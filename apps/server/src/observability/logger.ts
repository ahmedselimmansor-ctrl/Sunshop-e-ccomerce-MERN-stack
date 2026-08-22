import pino, { type LoggerOptions } from 'pino';

import { env, isProduction, isTest } from '../config/env';

import { getContext } from './context';

/**
 * Structured logging.
 *
 * JSON in production because the logs land in CloudWatch and are queried with
 * Logs Insights: pretty-printed text is unqueryable. Human-readable locally,
 * because a developer reading `{"level":30,...}` is a developer who stops
 * reading logs.
 *
 * **Redaction is not optional.** Everything below is a field that has, in some
 * incident somewhere, ended up in a log aggregator that half the company can
 * read. The list is deliberately broad: the cost of redacting a harmless field
 * is nothing; the cost of leaking a card number is a compliance event.
 */
const REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'totpSecret',
  'totpCode',
  'secret',
  'clientSecret',
  'authorization',
  'cookie',
  'set-cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'body.password',
  'body.newPassword',
  'body.currentPassword',
  'body.token',
  'body.refreshToken',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.cardNumber',
  '*.cvv',
  '*.iban',
  'card',
  'cardNumber',
  'cvv',
];

const options: LoggerOptions = {
  level: isTest ? 'silent' : env.LOG_LEVEL,
  base: {
    service: env.OTEL_SERVICE_NAME,
    version: env.APP_VERSION,
    env: env.NODE_ENV,
    pod: env.HOSTNAME,
  },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    // CloudWatch/Loki expect a string level, not pino's numeric default.
    level: (label) => ({ level: label }),
  },
  /**
   * Every log line automatically carries the request id and user id from the
   * ambient context, so tracing one customer's failing checkout through the
   * logs is one query rather than a manual join.
   */
  mixin() {
    const context = getContext();
    if (!context) return {};
    return {
      requestId: context.requestId,
      ...(context.userId ? { userId: context.userId } : {}),
      ...(context.route ? { route: context.route } : {}),
    };
  },
  ...(isProduction || isTest
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,version,env',
          },
        },
      }),
};

export const logger = pino(options);

/** Child logger tagged with a module name, for grep-ability. */
export function moduleLogger(module: string) {
  return logger.child({ module });
}
