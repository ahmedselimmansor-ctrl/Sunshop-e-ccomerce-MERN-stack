import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/** Sub-schemas with `_id: false`, see the note in models/Product.ts. */
const localizedRequired = new Schema(
  {
    en: { type: String, required: true, trim: true, maxlength: 400 },
    ar: { type: String, required: true, trim: true, maxlength: 400 },
  },
  { _id: false },
);

const localizedOptional = new Schema(
  {
    en: { type: String, trim: true, maxlength: 20_000 },
    ar: { type: String, trim: true, maxlength: 20_000 },
  },
  { _id: false },
);

/**
 * Categories form a tree, stored with a materialized path.
 *
 * `path` holds the slash-joined ancestor ids (`/rootId/parentId/selfId`), which
 * turns "give me this category and every descendant": the single most common
 * catalog query: into one indexed prefix match instead of a recursive
 * `$graphLookup`. The cost is that a re-parent must rewrite the subtree, which
 * is rare and done in a transaction.
 */
const categorySchema = new Schema(
  {
    name: { type: localizedRequired, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: localizedOptional, default: undefined },

    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    /**
     * Materialized ancestor chain. Empty string for a root category: hence a
     * default rather than `required`, since Mongoose treats `''` as absent.
     * A child of root R is `/R`, its child `/R/C`, and so on.
     */
    path: { type: String, default: '', index: true },
    depth: { type: Number, required: true, default: 0, min: 0, max: 6 },

    imageKey: { type: String, default: null, maxlength: 300 },
    iconName: { type: String, default: null, maxlength: 60 },

    position: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    showInNav: { type: Boolean, default: true },

    seo: {
      title: { type: localizedOptional, default: undefined },
      description: { type: localizedOptional, default: undefined },
    },

    /** Denormalized count of active products, refreshed by a nightly job. */
    productCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

categorySchema.index({ parent: 1, position: 1 });
categorySchema.index({ isActive: 1, showInNav: 1, position: 1 });
// Prefix queries on `path` are the subtree lookup; a plain btree index serves them.
categorySchema.index({ path: 1, isActive: 1 });

categorySchema.virtual('children', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parent',
});

export type CategoryAttributes = InferSchemaType<typeof categorySchema>;
export type CategoryDocument = HydratedDocument<CategoryAttributes>;

export const Category = model<CategoryAttributes>('Category', categorySchema);
