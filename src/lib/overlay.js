/**
 * Overlay geometry + renderer.
 *
 * `layoutOverlay` is pure maths (unit tested for every image size);
 * `drawOverlay` only paints what the layout describes. The map panel is placed
 * directly *above* the text panel so the two can never overlap.
 */

import { FONT_STACK, roundRectPath, truncateText, wrapText } from './canvas.js';
import { accuracyQuality } from './format.js';

export const BRAND_LABEL = 'Geo Map Camera';
export const ATTRIBUTION = '© OpenStreetMap contributors';

const QUALITY_COLORS = { high: '#4ade80', medium: '#facc15', low: '#fb7185', none: '#94a3b8' };

/**
 * @param {{width:number, height:number, data:object, settings:object}} params
 * @returns {{scale:number, panel:object, lines:Array, map:object|null, brand:object|null}}
 */
export function layoutOverlay({ width, height, data, settings }) {
  const scale = Math.max(0.5, width / 1080);
  const pad = Math.round(22 * scale);
  const gap = Math.round(10 * scale);
  const radius = Math.round(20 * scale);

  const fonts = {
    strong: `600 ${Math.round(32 * scale)}px ${FONT_STACK}`,
    body: `${Math.round(24 * scale)}px ${FONT_STACK}`,
    small: `${Math.round(19 * scale)}px ${FONT_STACK}`,
    chip: `600 ${Math.round(16 * scale)}px ${FONT_STACK}`,
  };
  const lineHeights = {
    strong: Math.round(42 * scale),
    body: Math.round(32 * scale),
    small: Math.round(26 * scale),
  };

  const lines = [];
  if (settings.showCoords && data.coordsText) {
    lines.push({ role: 'coords', text: data.coordsText, font: fonts.strong, height: lineHeights.strong, color: '#ffffff' });
  }
  if (settings.showTimestamp && data.timeText) {
    lines.push({ role: 'time', text: data.timeText, font: fonts.body, height: lineHeights.body, color: '#e6edf5' });
  }
  if (settings.showAddress && data.addressText) {
    lines.push({ role: 'address', text: data.addressText, font: fonts.body, height: lineHeights.body, color: '#c8d3e0' });
  }
  if (settings.showAccuracy && data.accuracyText) {
    lines.push({
      role: 'accuracy',
      text: data.accuracyText,
      font: fonts.small,
      height: lineHeights.small,
      color: QUALITY_COLORS[accuracyQuality(data.accuracy)] ?? QUALITY_COLORS.none,
    });
  }

  const panelWidth = Math.max(0, width - pad * 2);
  const panelHeight = lines.reduce((sum, line) => sum + line.height, 0) + (lines.length ? pad * 2 : 0);
  const panel = {
    x: pad,
    y: Math.round(height - pad - panelHeight),
    width: panelWidth,
    height: Math.round(panelHeight),
    radius,
    textX: pad + Math.round(26 * scale),
    textWidth: Math.max(0, panelWidth - Math.round(52 * scale)),
    accent: { x: pad, width: Math.round(6 * scale), radius: Math.round(3 * scale) },
  };

  // Mini-map: sits above the panel, right aligned.
  let map = null;
  if (settings.showMap) {
    const mapWidth = Math.round(Math.min(Math.max(width * 0.3, 150), 460));
    const mapHeight = Math.round(mapWidth * 0.72);
    const available = panel.y - gap - pad;
    if (mapWidth <= panelWidth && mapHeight <= available) {
      map = {
        x: Math.round(width - pad - mapWidth),
        y: Math.round(panel.y - gap - mapHeight),
        width: mapWidth,
        height: mapHeight,
        radius: Math.round(16 * scale),
        borderWidth: Math.max(2, Math.round(3 * scale)),
        attributionFont: `${Math.max(9, Math.round(14 * scale))}px ${FONT_STACK}`,
      };
    }
  }

  const brand = settings.showWatermark
    ? {
        x: pad,
        y: pad,
        height: Math.round(34 * scale),
        radius: Math.round(17 * scale),
        font: fonts.chip,
        text: BRAND_LABEL,
        padX: Math.round(16 * scale),
      }
    : null;

  return { scale, pad, gap, panel, lines, map, brand, width, height };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof layoutOverlay>} layout
 * @param {{mapCanvas?: {width:number,height:number}|null, mapPlaceholder?: boolean}} assets
 * @param {object} [deps] injectable for tests ({ measure?: fn })
 */
