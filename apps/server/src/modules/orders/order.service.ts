/* eslint-disable @typescript-eslint/no-explicit-any --
 * These mappers accept either a Mongoose `HydratedDocument` or the plain object
 * returned by `.lean()`, and the two have structurally different types for the
 * same fields (ObjectId vs string, Map vs Record). Threading a union through
 * every field access buys nothing here: the shape is validated on the way in by
 * the schema and on the way out by the DTO's own type.
 */
import {
  ORDER_STATUS_TRANSITIONS,
  money,
  type AddShipmentInput,
  type CheckoutInput,
  type Currency,
  type Order as OrderDto,
  type OrderListQuery,
  type PaginationMeta,
  type RefundOrderInput,
} from '@sunshop/shared';

import { withTransaction } from '../../db/mongoose';
import { Cart } from '../../models/Cart';
import { nextOrderNumber } from '../../models/Counter';
import { Order, type OrderDocument } from '../../models/Order';
import { OutboxEvent } from '../../models/OutboxEvent';
import { Product } from '../../models/Product';
import { User } from '../../models/User';
import { moduleLogger } from '../../observability/logger';
import { businessEvents, orderValue } from '../../observability/metrics';
import { scopeOrders } from '../../security/dataAccess';
import { audit } from '../../services/audit';
import { publicUrlFor, signedUrlFor } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import { buildPaginationMeta } from '../../utils/http';
import { computeTotals, getShippingMethod, type PriceableLine } from '../cart/pricing.service';
import { redeemCoupon, releaseCoupon } from '../coupons/coupon.service';

import * as inventory from './inventory.service';

import type { Principal } from '../../security/principal';
import type { FilterQuery } from 'mongoose';

const log = moduleLogger('orders');

/** How long an unpaid order holds its inventory. */
const RESERVATION_MINUTES = 30;

// ── Checkout ────────────────────────────────────────────────────────────────

