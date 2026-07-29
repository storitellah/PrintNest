import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom throughout: the pure engines (imposition, paper maths, validation)
    // do not need it, but the render/DOM and storage suites do, and one
    // environment keeps the suite simple to run.
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
  },
});
