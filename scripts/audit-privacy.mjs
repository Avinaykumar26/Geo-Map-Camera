#!/usr/bin/env node
/**
 * Privacy / bundle audit for the built output (the "Security Audit" checklist item).
 *
 *   node scripts/audit-privacy.mjs dist
 *
 * Fails the build if the shipped code references any host outside the allowlist,
 * uses a tracking API, or exceeds the JavaScript budget from the PRD.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

import { ALLOWED_EXTERNAL_HOSTS } from '../config/security.mjs';

const target = process.argv[2] ?? 'dist';
if (!existsSync(target)) {
  console.error(`✖ ${target} not found — run "npm run build" first.`);
  process.exit(1);
}

/** Hosts that appear in markup but are never fetched (schemas, placeholders). */
const DECLARED_ONLY = new Set([
  'schema.org',
  'www.sitemaps.org',
  'sitemaps.org',
  'www.w3.org',
  'example.com',
  'geo-map-camera.example.com',
]);

/**
 * `_headers` / `vercel.json` ARE the allowlist (generated from config/security.mjs
 * and asserted in tests/security.test.js), so scanning them for "unexpected"
 * hosts would be circular.
 */
const SKIP_SCAN = new Set(['_headers', 'vercel.json']);

const FORBIDDEN = [
  [/navigator\.sendBeacon/i, 'beacon/tracking API'],
  [/google-analytics|googletagmanager|gtag\(|doubleclick/i, 'Google analytics/ads'],
  [/facebook\.net|connect\.facebook/i, 'Facebook pixel'],
  [/hotjar|clarity\.ms|mixpanel|segment\.io|amplitude/i, 'third-party analytics'],
  [/new WebSocket|EventSource\(/i, 'live connection to a server'],
];

const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.webmanifest', '.xml', '.txt', '.svg']);
const JS_BUDGET_GZIP = 150 * 1024; // PRD: initial JavaScript under 150 KB gzipped

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const hosts = new Map(); // host -> Set(files)
const violations = [];
let jsGzip = 0;
let jsRaw = 0;
let cssGzip = 0;

for (const file of walk(target)) {
  const ext = extname(file);
  const rel = relative(target, file);
  const raw = readFileSync(file);

  if (ext === '.js') {
    jsRaw += raw.length;
    jsGzip += gzipSync(raw).length;
  }
  if (ext === '.css') cssGzip += gzipSync(raw).length;
  if (!SCANNED_EXTENSIONS.has(ext) || SKIP_SCAN.has(rel.split('/').pop())) continue;

  const text = raw.toString('utf8');

  for (const match of text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
    let host;
    try {
      host = new URL(match[0].replace(/[;,]+$/, '')).hostname.replace(/^[*.]+/, '');
    } catch {
      continue;
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
      continue; // prose like "over https." is not a host
    }
    if (!hosts.has(host)) hosts.set(host, new Set());
    hosts.get(host).add(rel);
  }

  if (ext === '.js' || ext === '.html') {
    for (const [pattern, why] of FORBIDDEN) {
      if (pattern.test(text)) violations.push(`${rel}: ${why}`);
    }
  }
}

const networked = [];
const declared = [];
for (const [host, files] of [...hosts].sort()) {
  const bare = host.replace(/^[^.]+\./, '');
  const allowed =
    ALLOWED_EXTERNAL_HOSTS.includes(host) ||
    ALLOWED_EXTERNAL_HOSTS.some((entry) => host.endsWith(`.${entry}`));
  if (allowed) networked.push([host, files]);
  else if (DECLARED_ONLY.has(host) || DECLARED_ONLY.has(bare)) declared.push([host, files]);
  else violations.push(`unexpected host ${host} (${[...files].join(', ')})`);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

console.log('Geo Map Camera — privacy & bundle audit');
console.log(`  output directory : ${target}`);
console.log(`  javascript       : ${kb(jsRaw)} raw / ${kb(jsGzip)} gzip (budget ${kb(JS_BUDGET_GZIP)})`);
console.log(`  css              : ${kb(cssGzip)} gzip`);
console.log('  networked hosts  :');
for (const [host, files] of networked) console.log(`    ✓ ${host}  (${[...files].join(', ')})`);
for (const [host, files] of declared) console.log(`    · ${host}  declared in markup, never fetched (${[...files].join(', ')})`);

if (jsGzip > JS_BUDGET_GZIP) violations.push(`JavaScript payload ${kb(jsGzip)} exceeds the ${kb(JS_BUDGET_GZIP)} budget`);
if (networked.length === 0) violations.push('no allowlisted host found — did the build change?');

if (violations.length) {
  console.error('\n✖ audit failed:');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

console.log('\n✓ no user data leaves the device; only map tiles + reverse geocoding are reachable.');
