# Sunshop

A production-shaped e-commerce platform built as a TypeScript monorepo: a REST API, a bilingual storefront, a staff admin console, a native Android client, and the Terraform and Kubernetes needed to run it on AWS.

Everything is bilingual English/Arabic with full RTL support, and prices are handled as integer minor units end to end.

| Workspace         | Stack                                       | What it is                                                |
| ----------------- | ------------------------------------------- | --------------------------------------------------------- |
| `apps/server`     | Express 4, Mongoose 8, Redis, Elasticsearch | REST API, background jobs, OpenAPI spec                   |
| `apps/web`        | React 18, Vite, TanStack Query, Tailwind    | Customer storefront                                       |
| `apps/admin`      | React 18, Vite, Recharts, Tailwind          | Staff console                                             |
| `apps/mobile`     | Kotlin, Jetpack Compose, Hilt, Retrofit     | Native Android client                                     |
| `packages/shared` | Zod, TypeScript                             | Schemas, domain rules and types shared by every workspace |
| `infra`           | Terraform, Kustomize, Docker                | AWS infrastructure and deployment manifests               |

---

## Contents

- [System architecture](#system-architecture)
- [Local development topology](#local-development-topology)
- [Repository layout](#repository-layout)
- [Database design](#database-design)
- [Order lifecycle](#order-lifecycle)
- [Request lifecycle](#request-lifecycle)
- [Checkout and the outbox](#checkout-and-the-outbox)
- [Authentication](#authentication)
- [Search indexing](#search-indexing)
- [Getting started](#getting-started)
- [Testing and CI](#testing-and-ci)

---

## System architecture

Production runs on EKS behind CloudFront. The API is stateless; every piece of state lives in DocumentDB, ElastiCache, OpenSearch or S3, so pods can be replaced at will.

```mermaid
flowchart TB
    subgraph clients [Clients]
        WEB[Web storefront<br/>React SPA]
        ADM[Admin console<br/>React SPA]
        AND[Android app<br/>Compose]
    end

    subgraph edge [Edge]
        CF[CloudFront<br/>CDN + TLS]
        WAF[AWS WAF<br/>managed rules + rate limits]
    end

    subgraph aws [AWS VPC]
        ALB[Application Load Balancer]

        subgraph eks [EKS cluster]
            API[API pods<br/>Express, autoscaled]
            JOBS[Scheduler + outbox worker<br/>in-process, Redis-locked]
        end

        subgraph data [Managed data stores]
            DOC[(DocumentDB<br/>catalogue, orders, users)]
            RDS[(ElastiCache Redis<br/>sessions, carts, rate limits)]
            OS[(OpenSearch<br/>product search + facets)]
            S3[(S3<br/>product media)]
        end

        SM[Secrets Manager]
        OTEL[ADOT collector<br/>sidecar]
    end

    subgraph external [Third parties]
        STRIPE[Stripe]
        SES[Amazon SES]
    end

    WEB --> CF
    ADM --> CF
    AND --> CF
    CF --> WAF --> ALB --> API
    CF -.static assets.-> S3

    API --> DOC
    API --> RDS
    API --> OS
    API --> S3
    API --> STRIPE
    API --> SES
    JOBS --> DOC
    JOBS --> OS
    JOBS --> RDS

    SM -.External Secrets Operator.-> API
    API -.OTLP traces.-> OTEL
    STRIPE -.webhooks.-> ALB
```

**Why these pieces**

- **Stateless API.** Sessions live in Redis and refresh tokens in the database, so no pod holds anything worth preserving.
- **Search is a projection, not the source of truth.** MongoDB owns product data; OpenSearch is rebuilt from it and may be dropped at any time.
- **Secrets never sit in manifests.** The External Secrets Operator pulls from Secrets Manager into Kubernetes at runtime.
- **Two proxy hops.** ALB then ingress, so Express is configured to trust exactly two. Trusting all of them would let a client spoof `X-Forwarded-For` past rate limiting.

---

## Local development topology

`docker compose up -d` starts the backing services; `npm run dev` runs the three JS apps with hot reload against them.

```mermaid
flowchart LR
    subgraph host [Host machine]
        direction TB
        V1[web :5173<br/>Vite]
        V2[admin :5174<br/>Vite]
        SRV[api :4000<br/>tsx watch]
    end

    subgraph compose [docker compose]
        direction TB
        MG[(mongo :27017<br/>replica set rs0)]
        RD[(redis :6379)]
        ES[(elasticsearch :9200)]
        MO[(minio :9000<br/>S3-compatible)]
        MH[mailhog :8025<br/>SMTP sink]
    end

    V1 -->|/api proxy| SRV
    V2 -->|/api proxy| SRV
    SRV --> MG
    SRV --> RD
    SRV --> ES
    SRV --> MO
    SRV --> MH
```

Mongo runs as a **single-node replica set** rather than a standalone, because checkout and inventory reservation use transactions. Developing without them would hide a whole class of bug until production.

Vite proxies `/api` to the API so the browser sees one origin and cookies work without relaxing `SameSite`.

---

## Repository layout

```mermaid
flowchart TD
    ROOT["sunshop/"]

    ROOT --> APPS["apps/"]
    ROOT --> PKG["packages/shared<br/>Zod schemas, domain rules, types"]
    ROOT --> INF["infra/"]
    ROOT --> DOC["docs/"]

    APPS --> SRV["server<br/>Express API"]
    APPS --> WEB["web<br/>storefront"]
    APPS --> ADM["admin<br/>console"]
    APPS --> MOB["mobile<br/>Android"]

    INF --> TF["terraform<br/>VPC, EKS, DocumentDB,<br/>OpenSearch, CloudFront, WAF"]
    INF --> K8S["k8s<br/>base + staging/production overlays"]
    INF --> DKR["docker<br/>image definitions"]

    PKG -.imported by.-> SRV
    PKG -.imported by.-> WEB
    PKG -.imported by.-> ADM

    style PKG fill:#f59e0b,stroke:#b45309,color:#1c1207
```

`packages/shared` is the reason the stack holds together: one Zod schema defines a product, and the API validates against it while both front ends infer their types from it. A field renamed in one place fails to compile in the others.

---

## Database design

MongoDB, accessed through Mongoose. Money is stored everywhere as `{ amount: Int, currency: String }` in **minor units**, never a float.

```mermaid
erDiagram
    USER ||--o{ ORDER : places
    USER ||--o{ REVIEW : writes
    USER ||--o{ WISHLIST_ITEM : saves
    USER ||--o| CART : owns
    USER ||--o{ ADDRESS : "has (embedded)"
    USER ||--o{ REFRESH_TOKEN : "has (embedded)"

    CATEGORY ||--o{ CATEGORY : "parent of"
    CATEGORY }o--o{ PRODUCT : categorises

    PRODUCT ||--|{ VARIANT : "has (embedded)"
    PRODUCT ||--o{ REVIEW : receives
    PRODUCT ||--o{ WISHLIST_ITEM : "appears in"
    PRODUCT ||--o{ CART_ITEM : "added as"
    PRODUCT ||--o{ ORDER_ITEM : "purchased as"
    PRODUCT ||--o{ INVENTORY_LOG : "stock moves"

    CART ||--o{ CART_ITEM : contains
    ORDER ||--|{ ORDER_ITEM : contains
    ORDER ||--o{ INVENTORY_LOG : "reserves / releases"
    ORDER ||--o{ REVIEW : "verifies purchase"
    COUPON ||--o{ ORDER : discounts

    USER {
        ObjectId _id
        string email UK
        string passwordHash
        string firstName
        string lastName
        string[] roles
        object twoFactor
        Address[] addresses
        RefreshToken[] refreshTokens
        boolean isSuspended
    }

    PRODUCT {
        ObjectId _id
        Localized name
        string slug UK
        Localized description
        string brand
        ObjectId[] categories FK
        string[] tags
        Image[] images
        Option[] options
        Variant[] variants
        string status
        boolean isFeatured
        object rating
    }

    VARIANT {
        ObjectId _id
        string sku UK
        object optionValues
        Money price
        Money compareAtPrice
        int stock
        int reserved
        int lowStockThreshold
        string stockPolicy
        boolean isActive
    }

    CATEGORY {
        ObjectId _id
        Localized name
        string slug UK
        ObjectId parent FK
        string path
        int depth
        int position
        boolean isActive
    }

    CART {
        ObjectId _id
        ObjectId user FK
        string guestToken
        string currency
        CartItem[] items
        string couponCode
        date lastActivityAt
    }

    CART_ITEM {
        ObjectId product FK
        ObjectId variantId
        string sku
        int quantity
        Money unitPrice
        date addedAt
    }

    ORDER {
        ObjectId _id
        string orderNumber UK
        ObjectId user FK
        string status
        string paymentStatus
        string fulfillmentStatus
        OrderItem[] items
        Address shippingAddress
        Address billingAddress
        Money subtotal
        Money discount
        Money shipping
        Money tax
        Money total
        string couponCode
        Shipment[] shipments
        date placedAt
    }

    ORDER_ITEM {
        ObjectId product FK
        ObjectId variantId
        string sku
        Localized name
        int quantity
        Money unitPrice
        Money lineTotal
    }

    REVIEW {
        ObjectId _id
        ObjectId product FK
        ObjectId user FK
        ObjectId order FK
        int rating
        string title
        string body
        string status
        boolean isVerifiedPurchase
        int helpfulCount
    }

    COUPON {
        ObjectId _id
        string code UK
        string type
        int percentage
        Money amount
        Money minSubtotal
        ObjectId[] appliesToProducts
        ObjectId[] appliesToCategories
        int usageLimit
        date expiresAt
    }

    WISHLIST_ITEM {
        ObjectId _id
        ObjectId user FK
        ObjectId product FK
        date createdAt
    }

    INVENTORY_LOG {
        ObjectId _id
        ObjectId product FK
        ObjectId variantId
        ObjectId order FK
        ObjectId actor FK
        string reason
        int delta
        int resulting
    }

    OUTBOX_EVENT {
        ObjectId _id
        string type
        Mixed payload
        string dedupeKey UK
        string status
        int attempts
        date availableAt
    }

    AUDIT_LOG {
        ObjectId _id
        ObjectId actor FK
        string action
        string entityType
        ObjectId entityId
        Mixed before
        Mixed after
        string ip
    }
```

### Modelling decisions worth knowing

**Variants are embedded in the product, not a separate collection.** A product and its variants are always read together, and a product is the natural transaction and consistency boundary. The trade-off is a document size ceiling, which is fine for a catalogue where a product has tens of variants, not thousands.

**Order items copy the product name and price at purchase time.** They are not references. A price change or a renamed product must never rewrite what a customer already bought, and an order has to stay readable after a product is deleted.

**Stock is `stock` minus `reserved`, not one number.** Adding to cart reserves; the reservation expires if checkout is abandoned. A single counter cannot distinguish "sold" from "in someone's cart for the next fifteen minutes".

**Categories store a materialised `path` and `depth`.** Breadcrumbs and "everything under Menswear" become one indexed prefix query rather than a recursive walk.

**`OUTBOX_EVENT` exists so side effects are transactional.** Explained under [Checkout and the outbox](#checkout-and-the-outbox).

**`AUDIT_LOG` keeps before/after snapshots** so a staff action can be reconstructed, not merely listed.

---

## Order lifecycle

The state machine lives in `packages/shared` and both the API and the admin UI read the same table, so the console cannot offer a transition the API will reject.

```mermaid
stateDiagram-v2
    [*] --> pending_payment: order placed

    pending_payment --> paid: payment captured
    pending_payment --> cancelled: abandoned or declined

    paid --> processing: picking started
    paid --> cancelled
    paid --> refunded

    processing --> shipped: tracking added
    processing --> cancelled
    processing --> refunded

    shipped --> delivered
    shipped --> refunded

    delivered --> refunded: return accepted

    cancelled --> [*]
    refunded --> [*]
```

Cancelling or refunding releases the stock reservation and writes an `INVENTORY_LOG` entry, so the ledger explains every movement.

---

## Request lifecycle

Middleware order is deliberate: cheap rejections happen before expensive work, and the health probes sit ahead of rate limiting so a throttled API still reports honestly to Kubernetes.

```mermaid
flowchart TD
    REQ([Request]) --> CTX[requestContext<br/>request id, logger]
    CTX --> SEC[securityHeaders<br/>Helmet, CSP]
    SEC --> CORS[CORS<br/>exact origins]
    CORS --> COOKIE[cookieParser]
    COOKIE --> HEALTH{/healthz /readyz?}
    HEALTH -->|yes| PROBE([200, bypasses everything below])
    HEALTH -->|no| BODY[express.json<br/>256 KB limit]
    BODY --> CT[requireJsonContentType]
    CT --> SAN[sanitizeInput]
    SAN --> QC[limitQueryComplexity]
    QC --> LOC[resolveLocale<br/>en / ar]
    LOC --> RL[globalRateLimit<br/>Redis token bucket]
    RL --> MAINT{maintenance mode?}
    MAINT -->|on, non-staff| M503([503])
    MAINT -->|off| ROUTE[Route handler]

    ROUTE --> AUTH[requireAuth<br/>JWT verify]
    AUTH --> RBAC[requirePermission<br/>role to permission]
    RBAC --> VAL[validate<br/>Zod schema]
    VAL --> SVC[Service layer]
    SVC --> RES([Response])

    ROUTE -.throws.-> ERR[errorHandler<br/>localised, coded]
    SVC -.throws.-> ERR
    ERR --> RES
```

Errors leave through one handler that returns a stable machine-readable `code` plus a message localised to the request's locale. Clients branch on the code; humans read the message.

---

## Checkout and the outbox

Placing an order writes several documents and needs to trigger side effects: email, search reindex, analytics. Doing that work inline would mean an order that succeeded but whose confirmation email failed, or a transaction held open across a third-party call.

Instead the side effects are written as events **inside the same transaction** as the order, then drained separately.

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant API
    participant M as MongoDB
    participant S as Stripe
    participant W as Outbox worker
    participant ES as Elasticsearch
    participant SES as Email

    C->>API: POST /orders (idempotency key)
    API->>M: check idempotency key
    alt key already seen
        M-->>API: stored response
        API-->>C: 200 (replay, no double charge)
    else new request
        API->>S: create PaymentIntent
        S-->>API: client secret

        rect rgb(245, 158, 11, 0.12)
            Note over API,M: single transaction
            API->>M: reserve stock on variants
            API->>M: insert order (pending_payment)
            API->>M: insert outbox events
            API->>M: clear cart
        end

        M-->>API: committed
        API-->>C: 201 + client secret
    end

    C->>S: confirm payment
    S->>API: webhook payment_intent.succeeded
    API->>M: order → paid, insert outbox event

    loop every 5s
        W->>M: claim pending event (atomic findAndModify)
        W->>ES: reindex product
        W->>SES: send confirmation
        W->>M: mark done, or retry with backoff
    end
```

If the process dies mid-drain the event stays `pending` and is retried; if a handler keeps failing the event lands in a dead-letter state rather than blocking the queue. The order and its side effects can never disagree, because they were committed together.

---

## Authentication

Short-lived access tokens in memory, long-lived refresh tokens in a rotating httpOnly cookie. The access token is deliberately **never** written to `localStorage`, which would trade XSS resistance for a one-line "stay signed in".

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant APP as SPA
    participant API
    participant DB as MongoDB

    U->>APP: email + password
    APP->>API: POST /auth/login
    API->>DB: verify argon2 hash
    API->>DB: store refresh token (hashed)
    API-->>APP: access token (memory)<br/>refresh token (httpOnly, SameSite)

    Note over APP: access token expires

    APP->>API: POST /auth/refresh (cookie)
    API->>DB: look up + invalidate old token
    API->>DB: store replacement
    API-->>APP: new access + new refresh

    Note over API,DB: rotation. A stolen refresh token<br/>is single-use, and reuse of an<br/>already-spent token revokes the family
```

Roles map to permissions in `packages/shared`, and routes declare the permission they need rather than the role, so adding a role does not mean auditing every route.

---

## Search indexing

Search is a projection of MongoDB. It is never written directly by a request.

```mermaid
flowchart LR
    W[Product write<br/>create / update / delete] --> TX[(MongoDB<br/>transaction)]
    TX --> OB[(outbox event<br/>product.upserted)]
    OB --> WK[Outbox worker]
    WK --> IDX[(Elasticsearch<br/>sunshop-products)]

    NIGHT[Nightly 03:30 UTC<br/>consistency pass] --> IDX
    Q[Catalogue query] --> IDX
    IDX -->|ids + facets| Q
    Q -->|hydrate| TX

    style OB fill:#f59e0b,stroke:#b45309,color:#1c1207
```

The nightly reindex is a safety net: the outbox keeps the index current, but a dead-lettered event would otherwise let the index drift silently for weeks.

---

## Getting started

**Requirements:** Node 22.12+, Docker, and (for the Android app) JDK 21 with the Android SDK.

```bash
git clone git@github.com:ahmedselimmansor-ctrl/Sunshop-e-ccomerce-MERN-stack.git
cd Sunshop-e-ccomerce-MERN-stack

cp .env.example .env          # dev defaults work as-is
npm ci
docker compose up -d          # mongo, redis, elasticsearch, minio, mailhog
npm run seed -w @sunshop/server
npm run dev
```

| Service             | URL                        |
| ------------------- | -------------------------- |
| Storefront          | http://localhost:5173      |
| Admin console       | http://localhost:5174      |
| API                 | http://localhost:4000      |
| OpenAPI docs        | http://localhost:4000/docs |
| Mail sink (MailHog) | http://localhost:8025      |
| MinIO console       | http://localhost:9001      |

Every host port is overridable in `.env` (`REDIS_HOST_PORT`, `MAIL_UI_HOST_PORT`, and so on) for machines where another project already holds the default.

Seeded demo accounts, development only:

| Role              | Email                   | Password       |
| ----------------- | ----------------------- | -------------- |
| Admin             | `admin@sunshop.demo`    | `Sunshop!2026` |
| Catalogue manager | `catalog@sunshop.demo`  | `Sunshop!2026` |
| Customer          | `customer@sunshop.demo` | `Sunshop!2026` |

### Android

```bash
cd apps/mobile
./gradlew assembleDebug
```

The debug build points at `10.0.2.2:4000`, which is the host machine as seen from the Android emulator.

---

## Testing and CI

```bash
npm run lint          # eslint, zero warnings tolerated
npm run typecheck     # tsc across every workspace
npm test              # vitest
npm run build         # all workspaces
```

Every push runs four jobs:

```mermaid
flowchart LR
    P([push / PR]) --> B[Lint, typecheck, test<br/>+ coverage]
    P --> S[Dependency + secret scanning<br/>npm audit, Trivy, Gitleaks]
    P --> M[Android build<br/>debug, unit tests, R8 release]
    P --> I[Infra validation<br/>terraform validate, kustomize build]

    B --> G{all green?}
    S --> G
    M --> G
    I --> G
    G -->|main| D[Deploy<br/>build images → ECR → EKS]
```

The Android job builds the release variant as well as debug, because R8 and resource shrinking fail on problems a debug build never sees.

---

## Documentation

| Document                                               | Contents                                      |
| ------------------------------------------------------ | --------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)           | Deeper architectural rationale and trade-offs |
| [docs/operations.md](docs/operations.md)               | Runbooks, deployment, scaling, monitoring     |
| [docs/security.md](docs/security.md)                   | Threat model and controls                     |
| [docs/disaster-recovery.md](docs/disaster-recovery.md) | Backup and restore procedures                 |

---

## Licence

MIT
