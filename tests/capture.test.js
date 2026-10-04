import { describe, expect, it } from 'vitest';

import {
  buildStampData,
  captureStampedPhoto,
  createStampedImage,
  exportBlob,
  filenameFor,
  renderMiniMap,
} from '../src/lib/capture.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { callsOf, createCanvasFactory, createTileStub, createVideoStub } from './helpers/canvas-stub.js';

const point = { lat: 51.5074, lon: -0.1278, accuracy: 8, timestamp: Date.UTC(2026, 9, 4) };
const address = { short: '10 Downing Street, SW1A 2AA London', full: '10 Downing Street, London, UK' };
const now = new Date(2026, 9, 4, 14, 32, 7);

describe('buildStampData', () => {
  it('turns a fix into the exact strings that get burned in', () => {
    const data = buildStampData({ point, address, settings: DEFAULT_SETTINGS, now });
    expect(data.hasFix).toBe(true);
    expect(data.coordsText).toBe('51.50740° N, 0.12780° W');
    expect(data.timeText).toBe('2026-10-04  14:32:07 UTC+00:00');
    expect(data.addressText).toBe('10 Downing Street, SW1A 2AA London');
    expect(data.accuracyText).toBe('±8 m');
  });

  it('honours the coordinate and time settings', () => {
    const data = buildStampData({
      point,
      address,
      now,
      settings: { ...DEFAULT_SETTINGS, coordFormat: 'dms', dateFormat: 'us', showAddress: false },
    });
    expect(data.coordsText).toBe('51°30\'26.6"N, 0°07\'40.1"W');
    expect(data.timeText).toMatch(/^10\/04\/2026/);
    expect(data.addressText).toBe('');
  });

  it('says so plainly when there is no fix', () => {
    const data = buildStampData({ point: null, address: null, settings: DEFAULT_SETTINGS, now });
    expect(data.hasFix).toBe(false);
    expect(data.coordsText).toBe('No GPS fix');
    expect(data.accuracyText).toBe('');
  });
});

describe('renderMiniMap', () => {
  it('returns null without a fix', async () => {
    const result = await renderMiniMap({
      point: null,
      settings: DEFAULT_SETTINGS,
      size: { width: 920, height: 662 },
      deps: { createCanvas: createCanvasFactory(), loadTile: createTileStub() },
    });
    expect(result).toBeNull();
  });

  it('renders at the requested size when tiles load', async () => {
    const loadTile = createTileStub();
    const result = await renderMiniMap({
      point,
      settings: DEFAULT_SETTINGS,
      size: { width: 920, height: 662 },
      deps: { createCanvas: createCanvasFactory(), loadTile },
    });
    expect(result.placeholder).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.canvas.width).toBe(920);
    expect(loadTile.requested.length).toBeGreaterThan(0);
  });

  it('falls back to a local grid when every tile fails', async () => {
    const result = await renderMiniMap({
      point,
      settings: DEFAULT_SETTINGS,
      size: { width: 920, height: 662 },
      deps: { createCanvas: createCanvasFactory(), loadTile: createTileStub({ fail: true }) },
    });
    expect(result.placeholder).toBe(true);
    expect(result.loaded).toBe(0);
  });

  it('discards a tainted canvas so the photo can still be exported', async () => {
    const result = await renderMiniMap({
      point,
      settings: DEFAULT_SETTINGS,
      size: { width: 920, height: 662 },
      deps: { createCanvas: createCanvasFactory({ taintIf: (_w, _h, index) => index === 0 }), loadTile: createTileStub() },
    });
    expect(result.placeholder).toBe(true);
    expect(result.canvas.getContext('2d').tainted).toBe(false);
  });
});

describe('createStampedImage', () => {
  it('composites frame + overlays into one canvas', async () => {
    const createCanvas = createCanvasFactory();
    const video = createVideoStub();
    const { canvas, layout, map } = await createStampedImage({
      video,
      point,
      address,
      settings: DEFAULT_SETTINGS,
      deps: { createCanvas, loadTile: createTileStub(), now: () => now },
    });

    expect(canvas.width).toBe(video.videoWidth);
    expect(canvas.height).toBe(video.videoHeight);
    expect(createCanvas.made).toHaveLength(2); // photo + mini-map
    expect(map.canvas.width).toBe(layout.map.width * 2);

    const draws = callsOf(createCanvas.made[0].calls, 'drawImage');
    expect(draws[0].args.slice(0, 5)).toEqual([video, 0, 0, video.videoWidth, video.videoHeight]);

    const texts = callsOf(createCanvas.made[0].calls, 'fillText').map((call) => call.args[0]);
    expect(texts).toContain('51.50740° N, 0.12780° W');
    expect(texts).toContain('10 Downing Street, SW1A 2AA London');
  });

  it('refuses to run before the camera produced a frame', async () => {
    await expect(
      createStampedImage({
        video: { videoWidth: 0, videoHeight: 0 },
        point,
        address,
        settings: DEFAULT_SETTINGS,
        deps: { createCanvas: createCanvasFactory(), loadTile: createTileStub() },
      }),
    ).rejects.toThrow(/frame/i);
  });

  it('still produces a stamp with no GPS and no tiles at all', async () => {
    const createCanvas = createCanvasFactory();
    const { canvas, data, map } = await createStampedImage({
      video: createVideoStub(1280, 720),
      point: null,
      address: null,
      settings: DEFAULT_SETTINGS,
      deps: { createCanvas, loadTile: createTileStub({ fail: true }) },
    });
    expect(data.hasFix).toBe(false);
    expect(map).toBeNull();
    expect(canvas.width).toBe(1280);
  });
});

describe('exportBlob / filenameFor', () => {
  it('exports a JPEG blob with the requested quality', async () => {
    const createCanvas = createCanvasFactory();
    const { canvas } = await createStampedImage({
      video: createVideoStub(1280, 720),
      point,
      address,
      settings: DEFAULT_SETTINGS,
      deps: { createCanvas, loadTile: createTileStub() },
    });

    const blob = await exportBlob(canvas, { format: 'jpeg', quality: 0.8 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBeGreaterThan(0);
    expect(callsOf(createCanvas.made[0].calls, 'toBlob')[0].args).toEqual(['image/jpeg', 0.8]);
  });

  it('exports PNG when asked', async () => {
    const createCanvas = createCanvasFactory();
    const { canvas } = await createStampedImage({
      video: createVideoStub(640, 480),
      point,
      address,
      settings: { ...DEFAULT_SETTINGS, exportFormat: 'png' },
      deps: { createCanvas, loadTile: createTileStub() },
    });
    const blob = await exportBlob(canvas, { format: 'png' });
    expect(blob.type).toBe('image/png');
    expect(filenameFor({ point, settings: { exportFormat: 'png' }, now })).toMatch(/\.png$/);
  });
});

describe('captureStampedPhoto (end to end)', () => {
  it('returns a downloadable blob with a geotagged filename', async () => {
    const result = await captureStampedPhoto({
      video: createVideoStub(),
      point,
      address,
      settings: DEFAULT_SETTINGS,
      deps: { createCanvas: createCanvasFactory(), loadTile: createTileStub(), now: () => now },
    });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.filename).toBe('geotag_2026-10-04_14-32-07_51.50740N-0.12780W.jpg');
    expect(result.map.placeholder).toBe(false);
  });
});
