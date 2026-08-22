import {
  CACHE_TTL,
  MAX_PAGE_SIZE,
  cacheKeys,
  cacheTags,
  slugify,
  type CreateProductInput,
  type PaginationMeta,
  type Product,
  type ProductCard,
  type ProductListQuery,
  type SearchFacets,
  type UpdateProductInput,
  type UpdateStockInput,
} from '@sunshop/shared';

import { Category } from '../../models/Category';
import { InventoryLog } from '../../models/InventoryLog';
import { OutboxEvent } from '../../models/OutboxEvent';
import { Product as ProductModel, type ProductDocument } from '../../models/Product';
import { moduleLogger } from '../../observability/logger';
import { isSearchAvailable } from '../../search/client';
import { searchProducts } from '../../search/productIndex';
import { scopeProducts } from '../../security/dataAccess';
import { audit, diff } from '../../services/audit';
import { cached, invalidateTags, queryHash } from '../../services/cache';
import { ApiError } from '../../utils/ApiError';
import { buildPaginationMeta } from '../../utils/http';

import { toProductCard, toProductDto } from './product.mapper';

import type { Principal } from '../../security/principal';
import type { FilterQuery, PipelineStage } from 'mongoose';

const log = moduleLogger('products');

export interface ProductListResult {
  items: ProductCard[];
  meta: PaginationMeta;
  facets: SearchFacets | null;
  /** True when the response came from the Mongo fallback, not Elasticsearch. */
  degraded: boolean;
}

/**
 * Catalogue listing.
 *
 * Elasticsearch is the primary path: it does relevance, facets and bilingual
 * analysis that Mongo cannot. When the cluster is unavailable the same query is
 * answered from MongoDB with reduced relevance and no facets, and the response
 * is flagged `degraded` so the UI can hide the facet rail instead of rendering
 * an empty one. A storefront that sells with worse ranking beats one that 503s.
 */
export async function listProducts(
  principal: Principal,
  query: ProductListQuery,
): Promise<ProductListResult> {
  const isStaffView = principal.can('product:write') && query.status !== undefined;

  // Staff views bypass the cache: a draft must appear the instant it is saved.
  if (isStaffView) return listFromMongo(principal, query, false);

  const cacheKey = cacheKeys.productList(queryHash({ ...query, locale: undefined }));

  return cached(
    cacheKey,
    async () => {
      if (isSearchAvailable()) {
        try {
          return await listFromSearch(query);
        } catch (error) {
          log.error({ err: (error as Error).message }, 'search failed; falling back to mongo');
        }
      }
      return listFromMongo(principal, query, true);
    },
    { ttl: CACHE_TTL.productList, tags: [cacheTags.products] },
  );
}

async function listFromSearch(query: ProductListQuery): Promise<ProductListResult> {
  const categoryPath = query.category
    ? await resolveCategoryPath(query.category, query.includeSubcategories !== false)
    : undefined;

  const result = await searchProducts({
    q: query.q,
    locale: 'en',
    categoryPath: categoryPath?.path,
    categoryId: categoryPath?.id,
    brands: query.brand,
    tags: query.tags,
    options: normalizeOptionFilters(query.options),
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    minRating: query.rating,
    inStockOnly: query.inStock,
    featuredOnly: query.featured,
    sort: query.sort,
    page: query.page,
    limit: Math.min(query.limit, MAX_PAGE_SIZE),
    withFacets: true,
  });

  // Elasticsearch decides *which* products and in what order; MongoDB remains
  // the source of truth for their current data, so a stale index can never
  // show a stale price.
  const documents = await ProductModel.find({ _id: { $in: result.ids } }).lean();
  const byId = new Map(documents.map((document) => [String(document._id), document]));
  const ordered = result.ids.map((id) => byId.get(id)).filter(Boolean);

  return {
    items: ordered.map((document) => toProductCard(document!)),
    meta: buildPaginationMeta(query.page, query.limit, result.total),
    facets: result.facets,
    degraded: false,
  };
}

