import { randomUUID } from 'node:crypto';

import {
  GUEST_CART_HEADER,
  addToCartSchema,
  applyCouponSchema,
  mergeCartSchema,
  updateCartItemSchema,
  type AddToCartInput,
} from '@sunshop/shared';
import {
  Router,
  type CookieOptions,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { env, isProduction } from '../../config/env';
import { authenticate, optionalAuth } from '../../middleware/auth';
import { writeRateLimit } from '../../middleware/rateLimit';
import { body, validate } from '../../middleware/validate';
import { asyncHandler, ok, setPrivateNoStore } from '../../utils/http';

import * as service from './cart.service';

const router = Router();

const GUEST_COOKIE = 'sunshop_cart';

function guestCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE || isProduction,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN === 'localhost' ? undefined : env.COOKIE_DOMAIN,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

/**
 * Establishes the anonymous cart identity.
 *
 * Guests get an opaque token in an httpOnly cookie; native clients that have no
 * cookie jar send the same value in `X-Cart-Token`. The token is a bearer
 * credential for one cart, so it is generated server-side and never derived
 * from anything guessable.
 */
function cartIdentity(req: Request, res: Response, next: NextFunction): void {
  if (req.principal.isAuthenticated) return next();

  const fromHeader = req.get(GUEST_CART_HEADER);
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[GUEST_COOKIE];
  const token = fromHeader ?? fromCookie ?? randomUUID();

  req.cartToken = token;
  if (!fromCookie) res.cookie(GUEST_COOKIE, token, guestCookieOptions());
  // Native clients read it back from here on first contact.
  res.setHeader(GUEST_CART_HEADER, token);

  next();
}

router.use(optionalAuth, cartIdentity);

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    const cart = await service.getOrCreateCart({
      principal: req.principal,
      guestToken: req.cartToken,
    });
    return ok(res, await service.toCartDto(cart, req.principal));
  }),
);

router.post(
  '/items',
  writeRateLimit,
  validate({ body: addToCartSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    return ok(
      res,
      await service.addItem(
        { principal: req.principal, guestToken: req.cartToken },
        body<AddToCartInput>(req),
      ),
    );
  }),
);

router.patch(
  '/items/:itemId',
  writeRateLimit,
  validate({ body: updateCartItemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    const { quantity } = body<{ quantity: number }>(req);
    return ok(
      res,
      await service.updateItem(
        { principal: req.principal, guestToken: req.cartToken },
        req.params.itemId!,
        quantity,
      ),
    );
  }),
);

router.delete(
  '/items/:itemId',
  writeRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    return ok(
      res,
      await service.removeItem(
        { principal: req.principal, guestToken: req.cartToken },
        req.params.itemId!,
      ),
    );
  }),
);

router.delete(
  '/',
  writeRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    return ok(
      res,
      await service.clearCart({ principal: req.principal, guestToken: req.cartToken }),
    );
  }),
);

router.post(
  '/coupon',
  writeRateLimit,
  validate({ body: applyCouponSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    const { code } = body<{ code: string }>(req);
    return ok(
      res,
      await service.applyCoupon({ principal: req.principal, guestToken: req.cartToken }, code),
    );
  }),
);

router.delete(
  '/coupon',
  writeRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    return ok(
      res,
      await service.removeCoupon({ principal: req.principal, guestToken: req.cartToken }),
    );
  }),
);

/** Called by the client immediately after a successful login. */
router.post(
  '/merge',
  authenticate,
  writeRateLimit,
  validate({ body: mergeCartSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    const { guestCartToken, strategy } = body<{
      guestCartToken: string;
      strategy: 'merge' | 'replace';
    }>(req);

    const cart = await service.mergeGuestCart(req.principal, guestCartToken, strategy);
    res.clearCookie(GUEST_COOKIE, { ...guestCookieOptions(), maxAge: undefined });
    return ok(res, cart);
  }),
);

export const cartRoutes = router;
