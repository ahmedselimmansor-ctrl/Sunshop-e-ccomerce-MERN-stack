import { ERROR_CODES, type Role } from '@sunshop/shared';
import jsonwebtoken from 'jsonwebtoken';

import { User } from '../models/User';
import { setContextValues } from '../observability/context';
import { moduleLogger } from '../observability/logger';
import { Principal } from '../security/principal';
import { getSession, verifyAccessToken, type AccessTokenPayload } from '../security/tokens';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/http';

import type { NextFunction, Request, Response } from 'express';

// `jsonwebtoken` is CommonJS: a named ESM import of its error classes fails at
// module-load time, so they are destructured from the default export instead.
const { JsonWebTokenError, TokenExpiredError } = jsonwebtoken;

const log = moduleLogger('auth');

/**
 * Resolves a bearer token into a `Principal`.
 *
 * The hot path is deliberately cheap: verify the JWT signature, then a single
 * Redis read to confirm the session still exists. The database is only touched
 * when the token's `ver` claim is stale, which happens once after a password or
 * role change and never again.
 */
async function resolvePrincipal(token: string): Promise<Principal> {
  let claims: AccessTokenPayload;
  try {
    claims = verifyAccessToken(token);
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw ApiError.unauthorized('errors.token_expired', ERROR_CODES.TOKEN_EXPIRED);
    }
    if (error instanceof JsonWebTokenError) {
      throw ApiError.unauthorized('errors.invalid_token');
    }
    throw error;
  }

  // A revoked session (logout, admin force-logout) disappears from Redis.
  const session = await getSession(claims.sid);
  if (!session || session.userId !== claims.sub) {
    throw ApiError.unauthorized('errors.session_revoked');
  }

  const user = await User.findById(claims.sub)
    .select('email roles status tokenVersion suspendedUntil deletedAt')
    .lean();

  if (!user || user.deletedAt) {
    throw ApiError.unauthorized('errors.account_not_found');
  }
  if (user.tokenVersion !== claims.ver) {
    // Credentials or roles changed after this token was minted.
    throw ApiError.unauthorized('errors.token_stale', ERROR_CODES.TOKEN_EXPIRED);
  }
  if (user.status === 'suspended') {
    const stillSuspended = !user.suspendedUntil || user.suspendedUntil.getTime() > Date.now();
    if (stillSuspended) throw ApiError.forbidden('errors.account_suspended');
  }

  return Principal.forUser({
    id: String(user._id),
    email: user.email,
    roles: user.roles as Role[],
    sessionId: claims.sid,
  });
}

function extractToken(req: Request): string | null {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  // Web clients may also present the access token as a cookie when the SPA is
  // served from the same site; the CSRF defence for that is SameSite=strict.
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.access_token;
  return cookieToken ?? null;
}

/** Requires a valid session. Rejects with 401 otherwise. */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized('errors.authentication_required');

    req.principal = await resolvePrincipal(token);
    setContextValues({
      userId: req.principal.id ?? undefined,
      sessionId: req.principal.sessionId ?? undefined,
      roles: req.principal.roles,
    });
    next();
  },
);

/**
 * Attaches a principal when a valid token is present, but never rejects.
 * Used on endpoints that serve both guests and members (product pages, cart):
 * an expired token there should degrade to anonymous, not 401 the storefront.
 */
export const optionalAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) return next();

    try {
      req.principal = await resolvePrincipal(token);
      setContextValues({
        userId: req.principal.id ?? undefined,
        sessionId: req.principal.sessionId ?? undefined,
        roles: req.principal.roles,
      });
    } catch (error) {
      log.debug({ err: (error as Error).message }, 'optional auth failed; continuing anonymous');
      req.principal = Principal.anonymous();
    }
    next();
  },
);

/** Rejects anonymous callers with a verified-email requirement. */
export const requireVerifiedEmail = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.principal.isAuthenticated) throw ApiError.unauthorized();
    const user = await User.findById(req.principal.id).select('emailVerified').lean();
    if (!user?.emailVerified) {
      throw new ApiError(403, ERROR_CODES.EMAIL_NOT_VERIFIED, 'errors.email_not_verified');
    }
    next();
  },
);
