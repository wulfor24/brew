// Every picture a model sees is a PNG, JPEG or WebP. Some stores serve product photos as SVG (eatknacks-com, 16 Oct), GIF,
// AVIF or HEIC; Gemini answers those with 400 "Provided image is not valid", the product check then compares against a broken
// picture, and the fallback shows a file the browser can't use either. normalize(file) returns a local file the models
// accept: the same file when it already is one, else a PNG made once (SVG through Chromium, the rest through ffmpeg) and
// kept by content hash in the temp folder. A file that is not a picture at all (an HTML error page saved as .jpg) throws
// a plain-worded error instead of reaching the model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

export const RASTER = new Set(['png', 'jpeg', 'webp']);
/* what a buffer really is, by its first bytes (never by its file name) */
export function kindOf(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (b.slice(0, 3).toString() === 'GIF') return 'gif';
  if (b.slice(4, 8).toString() === 'ftyp') { const brand = b.slice(8, 12).toString(); return /avi[fs]/.test(brand) ? 'avif' : /hei[cx]|mif1|msf1|heim|heis/.test(brand) ? 'heic' : 'video'; }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'tiff';
  const head = b.slice(0, 512).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body')) return 'html';
  return null;
}
export const mimeOf = (b) => ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[kindOf(b)] || 'image/png';

const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 20);
const svgSize = (s) => { const n = (k) => +((s.match(new RegExp(`\\b${k}\\s*=\\s*["']?([\\d.]+)`, 'i')) || [])[1] || 0);
  let w = n('width'), h = n('height'); const vb = (s.match(/viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i) || []);
  if ((!w || !h) && vb[1]) { w = +vb[1]; h = +vb[2]; } if (!w || !h) { w = 1024; h = 1024; }
  const k = 1024 / Math.max(w, h); return { w: Math.max(64, Math.round(w * k)), h: Math.max(64, Math.round(h * k)) }; };

/* withBrowser(fn): the shared Chromium (pdf/render.js); ffmpeg: in the image (Dockerfile) and on the build Mac */
export function createImageNorm({ withBrowser = null, tmp = os.tmpdir(), log = console, run = null } = {}) {
  const ffmpeg = run || ((args) => new Promise((res, rej) => execFile('ffmpeg', ['-y', '-v', 'error', ...args], { timeout: 60e3 }, (e) => (e ? rej(e) : res()))));
  const inflight = new Map();
  async function toPng(file, b, kind) {
    const out = path.join(tmp, `brew-norm-${sha(b)}.png`);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
    if (kind === 'svg') {
      if (!withBrowser) throw Object.assign(new Error('this product photo is an SVG and no browser is here to turn it into a picture'), { soft: true, badImage: true });
      const svg = b.toString('utf8'), { w, h } = svgSize(svg);
      const png = await withBrowser(async (br) => { const page = await br.newPage();
        try { await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
          await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><img src="data:image/svg+xml;base64,${b.toString('base64')}" style="display:block;width:${w}px;height:${h}px;object-fit:contain"></body></html>`, { waitUntil: 'load', timeout: 20e3 });
          return await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } }); }
        finally { await page.close().catch(() => {}); } });
      fs.writeFileSync(out, png); return out;
    }
    await ffmpeg(['-i', file, '-frames:v', '1', out]);
    if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error(`could not turn the ${kind} picture into a PNG`);
    return out;
  }
  /* file → a file the models accept (the same one when it already is) */
  async function normalize(file) {
    if (!file) return file;
    let b; try { b = fs.readFileSync(file); } catch { return file; }
    const kind = kindOf(b);
    if (RASTER.has(kind)) return file;
    if (kind === 'html' || kind === 'video' || !kind) throw Object.assign(new Error(`this product photo is not a picture Brew can use (${kind || 'unknown format'}); pick another photo`), { soft: true, badImage: true });
    const key = sha(b);
    if (!inflight.has(key)) inflight.set(key, toPng(file, b, kind).finally(() => setTimeout(() => inflight.delete(key), 1000)));
    try { const out = await inflight.get(key); log.info?.(`[img-norm] ${kind} → png ${path.basename(file)}`); return out; }
    catch (e) { log.warn?.('[img-norm]', kind, path.basename(file), e.message); throw Object.assign(new Error(`this product photo (${kind}) could not be turned into a picture: ${e.message}`), { soft: true, badImage: true }); }
  }
  /* a buffer (a picture already in memory, e.g. the image guard's stand-in) → a PNG/JPEG/WebP buffer */
  async function normalizeBuf(buf, hint = 'img') {
    const kind = kindOf(buf); if (RASTER.has(kind)) return buf;
    const f = path.join(tmp, `brew-normsrc-${sha(buf)}-${hint}`); if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
    return fs.readFileSync(await normalize(f));
  }
  return { normalize, normalizeBuf };
}
