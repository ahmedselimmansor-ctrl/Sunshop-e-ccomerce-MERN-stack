/* eslint-disable no-console */
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { slugify } from '@sunshop/shared';

import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongoose';
import { connectRedis, disconnectRedis } from '../db/redis';
import { Category } from '../models/Category';
import { Coupon } from '../models/Coupon';
import { Product } from '../models/Product';
import { Review } from '../models/Review';
import { Settings } from '../models/Settings';
import { User } from '../models/User';
import { hashPassword } from '../security/password';
import { flushNamespace } from '../services/cache';
import { s3 } from '../services/storage';

import { CATEGORY_TREE, SEED_PRODUCTS, type SeedCategory, type SeedProduct } from './seed-data';

/**
 * Development seed.
 *
 * Produces a store that is actually navigable: a real category tree, fifty-odd
 * products with variants and photography in both languages, one staff account
 * per role so RBAC can be exercised end to end, coupons covering each discount
 * type, and enough reviews for the rating aggregates to mean something.
 *
 * Images are downloaded from Unsplash and uploaded into the project's own
 * object storage, so the storefront serves them from its own CDN exactly as it
 * would in production. Already-uploaded objects are skipped, so a re-seed after
 * the first run takes seconds rather than minutes.
 *
 * Refuses to run against production. Seeding a live store with `demo@` accounts
 * that have known passwords is not a hypothetical accident.
 */
if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

const CURRENCY = env.DEFAULT_CURRENCY;
const DEMO_PASSWORD = 'Sunshop!2026';

/** Wide enough for the largest rendition the storefront asks for. */
const IMAGE_WIDTH = 1400;

// ── Media ───────────────────────────────────────────────────────────────────

const uploadCache = new Map<string, string>();

/**
 * Downloads one Unsplash photo and stores it in S3/MinIO under a stable key.
 *
 * Falls back to the remote URL if the download fails, because a seed that dies
 * on a flaky connection is worse than one that renders a hotlinked image: every
 * consumer of an image key already accepts an absolute URL.
 */
async function fetchAndStore(photoId: string, scope: string): Promise<string> {
  // Keyed by scope as well as id: the same photo can back both a category
  // banner and a product, and each belongs under its own prefix.
  const cacheKey = `${scope}:${photoId}`;
  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  const key = `${scope}/seed/${photoId}.jpg`;
  const remoteUrl = `https://images.unsplash.com/${photoId}?w=${IMAGE_WIDTH}&h=${IMAGE_WIDTH}&fit=crop&q=80&fm=jpg`;

  // Skip the download entirely if a previous run already uploaded it.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    uploadCache.set(cacheKey, key);
    return key;
  } catch {
    // Not there yet; fall through and upload.
  }

  try {
    const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`unsplash responded ${response.status}`);

    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: Buffer.from(await response.arrayBuffer()),
        ContentType: 'image/jpeg',
        // Keys are content-addressed by photo id and never rewritten.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    uploadCache.set(cacheKey, key);
    return key;
  } catch (error) {
    console.warn(`  could not store ${photoId} (${(error as Error).message}); linking remotely`);
    uploadCache.set(cacheKey, remoteUrl);
    return remoteUrl;
  }
}

// ── Variant generation ──────────────────────────────────────────────────────

/**
 * Builds one variant per combination of the declared option values.
 *
 * Stock is derived from the SKU index rather than randomised, so a re-seed
 * produces the same catalogue and yesterday's screenshot still matches.
 */
function buildVariants(product: SeedProduct, productIndex: number) {
  const options = product.options ?? [];

  const combinations = options.reduce<Record<string, string>[]>(
    (accumulator, option) =>
      accumulator.flatMap((partial) =>
        option.values.map((value) => ({ ...partial, [option.code]: value.code })),
      ),
    [{}],
  );

  return combinations.map((optionValues, variantIndex) => {
    // A deterministic spread: mostly healthy stock, a few low, one sold out per
    // larger product, so the low-stock badge and the out-of-stock path are both
    // visible without hand-editing the database.
    const seed = (productIndex * 7 + variantIndex * 13) % 23;
    const stock = seed === 0 ? 0 : seed < 3 ? seed + 1 : seed + 5;

    return {
      sku: `SN-${String(productIndex + 1).padStart(3, '0')}-${String(variantIndex + 1).padStart(3, '0')}`,
      optionValues,
      price: { amount: product.price, currency: CURRENCY },
      compareAtPrice: product.compareAt ? { amount: product.compareAt, currency: CURRENCY } : null,
      stock,
      reserved: 0,
      lowStockThreshold: 5,
      stockPolicy: 'deny' as const,
      isActive: true,
    };
  });
}

