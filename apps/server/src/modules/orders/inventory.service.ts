import { cacheKeys, cacheTags } from '@sunshop/shared';

import { InventoryLog } from '../../models/InventoryLog';
import { OutboxEvent } from '../../models/OutboxEvent';
import { Product } from '../../models/Product';
import { moduleLogger } from '../../observability/logger';
import { cacheDelete, invalidateTags } from '../../services/cache';
import { ApiError } from '../../utils/ApiError';

import type { ClientSession } from 'mongoose';

const log = moduleLogger('inventory');

export interface ReservationLine {
  productId: string;
  variantId: string;
  sku: string;
  quantity: number;
}

/**
 * Inventory reservation.
 *
 * The invariant: `available = stock - reserved`. Checkout increments
 * `reserved`, payment converts the reservation into a real decrement of
 * `stock`, and cancellation or expiry releases it. Without this two shoppers
 * can both reach the payment page holding the last unit, and one of them gets
 * an apology email instead of a product.
 *
 * Each line is claimed with a conditional update: the `$expr` guard checks
 * availability *inside* the same atomic operation that increments the counter,
 * so there is no read-then-write window for a race to slip through. If any line
 * fails, the caller's transaction rolls the rest back.
 */
export async function reserve(
  lines: ReservationLine[],
  session?: ClientSession,
): Promise<{ ok: true } | { ok: false; failed: ReservationLine[] }> {
  const claimed: ReservationLine[] = [];

  for (const line of lines) {
    const updated = await Product.findOneAndUpdate(
      {
        _id: line.productId,
        variants: { $elemMatch: { _id: line.variantId, isActive: true } },
        $expr: {
          $let: {
            vars: {
              variant: {
                $first: {
                  $filter: {
                    input: '$variants',
                    cond: { $eq: ['$$this._id', { $toObjectId: line.variantId }] },
                  },
                },
              },
            },
            in: {
              $or: [
                { $eq: ['$$variant.stockPolicy', 'continue'] },
                {
                  $gte: [{ $subtract: ['$$variant.stock', '$$variant.reserved'] }, line.quantity],
                },
              ],
            },
          },
        },
      },
      { $inc: { 'variants.$[variant].reserved': line.quantity } },
      {
        arrayFilters: [{ 'variant._id': line.variantId }],
        new: true,
        ...(session ? { session } : {}),
      },
    );

    if (!updated) {
      // Roll back whatever this call already claimed. When a transaction is
      // available the abort does this too, but single-node deployments have no
      // transactions and would otherwise leak reservations.
      if (!session) await release(claimed);
      return { ok: false, failed: [line] };
    }

    claimed.push(line);
  }

  await invalidateProductCaches(lines.map((line) => line.productId));
  return { ok: true };
}

/**
 * Drops the affected products from Redis.
 *
 * `available = stock - reserved`, so a *reservation* changes what the
 * storefront must show just as much as a sale does. Skipping this on
 * reserve/release is how a cached product page keeps offering the last unit
 * that someone else is already checking out with.
 */
async function invalidateProductCaches(productIds: string[]): Promise<void> {
  const unique = [...new Set(productIds)];
  if (unique.length === 0) return;

  const slugs = await Product.find({ _id: { $in: unique } })
    .select('slug')
    .lean();

  await invalidateTags(cacheTags.products, ...unique.map((id) => cacheTags.product(id)));
  await cacheDelete(
    ...unique.map((id) => cacheKeys.product(id)),
    ...slugs.map((entry) => cacheKeys.product(entry.slug)),
  );
}

/** Releases a reservation without touching `stock` (cancel / expiry). */
export async function release(lines: ReservationLine[], session?: ClientSession): Promise<void> {
  for (const line of lines) {
    await Product.updateOne(
      { _id: line.productId, 'variants._id': line.variantId },
      { $inc: { 'variants.$[variant].reserved': -line.quantity } },
      {
        arrayFilters: [{ 'variant._id': line.variantId }],
        ...(session ? { session } : {}),
      },
    ).catch((error: Error) => {
      log.error({ err: error.message, line }, 'failed to release reservation');
    });
  }

  await invalidateProductCaches(lines.map((line) => line.productId));
}

