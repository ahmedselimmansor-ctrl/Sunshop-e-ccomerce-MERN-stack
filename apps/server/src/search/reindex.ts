import { Category } from '../models/Category';
import { Product } from '../models/Product';
import { toIndexedProduct } from '../modules/products/product.mapper';
import { moduleLogger } from '../observability/logger';

import { INDEX } from './client';
import {
  bulkIndexProducts,
  ensureIndices,
  indexProduct,
  recreateProductIndex,
  removeProduct,
  swapProductAlias,
} from './productIndex';

const log = moduleLogger('search:reindex');

const BATCH_SIZE = 500;

/**
 * Zero-downtime full reindex.
 *
 * Writes into a fresh versioned index, then swaps the alias. Search keeps
 * answering from the old index throughout, which matters because a reindex of a
 * large catalogue takes minutes and a blank storefront search for that long is
 * a revenue event.
 */
export async function reindexAll(): Promise<{ indexed: number; errors: number; index: string }> {
  await ensureIndices();

  const target = await recreateProductIndex();
  log.info({ index: target }, 'reindex started');

  const categoryNames = await loadCategoryNames();

  let indexed = 0;
  let errors = 0;
  let skip = 0;

  for (;;) {
    const batch = await Product.find({ deletedAt: null })
      .sort({ _id: 1 })
      .skip(skip)
      .limit(BATCH_SIZE)
      .lean();

    if (batch.length === 0) break;

    const documents = batch.map((product) =>
      toIndexedProduct(product, resolveNames(product.categories, categoryNames)),
    );

    const result = await bulkIndexProducts(documents, target);
    indexed += result.indexed;
    errors += result.errors;
    skip += batch.length;

    log.debug({ indexed, errors }, 'reindex progress');
  }

  await swapProductAlias(target);
  await Product.updateMany({ deletedAt: null }, { indexedAt: new Date() });

  log.info({ indexed, errors, index: target }, 'reindex complete');
  return { indexed, errors, index: target };
}

/** Indexes (or removes) a single product: the outbox worker's unit of work. */
export async function syncProduct(productId: string): Promise<void> {
  const product = await Product.findById(productId).lean();

  if (!product || product.deletedAt || product.status !== 'active') {
    await removeProduct(productId);
    return;
  }

  const categoryNames = await loadCategoryNames(product.categories.map(String));
  await indexProduct(
    toIndexedProduct(product, resolveNames(product.categories, categoryNames)),
    INDEX.products,
  );
  await Product.updateOne({ _id: productId }, { indexedAt: new Date() });
}

type NameMap = Map<string, { en: string; ar: string }>;

async function loadCategoryNames(ids?: string[]): Promise<NameMap> {
  const filter = ids?.length ? { _id: { $in: ids } } : {};
  const categories = await Category.find(filter).select('_id name').lean();
  return new Map(
    categories.map((category) => [
      String(category._id),
      { en: category.name.en, ar: category.name.ar },
    ]),
  );
}

function resolveNames(categoryIds: unknown[], names: NameMap): { en: string[]; ar: string[] } {
  const en: string[] = [];
  const ar: string[] = [];

  for (const id of categoryIds) {
    const entry = names.get(String(id));
    if (!entry) continue;
    en.push(entry.en);
    ar.push(entry.ar);
  }

  return { en, ar };
}
