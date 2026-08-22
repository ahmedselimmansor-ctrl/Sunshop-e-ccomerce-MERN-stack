import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  // Never clean in watch mode. The server and both Vite apps import this
  // package's dist directly, and they start in parallel with the watcher: if
  // it empties dist/ first, the API dies on ERR_MODULE_NOT_FOUND and Vite's
  // dependency scan cannot resolve the entry. A one-off build still cleans.
  clean: !options.watch,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: 'es2022',
  external: ['zod'],
}));
