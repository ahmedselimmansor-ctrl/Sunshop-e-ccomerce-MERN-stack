import {
  changePasswordSchema,
  enableTotpSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from '@sunshop/shared';

import { env, isProduction } from '../../config/env';
import { translate } from '../../i18n/messages';
import { body } from '../../middleware/validate';
import { listSessions, revokeSession } from '../../security/tokens';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler, created, noContent, ok, setPrivateNoStore } from '../../utils/http';

import * as authService from './auth.service';
import * as totpService from './totp.service';

import type { CookieOptions, Request, Response } from 'express';

/**
 * Refresh tokens are delivered to browsers as an httpOnly cookie, never in the
 * JSON body: a token the JavaScript context cannot read is a token XSS cannot
 * steal. Native clients (the Kotlin app) get it in the body instead and store
 * it in the Android Keystore, since they have no cookie jar worth trusting.
 *
 * The cookie is scoped to the refresh path so it is not attached to every API
 * call, and `SameSite` blocks cross-site submission: the CSRF defence for a
 * cookie-bearing endpoint.
 */
const REFRESH_COOKIE = 'sunshop_rt';

function refreshCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE || isProduction,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN === 'localhost' ? undefined : env.COOKIE_DOMAIN,
    path: `${env.API_PREFIX}/auth`,
    maxAge: maxAgeMs,
  };
}

/** Cookie value is `<sessionId>.<token>` so one cookie carries both halves. */
function setRefreshCookie(
  res: Response,
  sessionId: string,
  token: string,
  rememberMe: boolean,
): void {
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  res.cookie(REFRESH_COOKIE, `${sessionId}.${token}`, refreshCookieOptions(maxAge));
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(0), maxAge: undefined });
}

function readRefreshCookie(req: Request): { sessionId: string; token: string } | null {
  const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (!raw) return null;
  const separator = raw.indexOf('.');
  if (separator <= 0) return null;
  return { sessionId: raw.slice(0, separator), token: raw.slice(separator + 1) };
}

/** True when the caller is a native client that wants tokens in the body. */
function wantsBodyTokens(req: Request): boolean {
  return req.get('x-client-type') === 'mobile';
}

function requestMeta(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

export const registerHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = body<RegisterInput>(req);
  const { auth, refreshToken } = await authService.register(input, requestMeta(req));

  setPrivateNoStore(res);
  if (wantsBodyTokens(req)) {
    return created(res, { ...auth, tokens: { ...auth.tokens, refreshToken } });
  }

  // The session id is embedded in the access token, but the cookie needs it
  // explicitly for the refresh call, so decode it from the issued session.
  const sessionId = decodeSessionId(auth.tokens.accessToken);
  setRefreshCookie(res, sessionId, refreshToken, false);
  return created(res, auth);
});

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = body<LoginInput>(req);
  const { auth, refreshToken } = await authService.login(input, requestMeta(req));

  setPrivateNoStore(res);
  if (wantsBodyTokens(req)) {
    return ok(res, { ...auth, tokens: { ...auth.tokens, refreshToken } });
  }

  setRefreshCookie(res, decodeSessionId(auth.tokens.accessToken), refreshToken, input.rememberMe);
  return ok(res, auth);
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const fromCookie = readRefreshCookie(req);
  const fromBody = (req.validated.body as { refreshToken?: string } | undefined)?.refreshToken;

  let sessionId: string;
  let token: string;

  if (fromCookie) {
    ({ sessionId, token } = fromCookie);
  } else if (fromBody) {
    const separator = fromBody.indexOf('.');
    if (separator <= 0) throw ApiError.unauthorized('errors.invalid_token');
    sessionId = fromBody.slice(0, separator);
    token = fromBody.slice(separator + 1);
  } else {
    throw ApiError.unauthorized('errors.authentication_required');
  }

  try {
    const { auth, refreshToken } = await authService.refresh(sessionId, token, requestMeta(req));
    setPrivateNoStore(res);

    if (wantsBodyTokens(req)) {
      const newSessionId = decodeSessionId(auth.tokens.accessToken);
      return ok(res, {
        ...auth,
        tokens: { ...auth.tokens, refreshToken: `${newSessionId}.${refreshToken}` },
      });
    }

    setRefreshCookie(res, decodeSessionId(auth.tokens.accessToken), refreshToken, true);
    return ok(res, auth);
  } catch (error) {
    // Any refresh failure invalidates the cookie; leaving a dead one in place
    // makes the client retry forever.
    clearRefreshCookie(res);
    throw error;
  }
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const { allDevices } = (req.validated.body as { allDevices?: boolean } | undefined) ?? {};
  await authService.logout(req.principal, Boolean(allDevices));
  clearRefreshCookie(res);
  return noContent(res);
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  setPrivateNoStore(res);
  return ok(res, await authService.getCurrentUser(req.principal));
});

