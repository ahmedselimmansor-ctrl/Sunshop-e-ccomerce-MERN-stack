import { moduleLogger } from '../observability/logger';
import { searchQueryDuration } from '../observability/metrics';

import { INDEX, elastic } from './client';
import { productIndexSettings, suggestionIndexSettings } from './mappings';

import type { estypes } from '@elastic/elasticsearch';
import type { Locale, ProductSort, SearchFacets } from '@sunshop/shared';

const log = moduleLogger('search:products');

type QueryDslQueryContainer = estypes.QueryDslQueryContainer;
type SearchRequest = estypes.SearchRequest;
type SortCombinations = estypes.SortCombinations;

export interface IndexedProduct {
  id: string;
  slug: string;
  status: string;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  brand?: string;
  tags: string[];
  sku: string[];
  categoryIds: string[];
  categoryPaths: string[];
  categoryNames: { en: string[]; ar: string[] };
  options: { code: string; value: string }[];
  priceMin: number;
  priceMax: number;
  currency: string;
  compareAtPrice?: number | null;
  discountPercent: number;
  inStock: boolean;
  totalStock: number;
  isFeatured: boolean;
  ratingAverage: number;
  ratingCount: number;
  soldCount: number;
  imageKey?: string | null;
  blurhash?: string | null;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
  boost: number;
}

// ── Index lifecycle ─────────────────────────────────────────────────────────

/**
 * Creates the indices if they are missing.
 *
 * The product index is always created *behind an alias*: the concrete index is
 * `sunshop-products-000001` and `sunshop-products` is an alias pointing at it.
 * Writing to a concrete index whose name is the one the app queries would make
 * a zero-downtime reindex impossible: you cannot create an alias with the same
 * name as an existing index, so the very first swap would fail.
 */
export async function ensureIndices(): Promise<void> {
  const aliasExists = await elastic.indices
    .existsAlias({ name: INDEX.products })
    .catch(() => false);

  if (!aliasExists) {
    const concreteName = `${INDEX.products}-000001`;
    const concreteExists = await elastic.indices.exists({ index: concreteName });

    if (!concreteExists) {
      await elastic.indices.create({
        ...productIndexSettings,
        index: concreteName,
        aliases: { [INDEX.products]: {} },
      });
      log.info({ index: concreteName, alias: INDEX.products }, 'created product index');
    } else {
      await elastic.indices.putAlias({ index: concreteName, name: INDEX.products });
    }
  }

  // The suggestions index is queried by its own name and never reindexed
  // behind an alias, so a plain index is correct here.
  const suggestionsExist = await elastic.indices.exists({ index: INDEX.suggestions });
  if (!suggestionsExist) {
    await elastic.indices.create(suggestionIndexSettings);
    log.info({ index: INDEX.suggestions }, 'created suggestions index');
  }
}

/**
 * Rebuilds the product index behind an alias.
 *
 * Deleting and recreating the live index would blank the storefront's search
 * for the duration of a reindex. Instead a new versioned index is populated,
 * then the alias is swapped atomically, then the old one is dropped: so search
 * never returns an empty result set during a mapping change.
 */
export async function recreateProductIndex(): Promise<string> {
  const versioned = `${INDEX.products}-${Date.now()}`;
  await elastic.indices.create({ ...productIndexSettings, index: versioned });
  return versioned;
}

