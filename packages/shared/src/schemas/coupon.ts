import { z } from 'zod';

import { DISCOUNT_TYPES } from '../constants';

import {
  localizedStringSchema,
  moneySchema,
  objectIdSchema,
  paginationQuerySchema,
} from './common';

/**
 * The plain object shape. Kept separate from the refined `createCouponSchema`
 * because zod's `.refine()` returns a `ZodEffects`, which no longer exposes
 * `.partial()` or `.extend()`: the update and output schemas need both.
 */
export const couponObjectSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/, { message: 'invalid_coupon_code' }),
  description: localizedStringSchema.optional(),
  type: z.enum(DISCOUNT_TYPES),
  /** Percent (1-100) when `type === 'percentage'`; ignored otherwise. */
  percentage: z.number().min(1).max(100).optional(),
  /** Fixed amount when `type === 'fixed'`; ignored otherwise. */
  amount: moneySchema.optional(),
  minSubtotal: moneySchema.optional(),
  /** Caps a percentage discount, e.g. "20% off, max $50". */
  maxDiscount: moneySchema.optional(),
  /** Empty = applies to everything. */
  appliesToProducts: z.array(objectIdSchema).max(500).default([]),
  appliesToCategories: z.array(objectIdSchema).max(100).default([]),
  excludedProducts: z.array(objectIdSchema).max(500).default([]),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  usageLimitPerUser: z.number().int().min(1).max(1000).default(1),
  /** Restrict to first-time buyers. */
  firstOrderOnly: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const createCouponSchema = couponObjectSchema
  .refine((value) => value.type !== 'percentage' || value.percentage !== undefined, {
    message: 'percentage_required',
    path: ['percentage'],
  })
  .refine((value) => value.type !== 'fixed' || value.amount !== undefined, {
    message: 'amount_required',
    path: ['amount'],
  })
  .refine((value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt, {
    message: 'invalid_date_range',
    path: ['endsAt'],
  });
export type CreateCouponInput = z.infer<typeof createCouponSchema>;

export const updateCouponSchema = couponObjectSchema.partial();
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

export const couponSchema = couponObjectSchema.extend({
  id: objectIdSchema,
  usageCount: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Coupon = z.infer<typeof couponSchema>;

export const couponListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(60).optional(),
  isActive: z.coerce.boolean().optional(),
  type: z.enum(DISCOUNT_TYPES).optional(),
  sort: z.enum(['newest', 'oldest', 'usage_desc', 'ends_soon']).default('newest'),
});

export const validateCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(32),
});

export const couponValidationResultSchema = z.object({
  valid: z.boolean(),
  reason: z
    .enum([
      'not_found',
      'inactive',
      'expired',
      'not_started',
      'usage_limit_reached',
      'user_limit_reached',
      'min_subtotal_not_met',
      'not_applicable_to_cart',
      'first_order_only',
    ])
    .nullable(),
  discount: moneySchema.nullable(),
});
export type CouponValidationResult = z.infer<typeof couponValidationResultSchema>;
