// The per-brand build: paste a URL, and this reads the brand, writes the brief, writes all its moves (the
// core "Know the brand" set first), turns each move into feed cards as it lands, and renders the Brew PDFs.
// Every stage writes to the brand pack (brand-pack.js) and to status.json, so a restart resumes where it was.
// Events are kept per brand and replayed, so the onboarding screen and anyone opening later see the same read.
import { safeFetch } from './reader/util.js'; // user-pasted links reach only the public internet
import { emailHtml, esc as mailEsc, p as mailP, list as mailList, images as mailImages } from './mail-layout.js';
import { teamRecipients } from './digest.js'; // who hears about a brand: its team, its starter and anyone who asked, minus mail off
import crypto from 'node:crypto';
import { adCall } from './reader/adlib.js';
import { ADS_V } from './reader/stages/ads.js';
import { SITE_V, speedOn } from './reader/stages/site.js';
import { namedStale } from './reader/stages/named.js';
import { wiping } from './retire.js';
import { sentenceCase } from './text-fit.js';
import path from 'node:path';
import fs from 'node:fs';
import { slugOf, moneyFmt } from './brand-pack.js';
import { isFullAccess } from './auth.js'; // SquareUp's people and ADMIN_EMAILS
import { skeletonSeed, seedFromProfile } from './seed-template.js';
import { factsFromLedger, configFromProfile, laneProducts, marketConfig } from './derive.js';
import { retiredSet, scrubRetired, allowedFrom } from './fact-gate.js';
import { createCardsGen } from './cards-gen.js';
import { marketFor, applyMarket, nameOf } from './market.js'; // the selling market, kept apart from the registered country
import { realRows, evidenceRows, privId } from './connectors/common.js'; // DUMMY: simulated account rows are never evidence; stale ones stop being evidence
import { healthFrom, geoOf } from './health.js';
import { isPlay, playDone, totalOf, numbersFor, healSeedNumbers, withNumbers, reviewsCap } from './pack-numbers.js'; // one number, one source
import { waitingOnCheck, awaitingCheck } from './confirm-remind.js'; // a brand whose moves wait on "Check what we read"
import { createStatics, teamStaticCards, teamStaticsDue } from './statics.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mergeLedger, diffLedgers, candidates, triage, changeLine, liveMaterial, handleOfItem, productNames, movesNaming, CONNECTED_MOVES } from './refresh.js';
import { withLearned, briefView } from './brand-learnings.js';
import { profileLive, withLive, settleWait, connectTargets } from './on-connect.js'; // what a real connected account corrects in the team's view
import { briefWithConnected, cleanBrief, renderBrief } from './brief.js'; // what the team told Brew survives a fresh brief; a saved brief heals its "null" cells
import { aiPaused } from './ai.js'; // a billing pause: the build says so and resumes, never writes a mock
import { providerNow, geminiModel } from './gemini-client.js';
import { KINDS, flagKind, runKind, potOf, potLeft, potAdd, potFit, perMove, capOf as potCapOf, nextWeek } from './rewrite-pot.js'; // one weekly rewrite budget a brand
import { moveLabel, moveNum, moveSay } from './move-label.js'; // weekly moves read "Weekly move 11", never "Move 1011" (QA FEED-QA-12)
import { markMoveClaims, sourceText } from './claims.js'; // move PDFs mark a claim the store never made, like the page

const buildCtx = new AsyncLocalStorage(); // which brand's build a paid call belongs to
// addresses that must never be read or built (wrong links, removals): BUILD_BLOCK=slug;slug (deploy.sh needs ; since its env list is comma-separated)
export const blocked = (slug) => wiping(slug) || String(process.env.BUILD_BLOCK || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean).includes(slug); // a reset brand (retire.js) too

const WAVE_A = [1, 2, 3, 9, 10, 4, 5, 6, 7, 8];
/* the build's own moves: the index (00) and the 50 core moves. Listening-era specs (51-65), dynamic specs (100+) and
   cadence moves (moves-cadence.js) are not counted toward "51 of 51" */
export const isCore = (n) => Number.isInteger(+n) && +n >= 0 && +n <= 50;
/* the brand's playbook, one count everywhere (status, progress card, Build tab, emails, feed): every move the build writes
   (1-999: core, listening-era specs once their evidence exists, dynamic specs), never the index (00) or cadence moves (1001+).
   Its size is the applicable specs, saved as status.total by the moves engine; 50 until the engine has counted */
export { isPlay, playDone, totalOf }; // one definition, in pack-numbers.js
/* a value that carries something: not null, not an empty string, array or object of empties */
export const hasData = (v) => v == null ? false : typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) ? v.some(hasData) : typeof v === 'object' ? Object.values(v).some(hasData) : typeof v === 'number' ? Number.isFinite(v) : true;
/* keep the old value of every field the fresh read left blank (a stage that failed or found nothing is not a change) */
const keepOld = (o, n) => { if (!hasData(n)) return o; if (!o || typeof o !== 'object' || Array.isArray(o) || typeof n !== 'object' || Array.isArray(n)) return n; const out = { ...o }; for (const [k, v] of Object.entries(n)) if (hasData(v)) out[k] = v; return out; };
/* the new profile on a refresh: the fresh read for what changes (catalog, reviews, ads, AI answers, search, checkout), the
   brand's own corrections and its rival list kept; a rival the read found again gets its new prices and ads. A section or
   a social the read returned blank keeps what was there. */
export const mergeProfile = (o, n) => {
  if (!o) return n; const p = structuredClone(o);
  const mine = (o.catalog?.products || []).filter((x) => x.addedByBrand);
  if ((n.catalog?.products || []).length) p.catalog = { ...n.catalog, hero: o.catalog?.hero?.length ? o.catalog.hero : n.catalog.hero, removed: o.catalog?.removed || [], products: [...mine, ...n.catalog.products.filter((x) => !mine.some((y) => y.handle === x.handle))] };
  for (const k of ['reviews', 'ads', 'ai', 'search', 'site']) if (hasData(n[k])) p[k] = keepOld(o[k], n[k]);
  if (o.reviews?.brandSource) p.reviews = { ...(p.reviews || {}), brandSource: o.reviews.brandSource };
  if (o.ads?.own?.page && !p.ads?.own?.page) p.ads = { ...(p.ads || {}), own: { ...(p.ads?.own || {}), page: o.ads.own.page } };
  if (n.socials) { p.socials = { ...(o.socials || {}) }; for (const [k, v] of Object.entries(n.socials)) if (hasData(v)) p.socials[k] = v; if (o.socials?.instagram?.handle) p.socials.instagram = o.socials.instagram; }
  const nr = new Map((n.rivals || []).map((r) => [r.host, r]));
  p.rivals = (o.rivals || []).map((r) => (nr.has(r.host) ? { ...r, ...Object.fromEntries(Object.entries(nr.get(r.host)).filter(([, v]) => hasData(v))), name: r.name, why: r.why, how: r.how } : r));
  p.refreshedAt = new Date().toISOString();
  return p;
};
/* price/mrp/product ledger entries of products the brand removed: they are no longer evidence */
export const removedKeys = (handles = []) => { const hs = new Set((handles || []).filter(Boolean)); return (e) => { const k = String(e?.key || ''); return hs.size > 0 && /^(price|mrp)\./.test(k) && hs.has(k.slice(k.indexOf('.') + 1)); }; };
/* did the read open the store at all? (reader/index.js: the open step is done only when the home page loaded) */
export const storeOpened = (out) => out?.opened !== false && (out?.findings?.steps || []).find((s) => s.k === 'open')?.state !== 'empty';
/* the client address behind Cloud Run: the right-most x-forwarded-for entry is the one Google's front end appended;
   TRUSTED_PROXY_HOPS skips that many more trusted entries (1 behind a Google load balancer) */
export const clientIp = (req, hops = +process.env.TRUSTED_PROXY_HOPS || 0) => { const xs = String(req?.headers?.['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean); return xs.length ? xs[Math.max(0, xs.length - 1 - hops)] : String(req?.socket?.remoteAddress || ''); };
const CONFIRM_WAIT = +process.env.BUILD_CONFIRM_WAIT_MS || 15 * 60e3; // the brief waits this long for "Check what we read", then goes with what was read
/* when Brew starts writing without the check: CONFIRM_WAIT after the wait began or after someone on the team last opened the
   check page, from the saved timestamps (status.waitingSince, status.checkOpenAt), so a restart or a deploy never starts the
   clock again and a brand is never stalled by frequent deploys */
/* once a time has been said (status.writeAt), it is the time: the banner, the wait screen, the check page and the timer all keep it
   (QA 19 Oct: the first open of the check page slid it once after the banner had shown an earlier one) */
export const confirmDueAt = (s, wait = CONFIRM_WAIT) => +s?.writeAt > 0 ? +s.writeAt : Math.max(+s?.waitingSince || 0, +s?.checkOpenAt || 0) + wait;
/* what the brief is written from, field by field (short hashes): a check after the build started that changes one of these
   rewrites the brief and the first wave of moves (confirm → recheck → lateCheck) */
const hash8 = (v) => crypto.createHash('sha1').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 8);
export const briefSig = (p = {}) => ({ name: hash8(p?.name || null), descriptor: hash8(p?.descriptor || p?.tagline || null), category: hash8(p?.category || null),
  products: hash8([p?.catalog?.hero || [], p?.catalog?.removed || [], (p?.catalog?.products || []).filter((x) => x?.addedByBrand).map((x) => x.handle)]),
  rivals: hash8((p?.rivals || []).map((r) => r?.host || r?.name)), market: hash8([p?.market?.primary || p?.country || null, p?.currency || null]) });
export const sigChanged = (a, b) => (!a || !b ? [] : Object.keys(b).filter((k) => a[k] !== b[k]));
const FIELD_WORDS = { name: 'the brand name', descriptor: 'the one-line description', category: 'the category', products: 'the hero products', rivals: 'the rivals', market: 'the selling market' };
const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] || '');
const RETRY_MAX = +(process.env.BUILD_RETRY_MAX || 6); // tries for moves that failed twice before the brand is Ready without them

