import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { authRateLimit, emailRateLimit, writeRateLimit } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';

import * as controller from './auth.controller';

const router = Router();

/**
 * Every unauthenticated endpoint here is rate limited twice: by IP
 * (`authRateLimit`) and, where an email is involved, by address
 * (`emailRateLimit`). One stops a single noisy host; the other stops a
 * distributed attempt against one account, and also stops Sunshop being used as
 * a free mail cannon.
 */
router.post(
  '/register',
  authRateLimit,
  emailRateLimit((req) => (req.body as { email?: string })?.email),
  validate({ body: controller.schemas.register }),
  controller.registerHandler,
);

router.post(
  '/login',
  authRateLimit,
  validate({ body: controller.schemas.login }),
  controller.loginHandler,
);

router.post(
  '/refresh',
  authRateLimit,
  validate({ body: controller.schemas.refresh }),
  controller.refreshHandler,
);

router.post(
  '/logout',
  authenticate,
  validate({ body: controller.schemas.logout }),
  controller.logoutHandler,
);

router.get('/me', authenticate, controller.meHandler);

router.post(
  '/verify-email',
  authRateLimit,
  validate({ body: controller.schemas.verifyEmail }),
  controller.verifyEmailHandler,
);

router.post(
  '/resend-verification',
  authRateLimit,
  emailRateLimit((req) => (req.body as { email?: string })?.email),
  validate({ body: controller.schemas.resendVerification }),
  controller.resendVerificationHandler,
);

router.post(
  '/forgot-password',
  authRateLimit,
  emailRateLimit((req) => (req.body as { email?: string })?.email),
  validate({ body: controller.schemas.forgotPassword }),
  controller.forgotPasswordHandler,
);

router.post(
  '/reset-password',
  authRateLimit,
  validate({ body: controller.schemas.resetPassword }),
  controller.resetPasswordHandler,
);

router.post(
  '/change-password',
  authenticate,
  writeRateLimit,
  validate({ body: controller.schemas.changePassword }),
  controller.changePasswordHandler,
);

// ── Session management ──────────────────────────────────────────────────────
router.get('/sessions', authenticate, controller.listSessionsHandler);
router.delete('/sessions/:id', authenticate, writeRateLimit, controller.revokeSessionHandler);

// ── Two-factor ──────────────────────────────────────────────────────────────
router.post('/totp/begin', authenticate, writeRateLimit, controller.beginTotpHandler);
router.post(
  '/totp/complete',
  authenticate,
  writeRateLimit,
  validate({ body: controller.schemas.enableTotp }),
  controller.completeTotpHandler,
);
router.post(
  '/totp/disable',
  authenticate,
  writeRateLimit,
  validate({ body: controller.schemas.enableTotp }),
  controller.disableTotpHandler,
);

export const authRoutes = router;
