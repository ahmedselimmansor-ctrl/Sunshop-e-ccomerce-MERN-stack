import {
  CACHE_TTL,
  createCategorySchema,
  idParamSchema,
  reorderCategoriesSchema,
  updateCategorySchema,
  type CreateCategoryInput,
  type ReorderCategoriesInput,
  type UpdateCategoryInput,
} from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';

import { optionalAuth, authenticate } from '../../middleware/auth';
import { writeRateLimit } from '../../middleware/rateLimit';
import { requirePermission } from '../../middleware/rbac';
import { body, params, validate } from '../../middleware/validate';
import { asyncHandler, created, noContent, ok, setPublicCache } from '../../utils/http';

import * as service from './category.service';

const router = Router();

router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.principal.isStaff) setPublicCache(res, CACHE_TTL.categoryTree);
    return ok(res, await service.listCategories(req.principal));
  }),
);

router.get(
  '/tree',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.principal.isStaff) setPublicCache(res, CACHE_TTL.categoryTree);
    return ok(res, await service.getCategoryTree(req.principal));
  }),
);

router.get(
  '/:idOrSlug',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.principal.isStaff) setPublicCache(res, CACHE_TTL.categoryTree);
    return ok(res, await service.getCategory(req.principal, req.params.idOrSlug!));
  }),
);

router.post(
  '/',
  authenticate,
  requirePermission('category:write'),
  writeRateLimit,
  validate({ body: createCategorySchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.createCategory(req.principal, body<CreateCategoryInput>(req))),
  ),
);

router.patch(
  '/reorder',
  authenticate,
  requirePermission('category:write'),
  writeRateLimit,
  validate({ body: reorderCategoriesSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.reorderCategories(req.principal, body<ReorderCategoriesInput>(req));
    return noContent(res);
  }),
);

router.patch(
  '/:id',
  authenticate,
  requirePermission('category:write'),
  writeRateLimit,
  validate({ params: idParamSchema, body: updateCategorySchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.updateCategory(
        req.principal,
        params<{ id: string }>(req).id,
        body<UpdateCategoryInput>(req),
      ),
    ),
  ),
);

router.delete(
  '/:id',
  authenticate,
  requirePermission('category:delete'),
  writeRateLimit,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteCategory(req.principal, params<{ id: string }>(req).id);
    return noContent(res);
  }),
);

export const categoryRoutes = router;
