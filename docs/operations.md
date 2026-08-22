# Operations

## Deploying

CI builds and pushes multi-arch images to ECR on every push to `main`, then rolls out
to staging automatically. Production requires a manual approval on the GitHub
environment.

```bash
# Manual rollout
kustomize build infra/k8s/overlays/production | kubectl apply -f -
kubectl -n sunshop rollout status deployment/sunshop-api --timeout=5m
```

The rollout is `maxUnavailable: 0, maxSurge: 1`, capacity never dips below the current
replica count during a deploy.

### Rolling back

```bash
kubectl -n sunshop rollout undo deployment/sunshop-api
kubectl -n sunshop rollout history deployment/sunshop-api
```

The deploy workflow does this automatically if `rollout status` times out. A rollback
is safe for application code; it is **not** safe if the release included a
backwards-incompatible data migration, which is why migrations must be additive and
deployed one release ahead of the code that requires them.

### Graceful shutdown

On SIGTERM the API stops reporting ready, waits 8 seconds for the ALB to drain it,
stops accepting connections, finishes in-flight requests, then closes its database and
Redis connections. `terminationGracePeriodSeconds: 45` gives that room. Exiting
immediately would drop every request that was mid-flight during a rolling deploy.

---

## Observability

### Metrics

Prometheus at `/metrics`, token-gated. The signals worth alerting on:

| Metric                                                | Meaning                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `sunshop_http_request_duration_seconds`               | p50/p95/p99 latency by route                             |
| `sunshop_http_requests_total{status=~"5.."}`          | Error rate                                               |
| `sunshop_dependency_up`                               | MongoDB / Redis / Elasticsearch reachability             |
| `sunshop_outbox_backlog{status="pending"}`            | Unprocessed events: the best early warning in the system |
| `sunshop_business_events_total{event="order_placed"}` | Orders per minute                                        |
| `sunshop_rate_limit_rejections_total`                 | Rejected requests by limiter                             |
| `sunshop_cache_operations_total{result="hit"}`        | Cache hit ratio                                          |

Cardinality is deliberately bounded: route labels are normalised (`/products/:id`, not
the raw path), and no metric carries a user or product id. A single unbounded label is
enough to take down a Prometheus.

### Logs

Structured JSON to stdout, collected by Fluent Bit into CloudWatch. Every line carries
the correlation id and, when authenticated, the user id: so tracing one customer's
failing checkout is a single Logs Insights query rather than a manual join:

```
fields @timestamp, level, msg, route, status, durationMs
| filter requestId = "abc-123"
| sort @timestamp asc
```

### Traces

OpenTelemetry to the ADOT collector, which fans out to X-Ray. Auto-instrumentation
covers Express, MongoDB, Redis and outbound HTTP. Health and metrics endpoints are
excluded: they would otherwise be 90% of the trace volume.

### Alerts worth having

| Alert               | Condition                              | Why                                              |
| ------------------- | -------------------------------------- | ------------------------------------------------ |
| API error rate      | 5xx > 1% for 5 min                     | Something is broken now                          |
| API latency         | p99 > 2s for 10 min                    | Degrading before it breaks                       |
| Dependency down     | `dependency_up == 0` for 2 min         | Readiness will follow                            |
| Outbox backlog      | pending > 500 for 10 min               | Search and email are silently stale              |
| Outbox dead letters | `status="dead"` > 0                    | Events are being dropped                         |
| Order rate collapse | orders/hour < 20% of the 7-day average | Checkout may be broken in a way that returns 200 |
| Payment failures    | failure ratio > 10% for 15 min         | Provider or configuration problem                |
| Low stock           | any variant at 0 with recent sales     | Merchandising, not engineering                   |

The order-rate alert is the one that catches the failures monitoring misses: a
checkout that returns 200 and quietly does nothing looks perfectly healthy on every
technical dashboard.

---

## Scaling

### Autoscaling

The HPA runs 3-30 pods on CPU (65%), memory (75%) and requests-per-pod (80). It scales
up fast and down slowly, because thrashing costs more than a few idle pods.

The cluster autoscaler adds nodes when pods are unschedulable. Batch work (reindex
jobs) is tainted onto a Spot node group that scales from zero.

### Capacity notes

- **DocumentDB connections** are limited per instance class. `maxPoolSize × replicas`
  must stay under that limit: at 30 pods and a pool of 20 that is 600 connections, so
  check the class before raising `maxReplicas`.
- **The NAT gateway** is a per-AZ bandwidth ceiling and a real cost line. S3 traffic
  already bypasses it through a gateway endpoint.
- **Elasticsearch** is sized for the catalogue, not for traffic. Query load is absorbed
  by the 60-second search cache.

### Load-testing before a sale

```bash
k6 run --vus 500 --duration 10m infra/load/checkout.js
```

