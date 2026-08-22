# Architecture

## Shape

```
                    ┌──────────── CloudFront ────────────┐
                    │  static assets + product media     │
                    └────────────────┬───────────────────┘
                                     │
  browsers / app ──▶ AWS WAF ──▶ ALB ─┴─▶ EKS ┬─▶ sunshop-web    (nginx, static)
                                              ├─▶ sunshop-admin  (nginx, static)
                                              └─▶ sunshop-api    (Node, 3-30 pods)
                                                        │
                          ┌─────────────────────────────┼───────────────────────┐
                          ▼                             ▼                       ▼
                    DocumentDB                     ElastiCache            Elasticsearch
                 (source of truth)            (cache, sessions,          (search, facets)
                                               rate limits)
```

Three tiers of subnet. The data stores sit in **isolated** subnets with no route to a
NAT gateway at all: a compromised pod cannot exfiltrate a database dump to the
internet, because the subnet has nowhere to send it.

---

## The monorepo

```
packages/shared     zod schemas, RBAC matrix, money helpers: imported by all three JS surfaces
apps/server         Express API
apps/web            storefront
apps/admin          dashboard
apps/mobile         Kotlin/Compose Android app
infra/              Docker, Kubernetes, Terraform
```

`@sunshop/shared` is the reason the clients and the server cannot drift. The web app
validates a checkout form with `checkoutSchema`; the API validates the request with the
_same_ `checkoutSchema`. Adding a required field is one edit, and every consumer fails
to compile until it is handled.

The Kotlin app mirrors these types by hand in `data/remote/Dto.kt`. That is a
deliberate duplication: generating Kotlin from zod would add a codegen step to every
build for a surface that changes rarely: and the DTOs are kept deliberately separate
from the domain models so a wire change does not ripple into every screen.

---

## Request flow

A product page request, end to end:

1. **CloudFront** serves the SPA shell and its hashed assets from the edge. The shell
   is never cached; the assets are immutable for a year.
2. **WAF** applies managed rule sets and a volumetric rate limit before the request
   costs a pod anything.
3. **ALB** terminates TLS and routes by hostname to the right service.
4. **API middleware**, in a load-bearing order:
   `requestContext` (correlation id, metrics, async-local storage) → security headers →
   CORS → body parsing → operator-injection sanitisation → locale resolution → rate
   limiting → maintenance gate → routing.
5. **Handler** validates with zod into `req.validated`, never reading `req.body`
   directly.
6. **Service** composes a query through an ownership scope, reads through the cache,
   and returns a DTO.

The Stripe webhook is mounted _before_ the JSON body parser, because signature
verification needs the exact bytes Stripe signed.

---

## Data model

MongoDB, with denormalization where it buys something specific.

**Products** hold their variants as subdocuments. A variant is never queried without
its product, and embedding avoids a join on the hottest read path in the system. The
denormalized `priceMin`, `priceMax`, `totalStock` and `ratingAverage` exist because
sorting a catalogue by price or rating cannot afford a per-product aggregation.

**Categories** use a materialized path (`/rootId/parentId`). "This category and every
descendant": the single most common catalogue query: becomes one indexed prefix
match instead of a recursive `$graphLookup`. The cost is that re-parenting rewrites a
subtree, which is rare and done in a transaction.

**Orders** snapshot everything. Line items copy the product name, image and price at
purchase time. If a merchant renames a product next month, last month's invoice must
still read exactly as the customer saw it; a join to the live catalogue would silently
rewrite history.

**Carts** live in MongoDB, not Redis. A cart is a business record: abandoned-cart
recovery, support lookups, analytics: and must survive an ElastiCache failover. Guest
carts expire through a TTL index so crawler traffic cannot grow the collection without
bound.

### Money

Every amount in the system is an integer count of currency minor units plus a currency
code. `1999` means $19.99. Floating-point money is a rounding bug waiting for an
invoice; `0.1 + 0.2 !== 0.3` is not an acceptable property for a payment system.

Order-level discounts are split across lines with a largest-remainder allocation, so
the sum of the line discounts equals the order discount _exactly_. Without that, a
partial refund computed from line totals drifts from the amount actually charged.

---

## Caching

Redis, cache-aside, with three properties that matter:

**Tag-based invalidation.** Invalidating "everything derived from product X" with
`KEYS` or `SCAN` is O(keyspace) and blocks Redis. Instead each cached entry registers
itself in tag sets, and invalidation deletes the members of a set in one pipeline.

**Stampede protection.** On a miss, exactly one caller takes a short lock and computes;
the rest poll briefly and read the result. Without it, a popular key expiring during a
traffic spike sends every pod's every request to MongoDB simultaneously.

