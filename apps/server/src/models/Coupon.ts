import { CURRENCIES, DISCOUNT_TYPES } from '@sunshop/shared';
import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const moneySchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, enum: CURRENCIES },
  },
  { _id: false },
);

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    description: {
      type: new Schema(
        {
          en: { type: String, maxlength: 200 },
          ar: { type: String, maxlength: 200 },
        },
        { _id: false },
      ),
      default: undefined,
    },

    type: { type: String, enum: DISCOUNT_TYPES, required: true },
    percentage: { type: Number, min: 1, max: 100, default: null },
    amount: { type: moneySchema, default: null },

    minSubtotal: { type: moneySchema, default: null },
    maxDiscount: { type: moneySchema, default: null },

    appliesToProducts: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    appliesToCategories: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: [] },
    excludedProducts: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },

    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null, index: true },

    usageLimit: { type: Number, default: null, min: 1 },
    usageLimitPerUser: { type: Number, default: 1, min: 1 },
    /**
     * Incremented atomically with `$inc` guarded by a `$lt` filter, so a global
     * usage cap holds even when two shoppers redeem the last use concurrently.
     */
    usageCount: { type: Number, default: 0, min: 0 },

    firstOrderOnly: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

couponSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });

export type CouponAttributes = InferSchemaType<typeof couponSchema>;
export type CouponDocument = HydratedDocument<CouponAttributes>;

export const Coupon = model<CouponAttributes>('Coupon', couponSchema);

/** Per-user redemption ledger: enforces `usageLimitPerUser`. */
const couponRedemptionSchema = new Schema(
  {
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    code: { type: String, required: true, uppercase: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    email: { type: String, lowercase: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    discount: { type: moneySchema, required: true },
    redeemedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

couponRedemptionSchema.index({ coupon: 1, user: 1 });
couponRedemptionSchema.index({ coupon: 1, order: 1 }, { unique: true });

export const CouponRedemption = model('CouponRedemption', couponRedemptionSchema);
