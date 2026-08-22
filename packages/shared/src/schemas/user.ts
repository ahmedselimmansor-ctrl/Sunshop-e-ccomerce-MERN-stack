import { z } from 'zod';

import { LOCALES, ROLES, THEMES, USER_STATUSES } from '../constants';

import {
  emailSchema,
  objectIdSchema,
  paginationQuerySchema,
  phoneSchema,
  savedAddressSchema,
} from './common';

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(2).max(60).optional(),
  lastName: z.string().trim().min(2).max(60).optional(),
  phone: phoneSchema.nullable().optional(),
  locale: z.enum(LOCALES).optional(),
  theme: z.enum(THEMES).optional(),
  avatarKey: z.string().max(300).nullable().optional(),
  marketingOptIn: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const upsertAddressSchema = savedAddressSchema;
export type UpsertAddressInput = z.infer<typeof upsertAddressSchema>;

/** Public projection of a user: never contains the hash or security fields. */
export const userSchema = z.object({
  id: objectIdSchema,
  email: emailSchema,
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  roles: z.array(z.enum(ROLES)),
  status: z.enum(USER_STATUSES),
  emailVerified: z.boolean(),
  totpEnabled: z.boolean(),
  locale: z.enum(LOCALES),
  theme: z.enum(THEMES),
  marketingOptIn: z.boolean(),
  addresses: z.array(savedAddressSchema).default([]),
  ordersCount: z.number().int().optional(),
  totalSpent: z.number().int().optional(),
  lastLoginAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

// ── Admin-side ──────────────────────────────────────────────────────────────

export const adminUserListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  sort: z.enum(['newest', 'oldest', 'spend_desc', 'orders_desc']).default('newest'),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminUpdateUserSchema = z.object({
  firstName: z.string().trim().min(2).max(60).optional(),
  lastName: z.string().trim().min(2).max(60).optional(),
  phone: phoneSchema.nullable().optional(),
  status: z.enum(USER_STATUSES).optional(),
  emailVerified: z.boolean().optional(),
  /** Reason is required for any state change so the audit log stays useful. */
  reason: z.string().trim().min(3).max(300).optional(),
});
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export const assignRolesSchema = z.object({
  roles: z.array(z.enum(ROLES)).min(1).max(ROLES.length),
  reason: z.string().trim().min(3).max(300),
});
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;

export const suspendUserSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  until: z.coerce.date().optional(),
});

/**
 * GDPR-style account deletion request. The API anonymizes rather than hard
 * deletes, because financial records must survive for tax retention periods.
 */
export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
  confirm: z.literal('DELETE'),
});