// ── Seed ────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  await connectMongo();
  await connectRedis();

  console.log('Clearing existing seed data');
  await Promise.all([
    User.deleteMany({ email: { $regex: /@sunshop\.demo$/ } }),
    Review.deleteMany({}),
    Product.deleteMany({}),
    Category.deleteMany({}),
    Coupon.deleteMany({}),
  ]);

  // ── Settings ──────────────────────────────────────────────────────────────
  await Settings.findByIdAndUpdate(
    'store',
    {
      storeName: { en: 'Sunshop', ar: 'صن شوب' },
      supportEmail: 'support@sunshop.demo',
      defaultCurrency: CURRENCY,
      defaultLocale: 'en',
      taxRatePercent: 14,
      taxIncludedInPrices: false,
      freeShippingThreshold: { amount: 200_000, currency: CURRENCY },
      shipsToCountries: ['EG', 'SA', 'AE', 'KW', 'QA'],
      announcement: {
        enabled: true,
        text: {
          en: 'Free standard shipping on orders over 2,000',
          ar: 'شحن عادي مجاني للطلبات فوق ٢٠٠٠',
        },
        href: '/products',
      },
    },
    { upsert: true, new: true },
  );

  // ── Categories ────────────────────────────────────────────────────────────
  console.log('Seeding categories');
  const categoryByName = new Map<string, { id: string; path: string }>();

  async function createCategory(
    node: SeedCategory,
    parent: { id: string; path: string } | null,
    position: number,
  ): Promise<void> {
    const imageKey = node.image ? await fetchAndStore(node.image, 'category') : null;

    const document = await Category.create({
      name: { en: node.en, ar: node.ar },
      slug: slugify(node.en),
      parent: parent?.id ?? null,
      path: parent ? `${parent.path}/${parent.id}` : '',
      depth: parent ? parent.path.split('/').filter(Boolean).length + 1 : 0,
      imageKey,
      position,
      isActive: true,
      showInNav: true,
    });

    const entry = { id: String(document._id), path: document.path };
    categoryByName.set(node.en, entry);

    for (const [index, child] of (node.children ?? []).entries()) {
      await createCategory(child, entry, index);
    }
  }

  for (const [index, node] of CATEGORY_TREE.entries()) {
    await createCategory(node, null, index);
  }

  // ── Products ──────────────────────────────────────────────────────────────
  console.log(`Seeding ${SEED_PRODUCTS.length} products and downloading photography`);

  const createdProducts: { id: string; index: number }[] = [];
  const usedSlugs = new Set<string>();

  for (const [index, seedProduct] of SEED_PRODUCTS.entries()) {
    const category = categoryByName.get(seedProduct.category);
    if (!category) {
      console.warn(`  unknown category "${seedProduct.category}" for ${seedProduct.en}`);
      continue;
    }

    const imageKeys = await Promise.all(
      seedProduct.images.map((photoId) => fetchAndStore(photoId, 'product')),
    );

    // Two products could slugify to the same string; suffix the collision
    // rather than letting the unique index reject the whole seed.
    let slug = slugify(seedProduct.en);
    if (usedSlugs.has(slug)) slug = `${slug}-${index + 1}`;
    usedSlugs.add(slug);

    const options = (seedProduct.options ?? []).map((option) => ({
      name: { en: option.en, ar: option.ar },
      code: option.code,
      values: option.values.map((value) => ({
        code: value.code,
        label: { en: value.en, ar: value.ar },
        ...(value.swatch ? { swatch: value.swatch } : {}),
      })),
    }));

    const document = await Product.create({
      name: { en: seedProduct.en, ar: seedProduct.ar },
      slug,
      description: { en: seedProduct.descEn, ar: seedProduct.descAr },
      shortDescription: {
        en: `${seedProduct.descEn.split('.')[0]}.`,
        ar: `${seedProduct.descAr.split('.')[0]}.`,
      },
      brand: seedProduct.brand,
      categories: [category.id],
      categoryPaths: [`${category.path}/${category.id}`],
      tags: [seedProduct.brand.toLowerCase().replace(/\s+/g, '-'), ...seedProduct.tags],
      images: imageKeys.map((key, position) => ({
        key,
        alt: { en: seedProduct.en, ar: seedProduct.ar },
        position,
        width: IMAGE_WIDTH,
        height: IMAGE_WIDTH,
      })),
      options,
      variants: buildVariants(seedProduct, index),
      status: 'active',
      isFeatured: Boolean(seedProduct.featured),
      currency: CURRENCY,
      // Staggered so "newest" produces a believable ordering.
      publishedAt: new Date(Date.now() - index * 36 * 60 * 60 * 1000),
      soldCount: seedProduct.soldCount ?? 0,
      attributes: [
        {
          key: { en: 'Brand', ar: 'الماركة' },
          value: { en: seedProduct.brand, ar: seedProduct.brand },
        },
        { key: { en: 'Origin', ar: 'بلد الصنع' }, value: { en: 'Egypt', ar: 'مصر' } },
        { key: { en: 'Warranty', ar: 'الضمان' }, value: { en: '2 years', ar: 'سنتان' } },
      ],
    });

    createdProducts.push({ id: String(document._id), index });

    if ((index + 1) % 10 === 0) console.log(`  ${index + 1}/${SEED_PRODUCTS.length}`);
  }

  // ── Accounts ──────────────────────────────────────────────────────────────
  console.log('Seeding accounts');
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const accounts = [
    { email: 'owner@sunshop.demo', firstName: 'Sara', lastName: 'Owner', roles: ['super_admin'] },
    { email: 'admin@sunshop.demo', firstName: 'Omar', lastName: 'Admin', roles: ['admin'] },
    {
      email: 'catalog@sunshop.demo',
      firstName: 'Nour',
      lastName: 'Catalog',
      roles: ['catalog_manager'],
    },
    { email: 'support@sunshop.demo', firstName: 'Hana', lastName: 'Support', roles: ['support'] },
    {
      email: 'customer@sunshop.demo',
      firstName: 'Ahmed',
      lastName: 'Customer',
      roles: ['customer'],
    },
  ];

  for (const account of accounts) {
    await User.create({
      ...account,
      passwordHash,
      status: 'active',
      emailVerified: true,
      locale: account.email.startsWith('customer') ? 'ar' : 'en',
    });
  }

  // A handful of shoppers so reviews are not all from one person.
  const reviewerNames: [string, string][] = [
    ['Layla', 'Ibrahim'],
    ['Karim', 'Fahmy'],
    ['Mona', 'Saleh'],
    ['Youssef', 'Adel'],
    ['Dina', 'Hassan'],
  ];

  const reviewers = [];
  for (const [index, name] of reviewerNames.entries()) {
    reviewers.push(
      await User.create({
        email: `shopper${index + 1}@sunshop.demo`,
        passwordHash,
        firstName: name[0],
        lastName: name[1],
        roles: ['customer'],
        status: 'active',
        emailVerified: true,
        locale: index % 2 === 0 ? 'ar' : 'en',
      }),
    );
  }

  // ── Reviews ───────────────────────────────────────────────────────────────
  console.log('Seeding reviews');

  const REVIEW_COPY = [
    {
      en: {
        title: 'Exactly as described',
        body: 'Arrived in three days and the quality matches the photos. No complaints at all.',
      },
      ar: {
        title: 'مطابق تمامًا للوصف',
        body: 'وصل خلال ثلاثة أيام والجودة مطابقة للصور. لا ملاحظات على الإطلاق.',
      },
    },
    {
      en: {
        title: 'Good, with one caveat',
        body: 'Very happy overall. Runs slightly large, so consider a size down.',
      },
      ar: {
        title: 'جيد مع ملاحظة واحدة',
        body: 'راضٍ جدًا بشكل عام. المقاس أكبر قليلًا، ففكر في اختيار مقاس أصغر.',
      },
    },
    {
      en: {
        title: 'Worth the price',
        body: 'Bought it after comparing three alternatives. This one felt the most solid in hand.',
      },
      ar: {
        title: 'يستحق سعره',
        body: 'اشتريته بعد مقارنة ثلاثة بدائل. هذا بدا الأمتن عند الإمساك به.',
      },
    },
    {
      en: {
        title: 'Second one I buy',
        body: 'The first lasted two years of daily use, which is why I came back.',
      },
      ar: {
        title: 'الثاني الذي أشتريه',
        body: 'الأول دام سنتين من الاستخدام اليومي، ولهذا عدت لشرائه مرة أخرى.',
      },
    },
  ];

  const { recalculateRating } = await import('../modules/reviews/review.service');

  let reviewCount = 0;
  for (const product of createdProducts) {
    const seedProduct = SEED_PRODUCTS[product.index];
    if (!seedProduct) continue;

    // Between one and four reviews, deterministic per product.
    const count = 1 + (product.index % 4);

    for (let position = 0; position < count; position += 1) {
      const reviewer = reviewers[(product.index + position) % reviewers.length]!;
      const copy = REVIEW_COPY[(product.index + position) % REVIEW_COPY.length]!;
      const localised = reviewer.locale === 'ar' ? copy.ar : copy.en;

      // Cluster ratings around the product's intended average.
      const target = seedProduct.rating ?? 4.5;
      const rating = Math.max(3, Math.min(5, Math.round(position % 2 === 0 ? target : target - 1)));

      await Review.create({
        product: product.id,
        user: reviewer._id,
        rating,
        title: localised.title,
        body: localised.body,
        status: 'approved',
        isVerifiedPurchase: position % 2 === 0,
        helpfulCount: (product.index * 3 + position) % 17,
      });
      reviewCount += 1;
    }

    // Recompute the denormalised aggregates the catalogue sorts on.
    await recalculateRating(product.id);
  }

  // ── Coupons ───────────────────────────────────────────────────────────────
  console.log('Seeding coupons');
  await Coupon.create([
    {
      code: 'WELCOME10',
      description: { en: '10% off your first order', ar: 'خصم ١٠٪ على أول طلب' },
      type: 'percentage',
      percentage: 10,
      maxDiscount: { amount: 50_000, currency: CURRENCY },
      firstOrderOnly: true,
      usageLimitPerUser: 1,
      isActive: true,
    },
    {
      code: 'SAVE50',
      description: { en: '500 off orders over 3,000', ar: 'خصم ٥٠٠ للطلبات فوق ٣٠٠٠' },
      type: 'fixed',
      amount: { amount: 50_000, currency: CURRENCY },
      minSubtotal: { amount: 300_000, currency: CURRENCY },
      usageLimit: 500,
      isActive: true,
    },
    {
      code: 'FREESHIP',
      description: { en: 'Free standard shipping', ar: 'شحن عادي مجاني' },
      type: 'free_shipping',
      isActive: true,
      endsAt: new Date(Date.now() + 30 * 86_400_000),
    },
    {
      code: 'SUMMER25',
      description: { en: '25% off, capped at 1,000', ar: 'خصم ٢٥٪ بحد أقصى ١٠٠٠' },
      type: 'percentage',
      percentage: 25,
      maxDiscount: { amount: 100_000, currency: CURRENCY },
      minSubtotal: { amount: 150_000, currency: CURRENCY },
      usageLimit: 200,
      usageLimitPerUser: 2,
      isActive: true,
      endsAt: new Date(Date.now() + 60 * 86_400_000),
    },
  ]);

  // ── Cache ─────────────────────────────────────────────────────────────────
  // The category tree and product lists are cached for up to fifteen minutes.
  // Without this, the storefront keeps serving the catalogue that existed
  // before the seed ran, which looks exactly like the seed having failed.
  console.log('Flushing caches');
  for (const namespace of [
    'product',
    'products',
    'category',
    'categories',
    'search',
    'home',
    'settings',
    'tag',
  ]) {
    await flushNamespace(namespace);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const [productCount, categoryCount, variantCount] = await Promise.all([
    Product.countDocuments(),
    Category.countDocuments(),
    Product.aggregate<{ total: number }>([
      { $project: { count: { $size: '$variants' } } },
      { $group: { _id: null, total: { $sum: '$count' } } },
    ]).then((rows) => rows[0]?.total ?? 0),
  ]);

  console.log('');
  console.log('Seed complete');
  console.log(`  categories: ${categoryCount}`);
  console.log(`  products:   ${productCount} (${variantCount} variants)`);
  console.log(`  reviews:    ${reviewCount}`);
  console.log(`  images:     ${uploadCache.size} stored in ${env.S3_BUCKET}`);
  console.log(`  accounts:   ${accounts.length + reviewers.length}`);
  console.log('');
  console.log('  Sign in with any of:');
  for (const account of accounts) {
    console.log(`    ${account.email.padEnd(26)} ${DEMO_PASSWORD}`);
  }
  console.log('');
  console.log('  Next: npm run reindex -w @sunshop/server');
}

seed()
  .catch((error: Error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
    await disconnectRedis();
    process.exit(process.exitCode ?? 0);
  });
