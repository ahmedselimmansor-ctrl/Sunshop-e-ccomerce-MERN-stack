import {
  adminUpdateUserSchema,
  adminUserListQuerySchema,
  assignRolesSchema,
  deleteAccountSchema,
  idParamSchema,
  updateProfileSchema,
  upsertAddressSchema,
  type AdminUpdateUserInput,
  type AdminUserListQuery,
  type Role,
  type SavedAddress,
  type UpdateProfileInput,
} from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';

import { authenticate } from '../../middleware/auth';
import { writeRateLimit } from '../../middleware/rateLimit';
import { requirePermission } from '../../middleware/rbac';
import { body, params, query, validate } from '../../middleware/validate';
import {
  asyncHandler,
  created,
  noContent,
  ok,
  paginated,
  setPrivateNoStore,
} from '../../utils/http';

import * as service from './user.service';

const router = Router();

router.use(authenticate);

// ── Self-service ────────────────────────────────────────────────────────────

router.get(
  '/me',
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    return ok(res, await service.getProfile(req.principal));
  }),
);

router.patch(
  '/me',
  writeRateLimit,
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    return ok(res, await service.updateProfile(req.principal, body<UpdateProfileInput>(req)));
  }),
);

router.delete(
  '/me',
  writeRateLimit,
  validate({ body: deleteAccountSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { password } = body<{ password: string }>(req);
    await service.deleteOwnAccount(req.principal, password);
    return noContent(res);
  }),
);

router.post(
  '/me/addresses',
  writeRateLimit,
  validate({ body: upsertAddressSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.addAddress(req.principal, body<SavedAddress>(req))),
  ),
);

router.patch(
  '/me/addresses/:addressId',
  writeRateLimit,
  validate({ body: upsertAddressSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.updateAddress(req.principal, req.params.addressId!, body<SavedAddress>(req)),
    ),
  ),
);

router.delete(
  '/me/addresses/:addressId',
  writeRateLimit,
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.deleteAddress(req.principal, req.params.addressId!)),
  ),
);

// ── Admin ───────────────────────────────────────────────────────────────────

router.get(
  '/',
  requirePermission('user:read:any'),
  validate({ query: adminUserListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    const result = await service.listUsers(req.principal, query<AdminUserListQuery>(req));
    return paginated(res, result.items, result.meta);
  }),
);

router.get(
  '/:id',
  requirePermission('user:read:any'),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    setPrivateNoStore(res);
    return ok(res, await service.getUser(req.principal, params<{ id: string }>(req).id));
  }),
);

router.patch(
  '/:id',
  requirePermission('user:write:any'),
  writeRateLimit,
  validate({ params: idParamSchema, body: adminUpdateUserSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.adminUpdateUser(
        req.principal,
        params<{ id: string }>(req).id,
        body<AdminUpdateUserInput>(req),
      ),
    ),
  ),
);

router.patch(
  '/:id/roles',
  requirePermission('role:assign'),
  writeRateLimit,
  validate({ params: idParamSchema, body: assignRolesSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = body<{ roles: Role[]; reason: string }>(req);
    return ok(
      res,
      await service.assignRoles(
        req.principal,
        params<{ id: string }>(req).id,
        input.roles,
        input.reason,
      ),
    );
  }),
);

export const userRoutes = router;