**Fail open.** Every cache error is swallowed and the origin function runs. Redis being
down degrades latency, never correctness.

Cache invalidation is wired into the _write_ paths that change what customers see:
including inventory reservations, not just sales. `available = stock - reserved`, so a
reservation changes the storefront just as much as a purchase does; skipping it is how
a cached product page keeps offering the last unit someone else is checking out with.

---

## Search

Elasticsearch 8, with a MongoDB text-search fallback.

### Why Elasticsearch and not Amazon OpenSearch

Amazon's managed offering forked from Elasticsearch 7.10, and the official Elastic v8
client deliberately refuses to talk to it: it checks for an `X-Elastic-Product`
response header that OpenSearch does not send. There is no compatibility flag that
fixes this.

So Sunshop picks one and is honest about it: **Elasticsearch**, run on EKS via the ECK
operator in production and as a container locally. The Terraform includes an
`aws_opensearch_domain` behind `enable_managed_opensearch = false` for teams that
prefer the managed service: but switching to it means swapping
`@elastic/elasticsearch` for `@opensearch-project/opensearch`, whose request shape
differs (`body`-wrapped). That is a real migration, not a config change.

### Bilingual analysis

Arabic needs more than a stemmer:

- `arabic_normalization` folds أ/إ/آ → ا and ة → ه, so "احمد" matches "أحمد". Without
  it, a large fraction of Arabic queries silently miss.
- `decimal_digit` maps Eastern Arabic numerals (٠١٢) to Latin, so "٤٢" and "42" find
  the same size.
- Tashkeel and tatweel are stripped, so a diacritized catalogue still matches
  undiacritized queries.

Each language is indexed into its own analyzed subfield, so a query is processed with
the right pipeline rather than a lowest-common-denominator one.

### Degradation

Search is a _degradable_ dependency. If the cluster is unavailable the same query is
answered from MongoDB with reduced relevance and no facets, and the response carries
`X-Search-Degraded: true` so the UI hides the facet rail instead of rendering an empty
one. A storefront that sells with worse ranking beats one that 503s.

### Zero-downtime reindexing

Reindexing writes into a fresh versioned index and swaps an alias atomically. Search
keeps answering from the old index throughout: a reindex of a large catalogue takes
minutes, and a blank search for that long is a revenue event.

---

## Consistency

Checkout is the only genuinely hard consistency problem here, and it is handled with
three mechanisms rather than one:

**Transactions** for the atomic part: reserve inventory, create the order, redeem the
coupon, mark the cart converted. Either all of it happens or none of it does.

**Conditional atomic updates** for the contended part. Inventory is claimed with an
`$expr` guard that checks availability _inside_ the same operation that increments the
counter: there is no read-then-write window for a race to slip through.

**A transactional outbox** for the parts that must not be inside the transaction.
Search indexing and email are queued in the same transaction as the state change and
drained afterwards by a worker. A slow Elasticsearch cluster would otherwise hold
MongoDB locks, and a failed index write would roll back a perfectly good order.

Consumers must be idempotent, because the outbox gives at-least-once delivery. Indexing
the same product twice is harmless; sending the same email twice is not, so mail
handlers check a dedupe key.

---

## Scaling

**Stateless API.** Sessions live in Redis, not in process memory, so any pod can serve
any request and the HPA can add or remove pods freely.

**HPA on three signals.** CPU and memory, plus requests-per-pod from Prometheus. CPU
alone reacts late for an I/O-bound API that spends most of its time waiting on
MongoDB rather than burning cycles.

**Asymmetric scaling behaviour.** Scale up fast (30-second stabilisation, up to
doubling) because a flash sale does not wait; scale down slowly (5-minute window, one
pod at a time) because thrashing costs more than a few idle pods.

**Read scaling through cache, not replicas.** The MongoDB read preference is `primary`,
deliberately. Commerce reads are overwhelmingly read-your-own-write: a cart that shows
stale contents right after an add is a bug report, not a saving: and MongoDB rejects
non-primary reads inside a transaction, so a connection-wide `primaryPreferred` breaks
every transactional path. The few genuinely stale-tolerant queries opt in per query.

---

## Deliberate omissions

Things a real deployment needs that are scaffolded rather than finished:

- **Payment methods beyond cards and COD.** The `PaymentMethod` enum and the order
  state machine accommodate more, but only Stripe is wired.
- **Multi-currency pricing.** Products carry a currency and the money helpers are
  currency-aware, but there is no FX table: a product is priced in one currency.
- **Multi-warehouse inventory.** Stock is a single number per variant.
- **Return merchandise authorisation.** Refunds exist; a full returns workflow with
  labels and inspection does not.
