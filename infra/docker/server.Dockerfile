# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Sunshop API image.
#
# Multi-stage so the runtime layer carries only production dependencies and the
# compiled bundle: no TypeScript, no dev tooling, no source maps of the build
# toolchain. The final image runs as an unprivileged user with a read-only root
# filesystem (enforced by the Kubernetes securityContext).
#
# Node 22 LTS, not 20: `sanitize-html` is CommonJS and pulls in an ESM-only
# `htmlparser2`, so the runtime must support `require()` of an ES module. That
# landed unflagged in 22.12 and 20.19; pinning to 22 LTS keeps the container on
# the same semantics as the development toolchain instead of failing at boot.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=22.12.0

# ── deps: install once, cached on lockfile changes only ──────────────────────
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

# Copy only the manifests first: this layer is reused across every source-only
# change, which is the difference between a 10-second and a 3-minute build.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/admin/package.json ./apps/admin/

# A cold install pulls well over a thousand packages. npm's defaults give up
# after two quick retries, which turns any transient registry blip into a failed
# build; these settings make it wait and retry instead.
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 180000 \
 && npm config set fetch-timeout 300000

RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

RUN npm run build -w @sunshop/shared \
 && npm run build -w @sunshop/server

# ── prod-deps: the runtime dependency closure, and nothing else ──────────────
#
# A `npm prune` of the full workspace install would leave every *production*
# dependency of the web and admin apps behind (React, Radix, Stripe.js), which
# is several hundred megabytes the API will never load. Installing fresh for
# just the server workspace is both smaller and easier to reason about.
#
# `@sunshop/shared` is bundled into the server's output by tsup, so it is
# deliberately absent here.
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/admin/package.json ./apps/admin/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @sunshop/server --include-workspace-root \
           --ignore-scripts --no-audit --no-fund

# npm materialises a handful of packages from the workspace lockfile that
# nothing in the server's dependency graph can reach. They are verified
# orphans, not transitive dependencies, and they are all build tooling —
# `tsx` in particular hands a TypeScript runner to anyone who gets code
# execution in this container.
#
# Deleting them by name is deliberately blunter than computing reachability:
# if a future npm stops installing them, this degrades to a no-op rather than
# to a subtly broken runtime.
RUN rm -rf node_modules/typescript \
           node_modules/tsx \
           node_modules/postcss-load-config \
           node_modules/.bin/tsc \
           node_modules/.bin/tsserver \
           node_modules/.bin/tsx

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    # Keep the heap under the container limit so the kernel never OOM-kills a
    # pod that Node thought still had room.
    NODE_OPTIONS="--max-old-space-size=384"

# `tini` reaps zombies and forwards SIGTERM, which is what makes the graceful
# shutdown path actually run during a rolling deploy.
RUN apk add --no-cache tini curl \
 && addgroup -g 10001 -S sunshop \
 && adduser -u 10001 -S sunshop -G sunshop

# Amazon DocumentDB requires the AWS RDS CA bundle for TLS verification.
ADD --chown=root:root https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/global-bundle.pem
RUN chmod 0444 /etc/ssl/certs/global-bundle.pem

COPY --from=prod-deps --chown=sunshop:sunshop /app/node_modules ./node_modules
COPY --from=build --chown=sunshop:sunshop /app/apps/server/dist ./dist
COPY --from=build --chown=sunshop:sunshop /app/apps/server/package.json ./package.json
# Loaded via --import below, before any instrumented module is evaluated.
COPY --from=build --chown=sunshop:sunshop /app/apps/server/esm-hook.mjs ./esm-hook.mjs

USER sunshop
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# The OpenTelemetry ESM loader hook must be registered before the application
# module graph is evaluated; see esm-hook.mjs. It is a no-op unless OTEL_ENABLED.
CMD ["node", "--import", "./esm-hook.mjs", "dist/index.js"]
