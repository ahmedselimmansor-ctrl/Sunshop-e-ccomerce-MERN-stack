import { z } from 'zod';

import {
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '../constants';

import { cartTotalsSchema } from './cart';
import {
  addressSchema,
  currencySchema,
  dateRangeSchema,
  localizedStringSchema,
  moneySchema,
  objectIdSchema,
  paginationQuerySchema,
} from './common';

export const checkoutSchema = z
  .object({
    shippingAddress: addressSchema,
    billingAddress: addressSchema.optional(),
    /** When true, `billingAddress` is ignored and shipping is reused. */
    billingSameAsShipping: z.boolean().default(true),
    paymentMethod: z.enum(PAYMENT_METHODS),
    shippingMethodId: z.string().min(1).max(60),
    couponCode: z.string().trim().toUpperCase().max(32).optional(),
    customerNote: z.string().trim().max(500).optional(),
    /** Guests must supply an email for the receipt. */
    email: z.string().email().optional(),
    /**
     * Client-generated total the user saw. If the server recomputes a different
     * total, checkout is rejected instead of silently charging more.
     */
    expectedTotal: moneySchema.optional(),
  })
  .refine((value) => value.billingSameAsShipping || Boolean(value.billingAddress), {
    message: 'billing_address_required',
    path: ['billingAddress'],
  });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const orderItemSchema = z.object({
  productId: objectIdSchema,
  variantId: objectIdSchema,
  sku: z.string(),
  /** Name/image snapshotted at purchase: the catalog may change later. */
  name: localizedStringSchema,
  imageUrl: z.string().url().nullable(),
  optionsLabel: z.array(localizedStringSchema).default([]),
  unitPrice: moneySchema,
  quantity: z.number().int(),
  discount: moneySchema,
  lineTotal: moneySchema,
  fulfilledQuantity: z.number().int().default(0),
  refundedQuantity: z.number().int().default(0),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const shipmentSchema = z.object({
  carrier: z.string().max(80),
  trackingNumber: z.string().max(120),
  trackingUrl: z.string().url().nullable().optional(),
  shippedAt: z.string(),
  deliveredAt: z.string().nullable().optional(),
  items: z
    .array(z.object({ variantId: objectIdSchema, quantity: z.number().int().min(1) }))
    .optional(),
});

export const orderTimelineEntrySchema = z.object({
  at: z.string(),
  type: z.enum([
    'created',
    'payment_pending',
    'payment_succeeded',
    'payment_failed',
    'status_changed',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
    'note',
  ]),
  message: z.string(),
  actor: z.object({ id: objectIdSchema.nullable(), name: z.string() }).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const orderSchema = z.object({
  id: objectIdSchema,
  /** Human-facing sequential reference, e.g. `SN-2026-000123`. */
  orderNumber: z.string(),
  userId: objectIdSchema.nullable(),
  email: z.string().email(),
  currency: currencySchema,
  items: z.array(orderItemSchema),
  totals: cartTotalsSchema,
  couponCode: z.string().nullable(),
  status: z.enum(ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES),
  shippingAddress: addressSchema,
  billingAddress: addressSchema,
  shippingMethod: z.object({
    id: z.string(),
    name: localizedStringSchema,
    price: moneySchema,
    estimatedDays: z.number().int().nullable().optional(),
  }),
  shipments: z.array(shipmentSchema).default([]),
  timeline: z.array(orderTimelineEntrySchema).default([]),
  refundedAmount: moneySchema.nullable().optional(),
  customerNote: z.string().nullable().optional(),
  staffNote: z.string().nullable().optional(),
  invoiceUrl: z.string().url().nullable().optional(),
  placedAt: z.string(),
  paidAt: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Order = z.infer<typeof orderSchema>;

export const orderSummarySchema = orderSchema.pick({
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  fulfillmentStatus: true,
  currency: true,
  placedAt: true,
});
export type OrderSummary = z.infer<typeof orderSummarySchema> & {
  total: z.infer<typeof moneySchema>;
  itemCount: number;
};

export const orderListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(ORDER_STATUSES).optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    fulfillmentStatus: z.enum(FULFILLMENT_STATUSES).optional(),
    q: z.string().trim().max(120).optional(),
    userId: objectIdSchema.optional(),
    sort: z.enum(['newest', 'oldest', 'total_desc', 'total_asc']).default('newest'),
  })
  .and(dateRangeSchema);
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional(),
  /** Restock cancelled/refunded units back into inventory. */
  restock: z.boolean().default(true),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const addShipmentSchema = z.object({
  carrier: z.string().trim().min(2).max(80),
  trackingNumber: z.string().trim().min(3).max(120),
  trackingUrl: z.string().url().optional(),
  items: z
    .array(z.object({ variantId: objectIdSchema, quantity: z.number().int().min(1) }))
    .min(1)
    .optional(),
  notifyCustomer: z.boolean().default(true),
});
export type AddShipmentInput = z.infer<typeof addShipmentSchema>;

export const refundOrderSchema = z.object({
  /** Omit for a full refund. */
  amount: moneySchema.optional(),
  reason: z.enum(['requested_by_customer', 'duplicate', 'fraudulent', 'damaged', 'other']),
  note: z.string().trim().max(500).optional(),
  restock: z.boolean().default(true),
});
export type RefundOrderInput = z.infer<typeof refundOrderSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

// ── Payments ────────────────────────────────────────────────────────────────

export const createPaymentIntentSchema = z.object({
  orderId: objectIdSchema,
});

export const paymentIntentSchema = z.object({
  provider: z.literal('stripe'),
  clientSecret: z.string(),
  publishableKey: z.string(),
  amount: moneySchema,
  orderId: objectIdSchema,
});
export type PaymentIntentResponse = z.infer<typeof paymentIntentSchema>;

// ── Shipping ────────────────────────────────────────────────────────────────

export const shippingQuoteQuerySchema = z.object({
  country: z.string().length(2).toUpperCase(),
  city: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
});

export const shippingMethodSchema = z.object({
  id: z.string(),
  name: localizedStringSchema,
  description: localizedStringSchema.optional(),
  price: moneySchema,
  estimatedDays: z.number().int().nullable(),
  /** Free above this order subtotal. */
  freeAbove: moneySchema.nullable().optional(),
});
export type ShippingMethod = z.infer<typeof shippingMethodSchema>;
