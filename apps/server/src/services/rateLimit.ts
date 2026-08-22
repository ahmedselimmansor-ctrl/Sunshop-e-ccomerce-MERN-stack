import { redis } from '../db/redis';
import { moduleLogger } from '../observability/logger';
import { rateLimitRejections } from '../observability/metrics';

const log = moduleLogger('ratelimit');

/**
 * Distributed token-bucket rate limiter.
 *
 * Why a token bucket and not a fixed window: a fixed window lets a caller spend
 * its whole budget in the last millisecond of window N and again in the first
 * of window N+1: an instantaneous 2× burst that is exactly what a
 * credential-stuffing script produces. A bucket smooths that out while still
 * permitting a legitimate burst up to `capacity`.
 *
 * The whole read-modify-write runs inside one Lua script so it is atomic across
 * every pod, and the clock comes from Redis (`TIME`) rather than from the pod,
 * so node clock skew cannot hand anyone extra budget.
 */
const TOKEN_BUCKET_SCRIPT = `
local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])   -- tokens per second
local cost       = tonumber(ARGV[3])
local ttl        = tonumber(ARGV[4])   -- ms

local time = redis.call('TIME')
local now  = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts     = tonumber(bucket[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + (elapsed * refillRate))

local allowed = 0
local retryAfterMs = 0

if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfterMs = math.ceil(((cost - tokens) / refillRate) * 1000)
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, ttl)

return { allowed, math.floor(tokens), retryAfterMs }
`;

declare module 'ioredis' {
  /**
   * Declaration merging requires the type parameter to be named exactly as in
   * the original interface, so `Context` cannot be renamed to satisfy the
   * unused-variable rule: renaming it silently breaks the merge and every
   * ioredis method disappears from the type.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface RedisCommander<Context> {
    sunshopTokenBucket(
      key: string,
      capacity: string,
      refillRate: string,
      cost: string,
      ttl: string,
    ): Promise<[number, number, number]>;
  }
}

redis.defineCommand('sunshopTokenBucket', {
  numberOfKeys: 1,
  lua: TOKEN_BUCKET_SCRIPT,
});

export interface RateLimitConfig {
  /** Human name, used in metrics and logs. */
  name: string;
  /** Maximum burst size. */
  points: number;
  /** Seconds over which `points` fully refill. */
  duration: number;
  /** Cost of a single request; heavier endpoints may charge more. */
  cost?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds the caller should wait; 0 when allowed. */
  retryAfter: number;
  limit: number;
}

export async function consume(
  config: RateLimitConfig,
  identifier: string,
): Promise<RateLimitResult> {
  const bucketKey = `rl:${config.name}:${identifier}`;
  const refillRate = config.points / config.duration;
  const cost = config.cost ?? 1;
  const ttlMs = Math.ceil((config.points / refillRate) * 1000) + 1000;

  try {
    const [allowed, remaining, retryAfterMs] = await redis.sunshopTokenBucket(
      bucketKey,
      String(config.points),
      String(refillRate),
      String(cost),
      String(ttlMs),
    );

    if (allowed !== 1) {
      rateLimitRejections.inc({ limiter: config.name });
    }

    return {
      allowed: allowed === 1,
      remaining: Math.max(0, remaining),
      retryAfter: Math.ceil(retryAfterMs / 1000),
      limit: config.points,
    };
  } catch (error) {
    // Fail open: a Redis outage must not take the storefront down with it.
    // The WAF rate rule in front of the ALB is the backstop for this window.
    log.error({ err: (error as Error).message, limiter: config.name }, 'rate limit check failed');
    return { allowed: true, remaining: config.points, retryAfter: 0, limit: config.points };
  }
}

export async function resetLimit(name: string, identifier: string): Promise<void> {
  await redis.del(`rl:${name}:${identifier}`).catch(() => undefined);
}

/**
 * Progressive login lockout, separate from the IP limiter above.
 *
 * Keyed on the account, not the source address: a distributed stuffing run
 * rotates IPs but keeps hammering the same handful of emails, and an IP-only
 * limiter never sees it.
 */
export async function recordLoginFailure(
  email: string,
  maxAttempts: number,
  lockSeconds: number,
): Promise<{ locked: boolean; attempts: number; retryAfter: number }> {
  const failKey = `login:fail:${email}`;
  try {
    const attempts = await redis.incr(failKey);
    if (attempts === 1) await redis.expire(failKey, lockSeconds);

    if (attempts >= maxAttempts) {
      const ttl = await redis.ttl(failKey);
      return { locked: true, attempts, retryAfter: ttl > 0 ? ttl : lockSeconds };
    }
    return { locked: false, attempts, retryAfter: 0 };
  } catch {
    return { locked: false, attempts: 0, retryAfter: 0 };
  }
}

export async function isLoginLocked(
  email: string,
  maxAttempts: number,
): Promise<{ locked: boolean; retryAfter: number }> {
  try {
    const raw = await redis.get(`login:fail:${email}`);
    const attempts = raw ? Number.parseInt(raw, 10) : 0;
    if (attempts < maxAttempts) return { locked: false, retryAfter: 0 };
    const ttl = await redis.ttl(`login:fail:${email}`);
    return { locked: true, retryAfter: ttl > 0 ? ttl : 60 };
  } catch {
    return { locked: false, retryAfter: 0 };
  }
}

export async function clearLoginFailures(email: string): Promise<void> {
  await redis.del(`login:fail:${email}`).catch(() => undefined);
}
