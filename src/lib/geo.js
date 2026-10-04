/**
 * Geolocation + reverse geocoding.
 *
 * Privacy: reverse geocoding is the *only* network request that involves the
 * user's position, it goes straight from the browser to OpenStreetMap's public
 * Nominatim service, and it is throttled + cached so it fires a handful of
 * times per session instead of once per GPS fix.
 */

import { haversineDistance } from './staticmap.js';

export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

export const POSITION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 20000,
  maximumAge: 3000,
};

const ERROR_HINTS = {
  1: {
    title: 'Location blocked',
    hint: 'Tap the lock icon in the address bar and allow location for this site.',
  },
  2: {
    title: 'No GPS signal',
    hint: 'Move near a window or outside — indoor fixes can take a while.',
  },
  3: {
    title: 'GPS timed out',
    hint: 'Keep the screen on and wait for a fix, then try again.',
  },
};

/** Normalise a GeolocationPosition into a plain, serialisable object. */
export function toGeoPoint(position) {
  const c = position?.coords ?? {};
  return {
    lat: c.latitude,
    lon: c.longitude,
    accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
    altitude: Number.isFinite(c.altitude) ? c.altitude : null,
    heading: Number.isFinite(c.heading) ? c.heading : null,
    speed: Number.isFinite(c.speed) ? c.speed : null,
    timestamp: position?.timestamp ?? Date.now(),
    source: 'device',
  };
}

export function mapGeoError(error) {
  const known = ERROR_HINTS[error?.code];
  return {
    code: error?.code ?? -1,
    title: known?.title ?? 'Location unavailable',
    hint: known?.hint ?? (error?.message ?? 'Could not read a position from this device.'),
  };
}

/**
 * @param {Geolocation} geolocation
 * @param {{onUpdate: (p:object)=>void, onError?: (e:object)=>void}} handlers
 * @returns {{stop: () => void}}
 */
export function watchPosition(geolocation, handlers, options = POSITION_OPTIONS) {
  const id = geolocation.watchPosition(
    (position) => handlers.onUpdate(toGeoPoint(position)),
    (error) => handlers.onError?.(mapGeoError(error)),
    options,
  );
  return { stop: () => geolocation.clearWatch(id) };
}

export function buildReverseGeocodeUrl({ lat, lon, zoom = 18, language = 'en' } = {}) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: Number(lat).toFixed(6),
    lon: Number(lon).toFixed(6),
    zoom: String(zoom),
    addressdetails: '1',
    extratags: '0',
    namedetails: '0',
    'accept-language': language,
  });
  return `${NOMINATIM_ENDPOINT}?${params.toString()}`;
}

/** Turn a Nominatim payload into two readable lines. */
export function formatAddress(payload, { style = 'short' } = {}) {
  if (!payload || payload.error) return null;
  const a = payload.address ?? {};
  const named =
    a.house_number && a.road
      ? `${a.house_number} ${a.road}`
      : a.road || a.pedestrian || a.footway || a.neighbourhood || a.suburb || a.hamlet || null;

  const city =
    a.city || a.town || a.village || a.municipality || a.county || a.state_district || a.state || null;
  const postcode = a.postcode || null;
  const country = a.country || null;

  const line1 = named || city || country || payload.display_name || null;
  const line2Parts = [postcode, city !== line1 ? city : null].filter(Boolean);
  const line2 = line2Parts.join(' ');

  const short = [line1, line2].filter(Boolean).join(', ') || null;
  const full = payload.display_name || [short, country].filter(Boolean).join(', ') || null;

  return {
    short,
    full,
    line1,
    line2,
    displayName: full,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cached, rate-limited reverse geocoder.
 *
 * OSM's usage policy asks for at most 1 request/second, so the resolver waits
 * for the window, dedupes concurrent calls, and skips work when the device has
 * not moved more than `moveThresholdM` metres.
 */
export function createAddressResolver({
  fetchImpl = (...args) => fetch(...args),
  minIntervalMs = 1100,
  moveThresholdM = 25,
  timeoutMs = 9000,
  language = 'en',
  now = () => Date.now(),
} = {}) {
  let cache = { key: null, coords: null, address: null };
  let lastRequestAt = -Infinity;
  let inflight = null;
  let lastAddress = null;
  let chain = Promise.resolve();
  const failures = new Map(); // key -> timestamp of last failure (backoff)
  const retryAfterMs = 30000;

  const keyFor = (point) => `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;

  async function request(point, key) {
    const wait = lastRequestAt + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(buildReverseGeocodeUrl({ ...point, language }), {
        headers: { Accept: 'application/json' },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) throw new Error(`reverse geocode HTTP ${response.status}`);
      const address = formatAddress(await response.json());
      cache = { key, coords: { lat: point.lat, lon: point.lon }, address };
      if (address) lastAddress = address;
      return address;
    } catch (error) {
      // Never poison the cache with a failure: keep the last known address,
      // but back off so an offline device does not retry every second.
      failures.set(key, now());
      if (failures.size > 64) failures.delete(failures.keys().next().value);
      return cache.address ?? lastAddress;
    } finally {
      if (timer) clearTimeout(timer);
      inflight = null;
    }
  }

  return {
    /** @returns {Promise<object|null>} the address for this fix (possibly cached) */
    async resolve(point) {
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return lastAddress;

      const key = keyFor(point);
      if (cache.key === key) return cache.address;
      if (cache.address && haversineDistance(cache.coords, point) < moveThresholdM) {
        return cache.address;
      }
      if (failures.has(key) && now() - failures.get(key) < retryAfterMs) {
        return cache.address ?? lastAddress;
      }
      if (inflight && inflight.key === key) return inflight.promise;

      // Serialise: never more than one request in flight, and the 1 req/s
      // window inside `request` is therefore respected under concurrency.
      const promise = (chain = chain.then(
        () => request(point, key),
        () => request(point, key),
      ));
      inflight = { key, promise };
      return promise;
    },

    current: () => lastAddress,
    reset() {
      cache = { key: null, coords: null, address: null };
      lastAddress = null;
      inflight = null;
      failures.clear();
    },
  };
}