async function listFromMongo(
  principal: Principal,
  query: ProductListQuery,
  degraded: boolean,
): Promise<ProductListResult> {
  const filter = await buildMongoFilter(principal, query);
  const sort = buildMongoSort(query);
  const skip = (query.page - 1) * query.limit;

  const [documents, total] = await Promise.all([
    ProductModel.find(filter).sort(sort).skip(skip).limit(query.limit).lean(),
    ProductModel.countDocuments(filter),
  ]);

  return {
    items: documents.map(toProductCard),
    meta: buildPaginationMeta(query.page, query.limit, total),
    facets: null,
    degraded,
  };
}

async function buildMongoFilter(
  principal: Principal,
  query: ProductListQuery,
): Promise<FilterQuery<Record<string, unknown>>> {
  const filter: FilterQuery<Record<string, unknown>> = scopeProducts(principal);

  if (query.status && principal.can('product:write')) filter.status = query.status;

  if (query.category) {
    if (query.includeSubcategories !== false) {
      const resolved = await resolveCategoryPath(query.category, true);
      if (resolved?.path) {
        filter.categoryPaths = { $regex: `^${escapeRegex(resolved.path)}` };
      } else if (resolved?.id) {
        filter.categories = resolved.id;
      }
    } else {
      const resolved = await resolveCategoryPath(query.category, false);
      if (resolved?.id) filter.categories = resolved.id;
    }
  }

  if (query.brand?.length) filter.brand = { $in: query.brand };
  if (query.tags?.length) filter.tags = { $in: query.tags };
  if (query.featured !== undefined) filter.isFeatured = query.featured;
  if (query.inStock) filter.totalStock = { $gt: 0 };
  if (query.rating !== undefined) filter.ratingAverage = { $gte: query.rating };

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.priceMin = {
      ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
    };
  }

  if (query.q) {
    filter.$text = { $search: query.q };
  }

  return filter;
}

function buildMongoSort(query: ProductListQuery): Record<string, 1 | -1 | { $meta: 'textScore' }> {
  switch (query.sort) {
    case 'newest':
      return { publishedAt: -1, _id: -1 };
    case 'price_asc':
      return { priceMin: 1, _id: 1 };
    case 'price_desc':
      return { priceMax: -1, _id: -1 };
    case 'rating_desc':
      return { ratingAverage: -1, ratingCount: -1 };
    case 'best_selling':
      return { soldCount: -1, _id: -1 };
    case 'relevance':
    default:
      return query.q
        ? { score: { $meta: 'textScore' }, soldCount: -1 }
        : { isFeatured: -1, soldCount: -1, _id: -1 };
  }
}

async function resolveCategoryPath(
  categoryRef: string,
  includeSubtree: boolean,
): Promise<{ id: string; path?: string } | null> {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(categoryRef);
  const category = await Category.findOne(isObjectId ? { _id: categoryRef } : { slug: categoryRef })
    .select('_id path')
    .lean();

  if (!category) return null;

  const id = String(category._id);
  if (!includeSubtree) return { id };
  return { id, path: `${category.path}/${id}` };
}

function normalizeOptionFilters(
  options: Record<string, string> | undefined,
): Record<string, string[]> {
  if (!options) return {};
  return Object.fromEntries(
    Object.entries(options).map(([code, value]) => [code, value.split(',').filter(Boolean)]),
  );
}

// ── Single product ──────────────────────────────────────────────────────────

export async function getProduct(principal: Principal, idOrSlug: string): Promise<Product> {
  const load = async () => {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrSlug);
    const filter = scopeProducts(principal, isObjectId ? { _id: idOrSlug } : { slug: idOrSlug });
    const document = await ProductModel.findOne(filter).lean();
    if (!document) throw ApiError.notFound();
    return toProductDto(document);
  };

  if (principal.can('product:write')) return load();

  return cached(cacheKeys.product(idOrSlug), load, {
    ttl: CACHE_TTL.productDetail,
    tags: [cacheTags.products],
  });
}

/** Fire-and-forget popularity counter; never blocks the response. */
export function recordProductView(productId: string): void {
  void ProductModel.updateOne({ _id: productId }, { $inc: { viewCount: 1 } }).catch(
    () => undefined,
  );
}

