// First drafts on the cards, before anyone opens a jam, in the format each card asks for. For each brand someone opened
// in the last 3 days, a background job drafts every card that names what to make (card.make, set by cards-gen or
// back-filled at pack load), plus the top few other cards, in feed order, with the jam's own draft pipeline (drafts.js:
// the planning prompt, schema, photo prompt and the shared media makers) and brand memory. The format is the card's:
//   video ad, reel → a still of the real product, animated by Veo 3.1 Fast on Vertex (6 s, about $0.90; DAILY_VIDEO_CAP still holds)
//   carousel ad, Instagram carousel → a photo per slide with the words set by Chromium; Instagram stories → the same at 9:16
//   collection ad → a hero picture over a grid of real catalog photos; catalog ad → the catalog grid only (no generation)
//   single image ad, Instagram post → one picture of the real product in a new scene
//   email, WhatsApp message, page section → the words, shown as an inbox, a chat or a phone page (Chromium, real photo)
// Drafts are cached per card in the pack (drafts/cards.json), keyed by card id + move number + format, so a card rewritten
// in the same format keeps its draft and one whose format changed is drafted again. The feed card shows the draft
// (feed-service pub → app.js postCard) and the jam opens with it (seedDrafts).
// Caps: DRAFTS_DAY_CAP_USD (default $4 per brand per day), booked at real cost (image-guard retries, treg charges).
// Kill switch: DRAFTS_BG_OFF=1. Nothing runs under AI_MOCK or on local servers (RESEARCH_OFF / LIVE_OFF) unless DRAFTS_BG=1.
// A picture never fails into a broken card: the image guard tries the model again (and the other Gemini model), and if no
// picture comes back the draft shows the real product photo (d.photoOnly) and says so; the new picture is tried again on
// later ticks with backoff (d.imgRetry: 30 min, 2 h, 8 h, then daily, 6 tries). A clip that fails (treg 402, a timeout)
// keeps its still and is tried again the same way (d.clipRetry). Saved drafts heal: a draft whose picture is gone from the
// bucket is made again, and a failed draft is retried with backoff instead of waiting a whole day.
// Every picture a draft names is in the bucket before drafts/cards.json is written (genFlush), so any instance can serve it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchProduct } from './product-match.js';
import { draftPrompt, imagePrompt, DRAFT_SCHEMA, DRAFT_RATIOS, createMakers } from './drafts.js';
import { emailHtml, whatsappHtml, pageHtml, collectionHtml } from './draft-mocks.js';
import { inferMake } from './cards-gen.js';
import { genFlush as genFlush0 } from './gen-store.js';

const H = 3600e3, DAY = 24 * H;
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
const today = (ms) => new Date(ms).toISOString().slice(0, 10);

