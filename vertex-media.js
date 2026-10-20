// Voice and video on our own Google Cloud (Vertex AI) account, never through treg: generated assets are ours to pay for
// directly. Voice: Gemini TTS (raw PCM, wrapped as WAV). Video: Veo 3.1 image-to-video (submit, poll, bytes come back inline).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { kindOf } from './img-norm.js';
import { noteVertex } from './alerts.js'; // billing and quota failures reach the ops alerts

/* a WebP, GIF or AVIF frame (a real-photo stand-in can be any of them) becomes a PNG through ffmpeg before Veo sees it */
async function pngOrJpeg(buf) {
  const k = kindOf(buf); if (k === 'png' || k === 'jpeg') return { buf };
  const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16), src = path.join(os.tmpdir(), `veo-in-${id}`), out = path.join(os.tmpdir(), `veo-in-${id}.png`);
  if (!fs.existsSync(out)) { fs.writeFileSync(src, buf); await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-v', 'error', '-i', src, '-frames:v', '1', out], { timeout: 60e3 }, (e) => (e ? rej(new Error(`the first frame (${k || 'unknown'}) could not be read: ${e.message}`)) : res()))); }
  return { buf: fs.readFileSync(out) };
}
/* a first frame not of the clip's own shape is cropped to it (centred, cover) before Veo sees it: Veo pads a 4:5 picture into a
   9:16 clip with black bars above and below (an Arata reel, 20 Oct, filled only the middle of the frame) */
const run = (bin, args) => new Promise((res, rej) => execFile(bin, args, { timeout: 60e3 }, (e, out) => (e ? rej(e) : res(String(out || '')))));
export async function fitFrame(buf, ratio = '9:16') {
  const [rw, rh] = ratio === '16:9' ? [16, 9] : [9, 16], id = crypto.createHash('sha1').update(buf).update(ratio).digest('hex').slice(0, 16);
  const src = path.join(os.tmpdir(), `veo-fit-${id}`), out = path.join(os.tmpdir(), `veo-fit-${id}.png`);
  try { fs.writeFileSync(src, buf);
    const m = /(\d+)x(\d+)/.exec(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', src])); if (!m) return buf;
    const w = +m[1], h = +m[2], want = rw / rh; if (Math.abs(w / h - want) / want < 0.02) return buf;
    const cw = w / h > want ? Math.round((h * want) / 2) * 2 : w, ch = w / h > want ? h : Math.round(w / want / 2) * 2;
    await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', `crop=${cw}:${ch}`, '-frames:v', '1', out]); return fs.readFileSync(out); }
  catch { return buf; } /* without ffmpeg the frame goes as it is (bars, but a clip) */
  finally { fs.rmSync(src, { force: true }); fs.rmSync(out, { force: true }); }
}
/* whether a picture is already the clip's shape (fitFrame leaves it untouched) */
export const fitsRatio = async (buf, ratio) => (await fitFrame(buf, ratio)) === buf;
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
  /* Veo takes 16:9 or 9:16 only (a 4:5 or 1:1 draft asked for one and got a 400), 4 to 8 seconds, and a PNG or JPEG first frame */
  ratio = ratio === '16:9' ? '16:9' : '9:16'; seconds = Math.max(4, Math.min(8, Math.round(+seconds || 6)));
  ({ buf: frame } = await pngOrJpeg(frame)); frame = await fitFrame(frame, ratio); const mimeType = kindOf(frame) === 'png' ? 'image/png' : 'image/jpeg';
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
