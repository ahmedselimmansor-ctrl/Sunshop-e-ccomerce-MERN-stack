import { Schema, model } from 'mongoose';

/**
 * Every stock movement, ever.
 *
 * Inventory disputes ("the system says 3, the shelf says 1") are unresolvable
 * without a ledger: the current count is a derived number, the movements are
 * the facts. Also feeds the shrinkage report.
 */
const inventoryLogSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, required: true, index: true },
    sku: { type: String, required: true, index: true },

    /** Signed: negative for a sale, positive for a restock. */
    delta: { type: Number, required: true },
    stockAfter: { type: Number, required: true },

    reason: {
      type: String,
      enum: [
        'sale',
        'restock',
        'correction',
        'damage',
        'return',
        'reservation',
        'release',
        'manual',
      ],
      required: true,
      index: true,
    },
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    note: { type: String, maxlength: 300, default: null },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Covered by the TTL index below.
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

inventoryLogSchema.index({ variantId: 1, at: -1 });
// One year of movement history is plenty for reconciliation.
inventoryLogSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

export const InventoryLog = model('InventoryLog', inventoryLogSchema);
