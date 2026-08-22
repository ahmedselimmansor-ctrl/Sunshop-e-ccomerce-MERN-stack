import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { nanoid } from 'nanoid';

import { env } from '../config/env';
import { redis } from '../db/redis';
import { moduleLogger } from '../observability/logger';
import { parseDurationSeconds } from '../utils/duration';

import { hashToken, randomToken, safeEqual } from './crypto';

import type { Role } from '@sunshop/shared';

const log = moduleLogger('tokens');

/**
 * Token strategy
 * ──────────────
 * **Access token**: a short-lived (15 min) JWT. Stateless, so the hot path
 * needs no database or Redis read. It carries `ver`, the user's token version;
 * bumping that column instantly invalidates every outstanding access token for
 * that user (password change, role change, forced logout) without a
 * per-request revocation lookup.
 *
 * **Refresh token**: a long-lived *opaque* random string, never a JWT. Stored
 * in Redis hashed, so a Redis dump does not yield usable credentials. Every use
 * rotates it.
 *
 * **Reuse detection**: rotated tokens are remembered briefly. If an old token
 * is presented again, either the user's token was stolen and replayed or the
 * attacker's was; the API cannot tell which, so it revokes the entire session
 * family and forces re-authentication. This is the standard defence for
 * refresh-token theft (OAuth 2.0 BCP §4.13.2).
 */

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  sid: string;
  roles: Role[];
  ver: number;
}

export interface SessionRecord {
  userId: string;
  familyId: string;
  tokenHash: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  rememberMe: boolean;
}

const sessionKey = (sessionId: string) => `session:${sessionId}`;
const userSessionsKey = (userId: string) => `sessions:${userId}`;
const usedTokenKey = (tokenHash: string) => `rt:used:${tokenHash}`;
const familyKey = (familyId: string) => `family:${familyId}`;

export function signAccessToken(payload: {
  userId: string;
  sessionId: string;
  roles: Role[];
  tokenVersion: number;
}): { token: string; expiresIn: number } {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithm: 'HS256',
    subject: payload.userId,
  };

  const token = jwt.sign(
    { sid: payload.sessionId, roles: payload.roles, ver: payload.tokenVersion },
    env.JWT_ACCESS_SECRET,
    options,
  );

  return { token, expiresIn: parseDurationSeconds(env.JWT_ACCESS_TTL) };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithms: ['HS256'],
  }) as AccessTokenPayload;
}

export interface IssueSessionInput {
  userId: string;
  roles: Role[];
  tokenVersion: number;
  userAgent?: string | null;
  ip?: string | null;
  rememberMe?: boolean;
  /** Present when rotating an existing session; keeps the family stable. */
  familyId?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
  refreshExpiresAt: number;
}

export async function issueSession(input: IssueSessionInput): Promise<IssuedSession> {
  const sessionId = nanoid(24);
  const familyId = input.familyId ?? nanoid(24);
  const refreshToken = randomToken(40);
  const tokenHash = hashToken(refreshToken);

  const ttlSeconds = parseDurationSeconds(input.rememberMe ? env.JWT_REFRESH_TTL : '1d');
  const now = Date.now();

  const record: SessionRecord = {
    userId: input.userId,
    familyId,
    tokenHash,
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + ttlSeconds * 1000,
    rememberMe: Boolean(input.rememberMe),
  };

  const pipeline = redis.pipeline();
  pipeline.set(sessionKey(sessionId), JSON.stringify(record), 'EX', ttlSeconds);
  pipeline.sadd(userSessionsKey(input.userId), sessionId);
  pipeline.expire(userSessionsKey(input.userId), ttlSeconds);
  pipeline.sadd(familyKey(familyId), sessionId);
  pipeline.expire(familyKey(familyId), ttlSeconds);
  await pipeline.exec();

  const { token: accessToken, expiresIn } = signAccessToken({
    userId: input.userId,
    sessionId,
    roles: input.roles,
    tokenVersion: input.tokenVersion,
  });

  return { accessToken, refreshToken, sessionId, expiresIn, refreshExpiresAt: record.expiresAt };
}

