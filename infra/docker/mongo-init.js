/* global db */
/**
 * Runs once on first container boot, before the app connects.
 *
 * Creates the indexes the application relies on for correctness rather than
 * performance: the unique constraints. Mongoose can build these itself, but
 * `autoIndex` is disabled in production (index builds during a rollout are a
 * known way to stall a cluster), so they are created here in development and by
 * a migration Job in production.
 */
db = db.getSiblingDB('sunshop');

db.createCollection('users');
db.users.createIndex({ email: 1 }, { unique: true, name: 'uniq_email' });

db.createCollection('products');
db.products.createIndex({ slug: 1 }, { unique: true, name: 'uniq_slug' });
db.products.createIndex({ 'variants.sku': 1 }, { unique: true, sparse: true, name: 'uniq_sku' });

db.createCollection('categories');
db.categories.createIndex({ slug: 1 }, { unique: true, name: 'uniq_category_slug' });

db.createCollection('orders');
db.orders.createIndex({ orderNumber: 1 }, { unique: true, name: 'uniq_order_number' });

db.createCollection('coupons');
db.coupons.createIndex({ code: 1 }, { unique: true, name: 'uniq_coupon_code' });

print('sunshop: base indexes created');
