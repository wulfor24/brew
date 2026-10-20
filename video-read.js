// Video read: what a short video does, scene by scene, so a move or a jam can borrow what works.
// 1. a downloadable file through treg (TikTok anyapi.tiktok.video_download, Instagram anyapi.instagram.post.detail,
//    YouTube tikhub youtube streams; a direct .mp4 URL is fetched as is)
// 2. Gemini on our own Vertex AI reads the file (project GOOGLE_CLOUD_PROJECT, location VERTEX_LOCATION, default global,
//    model VIDEO_MODEL, default gemini-3.5-flash; token from the Cloud Run metadata server, else `gcloud auth print-access-token`)
// 3. no Vertex: the transcript (treg) + ffmpeg keyframes to Claude (ai.js, image input); no Claude: the transcript alone.
// Cached across brands at _brew/video/<platform>-<id>.json (a video reads the same for every brand).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const GLOBAL = '_brew';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const MAX_BYTES = 60e6, INLINE_MAX = 18e6; // Vertex takes inline video up to ~20 MB; bigger files go through the bucket
// $ per 1M tokens (in, out), for the cost line only
const PRICE = { 'gemini-3.5-flash': [0.3, 2.5], 'gemini-2.5-flash': [0.3, 2.5], 'gemini-2.5-pro': [1.25, 10], 'gemini-3-pro': [2, 12] };
export const FORMATS = ['ugc', 'demo', 'founder', 'skit', 'slideshow', 'tutorial', 'unboxing', 'review', 'before-after', 'asmr', 'trend', 'interview', 'montage', 'other'];
const SCHEMA = { type: 'object', properties: {
  hook: { type: 'object', properties: { first3s: { type: 'string', description: 'what happens in the first 3 seconds' }, text: { type: 'string', description: 'words on screen or spoken in the first 3 seconds' }, visual: { type: 'string', description: 'the opening shot' } }, required: ['first3s', 'text', 'visual'] },
  scenes: { type: 'array', items: { type: 'object', properties: { t: { type: 'string', description: 'start time, m:ss' }, shot: { type: 'string' }, onScreenText: { type: 'string' }, voice: { type: 'string' } }, required: ['t', 'shot', 'onScreenText', 'voice'] } },
  productMoments: { type: 'array', items: { type: 'string', description: 'm:ss and what the product does on screen' } },
  cta: { type: 'string' }, format: { type: 'string', enum: FORMATS }, pacing: { type: 'string', description: 'cuts per 10 seconds and how the energy moves' },
  whyItWorks: { type: 'string' }, transcript: { type: 'string', description: 'everything said, verbatim' } },
  required: ['hook', 'scenes', 'productMoments', 'cta', 'format', 'pacing', 'whyItWorks', 'transcript'] };
// Vertex's responseSchema is the OpenAPI subset with upper-case types
const toVertex = (x) => (Array.isArray(x) ? x.map(toVertex) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'type' ? String(v).toUpperCase() : k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toVertex(pv)])) : toVertex(v)])) : x);
const PROMPT = (why) => `You are a performance-creative analyst. Watch this short-form video and break it down so a brand can make its own version.
Return JSON: hook (first 3 seconds: what happens, the words, the opening shot), scenes (every shot change: start time m:ss, the shot, on-screen text, voice-over or dialogue), productMoments (when and how the product shows), cta, format (${FORMATS.join(', ')}), pacing, whyItWorks (2-3 sentences, specific to this video), transcript (verbatim, empty if nothing is said).
Only describe what is in the video.${why ? `\nWhy we are reading it: ${why}` : ''}`;

// platform + id from a URL (or a platform and id given)
export function parseVideo({ url, link, platform, id } = {}) {
  url = url || link; id = id == null ? id : String(id).replace(/^(?:tt|ig|yt|fb):/, ''); // listening items carry link + a prefixed id
  if (url) { const v = fromUrl(url); if (v && (v.platform !== 'web' || !(platform && id))) return v; }
  if (platform && id) return { platform, id: String(id), url: url || ({ tiktok: `https://www.tiktok.com/@i/video/${id}`, instagram: `https://www.instagram.com/reel/${id}/`, youtube: `https://www.youtube.com/watch?v=${id}` })[platform] || null };
  throw new Error('video-read: need a url, or platform + id');
}
function fromUrl(url) {
  const u = String(url || ''); let m;
  if ((m = u.match(/tiktok\.com\/.*\/(?:video|photo)\/(\d+)/))) return { platform: 'tiktok', id: m[1], url: u };
  if ((m = u.match(/instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]+)/))) return { platform: 'instagram', id: m[1], url: u };
  if ((m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/))) return { platform: 'youtube', id: m[1], url: u };
  if (/facebook\.com|fb\.watch/.test(u)) return { platform: 'facebook', id: crypto.createHash('sha1').update(u).digest('hex').slice(0, 16), url: u };
  if (/^https?:\/\//.test(u)) return { platform: 'web', id: crypto.createHash('sha1').update(u).digest('hex').slice(0, 16), url: u };
  return null;
}
const vtt = (s) => String(s || '').replace(/^WEBVTT.*$/m, '').replace(/^\d+\s*$/gm, '').replace(/^[\d:.]+\s*-->\s*[\d:.]+.*$/gm, '').replace(/<[^>]+>/g, '').split('\n').map((x) => x.trim()).filter(Boolean).filter((x, i, a) => x !== a[i - 1]).join(' ');
const pick = (j) => j?.output?.data ?? j?.data ?? j; // anyapi wraps {output:{found,data}}

