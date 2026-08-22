# syntax=docker/dockerfile:1.7
# Admin dashboard image. Identical shape to the storefront, different app and a
# stricter nginx policy: the dashboard must never be indexed or framed.

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
ARG VITE_STOREFRONT_URL
ENV VITE_API_URL=$VITE_API_URL \
    VITE_CDN_URL=$VITE_CDN_URL \
    VITE_STOREFRONT_URL=$VITE_STOREFRONT_URL

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/admin ./apps/admin

RUN npm run build -w @sunshop/shared \
 && npm run build -w @sunshop/admin

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner
COPY infra/docker/nginx-admin.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
