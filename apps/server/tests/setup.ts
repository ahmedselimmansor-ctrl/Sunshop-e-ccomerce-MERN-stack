/**
 * Test environment.
 *
 * `config/env.ts` calls `process.exit(1)` on an invalid environment: correct
 * for a pod, fatal for a test runner: so a valid one is installed before any
 * module under test is imported.
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sunshop-test';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
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
