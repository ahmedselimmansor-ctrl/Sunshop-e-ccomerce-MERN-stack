import {
  add,
  clampToZero,
  money,
  percentOf,
  subtract,
  type CartTotals,
  type Currency,
  type Money,
  type ShippingMethod,
} from '@sunshop/shared';

import { getSettings } from '../../models/Settings';
import { evaluateCoupon, type CouponCartLine } from '../coupons/coupon.service';

/**
 * Pricing engine.
 *
 * Every total the customer is ever shown or charged is produced here, on the
 * server, from the live catalogue price. The client sends *what it wants to
 * buy*, never *what it thinks that costs*: the one place a client-supplied
 * total is accepted at all is `expectedTotal` at checkout, and that is used
 * only to reject a mismatch, never to charge.
 *
 * Order of operations matters and is fixed: discount applies to the subtotal,
 * shipping is added after the discount (so a free-shipping coupon can zero it),
 * and tax is computed last on (discounted subtotal + shipping).
 */

/**
 * Shipping catalogue. Static here for clarity; swapping in a carrier-rate API
 * means replacing `getShippingMethods`: nothing else needs to know.
 */
interface ShippingDefinition {
  id: string;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  estimatedDays: number;
  /** Minor units, keyed by zone; `default` is the fallback. */
  priceByZone: Record<string, number>;
}

const SHIPPING_CATALOGUE: ShippingDefinition[] = [
  {
    id: 'standard',
    name: { en: 'Standard delivery', ar: 'الشحن العادي' },
    description: { en: 'Arrives in 3-5 business days', ar: 'يصل خلال ٣-٥ أيام عمل' },
    estimatedDays: 5,
    priceByZone: { EG: 5000, SA: 8000, AE: 8000, default: 12_000 },
  },
  {
    id: 'express',
    name: { en: 'Express delivery', ar: 'الشحن السريع' },
    description: { en: 'Arrives in 1-2 business days', ar: 'يصل خلال يوم إلى يومين' },
    estimatedDays: 2,
    priceByZone: { EG: 12_000, SA: 18_000, AE: 18_000, default: 26_000 },
  },
  {
    id: 'pickup',
    name: { en: 'Collect in store', ar: 'الاستلام من المتجر' },
    description: { en: 'Ready within 24 hours', ar: 'جاهز خلال ٢٤ ساعة' },
    estimatedDays: 1,
    priceByZone: { default: 0 },
  },
];

export async function getShippingMethods(
  country: string,
  subtotal: Money,
): Promise<ShippingMethod[]> {
  const settings = await getSettings();
  const threshold = settings.freeShippingThreshold;
  const currency = subtotal.currency;

  /*
   * A destination the store does not serve gets no options at all.
   *
   * `shipsToCountries` was stored, seeded, editable in the admin console and
   * published to clients, but nothing ever read it here: every unknown country
   * fell through to `priceByZone.default` and was quoted a price. Checkout then
   * accepted the order, because its only shipping check is that the chosen
   * method exists for the destination. Returning nothing makes that existing
   * check reject the address, so the quote endpoint and checkout agree without
   * either of them growing a second copy of the rule.
   *
   * An empty list means unrestricted, which is the model's default and keeps a
   * store that never configured one working exactly as before.
   */
  const servedCountries = settings.shipsToCountries ?? [];
  if (servedCountries.length > 0 && !servedCountries.includes(country.toUpperCase())) {
    return [];
  }

  return SHIPPING_CATALOGUE.map((definition) => {
    const base =
      definition.priceByZone[country.toUpperCase()] ?? definition.priceByZone.default ?? 0;

    // Free shipping above a threshold applies to ground shipping only:
    // upgrading to express should still cost something.
    const qualifiesFree =
      definition.id !== 'express' && threshold != null && subtotal.amount >= threshold.amount;

    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      price: money(qualifiesFree ? 0 : base, currency),
      estimatedDays: definition.estimatedDays,
      freeAbove: threshold ? money(threshold.amount, currency) : null,
    };
  });
}

export async function getShippingMethod(
  id: string,
  country: string,
  subtotal: Money,
): Promise<ShippingMethod | null> {
  const methods = await getShippingMethods(country, subtotal);
  return methods.find((method) => method.id === id) ?? null;
}

export interface PriceableLine extends CouponCartLine {
  lineTotal: Money;
}

export interface ComputeTotalsInput {
  lines: PriceableLine[];
  currency: Currency;
  couponCode?: string | null;
  shippingMethodId?: string | null;
  country?: string;
  userId: string | null;
  email?: string | null;
}

export interface ComputedTotals {
  totals: CartTotals;
  appliedCoupon: { code: string; couponId: string; discount: Money } | null;
  /** Per-line discount allocation, so refunds reconcile exactly. */
  lineDiscounts: Map<string, Money>;
}

export async function computeTotals(input: ComputeTotalsInput): Promise<ComputedTotals> {
  const settings = await getSettings();
  const currency = input.currency;

  const subtotal = money(
    input.lines.reduce((total, line) => total + line.lineTotal.amount, 0),
    currency,
  );
  const itemCount = input.lines.reduce((total, line) => total + line.quantity, 0);

  const shippingMethod = input.shippingMethodId
    ? await getShippingMethod(input.shippingMethodId, input.country ?? 'EG', subtotal)
    : null;
  let shipping = shippingMethod?.price ?? money(0, currency);

  let discount = money(0, currency);
  let appliedCoupon: ComputedTotals['appliedCoupon'] = null;
  const lineDiscounts = new Map<string, Money>();

  if (input.couponCode) {
    const evaluated = await evaluateCoupon({
      code: input.couponCode,
      lines: input.lines,
      subtotal,
      shipping,
      userId: input.userId,
      email: input.email,
    });

    if (evaluated.ok) {
      const { coupon, discount: value, freeShipping } = evaluated.value;

      if (freeShipping) {
        shipping = money(0, currency);
        discount = money(0, currency);
      } else {
        discount = value;
      }

      appliedCoupon = { code: coupon.code, couponId: String(coupon._id), discount: value };

      // Spread the discount across lines proportionally to their value, with
      // the leftover minor units handed to the largest fractions, so the sum of
      // line discounts equals the order discount to the cent.
      const { allocate } = await import('@sunshop/shared');
      const weights = input.lines.map((line) => line.lineTotal.amount);
      const allocations = allocate(discount, weights);
      input.lines.forEach((line, index) => {
        lineDiscounts.set(line.productId, allocations[index] ?? money(0, currency));
      });
    }
  }

  const discountedSubtotal = clampToZero(subtract(subtotal, discount));

  // Tax-inclusive pricing means the displayed price already contains VAT, so
  // it is extracted for the invoice rather than added on top.
  const taxRate = settings.taxRatePercent ?? 0;
  const taxable = add(discountedSubtotal, shipping);
  const tax = settings.taxIncludedInPrices
    ? money(
        taxRate > 0 ? Math.round(taxable.amount - taxable.amount / (1 + taxRate / 100)) : 0,
        currency,
      )
    : percentOf(taxable, taxRate);

  const total = settings.taxIncludedInPrices ? taxable : add(taxable, tax);

  return {
    totals: {
      subtotal,
      discount,
      shipping,
      tax,
      total: clampToZero(total),
      itemCount,
    },
    appliedCoupon,
    lineDiscounts,
  };
}
