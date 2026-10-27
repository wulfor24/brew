// Sloosh makes and edits every creative in Brew (27 Oct, Param + Sai: "let Sloosh do its job"). Brew's only job is the context:
// the Brand Book's art direction, the card's words and every relevant reference (the product photos, the logo, the brand's own best
// posts), handed to Sloosh in the way its prompt guide asks: each reference named by position with its job, the product with a keep
// line. Sloosh writes the final prompt itself (enhancePrompt on the quote) and picks nothing Brew didn't route (sloosh-map.js).
// Every picture and clip path in Brew lands here: the image guard's model (server.js rawImage), the video maker (media.js), the
// jam's engines and Studio, finals. There is no other maker behind it: when Sloosh can't answer, the call waits and tries again,
// then fails softly (the caller shows its loader or sketch and retries later); it never falls back to a weaker model.
// Credits: one shared workspace, recorded per brand and path (record → budget.js 'credits'), never capped while Param's account is
// unlimited. Under AI_MOCK nothing is called: the first reference comes back as the "picture" (tests and local runs, never live).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pick as pickRoute } from './sloosh-map.js';
import { refLines } from './sloosh-prompt.js';
import { creativeBlock, refsFor, loadView } from './jam2/brandbook.js';
import { outputsOf, linkOf, refOf, creditsOf, idOf } from './finals.js';

const sha = (x) => crypto.createHash('sha1').update(x).digest('hex').slice(0, 16);
const extOf = (b) => (b[0] === 0x89 ? 'png' : b[0] === 0xff ? 'jpg' : b.slice(4, 8).toString() === 'ftyp' ? 'mp4' : b.slice(0, 4).toString() === 'RIFF' ? 'webp' : 'png');
const isFile = (f) => { try { return !!f && path.isAbsolute(String(f)) && fs.statSync(f).isFile(); } catch { return false; } };
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/* a failure worth trying again a little later (Sloosh busy, a dropped connection) vs one that won't change (a refused prompt) */
/* real_person_reference: a cast photo Sloosh hasn't verified yet ("retry after a minute"), so it is waited on, never dropped */
const personWait = (e) => /real_person_reference/i.test(String(e?.message || '') + String(e?.final?.owner?.errorCode || ''));
const transient = (e) => personWait(e) || e?.timeout || e?.pollError || e?.status >= 500 || /timed? ?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|busy|overload|rate|429|503|try again/i.test(String(e?.message || ''));

