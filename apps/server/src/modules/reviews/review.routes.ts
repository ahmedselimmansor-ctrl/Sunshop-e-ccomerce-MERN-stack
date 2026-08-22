import {
  createReviewSchema,
  idParamSchema,
  moderateReviewSchema,
  replyToReviewSchema,
  reviewListQuerySchema,
  updateReviewSchema,
  type CreateReviewInput,
  type ReviewListQuery,
} from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';

import { authenticate, optionalAuth, requireVerifiedEmail } from '../../middleware/auth';
import { writeRateLimit } from '../../middleware/rateLimit';
import { requirePermission } from '../../middleware/rbac';
import { body, params, query, validate } from '../../middleware/validate';
import { asyncHandler, created, noContent, ok, paginated, setPublicCache } from '../../utils/http';

import * as service from './review.service';

const router = Router();

router.get(
  '/',
  optionalAuth,
  validate({ query: reviewListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.listReviews(req.principal, query<ReviewListQuery>(req));
    if (!req.principal.isAuthenticated) setPublicCache(res, 120);
    return paginated(res, result.items, result.meta);
  }),
);

/**
 * Posting requires a verified email. Unverified accounts are free to create and
 * are therefore the cheapest possible review-spam vector.
 */
router.post(
  '/',
  authenticate,
  requireVerifiedEmail,
  requirePermission('review:create'),
  writeRateLimit,
  validate({ body: createReviewSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.createReview(req.principal, body<CreateReviewInput>(req))),
  ),
);

router.patch(
  '/:id',
  authenticate,
  writeRateLimit,
  validate({ params: idParamSchema, body: updateReviewSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.updateOwnReview(
        req.principal,
        params<{ id: string }>(req).id,
        body<Partial<CreateReviewInput>>(req),
      ),
    ),
  ),
);

router.delete(
  '/:id',
  authenticate,
  writeRateLimit,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteReview(req.principal, params<{ id: string }>(req).id);
    return noContent(res);
  }),
);

router.post(
  '/:id/helpful',
  authenticate,
  writeRateLimit,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.markHelpful(req.principal, params<{ id: string }>(req).id)),
  ),
);

// ── Moderation ──────────────────────────────────────────────────────────────

router.patch(
  '/:id/moderate',
  authenticate,
  requirePermission('review:moderate'),
  writeRateLimit,
  validate({ params: idParamSchema, body: moderateReviewSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = body<{ status: 'approved' | 'rejected' | 'pending'; moderationNote?: string }>(
      req,
    );
    return ok(
      res,
      await service.moderateReview(
        req.principal,
        params<{ id: string }>(req).id,
        input.status,
        input.moderationNote,
      ),
    );
  }),
);

router.post(
  '/:id/reply',
  authenticate,
  requirePermission('review:moderate'),
  writeRateLimit,
  validate({ params: idParamSchema, body: replyToReviewSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { body: replyBody } = body<{ body: string }>(req);
    return ok(
      res,
      await service.replyToReview(req.principal, params<{ id: string }>(req).id, replyBody),
    );
  }),
);

export const reviewRoutes = router;
