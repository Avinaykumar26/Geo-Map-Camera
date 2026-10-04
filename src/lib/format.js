/**
 * Formatting helpers. Pure functions only — no DOM, no globals — so they are
 * fully unit-testable and safe to call from the canvas compositor.
 */

const HEMISPHERE = {
  lat: ['N', 'S'],
  lon: ['E', 'W'],
};

export const COORD_FORMATS = ['decimal', 'dms', 'compact'];
export const DATE_FORMATS = ['iso', 'local', 'us', 'eu', 'unix'];

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Split a decimal degree into degrees / minutes / seconds, carrying rounding
 * overflow (59.96" must not be rendered as 60.0").
 */
export function toDMS(value, secondsDecimals = 1) {
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  const factor = 10 ** secondsDecimals;
  let seconds = Math.round((minutesFloat - minutes) * 60 * factor) / factor;

  if (seconds >= 60) {
    seconds = Math.round((seconds - 60) * factor) / factor;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes -= 60;
    degrees += 1;
  }
  return { degrees, minutes, seconds, secondsDecimals };
}

const pad2 = (n) => String(Math.trunc(n)).padStart(2, '0');

/**
 * @param {number} value decimal degrees
 * @param {'lat'|'lon'} axis
 * @param {{format?: string, decimals?: number}} [options]
 */
export function formatCoord(value, axis, { format = 'decimal', decimals = 5 } = {}) {
  if (!Number.isFinite(value)) return '—';
  const limit = axis === 'lat' ? 90 : 180;
  const v = clamp(value, -limit, limit);
  const [positive, negative] = HEMISPHERE[axis] ?? ['', ''];
  const hemisphere = v < 0 ? negative : positive;

  if (format === 'compact') return v.toFixed(decimals);

  if (format === 'dms') {
    const { degrees, minutes, seconds, secondsDecimals } = toDMS(v, 1);
    const secs = seconds.toFixed(secondsDecimals).padStart(2 + 1 + secondsDecimals, '0');
    return `${degrees}°${pad2(minutes)}'${secs}"${hemisphere}`;
  }

  return `${Math.abs(v).toFixed(decimals)}° ${hemisphere}`;
}

/** Both coordinates on one line, ready to burn onto the photo. */
export function formatCoords(coords, options = {}) {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) {
    return 'No GPS fix';
  }
  const lat = formatCoord(coords.lat, 'lat', options);
  const lon = formatCoord(coords.lon, 'lon', options);
  return `${lat}, ${lon}`;
}

function offsetLabel(date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

function clockParts(date, { hour12 = false } = {}) {
  let hour = date.getHours();
  let suffix = '';
  if (hour12) {
    suffix = hour < 12 ? ' AM' : ' PM';
    hour = hour % 12 || 12;
  }
  return { hour: pad2(hour), minute: pad2(date.getMinutes()), second: pad2(date.getSeconds()), suffix };
}

/**
 * @param {Date} date
 * @param {{format?: string, hour12?: boolean, showSeconds?: boolean,
 *          showTimezone?: boolean, timeZone?: string}} [options]
 */
export function formatTimestamp(date, options = {}) {
  const { format = 'iso', hour12 = false, showSeconds = true, showTimezone = true, timeZone } = options;
  const stamp = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(stamp.getTime())) return '—';

  if (format === 'unix') return String(Math.floor(stamp.getTime() / 1000));

  if (format === 'local' || timeZone) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: showSeconds ? 'medium' : 'short',
      hour12,
      ...(timeZone ? { timeZone } : {}),
    }).format(stamp);
  }

  const { hour, minute, second, suffix } = clockParts(stamp, { hour12 });
  const time = `${hour}:${minute}${showSeconds ? `:${second}` : ''}${suffix}`;
  const tz = showTimezone && !hour12 ? ` ${offsetLabel(stamp)}` : '';

  if (format === 'us') {
    return `${pad2(stamp.getMonth() + 1)}/${pad2(stamp.getDate())}/${stamp.getFullYear()}  ${time}${tz}`;
  }
  if (format === 'eu') {
    return `${pad2(stamp.getDate())}/${pad2(stamp.getMonth() + 1)}/${stamp.getFullYear()}  ${time}${tz}`;
  }
  const y = String(stamp.getFullYear()).padStart(4, '0');
  return `${y}-${pad2(stamp.getMonth() + 1)}-${pad2(stamp.getDate())}  ${time}${tz}`;
}

/** Human readable GPS accuracy, e.g. "±8 m". */
export function formatAccuracy(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return 'accuracy —';
  if (meters < 1000) return `±${Math.round(meters)} m`;
  return `±${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
}

/** GPS quality bucket used to colour the HUD. */
export function accuracyQuality(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return 'none';
  if (meters <= 15) return 'high';
  if (meters <= 60) return 'medium';
  return 'low';
}

export function sanitizeFilenamePart(value) {
  return String(value ?? '').replace(/[^\w.@-]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Deterministic, filesystem-safe download name:
 *   geotag_2026-10-04_12-34-56_51.50740N-0.12780W.jpg
 */
export function buildFilename({ date, coords, extension = 'jpg', prefix = 'geotag' } = {}) {
  const stamp = date instanceof Date ? date : new Date(date ?? Date.now());
  const { hour, minute, second } = clockParts(stamp);
  const parts = [
    prefix,
    `${stamp.getFullYear()}-${pad2(stamp.getMonth() + 1)}-${pad2(stamp.getDate())}`,
    `${hour}-${minute}-${second}`,
  ];
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
    const lat = Math.abs(coords.lat).toFixed(5);
    const lon = Math.abs(coords.lon).toFixed(5);
    parts.push(`${lat}${coords.lat < 0 ? 'S' : 'N'}-${lon}${coords.lon < 0 ? 'W' : 'E'}`);
  }
  return `${parts.join('_')}.${extension}`;
}
