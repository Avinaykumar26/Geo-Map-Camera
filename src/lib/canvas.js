/**
 * Small canvas utilities shared by the mini-map and the overlay compositor.
 * Everything here works with an injected canvas/context so it can be unit
 * tested in Node with a stub 2D context.
 */

export const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function createCanvas(width, height, factory) {
  if (factory) return factory(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** `ctx.roundRect` is not in older Safari — draw the path by hand. */
export function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

export function truncateText(ctx, text, maxWidth, ellipsis = '…') {
  const value = String(text ?? '');
  if (maxWidth <= 0) return '';
  if (ctx.measureText(value).width <= maxWidth) return value;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${value.slice(0, mid)}${ellipsis}`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${value.slice(0, low)}${ellipsis}`;
}

/** Word-wrap into at most `maxLines` lines, ellipsising the final one. */
export function wrapText(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines) {
    const consumed = lines.join(' ').split(/\s+/).length;
    const rest = words.slice(consumed).join(' ');
    if (rest) lines[maxLines - 1] = truncateText(ctx, `${lines[maxLines - 1]} ${rest}`, maxWidth);
  }
  return lines.map((line) => truncateText(ctx, line, maxWidth));
}

/**
 * A canvas holding cross-origin pixels without CORS headers cannot be read or
 * exported — detect it so we can fall back to a locally drawn map.
 */
export function isCanvasTainted(canvas) {
  try {
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}
