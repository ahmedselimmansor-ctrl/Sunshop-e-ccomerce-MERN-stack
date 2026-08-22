import {
  add,
  allocate,
  discountPercent,
  formatMoney,
  fromMajorUnits,
  money,
  percentOf,
  subtract,
  toMajorUnits,
} from '@sunshop/shared';
import { describe, expect, it } from 'vitest';

describe('money', () => {
  it('keeps amounts as integer minor units', () => {
    expect(money(1999).amount).toBe(1999);
    expect(toMajorUnits(money(1999))).toBe(19.99);
    expect(fromMajorUnits(19.99).amount).toBe(1999);
  });

  it('rounds fractional input rather than storing a float', () => {
    // 0.1 + 0.2 in major units is the classic failure this design avoids.
    expect(fromMajorUnits(0.1 + 0.2).amount).toBe(30);
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(100, 'USD'), money(100, 'EUR'))).toThrow(/Currency mismatch/);
  });

  it('adds and subtracts exactly', () => {
    expect(add(money(1999), money(1)).amount).toBe(2000);
    expect(subtract(money(2000), money(1)).amount).toBe(1999);
  });

  it('rounds percentages half-up', () => {
    // 10% of 1999 = 199.9 → 200, not 199.
    expect(percentOf(money(1999), 10).amount).toBe(200);
  });

  it('computes a discount percentage', () => {
    expect(discountPercent(money(10_000), money(7500))).toBe(25);
    // A "discount" that raises the price is not a discount.
    expect(discountPercent(money(5000), money(6000))).toBe(0);
  });

  describe('allocate', () => {
    it('distributes without losing or inventing a minor unit', () => {
      const parts = allocate(money(1000), [1, 1, 1]);
      expect(parts.map((part) => part.amount)).toEqual([334, 333, 333]);
      expect(parts.reduce((total, part) => total + part.amount, 0)).toBe(1000);
    });

    it('weights proportionally', () => {
      const parts = allocate(money(900), [2, 1]);
      expect(parts.map((part) => part.amount)).toEqual([600, 300]);
    });

    it('handles a zero total weight', () => {
      const parts = allocate(money(500), [0, 0]);
      expect(parts.every((part) => part.amount === 0)).toBe(true);
    });

    it('always reconciles, for any split', () => {
      // Property check: the sum of the parts must equal the whole, or an
      // order's line discounts will not add up to its order discount.
      for (const total of [1, 7, 99, 1234, 99_999]) {
        for (const weights of [
          [1, 2, 3],
          [5, 5],
          [1, 1, 1, 1, 1, 1, 1],
        ]) {
          const parts = allocate(money(total), weights);
          expect(parts.reduce((sum, part) => sum + part.amount, 0)).toBe(total);
        }
      }
    });
  });

  it('formats per locale with Latin digits in Arabic', () => {
    const formatted = formatMoney(money(199_900, 'USD'), 'ar');
    // Arabic locale, but the digits stay scannable next to Latin SKUs.
    expect(formatted).toMatch(/1[.,]999/);
  });
});
