/**
 * Test environment setup.
 *
 * jsdom has no IndexedDB, so the storage suites would otherwise skip — and a
 * skipped test proves nothing about project saving and recovery, which is
 * where a bug loses someone's work. `fake-indexeddb` provides a faithful
 * in-memory implementation of the same API surface.
 */

import 'fake-indexeddb/auto';

// jsdom does not implement canvas. The renderer tests only assert layout
// values, so a minimal stub keeps the DOM paths reachable without pulling in
// a native canvas dependency.
if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = (): null => null;
}
