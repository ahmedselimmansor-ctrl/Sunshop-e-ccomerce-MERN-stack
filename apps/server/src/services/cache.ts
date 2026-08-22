import { stableStringify } from '@sunshop/shared';

import { env } from '../config/env';
import { redis } from '../db/redis';
import { moduleLogger } from '../observability/logger';
import { cacheOperations } from '../observability/metrics';
import { shortHash } from '../security/crypto';

const log = moduleLogger('cache');

/**
 * Cache-aside layer over Redis.
 *
 * Design decisions worth knowing:
 *
 *  • **Tags, not key scans.** Invalidating "everything derived from product X"
 *    with `KEYS`/`SCAN` is O(keyspace) and blocks Redis. Instead each cached
 *    entry registers itself in one or more tag sets, and invalidation deletes
 *    the members of a set in a single pipeline.
 *
 *  • **Stampede protection.** On a miss, exactly one caller acquires a short
 *    lock and computes; the rest briefly wait and re-read. Without this, a
 *    popular key expiring during a traffic spike sends every pod's every
 *    request to Mongo simultaneously.
 *
 *  • **Fail open.** Redis being down degrades latency, never correctness: all
 *    cache errors are swallowed and the origin function runs.
 */

const LOCK_TTL_MS = 5000;
const LOCK_WAIT_MS = 60;
const LOCK_MAX_WAIT_ATTEMPTS = 25;

export interface CacheOptions {
  ttl?: number;
  tags?: readonly string[];
  /** Skip reading (but still write): used by "force refresh" admin actions. */
  bypass?: boolean;
}

function serialize(value: unknown): string {
  return JSON.stringify({ v: value });
}

function deserialize<T>(raw: string): T | undefined {
  try {
    return (JSON.parse(raw) as { v: T }).v;
  } catch {
    return undefined;
  }
}

export async function cacheGet<T>(cacheKey: string): Promise<T | undefined> {
  try {
    const raw = await redis.get(cacheKey);
    if (raw == null) {
      cacheOperations.inc({ operation: 'get', result: 'miss' });
      return undefined;
    }
    cacheOperations.inc({ operation: 'get', result: 'hit' });
    return deserialize<T>(raw);
  } catch (error) {
    cacheOperations.inc({ operation: 'get', result: 'error' });
    log.warn({ err: (error as Error).message, cacheKey }, 'cache get failed');
    return undefined;
  }
}

export async function cacheSet(
  cacheKey: string,
  value: unknown,
  options: CacheOptions = {},
): Promise<void> {
  const ttl = options.ttl ?? env.REDIS_CACHE_TTL;
  try {
    const pipeline = redis.pipeline();
    pipeline.set(cacheKey, serialize(value), 'EX', ttl);
    for (const tag of options.tags ?? []) {
      pipeline.sadd(tag, cacheKey);
      // Tag sets outlive their members slightly so a late write still finds them.
      pipeline.expire(tag, ttl * 4);
    }
    await pipeline.exec();
    cacheOperations.inc({ operation: 'set', result: 'ok' });
  } catch (error) {
    cacheOperations.inc({ operation: 'set', result: 'error' });
    log.warn({ err: (error as Error).message, cacheKey }, 'cache set failed');
  }
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
    cacheOperations.inc({ operation: 'del', result: 'ok' });
  } catch (error) {
    cacheOperations.inc({ operation: 'del', result: 'error' });
    log.warn({ err: (error as Error).message }, 'cache delete failed');
  }
}

/** Deletes every key registered under any of `tags`, then the tag sets. */
export async function invalidateTags(...tags: string[]): Promise<number> {
  if (tags.length === 0) return 0;
  try {
    const memberLists = await Promise.all(tags.map((tag) => redis.smembers(tag)));
    const keys = [...new Set(memberLists.flat())];

    const pipeline = redis.pipeline();
    // ioredis prefixes keys automatically, but SMEMBERS returned the *prefixed*
    // names, so strip the prefix before handing them back to a prefixed client.
    const prefix = `${env.REDIS_KEY_PREFIX}:`;
    for (const member of keys) {
      pipeline.del(member.startsWith(prefix) ? member.slice(prefix.length) : member);
    }
    for (const tag of tags) pipeline.del(tag);
    await pipeline.exec();

    cacheOperations.inc({ operation: 'invalidate', result: 'ok' });
    log.debug({ tags, count: keys.length }, 'cache tags invalidated');
    return keys.length;
  } catch (error) {
    cacheOperations.inc({ operation: 'invalidate', result: 'error' });
    log.warn({ err: (error as Error).message, tags }, 'tag invalidation failed');
    return 0;
  }
}

/**
 * Cache-aside with single-flight. Returns the cached value when present,
 * otherwise computes it under a lock and stores the result.
 */
export async function cached<T>(
  cacheKey: string,
  producer: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> {
  if (!options.bypass) {
    const hit = await cacheGet<T>(cacheKey);
    if (hit !== undefined) return hit;
  }

  const lockKey = `lock:${cacheKey}`;
  let acquired = false;
  try {
    acquired = (await redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
  } catch {
    // Redis unavailable: just compute.
    return producer();
  }

  if (!acquired) {
    // Someone else is computing; poll briefly for their result.
    for (let attempt = 0; attempt < LOCK_MAX_WAIT_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
      const hit = await cacheGet<T>(cacheKey);
      if (hit !== undefined) return hit;
    }
    // Waited long enough: compute rather than stall the request further.
    return producer();
  }

  try {
    const value = await producer();
    await cacheSet(cacheKey, value, options);
    return value;
  } finally {
    await redis.del(lockKey).catch(() => undefined);
  }
}

/**
 * Deterministic cache key from a query object. Sorted keys mean
 * `?a=1&b=2` and `?b=2&a=1` hit the same entry.
 */
export function queryHash(query: unknown): string {
  return shortHash(stableStringify(query));
}

/** Removes every key under a namespace. Only for admin "flush" actions. */
export async function flushNamespace(namespace: string): Promise<number> {
  const prefix = `${env.REDIS_KEY_PREFIX}:${namespace}`;
  let cursor = '0';
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = next;
    if (keys.length > 0) {
      const stripped = keys.map((entry) => entry.slice(`${env.REDIS_KEY_PREFIX}:`.length));
      await redis.del(...stripped);
      removed += keys.length;
    }
  } while (cursor !== '0');
  return removed;
}
