import { ROLES, type Role } from './constants';

/**
 * Sunshop authorization model
 * ───────────────────────────
 * Two independent layers, both enforced server-side:
 *
 *  1. **Permissions (this file)**: coarse "can this role perform this verb on
 *     this resource type at all?" Checked by `requirePermission()` middleware.
 *  2. **Data access control (server/src/security/dataAccess.ts)**: fine "which
 *     *rows* may this principal see?" Every query for a customer-owned resource
 *     is narrowed by an ownership scope, so a customer holding `order:read:own`
 *     can never read another customer's order even by guessing its id.
 *
 * The client uses the same matrix to hide UI it cannot use: purely cosmetic;
 * the server never trusts a client-side check.
 */

export const PERMISSIONS = [
  // catalog
  'product:read',
  'product:write',
  'product:delete',
  'product:publish',
  'category:read',
  'category:write',
  'category:delete',
  'inventory:read',
  'inventory:write',

  // commerce
  'order:read:own',
  'order:read:any',
  'order:write',
  'order:cancel:own',
  'order:refund',
  'cart:manage:own',

  // promotions
  'coupon:read',
  'coupon:write',

  // community
  'review:create',
  'review:read',
  'review:moderate',

  // identity
  'user:read:own',
  'user:write:own',
  'user:read:any',
  'user:write:any',
  'user:suspend',
  'user:delete',
  'role:assign',

  // platform
  'media:upload',
  'media:delete',
  'analytics:read',
  'settings:read',
  'settings:write',
  'audit:read',
  'search:reindex',
  'system:maintenance',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissions granted to a caller with no session at all. */
export const ANONYMOUS_PERMISSIONS: readonly Permission[] = [
  'product:read',
  'category:read',
  'review:read',
];

const CUSTOMER: readonly Permission[] = [
  ...ANONYMOUS_PERMISSIONS,
  'cart:manage:own',
  'order:read:own',
  'order:cancel:own',
  'review:create',
  'user:read:own',
  'user:write:own',
];

const SUPPORT: readonly Permission[] = [
  ...CUSTOMER,
  'order:read:any',
  'order:write',
  'user:read:any',
  'review:moderate',
  'inventory:read',
];

const CATALOG_MANAGER: readonly Permission[] = [
  ...CUSTOMER,
  'product:read',
  'product:write',
  'product:publish',
  'category:read',
  'category:write',
  'inventory:read',
  'inventory:write',
  'media:upload',
  'media:delete',
  'coupon:read',
  'coupon:write',
  'review:moderate',
  'analytics:read',
  'search:reindex',
];

const ADMIN: readonly Permission[] = [
  ...CATALOG_MANAGER,
  ...SUPPORT,
  'product:delete',
  'category:delete',
  'order:refund',
  'user:write:any',
  'user:suspend',
  'settings:read',
  'settings:write',
  'audit:read',
];

const SUPER_ADMIN: readonly Permission[] = [...PERMISSIONS];

/** role → permissions. Duplicates from spreading are collapsed below. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  customer: dedupe(CUSTOMER),
  support: dedupe(SUPPORT),
  catalog_manager: dedupe(CATALOG_MANAGER),
  admin: dedupe(ADMIN),
  super_admin: dedupe(SUPER_ADMIN),
};

function dedupe(list: readonly Permission[]): readonly Permission[] {
  return Object.freeze([...new Set(list)]);
}

/**
 * Rank is used for privilege-escalation guards: a principal may never assign a
 * role at or above their own rank, nor suspend/edit a user who outranks them.
 */
export const ROLE_RANK: Record<Role, number> = {
  customer: 0,
  support: 10,
  catalog_manager: 20,
  admin: 30,
  super_admin: 40,
};

export function permissionsForRoles(roles: readonly Role[] | undefined | null): Permission[] {
  if (!roles || roles.length === 0) return [...ANONYMOUS_PERMISSIONS];
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  }
  return [...set];
}

export function hasPermission(
  granted: readonly Permission[] | undefined | null,
  required: Permission,
): boolean {
  if (!granted) return false;
  return granted.includes(required);
}

export function hasAnyPermission(
  granted: readonly Permission[] | undefined | null,
  required: readonly Permission[],
): boolean {
  if (!granted) return false;
  return required.some((permission) => granted.includes(permission));
}

export function hasAllPermissions(
  granted: readonly Permission[] | undefined | null,
  required: readonly Permission[],
): boolean {
  if (!granted) return false;
  return required.every((permission) => granted.includes(permission));
}

export function highestRank(roles: readonly Role[] | undefined | null): number {
  if (!roles || roles.length === 0) return -1;
  return roles.reduce((max, role) => Math.max(max, ROLE_RANK[role] ?? -1), -1);
}

/**
 * True when `actorRoles` may grant/revoke `targetRole`.
 * Strictly-greater comparison stops an admin from minting another admin (or a
 * super_admin), which is the classic horizontal-escalation hole.
 */
export function canAssignRole(actorRoles: readonly Role[], targetRole: Role): boolean {
  if (actorRoles.includes('super_admin')) return true;
  return highestRank(actorRoles) > (ROLE_RANK[targetRole] ?? Number.MAX_SAFE_INTEGER);
}

/** True when the actor may act on a user holding `targetRoles`. */
export function canManageUser(actorRoles: readonly Role[], targetRoles: readonly Role[]): boolean {
  if (actorRoles.includes('super_admin')) return true;
  return highestRank(actorRoles) > highestRank(targetRoles);
}

export function isStaff(roles: readonly Role[] | undefined | null): boolean {
  if (!roles) return false;
  return roles.some((role) => role !== 'customer' && ROLES.includes(role));
}