export async function swapProductAlias(newIndex: string): Promise<void> {
  const alias = INDEX.products;
  const existing = await elastic.indices.getAlias({ name: alias }).catch(() => null);
  const previous = existing ? Object.keys(existing) : [];

  await elastic.indices.updateAliases({
    actions: [
      ...previous.map((index) => ({ remove: { index, alias } })),
      { add: { index: newIndex, alias } },
    ],
  });

  for (const index of previous) {
    if (index !== newIndex) await elastic.indices.delete({ index }).catch(() => undefined);
  }
  log.info({ alias, index: newIndex, removed: previous }, 'alias swapped');
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function indexProduct(
  product: IndexedProduct,
  index: string = INDEX.products,
): Promise<void> {
  await elastic.index({ index, id: product.id, document: product, refresh: false });
}

export async function bulkIndexProducts(
  products: IndexedProduct[],
  index: string = INDEX.products,
): Promise<{ indexed: number; errors: number }> {
  if (products.length === 0) return { indexed: 0, errors: 0 };

  const operations = products.flatMap((product) => [
    { index: { _index: index, _id: product.id } },
    product,
  ]);

  const response = await elastic.bulk({ operations, refresh: false });
  const errors = response.items.filter((item) => item.index?.error).length;

  if (errors > 0) {
    const sample = response.items.find((item) => item.index?.error)?.index?.error;
    log.error({ errors, sample }, 'bulk index reported failures');
  }

  return { indexed: products.length - errors, errors };
}

export async function removeProduct(productId: string): Promise<void> {
  await elastic
    .delete({ index: INDEX.products, id: productId })
    .catch((error: { statusCode?: number }) => {
      if (error.statusCode !== 404) throw error;
    });
}

// ── Query building ──────────────────────────────────────────────────────────

export interface SearchProductsInput {
  q?: string;
  locale: Locale;
  categoryPath?: string;
  categoryId?: string;
  brands?: string[];
  tags?: string[];
  options?: Record<string, string[]>;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStockOnly?: boolean;
  featuredOnly?: boolean;
  sort: ProductSort;
  page: number;
  limit: number;
  withFacets?: boolean;
}

function buildFilters(input: SearchProductsInput): QueryDslQueryContainer[] {
  const filters: QueryDslQueryContainer[] = [{ term: { status: 'active' } }];

  if (input.categoryPath) {
    // Materialized-path prefix match pulls in the whole subtree.
    filters.push({ prefix: { categoryPaths: input.categoryPath } });
  } else if (input.categoryId) {
    filters.push({ term: { categoryIds: input.categoryId } });
  }

  if (input.brands?.length) filters.push({ terms: { 'brand.keyword': input.brands } });
  if (input.tags?.length) filters.push({ terms: { tags: input.tags } });

  if (input.minPrice !== undefined || input.maxPrice !== undefined) {
    filters.push({
      range: {
        priceMin: {
          ...(input.minPrice !== undefined ? { gte: input.minPrice } : {}),
          ...(input.maxPrice !== undefined ? { lte: input.maxPrice } : {}),
        },
      },
    });
  }

  if (input.minRating !== undefined) {
    filters.push({ range: { ratingAverage: { gte: input.minRating } } });
  }
  if (input.inStockOnly) filters.push({ term: { inStock: true } });
  if (input.featuredOnly) filters.push({ term: { isFeatured: true } });

  // Each option axis is ANDed; values within an axis are ORed. Nested so the
  // pair (code, value) must occur on the same variant.
  for (const [code, values] of Object.entries(input.options ?? {})) {
    if (values.length === 0) continue;
    filters.push({
      nested: {
        path: 'options',
        query: {
          bool: {
            filter: [{ term: { 'options.code': code } }, { terms: { 'options.value': values } }],
          },
        },
      },
    });
  }

  return filters;
}

function buildTextQuery(q: string, locale: Locale): QueryDslQueryContainer {
  const primary = locale === 'ar' ? 'ar' : 'en';
  const secondary = primary === 'ar' ? 'en' : 'ar';

  return {
    bool: {
      should: [
        // Exact-ish phrase in the caller's language wins outright.
        {
          multi_match: {
            query: q,
            type: 'phrase',
            fields: [`name.${primary}^12`, `brand^6`],
            boost: 3,
          },
        },
        {
          multi_match: {
            query: q,
            type: 'best_fields',
            fields: [
              `name.${primary}^8`,
              `name.${secondary}^4`,
              'brand^5',
              'tags^3',
              `categoryNames.${primary}^2`,
              `description.${primary}`,
            ],
            // One typo for short words, two for long ones: the default that
            // keeps "shrit" finding shirts without matching everything.
            fuzziness: 'AUTO',
            prefix_length: 1,
            max_expansions: 40,
            operator: 'or',
            minimum_should_match: '2<70%',
          },
        },
        // Exact SKU lookup: staff and power users paste SKUs into search.
        { term: { sku: { value: q.toUpperCase(), boost: 20 } } },
      ],
      minimum_should_match: 1,
    },
  };
}

function buildSort(sort: ProductSort, hasQuery: boolean): SortCombinations[] {
  switch (sort) {
    case 'newest':
      return [{ publishedAt: { order: 'desc', missing: '_last' } }];
    case 'price_asc':
      return [{ priceMin: 'asc' }];
    case 'price_desc':
      return [{ priceMax: 'desc' }];
    case 'rating_desc':
      return [{ ratingAverage: 'desc' }, { ratingCount: 'desc' }];
    case 'best_selling':
      return [{ soldCount: 'desc' }];
    case 'relevance':
    default:
      // Without a query there is no relevance to sort by; fall back to
      // popularity so an empty search still shows the best products first.
      return hasQuery ? ['_score', { boost: 'desc' }] : [{ boost: 'desc' }, { soldCount: 'desc' }];
  }
}

export interface SearchProductsResult {
  ids: string[];
  hits: IndexedProduct[];
  total: number;
  facets: SearchFacets | null;
  tookMs: number;
}

export async function searchProducts(input: SearchProductsInput): Promise<SearchProductsResult> {
  const filters = buildFilters(input);
  const from = (input.page - 1) * input.limit;

  const query: QueryDslQueryContainer = {
    bool: {
      filter: filters,
      ...(input.q ? { must: [buildTextQuery(input.q, input.locale)] } : {}),
    },
  };

  const request: SearchRequest = {
    index: INDEX.products,
    from,
    size: input.limit,
    // Deep paging past ~10k is a memory bomb; the UI switches to "refine your
    // search" past that point.
    track_total_hits: 10_000,
    query: input.q
      ? {
          // Blend text relevance with a popularity signal so a well-matching
          // dead product does not outrank a slightly-worse best seller.
          function_score: {
            query,
            functions: [
              { field_value_factor: { field: 'boost', factor: 1, modifier: 'log1p', missing: 1 } },
            ],
            boost_mode: 'multiply',
            score_mode: 'sum',
          },
        }
      : query,
    sort: buildSort(input.sort, Boolean(input.q)),
    _source: true,
    ...(input.withFacets ? { aggs: buildAggregations() } : {}),
  };

  const stop = searchQueryDuration.startTimer({ index: INDEX.products, operation: 'search' });
  const response = await elastic.search<IndexedProduct>(request);
  stop();

  const total =
    typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total?.value ?? 0);

  return {
    ids: response.hits.hits.map((hit) => hit._id!).filter(Boolean),
    hits: response.hits.hits.map((hit) => hit._source!).filter(Boolean),
    total,
    facets: input.withFacets ? parseFacets(response.aggregations) : null,
    tookMs: response.took,
  };
}

