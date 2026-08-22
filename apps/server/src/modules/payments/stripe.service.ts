import Stripe from 'stripe';

import { env } from '../../config/env';
import { Order } from '../../models/Order';
import { moduleLogger } from '../../observability/logger';
import { businessEvents } from '../../observability/metrics';
import { scopeOrders } from '../../security/dataAccess';
import { ApiError } from '../../utils/ApiError';

import type { Principal } from '../../security/principal';
import type { PaymentIntentResponse } from '@sunshop/shared';

const log = moduleLogger('payments');

/**
 * Stripe integration.
 *
 * Sunshop never sees a card number: the browser tokenizes with Stripe.js
 * against a PaymentIntent client secret, so the API stays out of PCI scope
 * entirely. What crosses this boundary is an intent id and, later, a webhook.
 *
 * The webhook: not the browser's success callback: is what marks an order
 * paid. A client can close the tab, lose signal, or lie; the signed webhook is
 * the only trustworthy signal that money moved.
 */
let stripe: Stripe | null = null;

function client(): Stripe {
  if (!env.PAYMENTS_ENABLED || !env.STRIPE_SECRET_KEY) {
    throw ApiError.unavailable('errors.payments_disabled');
  }
  stripe ??= new Stripe(env.STRIPE_SECRET_KEY, {
    // Pinned to the version the installed SDK types were generated against.
    // Bumping it is a deliberate act, not a side effect of `npm update`.
    apiVersion: '2025-02-24.acacia',
    maxNetworkRetries: 2,
    timeout: 8000,
    telemetry: false,
  });
  return stripe;
}

export async function createPaymentIntent(
  principal: Principal,
  orderId: string,
): Promise<PaymentIntentResponse> {
  const order = await Order.findOne(scopeOrders(principal, { _id: orderId }));
  if (!order) throw ApiError.notFound();

  if (order.paymentStatus === 'paid') throw ApiError.conflict('errors.conflict');
  if (order.status === 'cancelled') throw ApiError.conflict('errors.order_not_cancellable');

  // Reuse an existing intent rather than minting a second one for the same
  // order: two open intents is how an order gets charged twice.
  if (order.payment?.intentId) {
    const existing = await client().paymentIntents.retrieve(order.payment.intentId);
    if (
      ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(
        existing.status,
      )
    ) {
      return {
        provider: 'stripe',
        clientSecret: existing.client_secret!,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '',
        amount: order.totals.total,
        orderId,
      };
    }
  }

  const intent = await client().paymentIntents.create(
    {
      amount: order.totals.total.amount,
      currency: order.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      // The webhook uses this to find the order without trusting the client.
      metadata: {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        userId: order.user ? String(order.user) : 'guest',
      },
      receipt_email: order.email,
      description: `Sunshop order ${order.orderNumber}`,
      shipping: {
        name: order.shippingAddress.fullName,
        phone: order.shippingAddress.phone,
        address: {
          line1: order.shippingAddress.line1,
          line2: order.shippingAddress.line2 ?? undefined,
          city: order.shippingAddress.city,
          state: order.shippingAddress.state ?? undefined,
          postal_code: order.shippingAddress.postalCode ?? undefined,
          country: order.shippingAddress.country,
        },
      },
    },
    // Stripe-level idempotency: a retried create returns the same intent.
    { idempotencyKey: `intent:${order.orderNumber}` },
  );

  order.payment = { ...(order.payment ?? {}), provider: 'stripe', intentId: intent.id } as never;
  await order.save();

  log.info({ orderId, intentId: intent.id }, 'payment intent created');

  return {
    provider: 'stripe',
    clientSecret: intent.client_secret!,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '',
    amount: order.totals.total,
    orderId,
  };
}

export async function refundPayment(
  intentId: string,
  amountMinorUnits: number,
  reason: string,
): Promise<string> {
  const stripeReason: Stripe.RefundCreateParams.Reason | undefined =
    reason === 'fraudulent'
      ? 'fraudulent'
      : reason === 'duplicate'
        ? 'duplicate'
        : 'requested_by_customer';

  try {
    const refund = await client().refunds.create(
      { payment_intent: intentId, amount: amountMinorUnits, reason: stripeReason },
      { idempotencyKey: `refund:${intentId}:${amountMinorUnits}` },
    );
    return refund.id;
  } catch (error) {
    log.error({ err: (error as Error).message, intentId }, 'refund failed at provider');
    throw ApiError.internal('errors.payment_failed', error);
  }
}

/**
 * Verifies the webhook signature against the raw body.
 *
 * The raw bytes matter: any JSON re-serialization changes whitespace and breaks
 * the HMAC, which is why the webhook route is mounted with `express.raw` before
 * the JSON parser. An unverified webhook is an unauthenticated "mark this order
 * paid" endpoint, so a failure here is a hard reject.
 */
export function constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw ApiError.unavailable('errors.payments_disabled');
  }
  try {
    return client().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    log.warn({ err: (error as Error).message }, 'webhook signature verification failed');
    throw ApiError.badRequest('errors.bad_request');
  }
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  const { markPaid, markPaymentFailed } = await import('../orders/order.service');

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (!orderId) {
        log.warn({ intentId: intent.id }, 'succeeded intent without orderId metadata');
        return;
      }

      const charge = intent.latest_charge;
      const card =
        typeof charge === 'object' && charge?.payment_method_details?.card
          ? charge.payment_method_details.card
          : null;

      await markPaid(orderId, {
        provider: 'stripe',
        intentId: intent.id,
        chargeId: typeof charge === 'string' ? charge : (charge?.id ?? undefined),
        last4: card?.last4 ?? undefined,
        brand: card?.brand ?? undefined,
      });
      break;
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (orderId) {
        await markPaymentFailed(orderId, intent.last_payment_error?.code ?? 'unknown');
      }
      break;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object;
      businessEvents.inc({ event: 'dispute', outcome: 'failure' });
      log.error({ disputeId: dispute.id, amount: dispute.amount }, 'chargeback opened');
      break;
    }

    default:
      log.debug({ type: event.type }, 'unhandled stripe event');
  }
}
