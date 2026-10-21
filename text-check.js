// On-screen spelling check for video finals. Video models misspell the words they set on screen (Arata's reel, 21 Oct: "drying
// like concrate"). After a final lands, two frames inside each beat that should show words are read by one vision call (the
// jam's structured call: Gemini on Google credits today) and compared with the exact words the final was asked for. Nothing is
// remade by itself: a remake costs credits, so the jam says what is wrong and where, and the team decides.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

/* the words a final asked for, with their seconds, straight from the prompt Sloosh got ("3-6s: … exactly: \"…\"") */
export function askedLines(prompt) {
  const out = []; const re = /^(\d+)-(\d+)s:.*?exactly: "([^"]+)"/gm; let m;
  while ((m = re.exec(String(prompt || '')))) out.push({ from: +m[1], to: +m[2], want: m[3] });
  return out;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}'₹$%]+/gu, ' ').trim();
const words = (s) => norm(s).split(/\s+/).filter(Boolean);
function dist(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
/* one line: each wanted word is on screen as is, misspelled (the nearest word read, within two letters), or missing */
export function compareLine(want, seen = []) {
  const got = seen.flatMap(words), wrong = [], missing = [];
  for (const w of words(want)) { if (got.includes(w)) continue;
    const near = got.map((g) => [g, dist(w, g)]).filter(([g, n]) => n > 0 && n <= Math.max(1, Math.min(2, Math.floor(w.length / 4)))).sort((a, b) => a[1] - b[1])[0];
    if (near) wrong.push({ want: w, saw: near[0] }); else missing.push(w); }
  const shown = seen.some((s) => words(s).length), ok = shown && !wrong.length && missing.length <= Math.floor(words(want).length / 4); /* a word the frame cut off is not a spelling mistake */
  return { want, saw: seen.filter(Boolean)[0] || '', ok, wrong, missing: shown ? missing : words(want), shown };
}

const grab = (file, at, out) => new Promise((res, rej) => execFile(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', out], { timeout: 30e3 }, (e) => (e ? rej(e) : res(out))));
const SCHEMA = { type: 'object', required: ['frames'], properties: { frames: { type: 'array', items: { type: 'object', required: ['i', 'text'], properties: { i: { type: 'number' }, text: { type: 'string', description: 'Every word set on screen as an overlay (captions, titles), letter for letter as drawn, misspellings kept; empty when there is none. Not the words on the product or its label' } } } } } };

/* file: the final's local mp4; prompt: what Sloosh was asked (for the lines and their seconds); call(content, schema, max, name) */
export async function checkVideoText({ file, prompt, call, log = console } = {}) {
  const lines = askedLines(prompt); if (!lines.length) return { ok: true, lines: [], skipped: 'no on-screen words were asked for' };
  if (!file || !fs.existsSync(file) || !call) return { ok: null, lines: [], error: 'the video or the reader is not here' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'textcheck-')), shots = [];
  try {
    for (const [k, l] of lines.entries()) for (const f of [0.45, 0.8]) { const at = +(l.from + (l.to - l.from) * f).toFixed(2); shots.push({ k, at, file: await grab(file, at, path.join(dir, `${k}-${f}.jpg`)) }); }
    const content = [{ type: 'text', text: 'These are frames from one short vertical video. For each frame, copy the words set on screen as an overlay exactly as drawn, letter for letter, keeping any misspelling. Ignore the words printed on a product or its label.' }];
    shots.forEach((s, i) => content.push({ type: 'text', text: `Frame ${i}:` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(s.file).toString('base64') } }));
    const j = await call(content, SCHEMA, 1200, 'video_text_check');
    const read = new Map((j?.frames || []).map((x) => [+x.i, String(x.text || '')]));
    const out = lines.map((l, k) => ({ ...compareLine(l.want, shots.map((s, i) => (s.k === k ? read.get(i) : null)).filter((x) => x != null)), from: l.from, to: l.to }));
    return { ok: out.every((x) => x.ok), lines: out, at: Date.now() };
  } catch (e) { log.warn?.('[text-check]', e.message); return { ok: null, lines: [], error: String(e.message).slice(0, 200) }; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/* the jam's line about it: nothing when all is right or nothing was read */
export function textCheckNote(r) {
  if (!r || r.ok !== false) return null;
  const bad = r.lines.filter((x) => !x.ok);
  const parts = bad.map((x) => x.wrong.length ? `${x.wrong.map((w) => `“${w.saw}” should read “${w.want}”`).join(', ')} (${x.from}–${x.to}s)` : !x.shown ? `“${x.want}” never shows (${x.from}–${x.to}s)` : `“${x.want}” is missing ${x.missing.map((w) => `“${w}”`).join(', ')} (${x.from}–${x.to}s)`);
  return `Spelling check on the final's on-screen words: ${parts.join('; ')}. Make the final again to fix it (that costs credits), or keep it as is.`;
}
