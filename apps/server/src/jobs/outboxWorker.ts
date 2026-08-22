import { formatMoney, type Currency, type Locale } from '@sunshop/shared';

import { Order } from '../models/Order';
import { OutboxEvent } from '../models/OutboxEvent';
import { User } from '../models/User';
import { moduleLogger } from '../observability/logger';
import { outboxBacklog } from '../observability/metrics';
import { syncProduct } from '../search/reindex';
import { sendOrderConfirmationEmail, sendShipmentEmail } from '../services/mailer';

const log = moduleLogger('outbox');

/**
 * Outbox worker.
 *
 * Drains the events that write paths recorded transactionally. Claiming uses
 * `findOneAndUpdate` with a status guard, which is atomic: several replicas
 * run this loop and each event is handled exactly once even though nothing
 * coordinates them.
 *
 * Failures back off exponentially and stop at `dead` after 6 attempts, where
 * they wait for a human. Retrying forever would let one poisoned event burn
 * capacity indefinitely.
 */
const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 25;

let running = false;
let stopped = false;

export function stopOutboxWorker(): void {
  stopped = true;
}

export async function drainOutbox(): Promise<number> {
  if (running || stopped) return 0;
  running = true;

  let processed = 0;

  try {
    for (let index = 0; index < BATCH_SIZE; index += 1) {
      const event = await OutboxEvent.findOneAndUpdate(
        { status: 'pending', availableAt: { $lte: new Date() } },
        { status: 'processing', $inc: { attempts: 1 } },
        { new: true, sort: { availableAt: 1 } },
      );

      if (!event) break;

      try {
        await handleEvent(event.type, event.payload as Record<string, unknown>);
        await OutboxEvent.updateOne(
          { _id: event._id },
          { status: 'done', processedAt: new Date(), lastError: null },
        );
        processed += 1;
      } catch (error) {
        const message = (error as Error).message;
        const dead = event.attempts >= MAX_ATTEMPTS;

        await OutboxEvent.updateOne(
          { _id: event._id },
          {
            status: dead ? 'dead' : 'pending',
            lastError: message.slice(0, 500),
            // 2s, 4s, 8s, … capped at ~5 minutes.
            availableAt: new Date(Date.now() + Math.min(300_000, 2 ** event.attempts * 1000)),
          },
        );

        log[dead ? 'error' : 'warn'](
          { err: message, type: event.type, attempts: event.attempts, eventId: String(event._id) },
          dead ? 'outbox event moved to dead letter' : 'outbox event failed; will retry',
        );
      }
    }
  } finally {
    running = false;
  }

  return processed;
}

async function handleEvent(type: string, payload: Record<string, unknown>): Promise<void> {
  switch (type) {
    case 'product.upserted':
    case 'product.deleted':
      await syncProduct(String(payload.productId));
      break;

    case 'order.placed':
    case 'order.paid':
      await sendOrderConfirmation(String(payload.orderId));
      break;

    case 'order.shipped':
      await sendShipmentNotice(String(payload.orderId), payload);
      break;

    case 'order.status_changed':
    case 'order.refunded':
    case 'review.created':
    case 'user.registered':
      // No side effect beyond what the request already did; kept as an event
      // so future consumers (analytics, webhooks) have a durable stream.
      log.debug({ type, payload }, 'event acknowledged');
      break;

    default:
      log.warn({ type }, 'no handler for outbox event');
  }
}

async function sendOrderConfirmation(orderId: string): Promise<void> {
  const order = await Order.findById(orderId).lean();
  if (!order) return;
  // Only confirm once money has actually moved.
  if (order.paymentStatus !== 'paid' && order.paymentMethod !== 'cash_on_delivery') return;

  const user = order.user
    ? await User.findById(order.user).select('firstName locale').lean()
    : null;
  const locale = (user?.locale ?? 'en') as Locale;

  await sendOrderConfirmationEmail({
    to: order.email,
    firstName: user?.firstName ?? order.shippingAddress?.fullName?.split(' ')[0] ?? 'there',
    orderNumber: order.orderNumber,
    total: formatMoney(
      { amount: order.totals.total.amount, currency: order.currency as Currency },
      locale,
    ),
    locale,
  });
}

async function sendShipmentNotice(
  orderId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const order = await Order.findById(orderId).lean();
  if (!order) return;

  const user = order.user ? await User.findById(order.user).select('locale').lean() : null;

  await sendShipmentEmail({
    to: order.email,
    orderNumber: order.orderNumber,
    carrier: String(payload.carrier ?? ''),
    trackingNumber: String(payload.trackingNumber ?? ''),
    trackingUrl: (payload.trackingUrl as string | null) ?? null,
    locale: (user?.locale ?? 'en') as Locale,
  });
}

/** Publishes backlog depth so an alert can fire before customers notice. */
export async function reportOutboxBacklog(): Promise<void> {
  const rows = await OutboxEvent.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  for (const status of ['pending', 'processing', 'failed', 'dead']) {
    const row = rows.find((entry) => entry._id === status);
    outboxBacklog.set({ status }, row?.count ?? 0);
  }
}
