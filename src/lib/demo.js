/**
 * Demo mode: a synthetic camera scene + a synthetic GPS feed.
 *
 * Used when the real camera cannot start — embedded preview iframes that do
 * not delegate `camera=`, desktops without a webcam, or denied permissions —
 * so the whole stamping pipeline (overlay, mini-map, reverse geocode, export)
 * stays fully testable end to end. Everything still runs on-device.
 */

/**
 * @param {{width?: number, height?: number, fps?: number,
 *          canvasFactory?: (w:number,h:number)=>HTMLCanvasElement}} [options]
 */
export function createDemoCamera({ width = 1280, height = 720, fps = 30, canvasFactory } = {}) {
  const canvas = canvasFactory
    ? canvasFactory(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  if (typeof canvas.captureStream !== 'function') {
    return { supported: false, stream: null, flip() {}, stop() {} };
  }

  let mirrored = false;
  let frame = 0;

  function draw() {
    frame += 1;
    const t = frame;
    ctx.save();
    if (mirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#0e2a4a');
    sky.addColorStop(0.6, '#153e6b');
    sky.addColorStop(1, '#0b1220');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Sun
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(width * 0.78, height * 0.24 + Math.sin(t / 40) * 6, height * 0.07, 0, Math.PI * 2);
    ctx.fill();

    // Rolling hills
    ctx.fillStyle = '#14532d';
    ctx.beginPath();
    ctx.moveTo(0, height * 0.74);
    for (let x = 0; x <= width; x += 32) {
      ctx.lineTo(x, height * 0.74 - Math.sin((x + t * 6) / 180) * height * 0.05);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    // A "surveyor's" marker pacing across the scene
    const px = width * (0.15 + 0.7 * ((t % 600) / 600));
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(px, height * 0.8, height * 0.02, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Un-mirrored label so it always reads correctly
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `600 ${Math.round(height * 0.05)}px system-ui, sans-serif`;
    ctx.fillText('DEMO SCENE — no real camera in use', width * 0.04, height * 0.1);
  }

  draw();
  const timer = setInterval(draw, Math.round(1000 / fps));
  const stream = canvas.captureStream(fps);

  return {
    supported: true,
    stream,
    width,
    height,
    flip() {
      mirrored = !mirrored;
      draw();
    },
    stop() {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

/**
 * A wandering GPS fix around a base coordinate (default: MG Road, Bengaluru).
 * Emits the same shape as `toGeoPoint`, so the rest of the app cannot tell.
 */
export function createDemoGeo({
  base = { lat: 12.97569, lon: 77.60124 },
  intervalMs = 2000,
  now = () => Date.now(),
} = {}) {
  let tick = 0;
  let timer = 0;

  const point = () => {
    tick += 1;
    return {
      lat: base.lat + Math.sin(tick / 9) * 0.0004,
      lon: base.lon + Math.cos(tick / 7) * 0.0004,
      accuracy: 6,
      altitude: 920,
      heading: null,
      speed: null,
      timestamp: now(),
      source: 'demo',
    };
  };

  return {
    start(onUpdate) {
      onUpdate(point());
      timer = setInterval(() => onUpdate(point()), intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = 0;
    },
  };
}
