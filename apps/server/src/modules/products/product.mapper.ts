/* eslint-disable @typescript-eslint/no-explicit-any --
 * These mappers accept either a Mongoose `HydratedDocument` or the plain object
 * returned by `.lean()`, and the two have structurally different types for the
 * same fields (ObjectId vs string, Map vs Record). Threading a union through
 * every field access buys nothing here: the shape is validated on the way in by
 * the schema and on the way out by the DTO's own type.
 */
import {
  IMAGE_RENDITIONS,
  discountPercent,
  type Currency,
  type Product,
  type ProductCard,
} from '@sunshop/shared';

import { publicUrlFor, srcSetFor } from '../../services/storage';

import type { ProductDocument } from '../../models/Product';
import type { IndexedProduct } from '../../search/productIndex';

type AnyProduct = ProductDocument | Record<string, any>;

/**
 * Projections.
 *
 * Three shapes, deliberately: the full `Product` for a detail page, the trimmed
 * `ProductCard` for grids (a 60-item grid does not need 60 full descriptions
 * and 700 variants), and `IndexedProduct` for Elasticsearch. Serving the full
 * document everywhere is the single easiest way to make a catalogue slow.
 */

function mapImage(image: Record<string, any>) {
  return {
    key: image.key,
    alt: image.alt ?? undefined,
    position: image.position ?? 0,
    width: image.width,
    height: image.height,
    blurhash: image.blurhash,
    url: publicUrlFor(image.key) ?? '',
    srcset: srcSetFor(image.key, IMAGE_RENDITIONS),
  };
}

export function toProductDto(document: AnyProduct): Product {
  const images = [...(document.images ?? [])].sort(
    (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0),
  );

  const variants = (document.variants ?? []).map((variant: any) => {
    const available = Math.max(0, (variant.stock ?? 0) - (variant.reserved ?? 0));
    return {
      _id: String(variant._id),
      sku: variant.sku,
      optionValues:
        variant.optionValues instanceof Map
          ? Object.fromEntries(variant.optionValues)
          : (variant.optionValues ?? {}),
      price: variant.price,
      compareAtPrice: variant.compareAtPrice ?? null,
      stock: variant.stock ?? 0,
      reserved: variant.reserved ?? 0,
      lowStockThreshold: variant.lowStockThreshold ?? 5,
      stockPolicy: variant.stockPolicy ?? 'deny',
      barcode: variant.barcode,
      weightGrams: variant.weightGrams,
      imageKey: variant.imageKey ?? null,
      imageUrl: publicUrlFor(variant.imageKey),
      isActive: variant.isActive ?? true,
      available,
      inStock: available > 0 || variant.stockPolicy === 'continue',
      isLowStock: available > 0 && available <= (variant.lowStockThreshold ?? 5),
    };
  });

  const currency = (document.currency ?? 'USD') as Currency;

  return {
    id: String(document._id),
    name: document.name,
    slug: document.slug,
    description: document.description,
    shortDescription: document.shortDescription ?? undefined,
    brand: document.brand ?? undefined,
    categories: (document.categories ?? []).map((id: unknown) => String(id)),
    tags: document.tags ?? [],
    images: images.map(mapImage),
    options: (document.options ?? []).map((option: any) => ({
      name: option.name,
      code: option.code,
      values: option.values ?? [],
    })),
    variants,
    status: document.status,
    isFeatured: Boolean(document.isFeatured),
    attributes: document.attributes ?? [],
    seo: document.seo ?? undefined,
    taxCode: document.taxCode ?? undefined,
    publishedAt: document.publishedAt ?? null,
    priceRange: {
      min: { amount: document.priceMin ?? 0, currency },
      max: { amount: document.priceMax ?? 0, currency },
    },
    rating: {
      average: document.ratingAverage ?? 0,
      count: document.ratingCount ?? 0,
      breakdown: document.ratingBreakdown ?? [0, 0, 0, 0, 0],
    },
    soldCount: document.soldCount ?? 0,
    inStock: (document.totalStock ?? 0) > 0,
    createdAt: new Date(document.createdAt).toISOString(),
    updatedAt: new Date(document.updatedAt).toISOString(),
  };
}

