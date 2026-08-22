import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import {
  addToCartSchema,
  apiErrorSchema,
  authResponseSchema,
  cartSchema,
  categorySchema,
  checkoutSchema,
  createProductSchema,
  loginSchema,
  orderSchema,
  paginationMetaSchema,
  productCardSchema,
  productListQuerySchema,
  productSchema,
  registerSchema,
  reviewSchema,
  searchQuerySchema,
  userSchema,
} from '@sunshop/shared';
import { z } from 'zod';

import { env } from '../config/env';

extendZodWithOpenApi(z);

/**
 * OpenAPI document generated from the *same* zod schemas the API validates
 * with. A hand-maintained spec drifts from the implementation within weeks;
 * this one cannot, because if the schema changes the documentation changes with
 * it.
 */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Short-lived access token from POST /auth/login.',
  });

  const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ ok: z.literal(true), data });
  const paginatedEnvelope = <T extends z.ZodTypeAny>(item: T) =>
    z.object({ ok: z.literal(true), data: z.array(item), meta: paginationMetaSchema });

  const errorResponse = {
    description: 'Error',
    content: { 'application/json': { schema: apiErrorSchema } },
  };

  // ── Auth ──────────────────────────────────────────────────────────────────

  registry.registerPath({
    method: 'post',
    path: '/auth/register',
    tags: ['Auth'],
    summary: 'Create an account',
    request: { body: { content: { 'application/json': { schema: registerSchema } } } },
    responses: {
      201: {
        description: 'Account created; a verification email is queued',
        content: { 'application/json': { schema: envelope(authResponseSchema) } },
      },
      409: errorResponse,
      422: errorResponse,
      429: errorResponse,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/login',
    tags: ['Auth'],
    summary: 'Sign in',
    description:
      'Browsers receive the refresh token as an httpOnly cookie. Native clients send `X-Client-Type: mobile` to receive it in the body instead.',
    request: { body: { content: { 'application/json': { schema: loginSchema } } } },
    responses: {
      200: {
        description: 'Signed in',
        content: { 'application/json': { schema: envelope(authResponseSchema) } },
      },
      401: errorResponse,
      429: { ...errorResponse, description: 'Account temporarily locked after repeated failures' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/refresh',
    tags: ['Auth'],
    summary: 'Rotate the session',
    description:
      'Refresh tokens are single use. Presenting a previously rotated token revokes the whole session family (reuse detection).',
    responses: {
      200: {
        description: 'Rotated',
        content: { 'application/json': { schema: envelope(authResponseSchema) } },
      },
      401: errorResponse,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/me',
    tags: ['Auth'],
    summary: 'Current principal, including effective permissions',
    security: [{ [bearer.name]: [] }],
    responses: {
      200: {
        description: 'Session user',
        content: { 'application/json': { schema: envelope(userSchema) } },
      },
      401: errorResponse,
    },
  });

  // ── Catalogue ─────────────────────────────────────────────────────────────

  registry.registerPath({
    method: 'get',
    path: '/products',
    tags: ['Catalogue'],
    summary: 'List products',
    description:
      'Served from Elasticsearch with facets. Falls back to MongoDB when the cluster is unavailable; the response then carries `X-Search-Degraded: true` and a null `facets`.',
    request: { query: productListQuerySchema },
    responses: {
      200: {
        description: 'Product page',
        content: { 'application/json': { schema: paginatedEnvelope(productCardSchema) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/products/{idOrSlug}',
    tags: ['Catalogue'],
    summary: 'Product detail',
    request: { params: z.object({ idOrSlug: z.string() }) },
    responses: {
      200: {
        description: 'Product',
        content: { 'application/json': { schema: envelope(productSchema) } },
      },
      404: errorResponse,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/products',
    tags: ['Catalogue'],
    summary: 'Create a product',
    security: [{ [bearer.name]: [] }],
    request: { body: { content: { 'application/json': { schema: createProductSchema } } } },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: envelope(productSchema) } },
      },
      403: errorResponse,
      422: errorResponse,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/categories/tree',
    tags: ['Catalogue'],
    summary: 'Full category tree',
    responses: {
      200: {
        description: 'Tree',
        content: { 'application/json': { schema: envelope(z.array(categorySchema)) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/search',
    tags: ['Catalogue'],
    summary: 'Full-text search with facets',
    description:
      'Bilingual analysis: Arabic queries are normalized (أ/إ/آ → ا, ة → ه) before matching.',
    request: { query: searchQuerySchema },
    responses: {
      200: {
        description: 'Results',
        content: { 'application/json': { schema: paginatedEnvelope(productCardSchema) } },
      },
    },
  });

  // ── Commerce ──────────────────────────────────────────────────────────────

  registry.registerPath({
    method: 'get',
    path: '/cart',
    tags: ['Commerce'],
    summary: 'Current cart',
    description: 'Works for guests via the `X-Cart-Token` header or the cart cookie.',
    responses: {
      200: {
        description: 'Cart',
        content: { 'application/json': { schema: envelope(cartSchema) } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/cart/items',
    tags: ['Commerce'],
    summary: 'Add an item',
    request: { body: { content: { 'application/json': { schema: addToCartSchema } } } },
    responses: {
      200: {
        description: 'Updated cart',
        content: { 'application/json': { schema: envelope(cartSchema) } },
      },
      409: { ...errorResponse, description: 'Out of stock' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/orders/checkout',
    tags: ['Commerce'],
    summary: 'Place an order',
    description:
      'Requires an `X-Idempotency-Key` header. Reserves inventory for 30 minutes pending payment.',
    request: { body: { content: { 'application/json': { schema: checkoutSchema } } } },
    responses: {
      201: {
        description: 'Order created',
        content: { 'application/json': { schema: envelope(orderSchema) } },
      },
      409: { ...errorResponse, description: 'Out of stock, total mismatch, or coupon exhausted' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/orders',
    tags: ['Commerce'],
    summary: 'List orders',
    description:
      'Customers see only their own orders; staff holding `order:read:any` see all of them. The narrowing is applied server-side and cannot be widened by a query parameter.',
    security: [{ [bearer.name]: [] }],
    responses: {
      200: {
        description: 'Orders',
        content: { 'application/json': { schema: paginatedEnvelope(orderSchema) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/reviews',
    tags: ['Community'],
    summary: 'List product reviews',
    responses: {
      200: {
        description: 'Reviews',
        content: { 'application/json': { schema: paginatedEnvelope(reviewSchema) } },
      },
    },
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Sunshop API',
      version: env.APP_VERSION,
      description: [
        'E-commerce API for the Sunshop platform.',
        '',
        '**Conventions**',
        '- Success: `{ "ok": true, "data": … }`; errors: `{ "ok": false, "error": { "code", "message" } }`.',
        '- Branch on `error.code` (stable), never on `message` (localized).',
        '- All money is an integer of currency minor units: `1999` means 19.99.',
        '- Send `X-Locale: ar|en` for localized copy; responses vary on it.',
        '- Unsafe retryable calls accept `X-Idempotency-Key`.',
      ].join('\n'),
      contact: { name: 'Sunshop Engineering' },
    },
    servers: [{ url: `${env.PUBLIC_API_URL}${env.API_PREFIX}`, description: env.NODE_ENV }],
    tags: [
      { name: 'Auth', description: 'Sessions, registration, password and 2FA' },
      { name: 'Catalogue', description: 'Products, categories and search' },
      { name: 'Commerce', description: 'Cart, checkout, orders and payments' },
      { name: 'Community', description: 'Reviews' },
    ],
  });
}
