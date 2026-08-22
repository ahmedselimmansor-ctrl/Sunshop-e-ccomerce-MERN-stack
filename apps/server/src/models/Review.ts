import { REVIEW_STATUSES } from '@sunshop/shared';
import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const reviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** The order that proves the purchase, when there is one. */
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },

    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true, maxlength: 120, default: null },
    /** Sanitized server-side; stored as plain text, rendered as text. */
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    imageKeys: { type: [String], default: [] },

    status: { type: String, enum: REVIEW_STATUSES, default: 'pending', index: true },
    moderationNote: { type: String, maxlength: 300, default: null, select: false },
    moderatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    moderatedAt: { type: Date, default: null },

    isVerifiedPurchase: { type: Boolean, default: false, index: true },
    helpfulCount: { type: Number, default: 0, min: 0 },
    /** Users who marked it helpful: prevents repeat voting. */
    helpfulBy: { type: [Schema.Types.ObjectId], default: [], select: false },

    reply: {
      body: { type: String, maxlength: 1500, default: null },
      author: { type: String, default: null },
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

/** One review per customer per product; edits update the existing document. */
reviewSchema.index({ product: 1, user: 1 }, { unique: true });
reviewSchema.index({ product: 1, status: 1, createdAt: -1 });
reviewSchema.index({ product: 1, status: 1, helpfulCount: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });

export type ReviewAttributes = InferSchemaType<typeof reviewSchema>;
export type ReviewDocument = HydratedDocument<ReviewAttributes>;

export const Review = model<ReviewAttributes>('Review', reviewSchema);
