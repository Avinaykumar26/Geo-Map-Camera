/**
 * User settings, persisted locally (localStorage) and never transmitted.
 */

export const STORAGE_KEY = 'gmc.settings.v1';

export const DEFAULT_SETTINGS = {
  // Appearance
  theme: 'dark', // dark | light

  // Overlays (FR-06)
  showMap: true,
  showCoords: true,
  showTimestamp: true,
  showAddress: true,
  showAccuracy: true,
  showWatermark: true,

  // Coordinate rendering
  coordFormat: 'decimal', // decimal | dms | compact
  coordDecimals: 5,

  // Time rendering
  dateFormat: 'iso', // iso | local | us | eu | unix
  hour12: false,
  showSeconds: true,
  showTimezone: true,

  // Mini-map
  mapZoom: 16,

  // Export (FR-05)
  exportFormat: 'jpeg', // jpeg | png
  jpegQuality: 0.92,
};

/** Inclusive [min, max] range per numeric setting. */
const NUMERIC = { coordDecimals: [4, 6], mapZoom: [12, 19], jpegQuality: [0.5, 1] };
const ENUMS = {
  theme: ['dark', 'light'],
  coordFormat: ['decimal', 'dms', 'compact'],
  dateFormat: ['iso', 'local', 'us', 'eu', 'unix'],
  exportFormat: ['jpeg', 'png'],
};

/**
 * Merge untrusted input (localStorage can be edited by hand) with the defaults,
 * dropping anything out of range.
 */
export function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_SETTINGS };

  for (const [key, value] of Object.entries(input)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    const fallback = DEFAULT_SETTINGS[key];

    if (typeof fallback === 'boolean') {
      out[key] = Boolean(value);
    } else if (typeof fallback === 'number') {
      const [min, max] = NUMERIC[key] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
      const parsed = Number(value);
      out[key] = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    } else if (Array.isArray(ENUMS[key])) {
      out[key] = ENUMS[key].includes(value) ? value : fallback;
    }
  }
  return out;
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false; // private mode / quota — settings simply stay in memory
  }
}
