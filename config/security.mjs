/**
 * Single source of truth for the security headers of Geo Map Camera Web.
 *
 * Consumed by:
 *   - vite.config.js  -> applied to `vite preview` responses (prod-like testing)
 *   - vite plugin     -> writes dist/_headers (Cloudflare Pages) + dist/vercel.json (Vercel)
 *
 * The CSP is deliberately strict: no third-party scripts, no inline scripts, no
 * analytics, and only the two external hosts the app genuinely needs
 * (OpenStreetMap raster tiles + Nominatim reverse geocoding).
 */

/** Hosts allowed to serve map raster tiles. */
export const TILE_HOSTS = ['https://*.tile.openstreetmap.org'];

/** Hosts allowed for XHR/fetch (reverse geocoding). */
export const CONNECT_HOSTS = ['https://nominatim.openstreetmap.org'];

/** Everything the app talks to. Anything else is a privacy regression. */
export const ALLOWED_EXTERNAL_HOSTS = ['tile.openstreetmap.org', 'nominatim.openstreetmap.org'];

/**
 * @param {{ scriptHashes?: string[] }} [options] sha256 hashes for inline data blocks
 *   (e.g. the JSON-LD structured data) so we never need 'unsafe-inline'.
 * @returns {Record<string, string>}
 */
export function securityHeaders({ scriptHashes = [] } = {}) {
  const scriptSrc = ['\'self\'', ...scriptHashes.map((h) => `'sha256-${h}'`)].join(' ');

  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self'",
      `img-src 'self' data: blob: ${TILE_HOSTS.join(' ')}`,
      `connect-src 'self' ${CONNECT_HOSTS.join(' ')}`,
      "media-src 'self' blob:",
      "worker-src 'self'",
      "manifest-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Permissions-Policy':
      'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()',
  };
}

/** Cloudflare Pages `_headers` file body. */
export function cloudflareHeadersFile(headers) {
  const lines = ['/*'];
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`  ${name}: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Vercel `vercel.json` body. */
export function vercelConfigFile(headers) {
  return `${JSON.stringify(
    {
      headers: [
        {
          source: '/(.*)',
          headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
        },
      ],
    },
    null,
    2,
  )}\n`;
}
