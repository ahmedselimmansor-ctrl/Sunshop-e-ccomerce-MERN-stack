import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: a real browser against the real storefront and API.
 *
 * These cover what neither unit nor integration tests can reach — that the
 * pages actually render, that a customer can get from the catalogue to a
 * placed order, and that the bilingual layout flips with the language. The
 * integration suite already proves the API's contracts, so these stay on the
 * journeys rather than re-testing every status code through a browser.
 *
 * The dev stack is started for you unless one is already listening, which
 * keeps a local run fast and a CI run self-contained. Docker must be up first:
 * `docker compose up -d`.
 */
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  // A browser test that has to retry locally is a browser test that is lying.
  retries: process.env.CI ? 1 : 0,
  // The suite shares one seeded database, so parallel files would fight over
  // stock levels and account state.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: WEB,
    // Artefacts only for failures: a green run should not leave a gigabyte of
    // traces behind.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev',
    url: WEB,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
