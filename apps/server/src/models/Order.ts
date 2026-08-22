import {
  CURRENCIES,
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@sunshop/shared';
import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const moneySchema = new Schema(
  {
    amount: { type: Number, required: true },
    currency: { type: String, required: true, enum: CURRENCIES },
  },
  { _id: false },
);

const localized = new Schema(
  {
    en: { type: String, default: '' },
    ar: { type: String, default: '' },
  },
  { _id: false },
);

const addressSchema = new Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String, required: true, uppercase: true },
    notes: { type: String },
  },
  { _id: false },
);

/**
 * Order line items are **snapshots**, not references.
 *
 * The product name, image and price are copied in at purchase time. If a
 * merchant renames a product or changes its price next month, last month's
 * invoice must still read exactly as the customer saw it: a join to the live
 * catalog would silently rewrite history.
 */
const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    name: { type: localized, required: true },
    imageKey: { type: String, default: null },
    optionsLabel: { type: [localized], default: [] },
    unitPrice: { type: moneySchema, required: true },
    quantity: { type: Number, required: true, min: 1 },
    discount: { type: moneySchema, required: true },
    lineTotal: { type: moneySchema, required: true },
    fulfilledQuantity: { type: Number, default: 0, min: 0 },
    refundedQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const shipmentSchema = new Schema(
  {
    carrier: { type: String, required: true },
    trackingNumber: { type: String, required: true },
    trackingUrl: { type: String, default: null },
    shippedAt: { type: Date, default: Date.now },
    deliveredAt: { type: Date, default: null },
    items: {
      type: [
        new Schema(
          { variantId: { type: Schema.Types.ObjectId, required: true }, quantity: Number },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: true },
);

/**
 * Declared as a real sub-schema rather than an inline object so that
 * `InferSchemaType` treats it as required: an inline nested literal infers as
 * optional, which forces a null check at every call site that reads a total.
 */
const totalsSchema = new Schema(
  {
    subtotal: { type: moneySchema, required: true },
    discount: { type: moneySchema, required: true },
    shipping: { type: moneySchema, required: true },
    tax: { type: moneySchema, required: true },
    total: { type: moneySchema, required: true },
    itemCount: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const shippingMethodSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: localized, required: true },
    price: { type: moneySchema, required: true },
    estimatedDays: { type: Number, default: null },
  },
  { _id: false },
);

const paymentSchema = new Schema(
  {
    provider: { type: String, default: null },
    intentId: { type: String, default: null },
    chargeId: { type: String, default: null },
    last4: { type: String, default: null },
    brand: { type: String, default: null },
    /** Raw provider payloads are logged, never stored on the order. */
    failureCode: { type: String, default: null },
  },
  { _id: false },
);

const timelineSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    type: { type: String, required: true },
    message: { type: String, required: true },
    actor: {
      id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      name: { type: String, default: 'system' },
    },
    meta: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    /** Human-facing reference, e.g. `SN-2026-000123`. Never the raw ObjectId. */
    orderNumber: { type: String, required: true, unique: true, index: true },

    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    /** Guests check out with an email only; kept for receipts and lookup. */
    email: { type: String, required: true, lowercase: true, index: true },

    currency: { type: String, enum: CURRENCIES, required: true },
    items: { type: [orderItemSchema], required: true },

    totals: { type: totalsSchema, required: true },

    couponCode: { type: String, default: null, uppercase: true },

    status: { type: String, enum: ORDER_STATUSES, default: 'pending_payment', index: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending', index: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    fulfillmentStatus: {
      type: String,
      enum: FULFILLMENT_STATUSES,
      default: 'unfulfilled',
      index: true,
    },

    shippingAddress: { type: addressSchema, required: true },
    billingAddress: { type: addressSchema, required: true },
    shippingMethod: { type: shippingMethodSchema, required: true },

    shipments: { type: [shipmentSchema], default: [] },
    timeline: { type: [timelineSchema], default: [] },

    payment: { type: paymentSchema, default: () => ({}) },

    refundedAmount: { type: moneySchema, default: null },
    refunds: {
      type: [
        new Schema(
          {
            amount: { type: moneySchema, required: true },
            reason: { type: String, required: true },
            note: { type: String },
            providerRefundId: { type: String },
            by: { type: Schema.Types.ObjectId, ref: 'User' },
            at: { type: Date, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    customerNote: { type: String, maxlength: 500, default: null },
    staffNote: { type: String, maxlength: 2000, default: null, select: false },
    invoiceKey: { type: String, default: null },

    /** Inventory held for this order until it is paid or expires. */
    reservationExpiresAt: { type: Date, default: null, index: true },
    inventoryReleased: { type: Boolean, default: false },

    placedAt: { type: Date, default: Date.now, index: true },
    paidAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    ipAddress: { type: String, default: null, select: false },
  },
  { timestamps: true },
);

orderSchema.index({ 'payment.intentId': 1 }, { sparse: true });
orderSchema.index({ user: 1, placedAt: -1 });
orderSchema.index({ status: 1, placedAt: -1 });
orderSchema.index({ paymentStatus: 1, reservationExpiresAt: 1 });
orderSchema.index({ 'totals.total.amount': -1 });
orderSchema.index({ orderNumber: 'text', email: 'text' });

export type OrderAttributes = InferSchemaType<typeof orderSchema>;
export type OrderDocument = HydratedDocument<OrderAttributes>;

export const Order = model<OrderAttributes>('Order', orderSchema);
