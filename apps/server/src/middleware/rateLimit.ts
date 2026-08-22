import { env } from '../config/env';
import { consume, type RateLimitConfig } from '../services/rateLimit';
import { ApiError } from '../utils/ApiError';
import { clientIp } from '../utils/http';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Layered rate limiting.
 *
 * Layer 0 (not here): AWS WAF rate rules at the edge absorb volumetric floods
 * before they cost a pod anything.
 * Layer 1 (here): per-identity application limits, which understand *who* is
 * calling and can be strict where it matters (login) and generous where it does
 * not (product reads).
 *
 * Identity is the user id when authenticated: otherwise a client behind
 * corporate NAT would share one bucket with thousands of colleagues: and the
 * client IP for anonymous traffic.
 */
function identify(req: Request): string {
  if (req.principal?.isAuthenticated && req.principal.id) return `u:${req.principal.id}`;
  return `ip:${clientIp(req)}`;
}

function setHeaders(
  res: Response,
  result: { limit: number; remaining: number; retryAfter: number },
): void {
  res.setHeader('RateLimit-Limit', String(result.limit));
  res.setHeader('RateLimit-Remaining', String(result.remaining));
  if (result.retryAfter > 0) res.setHeader('RateLimit-Reset', String(result.retryAfter));
}

export function rateLimit(
  config: RateLimitConfig,
  keyBuilder: (req: Request) => string = identify,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    consume(config, keyBuilder(req))
      .then((result) => {
        setHeaders(res, result);
        if (!result.allowed) {
          throw ApiError.rateLimited(Math.max(1, result.retryAfter));
        }
        next();
      })
      .catch(next);
  };
}

/** Applied to every route; the broad backstop. */
export const globalRateLimit = rateLimit({
  name: 'global',
  points: env.RATE_LIMIT_GLOBAL_POINTS,
  duration: env.RATE_LIMIT_GLOBAL_DURATION,
});

/**
 * Login/registration/reset. Keyed on IP *and* on the submitted email inside the
 * auth service, so neither a single noisy address nor a distributed attempt on
 * one account slips through.
 */
export const authRateLimit = rateLimit(
  {
    name: 'auth',
    points: env.RATE_LIMIT_AUTH_POINTS,
    duration: env.RATE_LIMIT_AUTH_DURATION,
  },
  (req) => `ip:${clientIp(req)}`,
);

/** Search is the most expensive read path. Elasticsearch fan-out per call. */
export const searchRateLimit = rateLimit({
  name: 'search',
  points: env.RATE_LIMIT_SEARCH_POINTS,
  duration: env.RATE_LIMIT_SEARCH_DURATION,
});

/** Any state-changing endpoint that is not auth. */
export const writeRateLimit = rateLimit({
  name: 'write',
  points: env.RATE_LIMIT_WRITE_POINTS,
  duration: env.RATE_LIMIT_WRITE_DURATION,
});

/** Checkout is deliberately tight: it costs money and holds inventory. */
export const checkoutRateLimit = rateLimit({ name: 'checkout', points: 10, duration: 60 });

/** Presigned upload requests: each one hands out write access to a bucket. */
export const uploadRateLimit = rateLimit({ name: 'upload', points: 30, duration: 60 });

/** Outbound email costs money and reputation; throttle hard per address. */
export function emailRateLimit(getEmail: (req: Request) => string | undefined): RequestHandler {
  return rateLimit({ name: 'email', points: 3, duration: 900 }, (req) => {
    const email = getEmail(req);
    return email ? `email:${email.toLowerCase()}` : `ip:${clientIp(req)}`;
  });
}
