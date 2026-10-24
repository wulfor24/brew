// A finished video, ready to post (Brew Studio, 24 Oct): the words spoken in it as timed captions (an .srt for the platform's own
// captions, and burned in for the feeds that play muted), a cover (the clearest frame, with the headline set in exact type), and
// for a short silent clip a looping GIF under 2 MB (email, WhatsApp, banners). Captions are drawn by Chromium like every other
// word Brew sets (never by ffmpeg's text filters, which not every build has) and laid over the film with ffmpeg's overlay, inside
// the safe zone the Reels/TikTok buttons and caption leave free. Timings come from a speech read (Gemini on Vertex); with none,
// a known script is spread over the speech and marked approximate; with neither, there are no captions and it says so.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const tidy = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const run = (bin, args, ms = 180e3) => new Promise((res, rej) => execFile(bin, args, { timeout: ms, maxBuffer: 64 << 20 }, (e, out, err) => (e ? rej(new Error(String(err || e.message).trim().slice(-300))) : res(String(out)))));
const tmp = (ext) => path.join(os.tmpdir(), `brew-vf-${crypto.randomBytes(6).toString('hex')}.${ext}`);

/* SRT time: 00:00:01,250 */
const ts = (s) => { const ms = Math.max(0, Math.round(s * 1000)), h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
export const srtOf = (segs = []) => segs.map((x, i) => `${i + 1}\n${ts(x.from)} --> ${ts(x.to)}\n${x.text}\n`).join('\n');

/* caption phrases a person can read in a glance: 2–6 words, never longer than the time they are on screen allows */
export function phrases(segs = [], dur = 60) {
  const out = [];
  for (const sg of segs) { const words = tidy(sg.text, 400).split(' ').filter(Boolean); if (!words.length) continue; const from = Math.max(0, +sg.from || 0), to = Math.min(dur, Math.max(from + 0.4, +sg.to || from + 1));
    const n = Math.max(1, Math.ceil(words.length / 6)), step = (to - from) / n; for (let k = 0; k < n; k++) out.push({ from: +(from + k * step).toFixed(2), to: +(from + (k + 1) * step).toFixed(2), text: words.slice(Math.round((k * words.length) / n), Math.round(((k + 1) * words.length) / n)).join(' ') }); }
  return out.filter((x) => x.text && x.to > x.from).sort((a, b) => a.from - b.from).map((x, i, a) => ({ ...x, to: i < a.length - 1 ? Math.min(x.to, a[i + 1].from) : x.to }));
}
/* a script with no read timings: spread over the speech (most of the clip), marked approximate */
export const spread = (script, dur) => { const ws = tidy(script, 600).split(' ').filter(Boolean); if (!ws.length || !dur) return []; const start = Math.min(0.4, dur * 0.05), end = dur * 0.94; return phrases([{ from: start, to: end, text: ws.join(' ') }], dur); };

/* a Reels/TikTok-safe caption card: the bottom fifth and the right edge are the platform's (buttons, caption); words sit above */
const captionHtml = ({ w, h, text, font = 'Inter, "Noto Sans", Arial, sans-serif' }) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;background:transparent}
  .c{position:absolute;left:${Math.round(w * 0.08)}px;right:${Math.round(w * 0.16)}px;top:${Math.round(h * 0.62)}px;display:flex;justify-content:center}
  .c span{font:800 ${Math.round(w * 0.058)}px/1.18 ${font};color:#fff;text-align:center;background:rgba(0,0,0,.62);padding:${Math.round(w * 0.012)}px ${Math.round(w * 0.026)}px;border-radius:${Math.round(w * 0.02)}px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
</style></head><body><div class="c"><span>${esc(text)}</span></div></body></html>`;
const coverHtml = ({ w, h, bg, headline, font = 'Inter, "Noto Sans", Arial, sans-serif' }) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;background:#000 url('${bg}') center/cover no-repeat}
  .s{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,0) 42%)}
  .t{position:absolute;left:${Math.round(w * 0.08)}px;right:${Math.round(w * 0.08)}px;top:${Math.round(h * 0.1)}px;font:800 ${Math.round(w * 0.085)}px/1.08 ${font};color:#fff;text-shadow:0 2px 18px rgba(0,0,0,.45)}
</style></head><body><div class="s"></div><div class="t">${esc(headline)}</div></body></html>`;

export function createVideoFinish({ ffmpeg = process.env.FFMPEG || 'ffmpeg', ffprobe = process.env.FFPROBE || 'ffprobe', launchBrowser = null, transcribe = null, log = console } = {}) {
  const probe = async (file) => { try { const j = JSON.parse(await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file], 30e3));
    const v = (j.streams || []).find((x) => x.codec_type === 'video') || {}; return { w: +v.width || 1080, h: +v.height || 1920, dur: +j.format?.duration || 0, audio: (j.streams || []).some((x) => x.codec_type === 'audio') }; } catch { return { w: 1080, h: 1920, dur: 0, audio: false }; } };
  /* the clip's own speech, as caption phrases; { segs, approx, none, error } */
  async function captions(buf, { script = '' } = {}) {
    const f = tmp('mp4'); fs.writeFileSync(f, buf);
    try { const p = await probe(f); if (!p.audio) return { segs: [], none: 'This video has no speech, so it has no captions.' };
      if (transcribe) { try { const segs = await transcribe(buf, { script, dur: p.dur }); if (Array.isArray(segs)) return segs.length ? { segs: phrases(segs, p.dur) } : { segs: [], none: 'No words are spoken in it, so it has no captions.' }; } catch (e) { log.warn?.('[video-finish] read speech', e.message); } }
      if (script) return { segs: spread(script, p.dur), approx: true };
      return { segs: [], error: 'The words couldn’t be read from the video, so it has no captions yet.' };
    } finally { fs.rmSync(f, { force: true }); } }
  /* words drawn as transparent cards (Chromium), laid over the film at their times (ffmpeg overlay); null when it can't */
  async function burn(buf, segs = [], { font } = {}) {
    if (!segs.length || !launchBrowser) return null; const f = tmp('mp4'), out = tmp('mp4'), pngs = []; fs.writeFileSync(f, buf);
    try { const p = await probe(f), br = await launchBrowser();
      try { const page = await br.newPage(); try { await page.setViewport({ width: p.w, height: p.h, deviceScaleFactor: 1 });
        for (const sg of segs.slice(0, 40)) { await page.setContent(captionHtml({ w: p.w, h: p.h, text: sg.text, font }), { waitUntil: 'load' }); const pf = tmp('png'); fs.writeFileSync(pf, await page.screenshot({ type: 'png', omitBackground: true })); pngs.push({ pf, ...sg }); } } finally { await page.close().catch(() => {}); } }
      finally { await br.close?.().catch?.(() => {}); }
      const inputs = pngs.flatMap((x) => ['-i', x.pf]);
      const chain = [...pngs.map((x, i) => `[${i ? `c${i - 1}` : '0:v'}][${i + 1}:v]overlay=0:0:enable='gte(t,${x.from})*lt(t,${x.to})'[c${i}]` /* the end is open: where one line ends and the next begins, only the next shows */), `[c${pngs.length - 1}]format=yuv420p[vo]`].join(';');
      await run(ffmpeg, ['-y', '-v', 'error', '-i', f, ...inputs, '-filter_complex', chain, '-map', '[vo]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-c:a', 'copy', '-movflags', '+faststart', out], 300e3);
      return fs.readFileSync(out);
    } catch (e) { log.warn?.('[video-finish] burn', e.message); return null; }
    finally { [f, out, ...pngs.map((x) => x.pf)].forEach((x) => fs.rmSync(x, { force: true })); } }
  /* a still from the film; the cover is the clearest of a few (the largest JPEG of them: the sharpest, most detailed frame) */
  async function frames(buf, at = []) { const f = tmp('mp4'); fs.writeFileSync(f, buf); const outs = [];
    try { const p = await probe(f), pts = at.length ? at : [0.18, 0.35, 0.5, 0.68].map((x) => +(p.dur * x).toFixed(2));
      for (const t of pts) { const o = tmp('jpg'); try { await run(ffmpeg, ['-y', '-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-q:v', '2', o], 60e3); outs.push({ at: t, buf: fs.readFileSync(o) }); } catch {} finally { fs.rmSync(o, { force: true }); } }
      return { outs, p }; } finally { fs.rmSync(f, { force: true }); } }
  async function cover(buf, { headline = '', font } = {}) {
    const { outs, p } = await frames(buf); if (!outs.length) return null; const best = outs.reduce((a, b) => (b.buf.length > a.buf.length ? b : a));
    if (!headline || !launchBrowser) return { frame: best.buf, at: best.at, cover: best.buf };
    try { const br = await launchBrowser(); try { const page = await br.newPage(); try { await page.setViewport({ width: p.w, height: p.h, deviceScaleFactor: 1 });
      await page.setContent(coverHtml({ w: p.w, h: p.h, bg: `data:image/jpeg;base64,${best.buf.toString('base64')}`, headline: tidy(headline, 90), font }), { waitUntil: 'load' });
      return { frame: best.buf, at: best.at, cover: await page.screenshot({ type: 'jpeg', quality: 90 }) }; } finally { await page.close().catch(() => {}); } } finally { await br.close?.().catch?.(() => {}); } }
    catch (e) { log.warn?.('[video-finish] cover', e.message); return { frame: best.buf, at: best.at, cover: best.buf }; } }
  /* a looping GIF of the clip's first seconds, under maxBytes (smaller and slower until it fits) */
  async function gif(buf, { seconds = 3, width = 600, maxBytes = 2e6 } = {}) { const f = tmp('mp4'); fs.writeFileSync(f, buf);
    try { for (const [w, fps] of [[width, 15], [Math.round(width * 0.8), 12], [Math.round(width * 0.66), 10], [400, 8]]) { const o = tmp('gif');
      try { await run(ffmpeg, ['-y', '-v', 'error', '-t', String(seconds), '-i', f, '-filter_complex', `fps=${fps},scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', o], 120e3);
        const g = fs.readFileSync(o); if (g.length <= maxBytes) return { gif: g, width: w, fps, bytes: g.length }; } catch (e) { log.warn?.('[video-finish] gif', e.message); return null; } finally { fs.rmSync(o, { force: true }); } }
      return null; } finally { fs.rmSync(f, { force: true }); } }
  return { probe, captions, burn, cover, gif, frames };
}

/* the speech read: Gemini on Vertex hears the clip and returns its words with start and end seconds (a fraction of a cent) */
export function vertexTranscribe({ gToken, fetchFn = fetch, project = process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617', location = process.env.VERTEX_LOCATION || 'global', model = process.env.CAPTION_MODEL || 'gemini-2.5-flash', spend = () => true } = {}) {
  return async (buf, { script = '', dur = 0 } = {}) => {
    if (!spend()) throw new Error('budget');
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`, tk = await gToken();
    const prompt = `Transcribe exactly what is spoken in this ${dur ? `${dur.toFixed(1)}-second ` : ''}video, word for word, with when each part is said. Return segments of 2 to 6 words, each with start and end in seconds (decimals). Only spoken words: no sounds, no music, no on-screen text. If nothing is spoken, return no segments.${script ? ` The speaker was asked to say (it may differ; write what is really said): "${tidy(script, 400)}"` : ''}`;
    const body = { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'video/mp4', data: buf.toString('base64') } }, { text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { segments: { type: 'ARRAY', items: { type: 'OBJECT', properties: { start: { type: 'NUMBER' }, end: { type: 'NUMBER' }, text: { type: 'STRING' } }, required: ['start', 'end', 'text'] } } }, required: ['segments'] } } };
    const r = await fetchFn(`https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`, { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'x-goog-user-project': project, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120e3) });
    if (!r.ok) throw new Error(`vertex ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json(), text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    const segs = (JSON.parse(text || '{}').segments || []).map((x) => ({ from: +x.start, to: +x.end, text: tidy(x.text, 120) })).filter((x) => Number.isFinite(x.from) && Number.isFinite(x.to) && x.text);
    return segs;
  };
}
