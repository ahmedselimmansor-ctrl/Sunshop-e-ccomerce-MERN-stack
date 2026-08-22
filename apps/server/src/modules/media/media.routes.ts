import {
  confirmUploadSchema,
  deleteMediaSchema,
  presignUploadSchema,
  type PresignUploadInput,
} from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';

import { authenticate } from '../../middleware/auth';
import { uploadRateLimit } from '../../middleware/rateLimit';
import { requireAnyPermission } from '../../middleware/rbac';
import { body, validate } from '../../middleware/validate';
import { audit } from '../../services/audit';
import {
  deleteObject,
  isValidKey,
  presignUpload,
  publicUrlFor,
  verifyUploaded,
  type UploadScope,
} from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler, noContent, ok, setPrivateNoStore } from '../../utils/http';

const router = Router();

router.use(authenticate);

/**
 * Which scopes each caller may write to.
 *
 * A customer must be able to upload an avatar and review photos; only staff may
 * write into the product/category/brand namespaces. Without this split, any
 * registered account could drop arbitrary images into the catalogue's
 * namespace and then reference them from a review.
 */
function allowedScopes(req: Request): UploadScope[] {
  const scopes: UploadScope[] = ['avatar', 'review'];
  if (req.principal.can('media:upload')) scopes.push('product', 'category', 'brand');
  return scopes;
}

router.post(
  '/presign',
  uploadRateLimit,
  validate({ body: presignUploadSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = body<PresignUploadInput>(req);

    if (!allowedScopes(req).includes(input.scope)) {
      throw ApiError.forbidden();
    }

    setPrivateNoStore(res);
    return ok(
      res,
      await presignUpload({
        scope: input.scope,
        contentType: input.contentType,
        size: input.size,
        ownerId: req.principal.id,
      }),
    );
  }),
);

/**
 * Confirms the object landed in S3 before its key is attached to a record.
 * A presigned URL that was never used would otherwise leave a product pointing
 * at a 404 image.
 */
router.post(
  '/confirm',
  uploadRateLimit,
  validate({ body: confirmUploadSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { key } = body<{ key: string }>(req);

    if (!isValidKey(key, allowedScopes(req))) throw ApiError.forbidden();

    const meta = await verifyUploaded(key);
    return ok(res, {
      key,
      url: publicUrlFor(key),
      size: meta.size,
      contentType: meta.contentType,
    });
  }),
);

router.delete(
  '/',
  requireAnyPermission('media:delete'),
  uploadRateLimit,
  validate({ body: deleteMediaSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { key } = body<{ key: string }>(req);

    if (!isValidKey(key, ['product', 'category', 'brand', 'review', 'avatar'])) {
      throw ApiError.badRequest();
    }

    await deleteObject(key);
    audit({
      action: 'media.deleted',
      actor: req.principal,
      target: { type: 'media', id: key },
    });

    return noContent(res);
  }),
);

export const mediaRoutes = router;
