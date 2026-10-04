import { describe, expect, it } from 'vitest';

import { BRAND_LABEL, drawOverlay, layoutOverlay } from '../src/lib/overlay.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { callsOf, createCanvasStub } from './helpers/canvas-stub.js';

const data = {
  coordsText: '51.50740° N, 0.12780° W',
  timeText: '2026-10-04  14:32:07 UTC+00:00',
  addressText: '10 Downing Street, SW1A 2AA London',
  accuracyText: '±8 m',
  accuracy: 8,
};

const withBounds = (layout) => {
  const boxes = [layout.panel, layout.map].filter(Boolean);
  const inFrame = boxes.every(
    (box) =>
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= layout.width + 0.001 &&
      box.y + box.height <= layout.height + 0.001,
  );
  const brandOk = !layout.brand || (layout.brand.x >= 0 && layout.brand.y >= 0);
  return inFrame && brandOk;
};

describe('layoutOverlay', () => {
  it('keeps every panel inside a full-resolution photo', () => {
    const layout = layoutOverlay({ width: 4032, height: 3024, data, settings: DEFAULT_SETTINGS });
    expect(layout.lines).toHaveLength(4);
    expect(withBounds(layout)).toBe(true);
  });

  it('never lets the map overlap the text panel', () => {
    for (const [width, height] of [
      [4032, 3024],
      [1920, 1080],
      [1080, 1920],
      [800, 600],
      [640, 480],
    ]) {
      const layout = layoutOverlay({ width, height, data, settings: DEFAULT_SETTINGS });
      if (!layout.map) continue;
      expect(layout.map.y + layout.map.height).toBeLessThanOrEqual(layout.panel.y);
      expect(layout.map.x + layout.map.width).toBeLessThanOrEqual(width);
      expect(layout.map.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('drops the map when the image is too small to fit it above the panel', () => {
    const layout = layoutOverlay({ width: 200, height: 150, data, settings: DEFAULT_SETTINGS });
    expect(layout.map).toBeNull();
    expect(layout.lines.length).toBeGreaterThan(0);
    expect(layout.panel.height).toBeGreaterThan(0);
  });

  it('renders nothing but a scrim when every overlay is off', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      showMap: false,
      showCoords: false,
      showTimestamp: false,
      showAddress: false,
      showAccuracy: false,
      showWatermark: false,
    };
    const layout = layoutOverlay({ width: 4032, height: 3024, data, settings });
    expect(layout.lines).toHaveLength(0);
    expect(layout.panel.height).toBe(0);
    expect(layout.map).toBeNull();
    expect(layout.brand).toBeNull();
  });

  it('scales typography with the image so stamps stay readable', () => {
    const small = layoutOverlay({ width: 640, height: 480, data, settings: DEFAULT_SETTINGS });
    const large = layoutOverlay({ width: 6400, height: 4800, data, settings: DEFAULT_SETTINGS });
    const sizeOf = (line) => Number.parseInt(line.font.match(/(\d+)px/)[1], 10);
    expect(sizeOf(large.lines[0])).toBeGreaterThan(sizeOf(small.lines[0]));
  });
});

describe('drawOverlay', () => {
  const settings = DEFAULT_SETTINGS;

  it('paints the map panel, the text lines and the watermark', () => {
    const layout = layoutOverlay({ width: 4032, height: 3024, data, settings });
    const { canvas, calls } = createCanvasStub(4032, 3024);
    const mapCanvas = { width: 920, height: 662 };

    drawOverlay(canvas.getContext('2d'), layout, { mapCanvas, mapPlaceholder: false });

    const images = callsOf(calls, 'drawImage');
    expect(images).toHaveLength(1);
    expect(images[0].args[0]).toBe(mapCanvas);

    const texts = callsOf(calls, 'fillText').map((call) => call.args[0]);
    expect(texts).toContain(BRAND_LABEL);
    expect(texts).toContain(data.coordsText);
    expect(texts).toContain(data.timeText);
    expect(texts).toContain('© OpenStreetMap contributors');
  });

  it('labels the map as an offline grid when tiles were unavailable', () => {
    const layout = layoutOverlay({ width: 1920, height: 1080, data, settings });
    const { canvas, calls } = createCanvasStub(1920, 1080);
    drawOverlay(canvas.getContext('2d'), layout, {
      mapCanvas: { width: 500, height: 360 },
      mapPlaceholder: true,
    });
    const texts = callsOf(calls, 'fillText').map((call) => call.args[0]);
    expect(texts).toContain('OSM grid (offline)');
  });

  it('truncates text that would overflow the panel', () => {
    const long = {
      ...data,
      coordsText: 'x'.repeat(400),
      timeText: '',
      addressText: '',
      accuracyText: '',
    };
    const layout = layoutOverlay({
      width: 400,
      height: 300,
      data: long,
      settings: { ...settings, showTimestamp: false, showAddress: false, showAccuracy: false },
    });
    const { canvas, calls } = createCanvasStub(400, 300);
    drawOverlay(canvas.getContext('2d'), layout, {});
    const texts = callsOf(calls, 'fillText').map((call) => call.args[0]);
    expect(texts.some((text) => text.endsWith('…'))).toBe(true);
  });
});
