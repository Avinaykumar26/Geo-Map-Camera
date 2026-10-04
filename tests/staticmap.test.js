import { describe, expect, it } from 'vitest';

import {
  drawPlaceholderMap,
  drawStaticMap,
  haversineDistance,
  MAX_LATITUDE,
  metersPerPixel,
  planMap,
  project,
  scaleBarFor,
  unproject,
  zoomForSpan,
} from '../src/lib/staticmap.js';
import { callsOf, createCanvasStub, createTileStub } from './helpers/canvas-stub.js';

describe('project / unproject', () => {
  it('maps the origin to the middle of the world', () => {
    const { x, y, worldSize } = project({ lat: 0, lon: 0, zoom: 1 });
    expect(worldSize).toBe(512);
    expect(x).toBe(256);
    expect(y).toBeCloseTo(256, 6);
  });

  it('maps the edges of the Mercator square', () => {
    expect(project({ lat: 0, lon: -180, zoom: 2 }).x).toBe(0);
    expect(project({ lat: 0, lon: 180, zoom: 2 }).x).toBe(1024);
    expect(project({ lat: MAX_LATITUDE, lon: 0, zoom: 2 }).y).toBeCloseTo(0, 6);
  });

  it('round-trips', () => {
    const point = { lat: 51.5074, lon: -0.1278 };
    const projected = project({ ...point, zoom: 16 });
    const back = unproject({ x: projected.x, y: projected.y, zoom: 16 });
    expect(back.lat).toBeCloseTo(point.lat, 9);
    expect(back.lon).toBeCloseTo(point.lon, 9);
  });
});

describe('metersPerPixel / zoomForSpan', () => {
  it('matches the published equator resolution at zoom 0', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
  });

  it('halves the ground distance per zoom level', () => {
    expect(metersPerPixel(51.5, 16) / metersPerPixel(51.5, 17)).toBeCloseTo(2, 9);
  });

  it('picks the zoom that still covers the requested span', () => {
    expect(zoomForSpan({ lat: 0, meters: 100, pixels: 256 })).toBeLessThan(19);
    expect(zoomForSpan({ lat: 0, meters: 500, pixels: 256 })).toBeLessThan(
      zoomForSpan({ lat: 0, meters: 100, pixels: 256 }),
    );
    expect(zoomForSpan({ lat: 0, meters: 40000000, pixels: 256 })).toBe(1);
  });
});

describe('planMap', () => {
  it('plans a 2x2 tile block for a centred 256px viewport', () => {
    const plan = planMap({ lat: 51.5074, lon: -0.1278, zoom: 16, width: 256, height: 256 });
    expect(plan.tiles).toHaveLength(4);
    expect(plan.tiles.every((t) => t.y >= 0 && t.y < 2 ** 16)).toBe(true);
    expect(plan.mpp).toBeCloseTo(metersPerPixel(51.5074, 16), 6);
  });

  it('wraps tile columns across the antimeridian', () => {
    const plan = planMap({ lat: 0, lon: 179.99, zoom: 4, width: 512, height: 256 });
    const xs = plan.tiles.map((t) => t.x).sort((a, b) => a - b);
    expect(xs).toContain(0);
    expect(xs).toContain(15);
    expect(Math.max(...xs)).toBeLessThanOrEqual(15);
  });

  it('clips rows beyond the poles instead of requesting junk tiles', () => {
    const plan = planMap({ lat: 84.9, lon: 0, zoom: 6, width: 512, height: 512 });
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(plan.tiles.every((t) => t.y >= 0 && t.y < 64)).toBe(true);
  });
});

describe('haversineDistance', () => {
  it('knows London to Paris is about 343 km', () => {
    const d = haversineDistance({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 });
    expect(d / 1000).toBeGreaterThan(330);
    expect(d / 1000).toBeLessThan(355);
  });

  it('is zero for the same point and infinite for garbage', () => {
    expect(haversineDistance({ lat: 1, lon: 1 }, { lat: 1, lon: 1 })).toBe(0);
    expect(haversineDistance(null, { lat: 1, lon: 1 })).toBe(Infinity);
  });
});

describe('scaleBarFor', () => {
  it('rounds to a friendly distance', () => {
    const plan = planMap({ lat: 51.5074, lon: -0.1278, zoom: 16, width: 400, height: 300 });
    const bar = scaleBarFor(plan, 96);
    expect(bar.metres % 1 === 0).toBe(true);
    expect(bar.pixels).toBeGreaterThan(0);
    expect(bar.pixels).toBeLessThanOrEqual(96);
    expect(bar.label).toMatch(/^\d+(\.\d+)? (m|km)$/);
  });
});

describe('drawStaticMap', () => {
  it('draws every planned tile plus scale bar and marker', async () => {
    const plan = planMap({ lat: 51.5074, lon: -0.1278, zoom: 16, width: 400, height: 300 });
    const { canvas, calls } = createCanvasStub(400, 300);
    const loadTile = createTileStub();

    const result = await drawStaticMap(canvas.getContext('2d'), plan, loadTile);

    expect(result.ok).toBe(true);
    expect(result.loaded).toBe(plan.tiles.length);
    expect(result.failed).toBe(0);
    expect(loadTile.requested.length).toBe(plan.tiles.length);
    expect(callsOf(calls, 'drawImage').length).toBe(plan.tiles.length);
    expect(callsOf(calls, 'fillText').length).toBeGreaterThan(0); // scale bar label
  });

  it('reports failures instead of throwing', async () => {
    const plan = planMap({ lat: 51.5074, lon: -0.1278, zoom: 16, width: 400, height: 300 });
    const { canvas } = createCanvasStub(400, 300);
    const result = await drawStaticMap(canvas.getContext('2d'), plan, createTileStub({ fail: true }));
    expect(result.ok).toBe(false);
    expect(result.loaded).toBe(0);
    expect(result.failed).toBe(plan.tiles.length);
  });
});

describe('drawPlaceholderMap', () => {
  it('draws an offline grid without any tile request', () => {
    const plan = planMap({ lat: 51.5074, lon: -0.1278, zoom: 16, width: 400, height: 300 });
    const { canvas, calls } = createCanvasStub(400, 300);
    const result = drawPlaceholderMap(canvas.getContext('2d'), plan);
    expect(result.placeholder).toBe(true);
    expect(callsOf(calls, 'drawImage')).toHaveLength(0);
    expect(callsOf(calls, 'fillText').length).toBeGreaterThan(0);
  });
});