function buildAggregations(): SearchRequest['aggs'] {
  return {
    brands: { terms: { field: 'brand.keyword', size: 25 } },
    tags: { terms: { field: 'tags', size: 30 } },
    categories: { terms: { field: 'categoryIds', size: 30 } },
    price_stats: { stats: { field: 'priceMin' } },
    ratings: {
      range: {
        field: 'ratingAverage',
        ranges: [{ from: 4 }, { from: 3 }, { from: 2 }, { from: 1 }],
      },
    },
    options: {
      nested: { path: 'options' },
      aggs: {
        codes: {
          terms: { field: 'options.code', size: 10 },
          aggs: { values: { terms: { field: 'options.value', size: 40 } } },
        },
      },
    },
  };
}

type Bucket = { key: string | number; doc_count: number };

function parseFacets(aggregations: unknown): SearchFacets {
  const aggs = (aggregations ?? {}) as Record<
    string,
    { buckets?: Bucket[] } & Record<string, unknown>
  >;

  const toBuckets = (name: string) =>
    (aggs[name]?.buckets ?? []).map((bucket) => ({
      key: String(bucket.key),
      count: bucket.doc_count,
    }));

  const optionsAgg =
    (aggs.options as { codes?: { buckets?: (Bucket & { values?: { buckets?: Bucket[] } })[] } })
      ?.codes?.buckets ?? [];

  const priceStats = aggs.price_stats as { min?: number | null; max?: number | null } | undefined;

  const ratingBuckets =
    (aggs.ratings as { buckets?: { from?: number; doc_count: number }[] })?.buckets ?? [];

  return {
    categories: toBuckets('categories'),
    brands: toBuckets('brands'),
    tags: toBuckets('tags'),
    options: Object.fromEntries(
      optionsAgg.map((bucket) => [
        String(bucket.key),
        (bucket.values?.buckets ?? []).map((value) => ({
          key: String(value.key),
          count: value.doc_count,
        })),
      ]),
    ),
    priceStats:
      priceStats && priceStats.min != null && priceStats.max != null
        ? { min: priceStats.min, max: priceStats.max }
        : null,
    ratings: ratingBuckets
      .filter((bucket) => bucket.from !== undefined)
      .map((bucket) => ({ key: String(bucket.from), count: bucket.doc_count })),
  };
}

// ── Suggestions ─────────────────────────────────────────────────────────────

export interface SuggestHit {
  type: 'product' | 'category' | 'brand' | 'query';
  text: string;
  slug?: string;
  imageKey?: string | null;
}

export async function suggest(q: string, locale: Locale, limit: number): Promise<SuggestHit[]> {
  const stop = searchQueryDuration.startTimer({ index: INDEX.products, operation: 'suggest' });

  try {
    const response = await elastic.search<IndexedProduct>({
      index: INDEX.products,
      size: limit,
      query: {
        bool: {
          filter: [{ term: { status: 'active' } }],
          should: [
            { match: { [`name.${locale}.autocomplete`]: { query: q, boost: 4 } } },
            {
              match: {
                [`name.${locale === 'ar' ? 'en' : 'ar'}.autocomplete`]: { query: q, boost: 2 },
              },
            },
            { match: { 'brand.autocomplete': { query: q, boost: 1.5 } } },
          ],
          minimum_should_match: 1,
        },
      },
      _source: ['name', 'slug', 'imageKey', 'brand'],
      sort: ['_score', { boost: 'desc' }],
    });

    return response.hits.hits
      .map((hit) => hit._source)
      .filter((source): source is IndexedProduct => Boolean(source))
      .map((source) => ({
        type: 'product' as const,
        text: source.name[locale] || source.name.en || source.name.ar,
        slug: source.slug,
        imageKey: source.imageKey ?? null,
      }));
  } finally {
    stop();
  }
}

/**
 * Records what shoppers actually searched for. Feeds the "popular searches"
 * row and, over time, a query-rewriting dictionary for zero-result terms.
 */
export async function recordSearchTerm(
  term: string,
  locale: Locale,
  resultCount: number,
): Promise<void> {
  if (term.length < 2 || term.length > 80) return;
  await elastic
    .index({
      index: INDEX.suggestions,
      id: `query:${locale}:${term.toLowerCase()}`,
      document: { type: 'query', text: term, locale, weight: resultCount > 0 ? 1 : 0 },
    })
    .catch(() => undefined);
}
