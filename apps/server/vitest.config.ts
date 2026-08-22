import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirrors the `@/*` path in tsconfig so tests import the way source does.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Integration files each boot an in-memory replica set, so they run one at
    // a time. Each still gets its own process and its own Redis database; see
    // tests/setup.ts.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Config validation exits the process on a bad environment, so tests get a
    // known-good one before any module is imported.
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Report across the whole server so the gaps stay visible, even though
      // only a few files are gated below.
      include: ['src/**/*.ts'],
      exclude: ['src/scripts/**', 'src/docs/**', 'src/**/*.d.ts'],
      thresholds: {
        /*
         * Global floors, set just under what the suite reaches today so a
         * regression trips them and ordinary work does not.
         *
         * These used to sit at 40% with only unit tests behind them, which was
         * unreachable and failed every `--coverage` run. Integration tests now
         * drive the real app over a real database, so the number means
         * something; raise these as coverage grows rather than aspirationally.
         */
        lines: 35,
        statements: 33,
        functions: 30,
        branches: 20,

        // Per-file floors for code whose correctness is load-bearing.
        'src/security/crypto.ts': { lines: 80, functions: 70 },
        'src/utils/duration.ts': { lines: 90, functions: 90 },
        'src/models/**': { lines: 80, functions: 60 },
      },
    },
  },
});
