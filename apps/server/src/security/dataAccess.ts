import { ApiError } from '../utils/ApiError';

import type { Principal } from './principal';
import type { FilterQuery } from 'mongoose';

/**
 * Data access control: the row-level half of authorization.
 *
 * A permission says *what verb* a caller may use. A scope says *which rows* it
 * applies to. Keeping them separate is what stops the classic IDOR: a customer
 * legitimately holds `order:read:own`, and without a scope
 * `GET /orders/:someoneElsesId` would happily satisfy that permission.
 *
 * Every service that reads a customer-owned collection composes its filter
 * through one of these helpers, so the narrowing cannot be forgotten: it is
 * part of building the query, not an afterthought.
 */

/** Narrows an order query to the caller unless they may read any order. */
export function scopeOrders<T extends Record<string, unknown>>(
  principal: Principal,
  filter: FilterQuery<T> = {},
): FilterQuery<T> {
  if (principal.can('order:read:any')) return filter;
  if (!principal.isAuthenticated) throw ApiError.unauthorized();
  return { ...filter, user: principal.id } as FilterQuery<T>;
}

/** Narrows a user query to the caller unless they may read any user. */
export function scopeUsers<T extends Record<string, unknown>>(
  principal: Principal,
  filter: FilterQuery<T> = {},
): FilterQuery<T> {
  if (principal.can('user:read:any')) return filter;
  if (!principal.isAuthenticated) throw ApiError.unauthorized();
  return { ...filter, _id: principal.id } as FilterQuery<T>;
}

/**
 * Reviews are public when approved; a caller additionally sees their own
 * pending ones, and a moderator sees everything.
 */
export function scopeReviews<T extends Record<string, unknown>>(
  principal: Principal,
  filter: FilterQuery<T> = {},
): FilterQuery<T> {
  if (principal.can('review:moderate')) return filter;
  if (principal.isAuthenticated) {
    return {
      ...filter,
      $or: [{ status: 'approved' }, { user: principal.id }],
    } as FilterQuery<T>;
  }
  return { ...filter, status: 'approved' } as FilterQuery<T>;
}

/**
 * Draft and archived products are staff-only. Without this every unreleased
 * product would be enumerable by anyone who guesses a slug.
 */
export function scopeProducts<T extends Record<string, unknown>>(
  principal: Principal,
  filter: FilterQuery<T> = {},
): FilterQuery<T> {
  if (principal.can('product:write')) return filter;
  return { ...filter, status: 'active', deletedAt: null } as FilterQuery<T>;
}

export function scopeCategories<T extends Record<string, unknown>>(
  principal: Principal,
  filter: FilterQuery<T> = {},
): FilterQuery<T> {
  if (principal.can('category:write')) return filter;
  return { ...filter, isActive: true } as FilterQuery<T>;
}

/**
 * Asserts ownership of an already-loaded document.
 *
 * Answers 404 rather than 403 on failure: telling an attacker "that order
 * exists, it just isn't yours" confirms the id is real, which is exactly the
 * oracle an enumeration attack needs.
 */
export function assertOwnership(
  principal: Principal,
  ownerId: unknown,
  elevatedPermission?: Parameters<Principal['can']>[0],
): void {
  if (elevatedPermission && principal.can(elevatedPermission)) return;
  if (!principal.owns(ownerId ? String(ownerId) : null)) throw ApiError.notFound();
}

/**
 * Fields a caller may never set on themselves, no matter what the body says.
 * Applied by stripping rather than rejecting, because a client sending a stale
 * full object should not fail: it should simply not escalate.
 */
const PROTECTED_USER_FIELDS = [
  'roles',
  'status',
  'emailVerified',
  'tokenVersion',
  'passwordHash',
  'ordersCount',
  'totalSpent',
  'suspendedUntil',
  'suspendedReason',
  'deletedAt',
  '_id',
  'id',
] as const;

export function stripProtectedFields<T extends Record<string, unknown>>(input: T): T {
  const copy = { ...input };
  for (const field of PROTECTED_USER_FIELDS) delete copy[field];
  return copy;
}
