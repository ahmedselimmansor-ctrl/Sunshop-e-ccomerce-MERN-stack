import { idParamSchema, objectIdSchema, type ProductCard } from '@sunshop/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { env } from '../../config/env';
import { authenticate } from '../../middleware/auth';
import { writeRateLimit } from '../../middleware/rateLimit';
import { body, params, validate } from '../../middleware/validate';
import { Product } from '../../models/Product';
import { WishlistItem } from '../../models/WishlistItem';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler, created, noContent, ok, setPrivateNoStore } from '../../utils/http';
import { toProductCard } from '../products/product.mapper';

const router = Router();

/** A wishlist belongs to an account, so every route here requires one. */
router.use(authenticate, (_req, res, next) => {
  setPrivateNoStore(res);
  next();
});

/** Hard cap: a "wishlist" of ten thousand items is a scraper, not a shopper. */
const MAX_ITEMS = 200;

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.FEATURE_WISHLIST) throw ApiError.notFound();

    const entries = await WishlistItem.find({ user: req.principal.id })
      .sort({ addedAt: -1 })
      .limit(MAX_ITEMS)
      .lean();

    const products = await Product.find({
      _id: { $in: entries.map((entry) => entry.product) },
      status: 'active',
      deletedAt: null,
    }).lean();

    // Preserve the saved order; a product that has since been unpublished
    // simply drops out rather than rendering as a broken card.
    const byId = new Map(products.map((product) => [String(product._id), product]));
    const cards: ProductCard[] = entries
      .map((entry) => byId.get(String(entry.product)))
      .filter((product): product is NonNullable<typeof product> => Boolean(product))
      .map(toProductCard);

    return ok(res, cards);
  }),
);

/** Just the ids, for painting the heart icons on a catalogue page cheaply. */
router.get(
  '/ids',
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.FEATURE_WISHLIST) throw ApiError.notFound();

    const entries = await WishlistItem.find({ user: req.principal.id })
      .select('product')
      .limit(MAX_ITEMS)
      .lean();

    return ok(
      res,
      entries.map((entry) => String(entry.product)),
    );
  }),
);

router.post(
  '/',
  writeRateLimit,
  validate({ body: z.object({ productId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.FEATURE_WISHLIST) throw ApiError.notFound();

    const { productId } = body<{ productId: string }>(req);

    const product = await Product.findOne({
      _id: productId,
      status: 'active',
      deletedAt: null,
    })
      .select('_id')
      .lean();
    if (!product) throw ApiError.notFound();

    const count = await WishlistItem.countDocuments({ user: req.principal.id });
    if (count >= MAX_ITEMS) {
      throw ApiError.conflict('errors.conflict', [{ path: 'wishlist', message: 'too_many' }]);
    }

    // Upsert makes a double-tap on the heart a no-op instead of a 409.
    await WishlistItem.updateOne(
      { user: req.principal.id, product: productId },
      { $setOnInsert: { addedAt: new Date() } },
      { upsert: true },
    );

    return created(res, { productId });
  }),
);

router.delete(
  '/:id',
  writeRateLimit,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await WishlistItem.deleteOne({
      user: req.principal.id,
      product: params<{ id: string }>(req).id,
    });
    return noContent(res);
  }),
);

export const wishlistRoutes = router;
