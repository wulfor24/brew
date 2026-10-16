// Draft asset generation, one chain per kind, on our own keys (never treg). Each step that fails hands over to the next, and
// the result says which provider made it, so a draft never loses its picture, clip or voice to one provider's bad minute.
// Sloosh (sloosh.ai) is not a step here: it makes the finals only, quote first and behind a button (sloosh-mcp.js, finals.js).
//   image: Vertex Gemini image (the chosen model, then the other one; server.js rawGeminiImage) → OpenAI gpt-image-1
//   video: Veo 3.1 fast → Veo 3.1 → (the caller keeps the still)
//   voice: Gemini TTS → OpenAI TTS
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
  if (src) { const fd = new FormData(); fd.append('model', 'gpt-image-1'); fd.append('prompt', prompt); fd.append('size', size); fd.append('image', new Blob([src], { type: 'image/jpeg' }), 'src.jpg');
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

/** first frame + motion prompt → MP4 buffer (same shape as vertexVideo) */
export async function makeVideo(frame, prompt, o = {}, log = console) {
  const fast = process.env.VEO_MODEL || 'veo-3.1-fast-generate-001', full = process.env.VEO_FALLBACK_MODEL || 'veo-3.1-generate-001';
  let filtered = false; /* a clip the model filtered is filtered by the stronger one too: only an outage or a quota moves on to it */
  const r = await chain('video', [[fast, () => vertexVideo(frame, prompt, { ...o, model: fast }).catch((e) => { filtered = /filtered|could not make/i.test(e.message); throw e; })],
    [full, full !== fast && (() => (filtered ? Promise.reject(Object.assign(new Error('filtered by the first model'), { off: true })) : vertexVideo(frame, prompt, { ...o, model: full })))]], log);
  return Object.assign(r.buf, { provider: r.provider });
}
