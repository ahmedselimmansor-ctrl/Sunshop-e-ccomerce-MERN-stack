/* eslint-disable @typescript-eslint/no-explicit-any --
 * These mappers accept either a Mongoose `HydratedDocument` or the plain object
 * returned by `.lean()`, and the two have structurally different types for the
 * same fields (ObjectId vs string, Map vs Record). Threading a union through
 * every field access buys nothing here: the shape is validated on the way in by
 * the schema and on the way out by the DTO's own type.
 */
import {
  ROLE_RANK,
  canAssignRole,
  canManageUser,
  type AdminUpdateUserInput,
  type AdminUserListQuery,
  type PaginationMeta,
  type Role,
  type SavedAddress,
  type UpdateProfileInput,
  type User as UserDto,
} from '@sunshop/shared';

import { User, type UserDocument } from '../../models/User';
import { moduleLogger } from '../../observability/logger';
import { blindIndex, canEncrypt } from '../../security/crypto';
import { stripProtectedFields } from '../../security/dataAccess';
import { verifyPassword } from '../../security/password';
import { revokeAllSessions } from '../../security/tokens';
import { audit, diff } from '../../services/audit';
import { publicUrlFor } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import { buildPaginationMeta } from '../../utils/http';

import type { Principal } from '../../security/principal';
import type { FilterQuery } from 'mongoose';

const log = moduleLogger('users');

function toDto(document: UserDocument | Record<string, any>, includePhone = false): UserDto {
  return {
    id: String(document._id),
    email: document.email,
    firstName: document.firstName,
    lastName: document.lastName,
    // Decrypting is opt-in: list views do not need it and should not pay for it.
    phone:
      includePhone && typeof document.decryptedPhone === 'function'
        ? document.decryptedPhone()
        : null,
    avatarUrl: publicUrlFor(document.avatarKey),
    roles: document.roles,
    status: document.status,
    emailVerified: Boolean(document.emailVerified),
    totpEnabled: Boolean(document.totpEnabled),
    locale: document.locale,
    theme: document.theme ?? 'system',
    marketingOptIn: Boolean(document.marketingOptIn),
    addresses: (document.addresses ?? []).map((address: any) => ({
      ...address,
      _id: String(address._id),
    })),
    ordersCount: document.ordersCount ?? 0,
    totalSpent: document.totalSpent ?? 0,
    lastLoginAt: document.lastLoginAt ? new Date(document.lastLoginAt).toISOString() : null,
    createdAt: new Date(document.createdAt).toISOString(),
    updatedAt: new Date(document.updatedAt).toISOString(),
  };
}

// ── Self-service ────────────────────────────────────────────────────────────

export async function getProfile(principal: Principal): Promise<UserDto> {
  const user = await User.findById(principal.id).select('+phone');
  if (!user) throw ApiError.notFound();
  return toDto(user, true);
}

export async function updateProfile(
  principal: Principal,
  input: UpdateProfileInput,
): Promise<UserDto> {
  const user = await User.findById(principal.id).select('+phone +phoneIndex');
  if (!user) throw ApiError.notFound();

  // Belt and braces: the zod schema does not accept `roles`, and this strips it
  // again in case the schema is ever loosened.
  const safe = stripProtectedFields(input as Record<string, unknown>);
  Object.assign(user, safe);

  await user.save();
  return toDto(user, true);
}

export async function addAddress(principal: Principal, input: SavedAddress): Promise<UserDto> {
  const user = await User.findById(principal.id).select('+phone');
  if (!user) throw ApiError.notFound();

  if (user.addresses.length >= 20) {
    throw ApiError.badRequest('errors.bad_request', [{ path: 'addresses', message: 'too_many' }]);
  }

  // Only one default of each kind.
  if (input.isDefaultShipping) {
    for (const address of user.addresses) address.isDefaultShipping = false;
  }
  if (input.isDefaultBilling) {
    for (const address of user.addresses) address.isDefaultBilling = false;
  }

  user.addresses.push(input as never);
  await user.save();

  return toDto(user, true);
}

export async function updateAddress(
  principal: Principal,
  addressId: string,
  input: SavedAddress,
): Promise<UserDto> {
  const user = await User.findById(principal.id).select('+phone');
  if (!user) throw ApiError.notFound();

  const address = user.addresses.find((entry) => String(entry._id) === addressId);
  if (!address) throw ApiError.notFound();

  if (input.isDefaultShipping) {
    for (const entry of user.addresses) entry.isDefaultShipping = false;
  }
  if (input.isDefaultBilling) {
    for (const entry of user.addresses) entry.isDefaultBilling = false;
  }

  Object.assign(address, input);
  await user.save();

  return toDto(user, true);
}

export async function deleteAddress(principal: Principal, addressId: string): Promise<UserDto> {
  const user = await User.findById(principal.id).select('+phone');
  if (!user) throw ApiError.notFound();

  const before = user.addresses.length;
  user.addresses.pull({ _id: addressId });
  if (user.addresses.length === before) throw ApiError.notFound();

  await user.save();
  return toDto(user, true);
}

/**
 * Account deletion, GDPR-style.
 *
 * Anonymize rather than hard delete: order records carry tax and accounting
 * obligations that outlive the account, and cascading a delete through them
 * would corrupt historical revenue. The personal data is destroyed; the
 * financial record survives with no way back to a person.
 */
