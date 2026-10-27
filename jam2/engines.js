// Jam v2: partners are interchangeable. Brew owns the pipeline (concept → spec → compose → type → gate); a partner only renders
// pixels or clips for one capability. Each adapter says which capabilities it has, whether it is connected, what a job will
// cost (quote) and runs it (run → { file: 'gen/<name>', provider, model, usd, credits }). data/engines.json orders them per
// capability; changing partners is a data change. An adapter that is not connected is skipped, never faked.
//   vertex      Gemini image + edit, Veo, Gemini TTS on Brew's own Google Cloud (live)
//   sloosh      ShopOS studio over MCP, Brew's paid account (finals.js: quote first, never paid twice)
//   higgsfield  api.higgsfield.ai queue: POST /<model> { ...input } → request_id → /requests/<id>/status (HF_API_KEY_ID/SECRET)
//   local       free: background cut-out (@imgly/background-removal-node when installed)
//   fal, heygen, elevenlabs   not connected yet (their keys are not set); the router skips them
import { createSlooshStudio } from './sloosh-studio.js'; // Studio's makers on Sloosh (27 Oct; Higgsfield retired)
import { makersNow } from '../media.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROUTES = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'engines.json'), 'utf8'));
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16);
export const CAPS = Object.keys(ROUTES.route);

