import { CURRENCIES } from '@sunshop/shared';
import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const moneySchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, enum: CURRENCIES },
  },
  { _id: false },
);

/**
 * Carts live in MongoDB rather than Redis.
 *
 * A cart is a business record, not a cache: abandoned-cart recovery, admin
 * support ("what did the customer have in their basket?") and analytics all
 * need it to survive an ElastiCache failover. The hot read is still served from
 * Redis by the cache layer; this is the source of truth.
 *
 * Guest carts expire automatically via a TTL index so the collection cannot
 * grow without bound from crawler traffic.
 */
const cartItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, max: 99 },
    /**
     * Price captured when the item was added. Checkout re-reads the live price
     * and surfaces a `price_changed` warning rather than silently charging the
     * new amount: quietly re-pricing a cart is how chargebacks start.
     */
    unitPrice: { type: moneySchema, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const cartSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    /** Opaque token for anonymous shoppers, stored in an httpOnly cookie. */
    guestToken: { type: String, default: null, index: true, sparse: true },

    currency: { type: String, enum: CURRENCIES, required: true },
    items: { type: [cartItemSchema], default: [] },
    couponCode: { type: String, default: null, uppercase: true, trim: true },

    /** Rolls forward on every mutation; drives the TTL below. */
    lastActivityAt: { type: Date, default: Date.now, index: true },
    /** Set when the cart converts, so it is retained for order forensics. */
    convertedOrder: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    abandonedEmailSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One active cart per signed-in user.
cartSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { user: { $type: 'objectId' }, convertedOrder: null } },
);

/**
 * TTL: guest carts are swept 30 days after their last activity. Converted
 * carts are exempted by the partial filter so order forensics keep working.
 */
cartSchema.index(
  { lastActivityAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30,
    partialFilterExpression: { user: null, convertedOrder: null },
  },
);

cartSchema.index({ user: 1, lastActivityAt: -1 });

export type CartAttributes = InferSchemaType<typeof cartSchema>;
export type CartDocument = HydratedDocument<CartAttributes>;

export const Cart = model<CartAttributes>('Cart', cartSchema);
