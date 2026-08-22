import type { PaginationMeta } from '@sunshop/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async handler so a rejected promise reaches Express's error
 * pipeline. Without this, an `await` that throws inside a handler becomes an
 * unhandled rejection and the client hangs until the LB times it out.
 */
export function asyncHandler<
  P = Record<string, string>,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = Record<string, unknown>,
>(
  handler: (
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler<P, ResBody, ReqBody, ReqQuery> {
  return (req, res, next) => {
    Promise.resolve(handler(req as never, res as never, next)).catch(next);
  };
}

/** `{ ok: true, data }`, the single success envelope for the whole API. */
export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ ok: true, data });
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, 201);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

export function paginated<T>(
  res: Response,
  data: T[],
  meta: PaginationMeta,
  status = 200,
): Response {
  return res.status(status).json({ ok: true, data, meta });
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Public, cacheable GET responses get CDN caching headers so CloudFront serves
 * the long tail of catalog traffic without ever touching a pod.
 * `stale-while-revalidate` keeps the edge serving during an origin blip.
 */
export function setPublicCache(
  res: Response,
  maxAgeSeconds: number,
  swrSeconds = maxAgeSeconds * 4,
): void {
  res.setHeader(
    'Cache-Control',
    `public, max-age=0, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${swrSeconds}, stale-if-error=86400`,
  );
  // Content differs per locale and per currency; the edge must key on both.
  res.setHeader('Vary', 'Accept-Encoding, Accept-Language, X-Locale, X-Currency');
}

/** Anything user-specific must never be stored by a shared cache. */
export function setPrivateNoStore(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

/** Weak ETag support for conditional GETs on large catalog payloads. */
export function setEtag(res: Response, etag: string): void {
  res.setHeader('ETag', `W/"${etag}"`);
}

export function notModified(req: Request, res: Response, etag: string): boolean {
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch.replace(/^W\//, '').replace(/"/g, '') === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

/** Client IP that respects the configured proxy depth (ALB → ingress → pod). */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
