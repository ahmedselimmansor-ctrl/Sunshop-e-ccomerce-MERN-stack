import {
  CACHE_TTL,
  bulkProductActionSchema,
  createProductSchema,
  idParamSchema,
  productListQuerySchema,
  updateProductSchema,
  updateStockSchema,
  type CreateProductInput,
  type ProductListQuery,
  type UpdateProductInput,
  type UpdateStockInput,
} from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';

import { authenticate, optionalAuth } from '../../middleware/auth';
import { writeRateLimit } from '../../middleware/rateLimit';
import { requirePermission } from '../../middleware/rbac';
import { body, params, query, validate } from '../../middleware/validate';
import { asyncHandler, created, noContent, ok, setPublicCache } from '../../utils/http';

import * as service from './product.service';

const router = Router();

router.get(
  '/',
  optionalAuth,
  validate({ query: productListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.listProducts(req.principal, query<ProductListQuery>(req));

    if (!req.principal.isStaff) setPublicCache(res, CACHE_TTL.productList);
    if (result.degraded) res.setHeader('X-Search-Degraded', 'true');
    if (result.facets) res.setHeader('X-Facets', 'included');

    return res.status(200).json({
      ok: true,
      data: result.items,
      meta: result.meta,
      facets: result.facets,
    });
  }),
);

router.get(
  '/low-stock',
  authenticate,
  requirePermission('inventory:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const threshold = req.query.threshold ? Number(req.query.threshold) : undefined;
    return ok(res, await service.getLowStock(threshold));
  }),
);

router.get(
  '/:idOrSlug',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const product = await service.getProduct(req.principal, req.params.idOrSlug!);
    if (!req.principal.isStaff) {
      setPublicCache(res, CACHE_TTL.productDetail);
      service.recordProductView(product.id);
    }
    return ok(res, product);
  }),
);

router.get(
  '/:id/related',
  optionalAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPublicCache(res, CACHE_TTL.productList);
    return ok(res, await service.getRelatedProducts(params<{ id: string }>(req).id));
  }),
);

router.post(
  '/',
  authenticate,
  requirePermission('product:write'),
  writeRateLimit,
  validate({ body: createProductSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.createProduct(req.principal, body<CreateProductInput>(req))),
  ),
);

router.post(
  '/bulk',
  authenticate,
  requirePermission('product:write'),
  writeRateLimit,
  validate({ body: bulkProductActionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = body<{
      ids: string[];
      action: 'publish' | 'unpublish' | 'archive' | 'delete' | 'feature' | 'unfeature';
    }>(req);
    return ok(res, await service.bulkAction(req.principal, input.ids, input.action));
  }),
);

router.patch(
  '/:id',
  authenticate,
  requirePermission('product:write'),
  writeRateLimit,
  validate({ params: idParamSchema, body: updateProductSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.updateProduct(
        req.principal,
        params<{ id: string }>(req).id,
        body<UpdateProductInput>(req),
      ),
    ),
  ),
);

router.post(
  '/:id/stock',
  authenticate,
  requirePermission('inventory:write'),
  writeRateLimit,
  validate({ params: idParamSchema, body: updateStockSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.adjustStock(
        req.principal,
        params<{ id: string }>(req).id,
        body<UpdateStockInput>(req),
      ),
    ),
  ),
);

router.delete(
  '/:id',
  authenticate,
  requirePermission('product:delete'),
  writeRateLimit,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteProduct(req.principal, params<{ id: string }>(req).id);
    return noContent(res);
  }),
);

export const productRoutes = router;
