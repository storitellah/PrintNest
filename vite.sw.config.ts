import { defineConfig } from 'vite';

/**
 * A second, tiny build whose only job is to emit `dist/sw.js`.
 *
 * A service worker cannot be an ordinary Vite entry: it must live at a stable,
 * unhashed path at the root of the scope it controls, and it must not be a
 * module inside the main graph. Building it separately — with `emptyOutDir`
 * off so it lands alongside the main build — is the simplest arrangement that
 * gets both of those right.
 *
 * `npm run build` runs this after the main build.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    // Classic worker scripts are the most widely supported; module workers are
    // still not universal on older Safari.
    lib: {
      entry: 'src/sw.ts',
      formats: ['iife'],
      name: 'PrintNestServiceWorker',
      fileName: () => 'sw.js',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'sw.js',
        // A service worker has no exports; suppressing the banner keeps the
        // emitted file clean.
        extend: true,
      },
    },
  },
});
