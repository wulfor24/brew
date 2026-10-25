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
// Built to stop a thumb (17 Oct): the plan opens on real buyers' words and the rival ads that keep running (brand-pack.js
// hooksOf), sees the scenes already in the feed, and its headline is set on the picture in exact type (d.render; on a clip's
// first 3 seconds too), never drawn by the image model. A picture the day's budget refused is made after midnight UTC from the
// saved prompt (d.imgRetry, no new plan). Cards are drafted by value (value.js), a brand whose read just turned ready first;
// the top two make cards get one new take a day (the last take kept, d.prev) and the top make card without a clip gets one.
import { leaderOnly } from './roles.js'; // timers run their work on the background lease holder only
import crypto from 'node:crypto';
import { safeFetch } from './reader/util.js'; // photo links reach only the public internet
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchProduct, cardProduct, sceneOf } from './product-match.js';
import { draftPrompt, imagePrompt, hookBlock, smallOf, DRAFT_SCHEMA, DRAFT_RATIOS, createMakers, HEAD_V } from './drafts.js';
import { cardValue } from './value.js'; // what a card is worth doing: the order drafts are made in
import { emailHtml, whatsappHtml, pageHtml, collectionHtml } from './draft-mocks.js';
import { hasCode } from './code-md.js'; // a draft that is code (markup, a snippet) shows as code, with no product photo
import { inferMake } from './cards-gen.js';
import { isRivalCard, isResearchImage } from './rival-ad.js'; // a rival's poster is never our product photo
import { genFlush as genFlush0 } from './gen-store.js';
import { cleanDraftClaims, packSource } from './claims.js'; // the store's own claims only, in drafts made with nobody watching
import { collageEdges, plainest, LOOKS_V } from './draft-quality.js'; // every saved draft picture passes the look check once
import { stayHere } from './moved.js'; // a brand moved to production: no background work here on staging

const H = 3600e3, DAY = 24 * H;
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
const today = (ms) => new Date(ms).toISOString().slice(0, 10);
/* the budgets reset at midnight UTC (budget.js and the brand's day cap): a refused picture is tried five minutes after */
export const nextDay = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5); };
/* a new take's composition, one of the thumb-stoppers the plan picks from (drafts.js SCHEMA.visual), turned day by day */
export const TAKES = ['a hand or person using the product mid-action', 'the problem moment just before the product fixes it', 'the product unboxed in hands', 'the product beside what it replaces', 'a first-person view of the routine'];

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
  if (d.failedAt) return !(d.key === draftKey(c) && now < (d.retryAt || d.failedAt + retryWait(d.fails || 1))); /* retryAt: a budget refusal waits for the reset */
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
   fallback: the real product photo the picture was made from, shown by the page if a picture can't load (never a broken image).
   A real-photo stand-in with no ad set on it says so (photoOnly, remaking while a new picture is due): the page shows "New
   picture coming", never "First draft" over a packshot. A clip's poster is its first frame with the headline set */
