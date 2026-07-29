/// <reference lib="webworker" />

/**
 * The offline service worker.
 *
 * PrintNest is a static application with no API, so caching is simple and
 * deliberately conservative:
 *
 *  - The application shell and its hashed assets are pre-cached at install.
 *  - Navigations are network-first with a cache fallback, so a deploy is
 *    picked up promptly but the app still opens on a plane.
 *  - Everything else is cache-first, because Vite gives every asset a
 *    content hash — a cached hit can never be stale.
 *
 * The cache name carries a version. Bumping it discards the old cache
 * wholesale, which is the only invalidation strategy that cannot go wrong.
 */

declare const self: ServiceWorkerGlobalScope;

const VERSION = 'v1';
const CACHE = `printnest-${VERSION}`;

/**
 * The build writes `precache.json` listing every emitted asset, so the worker
 * does not need the list compiled into it — which would mean the worker's own
 * hash changed on every deploy for no reason.
 */
const SHELL = ['./', './index.html', './manifest.webmanifest', './offline.html'];

async function precacheList(): Promise<string[]> {
  try {
    const response = await fetch('./precache.json', { cache: 'no-cache' });
    if (!response.ok) return SHELL;
    const files = (await response.json()) as unknown;
    if (!Array.isArray(files)) return SHELL;
    return [...SHELL, ...files.filter((entry): entry is string => typeof entry === 'string')];
  } catch {
    return SHELL;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const urls = await precacheList();
      // `addAll` fails the whole install if any single request fails, which
      // would leave the app with no offline support at all — cache one by one.
      await Promise.all(
        urls.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            /* a missing optional asset must not break installation */
          }
        }),
      );
      // Take over straight away on a first install so the app works offline
      // immediately rather than only on the next visit.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('printnest-') && name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'skip-waiting') {
    void self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Never touch anything but same-origin GETs. PrintNest makes no cross-origin
  // requests, so anything else is not ours to handle.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Single-page fallback: any unknown path resolves to the app shell.
    const shell = await cache.match('./index.html');
    if (shell) return shell;
    return new Response('PrintNest is offline and this page is not cached.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Opaque responses cannot be inspected and are not ours; skip them.
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504 });
  }
}

export {};
