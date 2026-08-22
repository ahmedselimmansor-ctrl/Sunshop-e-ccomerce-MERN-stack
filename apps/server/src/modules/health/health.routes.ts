import { Router, type Request, type Response } from 'express';

import { env } from '../../config/env';
import { isMongoHealthy, pingMongo } from '../../db/mongoose';
import { isRedisHealthy, pingRedis } from '../../db/redis';
import { moduleLogger } from '../../observability/logger';
import { collectMetrics, metricsContentType } from '../../observability/metrics';
import { pingSearch } from '../../search/client';
import { safeEqual } from '../../security/crypto';
import { asyncHandler } from '../../utils/http';

const log = moduleLogger('health');

const router = Router();

const startedAt = Date.now();

/** Flipped by the shutdown handler so the LB drains this pod before it exits. */
let shuttingDown = false;

export function beginShutdown(): void {
  shuttingDown = true;
}

/**
 * Liveness (`/healthz`).
 *
 * Deliberately checks *nothing* downstream. A liveness probe that fails when
 * MongoDB is briefly unavailable causes Kubernetes to restart every pod
 * simultaneously: turning a recoverable database blip into a full outage. The
 * only question this answers is "is this process wedged?".
 */
router.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000) });
});

/**
 * Readiness (`/readyz`).
 *
 * Answers "should this pod receive traffic right now?": which *does* depend on
 * MongoDB and Redis, since a pod that cannot reach them serves nothing but
 * errors. Elasticsearch is checked but not required: search degrades to the
 * Mongo fallback, so an OpenSearch outage must not empty the fleet.
 */
router.get(
  '/readyz',
  asyncHandler(async (_req: Request, res: Response) => {
    if (shuttingDown) {
      return res.status(503).json({ status: 'shutting_down' });
    }

    const [mongoOk, redisOk] = await Promise.all([pingMongo(), pingRedis()]);
    const ready = mongoOk && redisOk;

    return res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks: {
        mongodb: mongoOk ? 'up' : 'down',
        redis: redisOk ? 'up' : 'down',
      },
    });
  }),
);

/**
 * Startup probe target. Kubernetes uses it to allow a slow first connection
 * without a long `initialDelaySeconds` weakening the liveness probe.
 */
router.get('/startupz', (_req: Request, res: Response) => {
  const booted = isMongoHealthy() && isRedisHealthy();
  res.status(booted ? 200 : 503).json({ status: booted ? 'started' : 'starting' });
});

/**
 * Detailed health, including the optional dependencies. Behind the metrics
 * token because the response enumerates internal topology.
 */
router.get(
  '/health',
  asyncHandler(async (req: Request, res: Response) => {
    if (!authorizeOps(req)) return res.status(404).json({ ok: false });

    const [mongoOk, redisOk, searchOk] = await Promise.all([
      pingMongo(),
      pingRedis(),
      pingSearch(),
    ]);

    return res.status(200).json({
      status: mongoOk && redisOk ? 'ok' : 'degraded',
      version: env.APP_VERSION,
      env: env.NODE_ENV,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      pod: env.HOSTNAME ?? 'local',
      dependencies: {
        mongodb: { status: mongoOk ? 'up' : 'down', required: true },
        redis: { status: redisOk ? 'up' : 'down', required: true },
        elasticsearch: {
          status: searchOk ? 'up' : 'down',
          required: false,
          note: 'falls back to MongoDB text search',
        },
      },
    });
  }),
);

/**
 * Prometheus scrape endpoint.
 *
 * Token-gated when `METRICS_TOKEN` is set. Inside the mesh a NetworkPolicy
 * already restricts who can reach it; the token is the second layer for
 * clusters where that policy is not in place.
 */
router.get(
  '/metrics',
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.METRICS_ENABLED) return res.status(404).end();
    if (!authorizeOps(req)) return res.status(404).end();

    res.setHeader('Content-Type', metricsContentType);
    return res.send(await collectMetrics());
  }),
);

function authorizeOps(req: Request): boolean {
  if (!env.METRICS_TOKEN) return true;

  const header = req.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.get('x-metrics-token') ?? '');

  const authorized = safeEqual(presented, env.METRICS_TOKEN);
  if (!authorized) log.warn({ ip: req.ip }, 'unauthorized ops endpoint access');
  return authorized;
}

export const healthRoutes = router;
