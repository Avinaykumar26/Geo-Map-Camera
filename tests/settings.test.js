import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, STORAGE_KEY } from '../src/lib/settings.js';

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _map: map,
  };
}

describe('sanitizeSettings', () => {
  it('returns the defaults for missing or broken input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ unknownKey: true })).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numbers into the supported range', () => {
    expect(sanitizeSettings({ coordDecimals: 99 }).coordDecimals).toBe(6);
    expect(sanitizeSettings({ coordDecimals: 0 }).coordDecimals).toBe(4);
    expect(sanitizeSettings({ mapZoom: 40 }).mapZoom).toBe(19);
    expect(sanitizeSettings({ jpegQuality: 'nonsense' }).jpegQuality).toBe(DEFAULT_SETTINGS.jpegQuality);
    expect(sanitizeSettings({ jpegQuality: '0.75' }).jpegQuality).toBe(0.75);
  });

  it('rejects values outside the allowed enums', () => {
    expect(sanitizeSettings({ coordFormat: 'sexagesimal' }).coordFormat).toBe('decimal');
    expect(sanitizeSettings({ coordFormat: 'dms' }).coordFormat).toBe('dms');
    expect(sanitizeSettings({ exportFormat: 'webp' }).exportFormat).toBe('jpeg');
  });

  it('coerces booleans', () => {
    expect(sanitizeSettings({ showMap: 0 }).showMap).toBe(false);
    expect(sanitizeSettings({ showMap: 'yes' }).showMap).toBe(true);
  });
});

describe('loadSettings / saveSettings', () => {
  it('round-trips through storage', () => {
    const storage = createStorage();
    const changed = { ...DEFAULT_SETTINGS, coordFormat: 'dms', mapZoom: 18, showAddress: false };
    expect(saveSettings(changed, storage)).toBe(true);
    expect(storage._map.has(STORAGE_KEY)).toBe(true);
    expect(loadSettings(storage)).toEqual(changed);
  });

  it('falls back to defaults when storage is unavailable', () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const hostile = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('quota');
      },
    };
    expect(loadSettings(hostile)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, hostile)).toBe(false);
  });

  it('ignores tampered stored values', () => {
    const storage = createStorage({
      [STORAGE_KEY]: JSON.stringify({ coordFormat: 'bogus', mapZoom: 999, injected: '<script>' }),
    });
    const loaded = loadSettings(storage);
    expect(loaded.coordFormat).toBe('decimal');
    expect(loaded.mapZoom).toBe(19);
    expect('injected' in loaded).toBe(false);
  });
});
