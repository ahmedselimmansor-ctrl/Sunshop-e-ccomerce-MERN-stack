import { DEFAULT_LOCALE, IMAGE_RENDITIONS, type Locale } from './constants';

/** A value translated into both supported locales. */
export interface Localized {
  en?: string | null;
  ar?: string | null;
}

/**
 * Resolves a localized field for display, falling back to the other locale
 * rather than rendering an empty string: a missing Arabic translation should
 * still show the English name, not a blank product card.
 */
export function t(
  value: Localized | string | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  const primary = value[locale];
  if (primary && primary.trim()) return primary;
  const fallback = locale === 'en' ? value.ar : value.en;
  return fallback?.trim() ? fallback : '';
}

/**
 * URL-safe slug that keeps Arabic letters intact. Arabic diacritics
 * (tashkeel, U+064B-U+0652) and the tatweel are stripped so that
 * "كنـزة" and "كنزة" collapse to the same slug.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}

/** Appends a short suffix when a slug collides, e.g. `blue-shirt-x7f2`. */
export function uniqueSlug(base: string, suffix: string): string {
  const slug = slugify(base);
  return `${slug}-${suffix}`.slice(0, 140);
}

/**
 * Normalizes Arabic text for search/compare: unifies alef forms, ya/alef
 * maqsura, and ta marbuta so "احمد"/"أحمد" and "علي"/"على" match.
 */
export function normalizeArabic(input: string): string {
  return input
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .trim();
}

/** Case/diacritic-insensitive key for dedupe and cache keys. */
export function searchKey(input: string): string {
  return normalizeArabic(input.toLowerCase()).replace(/\s+/g, ' ');
}

export function initials(firstName?: string | null, lastName?: string | null): string {
  const a = firstName?.trim()?.[0] ?? '';
  const b = lastName?.trim()?.[0] ?? '';
  return (a + b).toUpperCase() || '?';
}

/** Builds a responsive `srcset` from a CDN base URL for one image key. */
export function buildSrcSet(
  cdnBaseUrl: string,
  key: string,
  widths: readonly number[] = IMAGE_RENDITIONS,
): Record<string, string> {
  const base = cdnBaseUrl.replace(/\/+$/, '');
  return Object.fromEntries(
    widths.map((width) => [String(width), `${base}/${key}?w=${width}&fm=webp&q=82`]),
  );
}

export function cdnUrl(cdnBaseUrl: string, key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  return `${cdnBaseUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

/** Stable JSON stringify: used to hash query objects into cache keys. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

export function formatDate(
  value: string | number | Date,
  locale: Locale = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  return new Intl.DateTimeFormat(tag, options).format(new Date(value));
}

export function relativeTime(
  value: string | number | Date,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const tag = locale === 'ar' ? 'ar-EG' : 'en-US';
  const diffMs = new Date(value).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1000],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms || unit === 'second') {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return '';
}

/** Masks an email for display in logs/UI: `ah***@example.com`. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Clamp with sane defaults; used everywhere pagination touches user input. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
