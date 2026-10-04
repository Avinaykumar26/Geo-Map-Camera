// @vitest-environment jsdom
/**
 * Boot smoke test: the real markup + the real controller, no stubs in between.
 * Catches null element lookups, bad ids and boot-time exceptions that the
 * library tests cannot see.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

describe('app boot', () => {
  beforeAll(async () => {
    // jsdom reports an insecure context by default; the real app ships over
    // HTTPS (and shows a dedicated fatal screen otherwise — covered below).
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });

    const body = html
      .slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
      .replace(/<script[^>]*src=[^>]*>\s*<\/script>/g, '');
    document.body.innerHTML = body;
    await import('../src/main.js');
  });

  it('lands on the intro screen', () => {
    expect(document.getElementById('screen-intro').hidden).toBe(false);
    expect(document.getElementById('screen-camera').hidden).toBe(true);
    expect(document.getElementById('screen-review').hidden).toBe(true);
  });

  it('seeds the settings drawer from the defaults', () => {
    expect(document.querySelector('[data-setting="showMap"]').checked).toBe(true);
    expect(document.querySelector('[data-setting="coordFormat"]').value).toBe('decimal');
    expect(document.querySelector('[data-setting="mapZoom"]').value).toBe('16');
    expect(document.querySelector('[data-output="jpegQuality"]').textContent).toBe('92%');
  });

  it('keeps the settings drawer closed until asked', () => {
    expect(document.getElementById('settings').hidden).toBe(true);
  });
});

describe('insecure context', () => {
  it('refuses to start the camera without HTTPS', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true });

    const fresh = readFileSync(resolve(root, 'index.html'), 'utf8');
    const body = fresh
      .slice(fresh.indexOf('<body>') + '<body>'.length, fresh.indexOf('</body>'))
      .replace(/<script[^>]*src=[^>]*>\s*<\/script>/g, '');
    document.body.innerHTML = body;

    await import('../src/main.js');

    expect(document.getElementById('screen-camera').hidden).toBe(false);
    expect(document.getElementById('fatal').hidden).toBe(false);
    expect(document.getElementById('fatal-title').textContent).toBe('HTTPS required');
  });
});