export function drawOverlay(ctx, layout, assets = {}, deps = {}) {
  const { panel, lines, map, brand } = layout;
  const measure = deps.measure ?? ((text) => ctx.measureText(text).width);

  if (map && assets.mapCanvas) {
    drawMapPanel(ctx, map, assets.mapCanvas, assets.mapPlaceholder === true);
  }

  if (brand) {
    ctx.save();
    ctx.font = brand.font;
    const textWidth = measure(brand.text);
    const boxWidth = Math.round(textWidth + brand.padX * 2);
    ctx.fillStyle = 'rgba(8, 11, 15, 0.62)';
    roundRectPath(ctx, brand.x, brand.y, boxWidth, brand.height, brand.radius);
    ctx.fill();

    const dotR = Math.max(2.5, brand.height * 0.13);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(brand.x + brand.padX + dotR, brand.y + brand.height / 2, dotR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(brand.text, brand.x + brand.padX + dotR * 3, brand.y + brand.height / 2 + 1);
    ctx.restore();
  }

  if (!lines.length) return;

  ctx.save();
  // Bottom scrim so text stays legible over bright scenes.
  const scrim = ctx.createLinearGradient(0, panel.y - panel.height * 0.8, 0, layout.height);
  scrim.addColorStop(0, 'rgba(4, 7, 10, 0)');
  scrim.addColorStop(1, 'rgba(4, 7, 10, 0.72)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, Math.max(0, panel.y - panel.height * 0.8), layout.width, layout.height - Math.max(0, panel.y - panel.height * 0.8));

  ctx.fillStyle = 'rgba(8, 11, 15, 0.66)';
  roundRectPath(ctx, panel.x, panel.y, panel.width, panel.height, panel.radius);
  ctx.fill();

  const accent = panel.accent;
  ctx.fillStyle = '#22c55e';
  roundRectPath(ctx, accent.x + panel.radius * 0.35, panel.y + panel.radius * 0.9, accent.width, panel.height - panel.radius * 1.8, accent.radius);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = Math.max(2, 4 * layout.scale);

  let cursorY = panel.y + panel.radius * 0.7 + lines[0].height * 0.72;
  for (const line of lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    const maxWidth = panel.textWidth;
    const text =
      line.role === 'address'
        ? wrapText(ctx, line.text, maxWidth, 2).join(' · ')
        : truncateText(ctx, line.text, maxWidth);
    ctx.fillText(text, panel.textX, cursorY);
    cursorY += line.height;
  }
  ctx.restore();
}

function drawMapPanel(ctx, map, mapCanvas, placeholder) {
  ctx.save();
  roundRectPath(ctx, map.x, map.y, map.width, map.height, map.radius);
  ctx.save();
  ctx.clip();
  ctx.drawImage(mapCanvas, map.x, map.y, map.width, map.height);

  const attrHeight = Math.max(14, map.height * 0.16);
  ctx.fillStyle = 'rgba(8, 11, 15, 0.7)';
  ctx.fillRect(map.x, map.y + map.height - attrHeight, map.width, attrHeight);
  ctx.font = map.attributionFont;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    placeholder ? 'OSM grid (offline)' : ATTRIBUTION,
    map.x + map.width - 6,
    map.y + map.height - attrHeight / 2,
  );
  ctx.restore();

  ctx.lineWidth = map.borderWidth;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  roundRectPath(ctx, map.x, map.y, map.width, map.height, map.radius);
  ctx.stroke();
  ctx.restore();
}
