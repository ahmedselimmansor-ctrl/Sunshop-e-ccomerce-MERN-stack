import {
  CACHE_TTL,
  cacheKeys,
  searchQuerySchema,
  suggestQuerySchema,
  type SearchQuery,
  type Suggestion,
} from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';

import { authenticate, optionalAuth } from '../../middleware/auth';
import { searchRateLimit, writeRateLimit } from '../../middleware/rateLimit';
import { requirePermission } from '../../middleware/rbac';
import { query, validate } from '../../middleware/validate';
import { moduleLogger } from '../../observability/logger';
import { isSearchAvailable } from '../../search/client';
import { recordSearchTerm, suggest } from '../../search/productIndex';
import { cached, queryHash } from '../../services/cache';
import { publicUrlFor } from '../../services/storage';
import { asyncHandler, ok, setPublicCache } from '../../utils/http';
import { listProducts } from '../products/product.service';

const log = moduleLogger('search:routes');

const router = Router();

/**
 * Full-text search.
 *
 * Rate limited more tightly than plain catalogue reads because each call fans
 * out to Elasticsearch, and cached briefly: search traffic follows a heavy
 * head (a handful of terms dominate), so a 60-second cache removes most of the
 * cluster load for no perceptible staleness.
 */
router.get(
  '/',
  optionalAuth,
  searchRateLimit,
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = query<SearchQuery>(req);

    const result = await listProducts(req.principal, { ...input, sort: input.sort });

    // Analytics: what people search for, and what returns nothing.
    void recordSearchTerm(input.q, req.locale, result.meta.total).catch(() => undefined);

    if (!req.principal.isStaff) setPublicCache(res, CACHE_TTL.search);
    if (result.degraded) res.setHeader('X-Search-Degraded', 'true');

    return res.status(200).json({
      ok: true,
      data: result.items,
      meta: result.meta,
      facets: result.facets,
      query: input.q,
    });
  }),
);

/**
 * Search-as-you-type. Hit on nearly every keystroke, so it is deliberately
 * cheap: a small result set, a short cache, and a hard failure mode of "empty
 * list" rather than an error: a broken dropdown must not break the header.
 */
router.get(
  '/suggest',
  searchRateLimit,
  validate({ query: suggestQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { q, limit } = query<{ q: string; limit: number }>(req);

    if (!isSearchAvailable()) return ok(res, [] as Suggestion[]);

    const suggestions = await cached(
      cacheKeys.search(queryHash({ suggest: q, locale: req.locale, limit })),
      async () => {
        try {
          const hits = await suggest(q, req.locale, limit);
          return hits.map<Suggestion>((hit) => ({
            type: hit.type,
            text: hit.text,
            slug: hit.slug,
            imageUrl: publicUrlFor(hit.imageKey ?? null),
          }));
        } catch (error) {
          log.warn({ err: (error as Error).message }, 'suggest failed');
          return [] as Suggestion[];
        }
      },
      { ttl: 120 },
    );

    setPublicCache(res, 60);
    return ok(res, suggestions);
  }),
);

/** Triggers a full reindex. Long-running, so it returns immediately. */
router.post(
  '/reindex',
  authenticate,
  requirePermission('search:reindex'),
  writeRateLimit,
  asyncHandler(async (_req: Request, res: Response) => {
    const { reindexAll } = await import('../../search/reindex');
    void reindexAll().catch((error: Error) => log.error({ err: error.message }, 'reindex failed'));
    return res.status(202).json({ ok: true, data: { started: true } });
  }),
);

export const searchRoutes = router;