/**
 * Converts reservations into sales: `reserved -= q` and `stock -= q` in one
 * operation, plus the sold counter that powers "best selling".
 */
export async function commit(
  lines: ReservationLine[],
  orderId: string,
  session?: ClientSession,
): Promise<void> {
  for (const line of lines) {
    const updated = await Product.findOneAndUpdate(
      { _id: line.productId, 'variants._id': line.variantId },
      {
        $inc: {
          'variants.$[variant].reserved': -line.quantity,
          'variants.$[variant].stock': -line.quantity,
          soldCount: line.quantity,
        },
      },
      {
        arrayFilters: [{ 'variant._id': line.variantId }],
        new: true,
        ...(session ? { session } : {}),
      },
    );

    const variant = updated?.variants.find((entry) => String(entry._id) === line.variantId);

    await InventoryLog.create(
      [
        {
          product: line.productId,
          variantId: line.variantId,
          sku: line.sku,
          delta: -line.quantity,
          stockAfter: variant?.stock ?? 0,
          reason: 'sale',
          order: orderId,
        },
      ],
      session ? { session } : {},
    ).catch(() => undefined);
  }

  // Refresh the denormalized totals so the catalogue stops showing stock that
  // has just been sold.
  await recalculateTotals(
    lines.map((line) => line.productId),
    session,
  );
}

/** Returns units to stock after a cancellation or refund. */
export async function restock(
  lines: ReservationLine[],
  orderId: string,
  reason: 'return' | 'correction' = 'return',
  session?: ClientSession,
): Promise<void> {
  for (const line of lines) {
    const updated = await Product.findOneAndUpdate(
      { _id: line.productId, 'variants._id': line.variantId },
      {
        $inc: {
          'variants.$[variant].stock': line.quantity,
          soldCount: -line.quantity,
        },
      },
      {
        arrayFilters: [{ 'variant._id': line.variantId }],
        new: true,
        ...(session ? { session } : {}),
      },
    );

    const variant = updated?.variants.find((entry) => String(entry._id) === line.variantId);

    await InventoryLog.create(
      [
        {
          product: line.productId,
          variantId: line.variantId,
          sku: line.sku,
          delta: line.quantity,
          stockAfter: variant?.stock ?? 0,
          reason,
          order: orderId,
        },
      ],
      session ? { session } : {},
    ).catch(() => undefined);
  }

  await recalculateTotals(
    lines.map((line) => line.productId),
    session,
  );
}

/**
 * Recomputes the denormalized aggregates and drops the affected products from
 * every cache tier.
 *
 * Without the invalidation, a sale updates MongoDB while the Redis-cached
 * product detail and the Elasticsearch document both keep advertising the old
 * stock: so the storefront happily sells units that no longer exist until the
 * TTL expires. The search update goes through the outbox rather than a direct
 * call so it inherits the retry semantics and never blocks the order.
 */
async function recalculateTotals(productIds: string[], session?: ClientSession): Promise<void> {
  const unique = [...new Set(productIds)];

  for (const id of unique) {
    const product = await Product.findById(id).session(session ?? null);
    if (!product) continue;
    // The pre-save hook recomputes priceMin/priceMax/totalStock.
    await product.save({ session: session ?? undefined });
  }

  await OutboxEvent.create(
    unique.map((id) => ({ type: 'product.upserted', payload: { productId: id } })),
    session ? { session } : {},
  ).catch((error: Error) => {
    log.error({ err: error.message }, 'failed to enqueue product reindex after stock change');
  });

  // Cache invalidation happens outside the transaction on purpose: if the
  // transaction later aborts, a needlessly cold cache costs one query, whereas
  // a stale cache after a successful commit oversells inventory.
  await invalidateProductCaches(unique);
}

export function assertAvailable(available: number, requested: number, sku: string): void {
  if (requested > available) {
    throw ApiError.outOfStock([
      { path: sku, message: 'insufficient_stock', code: String(available) },
    ]);
  }
}
