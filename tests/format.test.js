import { describe, expect, it } from 'vitest';

import {
  accuracyQuality,
  buildFilename,
  formatAccuracy,
  formatCoord,
  formatCoords,
  formatTimestamp,
  sanitizeFilenamePart,
  toDMS,
} from '../src/lib/format.js';

describe('formatCoord', () => {
  it('renders decimal degrees with a hemisphere', () => {
    expect(formatCoord(51.5074, 'lat')).toBe('51.50740° N');
    expect(formatCoord(-0.1278, 'lon')).toBe('0.12780° W');
    expect(formatCoord(0, 'lat')).toBe('0.00000° N');
  });

  it('renders compact form with a sign and no hemisphere', () => {
    expect(formatCoord(-0.1278, 'lon', { format: 'compact' })).toBe('-0.12780');
  });

  it('renders degrees/minutes/seconds', () => {
    expect(formatCoord(51.5074, 'lat', { format: 'dms' })).toBe('51°30\'26.6"N');
    expect(formatCoord(-0.1278, 'lon', { format: 'dms' })).toBe('0°07\'40.1"W');
  });

  it('honours the decimals option', () => {
    expect(formatCoord(51.5074, 'lat', { decimals: 4 })).toBe('51.5074° N');
  });

  it('clamps impossible values and survives garbage', () => {
    expect(formatCoord(95, 'lat')).toBe('90.00000° N');
    expect(formatCoord(-200, 'lon')).toBe('180.00000° W');
    expect(formatCoord(Number.NaN, 'lat')).toBe('—');
  });
});

describe('toDMS', () => {
  it('carries rounding overflow instead of printing 60"', () => {
    const { degrees, minutes, seconds } = toDMS(51.999999);
    expect(seconds).toBeLessThan(60);
    expect(minutes).toBeLessThan(60);
    expect(degrees).toBe(52);
  });
});

describe('formatCoords', () => {
  it('joins both axes', () => {
    expect(formatCoords({ lat: 51.5074, lon: -0.1278 })).toBe('51.50740° N, 0.12780° W');
    expect(formatCoords({ lat: 51.5, lon: -0.1 }, { format: 'compact' })).toBe('51.50000, -0.10000');
  });

  it('degrades without a fix', () => {
    expect(formatCoords(null)).toBe('No GPS fix');
    expect(formatCoords({ lat: Number.NaN, lon: 0 })).toBe('No GPS fix');
  });
});

describe('formatTimestamp', () => {
  const date = new Date(2026, 9, 4, 14, 32, 7); // local time, TZ independent

  it('supports ISO, US, EU and unix formats', () => {
    expect(formatTimestamp(date)).toBe('2026-10-04  14:32:07 UTC+00:00');
    expect(formatTimestamp(date, { format: 'us' })).toMatch(/^10\/04\/2026 {2}14:32:07/);
    expect(formatTimestamp(date, { format: 'eu' })).toMatch(/^04\/10\/2026 {2}14:32:07/);
    expect(formatTimestamp(date, { format: 'unix' })).toBe(String(Math.floor(date.getTime() / 1000)));
    expect(formatTimestamp(date, { format: 'local' })).toContain('2026');
  });

  it('drops seconds and the offset when asked', () => {
    expect(formatTimestamp(date, { showSeconds: false })).toBe('2026-10-04  14:32 UTC+00:00');
    expect(formatTimestamp(date, { showTimezone: false })).toBe('2026-10-04  14:32:07');
  });

  it('supports a 12-hour clock', () => {
    expect(formatTimestamp(date, { hour12: true, showTimezone: false })).toBe(
      '2026-10-04  02:32:07 PM',
    );
  });

  it('rejects invalid input', () => {
    expect(formatTimestamp(new Date('nope'))).toBe('—');
  });
});

describe('formatAccuracy', () => {
  it('switches units and buckets', () => {
    expect(formatAccuracy(8)).toBe('±8 m');
    expect(formatAccuracy(1500)).toBe('±1.50 km');
    expect(formatAccuracy(null)).toBe('accuracy —');
    expect(accuracyQuality(8)).toBe('high');
    expect(accuracyQuality(40)).toBe('medium');
    expect(accuracyQuality(300)).toBe('low');
    expect(accuracyQuality(undefined)).toBe('none');
  });
});

describe('buildFilename', () => {
  it('is filesystem safe and carries the position', () => {
    const name = buildFilename({
      date: new Date(2026, 9, 4, 14, 32, 7),
      coords: { lat: 51.5074, lon: -0.1278 },
    });
    expect(name).toBe('geotag_2026-10-04_14-32-07_51.50740N-0.12780W.jpg');
    expect(name).not.toMatch(/[:/\\*?"<>|]/);
  });

  it('omits the position without a fix and honours the extension', () => {
    const name = buildFilename({ date: new Date(2026, 0, 2, 3, 4, 5), extension: 'png' });
    expect(name).toBe('geotag_2026-01-02_03-04-05.png');
  });

  it('sanitises arbitrary strings', () => {
    expect(sanitizeFilenamePart('a b/c:d')).toBe('a_b_c_d');
  });
});
