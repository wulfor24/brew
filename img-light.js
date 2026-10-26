// Lighter pictures for the page (26 Oct QA: card and rival pictures of 1.2–1.9 MB sat grey for 3+ s). A browser asking for a
// /gen/ or /research/ picture to show (its Accept starts with image/) gets a copy at most 1600 px wide, as WebP (alpha kept) when
// it takes WebP, else JPEG for an opaque picture. The original file is never changed: downloads, makes, Sloosh references and
// every server-side read still get it, and anything that goes wrong serves the original.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const MIN = +process.env.IMG_LIGHT_MIN || 250e3; /* smaller files are already light */
const MAX_W = 1600, DIR = path.join(os.tmpdir(), 'brew-light');
let sharpP = null; const sharpOf = () => (sharpP ||= import('sharp').then((m) => m.default).catch(() => null));
const busy = new Map(); let running = 0; const SLOTS = 2;

/* an opaque picture may become a JPEG; one with see-through parts only a WebP */
export const hasAlpha = (b) => { if (!b || b.length < 30) return false;
  if (b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG') { const ct = b[25]; if (ct === 4 || ct === 6) return true; if (ct === 3) { const i = b.indexOf('tRNS'), d = b.indexOf('IDAT'); return i > 0 && (d < 0 || i < d); } return false; }
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return true; /* already WebP: left as it is (see below) */
  return false; };

/** the lighter file to send for `file` to a browser that asked with `accept`; null: send the original */
export async function lighter(file, accept = '', { wait = 6000 } = {}) {
  if (process.env.IMG_LIGHT === '0' || !/^image\//i.test(String(accept))) return null; /* only a picture shown on a page, never a download or a fetch */
  if (!/\.(png|jpe?g)$/i.test(file)) return null;
  let st; try { st = fs.statSync(file); } catch { return null; } if (st.size < MIN) return null;
  const webp = /image\/webp/i.test(accept), key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${webp}`).digest('hex').slice(0, 20);
  for (const ext of ['.webp', '.jpg']) { const f = path.join(DIR, key + ext); try { if (fs.statSync(f).size > 0) return f; } catch {} }
  if (fs.existsSync(path.join(DIR, key + '.skip'))) return null;
  if (!busy.has(key)) { if (running >= SLOTS) return null; /* busy: the original now, the light copy is made by a later ask */
    running++; busy.set(key, make(file, key, webp).finally(() => { running--; busy.delete(key); })); }
  return Promise.race([busy.get(key), new Promise((r) => setTimeout(() => r(null), wait).unref?.())]);
}

async function make(file, key, webp) {
  try {
    const sharp = await sharpOf(); if (!sharp) return null;
    const b = fs.readFileSync(file), alpha = hasAlpha(b); if (alpha && !webp) { mark(key); return null; }
    const img = sharp(b, { failOn: 'none' }).rotate().resize({ width: MAX_W, withoutEnlargement: true });
    const out = webp ? await img.webp({ quality: 80, effort: 4 }).toBuffer() : await img.flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    if (out.length >= b.length * 0.85) { mark(key); return null; } /* not worth it: the original stays */
    fs.mkdirSync(DIR, { recursive: true }); const f = path.join(DIR, key + (webp ? '.webp' : '.jpg')), tmp = f + '.' + process.pid;
    fs.writeFileSync(tmp, out); fs.renameSync(tmp, f); return f;
  } catch { mark(key); return null; }
}
const mark = (key) => { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, key + '.skip'), ''); } catch {} };
