import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * PrintNest is a fully static, client-side application. There is no server
 * component, no API and no build-time secret — everything below is about
 * producing a small, cache-friendly bundle for Cloudflare Pages.
 */

/**
 * Writes `precache.json`, the list of emitted assets the service worker warms
 * its cache with at install time.
 *
 * Keeping the list in a separate file rather than compiling it into the worker
 * means the worker's own content hash does not change on every deploy, so
 * browsers do not re-download and re-install it unnecessarily.
 */
function precacheManifest(): Plugin {
  return {
    name: 'printnest-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        // The worker cannot meaningfully pre-cache itself, and source maps are
        // only fetched by devtools.
        .filter((name) => !name.endsWith('.map') && !/(^|\/)sw[-.][^/]*\.js$/.test(name))
        .map((name) => `./${name}`)
        .sort();

      this.emitFile({
        type: 'asset',
        fileName: 'precache.json',
        source: JSON.stringify(files, null, 2),
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [precacheManifest()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    // Warn late: the PDF engines are legitimately large, and they are lazy.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Keep the first paint small: the PDF engines are only pulled in when
        // a user actually imports or exports a PDF.
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
  preview: {
    port: 4173,
  },
});
