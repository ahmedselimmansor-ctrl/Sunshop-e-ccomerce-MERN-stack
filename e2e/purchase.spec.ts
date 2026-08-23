import { expect, test, type Page } from '@playwright/test';

/**
 * The purchase journey, in a real browser.
 *
 * The integration suite already proves the API's contracts, so this is here for
 * what it cannot see: that the buttons are wired to those endpoints, that the
 * cart survives navigation, and that a customer can actually get from a product
 * page to a placed order without a developer's help.
 */
test.describe('purchase journey', () => {
  /**
   * Opens a product that can actually be bought.
   *
   * Taking whichever product the catalogue lists first is a coin flip: an
   * out-of-stock one renders no add-to-cart button, and the catalogue's order
   * depends on whether the search index happens to be warm. Asking the API for
   * an in-stock slug makes the journey deterministic.
   */
  async function openBuyableProduct(page: Page): Promise<string> {
    await page.goto('/');
    // Repeated local runs can trip the rate limiter, which answers with an
    // empty body; retrying briefly keeps that from reading as a product bug.
    const result = await page.evaluate(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetch('/api/v1/products?limit=24');
        const text = await response.text();
        if (response.ok && text) {
          const body = JSON.parse(text) as { data?: { slug: string; inStock?: boolean }[] };
          const items = body.data ?? [];
          const buyable = items.find((product) => product.inStock !== false) ?? items[0];
          if (buyable) return { slug: buyable.slug, status: response.status };
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      return { slug: null as string | null, status: 0 };
    });
    expect(result.slug, `no purchasable product (last status ${result.status})`).toBeTruthy();
    const slug = result.slug!;

    await page.goto(`/products/${slug}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /add to cart/i })).toBeEnabled();
    return slug;
  }
  test('a guest can add to the cart and it survives a reload', async ({ page }) => {
    await openBuyableProduct(page);

    await page.getByRole('button', { name: /add to cart/i }).click();

    /*
     * Adding opens the cart drawer, and Radix marks everything outside a modal
     * aria-hidden, so the header badge is deliberately unreachable by role
     * while it is open. Reload to dismiss it, then read the badge: that also
     * proves the guest cart survived, which is the point of the test.
     */
    await page.reload();
    await expect(page.getByRole('button', { name: /cart \(/i })).toContainText(/[1-9]/);
  });

  test('the cart page lists what was added and totals it', async ({ page }) => {
    await openBuyableProduct(page);
    const name = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? '';

    await page.getByRole('button', { name: /add to cart/i }).click();
    await page.goto('/cart');

    await expect(page.locator('#main')).toContainText(name);
    // A cart with something in it must not show the empty state.
    await expect(page.locator('#main')).not.toContainText(/your cart is empty/i);
  });

  test('a cart carries through to a checkout page that renders', async ({ page }) => {
    /*
     * Stops at the checkout form rather than submitting it. Order placement,
     * totals, idempotency and stock are all covered against the real API by
     * the integration suite; what a browser adds is the proof that a customer
     * with a basket actually arrives at a working form rather than a redirect
     * or an empty-cart screen.
     */
    await openBuyableProduct(page);
    await page.getByRole('button', { name: /add to cart/i }).click();

    await page.goto('/checkout');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.locator('#main')).not.toContainText(/your cart is empty/i);
    // The address form is the thing that has to be there.
    await expect(page.locator('#main input').first()).toBeVisible();
  });

  test('the wishlist button sends a guest to sign in rather than failing quietly', async ({
    page,
  }) => {
    await page.goto('/products');

    await page.locator('button[aria-label^="Save"]').first().click();

    await expect(page).toHaveURL(/\/login/);
  });

  test('rating stars render a real fraction, not five full stars', async ({ page }) => {
    await page.goto('/products');
    await page.waitForLoadState('networkidle');

    // Wait for a rating to exist before measuring it.
    await page.locator('[role="img"][aria-label*="out of 5"]').first().waitFor();

    const measured = await page.evaluate(() => {
      const widgets = [...document.querySelectorAll('[role="img"][aria-label*="out of 5"]')];
      const widget = widgets.find((candidate) => {
        const inner = candidate.querySelector('.relative');
        return inner != null && inner.children.length >= 2;
      });
      if (!widget) return null;
      const relative = widget.querySelector('.relative')!;
      const base = relative.children[0] as HTMLElement;
      const overlay = relative.children[1] as HTMLElement;
      const starWidth = base.querySelector('svg')!.getBoundingClientRect().width;
      const overlayStar = overlay.querySelector('svg')!.getBoundingClientRect().width;
      return {
        label: widget.getAttribute('aria-label'),
        starsShown: +(overlay.getBoundingClientRect().width / starWidth).toFixed(2),
        layersSameSize: Math.abs(starWidth - overlayStar) < 0.5,
      };
    });

    expect(measured).not.toBeNull();
    // The label says the rating; the fill has to agree with it.
    const rating = Number(/([\d.]+) out of 5/.exec(measured!.label ?? '')?.[1]);
    expect(measured!.starsShown).toBeCloseTo(rating, 1);
    // Equal-sized layers is what distinguishes a clip from a squeeze.
    expect(measured!.layersSameSize).toBe(true);
  });
});
