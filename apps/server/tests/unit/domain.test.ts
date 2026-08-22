import {
  ORDER_STATUS_TRANSITIONS,
  cacheKeys,
  cacheTags,
  normalizeArabic,
  searchKey,
  slugify,
  stableStringify,
} from '@sunshop/shared';
import { describe, expect, it } from 'vitest';

describe('order state machine', () => {
  it('allows only forward-compatible transitions', () => {
    expect(ORDER_STATUS_TRANSITIONS.pending_payment).toContain('paid');
    expect(ORDER_STATUS_TRANSITIONS.paid).toContain('processing');
    expect(ORDER_STATUS_TRANSITIONS.shipped).toContain('delivered');
  });

  it('makes cancelled and refunded terminal', () => {
    // Shipping a refunded order is the bug this table exists to prevent.
    expect(ORDER_STATUS_TRANSITIONS.cancelled).toHaveLength(0);
    expect(ORDER_STATUS_TRANSITIONS.refunded).toHaveLength(0);
  });

  it('never allows a jump straight from pending payment to shipped', () => {
    expect(ORDER_STATUS_TRANSITIONS.pending_payment).not.toContain('shipped');
    expect(ORDER_STATUS_TRANSITIONS.pending_payment).not.toContain('delivered');
  });
});

describe('slugify', () => {
  it('produces URL-safe Latin slugs', () => {
    expect(slugify('Sunshop Classic Cotton Tee')).toBe('sunshop-classic-cotton-tee');
    expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
  });

  it('keeps Arabic letters instead of transliterating them', () => {
    // An Arabic product should get a readable Arabic URL.
    expect(slugify('فستان كتان صيفي')).toBe('فستان-كتان-صيفي');
  });

  it('strips diacritics so tashkeel does not fork the slug', () => {
    expect(slugify('كَنْزَة')).toBe(slugify('كنزة'));
  });
});

describe('arabic normalization', () => {
  it('unifies alef forms', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    expect(normalizeArabic('إبراهيم')).toBe(normalizeArabic('ابراهيم'));
  });

  it('unifies ya and alef maqsura', () => {
    expect(normalizeArabic('على')).toBe(normalizeArabic('علي'));
  });

  it('gives the same search key regardless of case and spacing', () => {
    expect(searchKey('Blue  SHIRT')).toBe('blue shirt');
  });
});

describe('cache keys', () => {
  it('is stable across key ordering', () => {
    // Two equivalent queries must hit the same cache entry.
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('ignores undefined values', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('namespaces keys so a flush cannot take out the wrong thing', () => {
    expect(cacheKeys.product('abc')).toBe('product:abc');
    expect(cacheTags.product('abc')).toBe('tag:product:abc');
    expect(cacheKeys.product('abc')).not.toBe(cacheTags.product('abc'));
  });
});