export async function checkout(
  principal: Principal,
  input: CheckoutInput,
  context: { guestToken?: string; ip?: string | null },
): Promise<OrderDto> {
  const cart = principal.isAuthenticated
    ? await Cart.findOne({ user: principal.id, convertedOrder: null })
    : await Cart.findOne({ guestToken: context.guestToken, convertedOrder: null });

  if (!cart || cart.items.length === 0) throw ApiError.badRequest('errors.cart_empty');

  const email = principal.email ?? input.email;
  if (!email) {
    throw ApiError.badRequest('errors.bad_request', [{ path: 'email', message: 'email_required' }]);
  }

  // Re-read the catalogue: the cart's stored prices are a display convenience,
  // never the basis for a charge.
  const products = await Product.find({
    _id: { $in: cart.items.map((item) => item.product) },
  }).lean();
  const productById = new Map(products.map((product) => [String(product._id), product]));

  const lines: PriceableLine[] = [];
  const reservationLines: inventory.ReservationLine[] = [];
  const orderItems: Record<string, unknown>[] = [];
  const currency = cart.currency as Currency;

  for (const item of cart.items) {
    const product = productById.get(String(item.product));
    const variant = product?.variants.find((entry) => String(entry._id) === String(item.variantId));

    if (!product || !variant || product.status !== 'active' || product.deletedAt) {
      throw ApiError.conflict('errors.out_of_stock', [
        { path: 'items', message: 'item_unavailable', code: item.sku },
      ]);
    }

    const available = Math.max(0, variant.stock - variant.reserved);
    if (variant.stockPolicy === 'deny' && item.quantity > available) {
      throw ApiError.outOfStock([
        { path: 'items', message: 'insufficient_stock', code: `${item.sku}:${available}` },
      ]);
    }

    const lineTotal = money(variant.price.amount * item.quantity, currency);

    lines.push({
      productId: String(product._id),
      categoryIds: (product.categories ?? []).map(String),
      unitPrice: variant.price,
      quantity: item.quantity,
      lineTotal,
    });

    reservationLines.push({
      productId: String(product._id),
      variantId: String(variant._id),
      sku: variant.sku,
      quantity: item.quantity,
    });

    orderItems.push({
      product: product._id,
      variantId: variant._id,
      sku: variant.sku,
      name: product.name,
      imageKey: variant.imageKey ?? product.images?.[0]?.key ?? null,
      optionsLabel: [],
      unitPrice: variant.price,
      quantity: item.quantity,
      discount: money(0, currency),
      lineTotal,
    });
  }

  const shippingCountry = input.shippingAddress.country;
  const subtotalOnly = money(
    lines.reduce((total, line) => total + line.lineTotal.amount, 0),
    currency,
  );

  const shippingMethod = await getShippingMethod(
    input.shippingMethodId,
    shippingCountry,
    subtotalOnly,
  );
  if (!shippingMethod) {
    throw ApiError.badRequest('errors.bad_request', [
      { path: 'shippingMethodId', message: 'invalid_shipping_method' },
    ]);
  }

  const priced = await computeTotals({
    lines,
    currency,
    couponCode: input.couponCode ?? cart.couponCode,
    shippingMethodId: input.shippingMethodId,
    country: shippingCountry,
    userId: principal.id,
    email,
  });

  // The client tells us what the customer saw. If the server computes something
  // different: a price changed, a coupon expired mid-checkout: stop and let
  // them re-confirm rather than charging an unexpected amount.
  if (input.expectedTotal && input.expectedTotal.amount !== priced.totals.total.amount) {
    throw ApiError.conflict('errors.total_mismatch', [
      {
        path: 'expectedTotal',
        message: 'total_mismatch',
        code: String(priced.totals.total.amount),
      },
    ]);
  }

  // Apply the allocated discounts to the line snapshots.
  for (const orderItem of orderItems) {
    const allocated = priced.lineDiscounts.get(String(orderItem.product));
    if (allocated) {
      orderItem.discount = allocated;
      orderItem.lineTotal = money(
        (orderItem.lineTotal as { amount: number }).amount - allocated.amount,
        currency,
      );
    }
  }

  const orderNumber = await nextOrderNumber();

  const order = await withTransaction(async (session) => {
    const reservation = await inventory.reserve(reservationLines, session);
    if (!reservation.ok) {
      throw ApiError.outOfStock(
        reservation.failed.map((line) => ({
          path: 'items',
          message: 'insufficient_stock',
          code: line.sku,
        })),
      );
    }

    const [document] = await Order.create(
      [
        {
          orderNumber,
          user: principal.id,
          email,
          currency,
          items: orderItems,
          totals: priced.totals,
          couponCode: priced.appliedCoupon?.code ?? null,
          status: 'pending_payment',
          paymentStatus: 'pending',
          paymentMethod: input.paymentMethod,
          fulfillmentStatus: 'unfulfilled',
          shippingAddress: input.shippingAddress,
          billingAddress: input.billingSameAsShipping
            ? input.shippingAddress
            : (input.billingAddress ?? input.shippingAddress),
          shippingMethod: {
            id: shippingMethod.id,
            name: shippingMethod.name,
            price: priced.totals.shipping,
            estimatedDays: shippingMethod.estimatedDays,
          },
          customerNote: input.customerNote ?? null,
          reservationExpiresAt: new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000),
          ipAddress: context.ip ?? null,
          timeline: [
            {
              type: 'created',
              message: 'Order created',
              actor: { id: principal.id, name: 'customer' },
            },
          ],
          placedAt: new Date(),
        },
      ],
      session ? { session } : {},
    );

    if (priced.appliedCoupon) {
      // Inside the same transaction as the order: a committed order with an
      // unrecorded redemption would let one coupon be spent twice.
      const redeemed = await redeemCoupon(
        {
          couponId: priced.appliedCoupon.couponId,
          code: priced.appliedCoupon.code,
          userId: principal.id,
          email,
          orderId: String(document!._id),
          discount: priced.appliedCoupon.discount,
        },
        session ?? undefined,
      );
      if (!redeemed) throw ApiError.conflict('errors.coupon_usage_limit');
    }

    // Mark the cart converted rather than deleting it: support needs to see
    // what was in the basket if the order is later disputed.
    cart.convertedOrder = document!._id as never;
    await cart.save({ session: session ?? undefined });

    await OutboxEvent.create(
      [
        {
          type: 'order.placed',
          payload: { orderId: String(document!._id) },
          dedupeKey: `order.placed:${orderNumber}`,
        },
      ],
      session ? { session } : {},
    );

    return document!;
  });

  businessEvents.inc({ event: 'order_placed', outcome: 'success' });
  orderValue.observe({ currency }, priced.totals.total.amount);
  log.info(
    { orderId: String(order._id), orderNumber, total: priced.totals.total.amount },
    'order placed',
  );

  // Cash on delivery has no payment step, so it converts immediately.
  if (input.paymentMethod === 'cash_on_delivery') {
    await markPaid(String(order._id), { provider: 'cod' });
    const refreshed = await Order.findById(order._id);
    return toOrderDto(refreshed!, principal);
  }

  return toOrderDto(order, principal);
}

