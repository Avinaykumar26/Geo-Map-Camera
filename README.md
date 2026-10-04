# Geo Map Camera Web

A privacy-first, **zero-login** geotagging camera that runs entirely in the browser.
It captures a photo and burns accurate GPS coordinates, a timestamp, the street
address and an OpenStreetMap mini-map straight onto the image — then lets you
download it. **100% of image and location processing happens on the user's
device; no photo, coordinate or metadata ever reaches a backend server.**

Implements the accompanying PRD v1.0.

---

## Quick start

```bash
npm install
npm run dev        # local dev server (http://localhost:5173)
npm run build      # production bundle -> dist/
npm run preview    # serve the built app with prod security headers (:4173)
npm test           # unit + smoke + security tests (vitest)
npm run verify     # test + build + privacy/bundle audit
npm run icons      # regenerate PWA icons with ImageMagick
```

> Camera and GPS require a **secure origin**. For phone testing, serve over HTTPS
> (e.g. deploy, or `vite --host` behind a TLS proxy). On `http://` the app shows a
> clear "HTTPS required" screen instead of failing silently.

---

## Privacy model (the "Google-level security" requirement)

| Requirement | How it is met |
| :--- | :--- |
| Zero-knowledge | Every stage — camera frames, GPS fixes, map tiles, canvas compositing, download — runs client-side. There is no backend at all. |
| No login | No accounts, no sign-in, no user records. |
| No tracking | No analytics, ad networks or cookies. `Referrer-Policy: no-referrer`. |
| Strict CSP | `default-src 'self'`, no `unsafe-inline`/`unsafe-eval`, locked `Permissions-Policy`, `frame-ancestors 'none'`. Generated per-build (see below). |
| Minimal network | Only two OpenStreetMap endpoints: raster tiles (img) and Nominatim reverse-geocode (fetch). Both are allow-listed in the CSP and verified by `npm run audit:privacy`. |

The build writes `dist/_headers` (Cloudflare Pages) and `dist/vercel.json` (Vercel)
from a single source of truth in `config/security.mjs`, computing a sha256 CSP hash
for the inline JSON-LD block so the landing page needs no `'unsafe-inline'`.
`scripts/audit-privacy.mjs` scans the built output and **fails the build** if any
unexpected host, tracking API, or >150 KB gzipped JS budget is exceeded.

---

## Feature → PRD mapping

| PRD ID | Feature | Implementation |
| :--- | :--- | :--- |
| FR-01 | Camera capture + front/rear flip | `src/lib/camera.js` (`getUserMedia`, facing/deviceId fallbacks, friendly failure hints) |
| FR-02 | Geolocation + accuracy + address | `src/lib/geo.js` (`watchPosition`, throttled/cached Nominatim reverse geocode) |
| FR-03 | Canvas overlay burn-in | `src/lib/overlay.js` (pure `layoutOverlay` + `drawOverlay`) |
| FR-04 | Mini-map snapshot | `src/lib/staticmap.js` (hand-rolled Web-Mercator tile compositor, scale bar, marker, offline grid fallback) |
| FR-05 | Save / export | `src/lib/capture.js` + `src/lib/download.js` (JPEG quality / PNG, geotagged filename) |
| FR-06 | Customization toggles | `src/lib/settings.js` + settings drawer (overlays, coord/time formats, map zoom, export) + day/night theme toggle |
| FR-07 | PWA install | `public/manifest.webmanifest` + `public/sw.js` (offline shell + capped tile cache) |

### Demo mode (no camera / embedded previews)

Browsers refuse `getUserMedia()` inside embedded iframes (like hosted previews)
unless the embedder delegates `camera=` — and some devices have no webcam at all.
So the app ships a **demo mode**: a synthetic scene via `canvas.captureStream()`
plus a simulated GPS fix wandering around MG Road, Bengaluru (reverse-geocoded
for real via Nominatim). Every downstream stage — overlays, mini-map, export —
is identical, so the product is fully testable anywhere. Entry points:
“No camera handy? Explore in demo mode” on the landing screen and
“Use demo mode” on any camera-failure screen (`src/lib/demo.js`).

### Privacy-by-design details
- **Taint safety:** tiles load with `crossOrigin="anonymous"`. If a proxy ever strips
  CORS headers (or the network dies), the compositor detects a tainted canvas and
  swaps in a locally drawn grid, so export *never* fails.
- **Geocode rate-limiting:** reverse-geocoding is serialized to ≤1 req/s, deduped,
  cached per ~11 m bucket, and skipped until you move >25 m — friendly to OSM and
  to your battery.
- **Offline:** the service worker caches the app shell and map tiles; with no signal
  the photo is still stamped (grid fallback), satisfying the offline NFR.

---

## Performance

`npm run build` reports, and `audit:privacy` enforces, the budget:

```
javascript : ~31 KB raw / ~12 KB gzip   (budget 150 KB)
css        : ~2.7 KB gzip
```

No framework, no bundler bloat — the "map" is a ~2 KB hand-rolled Mercator
compositor instead of Leaflet, keeping Time-to-Interactive tiny on 4G.

---

## Project layout

```
index.html              landing + camera + review screens (SEO meta, JSON-LD)
config/security.mjs     single source of truth for CSP + hosting headers
vite.config.js          build + writes _headers/vercel.json + preview headers
src/
  main.js               controller (wiring only; all rules live in lib/)
  styles/main.css       dark-first, thumb-friendly, no framework
  lib/                  camera · geo · staticmap · overlay · capture ·
                        format · settings · tiles · canvas · download
public/
  sw.js                 standalone service worker (shell + tile caches)
  manifest.webmanifest  PWA metadata + shortcuts
  icons/                generated by scripts/make-icons.sh
  robots.txt sitemap.xml  (set your real domain before Search Console)
tests/                  98 vitest tests incl. jsdom boot + CSP/taint security
scripts/
  audit-privacy.mjs     host/budget/tracking audit of the built output
  make-icons.sh         ImageMagick icon generation
```

---

## Testing

`npm test` runs 98 tests. Highlights:

- `staticmap` / `overlay` / `capture` exercise the **real compositor** against a
  recording canvas stub (Node, no browser), including antimeridian wrap, polar
  clipping, taint fallback and no-GPS paths.
- `geo` verifies throttling, dedupe, movement-threshold caching and failure backoff
  with an injected clock — deterministic, no timing flakiness.
- `security` asserts the CSP, the JSON-LD sha256 hash round-trip, and that
  `index.html` ships no inline handlers or third-party scripts.
- `smoke` boots the real markup + controller in jsdom (secure and insecure contexts).

---

## Deployment (Go-to-Market checklist)

1. `npm run build`.
2. Deploy `dist/` to **Cloudflare Pages** (uses `_headers`) or **Vercel** (uses
   `vercel.json`). Both give HTTPS + CDN for free.
3. Set your real domain in `public/robots.txt` + `public/sitemap.xml`.
4. Submit the sitemap in Google Search Console.
5. Verify in DevTools Network tab: the only external requests are
   `*.tile.openstreetmap.org` and `nominatim.openstreetmap.org`.

### Roadmap (out of scope for V1)

- EXIF GPS writing for the exported JPEG.
- Custom overlay themes / logo.
- Compass heading stamp (requires iOS motion permission).
