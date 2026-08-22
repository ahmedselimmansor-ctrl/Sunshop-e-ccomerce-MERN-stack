import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // Dev-only proxy so the browser sees one origin and cookies "just work"
    // without relaxing SameSite. Production serves the SPA from CloudFront and
    // talks to the API on its own subdomain via CORS.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: mode !== 'production',
    target: 'es2020',
    // Long-term-cacheable hashed assets behind CloudFront.
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        /**
         * Manual chunks so a copy change does not invalidate the 150 KB of
         * vendor code sitting in every returning visitor's cache.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          // Recharts is ~400 kB and only the dashboard needs it; splitting it
          // out keeps every other admin route light.
          charts: ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  preview: { port: 5174 },
}));
