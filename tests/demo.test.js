import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDemoCamera, createDemoGeo } from '../src/lib/demo.js';
import { callsOf, createCanvasStub } from './helpers/canvas-stub.js';

function streamStub() {
  const tracks = [{ stop: vi.fn() }];
  return { getTracks: () => tracks, _tracks: tracks };
}

afterEach(() => vi.useRealTimers());

describe('createDemoCamera', () => {
  it('reports unsupported when captureStream is missing', () => {
    const demo = createDemoCamera({ canvasFactory: (w, h) => createCanvasStub(w, h).canvas });
    expect(demo.supported).toBe(false);
    expect(demo.stream).toBeNull();
  });

  it('streams a continuously drawn scene and stops cleanly', () => {
    vi.useFakeTimers();
    const stub = createCanvasStub(1280, 720);
    stub.canvas.captureStream = vi.fn(() => streamStub());

    const demo = createDemoCamera({ canvasFactory: () => stub.canvas, fps: 30 });
    expect(demo.supported).toBe(true);
    expect(stub.canvas.captureStream).toHaveBeenCalledWith(30);
    expect(callsOf(stub.calls, 'fillText').length).toBeGreaterThan(0); // the label

    const before = stub.calls.length;
    vi.advanceTimersByTime(100); // ~3 frames at 30fps
    expect(stub.calls.length).toBeGreaterThan(before);

    demo.stop();
    const after = stub.calls.length;
    vi.advanceTimersByTime(300);
    expect(stub.calls.length).toBe(after); // timer cleared
    expect(demo.stream._tracks[0].stop).toHaveBeenCalled();
  });

  it('mirrors the scene on flip', () => {
    vi.useFakeTimers();
    const stub = createCanvasStub(640, 360);
    stub.canvas.captureStream = () => streamStub();
    const demo = createDemoCamera({ canvasFactory: () => stub.canvas });

    expect(callsOf(stub.calls, 'scale')).toHaveLength(0);
    demo.flip();
    expect(callsOf(stub.calls, 'scale').length).toBeGreaterThan(0);
    demo.stop();
  });
});

describe('createDemoGeo', () => {
  it('emits an immediate fix then periodic ones, and stops on demand', () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const geo = createDemoGeo({ base: { lat: 12.97569, lon: 77.60124 }, intervalMs: 1000 });

    geo.start(onUpdate);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(onUpdate).toHaveBeenCalledTimes(4);

    const point = onUpdate.mock.calls[0][0];
    expect(point.source).toBe('demo');
    expect(point.accuracy).toBe(6);
    expect(Math.abs(point.lat - 12.97569)).toBeLessThan(0.001);
    expect(Math.abs(point.lon - 77.60124)).toBeLessThan(0.001);

    geo.stop();
    vi.advanceTimersByTime(3000);
    expect(onUpdate).toHaveBeenCalledTimes(4);
  });
});
