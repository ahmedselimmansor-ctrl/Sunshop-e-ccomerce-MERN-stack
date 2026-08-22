import { z } from 'zod';

import {
  MAX_IMAGES_PER_PRODUCT,
  PRODUCT_SORTS,
  PRODUCT_STATUSES,
  STOCK_POLICIES,
} from '../constants';

import {
  booleanQuery,
  csvArray,
  currencySchema,
  localizedStringSchema,
  localizedTextSchema,
  moneySchema,
  objectIdSchema,
  paginationQuerySchema,
  partialLocalizedStringSchema,
  slugSchema,
} from './common';

/** SKU: uppercase alphanumeric with dashes, stable across locales. */
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(48)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, { message: 'invalid_sku' });

export const productImageSchema = z.object({
  key: z.string().min(1).max(300),
  alt: partialLocalizedStringSchema.optional(),
  position: z.number().int().min(0).max(99).default(0),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** Tiny base64 LQIP so the grid never flashes empty boxes. */
  blurhash: z.string().max(120).optional(),
});
export type ProductImageInput = z.infer<typeof productImageSchema>;

export const productImageOutputSchema = productImageSchema.extend({
  url: z.string().url(),
  /** CDN-rendered widths, e.g. { 320: 'https://cdn/...w=320' }. */
  srcset: z.record(z.string(), z.string().url()).optional(),
});
export type ProductImage = z.infer<typeof productImageOutputSchema>;

