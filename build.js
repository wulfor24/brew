// The per-brand build: paste a URL, and this reads the brand, writes the brief, writes all its moves (the
// core "Know the brand" set first), turns each move into feed cards as it lands, and renders the Brew PDFs.
// Every stage writes to the brand pack (brand-pack.js) and to status.json, so a restart resumes where it was.
// Events are kept per brand and replayed, so the onboarding screen and anyone opening later see the same read.
import { adCall } from './reader/adlib.js';
import { ADS_V } from './reader/stages/ads.js';
import { wiping } from './retire.js';
import { sentenceCase } from './text-fit.js';
import path from 'node:path';
import fs from 'node:fs';
import { slugOf, moneyFmt } from './brand-pack.js';
import { isFullAccess } from './auth.js'; // SquareUp's people and ADMIN_EMAILS
import { skeletonSeed, seedFromProfile } from './seed-template.js';
import { factsFromLedger, configFromProfile, laneProducts } from './derive.js';
import { retiredSet, scrubRetired, allowedFrom } from './fact-gate.js';
import { createCardsGen } from './cards-gen.js';
import { realRows } from './connectors/common.js'; // DUMMY: simulated account rows are never evidence
import { healthFrom } from './dummy/health.js'; // DUMMY: simulated health rings
import { createStatics } from './statics.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mergeLedger, diffLedgers, candidates, triage, changeLine, CONNECTED_MOVES } from './refresh.js';
import { withLearned, briefView } from './brand-learnings.js'; // what the team told Brew survives a fresh brief

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
export const isPlay = (n, mv) => Number.isInteger(+n) && +n >= 1 && +n < 1000 && !mv?.meta?.cadence;
export const playDone = (moves) => Object.entries(moves || {}).filter(([k, mv]) => isPlay(k, mv)).length;
export const totalOf = (s) => +s?.total || 50;
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
  async function start(url, { ip, user = null, fresh = false } = {}) {
    const raw = String(url || '').trim(); const slug = slugOf(raw);
    if (blocked(slug)) return { error: 'This address can’t be read here.' };
    if (!slug || !/\.[a-z]{2,}/.test(raw.replace(/^[a-z]+:\/\//i, '').split('/')[0])) return { error: 'That doesn’t look like a website address.' };
    const host = raw.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/^www\./i, '').toLowerCase();
    const prev = await status(slug);
    if (prev?.cancelled && !fresh) return { error: 'This address was stopped. Ask Brew to restart it.' };
    if (prev && !fresh) { if (!st(slug).running && !prev.done) resume(slug).catch((e) => log.error('[build] resume', slug, e.message)); return { slug, existing: true, status: prev }; }
    if (prev && fresh && (st(slug).running || st(slug).checking)) return { error: 'This brand is being written right now. Restart it once this run stops.' };
    const PER_USER = +process.env.BUILD_PER_USER_DAY || 3, mine = (byUser.get(user?.email) || []).filter((t) => Date.now() - t < 864e5);
    if (user && mine.length >= PER_USER && !process.env.BUILD_NO_IP_LIMIT && !isFullAccess(user.email)) return { error: `${PER_USER} new brands a day per person. Open one you already started, or try again tomorrow.` };
    if (!user && ip && Date.now() - (byIp.get(ip) || 0) < IP_GAP && !process.env.BUILD_NO_IP_LIMIT) return { error: 'One new brand an hour from the same network. Open one you already started, or try again later.' };
    await loadDay(); if (dayUsd() >= DAY_CAP) return { error: 'Today’s reading budget is used up. Try again tomorrow.' };
    if (user) byUser.set(user.email, [...mine, Date.now()]); else if (ip) byIp.set(ip, Date.now());
    st(slug).events.length = 0; /* a new read starts a new story: viewers replay only this run's events */
    if (prev && fresh) await resetPack(slug);
    st(slug).status = {}; /* a new status, not merged over the last run's stages, PDFs and counts */
    /* the starter files go up together: one after another kept the person on the landing for 3-5s */
    await Promise.all([packs.put(slug, 'seed.json', skeletonSeed({ slug, host })), packs.put(slug, 'facts.json', {}), packs.put(slug, 'config.json', { countryName: '', questions: [], rivals: [] }),
      user ? packs.put(slug, 'private/created.json', { by: user.email, at: Date.now() }).catch(() => {}) : null]);
    await setStatus(slug, { slug, host, url: /^https?:/.test(raw) ? raw : 'https://' + host, name: host, createdAt: Date.now(), stages: {}, ready: false, done: false, state: 'Reading the site', error: null, cancelled: null, freshRead: !!(prev && fresh), ...(prev?.seenAt ? { seenAt: prev.seenAt } : {}) });
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
    return reader.read(s.url, { fresh: false, onEvent, signal });
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
      /* 1. read the site */
      let profile = await packs.getJSON(slug, 'profile.json'), ledger = await packs.getJSON(slug, 'ledger.json', []), findings = await packs.getJSON(slug, 'findings.json');
      if (!profile) {
        if (!m.reader) throw new Error('reader not installed');
        await halt(slug); if (await budgetPause(slug, 0)) return;
        await stage(slug, 'read', 'running'); await setStatus(slug, { state: 'Reading the site', error: null }); /* a new run clears the last one's error, or the brand stays hidden */
        const reader = makeReader(m);
        const out = await reader.read(s.url, { fresh: !!s.freshRead, onEvent: (e) => emit(slug, { type: 'reader', ev: e }) });
        /* the store did not open: nothing to write a brief or moves from, so stop here without spending more */
        if (!storeOpened(out)) { await packs.put(slug, 'findings.json', out.findings || null).catch(() => {}); await stage(slug, 'read', 'failed'); await setStatus(slug, { state: `We could not open ${s.host || 'the store'}. Check the address and try again.`, error: 'store did not open', unreadable: true }); return; }
        ({ profile, ledger, findings } = out);
        normalizeProfile(profile);
        await packs.put(slug, 'profile.json', profile); await packs.put(slug, 'ledger.json', ledger); await packs.put(slug, 'findings.json', findings);
        await stage(slug, 'read', 'done', { findings: findings?.cards?.length || 0 });
      } else { normalizeProfile(profile); await replayRead(slug, findings); await stage(slug, 'read', 'done', { cached: true }); }
      await publishBase(slug, profile, ledger, findings);
      s = await setStatus(slug, { name: profile.name || s.host, logo: profile.identity?.logo || null, state: 'Waiting for you to check what we read' });
      instantCards(slug, profile, ledger).catch((e) => log.warn('[build] instant', e.message));
      emit(slug, { type: 'read-done' });

      /* 2. "Check what we read": wait for the brand's corrections (or move on) */
      if (!s.stages?.confirm || s.stages.confirm.state !== 'done') {
        await stage(slug, 'confirm', 'waiting');
        /* a confirmation is stored (status.confirmedAt), so a click before this point is honoured, not lost */
        /* a brand read by someone not signed in waits for a signed-in confirm with no time limit: the moves are the expensive part */
        const anon = !!signGate() && !(await packs.getJSON(slug, 'private/created.json', null).catch(() => null));
        if (!(await status(slug))?.confirmedAt) await new Promise((res) => { const t = anon ? null : setTimeout(res, CONFIRM_WAIT); x.confirmed = () => { clearTimeout(t); res(); }; });
        x.confirmed = null;
        await stage(slug, 'confirm', 'done');
        ({ profile, ledger } = { profile: await packs.getJSON(slug, 'profile.json'), ledger: await packs.getJSON(slug, 'ledger.json', []) });
        normalizeProfile(profile);
        await publishBase(slug, profile, ledger, findings);
      }

      await halt(slug);
      /* 3. the brand brief */
      let brief = await packs.getJSON(slug, 'brief.json');
      if (!brief) {
        if (!m.brief) throw new Error('brief writer not installed');
        if (await budgetPause(slug, 0)) return;
        await stage(slug, 'brief', 'running'); await setStatus(slug, { state: 'Writing the brand brief' });
        const out = await m.brief.createBrief({ ai, log }).write(profile, ledger);
        brief = out.json || {}; const told = await packs.getJSON(slug, 'learned.json', null).catch(() => null); /* learnings added before a fresh read stay in the brief */
        if (told) brief.learned = briefView(told);
        await packs.put(slug, 'brief.md', told ? withLearned(out.md || '', told, { name: profile.name }) : out.md || ''); await packs.put(slug, 'brief.json', brief);
        await stage(slug, 'brief', 'done'); packs.drop(slug); await onPack(slug);
      }

      await halt(slug);
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
        await setStatus(slug, { movesDone: done, ready: waveA || (await status(slug)).ready, state: done >= total ? `All ${total} moves written` : `Writing the moves: ${done} of ${total}` });
        if (waveA && !firstSent) { firstSent = true; notify(slug, 'first').catch((e) => log.warn('[notify]', e.message)); }
        await unmarkPdf(slug, n); /* PDFs are made when someone opens one (pdfOn), never in the build */
        packs.drop(slug); await onPack(slug); saveSpend(slug);
      };
      const ctx = { brand: { name: profile.name, host: profile.host, descriptor: profile.descriptor }, brief: { md: briefMd, json: brief }, profile, ledger, packs, slug,
        load: (n) => cache[n] || null, save: async (n, move) => { cache[n] = move; await save(n, move); }, canSpend: () => !capHit(slug),
        effort: process.env.MOVES_EFFORT || 'medium', search: +(process.env.MOVES_SEARCH ?? 1),
        onTotal: async (N, applicable) => { total = N; await setStatus(slug, { total: N, applicable }); },
        onStart: (n) => { x.inflight.set(n, Date.now()); x.failed.delete(n); emit(slug, { type: 'move-start', n }); },
        onFail: (n, e) => { x.inflight.delete(n); x.failed.set(n, { msg: String(e?.message || e).slice(0, 160), at: Date.now() }); emit(slug, { type: 'move-failed', n, msg: String(e?.message || e).slice(0, 160) }); } };
      if (cache[21] && !(await status(slug))?.statics) staticsJob = makeStatics(slug, cache[21], profile, (fn) => (lock = lock.then(fn).catch((e) => log.warn('[build] statics card', e.message))));
      let res = await eng.runAll(ctx, { concurrency: +process.env.MOVES_CONCURRENCY || 6, waveA: WAVE_A });
      // a move that failed gets one more pass once the rest are written (a cut-off reply, a busy model)
      if (!capHit(slug) && (res.applicable || []).some((n) => !cache[n])) { await lock; log.warn('[build] second pass for', slug); res = await eng.runAll(ctx, { concurrency: 4, waveA: WAVE_A }); }
      await lock; await staticsJob;
      if (res.errors?.length) log.warn('[build] moves with errors', slug, res.errors.map((e) => e.n + ': ' + e.error).join('; '));
      if (await cancelled(slug)) { await setStatus(slug, { state: `Stopped. ${saved.size} of ${total} moves written.`, cancelled: true, error: 'cancelled' }); return; }
      if (await budgetPause(slug, saved.size)) return;
      await stage(slug, 'moves', 'done');
      await pdfQueue;
      await setStatus(slug, { done: true, ready: true, state: 'Ready', usd: +spentFor(slug).toFixed(2), doneAt: Date.now() });
      await notify(slug, 'all').catch((e) => log.warn('[notify]', e.message));
    } catch (e) { if (e.cancelled) return; log.error('[build] failed', slug, e); await setStatus(slug, { state: 'Stopped: ' + e.message, error: e.message }); }
    finally { x.running = false; await packs.put(slug, 'cost.json', { usd: +spentFor(slug).toFixed(3) }).catch(() => {}); }
  }

  async function makeZips(slug, m, profile) {
    if (!m.pdf?.zipBuffer) return; // the two zips, like the hand-made set: 00-28 and 29-50
    const st0 = await status(slug), name = String(profile.name || slug).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || slug, zips = [];
    for (const [lo, hi] of [[0, 28], [29, 50]]) {
      const entries = [];
      for (const [n, f] of Object.entries(st0.pdfs || {})) if (+n >= lo && +n <= hi) { const buf = await packs.get(slug, 'pdf/' + f); if (buf) entries.push({ name: f, data: buf }); }
      if (!entries.length) continue;
      const z = `${name}-moves-${String(lo).padStart(2, '0')}-${hi}.zip`; await packs.put(slug, 'pdf/' + z, m.pdf.zipBuffer(entries), 'application/zip'); zips.push(z);
    }
    await setStatus(slug, { zips });
  }
  // a read that is already in the pack (a restart, or a brand opened again): play its real findings back, step by step
  async function replayRead(slug, findings) {
    if (!findings?.steps) return;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const [i, st] of findings.steps.entries()) {
      for (const tk of (st.tick || []).filter((x) => x && x !== '…').slice(0, 2)) { emit(slug, { type: 'reader', ev: { type: 'step', k: st.k, i, state: 'reading', tick: tk } }); await wait(500); }
      for (const c of findings.cards.filter((c) => c.k === st.k)) { emit(slug, { type: 'reader', ev: { type: 'finding', k: st.k, i, finding: c, say: c.say } }); await wait(1400); }
      emit(slug, { type: 'reader', ev: { type: 'step', k: st.k, i, state: st.state === 'empty' ? 'empty' : 'done', done: st.done } }); await wait(300);
    }
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
    seed.health = healthFrom(profile); // DUMMY: simulated health rings (dummy/health.js)
    const ai = seed.health.rings.find((r) => r.k === 'AI answers'); if (ai) seed.geo = { score: ai.v, band: ai.v >= 60 ? 'Good' : ai.v >= 35 ? 'Fair' : 'Low' };
    const facts = factsFromLedger(ledger, { host: profile.host });
    const cfg = configFromProfile(profile, extra);
    Object.assign(cfg, laneProducts(seed, profile), { statics: (await packs.getJSON(slug, 'config.json', {}))?.statics || [] }); /* a re-read keeps the finished statics */
    await packs.put(slug, 'seed.json', seed); await packs.put(slug, 'facts.json', facts); await packs.put(slug, 'config.json', cfg);
    packs.drop(slug); await onPack(slug);
  }
  // static ads from Move 21 (statics.js): about 8 images, then one batch card the brand can pick from
  function makeStatics(slug, move, profile, withLock) {
    if (!image || !mods.pdf?.launchBrowser) return Promise.resolve();
    return (async () => {
      if (capHit(slug)) return;
      await setStatus(slug, { statics: { state: 'running' } });
      try {
        const p = await packs.load(slug);
        const { ids } = await createStatics({ ai, image, packs, launchBrowser: mods.pdf.launchBrowser, log }).make(slug, { move, profile, facts: p.facts });
        await withLock(async () => {
          const cfg = await packs.getJSON(slug, 'config.json', {}); cfg.statics = ids; await packs.put(slug, 'config.json', cfg);
          const seed = await packs.getJSON(slug, 'seed.json', {});
          const card = { id: 'statics-batch', agent: 'creative', sector: 'creatives', type: 'idea', lane: Object.keys(seed.lanes || { core: 1 })[0], roles: ['brand', 'growth', 'founder'], src: 'Move 21 · static ads', time: '5 min', kind: 'media', origin: 'build',
            images: ids.map((id) => `b/${slug}/statics/${id}.jpg`), campaign: 'From your ad plan',
            title: `${ids.length} ads from your ad plan, ready to review`, sub: `Each one puts a real ${profile.name} product photo in a new scene, with a headline from Move 21. Keep the ones you like and they go out together as one test.`,
            detail: { why: ['Concepts come from the ad-creative move.', 'Every number on them is in your fact sheet.'], how: ['Open the set and keep or drop each ad.', 'Edit any of them in the studio.', 'Queue the kept ones as one test.'] }, cta: { label: 'Queue the ads' } };
          seed.posts = [card, ...(seed.posts || []).filter((x) => x.id !== card.id)];
          await packs.put(slug, 'seed.json', seed); packs.drop(slug); await onPack(slug); onCards(slug, [card], { replace: true });
        });
        await setStatus(slug, { statics: { state: 'done', n: ids.length } });
        emit(slug, { type: 'statics', n: ids.length });
      } catch (e) { log.warn('[build] statics', e.message); await setStatus(slug, { statics: { state: 'failed', err: e.message.slice(0, 120) } }); }
    })();
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
    const c = { id: 'build-moves', agent: 'brew', sector: 'signals', type: 'report', lane: Object.keys(seed.lanes || { core: 1 })[0], roles: ['founder', 'growth', 'brand', 'ecom', 'crm'], src: 'Brew deployment team', time: '1 min', kind: 'rows', origin: 'build', boostFor: { founder: 6, growth: 3, brand: 3, ecom: 3, crm: 3 },
      badge: [done >= total ? 'All written' : `${done} of ${total} written`, done >= total ? 'ok' : 'info'],
      title: done >= total ? `All ${total} moves for ${seed.brand?.name} are written` : `Writing your ${total} moves: ${done} done`,
      sub: `Each move is a full plan with sources, a 30-day rollout and how we measure it. ${last?.title ? `The latest: ${last.title}.` : ''} Open the Moves page to read them; any move downloads as a PDF.`.slice(0, 240),
      rows: [['Written', `${done} of ${total}`], ['Latest', String(last?.title || '').slice(0, 44)]], detail: { why: ['Every card in this feed comes from one of these plans.'], how: ['Open the Moves page.', 'Read any move, or download its PDF.'] }, cta: { label: 'Open the moves' } };
    seed.posts = [c, ...(seed.posts || []).filter((x) => x.id !== c.id)];
    await packs.put(slug, 'seed.json', seed); onCards(slug, [c], { replace: true });
  }
  async function cardsFor(slug, move, profile, { replace = false, priv = false } = {}) {
    const p = await packs.load(slug); const specs = mods.moves?.SPECS || {};
    const ledger = await packs.getJSON(slug, 'ledger.json', []).catch(() => []);
    /* a member's rewrite also reads the connected facts (private/facts.json); numbers that stopped being true (facts-edits.json retired) leave the move before it backs a card */
    const facts = priv ? { ...p.facts, ...((await packs.getJSON(slug, 'private/facts.json', null))?.facts || {}) } : p.facts;
    const retired = retiredSet((await packs.getJSON(slug, 'facts-edits.json', null))?.retired, allowedFrom(facts));
    const { cards, label } = await cardsGen.fromMove(scrubRetired(move, retired), { brand: { name: profile.name, host: profile.host }, facts, lanes: p.seed.lanes, laneImg: p.seed.laneImg, spec: Array.isArray(specs) ? specs.find((x) => x.n === move.n) : specs[move.n], ledger: ledger || [] });
    // written from a connected account: the cards go to the team only (private/cards.json), never into the shared seed
    if (priv) { if (!cards.length) return; const own = new RegExp(`^m${String(move.n).padStart(2, '0')}-`), pc = (await packs.getJSON(slug, 'private/cards.json', [])).filter((c) => !own.test(c.id));
      const add = cards.map((c) => ({ ...c, liveOnly: true, privateOf: move.n })); await packs.put(slug, 'private/cards.json', [...pc, ...add]);
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
    ['country', 'Main market (country code)', (p) => p.country], ['currency', 'Currency', (p) => p.currency],
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
  async function confirm(slug, edits = [], v2 = null) {
    if (v2) { const r = await applyCheck(slug, v2); if (!r?.error) await markConfirmed(slug); emit(slug, { type: 'confirmed', v2: true }); return r; }
    const p = await packs.getJSON(slug, 'profile.json'), L = await packs.getJSON(slug, 'ledger.json', []); if (!p) return { ok: false };
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
    await markConfirmed(slug); emit(slug, { type: 'confirmed', edits: edits.length });
    return { ok: true };
  }

  /* ---------- "Is this right?" v2: structured data, and edits that are choices or links (never retyped facts) ---------- */
  const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36' };
  const NOT_PRODUCT = /gift ?wrap|gift ?card|e-?gift|shipping protection|route protection|insurance|sample|tester|donation/i;
  const hostOf = (u) => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const srcOf = (L, keys) => { const e = L.find((x) => keys.some((k) => x.key === k || x.key.startsWith(k + '.'))); return e ? { src: e.src || hostOf(e.url || ''), url: e.url || null, at: String(e.at || '').slice(0, 10) } : null; };
  /* mend a saved read when the brand is opened: ads lookups that failed (or never found our own page) are run again,
     and the one-liner is written if Claude never wrote it. At most once a day per brand, never during a build. */
  const healing = new Set();
  async function heal(slug) {
    if (healing.has(slug) || blocked(slug) || st(slug).running || st(slug).checking || process.env.AI_MOCK === '1' || process.env.HEAL_OFF === '1') return null;
    healing.add(slug);
    try {
      const p = await packs.getJSON(slug, 'profile.json'); if (!p?.host || !p.slug) return null;
      // healed today: wait a day; a heal that still hit errors tries again after an hour; a read from before a
      // stage changed (older ads version) or with no written one-liner heals now
      const outdated = (p.ads && p.ads.v !== ADS_V) || !['claude', 'brand'].includes(p.descriptorBy);
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
  async function checkData(slug, { heal: doHeal = true } = {}) {
    if (doHeal) heal(slug).catch(() => {});
    const p = await packs.getJSON(slug, 'profile.json'), L = await packs.getJSON(slug, 'ledger.json', []); if (!p) return { error: 'not read yet' };
    normalizeProfile(p);
    const prods = (p.catalog?.products || []).filter((x) => !NOT_PRODUCT.test(x.title || ''));
    const hero = new Set((p.catalog?.hero || []).filter((h) => prods.some((x) => x.handle === h)));
    if (!hero.size) prods.slice(0, 4).forEach((x) => hero.add(x.handle));
    const removed = new Set(p.catalog?.removed || []);
    const items = prods.filter((x) => !removed.has(x.handle)).sort((a, b) => (hero.has(b.handle) - hero.has(a.handle))).slice(0, 12)
      .map((x) => ({ handle: x.handle, title: x.title, price: x.priceLabel || '', img: x.img || (x.images || []).find((u) => /^https?:/.test(u)) || null, url: x.url || null, hero: hero.has(x.handle), added: !!x.addedByBrand }));
    const own = p.ads?.own || {}, ig = p.socials?.instagram, rv = p.reviews || {};
    return {
      name: p.name, host: p.host, logo: p.identity?.logo || null, count: (p.catalog?.products || []).length,
      who: [
        { key: 'name', label: 'Brand name', v: p.name || '', type: 'text', ...srcOf(L, ['brand.name']) },
        { key: 'descriptor', label: 'What you are, in one line', v: p.descriptor || p.tagline || '', type: 'text', ...srcOf(L, ['brand.descriptor', 'brand.tagline']) },
        { key: 'category', label: 'Category', v: p.category || '', type: 'text', ...srcOf(L, ['market.category']) },
        { key: 'country', label: 'Main market', v: p.country || '', type: 'country', ...srcOf(L, ['market.country']) },
        { key: 'currency', label: 'Currency', v: p.currency || '', type: 'currency', ...srcOf(L, ['market.currency']) }
      ],
      products: items,
      rivals: (p.rivals || []).map((r) => ({ name: r.name, host: r.host, how: r.how || r.why || '', logo: r.logo || `https://www.google.com/s2/favicons?domain=${r.host}&sz=64`, prices: (r.prices || []).length, live: (p.ads?.rivals || []).find((x) => x.host === r.host || x.name === r.name)?.live ?? null, url: r.url || `https://${r.host}` })),
      sources: [
        { key: 'adpage', label: 'Facebook page that runs your ads', v: own.page ? `${own.page} · ${own.live ?? 0} live ad versions` : own.error ? 'Couldn’t check this time' : 'Not found', url: own.pageId ? `https://www.facebook.com/ads/library/?view_all_page_id=${own.pageId}` : null, hint: 'Paste your Facebook page link if this is wrong', found: !!own.page },
        { key: 'instagram', label: 'Instagram', v: ig?.handle ? '@' + ig.handle : ig?.error ? 'Couldn’t check this time' : 'Not found', url: ig?.url || null, hint: 'Paste your Instagram profile link', found: !!ig?.handle },
        { key: 'reviews', label: 'Reviews and ratings', v: (rv.platforms || []).some((x) => x.count) ? (rv.platforms || []).filter((x) => x.count).map((x) => `${Number(x.count).toLocaleString('en-IN')} on ${x.label || x.name}`).join(' · ') : rv.total ? `${Number(rv.total).toLocaleString('en-IN')} reviews and ratings` : rv.error ? 'Couldn’t check this time' : 'No reviews found', url: (rv.platforms || [])[0]?.url || null, hint: 'Paste the page where your reviews live (Judge.me, Loox, Amazon…)', found: !!rv.total }
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
    try { const r = await fetch(u + '.js', { headers: UA, signal: AbortSignal.timeout(20e3) }); if (r.ok) { const j = await r.json(); t = j.title; price = (j.price || 0) / 100; img = j.featured_image || j.images?.[0]; } } catch {}
    if (!t) { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25e3) }); const h = await r.text();
      for (const m of h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { const j = [].concat(JSON.parse(m[1])).flatMap((x) => x['@graph'] || [x]).find((x) => String(x['@type']).includes('Product')); if (j) { t = j.name; const o = [].concat(j.offers || [])[0] || {}; price = +o.price || +o.lowPrice || null; cur = o.priceCurrency || cur; img = [].concat(j.image || [])[0]; break; } } catch {} }
      t ||= (h.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1]; img ||= (h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || [])[1]; }
    if (!t) throw new Error('That page did not show a product.');
    if (img && img.startsWith('//')) img = 'https:' + img;
    let asset = null; if (img) try { const r = await fetch(img, { headers: UA, signal: AbortSignal.timeout(20e3) }); if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); const n = 'added-' + u.split('/').pop().replace(/[^a-z0-9-]/gi, '').slice(0, 40) + (img.includes('.png') ? '.png' : '.jpg'); await packs.put(slug, 'assets/' + n, b); asset = `/b/${slug}/a/${n}`; } } catch {}
    return { handle: u.split('/').pop(), title: String(t).trim(), price, currency: cur, img: asset, images: asset ? [asset] : [], url: u, inStock: true, addedByBrand: true, claims: [] };
  }
  // a rival's website → name, logo, a few live prices (Shopify), and its live ads by domain
  async function readRival(url, p) {
    const host = hostOf(url); if (!host) throw new Error('That doesn’t look like a website.');
    const r = await fetch(`https://${host}/`, { headers: UA, signal: AbortSignal.timeout(25e3) }); const h = await r.text();
    const name = ((h.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || [])[1] || (h.match(/<title>([^<|–-]+)/i) || [])[1] || host).trim().slice(0, 40);
    const prices = [];
    try { const j = await (await fetch(`https://${host}/products.json?limit=12${p.country ? `&country=${p.country}` : ''}`, { headers: UA, signal: AbortSignal.timeout(20e3) })).json(); (j.products || []).filter((x) => !NOT_PRODUCT.test(x.title)).slice(0, 6).forEach((x) => { const v = x.variants?.[0]; if (v?.price) prices.push({ title: x.title, price: +v.price, currency: p.currency, url: `https://${host}/products/${x.handle}` }); }); } catch {}
    let live = null; try { const k = await adCall(treg, 'scrapecreators.x.v1-facebook-adlibrary-search-ads', { query: { query: host, country: p.country || 'ALL', status: 'ACTIVE', trim: true }, tag: 'check-rival-ads' }); live = (k?.searchResults || []).filter((a) => String(a.snapshot?.link_url || '').includes(host)).length; } catch {}
    return { name, host, url: `https://${host}`, why: 'Named by the brand', how: 'named by the brand, site read live', prices, claims: [], offers: [], liveAds: live };
  }
  async function applyCheck(slug, b = {}) {
    const p = await packs.getJSON(slug, 'profile.json'), L = await packs.getJSON(slug, 'ledger.json', []); if (!p) return { error: 'not read yet' };
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
    return { ok: true, notes, data: await checkData(slug) };
  }

  /* ---------- "We will notify you once ready": emails for the brand's team ---------- */
  const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
  async function addEmail(slug, email) {
    const e = String(email || '').trim().toLowerCase(); if (!EMAIL.test(e)) return { error: 'That email doesn’t look right.' };
    const n = await packs.getJSON(slug, 'notify.json', { emails: [], sent: {} });
    if (!n.emails.some((x) => x.email === e)) { if (n.emails.length >= 20) return { error: 'This brand already has 20 people waiting.' }; n.emails.push({ email: e, at: Date.now() }); await packs.put(slug, 'notify.json', n); }
    const s0 = await status(slug); if (s0?.done) await notify(slug, 'all'); // already finished: send now
    return { ok: true };
  }
  /* one send at a time per brand, so two "first moves" triggers never both mail the same people */
  const nq = new Map();
  const notify = (slug, kind, extra = {}) => { const p = (nq.get(slug) || Promise.resolve()).catch(() => {}).then(() => notifyNow(slug, kind, extra)); nq.set(slug, p); return p; };
  async function notifyNow(slug, kind, extra = {}) {
    const n = await packs.getJSON(slug, 'notify.json', null); if (!n?.emails?.length) return;
    const key = process.env.RESEND_API_KEY; if (!key) return log.warn('[notify] no RESEND_API_KEY');
    const s0 = await status(slug), name = s0?.name || slug, base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com';
    const sentKey = kind === 'update' ? `update-${extra.at}` : kind;
    const todo = n.emails.filter((x) => !n.sent[`${sentKey}:${x.email}`]); if (!todo.length) return;
    const subject = kind === 'update' ? `${extra.moves.length} of ${name}’s moves were updated` : kind === 'all' ? `All of ${name}’s moves are ready` : `Your first moves for ${name} are ready`;
    const line = kind === 'update' ? `Something changed for ${name}, so Brew rewrote the plans it affects: ${extra.moves.map((x) => `Move ${String(x.n).padStart(2, '0')} (${x.title})`).join(', ')}. ${extra.because || ''}`.trim() : kind === 'all' ? `Brew has finished all ${totalOf(s0)} moves for ${name}: every plan with its sources, a 30-day rollout and how we measure it. Each one downloads as a PDF, and your feed is built from them.` : `Brew has written the first ten moves for ${name}: positioning, customers, rivals, pricing, offers and measurement. Their ideas are in your feed now, and the other ${Math.max(0, totalOf(s0) - 10)} keep landing over the next hour.`;
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const html = `<div style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:520px"><p style="font-size:18px;font-weight:600;margin:0 0 12px">${esc(subject)}</p><p>${esc(line)}</p><p style="margin:22px 0"><a href="${base}/${slug}" style="background:#111;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:600">Open the feed</a> &nbsp; <a href="${base}/${slug}#v=moves" style="color:#111">Read the moves</a></p><p style="color:#777;font-size:13px">Every number in them has a source. Anything we could not confirm is marked “to confirm”.<br>Brew · brew.joinsquareup.com</p></div>`;
    for (const x of todo) {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: process.env.NOTIFY_FROM || 'Brew <hello@send.joinsquareup.com>', to: [x.email], subject, html, text: `${subject}\n\n${line}\n\nOpen the feed: ${base}/${slug}\nRead the moves: ${base}/${slug}#v=moves` }) });
      if (r.ok) n.sent[`${sentKey}:${x.email}`] = Date.now(); else log.warn('[notify] resend', r.status, (await r.text()).slice(0, 200));
    }
    const cur = await packs.getJSON(slug, 'notify.json', n); await packs.put(slug, 'notify.json', { ...cur, sent: { ...(cur?.sent || {}), ...n.sent } }); /* emails added meanwhile are kept */
  }
  // the Build tab: what is being written now, what is next, what failed, what it cost
  async function buildInfo(slug) {
    const s0 = await status(slug); if (!s0) return { error: 'unknown brand' };
    const x = st(slug), moves = await packs.getJSON(slug, 'moves.json', {});
    const specs = (await load()).moves?.SPECS || [];
    const nm = (n) => sentenceCase(specs.find((p) => p.n === n)?.discipline || '', [], { force: true }) || String(specs.find((p) => p.n === n)?.kicker || '').toLowerCase().replace(/^./, (c) => c.toUpperCase()) || `Move ${String(n).padStart(2, '0')}`; // skill names are Title Cased
    const done = Object.entries(moves).filter(([k, mv]) => isPlay(k, mv)); // the playbook: not the index, not cadence moves
    const app = s0.applicable?.length ? s0.applicable : [...Array(51).keys()].filter(Boolean);
    const order = [...WAVE_A.filter((n) => app.includes(n)), ...app.filter((n) => !WAVE_A.includes(n))];
    const inflight = [...x.inflight.entries()].map(([n, t]) => ({ n, title: nm(n), secs: Math.round((Date.now() - t) / 1e3) }));
    const queue = order.filter((n) => !moves[n] && !x.inflight.has(n) && !x.failed.has(n)).slice(0, 8).map((n) => ({ n, title: nm(n) }));
    const failed = [...x.failed.entries()].map(([n, f]) => ({ n, title: nm(n), msg: /max_tokens/.test(f.msg) ? 'The reply ran out of room' : /refused/.test(f.msg) ? 'The model declined this one' : /cap|budget/.test(f.msg) ? 'Spend cap reached' : 'It stopped with an error', at: f.at }));
    const pad = (n) => String(n).padStart(2, '0');
    const ev = x.events.filter((e) => ['move', 'move-start', 'move-failed', 'pdf', 'statics', 'cards', 'confirmed', 'read-done'].includes(e.type)).slice(-40).reverse().slice(0, 25)
      .map((e) => ({ at: e.at, type: e.type, text: e.type === 'move' ? `Move ${pad(e.n)} written: ${e.title}` : e.type === 'move-start' ? `Started Move ${pad(e.n)} · ${nm(e.n)}` : e.type === 'move-failed' ? `Move ${pad(e.n)} stopped, it gets another try` : e.type === 'pdf' ? `PDF ready: ${e.file}` : e.type === 'statics' ? `${e.n} static ads made` : e.type === 'cards' ? `${e.cards.length} new card${e.cards.length === 1 ? '' : 's'} from Move ${pad(e.n)}` : e.type === 'confirmed' ? 'You confirmed what we read' : 'Your site was read' }));
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
  const REFRESH_CAP = +process.env.REFRESH_CAP_USD || 60, AUTO_CAP = +process.env.REFRESH_AUTO_CAP_USD || 14, MOVE_USD = 0.6;
  const pad2 = (n) => String(n).padStart(2, '0');
  // DUMMY: flags raised by a simulated account (live) are not real reasons to rewrite: saved flags heal here
  const upd = async (slug) => { const u = { auto: true, stale: {}, history: [], ...(await packs.getJSON(slug, 'updates.json', {})) }; for (const [n, x] of Object.entries(u.stale || {})) if (x?.live && !x.real) delete u.stale[n]; return u; };
  let ulock = Promise.resolve(); // updates.json is read-modify-written from several places
  const editUpd = (slug, f) => (ulock = ulock.then(async () => { const u = await upd(slug); await f(u); await packs.put(slug, 'updates.json', u); return u; }));
  async function checkUpdates(slug, { auto = false, why = 'You asked for the latest' } = {}) {
    if (blocked(slug)) return { error: 'This brand is stopped.' };
    const x = st(slug), s0 = await status(slug); if (!s0) return { error: 'unknown brand' };
    if (!(await packs.getJSON(slug, 'brief.json'))) return { error: 'Updates start once the moves are written.' };
    if (x.checking) return { ok: true, already: true };
    if (x.running) return { error: x.rewriting ? 'A rewrite is running. Check again once it is in.' : 'The moves are still being written. Updates open once they are in.' };
    await loadDay(); if (dayUsd() >= DAY_CAP) return { error: 'Today’s budget is used up. Try again tomorrow.' };
    x.checking = true; await editUpd(slug, (u) => { u.checking = { at: Date.now(), why }; });
    emit(slug, { type: 'update-start', why });
    buildCtx.run(slug, () => doCheck(slug, { auto, why })).catch(async (e) => { log.error('[refresh]', slug, e.message); await editUpd(slug, (u) => { u.checking = null; u.lastError = { at: Date.now(), msg: String(e.message).slice(0, 160) }; }); })
      .finally(() => { x.checking = false; saveSpend(slug); });
    return { ok: true };
  }
  async function doCheck(slug, { auto, why }) {
    const m = await load(); await restoreSpend(slug); const usd0 = spentFor(slug), s0 = await status(slug);
    const old = await packs.getJSON(slug, 'ledger.json', []), oldP = await packs.getJSON(slug, 'profile.json');
    const out = await makeReader(m).read(s0.url, { fresh: true, prev: oldP, onEvent: (e) => { if (e.type === 'step' && e.done) emit(slug, { type: 'update-step', k: e.k, text: e.done }); } });
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
      for (const t of tri.moves) u.stale[t.n] = { n: t.n, priority: t.priority, why: t.why, changes: (t.changes || []).map((i) => changes[i]).filter(Boolean).slice(0, 6).map(changeLine), at };
      u.lastCheck = { at, why, auto, changes: changes.slice(0, 80), minor, spotted, summary: tri.summary, flagged: tri.moves.map((t) => t.n), usd: +(spentFor(slug) - usd0).toFixed(2) };
      u.checking = null; u.lastError = null;
    });
    await publishBase(slug, profile, ledger, await packs.getJSON(slug, 'findings.json')); // facts, health and the seed follow the new read
    emit(slug, { type: 'update-done', changes: changes.length, flagged: tri.moves.length });
    log.log(`[refresh] ${slug}: ${changes.length} changes (${minor} minor), ${tri.moves.length} moves flagged, $${u.lastCheck.usd}`);
    if (auto && u.auto !== false) { const ns = tri.moves.filter((t) => t.priority === 'high' && t.n >= 1 && t.n <= 50 && !moves[t.n]?.meta?.cadence).map((t) => t.n).slice(0, AUTO_MAX); /* the engine rewrites core moves only, as a manual rewrite does */ if (ns.length) await rewriteNow(slug, ns, { auto: true }); }
  }
  async function rewrite(slug, ns, o = {}) {
    if (blocked(slug)) return { error: 'This brand is stopped.' };
    const x = st(slug), s0 = await status(slug); if (!s0) return { error: 'unknown brand' };
    if (x.running) return { error: x.rewriting ? 'A rewrite is already running.' : 'The moves are still being written. Rewrites open once they are in.' };
    await loadDay(); if (dayUsd() >= DAY_CAP) return { error: 'Today’s budget is used up. Try again tomorrow.' };
    const have = await packs.getJSON(slug, 'moves.json', {});
    ns = [...new Set((ns || []).map(Number))].filter((n) => n >= 1 && n <= 50 && have[n]);
    if (!ns.length) return { error: 'Pick a written move.' };
    buildCtx.run(slug, () => rewriteNow(slug, ns, o)).catch((e) => log.error('[rewrite]', slug, e.message));
    return { ok: true, n: ns.length, est: Math.round(ns.length * MOVE_USD) };
  }
  async function rewriteNow(slug, ns, { auto = false } = {}) {
    ns = [...new Set((ns || []).map(Number))].filter((n) => n >= 1 && n <= 50); if (!ns.length) return;
    const x = st(slug); if (x.running) return; x.running = true; x.rewriting = new Set(ns);
    const m = await load(); await restoreSpend(slug); await loadDay(); const usd0 = spentFor(slug), cap = auto ? AUTO_CAP : Math.max(REFRESH_CAP, ns.length * 2.5);
    const written = []; let prevState = null;
    try {
      const profile = normalizeProfile(await packs.getJSON(slug, 'profile.json'));
      // a real connected account's numbers are evidence for the rewrite, and private to the brand's team (a move written
      // from them is saved privately too). Simulated accounts (DUMMY) are never evidence and never make a rewrite private.
      const privL = realRows(await packs.getJSON(slug, 'private/connected-ledger.json', [])), priv = privL.length > 0, P = priv ? 'private/' : '';
      const ledger = mergeLedger(await packs.getJSON(slug, 'ledger.json', []), [], { connected: [...realRows(await packs.getJSON(slug, 'connected-ledger.json', [])), ...privL] }).ledger;
      const brief = await packs.getJSON(slug, 'brief.json'), briefMd = (await packs.get(slug, 'brief.md'))?.toString('utf8') || '';
      const cache = { ...(await packs.getJSON(slug, 'moves.json', {})), ...(priv ? await packs.getJSON(slug, 'private/moves.json', {}) : {}) }, olds = Object.fromEntries(ns.map((n) => [n, cache[n]]));
      const stale = (await upd(slug)).stale || {}, stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      prevState = (await status(slug)).state;
      /* kept in updates.json while it runs: a restart or deploy mid-rewrite carries on with the moves not yet written (resumeAll) */
      await editUpd(slug, (u) => { u.rewriting = { ns, auto, at: Date.now(), prev: u.rewriting?.prev || prevState }; });
      await setStatus(slug, { state: `Rewriting ${ns.length} move${ns.length === 1 ? '' : 's'} with the latest` });
      emit(slug, { type: 'rewrite-start', ns, auto });
      const eng = m.moves.createMovesEngine({ ai, treg, log });
      let lock = Promise.resolve(), pdfQ = Promise.resolve(), staticsJob = Promise.resolve();
      const saveOne = async (n, move) => {
        x.inflight.delete(n); x.failed.delete(n);
        if (n !== 0) {
          const prev = olds[n], file = prev ? `${P}moves/history/${pad2(n)}-${stamp}.json` : null;
          if (prev) await packs.put(slug, file, prev);
          move.meta = { ...move.meta, version: (prev?.meta?.version || 1) + 1, rewrittenAt: new Date().toISOString(), because: stale[n]?.why || (auto ? 'New evidence came in' : 'Rewritten with the latest evidence'), changes: stale[n]?.changes || [], prevAt: prev?.meta?.at || null, prevFile: file };
        }
        await packs.put(slug, `${P}moves/${pad2(n)}.json`, move);
        const all = await packs.getJSON(slug, `${P}moves.json`, {}); all[n] = move; await packs.put(slug, `${P}moves.json`, all);
        emit(slug, { type: 'move', n, title: move.title, stat: move.stat, gives: move.gives, verified: !!move.meta?.verified, rewritten: true });
        if (n !== 0) { written.push({ n, title: move.title }); await cardsFor(slug, move, profile, { replace: true, priv }).catch((e) => log.warn('[rewrite] cards', n, e.message)); await editUpd(slug, (u) => { delete u.stale[n]; }); }
        if (n === 21 && !priv) staticsJob = makeStatics(slug, move, profile, (fn) => (lock = lock.then(fn).catch((e) => log.warn('[rewrite] statics card', e.message))));
        if (m.pdf && priv) pdfQ = pdfQ.then(() => renderPdf(slug, m.pdf, move, profile, { priv })).catch((e) => log.warn('[rewrite] pdf', n, e.message)); /* a member's private rewrite keeps its own PDF */
        if (!priv) await unmarkPdf(slug, n); /* the public PDF is drawn again on its next download */
        packs.drop(slug); await onPack(slug); saveSpend(slug);
      };
      const ctx = { brand: { name: profile.name, host: profile.host, descriptor: profile.descriptor }, brief: { md: briefMd, json: brief }, profile, ledger, packs, slug,
        load: (n) => cache[n] || null, save: async (n, move) => { cache[n] = move; await (lock = lock.then(() => saveOne(n, move)).catch((e) => log.warn('[rewrite] save', n, e.message))); },
        canSpend: () => !blocked(slug) && dayUsd() < DAY_CAP && spentFor(slug) - usd0 < cap && !st(slug).cancelled,
        effort: process.env.MOVES_EFFORT || 'medium', search: +(process.env.MOVES_SEARCH ?? 1),
        onTotal: async (N, applicable) => { total = N; await setStatus(slug, { total: N, applicable }); },
        onStart: (n) => { x.inflight.set(n, Date.now()); x.failed.delete(n); emit(slug, { type: 'move-start', n }); },
        onFail: (n, e) => { x.inflight.delete(n); x.failed.set(n, { msg: String(e?.message || e).slice(0, 160), at: Date.now() }); emit(slug, { type: 'move-failed', n, msg: String(e?.message || e).slice(0, 160) }); } };
      await eng.runAll(ctx, { only: ns.length >= 3 ? [...ns, 0] : ns, concurrency: Math.min(6, ns.length), waveA: WAVE_A });
      await lock; await staticsJob; await pdfQ;
      const usd = +(spentFor(slug) - usd0).toFixed(2), at = Date.now();
      await editUpd(slug, (u) => { u.history = [{ at, auto, moves: written, usd, because: written.map((w) => stale[w.n]?.why).filter(Boolean)[0] || null }, ...(u.history || [])].slice(0, 30); });
      await setStatus(slug, { state: (await status(slug)).done ? 'Ready' : prevState });
      emit(slug, { type: 'rewrite-done', n: written.length, usd });
      if (written.length && !priv) notify(slug, 'update', { at, moves: written, because: auto ? 'Your read changed, and these plans quoted what changed.' : '' }).catch((e) => log.warn('[notify]', e.message));
    } catch (e) { log.error('[rewrite] failed', slug, e); /* the brand does not stay on "Rewriting N moves" */
      await setStatus(slug, { state: (await status(slug))?.done ? 'Ready' : prevState || 'Ready' }).catch(() => {}); emit(slug, { type: 'rewrite-done', n: written.length, failed: String(e?.message || e).slice(0, 160) }); }
    finally { x.running = false; x.rewriting = null; saveSpend(slug); await editUpd(slug, (u) => { delete u.rewriting; }).catch(() => {}); }
  }
  /* a rewrite cut off by a restart (a deploy): the status goes back to what it was and the moves it had not written yet are
     rewritten now, auto or asked for alike (a move it wrote carries meta.rewrittenAt from after the start) */
  async function resumeRewrite(slug) {
    const u = await upd(slug), r = u.rewriting; if (!r || st(slug).running || blocked(slug)) return;
    /* a move this run already wrote counts as done, wherever it was saved (a member's rewrite goes to private/moves.json) */
    const pub = await packs.getJSON(slug, 'moves.json', {}), priv = await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({})), s0 = await status(slug);
    const doneAt = (n) => Math.max(Date.parse(pub[n]?.meta?.rewrittenAt || 0) || 0, Date.parse(priv?.[n]?.meta?.rewrittenAt || 0) || 0), moves = pub;
    const left = (r.ns || []).filter((n) => moves[n] && !(doneAt(n) >= (r.at || 0)) && (!r.auto || u.stale?.[n]));
    await setStatus(slug, { state: s0?.done ? 'Ready' : r.prev && !/^Rewriting/.test(r.prev) ? r.prev : s0?.state });
    if (!left.length) { await editUpd(slug, (v) => { delete v.rewriting; }); return; }
    log.log(`[rewrite] ${slug}: carrying on after a restart with ${left.join(', ')}`);
    buildCtx.run(slug, () => rewriteNow(slug, left, { auto: !!r.auto })).catch((e) => log.error('[rewrite] resume', slug, e.message));
  }
  async function updates(slug, { member = true } = {}) {
    const u = await upd(slug), x = st(slug), s0 = await status(slug), moves = await packs.getJSON(slug, 'moves.json', {});
    if (!member) u.stale = Object.fromEntries(Object.entries(u.stale || {}).filter(([, v]) => !v.private));
    const specs = (await load()).moves?.SPECS || [], nm = (n) => (moves[n]?.title ? sentenceCase(moves[n].title) : sentenceCase(specs.find((p) => p.n === +n)?.discipline || '', [], { force: true })) || `Move ${pad2(n)}`;
    const stale = Object.values(u.stale || {}).filter((s) => moves[s.n]).sort((a, b) => (a.priority === b.priority ? a.n - b.n : a.priority === 'high' ? -1 : 1)).map((s) => ({ ...s, title: nm(s.n) }));
    const last = u.lastCheck?.at || s0?.doneAt || null;
    return { auto: u.auto !== false, every: REFRESH_DAYS, checking: x.checking ? (u.checking || { at: Date.now() }) : null, lastCheck: u.lastCheck || null, lastError: u.lastError || null, stale,
      next: u.auto !== false && s0?.done ? (last || Date.now()) + REFRESH_DAYS * 864e5 : null, history: (u.history || []).slice(0, 10),
      rewriting: x.rewriting ? [...x.rewriting].map((n) => ({ n, title: nm(n), secs: x.inflight.has(n) ? Math.round((Date.now() - x.inflight.get(n)) / 1e3) : null, done: !x.inflight.has(n) && moves[n]?.meta?.rewrittenAt && Date.parse(moves[n].meta.rewrittenAt) > Date.now() - 3 * 3600e3 })) : null,
      canRewrite: !x.running, building: !!x.running && !x.rewriting, estMove: MOVE_USD, estCheck: 1, connected: (await packs.getJSON(slug, 'connected-ledger.json', [])).length > 0 || (member && (await packs.getJSON(slug, 'private/connected-ledger.json', [])).length > 0), accounts: Object.entries(u.connected || {}).filter(([, t]) => t).map(([k]) => NAME_OF[k] || k) };
  }
  // an account was connected (or disconnected): its numbers join the evidence, and the moves that measure or spend
  // on it are flagged to be looked at again. No paid call: the match is the fixed map in refresh.js
  const AREA_OF = { shopify: ['store'], meta: ['paid'], google: ['analytics', 'paid'], klaviyo: ['email'], whatsapp: ['email'] };
  const NAME_OF = { shopify: 'Shopify', meta: 'Meta Ads', google: 'Google Ads and GA4', klaviyo: 'Klaviyo', whatsapp: 'WhatsApp' };
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
      const ns = [...new Set((AREA_OF[id] || []).flatMap((a) => CONNECTED_MOVES[a] || []))].filter((n) => moves[n]).slice(0, 6);
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
  const PREFIX = { shopify: ['shopify.'], meta: ['meta.'], google: ['ga4.', 'gads.'], klaviyo: ['klaviyo.'], marketplaces: ['market.'], reviews: ['reviews.judgeme.'] };
  async function liveConnected(slug, id, add = [], on = true, { public: pub = false } = {}) {
    const file = pub ? 'connected-ledger.json' : 'private/connected-ledger.json', mine = (e) => !e.demo && (PREFIX[id] || []).some((p) => e.key.startsWith(p));
    const before = await packs.getJSON(slug, file, []), was = before.filter(mine);
    // a real account replaces its demo numbers
    const L = [...before.filter((e) => !mine(e) && !(e.demo && (PREFIX[id] || []).some((p) => e.key.startsWith(p)))), ...(on ? add : [])];
    await packs.put(slug, file, L);
    const moves = await packs.getJSON(slug, 'moves.json', {});
    // only what is new or moved: the first read flags, a daily resync flags only when a number really changed
    const { changes } = diffLedgers(was, on ? add : [], []);
    const fresh = on ? realRows(add).filter((e) => changes.some((c) => c.key === e.key)) : []; /* a simulated account never marks a move out of date */
    const ns = [...new Set((AREA_LIVE[id] || []).flatMap((a) => CONNECTED_MOVES[a] || []))].filter((n) => moves[n]).slice(0, 6);
    await editUpd(slug, (u) => {
      for (const n of Object.keys(u.stale)) if (u.stale[n].via === id) delete u.stale[n];
      if (fresh.length) for (const n of ns) if (!u.stale[n]) { const rel = relevant(n, fresh);
        u.stale[n] = { n, priority: 'medium', via: id, live: true, real: true, private: !pub, at: Date.now(),
          why: `${NAME_OF[id] || id} is connected. This plan used estimates for ${rel.map((e) => e.label.toLowerCase()).join(' and ')}; it can now use ${rel.map((e) => e.v).join(' and ')}.`,
          changes: rel.map((e) => `New: ${e.label}: ${e.v}`) }; }
      u.connected = { ...(u.connected || {}), [id]: on ? Date.now() : null };
    });
    emit(slug, { type: on ? 'connected' : 'disconnected', ids: [id], live: true });
    if (!pub) await hooks.connected?.(slug, id).catch((e) => log.warn('[facts] connected', e.message)); /* the fact sheet: connected accounts are the source of truth (facts-desk.js) */
  }
  const setAuto = (slug, on) => editUpd(slug, (u) => { u.auto = !!on; }).then(() => ({ ok: true }));
  // "whenever relevant": the free catalog watch (every 3 hours) saw a price change, a launch or a removal
  const RETRY_MS = +process.env.REFRESH_RETRY_MS || 24 * 3600e3;
  const backingOff = (u) => !!u?.lastError?.at && Date.now() - u.lastError.at < RETRY_MS;
  async function signal(slug, events = []) {
    const rel = events.filter((e) => ['price', 'new', 'removed', 'gone', 'drift'].includes(e.kind)); if (!rel.length) return;
    const s0 = await status(slug), u = await upd(slug); if (!s0?.done || u.auto === false || st(slug).running || st(slug).checking) return;
    if (Date.now() - (u.lastCheck?.at || s0.doneAt || 0) < 24 * 3600e3 || backingOff(u)) return; /* at most one event-driven check a day, and a day after a failed one */
    const say = { price: 'a price changed', new: 'a product launched', removed: 'a product was removed', gone: 'a product we quote is gone', drift: 'a price we quote changed' };
    checkUpdates(slug, { auto: true, why: `Your catalog changed: ${[...new Set(rel.map((e) => say[e.kind]))].join(', ')}` });
  }
  // the weekly check, for brands someone opened in the last month
  const seenAt = new Map();
  const seen = (slug) => { if (Date.now() - (seenAt.get(slug) || 0) < 3600e3) return; seenAt.set(slug, Date.now()); setStatus(slug, { seenAt: Date.now() }).catch(() => {}); };
  function autoRefresh() {
    if (process.env.BUILD_RESUME_OFF) return;
    const autoOn = process.env.REFRESH_AUTO !== '0';
    const tick = async () => { for (const b of await packs.list().catch(() => [])) {
      const s0 = b.status;
      /* "it carries on tomorrow": a build paused for the day's shared budget picks up the next day, not only at the next restart */
      if (s0 && !s0.done && !s0.error && !s0.capped && !s0.cancelled && s0.pausedDay && s0.pausedDay < dayKey() && !st(b.slug).running && !blocked(b.slug)) { log.log(`[build] ${b.slug}: paused on ${s0.pausedDay} for the day's budget, carrying on`); resume(b.slug).catch((e) => log.error('[build] resume', b.slug, e.message)); continue; }
      if (!autoOn || !s0?.done || s0.cancelled || blocked(b.slug)) continue;
      if (Date.now() - (s0.seenAt || s0.doneAt || 0) > 30 * 864e5) continue;
      const u = await upd(b.slug); if (u.auto === false) continue;
      if (backingOff(u)) continue; /* a failed check waits a day before the next paid try, not an hour */
      if (Date.now() - (u.lastCheck?.at || s0.doneAt || Date.now()) > REFRESH_DAYS * 864e5) await checkUpdates(b.slug, { auto: true, why: 'Weekly check' });
    } };
    setTimeout(() => tick().catch((e) => log.warn('[refresh] tick', e.message)), 10 * 60e3).unref?.();
    setInterval(() => tick().catch((e) => log.warn('[refresh] tick', e.message)), 3600e3).unref?.();
  }
  async function list() {
    const all = await packs.list();
    return all.filter((x) => !blocked(x.slug) && !x.status.cancelled && !x.status.error).sort((a, b) => (b.status.updatedAt || 0) - (a.status.updatedAt || 0)).map((x) => ({ slug: x.slug, name: x.status.name, host: x.status.host, logo: x.status.logo ? (/^https?:\/\//.test(x.status.logo) ? x.status.logo : '/' + String(x.status.logo).replace(/^\/+/, '')) : null, /* one leading slash: '//b/..' would be read as another host */ state: x.status.done ? 'Ready' : x.status.ready ? `${x.status.movesDone || 0} of ${totalOf(x.status)} moves` : 'Reading' }));
  }
  // after a restart: carry on with any brand that wasn't finished
  /* a one-off fresh reload (OPS_FRESH_RELOAD=<slug,...>): the pending updates are dropped, the brand's cap lifts (Pro), the build
     writes every missing move from today's brief (with the team's learnings), then every older move (and the index) is rewritten.
     A marker in the pack (private/ops-fresh.json) makes it run once and carry on across restarts */
  async function freshReload(slug) {
    if (blocked(slug) || !(await status(slug))) return;
    let mk = await packs.getJSON(slug, 'private/ops-fresh.json', null); if (mk?.phase === 'done') return;
    if (!mk) { mk = { startedAt: Date.now(), phase: 'build' }; await packs.put(slug, 'private/ops-fresh.json', mk);
      await editUpd(slug, (u) => { u.stale = {}; delete u.queue; delete u.queueDay; });
      const L = await packs.getJSON(slug, 'learned.json', null); if (L && (L.pendingFull || L.draft)) { delete L.pendingFull; delete L.draft; await packs.put(slug, 'learned.json', L); }
      const s0 = (await status(slug)) || {}; await setStatus(slug, { pro: true, proAt: s0.proAt || Date.now(), proBy: s0.proBy || 'ops: fresh reload', capped: false, pausedDay: null });
      log.log(`[ops] ${slug}: fresh reload started`); }
    const tick = async () => {
      const x = st(slug), s1 = await status(slug); mk = await packs.getJSON(slug, 'private/ops-fresh.json', mk);
      if (mk.phase === 'done' || blocked(slug) || s1?.cancelled) return;
      if (x.running) return setTimeout(tick, 60e3).unref?.();
      if (!s1?.done) { if (s1?.capped || s1?.pausedDay) await setStatus(slug, { capped: false, pausedDay: null }); log.log(`[ops] ${slug}: writing the missing moves`); resume(slug).catch((e) => log.error('[ops] resume', e.message)); return setTimeout(tick, 120e3).unref?.(); }
      const moves = await packs.getJSON(slug, 'moves.json', {}), t0 = mk.startedAt;
      const old = Object.keys(moves).map(Number).filter((n) => n >= 1 && n <= 50 && Math.max(Date.parse(moves[n]?.meta?.rewrittenAt || 0), Date.parse(moves[n]?.meta?.at || 0)) < t0).sort((a, b) => a - b);
      if (!old.length) { await packs.put(slug, 'private/ops-fresh.json', { ...mk, phase: 'done', doneAt: Date.now() }); log.log(`[ops] ${slug}: fresh reload done`); return; }
      await packs.put(slug, 'private/ops-fresh.json', { ...mk, phase: 'rewrite' }); log.log(`[ops] ${slug}: rewriting ${old.length} older moves: ${old.join(', ')}`);
      await editUpd(slug, (u) => { for (const n of old) u.stale[n] = { n, priority: 'high', why: 'Fresh reload with what the team told us', changes: [], at: Date.now() }; });
      await buildCtx.run(slug, () => rewriteNow(slug, old)).catch((e) => log.error('[ops] rewrite', e.message));
      /* a pass that rewrote nothing (budget, errors) stops the loop instead of paying again every minute (2026-10-14: about $7 for nothing) */
      const after = await packs.getJSON(slug, 'moves.json', {}), left = old.filter((n) => Math.max(Date.parse(after[n]?.meta?.rewrittenAt || 0), Date.parse(after[n]?.meta?.at || 0)) < t0);
      if (left.length >= old.length) { await packs.put(slug, 'private/ops-fresh.json', { ...mk, phase: 'stalled', stalledAt: Date.now(), why: 'a pass rewrote no moves' }); log.warn(`[ops] ${slug}: fresh reload stopped: a pass rewrote no moves`); return; }
      setTimeout(tick, 60e3).unref?.(); /* whatever a restart cut short is picked up next time round */ };
    setTimeout(tick, 20e3).unref?.();
  }
  async function resumeAll() { for (const sl of String(process.env.OPS_FRESH_RELOAD || '').split(',').map((x) => x.trim()).filter(Boolean)) freshReload(sl).catch((e) => log.error('[ops] fresh', sl, e.message));
    for (const x of await packs.list()) { if (!x.status.done && !x.status.error && !x.status.capped) resume(x.slug).catch((e) => log.error('[build] resume', x.slug, e.message)); else { if (x.status.done) { rebase(x.slug).catch((e) => log.warn('[build] rebase', x.slug, e.message)); healPdfs(x.slug); } resumeRewrite(x.slug).catch((e) => log.warn('[rewrite] resume', x.slug, e.message)); } } }
  /* Saved PDFs heal: when the PDF text rules change (PDF_V) the saved PDFs are forgotten and each is drawn again on its next
     download (pdfOn); entries for moves that no longer exist leave status.pdfs. Nothing is drawn ahead of time. */
  const PDF_V = 2; // 2: kickers without "OF N", "What to watch", BREW DRAFTS (2026-10-15)
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
  const pdfFor = async (slug, move) => { const m = await load(); if (!m.pdf) return null; const profile = await packs.getJSON(slug, 'profile.json'); if (!profile) return null; return renderPdf(slug, m.pdf, move, profile); };
  /* a move's PDF, made when someone opens it: drawn once per version of the move (and of the PDF rules), then served from the
     pack; two people opening it at once wait for the same render. → { name, buf } | null */
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
      await renderPdf(slug, m.pdf, mv, profile, { ver }); const name = m.pdf.pdfName(mv);
      return { name, buf: await packs.get(slug, 'pdf/' + name) };
    })().finally(() => pdfJobs.delete(key)));
    return pdfJobs.get(key);
  }
  /* ---------- for the fact sheet (facts-desk.js) ---------- */
  const hooks = {};
  const republish = async (slug) => { const p = await packs.getJSON(slug, 'profile.json'); if (!p) return; normalizeProfile(p); await publishBase(slug, p, await packs.getJSON(slug, 'ledger.json', []), await packs.getJSON(slug, 'findings.json')); };
  /* moves the fact sheet found quoting a changed fact: out of date, with the reason (kept with an older flag's changes) */
  const flagStale = (slug, list = []) => editUpd(slug, (u) => { for (const x of list) { const o = u.stale[x.n]; u.stale[x.n] = { ...x, at: Date.now(), changes: [...new Set([...(x.changes || []), ...(o?.changes || [])])].slice(0, 6), ...(o && !o.private ? { private: false } : {}) }; } });
  const facts = { republish, flagStale, readProduct: async (slug, url) => readProduct(slug, url, (await packs.getJSON(slug, 'profile.json', {})) || {}), readRival, busy: (slug) => !!(st(slug).running || st(slug).checking), setHooks: (h) => Object.assign(hooks, h) };
  return { ...facts, readLive, heal, healPdfs, pdfFor, pdfOn, connected, liveConnected, checkUpdates, rewrite, updates, setAuto, signal, seen, buildInfo, retry, goPro, checkData, applyCheck, peek: (slug) => st(slug).status, addEmail, start, resume, resumeAll, subscribe, status, summary, confirm, list, events: (slug) => st(slug).events, spent: spentFor, spentToday: dayUsd };
}
