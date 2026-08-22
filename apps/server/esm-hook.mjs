/**
 * OpenTelemetry's ESM loader hook.
 *
 * This has to be a separate file loaded via `node --import`, because a module
 * hook must be registered before the modules it rewrites are evaluated — by the
 * time any application code runs, `import express from 'express'` has already
 * been resolved and no amount of patching afterwards will catch it.
 *
 * Without this, instrumentation silently half-works: OpenTelemetry's default
 * mechanism is require-in-the-middle, which only sees CommonJS `require()`
 * calls. This service is ESM (`"type": "module"`, and tsup emits ESM), so the
 * only libraries that got patched were the ones loaded *indirectly* by a CJS
 * package — the mongodb driver via mongoose, for instance — while express,
 * mongoose and ioredis produced no spans at all. That failure is invisible:
 * traces still arrive, just missing most of their spans.
 *
 * Registration is gated on OTEL_ENABLED so a deployment with tracing off does
 * not pay for module-graph rewriting.
 */
import { register } from 'node:module';

if (process.env.OTEL_ENABLED === 'true') {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
}
