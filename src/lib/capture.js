/**
 * The compositor: video frame + live geo data + mini-map -> one exportable image.
 *
 * All work happens on the device. Nothing here touches the network except the
 * tile loader, which is injected (`deps.loadTile`) so it can be stubbed in tests
 * and swapped for an offline source later.
 */

import { createCanvas, isCanvasTainted } from './canvas.js';
import { buildFilename, formatAccuracy, formatCoords, formatTimestamp } from './format.js';
import { drawOverlay, layoutOverlay } from './overlay.js';
import { drawPlaceholderMap, drawStaticMap, planMap } from './staticmap.js';

/** Build the exact strings that will be burned onto the photo. */
export function buildStampData({ point, address, settings, now = new Date() } = {}) {
  const hasFix = Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lon));
  const coords = hasFix ? { lat: point.lat, lon: point.lon } : null;

  return {
    coords,
    coordsText: settings.showCoords
      ? hasFix
        ? formatCoords(coords, { format: settings.coordFormat, decimals: settings.coordDecimals })
        : 'No GPS fix'
      : '',
    timeText: settings.showTimestamp
      ? formatTimestamp(now, {
          format: settings.dateFormat,
          hour12: settings.hour12,
          showSeconds: settings.showSeconds,
          showTimezone: settings.showTimezone,
        })
      : '',
    addressText: settings.showAddress ? (address?.short ?? address?.full ?? '') : '',
    accuracyText: settings.showAccuracy && hasFix ? formatAccuracy(point.accuracy) : '',
    accuracy: hasFix ? point.accuracy : null,
    hasFix,
  };
}

/**
 * Render the mini-map at 2x for a crisp stamp.
 * Falls back to a locally drawn grid if tiles fail or taint the canvas.
 */
export async function renderMiniMap({ point, settings, size, deps }) {
  const { width, height } = size;
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;

  const plan = planMap({ lat: point.lat, lon: point.lon, zoom: settings.mapZoom, width, height });
  const canvas = deps.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const result = await drawStaticMap(ctx, plan, deps.loadTile);

  if (result.ok && !isCanvasTainted(canvas)) return { canvas, plan, placeholder: false, ...result };

  // Tiles failed or poisoned the canvas: draw a clean, export-safe placeholder.
  const fallback = deps.createCanvas(width, height);
  const fallbackResult = drawPlaceholderMap(fallback.getContext('2d'), plan);
  return { canvas: fallback, plan, placeholder: true, ...fallbackResult };
}

/**
 * @param {{video:object, point:object|null, address:object|null, settings:object,
 *          deps?: {createCanvas?: Function, loadTile?: Function, now?: Function}}} params
 * @returns {Promise<{canvas:object, layout:object, data:object, map:object|null}>}
 */
export async function createStampedImage({ video, point, address, settings, deps = {} }) {
  const factory = deps.createCanvas ?? ((w, h) => createCanvas(w, h));
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('The camera has not produced a frame yet.');

  const canvas = factory(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);

  const data = buildStampData({ point, address, settings, now: deps.now?.() ?? new Date() });
  const layout = layoutOverlay({ width, height, data, settings });

  let map = null;
  if (layout.map) {
    // eslint-disable-next-line no-await-in-loop
    map = await renderMiniMap({
      point,
      settings,
      size: { width: layout.map.width * 2, height: layout.map.height * 2 },
      deps: { createCanvas: factory, loadTile: deps.loadTile },
    });
  }

  drawOverlay(ctx, layout, { mapCanvas: map?.canvas ?? null, mapPlaceholder: map?.placeholder }, deps);
  return { canvas, layout, data, map };
}

/** Canvas -> Blob (JPEG quality or lossless PNG). */
export function exportBlob(canvas, { format = 'jpeg', quality = 0.92 } = {}) {
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  if (typeof canvas.toBlob !== 'function') {
    return Promise.reject(new Error('This browser cannot export canvas images.'));
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export produced an empty image.'))),
      type,
      quality,
    );
  });
}

export function filenameFor({ point, settings, now = new Date() }) {
  return buildFilename({
    date: now,
    coords: point && Number.isFinite(point.lat) ? { lat: point.lat, lon: point.lon } : null,
    extension: settings.exportFormat === 'png' ? 'png' : 'jpg',
  });
}

/** Full pipeline used by the shutter button. */
export async function captureStampedPhoto({ video, point, address, settings, deps = {} }) {
  const { canvas, layout, data, map } = await createStampedImage({ video, point, address, settings, deps });
  const blob = await exportBlob(canvas, {
    format: settings.exportFormat,
    quality: settings.jpegQuality,
  });
  return {
    blob,
    canvas,
    layout,
    data,
    map,
    filename: filenameFor({ point, settings, now: deps.now?.() ?? new Date() }),
    mimeType: settings.exportFormat === 'png' ? 'image/png' : 'image/jpeg',
  };
}
