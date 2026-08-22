/* eslint-disable @typescript-eslint/no-explicit-any --
 * These mappers accept either a Mongoose `HydratedDocument` or the plain object
 * returned by `.lean()`, and the two have structurally different types for the
 * same fields (ObjectId vs string, Map vs Record). Threading a union through
 * every field access buys nothing here: the shape is validated on the way in by
 * the schema and on the way out by the DTO's own type.
 */
import {
  CACHE_TTL,
  cacheKeys,
  cacheTags,
  slugify,
  type Category,
  type CategoryNode,
  type CreateCategoryInput,
  type ReorderCategoriesInput,
  type UpdateCategoryInput,
} from '@sunshop/shared';

import { withTransaction } from '../../db/mongoose';
import { Category as CategoryModel, type CategoryDocument } from '../../models/Category';
import { Product } from '../../models/Product';
import { scopeCategories } from '../../security/dataAccess';
import { audit, diff } from '../../services/audit';
import { cached, invalidateTags } from '../../services/cache';
import { publicUrlFor } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';

import type { Principal } from '../../security/principal';
import type { Types } from 'mongoose';

/**
 * Category tree operations.
 *
 * `path` is a materialized ancestor chain (`/id1/id2/id3`). Reads of a subtree
 * become one indexed prefix query; the cost is paid on re-parenting, which
 * rewrites the affected subtree inside a transaction. For a catalogue whose
 * tree changes monthly and is read millions of times a day, that is the right
 * trade.
 */

function toDto(document: CategoryDocument | Record<string, any>): Category {
  return {
    id: String(document._id),
    name: document.name,
    slug: document.slug,
    description: document.description ?? undefined,
    parent: document.parent ? String(document.parent) : null,
    path: document.path,
    depth: document.depth,
    imageKey: document.imageKey ?? null,
    imageUrl: publicUrlFor(document.imageKey),
    iconName: document.iconName ?? null,
    position: document.position,
    isActive: document.isActive,
    showInNav: document.showInNav,
    seo: document.seo ?? undefined,
    productCount: document.productCount ?? 0,
    createdAt: new Date(document.createdAt).toISOString(),
    updatedAt: new Date(document.updatedAt).toISOString(),
  };
}

async function computePath(parentId: string | null): Promise<{ path: string; depth: number }> {
  if (!parentId) return { path: '', depth: 0 };

  const parent = await CategoryModel.findById(parentId).select('path depth').lean();
  if (!parent) {
    throw ApiError.badRequest('errors.not_found', [
      { path: 'parent', message: 'parent_not_found' },
    ]);
  }
  if (parent.depth >= 5) {
    throw ApiError.badRequest('errors.bad_request', [
      { path: 'parent', message: 'max_depth_exceeded' },
    ]);
  }

  return { path: `${parent.path}/${parentId}`, depth: parent.depth + 1 };
}

export async function listCategories(principal: Principal): Promise<Category[]> {
  const documents = await CategoryModel.find(scopeCategories(principal))
    .sort({ depth: 1, position: 1, 'name.en': 1 })
    .lean();
  return documents.map(toDto);
}

/**
 * Full navigation tree. Cached aggressively: it changes rarely and is on
 * every page render: and invalidated by tag on any category write.
 */
