import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/scripts/seed.ts', 'src/scripts/reindex.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  // Bundling the workspace package keeps the runtime image free of a
  // node_modules symlink graph; everything else stays external so native and
  // instrumented modules (OTel) load normally.
  noExternal: ['@sunshop/shared'],
  banner: {
    // Some CJS-only deps reach for `require` at load time under ESM.
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});
