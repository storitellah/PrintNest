/**
 * Reports a failed start.
 *
 * Three deliberate choices, all for the same reason — this file has to keep
 * working in exactly the situations where the application bundle does not:
 *
 *  1. It lives in `public/` rather than `src/`, so Vite copies it verbatim
 *     instead of bundling it. As a second `src/` entry point the bundler
 *     merged it into the main chunk, which would have made it fail alongside
 *     the very thing it exists to report on.
 *  2. It is therefore plain JavaScript, not TypeScript. That is the cost of
 *     the guarantee above, and worth it for a hundred lines of diagnostics.
 *  3. It is a classic, non-deferred script in `<head>`, so its listeners are
 *     registered before the browser starts fetching the bundle. A deferred
 *     script can miss the failure it is watching for.
 *
 * Without it, any failure to load the bundle — a wrong MIME type, a Content
 * Security Policy that blocks the script, a half-finished deploy, a content
 * blocker — leaves the static loading state from `index.html` on screen for
 * ever, telling the user nothing at all.
 */
(function () {
  'use strict';

  /** Specific load failures seen by the listeners below, in order. */
  var failures = [];

  /** Filename only: the full URL is noise and can carry a long content hash. */
  function fileName(url) {
    try {
      var path = new URL(url, window.location.href).pathname;
      return path.slice(path.lastIndexOf('/') + 1) || path;
    } catch (error) {
      return url;
    }
  }

  /**
   * Resource load errors do not bubble, so the capture phase is the only place
   * a `<script>` or `<link>` that failed to load can be observed.
   */
  window.addEventListener(
    'error',
    function (event) {
      var target = event.target;

      if (target instanceof HTMLScriptElement && target.src) {
        failures.push(fileName(target.src) + ' could not be loaded, or the browser refused to run it.');
        return;
      }

      if (target instanceof HTMLLinkElement && target.href) {
        failures.push(fileName(target.href) + ' could not be loaded.');
        return;
      }

      if (event.message) failures.push(event.message);
    },
    true,
  );

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var message = reason instanceof Error ? reason.message : String(reason == null ? '' : reason);
    if (message) failures.push(message);
  });

  function paragraph(text, margin) {
    var node = document.createElement('p');
    node.textContent = text;
    node.style.margin = margin;
    return node;
  }

  function listOf(tagName, items) {
    var list = document.createElement(tagName);
    list.style.margin = '0 0 1.25rem';
    list.style.paddingLeft = '1.25rem';
    items.forEach(function (text) {
      var item = document.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    });
    return list;
  }

  /**
   * Builds the report with plain DOM calls and `textContent`. `innerHTML` is
   * not used anywhere in PrintNest, and a diagnostic screen is no reason to
   * start.
   */
  function reportFailure(boot) {
    var panel = document.createElement('div');
    panel.setAttribute('role', 'alert');
    panel.style.maxWidth = '38rem';
    panel.style.textAlign = 'left';
    panel.style.lineHeight = '1.6';

    var heading = document.createElement('h1');
    heading.textContent = 'PrintNest could not start';
    heading.style.fontFamily = "'Iowan Old Style', Palatino, Georgia, serif";
    heading.style.fontSize = '1.5rem';
    heading.style.margin = '0 0 0.75rem';
    panel.appendChild(heading);

    panel.appendChild(
      paragraph(
        'The page loaded, but the application code did not run. Any projects you have saved are unaffected — they live in this browser and are still there.',
        '0 0 1rem',
      ),
    );

    if (failures.length > 0) {
      var whatHappened = paragraph('What went wrong:', '0 0 0.35rem');
      whatHappened.style.fontWeight = '600';
      panel.appendChild(whatHappened);

      // De-duplicated: one missing chunk can raise the same error repeatedly.
      var unique = failures.filter(function (value, index) {
        return failures.indexOf(value) === index;
      });
      panel.appendChild(listOf('ul', unique.slice(0, 4)));
    }

    var checkTitle = paragraph('Worth checking, in order:', '0 0 0.35rem');
    checkTitle.style.fontWeight = '600';
    panel.appendChild(checkTitle);

    panel.appendChild(
      listOf('ol', [
        'Reload the page — an interrupted first download is the commonest cause.',
        'Open the browser console. The error there is more specific than anything this page can work out on its own.',
        'If you deployed this site: check that it was built with "npm run build" and that the published folder is "dist" rather than the repository root.',
        'If you use a content blocker, or a locked-down work browser, try once with it switched off.',
      ]),
    );

    var reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload PrintNest';
    reload.style.font = 'inherit';
    reload.style.cursor = 'pointer';
    reload.style.padding = '0.6rem 1.1rem';
    reload.style.borderRadius = '0.5rem';
    reload.style.border = '1px solid currentColor';
    reload.style.background = 'transparent';
    reload.style.color = 'inherit';
    reload.addEventListener('click', function () {
      window.location.reload();
    });
    panel.appendChild(reload);

    var help = paragraph('', '1.25rem 0 0');
    help.style.fontSize = '0.95rem';
    help.style.opacity = '0.75';
    help.appendChild(document.createTextNode('Still stuck? '));
    var mail = document.createElement('a');
    mail.href = 'mailto:hello@storitellah.com';
    mail.textContent = 'hello@storitellah.com';
    mail.style.color = 'inherit';
    help.appendChild(mail);
    help.appendChild(document.createTextNode('.'));
    panel.appendChild(help);

    boot.replaceChildren(panel);
  }

  /**
   * The check runs after `load`, not on a bare timer.
   *
   * Module scripts are deferred, so by the time `load` fires the bundle has
   * either evaluated — in which case it has already removed the loading state
   * — or failed. A script that 404s still lets `load` fire, which is what
   * makes this a reliable signal rather than a guess about network speed.
   *
   * The grace period afterwards covers a bundle that clears the loading state
   * from a microtask rather than synchronously.
   */
  var GRACE_MS = 2500;

  function check() {
    window.setTimeout(function () {
      var boot = document.querySelector('.pn-boot');
      // Gone means `main.ts` reached its mount step: nothing to report.
      if (boot) reportFailure(boot);
    }, GRACE_MS);
  }

  if (document.readyState === 'complete') {
    check();
  } else {
    window.addEventListener('load', check, { once: true });
  }
})();
