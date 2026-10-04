/**
 * Web-Mercator maths + static mini-map compositor.
 *
 * No Leaflet: a hand-rolled tile compositor is ~2 KB, has no DOM dependency in
 * its maths, and keeps the whole app well under the 150 KB budget.
 */

import { clamp } from './format.js';

export const TILE_SIZE = 256;
export const MAX_LATITUDE = 85.0511287798;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 19;

export function clampLatitude(lat) {
  return clamp(lat, -MAX_LATITUDE, MAX_LATITUDE);
}

/** Project WGS84 -> world pixel coordinates. */
export function project({ lat, lon, zoom, tileSize = TILE_SIZE }) {
  const worldSize = 2 ** zoom * tileSize;
  const x = ((lon + 180) / 360) * worldSize;
  const sin = Math.sin((clampLatitude(lat) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize;
  return { x, y, worldSize };
}

/** Inverse of {@link project}. */
export function unproject({ x, y, zoom, tileSize = TILE_SIZE }) {
  const worldSize = 2 ** zoom * tileSize;
  const lon = (x / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lon };
}

/** Ground resolution in metres/pixel at a given latitude + zoom. */
export function metersPerPixel(lat, zoom, tileSize = TILE_SIZE) {
  const cos = Math.cos((clampLatitude(lat) * Math.PI) / 180);
  return ((156543.03392 * cos) / 2 ** zoom) * (tileSize / 256);
}

/** Great-circle distance in metres (haversine). */
export function haversineDistance(a, b) {
  if (!a || !b || ![a.lat, a.lon, b.lat, b.lon].every(Number.isFinite)) return Infinity;
  const R = 6371008.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Highest zoom whose viewport still covers `meters` across `pixels` px. */
export function zoomForSpan({ lat, meters, pixels, minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM }) {
  if (!Number.isFinite(meters) || !Number.isFinite(pixels) || meters <= 0 || pixels <= 0) {
    return maxZoom;
  }
  let zoom = maxZoom;
  while (zoom > minZoom && metersPerPixel(lat, zoom) * pixels < meters) zoom -= 1;
  return zoom;
}

/**
 * Work out exactly which tiles a viewport needs, with X wrapped (antimeridian)
 * and Y clipped (polar regions).
 *
 * @returns {{center: {x:number,y:number}, originX: number, originY: number,
 *            worldSize: number, mpp: number, zoom: number,
 *            tiles: Array<{x:number,y:number,dx:number,dy:number}>}}
 */
export function planMap({ lat, lon, zoom, width, height, tileSize = TILE_SIZE }) {
  const z = Math.round(clamp(zoom, MIN_ZOOM, MAX_ZOOM));
  const center = project({ lat, lon, zoom: z, tileSize });
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;
  const count = 2 ** z;

  const firstCol = Math.floor(originX / tileSize);
  const lastCol = Math.floor((originX + width - 0.01) / tileSize);
  const firstRow = Math.floor(originY / tileSize);
  const lastRow = Math.floor((originY + height - 0.01) / tileSize);

  const tiles = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    if (row < 0 || row >= count) continue; // above/below the map edge
    for (let col = firstCol; col <= lastCol; col += 1) {
      const x = ((col % count) + count) % count;
      tiles.push({ x, y: row, dx: col * tileSize - originX, dy: row * tileSize - originY });
    }
  }

  return {
    center,
    originX,
    originY,
    worldSize: center.worldSize,
    mpp: metersPerPixel(lat, z, tileSize),
    zoom: z,
    tileSize,
    width,
    height,
    tiles,
  };
}

/**
 * Draw the planned tiles, a scale bar and a centre marker.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof planMap>} plan
 * @param {(z:number, x:number, y:number) => Promise<{width:number,height:number}|null>} loadTile
 */
export async function drawStaticMap(ctx, plan, loadTile) {
  const { width, height, tileSize, zoom, tiles } = plan;

  ctx.save();
  ctx.fillStyle = '#1b2129';
  ctx.fillRect(0, 0, width, height);

  let loaded = 0;
  const results = await Promise.all(
    tiles.map(async (tile) => {
      try {
        return { tile, image: await loadTile(zoom, tile.x, tile.y) };
      } catch {
        return { tile, image: null };
      }
    }),
  );

  for (const { tile, image } of results) {
    if (!image) continue;
    loaded += 1;
    ctx.drawImage(image, tile.dx, tile.dy, tileSize, tileSize);
  }
  ctx.restore();

  const failed = tiles.length - loaded;
  drawScaleBar(ctx, plan);
  drawCentreMarker(ctx, width / 2, height / 2);

  return { loaded, failed, total: tiles.length, ok: loaded > 0 };
}

/** Scale bar + label sized to a round number of metres. */
export function scaleBarFor(plan, maxWidth = 96) {
  const target = plan.mpp * maxWidth;
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  let metres = steps[0];
  for (const step of steps) {
    if (step <= target) metres = step;
  }
  const pixels = metres / plan.mpp;
  return {
    metres,
    pixels,
    label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m`,
  };
}

function drawScaleBar(ctx, plan) {
  const bar = scaleBarFor(plan, Math.min(96, plan.width * 0.4));
  const pad = Math.max(6, Math.round(plan.width * 0.03));
  const x = pad;
  const y = plan.height - pad;
  const h = Math.max(4, Math.round(plan.height * 0.03));

  ctx.save();
  ctx.fillStyle = 'rgba(9, 12, 16, 0.72)';
  ctx.fillRect(x - 3, y - h - 3, bar.pixels + 6, h + 6);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y - h, bar.pixels, 2);
  ctx.fillRect(x, y - h, 2, h);
  ctx.fillRect(x + bar.pixels - 2, y - h, 2, h);
  ctx.font = `${Math.max(9, Math.round(plan.height * 0.075))}px system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillText(bar.label, x, y - h - 3);
  ctx.restore();
}

function drawCentreMarker(ctx, x, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(x, y, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#22c55e';
  ctx.fill();
  ctx.restore();
}

/**
 * Offline / blocked-tiles fallback: a graticule grid so the stamp still carries
 * a meaningful map panel without any network access.
 */
export function drawPlaceholderMap(ctx, plan) {
  const { width, height, tileSize, center, worldSize } = plan;
  ctx.save();
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  const step = tileSize / 2;
  for (let gx = -(center.x % step); gx < width; gx += step) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
    ctx.stroke();
  }
  for (let gy = -(center.y % step); gy < height; gy += step) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
    ctx.stroke();
  }

  // Draw the viewport rectangle in "world" terms so the grid looks geodetic.
  ctx.strokeStyle = 'rgba(34,197,94,0.5)';
  ctx.strokeRect(
    (center.x - width / 2) / worldSize * width,
    (center.y - height / 2) / worldSize * height,
    (width / worldSize) * width,
    (height / worldSize) * height,
  );

  ctx.font = `${Math.max(9, Math.round(height * 0.08))}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textAlign = 'center';
  ctx.fillText('map tiles unavailable', width / 2, height - Math.max(8, height * 0.09));
  ctx.restore();

  drawCentreMarker(ctx, width / 2, height / 2);
  return { loaded: 0, failed: 0, total: 0, ok: false, placeholder: true };
}
