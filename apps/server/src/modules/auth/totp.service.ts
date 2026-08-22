import { authenticator } from 'otplib';
import QRCode from 'qrcode';

import { env } from '../../config/env';
import { User } from '../../models/User';
import { hashToken, randomToken, safeEqual } from '../../security/crypto';
import { ApiError } from '../../utils/ApiError';

import type { Principal } from '../../security/principal';

/**
 * TOTP second factor for staff accounts.
 *
 * A one-step window (±30s) is allowed for clock drift: wider windows make
 * brute forcing meaningfully easier, and the login rate limiter already bounds
 * attempts. Recovery codes are single-use and stored hashed, so a database leak
 * yields nothing usable.
 */
authenticator.options = { window: 1, step: 30 };

export function verifyTotp(secret: string, code: string): boolean {
  if (!secret || !code) return false;
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

export interface TotpEnrollment {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export async function beginEnrollment(principal: Principal): Promise<TotpEnrollment> {
  const user = await User.findById(principal.id).select('+totpSecret email totpEnabled');
  if (!user) throw ApiError.unauthorized();
  if (user.totpEnabled) throw ApiError.conflict();

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(user.email, env.APP_NAME, secret);

  // Stored but not yet enabled: enrollment only completes once the user
  // proves they can generate a valid code.
  user.totpSecret = secret;
  await user.save();

  return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) };
}

export async function completeEnrollment(
  principal: Principal,
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  const user = await User.findById(principal.id).select(
    '+totpSecret +totpRecoveryCodes totpEnabled',
  );
  if (!user?.totpSecret) throw ApiError.badRequest();

  if (!verifyTotp(user.totpSecret, code)) {
    throw ApiError.badRequest('errors.totp_invalid', [{ path: 'code', message: 'totp_invalid' }]);
  }

  // Plaintext is returned exactly once; only hashes are persisted.
  const recoveryCodes = Array.from({ length: 8 }, () => randomToken(6).slice(0, 10).toUpperCase());
  user.totpRecoveryCodes = recoveryCodes.map(hashToken);
  user.totpEnabled = true;
  user.tokenVersion += 1;
  await user.save();

  return { recoveryCodes };
}

export async function disableTotp(principal: Principal, code: string): Promise<void> {
  const user = await User.findById(principal.id).select(
    '+totpSecret +totpRecoveryCodes totpEnabled',
  );
  if (!user?.totpEnabled) throw ApiError.badRequest();

  const validTotp = verifyTotp(user.totpSecret ?? '', code);
  const validRecovery = await consumeRecoveryCode(user.totpRecoveryCodes ?? [], code);

  if (!validTotp && !validRecovery.matched) {
    throw ApiError.badRequest('errors.totp_invalid', [{ path: 'code', message: 'totp_invalid' }]);
  }

  user.totpEnabled = false;
  user.totpSecret = null;
  user.totpRecoveryCodes = [];
  user.tokenVersion += 1;
  await user.save();
}

async function consumeRecoveryCode(
  hashes: string[],
  candidate: string,
): Promise<{ matched: boolean; remaining: string[] }> {
  const candidateHash = hashToken(candidate.trim().toUpperCase());
  const index = hashes.findIndex((stored) => safeEqual(stored, candidateHash));
  if (index === -1) return { matched: false, remaining: hashes };
  return { matched: true, remaining: hashes.filter((_, position) => position !== index) };
}
