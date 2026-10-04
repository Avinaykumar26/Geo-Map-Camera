import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cloudflareHeadersFile,
  securityHeaders,
  vercelConfigFile,
} from './config/security.mjs';

const JSONLD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** sha256 CSP hashes for inline JSON-LD data blocks (avoids 'unsafe-inline'). */
export function scriptHashesFromHtml(html) {
  const hashes = [];
  for (const match of html.matchAll(JSONLD_RE)) {
    hashes.push(createHash('sha256').update(match[1], 'utf8').digest('base64'));
  }
  return hashes;
}

/**
 * Writes dist/_headers (Cloudflare Pages) and dist/vercel.json (Vercel) from the
 * shared header definition, with CSP hashes computed from the built index.html.
 */
function securityFilesPlugin() {
  return {
    name: 'gmc:security-files',
    apply: 'build',
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist');
      const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      const headers = securityHeaders({ scriptHashes: scriptHashesFromHtml(html) });
      writeFileSync(resolve(outDir, '_headers'), cloudflareHeadersFile(headers));
      writeFileSync(resolve(outDir, 'vercel.json'), vercelConfigFile(headers));
    },
  };
}

/** Applies the production headers to `vite preview` so prod CSP is testable locally. */
function previewSecurityHeadersPlugin() {
  let headers = null;
  return {
    name: 'gmc:preview-headers',
    apply: 'serve',
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        if (!headers) {
          try {
            const html = readFileSync(resolve(process.cwd(), 'dist/index.html'), 'utf8');
            headers = securityHeaders({ scriptHashes: scriptHashesFromHtml(html) });
          } catch {
            headers = securityHeaders();
          }
        }
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        next();
      });
    },
  };
}

export default {
  base: './',
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
    reportCompressedSize: true,
  },
  plugins: [securityFilesPlugin(), previewSecurityHeadersPlugin()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
};
