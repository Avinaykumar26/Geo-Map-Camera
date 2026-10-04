import { describe, expect, it } from 'vitest';

import { createTileLoader, tileUrl, TILE_URL_TEMPLATE } from '../src/lib/tiles.js';

function createImageStub({ failUrls = [], delay = 0, onActivity } = {}) {
  const made = [];

  class FakeImage {
    constructor() {
      this.crossOrigin = '';
      this.decoding = '';
      made.push(this);
    }

    set src(value) {
      this._src = value;
      onActivity?.('start', value);
      setTimeout(() => {
        if (failUrls.includes(value)) {
          onActivity?.('end', value);
          this.onerror?.(new Error(`failed ${value}`));
        } else {
          onActivity?.('end', value);
          this.onload?.();
        }
      }, delay);
    }

    get src() {
      return this._src;
    }
  }

  return { FakeImage, made, imageFactory: () => new FakeImage() };
}

describe('tileUrl', () => {
  it('builds an OSM raster tile URL', () => {
    expect(tileUrl(16, 32760, 21780)).toBe('https://tile.openstreetmap.org/16/32760/21780.png');
    expect(TILE_URL_TEMPLATE).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  });
});

describe('createTileLoader', () => {
  it('asks for CORS-safe images', async () => {
    const stub = createImageStub();
    const { loadTile } = createTileLoader({ imageFactory: stub.imageFactory });
    await loadTile(16, 1, 1);
    expect(stub.made[0].crossOrigin).toBe('anonymous');
  });

  it('caches tiles in memory', async () => {
    const stub = createImageStub();
    const loader = createTileLoader({ imageFactory: stub.imageFactory });
    const a = await loader.loadTile(16, 5, 5);
    const b = await loader.loadTile(16, 5, 5);
    expect(a).toBe(b);
    expect(stub.made).toHaveLength(1);
  });

  it('evicts the least recently used tile past the cap', async () => {
    const stub = createImageStub();
    const loader = createTileLoader({ imageFactory: stub.imageFactory, maxEntries: 2 });
    await loader.loadTile(1, 0, 0);
    await loader.loadTile(1, 1, 0);
    await loader.loadTile(1, 0, 1);

    expect(loader.size()).toBe(2);
    expect(loader.cache.has('1/0/0')).toBe(false);

    await loader.loadTile(1, 0, 0); // evicted earlier -> fetched again
    expect(stub.made).toHaveLength(4);
  });

  it('never exceeds the concurrency cap', async () => {
    let active = 0;
    let peak = 0;
    const stub = createImageStub({
      delay: 5,
      onActivity: (phase) => {
        if (phase === 'start') {
          active += 1;
          peak = Math.max(peak, active);
        } else {
          active -= 1;
        }
      },
    });

    const loader = createTileLoader({ imageFactory: stub.imageFactory, maxConcurrent: 2 });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => loader.loadTile(3, i, 0)),
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(loader.size()).toBe(8);
  });

  it('rejects a tile that errors, so the caller can fall back', async () => {
    const stub = createImageStub({ failUrls: [tileUrl(2, 1, 1)] });
    const loader = createTileLoader({ imageFactory: stub.imageFactory });
    await expect(loader.loadTile(2, 1, 1)).rejects.toThrow(/failed/);
    expect(loader.size()).toBe(0);
  });

  it('rejects a tile that never arrives', async () => {
    const neverImageFactory = () => ({ set src(_value) {}, set crossOrigin(_v) {}, set decoding(_v) {} });
    const loader = createTileLoader({ imageFactory: neverImageFactory, timeoutMs: 15 });
    await expect(loader.loadTile(2, 0, 0)).rejects.toThrow(/timeout/);
  });
});
