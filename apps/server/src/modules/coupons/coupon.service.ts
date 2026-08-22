/* eslint-disable @typescript-eslint/no-explicit-any --
 * These mappers accept either a Mongoose `HydratedDocument` or the plain object
 * returned by `.lean()`, and the two have structurally different types for the
 * same fields (ObjectId vs string, Map vs Record). Threading a union through
 * every field access buys nothing here: the shape is validated on the way in by
 * the schema and on the way out by the DTO's own type.
 */
import {
  clampToZero,
  money,
  percentOf,
  type Coupon as CouponDto,
  type CouponValidationResult,
  type CreateCouponInput,
  type Currency,
  type Money,
  type UpdateCouponInput,
} from '@sunshop/shared';

import { Coupon, CouponRedemption, type CouponDocument } from '../../models/Coupon';
import { Order } from '../../models/Order';
import { audit } from '../../services/audit';
import { ApiError } from '../../utils/ApiError';

import type { Principal } from '../../security/principal';
import type { ClientSession } from 'mongoose';

/**
 * Coupon evaluation.
 *
 * Two things this deliberately does *not* do:
 *  • trust a client-supplied discount: the amount is always recomputed here;
 *  • treat "coupon exists" as "coupon applies": eligibility depends on the
 *    cart contents, the customer's history and the global usage counter, all
 *    of which are re-checked at checkout, not just when the code is typed.
 */

export interface CouponCartLine {
  productId: string;
  categoryIds: string[];
  unitPrice: Money;
  quantity: number;
}

export interface EvaluateCouponInput {
  code: string;
  lines: CouponCartLine[];
  subtotal: Money;
  shipping: Money;
  userId: string | null;
  email?: string | null;
}

export interface EvaluatedCoupon {
  coupon: CouponDocument;
  discount: Money;
  freeShipping: boolean;
}

export async function evaluateCoupon(
  input: EvaluateCouponInput,
): Promise<
  { ok: true; value: EvaluatedCoupon } | { ok: false; reason: CouponValidationResult['reason'] }
> {
  const coupon = await Coupon.findOne({ code: input.code.toUpperCase() });
  if (!coupon) return { ok: false, reason: 'not_found' };
  if (!coupon.isActive) return { ok: false, reason: 'inactive' };

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) return { ok: false, reason: 'not_started' };
  if (coupon.endsAt && coupon.endsAt < now) return { ok: false, reason: 'expired' };

  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
    return { ok: false, reason: 'usage_limit_reached' };
  }

  if (input.userId) {
    const used = await CouponRedemption.countDocuments({ coupon: coupon._id, user: input.userId });
    if (used >= coupon.usageLimitPerUser) return { ok: false, reason: 'user_limit_reached' };

    if (coupon.firstOrderOnly) {
      const previousOrders = await Order.countDocuments({
        user: input.userId,
        paymentStatus: { $in: ['paid', 'partially_refunded'] },
      });
      if (previousOrders > 0) return { ok: false, reason: 'first_order_only' };
    }
  } else if (input.email) {
    const used = await CouponRedemption.countDocuments({
      coupon: coupon._id,
      email: input.email.toLowerCase(),
    });
    if (used >= coupon.usageLimitPerUser) return { ok: false, reason: 'user_limit_reached' };
  }

  if (coupon.minSubtotal && input.subtotal.amount < coupon.minSubtotal.amount) {
    return { ok: false, reason: 'min_subtotal_not_met' };
  }

  // Which lines the coupon actually touches.
  const eligible = input.lines.filter((line) => isLineEligible(coupon, line));
  if (eligible.length === 0) return { ok: false, reason: 'not_applicable_to_cart' };

  const eligibleTotal = eligible.reduce(
    (total, line) => total + line.unitPrice.amount * line.quantity,
    0,
  );
  const currency = input.subtotal.currency;

  let discount = money(0, currency);
  let freeShipping = false;

  switch (coupon.type) {
    case 'percentage':
      discount = percentOf(money(eligibleTotal, currency), coupon.percentage ?? 0);
      break;
    case 'fixed':
      // Never discount more than the eligible lines are worth.
      discount = money(Math.min(coupon.amount?.amount ?? 0, eligibleTotal), currency);
      break;
    case 'free_shipping':
      freeShipping = true;
      discount = money(input.shipping.amount, currency);
      break;
  }

  if (coupon.maxDiscount && discount.amount > coupon.maxDiscount.amount) {
    discount = money(coupon.maxDiscount.amount, currency);
  }

  return { ok: true, value: { coupon, discount: clampToZero(discount), freeShipping } };
}

function isLineEligible(coupon: CouponDocument, line: CouponCartLine): boolean {
  const excluded = coupon.excludedProducts.map(String);
  if (excluded.includes(line.productId)) return false;

  const products = coupon.appliesToProducts.map(String);
  const categories = coupon.appliesToCategories.map(String);

  // No restriction list at all → applies to everything not excluded.
  if (products.length === 0 && categories.length === 0) return true;
  if (products.includes(line.productId)) return true;
  return line.categoryIds.some((categoryId) => categories.includes(categoryId));
}

