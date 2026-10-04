import { describe, expect, it, vi } from 'vitest';

import {
  buildReverseGeocodeUrl,
  createAddressResolver,
  formatAddress,
  mapGeoError,
  NOMINATIM_ENDPOINT,
  POSITION_OPTIONS,
  toGeoPoint,
  watchPosition,
} from '../src/lib/geo.js';

const payload = {
  place_id: 42,
  licence: 'Data © OpenStreetMap contributors, ODbL 1.0.',
  lat: '51.5033',
  lon: '-0.1276',
  display_name:
    '10, Downing Street, Westminster, London, Greater London, England, SW1A 2AA, United Kingdom',
  address: {
    house_number: '10',
    road: 'Downing Street',
    suburb: 'Westminster',
    city: 'London',
    state: 'England',
    postcode: 'SW1A 2AA',
    country: 'United Kingdom',
    country_code: 'gb',
  },
};

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

describe('buildReverseGeocodeUrl', () => {
  it('targets Nominatim with jsonv2 and 6-decimal coordinates', () => {
    const url = new URL(buildReverseGeocodeUrl({ lat: 51.5074, lon: -0.1278 }));
    expect(`${url.origin}${url.pathname}`).toBe(NOMINATIM_ENDPOINT);
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('lat')).toBe('51.507400');
    expect(url.searchParams.get('lon')).toBe('-0.127800');
    expect(url.searchParams.get('addressdetails')).toBe('1');
    expect(url.searchParams.get('zoom')).toBe('18');
  });
});

describe('formatAddress', () => {
  it('builds two readable lines out of a Nominatim payload', () => {
    const result = formatAddress(payload);
    expect(result.line1).toBe('10 Downing Street');
    expect(result.line2).toBe('SW1A 2AA London');
    expect(result.short).toBe('10 Downing Street, SW1A 2AA London');
    expect(result.full).toContain('United Kingdom');
  });

  it('survives sparse payloads and API errors', () => {
    expect(formatAddress({ address: { country: 'Nowhere' } }).short).toBe('Nowhere');
    expect(formatAddress({ error: 'Unable to geocode' })).toBeNull();
    expect(formatAddress(null)).toBeNull();
  });
});

describe('toGeoPoint / mapGeoError', () => {
  it('normalises a GeolocationPosition', () => {
    const point = toGeoPoint({
      timestamp: 1759580000000,
      coords: { latitude: 51.5, longitude: -0.1, accuracy: 12, altitude: null, heading: null, speed: null },
    });
    expect(point).toMatchObject({ lat: 51.5, lon: -0.1, accuracy: 12, timestamp: 1759580000000 });
  });

  it('explains each permission failure in plain words', () => {
    expect(mapGeoError({ code: 1 }).title).toBe('Location blocked');
    expect(mapGeoError({ code: 2 }).title).toBe('No GPS signal');
    expect(mapGeoError({ code: 3 }).title).toBe('GPS timed out');
    expect(mapGeoError({ code: 99, message: 'weird' }).hint).toContain('weird');
  });
});

describe('watchPosition', () => {
  it('forwards normalised fixes and can be stopped', () => {
    const clearWatch = vi.fn();
    const geolocation = { watchPosition: vi.fn(() => 7), clearWatch };
    const onUpdate = vi.fn();

    const watcher = watchPosition(geolocation, { onUpdate });
    const [success] = geolocation.watchPosition.mock.calls[0];
    success({ timestamp: 1, coords: { latitude: 1, longitude: 2, accuracy: 5 } });

    expect(geolocation.watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), POSITION_OPTIONS);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ lat: 1, lon: 2, accuracy: 5 }));

    watcher.stop();
    expect(clearWatch).toHaveBeenCalledWith(7);
  });
});

describe('createAddressResolver', () => {
  const far = [
    { lat: 10, lon: 10 },
    { lat: 20, lon: 20 },
    { lat: 30, lon: 30 },
  ];

  it('caches a location so repeated fixes do not refetch', async () => {
    const fetchImpl = vi.fn(async () => okResponse(payload));
    const resolver = createAddressResolver({ fetchImpl, minIntervalMs: 0 });

    const first = await resolver.resolve({ lat: 51.50741, lon: -0.12781 });
    const second = await resolver.resolve({ lat: 51.50742, lon: -0.12782 }); // same ~11 m bucket

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.line1).toBe('10 Downing Street');
  });

  it('does not refetch for jitter below the movement threshold', async () => {
    const fetchImpl = vi.fn(async () => okResponse(payload));
    const resolver = createAddressResolver({ fetchImpl, minIntervalMs: 0 });

    await resolver.resolve({ lat: 51.5074, lon: -0.1278 });
    await resolver.resolve({ lat: 51.50745, lon: -0.12785 }); // ~7 m away

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent lookups for the same place', async () => {
    const fetchImpl = vi.fn(async () => okResponse(payload));
    const resolver = createAddressResolver({ fetchImpl, minIntervalMs: 0 });

    await Promise.all([resolver.resolve(far[0]), resolver.resolve(far[0]), resolver.resolve(far[0])]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps to one request per second even under a burst of fixes', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () => okResponse(payload));
    const resolver = createAddressResolver({ fetchImpl, minIntervalMs: 25, now: () => clock });

    await resolver.resolve(far[0]);
    clock += 10000;
    await resolver.resolve(far[1]); // clock moved on: no wait needed

    const started = Date.now();
    await resolver.resolve(far[2]); // same clock value: must wait out the window
    const elapsed = Date.now() - started;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(elapsed).toBeGreaterThanOrEqual(20);
  });

  it('keeps the last known address when a lookup fails, then backs off', async () => {
    let clock = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse(payload))
      .mockRejectedValue(new Error('offline'));
    const resolver = createAddressResolver({ fetchImpl, minIntervalMs: 0, now: () => clock });

    const first = await resolver.resolve(far[0]);
    expect(first.line1).toBe('10 Downing Street');

    clock += 10000;
    const second = await resolver.resolve(far[1]); // fails
    expect(second).toBe(first);

    const third = await resolver.resolve(far[1]); // within backoff window
    expect(third).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats an HTTP error as a failure, not as an address', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const resolver = createAddressResolver({ fetchImpl, minIntervalMs: 0 });
    expect(await resolver.resolve(far[0])).toBeNull();
  });
});
