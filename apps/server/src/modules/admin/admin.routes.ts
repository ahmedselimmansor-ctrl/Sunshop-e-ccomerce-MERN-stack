import {
  analyticsRangeSchema,
  auditListQuerySchema,
  couponListQuerySchema,
  createCouponSchema,
  idParamSchema,
  updateCouponSchema,
  updateSettingsSchema,
  type AnalyticsRange,
  type CreateCouponInput,
  type UpdateCouponInput,
  type UpdateSettingsInput,
} from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';

import { authenticate } from '../../middleware/auth';
import { setMaintenanceMode } from '../../middleware/maintenance';
import { writeRateLimit } from '../../middleware/rateLimit';
import { requirePermission, requireStaff } from '../../middleware/rbac';
import { body, params, query, validate } from '../../middleware/validate';
import { AuditLog } from '../../models/AuditLog';
import { Settings, getSettings } from '../../models/Settings';
import { audit, diff } from '../../services/audit';
import { flushNamespace } from '../../services/cache';
import {
  asyncHandler,
  buildPaginationMeta,
  created,
  noContent,
  ok,
  paginated,
  setPrivateNoStore,
} from '../../utils/http';
import * as couponService from '../coupons/coupon.service';

import { exportOrdersCsv, getDashboard } from './analytics.service';

const router = Router();

// Nothing under /admin is ever cacheable or reachable by a customer.
router.use(authenticate, requireStaff, (_req, res, next) => {
  setPrivateNoStore(res);
  next();
});

// ── Dashboard ───────────────────────────────────────────────────────────────

router.get(
  '/dashboard',
  requirePermission('analytics:read'),
  validate({ query: analyticsRangeSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await getDashboard(query<AnalyticsRange>(req))),
  ),
);

router.get(
  '/export/orders.csv',
  requirePermission('analytics:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from
      ? new Date(String(req.query.from))
      : new Date(to.getTime() - 30 * 86_400_000);

    const csv = await exportOrdersCsv(from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="orders-${from.toISOString().slice(0, 10)}.csv"`,
    );
    // A UTF-8 BOM, written as an escape so it is visible in review: without
    // it Excel decodes Arabic column values as mojibake.
    return res.send(`\uFEFF${csv}`);
  }),
);

// ── Audit log ───────────────────────────────────────────────────────────────

router.get(
  '/audit',
  requirePermission('audit:read'),
  validate({ query: auditListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = query<{
      page: number;
      limit: number;
      action?: string;
      actorId?: string;
      targetId?: string;
      from?: Date;
      to?: Date;
    }>(req);

    const filter: Record<string, unknown> = {};
    if (input.action) filter.action = input.action;
    if (input.actorId) filter['actor.id'] = input.actorId;
    if (input.targetId) filter['target.id'] = input.targetId;
    if (input.from || input.to) {
      filter.at = {
        ...(input.from ? { $gte: input.from } : {}),
        ...(input.to ? { $lte: input.to } : {}),
      };
    }

    const [entries, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ at: -1 })
        .skip((input.page - 1) * input.limit)
        .limit(input.limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return paginated(
      res,
      entries.map((entry) => ({
        id: String(entry._id),
        action: entry.action,
        actor: {
          id: entry.actor?.id ? String(entry.actor.id) : null,
          email: entry.actor?.email ?? null,
          roles: entry.actor?.roles ?? [],
          ip: entry.actor?.ip ?? null,
          userAgent: entry.actor?.userAgent ?? null,
        },
        target: entry.target?.type ? entry.target : null,
        changes: entry.changes ?? null,
        reason: entry.reason ?? null,
        requestId: entry.requestId ?? null,
        at: new Date(entry.at).toISOString(),
      })),
      buildPaginationMeta(input.page, input.limit, total),
    );
  }),
);

// ── Store settings ──────────────────────────────────────────────────────────

router.get(
  '/settings',
  requirePermission('settings:read'),
  asyncHandler(async (_req: Request, res: Response) => ok(res, await getSettings())),
);

router.patch(
  '/settings',
  requirePermission('settings:write'),
  writeRateLimit,
  validate({ body: updateSettingsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = body<UpdateSettingsInput>(req);
    const before = await getSettings();

    const updated = await Settings.findByIdAndUpdate(
      'store',
      { ...input, updatedBy: req.principal.id },
      { new: true, upsert: true },
    ).lean();

    // Maintenance mode is mirrored into Redis so every pod sees it instantly.
    if (input.maintenanceMode !== undefined) {
      await setMaintenanceMode(input.maintenanceMode);
    }

    await flushNamespace('settings');

    audit({
      action: 'settings.updated',
      actor: req.principal,
      target: { type: 'settings', id: 'store' },
      changes: diff(before as Record<string, unknown>, input as Record<string, unknown>),
    });

    return ok(res, updated);
  }),
);

// ── Coupons ─────────────────────────────────────────────────────────────────

router.get(
  '/coupons',
  requirePermission('coupon:read'),
  validate({ query: couponListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = query<{
      page: number;
      limit: number;
      q?: string;
      isActive?: boolean;
      sort: string;
    }>(req);
    const result = await couponService.listCoupons(input);
    return paginated(res, result.items, buildPaginationMeta(input.page, input.limit, result.total));
  }),
);

router.post(
  '/coupons',
  requirePermission('coupon:write'),
  writeRateLimit,
  validate({ body: createCouponSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await couponService.createCoupon(req.principal, body<CreateCouponInput>(req))),
  ),
);

router.patch(
  '/coupons/:id',
  requirePermission('coupon:write'),
  writeRateLimit,
  validate({ params: idParamSchema, body: updateCouponSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await couponService.updateCoupon(
        req.principal,
        params<{ id: string }>(req).id,
        body<UpdateCouponInput>(req),
      ),
    ),
  ),
);

router.delete(
  '/coupons/:id',
  requirePermission('coupon:write'),
  writeRateLimit,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await couponService.deleteCoupon(req.principal, params<{ id: string }>(req).id);
    return noContent(res);
  }),
);

// ── Cache control ───────────────────────────────────────────────────────────

router.post(
  '/cache/flush',
  requirePermission('system:maintenance'),
  writeRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const namespace = String(req.query.namespace ?? '');
    if (
      !['product', 'products', 'category', 'categories', 'search', 'analytics'].includes(namespace)
    ) {
      return ok(res, { flushed: 0, note: 'unknown namespace' });
    }
    const flushed = await flushNamespace(namespace);
    return ok(res, { flushed });
  }),
);

export const adminRoutes = router;