/** One axis of variation, e.g. { name: {en:'Size'}, values:['S','M','L'] }. */
export const productOptionSchema = z.object({
  name: localizedStringSchema,
  code: z.string().trim().min(1).max(40),
  values: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(60),
        label: localizedStringSchema,
        /** Hex swatch for colour options. */
        swatch: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type ProductOption = z.infer<typeof productOptionSchema>;

export const productVariantSchema = z.object({
  _id: objectIdSchema.optional(),
  sku: skuSchema,
  /** Map of option code → value code, e.g. { size: 'M', color: 'black' }. */
  optionValues: z.record(z.string(), z.string()).default({}),
  price: moneySchema,
  compareAtPrice: moneySchema.nullable().optional(),
  costPrice: moneySchema.nullable().optional(),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  /** Units held by unpaid orders; available = stock - reserved. */
  reserved: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).max(10_000).default(5),
  stockPolicy: z.enum(STOCK_POLICIES).default('deny'),
  barcode: z.string().trim().max(64).optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).optional(),
  imageKey: z.string().max(300).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type ProductVariantInput = z.infer<typeof productVariantSchema>;

export const productBaseSchema = z.object({
  name: localizedStringSchema,
  slug: slugSchema,
  description: localizedTextSchema,
  shortDescription: partialLocalizedStringSchema.optional(),
  brand: z.string().trim().max(80).optional(),
  categories: z.array(objectIdSchema).min(1).max(8),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  images: z.array(productImageSchema).max(MAX_IMAGES_PER_PRODUCT).default([]),
  options: z.array(productOptionSchema).max(4).default([]),
  variants: z.array(productVariantSchema).min(1).max(200),
  status: z.enum(PRODUCT_STATUSES).default('draft'),
  isFeatured: z.boolean().default(false),
  /** Free-form spec sheet rows rendered on the PDP. */
  attributes: z
    .array(
      z.object({
        key: localizedStringSchema,
        value: localizedStringSchema,
      }),
    )
    .max(40)
    .default([]),
  seo: z
    .object({
      title: partialLocalizedStringSchema.optional(),
      description: partialLocalizedStringSchema.optional(),
      keywords: z.array(z.string().max(40)).max(20).optional(),
    })
    .optional(),
  taxCode: z.string().max(40).optional(),
  publishedAt: z.coerce.date().nullable().optional(),
});

export const createProductSchema = productBaseSchema
  .refine(
    (value) => new Set(value.variants.map((variant) => variant.sku)).size === value.variants.length,
    { message: 'duplicate_sku', path: ['variants'] },
  )
  .refine(
    (value) =>
      value.variants.every(
        (variant) => variant.price.currency === value.variants[0]?.price.currency,
      ),
    { message: 'mixed_currencies', path: ['variants'] },
  )
  .refine(
    (value) =>
      value.variants.every(
        (variant) =>
          !variant.compareAtPrice || variant.compareAtPrice.amount > variant.price.amount,
      ),
    { message: 'compare_at_must_exceed_price', path: ['variants'] },
  )
  .refine(
    (value) => {
      // Every variant must map exactly the declared option axes.
      const codes = new Set(value.options.map((option) => option.code));
      if (codes.size === 0) return true;
      return value.variants.every((variant) => {
        const keys = Object.keys(variant.optionValues);
        return keys.length === codes.size && keys.every((key) => codes.has(key));
      });
    },
    { message: 'variant_options_mismatch', path: ['variants'] },
  );
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = productBaseSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const updateStockSchema = z.object({
  variantId: objectIdSchema,
  /** Signed delta; the server applies it atomically with `$inc`. */
  delta: z.number().int().min(-100_000).max(100_000),
  reason: z.enum(['restock', 'correction', 'damage', 'return', 'manual']),
  note: z.string().trim().max(300).optional(),
});
export type UpdateStockInput = z.infer<typeof updateStockSchema>;

export const bulkProductActionSchema = z.object({
  ids: z.array(objectIdSchema).min(1).max(200),
  action: z.enum(['publish', 'unpublish', 'archive', 'delete', 'feature', 'unfeature']),
});

// ── Output projections ──────────────────────────────────────────────────────

export const productVariantOutputSchema = productVariantSchema.extend({
  _id: objectIdSchema,
  imageUrl: z.string().url().nullable().optional(),
  available: z.number().int(),
  inStock: z.boolean(),
  isLowStock: z.boolean(),
});
export type ProductVariant = z.infer<typeof productVariantOutputSchema>;

export const productSchema = productBaseSchema.extend({
  id: objectIdSchema,
  images: z.array(productImageOutputSchema),
  variants: z.array(productVariantOutputSchema),
  /** Denormalized min/max across active variants: powers the price filter. */
  priceRange: z.object({ min: moneySchema, max: moneySchema }),
  rating: z.object({
    average: z.number().min(0).max(5),
    count: z.number().int().min(0),
    /** Histogram: index 0 === one star. */
    breakdown: z.array(z.number().int()).length(5).optional(),
  }),
  soldCount: z.number().int().min(0).default(0),
  inStock: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;

/** Trimmed card projection: what a 60-item grid actually needs. */
export const productCardSchema = z.object({
  id: objectIdSchema,
  name: localizedStringSchema,
  slug: slugSchema,
  brand: z.string().optional(),
  image: productImageOutputSchema.nullable(),
  priceRange: z.object({ min: moneySchema, max: moneySchema }),
  compareAtPrice: moneySchema.nullable().optional(),
  rating: z.object({ average: z.number(), count: z.number().int() }),
  inStock: z.boolean(),
  isFeatured: z.boolean().default(false),
  badges: z.array(z.enum(['new', 'sale', 'best_seller', 'low_stock'])).default([]),
});
export type ProductCard = z.infer<typeof productCardSchema>;

// ── Queries ─────────────────────────────────────────────────────────────────

export const productListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  category: z.union([objectIdSchema, slugSchema]).optional(),
  /** Include descendants of `category`. */
  includeSubcategories: booleanQuery.optional().default(true),
  brand: csvArray(z.string().max(80)).optional(),
  tags: csvArray(z.string().max(40)).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  currency: currencySchema.optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  inStock: booleanQuery.optional(),
  featured: booleanQuery.optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  sort: z.enum(PRODUCT_SORTS).default('relevance'),
  /** Arbitrary option filters, e.g. `?option.color=black,white`. */
  options: z.record(z.string(), z.string()).optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const searchQuerySchema = productListQuerySchema.extend({
  q: z.string().trim().min(1).max(200),
  /** Return aggregation buckets for the facet rail. */
  facets: booleanQuery.optional().default(true),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const facetBucketSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  count: z.number().int(),
});

export const searchFacetsSchema = z.object({
  categories: z.array(facetBucketSchema).default([]),
  brands: z.array(facetBucketSchema).default([]),
  tags: z.array(facetBucketSchema).default([]),
  options: z.record(z.string(), z.array(facetBucketSchema)).default({}),
  priceStats: z.object({ min: z.number(), max: z.number() }).nullable().default(null),
  ratings: z.array(facetBucketSchema).default([]),
});
export type SearchFacets = z.infer<typeof searchFacetsSchema>;

export const suggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(15).default(8),
});

export const suggestionSchema = z.object({
  type: z.enum(['product', 'category', 'brand', 'query']),
  text: z.string(),
  slug: z.string().optional(),
  imageUrl: z.string().url().nullable().optional(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;
