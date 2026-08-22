import { Router } from 'express';

import { env } from '../config/env';
import { getSettings } from '../models/Settings';
import { adminRoutes } from '../modules/admin/admin.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { cartRoutes } from '../modules/cart/cart.routes';
import { categoryRoutes } from '../modules/categories/category.routes';
import { mediaRoutes } from '../modules/media/media.routes';
import { orderRoutes } from '../modules/orders/order.routes';
import { paymentRoutes } from '../modules/payments/payment.routes';
import { productRoutes } from '../modules/products/product.routes';
import { reviewRoutes } from '../modules/reviews/review.routes';
import { searchRoutes } from '../modules/search/search.routes';
import { userRoutes } from '../modules/users/user.routes';
import { wishlistRoutes } from '../modules/wishlist/wishlist.routes';
import { cached } from '../services/cache';
import { asyncHandler, ok, setPublicCache } from '../utils/http';

const router = Router();

/**
 * Public bootstrap payload.
 *
 * One request that gives a cold client everything it needs to render: store
 * name, currency, locales, announcement bar, feature flags. Without it the
 * first paint waits on four separate round trips.
 */
router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const config = await cached(
      'settings:public',
      async () => {
        const settings = await getSettings();
        return {
          storeName: settings.storeName,
          supportEmail: settings.supportEmail,
          supportPhone: settings.supportPhone,
          defaultCurrency: settings.defaultCurrency,
          defaultLocale: settings.defaultLocale,
          locales: ['en', 'ar'],
          shipsToCountries: settings.shipsToCountries,
          taxIncludedInPrices: settings.taxIncludedInPrices,
          freeShippingThreshold: settings.freeShippingThreshold,
          socialLinks: settings.socialLinks,
          announcement: settings.announcement,
          features: {
            reviews: env.FEATURE_REVIEWS,
            wishlist: env.FEATURE_WISHLIST,
            coupons: env.FEATURE_COUPONS,
            payments: env.PAYMENTS_ENABLED,
          },
          cdnBaseUrl: env.CDN_BASE_URL,
        };
      },
      { ttl: 300 },
    );

    setPublicCache(res, 300);
    return ok(res, config);
  }),
);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/categories', categoryRoutes);
router.use('/products', productRoutes);
router.use('/search', searchRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);
router.use('/reviews', reviewRoutes);
router.use('/media', mediaRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/admin', adminRoutes);

export const apiRoutes = router;
