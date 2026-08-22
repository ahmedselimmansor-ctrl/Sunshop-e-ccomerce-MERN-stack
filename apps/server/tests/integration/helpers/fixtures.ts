import { type Types } from 'mongoose';

import { Category } from '@/models/Category';
import { Product } from '@/models/Product';
import { Settings } from '@/models/Settings';

/**
 * Catalogue fixtures.
 *
 * Written straight to the models rather than through the admin API: a cart
 * test should fail because the cart is broken, not because product creation
 * changed shape. The API's own contract is covered by the admin suite.
 */

export const PASSWORD = 'Sunshop!2026';

export async function seedCategory(overrides: Record<string, unknown> = {}) {
  return Category.create({
    name: { en: 'Shirts', ar: 'قمصان' },
    slug: 'shirts',
    path: 'shirts',
    depth: 0,
    position: 0,
    isActive: true,
    ...overrides,
  });
}

interface SeedProductOptions {
  slug?: string;
  status?: 'draft' | 'active' | 'archived';
  stock?: number;
  price?: number;
  categories?: Types.ObjectId[];
  isFeatured?: boolean;
}

export async function seedProduct(options: SeedProductOptions = {}) {
  const {
    slug = 'test-tee',
    status = 'active',
    stock = 10,
    price = 19_900,
    categories = [],
    isFeatured = false,
  } = options;

  return Product.create({
    name: { en: 'Test Tee', ar: 'تي شيرت' },
    slug,
    description: { en: 'A shirt for tests.', ar: 'قميص للاختبارات.' },
    categories,
    categoryPaths: [],
    tags: ['test'],
    images: [],
    options: [
      {
        code: 'size',
        name: { en: 'Size', ar: 'المقاس' },
        values: [
          { code: 's', label: { en: 'S', ar: 'صغير' } },
          { code: 'm', label: { en: 'M', ar: 'وسط' } },
        ],
      },
    ],
    variants: [
      {
        sku: `${slug.toUpperCase()}-S`,
        optionValues: { size: 's' },
        price: { amount: price, currency: 'USD' },
        stock,
        reserved: 0,
        lowStockThreshold: 2,
        stockPolicy: 'deny',
        isActive: true,
      },
      {
        sku: `${slug.toUpperCase()}-M`,
        optionValues: { size: 'm' },
        price: { amount: price, currency: 'USD' },
        stock,
        reserved: 0,
        lowStockThreshold: 2,
        stockPolicy: 'deny',
        isActive: true,
      },
    ],
    status,
    isFeatured,
    attributes: [],
    currency: 'USD',
    priceMin: price,
    priceMax: price,
    totalStock: stock * 2,
    publishedAt: status === 'active' ? new Date() : undefined,
  });
}

/** The store settings singleton, which several routes read on every request. */
export async function seedSettings(overrides: Record<string, unknown> = {}) {
  return Settings.findByIdAndUpdate(
    'store',
    {
      _id: 'store',
      storeName: { en: 'Sunshop', ar: 'صن شوب' },
      supportEmail: 'support@sunshop.test',
      defaultCurrency: 'USD',
      defaultLocale: 'en',
      shipsToCountries: ['EG', 'US'],
      taxRatePercent: 14,
      taxIncludedInPrices: false,
      maintenanceMode: false,
      ...overrides,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
