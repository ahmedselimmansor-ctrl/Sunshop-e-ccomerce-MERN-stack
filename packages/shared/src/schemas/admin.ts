import { z } from 'zod';

import { CURRENCIES, LOCALES } from '../constants';

import {
  dateRangeSchema,
  localizedStringSchema,
  moneySchema,
  objectIdSchema,
  paginationQuerySchema,
} from './common';

// ── Analytics ───────────────────────────────────────────────────────────────

export const analyticsRangeSchema = z
  .object({
    preset: z.enum(['today', '7d', '30d', '90d', '12m', 'custom']).default('30d'),
    granularity: z.enum(['hour', 'day', 'week', 'month']).default('day'),
  })
  .and(dateRangeSchema);
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

export const kpiSchema = z.object({
  revenue: moneySchema,
  orders: z.number().int(),
  averageOrderValue: moneySchema,
  customers: z.number().int(),
  newCustomers: z.number().int(),
  conversionRate: z.number(),
  refunds: moneySchema,
  /** Percentage change vs the immediately preceding window. */
  deltas: z.object({
    revenue: z.number(),
    orders: z.number(),
    averageOrderValue: z.number(),
    customers: z.number(),
  }),
});
export type Kpi = z.infer<typeof kpiSchema>;

export const timeseriesPointSchema = z.object({
  t: z.string(),
  revenue: z.number().int(),
  orders: z.number().int(),
});

export const dashboardSchema = z.object({
  currency: z.enum(CURRENCIES),
  kpi: kpiSchema,
  timeseries: z.array(timeseriesPointSchema),
  topProducts: z.array(
    z.object({
      id: objectIdSchema,
      name: localizedStringSchema,
      imageUrl: z.string().url().nullable(),
      unitsSold: z.number().int(),
      revenue: moneySchema,
    }),
  ),
  topCategories: z.array(
    z.object({ id: objectIdSchema, name: localizedStringSchema, revenue: moneySchema }),
  ),
  lowStock: z.array(
    z.object({
      productId: objectIdSchema,
      variantId: objectIdSchema,
      sku: z.string(),
      name: localizedStringSchema,
      stock: z.number().int(),
      threshold: z.number().int(),
    }),
  ),
  recentOrders: z.array(
    z.object({
      id: objectIdSchema,
      orderNumber: z.string(),
      customer: z.string(),
      total: moneySchema,
      status: z.string(),
      placedAt: z.string(),
    }),
  ),
  ordersByStatus: z.array(z.object({ status: z.string(), count: z.number().int() })),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

// ── Audit log ───────────────────────────────────────────────────────────────

export const auditActionSchema = z.enum([
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_changed',
  'auth.password_reset',
  'auth.token_reuse_detected',
  'user.created',
  'user.updated',
  'user.suspended',
  'user.roles_changed',
  'user.deleted',
  'product.created',
  'product.updated',
  'product.deleted',
  'product.published',
  'inventory.adjusted',
  'category.created',
  'category.updated',
  'category.deleted',
  'order.status_changed',
  'order.refunded',
  'order.cancelled',
  'order.shipment_added',
  'coupon.created',
  'coupon.updated',
  'coupon.deleted',
  'review.moderated',
  'media.deleted',
  'settings.updated',
  'search.reindexed',
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditEntrySchema = z.object({
  id: objectIdSchema,
  action: auditActionSchema,
  actor: z.object({
    id: objectIdSchema.nullable(),
    email: z.string().nullable(),
    roles: z.array(z.string()),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
  }),
  target: z
    .object({
      type: z.string(),
      id: z.string().nullable(),
      label: z.string().nullable().optional(),
    })
    .nullable(),
  /** JSON-patch-ish before/after for the changed fields only. */
  changes: z.record(z.string(), z.unknown()).nullable().optional(),
  reason: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
  at: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListQuerySchema = paginationQuerySchema
  .extend({
    action: auditActionSchema.optional(),
    actorId: objectIdSchema.optional(),
    targetId: z.string().max(80).optional(),
    q: z.string().max(120).optional(),
  })
  .and(dateRangeSchema);

// ── Store settings ──────────────────────────────────────────────────────────

export const storeSettingsSchema = z.object({
  storeName: localizedStringSchema,
  supportEmail: z.string().email(),
  supportPhone: z.string().max(30).nullable().optional(),
  defaultCurrency: z.enum(CURRENCIES),
  defaultLocale: z.enum(LOCALES),
  /** Country codes the store ships to; empty = worldwide. */
  shipsToCountries: z.array(z.string().length(2)).max(250).default([]),
  taxRatePercent: z.number().min(0).max(100).default(0),
  taxIncludedInPrices: z.boolean().default(false),
  freeShippingThreshold: moneySchema.nullable().optional(),
  maintenanceMode: z.boolean().default(false),
  maintenanceMessage: localizedStringSchema.optional(),
  socialLinks: z
    .object({
      facebook: z.string().url().nullable().optional(),
      instagram: z.string().url().nullable().optional(),
      x: z.string().url().nullable().optional(),
      tiktok: z.string().url().nullable().optional(),
      youtube: z.string().url().nullable().optional(),
    })
    .default({}),
  announcement: z
    .object({
      enabled: z.boolean().default(false),
      text: localizedStringSchema.optional(),
      href: z.string().max(300).nullable().optional(),
    })
    .default({ enabled: false }),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const updateSettingsSchema = storeSettingsSchema.partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
