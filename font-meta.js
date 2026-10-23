// What a font file says about itself: its family, weight and style. Read from the file's own tables (TTF, OTF and WOFF: the
// `name` table's family, OS/2 usWeightClass and its italic bit), falling back to the file name for WOFF2 and anything odd
// ("Geist-SemiBoldItalic.woff2" → Geist, 600, italic). Every weight of a family is kept apart by this, so Bold never
// replaces Regular.
import zlib from 'node:zlib';

const WEIGHTS = [[/hairline|thin/i, 100], [/extra[-\s]?light|ultra[-\s]?light/i, 200], [/light/i, 300], [/semi[-\s]?bold|demi[-\s]?bold/i, 600],
  [/extra[-\s]?bold|ultra[-\s]?bold/i, 800], [/black|heavy/i, 900], [/medium/i, 500], [/bold/i, 700], [/regular|normal|book|roman/i, 400]];
export const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const STYLE_WORDS = /[-_\s]?(hairline|thin|extra[-\s]?light|ultra[-\s]?light|light|semi[-\s]?bold|demi[-\s]?bold|extra[-\s]?bold|ultra[-\s]?bold|black|heavy|medium|bold|regular|normal|book|roman|italic|oblique|variable|vf|\d{3})(?=[-_\s]|$)/gi;

/* from a file name only: the family without its weight/style words, the weight, italic or not */
export function fromName(file = '') {
  const base = String(file).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  const spaced = base.replace(/([a-z])([A-Z])/g, '$1 $2');
  const num = spaced.match(/(?:^|[-_\s])([1-9]00)(?=[-_\s]|$)/)?.[1];
  const tail = spaced.replace(/^[^-_]*[-_]/, ''); /* the words after the family, when the name has a separator */
  const weight = +num || (WEIGHTS.find(([re]) => re.test(spaced.includes('-') || spaced.includes('_') ? tail : spaced))?.[1]) || 400;
  const style = /italic|oblique/i.test(spaced) ? 'italic' : 'normal';
  let family = spaced.replace(STYLE_WORDS, '').replace(STYLE_WORDS, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!family) family = base;
  return { family, weight, style };
}

/* the tables of an sfnt (TTF/OTF) or WOFF file, as tag → Buffer */
function tables(buf) {
  const sig = buf.toString('latin1', 0, 4), out = {};
  if (sig === 'wOFF') {
    const n = buf.readUInt16BE(12);
    for (let i = 0; i < n; i++) { const p = 44 + i * 20; if (p + 20 > buf.length) break;
      const tag = buf.toString('latin1', p, p + 4), off = buf.readUInt32BE(p + 4), comp = buf.readUInt32BE(p + 8), orig = buf.readUInt32BE(p + 12);
      if (!/^(name|OS\/2)$/.test(tag)) continue; const raw = buf.subarray(off, off + comp);
      try { out[tag] = comp < orig ? zlib.inflateSync(raw) : raw; } catch { /* a broken table: the name decides */ } }
    return out;
  }
  if (!(sig === 'OTTO' || sig === 'true' || buf.readUInt32BE(0) === 0x00010000)) return out;
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) { const p = 12 + i * 16; if (p + 16 > buf.length) break;
    const tag = buf.toString('latin1', p, p + 4), off = buf.readUInt32BE(p + 8), len = buf.readUInt32BE(p + 12);
    if (/^(name|OS\/2)$/.test(tag) && off + len <= buf.length) out[tag] = buf.subarray(off, off + len); }
  return out;
}
/* the family the font calls itself: nameID 16 (typographic family) first, then 1; Windows (UTF-16) or Mac (latin1) records */
function familyOf(name) {
  if (!name || name.length < 6) return null;
  const count = name.readUInt16BE(2), strings = name.readUInt16BE(4), found = {};
  for (let i = 0; i < count; i++) { const p = 6 + i * 12; if (p + 12 > name.length) break;
    const platform = name.readUInt16BE(p), id = name.readUInt16BE(p + 6), len = name.readUInt16BE(p + 8), off = name.readUInt16BE(p + 10);
    if (id !== 16 && id !== 1) continue; const raw = name.subarray(strings + off, strings + off + len); if (!raw.length) continue;
    let s = ''; if (platform === 3 || platform === 0) { for (let j = 0; j + 1 < raw.length; j += 2) s += String.fromCharCode(raw.readUInt16BE(j)); } else s = raw.toString('latin1');
    s = s.replace(/\0/g, '').trim(); if (s && !found[id]) found[id] = s; }
  return found[16] || found[1] || null;
}

/* fontMeta(bytes, fileName) → { family, weight, style } */
export function fontMeta(buf, file = '') {
  const byName = fromName(file);
  try {
    const t = tables(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    const family = familyOf(t.name);
    const os2 = t['OS/2'], weight = os2 && os2.length >= 6 ? os2.readUInt16BE(4) : null, italic = os2 && os2.length >= 64 ? !!(os2.readUInt16BE(62) & 1) : null;
    return { family: family || byName.family, weight: weight >= 100 && weight <= 1000 ? Math.round(weight / 100) * 100 : byName.weight, style: italic == null ? byName.style : italic ? 'italic' : 'normal' };
  } catch { return byName; }
}
/* one file per family + weight + style: a new upload of the same face replaces it, every other face is kept */
export const faceKey = (f) => `${String(f.family || '').toLowerCase()}|${f.weight || 400}|${f.style || 'normal'}`;
export const mergeFaces = (incoming = [], existing = []) => { const keys = new Set(incoming.map(faceKey)); return [...incoming, ...existing.filter((f) => !keys.has(faceKey(f)))].slice(0, 40); };
export const faceLabel = (f) => `${WEIGHT_NAMES[f.weight] || f.weight || 'Regular'}${f.style === 'italic' ? ' Italic' : ''}`;