export async function deleteOwnAccount(principal: Principal, password: string): Promise<void> {
  const user = await User.findById(principal.id).select('+passwordHash email');
  if (!user) throw ApiError.notFound();

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('errors.invalid_credentials');

  const anonymousEmail = `deleted-${String(user._id)}@sunshop.invalid`;

  user.email = anonymousEmail;
  user.firstName = 'Deleted';
  user.lastName = 'User';
  user.phone = null;
  user.phoneIndex = null;
  user.avatarKey = null;
  user.addresses.splice(0, user.addresses.length);
  user.status = 'deleted';
  user.deletedAt = new Date();
  user.marketingOptIn = false;
  user.tokenVersion += 1;
  await user.save();

  await revokeAllSessions(String(user._id));

  audit({
    action: 'user.deleted',
    actor: principal,
    target: { type: 'user', id: String(user._id) },
    reason: 'self_service_deletion',
  });

  log.info({ userId: String(user._id) }, 'account anonymized on user request');
}

// ── Admin ───────────────────────────────────────────────────────────────────

export async function listUsers(
  principal: Principal,
  query: AdminUserListQuery,
): Promise<{ items: UserDto[]; meta: PaginationMeta }> {
  const filter: FilterQuery<Record<string, unknown>> = { deletedAt: null };

  if (query.role) filter.roles = query.role;
  if (query.status) filter.status = query.status;

  if (query.q) {
    const term = query.q.trim();
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { email: { $regex: escaped, $options: 'i' } },
      { firstName: { $regex: escaped, $options: 'i' } },
      { lastName: { $regex: escaped, $options: 'i' } },
      // Encrypted phone is searchable only through its blind index.
      ...(canEncrypt() && /^\+?\d{6,}$/.test(term)
        ? [{ phoneIndex: blindIndex(term.startsWith('+') ? term : `+${term}`) }]
        : []),
    ];
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    spend_desc: { totalSpent: -1 },
    orders_desc: { ordersCount: -1 },
  };

  const [documents, total] = await Promise.all([
    User.find(filter)
      .sort(sortMap[query.sort] ?? { createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return {
    items: documents.map((document) => toDto(document)),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}

export async function getUser(principal: Principal, userId: string): Promise<UserDto> {
  const user = await User.findById(userId).select('+phone');
  if (!user || user.deletedAt) throw ApiError.notFound();

  if (!canManageUser(principal.roles, user.roles as Role[]) && !principal.owns(userId)) {
    // Staff may not inspect an account that outranks them.
    throw ApiError.forbidden('errors.insufficient_rank');
  }

  return toDto(user, true);
}

export async function adminUpdateUser(
  principal: Principal,
  userId: string,
  input: AdminUpdateUserInput,
): Promise<UserDto> {
  const user = await User.findById(userId).select('+phone');
  if (!user || user.deletedAt) throw ApiError.notFound();

  if (!canManageUser(principal.roles, user.roles as Role[])) {
    throw ApiError.forbidden('errors.insufficient_rank');
  }

  const before = user.toObject();
  const wasSuspended = user.status === 'suspended';

  Object.assign(user, {
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.emailVerified !== undefined ? { emailVerified: input.emailVerified } : {}),
  });

  // Suspending must take effect immediately, not at the next token expiry.
  if (input.status === 'suspended' && !wasSuspended) {
    user.tokenVersion += 1;
    user.suspendedReason = input.reason ?? null;
    await revokeAllSessions(userId);
  }

  await user.save();

  audit({
    action: input.status === 'suspended' ? 'user.suspended' : 'user.updated',
    actor: principal,
    target: { type: 'user', id: userId, label: user.email },
    changes: diff(before, user.toObject(), ['firstName', 'lastName', 'status', 'emailVerified']),
    reason: input.reason,
  });

  return toDto(user, true);
}

/**
 * Role assignment, the highest-risk operation in the system.
 *
 * Two guards: a caller may never grant a role at or above their own rank
 * (no self-promotion, no minting peers), and may never edit their own roles at
 * all (which would otherwise let the last admin lock everyone out, or an
 * attacker with one admin session make themselves permanent).
 */
export async function assignRoles(
  principal: Principal,
  userId: string,
  roles: Role[],
  reason: string,
): Promise<UserDto> {
  if (principal.owns(userId)) throw ApiError.forbidden('errors.cannot_modify_self');

  const user = await User.findById(userId);
  if (!user || user.deletedAt) throw ApiError.notFound();

  if (!canManageUser(principal.roles, user.roles as Role[])) {
    throw ApiError.forbidden('errors.insufficient_rank');
  }

  for (const role of roles) {
    if (!canAssignRole(principal.roles, role)) {
      throw ApiError.forbidden('errors.insufficient_rank');
    }
  }

  const before = [...user.roles];
  user.roles = roles;
  // Existing tokens carry the old roles; invalidate them.
  user.tokenVersion += 1;
  await user.save();
  await revokeAllSessions(userId);

  audit({
    action: 'user.roles_changed',
    actor: principal,
    target: { type: 'user', id: userId, label: user.email },
    changes: { roles: { from: before, to: roles } },
    reason,
  });

  log.warn({ actorId: principal.id, userId, from: before, to: roles }, 'user roles changed');

  return toDto(user);
}

export function rankOf(roles: Role[]): number {
  return roles.reduce((max, role) => Math.max(max, ROLE_RANK[role] ?? 0), 0);
}
