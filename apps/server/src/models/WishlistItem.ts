import { Schema, model } from 'mongoose';

/**
 * Saved products.
 *
 * A separate collection rather than an array on the user document: a wishlist
 * is unbounded in principle, and an ever-growing array inside `users` would
 * make every authentication read progressively more expensive for no reason.
 * The compound unique index is what makes "add" idempotent.
 */
const wishlistItemSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    addedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

wishlistItemSchema.index({ user: 1, product: 1 }, { unique: true });
wishlistItemSchema.index({ user: 1, addedAt: -1 });

export const WishlistItem = model('WishlistItem', wishlistItemSchema);
