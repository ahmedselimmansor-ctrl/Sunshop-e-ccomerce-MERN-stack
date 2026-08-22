import client, { Counter, Gauge, Histogram, Registry } from 'prom-client';

import { env } from '../config/env';

/**
 * Prometheus metrics.
 *
 * Scraped by the AMP-managed collector in EKS. Two rules govern what is here:
 *
 *  1. **Bounded cardinality.** Never a label that can take unbounded values:
 *     no product ids, no user ids, no raw paths. A single unbounded label is
 *     enough to take down a Prometheus.
 *  2. **Metrics answer "is it healthy", logs answer "what happened".** RED
 *     (rate, errors, duration) for every dependency, plus the handful of
 *     business counters that make a revenue dip visible before support tickets
 *     do.
 */
export const registry = new Registry();

registry.setDefaultLabels({
  service: env.OTEL_SERVICE_NAME,
  version: env.APP_VERSION,
});

// Event loop lag, heap, GC, handles: the signals that explain a latency
// regression that has nothing to do with the database.
client.collectDefaultMetrics({ register: registry, prefix: 'sunshop_' });

// ── HTTP ────────────────────────────────────────────────────────────────────

export const httpRequestDuration = new Histogram({
  name: 'sunshop_http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'] as const,
  // Tuned for a web API: fine resolution under 1s, coarse above.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: 'sunshop_http_requests_total',
  help: 'HTTP requests by outcome',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpRequestsInFlight = new Gauge({
  name: 'sunshop_http_requests_in_flight',
  help: 'In-flight HTTP requests',
  labelNames: ['method'] as const,
  registers: [registry],
});

// ── Dependencies ────────────────────────────────────────────────────────────

export const dependencyUp = new Gauge({
  name: 'sunshop_dependency_up',
  help: '1 when a downstream dependency is reachable',
  labelNames: ['dependency'] as const,
  registers: [registry],
});

export const dbQueryDuration = new Histogram({
  name: 'sunshop_db_query_duration_seconds',
  help: 'MongoDB command latency',
  labelNames: ['collection', 'operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 3],
  registers: [registry],
});

export const searchQueryDuration = new Histogram({
  name: 'sunshop_search_query_duration_seconds',
  help: 'Elasticsearch query latency',
  labelNames: ['index', 'operation'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 3],
  registers: [registry],
});

export const cacheOperations = new Counter({
  name: 'sunshop_cache_operations_total',
  help: 'Redis cache operations by result',
  labelNames: ['operation', 'result'] as const,
  registers: [registry],
});

export const rateLimitRejections = new Counter({
  name: 'sunshop_rate_limit_rejections_total',
  help: 'Requests rejected by a rate limiter',
  labelNames: ['limiter'] as const,
  registers: [registry],
});

// ── Business ────────────────────────────────────────────────────────────────

export const businessEvents = new Counter({
  name: 'sunshop_business_events_total',
  help: 'Domain events by outcome (orders, logins, payments)',
  labelNames: ['event', 'outcome'] as const,
  registers: [registry],
});

export const orderValue = new Histogram({
  name: 'sunshop_order_value_minor_units',
  help: 'Distribution of order totals in currency minor units',
  labelNames: ['currency'] as const,
  buckets: [1000, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000],
  registers: [registry],
});

export const outboxBacklog = new Gauge({
  name: 'sunshop_outbox_backlog',
  help: 'Pending events waiting in the transactional outbox',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const jobRuns = new Counter({
  name: 'sunshop_job_runs_total',
  help: 'Scheduled job executions by outcome',
  labelNames: ['job', 'outcome'] as const,
  registers: [registry],
});

export const jobDuration = new Histogram({
  name: 'sunshop_job_duration_seconds',
  help: 'Scheduled job runtime',
  labelNames: ['job'] as const,
  buckets: [0.1, 0.5, 1, 5, 15, 60, 300],
  registers: [registry],
});

export async function collectMetrics(): Promise<string> {
  return registry.metrics();
}

export const metricsContentType = registry.contentType;
