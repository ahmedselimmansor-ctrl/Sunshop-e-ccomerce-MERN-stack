import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { env } from '../config/env';

/**
 * Cryptographic primitives.
 *
 * Field-level encryption (AES-256-GCM) protects PII that must remain readable
 * by the application: phone numbers, addresses on historical orders: beyond
 * the at-rest encryption DocumentDB already provides with KMS. The threat model
 * is a leaked backup or an over-broad read role, not a compromised pod: the pod
 * necessarily holds the key.
 *
 * The key comes from Secrets Manager and is rotated by re-encrypting in a
 * background job; the version prefix on every ciphertext makes that possible
 * without a flag day.
 */

const KEY_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('FIELD_ENCRYPTION_KEY is not configured; cannot encrypt PII');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)');
  }
  cachedKey = key;
  return key;
}

export function canEncrypt(): boolean {
  return Boolean(env.FIELD_ENCRYPTION_KEY);
}

/** Returns `v1:<iv>:<tag>:<ciphertext>`, all base64url. */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    KEY_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptField(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(':');
  if (version !== KEY_VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed ciphertext');
  }
  const tag = Buffer.from(tagPart, 'base64url');
  if (tag.length !== TAG_BYTES) throw new Error('Malformed auth tag');

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** True when a stored value looks like our ciphertext envelope. */
export function isEncrypted(value: string): boolean {
  return /^v\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Deterministic blind index for encrypted fields that must still be searchable
 * (e.g. "find the account with this phone number"). HMAC, not a plain hash, so
 * an attacker with the database cannot brute-force the small phone-number
 * keyspace without also holding the key.
 */
export function blindIndex(value: string): string {
  return createHmac('sha256', encryptionKey())
    .update(value.trim().toLowerCase())
    .digest('base64url');
}

/** Opaque, URL-safe random token for email verification / password reset. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens are stored hashed. A leaked database then yields no usable reset
 * links, and SHA-256 is appropriate here (unlike passwords) because the input
 * already has 256 bits of entropy: there is nothing to brute force.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    // Still perform a comparison to keep the timing profile flat.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Short, stable hash used for cache keys and ETags. */
export function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('base64url').slice(0, 16);
}

export const uuid = randomUUID;
