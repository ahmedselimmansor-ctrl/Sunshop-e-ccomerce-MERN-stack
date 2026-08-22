import { CURRENCIES, PRODUCT_STATUSES, STOCK_POLICIES } from '@sunshop/shared';
import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * Localized string fields are real sub-schemas with `_id: false`.
 *
 * A plain object passed as `type:` makes Mongoose create a single nested
 * subdocument *with* an `_id`, which then leaks into API responses and: more
 * annoyingly: into the strict-mapped Elasticsearch document, where an
 * unexpected `name._id` is rejected outright.
 */
const localizedRequired = new Schema(
  {
    en: { type: String, required: true, trim: true, maxlength: 400 },
    ar: { type: String, required: true, trim: true, maxlength: 400 },
  },
  { _id: false },
);

const localizedText = new Schema(
  {
    en: { type: String, default: '', trim: true, maxlength: 20_000 },
    ar: { type: String, default: '', trim: true, maxlength: 20_000 },
  },
  { _id: false },
);

const localizedOptional = new Schema(
  {
    en: { type: String, trim: true, maxlength: 400 },
    ar: { type: String, trim: true, maxlength: 400 },
  },
  { _id: false },
);

/** Money is always an integer of minor units plus its currency. */
const moneySchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0, max: 1_000_000_000 },
    currency: { type: String, required: true, enum: CURRENCIES },
  },
  { _id: false },
);

const imageSchema = new Schema(
  {
    key: { type: String, required: true, maxlength: 300 },
    alt: { type: localizedOptional, default: undefined },
    position: { type: Number, default: 0, min: 0 },
    width: { type: Number, min: 1 },
    height: { type: Number, min: 1 },
    blurhash: { type: String, maxlength: 120 },
  },
  { _id: false },
);

const optionSchema = new Schema(
  {
    name: { type: localizedRequired, required: true },
    code: { type: String, required: true, trim: true, maxlength: 40 },
    values: [
      new Schema(
        {
          code: { type: String, required: true, trim: true, maxlength: 60 },
          label: { type: localizedRequired, required: true },
          swatch: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
        },
        { _id: false },
      ),
    ],
  },
  { _id: false },
);

const variantSchema = new Schema(
  {
    sku: { type: String, required: true, uppercase: true, trim: true, maxlength: 48 },
    optionValues: { type: Map, of: String, default: {} },
    price: { type: moneySchema, required: true },
    compareAtPrice: { type: moneySchema, default: null },
    costPrice: { type: moneySchema, default: null, select: false },
    stock: { type: Number, required: true, default: 0, min: 0 },
    /**
     * Units held by orders that are created but not yet paid. Availability is
     * `stock - reserved`, so two shoppers cannot both buy the last unit while
     * one of them is still on the payment page.
     */
    reserved: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    stockPolicy: { type: String, enum: STOCK_POLICIES, default: 'deny' },
    barcode: { type: String, trim: true, maxlength: 64 },
    weightGrams: { type: Number, min: 0 },
    imageKey: { type: String, default: null, maxlength: 300 },
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

const productSchema = new Schema(
  {
    name: { type: localizedRequired, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: localizedText, required: true },
    shortDescription: { type: localizedOptional, default: undefined },
    brand: { type: String, trim: true, maxlength: 80, index: true },

    categories: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
      default: [],
      index: true,
    },
    /** Denormalized ancestor ids so a subtree filter needs no join. */
    categoryPaths: { type: [String], default: [], index: true },

    tags: { type: [String], default: [], index: true },
    images: { type: [imageSchema], default: [] },
    options: { type: [optionSchema], default: [] },
    variants: {
      type: [variantSchema],
      validate: {
        validator: (value: unknown[]) => value.length > 0,
        message: 'product must have at least one variant',
      },
    },

    status: { type: String, enum: PRODUCT_STATUSES, default: 'draft', index: true },
    isFeatured: { type: Boolean, default: false, index: true },

    attributes: {
      type: [
        new Schema(
          {
            key: { type: localizedRequired, required: true },
            value: { type: localizedRequired, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    seo: {
      title: { type: localizedOptional, default: undefined },
      description: { type: localizedOptional, default: undefined },
      keywords: { type: [String], default: [] },
    },

    taxCode: { type: String, maxlength: 40 },

    /**
     * Denormalized aggregates. Recomputing a price range or a rating average on
     * every catalog request would make the grid unservable; these are updated
     * on write and by a reconciliation job.
     */
    priceMin: { type: Number, default: 0, index: true },
    priceMax: { type: Number, default: 0 },
    currency: { type: String, enum: CURRENCIES, required: true },
    totalStock: { type: Number, default: 0, index: true },

    ratingAverage: { type: Number, default: 0, min: 0, max: 5, index: true },
    ratingCount: { type: Number, default: 0, min: 0 },
    ratingBreakdown: { type: [Number], default: [0, 0, 0, 0, 0] },

    soldCount: { type: Number, default: 0, min: 0, index: true },
    viewCount: { type: Number, default: 0, min: 0 },

    publishedAt: { type: Date, default: null, index: true },
    /** Set by the search indexer once the document is live in Elasticsearch. */
    indexedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// SKUs are globally unique across every product's variants.
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });
// The catalog grid's default sort and its most common filters.
productSchema.index({ status: 1, publishedAt: -1 });
productSchema.index({ status: 1, categories: 1, priceMin: 1 });
productSchema.index({ status: 1, isFeatured: 1, soldCount: -1 });
productSchema.index({ status: 1, ratingAverage: -1, ratingCount: -1 });
// Mongo text index is the fallback when Elasticsearch is unavailable.
productSchema.index(
  { 'name.en': 'text', 'name.ar': 'text', brand: 'text', tags: 'text' },
  { weights: { 'name.en': 10, 'name.ar': 10, brand: 5, tags: 3 }, name: 'product_text' },
);

/** Keeps the denormalized aggregates in step with the variant array. */
productSchema.pre('save', function recalculate(next) {
  const activeVariants = this.variants.filter((variant) => variant.isActive);
  const pool = activeVariants.length > 0 ? activeVariants : this.variants;

  if (pool.length > 0) {
    const prices = pool.map((variant) => variant.price.amount);
    this.priceMin = Math.min(...prices);
    this.priceMax = Math.max(...prices);
    this.currency = pool[0]?.price.currency ?? this.currency;
    this.totalStock = pool.reduce(
      (total, variant) => total + Math.max(0, variant.stock - variant.reserved),
      0,
    );
  }

  if (this.status === 'active' && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  next();
});

productSchema.virtual('inStock').get(function inStock(this: { totalStock: number }) {
  return this.totalStock > 0;
});

export type ProductAttributes = InferSchemaType<typeof productSchema>;
export type ProductDocument = HydratedDocument<ProductAttributes>;
export type ProductVariantSubdocument = ProductDocument['variants'][number];

export const Product = model<ProductAttributes>('Product', productSchema);
