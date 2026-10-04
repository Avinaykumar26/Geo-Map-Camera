/**
 * Geo Map Camera — service worker.
 *
 * Offline goal: the app shell + last session's assets load with no network, and
 * map tiles are reused from a capped cache. Camera + GPS need no network at all,
 * so a stamped photo can still be produced and saved fully offline (the map
 * panel falls back to a locally drawn grid).
 *
 * Deliberately standalone: a service worker must not depend on the app bundle.
 */

const VERSION = '1.0.0';
const SHELL_CACHE = `gmc-shell-${VERSION}`;
const TILE_CACHE = 'gmc-tiles-v1';
const TILE_MAX_ENTRIES = 200;
const TILE_HOST_SUFFIX = '.tile.openstreetmap.org';

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== TILE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

/** Cache-first for OSM tiles, capped so storage stays predictable. */
async function handleTile(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(TILE_CACHE);
      cache.put(request, response.clone());
      trimCache(TILE_CACHE, TILE_MAX_ENTRIES);
    }
    return response;
  } catch (error) {
    return new Response('', { status: 504, statusText: 'tile offline' });
  }
}

/** Stale-while-revalidate for our own assets. */
async function handleSameOrigin(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok && request.method === 'GET') cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || new Response('offline', { status: 503 });
}

/** Network-first for navigations so updates land immediately, offline falls back. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put('./index.html', response.clone());
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match('./index.html')) ||
      (await cache.match('./')) ||
      new Response('Geo Map Camera is offline and has not been cached yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);

  if (url.hostname.endsWith(TILE_HOST_SUFFIX)) {
    event.respondWith(handleTile(request));
    return;
  }

  if (url.origin !== self.location.origin) return; // never proxy anything else

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleSameOrigin(request));
});