// ── Payment transitions ─────────────────────────────────────────────────────

/**
 * Idempotent: Stripe delivers webhooks at least once, and a retry must not
 * decrement stock or increment lifetime spend a second time.
 */
export async function markPaid(
  orderId: string,
  payment: {
    provider: string;
    intentId?: string;
    chargeId?: string;
    last4?: string;
    brand?: string;
  },
): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound();

  if (order.paymentStatus === 'paid') {
    log.debug({ orderId }, 'markPaid ignored: already paid');
    return;
  }

  await withTransaction(async (session) => {
    const lines = order.items.map((item) => ({
      productId: String(item.product),
      variantId: String(item.variantId),
      sku: item.sku,
      quantity: item.quantity,
    }));

    await inventory.commit(lines, orderId, session);

    order.paymentStatus = 'paid';
    order.status = order.paymentMethod === 'cash_on_delivery' ? 'processing' : 'paid';
    order.paidAt = new Date();
    order.reservationExpiresAt = null;
    order.payment = {
      provider: payment.provider,
      intentId: payment.intentId ?? null,
      chargeId: payment.chargeId ?? null,
      last4: payment.last4 ?? null,
      brand: payment.brand ?? null,
      failureCode: null,
    } as never;
    order.timeline.push({
      type: 'payment_succeeded',
      message: 'Payment received',
      actor: { id: null, name: 'system' },
    } as never);

    await order.save({ session: session ?? undefined });

    if (order.user) {
      await User.updateOne(
        { _id: order.user },
        { $inc: { ordersCount: 1, totalSpent: order.totals.total.amount } },
        { session: session ?? undefined },
      );
    }

    await OutboxEvent.create(
      [
        {
          type: 'order.paid',
          payload: { orderId },
          dedupeKey: `order.paid:${order.orderNumber}`,
        },
      ],
      session ? { session } : {},
    );
  });

  businessEvents.inc({ event: 'payment', outcome: 'success' });
  log.info({ orderId, orderNumber: order.orderNumber }, 'order paid');
}

