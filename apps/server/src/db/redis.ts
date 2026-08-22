import { Redis, type RedisOptions } from 'ioredis';

import { env, isTest } from '../config/env';
import { moduleLogger } from '../observability/logger';
import { dependencyUp } from '../observability/metrics';

const log = moduleLogger('redis');

/**
 * Redis connection (ElastiCache in AWS).
 *
 * Two clients: a general one for cache/session/rate-limit traffic and a
 * dedicated subscriber, because a connection in subscribe mode cannot run
 * ordinary commands. Both are lazy so an unavailable Redis delays readiness
 * instead of crashing the boot: the app degrades to "no cache" rather than
 * refusing traffic entirely.
 */
function buildOptions(): RedisOptions {
  return {
    keyPrefix: `${env.REDIS_KEY_PREFIX}:`,
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    // ElastiCache in-transit encryption requires TLS with SNI.
    ...(env.REDIS_TLS ? { tls: { servername: new URL(env.REDIS_URL).hostname } } : {}),
    retryStrategy(times) {
      if (times > 20) return null;
      // 50ms, 100ms, … capped at 3s: fast enough for a blip, slow enough
      // not to hammer a recovering node.
      return Math.min(times * 50, 3000);
    },
    reconnectOnError(error) {
      // A failover promotes a replica; the old primary answers READONLY.
      return error.message.includes('READONLY');
    },
  };
}

export const redis = new Redis(env.REDIS_URL, buildOptions());
export const redisSubscriber = new Redis(env.REDIS_URL, buildOptions());

let healthy = false;

function wire(client: Redis, name: string): void {
  client.on('ready', () => {
    if (name === 'main') {
      healthy = true;
      dependencyUp.set({ dependency: 'redis' }, 1);
    }
    log.info({ client: name }, 'redis ready');
  });
  client.on('error', (error: Error) => {
    if (name === 'main') {
      healthy = false;
      dependencyUp.set({ dependency: 'redis' }, 0);
    }
    log.error({ client: name, err: error.message }, 'redis error');
  });
  client.on('end', () => {
    if (name === 'main') {
      healthy = false;
      dependencyUp.set({ dependency: 'redis' }, 0);
    }
    log.warn({ client: name }, 'redis connection closed');
  });
}

wire(redis, 'main');
wire(redisSubscriber, 'subscriber');

export async function connectRedis(): Promise<void> {
  if (isTest) return;
  await Promise.all([
    redis.status === 'ready'
      ? Promise.resolve()
      : redis.connect().catch((error: Error) => {
          log.error({ err: error.message }, 'initial redis connection failed; continuing degraded');
        }),
    redisSubscriber.status === 'ready'
      ? Promise.resolve()
      : redisSubscriber.connect().catch(() => undefined),
  ]);
}

export async function disconnectRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), redisSubscriber.quit()]);
}

export function isRedisHealthy(): boolean {
  return healthy && redis.status === 'ready';
}

export async function pingRedis(): Promise<boolean> {
  try {
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Every key already carries the global prefix via `keyPrefix`; this helper
 * exists so call sites never hand-concatenate and drift.
 */
export function key(...parts: (string | number)[]): string {
  return parts.join(':');
}