export function createVideoRead({ packs, treg, ai, log = console, gToken, fetchFn = fetch, vertex, ffmpeg = process.env.FFMPEG || 'ffmpeg',
  project = process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617', location = process.env.VERTEX_LOCATION || 'global', model = process.env.VIDEO_MODEL || 'gemini-3.5-flash', bucket = process.env.RESEARCH_BUCKET || 'squareup-feed' } = {}) {
  const aiCall = ai ? (typeof ai === 'function' ? ai : ai.call?.bind(ai)) : null;
  const TMP = path.join(os.tmpdir(), 'brew-video'); fs.mkdirSync(TMP, { recursive: true });
  let tok = { v: '', exp: 0 };
  const token = gToken || (async () => {
    if (tok.v && Date.now() < tok.exp) return tok.v;
    if (process.env.K_SERVICE) { const r = await fetchFn('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } }); const j = await r.json(); tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1e3 }; return tok.v; }
    const v = await new Promise((res, rej) => execFile('gcloud', ['auth', 'print-access-token'], { timeout: 15e3 }, (e, out, err) => (e ? rej(new Error(String(err || e.message).trim())) : res(out.trim()))));
    tok = { v, exp: Date.now() + 40 * 60e3 }; return v; });

  /* ---------- 1. a file we can download ---------- */
  async function mediaUrl(v, tag) {
    if (v.platform === 'tiktok') { const d = pick(await treg.call('anyapi.tiktok.video_download', { body: { url: v.url }, tag })); return { url: d?.videoUrl || d?.watermarkedUrl, cover: d?.image, durationS: d?.durationSeconds ?? null }; }
    if (v.platform === 'instagram') { const d = pick(await treg.call('anyapi.instagram.post.detail', { body: { url: v.url }, tag })); return { url: d?.videoUrl, cover: d?.displayUrl, owner: d?.owner, likes: d?.likes }; }
    if (v.platform === 'youtube') { const j = await treg.call('tikhub.x.youtube-web-v2-get-video-streams', { query: { video_id: v.id }, tag }); const all = [];
      (function walk(x, d) { if (!x || typeof x !== 'object' || d > 7) return; if (typeof x.url === 'string' && /video\/mp4|mp4/.test(String(x.mimeType || x.mime_type || x.type || x.ext || ''))) all.push(x); Object.values(x).forEach((y) => walk(y, d + 1)); })(j, 0);
      const audio = (x) => /mp4a|audio/.test(String(x.mimeType || x.mime_type || '')) || x.audioQuality || x.hasAudio || x.audio_quality;
      const best = all.filter(audio).sort((a, b) => (+a.height || 999) - (+b.height || 999)).find((x) => (+x.height || 360) >= 360) || all.filter(audio)[0] || all[0];
      return { url: best?.url || null }; }
    if (v.platform === 'web' && /\.(mp4|mov|webm)(\?|$)/i.test(v.url)) return { url: v.url };
    return { url: null };
  }
  async function download(u, id) {
    const r = await fetchFn(u, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(120e3) }); if (!r.ok) throw new Error(`download ${r.status}`);
    const len = +(r.headers.get('content-length') || 0); if (len > MAX_BYTES) throw new Error('video too big');
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX_BYTES) throw new Error('video too big'); if (buf.length < 10e3) throw new Error('download too small');
    const f = path.join(TMP, `${id}.mp4`); fs.writeFileSync(f, buf); return f;
  }

  /* ---------- 2. Gemini on Vertex ---------- */
  async function vertexRead(file, why, id, ytUrl = null) {
    const buf = file ? fs.readFileSync(file) : null, tk = await token(), host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    let media;
    if (!buf) media = { fileData: { mimeType: 'video/*', fileUri: ytUrl } }; /* a public YouTube video Gemini watches itself (its stream URLs refuse our server: 403) */
    else if (buf.length <= INLINE_MAX) media = { inlineData: { mimeType: 'video/mp4', data: buf.toString('base64') } };
    else { const name = `video-tmp/${id}.mp4`; const r = await fetchFn(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'content-type': 'video/mp4' }, body: buf });
      if (!r.ok) throw new Error(`gcs upload ${r.status}`); media = { fileData: { mimeType: 'video/mp4', fileUri: `gs://${bucket}/${name}` } }; }
    const body = { contents: [{ role: 'user', parts: [media, { text: PROMPT(why) }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: toVertex(SCHEMA) } };
    let lastErr;
    for (const m of [...new Set([model, 'gemini-2.5-flash'])]) {
      const r = await fetchFn(`https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${m}:generateContent`, { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'x-goog-user-project': project, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240e3) });
      if (!r.ok) { lastErr = new Error(`vertex ${m} ${r.status}: ${(await r.text()).slice(0, 240)}`); if (r.status === 404 || r.status === 400) continue; throw lastErr; }
      const j = await r.json(), text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join(''), u = j.usageMetadata || {}, p = PRICE[m] || PRICE['gemini-3.5-flash'];
      return { json: JSON.parse(text), model: m, tokens: { in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) }, usd: +(((u.promptTokenCount || 0) * p[0] + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * p[1]) / 1e6).toFixed(5) };
    }
    throw lastErr;
  }

  /* ---------- 3. fallback: transcript (+ keyframes to Claude) ---------- */
  async function transcript(v, tag) {
    const tries = { tiktok: [['anyapi.tiktok.video.captions', { body: { url: v.url } }], ['scrapecreators.x.v1-tiktok-video-transcript', { query: { url: v.url } }]],
      youtube: [['scrapecreators.x.v1-youtube-video-transcript', { query: { url: v.url } }]], instagram: [['scrapecreators.x.v2-instagram-media-transcript', { query: { url: v.url } }]],
      facebook: [['scrapecreators.x.v1-facebook-post-transcript', { query: { url: v.url } }], ['anyapi.facebook.post_transcript', { body: { url: v.url } }]] }[v.platform] || [];
    for (const [id, o] of tries) { try { const d = pick(await treg.call(id, { ...o, tag }));
        const t = typeof d?.transcript === 'string' ? d.transcript : Array.isArray(d?.transcript) ? d.transcript.map((x) => x.text).join(' ') : d?.transcript_only_text || d?.text || (Array.isArray(d) ? d.map((x) => x.text).join(' ') : '');
        const s = vtt(t); if (s) return { text: s, via: id }; } catch (e) { log.warn?.('[video-read] transcript', id, e.message); } }
    return { text: '', via: null };
  }
  const hasFfmpeg = () => new Promise((res) => execFile(ffmpeg, ['-version'], { timeout: 5e3 }, (e) => res(!e)));
  async function keyframes(file, id, n = 8) {
    const dir = path.join(TMP, `${id}-frames`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    await new Promise((res, rej) => execFile(ffmpeg, ['-loglevel', 'error', '-i', file, '-vf', 'fps=1/2,scale=512:-2', '-frames:v', String(n), path.join(dir, 'f%02d.jpg')], { timeout: 60e3 }, (e, _o, err) => (e ? rej(new Error(String(err || e.message).slice(0, 200))) : res())));
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => fs.readFileSync(path.join(dir, f)));
  }
  async function claudeRead(frames, tx, why, tag) {
    const content = [...frames.map((b, i) => [{ type: 'text', text: `Frame at ${i * 2}s:` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } }]).flat(),
      { type: 'text', text: `${PROMPT(why)}\nYou see one frame every 2 seconds, not the video. Transcript (from captions): ${tx || '(none)'}` }];
    const r = await aiCall({ tag, model: 'sonnet', max: 4000, schema: SCHEMA, messages: [{ role: 'user', content }] });
    return { json: r.json, usd: r.usd };
  }

  /* ---------- read one ---------- */
  async function read({ url, platform, id, why, slug, fresh = false } = {}) {
    const v = parseVideo({ url, platform, id }), key = `video/${v.platform}-${v.id}.json`, tag = `video-${slug || GLOBAL}`;
    if (!fresh) { const c = await packs.getJSON(GLOBAL, key, null); if (c?.read) return { ...c, cached: true }; }
    const out = { id: v.id, platform: v.platform, url: v.url, why: why || null, at: new Date().toISOString(), via: null, read: null, notes: [] };
    let file = null, media = {};
    try { media = await mediaUrl(v, tag); Object.assign(out, { cover: media.cover || null, durationS: media.durationS ?? null }); if (media.url) file = await download(media.url, `${v.platform}-${v.id}`); else out.notes.push('no downloadable file'); }
    catch (e) { out.notes.push(`download: ${e.message}`); }
    if (file && process.env.VIDEO_VERTEX !== '0') try { const r = await (vertex ? vertex(file, why, v) : vertexRead(file, why, `${v.platform}-${v.id}`)); Object.assign(out, { read: r.json, via: 'vertex', model: r.model || model, usd: r.usd ?? null, tokens: r.tokens || null }); }
    catch (e) { out.notes.push(`vertex: ${e.message.slice(0, 200)}`); log.warn?.('[video-read] vertex', e.message.slice(0, 200)); }
    if (!out.read && !file && v.platform === 'youtube' && !vertex && process.env.VIDEO_VERTEX !== '0') try { const r = await vertexRead(null, why, `${v.platform}-${v.id}`, `https://www.youtube.com/watch?v=${v.id}`); Object.assign(out, { read: r.json, via: 'vertex-youtube', model: r.model || model, usd: r.usd ?? null, tokens: r.tokens || null }); }
    catch (e) { out.notes.push(`vertex youtube: ${e.message.slice(0, 200)}`); }
    if (!out.read) {
      const tx = await transcript(v, tag); if (tx.via) out.notes.push(`transcript from ${tx.via}`);
      let frames = []; if (file && aiCall && await hasFfmpeg()) try { frames = await keyframes(file, `${v.platform}-${v.id}`); } catch (e) { out.notes.push(`keyframes: ${e.message}`); }
      if (aiCall && (frames.length || tx.text)) try { const r = await claudeRead(frames, tx.text, why, tag); Object.assign(out, { read: { ...r.json, transcript: r.json.transcript || tx.text }, via: frames.length ? 'claude-frames' : 'claude-transcript', usd: r.usd, frames: frames.length }); }
        catch (e) { out.notes.push(`claude: ${e.message.slice(0, 160)}`); }
      if (!out.read && tx.text) { const first = (tx.text.match(/^.{0,140}?[.!?](\s|$)/) || [tx.text.slice(0, 140)])[0].trim();
        out.read = { hook: { first3s: '', text: first, visual: '' }, scenes: [], productMoments: [], cta: '', format: 'other', pacing: '', whyItWorks: '', transcript: tx.text }; out.via = 'transcript'; }
    }
    if (file) fs.rm(file, { force: true }, () => {});
    if (out.read) await packs.put(GLOBAL, key, out).catch((e) => log.warn?.('[video-read] cache', e.message));
    return out;
  }
  // the top n videos of a list (by views/likes when given), read one after another; the brand's pack keeps the day's set
  async function readTop({ slug, items = [], n = 3, why } = {}) {
    const score = (x) => +(x.views ?? x.plays ?? x.playCount ?? x.likes ?? 0);
    const top = [...items].filter((x) => x?.url || x?.link || (x?.platform && x?.id)).sort((a, b) => score(b) - score(a)).slice(0, n), out = [];
    for (const x of top) { try { out.push(await read({ url: x.url || x.link, platform: x.platform, id: x.id, why: x.why || why, slug })); } catch (e) { out.push({ url: x.url || x.link, error: e.message }); } }
    if (slug && out.length) await packs.put(slug, `video/top-${new Date().toISOString().slice(0, 10)}.json`, { at: new Date().toISOString(), why: why || null, reads: out.map((r) => ({ id: r.id, platform: r.platform, url: r.url, via: r.via, format: r.read?.format, hook: r.read?.hook?.text, whyItWorks: r.read?.whyItWorks, error: r.error })) }).catch(() => {});
    return out;
  }
  /* the file itself (the reference a jam shows, and the clip a Sloosh final may take as a video reference) */
  async function file({ url, link, platform, id, slug, max = 25e6 } = {}) {
    const v = parseVideo({ url, link, platform, id }), m = await mediaUrl(v, `video-${slug || GLOBAL}`); if (!m.url) throw new Error('no downloadable file');
    const f = await download(m.url, `${v.platform}-${v.id}-f`); try { const buf = fs.readFileSync(f); if (buf.length > max) throw new Error('video too big'); return { buf, cover: m.cover || null, durationS: m.durationS ?? null }; } finally { fs.rm(f, { force: true }, () => {}); }
  }
  return { read, readTop, file, parse: parseVideo };
}