export async function markPaymentFailed(orderId: string, failureCode: string): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order || order.paymentStatus === 'paid') return;

  order.paymentStatus = 'failed';
  order.payment = { ...(order.payment ?? {}), failureCode } as never;
  order.timeline.push({
    type: 'payment_failed',
    message: `Payment failed (${failureCode})`,
    actor: { id: null, name: 'system' },
  } as never);
  await order.save();

  businessEvents.inc({ event: 'payment', outcome: 'failure' });
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listOrders(
  principal: Principal,
  query: OrderListQuery,
): Promise<{ items: OrderDto[]; meta: PaginationMeta }> {
  const filter: FilterQuery<Record<string, unknown>> = scopeOrders(principal);

  if (query.status) filter.status = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.fulfillmentStatus) filter.fulfillmentStatus = query.fulfillmentStatus;
  if (query.userId && principal.can('order:read:any')) filter.user = query.userId;

  if (query.q) {
    filter.$or = [
      { orderNumber: { $regex: query.q, $options: 'i' } },
      { email: { $regex: query.q, $options: 'i' } },
    ];
  }

  if (query.from || query.to) {
    filter.placedAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { placedAt: -1 },
    oldest: { placedAt: 1 },
    total_desc: { 'totals.total.amount': -1 },
    total_asc: { 'totals.total.amount': 1 },
  };

  const [documents, total] = await Promise.all([
    Order.find(filter)
      .sort(sortMap[query.sort] ?? { placedAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  return {
    items: await Promise.all(documents.map((document) => toOrderDto(document, principal))),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}

export async function getOrder(principal: Principal, idOrNumber: string): Promise<OrderDto> {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrNumber);
  const filter = scopeOrders(
    principal,
    isObjectId ? { _id: idOrNumber } : { orderNumber: idOrNumber },
  );

  const order = await Order.findOne(filter);
  if (!order) throw ApiError.notFound();

  return toOrderDto(order, principal);
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function updateStatus(
  principal: Principal,
  orderId: string,
  nextStatus: OrderDto['status'],
  options: { note?: string; restock?: boolean } = {},
): Promise<OrderDto> {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound();

  const allowed = ORDER_STATUS_TRANSITIONS[order.status as OrderDto['status']] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.invalidTransition(order.status, nextStatus);
  }

  const previous = order.status;

  if (nextStatus === 'cancelled') {
    await cancelInternal(
      order,
      options.restock !== false,
      options.note ?? 'Cancelled by staff',
      principal,
    );
  } else {
    order.status = nextStatus;
    if (nextStatus === 'delivered') {
      order.fulfillmentStatus = 'fulfilled';
      const lastShipment = order.shipments.at(-1);
      if (lastShipment && !lastShipment.deliveredAt) lastShipment.deliveredAt = new Date();
    }
    order.timeline.push({
      type: 'status_changed',
      message: `${previous} → ${nextStatus}${options.note ? `: ${options.note}` : ''}`,
      actor: { id: principal.id, name: principal.email ?? 'staff' },
    } as never);
    await order.save();
  }

  await OutboxEvent.create({
    type: 'order.status_changed',
    payload: { orderId, from: previous, to: order.status },
    dedupeKey: `order.status:${order.orderNumber}:${order.status}`,
  });

  audit({
    action: 'order.status_changed',
    actor: principal,
    target: { type: 'order', id: orderId, label: order.orderNumber },
    changes: { status: { from: previous, to: order.status } },
    reason: options.note,
  });

  return toOrderDto(order, principal);
}

/** Customer-initiated cancellation, allowed only before fulfilment starts. */
export async function cancelOwnOrder(
  principal: Principal,
  orderId: string,
  reason: string,
): Promise<OrderDto> {
  const order = await Order.findOne(scopeOrders(principal, { _id: orderId }));
  if (!order) throw ApiError.notFound();

  if (!['pending_payment', 'paid'].includes(order.status)) {
    throw ApiError.conflict('errors.order_not_cancellable');
  }

  await cancelInternal(order, true, reason, principal);

  audit({
    action: 'order.cancelled',
    actor: principal,
    target: { type: 'order', id: orderId, label: order.orderNumber },
    reason,
  });

  return toOrderDto(order, principal);
}

async function cancelInternal(
  order: OrderDocument,
  restock: boolean,
  reason: string,
  principal: Principal,
): Promise<void> {
  const lines = order.items.map((item) => ({
    productId: String(item.product),
    variantId: String(item.variantId),
    sku: item.sku,
    quantity: item.quantity,
  }));

  await withTransaction(async (session) => {
    if (restock) {
      if (order.paymentStatus === 'paid') {
        // Stock was already decremented at payment; put it back.
        await inventory.restock(lines, String(order._id), 'return', session);
      } else if (!order.inventoryReleased) {
        // Still only reserved.
        await inventory.release(lines, session);
      }
      order.inventoryReleased = true;
    }

    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.reservationExpiresAt = null;
    order.timeline.push({
      type: 'cancelled',
      message: reason,
      actor: { id: principal.id, name: principal.email ?? 'system' },
    } as never);

    await order.save({ session: session ?? undefined });
  });

  await releaseCoupon(String(order._id));
  businessEvents.inc({ event: 'order_cancelled', outcome: 'success' });
}

export async function addShipment(
  principal: Principal,
  orderId: string,
  input: AddShipmentInput,
): Promise<OrderDto> {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound();
  if (!['paid', 'processing', 'shipped'].includes(order.status)) {
    throw ApiError.invalidTransition(order.status, 'shipped');
  }

  order.shipments.push({
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
    trackingUrl: input.trackingUrl ?? null,
    shippedAt: new Date(),
    items: input.items ?? [],
  } as never);

  // Partial shipments keep the order "partial" until every unit has moved.
  if (input.items?.length) {
    for (const shipped of input.items) {
      const item = order.items.find((entry) => String(entry.variantId) === shipped.variantId);
      if (item)
        item.fulfilledQuantity = Math.min(item.quantity, item.fulfilledQuantity + shipped.quantity);
    }
    const fullyFulfilled = order.items.every((item) => item.fulfilledQuantity >= item.quantity);
    order.fulfillmentStatus = fullyFulfilled ? 'fulfilled' : 'partial';
    if (fullyFulfilled) order.status = 'shipped';
  } else {
    for (const item of order.items) item.fulfilledQuantity = item.quantity;
    order.fulfillmentStatus = 'fulfilled';
    order.status = 'shipped';
  }

  order.timeline.push({
    type: 'shipped',
    message: `${input.carrier}, ${input.trackingNumber}`,
    actor: { id: principal.id, name: principal.email ?? 'staff' },
  } as never);

  await order.save();

  if (input.notifyCustomer) {
    await OutboxEvent.create({
      type: 'order.shipped',
      payload: {
        orderId,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl ?? null,
      },
      dedupeKey: `order.shipped:${order.orderNumber}:${input.trackingNumber}`,
    });
  }

  audit({
    action: 'order.shipment_added',
    actor: principal,
    target: { type: 'order', id: orderId, label: order.orderNumber },
    changes: { carrier: { from: null, to: input.carrier } },
  });

  return toOrderDto(order, principal);
}

export async function refundOrder(
  principal: Principal,
  orderId: string,
  input: RefundOrderInput,
): Promise<OrderDto> {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound();
  if (order.paymentStatus === 'refunded') throw ApiError.conflict('errors.already_refunded');
  if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'partially_refunded') {
    throw ApiError.conflict('errors.conflict');
  }

  const alreadyRefunded = order.refundedAmount?.amount ?? 0;
  const remaining = order.totals.total.amount - alreadyRefunded;
  const amount = input.amount?.amount ?? remaining;

  if (amount <= 0 || amount > remaining) {
    throw ApiError.badRequest('errors.refund_exceeds_total', [
      { path: 'amount', message: 'refund_exceeds_total', code: String(remaining) },
    ]);
  }

  // Money first: if the provider refund fails, nothing local should change.
  let providerRefundId: string | undefined;
  if (order.payment?.intentId) {
    const { refundPayment } = await import('../payments/stripe.service');
    providerRefundId = await refundPayment(order.payment.intentId, amount, input.reason);
  }

  await withTransaction(async (session) => {
    if (input.restock) {
      const lines = order.items
        .map((item) => ({
          productId: String(item.product),
          variantId: String(item.variantId),
          sku: item.sku,
          quantity: item.quantity - item.refundedQuantity,
        }))
        .filter((line) => line.quantity > 0);

      if (lines.length > 0) await inventory.restock(lines, orderId, 'return', session);
    }

    const totalRefunded = alreadyRefunded + amount;
    order.refundedAmount = money(totalRefunded, order.currency as Currency);
    order.paymentStatus =
      totalRefunded >= order.totals.total.amount ? 'refunded' : 'partially_refunded';
    if (order.paymentStatus === 'refunded') order.status = 'refunded';

    order.refunds.push({
      amount: money(amount, order.currency as Currency),
      reason: input.reason,
      note: input.note,
      providerRefundId,
      by: principal.id,
      at: new Date(),
    } as never);

    order.timeline.push({
      type: 'refunded',
      message: `Refunded ${amount / 100} ${order.currency} (${input.reason})`,
      actor: { id: principal.id, name: principal.email ?? 'staff' },
    } as never);

    await order.save({ session: session ?? undefined });

    if (order.user) {
      await User.updateOne(
        { _id: order.user },
        { $inc: { totalSpent: -amount } },
        { session: session ?? undefined },
      );
    }
  });

  await OutboxEvent.create({
    type: 'order.refunded',
    payload: { orderId, amount },
    dedupeKey: `order.refunded:${order.orderNumber}:${Date.now()}`,
  });

  businessEvents.inc({ event: 'refund', outcome: 'success' });
  audit({
    action: 'order.refunded',
    actor: principal,
    target: { type: 'order', id: orderId, label: order.orderNumber },
    changes: { refundedAmount: { from: alreadyRefunded, to: order.refundedAmount?.amount } },
    reason: input.reason,
  });

  return toOrderDto(order, principal);
}

/**
 * Releases inventory held by orders that were never paid. Runs on a schedule:
 * without it, abandoned checkouts silently make a catalogue look sold out.
 */
export async function releaseExpiredReservations(): Promise<number> {
  const expired = await Order.find({
    paymentStatus: 'pending',
    status: 'pending_payment',
    inventoryReleased: false,
    reservationExpiresAt: { $lt: new Date() },
  }).limit(200);

  for (const order of expired) {
    const lines = order.items.map((item) => ({
      productId: String(item.product),
      variantId: String(item.variantId),
      sku: item.sku,
      quantity: item.quantity,
    }));

    await inventory.release(lines);
    await releaseCoupon(String(order._id));

    order.inventoryReleased = true;
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.timeline.push({
      type: 'cancelled',
      message: 'Payment window expired; inventory released',
      actor: { id: null, name: 'system' },
    } as never);
    await order.save();
  }

  if (expired.length > 0) log.info({ count: expired.length }, 'released expired reservations');
  return expired.length;
}

// ── Mapping ─────────────────────────────────────────────────────────────────

export async function toOrderDto(
  order: OrderDocument | Record<string, any>,
  principal: Principal,
): Promise<OrderDto> {
  const isStaff = principal.can('order:read:any');

  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    userId: order.user ? String(order.user) : null,
    email: order.email,
    currency: order.currency,
    items: (order.items ?? []).map((item: any) => ({
      productId: String(item.product),
      variantId: String(item.variantId),
      sku: item.sku,
      name: item.name,
      imageUrl: publicUrlFor(item.imageKey),
      optionsLabel: item.optionsLabel ?? [],
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      discount: item.discount,
      lineTotal: item.lineTotal,
      fulfilledQuantity: item.fulfilledQuantity ?? 0,
      refundedQuantity: item.refundedQuantity ?? 0,
    })),
    totals: order.totals,
    couponCode: order.couponCode ?? null,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    fulfillmentStatus: order.fulfillmentStatus,
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
    shippingMethod: order.shippingMethod,
    shipments: (order.shipments ?? []).map((shipment: any) => ({
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl ?? null,
      shippedAt: new Date(shipment.shippedAt).toISOString(),
      deliveredAt: shipment.deliveredAt ? new Date(shipment.deliveredAt).toISOString() : null,
      items: shipment.items ?? [],
    })),
    timeline: (order.timeline ?? []).map((entry: any) => ({
      at: new Date(entry.at).toISOString(),
      type: entry.type,
      message: entry.message,
      actor: entry.actor?.id ? { id: String(entry.actor.id), name: entry.actor.name } : null,
      meta: entry.meta,
    })),
    refundedAmount: order.refundedAmount ?? null,
    customerNote: order.customerNote ?? null,
    // Internal notes never leave the admin surface.
    staffNote: isStaff ? (order.staffNote ?? null) : null,
    invoiceUrl: order.invoiceKey ? signedUrlFor(order.invoiceKey, 900) : null,
    placedAt: new Date(order.placedAt).toISOString(),
    paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : null,
    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt).toISOString() : null,
    createdAt: new Date(order.createdAt).toISOString(),
    updatedAt: new Date(order.updatedAt).toISOString(),
  };
}
