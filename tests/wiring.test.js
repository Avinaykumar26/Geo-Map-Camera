/**
 * Static drift checks: the controller (main.js), the markup (index.html) and
 * the settings schema must agree with each other.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as settings from '../src/lib/settings.js';

const { DEFAULT_SETTINGS } = settings;

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const mainJs = readFileSync(resolve(root, 'src/main.js'), 'utf8');

describe('main.js <-> index.html wiring', () => {
  it('every element id the controller queries exists in the markup', () => {
    const queried = [...mainJs.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
    const present = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

    expect(queried.length).toBeGreaterThan(10);
    const missing = queried.filter((id) => !present.has(id));
    expect(missing).toEqual([]);
  });

  it('every data-setting key maps to a real setting', () => {
    const used = [...html.matchAll(/data-setting="([^"]+)"/g)].map((match) => match[1]);
    const unknown = used.filter((key) => !(key in DEFAULT_SETTINGS));
    expect(unknown).toEqual([]);
    // All toggle-worthy settings should be exposed in the drawer.
    expect(used).toEqual(expect.arrayContaining(['showMap', 'showCoords', 'coordFormat', 'exportFormat']));
  });

  it('every range output has a matching setting', () => {
    const outputs = [...html.matchAll(/data-output="([^"]+)"/g)].map((match) => match[1]);
    expect(outputs).toEqual(['mapZoom', 'jpegQuality']);
    for (const key of outputs) expect(key in DEFAULT_SETTINGS).toBe(true);
  });

  it('selects only offer values the sanitizer accepts unchanged', () => {
    const { sanitizeSettings } = settings;
    for (const key of ['coordFormat', 'dateFormat', 'exportFormat', 'coordDecimals']) {
      const open = html.indexOf(`data-setting="${key}"`);
      const selectEnd = html.indexOf('</select>', open);
      const block = html.slice(open, selectEnd);
      const options = [...block.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1]);
      expect(options.length).toBeGreaterThan(0);
      for (const value of options) {
        const coerced = typeof DEFAULT_SETTINGS[key] === 'number' ? Number(value) : value;
        expect(sanitizeSettings({ [key]: coerced })[key]).toEqual(coerced);
      }
    }
  });

  it('keeps the accessibility hooks promised by the UI spec', () => {
    expect(html).toContain('aria-label="Take photo"');
    expect(html).toContain('aria-label="Switch camera"');
    expect(html).toContain('aria-live="polite"');
  });
});
