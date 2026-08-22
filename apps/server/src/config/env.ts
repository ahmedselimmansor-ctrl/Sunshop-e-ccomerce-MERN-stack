import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

/**
 * Minimal `.env` loader for local development.
 *
 * No `dotenv` dependency: the parser is twenty lines and this must run before
 * anything else, including any module that could itself read config. In
 * Kubernetes there is no `.env` at all: every value arrives as a container
 * environment variable from a ConfigMap or from Secrets Manager via the
 * External Secrets Operator: so this is skipped entirely in production.
 *
 * Existing environment variables always win: an explicit `REDIS_URL=… npm run
 * dev` must not be silently overridden by a stale file.
 */
function loadDotEnvFile(): void {
  if (process.env.NODE_ENV === 'production' || process.env.SKIP_DOTENV === 'true') return;

  const candidates = [
    process.env.DOTENV_PATH,
    resolve(process.cwd(), '.env'),
    // Running from apps/server inside the monorepo.
    resolve(process.cwd(), '../../.env'),
  ].filter((path): path is string => Boolean(path));

  const file = candidates.find((path) => existsSync(path));
  if (!file) return;

  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!key || key in process.env) continue;

    let value = line.slice(separator + 1).trim();
    // Strip matched surrounding quotes, preserving inner ones.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnvFile();

/**
 * Environment contract.
 *
 * The process refuses to boot on an invalid environment. That is deliberate:
 * a pod that starts with a missing JWT secret and only fails at the first login
 * is far worse than a pod that never passes its readiness probe, because the
 * deployment then rolls forward and takes the fleet with it.
 */

const bool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(fallback)
    .transform((value) =>
      typeof value === 'boolean' ? value : ['true', '1', 'yes', 'on'].includes(value.toLowerCase()),
    );

const csv = (fallback = '') =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    );

const port = z.coerce.number().int().min(1).max(65_535);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: port.default(4000),
    API_PREFIX: z.string().startsWith('/').default('/api/v1'),
    APP_NAME: z.string().default('Sunshop'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: csv('http://localhost:5173,http://localhost:5174'),
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
    PUBLIC_ADMIN_URL: z.string().url().default('http://localhost:5174'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(25_000),
    BODY_LIMIT: z.string().default('256kb'),

    // ── Data stores ─────────────────────────────────────────────────────────
    MONGO_URI: z.string().min(1),
    MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(500).default(20),
    MONGO_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(100).default(2),
    MONGO_TLS_CA_FILE: z.string().optional(),

    REDIS_URL: z.string().min(1),
    REDIS_TLS: bool(false),
    REDIS_KEY_PREFIX: z.string().default('sunshop'),
    REDIS_CACHE_TTL: z.coerce.number().int().min(1).default(300),

    ELASTICSEARCH_ENABLED: bool(true),
    ELASTICSEARCH_NODE: z.string().default('http://localhost:9200'),
    ELASTICSEARCH_USERNAME: z.string().optional(),
    ELASTICSEARCH_PASSWORD: z.string().optional(),
    ELASTICSEARCH_INDEX_PREFIX: z.string().default('sunshop'),

    // ── Auth ────────────────────────────────────────────────────────────────
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    JWT_ISSUER: z.string().default('sunshop.api'),
    JWT_AUDIENCE: z.string().default('sunshop.clients'),
    FIELD_ENCRYPTION_KEY: z.string().optional(),
    COOKIE_DOMAIN: z.string().default('localhost'),
    COOKIE_SECURE: bool(false),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(50).default(8),
    LOGIN_LOCK_SECONDS: z.coerce.number().int().min(30).max(86_400).default(900),

    // ── Rate limiting ───────────────────────────────────────────────────────
    RATE_LIMIT_GLOBAL_POINTS: z.coerce.number().int().min(1).default(600),
    RATE_LIMIT_GLOBAL_DURATION: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_AUTH_POINTS: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_AUTH_DURATION: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_SEARCH_POINTS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_SEARCH_DURATION: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_WRITE_POINTS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_WRITE_DURATION: z.coerce.number().int().min(1).default(60),

    // ── Storage ─────────────────────────────────────────────────────────────
    STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
    AWS_REGION: z.string().default('eu-central-1'),
    S3_BUCKET: z.string().default('sunshop-media-dev'),
    S3_ENDPOINT: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool(false),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    CDN_BASE_URL: z.string().url().default('http://localhost:9000/sunshop-media-dev'),
    CLOUDFRONT_KEY_PAIR_ID: z.string().optional(),
    CLOUDFRONT_PRIVATE_KEY: z.string().optional(),
    UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

    // ── Mail ────────────────────────────────────────────────────────────────
    MAIL_DRIVER: z.enum(['smtp', 'ses', 'console']).default('console'),
    MAIL_FROM: z.string().default('Sunshop <no-reply@sunshop.example>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: port.optional(),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // ── Payments ────────────────────────────────────────────────────────────
    PAYMENTS_ENABLED: bool(true),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    DEFAULT_CURRENCY: z.enum(['USD', 'EUR', 'EGP', 'SAR', 'AED']).default('USD'),

    // ── Observability ───────────────────────────────────────────────────────
    OTEL_ENABLED: bool(false),
    OTEL_SERVICE_NAME: z.string().default('sunshop-api'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
    METRICS_ENABLED: bool(true),
    METRICS_TOKEN: z.string().optional(),
    SENTRY_DSN: z.string().optional(),

    // ── Feature flags ───────────────────────────────────────────────────────
    FEATURE_REVIEWS: bool(true),
    FEATURE_WISHLIST: bool(true),
    FEATURE_COUPONS: bool(true),
    SWAGGER_ENABLED: bool(true),

    /** Set by the Deployment so logs/metrics can be sliced per release. */
    APP_VERSION: z.string().default('dev'),
    /** Kubernetes pod name: included in every log line. */
    HOSTNAME: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;

    const requireProd = (key: keyof typeof value, message: string) => {
      if (!value[key]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key as string], message });
      }
    };

    if (value.PAYMENTS_ENABLED) {
      requireProd('STRIPE_SECRET_KEY', 'required when PAYMENTS_ENABLED in production');
      requireProd('STRIPE_WEBHOOK_SECRET', 'required when PAYMENTS_ENABLED in production');
    }
    if (value.MAIL_DRIVER === 'smtp') {
      requireProd('SMTP_HOST', 'required when MAIL_DRIVER=smtp');
    }
    if (!value.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'must be true in production, refresh cookies must never travel over plain HTTP',
      });
    }
    if (value.CORS_ORIGINS.some((origin) => origin === '*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'wildcard origin is not allowed in production (credentials are sent cross-origin)',
      });
    }
    if (!value.FIELD_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIELD_ENCRYPTION_KEY'],
        message: 'required in production, PII columns are encrypted at rest',
      });
    }
    for (const secret of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (value[secret].startsWith('dev-only')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [secret],
          message: 'development placeholder secret must not be used in production',
        });
      }
    }
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'access and refresh secrets must differ',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Deliberately console + exit: the logger itself depends on this config.
    console.error(`\n✖ Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
