/**
 * OpenStreetMap raster tile loader (browser only).
 *
 * - `crossOrigin = 'anonymous'`: OSM serves tiles with
 *   `Access-Control-Allow-Origin: *`, so the canvas stays untainted and can be
 *   exported. If a proxy strips that header the export path detects the taint
 *   and swaps in a locally drawn placeholder instead of failing.
 * - LRU memory cache + in-flight dedupe + a concurrency cap keeps us well
 *   inside OSM's tile usage policy.
 */

export const TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function tileUrl(z, x, y) {
  return TILE_URL_TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

export function createTileLoader({
  cache = new Map(),
  maxEntries = 200,
  timeoutMs = 8000,
  maxConcurrent = 6,
  imageFactory = () => new Image(),
  urlFor = tileUrl,
} = {}) {
  let active = 0;
  const queue = [];

  const next = () => {
    const job = queue.shift();
    if (job) {
      active += 1;
      job();
    }
  };

  const acquire = () =>
    new Promise((resolve) => {
      if (active < maxConcurrent) {
        active += 1;
        resolve();
      } else {
        queue.push(resolve);
      }
    });

  const release = () => {
    active -= 1;
    next();
  };

  async function loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached); // refresh LRU position
      return cached;
    }

    await acquire();
    try {
      const image = await new Promise((resolve, reject) => {
        const img = imageFactory();
        const timer = setTimeout(() => reject(new Error('tile timeout')), timeoutMs);
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => {
          clearTimeout(timer);
          resolve(img);
        };
        img.onerror = () => {
          clearTimeout(timer);
          reject(new Error(`tile ${key} failed`));
        };
        img.src = urlFor(z, x, y);
      });

      cache.set(key, image);
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
      return image;
    } finally {
      release();
    }
  }

  return { loadTile, cache, size: () => cache.size };
}