export function createEngines({ geminiImage, vertexVideo, vertexVoice, vertexMusic = null, finals = null, saveGen, genFile, publicUrl = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', photo = async () => null,
  fetchImpl = fetch, env = process.env, mock = () => process.env.AI_MOCK === '1', log = console }) {
  const keep = (buf, ext) => { const name = `j2-${sha(buf)}.${ext}`; saveGen(name, buf); return 'gen/' + name; };
  const pub = (rel) => (/^https?:/.test(rel) ? rel : `${publicUrl.replace(/\/$/, '')}/${String(rel).replace(/^\//, '')}`);
  const V = ROUTES.vertex.usd, H = ROUTES.higgsfield;

  /* ---------- vertex (live) ---------- */
  const vertex = {
    id: 'vertex', label: 'Sloosh', live: () => !!geminiImage, /* the id stays 'vertex' (saved boards name it); every picture and clip behind it is Sloosh since 27 Oct */
    caps: {
      'still.scene': { quote: () => ({ usd: V.still }), run: async (s) => { const buf = await geminiImage({ srcFile: s.srcFile || null, refFiles: s.refFiles || [], prompt: s.prompt, ratio: s.ratio || '4:5', slug: s.slug, productName: s.product || null, ...(s.product === false ? { product: false } : {}), text: s.text || '', fallback: false }); return { file: keep(buf, 'png'), model: buf.model || 'sloosh', usd: V.still, guard: buf.guard || null }; } },
      'still.edit': { quote: () => ({ usd: V.still }), run: async (s) => { const buf = await geminiImage({ srcFile: s.srcFile, refFiles: s.refFiles || [], prompt: s.prompt, ratio: s.ratio || '4:5', slug: s.slug, text: s.text || '', fallback: false, edit: true }); return { file: keep(buf, 'png'), model: buf.model || 'sloosh', usd: V.still }; } },
      'still.harmonize': { quote: () => ({ usd: V.still }), run: async (s) => { const buf = await geminiImage({ srcFile: s.srcFile, refFiles: s.refFiles || [], prompt: s.prompt, ratio: s.ratio || '4:5', slug: s.slug, productName: s.product || null, fallback: false }); return { file: keep(buf, 'png'), model: buf.model || 'sloosh', usd: V.still, guard: buf.guard || null }; } },
      /* the shoot (creative.js): the whole photograph made around the real product, its photos as references, on the pro model; the
         product check (image guard) runs on each one and throws on a different product, so the engine moves to the next candidate */
      'still.shot': { quote: () => ({ usd: V.stillPro }), run: async (s) => { const buf = await geminiImage({ srcFile: s.srcFile || null, refFiles: s.refFiles || [], prompt: s.prompt, ratio: s.ratio || '4:5', slug: s.slug, ...(s.product ? { named: s.named || null } : { product: false }), fallback: false, model: 'gemini-3-pro-image' });
        /* the guard hands back the real photo when the product still differs: for a shoot that is a failed candidate, not a picture */
        if (buf.guard?.fallback) throw Object.assign(new Error(`the product changed (${buf.guard.why || 'different product'})`), { mismatch: true });
        return { file: keep(buf, 'png'), model: buf.model || 'sloosh', usd: V.stillPro, guard: buf.guard || null }; } },
      /* another placement of the same photo: shot wider or taller (outpaint), the photo itself kept */
      'still.extend': { quote: () => ({ usd: V.stillPro }), run: async (s) => { const buf = await geminiImage({ srcFile: s.srcFile, prompt: s.prompt, ratio: s.ratio || '9:16', slug: s.slug, product: false, fallback: false, edit: true, model: 'gemini-3-pro-image' }); return { file: keep(buf, 'png'), model: buf.model || 'sloosh', usd: V.stillPro }; } },
      'still.full': { quote: () => ({ usd: V.stillPro }), run: async (s) => { const buf = await geminiImage({ srcFile: s.srcFile, refFiles: s.refFiles || [], prompt: s.prompt, ratio: s.ratio || '4:5', slug: s.slug, productName: s.product || null, fallback: false, tier: 'final' /* the full one: Nano Banana Pro at 4K on Sloosh */ }); return { file: keep(buf, 'png'), model: buf.model || 'sloosh', usd: V.stillPro, guard: buf.guard || null }; } },
      'cutout': { quote: () => ({ usd: V.still }), run: async (s) => { const buf = await geminiImage({ srcFile: s.srcFile, prompt: 'Image 1 is a product photo. Return the exact same product, unchanged in shape, label, colour and text, alone on a plain pure white (#FFFFFF) background, centred, filling 80% of the frame, soft even light, no shadow, no props, no text added.', ratio: '1:1', slug: s.slug, productName: s.product || null, fallback: false, gate: false /* a packshot on white, not an ad: never judged as one */ }); return { file: keep(buf, 'png'), model: buf.model || 'sloosh', usd: V.still, white: true }; } },
      'video.shot': { quote: (s) => ({ usd: +(V.videoPerSecond * (s.seconds || 6)).toFixed(2) }), run: async (s) => { const frame = fs.readFileSync(s.srcFile); const buf = await vertexVideo(frame, s.prompt, { ratio: s.ratio === '16:9' ? '16:9' : '9:16', seconds: s.seconds || 6 }); return { file: keep(buf, 'mp4'), model: buf.model || 'sloosh', usd: +(V.videoPerSecond * (s.seconds || 6)).toFixed(2) }; } },
      /* a garment on a model: Sloosh's own Virtual Try-On space, as it is */
      'still.tryon': { quote: () => ({ usd: V.stillPro }), run: async (s) => { const M = makersNow(); if (!M?.space) throw new Error('Sloosh is not connected here'); const rec = await M.space({ slug: s.slug, id: 'sp_a4048a80-a935-45aa-a784-a46010077c06', name: 'Virtual Try-On', ctx: { person: s.personUrl || null, garment: s.srcUrl || null, product: s.product || null }, refs: [s.personUrl && { url: pub(s.personUrl), job: 'person' }, s.srcUrl && { url: pub(s.srcUrl), job: 'product' }].filter(Boolean) });
        if (rec.state !== 'done') throw new Error(rec.error || 'Sloosh has not finished it yet'); return { file: rec.file, model: 'sloosh:virtual-try-on', usd: V.stillPro, provider: 'sloosh' }; } },
      'music.gen': { quote: () => ({ usd: V.music ?? 0.06 }), run: async (s) => { if (!vertexMusic) throw new Error('music is not set up'); const wav = await vertexMusic(s.prompt); return { file: keep(wav, 'wav'), model: 'lyria', usd: V.music ?? 0.06 }; } },
      'voice.tts': { quote: () => ({ usd: V.voice }), run: async (s) => { const wav = await vertexVoice(s.text, s.voice || 'Kore'); return { file: keep(wav, 'wav'), model: 'gemini-tts', usd: V.voice }; } }
    }
  };

  /* ---------- sloosh (ShopOS, Brew's paid account): every run is quoted first through finals.js ---------- */
  const slSpec = (s, kind) => ({ kind, visual: s.prompt, text: s.words || [], ratio: s.ratio || (kind === 'video' ? '9:16' : '4:5'), refs: [...(s.refs || []), s.srcUrl ? pub(s.srcUrl) : null].filter(Boolean), /* the picture to finish or edit goes first-class to the partner */ product: s.product ? { name: s.product } : undefined, motion: s.motion || null, space: s.space || null, brandName: s.brandName || null });
  const slooshCap = (kind) => ({
    quote: async (s) => { const q = await finals.quote(s.slug, slSpec(s, kind)); if (q.error) return { error: q.error }; return { credits: q.credits || 0, usd: null, q, provider: q.provider || 'sloosh', why: q.why || null }; },
    run: async (s, qx) => { const q = qx?.q || (await finals.quote(s.slug, slSpec(s, kind))); if (q.error) throw new Error(q.error); const rec = await finals.run(s.slug, slSpec(s, kind), { quote: q, by: s.by || null, target: { jam2: s.jamId, board: s.boardId } });
      if (rec.state !== 'done') throw new Error(rec.error || rec.note || 'Sloosh has not finished it yet'); return { file: rec.file, model: rec.model || q.model || 'sloosh', credits: rec.charged ?? q.credits ?? 0, provider: rec.provider || 'sloosh' }; }
  });
  const sloosh = { id: 'sloosh', label: 'Sloosh', live: () => !!finals,
    caps: { 'still.full': slooshCap('image'), 'still.scene': slooshCap('image'), 'still.tryon': { ...slooshCap('image') }, 'video.shot': slooshCap('video'), 'video.ugc': slooshCap('video') } };

  /* ---------- higgsfield (api.higgsfield.ai; live once HF_API_KEY_ID and HF_API_KEY_SECRET are set) ---------- */
  const hfAuth = () => (env.HF_API_KEY_ID && env.HF_API_KEY_SECRET ? `Key ${env.HF_API_KEY_ID}:${env.HF_API_KEY_SECRET}` : null);
  const hfCall = async (model, input, { maxMs = 15 * 60e3 } = {}) => {
    const r = await fetchImpl(`${H.base}/${model}`, { method: 'POST', headers: { authorization: hfAuth(), 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(60e3) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`Higgsfield ${model} ${r.status}: ${JSON.stringify(j).slice(0, 240)}`);
    const id = j.request_id || j.id; if (!id) throw new Error(`Higgsfield gave no request id (${Object.keys(j).join(', ')})`);
    const t0 = Date.now(); let wait = 3000;
    while (Date.now() - t0 < maxMs) { await new Promise((ok) => setTimeout(ok, wait)); wait = Math.min(wait * 1.4, 15e3);
      const s = await fetchImpl(j.status_url || `${H.base}/requests/${id}/status`, { headers: { authorization: hfAuth() }, signal: AbortSignal.timeout(30e3) }).then((x) => x.json()).catch(() => null); if (!s) continue;
      const st = String(s.status || '').toLowerCase();
      if (/fail|error|nsfw|cancel/.test(st)) throw new Error(`Higgsfield ${model}: ${s.error || st}`);
      if (/complete|succeed|done/.test(st)) { const out = s.images?.[0]?.url || s.video?.url || s.output?.url || s.outputs?.[0]?.url || s.result?.url || s.url; if (!out) throw new Error(`Higgsfield ${model} finished with no output link`);
        const b = await fetchImpl(out, { signal: AbortSignal.timeout(180e3) }); if (!b.ok) throw new Error(`Higgsfield output could not be fetched (${b.status})`); return { buf: Buffer.from(await b.arrayBuffer()), type: b.headers.get('content-type') || '', id }; } }
    throw Object.assign(new Error('It’s still being made, so nothing is paid twice; we’ll check again'), { open: true, id });
  };
  /* the routed offerings (jam2/higgsfield.js + data/higgsfield-routes.json): each job's best workflow, its input fitted to the
     workflow's schema and priced by Higgsfield's own estimate before anything runs */
  const HF = createSlooshStudio({ log });
  /* the caller's hold on a paid request (Studio's make): the job to pick up again after a restart, where to write it down the moment
     it is bought, and an idempotency key so a retried submit never buys twice. Absent, a request runs as before */
  const hfOpts = (s) => { const h = s?.hf; return h ? { idem: h.idem || null, resume: h.resume || null, onSubmit: h.onSubmit || null } : {}; };
  const tierOf = (s) => (s.tier === 'premium' || s.tier === 'preview' ? s.tier : 'default');
  const shotInput = (s) => { const o = HF.pick('product-shot', tierOf(s)); const urls = [s.srcUrl, ...(s.refUrls || [])].filter(Boolean).map(pub);
    return { o, input: { ...o.input, prompt: s.prompt, image_urls: urls, aspect_ratio: HF.nearestRatio(o.id, s.ratio || '1:1') } }; };
  const hfImage = (cap) => cap === 'still.shot'
    ? { quote: async (s) => { const { o, input } = shotInput(s); const e = await HF.estimate(o.id, input); return { usd: e.usd ?? H.usd.shot ?? H.usd.still, model: o.id }; },
        run: async (s) => { const { o, input } = shotInput(s); const e = await HF.estimate(o.id, input); const out = await HF.run(o.id, { ...input, slug: s.slug }, hfOpts(s));
          return { file: keep(out.buf, /jpe?g/.test(out.type) ? 'jpg' : 'png'), model: o.id, usd: e.usd ?? H.usd.shot, provider: 'higgsfield' }; } }
    : { quote: () => ({ usd: H.usd.still }), run: async (s) => { const urls = [s.srcUrl, ...(s.refUrls || [])].filter(Boolean).map(pub);
        const out = await HF.run('sloosh:product-shot', { slug: s.slug, prompt: s.prompt, aspect_ratio: s.ratio || '1:1', image_urls: urls });
        return { file: keep(out.buf, /jpe?g/.test(out.type) ? 'jpg' : 'png'), model: H.models[cap], usd: H.usd.still, provider: 'higgsfield' }; } };
  /* a video shot: Kling 3.0 from the shot's first frame (product-motion), or a person with the product (ugc-video, Seedance) */
  const vidInput = (cap, s) => { const job = cap === 'video.ugc' ? 'ugc-video' : 'product-motion', o = HF.pick(job, tierOf(s)); const urls = [s.srcUrl, ...(s.refUrls || [])].filter(Boolean).map(pub);
    const input = job === 'ugc-video' ? { ...o.input, prompt: s.prompt, image_urls: urls, duration: Math.max(4, Math.round(s.seconds || 8)), aspect_ratio: HF.nearestRatio(o.id, s.ratio || '9:16') }
      : { ...o.input, prompt: s.prompt, image_url: urls[0], duration: Math.max(3, Math.round(s.seconds || 5)) };
    return { o, input }; };
  const hfVideo = (cap) => ({ quote: async (s) => { const { o, input } = vidInput(cap, s); const e = await HF.estimate(o.id, input); return { usd: e.usd ?? +(H.usd.videoPerSecond * (s.seconds || 5)).toFixed(2), model: o.id }; },
    run: async (s) => { const { o, input } = vidInput(cap, s); const e = await HF.estimate(o.id, input); const out = await HF.run(o.id, { ...input, slug: s.slug }, { maxMs: 20 * 60e3, ...hfOpts(s) });
      return { file: keep(out.buf, 'mp4'), model: o.id, usd: e.usd ?? +(H.usd.videoPerSecond * (s.seconds || 5)).toFixed(2), provider: 'higgsfield' }; } });
  const higgsfield = { id: 'higgsfield', label: 'Sloosh (Studio)', live: () => HF.live(), /* the id stays for saved boards; it runs on Sloosh */
    caps: { 'still.full': hfImage('still.full'), 'still.shot': hfImage('still.shot'), 'still.scene': hfImage('still.scene'), 'still.edit': hfImage('still.edit'), 'video.shot': hfVideo('video.shot'), 'video.ugc': hfVideo('video.ugc'),
      'cast.create': { quote: () => ({ usd: V.stillPro }), run: async (s) => { const out = await HF.run('sloosh:cast', { slug: s.slug, prompt: s.prompt || 'A real, everyday person for the brand, a natural portrait in soft light', image_url: s.srcUrl ? pub(s.srcUrl) : null }); return { file: keep(out.buf, 'png'), model: out.model, usd: V.stillPro, provider: 'sloosh' }; } } } };

  /* ---------- local (free) ---------- */
  /* the cut-out runs in one worker thread (jam2/cutout-worker.js), one photo at a time, so a batch never stalls the server;
     a photo that takes over 90 s fails on its own and the worker is replaced */
  let imglyP = null, worker = null, wseq = 0; const wait = new Map(); let lane = Promise.resolve();
  /* one shared load: calls that arrive while it loads wait for it (they used to read 'not installed' and fail) */
  const loadImgly = () => (imglyP ||= import('@imgly/background-removal-node').catch(() => null));
  const spawnWorker = async () => { const { Worker } = await import('node:worker_threads'); const w = new Worker(new URL('./cutout-worker.js', import.meta.url)); w.unref();
    w.on('message', (m) => { const p = wait.get(m.id); if (!p) return; wait.delete(m.id); clearTimeout(p.t); m.ok ? p.ok(Buffer.from(m.buf)) : p.no(new Error(m.error)); });
    const dead = (e) => { if (worker === w) worker = null; for (const [id, p] of wait) { clearTimeout(p.t); p.no(e instanceof Error ? e : new Error('the cut-out stopped')); wait.delete(id); } };
    w.on('error', dead); w.on('exit', () => dead(new Error('the cut-out stopped'))); return w; };
  const cutInWorker = (buf) => (lane = lane.catch(() => {}).then(async () => { worker ||= await spawnWorker(); const w = worker, id = ++wseq;
    return new Promise((ok, no) => { const t = setTimeout(() => { wait.delete(id); no(new Error('the cut-out took too long')); if (worker === w) { worker = null; w.terminate().catch(() => {}); } }, 90e3); wait.set(id, { ok, no, t }); w.postMessage({ id, buf }); }); }));
  const local = { id: 'local', label: 'Our own maker (free)', live: () => true,
    caps: { cutout: { available: async () => !!(await loadImgly()), quote: () => ({ usd: 0 }), run: async (s) => { if (!(await loadImgly())) throw Object.assign(new Error('the local cut-out is not installed'), { skip: true });
      const buf = await cutInWorker(fs.readFileSync(s.srcFile)); return { file: keep(buf, 'png'), model: 'imgly-isnet', usd: 0, alpha: true }; } } } };

  /* not connected yet: listed so the routing table reads true, skipped until their keys exist */
  const off = (id, label, caps, key) => ({ id, label, live: () => !!env[key], caps: Object.fromEntries(caps.map((c) => [c, { quote: () => ({ error: `${label} is not connected yet` }), run: async () => { throw Object.assign(new Error(`${label} is not connected yet`), { skip: true }); } }])) });
  const ADAPTERS = { vertex, sloosh, higgsfield, local, fal: off('fal', 'fal.ai', ['still.tryon', 'upscale', 'video.edit'], 'FAL_KEY'), heygen: off('heygen', 'HeyGen', ['video.avatar', 'video.ugc'], 'HEYGEN_API_KEY'), elevenlabs: off('elevenlabs', 'ElevenLabs', ['voice.tts'], 'ELEVENLABS_API_KEY') };

  /* the adapters that can do a capability right now, best first */
  const candidates = (cap, { prefer = null } = {}) => { const order = [...(prefer ? [prefer] : []), ...(ROUTES.route[cap] || [])]; return [...new Set(order)].map((id) => ADAPTERS[id]).filter((a) => a && a.live() && a.caps[cap]); };
  async function quote(cap, spec = {}, o = {}) {
    if (mock()) return { usd: 0, provider: 'mock', mock: true };
    for (const a of candidates(cap, o)) { const c = a.caps[cap]; if (c.available && !(await c.available())) continue; try { const q = await c.quote(spec); if (!q?.error) return { ...q, provider: q.provider || a.id, label: a.label }; } catch (e) { log.warn?.('[engines] quote', a.id, cap, e.message); } }
    return { error: `No partner can do ${cap} right now.` };
  }
  /* run on the best partner; a refusal or error falls through to the next one, and the result names who made it */
  async function run(cap, spec = {}, o = {}) {
    if (mock()) return mockRun(cap, spec);
    let last = null;
    /* a fallback never costs more than the price the brand was shown: the first partner sets the ceiling, a dearer one (or one
       paid in credits when the first wasn't) is skipped, so a refusal can't quietly move the job to a more expensive partner */
    let ceiling = null, first = true;
    for (const a of candidates(cap, o)) { const c = a.caps[cap]; if (c.available && !(await c.available())) continue;
      if (!first) { const q = await Promise.resolve(c.quote(spec)).catch(() => null);
        /* a refusal the first partner refunded (a safety filter's false alarm) cost nothing, so the next partner may use the room the
           shown price already leaves for a retry (Studio prices a take at 1.5× its first quote): Arata, 23 Oct, Flare refused a hair
           shot and the cheaper-only rule left the brand with nothing */
        const cap0 = ceiling?.usd != null ? ceiling.usd * (last?.refunded || last?.moderated ? 1.5 : 1) : null;
        if (!q || q.error || (q.credits && !(ceiling?.credits)) || (q.usd != null && cap0 != null && q.usd > cap0 + 1e-6)) { log.warn?.('[engines] skip dearer fallback', a.id, cap); continue; } }
      else { ceiling = o.quote || await Promise.resolve(c.quote(spec)).catch(() => null); first = false; }
      try { const r = await c.run(spec, o.quote?.provider === a.id ? o.quote : null); return { ...r, provider: r.provider || a.id, cap }; }
      catch (e) { last = e; if (e.open) throw e; log.warn?.('[engines] run', a.id, cap, e.message); } }
    throw last || new Error(`No partner can do ${cap} right now.`);
  }
  /* AI_MOCK: free stand-ins so the whole flow runs locally (the product photo as the scene, a grey clip, a tone) */
  async function mockRun(cap, spec) {
    if (/^still|^cutout|^cast/.test(cap)) { const f = spec.srcFile && fs.existsSync(spec.srcFile) ? fs.readFileSync(spec.srcFile) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+P9/PQAJYAN0Zx7nPgAAAABJRU5ErkJggg==', 'base64');
      return { file: keep(f, 'png'), provider: 'mock', model: 'mock', usd: 0, cap, mock: true }; }
    return { file: null, provider: 'mock', model: 'mock', usd: 0, cap, mock: true };
  }
  const status = () => Object.values(ADAPTERS).map((a) => ({ id: a.id, label: a.label, live: !!a.live(), caps: Object.keys(a.caps) }));
  return { quote, run, status, candidates: (cap) => candidates(cap).map((a) => a.id), ADAPTERS, pub, hf: HF, keep };
}
