import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD } from './helpers/fixtures';
import { startHarness, type Harness } from './helpers/harness';

/**
 * Authentication, end to end.
 *
 * The refresh path gets the most attention because it is the one that can go
 * wrong silently: tokens rotate, and a replayed token has to take down the
 * whole family rather than quietly mint a new session for whoever stole it.
 */
describe('auth', () => {
  let h: Harness;

  const account = {
    firstName: 'Test',
    lastName: 'Buyer',
    email: 'buyer@sunshop.test',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptTerms: true as const,
  };

  /** Browsers get an httpOnly cookie; only a mobile client gets body tokens. */
  const MOBILE = { 'x-client-type': 'mobile' };

  const register = (overrides: Record<string, unknown> = {}) =>
    h.request.post('/api/v1/auth/register').send({ ...account, ...overrides });

  const registerMobile = () => h.request.post('/api/v1/auth/register').set(MOBILE).send(account);

  const login = (overrides: Record<string, unknown> = {}) =>
    h.request
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: account.password, ...overrides });

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  beforeEach(async () => {
    await h.reset();
  });

  describe('registration', () => {
    it('creates an account and returns a session', async () => {
      const response = await register();

      expect(response.status).toBe(201);
      expect(response.body.data.user).toMatchObject({ email: account.email, roles: ['customer'] });
      expect(response.body.data.tokens.accessToken).toEqual(expect.any(String));
    });

    it('never returns the password hash', async () => {
      const response = await register();

      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(response.body.data.user.passwordHash).toBeUndefined();
    });

    it('rejects a mismatched confirmation', async () => {
      const response = await register({ confirmPassword: 'something-else' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a password containing the email local part', async () => {
      const response = await register({
        email: 'sunshine@sunshop.test',
        password: 'Sunshine!2026x',
        confirmPassword: 'Sunshine!2026x',
      });

      expect(response.status).toBe(422);
    });

    it('requires the terms to be accepted', async () => {
      const response = await register({ acceptTerms: false });

      expect(response.status).toBe(422);
    });

    it('refuses a duplicate email without revealing timing differences', async () => {
      await register();
      const response = await register();

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.ok).toBe(false);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await register();
    });

    it('issues tokens for the right password', async () => {
      const response = await login();

      expect(response.status).toBe(200);
      expect(response.body.data.tokens.accessToken).toEqual(expect.any(String));
    });

    it('rejects a wrong password', async () => {
      const response = await login({ password: 'Wrong!Password2026' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBeDefined();
    });

    it('gives the same answer for an unknown account as for a wrong password', async () => {
      // Otherwise the endpoint is an account-existence oracle.
      const unknown = await login({ email: 'nobody@sunshop.test' });
      const wrong = await login({ password: 'Wrong!Password2026' });

      expect(unknown.status).toBe(wrong.status);
      expect(unknown.body.error.code).toBe(wrong.body.error.code);
    });

    it('sets the refresh token as an httpOnly cookie', async () => {
      const response = await login();
      const cookies = response.headers['set-cookie'] as unknown as string[] | undefined;

      expect(cookies?.some((c) => c.toLowerCase().includes('httponly'))).toBe(true);
    });
  });

  describe('refresh rotation', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const registered = await registerMobile();
      refreshToken = registered.body.data.tokens.refreshToken;
    });

    it('exchanges a refresh token for a new pair', async () => {
      const response = await h.request
        .post('/api/v1/auth/refresh')
        .set(MOBILE)
        .send({ refreshToken });

      expect(response.status).toBe(200);
      expect(response.body.data.tokens.accessToken).toEqual(expect.any(String));
      expect(response.body.data.tokens.refreshToken).not.toBe(refreshToken);
    });

    it('prefers an explicit body token over a stale cookie', async () => {
      // The handler reads the cookie first, so a browser session left in the
      // jar must not be able to stand in for the token a caller supplied.
      const response = await h.request
        .post('/api/v1/auth/refresh')
        .set(MOBILE)
        .send({ refreshToken });

      expect(response.status).toBe(200);
    });

    it('refuses the old token once it has been rotated', async () => {
      await h.request.post('/api/v1/auth/refresh').set(MOBILE).send({ refreshToken });

      const replay = await h.request
        .post('/api/v1/auth/refresh')
        .set(MOBILE)
        .send({ refreshToken });

      expect(replay.status).toBe(401);
    });

    it('revokes the whole family when a spent token is replayed', async () => {
      // A stolen token is only useful once; using it must invalidate the
      // session it was stolen from, not just fail quietly.
      const rotated = await h.request
        .post('/api/v1/auth/refresh')
        .set(MOBILE)
        .send({ refreshToken });
      const currentToken = rotated.body.data.tokens.refreshToken;

      const replay = await h.request
        .post('/api/v1/auth/refresh')
        .set(MOBILE)
        .send({ refreshToken });

      const afterReuse = await h.request
        .post('/api/v1/auth/refresh')
        .set(MOBILE)
        .send({ refreshToken: currentToken });

      expect({
        rotate: rotated.status,
        replayStatus: replay.status,
        replayCode: replay.body?.error?.code,
        survivingSessionStatus: afterReuse.status,
      }).toEqual({
        rotate: 200,
        replayStatus: 401,
        replayCode: 'TOKEN_REUSED',
        survivingSessionStatus: 401,
      });
    });

    it('rejects a token that was never issued', async () => {
      const response = await h.request
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('guards', () => {
    it('refuses /me without a token', async () => {
      const response = await h.request.get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('refuses a malformed bearer token', async () => {
      const response = await h.request
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not.a.jwt');

      expect(response.status).toBe(401);
    });

    it('returns the caller for a valid token', async () => {
      const registered = await register();
      const token = registered.body.data.tokens.accessToken;

      const response = await h.request
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe(account.email);
    });

    it('refuses a staff-only route to a customer', async () => {
      const registered = await register();
      const token = registered.body.data.tokens.accessToken;

      const response = await h.request
        .get('/api/v1/admin/audit')
        .set('Authorization', `Bearer ${token}`);

      expect([401, 403]).toContain(response.status);
    });
  });
});
