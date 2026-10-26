// Draft asset generation, one chain per kind, on our own keys (never treg). Each step that fails hands over to the next, and
// the result says which provider made it, so a draft never loses its picture, clip or voice to one provider's bad minute.
// Since 27 Oct every picture and clip is made by Sloosh (sloosh-make.js): server.js registers it here with setMakers, and makeVideo
// sends every clip to it, with no Veo behind it (a clip Sloosh can't make now waits and is tried again; never a weaker model).
//   voice: Gemini TTS → OpenAI TTS (a spoken line on its own; a clip's own sound comes from the Sloosh video model)
import { mimeOf } from './img-norm.js';
import { vertexVoice, vertexVideo, pcmToWav } from './vertex-media.js';

const OPENAI = () => process.env.OPENAI_API_KEY || '';

/** run steps [[name, fn]] in order: → { buf, provider, tried: [{ provider, error }] }; throws the last error with every failure */
export async function chain(kind, steps, log = console) {
  const tried = [];
  for (const [provider, fn] of steps) {
    if (!fn) continue;
    try { const buf = await fn(); if (buf?.length) return { buf, provider, tried }; tried.push({ provider, error: 'empty' }); }
    catch (e) { if (!e.off) { tried.push({ provider, error: String(e.message).slice(0, 200) }); log.warn?.(`[media] ${kind} ${provider} failed, trying the next`, String(e.message).slice(0, 160)); } else tried.push({ provider, error: 'off' }); }
  }
  throw Object.assign(new Error(`${kind}: every provider failed (${tried.filter((t) => t.error !== 'off').map((t) => `${t.provider}: ${t.error}`).join('; ') || 'none on'})`), { tried });
}

export async function openaiImage({ srcFile, srcBuf, prompt, size = '1024x1024' }, { fetchImpl = fetch, readFile } = {}) {
  if (!OPENAI()) throw Object.assign(new Error('no OPENAI_API_KEY'), { off: true });
  const src = srcBuf || (srcFile && readFile ? readFile(srcFile) : null);
  if (src) { const fd = new FormData(); fd.append('model', 'gpt-image-1'); fd.append('prompt', prompt); fd.append('size', size); const mt = mimeOf(src); fd.append('image', new Blob([src], { type: mt }), `src.${mt.split('/')[1].replace('jpeg', 'jpg')}`);
    const r = await fetchImpl('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${OPENAI()}` }, body: fd, signal: AbortSignal.timeout(180e3) });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`); return Buffer.from((await r.json()).data[0].b64_json, 'base64'); }
  const r = await fetchImpl('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${OPENAI()}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-image-1', prompt, size }), signal: AbortSignal.timeout(180e3) });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`); return Buffer.from((await r.json()).data[0].b64_json, 'base64');
}

async function openaiVoice(text, { fetchImpl = fetch } = {}) {
  if (!OPENAI()) throw Object.assign(new Error('no OPENAI_API_KEY'), { off: true });
  const r = await fetchImpl('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { authorization: `Bearer ${OPENAI()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'pcm' }), signal: AbortSignal.timeout(120e3) });
  if (!r.ok) throw new Error(`OpenAI TTS ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return pcmToWav(Buffer.from(await r.arrayBuffer()), 24000);
}

/** text → WAV buffer (same shape as vertexVoice); the provider rides along as .provider */
export async function makeVoice(text, voiceName = 'Kore', o = {}, log = console) {
  const r = await chain('voice', [['gemini-tts', () => vertexVoice(text, voiceName, o)], ['openai-tts', OPENAI() && (() => openaiVoice(text))]], log);
  return Object.assign(r.buf, { provider: r.provider });
}

let makers = null; /* { video({ slug, frame, prompt, ratio, seconds, sound, line, tier }) → MP4 buffer } from sloosh-make.js */
export const setMakers = (m) => { makers = m; };
/* the Sloosh makers for modules that can't be handed them (Studio's helper, jam2/sloosh-studio.js): { image, edit, video, editVideo, space } */
export const makersNow = () => makers;
/** first frame + motion prompt → MP4 buffer: Sloosh (o.slug, o.ratio, o.seconds, o.sound, o.line, o.tier) */
export async function makeVideo(frame, prompt, o = {}, log = console) {
  if (makers?.video) { const buf = await makers.video({ slug: o.slug, frame, prompt, ratio: o.ratio, seconds: o.seconds, sound: o.sound, line: o.line, tier: o.tier, kind: o.kind });
    return Object.assign(buf, { provider: 'sloosh' }); }
  if (!process.env.VEO_LOCAL) throw Object.assign(new Error('Video is made by Sloosh, which is not connected here'), { soft: true });
  return veoVideo(frame, prompt, o, log);
}
/* Veo, kept only for a local run with VEO_LOCAL=1 and no Sloosh (never on a server) */
async function veoVideo(frame, prompt, o = {}, log = console) {
  const fast = process.env.VEO_MODEL || 'veo-3.1-fast-generate-001', full = process.env.VEO_FALLBACK_MODEL || 'veo-3.1-generate-001';
  let filtered = false; /* a clip the model filtered is filtered by the stronger one too: only an outage or a quota moves on to it */
  /* a filtered clip is tried once more with the plainest motion (Veo's filter mostly reacts to people, words and fast action in
     the prompt): the same first frame, the camera slowly pushing in, nothing else moving */
  const SAFE = 'A slow, steady push-in on the product exactly as it is in the first frame. Soft natural light. Nothing else moves. No people, no words, no new objects.';
  const r = await chain('video', [[fast, () => vertexVideo(frame, prompt, { ...o, model: fast }).catch((e) => { filtered = /filtered|could not make/i.test(e.message) && !/high load|try again later|quota|resource.?exhausted|unavailable|\b(429|503)\b/i.test(e.message); throw e; })],
    [`${fast} (plain motion)`, () => (filtered ? vertexVideo(frame, SAFE, { ...o, model: fast }) : Promise.reject(Object.assign(new Error('not filtered'), { off: true })))],
    /* o.priced (a jam render): the price shown was the fast model's, so a busy fast model is tried once more after a pause
       instead of moving to the dearer one */
    o.priced ? [`${fast} (again)`, () => (filtered ? Promise.reject(Object.assign(new Error('filtered'), { off: true })) : new Promise((ok) => setTimeout(ok, 20e3)).then(() => vertexVideo(frame, prompt, { ...o, model: fast })))]
      : [full, full !== fast && (() => (filtered ? Promise.reject(Object.assign(new Error('filtered by the first model'), { off: true })) : vertexVideo(frame, prompt, { ...o, model: full })))]], log);
  return Object.assign(r.buf, { provider: r.provider });
}
