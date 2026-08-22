/* eslint-disable @typescript-eslint/no-explicit-any --
 * These mappers accept either a Mongoose `HydratedDocument` or the plain object
 * returned by `.lean()`, and the two have structurally different types for the
 * same fields (ObjectId vs string, Map vs Record). Threading a union through
 * every field access buys nothing here: the shape is validated on the way in by
 * the schema and on the way out by the DTO's own type.
 */
import {
  ERROR_CODES,
  permissionsForRoles,
  type AuthResponse,
  type ChangePasswordInput,
  type LoginInput,
  type Locale,
  type RegisterInput,
  type Role,
  type SessionUser,
} from '@sunshop/shared';

import { env } from '../../config/env';
import { User, type UserDocument } from '../../models/User';
import { moduleLogger } from '../../observability/logger';
import { businessEvents } from '../../observability/metrics';
import { hashToken, randomToken } from '../../security/crypto';
import {
  containsPersonalData,
  hashPassword,
  isCommonPassword,
  needsRehash,
  verifyPassword,
} from '../../security/password';
import {
  issueSession,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
  type IssuedSession,
} from '../../security/tokens';
import { audit } from '../../services/audit';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../services/mailer';
import { clearLoginFailures, isLoginLocked, recordLoginFailure } from '../../services/rateLimit';
import { publicUrlFor } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';

import type { Principal } from '../../security/principal';

const log = moduleLogger('auth');

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export function toSessionUser(user: UserDocument | Record<string, any>): SessionUser {
  const roles = (user.roles ?? []) as Role[];
  return {
    id: String(user._id ?? user.id),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: publicUrlFor(user.avatarKey),
    roles,
    permissions: permissionsForRoles(roles),
    status: user.status,
    emailVerified: Boolean(user.emailVerified),
    totpEnabled: Boolean(user.totpEnabled),
    locale: user.locale,
    theme: user.theme ?? 'system',
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

function buildAuthResponse(user: UserDocument, session: IssuedSession): AuthResponse {
  return {
    user: toSessionUser(user),
    tokens: {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      tokenType: 'Bearer',
    },
  };
}

// ── Registration ────────────────────────────────────────────────────────────

export async function register(
  input: RegisterInput,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ auth: AuthResponse; refreshToken: string }> {
  if (isCommonPassword(input.password)) {
    throw ApiError.badRequest('errors.password_common', [
      { path: 'password', message: 'password_common' },
    ]);
  }
  if (
    containsPersonalData(input.password, [
      input.firstName,
      input.lastName,
      input.email.split('@')[0],
    ])
  ) {
    throw ApiError.badRequest('errors.password_personal', [
      { path: 'password', message: 'password_personal' },
    ]);
  }

  const existing = await User.findOne({ email: input.email }).select('_id').lean();
  if (existing) {
    // Deliberately explicit: hiding this would break the signup UX, and the
    // same information is obtainable from the login form anyway. The mitigation
    // is the rate limiter on this endpoint, not obscurity.
    throw ApiError.conflict('errors.email_taken');
  }

  const verificationToken = randomToken(32);

  const user = await User.create({
    email: input.email,
    passwordHash: await hashPassword(input.password),
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone ?? null,
    locale: input.locale,
    marketingOptIn: input.marketingOptIn,
    roles: ['customer'],
    status: 'pending_verification',
    emailVerificationTokenHash: hashToken(verificationToken),
    emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
  });

  await sendVerificationEmail({
    to: user.email,
    firstName: user.firstName,
    token: verificationToken,
    locale: input.locale,
  }).catch((error: Error) => {
    // A failed verification mail must not fail the signup: the user can ask
    // for a resend, and losing the account entirely is a worse outcome.
    log.error({ err: error.message, userId: String(user._id) }, 'verification email failed');
  });

  const session = await issueSession({
    userId: String(user._id),
    roles: user.roles as Role[],
    tokenVersion: user.tokenVersion,
    ip: meta.ip,
    userAgent: meta.userAgent,
    rememberMe: false,
  });

  businessEvents.inc({ event: 'user_registered', outcome: 'success' });
  log.info({ userId: String(user._id) }, 'user registered');

  return { auth: buildAuthResponse(user, session), refreshToken: session.refreshToken };
}

// ── Login ───────────────────────────────────────────────────────────────────

export async function login(
  input: LoginInput,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ auth: AuthResponse; refreshToken: string }> {
  const lock = await isLoginLocked(input.email, env.LOGIN_MAX_ATTEMPTS);
  if (lock.locked) {
    throw new ApiError(429, ERROR_CODES.ACCOUNT_LOCKED, 'errors.account_locked', {
      retryAfter: lock.retryAfter,
    });
  }

  const user = await User.findOne({ email: input.email }).select(
    '+passwordHash +totpSecret email firstName lastName roles status tokenVersion emailVerified totpEnabled locale theme avatarKey createdAt suspendedUntil deletedAt',
  );

  // Always run the hash comparison, even for a missing user, so response time
  // does not reveal whether an address is registered.
  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? '');

  if (!user || !passwordOk || user.deletedAt) {
    const failure = await recordLoginFailure(
      input.email,
      env.LOGIN_MAX_ATTEMPTS,
      env.LOGIN_LOCK_SECONDS,
    );
    businessEvents.inc({ event: 'login', outcome: 'failure' });
    log.warn({ email: input.email, attempts: failure.attempts, ip: meta.ip }, 'failed login');

    if (failure.locked) {
      throw new ApiError(429, ERROR_CODES.ACCOUNT_LOCKED, 'errors.account_locked', {
        retryAfter: failure.retryAfter,
      });
    }
    throw new ApiError(401, ERROR_CODES.INVALID_CREDENTIALS, 'errors.invalid_credentials');
  }

  if (user.status === 'suspended') {
    const stillSuspended = !user.suspendedUntil || user.suspendedUntil.getTime() > Date.now();
    if (stillSuspended) throw ApiError.forbidden('errors.account_suspended');
  }

  if (user.totpEnabled) {
    if (!input.totpCode) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, 'errors.totp_required');
    }
    const { verifyTotp } = await import('./totp.service');
    const valid = verifyTotp(user.totpSecret ?? '', input.totpCode);
    if (!valid) {
      await recordLoginFailure(input.email, env.LOGIN_MAX_ATTEMPTS, env.LOGIN_LOCK_SECONDS);
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, 'errors.totp_invalid');
    }
  }

  await clearLoginFailures(input.email);

  // Opportunistically upgrade a hash created under an older cost factor.
  if (needsRehash(user.passwordHash)) {
    user.passwordHash = await hashPassword(input.password);
  }

  user.lastLoginAt = new Date();
  user.lastLoginIp = meta.ip ?? null;
  await user.save();

  const session = await issueSession({
    userId: String(user._id),
    roles: user.roles as Role[],
    tokenVersion: user.tokenVersion,
    ip: meta.ip,
    userAgent: meta.userAgent,
    rememberMe: input.rememberMe,
  });

  businessEvents.inc({ event: 'login', outcome: 'success' });
  log.info({ userId: String(user._id) }, 'login succeeded');

  return { auth: buildAuthResponse(user, session), refreshToken: session.refreshToken };
}

