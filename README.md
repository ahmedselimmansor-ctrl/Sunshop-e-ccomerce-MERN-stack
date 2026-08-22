# Sunshop

A production-shaped MERN e-commerce platform: bilingual storefront (Arabic / English),
staff dashboard, Android app, and the AWS infrastructure to run all three.

```
React + Vite storefront ─┐
React + Vite admin ──────┼──▶ Express + MongoDB API ──▶ DocumentDB · ElastiCache · Elasticsearch · S3/CloudFront
Kotlin (Compose) app ────┘                              running on EKS behind an ALB + WAF
```

---

## Quick start

Requires Node 20+, Docker, and about 4 GB of free RAM for the local data stores.

```bash
git clone <this-repo> && cd Sunshop-e-ccomerce-MERN-stack
cp .env.example .env
npm install
docker compose up -d              # MongoDB, Redis, Elasticsearch, MinIO, Mailpit
npm run build:shared              # everything imports the shared package's types
npm run seed -w @sunshop/server   # categories, products, staff accounts, coupons
npm run reindex -w @sunshop/server
npm run dev                       # API :4000 · storefront :5173 · admin :5174
```

If another project on your machine already holds a port, override it: every host
port in `docker-compose.yml` is parameterised:

```bash
REDIS_HOST_PORT=6380 SMTP_HOST_PORT=1026 docker compose up -d
```

Then point `REDIS_URL` / `SMTP_PORT` in `.env` at the ports you chose.

### Demo accounts

Seeded by `npm run seed`. Password for all of them: `Sunshop!2026`

| Account                 | Role              | What it can reach                               |
| ----------------------- | ----------------- | ----------------------------------------------- |
| `owner@sunshop.demo`    | `super_admin`     | Everything, including role assignment           |
| `admin@sunshop.demo`    | `admin`           | Orders, refunds, catalogue, settings, audit log |
| `catalog@sunshop.demo`  | `catalog_manager` | Products, categories, inventory, coupons        |
| `support@sunshop.demo`  | `support`         | Orders and customers, read-mostly               |
| `customer@sunshop.demo` | `customer`        | Storefront only                                 |

### Local URLs

| Service                | URL                          |
| ---------------------- | ---------------------------- |
| Storefront             | http://localhost:5173        |
| Admin dashboard        | http://localhost:5174        |
| API                    | http://localhost:4000/api/v1 |
| API docs (Swagger)     | http://localhost:4000/docs   |
| Mail inbox (Mailpit)   | http://localhost:8025        |
| Object storage (MinIO) | http://localhost:9001        |

---

## What's in the box

### Storefront: `apps/web`

React 18 + Vite + Tailwind + shadcn/ui. TanStack Query for server state, Zustand for
UI state, react-hook-form + zod for forms. Dark/light/system theming applied before
first paint. Full Arabic localization with RTL mirroring via CSS logical properties:
one stylesheet, both directions.

### Admin dashboard: `apps/admin`

Separate app, separate origin, indigo palette so staff can tell at a glance which
surface they're on. Permission-filtered navigation, revenue analytics with Recharts,
order fulfilment and refunds, role management with mandatory audit reasons, and a
read-only audit log viewer.

### API: `apps/server`

Express + Mongoose. The interesting parts:

- **Auth**: 15-minute access JWTs plus opaque, rotating refresh tokens with reuse
  detection. Presenting a spent refresh token revokes the whole session family.
- **Authorization**: two independent layers. Permissions answer "may this _kind_ of
  caller do this?"; ownership scopes answer "which _rows_?". A customer with
  `order:read:own` cannot read another customer's order by guessing its id.
- **Inventory**: reservations with atomic conditional updates, so two shoppers cannot
  both buy the last unit. Unpaid holds expire after 30 minutes.
- **Money**: integer minor units everywhere. Discounts are allocated across lines so
  the parts always reconcile to the whole.
- **Idempotency**: required on checkout and refunds; a retried request replays the
  original response instead of charging twice.
- **Transactional outbox**: search indexing and email are queued in the same database
  transaction as the state change, then drained by a worker.

### Mobile: `apps/mobile`

Kotlin + Jetpack Compose, Hilt, Retrofit, Room, DataStore. Material 3 with a dark
scheme that is designed rather than inverted, Arabic strings with all six plural
categories, and tokens in `EncryptedSharedPreferences` backed by the Android Keystore.

### Infrastructure: `infra/`

Terraform for VPC (public / private / isolated tiers), EKS with IRSA, DocumentDB,
ElastiCache, S3 + CloudFront, Secrets Manager, KMS and WAF. Kubernetes manifests with
HPA, PDB, network policies and external secrets. Multi-stage Dockerfiles producing
non-root, read-only-rootfs images.

---

## Commands

```bash
npm run dev                  # all three apps with hot reload
npm run build                # build everything
npm run typecheck            # tsc across all workspaces
npm run lint                 # eslint
npm run test                 # vitest
npm run seed                 # reset and reseed the local database
npm run reindex -w @sunshop/server   # rebuild the Elasticsearch index
npm run infra:up             # data services only
npm run stack:up             # everything in containers, including the apps
```

---

## Documentation

| Document                                       | Covers                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)           | Request flow, data model, caching, search, the decisions and their trade-offs             |
| [Security](docs/security.md)                   | Threat model, auth design, data access control, secrets, what is deliberately _not_ done  |
| [Operations](docs/operations.md)               | Deploying, scaling, monitoring, and the runbooks for the incidents you will actually have |
| [Disaster recovery](docs/disaster-recovery.md) | RPO/RTO targets, backup layout, restore procedures                                        |

---

## A note on scope

This is a reference implementation, not a turnkey store. Everything described above is
implemented and runs, but before taking real payments you would still need: a Stripe
account with live keys and a verified webhook endpoint, SES out of the sandbox, a real
domain with ACM certificates, a load test against your own traffic shape, and a
security review of the checkout flow against your own risk tolerance.

The `docs/` directory is explicit about what is production-grade, what is a reasonable
default you should tune, and what is a placeholder.
