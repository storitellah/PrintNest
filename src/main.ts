import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/page.css';
import './styles/editor.css';
import './styles/print.css';

import { isStorageAvailable } from './core/db.ts';
import { mountApp } from './ui/app.ts';
import { el } from './ui/dom.ts';
import { toast } from './ui/toast.ts';

/**
 * Entry point.
 *
 * Boot order matters: styles first (so the first paint is not unstyled), then
 * the application, then the service worker. Registering the worker last keeps
 * it off the critical path.
 */

const root = document.getElementById('app');

if (!root) {
  throw new Error('PrintNest could not find its mount point.');
}

// Remove the static loading state written into index.html.
root.replaceChildren();

if (!isStorageAvailable()) {
  root.append(
    el(
      'div',
      { class: 'pn-empty', style: { padding: '4rem 1rem' } },
      el('h1', { class: 'pn-empty__title', text: 'PrintNest needs local storage' }),
      el('p', {
        class: 'pn-empty__body',
        text: 'This browser has no IndexedDB, which PrintNest uses to keep your projects on your device. Private or restricted browsing modes sometimes switch it off. Try a normal window, or a different browser.',
      }),
    ),
  );
} else {
  mountApp(root);
  void registerServiceWorker();
}

/**
 * Register the offline worker.
 *
 * Only in production: during development the worker would serve stale modules
 * and make every change look like it had not applied.
 */
async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;

  try {
    // `sw.js` is emitted by a separate build so it sits unhashed at the root
    // of its scope, which is what the service worker spec requires.
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // A worker that reaches `installed` while one is already controlling
        // the page means a new version is waiting.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          toast({
            title: 'A new version of PrintNest is ready',
            detail: 'Reload to use it. Your projects are unaffected.',
            kind: 'info',
            duration: 0,
            action: {
              label: 'Reload',
              onClick: () => {
                installing.postMessage({ type: 'skip-waiting' });
                window.location.reload();
              },
            },
          });
        }
      });
    });
  } catch {
    // Offline support is a bonus; the application works fine without it.
  }
}

// Install prompt: browsers fire this when the app qualifies for installation.
let installPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as BeforeInstallPromptEvent;
  toast({
    title: 'Install PrintNest?',
    detail: 'It will open in its own window and work without an internet connection.',
    kind: 'info',
    duration: 12_000,
    action: {
      label: 'Install',
      onClick: () => {
        void installPrompt?.prompt();
        installPrompt = null;
      },
    },
  });
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast({ title: 'PrintNest installed', detail: 'It now works offline.', kind: 'success' });
});