export const verifyEmailHandler = asyncHandler(async (req: Request, res: Response) => {
  const { token } = body<{ token: string }>(req);
  await authService.verifyEmail(token);
  return ok(res, { message: translate('success.email_verified', req.locale) });
});

export const resendVerificationHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email } = body<{ email: string }>(req);
  await authService.resendVerification(email, req.locale);
  // Uniform response whether or not the address exists.
  return ok(res, { message: translate('success.reset_email_sent', req.locale) });
});

export const forgotPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email } = body<{ email: string }>(req);
  await authService.forgotPassword(email, req.locale);
  return ok(res, { message: translate('success.reset_email_sent', req.locale) });
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = body<{ token: string; password: string }>(req);
  await authService.resetPassword(token, password);
  clearRefreshCookie(res);
  return ok(res, { message: translate('success.password_reset', req.locale) });
});

export const changePasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  await authService.changePassword(req.principal, body<ChangePasswordInput>(req));
  return ok(res, { message: translate('success.password_changed', req.locale) });
});

export const listSessionsHandler = asyncHandler(async (req: Request, res: Response) => {
  setPrivateNoStore(res);
  const sessions = await listSessions(req.principal.id!);
  return ok(
    res,
    sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      ip: session.ip,
      createdAt: new Date(session.createdAt).toISOString(),
      lastUsedAt: new Date(session.lastUsedAt).toISOString(),
      current: session.id === req.principal.sessionId,
    })),
  );
});

export const revokeSessionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const sessions = await listSessions(req.principal.id!);
  // Only sessions that belong to the caller may be revoked here.
  if (!sessions.some((session) => session.id === id)) throw ApiError.notFound();

  await revokeSession(id);
  if (id === req.principal.sessionId) clearRefreshCookie(res);
  return noContent(res);
});

export const beginTotpHandler = asyncHandler(async (req: Request, res: Response) => {
  setPrivateNoStore(res);
  return ok(res, await totpService.beginEnrollment(req.principal));
});

export const completeTotpHandler = asyncHandler(async (req: Request, res: Response) => {
  const { code } = body<{ code: string }>(req);
  setPrivateNoStore(res);
  return ok(res, await totpService.completeEnrollment(req.principal, code));
});

export const disableTotpHandler = asyncHandler(async (req: Request, res: Response) => {
  const { code } = body<{ code: string }>(req);
  await totpService.disableTotp(req.principal, code);
  return noContent(res);
});

/** Reads the `sid` claim without verifying: the token was just minted here. */
function decodeSessionId(accessToken: string): string {
  const payload = accessToken.split('.')[1];
  if (!payload) return '';
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sid?: string;
    };
    return decoded.sid ?? '';
  } catch {
    return '';
  }
}

export const schemas = {
  register: registerSchema,
  login: loginSchema,
  refresh: refreshSchema,
  logout: logoutSchema,
  verifyEmail: verifyEmailSchema,
  resendVerification: resendVerificationSchema,
  forgotPassword: forgotPasswordSchema,
  resetPassword: resetPasswordSchema,
  changePassword: changePasswordSchema,
  enableTotp: enableTotpSchema,
};