/* ---------- which cards, and in what form ---------- */
// cards that are not asks for an asset: progress, build status, live account readings
const SKIP = /^(build-|statics-batch$|story-|live-)/;
export const cardKey = (c) => sha(`${c.id}|${c.title || ''}`); /* the old key (by title), kept to read drafts made before keys carried the format */
const isVis = (c) => !!(c?.images?.length || c?.img || c?.video || ['media', 'chat', 'answer', 'variants'].includes(c?.kind));
const eligible = (c) => c?.id && c.title && !SKIP.test(c.id) && !c.liveOnly && !c.demo && !c.mock && c.kind !== 'answer' && !(c.origin === 'listen' && c.heard?.kind === 'theme');
// the order the feed opens in for a brand-neutral viewer: fresh cadence moves and cards that ask for a thing first,
// then the feed's own mix (two visual cards for every text card), as feed-service feed() does for a new workspace
export function rankCards(posts = []) {
  const ok = (posts || []).filter(eligible);
  const ageMin = (c) => { const m = /^(\d+)\s*(min|hr|day)/.exec(String(c.time || '')); return m ? +m[1] * (m[2] === 'min' ? 1 : m[2] === 'hr' ? 60 : 1440) : 600; };
  const score = (c) => (c.origin === 'cadence' ? 2 : 0) + (c.make?.format ? (IMAGE_FORMATS.test(c.make.format) ? 3 : 2) : 0) + (c.type === 'idea' ? 2 : c.type === 'decision' ? 1 : 0) + (c.stream === 'ideas' ? 1.5 : 0) + (/^Move \d+/.test(c.src || '') ? 1 : 0) + Math.max(0, 3 - ageMin(c) / 600) + (c.boostFor?.founder || 0) / 3;
  const sorted = ok.map((c, i) => ({ c, s: score(c), i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
  const V = sorted.filter(isVis), N = sorted.filter((c) => !isVis(c)), mixed = [];
  for (let i = 0; V.length || N.length; i++) mixed.push(((i % 3 === 2 && N.length) || !V.length ? N : V).shift());
  return mixed;
}
export function pickTopCards(posts = [], { n = 6, have = {}, now = Date.now() } = {}) { return rankCards(posts).slice(0, n).filter((c) => needsDraft(c, have, now)); }
const IMAGE_FORMATS = /image ad|carousel|collection|catalog|instagram|reel|video|post|stories/i;
const TEXT_FORMATS = /email|whatsapp|page section|message/i;
// the cheapest form for a card that names no format: an image when it shows one, otherwise text
export function draftFormat(c = {}) {
  const f = c.make?.format || '';
  if (TEXT_FORMATS.test(f)) return 'text';
  if (IMAGE_FORMATS.test(f)) return 'image';
  if (c.post) return c.post.media?.kind && c.post.media.kind !== 'none' ? 'image' : 'text';
  if (['report', 'decision'].includes(c.type) && !c.make) return 'text';
  if (c.kind === 'media' && c.images?.length) return 'image';
  return 'text';
}
/* the card's format → the draft it gets (format-true); a card with no format gets the cheapest fitting form */
export const FORMAT_KIND = { 'video ad': 'video', reel: 'video', 'carousel ad': 'carousel', 'instagram carousel': 'carousel', 'instagram stories': 'stories', 'collection ad': 'collection', 'catalog ad': 'catalog', 'single image ad': 'image', 'instagram post': 'image', email: 'email', 'whatsapp message': 'whatsapp', 'page section': 'page' };
export const draftKind = (c = {}) => FORMAT_KIND[(c.make?.format ? c.make : inferMake(c))?.format] || draftFormat(c); /* a card copied before its pack back-filled "make" still keys the same */
/* what the planner is asked for, per kind, and how the words are laid out so the mock can read them */
const PLAN_AS = { video: 'video', carousel: 'carousel', stories: 'carousel', collection: 'image', catalog: 'text', image: 'image', email: 'text', whatsapp: 'text', page: 'text', text: 'text' };
const ASK = { email: 'Write it as one email: a first line "Subject: …", then "Preview: …", then the email body, then a last line "Button: …".', whatsapp: 'Write it as one WhatsApp message from the brand, under 90 words, then a last line "Button: …".',
  page: 'Write it as one page section: a first line "Headline: …", then the words of the section, then a last line "Button: …".', stories: 'Make it as Instagram Stories: 3 to 5 frames, ratio 9:16.', catalog: 'Write the catalog ad: the primary text and the headline over the products.',
  collection: 'Write the collection ad: the headline over the hero picture and the primary text; the visual is the hero picture above the products.' };
/* drafts are keyed by card id + move number + format: a rewrite in the same format keeps the draft */
const moveOf = (c) => { const m = /^Move\s+(\d+)/i.exec(c?.src || '') || /^m(\d+)-/.exec(c?.id || ''); return m ? +m[1] : ''; };
export const draftKey = (c = {}) => `${c.id}|${moveOf(c)}|${draftKind(c)}`;
// the draft that belongs to this card as it is now, or null
/* a rewritten move reuses its card ids (m10-1): a draft made for the card that held the id before is not this card's, unless
   the title is the same idea (most of its telling words carry over) */
const titleWords = (t) => new Set(String(t || '').toLowerCase().match(/[a-z0-9₹%]{4,}/g) || []);
export const sameCard = (d, c) => { if (!d?.cardTitle || d.cardTitle === c?.title) return true;
  const a = titleWords(d.cardTitle), b = titleWords(c?.title); if (!a.size || !b.size) return true;
  let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.min(a.size, b.size) >= 0.5; };
export function draftFor(c, all = {}) {
  const d = c?.id ? all?.[c.id] : null; if (!d || d.failedAt) return null;
  if (d.k === 2) return d.key === draftKey(c) && sameCard(d, c) ? d : null;
  return d.cardTitle && d.cardTitle === c.title ? d : null; /* a draft made before keys carried the format: only while the title is unchanged */
}
/* the wait before try n+1 after n failures: 30 min, 2 h, 8 h, then a day */
export const retryWait = (n) => Math.min(DAY, 30 * 60e3 * 4 ** Math.max(0, (n || 1) - 1));
export const MAX_RETRIES = 6;
// a card needs a (new) draft: none yet, or its draft is for another move or format. A failure is retried with backoff
export function needsDraft(c, all = {}, now = Date.now()) {
  const d = all?.[c.id]; if (!d) return true;
  if (d.failedAt) return !(d.key === draftKey(c) && now - d.failedAt < retryWait(d.fails || 1));
  return !(d.k === 2 && d.key === draftKey(c) && sameCard(d, c));
}
// what the card says, as the jam brief would open: the card, its move, its post
export function cardBriefText(c = {}, { moveDocs = {} } = {}) {
  const n = +((/^Move\s+(\d+)/i.exec(c.src || '') || [])[1] ?? NaN), m = Number.isFinite(n) ? moveDocs[n] : null;
  const plan = m ? (m.sections || []).filter((s) => ['plan', 'examples'].includes(s.kind)).flatMap((s) => s.blocks.map((b) => b.t === 'example' ? `${b.title}: ${b.body}` : b.text || (b.items || []).join('; '))).filter(Boolean).join('\n') : '';
  return [`# ${c.title}`, c.sub, ...(c.rows || []).map((r) => `- ${r[0]}: ${r[1]}`), c.detail?.why?.length ? `Why: ${c.detail.why.join(' ')}` : '', c.detail?.how?.length ? `How: ${c.detail.how.join(' ')}` : '',
    c.make ? `Make: ${c.make.format}${c.make.pieces ? ` (${c.make.pieces})` : ''}` : '', c.post?.copy ? `The post so far:\n${c.post.copy}` : '', c.post?.where?.[0] ? `Where: ${c.post.where[0].name}${c.post.where[0].rule ? ` (rule: ${c.post.where[0].rule})` : ''}` : '',
    m ? `From Move ${n}: ${m.title}. ${m.gives || ''}\n${cut(plan, 1800)}` : ''].filter(Boolean).join('\n');
}
/* the feed card's view of its draft: only a draft with something to see (a picture, slides, a mock or a video).
   fallback: the real product photo the picture was made from, shown by the page if a picture can't load (never a broken image) */
export function draftView(d, c = null) {
  if (!d) return null; const images = d.slides?.length ? d.slides.map((x) => x.image).filter(Boolean) : d.render ? [d.render] : d.image ? [d.image] : [];
  if (!images.length && !d.video) return null;
  const fallback = [d.photo, ...(c?.images || []), c?.img].find((x) => x && typeof x === 'string' && !images.includes(x)) || null;
  return { as: d.as, kind: d.kind || d.as, images, video: d.video || null, poster: d.video ? d.image || images[0] || null : null, ratio: d.ratio || null, title: d.title || '', copy: cut(String(d.copy || '').replace(/[#*_>`]/g, ''), 240), ...(fallback ? { fallback } : {}), ...(d.imgRetry ? { remaking: true } : {}) };
}

/* ---------- gating and cost ---------- */
export const DRAFTS_DEFAULTS = { tickMs: 30 * 60e3, firstMs: 4 * 60e3, openDays: 3, dayCapUsd: 4, topN: 6, perTick: 2, perRun: 8, textUsd: 0.04, imageUsd: 0.17, videoUsd: 0.9, voiceUsd: 0.01, slides: 5 };
export function draftsConfig(env = process.env) {
  const n = (k, d) => (env[k] != null && env[k] !== '' && Number.isFinite(+env[k]) ? +env[k] : d);
  return { ...DRAFTS_DEFAULTS, dayCapUsd: n('DRAFTS_DAY_CAP_USD', DRAFTS_DEFAULTS.dayCapUsd), topN: n('DRAFTS_TOP_N', DRAFTS_DEFAULTS.topN), perRun: n('DRAFTS_PER_RUN', DRAFTS_DEFAULTS.perRun), imageUsd: n('DRAFTS_IMAGE_USD', DRAFTS_DEFAULTS.imageUsd), videoUsd: n('DRAFTS_VIDEO_USD', DRAFTS_DEFAULTS.videoUsd),
    killed: env.DRAFTS_BG_OFF === '1', mock: env.AI_MOCK === '1', local: env.DRAFTS_BG !== '1' && (!!env.RESEARCH_OFF || !!env.LIVE_OFF) };
}
/* what one draft of each kind costs before it is made (the words, then the pictures and the clip); booked after at real cost */
export const estUsd = (kind, cfg = DRAFTS_DEFAULTS) => cfg.textUsd + ({ image: cfg.imageUsd, collection: cfg.imageUsd, carousel: cfg.imageUsd * cfg.slides, stories: cfg.imageUsd * cfg.slides, video: cfg.imageUsd + cfg.videoUsd + cfg.voiceUsd }[kind] || 0);
/* an image's real cost: the image guard regenerates once on a wrong product, so that picture cost two */
export const imageCost = (buf, cfg = DRAFTS_DEFAULTS) => cfg.imageUsd * (buf?.guard?.retried ? 2 : 1);
export const spentToday = (st, now) => (st?.spend?.day === today(now) ? st.spend.usd || 0 : 0);
export function draftsDue(st = {}, cfg, { now = Date.now(), aiLive = true, lastOpen = 0, manual = false } = {}) {
  const left = +(cfg.dayCapUsd - spentToday(st, now)).toFixed(4);
  if (cfg.killed) return { ok: false, left, why: 'DRAFTS_BG_OFF' };
  if (cfg.mock || !aiLive) return { ok: false, left, why: 'AI is on mock: nothing runs, nothing is spent' };
  if (!manual && cfg.local) return { ok: false, left, why: 'background work is off here (DRAFTS_BG / RESEARCH_OFF / LIVE_OFF)' };
  if (!manual && !(lastOpen && now - lastOpen <= cfg.openDays * DAY)) return { ok: false, left, why: `nobody opened it in the last ${cfg.openDays} days` };
  if (left < cfg.textUsd) return { ok: false, left, why: `daily cap $${cfg.dayCapUsd} reached` };
  return { ok: true, left, why: '' };
}

/* ---------- the job ---------- */
// deps: ai (ai.js, metered), geminiImage (image-guard), saveGen, genFile, photoAsync(rel) → local file, memory (brand-memory),
// loadPack(slug) → brand pack, treg (video and voice), launchBrowser (Chromium for slides and mocks), zipBuffer, spend(kind) → the
// server's daily counters (DAILY_VIDEO_CAP, DAILY_VOICE_CAP); makers: the media makers (drafts.js createMakers), replaceable in tests
export function createDraftsBg({ packs, ai, geminiImage = null, saveGen = null, genFile = null, genFlush = genFlush0, photoAsync = null, memory = null, loadPack, treg = null, launchBrowser = null, zipBuffer = null, spend = () => true, makers = null, lastOpenOf = async () => 0, onDrafts = async () => {}, log = console, env = process.env, now = () => Date.now() } = {}) {
  const cfg = draftsConfig(env), F = 'drafts/cards.json', S = 'drafts/state.json', busy = new Set(), opens = new Map();
  const M = makers || createMakers({ geminiImage, treg, launchBrowser, zipBuffer, save: saveGen || (() => {}), file: genFile || (async () => null), log });
  /* treg charges booked to this job, per brand (tag draftsbg-<slug>, so the brand's spend ledger has them too) */
  const tregUsd = new Map(); treg?.onCharge?.((tag, usd) => { if (String(tag).startsWith('draftsbg-')) tregUsd.set(tag, (tregUsd.get(tag) || 0) + (usd || 0)); });
  const stateOf = async (slug) => (await packs.getJSON(slug, S, null).catch(() => null)) || {};
  const cacheOf = async (slug) => (await packs.getJSON(slug, F, null).catch(() => null)) || {};
  const opened = (slug) => { if (slug) opens.set(slug, now()); };
  // the real product photo: a pack asset, a public file, or a store image fetched once into tmp
  const photo = async (c, named = null) => {
    for (const rel of [named?.img, ...(c.images || []), c.img, ...(c.post?.media?.product?.images || [])].filter(Boolean)) {
      try {
        if (/^https?:/.test(rel)) { const f = path.join(os.tmpdir(), 'brew-ph-' + sha(rel) + '.jpg'); if (!fs.existsSync(f)) { const r = await fetch(rel, { signal: AbortSignal.timeout(20e3) }); if (!r.ok) continue; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return f; }
        const f = photoAsync ? await photoAsync(rel) : null; if (f && fs.existsSync(f)) return f;
      } catch {}
    }
    return null;
  };
  const dataUri = (f) => { try { const b = fs.readFileSync(f); return `data:${b[0] === 0x89 ? 'image/png' : b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/jpeg'};base64,${b.toString('base64')}`; } catch { return null; } };
  const genUri = async (rel) => { const f = rel && genFile ? await genFile(String(rel).replace(/^gen\//, '')) : null; return f ? dataUri(f) : null; };
  /* up to four real catalog products for a grid: the one the words name first, then others in stock, each with its photo */
  const gridOf = async (p, named) => { const out = [], seen = new Set();
    for (const x of [named, ...(p.catalog || []).filter((y) => !y.out), ...(p.catalog || [])].filter(Boolean)) { if (out.length >= 4) break; if (seen.has(x.img)) continue; seen.add(x.img); const f = await photo({}, x); const u = f && dataUri(f); if (u) out.push({ t: x.t, price: x.price || '', img: u }); }
    return out; };
  const render = async (html, ratio, key) => (launchBrowser ? M.render(html, ratio, key) : null);
  /* the address of the real photo a draft stands on (for the page's fallback), in the order photo() tries them */
  const photoRelOf = (c, named, p) => [named?.img, ...(c.images || []), c.img, ...(c.post?.media?.product?.images || []), p?.catalog?.[0]?.img].find((x) => x && typeof x === 'string' && !/^\/?gen\//.test(x)) || null;
  /* one picture of the real product: the guard tries the model again and, failing that, hands back the real photo (genFailed) */
  const makeStill = async (slug, c, { src, ip, ratio, text, catalog, brand, retry = false }) => {
    const buf = await geminiImage({ srcFile: src, prompt: ip, ratio, text, catalog, brand, fallback: !retry });
    const failed = !!buf?.guard?.genFailed, name = sha(`${slug}|${c.id}|${ip}|${ratio}${failed ? '|photo' : ''}`) + (failed ? '.jpg' : '.png');
    saveGen(name, buf); return { rel: 'gen/' + name, failed, retried: !!buf?.guard?.retried, error: buf?.guard?.error || null, buf };
  };
  async function makeOne(slug, p, c, kind, box) {
    const as = PLAN_AS[kind] || 'text', tag = `draftsbg-${slug}`;
    let mem = ''; try { mem = memory ? await memory.promptBlock(slug, { query: `${c.title} ${c.sub || ''}`, agent: 'creative', name: p.name }) : ''; } catch {}
    const card = `${p.factBrief || ''}\n\nCard (by the ${c.agent} agent, from ${c.src || 'the move documents'}):\nTitle: ${c.title}\nBody: ${c.sub || ''}\n${(c.rows || []).map((r) => `- ${r[0]}: ${r[1]}`).join('\n')}\nThe person reading is the founder.`;
    const prompt = draftPrompt({ card, role: c.agent === 'brew' ? 'creative' : c.agent || 'creative', brief: cardBriefText(c, { moveDocs: p.moveDocs }), mem, as, ask: ASK[kind] || '' });
    const r = await ai.call({ model: 'sonnet', prompt, schema: DRAFT_SCHEMA, max: 3000, tag: 'draft-bg' }); box.usd += r.usd || 0;
    const j = r.json || {}; j.as = as;
    const ratio = kind === 'stories' ? '9:16' : DRAFT_RATIOS.includes(j.ratio) && j.ratio !== '16:9' ? j.ratio : c.make?.format === 'reel' ? '9:16' : '4:5';
    const d = { k: 2, cardId: c.id, key: draftKey(c), kind, format: c.make?.format || null, cardTitle: c.title, as: kind === 'stories' ? 'carousel' : ['email', 'whatsapp', 'page', 'collection', 'catalog'].includes(kind) ? kind : as, title: cut(j.title || 'First draft', 70), copy: String(j.copy || '').trim(), note: cut(j.note || '', 160), ratio, at: now(), by: 'Brew', bg: true };
    const fits = (usd) => box.usd + usd <= box.cap + 1e-9, words = (x) => { d.as = 'text'; d.note = cut(`${d.note} ${x}`, 200); };
    const brand = { name: p.seed?.brand?.name || p.name || '', host: p.seed?.brand?.host || '', colors: p.seed?.brand?.colors || [] };
    /* the product the copy names, not the card's default shot (a Hukum ad must show the Hukum shoe) */
    const named = matchProduct(`${j.title || ''}. ${j.copy || ''}. ${(j.slides || []).map((x) => x?.onSlide).join('. ')}. ${c.title || ''}. ${c.sub || ''}`, p.catalog, { brand: brand.name });
    const src = await photo(c, named) || (p.catalog?.[0]?.img ? await photo({}, p.catalog[0]) : null); /* nothing named and no card photo: the brand's lead product, never an invented one */
    if (named) d.product = named.t; else if (p.catalog?.[0] && !(c.images?.length || c.img)) d.product = p.catalog[0].t;
    d.photo = src ? photoRelOf(c, named, p) : null;
    const still = async () => { /* one picture of the real product in a new scene; null when there is no photo or no budget */
      if (!geminiImage || !saveGen) return null; if (!src) { words('No product photo to stage, so this one is words only.'); return null; }
      if (!fits(cfg.imageUsd)) { words("The picture waits for tomorrow's budget."); return null; }
      const ip = imagePrompt(j, true), text = `${j.title || ''}. ${j.copy || ''}. ${c.title || ''}`;
      d.ip = ip; d.imgText = cut(text, 600); /* kept so a failed picture can be made again later without asking the AI for new words */
      try { const r = await makeStill(slug, c, { src, ip, ratio, text, catalog: p.catalog || null, brand: p.seed?.brand?.name || '' });
        if (r.failed) { d.photoOnly = true; d.imgRetry = { n: 1, next: now() + retryWait(1), err: cut(r.error || '', 160) }; d.note = cut(`${d.note} For now this is the real product photo; the new picture is being made again.`, 220); log.warn?.('[drafts-bg] image fell back to the real photo', slug, c.id, r.error || ''); }
        else { box.usd += imageCost(r.buf, cfg); if (r.retried) d.retried = true; }
        d.fromPhoto = true; return r.rel; }
      catch (e) { d.err = 'The words are here; the picture did not come through.'; d.imgRetry = { n: 1, next: now() + retryWait(1), err: cut(e.message, 160) }; log.warn?.('[drafts-bg] image', slug, c.id, e.message); return null; }
    };
    if (kind === 'image' || kind === 'collection' || kind === 'video') {
      const img = await still(); if (!img) { d.as = 'text'; d.usd = +(box.usd - box.start).toFixed(4); return d; }
      d.image = img; d.as = kind === 'video' ? 'image' : d.as;
      if (kind === 'collection' && launchBrowser) { const products = await gridOf(p, named); if (products.length >= 2) d.render = await render(collectionHtml({ brand, title: j.title || c.title, hero: await genUri(img), products }), '4:5', `${d.key}|${img}`).catch((e) => { log.warn?.('[drafts-bg] grid', slug, c.id, e.message); return null; }); }
      if (kind === 'video') { d.motion = cut(j.motion || '', 220); d.script = cut(j.script || '', 160); d.wants = 'video'; if (!d.photoOnly) await animate(slug, d, box); } /* a clip waits for the real still, not the stand-in photo */
    } else if (kind === 'carousel' || kind === 'stories') {
      const slides = (j.slides || []).filter((x) => x?.onSlide).slice(0, 8);
      if (slides.length < 2 || !launchBrowser || !src) { const img = await still(); if (img) { d.image = img; d.as = 'image'; d.note = cut(`${d.note} One picture for now; the slides come with another take.`, 200); } }
      else if (!fits(cfg.imageUsd * 2)) words("The slides wait for tomorrow's budget.");
      else { d.copy = d.copy || slides.map((x, i) => `${i + 1}. ${x.onSlide}`).join('\n'); let made = 0;
        try { const rr = await M.carousel({ slides, src, ratio, title: j.title, cardTitle: c.title, id: `${slug}|${d.key}`, canSpend: () => { if (!fits(cfg.imageUsd * (made + 1))) return false; made++; return true; } });
          box.usd += cfg.imageUsd * (rr.made + rr.retried); Object.assign(d, { slides: rr.slides, image: rr.image }); if (rr.zip) d.zip = rr.zip; if (rr.err) d.err = rr.err; }
        catch (e) { box.usd += cfg.imageUsd * made; words('The slides did not come through; the words are here.'); log.warn?.('[drafts-bg] slides', slug, c.id, e.message); } }
    } else if (['email', 'whatsapp', 'page', 'catalog'].includes(kind) && launchBrowser) { /* free: the words laid out where they will live, with a real product photo */
      const ph = src ? dataUri(src) : null, html = kind === 'email' ? emailHtml({ brand, title: d.title, copy: d.copy, photo: ph }) : kind === 'whatsapp' ? whatsappHtml({ brand, title: d.title, copy: d.copy, photo: ph }) : kind === 'page' ? pageHtml({ brand, title: d.title, copy: d.copy, photo: ph }) : null;
      try { d.render = html ? await render(html, '4:5', `${d.key}|${d.copy}`) : await (async () => { const products = await gridOf(p, named); return products.length >= 2 ? render(collectionHtml({ brand, title: j.title || c.title, products, catalog: true }), '4:5', `${d.key}|${d.title}`) : null; })(); }
      catch (e) { log.warn?.('[drafts-bg] mock', slug, c.id, e.message); }
      if (!d.render) d.as = 'text';
    } else if (kind !== 'text') d.as = 'text';
    d.usd = +(box.usd - box.start).toFixed(4);
    return d;
  }
  /* the still becomes a 6-second clip: within the brand's budget and the server's DAILY_VIDEO_CAP, else it waits as a still (wants: video) */
  async function animate(slug, d, box) {
    if (!d.image) return false; /* clips are made on our own Vertex account (vertex-media.js), not treg */
    if (box.usd + cfg.videoUsd > box.cap + 1e-9) { d.note = cut(`${d.note.replace(/ The clip.*$/, '')} The clip waits for tomorrow's budget; here is the first frame.`, 220); return false; }
    if (!spend('video')) { d.note = cut(`${d.note.replace(/ The clip.*$/, '')} The clip waits for today's video limit; here is the first frame.`, 220); return false; }
    const tag = `draftsbg-${slug}`, t0 = tregUsd.get(tag) || 0;
    try { d.video = 'gen/' + await M.video(d.image.slice(4), d.motion);
      if (d.script && spend('voice')) { const au = await M.voice(d.script, '', 'Kore').catch(() => null); const both = au ? await M.mux(d.video.slice(4), au).catch(() => null) : null; if (both) d.video = 'gen/' + both; else if (au) d.audio = 'gen/' + au; }
      d.as = 'video'; delete d.wants; delete d.clipRetry; delete d.err; d.note = d.note.replace(/ The clip.*$/, ''); }
    catch (e) { const n = (d.clipRetry?.n || 0) + 1; d.err = 'The first frame is here; the clip did not come through. It is tried again later.';
      if (n < MAX_RETRIES) d.clipRetry = { n, next: now() + retryWait(n), err: cut(e.message, 160) }; else { delete d.wants; delete d.clipRetry; d.err = 'The first frame is here; the clip did not come through.'; }
      log.warn?.('[drafts-bg] video', slug, d.cardId, e.message); }
    const real = (tregUsd.get(tag) || 0) - t0; box.usd += real > 0 ? real : d.video ? cfg.videoUsd : 0;
    return !!d.video;
  }
  /* saved drafts heal: a picture gone from the bucket is made again (the draft keeps its words); a lost mock or clip is
     dropped back to the picture. Checked once a day per draft; never on a server that can't see the bucket (no genFile) */
  async function healMissing(slug, cache) {
    if (!genFile) return 0; let n = 0;
    for (const d of Object.values(cache)) {
      if (!d || d.k !== 2 || d.failedAt || (d.checkedAt && now() - d.checkedAt < DAY)) continue;
      const has = async (r) => !/^gen\//.test(r || '') || !!(await genFile(String(r).slice(4)).catch(() => null));
      d.checkedAt = now(); n++;
      if (d.render && !(await has(d.render))) delete d.render;
      if (d.video && !(await has(d.video))) { delete d.video; d.wants = 'video'; if (d.as === 'video') d.as = 'image'; }
      if (d.slides?.length) { const ok = []; for (const x of d.slides) if (await has(x.image)) ok.push(x); if (ok.length < d.slides.length) { d.slides = ok; d.image = ok[0]?.image || null; if (!ok.length) { delete d.slides; d.as = 'text'; } } }
      if (d.image && !(await has(d.image))) { log.warn?.('[drafts-bg] picture gone from the bucket, making it again', slug, d.cardId, d.image); if (d.ip) d.imgRetry = { n: 0, next: 0, err: 'the picture was lost' }; else { delete d.image; d.as = 'text'; } }
    }
    return n;
  }
  /* pictures that came back as the real photo (or not at all) are made again when due, with backoff; the card heals on its next load */
  async function remakeStills(slug, p, cache, box, made) {
    let tried = 0; const brand = { name: p.seed?.brand?.name || p.name || '', host: p.seed?.brand?.host || '', colors: p.seed?.brand?.colors || [] };
    for (const c of rankCards(p.seed?.posts || [])) {
      const d = draftFor(c, cache); if (!d?.imgRetry || !d.ip || now() < (d.imgRetry.next || 0)) continue;
      if (made.length >= cfg.perRun || box.cap - box.usd < cfg.imageUsd) break;
      const named = matchProduct(d.imgText || `${d.title}. ${d.copy}`, p.catalog, { brand: brand.name });
      const src = await photo(c, named) || (p.catalog?.[0]?.img ? await photo({}, p.catalog[0]) : null); if (!src) continue;
      const t0 = box.usd; tried++;
      try { const r = await makeStill(slug, c, { src, ip: d.ip, ratio: d.ratio || '4:5', text: d.imgText || '', catalog: p.catalog || null, brand: brand.name, retry: true });
        box.usd += imageCost(r.buf, cfg); d.image = r.rel; d.fromPhoto = true; delete d.imgRetry; delete d.photoOnly; delete d.err; d.note = cut(String(d.note || '').replace(/ ?For now this is the real product photo;.*$/, ''), 220);
        if (d.as === 'text') d.as = d.kind === 'collection' ? 'collection' : 'image';
        if (d.kind === 'video' && !d.video) d.wants = 'video';
        if (d.kind === 'collection' && launchBrowser) { const products = await gridOf(p, named); if (products.length >= 2) d.render = await render(collectionHtml({ brand, title: d.title || c.title, hero: await genUri(d.image), products }), '4:5', `${d.key}|${d.image}`).catch(() => d.render || null); }
        d.usd = +((d.usd || 0) + box.usd - t0).toFixed(4); made.push({ cardId: c.id, as: d.as, kind: d.kind, title: d.title, image: d.render || d.image, video: d.video || null, usd: +(box.usd - t0).toFixed(4), remade: true });
        log.log?.('[drafts-bg] picture made again', slug, c.id); }
      catch (e) { const n = (d.imgRetry.n || 0) + 1; if (n >= MAX_RETRIES) { delete d.imgRetry; d.err = 'The new picture did not come through; this is the real product photo.'; } else d.imgRetry = { n, next: now() + retryWait(n), err: cut(e.message, 160) };
        log.warn?.('[drafts-bg] picture again', slug, c.id, e.message); }
    }
    return tried;
  }
  /* every file a draft names is in the bucket before the drafts file that names them is written */
  const save = async (slug, cache) => { await genFlush().catch(() => {}); await packs.put(slug, F, cache); };
  // make the missing drafts for one brand, best-ranked first → { made: [{cardId, as, kind, title, image}], usd, errors }
  async function runOne(slug, { manual = false, n = cfg.perRun, only = null } = {}) {
    if (busy.has(slug)) return { busy: true };
    busy.add(slug);
    try {
      const st = await stateOf(slug), lastOpen = Math.max(opens.get(slug) || 0, await lastOpenOf(slug).catch(() => 0) || 0);
      const due = draftsDue(st, cfg, { now: now(), aiLive: ai?.live !== false, lastOpen, manual }); if (!due.ok) return { made: [], usd: 0, why: due.why };
      const p = await loadPack(slug); if (!p?.seed?.posts) return { made: [], usd: 0, why: 'no feed yet' };
      const cache = await cacheOf(slug), ranked = rankCards(p.seed.posts), top = new Set(ranked.slice(0, cfg.topN).map((c) => c.id));
      if (await healMissing(slug, cache)) await save(slug, cache).catch(() => {});
      /* every card that names a format, and the top few others, in feed order; then stills that still wait for their clip */
      const todo = (only?.length ? ranked.filter((c) => only.includes(c.id)) : ranked.filter((c) => c.make?.format || top.has(c.id))).filter((c) => needsDraft(c, cache, now()));
      const clips = ranked.filter((c) => { const d = draftFor(c, cache); return d?.wants === 'video' && d.image && !d.video && !d.imgRetry && !d.photoOnly && now() >= (d.clipRetry?.next || 0); });
      const box = { usd: 0, cap: due.left, start: 0 }, made = [], errors = [];
      for (const c of todo) {
        if (made.length >= n || box.cap - box.usd < cfg.textUsd) break;
        const kind = draftKind(c), est = estUsd(kind, cfg);
        if (box.usd + Math.min(est, cfg.textUsd + (['image', 'collection', 'video', 'carousel', 'stories'].includes(kind) ? cfg.imageUsd : 0)) > box.cap) { errors.push({ cardId: c.id, error: 'daily cap' }); continue; } /* a dearer card waits; a cheaper one further down may still fit */
        box.start = box.usd;
        try { const d = await makeOne(slug, p, c, kind, box); cache[c.id] = d; made.push({ cardId: c.id, as: d.as, kind, title: d.title, image: d.render || d.image || null, video: d.video || null, usd: d.usd });
          await save(slug, cache); }
        catch (e) { if (e.mock) { errors.push({ cardId: c.id, error: 'AI is on mock' }); break; } errors.push({ cardId: c.id, error: e.message }); const prev = cache[c.id]; cache[c.id] = { k: 2, cardId: c.id, key: draftKey(c), failedAt: now(), fails: (prev?.failedAt && prev.key === draftKey(c) ? prev.fails || 1 : 0) + 1, err: cut(e.message, 160) }; await save(slug, cache).catch(() => {}); log.warn?.('[drafts-bg]', slug, c.id, e.message); }
      }
      if (await remakeStills(slug, p, cache, box, made)) await save(slug, cache); /* made again, or its next try booked */
      for (const c of clips) { if (made.length >= n) break; const d = cache[c.id]; box.start = box.usd;
        if (await animate(slug, d, box)) { d.usd = +((d.usd || 0) + box.usd - box.start).toFixed(4); made.push({ cardId: c.id, as: 'video', kind: 'video', title: d.title, image: d.image, video: d.video, usd: +(box.usd - box.start).toFixed(4) }); await save(slug, cache); }
        else if (d.clipRetry || d.err) await save(slug, cache).catch(() => {}); }
      const d0 = today(now()); if (st.spend?.day !== d0) st.spend = { day: d0, usd: 0 }; st.spend.usd = +((st.spend.usd || 0) + box.usd).toFixed(4);
      st.last = { at: now(), made: made.length, usd: +box.usd.toFixed(4), errors: errors.slice(0, 6), manual }; await packs.put(slug, S, st);
      if (made.length) await onDrafts(slug).catch(() => {});
      return { made, usd: +box.usd.toFixed(4), errors };
    } finally { busy.delete(slug); }
  }
  let ticking = false;
  async function tick() {
    if (ticking) return { busy: true }; ticking = true; const ran = [];
    try { for (const b of (await packs.list().catch(() => [])).filter((x) => x.slug && x.status?.ready)) {
      if (ran.length >= cfg.perTick) break;
      const st = await stateOf(b.slug), lastOpen = Math.max(opens.get(b.slug) || 0, await lastOpenOf(b.slug).catch(() => 0) || 0);
      if (!draftsDue(st, cfg, { now: now(), aiLive: ai?.live !== false, lastOpen }).ok) continue;
      const r = await runOne(b.slug).catch((e) => ({ error: e.message })); if (r?.made?.length) ran.push(b.slug); } }
    finally { ticking = false; }
    return { ran };
  }
  let timer = null;
  const start = () => { if (timer || cfg.killed || cfg.mock || cfg.local) { log.log?.(`[drafts-bg] first drafts ${cfg.killed ? 'off (DRAFTS_BG_OFF)' : cfg.mock ? 'off (AI mock)' : cfg.local ? 'off here (local)' : 'already on'}`); return false; }
    timer = setTimeout(function go() { tick().catch((e) => log.warn?.('[drafts-bg] tick', e.message)).finally(() => { timer = setTimeout(go, cfg.tickMs); timer.unref?.(); }); }, cfg.firstMs); timer.unref?.(); return true; };
  return { cfg, tick, start, runOne, opened, stateOf, cacheOf };
}

/* ---------- the jam: a cached draft becomes the jam's first draft ---------- */
// called when a jam is made for a card: the draft is copied in (ready, marked as made by Brew before the jam opened)
export function seedDrafts(w, c, firstDrafts = {}, { uid = () => 'dr' + Math.random().toString(36).slice(2, 10), at = Date.now() } = {}) {
  if (!w || !c || (w.drafts || []).length) return false;
  const d = draftFor(c, firstDrafts); if (!d) return false;
  const { cardId, key, k, kind, format, cardTitle, usd, bg, wants, motion, retried, failedAt, fails, ip, imgText, imgRetry, clipRetry, checkedAt, photoOnly, ...rest } = d;
  w.drafts = [{ ...rest, id: uid('dr'), asked: ['image', 'carousel', 'video', 'voice', 'text'].includes(d.as) ? d.as : 'auto', state: 'ready', step: null, at, doneAt: at, by: 'Brew', seeded: true }];
  return true;
}
