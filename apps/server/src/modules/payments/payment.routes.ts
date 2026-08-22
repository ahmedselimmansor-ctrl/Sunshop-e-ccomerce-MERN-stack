import { createPaymentIntentSchema } from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';

import { optionalAuth } from '../../middleware/auth';
import { checkoutRateLimit } from '../../middleware/rateLimit';
import { body, validate } from '../../middleware/validate';
import { moduleLogger } from '../../observability/logger';
import { asyncHandler, ok, setPrivateNoStore } from '../../utils/http';

import { constructEvent, createPaymentIntent, handleWebhookEvent } from './stripe.service';

const log = moduleLogger('payments:routes');

const router = Router();

router.post(
  '/intent',
  optionalAuth,
  checkoutRateLimit,
  validate({ body: createPaymentIntentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    const { orderId } = body<{ orderId: string }>(req);
    return ok(res, await createPaymentIntent(req.principal, orderId));
  }),
);

/**
 * Stripe webhook.
 *
 * Mounted in `app.ts` with `express.raw` so `req.body` is the exact bytes
 * Stripe signed. Deliberately unauthenticated: the HMAC signature *is* the
 * authentication: and deliberately fast: Stripe retries anything that takes
 * longer than 20s or answers non-2xx, so the handler acknowledges first and
 * lets failures surface through the outbox rather than blocking the response.
 */
router.post(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.get('stripe-signature');
    if (!signature) return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const event = constructEvent(rawBody, signature);

    try {
      await handleWebhookEvent(event);
    } catch (error) {
      // A 500 makes Stripe retry, which is what we want for a transient
      // failure: but log loudly, because a persistent failure here means
      // paid orders are stuck in `pending_payment`.
      log.error(
        { err: (error as Error).message, type: event.type, id: event.id },
        'webhook handling failed',
      );
      throw error;
    }

    return res.status(200).json({ received: true });
  }),
);

/** Publishable key + enabled methods, so the client needs no build-time config. */
router.get(
  '/config',
  asyncHandler(async (_req: Request, res: Response) => {
    const { env } = await import('../../config/env');
    return ok(res, {
      enabled: env.PAYMENTS_ENABLED,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
      methods: env.PAYMENTS_ENABLED ? ['card', 'cash_on_delivery'] : ['cash_on_delivery'],
      currency: env.DEFAULT_CURRENCY,
    });
  }),
);

export const paymentRoutes = router;
