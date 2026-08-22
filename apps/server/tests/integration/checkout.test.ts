import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Product } from '@/models/Product';

import { PASSWORD, seedProduct, seedSettings } from './helpers/fixtures';
import { startHarness, type Harness } from './helpers/harness';

/**
 * Checkout, which is where the money and the inventory both move.
 *
 * The two properties that matter most are that a retried request cannot charge
 * twice, and that the order's totals are the server's arithmetic rather than
 * anything the client proposed.
 */
describe('checkout', () => {
  let h: Harness;
  let productId: string;
  let variantId: string;
  let token: string;

  const address = {
    fullName: 'Test Buyer',
    phone: '+201000000000',
    line1: '1 Test Street',
    city: 'Cairo',
    country: 'EG',
    postalCode: '11511',
  };

  const checkout = (overrides: Record<string, unknown> = {}, key = `key-${Date.now()}`) =>
    h.request
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('x-idempotency-key', key)
      .send({
        shippingAddress: address,
        billingSameAsShipping: true,
        paymentMethod: 'cash_on_delivery',
        shippingMethodId: 'standard',
        ...overrides,
      });

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  beforeEach(async () => {
    await h.reset();
    await seedSettings();

    const product = await seedProduct({ stock: 10, price: 10_000 });
    productId = product.id as string;
    variantId = String(product.variants[0]!._id);

    const registered = await h.request.post('/api/v1/auth/register').send({
      firstName: 'Test',
      lastName: 'Buyer',
      email: 'checkout@sunshop.test',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptTerms: true,
    });
    token = registered.body.data.tokens.accessToken;

    await h.request
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, variantId, quantity: 2 });
  });

  it('places an order and returns its number', async () => {
    const response = await checkout();

    expect(response.status).toBeLessThan(300);
    expect(response.body.data.orderNumber).toMatch(/^SN-/);
    expect(response.body.data.totals.total.amount).toBeGreaterThan(0);
  });

  it('computes totals on the server, ignoring anything the client sends', async () => {
    const response = await checkout({
      totals: { total: { amount: 1, currency: 'USD' } },
    });

    const totals = response.body.data.totals;
    expect(totals.subtotal.amount).toBe(20_000);
    // Tax is charged on goods plus shipping, and the total is the sum of the
    // parts: asserting the relationship rather than a figure that moves with
    // the shipping table.
    expect(totals.tax.amount).toBe(
      Math.round((totals.subtotal.amount - totals.discount.amount + totals.shipping.amount) * 0.14),
    );
    expect(totals.total.amount).toBe(
      totals.subtotal.amount - totals.discount.amount + totals.shipping.amount + totals.tax.amount,
    );
  });

  it('replays an identical request instead of ordering twice', async () => {
    const key = 'stable-idempotency-key';
    const first = await checkout({}, key);
    const second = await checkout({}, key);

    expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber);

    const list = await h.request.get('/api/v1/orders').set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(1);
  });

  it('requires an idempotency key', async () => {
    const response = await h.request
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        shippingAddress: address,
        billingSameAsShipping: true,
        paymentMethod: 'cash_on_delivery',
        shippingMethodId: 'standard',
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('takes the ordered quantity out of stock', async () => {
    await checkout();

    const after = await Product.findById(productId);
    const variant = after!.variants.find((v) => String(v._id) === variantId)!;
    expect(variant.stock).toBe(8);
  });

  it('empties the cart', async () => {
    await checkout();

    const cart = await h.request.get('/api/v1/cart').set('Authorization', `Bearer ${token}`);
    expect(cart.body.data.items).toHaveLength(0);
  });

  it('refuses to check out an empty cart', async () => {
    await checkout();
    const response = await checkout({}, 'second-key');

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects an unsupported shipping destination', async () => {
    const response = await checkout({
      shippingAddress: { ...address, country: 'ZZ' },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects an incomplete address', async () => {
    const response = await checkout({
      shippingAddress: { fullName: 'Test Buyer', country: 'EG' },
    });

    expect(response.status).toBe(422);
  });

  it('refuses an anonymous checkout without an email', async () => {
    const response = await h.request
      .post('/api/v1/orders/checkout')
      .set('x-idempotency-key', 'guest-key')
      .send({
        shippingAddress: address,
        billingSameAsShipping: true,
        paymentMethod: 'cash_on_delivery',
        shippingMethodId: 'standard',
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('exposes the order to its owner and nobody else', async () => {
    const placed = await checkout();
    const orderNumber = placed.body.data.orderNumber;

    const mine = await h.request
      .get(`/api/v1/orders/${orderNumber}`)
      .set('Authorization', `Bearer ${token}`);
    expect(mine.status).toBe(200);

    const anonymous = await h.request.get(`/api/v1/orders/${orderNumber}`);
    expect(anonymous.status).toBe(401);
  });
});
