// The stand-in maker (27 Oct, Param): while Sloosh can't make a creative (its wallet is empty, it isn't connected, it refused),
// the same picture or clip is made on our own Google Cloud account (Vertex: Gemini image, Veo), paid by the startup credits.
// It is handed exactly what Sloosh would have been: the finished prompt (the card, the Brand Book's art direction, the reference
// lines) and the same references in the same order, so "image 1" means the product photo for both. What it makes is kept: a
// top-up does not redo it (Param's pick); new work goes back to Sloosh. VERTEX_STANDIN=0 turns it off.
import fs from 'node:fs';
import path from 'node:path';
import { gToken, vertexVideo } from './vertex-media.js';
import { kindOf } from './img-norm.js';
import { refLines } from './sloosh-prompt.js';
import { noteVertex } from './alerts.js';

const PROJECT = () => process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617';
/* the picture models, best first: the model asked for, then the other one (an outage, a quota, a reply with no picture in it) */
/* its own names: deploy.sh sets GEMINI_IMAGE_MODEL to the cheap flash model for other jobs */
const MODELS = () => [...new Set([process.env.STANDIN_IMAGE_MODEL || 'gemini-3-pro-image', process.env.STANDIN_IMAGE_FALLBACK || 'gemini-2.5-flash-image'])];
/* Gemini image takes these shapes; anything else (auto, an odd size) lets the model keep the reference's own */
const RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
const MAX_REFS = 14;
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const isFile = (f) => { try { return !!f && path.isAbsolute(String(f)) && fs.statSync(f).isFile(); } catch { return false; } };

export const standinOn = (env = process.env) => env.VERTEX_STANDIN !== '0' && env.AI_MOCK !== '1';

export function createStandin({ fetchImpl = fetch, publicUrl = process.env.PUBLIC_URL || '', toPng = null, token = gToken, video = vertexVideo, log = console } = {}) {
  const base = String(publicUrl || '').replace(/\/$/, '');
  /* any reference (a buffer, a file here, a gen/ or brand path, a store URL) → bytes Gemini can read inline */
  async function bytesOf(src) {
    let buf = null;
    if (Buffer.isBuffer(src)) buf = src;
    else if (isFile(src)) buf = fs.readFileSync(src);
    else if (src) { const s = String(src), u = /^https?:\/\//.test(s) ? s : `${base}/${s.replace(/^\/?gen\//, 'genraw/').replace(/^\//, '')}`;
      const r = await fetchImpl(u, { signal: AbortSignal.timeout(30e3) }); if (!r.ok) throw new Error(`reference ${r.status}`); buf = Buffer.from(await r.arrayBuffer()); }
    if (!buf?.length) throw new Error('empty reference');
    if (!MIME[kindOf(buf)] && toPng) buf = await toPng(buf); /* an SVG logo, a HEIC photo */
    const mt = MIME[kindOf(buf)]; if (!mt) throw new Error('a reference Gemini cannot read');
    return { inlineData: { mimeType: mt, data: buf.toString('base64') } };
  }

  async function once(model, parts, ratio) {
    const r = await fetchImpl(`https://aiplatform.googleapis.com/v1/projects/${PROJECT()}/locations/global/publishers/google/models/${model}:generateContent`, {
      method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'x-goog-user-project': PROJECT(), 'content-type': 'application/json' }, signal: AbortSignal.timeout(180e3),
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(RATIOS.has(ratio) ? { imageConfig: { aspectRatio: ratio } } : {}) } }) });
    if (!r.ok) { const t = await r.text(); try { noteVertex(r.status, t); } catch {} throw new Error(`Gemini ${model} ${r.status}: ${t.slice(0, 240)}`); }
    const j = await r.json(), img = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!img?.data) throw new Error(`Gemini ${model} returned no picture (${j.candidates?.[0]?.finishReason || 'no reason'})`);
    return Buffer.from(img.data, 'base64');
  }

  /** a picture: the prompt Sloosh would have had and its references [{ src, job, label, keep }], product first */
  async function image({ prompt, refs = [], ratio }) {
    const parts = [], kept = [];
    for (const r of refs.slice(0, MAX_REFS)) { try { parts.push(await bytesOf(r.src)); kept.push(r); }
      catch (e) { if (r.job === 'product') throw e; log.warn?.(`[standin] reference left out (${r.label || r.job}): ${String(e.message).slice(0, 120)}`); } }
    /* the prompt names references by position: a reference left out renumbers the lines to what went in */
    let p = String(prompt || ''); if (kept.length !== refs.length) p = p.replace(/\n\n(?:Image \d+ [^\n]*)$/, '') + (kept.length ? '\n\n' + refLines(kept.map((r, i) => ({ ...r, n: i + 1 }))) : '');
    parts.push({ text: p });
    let last; for (const model of MODELS()) { try { return Object.assign(await once(model, parts, ratio), { provider: 'vertex', model }); } catch (e) { last = e; log.warn?.('[standin] picture model failed', String(e.message).slice(0, 200)); } }
    throw last;
  }

  /** a clip: Veo from the opening still (Veo can't take references with a first frame); a filtered clip is tried once with plain motion */
  const SAFE = 'A slow, steady push-in on the scene exactly as it is in the first frame. Soft natural light. Nothing else moves. No new objects, no words.';
  async function clip({ frame, prompt, ratio, seconds }) {
    const first = Buffer.isBuffer(frame) ? frame : frame ? Buffer.from((await bytesOf(frame)).inlineData.data, 'base64') : null;
    if (!first) throw new Error('a clip needs its opening still');
    const model = process.env.STANDIN_VIDEO_MODEL || 'veo-3.1-fast-generate-001', o = { model, ratio, seconds: seconds || 8, resolution: '720p' };
    try { return Object.assign(await video(first, String(prompt || '').slice(0, 1800), o), { provider: 'vertex', model }); }
    catch (e) { if (!/filtered|could not make/i.test(e.message) || /quota|exhausted|unavailable|\b(429|503)\b/i.test(e.message)) throw e;
      return Object.assign(await video(first, SAFE, o), { provider: 'vertex', model, plain: true }); }
  }
  return { image, video: clip };
}
