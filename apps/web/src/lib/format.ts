import {
  formatMoney,
  formatDate as formatDateShared,
  type Locale,
  type Money,
} from '@sunshop/shared';

import { useUiStore } from '@/stores/ui';

/**
 * Formatting helpers bound to the active locale.
 *
 * Money always goes through `formatMoney`, which understands that amounts are
 * integer minor units. A component that does `amount / 100` by hand is one
 * refactor away from a rounding bug on an invoice.
 */
export function useFormat() {
  const locale = useUiStore((state) => state.locale) as Locale;

  return {
    locale,
    money: (value: Money) => formatMoney(value, locale),
    /** For price ranges on a card: "$19.99" or "$19.99 - $29.99". */
    moneyRange: (min: Money, max: Money) =>
      min.amount === max.amount
        ? formatMoney(min, locale)
        : `${formatMoney(min, locale)} - ${formatMoney(max, locale)}`,
    date: (value: string | Date, options?: Intl.DateTimeFormatOptions) =>
      formatDateShared(value, locale, options),
    number: (value: number) =>
      new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US').format(value),
    percent: (value: number) =>
      new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
        style: 'percent',
        maximumFractionDigits: 0,
      }).format(value / 100),
  };
}

/**
 * Picks the right side of a localized field.
 *
 * The locale is normalized to its base subtag first: `i18n.language` can be
 * `en-US` or `ar-EG` depending on what the browser reported, and indexing
 * `{ en, ar }` with `en-US` silently misses and falls through to Arabic: an
 * English shopper then sees Arabic product names on an English page.
 */
export function localized(
  value: { en?: string | null; ar?: string | null } | string | null | undefined,
  locale: string,
): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;

  const base = (locale.split('-')[0] ?? 'en').toLowerCase() as Locale;
  const primary = base === 'ar' ? value.ar : value.en;
  if (primary?.trim()) return primary;

  const fallback = base === 'ar' ? value.en : value.ar;
  return fallback?.trim() ?? '';
}