export async function validateForClient(
  input: EvaluateCouponInput,
): Promise<CouponValidationResult> {
  const result = await evaluateCoupon(input);
  if (!result.ok) return { valid: false, reason: result.reason, discount: null };
  return { valid: true, reason: null, discount: result.value.discount };
}

/**
 * Records a redemption. The `$inc` is guarded by the usage limit so two
 * shoppers redeeming the last use concurrently cannot both succeed.
 */
export async function redeemCoupon(
  input: {
    couponId: string;
    code: string;
    userId: string | null;
    email: string;
    orderId: string;
    discount: Money;
  },
  session?: ClientSession,
): Promise<boolean> {
  const coupon = await Coupon.findById(input.couponId)
    .select('usageLimit usageCount')
    .session(session ?? null)
    .lean();
  if (!coupon) return false;

  const limit = coupon.usageLimit ?? null;
  const filter =
    limit === null ? { _id: input.couponId } : { _id: input.couponId, usageCount: { $lt: limit } };

  const updated = await Coupon.findOneAndUpdate(
    filter,
    { $inc: { usageCount: 1 } },
    { new: true, ...(session ? { session } : {}) },
  );
  if (!updated) return false;

  await CouponRedemption.create(
    [
      {
        coupon: input.couponId,
        code: input.code,
        user: input.userId,
        email: input.email.toLowerCase(),
        order: input.orderId,
        discount: input.discount,
      },
    ],
    session ? { session } : {},
  );

  return true;
}

/** Reverses a redemption when an order is cancelled before payment. */
export async function releaseCoupon(orderId: string): Promise<void> {
  const redemption = await CouponRedemption.findOneAndDelete({ order: orderId });
  if (!redemption) return;
  await Coupon.updateOne({ _id: redemption.coupon }, { $inc: { usageCount: -1 } });
}

// ── Admin CRUD ──────────────────────────────────────────────────────────────

function toDto(document: CouponDocument | Record<string, any>): CouponDto {
  return {
    id: String(document._id),
    code: document.code,
    description: document.description,
    type: document.type,
    percentage: document.percentage ?? undefined,
    amount: document.amount ?? undefined,
    minSubtotal: document.minSubtotal ?? undefined,
    maxDiscount: document.maxDiscount ?? undefined,
    appliesToProducts: (document.appliesToProducts ?? []).map(String),
    appliesToCategories: (document.appliesToCategories ?? []).map(String),
    excludedProducts: (document.excludedProducts ?? []).map(String),
    startsAt: document.startsAt ?? null,
    endsAt: document.endsAt ?? null,
    usageLimit: document.usageLimit ?? null,
    usageLimitPerUser: document.usageLimitPerUser,
    firstOrderOnly: document.firstOrderOnly,
    isActive: document.isActive,
    usageCount: document.usageCount ?? 0,
    createdAt: new Date(document.createdAt).toISOString(),
    updatedAt: new Date(document.updatedAt).toISOString(),
  };
}

export async function listCoupons(query: {
  page: number;
  limit: number;
  q?: string;
  isActive?: boolean;
  sort: string;
}): Promise<{ items: CouponDto[]; total: number }> {
  const filter: Record<string, unknown> = {};
  if (query.q) filter.code = { $regex: query.q.toUpperCase(), $options: 'i' };
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    usage_desc: { usageCount: -1 },
    ends_soon: { endsAt: 1 },
  };

  const [documents, total] = await Promise.all([
    Coupon.find(filter)
      .sort(sortMap[query.sort] ?? { createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Coupon.countDocuments(filter),
  ]);

  return { items: documents.map(toDto), total };
}

export async function createCoupon(
  principal: Principal,
  input: CreateCouponInput,
): Promise<CouponDto> {
  const document = await Coupon.create({ ...input, createdBy: principal.id });
  audit({
    action: 'coupon.created',
    actor: principal,
    target: { type: 'coupon', id: String(document._id), label: document.code },
  });
  return toDto(document);
}

export async function updateCoupon(
  principal: Principal,
  id: string,
  input: UpdateCouponInput,
): Promise<CouponDto> {
  const document = await Coupon.findByIdAndUpdate(id, input, { new: true });
  if (!document) throw ApiError.notFound();

  audit({
    action: 'coupon.updated',
    actor: principal,
    target: { type: 'coupon', id, label: document.code },
  });
  return toDto(document);
}

export async function deleteCoupon(principal: Principal, id: string): Promise<void> {
  const document = await Coupon.findById(id);
  if (!document) throw ApiError.notFound();

  // Redeemed coupons are deactivated, never deleted: the redemption ledger
  // must keep resolving for accounting.
  if (document.usageCount > 0) {
    document.isActive = false;
    await document.save();
  } else {
    await document.deleteOne();
  }

  audit({
    action: 'coupon.deleted',
    actor: principal,
    target: { type: 'coupon', id, label: document.code },
  });
}

export function currencyOf(value: Money): Currency {
  return value.currency;
}
