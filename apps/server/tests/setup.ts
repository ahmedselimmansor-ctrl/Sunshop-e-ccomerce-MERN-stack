/**
 * Test environment.
 *
 * `config/env.ts` calls `process.exit(1)` on an invalid environment: correct
 * for a pod, fatal for a test runner: so a valid one is installed before any
 * module under test is imported.
 */
process.env.NODE_ENV = 'test';
// The integration harness replaces this with an in-memory replica set. The
// literal is only a valid-looking placeholder so config validation passes.
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/sunshop-test';
// Database 15, and overridable: this repo's compose file maps Redis to 6380
// on machines where another project already holds 6379.
/*
 * A Redis database of this process's own.
 *
 * Sessions, rate-limit counters and idempotency records all live in Redis, and
 * the integration harness clears the database it is handed. Vitest gives each
 * test file its own process, so picking here keeps one file from clearing
 * another's live session, which surfaced as an unrelated 401 that only
 * appeared when the whole suite ran.
 *
 * It has to happen in this file rather than in the harness: `db/redis.ts`
 * builds its client from the cached env the moment it is imported.
 *
 * Databases 1-15 are addressable; 0 is left to whatever a developer has
 * running locally.
 */
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-definitely-long-enough';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-also-long-enough-ok';
// 32 bytes, base64. AES-256 requires exactly this length.
process.env.FIELD_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString(
  'base64',
);
process.env.ELASTICSEARCH_ENABLED = 'false';
process.env.MAIL_DRIVER = 'console';
process.env.PAYMENTS_ENABLED = 'false';
process.env.SKIP_DOTENV = 'true';
