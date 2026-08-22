import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedProduct, seedSettings } from './helpers/fixtures';
import { startHarness, type Harness } from './helpers/harness';

/**
 * Cart behaviour.
 *
 * The invariant worth defending is that the server owns the totals. A client
 * that can talk the API into its own arithmetic is a client that can buy a
 * shirt for a penny.
 */
describe('cart', () => {
  let h: Harness;
  let productId: string;
  let variantId: string;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  beforeEach(async () => {
    await h.reset();
    await seedSettings();
    const product = await seedProduct({ stock: 5, price: 10_000 });
    productId = product.id as string;
    variantId = String(product.variants[0]!._id);
  });

  const addItem = (body: Record<string, unknown>) =>
    h.request.post('/api/v1/cart/items').send(body);

  it('starts empty', async () => {
    const response = await h.request.get('/api/v1/cart');

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(0);
    expect(response.body.data.totals.itemCount).toBe(0);
  });

  it('adds an item and computes totals server-side', async () => {
    const response = await addItem({ productId, variantId, quantity: 2 });

    expect(response.status).toBeLessThan(300);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.totals.subtotal.amount).toBe(20_000);
    expect(response.body.data.totals.itemCount).toBe(2);
  });

  it('ignores a client-supplied price', async () => {
    // The price is never read from the request; it comes from the variant.
    const response = await addItem({
      productId,
      variantId,
      quantity: 1,
      unitPrice: { amount: 1, currency: 'USD' },
      price: { amount: 1, currency: 'USD' },
    });

    expect(response.body.data.totals.subtotal.amount).toBe(10_000);
  });

  it('merges a repeated add rather than duplicating the line', async () => {
    await addItem({ productId, variantId, quantity: 1 });
    const response = await addItem({ productId, variantId, quantity: 2 });

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.totals.itemCount).toBe(3);
  });

  it('refuses more than the available stock', async () => {
    const response = await addItem({ productId, variantId, quantity: 99 });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.ok).toBe(false);
  });

  it('rejects a quantity of zero or less', async () => {
    const response = await addItem({ productId, variantId, quantity: 0 });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects an unknown variant', async () => {
    const response = await addItem({
      productId,
      variantId: '507f1f77bcf86cd799439011',
      quantity: 1,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('updates a line quantity', async () => {
    const added = await addItem({ productId, variantId, quantity: 1 });
    const itemId = added.body.data.items[0].id;

    const response = await h.request.patch(`/api/v1/cart/items/${itemId}`).send({ quantity: 3 });

    expect(response.status).toBe(200);
    expect(response.body.data.totals.itemCount).toBe(3);
  });

  it('removes a line', async () => {
    const added = await addItem({ productId, variantId, quantity: 1 });
    const itemId = added.body.data.items[0].id;

    const response = await h.request.delete(`/api/v1/cart/items/${itemId}`);

    expect(response.status).toBeLessThan(300);
    const cart = await h.request.get('/api/v1/cart');
    expect(cart.body.data.items).toHaveLength(0);
  });

  it('will not add a draft product', async () => {
    const draft = await seedProduct({ slug: 'draft-tee', status: 'draft' });

    const response = await addItem({
      productId: draft.id,
      variantId: String(draft.variants[0]!._id),
      quantity: 1,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
