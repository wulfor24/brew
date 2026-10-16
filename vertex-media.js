// Voice and video on our own Google Cloud (Vertex AI) account, never through treg: generated assets are ours to pay for
// directly. Voice: Gemini TTS (raw PCM, wrapped as WAV). Video: Veo 3.1 image-to-video (submit, poll, bytes come back inline).
import { execFile } from 'node:child_process';
import { noteVertex } from './alerts.js'; // billing and quota failures reach the ops alerts

const PROJECT = () => process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617';
const VEO_LOC = () => process.env.VEO_LOCATION || 'us-central1';
let tok = { v: '', exp: 0 };
export async function gToken() {
  if (tok.v && Date.now() < tok.exp) return tok.v;
  if (process.env.K_SERVICE) { const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
    const j = await r.json(); tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 }; return tok.v; }
  const v = await new Promise((res, rej) => execFile('gcloud', ['auth', 'print-access-token'], { timeout: 15000 }, (e, out, err) => (e ? rej(new Error(String(err || e.message).trim())) : res(out.trim()))));
  tok = { v, exp: Date.now() + 40 * 60e3 }; return v;
}
const post = async (url, body, ms = 120e3) => { const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${await gToken()}`, 'x-goog-user-project': PROJECT(), 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  if (!r.ok) { const t = await r.text(); noteVertex(r.status, t); throw new Error(`Vertex ${r.status}: ${t.slice(0, 240)}`); } return r.json(); };

// 16-bit mono PCM → a playable WAV file
export const pcmToWav = (pcm, rate = 24000) => { const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]); };

/** text → WAV buffer */
export async function vertexVoice(text, voiceName = 'Kore', { model = process.env.TTS_MODEL || 'gemini-2.5-flash-tts' } = {}) {
  const j = await post(`https://aiplatform.googleapis.com/v1/projects/${PROJECT()}/locations/global/publishers/google/models/${model}:generateContent`,
    { contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } } });
  const a = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData; if (!a?.data) throw new Error('no audio came back');
  const raw = Buffer.from(a.data, 'base64'); if (raw.slice(0, 4).toString() === 'RIFF') return raw;
  return pcmToWav(raw, +(/rate=(\d+)/.exec(a.mimeType || '')?.[1] || 24000));
}

/** first frame (jpg/png buffer) + motion prompt → MP4 buffer */
export async function vertexVideo(frame, prompt, { model = process.env.VEO_MODEL || 'veo-3.1-fast-generate-001', seconds = 6, ratio = '9:16', resolution = '1080p', onWait = () => {}, maxMs = 9 * 60e3 } = {}) {
  const base = `https://${VEO_LOC()}-aiplatform.googleapis.com/v1/projects/${PROJECT()}/locations/${VEO_LOC()}/publishers/google/models/${model}`;
  const mimeType = frame[0] === 0x89 ? 'image/png' : 'image/jpeg';
  const op = await post(`${base}:predictLongRunning`, { instances: [{ prompt, image: { bytesBase64Encoded: frame.toString('base64'), mimeType } }],
    parameters: { sampleCount: 1, durationSeconds: seconds, aspectRatio: ratio, resolution, generateAudio: false, personGeneration: 'allow_adult' } });
  if (!op.name) throw new Error('video was not started');
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 10e3));
    const s = await post(`${base}:fetchPredictOperation`, { operationName: op.name }, 60e3);
    if (!s.done) { if (Date.now() - t0 > 60e3) onWait(); continue; }
    if (s.error) throw new Error(`the video model could not make this one (${s.error.message || s.error.code})`);
    const v = s.response?.videos?.[0]; if (v?.bytesBase64Encoded) return Buffer.from(v.bytesBase64Encoded, 'base64');
    if (s.response?.raiMediaFilteredCount) throw new Error('the video model filtered this one');
    throw new Error('no video came back');
  }
  throw new Error('the video took too long');
}
