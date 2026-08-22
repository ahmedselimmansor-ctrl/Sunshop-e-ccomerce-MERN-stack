import bcrypt from 'bcryptjs';

import { env } from '../config/env';

/**
 * Password hashing.
 *
 * bcrypt at cost 12 is the deliberate choice over argon2id here: it is a pure
 * JS dependency, so the container image needs no native toolchain and the same
 * artifact runs on arm64 Graviton nodes and x86 dev laptops. Cost is read from
 * config so it can be raised as hardware improves: `needsRehash()` upgrades
 * existing hashes transparently on the user's next successful login.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) {
    // Equalize timing for accounts that have no password (OAuth-only, deleted).
    await bcrypt.hash(plain, env.BCRYPT_ROUNDS);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

export function needsRehash(hash: string): boolean {
  const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  if (!match?.[1]) return true;
  return Number.parseInt(match[1], 10) < env.BCRYPT_ROUNDS;
}

/**
 * Small deny-list of passwords that pass the zod composition rules but are
 * still guessed in the first thousand attempts of any credential-stuffing run.
 * In production this is backed by a k-anonymity lookup against
 * Have I Been Pwned; the local list is the offline fallback.
 */
const COMMON_PASSWORDS = new Set([
  'password1',
  'password12',
  'password123',
  'passw0rd123',
  'qwerty12345',
  'welcome123',
  'admin12345',
  'letmein123',
  'iloveyou123',
  'sunshop123',
  'changeme123',
  'test1234567',
]);

export function isCommonPassword(plain: string): boolean {
  return COMMON_PASSWORDS.has(plain.toLowerCase());
}

/** Rejects passwords built from the user's own identifiers. */
export function containsPersonalData(
  plain: string,
  parts: readonly (string | null | undefined)[],
): boolean {
  const lower = plain.toLowerCase();
  return parts.some((part) => {
    const value = part?.toLowerCase().trim();
    return Boolean(value && value.length >= 4 && lower.includes(value));
  });
}