Watch p99 latency, the cache hit ratio, and `sunshop_outbox_backlog`. A growing backlog
under load means the outbox worker is the bottleneck before the API is.

---

## Runbooks

### Orders stuck in `pending_payment`

**Symptom:** paid orders never advance; customers have been charged.

Almost always the Stripe webhook. The browser's success callback does not mark an order
paid: only the signed webhook does, deliberately, because a client can close the tab
or lie.

```bash
# Is the endpoint receiving anything?
kubectl -n sunshop logs -l app.kubernetes.io/name=sunshop-api --since=1h | grep webhook

# Is the signature verifying? A rotated STRIPE_WEBHOOK_SECRET fails every event.
kubectl -n sunshop get secret sunshop-api-secrets -o jsonpath='{.data.STRIPE_WEBHOOK_SECRET}' | base64 -d | head -c 8
```

Replay from the Stripe dashboard once fixed. `markPaid` is idempotent, so replaying
already-processed events is safe.

Meanwhile the reservation sweeper will cancel unpaid orders after 30 minutes and
release their inventory: which is correct behaviour but will look like mass
cancellations. Consider raising `RESERVATION_MINUTES` while the webhook is broken.

### Search returning nothing or stale results

Check whether the API has already degraded:

```bash
curl -sI https://api.sunshop.example/api/v1/search?q=shirt | grep -i x-search-degraded
```

`true` means Elasticsearch is unreachable and MongoDB is serving the query. The
storefront still sells; fix the cluster, no emergency.

If the cluster is healthy but results are stale, the outbox is behind:

```bash
kubectl -n sunshop exec deploy/sunshop-api -- \
  node -e "process.env.SKIP_DOTENV='true';import('./dist/index.js')" # inspect via metrics instead
# Preferred: check the gauge
curl -s -H "Authorization: Bearer $METRICS_TOKEN" https://api.sunshop.example/metrics | grep outbox_backlog
```

Full repair:

```bash
kubectl -n sunshop create job --from=cronjob/sunshop-reindex-nightly reindex-manual
kubectl -n sunshop logs -f job/reindex-manual
```

Safe in production: it builds a new index and swaps the alias only on success.

### Inventory looks wrong

`available = stock - reserved`. Stock that appears missing is usually held by
reservations from abandoned checkouts, which the sweeper releases after 30 minutes.

```js
// mongosh
db.products.aggregate([
  { $unwind: '$variants' },
  { $match: { 'variants.reserved': { $gt: 0 } } },
  { $project: { sku: '$variants.sku', stock: '$variants.stock', reserved: '$variants.reserved' } },
]);

// Orders holding those reservations
db.orders.find({ status: 'pending_payment', inventoryReleased: false }).count();
```

The `inventorylogs` collection is the ledger: the current count is derived, the
movements are the facts. Any discrepancy is reconciled from there, never by guessing.

### Redis is down

Expected behaviour: the site keeps working, slower. Caching fails open, rate limiting
fails open (WAF is the backstop), sessions are unavailable so _logged-in_ users cannot
authenticate: anonymous browsing and guest checkout continue.

Readiness fails while Redis is unreachable, so pods leave the load balancer. That is
intentional for a sustained outage but means a brief blip removes capacity. If it is
flapping, check the ElastiCache CloudWatch metrics for a failover before restarting
anything.

### High latency, no errors

Work through it in this order: it is roughly cheapest-to-check first:

1. Cache hit ratio. A recent deploy that changed a cache key shape drops it to zero.
2. `sunshop_db_query_duration_seconds` by collection. A missing index after a schema
   change is the usual culprit; DocumentDB's profiler logs anything over 100ms.
3. Event loop lag (`nodejs_eventloop_lag_seconds`). Sustained lag means CPU-bound work
   on the main thread.
4. Pod count against the HPA maximum. If it is pinned at max, the ceiling is the
   problem, not the code.

### Rotating a secret

```bash
aws secretsmanager put-secret-value \
  --secret-id sunshop/production/jwt \
  --secret-string '{"accessSecret":"...","refreshSecret":"..."}'

# ESO syncs within 15 minutes; force it sooner:
kubectl -n sunshop annotate externalsecret sunshop-api-secrets force-sync=$(date +%s) --overwrite
kubectl -n sunshop rollout restart deployment/sunshop-api
```

Rotating the **JWT secrets signs every user out**: access tokens fail verification
immediately. Do it during a low-traffic window unless responding to a compromise, in
which case do it now.

### Maintenance mode

```bash
# From the admin dashboard: Settings → Maintenance mode
# Or directly, which takes effect across every pod within a second:
kubectl -n sunshop exec deploy/sunshop-api -- redis-cli -u "$REDIS_URL" SET sunshop:flags:maintenance 1
```

Staff sessions and health probes are exempt: otherwise enabling it would fail
readiness and evict the very pods serving the maintenance page.
