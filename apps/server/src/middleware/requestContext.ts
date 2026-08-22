import { randomUUID } from 'node:crypto';

import { CORRELATION_ID_HEADER } from '@sunshop/shared';

import { runWithContext, setContextValues } from '../observability/context';
import { logger } from '../observability/logger';
import {
  httpRequestDuration,
  httpRequestsInFlight,
  httpRequestsTotal,
} from '../observability/metrics';
import { Principal } from '../security/principal';
import { clientIp } from '../utils/http';

import type { NextFunction, Request, Response } from 'express';

/** Accept an inbound correlation id only if it looks like one we minted. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * First middleware in the chain.
 *
 * Establishes the correlation id, the ambient async context, the metrics
 * timers and the access log. Everything downstream: including the error
 * handler: depends on `req.id` existing, so nothing may run before it.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get(CORRELATION_ID_HEADER);
  // Never echo an attacker-controlled string into logs unfiltered: a forged
  // header with newlines would forge log entries.
  const requestId = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();

  req.id = requestId;
  req.principal = Principal.anonymous();
  req.validated = {};
  res.setHeader(CORRELATION_ID_HEADER, requestId);

  const startedAt = process.hrtime.bigint();
  httpRequestsInFlight.inc({ method: req.method });

  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    // `req.route` is only populated after routing; fall back to the raw path
    // with ids masked so the metric cardinality stays bounded.
    const route = normalizeRoute(req);
    const labels = { method: req.method, route, status: String(res.statusCode) };

    httpRequestsInFlight.dec({ method: req.method });
    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestsTotal.inc(labels);

    setContextValues({ route });

    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](
      {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        route,
        status: res.statusCode,
        durationMs: Math.round(durationSeconds * 1000),
        ip: clientIp(req),
        userAgent: req.get('user-agent'),
        contentLength: res.getHeader('content-length'),
      },
      'request completed',
    );
  });

  runWithContext(
    {
      requestId,
      ip: clientIp(req),
      userAgent: req.get('user-agent') ?? undefined,
      method: req.method,
      startedAt: Date.now(),
    },
    () => next(),
  );
}

/**
 * Collapses dynamic path segments so Prometheus does not see one time series
 * per product id. `/api/v1/products/665f…/reviews` → `/products/:id/reviews`.
 */
function normalizeRoute(req: Request): string {
  if (req.route?.path && req.baseUrl !== undefined) {
    return `${req.baseUrl}${req.route.path}`.replace(/\/$/, '') || '/';
  }
  return req.originalUrl
    .split('?')[0]!
    .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 120);
}
