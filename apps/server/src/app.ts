import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';

import { env, isProduction } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { resolveLocale } from './middleware/locale';
import { maintenanceGuard } from './middleware/maintenance';
import { globalRateLimit } from './middleware/rateLimit';
import { requestContext } from './middleware/requestContext';
import {
  corsMiddleware,
  limitQueryComplexity,
  requireJsonContentType,
  sanitizeInput,
  securityHeaders,
} from './middleware/security';
import { healthRoutes } from './modules/health/health.routes';
import { paymentRoutes } from './modules/payments/payment.routes';
import { apiRoutes } from './routes';

/**
 * Express application.
 *
 * Middleware order is load-bearing and worth reading top to bottom: several
 * of these are wrong if moved:
 *  • `requestContext` first, so even a body-parser rejection is logged with a
 *    correlation id.
 *  • The Stripe webhook mounts its raw-body parser *before* `express.json`,
 *    because signature verification needs the exact bytes Stripe signed.
 *  • Rate limiting sits after CORS so that a preflight is never charged, and
 *    before routing so a flood never reaches a database.
 */
export function createApp(): Express {
  const app = express();

  /**
   * Behind an ALB and an ingress controller, `req.ip` is only trustworthy if
   * Express is told exactly how many proxies to trust. Setting `true` here
   * would let any client spoof `X-Forwarded-For` and defeat IP rate limiting.
   */
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.set('etag', 'weak');
  // Route matching should not depend on a trailing slash.
  app.set('strict routing', false);

  app.use(requestContext);
  app.use(securityHeaders);
  app.use(corsMiddleware());
  app.use(
    compression({
      threshold: 1024,
      // Let a client opt out: useful when debugging with curl.
      filter: (req, res) => (req.get('x-no-compression') ? false : compression.filter(req, res)),
    }),
  );
  app.use(cookieParser());

  // Ops endpoints live outside the API prefix and outside rate limiting, so a
  // flood cannot make Kubernetes think the pod is unhealthy and restart it.
  app.use('/', healthRoutes);

  /**
   * Stripe webhook: raw body, mounted before the JSON parser.
   * Also excluded from the global rate limiter: Stripe bursts retries, and
   * throttling a payment webhook means orders that were paid never leave
   * `pending_payment`.
   */
  app.use(
    `${env.API_PREFIX}/payments/webhook`,
    express.raw({ type: 'application/json', limit: '1mb' }),
    paymentRoutes,
  );

  app.use(express.json({ limit: env.BODY_LIMIT, strict: true }));
  app.use(express.urlencoded({ extended: false, limit: env.BODY_LIMIT }));

  app.use(requireJsonContentType);
  app.use(sanitizeInput);
  app.use(limitQueryComplexity());
  app.use(resolveLocale);
  app.use(globalRateLimit);
  app.use(maintenanceGuard);

  app.use(env.API_PREFIX, apiRoutes);

  // Interactive docs. Disabled by default in production.
  if (env.SWAGGER_ENABLED && !isProduction) {
    void mountSwagger(app);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function mountSwagger(app: Express): Promise<void> {
  const [{ default: swaggerUi }, { buildOpenApiDocument }, { swaggerSecurityHeaders }] =
    await Promise.all([
      import('swagger-ui-express'),
      import('./docs/openapi'),
      import('./middleware/security'),
    ]);

  const document = buildOpenApiDocument();

  app.use(
    '/docs',
    swaggerSecurityHeaders,
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'Sunshop API',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    }),
  );

  app.get('/openapi.json', (_req, res) => res.json(document));
}
