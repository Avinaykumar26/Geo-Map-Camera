import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_EXTERNAL_HOSTS,
  cloudflareHeadersFile,
  securityHeaders,
  vercelConfigFile,
} from '../config/security.mjs';
import { scriptHashesFromHtml } from '../vite.config.js';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'));
const serviceWorker = readFileSync(resolve(root, 'public/sw.js'), 'utf8');

describe('Content Security Policy', () => {
  const headers = securityHeaders();
  const csp = headers['Content-Security-Policy'];

  it("locks everything down to 'self' by default", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it("never allows 'unsafe-inline' or 'unsafe-eval' scripts", () => {
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("script-src 'self'");
  });

  it('only whitelists OpenStreetMap for pixels and geocoding', () => {
    expect(csp).toContain('img-src');
    expect(csp).toContain('https://*.tile.openstreetmap.org');
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://nominatim.openstreetmap.org');
    expect(ALLOWED_EXTERNAL_HOSTS).toEqual(['tile.openstreetmap.org', 'nominatim.openstreetmap.org']);
  });

  it('switches off every device permission the app does not need', () => {
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers['Permissions-Policy']).toContain('payment=()');
    expect(headers['Permissions-Policy']).toContain('camera=(self)');
    expect(headers['Permissions-Policy']).toContain('geolocation=(self)');
    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
  });
});

describe('inline JSON-LD hashing', () => {
  it('produces a sha256 that matches the data block exactly', () => {
    const hashes = scriptHashesFromHtml(html);
    expect(hashes).toHaveLength(1);

    const open = html.indexOf('<script type="application/ld+json">');
    const close = html.indexOf('</script>', open);
    const text = html.slice(open + '<script type="application/ld+json">'.length, close);

    expect(JSON.parse(text)['@type']).toBe('WebApplication');
    expect(hashes[0]).toBe(createHash('sha256').update(text, 'utf8').digest('base64'));
  });

  it('is emitted into the CSP so the landing page needs no unsafe-inline', () => {
    const headers = securityHeaders({ scriptHashes: scriptHashesFromHtml(html) });
    expect(headers['Content-Security-Policy']).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/]{43}='/);
  });
});

describe('hosting header files', () => {
  it('renders a Cloudflare _headers block', () => {
    const file = cloudflareHeadersFile(securityHeaders());
    expect(file.startsWith('/*\n')).toBe(true);
    expect(file).toContain('  Content-Security-Policy: ');
    expect(file).toContain('  X-Content-Type-Options: nosniff');
  });

  it('renders a Vercel config', () => {
    const config = JSON.parse(vercelConfigFile(securityHeaders()));
    expect(config.headers[0].source).toBe('/(.*)');
    expect(config.headers[0].headers.map((h) => h.key)).toContain('Content-Security-Policy');
  });
});

describe('index.html', () => {
  it('contains no inline handlers, inline styles or third-party scripts', () => {
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<[^>]+\sstyle\s*=/i);
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
    expect(html).not.toMatch(/google-analytics|googletagmanager|doubleclick|facebook\.net/i);
  });

  it('ships the PWA metadata', () => {
    expect(html).toContain('<link rel="manifest"');
    expect(html).toContain('viewport-fit=cover');
    expect(manifest.start_url).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('service worker', () => {
  it('only ever talks to OpenStreetMap tiles', () => {
    const urls = serviceWorker.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
    expect(urls).toEqual([]); // no absolute URLs: tiles are matched by hostname suffix
    expect(serviceWorker).toContain('tile.openstreetmap.org');
    expect(serviceWorker).not.toMatch(/google-analytics|sendBeacon|fetch\(['"]https?:/i);
  });
});
