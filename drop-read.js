// Drop anything here: what a dropped file says, as text Brew can learn from (feed-service POST /api/brands/:slug/drop/read).
//   text   .txt .md .csv .json: as it is
//   office .docx .pptx .xlsx: unzipped here (no AI, free): paragraphs, slides in order, the sheet's cells
//   pdf    Gemini reads it (inline document): every word in reading order, plus one [bracketed] line per picture or chart
//   image  Gemini reads it: the words printed on it, word for word, what it shows, and which References job it fits
// What comes back is the source the brand-learnings review reads (brand-learnings.js run): the team sees the draft and saves
// it, so nothing a file says becomes brand context unchecked. Same for every brand: nothing here knows one.
import zlib from 'node:zlib';
export const DOC_MAX = 20e6, IMAGE_MAX = 8e6, TEXT_CHARS = 200000;
export const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const OFFICE = ['docx', 'pptx', 'xlsx'];
const extOf = (name = '') => String(name).toLowerCase().split('.').pop();

/* what kind of file this is, from its name and type: 'text' | 'pdf' | 'office' | 'image' | null (we can't read it yet) */
export function dropKind(name = '', type = '') {
  const e = extOf(name), t = String(type || '').toLowerCase();
  if (IMG[e] || /^image\/(png|jpeg|webp)$/.test(t)) return 'image';
  if (e === 'pdf' || t === 'application/pdf') return 'pdf';
  if (OFFICE.includes(e)) return 'office';
  if (/^text\//.test(t) || /json|csv|markdown/.test(t) || /^(txt|md|markdown|csv|json|tsv)$/.test(e)) return 'text';
  return null;
}

/* a zip's files (docx, pptx and xlsx are zips): name → Buffer, from the central directory; only stored and deflated entries */
export function unzip(buf) {
  const out = new Map(); let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  for (let k = 0; k < n && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    if (buf.readUInt32LE(at) !== 0x04034b50) continue;
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28), raw = buf.subarray(start, start + size);
    try { if (method === 0) out.set(name, raw); else if (method === 8) out.set(name, zlib.inflateRawSync(raw)); } catch { /* one broken entry: the rest still read */ }
  }
  return out;
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unxml = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) => (c[0] === '#' ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : +c.slice(1)) : ENT[c] ?? m));
const tidy = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
/* the words of a Word, PowerPoint or Excel file, in reading order */
export function officeText(buf, ext) {
  const z = unzip(buf), xml = (k) => z.get(k)?.toString('utf8') || '';
  if (ext === 'docx') return tidy(unxml(xml('word/document.xml').replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')));
  if (ext === 'pptx') { const slides = [...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    return tidy(slides.map((k, i) => `Slide ${i + 1}\n${unxml(xml(k).replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, ''))}`).join('\n\n')); }
  if (ext === 'xlsx') return tidy([...xml('xl/sharedStrings.xml').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('\n'));
  return '';
}

const IMAGE_SCHEMA = { type: 'object', properties: {
  text: { type: 'string', description: 'Every word printed on the picture, copied exactly, line by line in reading order. Empty when it has none' },
  shows: { type: 'string', description: 'One or two plain sentences: what the picture shows (the product, people, setting, colours, layout, what kind of asset it is: an ad, a page, a guide, a packshot)' },
  job: { type: 'string', enum: ['product', 'scene', 'style', 'person', 'logo', 'other'], description: 'What the brand would use it for when making new pictures: product = the product itself, scene = a setting or lifestyle shot, style = a look to follow (an ad, a mood board, a guide page), person = a model or face, logo, other' } } };
const PDF_SYSTEM = 'You are a transcription engine. You copy every word of a document in reading order and nothing else. You never summarise, shorten, comment or ask a question.';
const PDF_AGAIN = 'Transcribe this whole document, every page, every word, word for word: titles, body text, tables, captions, slide text, script lines, footnotes. A summary is wrong. Add one line in square brackets for each picture or chart. Output only the transcription.';
/* chat around a copy ("Here is…", "Would you like…") is not the document */
export const unchat = (t) => String(t || '').replace(/^\s*(here is|here's|below is|sure[,!])[^\n]*\n+/i, '').replace(/\n+[^\n]*\b(would you like|let me know if|i can also|do you want me to)\b[^\n]*\s*$/i, '').trim();
/* a read that is a summary: it asked a question, or it is far too short for the file (a text deck gives ~10k characters a MB) */
export const thinRead = (text, raw, bytes) => /\b(would you like|let me know if|here is a summary|in summary)\b/i.test(String(raw || '')) || (bytes > 1.5e6 && String(text || '').length < 8000);
const PDF_ASK = 'Copy out all the text in this document, word for word, in reading order. Keep each heading and list item on its own line. For each picture, chart, colour swatch or logo, add one line in square brackets saying what it shows (with colour codes when they are printed). Nothing else: no summary, no comments.';

/* readDrop({ name, type, data }) → { kind, text, chars, cut, image?: { buf, ext, shows, job }, usd } | { error }
   data is base64 (a data: URL or bare) for every file but text, which may come as plain `text` */
export async function readDrop(f = {}, { ai = null } = {}) {
  const name = String(f.name || 'file').replace(/[\r\n]+/g, ' ').slice(0, 120), kind = dropKind(name, f.type), ext = extOf(name);
  if (!kind) { const how = { doc: 'Save it as .docx or PDF', ppt: 'Save it as .pptx or PDF', key: 'Export it from Keynote as PDF', pages: 'Export it from Pages as PDF', heic: 'Send it as JPG or PNG', gif: 'Send it as PNG' }[ext];
    return { error: `We can’t read ${name} yet. ${how ? `${how}, then drop it again.` : 'Drop a PDF, Word, PowerPoint, Excel, text file or a photo (PNG, JPG, WebP).'}` }; }
  const live = !!ai?.live;
  if (kind === 'text' && f.text != null) return done(kind, String(f.text));
  const b64 = String(f.data || '').replace(/^data:[^;,]*(;[^,]*)?,/, ''), buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: `${name} is empty.` };
  if (kind === 'text') return done(kind, buf.toString('utf8'));
  if (kind === 'image' ? buf.length > IMAGE_MAX : buf.length > DOC_MAX) return { error: `${name} is over ${kind === 'image' ? 8 : 20} MB.` };
  if (kind === 'office') { try { return done(kind, officeText(buf, ext)); } catch { return { error: `${name} didn’t open. Save it again as .${ext} or a PDF and drop it again.` }; } }
  if (!live) return { error: `Reading ${kind === 'pdf' ? 'PDFs' : 'photos'} needs the AI, which is off on this server.` };
  const mime = kind === 'pdf' ? 'application/pdf' : IMG[ext] || String(f.type || 'image/png');
  if (kind === 'pdf') {
    /* a copy, never a summary: a model sometimes answers a long deck with a few bullets and "Would you like…". Such a read
       (chat lines, or far too few words for the file) is read again with the stricter ask, and the longer copy is kept */
    const read = (ask) => ai.call({ model: 'sonnet', tag: 'drop-read', max: 60000, effort: 'low', system: PDF_SYSTEM, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: mime, data: b64 } }, { type: 'text', text: ask }] }] });
    let r = await read(PDF_ASK), usd = r.usd || 0, text = unchat(r.text);
    if (thinRead(text, r.text, buf.length)) { const r2 = await read(PDF_AGAIN).catch(() => null); usd += r2?.usd || 0; const t2 = unchat(r2?.text); if (t2.length > text.length) text = t2; }
    return done(kind, text, usd);
  }
  const r = await ai.call({ model: 'sonnet', tag: 'drop-read', max: 3000, effort: 'low', schema: IMAGE_SCHEMA, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }, { type: 'text', text: `A brand's team dropped this picture (“${name}”) into Brew. Read it.` }] }] });
  const j = r.json || {}, words = String(j.text || '').trim(), shows = String(j.shows || '').trim().slice(0, 400);
  const text = [`[Picture “${name}”: ${shows || 'a picture'}]`, words ? `Words on it:\n${words}` : ''].filter(Boolean).join('\n');
  return { ...done(kind, text, r.usd), image: { buf, ext: ext === 'jpeg' ? 'jpg' : ext, shows, job: j.job || 'other' } };
}
function done(kind, raw, usd = 0) {
  const s = String(raw || '').replace(/\r/g, '').trim();
  return { kind, text: s.slice(0, TEXT_CHARS), chars: s.length, cut: s.length > TEXT_CHARS, usd: +(+usd || 0).toFixed(4) };
}
