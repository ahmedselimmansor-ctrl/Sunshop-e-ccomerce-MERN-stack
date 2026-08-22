/**
 * Domain constants shared by the API, the storefront, the admin dashboard and
 * (mirrored by hand) the Kotlin client. Anything that both a client and the
 * server must agree on lives here so the two can never drift.
 */

// ── Localization ────────────────────────────────────────────────────────────

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_DIRECTION: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  ar: 'rtl',
};

export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
};

/** BCP-47 tags used for `Intl.NumberFormat` / `Intl.DateTimeFormat`. */
export const LOCALE_TAG: Record<Locale, string> = {
  en: 'en-US',
  ar: 'ar-EG',
};

// ── Theme ───────────────────────────────────────────────────────────────────

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

// ── Money & currency ────────────────────────────────────────────────────────

export const CURRENCIES = ['USD', 'EUR', 'EGP', 'SAR', 'AED'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = 'USD';

/**
 * Number of minor units per major unit. All money in Sunshop is stored and
 * transported as an integer count of minor units (e.g. 1999 === $19.99) so that
 * no floating point rounding ever reaches an invoice.
 */
export const CURRENCY_MINOR_UNITS: Record<Currency, number> = {
  USD: 100,
  EUR: 100,
  EGP: 100,
  SAR: 100,
  AED: 100,
};

export const CURRENCY_SYMBOL: Record<Currency, { en: string; ar: string }> = {
  USD: { en: '$', ar: '$' },
  EUR: { en: '€', ar: '€' },
  EGP: { en: 'EGP', ar: 'ج.م' },
  SAR: { en: 'SAR', ar: 'ر.س' },
  AED: { en: 'AED', ar: 'د.إ' },
};

// ── Identity & access ───────────────────────────────────────────────────────

export const ROLES = ['customer', 'support', 'catalog_manager', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];
export const DEFAULT_ROLE: Role = 'customer';

/** Roles that may sign in to the admin dashboard at all. */
export const STAFF_ROLES: readonly Role[] = ['support', 'catalog_manager', 'admin', 'super_admin'];

export const USER_STATUSES = ['active', 'pending_verification', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// ── Catalog ─────────────────────────────────────────────────────────────────

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_SORTS = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
  'rating_desc',
  'best_selling',
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Inventory policy when stock hits zero. */
export const STOCK_POLICIES = ['deny', 'continue'] as const;
export type StockPolicy = (typeof STOCK_POLICIES)[number];

// ── Orders & payments ───────────────────────────────────────────────────────

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed order state machine. Anything not listed is rejected by the API,
 * which keeps an admin from e.g. shipping a refunded order.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['card', 'cash_on_delivery'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const FULFILLMENT_STATUSES = ['unfulfilled', 'partial', 'fulfilled', 'returned'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

// ── Promotions ──────────────────────────────────────────────────────────────

export const DISCOUNT_TYPES = ['percentage', 'fixed', 'free_shipping'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

// ── Reviews ─────────────────────────────────────────────────────────────────

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// ── Media ───────────────────────────────────────────────────────────────────

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_IMAGES_PER_PRODUCT = 12;

/** Widths the CDN/image pipeline pre-renders; used to build `srcset`. */
export const IMAGE_RENDITIONS = [160, 320, 640, 960, 1280, 1920] as const;

// ── Pagination ──────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ── Transport contracts ─────────────────────────────────────────────────────

/** Header carrying the request/correlation id end to end (client → LB → API → logs). */
export const CORRELATION_ID_HEADER = 'x-request-id';
/** Header carrying the caller's preferred locale when it is not in the URL. */
export const LOCALE_HEADER = 'x-locale';
/** Header carrying an idempotency key for unsafe, retry-prone requests. */
export const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';
/** Header carrying the anonymous cart id for guests. */
export const GUEST_CART_HEADER = 'x-cart-token';

/**
 * Stable, machine-readable error codes. Clients switch on these: never on the
 * human-readable message, which is localized and may change.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  IDEMPOTENCY_REPLAY: 'IDEMPOTENCY_REPLAY',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REUSED: 'TOKEN_REUSED',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  PRICE_CHANGED: 'PRICE_CHANGED',
  COUPON_INVALID: 'COUPON_INVALID',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ── Cache keys / TTLs (seconds) ─────────────────────────────────────────────

export const CACHE_TTL = {
  productDetail: 300,
  productList: 120,
  categoryTree: 900,
  search: 60,
  homeFeed: 180,
  settings: 600,
} as const;

/**
 * Cache-key builders. Centralised so that the write path (which invalidates)
 * and the read path (which populates) can never disagree on a key shape.
 */
export const cacheKeys = {
  product: (idOrSlug: string) => `product:${idOrSlug}`,
  productList: (hash: string) => `products:list:${hash}`,
  categoryTree: () => 'categories:tree',
  category: (idOrSlug: string) => `category:${idOrSlug}`,
  search: (hash: string) => `search:${hash}`,
  userPermissions: (userId: string) => `perm:${userId}`,
  cart: (cartId: string) => `cart:${cartId}`,
  settings: () => 'settings:public',
  homeFeed: (locale: string) => `home:${locale}`,
} as const;

/** Tags let one write invalidate every derived list without scanning keys. */
export const cacheTags = {
  products: 'tag:products',
  categories: 'tag:categories',
  product: (id: string) => `tag:product:${id}`,
  category: (id: string) => `tag:category:${id}`,
} as const;
