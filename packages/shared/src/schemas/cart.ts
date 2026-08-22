import { z } from 'zod';

import {
  currencySchema,
  localizedStringSchema,
  moneySchema,
  objectIdSchema,
  slugSchema,
} from './common';

export const addToCartSchema = z.object({
  productId: objectIdSchema,
  variantId: objectIdSchema,
  quantity: z.number().int().min(1).max(99).default(1),
});
export type AddToCartInput = z.infer<typeof addToCartSchema>;

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(99),
});
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

export const applyCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(32),
});

/** Merges a guest cart into the signed-in cart after login. */
export const mergeCartSchema = z.object({
  guestCartToken: z.string().min(10).max(200),
  strategy: z.enum(['merge', 'replace']).default('merge'),
});

export const cartItemSchema = z.object({
  id: z.string(),
  productId: objectIdSchema,
  variantId: objectIdSchema,
  sku: z.string(),
  name: localizedStringSchema,
  slug: slugSchema,
  imageUrl: z.string().url().nullable(),
  optionsLabel: z.array(localizedStringSchema).default([]),
  /** Price captured at add-time; re-validated at checkout. */
  unitPrice: moneySchema,
  compareAtPrice: moneySchema.nullable().optional(),
  quantity: z.number().int(),
  lineTotal: moneySchema,
  available: z.number().int(),
  inStock: z.boolean(),
  /** True when the live price no longer matches `unitPrice`. */
  priceChanged: z.boolean().default(false),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const cartTotalsSchema = z.object({
  subtotal: moneySchema,
  discount: moneySchema,
  shipping: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  itemCount: z.number().int(),
});
export type CartTotals = z.infer<typeof cartTotalsSchema>;

export const appliedCouponSchema = z.object({
  code: z.string(),
  description: localizedStringSchema.nullable().optional(),
  discount: moneySchema,
});

export const cartSchema = z.object({
  id: z.string(),
  /** Null for guests; the cart is then keyed by an opaque cart token. */
  userId: objectIdSchema.nullable(),
  currency: currencySchema,
  items: z.array(cartItemSchema),
  coupon: appliedCouponSchema.nullable(),
  totals: cartTotalsSchema,
  /** Non-fatal notices, e.g. an item that went out of stock since add-time. */
  warnings: z
    .array(
      z.object({
        code: z.enum(['out_of_stock', 'quantity_reduced', 'price_changed', 'item_removed']),
        itemId: z.string().optional(),
        message: z.string(),
      }),
    )
    .default([]),
  updatedAt: z.string(),
});
export type Cart = z.infer<typeof cartSchema>;
