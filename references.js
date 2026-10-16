// References: the photos, past ads, mood boards, logos, people, textures and packaging a brand uploads so Brew can hand them
// to the generators as numbered references ("image 2 is the style: match its light"). Nothing here is simulated: every file
// is a real upload. One JSON per brand, brands/<slug>/private/references.json { items: [...] }; the bytes live beside it at
// brands/<slug>/refs/<sha16>.<ext> (brand-pack.js packs.put) and are served at /b/<slug>/refs/<file> (server.js).
//   item: { id: 'rf_<rand>', kind: 'image' | 'video', file: 'refs/<sha16>.<ext>', label, job, keep, by, at, bytes, w, h, sloosh: null }
//   job (what the generators use it for): product | scene | style | person | logo | other
//   keep: one line on what to keep from it ("match its light", "this exact bottle")
//   sloosh: filled by a later batch when the file is mirrored into Sloosh Assets; null until then
// Images reuse drop.js parseDrop (PNG, JPG, WebP ≤ 8 MB); video/mp4 ≤ 25 MB is accepted here only.
import crypto from 'node:crypto';
import { parseDrop, IMAGE_MAX } from './drop.js';

export const JOBS = ['product', 'scene', 'style', 'person', 'logo', 'other'];
export const VIDEO_MAX = 25e6;
export const FILE = 'private/references.json';
export const LABEL_MAX = 80, KEEP_MAX = 160;
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4' };
export const mimeOf = (file) => MIME[String(file || '').split('.').pop().toLowerCase()] || 'application/octet-stream';

const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
export const jobOf = (j) => (JOBS.includes(String(j || '').toLowerCase()) ? String(j).toLowerCase() : null);

/* width and height from the file's own header (no decoder): PNG IHDR, JPEG SOFn, WebP VP8 / VP8L / VP8X; null when unreadable */
export function dims(buf, ext) {
  try {
    if (ext === 'png' && buf.length >= 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (ext === 'jpg') { let i = 2; while (i + 9 < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } const len = buf.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }; i += 2 + len; } }
    if (ext === 'webp' && buf.length >= 30 && buf.toString('ascii', 12, 16) === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (ext === 'webp' && buf.length >= 25 && buf.toString('ascii', 12, 16) === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (ext === 'webp' && buf.length >= 30 && buf.toString('ascii', 12, 16) === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  } catch { /* a header we can't read is no reason to refuse the file */ }
  return { w: null, h: null };
}

/* what was uploaded: { kind, buf, ext, mime, file, bytes, w, h, label, job, keep } | { error } */
export function parseReference(b = {}) {
  const label = oneLine(b.label || b.name, LABEL_MAX), keep = oneLine(b.keep, KEEP_MAX), job = jobOf(b.job) || 'other';
  if (!b.data) return { error: 'Add a photo (PNG, JPG or WebP) or an MP4 video.' };
  if (/^data:[^;,]+;base64,?$/.test(String(b.data).trim())) return { error: 'That file is empty.' };
  const v = /^data:video\/mp4;base64,(.+)$/.exec(String(b.data));
  if (v) { const buf = Buffer.from(v[1], 'base64'); if (!buf.length) return { error: 'That video is empty.' }; if (buf.length > VIDEO_MAX) return { error: 'That video is over 25 MB.' };
    return { kind: 'video', buf, ext: 'mp4', mime: 'video/mp4', file: `refs/${sha16(buf)}.mp4`, bytes: buf.length, w: null, h: null, label, job, keep }; }
  if (/^data:video\//.test(String(b.data))) return { error: 'Videos are MP4 only, up to 25 MB.' };
  const f = parseDrop({ data: b.data, name: label });
  if (f.error) return { error: /over 8 MB|empty/.test(f.error) ? f.error : 'Add a PNG, JPG or WebP photo (up to 8 MB), or an MP4 video (up to 25 MB).' };
  return { kind: 'image', buf: f.buf, ext: f.ext, mime: MIME[f.ext], file: `refs/${sha16(f.buf)}.${f.ext}`, bytes: f.buf.length, ...dims(f.buf, f.ext), label, job, keep };
}
const sha16 = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
export { IMAGE_MAX };

export const urlOf = (slug, it) => `/b/${slug}/${it.file}`;
/* the shape every route and the photo picker send to the client */
export const pub = (slug, it) => ({ id: it.id, kind: it.kind, url: urlOf(slug, it), label: it.label, job: it.job, keep: it.keep, by: it.by || null, at: it.at, bytes: it.bytes, w: it.w, h: it.h, sloosh: it.sloosh || null });

export function createReferences({ packs, log = console }) {
  const chain = new Map(); /* one writer per brand at a time: list → change → save never interleaves */
  const serial = (slug, fn) => { const p = (chain.get(slug) || Promise.resolve()).then(fn, fn); chain.set(slug, p.catch(() => {})); return p; };
  const load = async (slug) => { const j = await packs.getJSON(slug, FILE, null).catch(() => null); return { items: Array.isArray(j?.items) ? j.items : [] }; };
  const save = (slug, doc) => packs.put(slug, FILE, doc);

  const list = async (slug) => (await load(slug)).items.map((it) => pub(slug, it));
  const add = (slug, b = {}) => serial(slug, async () => {
    const f = parseReference(b); if (f.error) return f;
    if (!f.label) f.label = f.kind === 'video' ? 'Video' : 'Photo';
    const doc = await load(slug);
    const same = doc.items.find((x) => x.file === f.file); if (same) return { ok: true, item: pub(slug, same), same: true }; /* the same bytes twice are one reference */
    await packs.put(slug, f.file, f.buf, f.mime);
    const it = { id: 'rf_' + crypto.randomBytes(5).toString('hex'), kind: f.kind, file: f.file, label: f.label, job: f.job, keep: f.keep, by: b.by || null, at: Date.now(), bytes: f.bytes, w: f.w, h: f.h, sloosh: null };
    doc.items.unshift(it); await save(slug, doc); log.info?.(`[refs] ${slug} +${f.kind} ${f.file} (${f.job})`);
    return { ok: true, item: pub(slug, it) };
  });
  const update = (slug, id, b = {}) => serial(slug, async () => {
    const doc = await load(slug), it = doc.items.find((x) => x.id === id); if (!it) return { error: 'not found' };
    if (b.label != null) { const l = oneLine(b.label, LABEL_MAX); if (!l) return { error: 'Give it a name.' }; it.label = l; }
    if (b.job != null) { const j = jobOf(b.job); if (!j) return { error: `The job is one of ${JOBS.join(', ')}.` }; it.job = j; }
    if (b.keep != null) it.keep = oneLine(b.keep, KEEP_MAX);
    await save(slug, doc); return { ok: true, item: pub(slug, it) };
  });
  /* the row goes; the file stays under its hash (another upload of the same bytes finds it again, and nothing links by file) */
  const remove = (slug, id) => serial(slug, async () => {
    const doc = await load(slug), n = doc.items.length; doc.items = doc.items.filter((x) => x.id !== id); if (doc.items.length === n) return { error: 'not found' };
    await save(slug, doc); return { ok: true, items: doc.items.map((it) => pub(slug, it)) };
  });
  return { list, add, update, remove, parse: parseReference, JOBS };
}
