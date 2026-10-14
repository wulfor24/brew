// Cover art for a Brew move PDF.
// With a hero product image: the image (PNG cutouts float on the cover, photos sit on a white card).
// Without one: a line-art bottle drawn from the brand colours, in the style of the first hand-made covers
// (body filled with the brand colour and hatched with fine off-white wavy lines, a dark hatched cap,
// an accent label band).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FEED_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFF = '#f1e9df';
const BREW_RED = '#a9121f';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif' };

function rng(seedStr) {
  let h = 2166136261;
  for (const c of String(seedStr || 'brew')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

function hex(c) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return '#' + h.toLowerCase();
}
function lum(c) {
  const h = hex(c); if (!h) return 0;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pick body + accent colours from a brand palette. Near-black/near-white body colours read badly on
 *  the charcoal cover, so we fall back to a muted lab blue. */
export function artColors(colors = []) {
  const list = (colors || []).map(hex).filter(Boolean);
  const body = list.find((c) => lum(c) > 0.12 && lum(c) < 0.9) || '#67bae6';
  const accent = list.find((c) => c !== body && lum(c) > 0.04 && lum(c) < 0.8) || BREW_RED;
  return { body, accent };
}

function wavyLine(x, y0, y1, amp, period, phase) {
  const pts = [];
  for (let y = y0; y <= y1 + 0.01; y += period / 4) {
    pts.push([x + amp * Math.sin(((y - y0) / period) * Math.PI * 2 + phase), y]);
  }
  return 'M' + pts.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L');
}

/** Line-art bottle as an SVG string (viewBox 0 0 120 460). */
export function bottleSvg({ colors = [], seed = 'brand' } = {}) {
  const { body, accent } = artColors(colors);
  const r = rng(seed);
  const W = 120, BX = 4, BW = 112, BY = 72, BH = 384, CX = 34, CW = 52, CY = 4, CH = 70;
  const id = 'b' + Math.floor(r() * 1e6);
  let hatch = '';
  // body hatch: denser and brighter toward the right edge (the light side)
  for (let x = BX + 3; x < BX + BW - 1; x += 2.2 + r() * 1.6) {
    const t = (x - BX) / BW;
    const w = 0.35 + r() * 0.9 + t * t * 1.6;
    const op = 0.55 + r() * 0.45;
    hatch += `<path d="${wavyLine(x, BY, BY + BH, 0.4 + r() * 1.1, 40 + r() * 70, r() * 6)}" stroke="${OFF}" stroke-width="${w.toFixed(2)}" opacity="${op.toFixed(2)}" fill="none"/>`;
  }
  let cap = '';
  for (let x = CX + 3; x < CX + CW - 2; x += 2 + r() * 1.4) {
    cap += `<path d="${wavyLine(x, CY + 2, CY + CH, 0.3 + r() * 0.5, 22 + r() * 18, r() * 6)}" stroke="${OFF}" stroke-width="${(0.5 + r() * 0.9).toFixed(2)}" fill="none"/>`;
  }
  const bandY = BY + BH * 0.43, bandH = BH * 0.135;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 460" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
<defs><clipPath id="${id}c"><rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" rx="9"/></clipPath>
<clipPath id="${id}b"><rect x="${BX}" y="${BY}" width="${BW}" height="${BH}" rx="30"/></clipPath></defs>
<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" rx="9" fill="#0e0e0f"/>
<g clip-path="url(#${id}c)">${cap}</g>
<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" rx="9" fill="none" stroke="${OFF}" stroke-width="3.2"/>
<rect x="${BX}" y="${BY}" width="${BW}" height="${BH}" rx="30" fill="${body}"/>
<g clip-path="url(#${id}b)">${hatch}
<rect x="${BX}" y="${bandY.toFixed(1)}" width="${BW}" height="${bandH.toFixed(1)}" fill="${accent}" stroke="${OFF}" stroke-width="3"/></g>
<rect x="${BX}" y="${BY}" width="${BW}" height="${BH}" rx="30" fill="none" stroke="${OFF}" stroke-width="4"/>
</svg>`;
}

function resolveHero(hero) {
  if (!hero) return null;
  const p = path.isAbsolute(hero) ? hero : path.resolve(FEED_ROOT, hero);
  try {
    if (!fs.statSync(p).isFile()) return null;
    const ext = path.extname(p).toLowerCase();
    const mime = MIME[ext];
    if (!mime) return null;
    return { uri: `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`, cutout: ext === '.png' || ext === '.webp' || ext === '.svg' };
  } catch { return null; }
}

/** Cover art block (HTML). `hero` is a product image path (absolute, or relative to feed/); PNG/WebP/SVG
 *  are treated as cutouts, JPEGs are framed on a white card so their background does not fight the cover. */
export function coverArt({ colors = [], hero = null, name = '' } = {}) {
  const img = resolveHero(hero);
  if (img) {
    const alt = String(name || 'Product').replace(/[&<>"]/g, '');
    return img.cutout
      ? `<div class="art art-cutout"><img src="${img.uri}" alt="${alt}"></div>`
      : `<div class="art art-photo"><div class="art-card"><img src="${img.uri}" alt="${alt}"></div></div>`;
  }
  return `<div class="art art-bottle">${bottleSvg({ colors, seed: name })}</div>`;
}
