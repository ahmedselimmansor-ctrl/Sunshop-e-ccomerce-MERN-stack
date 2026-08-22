import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Config validation exits the process on a bad environment, so tests get a
    // known-good one before any module is imported.
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/scripts/**', 'src/docs/**', 'src/**/*.d.ts'],
      thresholds: {
        // Deliberately modest: a high global number encourages tests written to
        // hit lines rather than to catch bugs. The security and pricing paths
        // below are the ones that actually matter.
        lines: 40,
        functions: 40,
      },
    },
  },
});
