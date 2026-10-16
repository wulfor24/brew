// "Drop anything here" (UI2): one upload, three places it can go (feed-service POST /api/brands/:slug/drop):
//   memory  the brand's memory (brand-memory.js), for the whole team: the team only, like memory-routes.js
//   prefs   my preferences: the member's own tuning notes (member-tuning.js), and their personal memory when memory is on
//   once    just this once: a jam's photo (the /api/work/:wid/reference path) when a jam is named, else it rides on the next ask
//   references  the brand's References (references.js): a photo or MP4 the generators work from, with a label, a job and a keep note
// The limits are today's: a note is text up to 4,000 characters (memory-routes.js); a photo is PNG, JPG or WebP up to 8 MB
// (the jam's reference photo and the studio's upload).
import crypto from 'node:crypto';
export const DESTS = ['memory', 'prefs', 'once', 'references'];
export const TEXT_MAX = 4000, IMAGE_MAX = 8e6;

/* what was dropped: { kind: 'text', text, cut } | { kind: 'image', buf, ext, file, name } | { error } */
export function parseDrop(b = {}) {
  const name = String(b.name || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
  if (b.data) {
    const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/.exec(String(b.data));
    if (!m) return { error: 'Drop text, or a PNG, JPG or WebP photo.' };
    const buf = Buffer.from(m[3], 'base64'); if (buf.length > IMAGE_MAX) return { error: 'That photo is over 8 MB.' };
    if (!buf.length) return { error: 'That photo is empty.' };
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    return { kind: 'image', buf, ext, name, caption: String(b.text || '').trim().slice(0, 400), file: `ref-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}` };
  }
  const raw = String(b.text || '').replace(/\r/g, '').trim();
  if (raw.length < 4) return { error: 'Drop some text or a photo first.' };
  return { kind: 'text', text: raw.slice(0, TEXT_MAX), cut: raw.length > TEXT_MAX, name };
}