// ── Refresh ─────────────────────────────────────────────────────────────────

export async function refresh(
  sessionId: string,
  refreshToken: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ auth: AuthResponse; refreshToken: string }> {
  // Read current roles/version first so a role change applies on this refresh.
  const { getSession, detectTokenReuse } = await import('../../security/tokens');
  const existing = await getSession(sessionId);

  if (!existing) {
    /*
     * A missing session is ambiguous: either it was revoked normally, or this
     * is a replay of a token that rotation already spent and deleted. Only the
     * spent-token marker separates the two, and the replay case has to take
     * the rest of the family down with it. Returning early here instead made
     * every replay look like an ordinary revoked session, which left the
     * reuse check inside `rotateRefreshToken` unreachable and the attacker's
     * freshly rotated session alive.
     */
    const reuse = await detectTokenReuse(refreshToken);
    if (reuse.detected) {
      if (reuse.userId) {
        await User.updateOne({ _id: reuse.userId }, { $inc: { tokenVersion: 1 } });
      }
      businessEvents.inc({ event: 'token_reuse', outcome: 'failure' });
      log.error({ userId: reuse.userId }, 'refresh token reuse, all sessions revoked');
      throw new ApiError(401, ERROR_CODES.TOKEN_REUSED, 'errors.token_reuse');
    }
    throw ApiError.unauthorized('errors.session_revoked');
  }

  const user = await User.findById(existing.userId).select(
    'email firstName lastName roles status tokenVersion emailVerified totpEnabled locale theme avatarKey createdAt deletedAt',
  );
  if (!user || user.deletedAt) throw ApiError.unauthorized('errors.account_not_found');

  const result = await rotateRefreshToken(sessionId, refreshToken, {
    roles: user.roles as Role[],
    tokenVersion: user.tokenVersion,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  if (result.outcome === 'reuse_detected') {
    // Every session in the family is already gone; bump the token version so
    // outstanding *access* tokens die immediately too.
    await User.updateOne({ _id: result.userId }, { $inc: { tokenVersion: 1 } });
    businessEvents.inc({ event: 'token_reuse', outcome: 'failure' });
    log.error({ userId: result.userId }, 'refresh token reuse, all sessions revoked');
    throw new ApiError(401, ERROR_CODES.TOKEN_REUSED, 'errors.token_reuse');
  }

  if (result.outcome !== 'ok') {
    throw ApiError.unauthorized(
      result.outcome === 'expired' ? 'errors.token_expired' : 'errors.invalid_token',
    );
  }

  return {
    auth: buildAuthResponse(user, result.session),
    refreshToken: result.session.refreshToken,
  };
}

// ── Logout ──────────────────────────────────────────────────────────────────

export async function logout(principal: Principal, allDevices: boolean): Promise<void> {
  if (!principal.isAuthenticated) return;

  if (allDevices && principal.id) {
    await revokeAllSessions(principal.id);
    await User.updateOne({ _id: principal.id }, { $inc: { tokenVersion: 1 } });
  } else if (principal.sessionId) {
    await revokeSession(principal.sessionId);
  }

  log.info({ userId: principal.id, allDevices }, 'logout');
}

// ── Email verification ──────────────────────────────────────────────────────

export async function verifyEmail(token: string): Promise<void> {
  const user = await User.findOne({
    emailVerificationTokenHash: hashToken(token),
    emailVerificationExpiresAt: { $gt: new Date() },
  }).select('+emailVerificationTokenHash +emailVerificationExpiresAt status emailVerified');

  if (!user) throw ApiError.badRequest('errors.invalid_verification_token');

  user.emailVerified = true;
  user.emailVerificationTokenHash = null;
  user.emailVerificationExpiresAt = null;
  if (user.status === 'pending_verification') user.status = 'active';
  await user.save();

  log.info({ userId: String(user._id) }, 'email verified');
}

export async function resendVerification(email: string, locale: Locale): Promise<void> {
  const user = await User.findOne({ email, emailVerified: false }).select(
    '+emailVerificationTokenHash email firstName locale',
  );
  // Silent success: confirming which addresses are unverified is an oracle.
  if (!user) return;

  const token = randomToken(32);
  user.emailVerificationTokenHash = hashToken(token);
  user.emailVerificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  await user.save();

  await sendVerificationEmail({
    to: user.email,
    firstName: user.firstName,
    token,
    locale: user.locale ?? locale,
  });
}

// ── Password reset ──────────────────────────────────────────────────────────

export async function forgotPassword(email: string, locale: Locale): Promise<void> {
  const user = await User.findOne({ email, deletedAt: null }).select(
    '+passwordResetTokenHash email firstName locale',
  );
  // Always answer 200 regardless: see `success.reset_email_sent`.
  if (!user) return;

  const token = randomToken(32);
  user.passwordResetTokenHash = hashToken(token);
  user.passwordResetExpiresAt = new Date(Date.now() + RESET_TTL_MS);
  await user.save();

  await sendPasswordResetEmail({
    to: user.email,
    firstName: user.firstName,
    token,
    locale: user.locale ?? locale,
  });

  log.info({ userId: String(user._id) }, 'password reset requested');
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const user = await User.findOne({
    passwordResetTokenHash: hashToken(token),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select(
    '+passwordHash +passwordResetTokenHash +passwordResetExpiresAt email firstName lastName',
  );

  if (!user) throw ApiError.badRequest('errors.invalid_reset_token');

  if (isCommonPassword(newPassword)) {
    throw ApiError.badRequest('errors.password_common', [
      { path: 'password', message: 'password_common' },
    ]);
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw ApiError.badRequest('errors.password_reused', [
      { path: 'password', message: 'password_reused' },
    ]);
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.passwordChangedAt = new Date();
  // Invalidate every outstanding token: a reset usually follows a compromise.
  user.tokenVersion += 1;
  await user.save();

  await revokeAllSessions(String(user._id));
  log.info({ userId: String(user._id) }, 'password reset completed');
}

export async function changePassword(
  principal: Principal,
  input: ChangePasswordInput,
): Promise<void> {
  const user = await User.findById(principal.id).select('+passwordHash email firstName lastName');
  if (!user) throw ApiError.unauthorized();

  const currentOk = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentOk) {
    throw new ApiError(401, ERROR_CODES.INVALID_CREDENTIALS, 'errors.invalid_credentials');
  }
  if (isCommonPassword(input.newPassword)) {
    throw ApiError.badRequest('errors.password_common', [
      { path: 'newPassword', message: 'password_common' },
    ]);
  }
  if (
    containsPersonalData(input.newPassword, [
      user.firstName,
      user.lastName,
      user.email.split('@')[0],
    ])
  ) {
    throw ApiError.badRequest('errors.password_personal', [
      { path: 'newPassword', message: 'password_personal' },
    ]);
  }

  user.passwordHash = await hashPassword(input.newPassword);
  user.passwordChangedAt = new Date();
  user.tokenVersion += 1;
  await user.save();

  // Keep the current device signed in, drop every other one.
  await revokeAllSessions(String(user._id));

  audit({
    action: 'auth.password_changed',
    actor: principal,
    target: { type: 'user', id: String(user._id), label: user.email },
  });

  log.info({ userId: String(user._id) }, 'password changed');
}

export async function getCurrentUser(principal: Principal): Promise<SessionUser> {
  const user = await User.findById(principal.id).lean();
  if (!user) throw ApiError.unauthorized();
  return toSessionUser(user);
}