export async function getCategoryTree(principal: Principal): Promise<CategoryNode[]> {
  const buildTree = async (): Promise<CategoryNode[]> => {
    const flat = await listCategories(principal);
    const byId = new Map<string, CategoryNode>();
    const roots: CategoryNode[] = [];

    for (const category of flat) byId.set(category.id, { ...category, children: [] });

    for (const node of byId.values()) {
      if (node.parent && byId.has(node.parent)) {
        byId.get(node.parent)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortRecursive = (nodes: CategoryNode[]) => {
      nodes.sort((a, b) => a.position - b.position || a.name.en.localeCompare(b.name.en));
      for (const node of nodes) sortRecursive(node.children);
    };
    sortRecursive(roots);

    return roots;
  };

  // Staff see drafts, so their view is not shareable with the public cache.
  if (principal.can('category:write')) return buildTree();

  return cached(cacheKeys.categoryTree(), buildTree, {
    ttl: CACHE_TTL.categoryTree,
    tags: [cacheTags.categories],
  });
}

export async function getCategory(principal: Principal, idOrSlug: string): Promise<Category> {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrSlug);
  const filter = scopeCategories(principal, isObjectId ? { _id: idOrSlug } : { slug: idOrSlug });

  const document = await CategoryModel.findOne(filter).lean();
  if (!document) throw ApiError.notFound();
  return toDto(document);
}

/** Every descendant of a category, used to widen a catalogue filter. */
export async function getDescendantIds(categoryId: string): Promise<string[]> {
  const category = await CategoryModel.findById(categoryId).select('path').lean();
  if (!category) return [];

  const subtreePrefix = `${category.path}/${categoryId}`;
  const descendants = await CategoryModel.find({
    path: { $regex: `^${escapeRegex(subtreePrefix)}` },
  })
    .select('_id')
    .lean();

  return [categoryId, ...descendants.map((entry) => String(entry._id))];
}

export async function getSubtreePath(categoryId: string): Promise<string | null> {
  const category = await CategoryModel.findById(categoryId).select('path').lean();
  if (!category) return null;
  return `${category.path}/${categoryId}`;
}

export async function createCategory(
  principal: Principal,
  input: CreateCategoryInput,
): Promise<Category> {
  const { path, depth } = await computePath(input.parent ?? null);
  const slug = input.slug || slugify(input.name.en);

  const document = await CategoryModel.create({ ...input, slug, path, depth });

  await invalidateTags(cacheTags.categories);
  audit({
    action: 'category.created',
    actor: principal,
    target: { type: 'category', id: String(document._id), label: document.slug },
  });

  return toDto(document);
}

export async function updateCategory(
  principal: Principal,
  id: string,
  input: UpdateCategoryInput,
): Promise<Category> {
  const document = await CategoryModel.findById(id);
  if (!document) throw ApiError.notFound();

  const before = document.toObject();
  const reparenting =
    input.parent !== undefined && String(input.parent ?? '') !== String(document.parent ?? '');

  if (reparenting) {
    await assertNoCycle(id, input.parent ?? null);
  }

  Object.assign(document, input);

  if (reparenting) {
    const { path, depth } = await computePath(input.parent ?? null);
    const oldSubtree = `${document.path}/${id}`;
    document.path = path;
    document.depth = depth;
    await document.save();

    // Rewrite every descendant's path in one transaction, or none at all: a
    // half-rewritten tree would orphan products from their categories.
    await withTransaction(async (session) => {
      const newSubtree = `${path}/${id}`;
      const descendants = await CategoryModel.find({
        path: { $regex: `^${escapeRegex(oldSubtree)}` },
      }).session(session ?? null);

      for (const descendant of descendants) {
        descendant.path = descendant.path.replace(oldSubtree, newSubtree);
        descendant.depth = descendant.path.split('/').filter(Boolean).length;
        await descendant.save({ session: session ?? undefined });
      }
    });

    await refreshProductCategoryPaths(id);
  } else {
    await document.save();
  }

  await invalidateTags(cacheTags.categories, cacheTags.category(id));
  audit({
    action: 'category.updated',
    actor: principal,
    target: { type: 'category', id, label: document.slug },
    changes: diff(before, document.toObject(), ['name', 'slug', 'parent', 'isActive', 'position']),
  });

  return toDto(document);
}

export async function deleteCategory(principal: Principal, id: string): Promise<void> {
  const childCount = await CategoryModel.countDocuments({ parent: id });
  if (childCount > 0) throw ApiError.conflict('errors.category_has_children');

  const productCount = await Product.countDocuments({ categories: id, deletedAt: null });
  if (productCount > 0) {
    throw ApiError.conflict('errors.conflict', [
      { path: 'category', message: 'category_has_products' },
    ]);
  }

  const document = await CategoryModel.findByIdAndDelete(id);
  if (!document) throw ApiError.notFound();

  await invalidateTags(cacheTags.categories, cacheTags.category(id));
  audit({
    action: 'category.deleted',
    actor: principal,
    target: { type: 'category', id, label: document.slug },
  });
}

export async function reorderCategories(
  principal: Principal,
  input: ReorderCategoriesInput,
): Promise<void> {
  await withTransaction(async (session) => {
    for (const item of input.items) {
      await CategoryModel.updateOne(
        { _id: item.id },
        { position: item.position, parent: item.parent },
        { session: session ?? undefined },
      );
    }
  });

  await invalidateTags(cacheTags.categories);
  audit({
    action: 'category.updated',
    actor: principal,
    target: { type: 'category', id: null },
    reason: 'reorder',
  });
}

/** Recomputes `productCount` for every category. Runs nightly. */
export async function refreshProductCounts(): Promise<void> {
  const counts = await Product.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { status: 'active', deletedAt: null } },
    { $unwind: '$categories' },
    { $group: { _id: '$categories', count: { $sum: 1 } } },
  ]);

  const countById = new Map(counts.map((entry) => [String(entry._id), entry.count]));
  const categories = await CategoryModel.find().select('_id').lean();

  await CategoryModel.bulkWrite(
    categories.map((category) => ({
      updateOne: {
        filter: { _id: category._id },
        update: { productCount: countById.get(String(category._id)) ?? 0 },
      },
    })),
  );

  await invalidateTags(cacheTags.categories);
}

/** Keeps `Product.categoryPaths` in step after a subtree moves. */
async function refreshProductCategoryPaths(categoryId: string): Promise<void> {
  const category = await CategoryModel.findById(categoryId).select('path').lean();
  if (!category) return;

  const products = await Product.find({ categories: categoryId }).select('categories');
  for (const product of products) {
    const paths = await Promise.all(
      product.categories.map(async (id) => {
        const entry = await CategoryModel.findById(id).select('path').lean();
        return entry ? `${entry.path}/${id}` : null;
      }),
    );
    product.categoryPaths = paths.filter((value): value is string => Boolean(value));
    await product.save();
  }
}

async function assertNoCycle(categoryId: string, newParentId: string | null): Promise<void> {
  if (!newParentId) return;
  if (newParentId === categoryId) throw ApiError.conflict('errors.category_cycle');

  const parent = await CategoryModel.findById(newParentId).select('path').lean();
  if (!parent) throw ApiError.badRequest('errors.not_found');
  if (parent.path.split('/').includes(categoryId)) {
    throw ApiError.conflict('errors.category_cycle');
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
