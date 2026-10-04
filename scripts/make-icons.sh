#!/usr/bin/env bash
# Generates the PWA icons from scratch with ImageMagick (no binary assets to
# maintain). Run: npm run icons
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/public/icons"
mkdir -p "$OUT"

MASTER="$OUT/.master-1024.png"

# 1024px master: dark map background, blue graticule, green location pin.
convert -size 1024x1024 xc:'#0b1220' \
  -stroke '#1d4ed8' -strokewidth 18 -fill none \
  -draw "line 0,384 1024,384" -draw "line 0,640 1024,640" \
  -draw "line 384,0 384,1024" -draw "line 640,0 640,1024" \
  -stroke none \
  -fill '#22c55e' -draw "circle 512,384 512,256" \
  -fill '#22c55e' -draw "polygon 424,452 600,452 512,764" \
  -fill '#0b1220' -draw "circle 512,384 512,318" \
  "$MASTER"

convert "$MASTER" -resize 512x512 "$OUT/icon-512.png"
convert "$MASTER" -resize 192x192 "$OUT/icon-192.png"
convert "$MASTER" -resize 180x180 "$OUT/apple-touch-icon.png"

# Maskable: the artwork must survive a circular crop, so pad it to 80%.
convert -size 512x512 xc:'#070b10' \
  "$MASTER" -resize 410x410 -gravity center -composite \
  "$OUT/maskable-512.png"

rm -f "$MASTER"
echo "Icons written to $OUT"
ls -1 "$OUT"