/* Brew's own words never carry an em dash (plain.js tidy does the same on cards); saved drafts read so on every serve (QA UI 20 Oct) */
const undash = (s) => String(s || '').replace(/\s*—\s*/g, ', ').replace(/(\s)–(\s)/g, '$1-$2').replace(/,\s*,/g, ',');
export function draftView(d, c = null) {
  if (!d) return null; const images = d.slides?.length ? d.slides.map((x) => x.image).filter(Boolean) : d.render ? [d.render] : d.image ? [d.image] : [];
  if (!images.length && !d.video) return null;
  const fallback = hasCode(d.copy) ? null : [d.photo, ...(isRivalCard(c) ? [] : [...(c?.images || []), c?.img])].find((x) => x && typeof x === 'string' && !images.includes(x) && !isResearchImage(x)) || null; /* never a rival's poster under our draft */
  const bare = !!d.photoOnly && !d.render && !d.video && !d.slides?.length;
  return { as: d.as, kind: d.kind || d.as, images, video: d.video || null, poster: d.video ? d.poster || d.render || d.image || images[0] || null : null, ratio: d.video && d.clipStill ? '9:16' : d.ratio || null, title: undash(d.title || ''), copy: cut(undash(String(d.copy || '').replace(/[#*_>`]/g, '')), 240), ...(hasCode(d.copy) ? { code: String(d.copy).slice(0, 6000) } : {}) /* the jam's stage shows code as code, not as the mock's picture */,
    ...(d.product ? { product: d.product } : {}) /* the product its pictures show: the jam's Studio sets up the same one */, ...(d.headline ? { headline: undash(d.headline) } : {}), ...(d.render && d.headline && ['image', 'video'].includes(d.kind || d.as) ? { wordsIn: d.render } /* the headline is already set in this picture: the page never lays it on again */ : {}), ...(fallback ? { fallback } : {}), ...(d.imgRetry || bare ? { remaking: true } : {}), ...(bare ? { photoOnly: true } : {}) };
}

/* ---------- gating and cost ---------- */
/* imageUsd: one flash picture on Vertex (about $0.039; it was booked at $0.17, so the $4 day bought 23 pictures, not 100);
   proImageUsd: one on the other model (a misspelled name made again, image-guard TEXT). readyMs: how often a brand that just
   turned ready is looked for. takes: the top make cards that get a new take a day */
export const DRAFTS_DEFAULTS = { tickMs: 30 * 60e3, firstMs: 4 * 60e3, readyMs: 3 * 60e3, openDays: 3, dayCapUsd: 4, topN: 6, perTick: 2, perRun: 8, takes: 2, textUsd: 0.04, imageUsd: 0.04, proImageUsd: 0.14, videoUsd: 0.9, voiceUsd: 0.01, slides: 5 };
export function draftsConfig(env = process.env) {
  const n = (k, d) => (env[k] != null && env[k] !== '' && Number.isFinite(+env[k]) ? +env[k] : d);
  return { ...DRAFTS_DEFAULTS, dayCapUsd: n('DRAFTS_DAY_CAP_USD', DRAFTS_DEFAULTS.dayCapUsd), topN: n('DRAFTS_TOP_N', DRAFTS_DEFAULTS.topN), perRun: n('DRAFTS_PER_RUN', DRAFTS_DEFAULTS.perRun), imageUsd: n('DRAFTS_IMAGE_USD', DRAFTS_DEFAULTS.imageUsd), videoUsd: n('DRAFTS_VIDEO_USD', DRAFTS_DEFAULTS.videoUsd), readyMs: n('DRAFTS_READY_MS', DRAFTS_DEFAULTS.readyMs), takes: n('DRAFTS_TAKES', DRAFTS_DEFAULTS.takes),
    killed: env.DRAFTS_BG_OFF === '1', mock: env.AI_MOCK === '1', local: env.DRAFTS_BG !== '1' && (!!env.RESEARCH_OFF || !!env.LIVE_OFF) };
}
/* what one draft of each kind costs before it is made (the words, then the pictures and the clip); booked after at real cost */
export const estUsd = (kind, cfg = DRAFTS_DEFAULTS) => cfg.textUsd + ({ image: cfg.imageUsd, collection: cfg.imageUsd, carousel: cfg.imageUsd * cfg.slides, stories: cfg.imageUsd * cfg.slides, video: cfg.imageUsd + cfg.videoUsd + cfg.voiceUsd }[kind] || 0);
/* an image's real cost: every picture the image guard made for it (a wrong product or a misspelled name is made again), the
   ones on the dearer model at its price */
export const imageCost = (buf, cfg = DRAFTS_DEFAULTS) => { const g = buf?.guard || {}, n = Number.isFinite(g.gens) ? g.gens : g.retried ? 2 : 1, pro = Math.min(n, g.pro || 0);
  return +((n - pro) * cfg.imageUsd + pro * (cfg.proImageUsd ?? cfg.imageUsd)).toFixed(4); };
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
export function createDraftsBg({ packs, ai, geminiImage = null, saveGen = null, genFile = null, genFlush = genFlush0, photoAsync = null, memory = null, loadPack, treg = null, launchBrowser = null, zipBuffer = null, spend = () => true, makers = null, looks = null, lastOpenOf = async () => 0, onDrafts = async () => {}, log = console, env = process.env, now = () => Date.now() } = {}) {
  const cfg = draftsConfig(env), F = 'drafts/cards.json', S = 'drafts/state.json', busy = new Set(), opens = new Map();
  const M = makers || createMakers({ geminiImage, treg, launchBrowser, zipBuffer, save: saveGen || (() => {}), file: genFile || (async () => null), log });
  /* treg charges booked to this job, per brand (tag draftsbg-<slug>, so the brand's spend ledger has them too) */
  const tregUsd = new Map(); treg?.onCharge?.((tag, usd) => { if (String(tag).startsWith('draftsbg-')) tregUsd.set(tag, (tregUsd.get(tag) || 0) + (usd || 0)); });
  const stateOf = async (slug) => (await packs.getJSON(slug, S, null).catch(() => null)) || {};
  const cacheOf = async (slug) => (await packs.getJSON(slug, F, null).catch(() => null)) || {};
  const opened = (slug) => { if (slug) opens.set(slug, now()); };
  // the real product photo: a pack asset, a public file, or a store image fetched once into tmp
  /* the named product's cleanest photo first (a packshot on a plain ground, draft-quality.js plainest): a designed store card copied
     into a draft or a mock reads as a collage */
  const photo = async (c, named = null) => {
    const views = named ? [...new Set([named.img, ...(Array.isArray(named.imgs) ? named.imgs : [])].filter((x) => x && !isResearchImage(x)))].slice(0, 5) : [];
    if (views.length > 1) { const got = (await Promise.all(views.map(async (u) => ({ key: u, file: await photo({}, { img: u }).catch(() => null) })))).filter((x) => x.file);
      const pick = got.length > 1 ? await plainest(got).catch(() => null) : null, hit = got.find((x) => x.key === pick) || got[0]; if (hit) return hit.file; }
    for (const rel of [named?.img, ...(isRivalCard(c) ? [] : [...(c.images || []), c.img]), ...(c.post?.media?.product?.images || [])].filter((x) => x && !isResearchImage(x))) {
      try {
        if (/^https?:/.test(rel)) { const f = path.join(os.tmpdir(), 'brew-ph-' + sha(rel) + '.jpg'); if (!fs.existsSync(f)) { const r = await safeFetch(rel, { signal: AbortSignal.timeout(20e3) }); if (!r.ok) continue; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return f; }
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
  const photoRelOf = (c, named, p) => [named?.img, ...(isRivalCard(c) ? [] : [...(c.images || []), c.img]), ...(c.post?.media?.product?.images || []), p?.catalog?.[0]?.img].find((x) => x && typeof x === 'string' && !/^\/?gen\//.test(x)) || null;
  /* one picture of the real product: the guard tries the model again and, failing that, hands back the real photo (genFailed).
     salt: a new take on another day is another file, whatever its words */
  const makeStill = async (slug, c, { src, ip, ratio, text, catalog, brand, named = null, retry = false, salt = '' }) => {
    const buf = await geminiImage({ srcFile: src, prompt: ip, ratio, text, catalog, brand, named, slug, fallback: !retry }); /* slug: the picture counts against this brand's daily share */
    const failed = !!buf?.guard?.genFailed, name = sha(`${slug}|${c.id}|${ip}|${ratio}${salt ? `|${salt}` : ''}${failed ? '|photo' : ''}`) + (failed ? '.jpg' : '.png');
    saveGen(name, buf); return { rel: 'gen/' + name, failed, retried: !!buf?.guard?.retried, error: buf?.guard?.error || null, buf };
  };
  /* the headline set on a picture in exact type by Chromium (never drawn by the image model) → 'gen/…jpg', or null */
  const headOn = async (buf, d, ratio, key) => { if (!buf || !d?.headline || !launchBrowser || !M.head) return null;
    try { return await M.head(buf, { text: d.headline, small: d.headSmall || '' }, ratio, key); } catch (e) { log.warn?.('[drafts-bg] headline', d.cardId, e.message); return null; } };
  const brandOf = (p) => ({ name: p.seed?.brand?.name || p.name || '', host: p.seed?.brand?.host || '', colors: p.seed?.brand?.colors || [] });
  /* the scenes the brand's last drafts already show, so the next one goes somewhere else */
  const scenesOf = (cache, id) => Object.values(cache || {}).filter((x) => x?.visual && x.cardId !== id && !x.failedAt).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 10).map((x) => cut(x.visual, 160));
  /* a budget refusal is not a failure: the picture is made after the reset from the saved prompt, with no new plan */
  const budgetWait = (d, why) => { d.imgRetry = { n: 0, next: nextDay(now()), err: 'budget' }; d.note = cut(`${String(d.note || '').replace(/ The picture comes.*$/, '')} ${why}`, 220); return null; };
  // o.cache: the brand's drafts (the scenes already shown); o.take: a new take of a card drafted on an earlier day, its number
  async function makeOne(slug, p, c, kind, box, o = {}) {
    const as = PLAN_AS[kind] || 'text', tag = `draftsbg-${slug}`;
    let mem = ''; try { mem = memory ? await memory.promptBlock(slug, { query: `${c.title} ${c.sub || ''}`, agent: 'creative', name: p.name }) : ''; } catch {}
    const hooks = hookBlock(p), scenes = o.cache ? scenesOf(o.cache, c.id) : [], take = o.take ? TAKES[(o.take + (+moveOf(c) || 0)) % TAKES.length] : '';
    const card = `${p.factBrief || ''}\n\nCard (by the ${c.agent} agent, from ${c.src || 'the move documents'}):\nTitle: ${c.title}\nBody: ${c.sub || ''}\n${(c.rows || []).map((r) => `- ${r[0]}: ${r[1]}`).join('\n')}\nThe person reading is the founder.${hooks ? `\n\n${hooks}` : ''}${scenes.length ? `\n\nSCENES ALREADY IN THIS FEED (use another setting, person and angle):\n${scenes.map((v) => `- ${v}`).join('\n')}` : ''}`;
    const ask = [ASK[kind] || '', take ? `This is today's new take on a draft the team has seen: build the visual as ${take}, with a new headline.` : ''].filter(Boolean).join(' ');
    const prompt = draftPrompt({ card, role: c.agent === 'brew' ? 'creative' : c.agent || 'creative', brief: cardBriefText(c, { moveDocs: p.moveDocs }), mem, as, ask });
    const r = await ai.call({ model: 'sonnet', prompt, schema: DRAFT_SCHEMA, max: 4500, tag: 'draft-bg', ...(p.bookWords ? { system: `You write for ${p.name || 'the brand'}. Follow its Brand Book in every word:\n${p.bookWords}` } : {}) }); box.usd += r.usd || 0; /* 3000 was hit once: a plan cut off mid-JSON */
    const j = r.json || {}; j.as = as;
    const cut0 = cleanDraftClaims(j, packSource(p, c)); if (cut0.length) log.info?.('[drafts-bg] dropped unbacked claims', c.id, cut0.map((f) => f.phrase).join(', ')); /* QA-25: a code, guarantee or timed result the store never made never reaches a first draft */
    /* a clip is 9:16 from its first frame (Veo takes 9:16 or 16:9); Stories too */
    const ratio = kind === 'stories' || kind === 'video' ? '9:16' : DRAFT_RATIOS.includes(j.ratio) && j.ratio !== '16:9' ? j.ratio : c.make?.format === 'reel' ? '9:16' : '4:5';
    const d = { k: 2, qv: LOOKS_V /* made through the judged guard */, cardId: c.id, key: draftKey(c), kind, format: c.make?.format || null, cardTitle: c.title, as: kind === 'stories' ? 'carousel' : ['email', 'whatsapp', 'page', 'collection', 'catalog'].includes(kind) ? kind : as, title: cut(j.title || 'First draft', 70), copy: String(j.copy || '').trim(), note: cut(j.note || '', 160), ratio, at: now(), by: 'Brew', bg: true };
    if (j.visual) d.visual = cut(j.visual, 400); /* the scene, so the next draft goes elsewhere (and a final reruns it) */
    if (j.headline && ['image', 'collection', 'video'].includes(kind)) { d.headline = cut(String(j.headline).replace(/[#*_>`"“”]/g, ''), 80); d.headSmall = smallOf(d.copy, d.headline); }
    if (take) d.take = { n: o.take + 1, look: take, day: today(now()) };
    const fits = (usd) => box.usd + usd <= box.cap + 1e-9, words = (x) => { d.as = 'text'; d.note = cut(`${d.note} ${x}`, 200); };
    const brand = brandOf(p);
    /* the product the copy names, not the card's default shot (a Hukum ad must show the Hukum shoe) */
    /* the card's asset line names the product it promises ("an office worker wearing Toe Toasters"): that one wins over the draft's words */
    const named = cardProduct(c, p.catalog, { brand: brand.name }) || matchProduct(`${j.title || ''}. ${j.copy || ''}. ${(j.slides || []).map((x) => x?.onSlide).join('. ')}`, p.catalog, { brand: brand.name });
    const src = await photo(c, named) || (p.catalog?.[0]?.img ? await photo({}, p.catalog[0]) : null); /* nothing named and no card photo: the brand's lead product, never an invented one */
    if (named) d.product = named.t; else if (p.catalog?.[0] && !(c.images?.length || c.img)) d.product = p.catalog[0].t;
    d.photo = src ? photoRelOf(c, named, p) : null;
    let stillBuf = null;
    const still = async () => { /* one picture of the real product in a new scene; null when there is no photo or no budget */
      if (!geminiImage || !saveGen) return null; if (!src) { words('No product photo to stage, so this one is words only.'); return null; }
      /* the prompt first: a picture the budget refuses now is made later from it, without asking the AI for new words */
      const ip = imagePrompt(j, true, c, { name: brand.name, ...(p.config?.product || {}), product: named?.t || d.product || '' }, { ratio, topSpace: !!d.headline }), text = `${c.make?.pieces || ''}. ${j.title || ''}. ${j.copy || ''}. ${c.title || ''}`;
      d.ip = ip; d.imgText = cut(text, 600);
      if (!fits(cfg.imageUsd)) return budgetWait(d, "The picture comes with tomorrow's budget.");
      try { const r = await makeStill(slug, c, { src, ip, ratio, text, catalog: p.catalog || null, brand: p.seed?.brand?.name || '', named, salt: take ? today(now()) : '' });
        if (r.failed) { d.photoOnly = true; d.imgRetry = { n: 1, next: now() + retryWait(1), err: cut(r.error || '', 160) }; d.note = cut(`${d.note} For now this is the real product photo; the new picture is being made again.`, 220); log.warn?.('[drafts-bg] image fell back to the real photo', slug, c.id, r.error || ''); }
        else { box.usd += imageCost(r.buf, cfg); if (r.retried) d.retried = true; if (r.buf?.guard?.labelApprox) d.labelApprox = true; }
        stillBuf = r.buf; d.fromPhoto = true; return r.rel; }
      catch (e) { if (e.budget) return budgetWait(d, 'The picture comes when the picture budget resets.'); /* the brand's image share for today is used */
        d.err = 'The words are here; the picture did not come through.'; d.imgRetry = { n: 1, next: now() + retryWait(1), err: cut(e.message, 160) }; log.warn?.('[drafts-bg] image', slug, c.id, e.message); return null; }
    };
    if (kind === 'image' || kind === 'collection' || kind === 'video') {
      const img = await still(); if (!img) { d.as = 'text'; d.usd = +(box.usd - box.start).toFixed(4); return d; }
      d.image = img; d.as = kind === 'video' ? 'image' : d.as;
      /* the headline in exact type: a single image ad becomes a finished static (a real-photo stand-in too), a clip's first frame its poster */
      if (kind !== 'collection' && d.headline) { const h = await headOn(stillBuf, d, ratio, img); if (h) { d.render = h; d.headV = HEAD_V; } }
      if (kind === 'collection' && launchBrowser) { const products = await gridOf(p, named); if (products.length >= 2) d.render = await render(collectionHtml({ brand, title: j.title || c.title, hero: await genUri(img), products }), '4:5', `${d.key}|${img}`).catch((e) => { log.warn?.('[drafts-bg] grid', slug, c.id, e.message); return null; }); }
      if (kind === 'video') { d.motion = cut(j.motion || '', 220); d.script = cut(j.script || '', 160); d.wants = 'video'; await animate(slug, d, box); } /* a real-photo stand-in is still the right product: it is animated too */
    } else if (kind === 'carousel' || kind === 'stories') {
      const slides = (j.slides || []).filter((x) => x?.onSlide).slice(0, 8);
      if (slides.length < 2 || !launchBrowser || !src) { const img = await still(); if (img) { d.image = img; d.as = 'image'; d.note = cut(`${d.note} One picture for now; the slides come with another take.`, 200); } else d.as = 'text'; }
      /* the day's budget can't hold the slides: a failure that waits for the reset (runOne writes failedAt + retryAt) */
      else if (!fits(cfg.imageUsd * 2)) throw Object.assign(new Error("The slides wait for tomorrow's budget."), { budget: true });
      else { d.copy = d.copy || slides.map((x, i) => `${i + 1}. ${x.onSlide}`).join('\n'); let made = 0;
        try { const rr = await M.carousel({ slides, src, ratio, title: j.title, cardTitle: c.title, scene: sceneOf(c), named, product: named?.t || d.product || '', brand, id: `${slug}|${d.key}`, slug, canSpend: () => { if (!fits(cfg.imageUsd * (made + 1))) return false; made++; return true; } });
          box.usd += cfg.imageUsd * (rr.made + rr.retried); Object.assign(d, { slides: rr.slides, image: rr.image }); if (rr.zip) d.zip = rr.zip; if (rr.err) d.err = rr.err; }
        catch (e) { box.usd += cfg.imageUsd * made; log.warn?.('[drafts-bg] slides', slug, c.id, e.message);
          /* no slide came back, or the budget refused them: thrown, so the card is tried again (runOne), never left as words for good */
          if (e.budget || e.noSlides || /no slide photo came back/i.test(e.message)) throw e;
          words('The slides did not come through; the words are here.'); } }
    } else if (['email', 'whatsapp', 'page', 'catalog'].includes(kind) && launchBrowser) { /* free: the words laid out where they will live, with a real product photo */
      const code = hasCode(d.copy); if (code) d.photo = null; /* markup has no product: no product photo on it or under it */
      const ph = src && !code ? dataUri(src) : null, html = kind === 'email' ? emailHtml({ brand, title: d.title, copy: d.copy, photo: ph }) : kind === 'whatsapp' ? whatsappHtml({ brand, title: d.title, copy: d.copy, photo: ph }) : kind === 'page' ? pageHtml({ brand, title: d.title, copy: d.copy, photo: ph }) : null;
      try { d.render = html ? await render(html, '4:5', `${d.key}|${d.copy}${code ? '|code' : ''}`) : await (async () => { const products = await gridOf(p, named); return products.length >= 2 ? render(collectionHtml({ brand, title: j.title || c.title, products, catalog: true }), '4:5', `${d.key}|${d.title}`) : null; })(); }
      catch (e) { log.warn?.('[drafts-bg] mock', slug, c.id, e.message); }
      if (!d.render) d.as = 'text'; else if (code) d.codeMock = 1;
    } else if (kind !== 'text') d.as = 'text';
    d.usd = +(box.usd - box.start).toFixed(4);
    return d;
  }
  /* the still becomes a 6-second clip: within the brand's budget and the server's DAILY_VIDEO_CAP, else it waits as a still (wants: video).
     The headline sits on its first 3 seconds (Chromium sets it, ffmpeg lays it over). frame: another still to start from (a 9:16
     one made for an image card's clip), else the draft's own; spent: the video limit was already counted for it */
  async function animate(slug, d, box, { frame = null, spent = false } = {}) {
    const first = frame || d.image; if (!first) return false; /* clips are made on our own Vertex account (vertex-media.js), not treg */
    if (box.usd + cfg.videoUsd > box.cap + 1e-9) { d.note = cut(`${String(d.note || '').replace(/ The clip.*$/, '')} The clip waits for tomorrow's budget; here is the first frame.`, 220); return false; }
    if (!spent && !spend('video', slug)) { d.note = cut(`${String(d.note || '').replace(/ The clip.*$/, '')} The clip waits for today's video limit; here is the first frame.`, 220); return false; }
    const tag = `draftsbg-${slug}`, t0 = tregUsd.get(tag) || 0;
    try { d.video = 'gen/' + await M.video(first.slice(4), d.motion || '');
      if (d.script && spend('voice', slug)) { const au = await M.voice(d.script, '', 'Kore').catch(() => null); const both = au ? await M.mux(d.video.slice(4), au).catch(() => null) : null; if (both) d.video = 'gen/' + both; else if (au) d.audio = 'gen/' + au; }
      if (d.headline && launchBrowser && M.headClip) { const hv = await M.headClip(d.video.slice(4), { text: d.headline, small: d.headSmall || '' }).catch((e) => { log.warn?.('[drafts-bg] clip headline', slug, d.cardId, e.message); return null; }); if (hv) { d.video = 'gen/' + hv; d.clipHead = true; } }
      if (d.kind === 'video') d.as = 'video'; d.videoDay = today(now()); delete d.wants; delete d.clipRetry; delete d.err; d.note = String(d.note || '').replace(/ The clip.*$/, '');
      if (d.photoOnly && d.kind === 'video') delete d.imgRetry; } /* the clip of the real photo is the draft now: its still is not made again */
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
      if (d.video && !(await has(d.video))) { delete d.video; delete d.clipStill; if (d.kind === 'video') d.wants = 'video'; if (d.as === 'video') d.as = 'image'; }
      if (d.slides?.length) { const ok = []; for (const x of d.slides) if (await has(x.image)) ok.push(x); if (ok.length < d.slides.length) { d.slides = ok; d.image = ok[0]?.image || null; if (!ok.length) { delete d.slides; d.as = 'text'; } } }
      if (d.image && !(await has(d.image))) { log.warn?.('[drafts-bg] picture gone from the bucket, making it again', slug, d.cardId, d.image); if (d.ip) d.imgRetry = { n: 0, next: 0, err: 'the picture was lost' }; else { delete d.image; d.as = 'text'; } }
      /* a real-photo stand-in whose retries ran out (drafts made before 17 Oct) is tried again: it is never left as the packshot */
      if (d.photoOnly && !d.imgRetry && !d.video && d.ip) d.imgRetry = { n: MAX_RETRIES - 1, next: 0, err: 'still the real photo' };
    }
    return n;
  }
  /* a saved draft whose picture stands on another product than the one the card's asset line names (drafts made before the
     asset line counted, e.g. "an office worker wearing Toe Toasters" drafted on the hand warmer) is dropped: the feed shows the
     card's own product photo at once, and the draft is made again in its turn, inside the day's cap. Every brand, every kind */
  function healWrongProduct(p, cache) {
    let n = 0; const brand = p.seed?.brand?.name || p.name || '';
    for (const c of p.seed?.posts || []) {
      const d = draftFor(c, cache); if (!d || !(d.image || d.render || d.photo || d.slides?.length)) continue;
      const want = cardProduct(c, p.catalog, { brand, byNameOnly: true }); if (!want || d.product === want.t) continue; /* only a product the card names outright: loose words never throw a draft away */
      log.log?.('[drafts-bg] draft shows another product than the card names; making it again', c.id, d.product || '(none)', '→', want.t);
      delete cache[c.id]; n++;
    }
    return n;
  }
  /* drafts saved before the look check (draft-quality.js LOOKS_V) are judged once: the free pixel check, then the vision judge
     (looks) against the card's words. A collage, a cropped product or an unrelated picture is dropped: the feed shows the card's
     own photo at once and the draft is made again in its turn, through the guard that now judges every picture. Every brand,
     every kind with a picture (a still, a clip's first frame, a collection hero, slides); a few a run so the cost stays small */
  /* a saved still whose headline was set over the picture (layout 1) is set again from its own clean picture: the words in their
     own panel above it. Free (Chromium only), a few a tick, never a clip's overlay */
  async function healHeads(p, cache, max = 12) {
    if (!genFile || !launchBrowser || !M.head) return 0; let n = 0; const skip = {};
    for (const d of Object.values(cache || {})) { if (n >= max) break;
      if (!d?.render || !d.headline || (d.headV || 0) >= HEAD_V || d.kind === 'collection' || !['image', 'video'].includes(d.kind || d.as)) continue;
      /* the clean picture under the words: the draft's own, else the clip's still, else the real photo it stood in with */
      const src = [d.image, d.clipStill, d.poster !== d.render ? d.poster : null].find((x) => /^\/?gen\//.test(x || '') && x !== d.render);
      let f = src ? await genFile(String(src).replace(/^\/?gen\//, '')).catch(() => null) : null;
      if (!f && d.photo && photoAsync) f = await photoAsync(d.photo).catch(() => null);
      if (!f || !fs.existsSync(f)) { skip[src ? 'no file' : 'no clean picture'] = (skip[src ? 'no file' : 'no clean picture'] || 0) + 1; d.headV = HEAD_V; continue; }
      const h = await headOn(fs.readFileSync(f), d, d.kind === 'video' ? '9:16' : d.ratio || '4:5', src || d.photo); if (h) { d.render = h; n++; } else skip.failed = (skip.failed || 0) + 1; d.headV = HEAD_V; }
    if (n || Object.keys(skip).length) log.log?.('[drafts-bg] re-lettered', p?.slug || p?.seed?.brand?.slug || '', n, JSON.stringify(skip));
    return n + Object.values(skip).reduce((a, b) => a + b, 0); }
  async function healLooks(p, cache, max = 6) {
    if (!genFile) return 0; let n = 0, checked = 0;
    for (const c of rankCards(p.seed?.posts || [])) {
      const d = draftFor(c, cache); if (!d || d.qv === LOOKS_V || d.photoOnly) continue;
      if (!['image', 'video', 'collection', 'carousel', 'stories'].includes(d.kind || d.as)) { d.qv = LOOKS_V; continue; } /* an email, chat or page mock is our own render, never judged as a photograph */
      const pics = (d.slides?.length ? d.slides.map((x) => x.image) : [d.image]).filter((r) => /^gen\//.test(r || '')).slice(0, 3); if (!pics.length) { d.qv = LOOKS_V; continue; }
      if (checked++ >= max) break;
      const words = `${c.title || ''}. ${c.sub || ''}${d.product ? ` Product: ${d.product}.` : ''}`; let bad = null, answered = true;
      for (const r of pics) { const f = await genFile(String(r).slice(4)).catch(() => null); if (!f) continue; const buf = fs.readFileSync(f);
        const px = await collageEdges(buf); if (px.collage) { bad = px.why; break; }
        const q = looks ? await looks(buf, words).catch(() => null) : null; if (!q) { if (looks) answered = false; continue; } /* no answer: judged again on a later run */ if (!q.ok) { bad = q.why; break; } }
      if (bad) { log.log?.('[drafts-bg] saved draft failed the look check; making it again', c.id, bad); delete cache[c.id]; n++; }
      else if (answered) d.qv = LOOKS_V;
    }
    return n;
  }
  /* a saved email, chat or page mock whose words are code (a JSON-LD block, a snippet) was shot with a product photo and the
     code as paragraphs: shot again (free, Chromium) as a code block with no photo. Every brand, once per draft */
  async function healCodeMocks(p, cache) {
    if (!launchBrowser) return 0; let n = 0; const brand = brandOf(p);
    for (const d of Object.values(cache)) {
      if (!d || d.k !== 2 || d.codeMock || !d.render || !['email', 'whatsapp', 'page'].includes(d.kind) || !hasCode(d.copy)) continue;
      const html = (d.kind === 'email' ? emailHtml : d.kind === 'whatsapp' ? whatsappHtml : pageHtml)({ brand, title: d.title, copy: d.copy, photo: null });
      try { d.render = await render(html, '4:5', `${d.key}|${d.copy}|code`); d.photo = null; d.codeMock = 1; n++; log.log?.('[drafts-bg] code mock shot again without the product photo', d.cardId); }
      catch (e) { log.warn?.('[drafts-bg] code mock', d.cardId, e.message); }
    }
    return n;
  }
  /* pictures that came back as the real photo, were refused by the day's budget, or did not come at all are made again when due,
     from the saved prompt; the headline is set on the new one and the card heals on its next load. A real-photo stand-in keeps
     being tried once a day (it is never left as the packshot); a budget refusal waits for the reset without counting as a try */
  async function remakeStills(slug, p, cache, box, made) {
    let tried = 0; const brand = brandOf(p);
    for (const c of rankCards(p.seed?.posts || [])) {
      const d = draftFor(c, cache); if (!d?.imgRetry || !d.ip || now() < (d.imgRetry.next || 0)) continue;
      if (d.video && d.kind === 'video') { delete d.imgRetry; continue; } /* the clip is made: its first frame stays */
      if (made.length >= cfg.perRun || box.cap - box.usd < cfg.imageUsd) break;
      const named = cardProduct(c, p.catalog, { brand: brand.name }) || matchProduct(d.imgText || `${d.title}. ${d.copy}`, p.catalog, { brand: brand.name });
      const src = await photo(c, named) || (p.catalog?.[0]?.img ? await photo({}, p.catalog[0]) : null); if (!src) continue;
      const t0 = box.usd; tried++;
      try { const r = await makeStill(slug, c, { src, ip: d.ip, ratio: d.ratio || '4:5', text: d.imgText || '', catalog: p.catalog || null, brand: brand.name, named, retry: true });
        if (r.failed) throw new Error(r.error || 'the picture still showed another product'); /* the real photo again is not a made picture: back off and try later */
        box.usd += imageCost(r.buf, cfg); d.image = r.rel; d.fromPhoto = true; d.qv = LOOKS_V; delete d.imgRetry; delete d.photoOnly; delete d.err; d.note = cut(String(d.note || '').replace(/ ?For now this is the real product photo;.*$/, '').replace(/ The picture comes.*$/, ''), 220);
        if (r.buf?.guard?.labelApprox) d.labelApprox = true;
        if (d.as === 'text') d.as = d.kind === 'collection' ? 'collection' : 'image';
        if (d.kind === 'video' && !d.video) d.wants = 'video';
        if (d.kind !== 'collection' && d.headline) { const h = await headOn(r.buf, d, d.ratio || '4:5', r.rel); if (h) { d.render = h; d.headV = HEAD_V; } else delete d.render; } /* never the old stand-in's render over the new picture */
        if (d.kind === 'collection' && launchBrowser) { const products = await gridOf(p, named); if (products.length >= 2) d.render = await render(collectionHtml({ brand, title: d.title || c.title, hero: await genUri(d.image), products }), '4:5', `${d.key}|${d.image}`).catch(() => d.render || null); }
        d.usd = +((d.usd || 0) + box.usd - t0).toFixed(4); made.push({ cardId: c.id, as: d.as, kind: d.kind, title: d.title, image: d.render || d.image, video: d.video || null, usd: +(box.usd - t0).toFixed(4), remade: true });
        log.log?.('[drafts-bg] picture made again', slug, c.id); }
      catch (e) {
        if (e.budget) { d.imgRetry = { n: d.imgRetry.n || 0, next: nextDay(now()), err: 'budget' }; log.warn?.('[drafts-bg] picture again waits for the budget', slug, c.id); continue; }
        const n = (d.imgRetry.n || 0) + 1; if (n >= MAX_RETRIES && !d.photoOnly) { delete d.imgRetry; d.err = 'The new picture did not come through; this is the real product photo.'; } else d.imgRetry = { n: Math.min(n, MAX_RETRIES), next: now() + retryWait(n), err: cut(e.message, 160) };
        log.warn?.('[drafts-bg] picture again', slug, c.id, e.message); }
    }
    return tried;
  }
  /* every file a draft names is in the bucket before the drafts file that names them is written */
  const save = async (slug, cache) => { await genFlush().catch(() => {}); await packs.put(slug, F, cache); };
  /* a take kept as a version when a new one replaces it (the jam opens with both, newest first) */
  const KEEP_TAKE = ['as', 'title', 'copy', 'note', 'ratio', 'image', 'render', 'video', 'audio', 'slides', 'zip', 'headline', 'visual', 'product', 'at'];
  const versionOf = (d) => Object.fromEntries(KEEP_TAKE.filter((k) => d[k] != null).map((k) => [k, d[k]]));
  const VISUAL = new Set(['image', 'video', 'carousel', 'stories', 'collection']);
  /* the cards in the order they are worth doing (value.js), the feed's order breaking ties */
  const byValue = (p, cards) => { const grades = p.moveValue || {}; return cards.map((c, i) => ({ c, i, v: cardValue(c, grades, now()) })).sort((a, b) => b.v - a.v || a.i - b.i).map((x) => x.c); };
  // make the missing drafts for one brand, best-valued first → { made: [{cardId, as, kind, title, image}], usd, errors }
  async function runOne(slug, { manual = false, n = cfg.perRun, only = null } = {}) {
    if (busy.has(slug)) return { busy: true };
    busy.add(slug);
    try {
      const st = await stateOf(slug), lastOpen = Math.max(opens.get(slug) || 0, await lastOpenOf(slug).catch(() => 0) || 0);
      const due = draftsDue(st, cfg, { now: now(), aiLive: ai?.live !== false, lastOpen, manual });
      if (!due.ok) { /* nothing new is due, but saved drafts are still mended: the free re-lettering and the look check (25 Oct: both waited behind the daily cap) */
        if (ai?.live !== false) { const p0 = await loadPack(slug).catch(() => null), c0 = p0?.seed?.posts ? await cacheOf(slug) : null;
          if (c0) { const n0 = Object.values(c0).filter((d) => d?.qv === LOOKS_V).length; const h = await healHeads(p0, c0); const l = await healLooks(p0, c0); if (h || l || Object.values(c0).filter((d) => d?.qv === LOOKS_V).length !== n0) await save(slug, c0).catch(() => {}); } }
        return { made: [], usd: 0, why: due.why }; }
      const p = await loadPack(slug); if (!p?.seed?.posts) return { made: [], usd: 0, why: 'no feed yet' };
      const cache = await cacheOf(slug), ranked = rankCards(p.seed.posts), top = new Set(ranked.slice(0, cfg.topN).map((c) => c.id)), order = byValue(p, ranked), day = today(now());
      if (await healMissing(slug, cache)) await save(slug, cache).catch(() => {});
      if (healWrongProduct(p, cache)) await save(slug, cache).catch(() => {});
      if (await healCodeMocks(p, cache)) await save(slug, cache).catch(() => {});
      if (await healHeads(p, cache)) await save(slug, cache).catch(() => {});
      { const n0 = Object.values(cache).filter((d) => d?.qv === LOOKS_V).length; if (await healLooks(p, cache) || Object.values(cache).filter((d) => d?.qv === LOOKS_V).length !== n0) await save(slug, cache).catch(() => {}); }
      /* every card that names a format, and the top few others that show a picture (a text-only card with no format is not an
         ask for an asset), best-valued first; then stills that still wait for their clip */
      const todo = (only?.length ? order.filter((c) => only.includes(c.id)) : order.filter((c) => c.make?.format || (top.has(c.id) && draftKind(c) !== 'text'))).filter((c) => needsDraft(c, cache, now()));
      const clips = ranked.filter((c) => { const d = draftFor(c, cache); return d?.wants === 'video' && d.image && !d.video && now() >= (d.clipRetry?.next || 0); });
      const box = { usd: 0, cap: due.left, start: 0 }, made = [], errors = [];
      for (const c of todo) {
        if (made.length >= n || box.cap - box.usd < cfg.textUsd) break;
        const kind = draftKind(c), est = estUsd(kind, cfg);
        if (box.usd + Math.min(est, cfg.textUsd + (['image', 'collection', 'video', 'carousel', 'stories'].includes(kind) ? cfg.imageUsd : 0)) > box.cap) { errors.push({ cardId: c.id, error: 'daily cap' }); continue; } /* a dearer card waits; a cheaper one further down may still fit */
        box.start = box.usd;
        try { const d = await makeOne(slug, p, c, kind, box, { cache }); cache[c.id] = d; made.push({ cardId: c.id, as: d.as, kind, title: d.title, image: d.render || d.image || null, video: d.video || null, usd: d.usd });
          await save(slug, cache); }
        catch (e) { if (e.mock) { errors.push({ cardId: c.id, error: 'AI is on mock' }); break; } errors.push({ cardId: c.id, error: e.message }); const prev = cache[c.id];
          cache[c.id] = { k: 2, cardId: c.id, key: draftKey(c), failedAt: now(), fails: (prev?.failedAt && prev.key === draftKey(c) ? prev.fails || 1 : 0) + 1, err: cut(e.message, 160), ...(e.budget ? { retryAt: nextDay(now()) } : {}) }; /* a budget refusal waits for the reset, then the card is drafted again */
          await save(slug, cache).catch(() => {}); log.warn?.('[drafts-bg]', slug, c.id, e.message); }
      }
      if (await remakeStills(slug, p, cache, box, made)) await save(slug, cache); /* made again, or its next try booked */
      for (const c of clips) { if (made.length >= n) break; const d = cache[c.id]; box.start = box.usd;
        if (await animate(slug, d, box)) { d.usd = +((d.usd || 0) + box.usd - box.start).toFixed(4); made.push({ cardId: c.id, as: 'video', kind: 'video', title: d.title, image: d.image, video: d.video, usd: +(box.usd - box.start).toFixed(4) }); await save(slug, cache); }
        else if (d.clipRetry || d.err) await save(slug, cache).catch(() => {}); }
      if (!only?.length && !manual) { await newTakes(slug, p, order, cache, box, made, errors, n, day); await dailyClip(slug, p, order, cache, box, made, st, n, day); } /* the background job only: a manual run (the demo tour, ops) makes what is missing */
      const d0 = today(now()); if (st.spend?.day !== d0) st.spend = { day: d0, usd: 0 }; st.spend.usd = +((st.spend.usd || 0) + box.usd).toFixed(4);
      st.last = { at: now(), made: made.length, usd: +box.usd.toFixed(4), errors: errors.slice(0, 6), manual }; await packs.put(slug, S, st);
      if (made.length) await onDrafts(slug).catch(() => {});
      return { made, usd: +box.usd.toFixed(4), errors };
    } finally { busy.delete(slug); }
  }
  /* the top make cards (by value) get one new take a day: another composition (TAKES), a new headline, inside the day's cap.
     The new take replaces the draft only when it has a picture of its own; the last take is kept as a version (d.prev) */
  async function newTakes(slug, p, order, cache, box, made, errors, n, day) {
    for (const c of order.filter((x) => x.make?.format && VISUAL.has(draftKind(x))).slice(0, cfg.takes)) {
      if (made.length >= n || box.cap - box.usd < cfg.textUsd + cfg.imageUsd) break;
      const old = draftFor(c, cache); if (!old || old.imgRetry || old.photoOnly || today(old.at || 0) === day || old.takeDay === day || made.some((m) => m.cardId === c.id)) continue; /* a card worked on in this run waits */
      const kind = draftKind(c); box.start = box.usd;
      try { const d = await makeOne(slug, p, c, kind, box, { cache, take: old.takes || 1 });
        if ((d.image && !d.photoOnly) || d.slides?.length || d.video) { Object.assign(d, { takes: (old.takes || 1) + 1, takeDay: day, prev: [versionOf(old), ...(old.prev || [])].slice(0, 2) }); cache[c.id] = d;
          made.push({ cardId: c.id, as: d.as, kind, title: d.title, image: d.render || d.image || null, video: d.video || null, usd: d.usd, take: true }); }
        else old.takeDay = day; /* no picture of its own: the last take stays, tried again tomorrow */
      } catch (e) { if (e.mock) return; old.takeDay = day; errors.push({ cardId: c.id, error: `new take: ${e.message}` }); log.warn?.('[drafts-bg] new take', slug, c.id, e.message); }
      await save(slug, cache).catch(() => {});
    }
  }
  /* a clip a day for the brand's top make card: the best reel or video ad card, or (when the brand has none) the best single image
     ad or post, whose clip starts from a 9:16 still made for it so it fills a phone. Only when its draft has no clip yet and was
     not worked on in this run (a card refreshed by a new take gets its clip with it); at most one a brand a day, inside the
     brand's day cap and the server's video limit. A packshot stand-in of an image ad is not animated: its picture comes first */
  async function dailyClip(slug, p, order, cache, box, made, st, n, day) {
    if (st.clipDay === day || made.length >= n) return;
    const c = order.find((x) => /^(reel|video ad)$/.test(x.make?.format || '')) || order.find((x) => /^(single image ad|instagram post)$/.test(x.make?.format || '')); if (!c) return;
    const d = draftFor(c, cache); if (!d?.image || d.video || d.failedAt || (d.photoOnly && d.kind !== 'video') || made.some((m) => m.cardId === c.id) || now() < (d.clipRetry?.next || 0)) return;
    if (box.usd + cfg.videoUsd + (d.kind === 'video' ? 0 : cfg.imageUsd) > box.cap + 1e-9) return;
    st.clipDay = day; /* tried today, whatever comes of it */
    if (!spend('video', slug)) return; /* the server's video limit for today is used: the picture is not made for nothing */
    box.start = box.usd; let frame = null;
    if (d.kind !== 'video') { /* an image card: a 9:16 first frame of the same scene, then the clip */
      const brand = brandOf(p), named = cardProduct(c, p.catalog, { brand: brand.name }) || matchProduct(d.imgText || `${d.title}. ${d.copy}`, p.catalog, { brand: brand.name });
      const src = await photo(c, named) || (p.catalog?.[0]?.img ? await photo({}, p.catalog[0]) : null); if (!src) return;
      const ip = imagePrompt({ title: d.title, visual: d.visual || '' }, true, c, { name: brand.name, ...(p.config?.product || {}), product: named?.t || d.product || '' }, { ratio: '9:16', topSpace: !!d.headline });
      try { const r = await makeStill(slug, c, { src, ip, ratio: '9:16', text: d.imgText || '', catalog: p.catalog || null, brand: brand.name, named, salt: `clip|${day}` });
        if (r.failed) return; box.usd += imageCost(r.buf, cfg); frame = r.rel; d.clipStill = r.rel; const h = await headOn(r.buf, d, '9:16', r.rel); if (h) d.poster = h; }
      catch (e) { log.warn?.('[drafts-bg] clip still', slug, c.id, e.message); return; } }
    if (!d.motion) d.motion = 'A hand reaches in and uses the product.';
    if (await animate(slug, d, box, { frame, spent: true })) { d.usd = +((d.usd || 0) + box.usd - box.start).toFixed(4); made.push({ cardId: c.id, as: d.as, kind: d.kind, title: d.title, image: d.poster || d.render || d.image, video: d.video, usd: +(box.usd - box.start).toFixed(4), clip: true }); }
    else if (!d.video && d.kind !== 'video') { delete d.clipStill; delete d.poster; delete d.clipRetry; delete d.err; d.note = String(d.note || '').replace(/ The clip.*$/, ''); } /* an image ad stays a finished image ad: tried again another day */
    await save(slug, cache).catch(() => {});
  }
  /* brands whose read turned ready since the last look, and (on the first look after a start) ready brands never drafted:
     their first drafts are made now, not at the next half-hourly tick */
  const readySeen = new Map(); let looked = false;
  async function freshReady(list) { const out = [];
    for (const b of list || []) { if (!b?.slug) continue; const ready = !!b.status?.ready, was = readySeen.get(b.slug); readySeen.set(b.slug, ready); if (!ready) continue;
      if (looked ? !was : !(await stateOf(b.slug)).last) out.push(b.slug); }
    looked = true; return out; }
  let ticking = false;
  /* first: brands to run before the rest (just turned ready); onlyFirst: run only those (the ready watch) */
  async function tick({ list = null, first = null, onlyFirst = false } = {}) {
    if (ticking) return { busy: true }; ticking = true; const ran = [];
    try { const all = stayHere(list || await packs.list().catch(() => [])), fresh = first || await freshReady(all), ready = all.filter((x) => x.slug && x.status?.ready);
      for (const b of [...ready.filter((x) => fresh.includes(x.slug)), ...(onlyFirst ? [] : ready.filter((x) => !fresh.includes(x.slug)))]) {
      if (ran.length >= cfg.perTick) break;
      const st = await stateOf(b.slug), lastOpen = Math.max(opens.get(b.slug) || 0, await lastOpenOf(b.slug).catch(() => 0) || 0);
      if (!draftsDue(st, cfg, { now: now(), aiLive: ai?.live !== false, lastOpen }).ok) continue;
      const r = await runOne(b.slug).catch((e) => ({ error: e.message })); if (r?.made?.length) ran.push(b.slug); } }
    finally { ticking = false; }
    return { ran };
  }
  /* the ready watch: a light look every few minutes; a brand that just turned ready is drafted at once */
  async function watch() { if (ticking) return { busy: true }; const list = await packs.list().catch(() => []); const fresh = await freshReady(list); return fresh.length ? tick({ list, first: fresh, onlyFirst: true }) : { ran: [] }; }
  let timer = null, watcher = null;
  const start = () => { if (timer || cfg.killed || cfg.mock || cfg.local) { log.log?.(`[drafts-bg] first drafts ${cfg.killed ? 'off (DRAFTS_BG_OFF)' : cfg.mock ? 'off (AI mock)' : cfg.local ? 'off here (local)' : 'already on'}`); return false; }
    timer = setTimeout(function go() { leaderOnly(tick).catch((e) => log.warn?.('[drafts-bg] tick', e.message)).finally(() => { timer = setTimeout(go, cfg.tickMs); timer.unref?.(); }); }, cfg.firstMs); timer.unref?.();
    if (cfg.readyMs > 0) { watcher = setInterval(() => { leaderOnly(watch).catch((e) => log.warn?.('[drafts-bg] ready watch', e.message)); }, cfg.readyMs); watcher.unref?.(); }
    return true; };
  return { cfg, tick, watch, start, runOne, opened, stateOf, cacheOf, busy: () => busy.size };
}

/* ---------- the jam: a cached draft becomes the jam's first draft ---------- */
// called when a jam is made for a card: the draft is copied in (ready, marked as made by Brew before the jam opened)
export function seedDrafts(w, c, firstDrafts = {}, { uid = () => 'dr' + Math.random().toString(36).slice(2, 10), at = Date.now() } = {}) {
  if (!w || !c || (w.drafts || []).length) return false;
  const d = draftFor(c, firstDrafts); if (!d) return false;
  const { cardId, key, k, kind, format, cardTitle, usd, bg, wants, motion, retried, failedAt, fails, ip, imgText, imgRetry, clipRetry, checkedAt, photoOnly, retryAt, prev, takes, takeDay, take, videoDay, clipStill, poster, clipHead, headSmall, labelApprox, ...rest } = d;
  const asked = (x) => (['image', 'carousel', 'video', 'voice', 'text'].includes(x) ? x : 'auto'), seed = (x, o = {}) => ({ ...x, id: uid('dr'), asked: asked(x.as), state: 'ready', step: null, at, doneAt: at, by: 'Brew', seeded: true, ...o });
  /* an image ad with its daily clip opens as two drafts: the static as made, and the clip (9:16, from its own first frame) */
  const clip = clipStill && rest.video ? seed({ ...rest, as: 'video', image: clipStill, render: undefined, ratio: '9:16' }) : null;
  const main = clip ? seed((({ video: _v, audio: _a, ...x }) => x)(rest)) : seed(rest);
  /* the takes before this one, older below: the jam keeps them as versions */
  const older = (prev || []).filter((x) => x && (x.image || x.render || x.video || x.slides?.length)).map((x) => seed(x, { at: x.at || at, doneAt: x.at || at, take: true }));
  w.drafts = [main, ...(clip ? [clip] : []), ...older];
  return true;
}