export async function getRelatedProducts(productId: string, limit = 8): Promise<ProductCard[]> {
  const product = await ProductModel.findById(productId).select('categories tags brand').lean();
  if (!product) return [];

  const pipeline: PipelineStage[] = [
    {
      $match: {
        _id: { $ne: product._id },
        status: 'active',
        deletedAt: null,
        $or: [
          { categories: { $in: product.categories } },
          ...(product.tags?.length ? [{ tags: { $in: product.tags } }] : []),
          ...(product.brand ? [{ brand: product.brand }] : []),
        ],
      },
    },
    // Rank by how much they overlap, then by how well they sell.
    {
      $addFields: {
        overlap: { $size: { $setIntersection: ['$categories', product.categories] } },
      },
    },
    { $sort: { overlap: -1, soldCount: -1, ratingAverage: -1 } },
    { $limit: limit },
  ];

  const documents = await ProductModel.aggregate(pipeline);
  return documents.map(toProductCard);
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function createProduct(
  principal: Principal,
  input: CreateProductInput,
): Promise<Product> {
  const slug = input.slug || slugify(input.name.en);
  const categoryPaths = await buildCategoryPaths(input.categories);

  const document = await ProductModel.create({
    ...input,
    slug,
    categoryPaths,
    currency: input.variants[0]!.price.currency,
  });

  await afterProductWrite(document, 'product.upserted');
  audit({
    action: 'product.created',
    actor: principal,
    target: { type: 'product', id: String(document._id), label: document.slug },
  });

  return toProductDto(document);
}

export async function updateProduct(
  principal: Principal,
  id: string,
  input: UpdateProductInput,
): Promise<Product> {
  const document = await ProductModel.findById(id);
  if (!document || document.deletedAt) throw ApiError.notFound();

  const before = document.toObject();

  if (input.categories) {
    document.categoryPaths = await buildCategoryPaths(input.categories);
  }

  Object.assign(document, input);
  await document.save();

  await afterProductWrite(document, 'product.upserted');
  audit({
    action: 'product.updated',
    actor: principal,
    target: { type: 'product', id, label: document.slug },
    changes: diff(before, document.toObject(), [
      'name',
      'slug',
      'status',
      'brand',
      'categories',
      'isFeatured',
      'priceMin',
      'priceMax',
    ]),
  });

  return toProductDto(document);
}

/**
 * Soft delete. Orders reference products for their line-item snapshots and
 * analytics joins; a hard delete would orphan both. `deletedAt` removes it from
 * every customer-facing query and from the search index.
 */
export async function deleteProduct(principal: Principal, id: string): Promise<void> {
  const document = await ProductModel.findById(id);
  if (!document || document.deletedAt) throw ApiError.notFound();

  document.deletedAt = new Date();
  document.status = 'archived';
  await document.save();

  await afterProductWrite(document, 'product.deleted');
  audit({
    action: 'product.deleted',
    actor: principal,
    target: { type: 'product', id, label: document.slug },
  });
}

export async function bulkAction(
  principal: Principal,
  ids: string[],
  action: 'publish' | 'unpublish' | 'archive' | 'delete' | 'feature' | 'unfeature',
): Promise<{ modified: number }> {
  const update: Record<string, unknown> = {};

  switch (action) {
    case 'publish':
      update.status = 'active';
      update.publishedAt = new Date();
      break;
    case 'unpublish':
      update.status = 'draft';
      break;
    case 'archive':
      update.status = 'archived';
      break;
    case 'delete':
      update.deletedAt = new Date();
      update.status = 'archived';
      break;
    case 'feature':
      update.isFeatured = true;
      break;
    case 'unfeature':
      update.isFeatured = false;
      break;
  }

  const result = await ProductModel.updateMany({ _id: { $in: ids } }, update);

  await OutboxEvent.insertMany(
    ids.map((id) => ({
      type: action === 'delete' ? 'product.deleted' : 'product.upserted',
      payload: { productId: id },
      dedupeKey: `product:${id}:${Date.now()}`,
    })),
  );
  await invalidateTags(cacheTags.products);

  audit({
    action: action === 'delete' ? 'product.deleted' : 'product.updated',
    actor: principal,
    target: { type: 'product', id: null, label: `${ids.length} products` },
    reason: `bulk:${action}`,
  });

  return { modified: result.modifiedCount };
}

/**
 * Adjusts stock atomically.
 *
 * `$inc` with a guard filter, not read-modify-write: two concurrent
 * adjustments must not lose one another, and a decrement must never take a
 * variant negative.
 */
export async function adjustStock(
  principal: Principal,
  productId: string,
  input: UpdateStockInput,
): Promise<{ stock: number }> {
  const filter: FilterQuery<Record<string, unknown>> = {
    _id: productId,
    'variants._id': input.variantId,
  };

  // For a decrement, require enough stock in the same atomic operation.
  if (input.delta < 0) {
    filter.variants = { $elemMatch: { _id: input.variantId, stock: { $gte: -input.delta } } };
  }

  const updated = await ProductModel.findOneAndUpdate(
    filter,
    { $inc: { 'variants.$[variant].stock': input.delta } },
    {
      new: true,
      arrayFilters: [{ 'variant._id': input.variantId }],
    },
  );

  if (!updated) {
    throw ApiError.conflict('errors.out_of_stock', [
      { path: 'variantId', message: 'insufficient_stock' },
    ]);
  }

  const variant = updated.variants.find((entry) => String(entry._id) === input.variantId);
  // Recalculate the denormalized totals through the save hook.
  await updated.save();

  await InventoryLog.create({
    product: productId,
    variantId: input.variantId,
    sku: variant?.sku ?? 'unknown',
    delta: input.delta,
    stockAfter: variant?.stock ?? 0,
    reason: input.reason,
    note: input.note,
    by: principal.id,
  });

  await afterProductWrite(updated, 'product.upserted');
  audit({
    action: 'inventory.adjusted',
    actor: principal,
    target: { type: 'variant', id: input.variantId, label: variant?.sku },
    changes: { stock: { from: (variant?.stock ?? 0) - input.delta, to: variant?.stock ?? 0 } },
    reason: input.reason,
  });

  return { stock: variant?.stock ?? 0 };
}

export async function getLowStock(threshold?: number): Promise<
  {
    productId: string;
    variantId: string;
    sku: string;
    name: unknown;
    stock: number;
    threshold: number;
  }[]
> {
  const products = await ProductModel.find({ status: 'active', deletedAt: null })
    .select('name variants')
    .lean();

  const rows: {
    productId: string;
    variantId: string;
    sku: string;
    name: unknown;
    stock: number;
    threshold: number;
  }[] = [];

  for (const product of products) {
    for (const variant of product.variants) {
      const limit = threshold ?? variant.lowStockThreshold ?? 5;
      const available = Math.max(0, variant.stock - variant.reserved);
      if (available <= limit) {
        rows.push({
          productId: String(product._id),
          variantId: String(variant._id),
          sku: variant.sku,
          name: product.name,
          stock: available,
          threshold: limit,
        });
      }
    }
  }

  return rows.sort((a, b) => a.stock - b.stock);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function buildCategoryPaths(categoryIds: string[]): Promise<string[]> {
  const categories = await Category.find({ _id: { $in: categoryIds } })
    .select('_id path')
    .lean();
  return categories.map((category) => `${category.path}/${String(category._id)}`);
}

/**
 * Post-write side effects: invalidate the cache now (cheap, in-process) and
 * queue the search index update in the outbox (durable, retried).
 */
async function afterProductWrite(
  document: ProductDocument,
  eventType: 'product.upserted' | 'product.deleted',
): Promise<void> {
  const id = String(document._id);

  await OutboxEvent.create({
    type: eventType,
    payload: { productId: id },
    dedupeKey: `${eventType}:${id}:${document.updatedAt?.getTime() ?? Date.now()}`,
  });

  await invalidateTags(cacheTags.products, cacheTags.product(id));
  // Slug-keyed entries are not covered by the id tag.
  const { cacheDelete } = await import('../../services/cache');
  await cacheDelete(cacheKeys.product(id), cacheKeys.product(document.slug));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
