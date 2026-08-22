import { z } from 'zod';

import { CURRENCIES, DEFAULT_PAGE_SIZE, ERROR_CODES, LOCALES, MAX_PAGE_SIZE } from '../constants';

/** 24-char hex Mongo ObjectId. */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'invalid_id' });

/**
 * URL slug. Accepts Latin and Arabic letters so Arabic product names can
 * produce readable, indexable URLs (`/p/كنزة-صوفية`) instead of transliterated
 * mush. Percent-encoding is handled by the browser.
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(140)
  .regex(/^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u, { message: 'invalid_slug' });

export const localeSchema = z.enum(LOCALES);
export const currencySchema = z.enum(CURRENCIES);

/** Every user-facing string in the catalog carries both locales. */
export const localizedStringSchema = z.object({
  en: z.string().trim().min(1).max(400),
  ar: z.string().trim().min(1).max(400),
});

/** Same, but the translation may be omitted and fall back to the other locale. */
export const partialLocalizedStringSchema = z
  .object({
    en: z.string().trim().max(400).optional(),
    ar: z.string().trim().max(400).optional(),
  })
  .refine((value) => Boolean(value.en?.trim() || value.ar?.trim()), {
    message: 'at_least_one_locale_required',
  });

export const localizedTextSchema = z.object({
  en: z.string().trim().max(20_000),
  ar: z.string().trim().max(20_000),
});

export const moneySchema = z.object({
  amount: z.number().int().min(0).max(1_000_000_000),
  currency: currencySchema,
});

/** Signed variant for adjustments/refund deltas. */
export const signedMoneySchema = z.object({
  amount: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  currency: currencySchema,
});

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(254)
  .email({ message: 'invalid_email' });

/** E.164, which is what SMS/OTP providers and Stripe both expect. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, { message: 'invalid_phone' });

/**
 * Password policy: length does the heavy lifting (NIST SP 800-63B), with a
 * light composition rule to stop `aaaaaaaaaaaa`. The server additionally
 * screens against a breached-password list.
 */
export const passwordSchema = z
  .string()
  .min(10, { message: 'password_too_short' })
  .max(128, { message: 'password_too_long' })
  .refine((value) => /[a-z]/.test(value), { message: 'password_needs_lowercase' })
  .refine((value) => /[A-Z]/.test(value), { message: 'password_needs_uppercase' })
  .refine((value) => /\d/.test(value), { message: 'password_needs_digit' })
  .refine((value) => !/^(.)\1+$/.test(value), { message: 'password_too_repetitive' });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Cursor pagination for infinite feeds: deep `page=500` offsets are a
 * guaranteed way to melt a database, so lists that can grow unbounded use this.
 */
export const cursorQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const idParamSchema = z.object({ id: objectIdSchema });
export const slugParamSchema = z.object({ slug: slugSchema });

/** Accepts either an id or a slug in the same route position. */
export const idOrSlugParamSchema = z.object({
  idOrSlug: z.union([objectIdSchema, slugSchema]),
});

export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'invalid_date_range',
  });

// ── Response envelopes ──────────────────────────────────────────────────────

export const errorCodeSchema = z.enum(Object.values(ERROR_CODES) as [string, ...string[]]);

export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.array(fieldErrorSchema).optional(),
    requestId: z.string().optional(),
    retryAfter: z.number().int().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiSuccessSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ ok: z.literal(true), data });
}

export function apiPaginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    ok: z.literal(true),
    data: z.array(item),
    meta: paginationMetaSchema,
  });
}

// ── Address ─────────────────────────────────────────────────────────────────

export const addressSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().max(100).optional().or(z.literal('')),
  postalCode: z.string().trim().max(20).optional().or(z.literal('')),
  /** ISO 3166-1 alpha-2, uppercase. */
  country: z.string().trim().length(2).toUpperCase(),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
export type Address = z.infer<typeof addressSchema>;

export const savedAddressSchema = addressSchema.extend({
  _id: objectIdSchema.optional(),
  label: z.string().trim().max(40).optional(),
  isDefaultShipping: z.boolean().default(false),
  isDefaultBilling: z.boolean().default(false),
});
export type SavedAddress = z.infer<typeof savedAddressSchema>;

// ── Utilities ───────────────────────────────────────────────────────────────

/** `?a,b,c` → `['a','b','c']`, tolerating repeated query params. */
export const csvArray = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((value) => {
    if (Array.isArray(value)) return value.flatMap((entry) => String(entry).split(','));
    if (typeof value === 'string') return value.split(',').filter(Boolean);
    return value;
  }, z.array(item));

/** `?flag=true|1|yes` → boolean. */
export const booleanQuery = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  return value;
}, z.boolean());