export function createSlooshMake({ sloosh, finals, packs, saveGen, genFlush = async () => {}, publicUrl = process.env.PUBLIC_URL || '', fetchImpl = fetch,
  record = () => {}, onRefuse = () => {}, toPng = null /* (buf) → PNG buffer (img-norm normalizeBuf): an SVG or HEIC Sloosh won't take */, mock = () => process.env.AI_MOCK === '1', viewOf = (slug) => loadView(packs, slug, { scope: 'member' }), tries = 3, backoffMs = 20e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console } = {}) {
  const base = String(publicUrl || '').replace(/\/$/, '');

  /* any reference (a buffer, a file on this instance, a gen/ or brand path, a store URL) → a public https link Sloosh can import */
  async function linkFor(x) {
    if (!x) return null;
    if (!Buffer.isBuffer(x) && isFile(x)) x = fs.readFileSync(x);
    if (Buffer.isBuffer(x)) { const name = `ref-${sha(x)}.${extOf(x)}`; saveGen(name, x); await genFlush([name]); return `${base}/genraw/${name}`; }
    const s = String(x); if (/^https?:\/\//.test(s)) return s;
    /* a generated file is handed over as its own bytes (/genraw/), never the lighter copy the page gets */
    return /^\/?gen\/[^?]+$/.test(s) ? `${base}/genraw/${s.replace(/^\/?gen\//, '')}` : `${base}/${s.replace(/^\//, '')}`;
  }

  /* the brand's art direction and its own references, from the Brand Book (member view: generation only, never shown or shared) */
  const memo = new Map();
  async function brand(slug, kind = '') {
    if (!slug || (!packs && !viewOf)) return { block: '', refs: [] };
    const k = `${slug}|${kind}`, hit = memo.get(k); if (hit && Date.now() - hit.at < 5 * 60e3) return hit.v;
    let v = null; try { v = await viewOf(slug); } catch (e) { log.warn?.('[sloosh-make] brand book', slug, e.message); }
    const refs = [];
    if (v?.kit?.logo) refs.push({ src: v.kit.logo, job: 'logo', label: `the ${v.name || 'brand'} logo`, keep: 'only where the product or the layout would really carry it' });
    for (const r of refsFor(v || {}, kind, 12)) refs.push({ src: r.src, job: 'style', label: `one of the brand's own ${r.label || 'posts'}`, keep: 'match its light, colour and feel, never copy its subject or words' });
    const out = { block: v ? creativeBlock(v, kind) : '', refs }; memo.set(k, { at: Date.now(), v: out }); return out;
  }

  /* all relevant references, product first, each once, up to what the model takes */
  const gather = (lists, max) => { const out = [], seen = new Set();
    for (const r of lists.flat()) { if (!r?.src) continue; const id = Buffer.isBuffer(r.src) ? sha(r.src) : String(r.src); if (seen.has(id)) continue; seen.add(id); out.push(r); if (out.length >= max) break; }
    return out; };

  /* one Sloosh generation, start to bytes: import the references, quote (Sloosh enhances the prompt), generate with a key, wait, fetch */
  async function run({ slug, mode, prompt: prompt0, route, refs = [], frame = null, endFrame = null, path: where = 'image' }) {
    const vid = mode !== 'image_gen'; let prompt = prompt0;
    if (mock()) { const first = frame || refs[0]?.src; const buf = Buffer.isBuffer(first) ? first : isFile(first) ? fs.readFileSync(first) : Buffer.from('mock');
      return Object.assign(Buffer.from(buf), { provider: 'sloosh', mock: true, model: route.model, ask: { mode, prompt, route, refs: refs.map((r) => ({ job: r.job, label: r.label })), frame: !!frame } }); }
    /* no brand: imported straight, no per-brand cache */
    const importOf = (url, label) => (slug ? finals.assetFor(slug, { url, label }) : sloosh.importAsset(url, label).then((x) => ({ ...refOf(x), url: linkOf(x) || url, type: /video/.test(String(x?.asset?.assetType || '')) ? 'video' : 'image' })));
    const asset0 = async (src, role, label) => { const a = await importOf(await linkFor(src), label); return { kind: a.kind, id: a.id, url: a.url, type: a.type || (vid && role === 'reference' && /\.mp4/.test(a.url) ? 'video' : 'image'), role }; };
    /* a reference Sloosh won't take as it is (an SVG logo, a HEIC photo: asset_media_unsupported) is turned into a PNG first */
    const asset = async (src, role, label) => { try { return await asset0(src, role, label); }
      catch (e) { if (!toPng || !/unsupported|media|image or video/i.test(String(e.message))) throw e;
        const raw = Buffer.isBuffer(src) ? src : isFile(src) ? fs.readFileSync(src) : await fetchImpl(/^https?:/.test(String(src)) ? src : `${base}/${String(src).replace(/^\//, '')}`, { signal: AbortSignal.timeout(30e3) }).then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null));
        if (!raw) throw e; return asset0(await toPng(raw), role, label); } };
    const uploaded = []; let skipped = 0; const kept = [];
    try {
    if (frame) uploaded.push(await asset(frame, 'start_frame', 'opening frame'));
    if (endFrame) uploaded.push(await asset(endFrame, 'end_frame', 'closing frame'));
    /* the product photo must go in (no picture without it); any other reference that still won't import is left out, never the whole picture */
    if (!(vid && frame && route.framesAlone)) for (const r of refs) { try { uploaded.push(await asset(r.src, 'reference', r.label)); kept.push(r); }
      catch (e) { if (r.job === 'product' || transient(e)) throw e; skipped++; log.warn?.(`[sloosh-make] reference left out (${r.label || r.job}): ${String(e.message).slice(0, 140)}`); } }
    } catch (e) { try { onRefuse(e, { slug, where }); } catch {} throw Object.assign(new Error(`Sloosh couldn't take the photos for this just now (${String(e.message).slice(0, 200)}). We'll try again.`), { soft: true, sloosh: true, cause: e }); }
    /* the prompt names references by position: when one was left out, the lines are renumbered to what went in */
    if (skipped) prompt = String(prompt).replace(/\n\n(?:Image \d+ [^\n]*)$/, '') + '\n\n' + refLines(kept.map((r, i) => ({ ...r, n: i + 1 })));
    const ask = { mode, prompt: one(prompt).slice(0, 30000), model: route.model, references: uploaded.slice(0, 20), ratio: route.ratio, resolution: route.resolution, seconds: vid ? route.seconds : undefined, sound: vid ? route.sound : undefined, count: 1, enhance: true };
    const key = `brew-${sha(JSON.stringify([slug, ask.mode, ask.prompt, ask.model, ask.ratio, ask.resolution, ask.seconds, uploaded.map((u) => u.id)]))}`;
    let last, ended = 0;
    for (let i = 0; i < tries; i++) {
      try {
        const q = await sloosh.quoteGeneration(ask); const qid = idOf(q); if (!qid) throw new Error(`Sloosh gave no quote (${Object.keys(q || {}).join(', ')})`);
        /* the same key retries the same start (a dropped call is never paid twice); a run that ended failed needs a new one */
        const op = await sloosh.generate({ quote: qid, runKey: ended ? `${key}-${ended}` : key, confirmed: true }); const gid = idOf(op); if (!gid) throw new Error('Sloosh started nothing');
        const done = await sloosh.wait(async () => { const x = await sloosh.getGeneration(gid); return x?.reconciliationRequired || /ambiguous/i.test(x?.state || '') ? (await sloosh.reconcileGeneration(gid).catch(() => null)) || x : x; },
          { every: vid ? 10e3 : 4e3, maxMs: vid ? 25 * 60e3 : 8 * 60e3 });
        const out = outputsOf(done)[0]; let link = linkOf(out); if (!link && refOf(out)) link = linkOf(await sloosh.getAsset(refOf(out)));
        if (!link) throw new Error('Sloosh finished with nothing to show');
        const r = await fetchImpl(link, { signal: AbortSignal.timeout(180e3) }); if (!r.ok) throw Object.assign(new Error(`the picture could not be fetched (${r.status})`), { status: r.status });
        const buf = Buffer.from(await r.arrayBuffer()), credits = creditsOf(done) || creditsOf(q);
        try { record(slug, credits, where); } catch {}
        return Object.assign(buf, { provider: 'sloosh', model: route.model, credits, generationId: refOf(out)?.id || null, link });
      } catch (e) { last = e; if (e?.terminal) ended++; if (!transient(e) || i === tries - 1) break; log.warn?.(`[sloosh-make] ${where} for ${slug}: ${String(e.message).slice(0, 160)}; trying again`); await sleep(personWait(e) ? Math.max(65e3, backoffMs) : backoffMs * (i + 1)); }
    }
    try { onRefuse(last, { slug, where }); } catch {} /* staff hear it (an upload agreement to accept, a limit, a refused model): the ops alert */
    throw Object.assign(new Error(`Sloosh couldn't make this just now (${String(last?.message || last).slice(0, 200)}). We'll try again.`), { soft: true, sloosh: true, cause: last });
  }
  const specs = (mode) => (mock() || !sloosh?.modelSpecs ? Promise.resolve(null) : sloosh.modelSpecs(mode).catch(() => null));

  /**
   * a picture: the image guard's model and every direct caller.
   * o: { slug, prompt, srcFile (the product photo), refFiles, refs: [{ src, job, label, keep }], productName, ratio, job ('image' | 'type' |
   *      'concept' | 'edit'), tier ('draft' | 'final'), kind (the deliverable, for the Brand Book's playbook), words (set in the picture) }
   */
  /* a pack or a combo (Pack of 3, a Kit, Shampoo + Serum): every item in it is shown, the same count, each as photographed; on Nano
     Banana Pro, which holds counts and labels best. A single bottle for a "Pack of 3" was the commonest product-check failure (27 Oct) */
  const PACK = /\bpack of (\d+)|\b(\d+)\s*(?:x|pack|pcs|pieces)\b|\bcombo\b|\bkit\b|\bduo\b|\btrio\b|\bbundle\b|\bset of (\d+)|\s\+\s/i;
  const packLine = (name) => { const m = PACK.exec(String(name || '')); if (!m) return ''; const n = +(m[1] || m[2] || m[3] || 0);
    return `Image 1 shows the whole ${/combo|\+|kit|bundle/i.test(name) ? 'combo' : 'pack'}${n ? ` of ${n}` : ''}: show every item in it${n ? `, exactly ${n}` : ''}, each exactly as in image 1, together in the picture; never a single item alone and never a different number.`; };
  async function image(o = {}) {
    const pack = packLine(o.productName || o.named?.t);
    if (pack && (!o.model || /gemini-2|gemini-3-pro-image$|veo/.test(o.model)) && (o.job || 'image') === 'image') o = { ...o, model: 'gemini-3-pro-image-preview' };
    const job = o.job || 'image', route = pickRoute({ specs: await specs('image_gen'), job, ratio: o.ratio || '4:5', tier: o.tier || 'draft', model: o.model && !/gemini-2|gemini-3-pro-image$|veo/.test(o.model) ? o.model : null });
    const b = o.brand === false ? { block: '', refs: [] } : await brand(o.slug, o.kind || '');
    const prod = o.srcFile ? [{ src: o.srcFile, job: 'product', label: o.productName || o.named || 'the product' }] : [];
    const extra = (o.refFiles || []).map((f, i) => ({ src: f, job: o.refJobs?.[i] || 'style', label: o.refLabels?.[i] || null }));
    const refs = gather([prod, o.refs || [], extra, o.noBrandRefs ? [] : b.refs], route.maxRefs || 14);
    const words = [].concat(o.words || []).map(one).filter(Boolean);
    /* a look reference (the brand's own posts) can show other products: only the product photo's product may appear (27 Oct, Arata: a
       sea-salt spray from a post walked into a shampoo ad) */
    const onlyProduct = prod.length && refs.some((r) => r.job === 'style' || r.job === 'logo') ? 'Only the product from image 1 appears; never a product, bottle or pack from any other image (those are for the look only).' : '';
    const prompt = [o.prompt, pack, onlyProduct, words.length ? `Set these words in the picture exactly as written, in the brand's type, where they read first: ${words.map((w) => `"${w}"`).join(' / ')}. No other words, banners, badges, prices or buttons anywhere; only the product's own label.` : '',
      b.block ? `The brand's art direction (follow it):\n${b.block}` : '', refLines(refs.map((r, i) => ({ ...r, n: i + 1 })))].filter(Boolean).join('\n\n');
    return run({ slug: o.slug, mode: 'image_gen', prompt, route, refs, path: o.path || job });
  }

  /** an edit: change one thing, keep the rest (Sloosh's own way: the current picture as image 1 plus a keep line) */
  async function edit(o = {}) {
    const route = pickRoute({ specs: await specs('image_gen'), job: 'edit', ratio: o.ratio || 'auto', tier: o.tier || 'draft' });
    const refs = gather([[{ src: o.src, job: 'other', label: 'the current picture' }], o.srcFile ? [{ src: o.srcFile, job: 'product', label: o.productName || 'the product' }] : [], o.refs || []], route.maxRefs || 14);
    const prompt = [`Edit image 1. Change only this: ${one(o.instruction)}.`, `Keep everything else exactly as in image 1: the product, its label and colours, any people, the layout and the words.`,
      refs.length > 1 ? refLines(refs.slice(1).map((r, i) => ({ ...r, n: i + 2 }))) : ''].filter(Boolean).join(' ');
    return run({ slug: o.slug, mode: 'image_gen', prompt, route, refs, path: o.path || 'edit' });
  }

  /** a clip: o: { slug, frame (opening still), endFrame, prompt (what happens), ratio, seconds, sound, refs, tier, kind } */
  async function video(o = {}) {
    const route = pickRoute({ specs: await specs('video_gen'), job: 'video', ratio: o.ratio || '9:16', tier: o.tier || 'draft', seconds: o.seconds || 8, sound: o.sound });
    const b = o.brand === false ? { block: '', refs: [] } : await brand(o.slug, o.kind || 'reel');
    const refs = gather([o.srcFile ? [{ src: o.srcFile, job: 'product', label: o.productName || 'the product' }] : [], o.refs || [], b.refs.filter((r) => r.job !== 'logo')], route.maxRefs || 9);
    const prompt = [o.prompt, o.srcFile && refs.length > 1 ? 'Only the product from image 1 appears; never a product, bottle or pack from any other image.' : '', o.line ? `Spoken line: "${one(o.line)}".` : '', b.block ? `The brand's look (follow it):\n${b.block}` : '', o.frame ? 'Open exactly on the start frame and keep the product as it is there.' : '',
      route.framesAlone && o.frame ? '' : refLines(refs.map((r, i) => ({ ...r, n: i + 1 })))].filter(Boolean).join('\n\n');
    return run({ slug: o.slug, mode: 'video_gen', prompt, route, refs, frame: o.frame || null, endFrame: o.endFrame || null, path: o.path || 'video' });
  }

  /** a video edit (restyle, change the setting, extend): Sloosh's video_edit / video_extend on the clip itself */
  async function editVideo(o = {}) {
    const mode = o.extend ? 'video_extend' : 'video_edit', route = pickRoute({ specs: await specs(mode), job: 'videoEdit', ratio: o.ratio || 'auto', tier: o.tier || 'draft', seconds: o.seconds });
    const prompt = `${o.extend ? 'Continue this clip' : 'Edit this clip'}: ${one(o.instruction)}. Keep the product, its label and colours, and everything not asked to change.`;
    const refs = gather([[{ src: o.src, job: 'other', label: 'the clip' }], o.refs || []], 1 + (route.maxRefs || 0));
    return run({ slug: o.slug, mode, prompt: refs.length > 1 ? `${prompt} ${refLines(refs.slice(1).map((r, i) => ({ ...r, n: i + 1 })))}` : prompt, route, refs, path: o.path || (o.extend ? 'video-extend' : 'video-edit') });
  }

  /** one of Sloosh's public Spaces, run as it is (its form filled from the card and the brand): finals' Space flow, quoted and run at once */
  async function space(o = {}) {
    if (mock()) return [Object.assign(Buffer.from('mock-space'), { provider: 'sloosh', mock: true, space: o.id })];
    const q = await finals.quote(o.slug, { space: { id: o.id, name: o.name || null, ctx: o.ctx || {}, inputs: o.inputs || {} }, refs: o.refs || [], kind: o.kind || 'image', brandName: o.brandName });
    if (q?.error) throw Object.assign(new Error(q.error), { soft: true, sloosh: true, missing: q.missing || null });
    const rec = await finals.run(o.slug, { space: { id: o.id, inputs: q.inputs }, kind: o.kind || 'image', refs: o.refs || [] }, { quote: q, target: o.target || null });
    try { record(o.slug, rec.charged ?? q.credits, `space:${o.name || o.id}`); } catch {}
    return rec;
  }

  return { image, edit, video, editVideo, space, brand, linkFor, run };
}
