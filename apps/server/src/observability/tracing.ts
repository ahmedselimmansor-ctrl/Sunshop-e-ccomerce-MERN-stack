/**
 * OpenTelemetry bootstrap.
 *
 * MUST be imported before anything that it instruments (express, mongoose,
 * ioredis, http). `src/index.ts` therefore awaits `startTracing()` as its very
 * first statement, before the app module is even imported.
 *
 * In AWS the OTLP endpoint is the ADOT collector sidecar, which fans traces out
 * to X-Ray and metrics to AMP.
 *
 * Two deliberate narrowings keep the runtime closure honest, because both the
 * convenience wrappers pull in far more than this service uses:
 *
 *  - Instrumentations are listed explicitly. `getNodeAutoInstrumentations()`
 *    wires up 47 of them plus 5 cloud resource detectors — Kafka, Cassandra,
 *    GraphQL, Postgres, Koa, Hapi, Lambda, Alibaba, Azure, GCP — none of which
 *    this service loads. Adding a new backing store means adding its
 *    instrumentation below, deliberately.
 *
 *  - `NodeTracerProvider`, not `NodeSDK`. We export traces over OTLP/HTTP and
 *    nothing else: metrics are served to Prometheus by `prom-client` (see
 *    ./metrics.ts) and logs go to stdout via pino. `NodeSDK` would drag in the
 *    metrics SDK, the logs SDK, and gRPC/protobuf/Zipkin exporters for all
 *    three signals, none of which is ever constructed.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { MongooseInstrumentation } from '@opentelemetry/instrumentation-mongoose';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { awsEcsDetector, awsEksDetector } from '@opentelemetry/resource-detector-aws';
import { containerDetector } from '@opentelemetry/resource-detector-container';
import { detectResources, resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { env } from '../config/env';

let provider: NodeTracerProvider | undefined;

/** Endpoints that would otherwise bury real traffic in health-check spans. */
const UNTRACED_PATHS = ['/healthz', '/readyz', '/metrics'];

export async function startTracing(): Promise<void> {
  if (!env.OTEL_ENABLED) return;

  // Only the detectors that can match: this runs on EKS, in a container. The
  // explicit attributes are merged last so they win over anything detected.
  const resource = detectResources({
    detectors: [containerDetector, awsEksDetector, awsEcsDetector],
  }).merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: env.APP_VERSION,
      'deployment.environment': env.NODE_ENV,
      'k8s.pod.name': env.HOSTNAME ?? 'local',
    }),
  );

  provider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, '')}/v1/traces`,
        }),
      ),
    ],
  });

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // Inbound requests, plus every outbound call that goes over node:http —
      // Stripe and Elasticsearch both ride on this.
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => {
          const url = request.url ?? '';
          return UNTRACED_PATHS.some((path) => url.startsWith(path));
        },
      }),
      // The HTTP hook above suppresses the *request* span for probe endpoints,
      // but express layer spans are created independently and would otherwise
      // still arrive — as parentless roots, which is worse than noise. Kubernetes
      // probes these every few seconds.
      new ExpressInstrumentation({
        ignoreLayers: [(name) => UNTRACED_PATHS.some((path) => name.includes(path))],
      }),
      // Mongoose gives model/method spans; the driver instrumentation underneath
      // gives the actual command and collection.
      new MongooseInstrumentation(),
      new MongoDBInstrumentation(),
      new IORedisInstrumentation(),
      // S3 and SES.
      new AwsInstrumentation(),
      // Anything using global fetch rather than node:http.
      new UndiciInstrumentation(),
      // Stamps trace_id/span_id onto log lines so logs and traces join up.
      new PinoInstrumentation(),
    ],
  });

  // Installs the provider and the W3C trace-context propagator globally.
  provider.register();
}

export async function stopTracing(): Promise<void> {
  if (!provider) return;
  await provider.shutdown().catch(() => undefined);
}
