/**
 * Process entry point.
 *
 * Tracing must be installed before any instrumented module is imported, so the
 * OTel bootstrap runs first and everything else is a dynamic import after it.
 */
import { startTracing, stopTracing } from './observability/tracing';

await startTracing();

const { createApp } = await import('./app');
const { env, isProduction } = await import('./config/env');
const { connectMongo, disconnectMongo } = await import('./db/mongoose');
const { connectRedis, disconnectRedis } = await import('./db/redis');
const { logger } = await import('./observability/logger');
const { beginShutdown } = await import('./modules/health/health.routes');
const { startScheduler, stopScheduler } = await import('./jobs/scheduler');
const { stopOutboxWorker } = await import('./jobs/outboxWorker');
const { closeSearch, pingSearch } = await import('./search/client');
const { ensureIndices } = await import('./search/productIndex');

async function bootstrap(): Promise<void> {
  logger.info(
    { version: env.APP_VERSION, node: process.version, env: env.NODE_ENV },
    'starting Sunshop API',
  );

  // MongoDB is required to serve anything; failing fast here means the pod
  // never passes readiness and the rollout stalls instead of half-working.
  await connectMongo();
  await connectRedis();

  if (env.ELASTICSEARCH_ENABLED) {
    // Search is optional: log and continue if the cluster is not there yet.
    const reachable = await pingSearch();
    if (reachable) {
      await ensureIndices().catch((error: Error) =>
        logger.error({ err: error.message }, 'failed to ensure search indices'),
      );
    } else {
      logger.warn('elasticsearch unreachable at boot; search will use the MongoDB fallback');
    }
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, prefix: env.API_PREFIX }, 'API listening');
  });

  /**
   * Keep-alive timeouts must exceed the load balancer's idle timeout, or the
   * ALB will occasionally reuse a connection Node has just closed and the
   * client sees a spurious 502. AWS ALB defaults to 60s.
   */
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 120_000;

  startScheduler();

  /**
   * Graceful shutdown.
   *
   * Order matters: stop reporting ready *first* so the LB drains this pod,
   * wait a moment for in-flight requests routed just before the drain, then
   * stop accepting, then close dependencies. Exiting immediately on SIGTERM
   * drops every request that was mid-flight during a rolling deploy.
   */
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'shutdown initiated');
    beginShutdown();
    stopScheduler();
    stopOutboxWorker();

    // Give the LB time to notice readiness has flipped (probe period + margin).
    const drainMs = isProduction ? 8000 : 0;
    await new Promise((resolve) => setTimeout(resolve, drainMs));

    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info('http server closed');

    await Promise.allSettled([disconnectMongo(), disconnectRedis(), closeSearch(), stopTracing()]);

    clearTimeout(forceExit);
    logger.info('shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  /**
   * An unhandled rejection leaves the process in an unknown state. Log it with
   * full context and exit so Kubernetes restarts a clean pod: limping on is
   * how one bad request becomes a slow corruption of everything after it.
   */
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error.message, stack: error.stack }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

bootstrap().catch((error: Error) => {
  // The logger may not exist yet if config validation failed.
  console.error('Fatal error during bootstrap:', error);
  process.exit(1);
});
