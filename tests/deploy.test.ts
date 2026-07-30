import { describe, expect, it } from 'vitest';
import { stripUnbuiltNotice } from '../vite.config.ts';

// `?raw` rather than `node:fs`: it needs no Node type declarations and no
// guesses about the working directory, and Vite resolves it the same way the
// real build does.
import indexHtml from '../index.html?raw';
import watchdog from '../public/boot-watchdog.js?raw';
import serviceWorker from '../src/sw.ts?raw';

/**
 * The deployment contract.
 *
 * PrintNest was once published with no build step, so a static host served the
 * source `index.html` verbatim. That file asks for `/src/main.ts`; browsers
 * refuse TypeScript as a module script; the loading state stayed on screen
 * indefinitely with nothing on the page to say why.
 *
 * Two safety nets came out of that, and both are only worth anything if they
 * are wired up exactly right — which is what these tests hold in place.
 */

describe('the unbuilt-deployment notice', () => {
  it('is present in the source index.html', () => {
    // If this fails, an unbuilt deploy has gone back to failing silently.
    expect(indexHtml).toContain('<!--pn-unbuilt-->');
    expect(indexHtml).toContain('<!--/pn-unbuilt-->');
    expect(indexHtml).toContain('This site was published without being built');
  });

  it('names the settings needed to fix it, since that is its whole purpose', () => {
    const notice = indexHtml.slice(
      indexHtml.indexOf('<!--pn-unbuilt-->'),
      indexHtml.indexOf('<!--/pn-unbuilt-->'),
    );
    expect(notice).toContain('npm run build');
    expect(notice).toContain('dist');
    expect(notice).toContain('hello@storitellah.com');
  });

  it('needs no JavaScript, because in that situation none can run', () => {
    const notice = indexHtml.slice(
      indexHtml.indexOf('<!--pn-unbuilt-->'),
      indexHtml.indexOf('<!--/pn-unbuilt-->'),
    );
    expect(notice).not.toContain('<script');
  });

  it('is removed completely from a build', () => {
    const built = stripUnbuiltNotice(indexHtml);
    expect(built).not.toContain('pn-unbuilt');
    expect(built).not.toContain('This site was published without being built');
    // The rest of the document must survive intact.
    expect(built).toContain('<div id="app">');
    expect(built).toContain('/src/main.ts');
    expect(built).toContain('./boot-watchdog.js');
  });

  it('leaves markup alone when there is no notice to remove', () => {
    const plain = '<body>\n  <p>nothing to strip</p>\n</body>';
    expect(stripUnbuiltNotice(plain)).toBe(plain);
  });

  it('is idempotent, so running the transform twice is harmless', () => {
    const once = stripUnbuiltNotice(indexHtml);
    expect(stripUnbuiltNotice(once)).toBe(once);
  });

  it('strips the indentation and trailing newline, not just the tags', () => {
    const html = '<body>\n    <!--pn-unbuilt-->\n    <p>x</p>\n    <!--/pn-unbuilt-->\n    <main></main>\n</body>';
    expect(stripUnbuiltNotice(html)).toBe('<body>\n    <main></main>\n</body>');
  });
});

describe('the boot watchdog', () => {
  it('loads before the application bundle', () => {
    // Its listeners have to be registered before the browser starts fetching
    // the bundle, or the failure it exists to catch happens unobserved.
    expect(indexHtml.indexOf('./boot-watchdog.js')).toBeLessThan(indexHtml.indexOf('/src/main.ts'));
  });

  it('is loaded as a classic, non-deferred script', () => {
    // `type="module"` would defer it; `defer`/`async` likewise.
    expect(indexHtml).toContain('<script src="./boot-watchdog.js"></script>');
  });

  it('lives in public/ so the bundler cannot fold it into the main chunk', () => {
    // Regression: as a second `src/` entry point Vite merged it into the
    // application chunk, so it failed alongside the thing it reports on.
    expect(indexHtml).not.toContain('src/bootWatchdog');
  });

  it('imports nothing, for the same reason', () => {
    expect(watchdog).not.toMatch(/^\s*import\s/m);
    expect(watchdog).not.toMatch(/\brequire\(/);
    expect(watchdog).not.toMatch(/\bimport\(/);
  });

  it('builds its report without innerHTML', () => {
    // Matches use, not mention: the file's own comments discuss innerHTML.
    expect(watchdog).not.toMatch(/\.innerHTML\b/);
    expect(watchdog).not.toMatch(/\.outerHTML\b/);
    expect(watchdog).not.toMatch(/insertAdjacentHTML\s*\(/);
  });

  it('offers a working control rather than a dead end', () => {
    expect(watchdog).toContain('window.location.reload()');
    expect(watchdog).toContain('hello@storitellah.com');
  });

  it('keys off the loading state the application removes', () => {
    // The signal is `.pn-boot` still being in the document; `main.ts` clears it
    // as its first act, so the two must agree on the class name.
    expect(watchdog).toContain('.pn-boot');
    expect(indexHtml).toContain('class="pn-boot"');
  });

  it('is pre-cached by the service worker', () => {
    // It is copied from `public/`, so it never appears in `precache.json`. The
    // file that explains a failed start is the worst one to be missing offline.
    expect(serviceWorker).toContain("'./boot-watchdog.js'");
  });
});
