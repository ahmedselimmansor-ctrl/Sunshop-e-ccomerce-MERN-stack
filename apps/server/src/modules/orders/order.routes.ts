import {
  addShipmentSchema,
  cancelOrderSchema,
  checkoutSchema,
  idParamSchema,
  orderListQuerySchema,
  refundOrderSchema,
  shippingQuoteQuerySchema,
  updateOrderStatusSchema,
  money as toMoney,
  type AddShipmentInput,
  type CheckoutInput,
  type OrderListQuery,
  type RefundOrderInput,
  type UpdateOrderStatusInput,
} from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';

import { env } from '../../config/env';
import { authenticate, optionalAuth } from '../../middleware/auth';
import { idempotent } from '../../middleware/idempotency';
import { checkoutRateLimit, writeRateLimit } from '../../middleware/rateLimit';
import { requirePermission } from '../../middleware/rbac';
import { body, params, query, validate } from '../../middleware/validate';
import { asyncHandler, created, ok, paginated, setPrivateNoStore } from '../../utils/http';
import { getShippingMethods } from '../cart/pricing.service';

import * as service from './order.service';

const router = Router();

/** Shipping options for a destination: public, needed before checkout. */
router.get(
  '/shipping-methods',
  validate({ query: shippingQuoteQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { country } = query<{ country: string }>(req);
    const subtotal = toMoney(
      Number(req.query.subtotal ?? 0),
      (req.query.currency as never) ?? env.DEFAULT_CURRENCY,
    );
    return ok(res, await getShippingMethods(country, subtotal));
  }),
);

/**
 * Checkout.
 *
 * Idempotency is *required* here, not optional: this endpoint moves money and
 * holds inventory, and mobile clients retry aggressively on flaky networks.
 * `optionalAuth` because guests may check out with an email.
 */
router.post(
  '/checkout',
  optionalAuth,
  checkoutRateLimit,
  idempotent({ required: true }),
  validate({ body: checkoutSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    const order = await service.checkout(req.principal, body<CheckoutInput>(req), {
      guestToken:
        req.get('x-cart-token') ??
        (req.cookies as Record<string, string> | undefined)?.sunshop_cart,
      ip: req.ip ?? null,
    });
    return created(res, order);
  }),
);

router.get(
  '/',
  authenticate,
  validate({ query: orderListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    const result = await service.listOrders(req.principal, query<OrderListQuery>(req));
    return paginated(res, result.items, result.meta);
  }),
);

router.get(
  '/:idOrNumber',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    return ok(res, await service.getOrder(req.principal, req.params.idOrNumber!));
  }),
);

router.post(
  '/:id/cancel',
  authenticate,
  writeRateLimit,
  validate({ params: idParamSchema, body: cancelOrderSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = body<{ reason: string }>(req);
    return ok(
      res,
      await service.cancelOwnOrder(req.principal, params<{ id: string }>(req).id, reason),
    );
  }),
);

// ── Staff operations ────────────────────────────────────────────────────────

router.patch(
  '/:id/status',
  authenticate,
  requirePermission('order:write'),
  writeRateLimit,
  validate({ params: idParamSchema, body: updateOrderStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = body<UpdateOrderStatusInput>(req);
    return ok(
      res,
      await service.updateStatus(req.principal, params<{ id: string }>(req).id, input.status, {
        note: input.note,
        restock: input.restock,
      }),
    );
  }),
);

router.post(
  '/:id/shipments',
  authenticate,
  requirePermission('order:write'),
  writeRateLimit,
  validate({ params: idParamSchema, body: addShipmentSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.addShipment(
        req.principal,
        params<{ id: string }>(req).id,
        body<AddShipmentInput>(req),
      ),
    ),
  ),
);

router.post(
  '/:id/refund',
  authenticate,
  requirePermission('order:refund'),
  writeRateLimit,
  idempotent({ required: true }),
  validate({ params: idParamSchema, body: refundOrderSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.refundOrder(
        req.principal,
        params<{ id: string }>(req).id,
        body<RefundOrderInput>(req),
      ),
    ),
  ),
);

export const orderRoutes = router;
