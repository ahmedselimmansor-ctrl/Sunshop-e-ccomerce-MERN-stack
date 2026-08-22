# syntax=docker/dockerfile:1.7
# Storefront image: Vite build served by nginx.
#
# The API URL is baked in at build time because Vite inlines `import.meta.env`.
# That means one image per environment: the alternative (runtime substitution
# into a placeholder) trades a build for a startup-time text replacement and is
# strictly worse to debug.

FROM node:22.12.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/admin/package.json ./apps/admin/
RUN --mount=type=cache,target=/root/.npm \
    npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 180000 \
 && npm config set fetch-timeout 300000 \
 && npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund

FROM deps AS build
WORKDIR /app

ARG VITE_API_URL
ARG VITE_CDN_URL
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_SENTRY_DSN
ENV VITE_API_URL=$VITE_API_URL \
    VITE_CDN_URL=$VITE_CDN_URL \
    VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN npm run build -w @sunshop/shared \
 && npm run build -w @sunshop/web

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

# The unprivileged image already runs as uid 101 and listens on 8080, so no
# capability is needed to bind the port and the pod can drop them all.
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
