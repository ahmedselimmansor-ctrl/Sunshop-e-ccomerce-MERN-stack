import { ERROR_CODES } from '@sunshop/shared';

import { redis } from '../db/redis';
import { ApiError } from '../utils/ApiError';

import type { NextFunction, Request, Response } from 'express';

/**
 * Maintenance mode.
 *
 * The flag lives in Redis (mirrored from the settings document) so toggling it
 * takes effect across every pod within a second, without a rollout. Staff and
 * the health probes are exempt: otherwise turning it on would fail readiness
 * and the deployment would evict the very pods serving the maintenance page.
 */
const FLAG_KEY = 'flags:maintenance';

let cached = { value: false, checkedAt: 0 };
const CACHE_MS = 5000;

export async function isMaintenanceMode(): Promise<boolean> {
  if (Date.now() - cached.checkedAt < CACHE_MS) return cached.value;
  try {
    const raw = await redis.get(FLAG_KEY);
    cached = { value: raw === '1', checkedAt: Date.now() };
  } catch {
    // If Redis is unreachable, serving traffic beats serving a 503.
    cached = { value: false, checkedAt: Date.now() };
  }
  return cached.value;
}

export async function setMaintenanceMode(enabled: boolean): Promise<void> {
  if (enabled) await redis.set(FLAG_KEY, '1');
  else await redis.del(FLAG_KEY);
  cached = { value: enabled, checkedAt: Date.now() };
}

export function maintenanceGuard(req: Request, _res: Response, next: NextFunction): void {
  isMaintenanceMode()
    .then((enabled) => {
      if (!enabled) return next();
      if (req.principal?.isStaff) return next();
      if (req.method === 'GET' && req.path.startsWith('/health')) return next();

      throw new ApiError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'errors.maintenance', {
        retryAfter: 300,
      });
    })
    .catch(next);
}