export async function getSession(sessionId: string): Promise<SessionRecord | null> {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

export type RotateResult =
  | { outcome: 'ok'; session: IssuedSession; userId: string; familyId: string }
  | { outcome: 'invalid' }
  | { outcome: 'expired' }
  | { outcome: 'reuse_detected'; userId: string };

/**
 * Validates and rotates a refresh token. The caller supplies the *current*
 * roles/tokenVersion (read from the database) so a role change takes effect on
 * the next refresh rather than at the next full login.
 */
export async function rotateRefreshToken(
  sessionId: string,
  presentedToken: string,
  current: { roles: Role[]; tokenVersion: number; userAgent?: string | null; ip?: string | null },
): Promise<RotateResult> {
  const presentedHash = hashToken(presentedToken);

  // A previously-rotated token is being replayed → the family is compromised.
  const replayedFamily = await redis.get(usedTokenKey(presentedHash));
  if (replayedFamily) {
    const userId = await revokeFamily(replayedFamily);
    log.warn({ familyId: replayedFamily, userId }, 'refresh token reuse detected; family revoked');
    return { outcome: 'reuse_detected', userId: userId ?? '' };
  }

  const session = await getSession(sessionId);
  if (!session) return { outcome: 'invalid' };
  if (session.expiresAt <= Date.now()) {
    await revokeSession(sessionId);
    return { outcome: 'expired' };
  }
  if (!safeEqual(session.tokenHash, presentedHash)) {
    // Right session, wrong secret: also treat as a compromise signal.
    await revokeFamily(session.familyId);
    log.warn({ sessionId, familyId: session.familyId }, 'refresh token mismatch; family revoked');
    return { outcome: 'reuse_detected', userId: session.userId };
  }

  // Remember the spent token for the remaining lifetime of the session so a
  // replay after rotation is caught by the check above.
  const remainingSeconds = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
  await redis.set(usedTokenKey(presentedHash), session.familyId, 'EX', remainingSeconds);

  await revokeSession(sessionId, { keepFamily: true });

  const issued = await issueSession({
    userId: session.userId,
    roles: current.roles,
    tokenVersion: current.tokenVersion,
    userAgent: current.userAgent ?? session.userAgent,
    ip: current.ip ?? session.ip,
    rememberMe: session.rememberMe,
    familyId: session.familyId,
  });

  return { outcome: 'ok', session: issued, userId: session.userId, familyId: session.familyId };
}

export async function revokeSession(
  sessionId: string,
  options: { keepFamily?: boolean } = {},
): Promise<void> {
  const session = await getSession(sessionId);
  const pipeline = redis.pipeline();
  pipeline.del(sessionKey(sessionId));
  if (session) {
    pipeline.srem(userSessionsKey(session.userId), sessionId);
    if (!options.keepFamily) pipeline.srem(familyKey(session.familyId), sessionId);
  }
  await pipeline.exec();
}

/** Revokes every session in a family. Returns the owning user id, if known. */
export async function revokeFamily(familyId: string): Promise<string | null> {
  const sessionIds = await redis.smembers(familyKey(familyId));
  let userId: string | null = null;

  for (const sessionId of sessionIds) {
    const session = await getSession(sessionId);
    if (session) userId = session.userId;
    await revokeSession(sessionId, { keepFamily: true });
  }
  await redis.del(familyKey(familyId));
  return userId;
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const sessionIds = await redis.smembers(userSessionsKey(userId));
  const pipeline = redis.pipeline();
  for (const sessionId of sessionIds) pipeline.del(sessionKey(sessionId));
  pipeline.del(userSessionsKey(userId));
  await pipeline.exec();
  return sessionIds.length;
}

export async function listSessions(userId: string): Promise<(SessionRecord & { id: string })[]> {
  const sessionIds = await redis.smembers(userSessionsKey(userId));
  const sessions = await Promise.all(
    sessionIds.map(async (id) => {
      const record = await getSession(id);
      return record ? { ...record, id } : null;
    }),
  );
  return sessions
    .filter((entry): entry is SessionRecord & { id: string } => entry !== null)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function touchSession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  session.lastUsedAt = Date.now();
  const ttl = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
  await redis.set(sessionKey(sessionId), JSON.stringify(session), 'EX', ttl);
}
