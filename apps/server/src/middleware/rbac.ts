import { STAFF_ROLES, type Permission, type Role } from '@sunshop/shared';

import { moduleLogger } from '../observability/logger';
import { ApiError } from '../utils/ApiError';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

const log = moduleLogger('rbac');

/**
 * Permission gates.
 *
 * These answer "may this *kind* of caller perform this verb at all". They do
 * **not** answer "may this caller touch this particular row": that is the job
 * of the ownership scopes in `security/dataAccess.ts`, applied inside the
 * services. Both layers are required: `order:read:any` without a scope would
 * let support read any order (correct), while `order:read:own` without a scope
 * would let a customer read *every* order by id (catastrophic).
 */

function deny(req: Request, required: string): never {
  log.warn(
    {
      userId: req.principal.id,
      roles: req.principal.roles,
      required,
      path: req.originalUrl.split('?')[0],
    },
    'authorization denied',
  );
  // 401 when unauthenticated so the client knows to log in; 403 when the
  // caller is known but lacks the right.
  throw req.principal.isAuthenticated ? ApiError.forbidden() : ApiError.unauthorized();
}

export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.principal.canAll(permissions)) deny(req, permissions.join(','));
    next();
  };
}

export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.principal.canAny(permissions)) deny(req, permissions.join('|'));
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!roles.some((role) => req.principal.hasRole(role))) deny(req, roles.join('|'));
    next();
  };
}

/** Gate for the whole admin surface. */
export const requireStaff: RequestHandler = (req, _res, next) => {
  if (!req.principal.isStaff) deny(req, STAFF_ROLES.join('|'));
  next();
};

/**
 * Allows the request when the caller holds `elevated`, **or** holds `own` and
 * the route's resource belongs to them. `resolveOwnerId` runs only in the
 * second case, so the common admin path costs no extra query.
 */
export function requireOwnershipOr(
  elevated: Permission,
  own: Permission,
  resolveOwnerId: (req: Request) => Promise<string | null> | string | null,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.principal.can(elevated)) return next();
    if (!req.principal.can(own)) return deny(req, `${elevated}|${own}`);

    Promise.resolve(resolveOwnerId(req))
      .then((ownerId) => {
        if (!ownerId) throw ApiError.notFound();
        if (!req.principal.owns(ownerId)) {
          // 404 rather than 403: confirming that "order X exists but is not
          // yours" is itself an information leak.
          throw ApiError.notFound();
        }
        next();
      })
      .catch(next);
  };
}
