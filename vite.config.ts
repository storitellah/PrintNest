import { defineConfig } from 'vite';

/**
 * PrintNest is a fully static, client-side application. There is no server
 * component, no API and no build-time secret — everything below is about
 * producing a small, cache-friendly bundle for Cloudflare Pages.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    // Keep the first paint small: the PDF engines are only pulled in when a
    // user actually imports or exports a PDF.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('pdf-lib')) return 'pdflib';
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
