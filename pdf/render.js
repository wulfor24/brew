// Render Brew move PDFs with puppeteer-core + a local Chrome. One browser is reused across a batch.
// renderMove(move, brand, outFile, opts?)  -> { file, bytes, pages?, ms }
// renderAll(moves, brand, outDir, opts?)   -> { files:[…], zips:[…], ms }
// Chrome: env CHROME_PATH, else the macOS default install path.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { moveHtml } from './template.js';
import { hiddenFor, scrubText } from '../connector-hide.js'; // a tool the brand doesn't use is never named in its PDFs

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [MAC_CHROME, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || MAC_CHROME;
}

export async function launchBrowser() {
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none', '--allow-file-access-from-files'],
  });
}

/* one browser for every on-demand render: launched on the first download, shared by renders running at once, closed after
   two quiet minutes (a PDF used to launch and close its own Chromium) */
let shared = null, idle = null, users = 0;
export async function withBrowser(fn) {
  if (!shared) shared = launchBrowser().catch((e) => { shared = null; throw e; });
  const b = await shared; users++; clearTimeout(idle);
  try { return await fn(b); }
  finally { users--; if (!users) { idle = setTimeout(() => { const s = shared; shared = null; s?.then((x) => x.close()).catch(() => {}); }, 120e3); idle.unref?.(); } }
}

/** Safe file name: "03 Five competitor dossiers for Acme.pdf". */
export function pdfName(move) {
  const t = String(move.title || 'Move').replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  /* the number as a person reads it (move-label.js): "05 …", "Weekly move 4 …", a timely move by its title only (QA 20 Oct) */
  const n = +(move.n ?? 0); return `${n > 1000 ? `Weekly move ${n - 1000} ` : n >= 100 && n <= 999 ? '' : `${String(n).padStart(2, '0')} `}${t}.pdf`;
}

async function htmlToPdf(browser, html, outFile) {
  const tmp = path.join(os.tmpdir(), `brew-move-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html);
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await page.pdf({ path: outFile, preferCSSPageSize: true, printBackground: true, timeout: 120000 });
  } finally {
    await page.close().catch(() => {});
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Render one move. opts.browser reuses an open browser; opts.moves feeds the 00 index; opts.html also
 * writes the HTML next to the PDF (debug).
 */
export async function renderMove(move, brand, outFile, opts = {}) {
  if (!opts.browser && opts.shared !== false) return withBrowser((browser) => renderMove(move, brand, outFile, { ...opts, browser }));
  const t0 = Date.now();
  const own = !opts.browser;
  const browser = opts.browser || (await launchBrowser());
  try {
    const html = scrubText(moveHtml(move, brand, { moves: opts.moves }), hiddenFor(brand?.slug || '', brand?.host || ''));
    if (opts.html) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile.replace(/\.pdf$/i, '.html'), html); }
    await htmlToPdf(browser, html, outFile);
  } finally {
    if (own) await browser.close().catch(() => {});
  }
  const bytes = fs.statSync(outFile).size;
  return { file: outFile, bytes, ms: Date.now() - t0 };
}

/** Render every move into outDir and write <Brand>-moves-00-28.zip and <Brand>-moves-29-50.zip. */
export async function renderAll(moves, brand, outDir, opts = {}) {
  const t0 = Date.now();
  const list = [...(moves || [])].filter(Boolean).sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  fs.mkdirSync(outDir, { recursive: true });
  const browser = opts.browser || (await launchBrowser());
  const files = [];
  try {
    for (const m of list) {
      const out = path.join(outDir, pdfName(m));
      const r = await renderMove(m, brand, out, { browser, moves: list, html: opts.html });
      files.push({ n: m.n, ...r });
      if (opts.onProgress) opts.onProgress({ n: m.n, ...r });
    }
  } finally {
    if (!opts.browser) await browser.close().catch(() => {});
  }
  const slug = String(brand?.name || 'Brand').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Brand';
  const zips = [];
  for (const [lo, hi] of [[0, 28], [29, 50]]) {
    const part = files.filter((f) => f.n >= lo && f.n <= hi);
    const zipFile = path.join(outDir, `${slug}-moves-${String(lo).padStart(2, '0')}-${hi}.zip`);
    writeZip(zipFile, part.map((f) => ({ name: path.basename(f.file), data: fs.readFileSync(f.file) })));
    zips.push({ file: zipFile, count: part.length, bytes: fs.statSync(zipFile).size });
  }
  return { files, zips, ms: Date.now() - t0 };
}

// ---------- minimal ZIP writer (deflate via zlib, CRC-32, UTF-8 names) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
/** entries: [{ name, data: Buffer }] */
export function zipBuffer(entries, when = new Date()) {
  const { time, date } = dosTime(when);
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const def = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = def.length < raw.length;
    const body = useDeflate ? def : raw;
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}
export function writeZip(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zipBuffer(entries));
  return file;
}