export function toProductCard(document: AnyProduct): ProductCard {
  const currency = (document.currency ?? 'USD') as Currency;
  const primaryImage = [...(document.images ?? [])].sort(
    (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0),
  )[0];

  // The best compare-at across variants drives the "sale" badge.
  const compareAt = (document.variants ?? [])
    .map((variant: any) => variant.compareAtPrice?.amount ?? 0)
    .reduce((max: number, value: number) => Math.max(max, value), 0);

  const badges: ProductCard['badges'] = [];
  const publishedAt = document.publishedAt ? new Date(document.publishedAt).getTime() : 0;
  const isNew = publishedAt > Date.now() - 30 * 24 * 60 * 60 * 1000;

  if (isNew) badges.push('new');
  if (compareAt > (document.priceMin ?? 0)) badges.push('sale');
  if ((document.soldCount ?? 0) > 50) badges.push('best_seller');
  if ((document.totalStock ?? 0) > 0 && (document.totalStock ?? 0) <= 5) badges.push('low_stock');

  return {
    id: String(document._id),
    name: document.name,
    slug: document.slug,
    brand: document.brand ?? undefined,
    image: primaryImage ? mapImage(primaryImage) : null,
    priceRange: {
      min: { amount: document.priceMin ?? 0, currency },
      max: { amount: document.priceMax ?? 0, currency },
    },
    compareAtPrice: compareAt > 0 ? { amount: compareAt, currency } : null,
    rating: { average: document.ratingAverage ?? 0, count: document.ratingCount ?? 0 },
    inStock: (document.totalStock ?? 0) > 0,
    isFeatured: Boolean(document.isFeatured),
    badges,
  };
}

/**
 * Builds the Elasticsearch document.
 *
 * `boost` folds sales, rating and recency into one number so relevance ties
 * break toward products that actually sell. Recomputed on every index write,
 * which is cheap and keeps the signal from going stale.
 */
export function toIndexedProduct(
  document: AnyProduct,
  categoryNames: { en: string[]; ar: string[] },
): IndexedProduct {
  const currency = (document.currency ?? 'USD') as Currency;
  const variants = document.variants ?? [];

  const options = variants.flatMap((variant: any) => {
    const values =
      variant.optionValues instanceof Map
        ? Object.fromEntries(variant.optionValues)
        : (variant.optionValues ?? {});
    return Object.entries(values).map(([code, value]) => ({ code, value: String(value) }));
  });

  const compareAt = variants
    .map((variant: any) => variant.compareAtPrice?.amount ?? 0)
    .reduce((max: number, value: number) => Math.max(max, value), 0);

  const ageDays = document.publishedAt
    ? (Date.now() - new Date(document.publishedAt).getTime()) / 86_400_000
    : 3650;

  const boost =
    1 +
    Math.log1p(document.soldCount ?? 0) * 2 +
    (document.ratingAverage ?? 0) * Math.log1p(document.ratingCount ?? 0) +
    // Recency decays over roughly a quarter.
    Math.max(0, 3 - ageDays / 30);

  const primaryImage = [...(document.images ?? [])].sort(
    (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0),
  )[0];

  return {
    id: String(document._id),
    slug: document.slug,
    status: document.status,
    name: document.name,
    description: document.description ?? { en: '', ar: '' },
    brand: document.brand ?? undefined,
    tags: document.tags ?? [],
    sku: variants.map((variant: any) => variant.sku),
    categoryIds: (document.categories ?? []).map((id: unknown) => String(id)),
    categoryPaths: document.categoryPaths ?? [],
    categoryNames,
    // Deduplicate: 40 variants sharing 4 colours should index 4 colour terms.
    options: dedupeOptions(options),
    priceMin: document.priceMin ?? 0,
    priceMax: document.priceMax ?? 0,
    currency,
    compareAtPrice: compareAt > 0 ? compareAt : null,
    discountPercent:
      compareAt > 0
        ? discountPercent(
            { amount: compareAt, currency },
            { amount: document.priceMin ?? 0, currency },
          )
        : 0,
    inStock: (document.totalStock ?? 0) > 0,
    totalStock: document.totalStock ?? 0,
    isFeatured: Boolean(document.isFeatured),
    ratingAverage: document.ratingAverage ?? 0,
    ratingCount: document.ratingCount ?? 0,
    soldCount: document.soldCount ?? 0,
    imageKey: primaryImage?.key ?? null,
    blurhash: primaryImage?.blurhash ?? null,
    createdAt: new Date(document.createdAt).toISOString(),
    publishedAt: document.publishedAt ? new Date(document.publishedAt).toISOString() : null,
    updatedAt: new Date(document.updatedAt).toISOString(),
    boost: Number(boost.toFixed(3)),
  };
}

function dedupeOptions(
  options: { code: string; value: string }[],
): { code: string; value: string }[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const composite = `${option.code}:${option.value}`;
    if (seen.has(composite)) return false;
    seen.add(composite);
    return true;
  });
}