export function createBuilder({ ROOT, packs, ai, treg, image = null, onPack = () => {}, onCards = () => {}, log = console, caps = {}, modules = null, signGate = () => false }) {
  const BUILD_CAP = +process.env.BUILD_CAP_USD || caps.build || 60; // every move at Opus medium effort with the shared brand cache: about $25-35
  const DAY_CAP = +process.env.DAILY_BUILD_CAP_USD || caps.day || 200;
  const PRO_CAP = +process.env.BUILD_CAP_PRO_USD || caps.buildPro || Math.max(150, BUILD_CAP * 2.5); // a Pro brand: every move written
  const IP_GAP = 60 * 60e3;
  const S = new Map(); // slug → { events, listeners, status, confirmed, abort }
  const byIp = new Map();
  /* today's spend across brands: rolled over by date on every read (a cap hit yesterday never blocks today), and kept in
     the pack store (_brew/spend-day.json) so a restart does not reset it */
  const dayKey = () => new Date().toISOString().slice(0, 10);
  const day = { d: dayKey(), usd: 0, loaded: false };
  const today = () => { const d = dayKey(); if (day.d !== d) Object.assign(day, { d, usd: 0 }); return day; };
  const dayUsd = () => today().usd;
  const loadDay = async () => { if (day.loaded) return; day.loaded = true; const j = await Promise.resolve().then(() => packs.getJSON('_brew', 'spend-day.json', null)).catch(() => null); if (j?.d === today().d) day.usd = Math.max(day.usd, +j.usd || 0); };
  let daySave = null;
  const saveDay = () => { if (daySave) return; daySave = setTimeout(() => { daySave = null; Promise.resolve().then(() => packs.put('_brew', 'spend-day.json', { d: day.d, usd: +day.usd.toFixed(3) })).catch(() => {}); }, 5000); daySave.unref?.(); };
  let mods = null;
  const load = async () => mods ||= modules || { /* modules: tests pass their own reader, brief, moves engine and renderer */
    reader: await import('./reader/index.js').catch((e) => { log.error('[build] reader missing', e.message); return null; }),
    brief: await import('./brief.js').catch((e) => { log.error('[build] brief missing', e.message); return null; }),
    moves: await import('./moves-engine.js').catch((e) => { log.error('[build] moves engine missing', e.message); return null; }),
    pdf: await import('./pdf/render.js').catch((e) => { log.error('[build] pdf renderer missing', e.message); return null; })
  };
  const cardsGen = createCardsGen({ ai, log });
  // every Claude and treg call made inside a build is charged to that brand
  const onSpend = (tag, usd) => { const slug = buildCtx.getStore(); if (slug) charge(slug)(tag, usd); };
  ai.onCharge?.(onSpend); treg.onCharge?.(onSpend);

  /* paid jobs that run beside a build or rewrite (the ad statics): counted for paidWork(), which deploy.sh asks before a deploy */
  let statics = 0; const held = (fn) => { statics++; return fn().finally(() => { statics--; }); };
  /* what paid work this instance is doing now (builds, rewrites, update checks, statics), by kind and without brand names */
  const paidWork = () => { const by = { build: 0, rewrite: 0, check: 0, statics }; for (const x of S.values()) { if (x.running && !x.confirmed) by[x.rewriting ? 'rewrite' : 'build']++; /* a read waiting for the owner's check (x.confirmed is its wake-up) spends nothing */ if (x.checking) by.check++; } return by; };
  /* a deploy or scale-down: SIGTERM (server.js) calls stop(), no new move starts on this instance, every run leaves its brand
     unfinished (not done, not capped) and the next instance's resumeAll() carries on with the moves not yet saved. Only the
     moves in flight at that second are written again, so a deploy never has to wait for a build. */
  let stopping = false; const stop = () => { stopping = true; };
  const st = (slug) => { let x = S.get(slug); if (!x) S.set(slug, x = { events: [], listeners: new Set(), status: null, confirmed: null, running: false, inflight: new Map(), failed: new Map() }); return x; };
  const emit = (slug, ev) => { const x = st(slug); const e = { ...ev, at: Date.now() }; x.events.push(e); if (x.events.length > 2000) x.events.shift(); x.listeners.forEach((f) => { try { f(e); } catch {} }); };
  const subscribe = (slug, f, { replay = true } = {}) => { const x = st(slug); if (replay) x.events.forEach(f); x.listeners.add(f); return () => x.listeners.delete(f); };
  const status = async (slug) => st(slug).status || (st(slug).status = await packs.getJSON(slug, 'status.json', null));
  const setStatus = async (slug, patch) => {
    if (blocked(slug)) return {};
    const cur = (await status(slug)) || {};
    const s = { ...cur, ...patch, stages: { ...(cur.stages || {}), ...(patch.stages || {}) }, updatedAt: Date.now() };
    st(slug).status = s; await packs.put(slug, 'status.json', s); emit(slug, { type: 'status', status: s }); return s;
  };
  const stage = (slug, k, state, extra = {}) => setStatus(slug, { stages: { [k]: { state, at: Date.now(), ...extra } } });
  // spend: one meter per brand, from both clients; a build stops cleanly at its cap
  const spentFor = (slug) => (st(slug).usd || 0);
  const charge = (slug) => (tag, usd) => { const x = st(slug); x.usd = (x.usd || 0) + usd; today().usd += usd; saveDay(); };
  const capOf = (slug) => (st(slug).status?.pro ? PRO_CAP : BUILD_CAP);
  const capHit = (slug) => blocked(slug) || spentFor(slug) >= capOf(slug) || dayUsd() >= DAY_CAP || !!st(slug).cancelled;
  // a stopped build (wrong site, abuse): cancel.json in the pack; checked before every paid stage
  const cancelled = async (slug) => { const x = st(slug); if (x.cancelled) return true; const c = await packs.getJSON(slug, 'cancel.json', null); if (c?.cancelled) x.cancelled = true; return !!x.cancelled; };
  const halt = async (slug) => { if (blocked(slug)) throw Object.assign(new Error('blocked'), { cancelled: true }); if (await cancelled(slug)) { await setStatus(slug, { state: 'Stopped', cancelled: true, error: 'cancelled' }); throw Object.assign(new Error('cancelled'), { cancelled: true }); } };

  /* ---------- start a brand ---------- */
  const byUser = new Map(); // email → [started at, …] today
  const madeToday = async (email) => { const all = await packs.list().catch(() => []), now = Date.now(); /* only brands started in the last day are opened */
    const by = await Promise.all(all.filter((x) => now - (+x.status?.createdAt || 0) < 864e5).map((x) => packs.getJSON(x.slug, 'private/created.json', null).catch(() => null)));
    return by.filter((c) => c?.by === email && now - (+c.at || 0) < 864e5).map((c) => +c.at); };
  /* two starts of the same address at once (two tabs, a double click, two instances) make one paid run: on this instance the
     second waits for the first and joins it; across instances a short-lived marker in the pack (start-lock.json, written
     before anything else) tells the other one to join instead of starting or resuming a second run */
  const starting = new Map(), INSTANCE = crypto.randomBytes(6).toString('hex'), LOCK = 'start-lock.json', LOCK_MS = +process.env.START_LOCK_MS || 5 * 60e3;
  const otherStart = async (slug) => { const lk = await packs.getFreshJSON(slug, LOCK, null).catch(() => null); return lk && lk.by !== INSTANCE && Date.now() - (+lk.at || 0) < LOCK_MS ? lk : null; };
  async function start(url, o = {}) {
    const slug = slugOf(String(url || '').trim()), was = slug && starting.get(slug);
    if (was) { const r = await was.catch(() => null); if (r?.slug) return { slug: r.slug, existing: true, status: await status(r.slug) }; } /* the first failed (a limit, a bad address): this one is judged on its own */
    const p = start0(url, o); if (slug && !was) { starting.set(slug, p); p.catch(() => {}).finally(() => { if (starting.get(slug) === p) starting.delete(slug); }); }
    return p;
  }
  /* admin: a Shopify Admin API snapshot (reader/stages/admin.js adminCatalog) for a store behind Shopify's password page, from the
     Shopify app (shopify-app.js startRead): saved privately, and every read of the brand opens from it while the store stays closed */
  async function start0(url, { ip, user = null, fresh = false, admin = null } = {}) {
    const raw = String(url || '').trim(); const slug = slugOf(raw);
    if (blocked(slug)) return { error: 'This address can’t be read here.' };
    /* the host is lower-cased before it is judged: ARATA.IN or https://Arata.In/… is the same site, as the landing already says (QA 19 Oct) */
    const host = raw.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/^www\./i, '').toLowerCase();
    if (!slug || !/\.[a-z]{2,}/.test(host)) return { error: 'That doesn’t look like a website. Try yourbrand.com' };
    const prev = await status(slug);
    /* another instance is starting this brand right now: join its run, never start (or resume) a second one */
    if (await otherStart(slug)) return { slug, existing: true, status: prev || (await packs.getFreshJSON(slug, 'status.json', null).catch(() => null)) || { slug, host: slug, state: 'Reading the site' } };
    if (prev?.cancelled && !fresh) return { error: 'This address was stopped. Ask Brew to restart it.' };
    if (prev && !fresh) { if (!st(slug).running && !prev.done) resume(slug).catch((e) => log.error('[build] resume', slug, e.message)); return { slug, existing: true, status: prev }; }
    if (prev && fresh && (st(slug).running || st(slug).checking)) return { error: 'This brand is being written right now. Restart it once this run stops.' };
    const PER_USER = +process.env.BUILD_PER_USER_DAY || 3, mine = (byUser.get(user?.email) || []).filter((t) => Date.now() - t < 864e5);
    /* the count survives a deploy: each brand's saved created stamp (private/created.json), not only this instance's memory (QA 19 Oct) */
    const made = user && !process.env.BUILD_NO_IP_LIMIT && !isFullAccess(user.email) ? Math.max(mine.length, (await madeToday(user.email)).length) : 0;
    if (user && made >= PER_USER && !process.env.BUILD_NO_IP_LIMIT && !isFullAccess(user.email)) return { error: `${PER_USER} new brands a day per person. Open one you already started, or try again tomorrow.` };
    if (!user && ip && Date.now() - (byIp.get(ip) || 0) < IP_GAP && !process.env.BUILD_NO_IP_LIMIT) return { error: 'One new brand an hour from the same network. Open one you already started, or try again later.' };
    await loadDay(); if (dayUsd() >= DAY_CAP) return { error: 'Today’s reading budget is used up. Try again tomorrow.' };
    if (user) byUser.set(user.email, [...mine, Date.now()]); else if (ip) byIp.set(ip, Date.now());
    await packs.put(slug, LOCK, { at: Date.now(), by: INSTANCE }); /* first, before the starter files: the other instances join */
    st(slug).events.length = 0; /* a new read starts a new story: viewers replay only this run's events */
    if (prev && fresh) await resetPack(slug);
    st(slug).status = {}; /* a new status, not merged over the last run's stages, PDFs and counts */
    /* the starter files go up together: one after another kept the person on the landing for 3-5s */
    await Promise.all([packs.put(slug, 'seed.json', skeletonSeed({ slug, host })), packs.put(slug, 'facts.json', {}), packs.put(slug, 'config.json', { countryName: '', questions: [], rivals: [] }),
      user ? packs.put(slug, 'private/created.json', { by: user.email, at: Date.now() }).catch(() => {}) : null, admin ? packs.put(slug, ADMIN_SNAP, admin) : null]);
    await setStatus(slug, { slug, host, url: /^https?:/i.test(raw) ? raw.replace(/^(https?:\/\/)([^/?#]+)/i, (_, a, h) => a.toLowerCase() + h.toLowerCase()) : 'https://' + host, name: host, createdAt: Date.now(), stages: {}, ready: false, done: false, state: 'Reading the site', error: null, cancelled: null, freshRead: !!(prev && fresh),
      /* born: the brand's first read on Brew; a re-read keeps it, a wipe ends it, and a browser that saved another born forgets its onboarding */
      born: prev?.born || Date.now(), ...(prev?.seenAt ? { seenAt: prev.seenAt } : {}), source: admin ? { kind: 'shopify-admin', shop: admin.shop?.myshopify || null, at: admin.at } : prev?.source || null }); /* a restart keeps reading from the admin */
    packs.drop(slug); await onPack(slug);
    resume(slug).catch((e) => log.error('[build]', slug, e));
    return { slug, status: await status(slug) };
  }

  /* an explicit restart: the last run's read, brief and moves go to archive/<stamp>/ and the pack starts empty, so the
     read, the brief, every move, its cards and its PDF are made again; a stop (cancel.json) is lifted */
  async function resetPack(slug) {
    const x = st(slug), stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const f of ['profile.json', 'ledger.json', 'findings.json', 'brief.json', 'brief.md', 'moves.json', 'labels.json', 'status.json', 'cost.json']) {
      const b = await packs.get(slug, f).catch(() => null); if (b) await packs.put(slug, `archive/${stamp}/${f}`, b).catch(() => {}); }
    const old = await packs.getJSON(slug, 'moves.json', {}) || {}, keep = Object.fromEntries(Object.entries(old).filter(([k, m]) => !isCore(k) && m?.meta?.cadence));
    await packs.put(slug, 'profile.json', 'null'); await packs.put(slug, 'ledger.json', []); await packs.put(slug, 'findings.json', 'null');
    await packs.put(slug, 'brief.json', 'null'); await packs.put(slug, 'brief.md', ''); await packs.put(slug, 'moves.json', keep); await packs.put(slug, 'labels.json', {});
    await packs.put(slug, 'cancel.json', { cancelled: false, liftedAt: Date.now() });
    const was = +(await packs.getJSON(slug, 'cost.json', null))?.usd || 0; await packs.put(slug, 'cost.json', { usd: 0, before: +(Math.max(was, x.usd || 0)).toFixed(3) }); /* the per-build cap counts this run; the last run's spend is kept */
    Object.assign(x, { cancelled: false, usd: 0, usdLoaded: true, confirmed: null }); x.inflight.clear(); x.failed.clear();
  }

  /* the Admin API snapshot a read opens from: a brand started from the Shopify app whose store is (still) behind the password
     page. Once a heal sees the store open (profile.closed gone), reads go back to the public site */
  const ADMIN_SNAP = 'private/admin-catalog.json';
  const adminFor = async (slug, s, profile = undefined) => {
    if (s?.source?.kind !== 'shopify-admin') return null;
    const p = profile === undefined ? await packs.getJSON(slug, 'profile.json', null).catch(() => null) : profile;
    return p && !p.closed ? null : packs.getJSON(slug, ADMIN_SNAP, null).catch(() => null);
  };
  /* a newer snapshot (the Shopify app takes one when the merchant opens it while the store is closed) */
  const saveAdmin = async (slug, snap) => { const s = await status(slug); if (!snap?.shop || s?.source?.kind !== 'shopify-admin') return false;
    await packs.put(slug, ADMIN_SNAP, snap); await setStatus(slug, { source: { ...s.source, at: snap.at } }); return true; };
  const makeReader = (m) => m.reader.createReader({ ai, treg, log, saveAsset: async (sl, name, buf, type) => { const n = String(name).replace(/[^a-zA-Z0-9._-]+/g, '-'); await packs.put(sl, 'assets/' + n, buf, type); return `/b/${sl}/a/${n}`; },
    saveRaw: (sl, name, data) => packs.put(sl, `raw/${new Date().toISOString().slice(0, 10)}/${String(name).replace(/[^a-zA-Z0-9._-]+/g, '-')}`, data),
    loadRaw: async (sl, name) => { const f = path.join(packs.dirOf(sl), 'raw', new Date().toISOString().slice(0, 10), String(name).replace(/[^a-zA-Z0-9._-]+/g, '-')); if (!fs.existsSync(f)) return null; const b = fs.readFileSync(f); const t = b.toString('utf8'); try { return JSON.parse(t); } catch { return t; } } });
  /* Demo Mode's tour: read the store again, live, only to show it happening. Nothing is saved over the brand's read
     (profile, ledger, findings stay as built; photos it fetches join the pack's assets). The site is fetched fresh every time; paid lookups (treg, the AI) reuse
     the day's shared answers, so only the first tour of a day pays for them */
  async function readLive(slug, { onEvent = () => {}, signal } = {}) {
    const s = await status(slug); if (!s?.url) throw new Error('unknown brand');
    const m = await load(); if (!m.reader) throw new Error('reader not installed');
    const paidOnly = (name) => /^(treg|ai)\//.test(String(name));
    const reader = m.reader.createReader({ ai, treg, log,
      saveAsset: async (sl, name, buf, type) => { const n = String(name).replace(/[^a-zA-Z0-9._-]+/g, '-'); await packs.put(sl, 'assets/' + n, buf, type); return `/b/${sl}/a/${n}`; }, /* photos the cards show */
      saveRaw: (sl, name, data) => (paidOnly(name) ? packs.put(sl, `raw/${new Date().toISOString().slice(0, 10)}/${String(name).replace(/[^a-zA-Z0-9._-]+/g, '-')}`, data) : Promise.resolve()),
      loadRaw: async (sl, name) => (paidOnly(name) ? packs.getJSON(sl, `raw/${new Date().toISOString().slice(0, 10)}/${String(name).replace(/[^a-zA-Z0-9._-]+/g, '-')}`, null) : null) });
    return reader.read(s.url, { fresh: false, onEvent, signal, admin: await adminFor(slug, s) });
  }
  // the brand's spend survives a restart (cost.json is written as it goes)
  const restoreSpend = async (slug) => { const x = st(slug); if (x.usdLoaded) return; x.usdLoaded = true; const c = await packs.getJSON(slug, 'cost.json', null); x.usd = Math.max(x.usd || 0, +c?.usd || 0); };
  const saveSpend = (slug) => packs.put(slug, 'cost.json', { usd: +spentFor(slug).toFixed(3) }).catch(() => {});

  /* a build out of budget pauses with the reason: its own cap (capped, a raised cap and Retry continue it) or today's
     shared budget (not capped, so the next restart or Retry carries on tomorrow) */
  async function budgetPause(slug, n) {
    if (blocked(slug) || !capHit(slug) || st(slug).cancelled) return false;
    const own = spentFor(slug) >= capOf(slug);
    await setStatus(slug, own ? { state: `Paused at the spend cap ($${capOf(slug)}). ${n} of ${totalOf(await status(slug))} moves written.`, capped: true } : { state: `Paused: today’s reading budget is used up. ${n} of ${totalOf(await status(slug))} moves written; it carries on tomorrow.`, capped: null, pausedDay: dayKey() });
    return true;
  }
  /* ---------- the pipeline (idempotent: every stage skips what is already in the pack) ---------- */
  const resume = (slug) => buildCtx.run(slug, () => run(slug));
  async function run(slug) {
    if (blocked(slug)) return;
    const x = st(slug); if (x.running) return; x.running = true;
    const m = await load(); await restoreSpend(slug); await loadDay();
    try {
      let s = await status(slug);
      /* a new run clears the last one's error and retry note (list() hides a brand whose status keeps an error) */
      if (s?.error || s?.retryMoves || s?.aiPausedAt) s = await setStatus(slug, { error: null, retryMoves: null, retryAt: null, aiPausedAt: null });
      /* 1. read the site */
      let profile = await packs.getJSON(slug, 'profile.json'), ledger = await packs.getJSON(slug, 'ledger.json', []), findings = await packs.getJSON(slug, 'findings.json');
      if (!profile) {
        if (!m.reader) throw new Error('reader not installed');
        await halt(slug); if (await budgetPause(slug, 0)) return;
        await stage(slug, 'read', 'running'); await setStatus(slug, { state: 'Reading the site', error: null }); /* a new run clears the last one's error, or the brand stays hidden */
        const reader = makeReader(m);
        const out = await reader.read(s.url, { fresh: !!s.freshRead, onEvent: (e) => emit(slug, { type: 'reader', ev: e }), admin: await adminFor(slug, s, null) });
        /* the store did not open: nothing to write a brief or moves from, so stop here without spending more */
        if (!storeOpened(out)) { await packs.put(slug, 'findings.json', out.findings || null).catch(() => {}); await stage(slug, 'read', 'failed');
          await setStatus(slug, { state: out.closed ? `${s.host || 'The store'} is behind Shopify’s password page, so its site can’t be read. Open Brew from your Shopify admin to read it from there.` : `We could not open ${s.host || 'the store'}. Check the address and try again.`, error: 'store did not open', unreadable: true, ...(out.closed ? { closed: true } : {}) }); return; }
        ({ profile, ledger, findings } = out);
        normalizeProfile(profile);
        await packs.put(slug, 'profile.json', profile); await packs.put(slug, 'ledger.json', ledger); await packs.put(slug, 'findings.json', findings);
        await stage(slug, 'read', 'done', { findings: findings?.cards?.length || 0 });
      } else { normalizeProfile(profile); await replayRead(slug, findings); await stage(slug, 'read', 'done', { cached: true }); }
      await publishBase(slug, profile, ledger, findings);
      /* "waiting for you" only while the check is still open: a resume after the check (or after the wait ended) keeps its own state */
      s = await setStatus(slug, { name: profile.name || s.host, logo: profile.identity?.logo || null, ...(s.stages?.confirm?.state !== 'done' ? { state: 'Waiting for you to check what we read' } : {}) });
      const instant = instantCards(slug, profile, ledger).catch((e) => log.warn('[build] instant', e.message)); /* awaited before the moves stage: it writes seed.json like cardsFor does, so the two never cross */
      emit(slug, { type: 'read-done' });

      /* 2. "Check what we read": wait for the brand's corrections (or move on) */
      if (!s.stages?.confirm || s.stages.confirm.state !== 'done') {
        /* the wait is stamped once: a restart doesn't make a day-old wait look new (confirm-remind.js reminds from it) */
        if (s.stages?.confirm?.state !== 'waiting') await stage(slug, 'confirm', 'waiting');
        if (!(await status(slug))?.waitingSince) await setStatus(slug, { waitingSince: Date.now() });
        /* a confirmation is stored (status.confirmedAt), so a click before this point is honoured, not lost */
        /* a brand read by someone not signed in waits for a signed-in confirm with no time limit: the moves are the expensive part */
        const anon = await anonOf(slug);
        /* the honest wait: Brew goes on with what it read at writeAt (confirmDueAt, from saved timestamps) unless someone checks first */
        await setStatus(slug, { writeAt: anon ? null : confirmDueAt(await status(slug)) });
        if (!(await status(slug))?.confirmedAt) await waitForCheck(slug, anon);
        x.confirmed = null;
        await stage(slug, 'confirm', 'done'); await setStatus(slug, { writeAt: null }); /* started: confirmedAt says whether it was checked first */
        ({ profile, ledger } = { profile: await packs.getJSON(slug, 'profile.json'), ledger: await packs.getJSON(slug, 'ledger.json', []) });
        normalizeProfile(profile);
        await publishBase(slug, profile, ledger, findings);
      }

      await halt(slug);
      /* 3. the brand brief */
      let brief = await packs.getJSON(slug, 'brief.json');
      if (brief) brief = await healBrief(slug, brief, profile);
      if (!brief) {
        if (!m.brief) throw new Error('brief writer not installed');
        if (await budgetPause(slug, 0)) return;
        await stage(slug, 'brief', 'running'); await setStatus(slug, { state: 'Writing the brand brief' });
        brief = await writeBrief(slug, m, profile, ledger);
        await stage(slug, 'brief', 'done'); packs.drop(slug); await onPack(slug);
      }

      await halt(slug); await instant;
      /* 4. the moves: wave A (know the brand) first, then the rest; each one becomes cards as it lands */
      if (!m.moves) throw new Error('moves engine not installed');
      const eng = m.moves.createMovesEngine({ ai, treg, log });
      const pack = () => packs.load(slug);
      const briefMd = (await packs.get(slug, 'brief.md'))?.toString('utf8') || '';
      const cache = await packs.getJSON(slug, 'moves.json', {});
      await stage(slug, 'moves', 'running'); await setStatus(slug, { state: 'Writing the moves' });
      const saved = new Set(Object.entries(await packs.getJSON(slug, 'moves.json', {})).filter(([k, mv]) => isPlay(k, mv)).map(([k]) => +k)); /* the playbook only: not the index, not cadence moves */
      let total = totalOf(await status(slug));
      let pdfQueue = Promise.resolve(), staticsJob = Promise.resolve(), firstSent = false;
      let lock = Promise.resolve(); // moves finish in parallel; their pack writes go one at a time
      const save = (n, move) => (lock = lock.then(() => saveOne(n, move)).catch((e) => log.warn('[build] save', n, e.message)));
      const saveOne = async (n, move) => {
        x.inflight.delete(n); x.failed.delete(n);
        await packs.put(slug, `moves/${String(n).padStart(2, '0')}.json`, move);
        /* the build owns moves 00-50; cadence moves (51+) written meanwhile are kept as they are on disk */
        const cur = await packs.getJSON(slug, 'moves.json', {}), own = (o, keep) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => keep(+k)));
        const all = { ...own(cur, (k) => k > 50), ...own(cache, (k) => k <= 50), [n]: move }; await packs.put(slug, 'moves.json', all); if (isPlay(n, move)) saved.add(+n);
        emit(slug, { type: 'move', n, title: move.title, stat: move.stat, gives: move.gives, verified: !!move.meta?.verified });
        if (n !== 0) await cardsFor(slug, move, profile).catch((e) => log.warn('[build] cards', n, e.message));
        if (n === 21) staticsJob = makeStatics(slug, move, profile, (fn) => (lock = lock.then(fn).catch((e) => log.warn('[build] statics card', e.message))));
        await progressCard(slug, saved.size, move, total);
        const done = saved.size, waveA = WAVE_A.every((k) => saved.has(k));
        const s1 = await status(slug); /* the pace this run really keeps: the last 12 saves (pack-numbers.js movesEta) */
        await setStatus(slug, { movesDone: done, paceAt: [...(s1?.paceAt || []), Date.now()].slice(-12), ready: waveA || s1?.ready, state: done >= total ? `All ${total} moves written` : `Writing the moves: ${done} of ${total}` });
        if (waveA && !firstSent) { firstSent = true; notify(slug, 'first').catch((e) => log.warn('[notify]', e.message)); }
        await unmarkPdf(slug, n); /* PDFs are made when someone opens one (pdfOn), never in the build */
        packs.drop(slug); await onPack(slug); saveSpend(slug);
      };
      const NUM = await numbersFor(packs.getJSON, slug, { 'profile.json': profile }); /* the moves quote today's counts, each with the day it was read */
      const ctx = { brand: { name: profile.name, host: profile.host, descriptor: profile.descriptor }, brief: { md: briefMd, json: brief }, profile, ledger: withNumbers(ledger, NUM, profile.name), numbers: NUM, packs, slug,
        load: (n) => cache[n] || null, save: async (n, move) => { cache[n] = move; await save(n, move); }, canSpend: () => !stopping && !capHit(slug),
        effort: process.env.MOVES_EFFORT || 'medium', search: +(process.env.MOVES_SEARCH ?? 1),
        onTotal: async (N, applicable) => { total = N; await setStatus(slug, { total: N, applicable }); },
        onStart: (n) => { x.inflight.set(n, Date.now()); x.failed.delete(n); emit(slug, { type: 'move-start', n }); },
        onFail: (n, e) => { x.inflight.delete(n); x.failed.set(n, { msg: String(e?.message || e).slice(0, 160), at: Date.now() }); emit(slug, { type: 'move-failed', n, msg: String(e?.message || e).slice(0, 160) }); } };
      if (cache[21] && staticsUnset((await status(slug))?.statics)) staticsJob = makeStatics(slug, cache[21], profile, (fn) => (lock = lock.then(fn).catch((e) => log.warn('[build] statics card', e.message))));
      let res = await eng.runAll(ctx, { concurrency: +process.env.MOVES_CONCURRENCY || 6, waveA: WAVE_A });
      // a move that failed gets one more pass once the rest are written (a cut-off reply, a busy model)
      if (!stopping && !capHit(slug) && (res.applicable || []).some((n) => !cache[n])) { await lock; log.warn('[build] second pass for', slug); res = await eng.runAll(ctx, { concurrency: 4, waveA: WAVE_A }); }
      await lock; await staticsJob;
      if (res.errors?.length) log.warn('[build] moves with errors', slug, res.errors.map((e) => e.n + ': ' + e.error).join('; '));
      if (await cancelled(slug)) { await setStatus(slug, { state: `Stopped. ${saved.size} of ${total} moves written.`, cancelled: true, error: 'cancelled' }); return; }
      if (stopping && (res.applicable || []).some((n) => !cache[n])) { await setStatus(slug, { state: `Brew is restarting; the rest of the moves carry on in a moment. ${saved.size} of ${total} written.` }); log.warn(`[build] ${slug}: stopping with ${saved.size} of ${total}, the next instance resumes`); return; } /* not done, not capped: resumeAll picks it up */
      /* a build stopped at its own spend cap stops for good (until Pro or a raised cap): the team hears what was written */
      if (await budgetPause(slug, saved.size)) { if ((await status(slug))?.capped && saved.size) await notify(slug, 'all', { capped: true }).catch((e) => log.warn('[notify]', e.message)); return; }
      /* moves that failed twice (a cut-off reply, a busy model, the AI paused for credit) are not "Ready": the brand stays
         unfinished and the hourly tick (autoRefresh) or the next boot (resumeAll) carries on, bounded by the build cap */
      const missing = (res.applicable || []).filter((n) => !cache[n]);
      /* bounded: after RETRY_MAX tries (a move that fails every time, not a busy minute) the brand is Ready with those moves
         named as not written, instead of retrying all day; a billing pause never counts as a try */
      const tries = (+(await status(slug))?.retryN || 0) + (aiPaused() ? 0 : 1);
      if (missing.length && tries > RETRY_MAX) { log.warn(`[build] ${slug}: ${missing.length} moves still missing after ${RETRY_MAX} retries; marking Ready`); await setStatus(slug, { missingMoves: missing, retryN: null }); }
      else if (missing.length) {
        const why = aiPaused() ? 'AI is paused (credit); Brew carries on when it is back' : 'Brew retries within the hour';
        await setStatus(slug, { state: `${missing.length} move${missing.length === 1 ? '' : 's'} still to write; ${why}. ${saved.size} of ${total} written.`, retryMoves: missing.length, retryN: tries, retryAt: Date.now(), error: null, ...(aiPaused() ? { aiPausedAt: Date.now() } : {}) });
        log.warn(`[build] ${slug}: ${missing.length} moves still to write after two passes`); return;
      }
      await stage(slug, 'moves', 'done');
      await pdfQueue;
      await setStatus(slug, { done: true, ready: true, state: 'Ready', usd: +spentFor(slug).toFixed(2), doneAt: Date.now(), error: null, retryMoves: null, retryN: null, retryAt: null, aiPausedAt: null, ...(missing.length ? {} : { missingMoves: null }) });
      await notify(slug, 'all').catch((e) => log.warn('[notify]', e.message));
    } catch (e) { if (e.cancelled) return;
      /* the AI paused for credit (the brief, or anything before the moves): a pause, not a stop. No error (that hides the brand
         and resumeAll skips it); the hourly tick carries on once the pause lifts */
      if (e.billing) { log.warn('[build] AI paused', slug, e.message); await setStatus(slug, { state: 'Paused: the AI is paused (credit). Brew carries on when it is back.', aiPausedAt: Date.now(), retryAt: Date.now() }); return; }
      log.error('[build] failed', slug, e); await setStatus(slug, { state: 'Stopped: ' + e.message, error: e.message }); }
    finally { x.running = false; await packs.put(slug, 'cost.json', { usd: +spentFor(slug).toFixed(3) }).catch(() => {}); setTimeout(() => drain(slug).catch((e) => log.warn('[rewrite] drain', e.message)), 0); /* learnings that arrived mid-build */
      upd(slug).then((u) => { if (u.connectRun) armConnect(slug, u.connectRun.due || 0); }).catch(() => {}); /* an account connected while the moves were being written */ }
  }

  /* the brief writer, one place for the build and a late check: what the team told Brew stays in it (learned.json) */
  async function writeBrief(slug, m, profile, ledger) {
    await setStatus(slug, { briefFromAt: Date.now() }); /* what it is written from is read now: a correction after this needs another brief */
    const out = await m.brief.createBrief({ ai, log }).write(profile, ledger);
    const brief = out.json || {}, told = await packs.getJSON(slug, 'learned.json', null).catch(() => null); /* learnings added before a fresh read stay in the brief */
    if (told) brief.learned = briefView(told);
    await packs.put(slug, 'brief.md', told ? withLearned(out.md || '', told, { name: profile.name }) : out.md || ''); await packs.put(slug, 'brief.json', brief);
    return brief;
  }
  /* a read started by someone not signed in (no private/created.json) waits for a signed-in check, with no time limit */
  const anonOf = async (slug) => !!signGate() && !(await packs.getJSON(slug, 'private/created.json', null).catch(() => null));
  /* wait for "Check what we read": a confirm wakes it at once (x.confirmed); otherwise it goes at confirmDueAt, worked out again
     from the saved status on every wake, so a later check-page open pushes it out and a restart never starts the clock over */
  const waitForCheck = (slug, anon) => new Promise((res) => {
    const x = st(slug); let t = null, over = false;
    const go = () => { if (over) return; over = true; clearTimeout(t); res(); };
    x.confirmed = go;
    const arm = async () => { if (over) return; const s1 = (await status(slug)) || {}; if (s1.confirmedAt) return go(); if (anon) return;
      const ms = confirmDueAt(s1) - Date.now(); if (ms <= 0) return go(); t = setTimeout(() => arm().catch(() => go()), Math.min(ms + 50, 2 ** 31 - 1)); };
    arm().catch(() => go());
  });
  // a read that is already in the pack (a restart, or a brand opened again): play its real findings back, step by step
  async function replayRead(slug, findings) {
    if (!findings?.steps) return;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    /* the onboarding's saved taps (findings.picks) follow the step that found them: who you are after brand, products after
       catalog, rivals after ads (they are found just before it); whatever is left goes after the last step */
    const PICK_STEP = { who: 'brand', catalog: 'catalog', rivals: 'ads' }, picks = findings.picks || {}, sent = new Set();
    const sendPicks = (k) => { for (const [pk, items] of Object.entries(picks)) if (!sent.has(pk) && (k == null || (PICK_STEP[pk] || 'answers') === k)) { sent.add(pk); emit(slug, { type: 'reader', ev: { type: 'picks', k: pk, items } }); } };
    for (const [i, st] of findings.steps.entries()) {
      for (const tk of (st.tick || []).filter((x) => x && x !== '…').slice(0, 2)) { emit(slug, { type: 'reader', ev: { type: 'step', k: st.k, i, state: 'reading', tick: tk } }); await wait(500); }
      for (const c of (findings.cards || []).filter((c) => c.k === st.k)) { emit(slug, { type: 'reader', ev: { type: 'finding', k: st.k, i, finding: c, say: c.say } }); await wait(1400); }
      emit(slug, { type: 'reader', ev: { type: 'step', k: st.k, i, state: st.state === 'empty' ? 'empty' : 'done', done: st.done } }); sendPicks(st.k); await wait(300);
    }
    sendPicks(null);
  }
  /* a saved brief whose rows carry the word "null" (an empty MRP, price or note written by the model) is cleaned and its
     page drawn again, once; the team's learnings section is laid in again as the build does (brief.js cleanBrief) */
  async function healBrief(slug, brief, profile) {
    const { brief: b, changed } = cleanBrief(brief); if (!changed) return brief;
    try {
      const told = await packs.getJSON(slug, 'learned.json', null).catch(() => null), md = renderBrief(b, b.at || new Date().toISOString().slice(0, 10));
      await packs.put(slug, 'brief.json', b); await packs.put(slug, 'brief.md', told ? withLearned(md, told, { name: profile?.name }) : md);
      packs.drop(slug); log.info?.(`[build] ${slug}: healed the brief's empty cells`);
    } catch (e) { log.warn('[build] heal brief', slug, e.message); }
    return b;
  }
  // prices as the brand writes them, on every product
  function normalizeProfile(p) {
    const fmt = moneyFmt(p.currency || 'INR', p.locale || 'en-IN');
    if (p.catalog?.products) { const gone = new Set(p.catalog.removed || []); p.catalog.products = p.catalog.products.filter((x) => !gone.has(x.handle) && !/gift ?wrap|gift ?card|e-?gift|shipping protection|route protection/i.test(x.title || '')); }
    (p.catalog?.products || []).forEach((x) => { if (x.price != null && !x.priceLabel) x.priceLabel = fmt(+x.price); });
    return p;
  }
  // seed, facts and config from what was read; the feed can open as soon as this lands
  async function publishBase(slug, profile, ledger, findings) {
    const seed0 = await packs.getJSON(slug, 'seed.json', {});
    const extra = { marketplaces: (profile.reviews?.platforms || []).map((x) => x.name).filter((n) => /amazon|flipkart|nykaa|myntra|walmart|target|etsy|ebay|blinkit|zepto|meesho|purplle|tira/i.test(n)) };
    const seed = seedFromProfile(slug, profile, findings, extra);
    seed.posts = (seed0.posts || []).map((c) => (c.lane && !seed.lanes[c.lane] ? { ...c, lane: Object.keys(seed.lanes)[0] } : c)); // cards already written stay, on a lane that still exists
    const N = await numbersFor(packs.getJSON, slug, { 'profile.json': profile }); healSeedNumbers(seed, N, profile.name); /* the read's steps quote the one count of each */
    seed.health = healthFrom(profile, N); /* the health rings, from what the read found (health.js) */
    seed.geo = geoOf(seed.health) || { score: 0, band: 'Not read yet' };
    const facts = factsFromLedger(withNumbers(ledger, N, profile.name), { host: profile.host }); /* the current counts, each with its day, replace the read's older rows */
    const cfg = configFromProfile(profile, extra);
    const cfg0 = (await packs.getJSON(slug, 'config.json', {})) || {};
    Object.assign(cfg, laneProducts(seed, profile), { statics: cfg0.statics || [] }); /* a re-read keeps the finished statics */
    if (cfg0.questionsV) Object.assign(cfg, { questions: cfg0.questions, questionsV: cfg0.questionsV, questionsMethod: cfg0.questionsMethod, rivalsAI: cfg0.rivalsAI || cfg.rivalsAI }); /* and the questions sourced from real searches (ai-questions.js), with the team's own */
    await packs.put(slug, 'seed.json', seed); await packs.put(slug, 'facts.json', facts); await packs.put(slug, 'config.json', cfg);
    packs.drop(slug); await onPack(slug);
  }
  /* the statics job never finished: nothing saved, a failed set, or a "running" older than an hour (the instance that ran it
     was replaced and the state never resolved) */
  const STATICS_STALE_MS = 3600e3;
  const staticsUnset = (s) => !s || s.state === 'failed' || (s.state === 'running' && Date.now() - (+s.at || 0) > STATICS_STALE_MS);
  // static ads from Move 21 (statics.js): about 8 images, then one batch card the brand can pick from
  function makeStatics(slug, move, profile, withLock, { priv = false } = {}) {
    if (!image || !mods.pdf?.launchBrowser) return Promise.resolve();
    if (priv) return makeTeamStatics(slug, move, profile, withLock);
    return held(async () => {
      if (capHit(slug)) return;
      await setStatus(slug, { statics: { state: 'running', at: Date.now() } });
      try {
        const p = await packs.load(slug);
        const { ids } = await createStatics({ ai, image, packs, launchBrowser: mods.pdf.launchBrowser, log }).make(slug, { move, profile, facts: p.facts });
        await withLock(async () => {
          const cfg = await packs.getJSON(slug, 'config.json', {}); cfg.statics = ids; await packs.put(slug, 'config.json', cfg);
          const seed = await packs.getJSON(slug, 'seed.json', {});
          const card = { id: 'statics-batch', agent: 'creative', sector: 'creatives', type: 'idea', lane: Object.keys(seed.lanes || { core: 1 })[0], roles: ['brand', 'growth', 'founder'], src: 'Move 21 · static ads', time: '5 min', kind: 'media', origin: 'build',
            images: ids.map((id) => `b/${slug}/statics/${id}.jpg`), campaign: 'From your ad plan',
            title: `${ids.length} ads from your ad plan, ready to review`, sub: `Each one puts a real ${profile.name} product photo in a new scene, with a headline from Move 21. Keep the ones you like, jam on any of them, and download the batch for your team to run.`,
            detail: { why: ['Concepts come from the ad-creative move.', 'Every number on them is in your fact sheet.'], how: ['Open the batch and keep or drop each ad.', 'Edit any of them in the studio.', 'Download the kept ones for your team to run.'] }, cta: { label: 'Open the batch' } }; /* Brew runs nothing: the batch opens in a jam and downloads for the team */
          seed.posts = [card, ...(seed.posts || []).filter((x) => x.id !== card.id)];
          await packs.put(slug, 'seed.json', seed); packs.drop(slug); await onPack(slug); onCards(slug, [card], { replace: true });
        });
        await setStatus(slug, { statics: { state: 'done', n: ids.length } });
        emit(slug, { type: 'statics', n: ids.length });
      } catch (e) { log.warn('[build] statics', e.message); await setStatus(slug, { statics: { state: 'failed', err: e.message.slice(0, 120) } }); }
    });
  }
  /* the team's set is made once: a failed or cut-off try is tried again at most once a day (STATICS_RETRY_MS), never on every
     private rewrite of Move 21 (a connected run used to start a fresh, paid set each time it touched 21) */
  const staticsDue = (s0) => teamStaticsDue(s0, { retryMs: +(process.env.STATICS_RETRY_MS ?? 24 * 3600e3) });
  /* the team's static ads, from their private rewrite of Move 21 (written with the connected accounts): the images and their
     words stay in private/ and reach members only, as cards in private/cards.json whose images the team route serves
     (/b/<slug>/team/statics/<id>.jpg, signed-in members only). Made once, like the public set; state in private/statics-state.json */
  function makeTeamStatics(slug, move, profile, withLock) {
    return held(async () => {
      if (capHit(slug)) return;
      await packs.put(slug, 'private/statics-state.json', { state: 'running', at: Date.now(), move: move.meta?.rewrittenAt || move.meta?.at || null });
      try {
        const p = await packs.load(slug), facts = { ...p.facts, ...((await packs.getJSON(slug, 'private/facts.json', null))?.facts || {}) };
        const { ids, text } = await createStatics({ ai, image, packs, launchBrowser: mods.pdf.launchBrowser, log }).make(slug, { move, profile, facts, priv: true });
        await withLock(async () => {
          const seed = await packs.getJSON(slug, 'seed.json', {}), lane = Object.keys(seed.lanes || { core: 1 })[0];
          const cards = teamStaticCards(slug, ids, text, { lane, name: profile.name, titleOf: (h) => (profile.catalog?.products || []).find((x) => x?.handle === h)?.title || '' });
          const pc = (await packs.getJSON(slug, 'private/cards.json', [])).filter((c) => !/^(static-|statics-batch)/.test(c.id));
          await packs.put(slug, 'private/cards.json', [...pc, ...cards]); onCards(slug, cards, { replace: true, private: true });
        });
        await packs.put(slug, 'private/statics-state.json', { state: 'done', n: ids.length, at: Date.now(), move: move.meta?.rewrittenAt || move.meta?.at || null });
        emit(slug, { type: 'statics', n: ids.length, private: true });
      } catch (e) { log.warn('[build] team statics', e.message); await packs.put(slug, 'private/statics-state.json', { state: 'failed', err: e.message.slice(0, 120), at: Date.now() }); }
    });
  }
  /* the team's statics from the team's Move 21 as it is saved now (an ops probe, or a brand whose private 21 was written
     before team statics existed): the same once-only job a private rewrite starts */
  async function teamStatics(slug) {
    const m21 = (await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({})))?.[21]; if (!m21) return { error: 'no team Move 21' };
    if (!realRows(await packs.getJSON(slug, 'private/connected-ledger.json', [])).length) return { error: 'no real connected account' };
    const profile = withLive(normalizeProfile(await packs.getJSON(slug, 'profile.json')), await packs.getJSON(slug, 'private/profile-live.json', null));
    let lock = Promise.resolve(); await makeStatics(slug, m21, profile, (fn) => (lock = lock.then(fn)), { priv: true }); await lock;
    return (await packs.getJSON(slug, 'private/statics-state.json', null)) || {};
  }
  // the feed's first cards, straight from the read (before any move is written): only what was observed
  async function instantCards(slug, profile, ledger) {
    const seed = await packs.getJSON(slug, 'seed.json', {}); if ((seed.posts || []).some((c) => c.origin === 'read')) return;
    const p = await packs.load(slug);
    const cards = await cardsGen.fromRead(profile, { brand: { name: profile.name, host: profile.host }, facts: p.facts, lanes: p.seed.lanes, laneImg: p.seed.laneImg }).catch((e) => { log.warn('[build] instant cards', e.message); return []; });
    if (!cards.length) return;
    seed.posts = [...cards, ...(seed.posts || [])]; await packs.put(slug, 'seed.json', seed); packs.drop(slug); await onPack(slug); onCards(slug, cards);
  }
  // one Brew card that tracks the moves being written, refreshed as each lands
  async function progressCard(slug, done, last, total) {
    total ||= totalOf(await status(slug));
    const seed = await packs.getJSON(slug, 'seed.json', {});
    const c = { id: 'build-moves', agent: 'brew', sector: 'signals', type: 'report', lane: Object.keys(seed.lanes || { core: 1 })[0], roles: ['founder', 'growth', 'brand', 'ecom', 'crm'], src: 'The ShopOS team, Brew’s build crew', time: '1 min', kind: 'rows', origin: 'build', boostFor: { founder: 6, growth: 3, brand: 3, ecom: 3, crm: 3 },
      badge: [done >= total ? 'All written' : `${done} of ${total} written`, done >= total ? 'ok' : 'info'],
      title: done >= total ? `All ${total} moves for ${seed.brand?.name} are written` : `Writing your ${total} moves: ${done} done`,
      sub: `Each move is a full plan with sources, a 30-day rollout and what to watch. ${last?.title ? `The latest: ${last.title}.` : ''} Open the Moves page to read them; any move downloads as a PDF.`.slice(0, 240),
      rows: [['Written', `${done} of ${total}`], ['Latest', String(last?.title || '').slice(0, 44)]], detail: { why: ['Every card in this feed comes from one of these plans.'], how: ['Open the Moves page.', 'Read any move, or download its PDF.'] }, cta: { label: 'Open the moves' } };
    seed.posts = [c, ...(seed.posts || []).filter((x) => x.id !== c.id)];
    await packs.put(slug, 'seed.json', seed); onCards(slug, [c], { replace: true });
  }
  /* the read's ledger plus every real connected account's numbers (public marketplaces and the team's private accounts) */
  async function mergedLedger(slug, base = null) {
    const conn = [...evidenceRows(await packs.getJSON(slug, 'connected-ledger.json', [])), ...evidenceRows(await packs.getJSON(slug, 'private/connected-ledger.json', []))]; /* a stale account's rows are not evidence */
    return mergeLedger(base || await packs.getJSON(slug, 'ledger.json', []), [], { connected: conn }).ledger;
  }
  async function cardsFor(slug, move, profile, { replace = false, priv = false } = {}) {
    const p = await packs.load(slug); const specs = mods.moves?.SPECS || {};
    const ledger0 = await packs.getJSON(slug, 'ledger.json', []).catch(() => []);
    /* a member's cards check their numbers against the same evidence the rewrite used: the read plus the real connected accounts */
    const ledger = priv ? await mergedLedger(slug, ledger0) : ledger0;
    /* a member's rewrite also reads the connected facts (private/facts.json); numbers that stopped being true (facts-edits.json retired) leave the move before it backs a card */
    const facts = priv ? { ...p.facts, ...((await packs.getJSON(slug, 'private/facts.json', null))?.facts || {}) } : p.facts;
    const retired = retiredSet((await packs.getJSON(slug, 'facts-edits.json', null))?.retired, allowedFrom(facts));
    const learnedJ = await packs.getJSON(slug, 'learned.json', null).catch(() => null); /* the brand's style, the team's learnings and the cards already in the feed make the next cards specific and unrepeated (cards-gen.js) */
    const { cards, label } = await cardsGen.fromMove(scrubRetired(move, retired), { brand: { name: profile.name, host: profile.host }, profile, config: p.config || null, learned: learnedJ, seen: (p.seed?.posts || []), facts, lanes: p.seed.lanes, laneImg: p.seed.laneImg, spec: Array.isArray(specs) ? specs.find((x) => x.n === move.n) : specs[move.n], ledger: ledger || [] });
    // written from a connected account: the cards go to the team only (private/cards.json), never into the shared seed
    if (priv) { if (!cards.length) return; const own = new RegExp(`^m${String(move.n).padStart(2, '0')}-`), pc = (await packs.getJSON(slug, 'private/cards.json', [])).filter((c) => !own.test(c.id));
      const add = cards.map((c) => ({ ...c, id: privId(c.id), liveOnly: true, privateOf: move.n })); /* its own id: the shared card of the same move stays for everyone else */ await packs.put(slug, 'private/cards.json', [...pc, ...add]);
      onCards(slug, add, { replace: true, private: true }); emit(slug, { type: 'cards', n: move.n, private: true, cards: add.map((c) => ({ id: c.id, title: c.title, agent: c.agent })) }); return; }
    const labels = await packs.getJSON(slug, 'labels.json', {}); labels[move.n] = label; await packs.put(slug, 'labels.json', labels);
    if (!cards.length) return;
    const seed = await packs.getJSON(slug, 'seed.json', {});
    // a rewritten move replaces its own cards (ids mNN-i), in the feed too
    if (replace) { const own = new RegExp(`^m${String(move.n).padStart(2, '0')}-`); seed.posts = (seed.posts || []).filter((c) => !own.test(c.id)); }
    const have = new Set((seed.posts || []).map((c) => c.id));
    const add = cards.filter((c) => !have.has(c.id)); seed.posts = [...(seed.posts || []), ...add];
    await packs.put(slug, 'seed.json', seed); packs.drop(slug); await onPack(slug);
    if (add.length) { onCards(slug, add, replace ? { replace: true } : undefined); emit(slug, { type: 'cards', n: move.n, cards: add.map((c) => ({ id: c.id, title: c.title, agent: c.agent })) }); }
  }
  // status.pdfs is written by the build, rewrites and the weekly moves at once: one writer per brand, so no entry is lost
  const pdfLocks = new Map();
  const markPdf = (slug, n, file, ver) => { const p = (pdfLocks.get(slug) || Promise.resolve()).catch(() => {}).then(async () => { const s = (await status(slug)) || {}, cur = { ...(s.pdfs || {}) }, cv = { ...(s.pdfVer || {}) };
    if (file) { cur[n] = file; if (ver) cv[n] = ver; } else { if (!(n in cur)) return; delete cur[n]; delete cv[n]; } await setStatus(slug, { pdfs: cur, pdfVer: cv }); }); pdfLocks.set(slug, p); return p; };
  const unmarkPdf = (slug, n) => markPdf(slug, n, null); // a move written again: its old PDF no longer matches it
  // a render that fails is tried once more before it is logged (moves 02, 03 and 25 went missing that way)
  async function renderPdf(slug, pdf, move, profile, opts = {}) {
    try { return await renderPdf1(slug, pdf, move, profile, opts); }
    catch (e) { log.warn('[pdf] retry', slug, move?.n, e.message); await new Promise((r) => setTimeout(r, 2000)); return renderPdf1(slug, pdf, move, profile, opts); }
  }
  async function renderPdf1(slug, pdf, move, profile, { priv = false, ver = null } = {}) {
    const brand = { name: profile.name, descriptor: (profile.descriptor || profile.category || '').toUpperCase(), host: profile.host, hero: heroFile(slug, profile), colors: profile.identity?.colors || [], dateLabel: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase(), version: 'V1 · FOR DISCUSSION' };
    const out = path.join(packs.dirOf(slug), priv ? 'private/pdf' : 'pdf', pdf.pdfName(move));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const moves = move.n === 0 ? Object.values(await packs.getJSON(slug, 'moves.json', {})) : undefined; // the index lists every move
    await pdf.renderMove(move, brand, out, { moves });
    if (priv) { await packs.put(slug, 'private/pdf/' + path.basename(out), fs.readFileSync(out), 'application/pdf'); const pp = await packs.getJSON(slug, 'private/pdfs.json', {}); pp[move.n] = path.basename(out); await packs.put(slug, 'private/pdfs.json', pp); emit(slug, { type: 'pdf', n: move.n, private: true }); return; }
    await packs.put(slug, 'pdf/' + path.basename(out), fs.readFileSync(out), 'application/pdf');
    await markPdf(slug, move.n, path.basename(out), ver);
    emit(slug, { type: 'pdf', n: move.n, file: path.basename(out) });
  }
  const heroFile = (slug, p) => { const img = p.catalog?.products?.find((x) => x.img)?.img; const m = img && /^b\/[^/]+\/a\/(.+)$/.exec(String(img).replace(/^\//, '')); const f = m && path.join(packs.dirOf(slug), 'assets', m[1]); return f && fs.existsSync(f) ? f : null; };

  /* ---------- "Check what we read" ---------- */
  const SUMMARY = [
    ['name', 'Brand name', (p) => p.name], ['descriptor', 'What you are, in a line', (p) => p.descriptor || p.tagline], ['category', 'Category', (p) => p.category],
    ['country', 'Main selling market (country code)', (p) => p.country], ['currency', 'Currency', (p) => p.currency],
    ...[0, 1, 2, 3, 4].map((i) => [`product.${i}`, `Hero product ${i + 1}`, (p) => { const x = p.catalog?.products?.[i]; return x ? `${x.title} · ${x.priceLabel || x.price}` : ''; }]),
    ['rivals', 'Main rivals', (p) => (p.rivals || []).map((r) => r.name).join(', ')],
    ['founded', 'Founded', (p) => (typeof p.company?.founded === 'object' ? p.company?.founded?.v : p.company?.founded) || ''], ['founders', 'Founders', (p) => (p.company?.founders || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean).join(', ')],
    ['reviews', 'Reviews', (p) => p.reviews?.total ? `${p.reviews.total} reviews${p.reviews.platforms?.length ? ' on ' + p.reviews.platforms.map((x) => x.name).join(', ') : ''}` : ''],
    ['instagram', 'Instagram', (p) => p.socials?.instagram?.url || ''], ['adpage', 'Facebook page that runs your ads', (p) => p.ads?.own?.page || '']
  ];
  async function summary(slug) {
    const p = await packs.getJSON(slug, 'profile.json'); const L = await packs.getJSON(slug, 'ledger.json', []); if (!p) return { rows: [] }; normalizeProfile(p);
    const src = (k) => { const e = L.find((x) => x.key === k || x.key.startsWith(k + '.')); return e ? `${e.src || e.url}${e.at ? ', ' + String(e.at).slice(0, 10) : ''}` : null; };
    const SRC = { name: 'brand.name', descriptor: 'brand.descriptor', category: 'market.category', country: 'market.country', currency: 'market.currency', rivals: 'rival', founded: 'company.founded', founders: 'company.founders', reviews: 'reviews.total', instagram: 'social.instagram' };
    return { rows: SUMMARY.map(([key, label, f]) => ({ key, label, v: f(p) || '', src: src(SRC[key] || (key.startsWith('product.') ? 'price.' + (p.catalog?.products?.[+key.split('.')[1]]?.handle || '') : key)) || (key.startsWith('product.') ? p.catalog?.products?.[+key.split('.')[1]]?.url : null) })) };
  }
  // the brand's corrections become ledger entries marked as confirmed by the brand; they outrank what was read
  /* the confirmation is written to status first, then a waiting build is woken: a click at any point before the brief counts */
  async function markConfirmed(slug) { await setStatus(slug, { confirmedAt: Date.now() }); const f = st(slug).confirmed; st(slug).confirmed = null; f?.(); }
  /* a correction made after the build stopped waiting (the brief may already be written from the read): the fields that really
     changed are noted (status.checkTouched) until the confirm, which rewrites the brief and the first moves with them */
  async function noteLate(slug, before, after) {
    const s = await status(slug); if (s?.stages?.confirm?.state !== 'done') return []; /* still waiting: the build reads the corrections itself */
    const ch = sigChanged(briefSig(before), briefSig(after)); if (!ch.length) return [];
    await setStatus(slug, { checkTouched: [...new Set([...(s.checkTouched || []), ...ch])] }); return ch;
  }
  /* the confirm after a late correction: the brief and the moves written before it are rewritten once the build is free (lateCheck,
     run from drain); kept in status.recheck so a restart carries it */
  async function recheckIfLate(slug) {
    const s = await status(slug), what = [...new Set([...(s?.recheck?.what || []), ...(s?.checkTouched || [])])]; if (!s?.checkTouched?.length) return null;
    await setStatus(slug, { recheck: { at: Date.now(), what, tries: 0 }, checkTouched: null });
    log.log?.(`[check] ${slug}: corrected after the build started (${what.join(', ')}): the brief and the first moves are rewritten`);
    setTimeout(() => drain(slug).catch((e) => log.warn('[check] late', slug, e.message)), 0);
    return { what, words: andList(what.map((k) => FIELD_WORDS[k] || k)) };
  }
  async function confirm(slug, edits = [], v2 = null) {
    if (v2) { const r = await applyCheck(slug, v2); let rc = null; if (!r?.error) { await markConfirmed(slug); rc = await recheckIfLate(slug); } emit(slug, { type: 'confirmed', v2: true }); return rc ? { ...r, recheck: rc } : r; }
    const p = await packs.getJSON(slug, 'profile.json'), L = await packs.getJSON(slug, 'ledger.json', []); if (!p) return { ok: false };
    const before = structuredClone(p);
    const at = new Date().toISOString().slice(0, 10);
    for (const { key, v } of edits.slice(0, 30)) {
      const val = String(v || '').slice(0, 300);
      if (key === 'name') p.name = val; else if (key === 'descriptor') { p.descriptor = val; p.descriptorBy = 'brand'; } else if (key === 'category') p.category = val;
      else if (key === 'country') p.country = val.toUpperCase().slice(0, 2); else if (key === 'currency') p.currency = val.toUpperCase().slice(0, 3);
      else if (key === 'rivals') p.rivals = val.split(/\s*,\s*/).filter(Boolean).map((name) => (p.rivals || []).find((r) => r.name.toLowerCase() === name.toLowerCase()) || { name, why: 'named by the brand' });
      else if (key === 'founded') (p.company ||= {}).founded = val; else if (key === 'founders') (p.company ||= {}).founders = val.split(/\s*,\s*/).filter(Boolean);
      L.push({ key: key.startsWith('product.') ? `brand.confirmed.${key}` : ['country', 'currency', 'category'].includes(key) ? `market.${key}.confirmed` : `brand.${key}.confirmed`, label: `${key} (confirmed by the brand)`, v: val, layer: 'observed', src: 'Confirmed by the brand in Brew', at, method: 'brand-confirmed' });
    }
    await packs.put(slug, 'profile.json', p); await packs.put(slug, 'ledger.json', L);
    if (edits.some((x) => x.key === 'country')) await marketCheck(slug).catch((e) => log.warn?.('[market] check', slug, e.message));
    await noteLate(slug, before, p);
    await markConfirmed(slug); const rc = await recheckIfLate(slug); emit(slug, { type: 'confirmed', edits: edits.length });
    return { ok: true, ...(rc ? { recheck: rc } : {}) };
  }
  /* the late check's rewrite, once nothing else runs for the brand: the base (seed, facts, config) follows the corrected read, the
     brief is written again if it was written from the read before the correction, and the first wave of moves written before
     it is queued as "what the team told Brew" (the weekly pot's first kind, LEARN_CAP a run: within the caps). Billing pauses
     and the day's budget leave it for the next drain (the hourly tick); three failures drop it */
  async function lateCheck(slug) {
    const x = st(slug); if (x.running || x.checking || stopping || blocked(slug)) return false;
    x.running = true;
    let rc = null;
    try {
      const s0 = await status(slug); rc = s0?.recheck; if (!rc?.at) return false;
      if (s0.cancelled || (await cancelled(slug))) { await setStatus(slug, { recheck: null }); return false; }
      await loadDay(); if (dayUsd() >= DAY_CAP) { log.warn(`[check] ${slug}: the late rewrite waits for tomorrow's budget`); return false; }
      const m = await load(); await restoreSpend(slug);
      const profile = normalizeProfile(await packs.getJSON(slug, 'profile.json')), ledger = await packs.getJSON(slug, 'ledger.json', []); if (!profile) { await setStatus(slug, { recheck: null }); return false; }
      await publishBase(slug, profile, ledger, await packs.getJSON(slug, 'findings.json'));
      const words = andList((rc.what || []).map((k) => FIELD_WORDS[k] || k)) || 'what Brew read';
      /* the brief: only if it was written from the read before this correction (a brief started after it already has it) */
      const from = +s0.briefFromAt || +s0.stages?.brief?.at || 0, briefDone = s0.stages?.brief?.state === 'done' || !!(await packs.getJSON(slug, 'brief.json'));
      const rebrief = briefDone && from < rc.at && !!m.brief;
      if (rebrief) {
        await buildCtx.run(slug, async () => { await stage(slug, 'brief', 'running'); try { await writeBrief(slug, m, profile, ledger); } finally { await stage(slug, 'brief', 'done'); /* a failed try keeps the brief on file */ } });
        packs.drop(slug); await onPack(slug); saveSpend(slug);
        if (realRows(await packs.getJSON(slug, 'private/connected-ledger.json', [])).length) await teamView(slug).catch((e) => log.warn('[check] team view', e.message)); /* the team's brief follows (free) */
      }
      /* the first wave written before the correction: flagged with the reason (it becomes each move's "because") and queued */
      const moves = await packs.getJSON(slug, 'moves.json', {}), at = (mv) => Math.max(Date.parse(mv?.meta?.rewrittenAt || 0) || 0, Date.parse(mv?.meta?.at || 0) || 0);
      const ns = WAVE_A.filter((n) => moves[n] && !moves[n]?.meta?.cadence && at(moves[n]) < rc.at);
      if (ns.length) { await flagStale(slug, ns.map((n) => ({ n, priority: 'high', via: 'learnings', impact: 'high', why: `You corrected ${words} on the check page, so Brew rewrote this plan with it.`, changes: [] })));
        await enqueue(slug, ns, { via: 'learnings' }); }
      await setStatus(slug, { recheck: null, recheckDone: { at: Date.now(), what: rc.what || [], moves: ns.length } });
      emit(slug, { type: 'recheck', what: rc.what || [], moves: ns.length });
      log.log?.(`[check] ${slug}: late corrections (${words}): brief ${rebrief ? 'rewritten' : 'not rewritten (it had them, or is not written yet)'}, ${ns.length} first-wave moves queued`);
      return true;
    } catch (e) {
      log.warn('[check] late rewrite', slug, e.message);
      if (rc && !e.billing) { const tries = (+rc.tries || 0) + 1; await setStatus(slug, tries >= 3 ? { recheck: null, recheckFailed: { at: Date.now(), msg: String(e.message).slice(0, 160) } } : { recheck: { ...rc, tries } }).catch(() => {}); }
      return false;
    } finally { x.running = false; }
  }

  /* ---------- "Is this right?" v2: structured data, and edits that are choices or links (never retyped facts) ---------- */
  const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36' };
  const NOT_PRODUCT = /gift ?wrap|gift ?card|e-?gift|shipping protection|route protection|insurance|sample|tester|donation/i;
  const hostOf = (u) => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const srcOf = (L, keys) => { const e = L.find((x) => keys.some((k) => x.key === k || x.key.startsWith(k + '.'))); return e ? { src: e.src || hostOf(e.url || ''), url: e.url || null, at: String(e.at || '').slice(0, 10) } : null; };
  /* mend a saved read when the brand is opened: ads lookups that failed (or never found our own page) are run again,
     and the one-liner is written if Claude never wrote it. At most once a day per brand, never during a build. */
  const healing = new Set();
  /* the selling market is worked out again first (free: no AI, no fetch), even where the paid repairs below are off */
  async function heal(slug) {
    const mk = healing.has(slug) || blocked(slug) || st(slug).running || st(slug).checking || process.env.HEAL_OFF === '1' ? null : await marketCheck(slug).catch((e) => (log.warn?.('[market] heal', slug, e.message), null));
    const r = await healRead(slug);
    return mk ? ['market', ...(r || [])] : r;
  }
  async function healRead(slug) {
    if (healing.has(slug) || blocked(slug) || st(slug).running || st(slug).checking || process.env.AI_MOCK === '1' || process.env.HEAL_OFF === '1') return null;
    healing.add(slug);
    try {
      const p = await packs.getJSON(slug, 'profile.json'); if (!p?.host || !p.slug) return null;
      // healed today: wait a day; a heal that still hit errors tries again after an hour; a read from before a
      // stage changed (older ads version) or with no written one-liner heals now
      const outdated = (p.ads && p.ads.v !== ADS_V) || (p.site?.checkout && p.site.checkout.v !== SITE_V) || !['claude', 'brand'].includes(p.descriptorBy) || (!!p.host && !p.site?.pagespeed && speedOn()) || namedStale(p);
      const stillBroken = !!p.ads?.own?.error || (p.ads?.rivals || []).some((r) => r.error) || (!p.ai?.answers?.length && !!p.meta?.errors?.answers); /* the AI tools step failed in the read: ask again hourly */
      if (!outdated && p.meta?.healedAt && Date.now() - Date.parse(p.meta.healedAt) < (stillBroken ? 36e5 : 864e5)) return null;
      const reader = makeReader(await load()); if (!reader.heal) return null;
      const out = await reader.heal(p, { findings: await packs.getJSON(slug, 'findings.json'), ledger: await packs.getJSON(slug, 'ledger.json', []), log });
      if (!out) { p.meta = { ...(p.meta || {}), healedAt: new Date().toISOString(), healed: [] }; await packs.put(slug, 'profile.json', p); return null; }
      if (st(slug).running) return null; // a build started meanwhile: its read wins
      await packs.put(slug, 'profile.json', out.profile); await packs.put(slug, 'ledger.json', out.ledger); if (out.findings) await packs.put(slug, 'findings.json', out.findings);
      normalizeProfile(out.profile);
      if (await packs.getJSON(slug, 'seed.json', null)) await publishBase(slug, out.profile, out.ledger, out.findings).catch((e) => log.warn?.('[build] heal publish', slug, e.message));
      log.info?.(`[build] healed ${slug}: ${out.changed.join(', ')}`);
      return out.changed;
    } catch (e) { log.warn?.('[build] heal', slug, e.message); return null; }
    finally { healing.delete(slug); }
  }
  /* someone on the team opened the check page while the brand waits: Brew gives them the full wait from that first open
     (checkOpenAt), and says when it starts writing (writeAt). Once per build: a revisit never moves the time later (it drifted
     a minute on every visit), and a stamp from an earlier build (before this wait began) doesn't count */
  async function checkOpened(slug) {
    const s = await status(slug); if (!awaitingCheck(s) || s.confirmedAt || +s.checkOpenAt >= (+s.waitingSince || 0) && +s.checkOpenAt > 0) return;
    const patch = { checkOpenAt: Date.now() }; if (!(+s.writeAt > 0) && !(await anonOf(slug))) patch.writeAt = confirmDueAt({ ...s, ...patch }); /* a time already shown never moves */
    await setStatus(slug, patch);
  }
  async function checkData(slug, { heal: doHeal = true, opened = false } = {}) {
    if (doHeal) heal(slug).catch(() => {});
    if (opened) await checkOpened(slug).catch((e) => log.warn?.('[check] opened', slug, e.message));
    const p = await packs.getJSON(slug, 'profile.json'), L = await packs.getJSON(slug, 'ledger.json', []); if (!p) return { error: 'not read yet' };
    normalizeProfile(p);
    const prods = (p.catalog?.products || []).filter((x) => !NOT_PRODUCT.test(x.title || ''));
    const hero = new Set((p.catalog?.hero || []).filter((h) => prods.some((x) => x.handle === h)));
    if (!hero.size) prods.slice(0, 4).forEach((x) => hero.add(x.handle));
    const removed = new Set(p.catalog?.removed || []);
    const items = prods.filter((x) => !removed.has(x.handle)).sort((a, b) => (hero.has(b.handle) - hero.has(a.handle))).slice(0, 12)
      .map((x) => ({ handle: x.handle, title: x.title, price: x.priceLabel || '', img: x.img || (x.images || []).find((u) => /^https?:/.test(u)) || null, url: x.url || null, hero: hero.has(x.handle), added: !!x.addedByBrand }));
    const own = p.ads?.own || {}, ig = p.socials?.instagram, rv = p.reviews || {};
    const N = await numbersFor(packs.getJSON, slug, { 'profile.json': p }); /* the same numbers every other screen shows */
    const s0 = (await status(slug)) || {};
    return {
      name: p.name, host: p.host, logo: p.identity?.logo || null, count: N.products.n ?? prods.length, storeNote: N.storeNote || null, /* not Shopify, or no catalog read (pack-numbers.js storeNote) */
      /* when Brew starts writing with what it read unless someone checks first (null: it waits for a check, or it has started) */
      writeAt: awaitingCheck(s0) && !s0.confirmedAt ? s0.writeAt || null : null, started: s0.stages?.confirm?.state === 'done',
      who: [
        { key: 'name', label: 'Brand name', v: p.name || '', type: 'text', ...srcOf(L, ['brand.name']) },
        { key: 'descriptor', label: 'What you are, in one line', v: p.descriptor || p.tagline || '', type: 'text', ...srcOf(L, ['brand.descriptor', 'brand.tagline']) },
        { key: 'category', label: 'Category', v: p.category || '', type: 'text', ...srcOf(L, ['market.category']) },
        { key: 'country', label: 'Main selling market', v: p.country || '', type: 'country', ...srcOf(L, ['market.country']) },
        { key: 'currency', label: 'Currency', v: p.currency || '', type: 'currency', ...srcOf(L, ['market.currency']) }
      ],
      products: items,
      /* the one rival list, each with the freshest count of its live ads (pack-numbers.js rivals): the read and the stories say the same */
      rivals: (p.rivals || []).map((r) => { const x = N.rivals.find((y) => (r.host && y.host === r.host) || y.name === r.name); return { name: r.name, host: r.host, how: r.how || r.why || '', logo: r.logo || `https://www.google.com/s2/favicons?domain=${r.host}&sz=64`, prices: (r.prices || []).length, live: x?.live ?? null, liveAt: x?.at ? new Date(x.at).toISOString().slice(0, 10) : null, url: r.url || `https://${r.host}` }; }),
      sources: [
        { key: 'adpage', label: 'Facebook page that runs your ads', v: own.page ? `${own.page} · ${(N.ownAds.n ?? 0).toLocaleString('en-IN')} live ads` : own.error || N.ownAds.error || p.meta?.errors?.ads ? 'Couldn’t check this time' : 'Not found', /* a failed ads stage is not "Not found" */ url: own.pageId ? `https://www.facebook.com/ads/library/?view_all_page_id=${own.pageId}` : null, hint: 'Paste your Facebook page link if this is wrong', found: !!own.page },
        { key: 'instagram', label: 'Instagram', v: ig?.handle ? '@' + ig.handle : ig?.error || p.meta?.errors?.socials ? 'Couldn’t check this time' : 'Not found', /* a failed socials stage is not "Not found" */ url: ig?.url || null, hint: 'Paste your Instagram profile link', found: !!ig?.handle },
        { key: 'reviews', label: 'Reviews and ratings', v: reviewsCap(N)?.replace(/\.$/, '') || (N.reviews.n != null ? `${N.reviews.n.toLocaleString('en-IN')} reviews and ratings` : N.reviews.error ? 'Couldn’t check this time' : 'No reviews found') /* N.reviews.error carries a failed or timed-out reviews stage (pack-numbers.js) */, url: (rv.platforms || [])[0]?.url || null, hint: 'Paste the page where your reviews live (Judge.me, Loox, Amazon…)', found: N.reviews.n != null }
      ],
      company: [
        { key: 'founders', label: 'Founders', v: (p.company?.founders || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean).join(', '), type: 'text', ...srcOf(L, ['company.founders', 'company.founder']) },
        { key: 'founded', label: 'Founded', v: String((typeof p.company?.founded === 'object' ? p.company?.founded?.v : p.company?.founded) || ''), type: 'text', ...srcOf(L, ['company.founded']) }
      ]
    };
  }
  // a product page link → its real title, price and photo (Shopify's .js, else JSON-LD)
  async function readProduct(slug, url, p) {
    const u = String(url).split('?')[0].replace(/\/$/, '');
    let t = null, price = null, img = null, cur = p.currency;
    try { const r = await safeFetch(u + '.js', { headers: UA, signal: AbortSignal.timeout(20e3) }); if (r.ok) { const j = await r.json(); t = j.title; price = (j.price || 0) / 100; img = j.featured_image || j.images?.[0]; } } catch {}
    if (!t) { const r = await safeFetch(u, { headers: UA, signal: AbortSignal.timeout(25e3) }); const h = await r.text();
      for (const m of h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { const j = [].concat(JSON.parse(m[1])).flatMap((x) => x['@graph'] || [x]).find((x) => String(x['@type']).includes('Product')); if (j) { t = j.name; const o = [].concat(j.offers || [])[0] || {}; price = +o.price || +o.lowPrice || null; cur = o.priceCurrency || cur; img = [].concat(j.image || [])[0]; break; } } catch {} }
      t ||= (h.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1]; img ||= (h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || [])[1]; }
    if (!t) throw new Error('That page did not show a product.');
    if (img && img.startsWith('//')) img = 'https:' + img;
    let asset = null; if (img) try { const r = await safeFetch(img, { headers: UA, signal: AbortSignal.timeout(20e3) }); if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); const n = 'added-' + u.split('/').pop().replace(/[^a-z0-9-]/gi, '').slice(0, 40) + (img.includes('.png') ? '.png' : '.jpg'); await packs.put(slug, 'assets/' + n, b); asset = `/b/${slug}/a/${n}`; } } catch {}
    return { handle: u.split('/').pop(), title: String(t).trim(), price, currency: cur, img: asset, images: asset ? [asset] : [], url: u, inStock: true, addedByBrand: true, claims: [] };
  }
  // a rival's website → name, logo, a few live prices (Shopify), and its live ads by domain
  async function readRival(url, p) {
    const host = hostOf(url); if (!host) throw new Error('That doesn’t look like a website.');
    const r = await safeFetch(`https://${host}/`, { headers: UA, signal: AbortSignal.timeout(25e3) }); const h = await r.text();
    const name = ((h.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || [])[1] || (h.match(/<title>([^<|–-]+)/i) || [])[1] || host).trim().slice(0, 40);
    const prices = [];
    try { const j = await (await safeFetch(`https://${host}/products.json?limit=12${p.country ? `&country=${p.country}` : ''}`, { headers: UA, signal: AbortSignal.timeout(20e3) })).json(); (j.products || []).filter((x) => !NOT_PRODUCT.test(x.title)).slice(0, 6).forEach((x) => { const v = x.variants?.[0]; if (v?.price) prices.push({ title: x.title, price: +v.price, currency: p.currency, url: `https://${host}/products/${x.handle}` }); }); } catch {}
    let live = null; try { const k = await adCall(treg, 'scrapecreators.x.v1-facebook-adlibrary-search-ads', { query: { query: host, country: p.country || 'ALL', status: 'ACTIVE', trim: true }, tag: 'check-rival-ads' }); live = (k?.searchResults || []).filter((a) => String(a.snapshot?.link_url || '').includes(host)).length; } catch {}
    return { name, host, url: `https://${host}`, why: 'Named by the brand', how: 'named by the brand, site read live', prices, claims: [], offers: [], liveAds: live };
  }
  async function applyCheck(slug, b = {}) {
    const p = await packs.getJSON(slug, 'profile.json'), L = await packs.getJSON(slug, 'ledger.json', []); if (!p) return { error: 'not read yet' };
    const before = structuredClone(p);
    const at = new Date().toISOString().slice(0, 10), notes = [];
    const conf = (key, label, v, url) => L.push({ key, label, v: String(v), layer: 'observed', src: url ? hostOf(url) : 'Confirmed by the brand in Brew', url: url || null, at, method: 'brand-confirmed' });
    for (const [k, v] of Object.entries(b.who || {})) { const val = String(v || '').trim().slice(0, 200); if (!val) continue;
      if (k === 'name') p.name = val; if (k === 'descriptor') { p.descriptor = val; p.descriptorBy = 'brand'; } if (k === 'category') p.category = val; if (k === 'country') p.country = val.toUpperCase().slice(0, 2); if (k === 'currency') p.currency = val.toUpperCase().slice(0, 3);
      conf(['country', 'currency', 'category'].includes(k) ? `market.${k}.confirmed` : `brand.${k}.confirmed`, `${k} (confirmed by the brand)`, val); }
    p.catalog ||= {}; p.catalog.products ||= [];
    if (Array.isArray(b.hero)) p.catalog.hero = b.hero.slice(0, 12);
    if (Array.isArray(b.removed)) p.catalog.removed = [...new Set([...(p.catalog.removed || []), ...b.removed])];
    for (const u of (b.addProducts || []).slice(0, 6)) { try { const x = await readProduct(slug, u, p); p.catalog.products = [x, ...p.catalog.products.filter((y) => y.handle !== x.handle)]; p.catalog.removed = (p.catalog.removed || []).filter((h) => h !== x.handle); p.catalog.hero = [x.handle, ...(p.catalog.hero || []).filter((h) => h !== x.handle)];
      if (x.price) L.push({ key: `price.${x.handle}`, label: x.title, v: moneyFmt(x.currency || p.currency, p.locale)(x.price), n: x.price, unit: x.currency, layer: 'observed', src: hostOf(x.url) + new URL(x.url).pathname, url: x.url, at, method: 'product page (added by the brand)' }); } catch (e) { notes.push(`${u}: ${e.message}`); } }
    const rivals0 = (p.rivals || []).map((r) => r.name).join('|');
    if (Array.isArray(b.removeRivals)) p.rivals = (p.rivals || []).filter((r) => !b.removeRivals.includes(r.host));
    for (const u of (b.addRivals || []).slice(0, 6)) { try { const r = await readRival(u, p); p.rivals = [...(p.rivals || []).filter((x) => x.host !== r.host), r]; L.push({ key: `rival.${r.host.replace(/\./g, '-')}.found`, label: `Rival: ${r.name}`, v: r.host, layer: 'observed', src: r.host, url: r.url, at, method: 'brand-confirmed' });
      r.prices.forEach((x, i) => L.push({ key: `rival.${r.host.replace(/\./g, '-')}.price.${i + 1}`, label: `${r.name}: ${x.title}`, v: moneyFmt(p.currency, p.locale)(x.price), n: x.price, unit: p.currency, layer: 'observed', src: r.host, url: x.url, at, method: 'products.json' })); } catch (e) { notes.push(`${u}: ${e.message}`); } }
    const src = b.sources || {};
    if (src.instagram) { const h = (String(src.instagram).match(/instagram\.com\/([A-Za-z0-9_.]+)/) || [])[1]; if (h) { p.socials ||= {}; p.socials.instagram = { ...(p.socials.instagram || {}), url: `https://www.instagram.com/${h}`, handle: h }; conf('social.instagram.confirmed', 'Instagram (confirmed by the brand)', '@' + h, `https://www.instagram.com/${h}`); } else notes.push('That Instagram link did not look right.'); }
    if (src.adpage) { try { const m = String(src.adpage).match(/facebook\.com\/(?:profile\.php\?id=)?([A-Za-z0-9.\-]+)/); let pageId = /^\d+$/.test(m?.[1] || '') ? m[1] : null;
        if (!pageId && m) { const s2 = await adCall(treg, 'scrapecreators.x.v1-facebook-adlibrary-search-companies', { query: { query: m[1] }, tag: 'check-adpage' }); pageId = (s2?.searchResults || []).find((x) => (x.page_alias || '').toLowerCase() === m[1].toLowerCase())?.page_id || s2?.searchResults?.[0]?.page_id; }
        if (!pageId) throw new Error('We could not find that page in the Ad Library.');
        const k = await adCall(treg, 'scrapecreators.x.v1-facebook-adlibrary-company-ads', { query: { pageId, country: p.country || 'ALL', status: 'ACTIVE' }, tag: 'check-adpage-ads' });
        const rows = (k?.results || []); p.ads ||= {}; p.ads.own = { page: rows[0]?.page_name || m[1], pageId, live: k?.searchResultsCount ?? rows.length, items: p.ads.own?.items || [] };
        conf('ads.own.live', `Live Meta ads (${p.country || 'all countries'})`, String(p.ads.own.live), `https://www.facebook.com/ads/library/?view_all_page_id=${pageId}`); } catch (e) { notes.push(`Ad page: ${e.message}`); } }
    if (src.reviews) { const u = String(src.reviews).trim(); if (/^https?:\/\//.test(u)) { p.reviews ||= {}; p.reviews.brandSource = u; conf('reviews.source.confirmed', 'Where the brand says its reviews live', hostOf(u), u); notes.push('Saved that link for the team. Brew doesn’t read reviews from a pasted page yet.'); } }
    for (const [k, v] of Object.entries(b.company || {})) { const val = String(v || '').trim(); if (!val) continue; p.company ||= {};
      if (k === 'founders') p.company.founders = val.split(/\s*,\s*/).filter(Boolean); if (k === 'founded') p.company.founded = val;
      conf(`company.${k}.confirmed`, `${k} (confirmed by the brand)`, val, (b.companyLinks || {})[k] || null); }
    /* a product the brand removed stops being evidence: its price and list price leave the ledger (facts, brief, moves) */
    const gone = removedKeys(p.catalog.removed);
    await packs.put(slug, 'profile.json', p); await packs.put(slug, 'ledger.json', L.filter((e) => !gone(e)));
    if (b.who?.country) await marketCheck(slug).catch((e) => log.warn?.('[market] check', slug, e.message)); /* the brand's own market: its moves are marked for the weekly rewrite */
    /* the rival list changed: the config the stories read (research.js) and the read's steps follow it, so every screen names the same rivals */
    if ((p.rivals || []).map((r) => r.name).join('|') !== rivals0) await republish(slug).catch((e) => log.warn('[check] republish', slug, e.message));
    await noteLate(slug, before, p).catch((e) => log.warn('[check] late note', slug, e.message)); /* after the build stopped waiting: the confirm rewrites with it */
    return { ok: true, notes, data: await checkData(slug) };
  }

  /* ---------- "We will notify you once ready": emails for the brand's team ---------- */
  const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
  async function addEmail(slug, email) {
    const e = String(email || '').trim().toLowerCase(); if (!EMAIL.test(e)) return { error: 'That email doesn’t look right.' };
    const n = await packs.getJSON(slug, 'notify.json', { emails: [], sent: {} });
    if (!n.emails.some((x) => x.email === e)) { if (n.emails.length >= 20) return { error: 'This brand already has 20 people waiting.' }; n.emails.push({ email: e, at: Date.now() }); await packs.put(slug, 'notify.json', n); }
    const s0 = await status(slug); if (s0?.done) await notify(slug, 'all', { only: e }); // already finished: send now, to them
    return { ok: true };
  }
  /* one send at a time per brand, so two "first moves" triggers never both mail the same people */
  const nq = new Map();
  const notify = (slug, kind, extra = {}) => { const p = (nq.get(slug) || Promise.resolve()).catch(() => {}).then(() => notifyNow(slug, kind, extra)); nq.set(slug, p); return p; };
  /* everyone on the brand's team hears, not only the people who tapped "email me": the addresses in notify.json, the person who
     started the read and every member, once each, minus anyone who turned Brew's emails off (digest.js teamRecipients). A
     rewrite from the team's own accounts goes to the members only. One email per kind per person (notify.json sent). The demo
     site sends none. Every button lands in the product (?go=feed), never the read replay */
  async function notifyNow(slug, kind, extra = {}) {
    if (process.env.DEMO_MODE === '1') return;
    const n = (await packs.getJSON(slug, 'notify.json', null)) || {}; n.emails = Array.isArray(n.emails) ? n.emails : []; n.sent ||= {};
    const to = await teamRecipients(packs, slug, { extra: n.emails.map((x) => x?.email), membersOnly: !!extra.members }); if (!to.length) return;
    const key = process.env.RESEND_API_KEY; if (!key) return log.warn('[notify] no RESEND_API_KEY');
    const s0 = (await status(slug)) || {}, name = s0.name || slug, base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com';
    const moves = (await packs.getJSON(slug, 'moves.json', {})) || {}, total = totalOf(s0), done = Math.max(playDone(moves), kind === 'first' ? 0 : +s0.movesDone || 0);
    /* "all" is honest: a capped build or one Ready with moves it could not write says how many are in ({done} of {total}) */
    const partial = kind === 'all' && done < total, capped = partial && (extra.capped || s0.capped), missing = partial && !capped ? (s0.missingMoves || []).length : 0;
    const sentKey = kind === 'update' ? `update-${extra.at}` : partial ? 'all-partial' : kind; /* a partial "all" then a full one: both, each once */
    const todo = to.filter((e) => !n.sent[`${sentKey}:${e}`] && (!extra.only || e === String(extra.only).toLowerCase())); if (!todo.length) return;
    const href = `${base}/${slug}?go=feed`, movesHref = `${base}/${slug}?go=feed#v=moves`;
    const subject = kind === 'update' ? `${extra.moves.length} of ${name}’s moves were updated` : kind === 'all' ? (partial ? `${done} of ${total} moves for ${name} are ready` : `All of ${name}’s moves are ready`) : `Your first moves for ${name} are ready`;
    const lead = extra.lead || `Something changed for ${name}, so Brew rewrote the plans it affects`;
    const first = kind === 'first' ? WAVE_A.filter((k) => moves[k]?.title).sort((a, b) => a - b).map((k) => `${moveLabel(k)} · ${moves[k].title}`) : [];
    const left = Math.max(0, total - done);
    const allLine = partial ? `Brew has written ${done} of ${total} moves for ${name}: every plan with its sources, a 30-day rollout and what to watch.` : `Brew has finished all ${total} moves for ${name}: every plan with its sources, a 30-day rollout and what to watch.`;
    const whyPart = capped ? `The other ${left} are paused at this brand’s spending cap; open Brew to carry on.` : missing ? `${missing} could not be written this time; the Moves page names them.` : '';
    const firstLine = `Brew has written the first ${first.length || 10} moves for ${name}: positioning, customers, rivals, pricing, offers and measurement.`;
    const firstNext = `Their ideas are in your feed now, and the other ${left} land one by one; we’ll email again when they’re all in.`;
    const line = kind === 'update' ? `${lead}: ${extra.moves.map((x) => `${moveLabel(x.n)} (${x.title})`).join(', ')}. ${extra.because || ''}`.trim() : kind === 'all' ? `${allLine} ${whyPart} Each one downloads as a PDF, and your feed is built from them.`.replace(/\s+/g, ' ') : `${firstLine} ${firstNext}`;
    /* the "all" email shows a few of the brand's static ads (public files) */
    const statics = kind === 'all' ? (((await packs.getJSON(slug, 'config.json', {})) || {}).statics || []).slice(0, 3).map((id) => `${base}/b/${slug}/statics/${encodeURIComponent(id)}.jpg`) : [];
    const body = kind === 'update'
      ? mailP(`${mailEsc(lead)}:`) + mailList(extra.moves.slice(0, 12).map((x) => `${moveLabel(x.n)} · ${x.title}`)) + (extra.because ? mailP(mailEsc(extra.because)) : '')
      : kind === 'all' ? mailP(mailEsc(allLine)) + (whyPart ? mailP(mailEsc(whyPart)) : '') + mailP('Each one downloads as a PDF, and your feed is built from them.') + (statics.length ? mailP(mailEsc(`${statics.length === 1 ? 'An ad' : `${statics.length} of the ads`} Brew made from your ad plan:`)) + mailImages(statics, { href, alt: `${name} ad` }) : '')
      : mailP(mailEsc(firstLine)) + (first.length ? mailList(first) : '') + mailP(mailEsc(firstNext));
    const html = emailHtml({ title: subject, eyebrow: name, preheader: line.slice(0, 140), body, cta: { href, label: 'Open the feed' }, secondary: { href: movesHref, label: 'Read the moves' }, after: mailP('Every number in them has a source. Anything we could not confirm is marked “to confirm”.', { muted: true, small: true }), base });
    const text = `${subject}\n\n${line}${first.length ? `\n\n${first.join('\n')}` : ''}\n\nOpen the feed: ${href}\nRead the moves: ${movesHref}`;
    for (const e of todo) {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: process.env.NOTIFY_FROM || 'Brew <hello@send.joinsquareup.com>', to: [e], subject, html, text }) }).catch((err) => ({ ok: false, status: 0, text: async () => err.message }));
      if (r.ok) n.sent[`${sentKey}:${e}`] = Date.now(); else log.warn('[notify] resend', r.status, (await r.text()).slice(0, 200));
    }
    const cur = (await packs.getJSON(slug, 'notify.json', null)) || {}; await packs.put(slug, 'notify.json', { emails: [], ...cur, sent: { ...(cur?.sent || {}), ...n.sent } }); /* emails added meanwhile are kept */
  }
  // the Build tab: what is being written now, what is next, what failed, what it cost
  async function buildInfo(slug) {
    const s0 = await status(slug); if (!s0) return { error: 'unknown brand' };
    const x = st(slug), moves = await packs.getJSON(slug, 'moves.json', {});
    const specs = (await load()).moves?.SPECS || [];
    const nm = (n) => sentenceCase(specs.find((p) => p.n === n)?.discipline || '', [], { force: true }) || String(specs.find((p) => p.n === n)?.kicker || '').toLowerCase().replace(/^./, (c) => c.toUpperCase()) || moveLabel(n); // skill names are Title Cased
    const done = Object.entries(moves).filter(([k, mv]) => isPlay(k, mv)); // the playbook: not the index, not cadence moves
    const app = s0.applicable?.length ? s0.applicable : [...Array(51).keys()].filter(Boolean);
    const order = [...WAVE_A.filter((n) => app.includes(n)), ...app.filter((n) => !WAVE_A.includes(n))];
    const inflight = [...x.inflight.entries()].map(([n, t]) => ({ n, title: nm(n), secs: Math.round((Date.now() - t) / 1e3) }));
    const queue = order.filter((n) => !moves[n] && !x.inflight.has(n) && !x.failed.has(n)).slice(0, 8).map((n) => ({ n, title: nm(n) }));
    const failed = [...x.failed.entries()].map(([n, f]) => ({ n, title: nm(n), msg: /max_tokens/.test(f.msg) ? 'The reply ran out of room' : /refused/.test(f.msg) ? 'The model declined this one' : /cap|budget/.test(f.msg) ? 'Spend cap reached' : 'It stopped with an error', at: f.at }));
    const pad = (n) => String(n).padStart(2, '0');
    const ev = x.events.filter((e) => ['move', 'move-start', 'move-failed', 'pdf', 'statics', 'cards', 'confirmed', 'read-done'].includes(e.type)).slice(-40).reverse().slice(0, 25)
      .map((e) => ({ at: e.at, type: e.type, text: e.type === 'move' ? `${moveLabel(e.n)} written: ${e.title}` : e.type === 'move-start' ? `Started ${moveLabel(e.n)} · ${nm(e.n)}` : e.type === 'move-failed' ? `${moveLabel(e.n)} stopped, it gets another try` : e.type === 'pdf' ? `PDF ready: ${e.file}` : e.type === 'statics' ? `${e.n} static ads made` : e.type === 'cards' ? `${e.cards.length} new card${e.cards.length === 1 ? '' : 's'} from ${moveLabel(e.n)}` : e.type === 'confirmed' ? 'You confirmed what we read' : 'Your site was read' }));
    const g = s0.stages || {};
    return { name: s0.name, running: !!x.running, state: s0.state, done: done.length, core: WAVE_A.filter((n) => moves[n]).length, total: totalOf(s0), pdfs: Object.keys(s0.pdfs || {}).filter((k) => isPlay(k)).length, /* PDFs are made on download */ zips: s0.zips || [], statics: s0.statics || null,
      stages: { read: g.read?.state || null, confirm: g.confirm?.state || null, brief: g.brief?.state || null, moves: g.moves?.state || null },
      inflight, queue, failed, events: ev, usd: +spentFor(slug).toFixed(2), cap: capOf(slug), pro: !!s0.pro, capped: !!s0.capped, createdAt: s0.createdAt };
  }
  /* Pro: a build paused at the free spend cap carries on to every move (the Pro cap), from where it stopped */
  async function goPro(slug, { by = null } = {}) {
    if (blocked(slug)) return { error: 'This brand is stopped.' };
    const s0 = (await status(slug)) || {}; if (st(slug).cancelled || s0.cancelled) return { error: 'This build was stopped.' };
    await setStatus(slug, { pro: true, proAt: s0.proAt || Date.now(), proBy: s0.proBy || by, ...(s0.capped ? { capped: false, state: 'Pro: writing the rest of the moves.' } : {}) });
    log.log?.(`[build] ${slug}: Pro by ${by || '?'}, cap $${PRO_CAP}${s0.capped ? ', resuming' : ''}`);
    if (s0.capped && !st(slug).running) resume(slug).catch((e) => log.error('[build] pro', e.message));
    return { ok: true, pro: true, cap: PRO_CAP, resumed: !!s0.capped };
  }
  async function retry(slug) { const x = st(slug); if (x.running) return { ok: true, note: 'Failed moves get another try once the rest are written.' }; x.failed.clear(); resume(slug).catch((e) => log.error('[build] retry', e.message)); return { ok: true }; }

  /* ---------- keep the moves current: check for updates, flag the moves a change affects, rewrite them ---------- */
  // updates.json: { auto, checking, lastCheck: { at, changes, summary, flagged, usd }, stale: { n: { why, priority, changes } }, history }
  const REFRESH_DAYS = +process.env.REFRESH_EVERY_DAYS || 7, AUTO_MAX = +process.env.REFRESH_AUTO_MAX || 6;
  const REFRESH_CAP = +process.env.REFRESH_CAP_USD || 60, AUTO_CAP = +process.env.REFRESH_AUTO_CAP_USD || 10;
  const CONNECT_CAP = +process.env.CONNECT_CAP_USD || 40, CONNECT_SETTLE = +(process.env.CONNECT_SETTLE_MS ?? 30 * 60e3); /* teams connect several accounts in one sitting: one run for all of them */
  const CONNECT_FRESH_MS = +(process.env.CONNECT_FRESH_MS ?? 24 * 3600e3); /* a later account skips a move rewritten this recently (moves written before connectedWith) */
  const CONNECT_READ_MAX = +(process.env.CONNECT_READ_MAX_MS ?? 2 * 3600e3); /* the run waits this long at most for a just-connected account's first read */
  /* connected accounts' re-reads: a number counts once it moved LIVE_MATERIAL (10%) since the move was written; the moves they
     flag are rewritten once a week (LIVE_DAYS), up to LIVE_CAP dollars a brand a run, and what the cap stopped waits for next week */
  const LEARN_CAP = +process.env.LEARN_CAP_USD || 30; /* one learnings upload's own rewrite (brand-learnings.js picks the moves within it); "go ahead" on the first one is learnings-all */
  const LIVE_MATERIAL = +(process.env.LIVE_MATERIAL ?? 0.1), LIVE_CAP = +process.env.LIVE_CAP_USD || 30, LIVE_DAYS = +process.env.LIVE_REWRITE_DAYS || REFRESH_DAYS;
  const pad2 = (n) => String(n).padStart(2, '0');
  /* the brand's weekly pot (rewrite-pot.js): every automatic rewrite draws from it, best kind first; manual ones stay outside.
     A move costs what this brand's moves cost on today's model, else the provider's estimate (Flash is about a sixth of Opus) */
  const moveModel = () => (providerNow() === 'gemini' ? geminiModel('opus') : 'claude-opus-5-5');
  async function estMove(slug) {
    const pub = await packs.getJSON(slug, 'moves.json', {}), pm = await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({}));
    return perMove({ moves: [...Object.values(pub || {}), ...Object.values(pm || {})], model: moveModel(), provider: providerNow() });
  }
  async function potInfo(slug, now = Date.now()) {
    const pot = potOf(await upd(slug), now), cap = potCapOf(process.env, providerNow()), est = await estMove(slug);
    return { pot, cap, est, left: Object.fromEntries(KINDS.map((k) => [k, +potLeft(pot, cap, k).toFixed(2)])) };
  }
  const potSpend = (slug, kind, usd) => (kind && usd > 0 ? editUpd(slug, (u) => { u.pot = potAdd(potOf(u), kind, usd); }) : Promise.resolve());
  /* what the pot did not cover this week: it keeps its flag and is listed as waiting until it is rewritten or the week turns */
  const potWait = (slug, wait = [], go = []) => (wait.length || go.length ? editUpd(slug, (u) => { const p = potOf(u); for (const it of go) delete p.waits[it.n]; for (const it of wait) p.waits[it.n] = it.kind; u.pot = p; }) : Promise.resolve());
  // DUMMY: flags raised by a simulated account (live) are not real reasons to rewrite: saved flags heal here
  const upd = async (slug) => { const u = { auto: true, stale: {}, history: [], ...(await packs.getJSON(slug, 'updates.json', {})) }; for (const [n, x] of Object.entries(u.stale || {})) if (x?.live && !x.real) delete u.stale[n]; return u; };
  let ulock = Promise.resolve(); // updates.json is read-modify-written from several places
  const editUpd = (slug, f) => (ulock = ulock.then(async () => { const u = await upd(slug); await f(u); await packs.put(slug, 'updates.json', u); return u; }));
  async function checkUpdates(slug, { auto = false, why = 'You asked for the latest', max = null, via = null } = {}) {
    if (blocked(slug)) return { error: 'This brand is stopped.' };
    const x = st(slug), s0 = await status(slug); if (!s0) return { error: 'unknown brand' };
    if (!(await packs.getJSON(slug, 'brief.json'))) return { error: 'Updates start once the moves are written.' };
    if (x.checking) return { ok: true, already: true };
    if (x.running) return { error: x.rewriting ? 'A rewrite is running. Check again once it is in.' : 'The moves are still being written. Updates open once they are in.' };
    await loadDay(); if (dayUsd() >= DAY_CAP) return { error: 'Today’s budget is used up. Try again tomorrow.' };
    x.checking = true; await editUpd(slug, (u) => { u.checking = { at: Date.now(), why }; });
    emit(slug, { type: 'update-start', why });
    buildCtx.run(slug, () => doCheck(slug, { auto, why, max, via })).catch(async (e) => { log.error('[refresh]', slug, e.message); await editUpd(slug, (u) => { u.checking = null; u.lastError = { at: Date.now(), msg: String(e.message).slice(0, 160) }; }); })
      .finally(() => { x.checking = false; saveSpend(slug); setTimeout(() => drain(slug).catch(() => {}), 0); });
    return { ok: true };
  }
  async function doCheck(slug, { auto, why, max = null, via = null }) {
    const m = await load(); await restoreSpend(slug); const usd0 = spentFor(slug), s0 = await status(slug);
    const old = await packs.getJSON(slug, 'ledger.json', []), oldP = await packs.getJSON(slug, 'profile.json');
    const out = await makeReader(m).read(s0.url, { fresh: true, prev: oldP, admin: await adminFor(slug, s0, oldP), onEvent: (e) => { if (e.type === 'step' && e.done) emit(slug, { type: 'update-step', k: e.k, text: e.done }); } });
    /* the store did not open today: nothing is compared or overwritten (the error is kept and the next try waits a day) */
    if (!storeOpened(out)) throw new Error('The store did not open, so nothing was compared. Brew tries again tomorrow.');
    const gone = removedKeys(oldP?.catalog?.removed);
    // rivals stay the brand's list: a rival the read newly spotted is reported, not slipped into the plans
    const known = new Set((oldP?.rivals || []).map((r) => 'rival.' + String(r.host).replace(/\./g, '-')));
    /* a fact the team removed on the fact sheet stays removed while the site still says the same thing (facts-edits.json removed) */
    const tombs = (await packs.getJSON(slug, 'facts-edits.json', null))?.removed || [], tomb = (e) => tombs.some((t) => t.key === e.key && String(t.v).trim().toLowerCase() === String(e.v).trim().toLowerCase());
    const fresh = out.ledger.filter((e) => !gone(e) && !tomb(e) && (!e.key.startsWith('rival.') || [...known].some((k) => e.key.startsWith(k + '.'))));
    const spotted = (out.profile.rivals || []).filter((r) => !known.has('rival.' + String(r.host).replace(/\./g, '-'))).map((r) => ({ name: r.name, host: r.host }));
    // connected accounts' numbers stay in connected-ledger.json (read at rewrite time), so a disconnect takes them out cleanly
    const { ledger, removed } = mergeLedger(old.filter((e) => !e.demo), fresh, { catalogRead: (out.profile.catalog?.products || []).length > 0 });
    const { changes, minor } = diffLedgers(old, ledger, removed);
    const profile = normalizeProfile(mergeProfile(oldP, out.profile));
    await packs.put(slug, `refresh/${new Date().toISOString().slice(0, 10)}/ledger-before.json`, old);
    await packs.put(slug, 'ledger.json', ledger); await packs.put(slug, 'profile.json', profile);
    const moves = await packs.getJSON(slug, 'moves.json', {}), specs = m.moves?.SPECS || [];
    const tri = changes.length ? await triage(ai, { name: profile.name, changes, cand: candidates(changes, moves, specs), moves, specs }) : { summary: 'Nothing changed that affects a move.', moves: [] };
    const at = Date.now();
    const u = await editUpd(slug, (u) => {
      for (const t of tri.moves) { const e = { n: t.n, priority: t.priority, why: t.why, changes: (t.changes || []).map((i) => changes[i]).filter(Boolean).slice(0, 6).map(changeLine), at, ...(via === 'event' ? { src: 'event' } : {}) }, o = u.stale[t.n];
        /* an out-of-stock mark stays on top: the check's reason waits under it (stockSignal) */
        u.stale[t.n] = o?.stockWhy ? { ...o, was: { priority: e.priority, why: e.why }, why: [...Object.values(o.stockWhy), e.why].join(' '), changes: [...new Set([...(o.changes || []), ...e.changes])].slice(0, 6) } : e; }
      u.lastCheck = { at, why, auto, changes: changes.slice(0, 80), minor, spotted, summary: tri.summary, flagged: tri.moves.map((t) => t.n), usd: +(spentFor(slug) - usd0).toFixed(2) };
      u.checking = null; u.lastError = null;
    });
    await publishBase(slug, profile, ledger, await packs.getJSON(slug, 'findings.json')); // facts, health and the seed follow the new read
    emit(slug, { type: 'update-done', changes: changes.length, flagged: tri.moves.length });
    log.log(`[refresh] ${slug}: ${changes.length} changes (${minor} minor), ${tri.moves.length} moves flagged, $${u.lastCheck.usd}`);
    /* a weekly check rewrites up to AUTO_MAX high-priority moves; a big change (an event) rewrites the one it hits hardest */
    if (auto && u.auto !== false) { const ok = await rewritable(moves), kind = via === 'event' ? 'event' : 'check', P = await potInfo(slug);
      const { now: go, wait } = potFit(P.pot, P.cap, P.est, tri.moves.filter((t) => t.priority === 'high' && ok(t.n)).slice(0, max ?? AUTO_MAX).map((t) => ({ n: t.n, kind, at })));
      await potWait(slug, wait, go); if (wait.length) log.log(`[pot] ${slug}: ${wait.length} ${kind} moves wait for next week's pot (${wait.map((x) => x.n).join(', ')})`);
      if (go.length) await rewriteNow(slug, go.map((x) => x.n), { auto: true, via: via === 'event' ? 'event' : 'weekly' }); }
    /* the weekly check also writes the moves whose evidence has appeared since (listening-era specs, a festival at its plan
       point, a research gap): they become cards like any other. At most NEW_MAX a week, after the rewrites */
    if (auto && u.auto !== false && max == null) { const add = await newlyApplicable(slug, m, { profile, ledger, moves }).catch((e) => { log.warn('[refresh] new moves', slug, e.message); return []; });
      const P = add.length ? await potInfo(slug) : null, { now: go, wait } = P ? potFit(P.pot, P.cap, P.est, add.map((n) => ({ n, kind: 'new' }))) : { now: [], wait: [] };
      await potWait(slug, wait, go); /* a new move the pot can't cover is found again next week (its evidence is still there) */
      if (go.length) { log.log(`[refresh] ${slug}: ${go.length} new moves now have their evidence: ${go.map((x) => x.n).join(', ')}${wait.length ? ` (${wait.length} wait for next week's pot)` : ''}`); await rewriteNow(slug, go.map((x) => x.n), { auto: true, via: 'new' }); } }
  }
  /* the rewrite queue (updates.json queue): what the team told Brew goes first, then a big change (a rival's price move or
     launch, our catalog), then the weekly check's stale moves. A rewrite asked for while another runs waits its turn instead of
     being turned away, and starts the moment the brand is free (drain) */
  const PRIO = { learnings: 0, 'learnings-all': 0, event: 1, manual: 1, connected: 1, stale: 2, weekly: 2, live: 2, new: 3 };
  const enqueue = (slug, ns, { via = 'manual', auto = false, notBefore = null, tries = null } = {}) => editUpd(slug, (u) => { const q = (u.queue ||= []);
    let e = q.find((x) => x.via === via); if (!e) { e = { via, prio: PRIO[via] ?? 1, ns: [], auto, at: Date.now() }; q.push(e); } e.ns = [...new Set([...e.ns, ...ns])]; e.auto = e.auto && auto;
    if (notBefore) e.notBefore = notBefore; else delete e.notBefore; if (tries != null) e.tries = tries; });
  /* an entry that waits (notBefore: the rest of a connected run after the day's cap) starts on its own when its time comes */
  const later = new Map();
  const armLater = (slug, at) => { clearTimeout(later.get(slug)); const t = setTimeout(() => { later.delete(slug); drain(slug).catch((e) => log.warn('[rewrite] later', e.message)); }, Math.max(1e3, Math.min(at - Date.now(), 2 ** 31 - 1))); t.unref?.(); later.set(slug, t); };
  async function drain(slug) {
    if (st(slug).running || st(slug).checking || blocked(slug)) return;
    /* a late check goes first: the brief it rewrites is what the queued moves are written from */
    if ((await status(slug))?.recheck?.at) { await lateCheck(slug); if (st(slug).running || st(slug).checking) return; }
    let next = null, wait = null; await editUpd(slug, (u) => { const q = (u.queue || []).sort((a, b) => a.prio - b.prio || a.at - b.at), i = q.findIndex((x) => !(x.notBefore > Date.now()));
      if (i >= 0) next = q.splice(i, 1)[0]; else wait = Math.min(...q.map((x) => x.notBefore).filter(Boolean)); u.queue = q; });
    if (!next && Number.isFinite(wait)) armLater(slug, wait);
    const have = await packs.getJSON(slug, 'moves.json', {}), ns = (next?.ns || []).filter((n) => have[n]); if (!ns.length) return next ? drain(slug) : undefined;
    log.log(`[rewrite] ${slug}: next in the queue (${next.via}): ${ns.join(', ')}`);
    buildCtx.run(slug, () => rewriteNow(slug, ns, { auto: !!next.auto, via: next.via, tries: next.tries || 0 })).catch((e) => log.error('[rewrite] queue', slug, e.message));
  }
  // a move the engine can write again: a written playbook move with a spec (core, listening-era), never a weekly cadence move
  const rewritable = async (have) => { const specN = new Set(((await load()).moves?.SPECS || []).map((s) => s.n)); return (n) => n >= 1 && specN.has(n) && !!have[n] && !have[n]?.meta?.cadence; };
  const NEW_MAX = +process.env.REFRESH_NEW_MAX || 4;
  async function newlyApplicable(slug, m, { profile, ledger, moves }) {
    if (!m.moves) return [];
    const eng = m.moves.createMovesEngine({ ai, treg, log }), briefMd = (await packs.get(slug, 'brief.md'))?.toString('utf8') || '';
    const ctx = await eng.prepare({ profile, ledger, packs, slug, brief: { md: briefMd } });
    const specs = [...(m.moves.SPECS || []).filter((s) => s.n && s.needs?.length), ...(ctx.dynamicSpecs || [])];
    return specs.filter((sp) => !moves[sp.n] && eng.needsMet(sp, ctx)).map((sp) => sp.n).slice(0, NEW_MAX);
  }
  async function rewrite(slug, ns, o = {}) {
    if (blocked(slug)) return { error: 'This brand is stopped.' };
    const x = st(slug), s0 = await status(slug); if (!s0) return { error: 'unknown brand' };
    const have = await packs.getJSON(slug, 'moves.json', {}), ok = await rewritable(have);
    ns = [...new Set((ns || []).map(Number))].filter(ok);
    if (!ns.length) return { error: 'Pick a written move.' };
    const est1 = await estMove(slug), est = +(ns.length * est1).toFixed(2);
    if (x.running || x.checking) { if (o.via) { await enqueue(slug, ns, { via: o.via }); return { ok: true, queued: true, n: ns.length, est }; }
      return { error: x.rewriting ? 'A rewrite is already running.' : 'The moves are still being written. Rewrites open once they are in.' }; }
    await loadDay(); if (dayUsd() >= DAY_CAP) return { error: 'Today’s budget is used up. Try again tomorrow.' };
    buildCtx.run(slug, () => rewriteNow(slug, ns, o)).catch((e) => log.error('[rewrite]', slug, e.message));
    return { ok: true, n: ns.length, est };
  }
  async function rewriteNow(slug, ns, { auto = false, via = null, tries = 0, noIndex = false } = {}) {
    ns = [...new Set((ns || []).map(Number))].filter((n) => n >= 1 && n < 1000); if (!ns.length) return;
    const x = st(slug); if (x.running) return enqueue(slug, ns, { via: via || (auto ? 'weekly' : 'manual'), auto }); x.running = true; x.rewriting = new Set(ns);
    const m = await load(); await restoreSpend(slug); await loadDay(); const usd0 = spentFor(slug), cap0 = via === 'connected' ? CONNECT_CAP : via === 'live' ? LIVE_CAP : via === 'learnings' ? LEARN_CAP : auto ? AUTO_CAP : Math.max(REFRESH_CAP, ns.length * 2.5);
    /* an automatic run draws from the brand's weekly pot (a manual one, asked for with its cost shown, does not) */
    const kind = runKind(via, auto), P = kind ? await potInfo(slug) : null, cap = P ? Math.min(cap0, potLeft(P.pot, P.cap, kind)) : cap0;
    let booked = usd0; const book = () => { const d = spentFor(slug) - booked; booked += d; return d; };
    const potOut = async () => !!kind && (await potInfo(slug).then((Q) => potLeft(Q.pot, Q.cap, kind) < Q.est));
    /* the pot is out for this kind: nothing is written, the flags stay, a connected run starts again with next week's pot */
    const holdForPot = async (left) => { await potWait(slug, left.map((n) => ({ n, kind }))); log.log(`[pot] ${slug}: ${left.length} ${kind} moves wait for next week's pot (${left.join(', ')})`);
      if (via === 'connected') await enqueue(slug, left, { via: 'connected', auto: true, notBefore: nextWeek(), tries }); };
    if (P && cap < P.est) { x.running = false; x.rewriting = null; await holdForPot(ns); setTimeout(() => drain(slug).catch(() => {}), 0); return; }
    const written = []; let prevState = null;
    try {
      const profile0 = normalizeProfile(await packs.getJSON(slug, 'profile.json'));
      // a real connected account's numbers are evidence for the rewrite, and private to the brand's team (a move written
      // from them is saved privately too). Simulated accounts (DUMMY) are never evidence and never make a rewrite private.
      const privL = realRows(await packs.getJSON(slug, 'private/connected-ledger.json', [])), priv = privL.length > 0, P = priv ? 'private/' : '';
      const ledger = await mergedLedger(slug);
      /* the team's rewrite writes from their view of the brand: best sellers as heroes, the brief with the account numbers in it */
      const profile = priv ? withLive(profile0, await packs.getJSON(slug, 'private/profile-live.json', null)) : profile0;
      const pb = priv ? await packs.getJSON(slug, 'private/brief.json', null) : null;
      const brief = pb || await packs.getJSON(slug, 'brief.json'), briefMd = ((pb && await packs.get(slug, 'private/brief.md')) || await packs.get(slug, 'brief.md'))?.toString('utf8') || '';
      const cache = { ...(await packs.getJSON(slug, 'moves.json', {})), ...(priv ? await packs.getJSON(slug, 'private/moves.json', {}) : {}) }, olds = Object.fromEntries(ns.map((n) => [n, cache[n]]));
      const u0 = await upd(slug), stale = u0.stale || {}, stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      /* what the site can't sell right now (stockSignal): every rewrite reads it, so a rewritten move never builds on it again */
      const outNow = Object.entries(u0.stockOut || {}).map(([h, k]) => { const t = (profile0.catalog?.products || []).find((x) => x.handle === h)?.title || h.replace(/-/g, ' '); return `- ${t}: ${k.kind === 'oos' ? 'out of stock' : 'no longer on the site'}`; });
      /* what the team told Brew (learnings, what they tried) reaches every rewrite: the team's private brief is drawn from brief.json and has no such section, so it is laid in here from learned.json */
      const told = await packs.getJSON(slug, 'learned.json', null), briefMdT = told ? withLearned(briefMd, told, { name: profile0.name }) : briefMd;
      const stockMd = outNow.length ? `\n\n## Right now on the site\nThese products can't be bought today. Don't build a move on them, feature them or spend on them; pick an in-stock product instead.\n${outNow.slice(0, 40).join('\n')}` : '';
      prevState = (await status(slug)).state;
      /* kept in updates.json while it runs: a restart or deploy mid-rewrite carries on with the moves not yet written (resumeAll) */
      await editUpd(slug, (u) => { u.rewriting = { ns, auto, via, tries, at: Date.now(), prev: u.rewriting?.prev || prevState, ...(noIndex ? { indexDone: true } : {}) }; });
      await setStatus(slug, { state: `Rewriting ${ns.length} move${ns.length === 1 ? '' : 's'} with the latest` });
      emit(slug, { type: 'rewrite-start', ns, auto });
      const eng = m.moves.createMovesEngine({ ai, treg, log });
      let lock = Promise.resolve(), pdfQ = Promise.resolve(), staticsJob = Promise.resolve();
      const saveOne = async (n, move) => {
        x.inflight.delete(n); x.failed.delete(n);
        if (n !== 0) {
          const prev = olds[n], file = prev ? `${P}moves/history/${pad2(n)}-${stamp}.json` : null;
          if (prev) await packs.put(slug, file, prev);
          move.meta = { ...move.meta, version: (prev?.meta?.version || 1) + 1, rewrittenAt: new Date().toISOString(), ...(priv ? { connectedWith: idsOfRows(privL) } : {}), because: stale[n]?.why || (auto ? 'New evidence came in' : 'Rewritten with the latest evidence'), changes: stale[n]?.changes || [], prevAt: prev?.meta?.at || null, prevFile: file };
        }
        await packs.put(slug, `${P}moves/${pad2(n)}.json`, move);
        if (n === 0) await editUpd(slug, (u) => { if (u.rewriting) u.rewriting.indexDone = true; }); /* a restart does not write the index again */
        const all = await packs.getJSON(slug, `${P}moves.json`, {}); all[n] = move; await packs.put(slug, `${P}moves.json`, all);
        emit(slug, { type: 'move', n, title: move.title, stat: move.stat, gives: move.gives, verified: !!move.meta?.verified, rewritten: true });
        if (n !== 0) { written.push({ n, title: move.title }); /* cardsDue: a restart between the move and its cards writes the cards at boot (healCards) */ await editUpd(slug, (u) => { u.cardsDue = { ...(u.cardsDue || {}), [n]: priv ? 'p' : 1 }; }); await cardsFor(slug, move, profile, { replace: true, priv }).catch((e) => log.warn('[rewrite] cards', n, e.message)); await editUpd(slug, (u) => { delete u.stale[n]; if (u.cardsDue) delete u.cardsDue[n]; if (kind) { u.pot = potAdd(potOf(u), kind, book()); delete u.pot.waits[n]; } }); }
        if (n === 21 && !priv && staticsUnset((await status(slug))?.statics)) staticsJob = makeStatics(slug, move, profile, (fn) => (lock = lock.then(fn).catch((e) => log.warn('[rewrite] statics card', e.message))));
        /* the team's rewrite of Move 21 makes the team's own set (once), kept private */
        if (n === 21 && priv && staticsDue(await packs.getJSON(slug, 'private/statics-state.json', null))) staticsJob = makeStatics(slug, move, profile, (fn) => (lock = lock.then(fn).catch((e) => log.warn('[rewrite] team statics card', e.message))), { priv: true });
        if (m.pdf && priv) pdfQ = pdfQ.then(() => renderPdf(slug, m.pdf, move, profile, { priv })).catch((e) => log.warn('[rewrite] pdf', n, e.message)); /* a member's private rewrite keeps its own PDF */
        if (!priv) await unmarkPdf(slug, n); /* the public PDF is drawn again on its next download */
        packs.drop(slug); await onPack(slug); saveSpend(slug);
      };
      const NUM = await numbersFor(packs.getJSON, slug, { 'profile.json': profile });
      const ctx = { brand: { name: profile.name, host: profile.host, descriptor: profile.descriptor }, brief: { md: briefMdT + stockMd, json: brief }, profile, ledger: withNumbers(ledger, NUM, profile.name), numbers: NUM, packs, slug,
        load: (n) => cache[n] || null, save: async (n, move) => { cache[n] = move; await (lock = lock.then(() => saveOne(n, move)).catch((e) => log.warn('[rewrite] save', n, e.message))); },
        canSpend: () => !stopping && !blocked(slug) && dayUsd() < DAY_CAP && spentFor(slug) - usd0 < cap && !st(slug).cancelled,
        effort: process.env.MOVES_EFFORT || 'medium', search: +(process.env.MOVES_SEARCH ?? 1),
        onTotal: async () => {}, /* a rewrite keeps the brand's count: the build sets it (there is no `total` here; it threw on every rewrite of 3+ moves) */
        onStart: (n) => { x.inflight.set(n, Date.now()); x.failed.delete(n); emit(slug, { type: 'move-start', n }); },
        onFail: (n, e) => { x.inflight.delete(n); x.failed.set(n, { msg: String(e?.message || e).slice(0, 160), at: Date.now() }); emit(slug, { type: 'move-failed', n, msg: String(e?.message || e).slice(0, 160) }); } };
      await eng.runAll(ctx, { only: ns.length >= 3 && !noIndex ? [...ns, 0] : ns, concurrency: Math.min(6, ns.length), waveA: WAVE_A });
      await lock; await staticsJob; await pdfQ;
      const usd = +(spentFor(slug) - usd0).toFixed(2), at = Date.now();
      await potSpend(slug, kind, book());
      await editUpd(slug, (u) => { u.history = [{ at, auto, ...(kind ? { kind } : {}), moves: written, usd, because: written.map((w) => stale[w.n]?.why).filter(Boolean)[0] || null }, ...(u.history || [])].slice(0, 30); });
      await setStatus(slug, { state: (await status(slug)).done ? 'Ready' : prevState });
      emit(slug, { type: 'rewrite-done', n: written.length, usd });
      if (written.length && !priv) notify(slug, 'update', { at, moves: written, because: auto ? 'Your read changed, and these plans quoted what changed.' : '' }).catch((e) => log.warn('[notify]', e.message));
      /* a connected run: the team hears once it is in; what the day's budget stopped carries on tomorrow (three days at most) */
      if (via === 'connected') {
        const left = ns.filter((n) => !written.some((w) => w.n === n));
        if (left.length && await potOut()) await holdForPot(left);
        else if (left.length && tries < 3) { await enqueue(slug, left, { via: 'connected', auto: true, notBefore: Date.now() + 20 * 3600e3, tries: tries + 1 }); log.log(`[connect] ${slug}: ${left.length} moves carry on tomorrow`); }
      } else if (kind) { const left = ns.filter((n) => !written.some((w) => w.n === n)); if (left.length && await potOut()) await holdForPot(left); }
    } catch (e) { log.error('[rewrite] failed', slug, e); /* the brand does not stay on "Rewriting N moves" */
      /* a connected run that stopped on an error tries the moves it had not written again in an hour (three tries in all) */
      if (via === 'connected' && tries < 3) { const left = ns.filter((n) => !written.some((w) => w.n === n)); if (left.length) await enqueue(slug, left, { via: 'connected', auto: true, notBefore: Date.now() + 3600e3, tries: tries + 1 }).catch(() => {}); }
      await setStatus(slug, { state: (await status(slug))?.done ? 'Ready' : prevState || 'Ready' }).catch(() => {}); emit(slug, { type: 'rewrite-done', n: written.length, failed: String(e?.message || e).slice(0, 160) }); }
    finally { x.running = false; x.rewriting = null; saveSpend(slug); await potSpend(slug, kind, book()).catch(() => {}); await editUpd(slug, (u) => { delete u.rewriting; }).catch(() => {}); setTimeout(() => drain(slug).catch((e) => log.warn('[rewrite] drain', e.message)), 0);
      if (via === 'connected') setTimeout(() => settleConnect(slug).catch((e) => log.warn('[connect] settle', e.message)), 50); }
  }
  /* a rewrite cut off by a restart (a deploy): the status goes back to what it was and the moves it had not written yet are
     rewritten now, auto or asked for alike (a move it wrote carries meta.rewrittenAt from after the start) */
  /* a rewritten move whose cards a restart cut off (updates.json cardsDue): its cards are written now, from the saved move,
     so the feed never keeps the old move's cards under the new move */
  async function healCards(slug) {
    const due = Object.entries((await upd(slug)).cardsDue || {}); if (!due.length || blocked(slug)) return;
    const profile0 = normalizeProfile(await packs.getJSON(slug, 'profile.json'));
    for (const [k, w] of due) { const n = +k, priv = w === 'p';
      const move = (await packs.getJSON(slug, priv ? 'private/moves.json' : 'moves.json', {}))?.[n];
      const profile = priv ? withLive(profile0, await packs.getJSON(slug, 'private/profile-live.json', null)) : profile0;
      if (move) { log.log(`[rewrite] ${slug}: writing move ${n}'s cards, cut off by a restart`); await cardsFor(slug, move, profile, { replace: true, priv }).catch((e) => log.warn('[rewrite] heal cards', n, e.message)); }
      await editUpd(slug, (u) => { if (u.cardsDue) delete u.cardsDue[n]; }); }
  }
  async function resumeRewrite(slug) {
    const u = await upd(slug), r = u.rewriting; if (!r || st(slug).running || blocked(slug)) return;
    /* a move this run already wrote counts as done, wherever it was saved (a member's rewrite goes to private/moves.json) */
    const pub = await packs.getJSON(slug, 'moves.json', {}), priv = await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({})), s0 = await status(slug);
    const doneAt = (n) => Math.max(Date.parse(pub[n]?.meta?.rewrittenAt || 0) || 0, Date.parse(priv?.[n]?.meta?.rewrittenAt || 0) || 0), moves = pub;
    const left = (r.ns || []).filter((n) => moves[n] && !(doneAt(n) >= (r.at || 0)) && (!r.auto || u.stale?.[n]));
    await setStatus(slug, { state: s0?.done ? 'Ready' : r.prev && !/^Rewriting/.test(r.prev) ? r.prev : s0?.state });
    if (!left.length) { await editUpd(slug, (v) => { delete v.rewriting; }); return; }
    log.log(`[rewrite] ${slug}: carrying on after a restart with ${left.join(', ')}`);
    buildCtx.run(slug, () => rewriteNow(slug, left, { auto: !!r.auto, via: r.via || null, tries: r.tries || 0, noIndex: !!r.indexDone })).catch((e) => log.error('[rewrite] resume', slug, e.message));
  }
  async function updates(slug, { member = true } = {}) {
    const u = await upd(slug), x = st(slug), s0 = await status(slug), moves = await packs.getJSON(slug, 'moves.json', {});
    if (!member) u.stale = Object.fromEntries(Object.entries(u.stale || {}).filter(([, v]) => !v.private));
    /* where an outdated move's refresh stands (staleSweep): being rewritten, queued, waiting for next week's pot, or due within
       the hour; off when the team turned automatic updates off */
    const inQ = new Set((u.queue || []).flatMap((q) => (q.ns || []).map(Number))), wq = potOf(u).waits || {}, rw = new Set([...(x.rewriting || [])].map(Number));
    const refreshOf = (n) => (u.auto === false ? 'off' : rw.has(+n) ? 'now' : inQ.has(+n) ? 'queued' : wq[n] ? 'next-week' : 'soon');
    const specs = (await load()).moves?.SPECS || [], nm = (n) => (moves[n]?.title ? sentenceCase(moves[n].title) : sentenceCase(specs.find((p) => p.n === +n)?.discipline || '', [], { force: true })) || moveLabel(n);
    const stale = Object.values(u.stale || {}).filter((s) => moves[s.n] && s.via !== 'connected' /* a connected run rewrites them on its own */).sort((a, b) => (a.priority === b.priority ? a.n - b.n : a.priority === 'high' ? -1 : 1)).map((s) => ({ ...s, title: nm(s.n), refresh: refreshOf(s.n) }));
    const last = u.lastCheck?.at || s0?.doneAt || null;
    return { auto: u.auto !== false, every: REFRESH_DAYS, potNext: nextWeek(), checking: x.checking ? (u.checking || { at: Date.now() }) : null, lastCheck: u.lastCheck || null, lastError: u.lastError || null, stale,
      next: u.auto !== false && s0?.done ? (last || Date.now()) + REFRESH_DAYS * 864e5 : null, history: (u.history || []).slice(0, 10),
      rewriting: x.rewriting ? [...x.rewriting].map((n) => ({ n, title: nm(n), secs: x.inflight.has(n) ? Math.round((Date.now() - x.inflight.get(n)) / 1e3) : null, done: !x.inflight.has(n) && moves[n]?.meta?.rewrittenAt && Date.parse(moves[n].meta.rewrittenAt) > Date.now() - 3 * 3600e3 })) : null,
      /* a connected account's run, for the team: waiting for more connects, then rewriting every move with the numbers */
      connect: member && (u.connectRun || (u.connectDone && !u.connectDone.finished)) ? { names: (u.connectRun?.ids || u.connectDone?.ids || []).map((k) => NAME_OF[k] || k), waiting: !!u.connectRun, due: u.connectRun?.due || null,
        n: u.connectDone?.n || null, written: u.connectDone?.written || 0, later: (u.queue || []).some((q) => q.via === 'connected' && q.notBefore > Date.now()) } : null,
      pot: await (async () => { /* the week's pot, only once something drew from it or waits on it (quiet: never a $0 line) */
        const P = await potInfo(slug), waits = Object.entries(P.pot.waits || {}).filter(([n, k]) => (k === 'new' ? !moves[n] : !!u.stale?.[n])).length;
        return P.pot.usd > 0 || waits ? { spent: +P.pot.usd.toFixed(2), cap: P.cap, waiting: waits, est: P.est } : null; })(),
      canRewrite: !x.running, building: !!x.running && !x.rewriting, estMove: await estMove(slug), estCheck: 1, connected: (await packs.getJSON(slug, 'connected-ledger.json', [])).length > 0 || (member && (await packs.getJSON(slug, 'private/connected-ledger.json', [])).length > 0), accounts: Object.entries(u.connected || {}).filter(([, t]) => t).map(([k]) => NAME_OF[k] || k) };
  }
  // an account was connected (or disconnected): its numbers join the evidence, and the moves that measure or spend
  // on it are flagged to be looked at again. No paid call: the match is the fixed map in refresh.js
  const AREA_OF = { shopify: ['store'], meta: ['paid'], ga4: ['analytics'], google: ['paid'], klaviyo: ['email'], whatsapp: ['email'], reviews: ['reviews'] };
  const NAME_OF = { shopify: 'Shopify', meta: 'Meta Ads', ga4: 'Google Analytics', google: 'Google Ads', klaviyo: 'Klaviyo', whatsapp: 'WhatsApp', reviews: 'Judge.me' };
  const plain = (e) => e.label.replace(/ \(demo account\)$/, '');
  // the account numbers each kind of move leans on (by move number), so every flag names its own reason
  const WANTS = [[[4, 5, 6, 7, 8], /aov|conversion|repeat|cpa/], [[9, 10, 48, 49], /orders|conversion|sessions|roas|spend/], [[11, 12, 13, 14, 15, 16], /branded|sessions|mobile/],
    [[20, 21, 22, 23, 24, 25], /cpa|roas|frequency|spend/], [[29, 30, 31, 32, 33, 34, 35, 36, 37, 38], /conversion|checkout|mobile|pdp|cod|rto/], [[39, 40, 41, 42, 43, 44], /repeat|aov|list|flows|orders/]];
  const relevant = (n, add) => { const re = (WANTS.find(([ns]) => ns.includes(+n)) || [[], /./])[1]; const r = add.filter((e) => re.test(e.key)); return (r.length ? r : add).slice(0, 2); };
  async function connected(slug, ids = [], on = true) {
    const demo = (await packs.load(slug))?.demo; if (!demo) return;
    if ((await packs.getJSON(slug, 'private/members.json', null))?.owner) return; // a claimed brand: visitors' demo accounts don't touch its moves
    let L = await packs.getJSON(slug, 'connected-ledger.json', []);
    const moves = await packs.getJSON(slug, 'moves.json', {});
    for (const id of ids) {
      const add = demo.ledger?.[id] || [], keys = new Set(add.map((e) => e.key));
      L = L.filter((e) => !keys.has(e.key)); if (on) L.push(...add);
      const ns = [...new Set((AREA_OF[id] || []).flatMap((a) => CONNECTED_MOVES[a] || []))].filter((n) => moves[n]);
      await editUpd(slug, (u) => {
        for (const n of Object.keys(u.stale)) if (u.stale[n].via === id) delete u.stale[n];
        if (on && add.length) for (const n of ns) if (!u.stale[n]) { const rel = relevant(n, add);
          u.stale[n] = { n, priority: 'medium', via: id, demo: true, at: Date.now(),
            why: `${NAME_OF[id] || id} is connected (demo account). This plan used estimates for ${rel.map((e) => plain(e).toLowerCase()).join(' and ')}; it can now use ${rel.map((e) => e.v).join(' and ')}.`,
            changes: rel.map((e) => `New: ${plain(e)}: ${e.v}`) }; }
        u.connected = { ...(u.connected || {}), [id]: on ? Date.now() : null };
      });
    }
    await packs.put(slug, 'connected-ledger.json', L);
    emit(slug, { type: on ? 'connected' : 'disconnected', ids });
  }
  // a real account was read (connectors/index.js): its numbers join the evidence the moves are rewritten from, and the
  // moves that measure or spend on it are flagged, each with the number it can now use. Private accounts write to the
  // brand's private folder and flag privately (only the team sees those flags); the public marketplace read does not.
  const AREA_LIVE = { ...AREA_OF, marketplaces: ['store'] };
  NAME_OF.marketplaces = 'Marketplaces'; NAME_OF.slack = 'Slack';
  const PREFIX = { shopify: ['shopify.'], meta: ['meta.'], ga4: ['ga4.'], google: ['gads.'], klaviyo: ['klaviyo.'], marketplaces: ['market.'], reviews: ['reviews.judgeme.'] };
  /* an account that kept failing, or whose last good read is too old (connectors/index.js failure, ageCheck): its rows stay
     in the connected ledger, marked stale with why, so the fact sheet shows them as stale and the moves, cards and answers
     stop resting on them (evidenceRows). The next good read replaces them, unmarked */
  async function staleConnected(slug, id, why, { public: pub = false } = {}) {
    const file = pub ? 'connected-ledger.json' : 'private/connected-ledger.json', mine = (e) => !e.demo && (PREFIX[id] || []).some((p) => e.key.startsWith(p));
    const L = await packs.getJSON(slug, file, []); let n = 0;
    for (const e of L) if (mine(e) && !e.stale) { e.stale = true; e.staleWhy = why; n++; }
    if (!n) return 0;
    await packs.put(slug, file, L);
    await hooks.connected?.(slug, id); /* the fact sheet (facts-desk connected) shows them as stale; the site's fact is the truth again */
    log.log?.(`[connect] ${slug} ${id}: ${n} rows stale (${why})`);
    return n;
  }
  async function liveConnected(slug, id, add = [], on = true, { public: pub = false } = {}) {
    const file = pub ? 'connected-ledger.json' : 'private/connected-ledger.json', mine = (e) => !e.demo && (PREFIX[id] || []).some((p) => e.key.startsWith(p));
    const before = await packs.getJSON(slug, file, []), was = before.filter(mine);
    // a real account replaces its demo numbers
    const L = [...before.filter((e) => !mine(e) && !(e.demo && (PREFIX[id] || []).some((p) => e.key.startsWith(p)))), ...(on ? add : [])];
    await packs.put(slug, file, L);
    const moves = await packs.getJSON(slug, 'moves.json', {});
    /* the first read flags with what the account brings; every re-read after it flags only what moved materially since the
       moves were last written with it (liveMaterial: 10% or more, a list whose names changed), kept in the brand's base file */
    const rows = on ? realRows(add) : [], baseFile = pub ? 'live-base.json' : 'private/live-base.json'; /* a simulated account never marks a move out of date */
    const base0 = await packs.getJSON(slug, baseFile, {}), first = !was.length;
    const { changes, base } = liveMaterial(first ? {} : base0, rows, { pct: LIVE_MATERIAL });
    if (on) await packs.put(slug, baseFile, { ...base0, ...base });
    else await packs.put(slug, baseFile, Object.fromEntries(Object.entries(base0).filter(([k]) => !(PREFIX[id] || []).some((p) => k.startsWith(p)))));
    const fresh = first ? rows : rows.filter((e) => changes.some((c) => c.key === e.key));
    const ns = [...new Set((AREA_LIVE[id] || []).flatMap((a) => CONNECTED_MOVES[a] || []))].filter((n) => moves[n]); /* every move the account touches */
    const at = Date.now();
    await editUpd(slug, (u) => {
      /* a flag stays until its move is rewritten (the weekly run) or the account is disconnected: a quiet re-read never clears it */
      if (!on) for (const n of Object.keys(u.stale)) if (u.stale[n].via === id) delete u.stale[n];
      if (fresh.length) for (const n of ns) { const o = u.stale[n]; if (o && (o.via !== id || o.stockWhy)) continue; const rel = relevant(n, fresh);
        const lines = first ? rel.map((e) => `New: ${e.label}: ${e.v}`) : changes.filter((c) => rel.some((e) => e.key === c.key)).map(changeLine);
        u.stale[n] = { n, priority: 'medium', via: id, live: true, real: true, private: !pub, at: o?.at || at, seenAt: at,
          why: first ? `${NAME_OF[id] || id} is connected. This plan used estimates for ${rel.map((e) => e.label.toLowerCase()).join(' and ')}; it can now use ${rel.map((e) => e.v).join(' and ')}.`
            : `${NAME_OF[id] || id} moved since this plan was written: ${lines.join('; ')}.`,
          changes: [...new Set([...lines, ...(o?.changes || [])])].slice(0, 6) }; }
      u.connected = { ...(u.connected || {}), [id]: on ? Date.now() : null };
    });
    emit(slug, { type: on ? 'connected' : 'disconnected', ids: [id], live: true });
    /* orders by shipping country and visits by country say where the customers really are: the market follows them */
    if (['shopify', 'ga4', 'google'].includes(id)) await marketCheck(slug).catch((e) => log.warn('[market] connected', slug, e.message));
    if (!pub) await hooks.connected?.(slug, id).catch((e) => log.warn('[facts] connected', e.message)); /* the fact sheet: connected accounts are the source of truth (facts-desk.js) */
    if (!pub && (changes.length || !on)) await teamView(slug).catch((e) => log.warn('[connect] team view', e.message)); /* the brief and profile follow every changed number */
    /* a team account read for the first time (not a resync, not a disconnect, never a simulated one): every move is rewritten with it */
    if (!pub && on && !was.length && realRows(add).length) await connectSoon(slug, id).catch((e) => log.warn('[connect] run', slug, e.message));
    else if (!pub) await connectRead(slug, id).catch(() => {}); /* read (or gone) with nothing new to write from: the run stops waiting for it */
  }

  /* ---------- a real account connected: Brew rewrites every move with its numbers, and the team's view of the brand follows ----------
     Connecting three accounts in a row costs one run: the run waits CONNECT_SETTLE after the last connect (kept in updates.json
     connectRun, so a restart carries it). It runs once the moves are written: a build in progress picks it up when it ends. */
  const settling = new Map();
  /* an account was just connected (its first read is on its way): the run waits for that read and a quiet CONNECT_SETTLE after it */
  async function connectPending(slug, id) {
    if (blocked(slug)) return; const at = Date.now(), due = at + CONNECT_SETTLE;
    await editUpd(slug, (u) => { const r = u.connectRun || { ids: [] }; u.connectRun = { ...r, waiting: { ...(r.waiting || {}), [id]: at }, due: Math.max(+r.due || 0, due) }; });
    armConnect(slug, due);
  }
  /* an account's first read is in (connectSoon) or brought nothing to write from (connectRead): it no longer holds the run */
  async function connectSoon(slug, id) {
    const due = Date.now() + CONNECT_SETTLE;
    await editUpd(slug, (u) => { const w = { ...(u.connectRun?.waiting || {}) }; delete w[id]; u.connectRun = { ...(u.connectRun || {}), ids: [...new Set([...(u.connectRun?.ids || []), id])], waiting: w, due }; });
    armConnect(slug, due); emit(slug, { type: 'connect-run', ids: [id], due });
  }
  async function connectRead(slug, id) {
    let left = null; await editUpd(slug, (u) => { const r = u.connectRun; if (!r?.waiting?.[id]) return; const w = { ...r.waiting }; delete w[id];
      if (!(r.ids || []).length && !Object.keys(w).length) delete u.connectRun; else { u.connectRun = { ...r, waiting: w }; left = u.connectRun; } });
    if (left) armConnect(slug, left.due || 0);
  }
  /* which of the team's accounts a set of ledger rows comes from (shopify, meta, ga4, ...) */
  const idsOfRows = (rows = []) => Object.entries(PREFIX).filter(([, ps]) => rows.some((e) => ps.some((p) => String(e?.key || '').startsWith(p)))).map(([id]) => id).sort();
  function armConnect(slug, due) {
    clearTimeout(settling.get(slug));
    const t = setTimeout(() => { settling.delete(slug); onConnect(slug).catch((e) => log.error('[connect] run', slug, e.message)); }, Math.max(0, due - Date.now())); t.unref?.(); settling.set(slug, t);
  }
  /* the team's view of the brand from the real account rows: best sellers, the size of the business, the brief with the account
     numbers (no AI, no spend). Built again whenever an account's numbers change, so a corrected read (a currency, the brand's own
     campaigns) never leaves an old number in the brief the moves are written from. No rows left: the private copies go. */
  async function teamView(slug, rows = null) {
    rows ||= realRows(await packs.getJSON(slug, 'private/connected-ledger.json', []));
    if (!rows.length) { for (const f of ['private/profile-live.json', 'private/brief.json', 'private/brief.md']) await packs.del?.(slug, f).catch(() => {}); return; }
    const profile = normalizeProfile(await packs.getJSON(slug, 'profile.json', {})), live = profileLive(rows, profile);
    await packs.put(slug, 'private/profile-live.json', live);
    const b = briefWithConnected(await packs.getJSON(slug, 'brief.json', null), rows);
    if (b) { await packs.put(slug, 'private/brief.json', b.json); await packs.put(slug, 'private/brief.md', b.md); }
    /* where the brand sells, for the calendar: only the country codes (10% of visits or more), never the shares */
    if (live.countries?.length) await packs.put(slug, 'ga4/countries.json', live.countries.filter((c) => c.share >= 0.1).map((c) => ({ code: c.code })));
  }
  async function onConnect(slug) {
    if (blocked(slug)) return;
    const u0 = await upd(slug), run = u0.connectRun, now = Date.now(); if (!run) return;
    /* settle first: a quiet CONNECT_SETTLE since the last connect or first read (whatever fired this timer early), and every
       just-connected account's first read in (CONNECT_READ_MAX at most), so one run carries every account's numbers */
    const w0 = settleWait(run, { now, readMaxMs: CONNECT_READ_MAX }); if (w0) return armConnect(slug, w0);
    if (!run.ids?.length) { await editUpd(slug, (u) => { delete u.connectRun; }); return; }
    const s0 = await status(slug); if (!s0?.done || st(slug).running && !st(slug).rewriting) return; /* the build's finish picks it up */
    /* a connected run still writing or queued: this one waits for it, so no move is written twice in one sitting */
    if ((st(slug).running && u0.rewriting?.via === 'connected') || (u0.queue || []).some((q) => q.via === 'connected' && !(q.notBefore > now + 3600e3))) return armConnect(slug, now + 5 * 60e3);
    const rows = realRows(await packs.getJSON(slug, 'private/connected-ledger.json', []));
    if (!rows.length) { await editUpd(slug, (u) => { delete u.connectRun; }); return; }
    await teamView(slug, rows);
    /* the brand's first connected account rewrites every move, once. An account connected after that rewrites only the moves it
       touches (CONNECTED_MOVES), skipping one rewritten in the last day; a skipped move keeps its flag for the weekly run */
    const moves = await packs.getJSON(slug, 'moves.json', {}), ok = await rewritable(moves), all = Object.keys(moves).map(Number).filter(ok).sort((a, z) => a - z);
    /* the first run is decided from the moves themselves too (a team rewrite on file), so an older instance saving updates.json
       over connectFull never starts a second full run. Each move is written once per set of accounts: a move whose private
       version already carries every account that touches it (meta.connectedWith) is left alone */
    const u1 = await upd(slug), at = Date.now(), pm = await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({}));
    const full = !(u1.connectFull || u1.connectDone?.at || Object.values(pm || {}).some((m) => m?.meta?.rewrittenAt)), nowIds = idsOfRows(rows);
    const touches = (id, n) => (AREA_LIVE[id] || []).some((a) => (CONNECTED_MOVES[a] || []).includes(n));
    const ns = connectTargets({ all, full, runIds: run.ids, nowIds, pm, moves, touches, at, freshMs: CONNECT_FRESH_MS });
    const names = run.ids.map((i) => NAME_OF[i] || i), said = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are connected` : `${names[0]} is connected`;
    if (!ns.length) { await editUpd(slug, (u) => { delete u.connectRun; }); log.log(`[connect] ${slug}: ${said}; its moves were rewritten in the last day, nothing to rewrite now`); return; }
    await editUpd(slug, (u) => { if (full) u.connectFull = at;
      for (const n of ns) u.stale[n] = { n, priority: 'medium', via: 'connected', live: true, real: true, private: true, at, why: `${said}: rewritten with your real numbers.`, changes: [] };
      delete u.connectRun; u.connectDone = { at, ids: run.ids, n: ns.length, finished: null, written: 0 };
    });
    await enqueue(slug, ns, { via: 'connected', auto: true, tries: 0 });
    log.log(`[connect] ${slug}: ${said}, rewriting ${full ? `every move (${ns.length}), the first connect` : `the ${ns.length} moves it touches`} (cap $${CONNECT_CAP})`);
    emit(slug, { type: 'connect-rewrite', ids: run.ids, n: ns.length });
    drain(slug).catch((e) => log.warn('[connect] drain', e.message));
  }
  /* a connected run's end, worked out from the moves themselves, not from a write that has to survive: a deploy mid-run restarts
     it (resumeRewrite) and an older instance can save updates.json over the newer one. A move rewritten since the run began is
     done; the flags of done moves go, the run is marked finished with its history line, and the team hears once. Moves still
     missing with nothing queued or running for them are queued again (three times at most). Runs after each connected rewrite
     and after a restart. */
  async function settleConnect(slug) {
    const u0 = await upd(slug), c = u0.connectDone;
    if (!c?.at || c.finished || u0.connectRun || u0.rewriting || st(slug).running || (u0.queue || []).some((q) => q.via === 'connected')) return;
    const pub = await packs.getJSON(slug, 'moves.json', {}), pm = await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({}));
    const done = (n) => Math.max(Date.parse(pm?.[n]?.meta?.rewrittenAt || 0) || 0, Date.parse(pub[n]?.meta?.rewrittenAt || 0) || 0) >= c.at;
    const flagged = Object.values(u0.stale || {}).filter((s) => s.via === 'connected').map((s) => +s.n);
    const left = flagged.filter((n) => pub[n] && !done(n));
    if (left.length) { const tries = c.settleTries || 0; if (tries >= 3) return;
      await editUpd(slug, (u) => { if (u.connectDone) u.connectDone.settleTries = tries + 1; });
      log.log(`[connect] ${slug}: ${left.length} moves of the connected run are still to write, queued again`);
      await enqueue(slug, left, { via: 'connected', auto: true, tries: tries + 1 }); return drain(slug); }
    const ns = [...new Set([...Object.keys(pub), ...Object.keys(pm || {})].map(Number))].filter((n) => n >= 1 && n < 1000 && done(n)).sort((a, z) => a - z);
    const title = (n) => (pm?.[n] || pub[n])?.title || moveLabel(n), names = (c.ids || []).map((k) => NAME_OF[k] || k).join(' and ') || 'Your accounts';
    let first = false;
    await editUpd(slug, (u) => { const d = u.connectDone; if (!d || d.at !== c.at || d.finished) return; first = true;
      for (const [n, s] of Object.entries(u.stale || {})) if (s.via === 'connected' && done(+n)) delete u.stale[n];
      u.connectDone = { ...d, finished: Date.now(), written: ns.length };
      if (!(u.history || []).some((h) => h.connected === c.at)) u.history = [{ at: Date.now(), auto: true, connected: c.at, moves: ns.map((n) => ({ n, title: title(n) })), usd: null, because: `${names} connected` }, ...(u.history || [])].slice(0, 30);
    });
    if (!first || !ns.length) return;
    log.log(`[connect] ${slug}: the connected run is in, ${ns.length} moves rewritten`);
    emit(slug, { type: 'connect-done', n: ns.length });
    /* the run's own start time keys the email, so a second settle never sends it twice */
    notify(slug, 'update', { at: c.at, moves: ns.map((n) => ({ n, title: title(n) })), members: true, lead: `${names} ${(c.ids || []).length > 1 ? 'are' : 'is'} connected, so Brew rewrote ${ns.length} of ${(await status(slug))?.name || slug}’s moves with your real numbers`, because: 'Only your team sees these versions.' }).catch((e) => log.warn('[notify]', e.message));
  }
  /* the weekly rewrite of what connected accounts flagged: once every LIVE_DAYS, the moves their re-reads flagged (real accounts
     only, never the first-connect run's own flags), best kind first, as far as the week's pot goes. A move the pot stopped keeps its flag for
     the next week; a brand whose first-connect run is still going waits for it */
  async function liveWeekly(slug, { now = Date.now() } = {}) {
    if (blocked(slug) || st(slug).running && !st(slug).rewriting) return { skipped: 'busy' };
    const u = await upd(slug);
    if (u.connectRun || (u.queue || []).some((q) => q.via === 'connected' || q.via === 'live') || u.rewriting?.via === 'live') return { skipped: 'waiting' };
    if (now - (u.liveRun?.at || 0) < LIVE_DAYS * 864e5) return { skipped: 'this week' };
    const moves = await packs.getJSON(slug, 'moves.json', {}), ok = await rewritable(moves);
    /* every flag kind waits here (the site check's medium ones, the fact sheet's, a fresh reload's, older ones), never the
       first-connect run's own (it rewrites them itself) and never a simulated account's; out of stock goes first */
    const items = Object.values(u.stale || {}).filter((f) => f && f.via !== 'connected' && !f.demo && !(f.live && !f.real) && ok(f.n)).map((f) => ({ n: +f.n, kind: flagKind(f), at: f.at || 0, top: !!(f.stock || f.via === 'stock') }));
    if (!items.length) return { skipped: 'nothing flagged' };
    const P = await potInfo(slug, now), { now: go, wait } = potFit(P.pot, P.cap, P.est, items), ns = go.map((x) => x.n);
    await potWait(slug, wait, go);
    if (!ns.length) { log.log(`[pot] ${slug}: the weekly run waits for next week's pot ($${P.pot.usd.toFixed(2)} of $${P.cap} spent), ${wait.length} moves flagged`); return { skipped: 'pot', wait: wait.map((x) => x.n) }; }
    await editUpd(slug, (v) => { v.liveRun = { at: now, ns }; });
    log.log(`[live] ${slug}: weekly rewrite of ${ns.length} flagged moves (${ns.join(', ')}), about $${(ns.length * P.est).toFixed(2)} of the week's $${P.cap} pot ($${P.pot.usd.toFixed(2)} spent)${wait.length ? `; ${wait.length} wait for next week` : ''}`);
    await enqueue(slug, ns, { via: 'live', auto: true });
    drain(slug).catch((e) => log.warn('[live] drain', e.message));
    return { ok: true, ns, wait: wait.map((x) => x.n) };
  }
  /* outdated moves refresh on their own (Param, 19 Oct: "I want outdated moves to be automatically refreshed"): the hourly tick
     and every signal that flags moves queue the flagged moves this week's pot covers, best kind first (out of stock, events,
     the site check, accounts, the rest); what the pot can't cover keeps its flag and waits for next week's pot. A move written
     in the last day waits a day, so a signal that flips back and forth can't loop. Auto off (updates.json auto) stops it */
  const SWEEP_EVERY = +(process.env.STALE_SWEEP_MS ?? 3600e3), SWEEP_FRESH = +(process.env.STALE_FRESH_MS ?? 864e5);
  async function staleSweep(slug, { now = Date.now(), why = 'hourly' } = {}) {
    if (process.env.STALE_SWEEP === '0') return { skipped: 'off' };
    if (blocked(slug) || (st(slug).running && !st(slug).rewriting)) return { skipped: 'busy' };
    const s0 = await status(slug), u = await upd(slug);
    if (!s0?.done || s0.cancelled || u.auto === false) return { skipped: 'auto off' };
    if (u.connectRun || (u.queue || []).some((q) => q.via === 'connected')) return { skipped: 'waiting' }; /* the first-connect run rewrites everything itself */
    if (why === 'hourly' && now - (u.sweep?.at || 0) < SWEEP_EVERY) return { skipped: 'recent' };
    const moves = await packs.getJSON(slug, 'moves.json', {}), ok = await rewritable(moves);
    const inQ = new Set((u.queue || []).flatMap((q) => (q.ns || []).map(Number))), busy = new Set([...(st(slug).rewriting || [])].map(Number));
    const fresh = (n) => now - (Date.parse(moves[n]?.meta?.rewrittenAt || '') || 0) < SWEEP_FRESH;
    const items = Object.values(u.stale || {}).filter((f) => f && f.via !== 'connected' && !f.demo && !(f.live && !f.real) && ok(+f.n) && !inQ.has(+f.n) && !busy.has(+f.n) && !fresh(+f.n))
      .map((f) => ({ n: +f.n, kind: flagKind(f), at: f.at || 0, top: !!(f.stock || f.via === 'stock') }));
    await editUpd(slug, (v) => { v.sweep = { at: now, why }; });
    if (!items.length) return { skipped: 'nothing flagged' };
    const P = await potInfo(slug, now), { now: go, wait } = potFit(P.pot, P.cap, P.est, items), ns = go.map((x) => x.n);
    await potWait(slug, wait, go);
    if (!ns.length) { log.log(`[stale] ${slug}: ${wait.length} outdated moves wait for next week's pot ($${P.pot.usd.toFixed(2)} of $${P.cap} spent)`); return { skipped: 'pot', wait: wait.map((x) => x.n) }; }
    log.log(`[stale] ${slug}: refreshing ${ns.length} outdated moves (${ns.join(', ')}, ${why}), about $${(ns.length * P.est).toFixed(2)} of the week's $${P.cap} pot${wait.length ? `; ${wait.length} wait for next week` : ''}`);
    await enqueue(slug, ns, { via: 'stale', auto: true });
    drain(slug).catch((e) => log.warn('[stale] drain', e.message));
    return { ok: true, ns, wait: wait.map((x) => x.n) };
  }
  const setAuto = (slug, on) => editUpd(slug, (u) => { u.auto = !!on; }).then(() => ({ ok: true }));
  // "whenever relevant": the free catalog watch (every 3 hours) saw a price change, a launch or a removal
  const RETRY_MS = +process.env.REFRESH_RETRY_MS || 24 * 3600e3;
  const backingOff = (u) => !!u?.lastError?.at && Date.now() - u.lastError.at < RETRY_MS;
  /* a product a move builds on went out of stock or off the site (the free catalog watch, every 3 hours): every move that names
     it is marked out of date at once (no AI, no spend) with the reason on the move, and rewritten in the weekly run. Back in
     stock (or back on the site) takes the mark off. Only a change counts: updates.json stockOut keeps what is already known */
  const STOCK_V = 2;
  async function stockSignal(slug, events = []) {
    const out = events.filter((e) => ['oos', 'removed', 'gone'].includes(e.kind)), back = events.filter((e) => e.kind === 'back' || e.kind === 'new');
    if (!out.length && !back.length) return { flagged: [] };
    if (!(await status(slug))?.done) return { flagged: [] };
    const pub = await packs.getJSON(slug, 'moves.json', {}), priv = await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({}));
    const seenP = events.flatMap((e) => e.items || []).filter((x) => x?.handle && x.title), products = [...((await packs.getJSON(slug, 'profile.json', {}))?.catalog?.products || []), ...seenP.filter((x, i, a) => a.findIndex((y) => y.handle === x.handle) === i)];
    const items = new Map(); for (const e of out) for (const it of e.items || []) { const h = handleOfItem(it); if (h && !items.has(h)) items.set(h, { it, kind: e.kind === 'oos' ? 'oos' : 'gone' }); }
    /* back in stock clears an out-of-stock mark; a product back on the site clears a gone one; never one this same pass marks out */
    const backH = new Map(); for (const e of back) for (const it of e.items || []) { const h = handleOfItem(it); if (h && !items.has(h)) backH.set(h, new Set([...(backH.get(h) || []), e.kind === 'back' ? 'oos' : 'gone'])); }
    const at = Date.now(), flagged = new Set();
    const whyOf = (f) => [...Object.values(f.stockWhy || {}), f.was?.why].filter(Boolean).join(' ');
    await editUpd(slug, (u) => {
      /* STOCK_V 2 (2026-10-16): a 15ml variant out of stock had marked every move naming the 200ml one (54 of Arata's). Once per
         brand, every stock mark comes off (an earlier flag underneath is restored) and this pass marks again with the fixed names */
      if ((u.stockV || 1) < STOCK_V) { for (const [n, f] of Object.entries(u.stale || {})) { if (!f?.stockWhy) continue;
          if (f.was) { const { stockWhy, was, stock, ...rest } = f; u.stale[n] = { ...rest, ...was }; } else delete u.stale[n]; }
        u.stockOut = {}; u.stockV = STOCK_V; }
      const known = (u.stockOut ||= {});
      for (const [h, kinds] of backH) {
        if (!known[h] || !kinds.has(known[h].kind)) continue;
        delete known[h];
        for (const [n, f] of Object.entries(u.stale)) { if (!f?.stockWhy?.[h]) continue; const sw = { ...f.stockWhy }; delete sw[h];
          if (Object.keys(sw).length) u.stale[n] = { ...f, stockWhy: sw, why: whyOf({ ...f, stockWhy: sw }) };
          else if (f.was) { const { stockWhy, was, stock, ...rest } = f; u.stale[n] = { ...rest, ...was }; }
          else delete u.stale[n]; }
      }
      for (const [h, { it, kind }] of items) {
        if (known[h]?.kind === kind) continue; known[h] = { kind, at };
        const names = productNames(it, products), name = (products.find((x) => x.handle === h)?.title) || (it.title && !/^[a-z]+\.[\w.-]+$/.test(it.title) ? it.title : names[0]);
        const why = kind === 'oos' ? `${name} is out of stock on the site, and this move builds on it.` : `${name} is no longer on the site, and this move builds on it.`;
        for (const n of new Set([...movesNaming(pub, names), ...movesNaming(priv, names)])) { if (!pub[n] && !priv[n]) continue; const o = u.stale[n];
          const was = o ? (o.stockWhy ? o.was : { priority: o.priority, why: o.why, ...(o.via ? { via: o.via } : {}) }) : null;
          const f = { ...(o || {}), n, priority: 'high', via: o?.via || 'stock', stock: true, stockWhy: { ...(o?.stockWhy || {}), [h]: why }, was, at: o?.at || at, changes: [...new Set([`${kind === 'oos' ? 'Out of stock' : 'Gone from the site'}: ${name}`, ...(o?.changes || [])])].slice(0, 6) };
          f.why = whyOf(f); u.stale[n] = f; flagged.add(n); }
      }
    });
    if (flagged.size) { emit(slug, { type: 'update-done', changes: items.size, flagged: flagged.size }); log.log(`[stock] ${slug}: ${flagged.size} moves out of date (${[...flagged].join(', ')}): ${[...items.keys()].join(', ')}`);
      staleSweep(slug, { why: 'stock' }).catch((e) => log.warn('[stale] stock', slug, e.message)); } /* refreshed now, not at the weekly run */
    return { flagged: [...flagged] };
  }
  async function signal(slug, events = []) {
    await stockSignal(slug, events).catch((e) => log.warn('[stock]', slug, e.message));
    const rel = events.filter((e) => ['price', 'new', 'removed', 'gone', 'drift', 'rival-price', 'rival-launch'].includes(e.kind)); if (!rel.length) return;
    const s0 = await status(slug), u = await upd(slug); if (!s0?.done || u.auto === false || st(slug).running || st(slug).checking) return;
    if (Date.now() - (u.lastCheck?.at || s0.doneAt || 0) < 24 * 3600e3 || backingOff(u)) return; /* at most one event-driven check a day, and a day after a failed one */
    const say = { price: 'a price changed', new: 'a product launched', removed: 'a product was removed', gone: 'a product we quote is gone', drift: 'a price we quote changed', 'rival-price': 'a rival changed its prices', 'rival-launch': 'a rival launched a product' };
    const rival = rel.every((e) => e.kind.startsWith('rival-'));
    checkUpdates(slug, { auto: true, max: 1, via: 'event', why: `${rival ? 'The market moved' : 'Your catalog changed'}: ${[...new Set(rel.map((e) => say[e.kind]))].join(', ')}` }); /* one move: the one the change hits hardest */
  }
  // the weekly check, for brands someone opened in the last month
  const seenAt = new Map();
  const seen = (slug) => { if (Date.now() - (seenAt.get(slug) || 0) < 3600e3) return; seenAt.set(slug, Date.now()); setStatus(slug, { seenAt: Date.now() }).catch(() => {}); };
  function autoRefresh() {
    if (process.env.BUILD_RESUME_OFF) return;
    const autoOn = process.env.REFRESH_AUTO !== '0';
    const tick = async () => { for (const b of await packs.list().catch(() => [])) {
      const s0 = b.status;
      /* a late check that waited (the day's budget, a billing pause, a busy brand) is tried again */
      if (s0?.recheck?.at && !st(b.slug).running && !st(b.slug).checking && !blocked(b.slug)) await drain(b.slug).catch((e) => log.warn('[check] late', b.slug, e.message));
      /* "it carries on tomorrow": a build paused for the day's shared budget picks up the next day, not only at the next restart */
      if (s0 && !s0.done && !s0.error && !s0.capped && !s0.cancelled && s0.pausedDay && s0.pausedDay < dayKey() && !st(b.slug).running && !blocked(b.slug)) { log.log(`[build] ${b.slug}: paused on ${s0.pausedDay} for the day's budget, carrying on`); resume(b.slug).catch((e) => log.error('[build] resume', b.slug, e.message)); continue; }
      /* "Brew retries within the hour": moves that failed twice are written again on the next tick (not while the AI is paused for credit; the build cap bounds the tries) */
      if (s0 && !s0.done && !s0.error && !s0.capped && !s0.cancelled && (s0.retryMoves || s0.aiPausedAt) && !aiPaused() && Date.now() - (+s0.retryAt || 0) > 30 * 60e3 && !st(b.slug).running && !blocked(b.slug)) { log.log(`[build] ${b.slug}: ${s0.retryMoves ? `${s0.retryMoves} moves still to write` : 'the AI pause lifted'}, trying again`); resume(b.slug).catch((e) => log.error('[build] resume', b.slug, e.message)); continue; }
      if (!autoOn || !s0?.done || s0.cancelled || blocked(b.slug)) continue;
      if (Date.now() - (s0.seenAt || s0.doneAt || 0) > 30 * 864e5) continue;
      const u = await upd(b.slug); if (u.auto === false) continue;
      await liveWeekly(b.slug).catch((e) => log.warn('[live] weekly', b.slug, e.message)); /* its own week: a failed site check does not hold it */
      await staleSweep(b.slug).catch((e) => log.warn('[stale] sweep', b.slug, e.message)); /* outdated moves refresh within the hour, inside the week's pot */
      await hooks.newMoves?.(b.slug).catch((e) => log.warn('[pot] new moves', b.slug, e.message)); /* new moves from learnings that waited for the pot */
      if (backingOff(u)) continue; /* a failed check waits a day before the next paid try, not an hour */
      if (Date.now() - (u.lastCheck?.at || s0.doneAt || Date.now()) > REFRESH_DAYS * 864e5) await checkUpdates(b.slug, { auto: true, why: 'Weekly check' });
    } };
    setTimeout(() => tick().catch((e) => log.warn('[refresh] tick', e.message)), 10 * 60e3).unref?.();
    setInterval(() => tick().catch((e) => log.warn('[refresh] tick', e.message)), 3600e3).unref?.();
  }
  async function list() {
    const all = await packs.list();
    return all.filter((x) => !blocked(x.slug) && !x.status.cancelled && !x.status.error).sort((a, b) => (b.status.updatedAt || 0) - (a.status.updatedAt || 0)).map((x) => ({ slug: x.slug, name: x.status.name, host: x.status.host, logo: x.status.logo ? (/^https?:\/\//.test(x.status.logo) ? x.status.logo : '/' + String(x.status.logo).replace(/^\/+/, '')) : null, /* one leading slash: '//b/..' would be read as another host */ state: x.status.done ? 'Ready' : x.status.ready ? `${x.status.movesDone || 0} of ${totalOf(x.status)} moves` : waitingOnCheck(x.status) ? 'Waiting for you to check the read' : 'Reading' }));
  }
  // after a restart: carry on with any brand that wasn't finished
  /* a one-off fresh reload (OPS_FRESH_RELOAD=<slug,...>): the pending updates are dropped, the brand's cap lifts (Pro), the build
     writes every missing move from today's brief (with the team's learnings), then every older move (and the index) is rewritten.
     A marker in the pack (private/ops-fresh.json) makes it run once and carry on across restarts */
  async function freshReload(slug) {
    if (blocked(slug) || !(await status(slug))) return;
    let mk = await packs.getJSON(slug, 'private/ops-fresh.json', null); if (mk?.phase === 'done' || mk?.phase === 'stalled') return; /* a stalled run waits for a person: it never starts another paid pass at boot */
    if (!mk) { mk = { startedAt: Date.now(), phase: 'build' }; await packs.put(slug, 'private/ops-fresh.json', mk);
      await editUpd(slug, (u) => { u.stale = {}; delete u.queue; delete u.queueDay; });
      const L = await packs.getJSON(slug, 'learned.json', null); if (L && (L.pendingFull || L.draft)) { delete L.pendingFull; delete L.draft; await packs.put(slug, 'learned.json', L); }
      const s0 = (await status(slug)) || {}; await setStatus(slug, { pro: true, proAt: s0.proAt || Date.now(), proBy: s0.proBy || 'ops: fresh reload', capped: false, pausedDay: null });
      log.log(`[ops] ${slug}: fresh reload started`); }
    const tick = async () => {
      const x = st(slug), s1 = await status(slug); mk = await packs.getJSON(slug, 'private/ops-fresh.json', mk);
      if (mk.phase === 'done' || mk.phase === 'stalled' || blocked(slug) || s1?.cancelled) return;
      if (x.running) return setTimeout(tick, 60e3).unref?.();
      if (!s1?.done) { if (s1?.capped || s1?.pausedDay) await setStatus(slug, { capped: false, pausedDay: null }); log.log(`[ops] ${slug}: writing the missing moves`); resume(slug).catch((e) => log.error('[ops] resume', e.message)); return setTimeout(tick, 120e3).unref?.(); }
      const moves = await packs.getJSON(slug, 'moves.json', {}), t0 = mk.startedAt;
      const old = Object.keys(moves).map(Number).filter((n) => n >= 1 && n < 1000 /* every playbook move, not the weekly ones (1001+) */ && Math.max(Date.parse(moves[n]?.meta?.rewrittenAt || 0), Date.parse(moves[n]?.meta?.at || 0)) < t0).sort((a, b) => a - b);
      if (!old.length) { await packs.put(slug, 'private/ops-fresh.json', { ...mk, phase: 'done', doneAt: Date.now() }); log.log(`[ops] ${slug}: fresh reload done`); return; }
      await packs.put(slug, 'private/ops-fresh.json', { ...mk, phase: 'rewrite' }); log.log(`[ops] ${slug}: rewriting ${old.length} older moves: ${old.join(', ')}`);
      await editUpd(slug, (u) => { for (const n of old) u.stale[n] = { n, priority: 'high', why: 'Fresh reload with what the team told us', changes: [], at: Date.now() }; });
      await buildCtx.run(slug, () => rewriteNow(slug, old)).catch((e) => log.error('[ops] rewrite', e.message));
      /* a pass that rewrote nothing (budget, errors) stops the loop instead of paying again every minute (2026-10-14: about $7 for nothing) */
      const after = await packs.getJSON(slug, 'moves.json', {}), left = old.filter((n) => Math.max(Date.parse(after[n]?.meta?.rewrittenAt || 0), Date.parse(after[n]?.meta?.at || 0)) < t0);
      /* what is left are festival moves whose window has passed (no spec today): the reload is done, they stay as they are */
      if (left.length && left.every((n) => n >= 100)) { await packs.put(slug, 'private/ops-fresh.json', { ...mk, phase: 'done', doneAt: Date.now(), skipped: left }); log.log(`[ops] ${slug}: fresh reload done; ${left.join(', ')} left as they are (no spec today)`); return; }
      if (left.length >= old.length) { await packs.put(slug, 'private/ops-fresh.json', { ...mk, phase: 'stalled', stalledAt: Date.now(), why: 'a pass rewrote no moves' }); log.warn(`[ops] ${slug}: fresh reload stopped: a pass rewrote no moves`); return; }
      setTimeout(tick, 60e3).unref?.(); /* whatever a restart cut short is picked up next time round */ };
    setTimeout(tick, 20e3).unref?.();
  }
  /* a brand finished before the playbook had one count: its total is the moves it has (never the index or weekly moves) */
  async function healCount(slug) {
    const s0 = await status(slug); if (!s0?.done || (s0.total && s0.movesDone <= s0.total)) return;
    const moves = await packs.getJSON(slug, 'moves.json', {}), n = playDone(moves); if (!n) return;
    await setStatus(slug, { total: Math.max(n, +s0.total || 0), movesDone: n, applicable: Object.keys(moves).map(Number).filter((k) => isPlay(k, moves[k])).sort((a, c) => a - c) });
  }
  async function resumeAll() { for (const sl of String(process.env.OPS_FRESH_RELOAD || '').split(',').map((x) => x.trim()).filter(Boolean)) freshReload(sl).catch((e) => log.error('[ops] fresh', sl, e.message));
    for (const x of await packs.list()) { if (!x.status.done && !x.status.error && !x.status.capped) resume(x.slug).catch((e) => log.error('[build] resume', x.slug, e.message)); else { if (x.status.done) { rebase(x.slug).catch((e) => log.warn('[build] rebase', x.slug, e.message)); healPdfs(x.slug); healCount(x.slug).catch((e) => log.warn('[build] count', x.slug, e.message)); restartStatics(x.slug).catch((e) => log.warn('[build] statics restart', x.slug, e.message)); } healCards(x.slug).catch((e) => log.warn('[rewrite] heal cards', x.slug, e.message)).then(() => resumeRewrite(x.slug)).catch((e) => log.warn('[rewrite] resume', x.slug, e.message));
      if (x.status.recheck?.at) setTimeout(() => drain(x.slug).catch((e) => log.warn('[check] late', x.slug, e.message)), 60e3); /* a late check a restart cut short: after resumeRewrite has had its turn */
      upd(x.slug).then((u) => { if (u.connectRun) armConnect(x.slug, u.connectRun.due || 0); if ((u.queue || []).some((q) => q.notBefore)) drain(x.slug).catch(() => {});
        if (u.connectDone && !u.connectDone.finished) setTimeout(() => settleConnect(x.slug).catch((e) => log.warn('[connect] settle', e.message)), 90e3); /* after resumeRewrite has had its turn */ }).catch(() => {});
      /* saved team views heal: a brief built from an older read of an account is built again from today's rows (free) */
      packs.getJSON(x.slug, 'private/connected-ledger.json', []).then((L) => realRows(L).length ? teamView(x.slug) : null).catch((e) => log.warn('[connect] team view', x.slug, e.message)); } } }
  /* a statics job left "running" by an instance that went (older than an hour) is marked failed and started again from the saved Move 21 */
  async function restartStatics(slug) {
    if (blocked(slug)) return; const s0 = await status(slug); const sx = s0?.statics;
    if (!sx || sx.state !== 'running' || Date.now() - (+sx.at || 0) <= STATICS_STALE_MS) return;
    await setStatus(slug, { statics: { state: 'failed', err: 'cut off by a restart', at: Date.now() } });
    await load(); const m21 = (await packs.getJSON(slug, 'moves.json', {}))?.[21], profile = await packs.getJSON(slug, 'profile.json', null); if (!m21 || !profile) return;
    log.log(`[build] ${slug}: statics were cut off by a restart, starting again`);
    let lock = Promise.resolve(); await makeStatics(slug, m21, normalizeProfile(profile), (fn) => (lock = lock.then(fn).catch((e) => log.warn('[build] statics card', e.message)))); await lock;
  }
  /* Saved PDFs heal: when the PDF text rules change (PDF_V) the saved PDFs are forgotten and each is drawn again on its next
     download (pdfOn); entries for moves that no longer exist leave status.pdfs. Nothing is drawn ahead of time. */
  const PDF_V = 5; // 5: ₹ never ‹, claims the store never made marked "Proposed (team decides)" (final QA pass 19 Oct); 2: kickers without "OF N", "What to watch", BREW DRAFTS; 3: no "Brew re-reads / we pause", index without a count; 4: no source-method narration (brew-name.js unSkill) (2026-10-15)
  let pdfHealQ = Promise.resolve();
  const healPdfs = (slug) => (pdfHealQ = pdfHealQ.catch(() => {}).then(async () => {
    if (blocked(slug) || process.env.PDF_HEAL_OFF === '1') return;
    const m = await load(); if (!m.pdf) return;
    const s0 = await status(slug), moves = await packs.getJSON(slug, 'moves.json', {}), profile = await packs.getJSON(slug, 'profile.json');
    if (!s0?.done || !profile) return;
    const have = s0.pdfs || {};
    if (s0.pdfV === PDF_V && Object.keys(have).every((n) => moves[n])) return;
    const keep = s0.pdfV === PDF_V ? Object.fromEntries(Object.entries(have).filter(([n]) => moves[n])) : {};
    log.log(`[pdf] heal ${slug}: ${Object.keys(have).length - Object.keys(keep).length} PDFs forgotten, drawn again on their next download`);
    await setStatus(slug, { pdfs: keep, pdfVer: Object.fromEntries(Object.entries(s0.pdfVer || {}).filter(([n]) => n in keep)), pdfV: PDF_V, zips: [] });
  }).catch((e) => log.warn('[pdf] heal', slug, e.message)));
  // a finished brand whose lanes would come out differently today (the lane rules improved): publish its base again (free)
  async function rebase(slug) {
    if (blocked(slug)) return;
    const p = await packs.getJSON(slug, 'profile.json'), seed = await packs.getJSON(slug, 'seed.json'); if (!p || !seed) return;
    normalizeProfile(p); const want = Object.keys(seedFromProfile(slug, p, null).lanes).join();
    if (want === Object.keys(seed.lanes || {}).join()) return;
    log.log(`[build] rebase ${slug}: lanes ${Object.keys(seed.lanes || {}).join()} → ${want}`);
    await publishBase(slug, p, await packs.getJSON(slug, 'ledger.json', []), await packs.getJSON(slug, 'findings.json'));
  }

  autoRefresh();
  // a move written outside the build (moves-cadence.js) gets its PDF the same way
  const pdfFor = async (slug, move, o = {}) => { const m = await load(); if (!m.pdf) return null; const profile = await packs.getJSON(slug, 'profile.json'); if (!profile) return null; return renderPdf(slug, m.pdf, move, profile, o); }; /* { priv: true }: the team's copy (private/pdf) */
  /* a move's PDF, made when someone opens it: drawn once per version of the move (and of the PDF rules), then served from the
     pack; two people opening it at once wait for the same render. → { name, buf } | null */
  /* the brand's own words for the claims mark (claims.js): its facts, products and about */
  const claimSrcOf = async (slug) => { const [facts, profile] = await Promise.all([packs.getJSON(slug, 'facts.json', {}).catch(() => ({})), packs.getJSON(slug, 'profile.json', null).catch(() => null)]);
    return sourceText(Object.values(facts || {}).map((f) => [f?.label, f?.v, ...(f?.aliases || [])]), (profile?.catalog?.products || []).map((x) => [x?.title, x?.description]), profile?.about || '', profile?.brand?.about || ''); };
  const pdfJobs = new Map();
  async function pdfOn(slug, n) {
    if (blocked(slug)) return null;
    const moves = await packs.getJSON(slug, 'moves.json', {}), mv = moves?.[n]; if (!mv) return null;
    const s0 = (await status(slug)) || {}, ver = `${PDF_V}:${mv.meta?.at || ''}`, f = s0.pdfs?.[n];
    const fresh = f && (s0.pdfVer?.[n] ? s0.pdfVer[n] === ver : s0.pdfV === PDF_V); /* a PDF from before versions counts while the rules have not changed */
    if (fresh) { const buf = await packs.get(slug, 'pdf/' + f); if (buf) return { name: f, buf }; }
    const key = `${slug}:${n}:${ver}`;
    if (!pdfJobs.has(key)) pdfJobs.set(key, (async () => {
      const m = await load(); if (!m.pdf) throw new Error('PDF renderer not installed');
      const profile = await packs.getJSON(slug, 'profile.json'); if (!profile) throw new Error('no profile');
      await renderPdf(slug, m.pdf, markMoveClaims(mv, await claimSrcOf(slug)) /* a code or guarantee the store never made reads as the team's call, as on the page (QA-25) */, profile, { ver }); const name = m.pdf.pdfName(mv);
      return { name, buf: await packs.get(slug, 'pdf/' + name) };
    })().finally(() => pdfJobs.delete(key)));
    return pdfJobs.get(key);
  }
  /* ---------- the selling market (market.js) ----------
     Worked out again from what is saved: the read's signals (or its ledger, for older reads), the brand's own correction and the
     connected accounts' orders and visits by country. No AI, no fetch. When the market moves (an Indian-registered store whose
     orders go to the US), the profile, ledger, config and seed follow, and every move is flagged for the weekly rewrite: the
     week's pot pays for it (rewrite-pot.js), never an extra run. Returns { was, now, moved } or null when nothing changed. */
  async function marketCheck(slug) {
    if (blocked(slug) || st(slug).running) return null;
    const p = await packs.getJSON(slug, 'profile.json'); if (!p?.host || !p.slug) return null;
    const L = await packs.getJSON(slug, 'ledger.json', []) || [];
    const rows = [...realRows(await packs.getJSON(slug, 'connected-ledger.json', [])), ...realRows(await packs.getJSON(slug, 'private/connected-ledger.json', []))];
    const { market: m, changed } = marketFor(p, L, rows); if (!changed) return null;
    /* too close to call from the site alone (market.js toConfirm): a market the read only guessed is cleared, so the check page
       asks for it ("To confirm"). Nothing is rewritten for it and nothing is spent; the brand's answer pins it */
    if (!m.primary && m.toConfirm) { if (!p.country || p.market?.by !== 'site') return null;
      const was = p.country; Object.assign(p, { country: null, markets: [], market: { ...m, at: new Date().toISOString() } });
      for (const k of ['market.country', 'market.registered']) { const i = L.findIndex((x) => x.key === k); if (i >= 0) L.splice(i, 1); }
      await packs.put(slug, 'profile.json', p); await packs.put(slug, 'ledger.json', L);
      /* the settings follow: no country, name, markets or sale day left behind for the cards and watchers (QA 19 Oct) */
      const cfg0 = await packs.getJSON(slug, 'config.json', null); if (cfg0) await packs.put(slug, 'config.json', { ...cfg0, ...marketConfig(p) });
      packs.drop?.(slug); await onPack(slug);
      log.log?.(`[market] ${slug}: ${was} → to confirm (${m.why})`); return { was, now: null, moved: false, by: 'site', toConfirm: true }; }
    if (!m.primary) return null;
    const was = p.market?.primary || p.country || null, moved = !!was && was !== m.primary;
    applyMarket(p, m);
    const at = new Date().toISOString().slice(0, 10), put = (e) => { const i = L.findIndex((x) => x.key === e.key); if (i >= 0) L[i] = { ...L[i], ...e }; else L.push(e); };
    put({ key: 'market.country', label: 'Main selling market (where customers are)', v: m.primary, layer: 'inferred', method: m.by === 'site' ? 'crawl' : m.by === 'brand' ? 'brand-confirmed' : `account:${m.by === 'orders' ? 'shopify' : 'ga4'}`, conf: m.conf, at,
      note: m.why + (m.others?.length ? `; other markets: ${m.others.join(', ')}` : '') + (L.find((x) => x.key === 'market.country')?.note?.match(/; hreflang: [^;]+/)?.[0] || '') });
    if (m.registered && m.registered !== m.primary) put({ key: 'market.registered', label: 'Registered in (not the selling market)', v: m.registered, layer: 'inferred', method: 'crawl', conf: 'high', at, note: `The store's address is in ${nameOf(m.registered)}; ${m.why}` });
    else { const i = L.findIndex((x) => x.key === 'market.registered'); if (i >= 0) L.splice(i, 1); }
    const sc = L.find((x) => x.key === 'shop.country'); if (sc) sc.label = 'Country the store is registered in (Shopify /meta.json; not where it sells)';
    await packs.put(slug, 'profile.json', p); await packs.put(slug, 'ledger.json', L);
    const cfg = await packs.getJSON(slug, 'config.json', null); if (cfg) await packs.put(slug, 'config.json', { ...cfg, ...marketConfig(p) }); /* country, locale, holidays, search location */
    packs.drop?.(slug); await onPack(slug);
    if (moved) {
      const moves = await packs.getJSON(slug, 'moves.json', {}), ok = await rewritable(moves), ns = Object.keys(moves).map(Number).filter(ok);
      const why = `Written for shoppers in ${nameOf(was)}, but ${m.why}. Rewritten for ${nameOf(m.primary)}.`;
      if (ns.length) await flagStale(slug, ns.map((n) => ({ n, priority: 'high', via: 'market', real: true, why, changes: [`Selling market: ${was} → ${m.primary}`] })));
      emit(slug, { type: 'market', was, now: m.primary, flagged: ns.length });
      log.log?.(`[market] ${slug}: ${was} → ${m.primary} (${m.by}); ${ns.length} moves flagged for the weekly rewrite`);
    }
    return { was, now: m.primary, moved, by: m.by };
  }

  /* ---------- for the fact sheet (facts-desk.js) ---------- */
  const hooks = {};
  const republish = async (slug) => { const p = await packs.getJSON(slug, 'profile.json'); if (!p) return; normalizeProfile(p); await publishBase(slug, p, await packs.getJSON(slug, 'ledger.json', []), await packs.getJSON(slug, 'findings.json')); };
  /* moves the fact sheet found quoting a changed fact: out of date, with the reason (kept with an older flag's changes) */
  const flagStale = (slug, list = []) => editUpd(slug, (u) => { for (const x of list) { const o = u.stale[x.n];
    if (o?.stockWhy) { u.stale[x.n] = { ...o, was: { priority: x.priority, why: x.why, via: x.via }, why: [...Object.values(o.stockWhy), x.why].join(' '), changes: [...new Set([...(o.changes || []), ...(x.changes || [])])].slice(0, 6) }; continue; } /* an out-of-stock mark stays on top */
    u.stale[x.n] = { ...x, at: Date.now(), changes: [...new Set([...(x.changes || []), ...(o?.changes || [])])].slice(0, 6), ...(o && !o.private ? { private: false } : {}) }; } });
  const facts = { pot: potInfo, potSpend, estMove, republish, flagStale, readProduct: async (slug, url) => readProduct(slug, url, (await packs.getJSON(slug, 'profile.json', {})) || {}), readRival, busy: (slug) => !!(st(slug).running || st(slug).checking), setHooks: (h) => Object.assign(hooks, h) };
  return { ...facts, saveAdmin, paidWork, stop, marketCheck, teamStatics, settleConnect, connectPending, readLive, heal, healPdfs, pdfFor, pdfOn, connected, liveConnected, staleConnected, checkUpdates, rewrite, updates, setAuto, signal, staleSweep, seen, buildInfo, retry, goPro, checkData, applyCheck, liveWeekly, stockSignal, peek: (slug) => st(slug).status, addEmail, start, resume, resumeAll, replayRead, subscribe, status, summary, confirm, list, events: (slug) => st(slug).events, spent: spentFor, spentToday: dayUsd };
}
