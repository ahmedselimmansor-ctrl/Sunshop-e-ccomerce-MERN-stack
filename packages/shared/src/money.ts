import {
  CURRENCY_MINOR_UNITS,
  DEFAULT_CURRENCY,
  LOCALE_TAG,
  type Currency,
  type Locale,
} from './constants';

/**
 * Money is an integer number of minor units plus a currency. Never a float:
 * `0.1 + 0.2 !== 0.3` is not an acceptable property for an invoice line.
 */
export interface Money {
  amount: number; // minor units, e.g. 1999 === $19.99
  currency: Currency;
}

export function money(amount: number, currency: Currency = DEFAULT_CURRENCY): Money {
  return { amount: Math.round(amount), currency };
}

export function zero(currency: Currency = DEFAULT_CURRENCY): Money {
  return { amount: 0, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function sum(items: readonly Money[], currency: Currency = DEFAULT_CURRENCY): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), zero(currency));
}

export function multiply(value: Money, quantity: number): Money {
  return { amount: Math.round(value.amount * quantity), currency: value.currency };
}

/** Banker-free half-up rounding, which is what tax/discount tables assume. */
export function percentOf(value: Money, percent: number): Money {
  return { amount: Math.round((value.amount * percent) / 100), currency: value.currency };
}

export function clampToZero(value: Money): Money {
  return { amount: Math.max(0, value.amount), currency: value.currency };
}

export function toMajorUnits(value: Money): number {
  return value.amount / (CURRENCY_MINOR_UNITS[value.currency] ?? 100);
}

export function fromMajorUnits(major: number, currency: Currency = DEFAULT_CURRENCY): Money {
  return { amount: Math.round(major * (CURRENCY_MINOR_UNITS[currency] ?? 100)), currency };
}

/**
 * Locale-aware currency rendering. Arabic uses `ar-EG` which renders the symbol
 * on the correct side and, with `numberingSystem: 'latn'`, keeps digits Latin
 * so prices stay scannable next to Latin SKUs.
 */
export function formatMoney(
  value: Money,
  locale: Locale = 'en',
  options: Intl.NumberFormatOptions = {},
): string {
  const tag = LOCALE_TAG[locale] ?? 'en-US';
  return new Intl.NumberFormat(`${tag}-u-nu-latn`, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(toMajorUnits(value));
}

/** Percentage saved between a compare-at price and the effective price. */
export function discountPercent(compareAt: Money, price: Money): number {
  if (compareAt.amount <= 0 || price.amount >= compareAt.amount) return 0;
  return Math.round(((compareAt.amount - price.amount) / compareAt.amount) * 100);
}

/**
 * Splits `value` into `parts` amounts whose sum is exactly `value.amount`.
 * Used when distributing an order-level discount across line items so the
 * refunded total always reconciles to the cent.
 */
export function allocate(value: Money, weights: readonly number[]): Money[] {
  const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);
  if (totalWeight <= 0) return weights.map(() => zero(value.currency));

  const raw = weights.map((weight) => (value.amount * weight) / totalWeight);
  const floored = raw.map((entry) => Math.floor(entry));
  let remainder = value.amount - floored.reduce((acc, entry) => acc + entry, 0);

  // Hand the leftover minor units to the largest fractional parts first.
  const order = raw
    .map((entry, index) => ({ index, frac: entry - Math.floor(entry) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floored];
  for (const { index } of order) {
    if (remainder <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remainder -= 1;
  }

  return result.map((amount) => ({ amount, currency: value.currency }));
}
