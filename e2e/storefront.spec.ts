import { expect, test } from '@playwright/test';

/**
 * The storefront as a customer meets it.
 *
 * Deliberately thin on assertions about copy and heavy on the things that only
 * a browser can tell you: that the page rendered at all, that the routes are
 * wired, and that the accessibility affordances survive a real render.
 */
test.describe('storefront', () => {
  test('home page renders the catalogue', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/Sunshop/);
    // Seeded products reach the page, so the API and the CDN URLs both work.
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('every page sets its own document title', async ({ page }) => {
    await page.goto('/');
    const home = await page.title();

    await page.goto('/products');
    await expect(page).toHaveTitle(/All products/);
    expect(await page.title()).not.toBe(home);
  });

  test('a product page opens from the catalogue', async ({ page }) => {
    await page.goto('/products');

    const firstProduct = page.locator('article a[href^="/products/"]').first();
    const name = (await firstProduct.textContent())?.trim();
    await firstProduct.click();

    await expect(page).toHaveURL(/\/products\/[a-z0-9-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name ?? '');
  });

  test('search returns results', async ({ page }) => {
    await page.goto('/');

    // The field offers suggestions, so its role is combobox rather than searchbox.
    const search = page.getByRole('combobox', { name: /search/i });
    await search.fill('tee');
    await search.press('Enter');

    await expect(page).toHaveURL(/\/search/);
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('an unknown route shows the not-found page, not a blank screen', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#main')).toContainText(/could not find/i);
  });

  test('the skip link is the first thing a keyboard reaches, and it works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Asserted structurally rather than by pressing Tab: the browser's
    // sequential focus point starts wherever it likes, so a Tab-based check
    // measures the harness as much as the page.
    const firstTabbable = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => {
        if (element.hasAttribute('disabled')) return false;
        if (element.getAttribute('tabindex') === '-1') return false;
        return element.offsetParent !== null || element.classList.contains('sr-only-focusable');
      });
      const first = candidates[0];
      return first ? `${first.tagName}:${(first.textContent ?? '').trim()}` : 'none';
    });
    expect(firstTabbable).toMatch(/^A:Skip to content$/i);

    const skip = page.getByRole('link', { name: /skip to content/i });
    await skip.focus();
    await expect(skip).toBeFocused();

    await skip.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'sunshop-ui',
        JSON.stringify({ state: { theme: 'system', locale: 'ar' }, version: 0 }),
      );
      localStorage.setItem('sunshop-language', 'ar');
    });
    await page.goto('/products');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test('no page renders a horizontal scrollbar on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    for (const path of ['/', '/products', '/cart', '/login']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });

  test('browsing raises no application errors and no server faults', async ({ page }) => {
    /*
     * Two different things get called a console error. The browser logs one for
     * any failed request, including the 401 that an anonymous visitor's session
     * probe is *supposed* to return, so asserting on the raw stream fails for
     * correct behaviour. What matters is that the application itself never
     * threw and that the server never returned a 5xx.
     */
    const appErrors: string[] = [];
    const serverFaults: string[] = [];

    page.on('pageerror', (error) => appErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (message.text().startsWith('Failed to load resource')) return;
      appErrors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 500) serverFaults.push(`${response.status()} ${response.url()}`);
    });

    await page.goto('/');
    await page.goto('/products');
    await page.locator('article a[href^="/products/"]').first().click();
    await page.waitForLoadState('networkidle');

    expect(appErrors).toEqual([]);
    expect(serverFaults).toEqual([]);
  });
});
