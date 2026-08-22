import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';

import { env, isProduction } from '../config/env';
import { moduleLogger } from '../observability/logger';
import { ApiError } from '../utils/ApiError';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

const log = moduleLogger('security');

/**
 * Security headers.
 *
 * The API serves JSON, not documents, so the CSP is maximally restrictive:
 * `default-src 'none'` means a reflected-XSS payload in a JSON error message
 * has nothing to execute against. The exception is the Swagger UI route, which
 * needs its own inline styles and is therefore mounted with a relaxed policy.
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
      ...(isProduction ? { 'upgrade-insecure-requests': [] } : {}),
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  // HSTS is terminated at the ALB but set here too: defence in depth costs a
  // header, and a misrouted direct hit still gets the right instruction.
  hsts: isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  // The API is not a document host; these two just remove attack surface.
  xFrameOptions: { action: 'deny' },
  xPoweredBy: false,
});

/** Relaxed policy just for the interactive API docs. */
export const swaggerSecurityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

/**
 * CORS with an explicit allow-list.
 *
 * `credentials: true` is required for the refresh cookie, and the spec forbids
 * pairing that with a wildcard origin: so the config validator rejects `*` in
 * production and this callback rejects anything not on the list.
 */
export function corsMiddleware(): RequestHandler {
  const allowed = new Set(env.CORS_ORIGINS);

  const options: CorsOptions = {
    origin(origin, callback) {
      // Same-origin requests, curl, and server-to-server calls send no Origin.
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);

      log.warn({ origin }, 'blocked cross-origin request');
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-Locale',
      'X-Currency',
      'X-Idempotency-Key',
      'X-Cart-Token',
    ],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 86_400,
    optionsSuccessStatus: 204,
  };

  return cors(options);
}

/**
 * Strips MongoDB operator injection from user input.
 *
 * `{"email": {"$gt": ""}}` posted to a login endpoint matches the first user in
 * the collection unless something removes the `$`. Mongoose's `sanitizeFilter`
 * covers queries built from objects, but this closes the door earlier, before
 * a payload can reach any code path at all. Keys are deleted rather than
 * escaped: no legitimate Sunshop field starts with `$` or contains a dot.
 */
export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  let removed = 0;

  const scrub = (value: unknown, depth = 0): unknown => {
    if (depth > 12 || value === null || typeof value !== 'object') return value;

    if (Array.isArray(value)) {
      return value.map((entry) => scrub(entry, depth + 1));
    }

    for (const objectKey of Object.keys(value as Record<string, unknown>)) {
      if (objectKey.startsWith('$') || objectKey.includes('.')) {
        delete (value as Record<string, unknown>)[objectKey];
        removed += 1;
        continue;
      }
      // Block prototype pollution via __proto__ / constructor payloads.
      if (objectKey === '__proto__' || objectKey === 'constructor' || objectKey === 'prototype') {
        delete (value as Record<string, unknown>)[objectKey];
        removed += 1;
        continue;
      }
      scrub((value as Record<string, unknown>)[objectKey], depth + 1);
    }
    return value;
  };

  scrub(req.body);
  scrub(req.params);
  // Express 5 exposes `query` as a getter; mutate in place rather than reassign.
  scrub(req.query);

  if (removed > 0) {
    log.warn(
      { removed, path: req.originalUrl.split('?')[0], ip: req.ip },
      'stripped operator-like keys from request',
    );
  }

  next();
}

/**
 * Rejects requests whose body is not JSON on write verbs.
 *
 * Without this, a form-encoded POST from an attacker's page is a "simple
 * request" that CORS preflight never sees: the classic CSRF vector against a
 * cookie-authenticated API.
 */
export function requireJsonContentType(req: Request, _res: Response, next: NextFunction): void {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  if (req.is('application/json')) return next();
  // Bodyless writes are fine (e.g. POST /logout).
  if (!req.get('content-length') || req.get('content-length') === '0') return next();

  next(ApiError.unsupportedMediaType());
}

/**
 * Caps the number of query parameters and array items, which stops an attacker
 * from turning `?tags=a&tags=b&…` (10k times) into an expensive query.
 */
export function limitQueryComplexity(maxKeys = 40, maxArray = 100): RequestHandler {
  return (req, _res, next) => {
    const entries = Object.entries(req.query);
    if (entries.length > maxKeys) return next(ApiError.badRequest('errors.bad_request'));

    for (const [, value] of entries) {
      if (Array.isArray(value) && value.length > maxArray) {
        return next(ApiError.badRequest('errors.bad_request'));
      }
    }
    next();
  };
}
