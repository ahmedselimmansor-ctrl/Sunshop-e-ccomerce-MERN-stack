import { describe, expect, it } from 'vitest';

import {
  blindIndex,
  decryptField,
  encryptField,
  hashToken,
  isEncrypted,
  randomToken,
  safeEqual,
} from '../../src/security/crypto';
import { parseDuration, parseDurationSeconds } from '../../src/utils/duration';

describe('field encryption', () => {
  it('round-trips a value', () => {
    const plaintext = '+201001234567';
    const ciphertext = encryptField(plaintext);

    expect(ciphertext).not.toContain(plaintext);
    expect(decryptField(ciphertext)).toBe(plaintext);
  });

  it('produces a different ciphertext each time', () => {
    // A deterministic ciphertext would leak which users share a phone number.
    const first = encryptField('same value');
    const second = encryptField('same value');

    expect(first).not.toBe(second);
    expect(decryptField(first)).toBe(decryptField(second));
  });

  it('rejects a tampered ciphertext', () => {
    const ciphertext = encryptField('sensitive');
    const parts = ciphertext.split(':');
    // Flip the last character of the payload. GCM must catch it.
    parts[3] = `${parts[3]!.slice(0, -1)}A`;

    expect(() => decryptField(parts.join(':'))).toThrow();
  });

  it('recognises its own envelope', () => {
    expect(isEncrypted(encryptField('x'))).toBe(true);
    expect(isEncrypted('+201001234567')).toBe(false);
  });

  it('builds a stable blind index for lookup', () => {
    // Same input, same index: that is what makes "find by phone" work.
    expect(blindIndex('+201001234567')).toBe(blindIndex('+201001234567'));
    expect(blindIndex('+201001234567')).not.toBe(blindIndex('+201009999999'));
  });
});

describe('tokens', () => {
  it('hashes deterministically', () => {
    const token = randomToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
  });

  it('compares in constant time and still compares correctly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('duration parsing', () => {
  it('parses the units the config uses', () => {
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('24h')).toBe(86_400_000);
    expect(parseDurationSeconds('30d')).toBe(2_592_000);
  });

  it('throws on a malformed value instead of yielding NaN', () => {
    // A silent NaN would mint a token with no expiry.
    expect(() => parseDuration('soon')).toThrow(/Invalid duration/);
    expect(() => parseDuration('15')).toThrow(/Invalid duration/);
    expect(() => parseDuration('0m')).toThrow(/Invalid duration/);
  });
});
