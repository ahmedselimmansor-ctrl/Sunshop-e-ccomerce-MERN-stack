import {
  addToCartSchema,
  checkoutSchema,
  createProductSchema,
  loginSchema,
  registerSchema,
} from '@sunshop/shared';
import { describe, expect, it } from 'vitest';

const validProduct = {
  name: { en: 'Tee', ar: 'تي شيرت' },
  slug: 'tee',
  description: { en: 'A tee', ar: 'تي شيرت' },
  categories: ['507f1f77bcf86cd799439011'],
  variants: [
    {
      sku: 'SN-01-001',
      optionValues: {},
      price: { amount: 1999, currency: 'USD' as const },
      stock: 10,
    },
  ],
};

describe('registration schema', () => {
  it('rejects a password that is too short', () => {
    const result = registerSchema.safeParse({
      firstName: 'Ahmed',
      lastName: 'Customer',
      email: 'a@example.com',
      password: 'Short1',
      confirmPassword: 'Short1',
      acceptTerms: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects mismatched passwords', () => {
    const result = registerSchema.safeParse({
      firstName: 'Ahmed',
      lastName: 'Customer',
      email: 'a@example.com',
      password: 'GoodPassword1',
      confirmPassword: 'GoodPassword2',
      acceptTerms: true,
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('passwords_do_not_match');
  });

  it('rejects a password built from the email local part', () => {
    const result = registerSchema.safeParse({
      firstName: 'Ahmed',
      lastName: 'Customer',
      email: 'ahmedhassan@example.com',
      password: 'Ahmedhassan1',
      confirmPassword: 'Ahmedhassan1',
      acceptTerms: true,
    });
    expect(result.success).toBe(false);
  });

  it('requires the terms checkbox', () => {
    const result = registerSchema.safeParse({
      firstName: 'Ahmed',
      lastName: 'Customer',
      email: 'a@example.com',
      password: 'GoodPassword1',
      confirmPassword: 'GoodPassword1',
      acceptTerms: false,
    });
    expect(result.success).toBe(false);
  });

  it('normalizes the email to lowercase', () => {
    const result = registerSchema.safeParse({
      firstName: 'Ahmed',
      lastName: 'Customer',
      email: '  Ahmed@Example.COM ',
      password: 'GoodPassword1',
      confirmPassword: 'GoodPassword1',
      acceptTerms: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('ahmed@example.com');
  });
});

describe('login schema', () => {
  it('accepts a minimal payload', () => {
    expect(loginSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true);
  });

  it('rejects a malformed TOTP code', () => {
    const result = loginSchema.safeParse({
      email: 'a@example.com',
      password: 'x',
      totpCode: '12345',
    });
    expect(result.success).toBe(false);
  });
});

describe('product schema', () => {
  it('accepts a well-formed product', () => {
    expect(createProductSchema.safeParse(validProduct).success).toBe(true);
  });

  it('rejects duplicate SKUs across variants', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      variants: [validProduct.variants[0], validProduct.variants[0]],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('duplicate_sku');
  });

  it('rejects variants priced in different currencies', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      variants: [
        validProduct.variants[0],
        { ...validProduct.variants[0], sku: 'SN-01-002', price: { amount: 1999, currency: 'EUR' } },
      ],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('mixed_currencies');
  });

  it('rejects a compare-at price below the selling price', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      variants: [
        {
          ...validProduct.variants[0],
          compareAtPrice: { amount: 999, currency: 'USD' },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('requires every variant to set every declared option', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      options: [
        {
          code: 'size',
          name: { en: 'Size', ar: 'المقاس' },
          values: [{ code: 'M', label: { en: 'M', ar: 'وسط' } }],
        },
      ],
      // The variant declares no size, so it cannot be selected.
      variants: [validProduct.variants[0]],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('variant_options_mismatch');
  });
});

describe('cart and checkout schemas', () => {
  it('rejects a non-positive quantity', () => {
    const result = addToCartSchema.safeParse({
      productId: '507f1f77bcf86cd799439011',
      variantId: '507f1f77bcf86cd799439012',
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it('requires a billing address when it differs from shipping', () => {
    const result = checkoutSchema.safeParse({
      shippingAddress: {
        fullName: 'Ahmed Customer',
        phone: '+201001234567',
        line1: '12 Nile St',
        city: 'Cairo',
        country: 'EG',
      },
      billingSameAsShipping: false,
      paymentMethod: 'card',
      shippingMethodId: 'standard',
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('billing_address_required');
  });

  it('rejects a phone number that is not E.164', () => {
    const result = checkoutSchema.safeParse({
      shippingAddress: {
        fullName: 'Ahmed Customer',
        phone: '01001234567',
        line1: '12 Nile St',
        city: 'Cairo',
        country: 'EG',
      },
      paymentMethod: 'card',
      shippingMethodId: 'standard',
    });
    expect(result.success).toBe(false);
  });
});
