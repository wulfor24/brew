// Prototype of the Feed service from the engineering spec (v13):
// tenants, card store + lifecycle, ranker (freshness + impact + affinity + seat − fatigue), daily free
// budget, feedback, action runs behind a weekly spend limit, versions, jam router + deployment
// workbench, stories, deck layout, always-on watchers with a QA agent, brand memory and metrics.
// State is in memory per tenant; the client re-creates its tenant from a snapshot after a restart.
import { realRows } from './connectors/common.js';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { near } from './research.js';
import { B, live as liveView, liveArr, liveRe, runIn, BN, BH, CTRY, FESTN, FESTD } from './brand-ctx.js';
import { cardValue, moveNo } from './value.js'; // what a card is worth doing (expected value), for the ranker
import { moneyParse, safeLocale } from './brand-pack.js';
import { allowedFrom, unbacked, numbersIn } from './fact-gate.js';
import { createRemix } from './remix.js';
import { saveGen } from './gen-store.js';
import { createJamBrief } from './jam-brief.js';
import { shipLine } from './text-fit.js';
import { createDrafts, fakeMakers } from './drafts.js';
import { seedDrafts, draftFor, draftView } from './drafts-bg.js';
import { planFor, planPrompt } from './card-plan.js';
import { createMoves } from './moves.js';
import { rulesFor, addLesson, stepOnce, lessonsFor, promptBlock, outcome, memoryBlock } from './learn.js';
import { createHandoff, parseToken, handoffPath, jamPath, shareToken, parseShare } from './handoff.js';
import { PAGE_SCHEMA, pagePrompt, moveTextOf, sanitizePage, fallbackPage } from './card-page.js';
import { withPrefs, prefsOf } from './model-ctx.js';
import { createMemberCtx } from './member-ctx.js';
import { createJams } from './jams.js';
import { parseLearnCommand, learnGate, cardUsesLearned } from './brand-learnings.js'; // /update-brand-learnings in a jam
import { AsyncLocalStorage } from 'node:async_hooks';
/* this request may make fresh work (the brand's team, SquareUp); false = demo mode. Unset off a request (the background clock) */
const GEN_CTX = new AsyncLocalStorage();
const demoReq = () => GEN_CTX.getStore() === false;
import { demoSid, runDemo, sk } from './demo-mode.js'; // Demo Mode: per-session workspaces
// cut on a word boundary with an ellipsis, never mid-word or with a dangling space
const cutWords = (x, n) => { x = String(x).trim(); return x.length > n ? x.slice(0, n - 1).replace(/\s+\S*$/, '').replace(/[\s,;:·-]+$/, '') + '…' : x; };

const H = 3600e3, D = 24 * H;
const AGENT = { creative: 'Creative director', performance: 'Performance marketer', storefront: 'Storefront manager', visibility: 'AI visibility', crm: 'CRM specialist', brew: 'Brew' };
const FAMILY = { idea: 'idea', decision: 'decision', report: 'result', competitor: 'learning' };
// brand-specific values come from the active brand pack (brand-ctx.js / brand-pack.js)
const RIVALS = liveRe((b) => b.rivalsRe);
const FEST = () => B()?.festivalAt || null; // the next big sale day for this brand

// How each kind of card would be measured (the plan the brief carries: the metric, what to watch, how the result is told
// apart). Baselines come from the brand's config or stay "to be measured"; nothing here is read or graded.
const genericMeasure = (b) => {
  const n = b.name, h = b.host, sym = b.sym || '', c = b.config || {}, m = c.measure || {};
  const mk = (k, o) => ({ ...o, baseline: m[k]?.baseline ?? null, target: m[k]?.target ?? null, ...(m[k] || {}) });
  return {
    creatives: mk('creatives', { metric: 'Cost per first order', unit: sym, lower: true, from: 'meta', window: 7, watch: ['Thumb-stop: people who watch past 3 seconds', 'Frequency stays under 3.5', 'Comments asking about price or side effects'], attribution: 'Ad-level orders in Meta, matched to store orders by server-side tracking, checked against the “how did you hear about us” answer after purchase.' }),
    ads: mk('ads', { metric: 'Cost per first order', unit: sym, lower: true, from: 'meta', window: 7, watch: ['Spend pace against the weekly limit', 'Frequency', 'Return on ad spend on non-brand'], attribution: 'Meta and Google results matched to store orders by server-side tracking. A holdout region shows whether the lift is real.' }),
    storefront: mk('storefront', { metric: 'Visits that become a first order', unit: '%', from: 'shopify', window: 14, watch: ['Add-to-cart rate', 'Checkout drop-off', 'Average order value'], attribution: 'A/B test: half of visitors see the new version, half the old one, for 14 days. Only the difference counts.' }),
    catalog: mk('catalog', { metric: 'Orders from the listing, per week', unit: '', from: 'marketplaces', window: 14, watch: ['Listing approval', `Search rank for “${c.listingTerm || 'the main category term'}”`, 'Days of stock left'], attribution: 'Marketplace orders for this item against the 14 days before, with sale days taken out.' }),
    visibility: mk('visibility', { metric: `AI answers that name ${n}`, unit: ` of ${(c.questions || []).length * 4 || 32}`, from: null, window: 28, watch: [`Which AI tools cite ${h}`, 'Whether claims are quoted correctly', 'How often rivals are named'], attribution: 'The same questions are asked again in 4 AI tools every week. Nothing else changes the count.' }),
    signals: mk('signals', { metric: 'Reorders by day 45', unit: '%', from: 'shopify', window: 21, watch: ['Opt-outs', 'Messages read', 'Complaints'], attribution: 'A 10% holdout gets no message. The gap in reorders between the two groups is the lift.' })
  };
};
const measureFor = (b) => (b._measure ||= genericMeasure(b));
export const MEASURE = liveView((b) => measureFor(b));

/* ---------- move cards follow their moves (pure; the feed service and tests use it) ---------- */
export const moveNoOf = (id) => { const m = /^m(\d+)-\d+$/.exec(String(id || '')); return m && +m[1] > 0 ? +m[1] : null; };
// the version of the move a card was made from: a rewrite stamps meta.rewrittenAt; null when the card is not a move card or its move is gone
export const moveVersion = (docs, id) => { const n = moveNoOf(id), m = n == null ? null : docs?.[n]; return m ? String(m.meta?.rewrittenAt || m.meta?.version || m.meta?.at || 1) : null; };
/* a workspace's move cards against the brand's moves now: a card whose move was retired steps back (expired, unless someone acted
   on it); one whose move was rewritten takes the new card (as addCards replace does), or steps back if the rewrite made fewer cards.
   A card without a version yet is stamped with today's. With no moves read at all nothing is touched */
export function followMoveCards(cards, { docs = {}, posts = [], at = Date.now(), keep = () => false, expire, clone = (x) => JSON.parse(JSON.stringify(x)) } = {}) {
  const out = { expired: [], replaced: [] }; if (!docs || !Object.keys(docs).length) return out;
  const src = new Map(posts.map((p) => [p.id, p])), live = (c) => ['ready', 'shown'].includes(c.state);
  const drop = (id, c) => { if (live(c) && !keep(id)) { expire(c); out.expired.push(id); } };
  for (const [id, c] of cards) {
    const n = moveNoOf(id); if (n == null || c.privateOf != null || c.liveOnly) continue; /* a member's private move cards follow private/cards.json */
    if (!docs[n]) { drop(id, c); continue; }
    const v = moveVersion(docs, id); if (c.mv == null) { c.mv = v; continue; }
    if (c.mv === v) continue;
    c.mv = v; const p = src.get(id);
    if (p) { Object.assign(c, clone(p), { createdAt: at, mv: v }); out.replaced.push(id); } else drop(id, c);
  }
  return out;
}

const watchersFor = (b) => (b._watchers ||= [
  { id: 'trends', data: 'live', name: 'Trends', agent: 'brew', cadence: 'Daily', demoEvery: D, firstAt: 45e3, watches: 'Category news, search interest, the festive calendar', produces: 'Trends ring slides; idea cards when a trend meets a product' },
  { id: 'ads-library', data: 'live', name: 'Popular ads', agent: 'performance', cadence: 'Daily', demoEvery: D, firstAt: 75e3, watches: 'Ad libraries in and around the category', produces: 'Popular ads ring; “rivals run this” cards' },
  { id: 'catalog', name: 'Catalog', agent: 'storefront', cadence: 'Every 3 hours', demoEvery: D, firstAt: 30e3, data: 'live', watches: `The live ${b.host} catalog: prices, stock, launches, removed items, photos`, produces: 'Exception cards: out of stock, price changes, prices our cards quote, thin listings, new launches' },
  b.kind === 'generated'
    ? { id: 'ads', data: 'live', name: 'Your ads', agent: 'performance', cadence: 'Daily', demoEvery: D, firstAt: 50e3, watches: `Your own live ads in the Meta Ad Library (${b.config.countryName || 'your market'}): how many run, how long each has run, versions, formats, new launches`, produces: 'Refresh cards for ads that have run for months unchanged; launch and count changes. Spend, cost per order and frequency need your Meta account' }
    : { id: 'ads', data: 'sample', name: 'Ads', agent: 'performance', cadence: 'Hourly with Meta connected', demoEvery: 2 * 60e3, firstAt: 25e3, needs: 'meta', watches: 'Frequency, cost per result, fatigue', produces: 'Rotate creative and Shift budget cards' },
  { id: 'visibility', name: 'AI visibility', agent: 'visibility', cadence: 'Weekly', demoEvery: D, firstAt: 40e3, data: 'live', watches: `${(b.config.questions || []).length || 8} shopper questions asked from ${b.config.countryName || 'your market'} to the real ChatGPT, Gemini, Perplexity and Claude`, produces: 'Score changes, publish-a-page cards, the health ring' },
  b.kind === 'generated'
    ? { id: 'batches', data: 'live', name: 'Work in progress', agent: 'brew', cadence: 'On every change', demoEvery: 30e3, firstAt: 10e3, watches: 'Your moves, the static ads, every jam and Work board item and where it is', produces: 'The Your team is working card and the brand ring, straight from real work' }
    : { id: 'batches', data: 'sample', name: 'Batches', agent: 'brew', cadence: 'On event', demoEvery: 40e3, firstAt: 20e3, watches: 'Deployment team batches and jams', produces: 'What is new ring; Your team is working card' },
  { id: 'creative', data: 'live', name: 'Creative', agent: 'creative', cadence: 'Fills the daily budget', demoEvery: 3 * 60e3, firstAt: 60e3, watches: 'Brand memory, hearted cards, the calendar', produces: 'Idea cards with generated images (cheap model first)' }
]);
export const WATCHERS = liveArr((b) => watchersFor(b));

const ROUTE_RULES = [
  ['a shoot', /\b(shoot|photoshoot|reshoot|photograph|film it|filming)\b/i],
  ['a model or creator', /\b(model|influencer|creator|actor|celebrity)\b/i],
  ['pricing or discount', /\b(price|pricing|discount|% off|mrp|coupon|cheaper)\b/i],
  ['legal', /\b(legal|lawyer|compliance|contract|trademark|cdsco|asci)\b/i],
  ['a call', /\b(call me|a call|meeting|zoom|get on a call)\b/i],
  ['a new product', /\b(new product|new sku|new variant|formulat\w*)\b/i],
  ['a person', /\b(person|human|someone|dermatologist|doctor)\b/i]
];

/* ---------- the setup screen's read stream (a generated brand) ----------
   replay and follow the real read (build.js) in the v1 event shape the setup screen draws. The builder's buffer can hold
   only a status event (a cached read: no reader events in memory, or after a restart). Then the pack's steps and findings
   are replayed first, and `ready` is held until they are sent: the screen never gets `ready` before the steps it reports. */
const STEP_KEYS = ['open', 'brand', 'catalog', 'reviews', 'ads', 'site', 'answers'];
const FIRST_LOAD_MS = 3 * 60e3; // watcher posts in the first minutes after setup are the first load, not news
const AGENT_OF = { catalog: 'storefront', reviews: 'creative', ads: 'performance', site: 'storefront', answers: 'visibility', brand: 'creative', open: 'crm' };
/* Demo Mode's live tour, one step: the live step stands unless it came back empty or partial (a paid source off, a rival
   search that failed) while the saved read has that step whole; then the saved step and its findings are shown, marked
   as carried from the last read. A step the saved read lacks too stays as the live read says, honestly */
export function tourStep(ev, old, savedCards = [], liveFindings = []) {
  const worse = (ev.state === 'empty' || !!ev.partial) && !!old?.done && old.state !== 'empty' && !old.partial;
  if (worse) return { carried: true, empty: false, done: old.done, cards: savedCards.map((c) => ({ finding: { ...c, carried: true }, say: 'From the last read' })) };
  const empty = ev.state === 'empty';
  return { carried: false, empty, done: ev.done || (empty ? 'Nothing found' : 'Done'), cards: liveFindings.map((e) => ({ finding: e.finding, say: e.say || 'Found it' })) };
}
export function followRead({ builder, slug, loadSeed, send, isOpen = () => true, startedAt = Date.now(), replayMs = 500 }) {
  let sentReady = false, doneSeen = false, hold = !(builder.events(slug) || []).some((e) => e.type === 'reader');
  const ready = () => { if (sentReady || !isOpen()) return; sentReady = true; send({ type: 'ready', ms: Date.now() - startedAt }); };
  const on = (e) => {
    if (e.type === 'reader') { const ev = e.ev, i = STEP_KEYS.indexOf(ev.k);
      if (ev.type === 'step' && ev.state === 'reading') send({ type: 'step', i, state: 'reading', tick: ev.tick || '' });
      if (ev.type === 'finding') send({ type: 'finding', i, finding: ev.finding, say: ev.say });
      if (ev.type === 'step' && (ev.state === 'done' || ev.state === 'empty')) { send({ type: 'step', i, state: 'done', empty: ev.state === 'empty', done: ev.done || (ev.state === 'empty' ? 'Nothing found' : 'Done') }); if (AGENT_OF[ev.k]) send({ type: 'agent', agent: AGENT_OF[ev.k] }); } }
    if (e.type === 'read-done' || (e.type === 'status' && e.status?.stages?.read?.state === 'done')) { doneSeen = true; if (!hold) ready(); }
    if (e.type === 'status' && e.status?.error && !sentReady) send({ type: 'error', msg: e.status.state });
  };
  // someone arriving mid-read or after it sees what was already found (subscribe replays the buffer), then the rest live
  const off = builder.subscribe(slug, on);
  const release = () => { hold = false; if (doneSeen) ready(); };
  Promise.resolve(builder.status(slug)).then(async (st) => {
    if (!hold || st?.stages?.read?.state !== 'done' || (builder.events(slug) || []).some((e) => e.type === 'reader')) return release();
    const f = await loadSeed(); const steps = f?.steps || [], cards = f?.scrape || [];
    for (let i = 0; i < steps.length && isOpen(); i++) {
      send({ type: 'step', i, state: 'reading', tick: '/' });
      cards.filter((c) => (c.k || STEP_KEYS[i]) === STEP_KEYS[i]).forEach((c) => send({ type: 'finding', i, finding: c }));
      if (replayMs) await new Promise((r) => setTimeout(r, replayMs));
      send({ type: 'step', i, state: 'done', empty: steps[i].state === 'empty', done: steps[i].done });
    }
    doneSeen = true; release();
  }).catch(() => release());
  return off;
}

export function createFeedService(o) {
  const { PUB, claudeJSON, claudeTool, mockVariants, geminiImage, BANNED, clean, store, packs, builder, log = console } = o;
  /* every card's plan (card-plan.js): the ground-work steps toward its action, with its first draft as v0. Worked out from
     the card itself, so saved cards get it without new spend; every prompt that reads a card reads its plan too */
  const planOfCard = (c) => { if (!c?.id || !c.title) return null; try { return planFor(c, { draft: draftView(draftFor(c, B()?.firstDrafts), c) }); } catch (e) { log.warn?.('[plan]', e.message); return null; } };
  const cardBrief = (c, role) => `${o.cardBrief(c, role)}${planPrompt(planOfCard(c))}`;
  /* demo mode: a request from someone who may not make fresh work runs every AI path as mock (nothing spent, the plain
     version shown); the background clock and the team's requests are unchanged */
  const isMock = () => !!o.isMock?.() || demoReq(), spend = (k) => !demoReq() && (o.spend ? o.spend(k) : true);
  // real connected accounts (connectors/index.js): who is on the brand's team, and the live cards they get
  const viewerOf = o.viewerOf || (async () => ({ member: false, claimed: false })), liveFor = o.liveFor || (async () => ({ cards: [], on: {}, privMoves: [] }));
  const photoFile = o.photoFile || ((rel) => path.join(PUB, rel));
  // research rings and live watchers run per brand (server.js attaches them to each pack)
  const research = liveView((b) => b.research), live = liveView((b) => b.live);
  const brandTenants = (b) => [...tenants.values()].filter((t) => (t.brandId || DEFAULT_BRAND) === b.slug);
  /* a move card (id mNN-i) remembers the version of the move it was made from (mv), so a workspace that was not open when its move
     was rewritten (build.js rewriteNow) or retired (moves-cadence.js) catches up when it loads; open ones get addCards / dropCards */
  const mvOf = (br, id) => moveVersion(br?.moveDocs, id);
  const followMoves = (t, br) => { if (br?.kind !== 'generated') return;
    const keep = (id) => t.acted?.has?.(id) || (t.work || []).some((w) => w.cardId === id);
    followMoveCards(t.cards, { docs: br.moveDocs, posts: SEED.posts, at: now(t), keep, expire: (c) => setState(t, c, 'expired'), clone }); };
  const DEFAULT_BRAND = o.defaultBrand || 'brew'; // a workspace with no brand: the Brew default context (brand-pack.js DEFAULT)
  const brandOfT = (t) => packs.peek(t.brandId || DEFAULT_BRAND);
  let JB = null, DR = null; // the living jam brief (jam-brief.js), first drafts (drafts.js)
 // the agent layer's routes and resume clock (agent-runner.js)
  let HO = null; // the full-context handoff (handoff.js)
  let MOVES = null; // the move documents (moves.js)
  let RMX = null; // the studio (remix.js), wired up once the routes exist
  let linkChange = null; // a jam's change package for its work item (set with the work routes)
 // the measuring engine (measure-engine.js), behind MEASURE_ENGINE; off = the old simulated loop
  // the active brand's data (a generated pack, or the Brew default context); see brand-ctx.js
  const SEED = liveView((b) => b.seed);
  // the brand's own product lines (seed lanes): watcher and Creative cards use them, never another brand's lane names
  const creativeByBrand = new Map(), newWs = new Map();
  const laneIds = () => Object.keys(SEED.lanes || {}), firstLane = () => laneIds()[0] || 'core';
  const FACTS = liveView((b) => b.facts), fx = (s) => B().fx(s);
  const FACT_OK = { has: (n) => B().factOk.has(n), [Symbol.iterator]: () => B().factOk[Symbol.iterator]() };
  const POOLS = liveView((b) => b.pools), STATICS = liveArr((b) => b.statics), LANE_PHOTO = liveView((b) => b.lanePhoto);
  /* a lane's product photo for an image reference: the brand's lane photo, else the seed's lane image (most generated brands have
     only these), else none */
  const refPhoto = (lane) => { const li = SEED?.laneImg || {}; return LANE_PHOTO[lane] || Object.values(LANE_PHOTO)[0] || li[lane] || Object.values(li)[0] || null; };
  // who is reading, for Claude: seat, focus product and what they asked to see first
  const seatLine = (v = {}) => [SEED.roles[v.role]?.title || 'founder', v.lane && SEED.lanes[v.lane] ? `focused on ${SEED.lanes[v.lane].name}` : '', v.wants?.length ? `who wants ${v.wants.map((w) => SEED.wants[w]?.name.toLowerCase()).filter(Boolean).join(' and ')} first` : ''].filter(Boolean).join(', ');
  /* who is acting is decided per request, never by a flag left on the shared workspace: a workspace id travels in share and
     handoff links, so a stored t.member would let any link holder act as the team. In a request, t.member and t.memberEmail
     are that request's signed-in viewer (REQ); on the background clock they are the last team member who opened the
     workspace (t.teamEmail), re-checked against the brand's members before every tick (BG, bgTeam) */
  const MC = createMemberCtx({ isMemberEmail: o.isMemberEmail || null, defaultBrand: DEFAULT_BRAND }), reqOf = MC.reqOf; /* member-ctx.js */
  /* team jams (jams.js): a member's t.work and t.changes are the brand's shared jams; a visitor keeps their own */
  const JAMS = o.jams || createJams({ packs: o.globalPacks || packs, reqOf, bgMember: MC.bgMember, log });
  /* the person acting in this request ({ email, name, pic }), or null (a visitor, the background clock) */
  const meOf = (t) => { const r = reqOf(t); if (!r) return null; if (r.member && r.email) return { email: r.email, name: r.name || null, pic: r.pic || null, ...(o.isStaff?.(r.email) ? { staff: true } : {}) }; if (r.guest?.email) return { email: r.guest.email, name: r.guest.name || null, pic: r.guest.pic || null }; return null; };
  const tenants = new (class extends Map { set(k, t) { MC.guard(t); JAMS.guard(t); return super.set(k, t); } })();
  /* jam emails to the team (jam-mail.js); the demo site never sends */
  const mailEv = (t, w, ev) => { if (!o.jamMail || process.env.DEMO_MODE === '1') return; o.jamMail.event(t.brandId || DEFAULT_BRAND, w, ev).catch((e) => log.warn?.('[jam-mail]', e.message)); };
  const nameOf = (p) => p?.name || p?.email || 'Someone';
  /* the ShopOS team was tagged: its shared inbox gets the jam link and the read-only brief (jam-mail.js shopos) */
  const shoposMail = (t, w, { why, text }) => { if (!o.jamMail || process.env.DEMO_MODE === '1') return; const base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com';
    o.jamMail.shopos(t.brandId || DEFAULT_BRAND, w, { by: meOf(t), why, text, ticket: w.ticket || null, jamUrl: `${base}${jamPath(t, w)}`, briefUrl: `${base}${handoffPath(t, w)}?full=1` }).catch((e) => log.warn?.('[jam-mail] shopos', e.message)); };
  /* the people a jam may tag or assign: the brand's team, its pending invites, and the jam's own guests (never a stranger) */
  const tagsOf = async (t, w, list) => {
    const want = [...new Set((Array.isArray(list) ? list : [list]).map((e) => String(e || '').toLowerCase().trim()).filter(Boolean))].slice(0, 12); if (!want.length) return [];
    const m = o.teamOf ? await o.teamOf(t.brandId || DEFAULT_BRAND).catch(() => null) : null, known = new Map();
    for (const x of m?.members || []) known.set(x.email, { email: x.email, name: x.name || null, pic: x.pic || null });
    for (const x of m?.invites || []) if (!known.has(x.email)) known.set(x.email, { email: x.email, name: null, pic: null, invited: true });
    for (const x of w.people || []) if (!known.has(x.email)) known.set(x.email, { email: x.email, name: x.name || null, pic: x.pic || null });
    return want.map((e) => known.get(e)).filter(Boolean); };
  let ticket = 1041, leadsAllTenants = 0;

  /* ---------- small helpers ---------- */
  const uid = (p) => p + '_' + crypto.randomBytes(p === 't' ? 8 : 4).toString('hex'); // a workspace id is a key to it: 64 bits, not 32
  // Brew tickets are numbered per workspace and never reused, even across restarts (the old global counter reset on every deploy)
  const ticketNo = (x) => +(/^(?:BR|SO)-(\d+)$/.exec(x || '')?.[1] || 0); // BR- (Brew); SO- from before the rename still counts
  const nextTicket = (t) => { t.ticketN = Math.max(t.ticketN || 1041, ...t.work.map((w) => ticketNo(w.ticket)), ...(t.jams || []).map((j) => ticketNo(j.ticket))) + 1; return 'BR-' + t.ticketN; };
  // workspaces made before that can hold the same ticket on two items: the oldest keeps it, the rest get a fresh one
  /* BR numbers run per brand, not per workspace: two teammates' first briefs are BR-1042 and BR-1043, never both BR-1042.
     Kept in the brand pack (tickets.json), one writer at a time (one instance). */
  const ticketLock = new Map();
  const nextBrandTicket = (t) => { const slug = t.brandId, P = o.globalPacks; if (!slug || !P?.getJSON) return Promise.resolve(nextTicket(t));
    const run = (ticketLock.get(slug) || Promise.resolve()).catch(() => {}).then(async () => { const j = await P.getJSON(slug, 'tickets.json', { n: 1041 }).catch(() => ({ n: 1041 }));
      const n = Math.max(j.n || 1041, t.ticketN || 1041, ...t.work.map((w) => ticketNo(w.ticket))) + 1; await P.put(slug, 'tickets.json', { n, at: Date.now() }); t.ticketN = n; return 'BR-' + n; });
    ticketLock.set(slug, run); return run; };
  const fixTickets = (t) => { const seen = new Set(); for (const w of [...t.work].sort((a, b) => a.createdAt - b.createdAt)) { if (!w.ticket) continue; if (seen.has(w.ticket)) w.ticket = nextTicket(t); seen.add(w.ticket); } };
  const now = (t) => Date.now() + (t?.clock || 0);
  const dayKey = (ms) => new Date(ms + (B()?.tzMs ?? 5.5 * H)).toISOString().slice(0, 10);
  const weekKey = (ms) => { const d = new Date(ms + (B()?.tzMs ?? 5.5 * H)); const day = (d.getUTCDay() + 6) % 7; return new Date(d - day * D).toISOString().slice(0, 10); };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const ageOf = (s) => { s = String(s || ''); let m; if ((m = s.match(/(\d+)\s*min/))) return +m[1] * 60e3; if ((m = s.match(/(\d+)\s*(hr|hour)/))) return +m[1] * H; if ((m = s.match(/(\d+)\s*day/))) return +m[1] * D; if (/yesterday/i.test(s)) return 26 * H; return 3 * H; };
  const inr = (v) => B().money(v); // money in the brand's currency (₹ lakh/crore for Indian brands)
  const textOfCard = (c) => [c.title, c.sub, ...(c.rows || []).flat(), c.q, c.a].filter(Boolean).join(' ');
  const rupees = (s) => moneyParse(s); // the largest money amount in the text, any currency
  const fill = (s, t) => String(s).replace(/\{diwali\}/g, FEST() ? Math.max(0, Math.ceil((FEST() - now(t)) / D)) : '');
  const fillCard = (c, t) => B().fxDeep(JSON.parse(fill(JSON.stringify(c), t)));

  /* ---------- tenants ---------- */
  const newTenant = (url, snap = {}) => {
    const t = {
      id: uid('t'), host: BH(), name: SEED.brand.name, clock: 0,
      plan: snap.pro ? 'pro' : 'free', brandId: B().slug, createdAt: Date.now(), lastSeen: Date.now(),
      viewer: { role: 'founder', wants: ['decision', 'idea'], lane: firstLane(), ...(snap.viewer || {}) }, conn: { ...(snap.conn || {}) },
      cards: new Map(), feedback: [], runs: [], jams: [], versions: [], memory: [], qa: [], router: [], wlog: [], api: {},
      fewer: { ...(snap.fewer || {}) }, snoozed: {}, boost: {}, shown: {}, acted: new Set(), days: new Set(),
      storySeen: {}, storyExtra: { trends: [], ads: [], news: [] }, health: {}, deck: { hidden: [], colWidth: 480 },
      batches: B().kind === 'generated' ? [] : clone(SEED.batches).map((b) => ({ id: uid('b'), ...b })), watchers: {}, speed: 'demo',
      work: [], notes: [], decided: {}, onboarding: { startedAt: null, readyAt: null }, proAt: snap.pro ? Date.now() : null, used: new Set(),
      ...(demoSid() ? { demoSid: demoSid() } : {}) /* Demo Mode: the session this workspace belongs to (its background clock runs inside it) */
    };
    const t0 = now(t);
    SEED.posts.forEach((p) => t.cards.set(p.id, { ...clone(p), family: p.family || FAMILY[p.type] || 'idea', state: 'ready', origin: 'seed', createdAt: t0 - ageOf(p.time), expiresAt: null, history: [['ready', t0 - ageOf(p.time)]], shownCount: 0, ...(mvOf(B(), p.id) ? { mv: mvOf(B(), p.id) } : {}) }));
    WATCHERS.forEach((w) => (t.watchers[w.id] = { lastRun: null, nextRun: t0 + w.firstAt, runs: 0, made: 0, kept: 0, enabled: true }));
    // findings from the store read live in brand memory as facts with a source and a time
    SEED.scrape.forEach((f, i) => t.memory.push({ id: uid('m'), type: 'finding', kind: f.kind, fact: f.t, source: f.src, at: t0 - 60e3 + i * 1000 }));
    // replay what the client already did (after a server restart)
    (snap.hearts || []).forEach((id) => { if (t.cards.has(id)) t.feedback.push({ id: uid('f'), cardId: id, kind: 'heart', weight: 1, at: t0 }); });
    Object.keys(snap.dismissed || {}).forEach((id) => { const c = t.cards.get(id); if (c) c.state = 'dismissed'; });
    Object.entries(snap.done || {}).forEach(([id, label]) => { const c = t.cards.get(id); if (c) { c.state = 'done'; c.done = label; } });
    (snap.extra || []).forEach((e) => { if (e?.card?.id && !t.cards.has(e.card.id)) t.cards.set(e.card.id, { ...e.card, parentCardId: e.after || e.card.parentCardId || null, origin: e.card.origin || 'user', state: 'ready', createdAt: t0, history: [['ready', t0]], loading: false }); });
    tenants.set(t.id, t);
    return t;
  };
  const touch = (t) => { t.lastSeen = Date.now(); t.days.add(dayKey(now(t))); };
  /* the social stream (social-feed.js): idea and listening cards rotate. A workspace gets today's set; the ones that rotated
     out step back (expired, marked retired) unless this person acted on, liked or jammed them; one rotating back returns */
  const streamSync = (t, posts) => {
    const cur = (posts || []).filter((p) => p.stream), ids = new Set(cur.map((p) => p.id)), t0 = now(t);
    const kept = (id) => t.acted?.has?.(id) || (t.feedback || []).some((f) => f.cardId === id && f.kind === 'heart') || (t.work || []).some((w) => w.cardId === id);
    for (const p of cur) { const have = t.cards.get(p.id);
      if (!have) t.cards.set(p.id, { ...clone(p), family: p.family || FAMILY[p.type] || 'idea', state: 'ready', origin: p.origin || 'stream', createdAt: t0 - ageOf(p.time), expiresAt: null, history: [['ready', t0]], shownCount: 0 });
      else if (have.retired && have.state === 'expired') { delete have.retired; setState(t, have, 'ready'); } }
    for (const [id, c] of t.cards) if (c.stream && !ids.has(id) && ['ready', 'shown'].includes(c.state) && !kept(id)) { c.retired = true; setState(t, c, 'expired'); }
  };

  /* ---------- lifecycle housekeeping ---------- */
  const setState = (t, c, s) => { c.state = s; (c.history ||= []).push([s, now(t)]); };
  const housekeep = (t) => {
    const n = now(t), today = dayKey(n);
    t.cards.forEach((c) => { if (c.expiresAt && c.expiresAt < n && !['expired', 'dismissed', 'done', 'dropped', 'story'].includes(c.state)) setState(t, c, 'expired'); });
    Object.entries(t.snoozed).forEach(([id, d]) => { if (d !== today) { delete t.snoozed[id]; t.boost[id] = 8; } });
    const wk = weekKey(n); t.runs.forEach((r) => { if (r.week !== wk) r.counted = false; });
  };

  /* ---------- ranking ---------- */
  const BASE = () => B().config.baseMonthly || 0; // the brand's monthly revenue, when it is known 
  const impactOf = (c) => {
    const v = rupees(textOfCard(c));
    let s = v ? (BASE() ? Math.max(0, Math.min(5, 3 + Math.log10(v / BASE()) * 1.5)) : Math.max(0, Math.min(5, Math.log10(v) - 1))) : 0;
    let note = v ? (BASE() ? `${inr(v)} against ${inr(BASE())} a month in revenue` : `${inr(v)} at stake`) : 'No money number on the card';
    if (!v && /\d+%/.test(textOfCard(c))) { s = 1.5; note = 'A percentage, no rupee value'; }
    if (c.type === 'decision') { s += 1; note += ' · a decision'; }
    return { s: +s.toFixed(2), note, v: v || 0, pct: !v && /\d+%/.test(textOfCard(c)), decision: c.type === 'decision' };
  };
  const clusterOf = (c) => (c.images?.[0]?.includes('statics/') ? 'statics' : c.images ? 'photo' : c.kind);
  const affinityMap = (t) => {
    const a = { agent: {}, campaign: {}, format: {}, cluster: {} };
    const hearts = new Map(); t.feedback.forEach((f) => { if (f.kind === 'heart') hearts.set(f.cardId, 1); if (f.kind === 'unheart') hearts.delete(f.cardId); });
    a.no = {}; a.noSector = {}; t.feedback.forEach((f) => { if (f.kind !== 'not_interested') return; const c = t.cards.get(f.cardId); if (!c) return; a.no[c.agent] = (a.no[c.agent] || 0) + 1; a.noSector[c.sector] = (a.noSector[c.sector] || 0) + 1; });
    hearts.forEach((_, id) => { const c = t.cards.get(id); if (!c) return; a.agent[c.agent] = (a.agent[c.agent] || 0) + 1; if (c.campaign) a.campaign[c.campaign] = (a.campaign[c.campaign] || 0) + 1; a.format[c.kind] = (a.format[c.kind] || 0) + 1; a.cluster[clusterOf(c)] = (a.cluster[clusterOf(c)] || 0) + 1; });
    return { a, hearts };
  };
  const agentShown24h = (t, agent) => { const n = now(t); let k = 0; Object.entries(t.shown).forEach(([id, ts]) => { const c = t.cards.get(id); if (c?.agent === agent) k += ts.filter((x) => n - x < D).length; }); return k; };
  /* the ranker, v2 (2026-10-14): expected value first, then fit and learning; freshness decides between cards of similar value.
     value 0-10: value.js (a move's graded impact x confidence x urgency / effort; live exceptions high; research and listening
     middle). The old money-in-the-text impact only counts for a brand with a known monthly revenue and no grade.
     seat: role, lane and the types this person picked (x0.6). affinity: hearts lift the same agent, campaign, kind and look;
     "not for me" and "fewer" push them down. fatigue: a card shown again and again without being opened sinks */
  const STREAMY = (c) => !!(c.stream || c.liveOnly || c.live || c.research || c.liveSrc || c.family === 'exception');
  // the "rests on what the team told Brew" lift, per pack (not saved on the card): new learnings re-rank every card
  const toldMemo = new WeakMap();
  const toldOf = (c) => { const terms = B()?.learnedTerms; let m = toldMemo.get(terms || toldMemo); if (!m) { m = new Map(); toldMemo.set(terms || toldMemo, m); }
    if (!m.has(c.id)) m.set(c.id, cardUsesLearned(`${c.title || ''} ${c.sub || ''} ${(c.detail?.why || []).join(' ')} ${(c.detail?.how || []).join(' ')}`, terms) ? 5 : 0); return m.get(c.id); };
  // who may see that a card rests on what the team told Brew: the same people as the told list (server.js /told)
  const toldSeen = (t) => process.env.DEMO_MODE === '1' || !!t?.member || process.env.FEED_SIGNIN === '0';
  const score = (t, c, af) => {
    const v = t.viewer, R = SEED.roles[v.role] || SEED.roles.founder;
    const ageH = Math.max(0, (now(t) - c.createdAt) / H);
    const fresh = +(STREAMY(c) ? 3 * Math.exp(-ageH / 24) : 1 * Math.exp(-ageH / 72)).toFixed(2);
    const imp = impactOf(c), graded = moveNo(c.id) != null && B()?.moveValue?.[moveNo(c.id)];
    let val = cardValue(c, B()?.moveValue || {}, now(t)); if (!graded && BASE()) val = Math.max(val, imp.s * 2);
    const g = graded ? B().moveValue[moveNo(c.id)] : null;
    const valNote = g ? `Impact ${g.impact}/5, confidence ${Math.round(g.confidence * 100)}%, effort ${['', 'hours', 'days', 'weeks', 'a month+'][g.effort]}${g.by ? `, by ${g.by}` : ''}${g.now ? ', doable now' : ''}` : imp.note;
    const aff = (af.agent[c.agent] || 0) * 1.5 + (c.campaign ? (af.campaign[c.campaign] || 0) * 1.5 : 0) + (af.format[c.kind] || 0) + (af.cluster[clusterOf(c)] || 0) - (af.no?.[c.agent] || 0) * 0.75 - (af.noSector?.[c.sector] || 0) * 0.5;
    const said = (v.focusTerms || []).length ? Math.min(2, (v.focusTerms || []).filter((w) => `${c.title || ''} ${c.sub || ''} ${c.campaign || ''} ${c.src || ''}`.toLowerCase().includes(w)).length) * 3 : 0; /* what they said should come first, in their words */
    const seat = said + 0.6 * ((R.sector[c.sector] || 0) * 3 + (R.type[c.type] || 0) * 2 + (v.wants.includes(c.type) ? 5 : 0) + (c.lane === v.lane ? 6 : 0) + ((c.roles || []).includes(v.role) ? 4 : 0) + (c.boostFor?.[v.role] || 0)) / 2.5;
    const seen = (t.shown[c.id] || []).length;
    const fatigue = -Math.min(4, agentShown24h(t, c.agent) * 0.08) - (!t.acted.has(c.id) ? Math.min(4, Math.max(0, seen - 2) * 1.2) : 0);
    const fb = -2 * (t.fewer[c.agent] || 0);
    // what the team told Brew comes first: cards of a move that rests on it, or that quote it themselves
    const told = toldOf(c) || (B()?.learnedMoves?.has(moveNo(c.id)) ? 2 : 0);
    const extra = told + (t.boost[c.id] || 0) + (c.onlyWhen && connOn(t, c.onlyWhen) ? 3 : 0) + (c.live && Object.keys(c.live).some((k) => connOn(t, k)) ? 2 : 0) + (c.liveOnly ? 2 : 0);
    const behind = B()?.staleMoves?.has(moveNo(c.id)) ? -8 : 0; /* its move is being rewritten: off the first screen until the new card lands */
    const total = val + seat + aff + fresh + fatigue + fb + extra + behind;
    return { fresh, told, value: val, impact: +val.toFixed(2), impactNote: valNote, impactV: imp.v, impactPct: imp.pct, isDecision: imp.decision, affinity: +aff.toFixed(2), seat: +seat.toFixed(2), fatigue: +fatigue.toFixed(2), feedback: fb, boost: extra, total: +total.toFixed(2), seen };
  };
  const connOn = (t, k) => !!(t.conn?.[k] || t.liveConn?.[k]);
  // live cards are the team's only; a real account hides its demo cards; a move rewritten privately replaces its shared cards
  const moveOfId = (id) => +((/^m(\d\d)-/.exec(id) || [])[1] ?? -1);
  /* views: a member limited to some seats sees only cards meant for one of them; cards with no roles are everyone's */
  const seatOk = (t, c) => { const S = t.seats; return !S || !c.roles?.length || c.roles.some((r) => S.includes(r)); };
  /* a limited member can only view as one of their seats */
  const clampSeat = (t) => { const S = t?.seats; if (S && t.viewer && !S.includes(t.viewer.role) && S.length) t.viewer = { ...t.viewer, role: S[0] }; };
  // a price card saved before the paise fix whose every row is "₹1,850 → ₹1,850" says nothing changed: never shown
  const noChange = (c) => c.liveSrc?.kind === 'catalog' && c.badge?.[0] === 'Price changed' && c.rows?.length && c.rows.every((r) => { const m = /^(.+) → (.+)$/.exec(r?.[1] || ''); return m && m[1] === m[2]; });
  const visible = (t, c) => seatOk(t, c) && !noChange(c) && !(c.origin === 'watcher' && c.type === 'idea' && !titlePricesMatch(c)) && ['ready', 'shown', 'approved', 'done'].includes(c.state) && !t.snoozed[c.id] && (!c.onlyWhen || connOn(t, c.onlyWhen))
    && !(c.liveOnly && !t.member) && !(c.demo && (t.member || t.liveConn?.[c.onlyWhen])) && !(!c.liveOnly && t.privMoves?.includes(moveOfId(c.id)));
  // bring a workspace in line with what this viewer may see: add the live cards, drop the ones they may not have
  const applyLive = async (t, viewer) => {
    if (!t) return; t.member = !!viewer?.member; t.claimed = !!viewer?.claimed; t.memberEmail = viewer?.member && viewer?.email ? viewer.email : null; /* a signed-out or non-member viewer no longer carries the last member's name or personal memory */
    const L = await liveFor(t.brandId || DEFAULT_BRAND, t.member).catch(() => ({ cards: [], on: {}, privMoves: [] }));
    t.liveConn = L.on; t.privMoves = L.privMoves || []; t.liveLedger = L.ledger || {};
    const ids = new Set(L.cards.map((c) => c.id)), t0 = now(t);
    for (const [id, c] of t.cards) if ((c.liveOnly || c.publicLive) && !ids.has(id)) t.cards.delete(id);
    for (const p of L.cards) { const have = t.cards.get(p.id);
      if (!have) t.cards.set(p.id, { ...clone(p), family: p.family || FAMILY[p.type] || 'idea', state: 'ready', origin: 'live', createdAt: t0, expiresAt: null, history: [['ready', t0]], shownCount: 0 });
      else if (have.title !== p.title || JSON.stringify(have.rows) !== JSON.stringify(p.rows)) Object.assign(have, { title: p.title, sub: p.sub, rows: clone(p.rows), badge: p.badge, detail: clone(p.detail) }); }
  };
  /* cards that read as the same thing: one move's cards; one live check's readings (catalog ones collapse to the newest); one
     template of live card (AI-answer gaps); research from one rival, or one more trend or how-to */
  const groupOf = (c) => { const n = moveNo(c.id); if (n != null) return `m${n}`; const ls = c.liveSrc;
    if (ls?.id && ls.kind === 'catalog') return `live:catalog:${String(ls.id).replace(/-q?-?[0-9a-f]{8,}$/, '').replace(/-q$/, '')}`;
    if (ls?.id) return `tpl:${ls.kind}:${String(ls.id).replace(/-\d{4}-\d\d-\d\d$/, '').replace(/-q\d+$/, '').replace(/-[0-9a-f]{8,}$/, '')}`;
    if (c.research?.kind === 'ad') return `ad:${String(c.title || '').split(':')[0].toLowerCase()}`;
    if (c.research?.kind) return `res:${c.research.kind}`; return null; };
  /* cards that say the same thing twice: only the newest stays at all */
  const dupOf = (c) => {
    // two stories written from one rising-searches list show the same widget: one card is enough
    if (c.research?.kind === 'trend' && c.rows?.length) return `one:trend:${JSON.stringify(c.rows)}`;
    // the scheduled Creative agent pitching the brand's festival again: only its newest idea stays
    const fest = FESTN(); if (c.origin === 'watcher' && c.type === 'idea' && fest && fest !== 'the next sale' && new RegExp(`\\b${fest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(c.title || '')) return `one:fest`;
    return null; };
  const rank = (t) => {
    housekeep(t);
    const { a } = affinityMap(t);
    const all = [...t.cards.values()];
    const top = all.filter((c) => visible(t, c) && !c.parentCardId && c.origin === 'user').sort((x, y) => y.createdAt - x.createdAt);
    const pool = all.filter((c) => visible(t, c) && !c.parentCardId && c.origin !== 'user' && c.origin !== 'signal');
    const scores = {}; pool.forEach((c) => (scores[c.id] = score(t, c, a)));
    const sorted0 = pool.sort((x, y) => scores[y.id].total - scores[x.id].total);
    /* one card per group in the first screen: a move's other cards, a live check's older readings and a second ad from the same
       rival wait until position 12, unless the first was already acted on. A live check that read the same thing again (stock-outs,
       price drift) keeps only its newest reading at all: the older ones are the same news */
    const newestLive = new Map(); for (const c of sorted0) { const d = dupOf(c); if (d) { const h = newestLive.get(d); if (!h || c.createdAt > h.createdAt) newestLive.set(d, c); } const g = groupOf(c); if (g?.startsWith('live:')) { const h = newestLive.get(g); const q = (x) => /-q-/.test(x.liveSrc.id); /* the reading about products our cards sell beats the store-wide one */ if (!h || q(c) > q(h) || (q(c) === q(h) && c.createdAt > h.createdAt)) newestLive.set(g, c); } }
    const sorted = []; const later = []; const firstOf = new Map();
    for (const c of sorted0) { const d = dupOf(c); if (d && newestLive.get(d) !== c) continue; const g = groupOf(c); if (g == null) { sorted.push(c); continue; } if (g.startsWith('live:') && newestLive.get(g) !== c) continue; const f = firstOf.get(g);
      if (!f) { firstOf.set(g, c); sorted.push(c); } else if (t.acted.has(f.id)) sorted.push(c); else later.push(c); }
    for (const c of later) sorted.splice(Math.max(12, sorted.findIndex((x) => scores[x.id].total < scores[c.id].total) >>> 0), 0, c);
    // interleave: no two of a kind together, no agent twice in a row
    const out = []; const rest = [...sorted];
    while (rest.length) {
      const prev = out[out.length - 1];
      let k = rest.findIndex((c) => !prev || (c.agent !== prev.agent && c.kind !== prev.kind));
      if (k < 0 || k > 10) k = rest.findIndex((c) => !prev || c.agent !== prev.agent);
      if (k < 0 || k > 10) k = 0;
      out.push(rest[k]); rest.splice(k, 1);
    }
    return { top, ranked: out, scores };
  };
  const withChildren = (t, list) => { const res = []; list.forEach((c) => { res.push(c); [...t.cards.values()].filter((x) => x.parentCardId === c.id && visible(t, x)).sort((x, y) => y.createdAt - x.createdAt).forEach((x) => res.push(x)); }); return res; };
  const feed = (t) => {
    const { top, ranked: all, scores } = rank(t);
    // cards the viewer pulled in from the "new cards" pill sit on top for 30 minutes
    const pins = (t.pinned || []).filter((x) => now(t) - x.at < 30 * 60e3).map((x) => all.find((c) => c.id === x.id)).filter(Boolean);
    /* a feed you look at, not a list you read: two visual cards for every text card, each kind kept in its rank order */
    const isVis = (c) => !!(c?.images?.length || c?.img || c?.video || ['media', 'chat', 'answer', 'variants'].includes(c?.kind));
    const ranked0 = all.filter((c) => !pins.includes(c)), V = ranked0.filter(isVis), N = ranked0.filter((c) => !isVis(c)), ranked = [];
    /* the 2:1 picture/text rhythm, but it never lifts a clearly weaker card over a stronger one (more than 2 points apart) */
    const tot = (c) => scores[c.id]?.total ?? 0;
    for (let i = 0; V.length || N.length; i++) { let L = (i % 3 === 2 && N.length) || !V.length ? N : V; const O = L === V ? N : V; if (O.length && L.length && tot(O[0]) - tot(L[0]) > 2) L = O; ranked.push(L.shift()); }
    let seated = new Set();
    /* the social stream (ready posts, what people asked) always has a seat in the first screen: its best two at 3 and 7 */
    { const isSoc = (c) => /^(Ideas|Heard) ·/.test(c?.src || ''); const off = top.length + pins.length; /* seats 3 and 7 count from the top of what the reader sees, pins and top cards included */ const soc = [[ranked.find((c) => isSoc(c) && !isVis(c)), Math.max(0, 2 - off)], [ranked.find((c) => isSoc(c) && isVis(c)), Math.max(1, 6 - off)]].filter((x) => x[0]);
      seated = new Set(soc.map((x) => x[0])); soc.forEach(([c, at]) => { const i = ranked.indexOf(c); if (i > at && at < ranked.length) [ranked[at], ranked[i]] = [ranked[i], ranked[at]]; }); } /* a swap with the card in that seat (same picture/text slot), so the 2:1 rhythm holds */
    /* an ad or a social post to make always has two seats in the first screen: the best two at 2 and 6. Moves mostly plan
       page, email and WhatsApp work, and the ranker leans to decisions, so before this the first ad card sat at 9 to 15 */
    /* the seats are for what the brand can make: a rival's ad is a reading, not a make card; the two come from different
       groups (never two cards of one move or one rival), and a finished static ad, the strongest picture asset, takes one */
    { const isMake = (c) => !seated.has(c) && c?.research?.kind !== 'ad' && (/carousel|collection|catalog|instagram|reel|video|image ad/.test(c?.make?.format || '') || /^(static-|statics-batch$)/.test(c?.id || ''));
      const off = top.length + pins.length, at = [1, 5].map((s) => Math.max(0, s - off));
      const picks = []; for (const c of ranked.filter(isMake)) { if (picks.length >= 2) break; const g = groupOf(c); if (!g || !picks.some((x) => groupOf(x) === g)) picks.push(c); }
      const isStatic = (c) => /^static-/.test(c?.id || ''), st = ranked.find((c) => isMake(c) && isStatic(c));
      if (st && !picks.some(isStatic)) picks.splice(Math.min(1, picks.length), 1, st);
      picks.forEach((c, k) => { const i = ranked.indexOf(c); if (i > at[k] && at[k] < ranked.length && !seated.has(ranked[at[k]])) [ranked[at[k]], ranked[i]] = [ranked[i], ranked[at[k]]]; seated.add(c); }); }
    /* no two cards of the same sort in a row (two AI-answer cards back to back reads as a repeat). Runs last, after the
       social seats, and swaps with the next different card of the same visual class (up to 10 ahead), so the
       picture/text rhythm and the seated social cards both stay where they are */
    { /* what reads as a repeat: the same template from the same source (two cards of one move, two AI answers, two heard themes) */
      const sortOf = (c) => `${c.kind}:${String(c.src || c.sector || c.agent || '').split('·')[0].trim()}`; const lead = [...top, ...pins].at(-1), prev = (i) => i === 0 ? lead : ranked[i - 1]; for (let i = lead ? 0 : 1; i < ranked.length; i++) { if (!prev(i) || sortOf(ranked[i]) !== sortOf(prev(i)) || seated.has(ranked[i])) continue;
      const j = ranked.findIndex((c, k) => k > i && k <= i + 10 && !seated.has(c) && sortOf(c) !== sortOf(prev(i)) && (k + 1 >= ranked.length || sortOf(c) !== sortOf(ranked[i + 1])) && isVis(c) === isVis(ranked[i]));
      if (j > 0) [ranked[i], ranked[j]] = [ranked[j], ranked[i]]; } }
    /* last: the first screen (12) holds one card per group (groupOf); a repeat of a group whose first card was not acted on
       moves to position 12. Runs after the layout swaps so they can't pull a repeat back up */
    { const head = [], defer = [], rest = [], seen = new Map(); /* one linear pass: the first 12 take one card per group, repeats follow them */
      for (const c of ranked) { if (head.length >= 12) { rest.push(c); continue; } const g = groupOf(c), f = g && seen.get(g);
        if (f && !t.acted.has(f.id) && !seated.has(c)) defer.push(c); else { if (g && !f) seen.set(g, c); head.push(c); } }
      ranked.splice(0, ranked.length, ...head, ...defer, ...rest); }
    const shownList = ranked; /* no daily cap: every card is shown (the Pro plan is a Dummy) */
    const order = withChildren(t, [...top, ...pins, ...shownList]).map((c) => c.id);
    return { order, scores, pinned: pins.map((c) => c.id), limit: { plan: t.plan, daily: null, locked: 0 } };
  };
  const measureOf = (t, c) => { const m = { ...(MEASURE[c?.sector] || MEASURE.creatives), ...(c?.measure || {}) };
    // AI answers: today's number is the latest real run, not a sample
    const vr = live?.get()?.visibility?.runs?.[0]; if (c?.sector === 'visibility' && vr && !c?.measure) Object.assign(m, { unit: ` of ${vr.total}`, baseline: vr.named, target: Math.min(vr.total, vr.named + 4), window: 28, attribution: `The same questions, asked the same way every week from ${CTRY()}. A change in who gets named is the result.` }); m.connected = !m.from || !!t?.conn[m.from]; m.fromName = m.from ? (SEED.connectors[m.from]?.name || m.from) : null; return m; };
  const pub = (c, t) => { const { history, ...rest } = c; if (!rest.note && B()?.notes?.[c.id]) rest.note = B().notes[c.id]; /* margin notes written after the card landed (notes.js) */ if (LEAK.test(`${rest.title} ${rest.sub}`)) { rest.title = scrubLeak(rest.title); rest.sub = scrubLeak(rest.sub); } const dv = draftView(draftFor(c, B()?.firstDrafts), c); if (dv) rest.draft = dv; /* the first draft Brew made for this card (drafts-bg.js), shown on the feed card */ const pl = planOfCard(c); if (pl) rest.plan = pl; /* its plan: what the jam opens on */ if (toldOf(c) && toldSeen(t)) rest.told = true; /* the card itself rests on what the team told Brew: the feed labels it (team only, like the told list) */ return { ...rest, history: (history || []).slice(-6), measure: measureOf(t, c), decided: t?.decided?.[c.id] || null }; };
  const allCards = (t) => { const o = {}; t.cards.forEach((c, id) => { if (!['dropped'].includes(c.state) && seatOk(t, c)) o[id] = pub(c, t); }); return o; };

  /* ---------- QA agent ---------- */
  // research cards may also quote the numbers in their own source record (an ad's copy, a trend's measured change)
  const researchOK = (c) => {
    // only the source data counts (the rival's own copy, measured trends), never the agent's own words
    const r = research?.get() || {}; const ok = new Set(FACT_OK); const add = (x) => numbersIn(typeof x === 'string' ? x : JSON.stringify(x)).forEach((n) => ok.add(n));
    const pct = (s) => s?.change != null && add(`${Math.abs(s.change)}% ${s.change}%`);
    const adSrc = (a) => a && add([a.headline, a.body, a.hook].join(' '));
    if (c.research.kind === 'ad') adSrc(r.ads?.items.find((a) => a.id === c.research.id));
    if (c.research.kind === 'trend') { const x = r.trends?.items.find((y) => y.id === c.research.id); (x?.terms || []).forEach((t) => pct(r.trends.series[t])); add(x?.rising || []); }
    if (c.research.kind === 'howto') { (r.ads?.items || []).forEach(adSrc); Object.values(r.trends?.series || {}).forEach(pct); add(r.trends?.rising || {}); }
    return ok;
  };
  // design notes (fonts, type, hex colours) are for the team, never for a card a client reads
  const LEAK = /\b(?:Geist(?: Mono)?|typeface|font|kerning|letter-?spacing|#[0-9a-f]{6})\b/i;
  const scrubLeak = (s) => { s = String(s || ''); if (!LEAK.test(s)) return s;
    // "the stat set in Geist Mono" → "the stat": drop just the styling phrase, keep the point
    s = s.replace(/\s+(?:set|written|typed|shown)\s+in\s+(?:Geist(?: Mono)?|[A-Z]\w+ (?:Mono|Sans|Serif))\b/g, '');
    // anything still naming a font or a hex colour: drop that sentence
    return s.replace(/[^.]*\b(?:Geist(?: Mono)?|typeface|font|kerning|letter-?spacing|#[0-9a-f]{6})\b[^.]*\.\s*/gi, '').replace(/\s{2,}/g, ' ').trim(); };
  /* a member's numbers are checked against the merged sheet: the public facts plus their connected accounts (t.liveLedger, never demo) */
  const factOkFor = (t) => { const xs = t?.member ? realRows(t.liveLedger).filter((e) => e.v != null) : []; if (!xs.length) return FACT_OK; const ok = new Set(FACT_OK); xs.forEach((e) => numbersIn(String(e.v), { strict: true }).forEach((n) => ok.add(n))); return ok; };
  // an idea's title quotes a price its text doesn't ("the ₹399 + ₹399 pair" over "₹399 shampoo with the ₹642.32 serum"): the AI mixed two items up
  const titlePricesMatch = (c) => { const money = (x) => numbersIn(x, { strict: true }).filter((n) => /^[^\d]+\d/.test(n)); const have = money([c.sub, ...(c.detail?.why || [])].join(' '));
    return money(c.title).every((n) => { const i = have.indexOf(n); if (i < 0) return false; have.splice(i, 1); return true; }); };
  const qaCheck = (c, t = null) => {
    const main = [c.title, c.sub, ...(c.rows || []).flat()].join(' ');
    const all = textOfCard(c) + ' ' + (c.detail?.why || []).join(' ');
    const claim = all.match(/[^.]*\b\d[\d,]*%?\s+(?:new|more|fewer|less)\s+[a-z]+\s+in\s+\d+\s*(?:days|weeks)[^.]*/i); // a counted result claim ("30% fewer breakouts in 28 days") keeps "up to" and its window
    return [
      { k: 'Names a number', ok: /\d/.test(main) },
      // a rival ad is quoted as it runs; the banned words apply to what the brand would say
      // a rival ad is quoted as it runs, and a shopper's question is quoted as they asked it: the banned words apply to
      // what the brand would say ("which serum works for hair regrowth?" is the shopper's word, not a claim)
      { k: 'No banned words', ok: !BANNED.test(c.research?.kind === 'ad' ? [c.title, ...(c.detail?.how || [])].join(' ') : c.q ? all.split(c.q).join(' ').replace(/“[^”]*(”|$)/g, ' ') : all) },
      { k: 'Claims keep “up to” and the window', ok: !claim || (/up to/i.test(claim[0]) && /\d+\s*days/i.test(claim[0])) },
      { k: 'No rival named in ad copy', ok: !(c.type === 'idea' && RIVALS.test(c.title + ' ' + c.sub)) },
      { k: 'Short title, point first', ok: String(c.title || '').length <= 76 },
      { k: 'Title prices match the text', ok: c.type !== 'idea' || titlePricesMatch(c) },
      { k: 'No internal design notes', ok: !LEAK.test(`${c.title} ${c.sub}`) },
      { k: 'Every ₹ and % is in the fact sheet', ok: !unbacked({ title: c.title, sub: c.sub, rows: c.rows, detail: c.detail }, c.research ? researchOK(c) : c.liveNums ? new Set([...factOkFor(t), ...c.liveNums.flatMap((x) => numbersIn(x))]) : factOkFor(t)).length }
    ];
  };
  const mechanicalFix = (c) => {
    const f = (s) => String(s || '').replace(/\bregrow\w*/gi, 'grow').replace(/\bcure[sd]?\b/gi, 'help').replace(/\bmiracle\w*/gi, 'result').replace(/100%/g, 'every').replace(RIVALS, 'other brands').replace(/(^|[^p] )(\d[\d,]*%?\s+(?:new|more|fewer|less)\s+[a-z]+\s+in\s+\d+\s*(?:days|weeks))/i, '$1up to $2'); // a counted result claim gets "up to", for any brand
    let title = f(c.title); if (title.length > 72) title = title.slice(0, 70).replace(/\s+\S*$/, '') + '…';
    return { ...c, title: scrubLeak(title), sub: scrubLeak(f(c.sub)) };
  };
  // proposed → qa → ready, or re-run (max 2) → dropped, or no number → story slide
  const pipeline = (t, proposal, w) => {
    let c = { ...proposal, family: proposal.family || FAMILY[proposal.type] || 'idea', origin: proposal.origin || 'watcher', watcher: w?.id || null, createdAt: now(t), time: 'Just now', src: proposal.src || `${w ? w.name + ' watcher' : 'Agent'} · ${new Date(now(t)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, history: [], shownCount: 0 };
    if (proposal.ttlDays) c.expiresAt = now(t) + proposal.ttlDays * D; else if (c.origin === 'watcher') c.expiresAt = now(t) + 3 * D;
    setState(t, c, 'proposed'); setState(t, c, 'qa');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const checks = qaCheck(c); const failed = checks.filter((x) => !x.ok);
      const entry = { id: uid('qa'), cardId: c.id, title: c.title, by: w?.name || 'Agent', attempt, checks, at: now(t) };
      if (!failed.length) { entry.result = 'pass'; t.qa.unshift(entry); setState(t, c, 'ready'); t.cards.set(c.id, c); return c; }
      if (failed.length === 1 && failed[0].k === 'Names a number') {
        entry.result = 'story'; t.qa.unshift(entry); setState(t, c, 'story'); t.cards.set(c.id, c);
        t.storyExtra[c.story?.ring || 'trends'].push({ c: SEED.brand.wash[attempt % 3], h: c.title, p: c.sub, from: w?.name, at: now(t) });
        return c;
      }
      if (attempt === 3) { entry.result = 'dropped'; t.qa.unshift(entry); setState(t, c, 'dropped'); t.cards.set(c.id, c); return c; }
      entry.result = 'rerun'; t.qa.unshift(entry);
      c = c.qaFix && attempt === 1 ? { ...c, ...c.qaFix } : mechanicalFix(c);
    }
  };

  /* ---------- watchers ---------- */
  const wlog = (t, w, note, made = []) => t.wlog.unshift({ id: uid('w'), watcher: w.id, name: w.name, note, made: made.map((c) => ({ id: c.id, title: c.title, state: c.state })), at: now(t) });
  const fromPool = (t, wid, n = 1) => {
    const used = t.used; const out = [];
    for (const p of POOLS[wid] || []) { if (out.length >= n) break; if (used.has(p.id)) continue; if (p.onlyWhen && !connOn(t, p.onlyWhen)) continue; used.add(p.id); out.push(fillCard(p, t)); }
    return out;
  };
  /* ---------- real work in progress (generated brands): no simulated progress, only what is happening ---------- */
  const STAGE_PCT = { drafting: 20, team: 45, brew: 55, needs_you: 70, ready: 85, deploying: 90, measuring: 95, result: 100 };
  const STAGE_TXT = { drafting: 'Drafting', team: 'With your team', brew: 'With the ShopOS team', needs_you: 'Needs your OK', ready: 'Ready to share', deploying: 'Brief shared', out: 'Brief shared', measuring: 'Brief shared', result: 'Brief shared' }; // Brew never ships or measures: old stages read as shared
  const realBatches = (t) => {
    const st = builder?.peek?.(B().slug) || {}, out = [];
    const done = st.movesDone || 0, N = +st.total || 50; /* the playbook (not the index, not weekly moves); PDFs are made on download */
    out.push({ id: 'b-moves', t: `Your moves`, s: done >= N ? `All ${N} written` : `${done} of ${N} written`, pct: Math.round(100 * Math.min(done, N) / N), st: done >= N ? 'Done' : 'Running', tone: done >= N ? 'ok' : 'info', agent: 'brew', team: true, real: true });
    if (st.statics) out.push({ id: 'b-statics', t: 'Static ads from Move 21', s: st.statics.state === 'done' ? `${st.statics.n} ads ready for your review` : st.statics.state === 'failed' ? 'Could not be made: ' + (st.statics.err || 'image model error') : 'Making the images from your product photos', pct: st.statics.state === 'done' ? 100 : 40, st: st.statics.state === 'done' ? 'Needs you' : st.statics.state === 'failed' ? 'Stopped' : 'Running', tone: st.statics.state === 'done' ? 'warn' : 'info', agent: 'creative', real: true });
    for (const w of t.work.filter((x) => !x.archived && !x.discarded).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6))
      out.push({ id: 'b-' + w.id, t: cutWords(w.title || 'Work', 48), s: `${STAGE_TXT[w.stage] || w.stage}${w.with?.name ? ' · ' + w.with.name : ''}${w.ticket ? ' · ' + w.ticket : ''}`, pct: STAGE_PCT[w.stage] || 30, st: w.stage === 'needs_you' ? 'Needs you' : w.stage === 'result' ? 'Done' : 'Running', tone: w.stage === 'needs_you' ? 'warn' : w.stage === 'result' ? 'ok' : 'info', agent: w.agent, team: w.with?.kind === 'brew', workId: w.id, real: true });
    return out;
  };
  const syncBatches = (t) => { if (B().kind !== 'generated') return; if (!builder?.peek?.(B().slug)) builder?.status?.(B().slug).catch(() => {}); t.batches = realBatches(t); };
  // the brand's own live ads (research.js "own"), read from the public Ad Library
  const fromOwnAds = (t, n = 2) => {
    const o = research?.get()?.own, out = [], at = o ? new Date(o.fetchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    for (const e of o?.events || []) {
      if (out.length >= n) break; const id = 'ow-' + e.id; if (t.used.has(id) || t.cards.has(id)) continue; t.used.add(id);
      const base = { id, agent: 'performance', sector: 'creatives', lane: Object.keys(SEED.lanes)[0], roles: ['brand', 'growth', 'founder'], src: `Meta Ad Library · ${CTRY()} · ${at}`, link: { label: 'See it in the Ad Library', url: e.items?.[0]?.url || 'https://www.facebook.com/ads/library/' } };
      const nums = (e.items || []).flatMap((x) => [String(x.days), String(x.versions)]).concat([String(e.n || ''), String(e.was || ''), String(e.now || ''), String(o.live)]);
      if (e.kind === 'long') out.push({ ...base, type: 'decision', kind: (e.items || []).some((x) => x.poster) ? 'media' : 'rows', images: (e.items || []).filter((x) => x.poster).slice(0, 1).map((x) => x.poster), badge: ['Running long', 'warn'], liveNums: nums,
        title: `${e.n} of your live ads have run 60 days or more`, sub: `The oldest has run ${e.items[0].days} days in ${e.items[0].versions} version${e.items[0].versions === 1 ? '' : 's'}. We make fresh versions of the ones still worth keeping, so the winners don't tire.`,
        rows: e.items.slice(0, 4).map((x) => [String(x.hook || 'Untitled ad').slice(0, 38), `${x.days} days`]), detail: { why: ['Read from your live ads in the public Meta Ad Library.', 'Spend and results need your Meta account connected.'], how: ['We draft fresh versions of the long runners.', 'You pick which go live.', 'The old ones pause when the new ones start.'] }, cta: { label: 'Rotate creative' } });
      if (e.kind === 'new') out.push({ ...base, type: 'report', family: 'result', kind: 'rows', badge: ['New live', 'info'], liveNums: nums,
        title: `${e.n} new ad${e.n === 1 ? '' : 's'} went live since the last read`, sub: `We now count ${o.live} live ads for ${BN()} in the Meta Ad Library. The new ones are below, so the team can see what is being tested.`,
        rows: e.items.slice(0, 4).map((x) => [String(x.hook || 'Untitled ad').slice(0, 38), x.video ? 'Video' : 'Image']), detail: { why: ['Read from the public Meta Ad Library today.'], how: ['Connect Meta to see what each one costs and returns.'] }, cta: { label: 'Generate versions' } });
      if (e.kind === 'count') out.push({ ...base, type: 'report', family: 'result', kind: 'rows', badge: ['Live ads', e.now > e.was ? 'ok' : 'warn'], liveNums: nums,
        title: `Live ads went from ${e.was} to ${e.now}`, sub: `The count of ${BN()} ads running in the Meta Ad Library changed since the last read. A big drop can mean a paused account or a budget cut.`, rows: [['Before', String(e.was)], ['Now', String(e.now)]], detail: { why: ['Counted in the public Meta Ad Library.'], how: ['Check the account if the drop was not planned.'] }, cta: { label: 'Open report' } });
      if (e.kind === 'none') out.push({ ...base, type: 'decision', kind: 'rows', badge: ['No live ads', 'warn'], liveNums: [], title: `No live ${BN()} ads found in the Meta Ad Library`, sub: `We searched the Ad Library for ${CTRY()} and found no ads running for ${BN()} today. Your feed's ad cards start from your moves instead.`, rows: [['Live ads', 'None found']], detail: { why: ['Searched by brand name in the public Ad Library.'], how: ['If you run ads under another page name, tell us and we will track that page.'] }, cta: { label: 'Make our version' } });
    }
    return out;
  };
  const tickBatches = (t) => {
    if (B().kind === 'generated') { syncBatches(t); return []; } // real work moves by itself
    const done = [];
    t.batches.forEach((b) => {
      if (!(b.st === 'Running' || b.st === 'Needs team')) return;
      b.pct = Math.min(100, b.pct + (b.team ? 23 : 9 + Math.round(Math.random() * 6)));
      if (b.pct >= 100) {
        b.st = b.team ? 'Needs you' : 'Done'; b.tone = b.team ? 'warn' : 'ok';
        t.storyExtra.news.push({ c: SEED.brand.wash[1], h: b.team ? `${b.ticket}: first draft is ready` : `${b.t} is done`, p: b.s, at: now(t) });
        if (b.team) { const j = t.jams.find((x) => x.ticket === b.ticket); if (j) { j.messages.push({ from: 'team', agent: 'Creative director', body: 'First draft is ready. It’s attached here and on WhatsApp if you moved the thread.', at: now(t) }); j.status = 'Waiting on you'; j.updatedAt = now(t); } }
        done.push(b);
      }
    });
    return done;
  };
  const creativeIdea = async (t) => {
    /* three a day per brand, however many teammates have the feed open (it was per workspace: five teammates, five times the calls) */
    const today = dayKey(now(t)), bk = `${t.brandId || 'brew'}|${today}`; const cd = (creativeByBrand.get(bk) || { day: today, n: 0 }); creativeByBrand.set(bk, cd); if (creativeByBrand.size > 500) creativeByBrand.clear(); t.creativeDay = cd;
    const live = !isMock() && cd.n < 3 && spend('text');
    if (!live) return { cards: fromPool(t, 'creative'), how: isMock() ? 'from the mock pool (AI is on mock)' : 'from the pool (daily AI budget used)' };
    t.creativeDay.n++;
    const { hearts } = affinityMap(t);
    const hearted = [...hearts.keys()].map((id) => t.cards.get(id)?.title).filter(Boolean).slice(0, 5);
    // the newest first: its own recent ideas are the ones it would repeat
    const titles = [...t.cards.values()].filter((c) => c.sector === 'creatives' || c.type === 'idea').sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)).map((c) => c.title).slice(0, 40);
    const mem = t.memory.slice(0, 12).map((m) => `- ${m.fact} (${m.source})`).join('\n');
    try {
      const j = await claudeJSON(`You are the Creative director agent, running on a schedule. Propose ONE new ad idea card for ${BN()}'s feed.\nBrand memory:\n${mem}\nThe person hearted: ${hearted.join(' | ') || 'nothing yet'}\nCalendar: ${FESTN()} is ${FESTD()}${FEST() ? ` (${Math.ceil((FEST() - now(t)) / D)} days away)` : ''}.\nAlready in the feed, do not repeat: ${titles.join(' | ')}\nIf an idea about ${FESTN()} is already there, pick a different angle. Every price in the title must appear in the sub, for the same product.\nUse only facts from the claims list, and only these numbers:\n${Object.values(FACTS).filter((f) => f.kind !== 'demo' && f.label).map((f) => `- ${f.label}: ${f.v}`).join('\n')}\nPlain, simple words.\nJSON: {"title":"under 60 chars, point first, one number","sub":"two sentences, 25 to 35 words: what we saw with the number, then the move and what it gets ${BN()}; no fonts, design notes or file names","why":["3 bullets, each under 14 words"],"how":["3 steps, each under 12 words"],"image":"one of: ${STATICS.join(', ')}","lane":"${laneIds().join('|') || 'core'}","scene":"one sentence describing a new product photo for this idea"}`, 1200);
      const lane = laneIds().includes(j.lane) ? j.lane : firstLane();
      const stImg = (id) => `b/${B().slug}/statics/${id}.jpg`;
      const ref = refPhoto(lane);
      let img = STATICS.length ? stImg(STATICS.includes(j.image) ? j.image : STATICS[0]) : ref, imgNote = STATICS.length ? 'picked from your statics' : 'your product photo'; /* the brand's own product photo; with none, no picture is made (never the wrong product) */
      if (ref && spend('image')) {
        try {
          const buf = await geminiImage({ srcFile: photoFile(ref), prompt: `Create a new product photograph: ${j.scene || 'the product on a clean surface, soft daylight'}. ${`Keep the ${BN()} ${B().config.product?.noun || 'product'} and its label exactly as in the reference`}. ${B().config.product?.avoid || 'No text, no before/after.'} ${(B().config.product?.style || 'Premium D2C product ad photography') + '.'}`, ratio: '4:5', model: process.env.WATCHER_IMAGE_MODEL || 'gemini-2.5-flash-image' });
          const key = crypto.createHash('sha1').update(j.title + j.scene).digest('hex').slice(0, 16);
          saveGen(key + '.png', buf); img = `gen/${key}.png`; imgNote = 'generated with the cheap image model';
        } catch (e) { log.warn('[creative watcher] image', e.message); }
      }
      return { cards: [{ id: uid('w-c'), agent: 'creative', sector: 'creatives', type: 'idea', lane, roles: ['brand', 'growth', 'founder'], kind: 'media', images: [img], campaign: 'New from your agents', title: clean(j.title), sub: clean(j.sub), detail: { why: (j.why || []).map(clean), how: (j.how || []).map(clean) }, cta: { label: 'Generate versions' } }], how: `written live by Claude, image ${imgNote}` };
    } catch (e) { log.warn('[creative watcher]', e.message); return { cards: fromPool(t, 'creative'), how: 'from the pool (AI call failed)' }; }
  };
  /* ---------- cards from real research (research.js) ---------- */
  const dateIN = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const adCard = (a, at) => ({ id: 'r-ad-' + a.id, agent: 'performance', sector: 'ads', type: 'competitor', family: 'learning', lane: firstLane(), roles: ['founder', 'growth', 'brand'], kind: 'media', images: [a.poster],
    campaign: 'Popular ads', title: `${a.brand}: live ${a.days} days in ${a.versions} version${a.versions > 1 ? 's' : ''}`, sub: a.why || a.hook,
    rows: [['Hook', a.hook], ['Angle', a.angle], ['Live since', a.since], ['Format', a.format]],
    detail: { why: [a.why, `Hook: ${a.hook}`, `${a.brand} runs it as ${a.versions} version${a.versions > 1 ? 's' : ''}, ranked ${a.rank} by Meta for reach.`].filter(Boolean), how: [a.take, 'The Creative director drafts three versions in your words.', 'You approve one, then it goes to Meta.'].filter(Boolean) },
    cta: { label: 'Make our version' }, link: { label: 'See it in the Ad Library', url: a.url }, src: `Meta Ad Library · ${CTRY()} · ${dateIN(at)}`, research: { kind: 'ad', id: a.id } });
  const trendCard = (x, at) => ({ id: 'r-' + x.id, agent: 'brew', sector: 'creatives', type: 'competitor', family: 'learning', lane: firstLane(), roles: ['founder', 'growth', 'brand'], kind: 'rows',
    campaign: 'Trends', title: x.card, sub: x.p,
    rows: x.rising ? x.rising.slice(0, 4).map((r) => [r.q.length > 38 ? r.q.slice(0, 36) + '…' : r.q, r.v]) : x.terms.map((term) => { const s = research.get().trends.series[term]; return [term, s.change == null ? `index ${s.last}` : `${s.change > 0 ? '+' : ''}${s.change}% in 30 days`]; }),
    detail: { why: [x.p, x.h], how: ['Brew turns it into an ad idea or a page change.', 'You approve it before anything goes live.'] },
    cta: { label: 'Turn into an idea' }, src: `Google Trends · ${CTRY()} · ${dateIN(at)}`, research: { kind: 'trend', id: x.id } });
  const howtoCard = (x, at) => ({ id: 'r-' + x.id, agent: 'creative', sector: 'creatives', type: 'idea', lane: x.lane, roles: ['founder', 'growth', 'brand'], kind: x.img ? 'media' : 'rows', images: x.img ? [x.img] : undefined,
    campaign: 'How to', title: x.card, sub: x.p, rows: x.steps.map((st, i) => [`Step ${i + 1}`, st]),
    detail: { why: [x.p], how: x.steps }, cta: { label: 'Start this' }, src: `How-to playbook · ${dateIN(at)}`, research: { kind: 'howto', id: x.id } });
  /* a story and the archive behind it (research.js pool): a story past its 24 hours can still become a feed card */
  const resAll = (o) => [...(o?.items || []), ...(o?.archive || [])];
  const researchCard = (kind, id) => {
    const r = research?.get() || {};
    if (kind === 'ad') { const a = resAll(r.ads).find((x) => x.id === id); return a && adCard(a, a.firstSeen || r.ads.fetchedAt); }
    if (kind === 'trend') { const x = resAll(r.trends).find((y) => y.id === id); return x && x.terms?.every((term) => r.trends.series?.[term]) && trendCard(x, x.firstSeen || r.trends.fetchedAt); }
    if (kind === 'howto') { const x = resAll(r.howto).find((y) => y.id === id); return x && howtoCard(x, x.firstSeen || r.howto.fetchedAt); }
  };
  /* which research becomes a card: live stories and archived ones alike, strongest first (ads: Meta rank, versions, run
     length; trends: size of the move), so a strong story that expired from the ring still reaches the feed, where the
     ranker places it like any other card */
  const resStrength = (wid, x, r) => wid === 'trends' ? (x.kind === 'rising' ? 40 : Math.max(0, ...(x.terms || []).map((term) => Math.abs(r.trends?.series?.[term]?.change || 0))))
    : (30 - (x.rank || 30)) / 3 + Math.log2(1 + (x.versions || 1)) * 4 + Math.min(x.days || 0, 120) / 10;
  const fromResearch = (t, wid, n) => {
    const r = research?.get() || {}; const out = [];
    const src = wid === 'trends' ? resAll(r.trends) : resAll(r.ads), list = src.slice().sort((a, b) => resStrength(wid, b, r) - resStrength(wid, a, r)).map((x) => researchCard(wid === 'trends' ? 'trend' : 'ad', x.id));
    for (const c of list) { if (out.length >= n) break; if (!c || t.used.has(c.id) || t.cards.has(c.id)) continue; t.used.add(c.id); out.push(c); }
    return out;
  };
  const wireResearch = (b) => b.research?.onRefresh((done) => {
    for (const t of brandTenants(b)) {
      if (done.includes('trends') && t.watchers.trends) t.watchers.trends.nextRun = now(t) + 15e3;
      if (done.includes('ads') && t.watchers['ads-library']) t.watchers['ads-library'].nextRun = now(t) + 30e3;
    }
  });

  /* ---------- cards from live data (live-watch.js): the brand's catalog and real AI answers ---------- */
  const ENG = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude' };
  const inrN = (n) => (B().sym || '') + Math.round(n).toLocaleString(safeLocale(B().config.locale || 'en-IN'));
  const andList = (xs) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
  const short = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const liveCard = (wid, e) => {
    const at = new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    if (wid === 'catalog') {
      const x = e.items || [], names = x.map((i) => i.title), base = { id: 'lv-' + e.id, agent: 'storefront', sector: 'catalog', lane: firstLane(), roles: ['ecom', 'founder', 'growth'], kind: 'rows', src: `${BH()}, checked ${at}`, liveSrc: { kind: 'catalog', id: e.id }, link: x[0]?.url ? { label: `Open on ${BH()}`, url: x[0].url } : undefined, ttlDays: 7 };
      const rows = (f) => x.slice(0, 4).map(f);
      if (e.kind === 'oos') return { ...base, type: 'decision', family: 'exception', badge: ['Out of stock', 'warn'],
        title: e.urgent ? `${plural(x.length, 'product our cards sell is', 'products our cards sell are')} out of stock` : `${plural(x.length, 'product is', 'products are')} out of stock on ${BH()}`,
        sub: `The live store shows ${short(andList(names.slice(0, 3)), 160)}${x.length > 3 ? ` and ${x.length - 3} more` : ''} as sold out. Any ad, message or link that sends people there loses the sale until it's back.`,
        rows: rows((i) => [short(i.title, 40), 'Out of stock']), detail: { why: [`Checked on the live ${BH()} catalog.`, 'Shoppers who land there can’t buy.', e.urgent ? 'These are products the feed’s cards and ads point to.' : 'Ads and messages may still point there.'], how: ['Brew lists every ad and message that points there.', 'Your team pauses them or swaps in an in-stock product.', 'Brew posts a card when it is back in stock.'] }, cta: { label: 'List what points there' } };
      if (e.kind === 'back') return { ...base, type: 'report', family: 'result', badge: ['Back in stock', 'ok'], title: `${plural(x.length, 'product is', 'products are')} back in stock on ${BH()}`, sub: `${short(andList(names.slice(0, 3)), 180)} can be bought again. Anything paused for it can restart.`, rows: rows((i) => [short(i.title, 40), 'In stock']), detail: { why: [`Checked on the live ${BH()} catalog.`], how: ['Your team restarts anything it paused for it.'] }, cta: { label: 'Plan the restart' } };
      if (e.kind === 'price' || e.kind === 'drift') { const it = x.map((i) => ({ t: i.title, was: i.was != null ? (typeof i.was === 'number' ? inrN(i.was) : i.was) : '', now: i.now || inrN(i.price) })).filter((i) => i.was !== i.now); // saved events from before the paise fix: "₹1,850 → ₹1,850" is no change
        if (!it.length) return null;
        return { ...base, type: 'decision', family: 'exception', badge: ['Price changed', 'warn'], liveNums: it.flatMap((i) => [i.was, i.now]),
          title: e.kind === 'drift' ? `${plural(it.length, 'price our cards quote has', 'prices our cards quote have')} changed on ${BH()}` : `${plural(it.length, 'price', 'prices')} changed on ${BH()}`,
          sub: `${short(it[0].t, 60)} is now ${it[0].now}${it[0].was ? `, was ${it[0].was}` : ''}${it.length > 1 ? `, plus ${plural(it.length - 1, 'more', 'more')}` : ''}. ${e.kind === 'drift' ? 'Cards and ads that quote the old price are now wrong.' : 'Ads and messages quoting the old price need the new one.'}`,
          rows: it.slice(0, 4).map((i) => [short(i.t, 34), i.was ? `${i.was} → ${i.now}` : i.now]), detail: { why: [`Read from the live ${BH()} catalog.`, 'A wrong price in an ad is a broken promise at checkout.'], how: ['The fact sheet takes the new price on its daily check.', 'Brew lists the cards and moves that quote the old one.', 'Your team updates the ads and messages.'] }, cta: { label: 'Update the prices' } }; }
      if (e.kind === 'removed' || e.kind === 'gone') return { ...base, type: 'decision', family: 'exception', badge: ['Removed', 'warn'], title: `${plural(x.length, 'product was', 'products were')} removed from ${BH()}`, sub: `${short(andList(names.slice(0, 3)), 180)} ${x.length === 1 ? 'is' : 'are'} gone from the live store. Links and ads that point there now land on an error page.`, rows: rows((i) => [short(i.title, 40), 'Gone']), detail: { why: [`Checked on the live ${BH()} catalog.`, 'A dead link wastes every click.'], how: ['Brew lists what points there.', 'Your team redirects it or pauses it.'] }, cta: { label: 'Fix the links' } };
      if (e.kind === 'new') return { ...base, type: 'idea', family: 'idea', badge: ['New on the store', 'info'], liveNums: x.map((i) => inrN(i.price)), title: `${plural(x.length, 'new product is', 'new products are')} live on ${BH()}`, sub: `${short(andList(names.slice(0, 3)), 170)}${x.length > 3 ? ` and ${x.length - 3} more` : ''} went live recently. None has launch content in the feed yet.`, rows: rows((i) => [short(i.title, 40), inrN(i.price)]), detail: { why: [`Found on the live ${BH()} catalog.`, 'A launch with no ads or messages sells to nobody.'], how: ['The Creative director drafts launch ideas.', 'The CRM specialist drafts a message to past buyers.', 'You pick what goes out.'] }, cta: { label: 'Plan the launch' } };
      if (e.kind === 'thin') return { ...base, type: 'decision', family: 'exception', badge: [plural(x.length, 'listing', 'listings'), 'warn'], title: `${plural(x.length, 'listing has', 'listings have')} one photo or none on ${BH()}`, sub: `${short(andList(names.slice(0, 2)), 170)}${x.length > 2 ? ` and ${x.length - 2} more` : ''} show a single image. Catalog ads and shoppers need more than one angle to trust a combo.`, rows: rows((i) => [short(i.title, 40), `${i.images} photo${i.images === 1 ? '' : 's'}`]), detail: { why: [`Counted on the live ${BH()} catalog.`, 'Listings with one image convert worse and look thin in catalog ads.'], how: ['Brew drafts packshots from the single-product photos.', 'You pick the ones you like.', 'Your team adds them to the listings.'] }, cta: { label: 'Add photos' } };
      return null;
    }
    const base = { id: 'lv-' + e.id, agent: 'visibility', sector: 'visibility', lane: firstLane(), roles: ['founder', 'brand', 'ecom'], src: `ChatGPT, Gemini, Perplexity and Claude, asked from ${CTRY()} · ${at}`, liveSrc: { kind: 'visibility', id: e.id }, ttlDays: 7 };
    if (e.kind === 'score') { const d = e.was ? e.named - e.was.named : null;
      return { ...base, type: 'report', family: 'result', kind: 'rows', badge: [d == null ? 'This week' : d > 0 ? `+${d}` : d < 0 ? `${d}` : 'No change', d > 0 ? 'ok' : d < 0 ? 'warn' : 'info'], health: d ? { 'AI answers': d } : undefined,
        title: `${BN()} is named in ${e.named} of ${e.total} AI answers this week`, sub: `We asked ${plural(e.total / 4 | 0, 'shopper question', 'shopper questions')} to ChatGPT, Gemini, Perplexity and Claude, from ${CTRY()}.${e.was ? ` Last time it was ${e.was.named} of ${e.was.total}.` : ' This is the first reading; next week shows the change.'}`,
        rows: e.byEngine.map((b) => [ENG[b.engine], `${b.named} of ${b.total}`]), detail: { why: ['Real answers from the consumer apps, with web search on.', 'Shoppers ask these before they buy.'], how: ['Brew asks the same questions every week.', 'Each gap becomes a card with a page or a claims fix to draft.'] }, cta: { label: 'Open report' } }; }
    if (e.kind === 'gap') return { ...base, type: 'decision', family: 'exception', kind: 'answer', q: e.q, a: `${andList(e.rivals)} ${e.rivals.length === 1 ? 'is' : 'are'} named. ${BN()} is in none of the ${e.of} answers.`,
      title: short(`Ask AI “${e.q.replace(/\?$/, '')}”: ${BN()} is in 0 of ${e.of}`, 76), sub: `ChatGPT, Gemini, Perplexity and Claude name ${andList(e.rivals)}${e.domains?.length ? ` and cite ${andList(e.domains.slice(0, 3))}` : ''}. A page on ${BH()} that answers this directly is how a brand gets named.`,
      rows: [[`${BN()} named`, `0 of ${e.of}`], ['Named instead', short(e.rivals.join(', '), 40)]], detail: { why: [`Real answers from the consumer apps, asked from ${CTRY()}.`, 'Answers lean on the sites they cite.'], how: ['Brew drafts a page that answers the question with your claims.', `Your team puts it on ${BH()}.`, 'Brew asks again next week.'] }, cta: { label: 'Draft the page' } };
    if (e.kind === 'win') return { ...base, type: 'report', family: 'result', kind: 'answer', q: e.q, a: e.said || `${andList(e.engines.map((x) => ENG[x]))} now names ${BN()}.`, badge: ['Named', 'ok'], health: { 'AI answers': e.engines.length },
      title: short(`${andList(e.engines.map((x) => ENG[x]))} now names ${BN()} for “${e.q.replace(/\?$/, '')}”`, 76), sub: `${BN()} is now in ${e.yes.length} of ${e.of} answers to this question, up from ${e.yes.length - e.engines.length} last time.`, rows: [['Named in', `${e.yes.length} of ${e.of}`]], detail: { why: ['Real answers, compared with last week.'], how: ['We keep asking weekly.'] }, cta: { label: 'Open report' } };
    if (e.kind === 'loss') return { ...base, type: 'decision', family: 'exception', kind: 'rows', badge: ['Dropped', 'warn'], health: { 'AI answers': -e.engines.length },
      title: short(`${andList(e.engines.map((x) => ENG[x]))} stopped naming ${BN()} for “${e.q.replace(/\?$/, '')}”`, 76), sub: `${BN()} is in ${e.yes.length} of ${e.of} answers now${e.rivals?.length ? `; ${andList(e.rivals.slice(0, 3))} still show up` : ''}.`, rows: [['Named in', `${e.yes.length} of ${e.of}`], ['Lost', andList(e.engines.map((x) => ENG[x]))]], detail: { why: ['Real answers, compared with last week.'], how: ['Brew checks which page it used to cite.', 'Your team refreshes that page.'] }, cta: { label: 'See what changed' } };
    return null;
  };
  const fromLive = (t, wid, n) => {
    const s = live?.get()?.[wid]; const out = [];
    for (const e of s?.events || []) { if (out.length >= n) break; const id = 'lv-' + e.id; if (t.used.has(id) || t.cards.has(id)) continue; const c = liveCard(wid, e); t.used.add(id); if (c) out.push(c); }
    return out;
  };
  const wireLive = (b) => b.live?.onRefresh((done) => { for (const t of brandTenants(b)) done.forEach((k) => { if (t.watchers[k]) t.watchers[k].nextRun = now(t) + 10e3; }); });

  const runWatcher = async (t, w, why = 'schedule') => {
    const st = t.watchers[w.id]; st.lastRun = now(t); st.nextRun = now(t) + w.demoEvery; st.runs++;
    if (w.needs && !connOn(t, w.needs)) { wlog(t, w, `Skipped: needs ${SEED.connectors[w.needs]?.name || w.needs} connected`); return []; }
    if (w.id === 'batches') { const d = tickBatches(t); wlog(t, w, d.length ? `${d.length} batch${d.length > 1 ? 'es' : ''} finished` : 'Batches moved forward'); return []; }
    let proposals = [], how = '';
    if (w.id === 'creative') { const r = await creativeIdea(t); proposals = r.cards; how = r.how; }
    else if (w.id === 'catalog' || w.id === 'visibility') { const s = live?.get()?.[w.id]; proposals = fromLive(t, w.id, w.id === 'catalog' ? 3 : 3);
      how = w.id === 'catalog' ? `from the live ${BH()} catalog (${s?.count || 0} products)` : 'from real ChatGPT, Gemini, Perplexity and Claude answers';
      if (!proposals.length) { wlog(t, w, !s ? (live?.running().includes(w.id) ? 'Reading the live source now' : 'Live source not read yet') : `Checked ${w.id === 'catalog' ? `${s.count} products on ${BH()}` : 'the latest AI answers'}: nothing new`); return []; } }
    else if (w.id === 'ads' && B().kind === 'generated') { proposals = fromOwnAds(t, 2); how = `from your live ads in the Meta Ad Library, ${CTRY()}`; }
    else if (w.id === 'trends' || w.id === 'ads-library') { proposals = fromResearch(t, w.id, w.id === 'trends' ? 2 : 2); how = w.id === 'trends' ? `from Google Trends, ${CTRY()}` : `from the Meta Ad Library, ${CTRY()}`; }
    else proposals = fromPool(t, w.id, 1);
    if (!proposals.length) { wlog(t, w, (w.id === 'trends' || w.id === 'ads-library') && !research?.get()[w.id === 'trends' ? 'trends' : 'ads'] ? 'Research is still running' : 'Nothing new since the last run'); return []; }
    const made = proposals.map((p) => {
      const c = pipeline(t, p, w);
      if (p.story && c.state === 'ready') t.storyExtra[p.story.ring || 'trends'].push({ c: SEED.brand.wash[0], h: fill(p.story.h, t), p: fill(p.story.p, t), from: w.name, at: now(t) });
      if (p.health && c.state === 'ready') Object.entries(p.health).forEach(([k, d]) => (t.health[k] = (t.health[k] || 0) + d));
      return c;
    });
    /* a watcher's first run in a workspace catches up on what was already there: those cards join the feed, but they are
       part of the first load, not "new since you looked" (the pill would climb to 8 within a minute of a fresh feed) */
    if (st.runs <= 1 || Date.now() - (t.onboarding.readyAt || 0) < FIRST_LOAD_MS) made.forEach((c) => { c.initial = true; });
    st.made += made.length; st.kept += made.filter((c) => c.state === 'ready').length;
    wlog(t, w, `${why === 'manual' ? 'Run now' : why === 'overnight' ? 'Overnight run' : 'Scheduled run'}: ${made.length} proposed${how ? ', ' + how : ''}`, made);
    return made;
  };
  const tick = async () => { for (const t of tenants.values()) await runDemo(t.demoSid, () => tickOne(t)); };
  const tickOne = async (t) => {
    if (t.demoSid && Date.now() - t.lastSeen > 2 * 3600e3) return; /* a demo session nobody has open for 2 hours rests */
    {
      /* a brand's own workspace keeps its clock when nobody has it open: launches are read, approved programs run, flows send.
         A visitor's demo and the AI watchers wait for someone to be there. On this clock t.member is the last team member who
         opened it, re-checked against the brand's members now (removed from the team: it stops acting) */
      await MC.bgCheck(t);
      const idle = Date.now() - t.lastSeen > 10 * 60e3; if (!t.onboarding.readyAt || (idle && !t.member)) return;
      const br = brandOfT(t); if (!br) return;
      if (idle) { if (Date.now() - (t.idleSaveAt || 0) > 3600e3) { t.idleSaveAt = Date.now(); store?.save(t, 0); } return; } /* the 20s saver only covers open workspaces */
      /* the AI watchers write new cards: only while someone who may make fresh work (the team, SquareUp) has it open */
      if (Date.now() - (t.lastGen || 0) > 15 * 60e3) return;
      runIn(br, () => { for (const w of WATCHERS) { const st = t.watchers[w.id]; if (st && st.enabled && now(t) >= st.nextRun) { st.nextRun = now(t) + w.demoEvery; runWatcher(t, w).catch((e) => log.warn('[watcher]', w.id, e.message)); } } });
    }
  };
  setInterval(() => { if (tick.busy) return; tick.busy = true; tick().catch((e) => log.warn('[tick]', e.message)).finally(() => { tick.busy = false; }); }, 5000).unref?.(); /* one tick at a time: it awaits the team check */
  // timers (replies, drafts) change tenants between requests; keep the saved copy current
  setInterval(() => { for (const t of tenants.values()) if (Date.now() - t.lastSeen < 15 * 60e3) store?.save(t, 0); }, 20e3).unref?.();

  /* ---------- heart: a child card in the same direction ---------- */
  // a version may only use numbers from the fact sheet or the card it came from (heart cards skip the QA pass)
  const variantOk = (parent, v) => { const ok = new Set(FACT_OK); numbersIn(JSON.stringify({ t: parent.title, s: parent.sub, r: parent.rows, d: parent.detail })).forEach((n) => ok.add(n)); return !unbacked({ text: `${v.title} ${v.sub}` }, ok).length; };
  // heart cards made before that check could carry canned versions with stale prices: rebuild them from their parent
  const repairHeartKids = (t) => { for (const c of t.cards.values()) { if (c.origin !== 'heart' || !c.variants?.length || c._vfix) continue; const parent = t.cards.get(c.parentCardId); if (!parent) continue;
    const good = c.variants.filter((v) => variantOk(parent, v)); c.variants = good.length === c.variants.length ? c.variants : [...good, ...mockVariants(parent)].slice(0, 3); c._vfix = 1; } };
  const heartChild = (t, parent) => {
    const existing = [...t.cards.values()].find((c) => c.parentCardId === parent.id && c.origin === 'heart'); if (existing) return existing;
    const child = { id: uid('more'), parentCardId: parent.id, origin: 'heart', agent: parent.agent === 'brew' ? 'creative' : parent.agent, sector: parent.sector, type: 'idea', family: 'idea', lane: parent.lane, roles: parent.roles, time: 'Just now', campaign: 'More like this', kind: 'variants', loading: true, images: parent.images ? [parent.images[0]] : null, title: 'Three more in the direction you hearted', sub: `Same idea as “${parent.title}”, cut three ways.`, cta: { label: 'Generate versions' }, src: parent.src, createdAt: now(t), history: [] };
    setState(t, child, 'proposed'); t.cards.set(child.id, child);
    (async () => {
      setState(t, child, 'qa');
      let vs, how = 'mock';
      if (!isMock() && spend('text')) { try { const j = await claudeJSON(`${cardBrief(parent, seatLine(t.viewer))}\n\nThe reader hearted this card. Write three new feed cards in the same direction, each a different cut (persona, format or hook). JSON: {"variants":[{"angle":"2-3 words","title":"under 60 chars, point first, plain words","sub":"two sentences, 25 to 35 words: what we saw with the number, then the move and what it gets ${BN()}; no fonts, design notes or file names; numbers only from the facts"}]}`); vs = j.variants; how = 'live'; } catch (e) { log.warn('[heart]', e.message); } }
      vs = (vs || mockVariants(parent)).slice(0, 3).map((v) => ({ ...v, title: clean(v.title), sub: clean(v.sub) })).filter((v) => !BANNED.test(v.title + v.sub) && variantOk(parent, v));
      child.variants = vs.length ? vs : mockVariants(parent); child.loading = false;
      child.sub = how === 'live' ? `Written just now from “${parent.title}”. Pick the one to run.` : `Same idea as “${parent.title}”, cut three ways. Pick the one to run.`;
      t.qa.unshift({ id: uid('qa'), cardId: child.id, title: child.title, by: 'Heart', attempt: 1, checks: [{ k: 'No banned words', ok: true }, { k: 'Names a number', ok: true }], result: 'pass', at: now(t) });
      setState(t, child, 'ready');
    })();
    return child;
  };

  /* ---------- jam router ---------- */
  const QUESTION = /^(what|why|how|which|when|who|is|are|can|should|do|does|will|would)\b|\?\s*$/i;
  const routeJam = async (t, body, manual) => {
    if (manual) return { route: 'team', label: 'talk to a person', reason: 'You asked for a person', method: 'manual row' };
    if (!isMock() && spend('text')) {
      try {
        const j = await claudeJSON(`Route a message in Brew. Agents can write, rewrite, plan, explain and make image or copy versions. A person on the ShopOS team is needed for: a shoot, a model or creator, pricing or discount decisions, legal, a call, a new product.\nMessage: "${String(body).slice(0, 500)}"\nJSON: {"route":"ai" or "team","label":"a shoot|a model or creator|pricing or discount|legal|a call|a new product|spend above weekly limit|none","reason":"under 10 words","intent":"answer" (a question) or "versions" (a change to make)}`, 300);
        if (j.route === 'ai' || j.route === 'team') return { route: j.route, label: j.label || 'none', reason: clean(j.reason || ''), intent: j.intent === 'answer' ? 'answer' : 'versions', method: 'classifier (Claude)' };
      } catch (e) { log.warn('[router]', e.message); }
    }
    const hit = ROUTE_RULES.find(([, re]) => re.test(body));
    return hit ? { route: 'team', label: hit[0], reason: `Needs ${hit[0]}`, method: 'keyword rule' } : { route: 'ai', label: 'none', reason: 'An agent can do this', intent: QUESTION.test(body.trim()) ? 'answer' : 'versions', method: 'keyword rule' };
  };

  /* ---------- versions (remix and jam) ---------- */
  const makeVersions = async (t, c, prompt, extra = '') => {
    if (!isMock() && spend('text')) {
      try {
        const j = await claudeTool(`${cardBrief(c, seatLine(t.viewer))}\n\nThe reader wants: "${prompt || 'three distinct angles'}". ${extra}\n${promptBlock(t, c.agent === 'brew' ? 'creative' : c.agent)}\nReply as the ${AGENT[c.agent] || 'agent'}: one short line, then three versions of this card that do exactly that. Plain words, only numbers from the facts.`,
          { type: 'object', required: ['line', 'versions'], properties: { line: { type: 'string', description: 'Under 20 words' }, versions: { type: 'array', items: { type: 'object', required: ['angle', 'title', 'sub'], properties: { angle: { type: 'string', description: '2-3 words' }, title: { type: 'string', description: 'Under 60 characters' }, sub: { type: 'string', description: 'Under 100 characters, one exact number from the facts' } } } } } }, 1500, 'versions');
        const vs = (j.versions || []).slice(0, 3).map((v) => ({ ...v, title: clean(v.title), sub: clean(v.sub) })).filter((v) => !BANNED.test(v.title + v.sub) && qaCheck({ ...c, ...v }).every((x) => x.ok || x.k === 'Names a number'));
        if (vs.length) return { line: clean(j.line || 'Here are three versions.'), versions: vs, live: true };
      } catch (e) { log.warn('[versions]', e.message); }
    }
    return { line: 'Here are three versions. Pick one, or tell me what to change.', versions: mockVariants(c), live: false };
  };

  /* ---------- engine view: everything the spec describes, in one read ---------- */
  const metrics = (t) => {
    const n = now(t), last7 = [...t.days].filter((d) => Date.parse(d) > n - 7 * D).length;
    const shownIds = Object.keys(t.shown).length;
    const approvals = t.runs.filter((r) => r.state === 'done' && n - r.at < 7 * D).length;
    const ttf = t.onboarding.readyAt && t.onboarding.startedAt ? (t.onboarding.readyAt - t.onboarding.startedAt) / 1000 : null;
    return [
      { k: 'Time to feed', v: ttf != null ? `${Math.round(ttf)}s` : '—', target: 'Under 2 minutes', ok: ttf != null && ttf < 120 },
      { k: 'Return days', v: `${last7} of 7`, target: '4 or more', ok: last7 >= 4 },
      { k: 'Card action rate', v: shownIds ? `${Math.round((t.acted.size / shownIds) * 100)}%` : '—', target: '25%', ok: shownIds && t.acted.size / shownIds >= 0.25, note: `${t.acted.size} of ${shownIds} cards shown` },
      { k: 'Approvals this week', v: String(approvals), target: '5 or more', ok: approvals >= 5 },
      { k: 'Team jams', v: String(t.work.filter((w) => w.ticket).length + t.jams.filter((j) => j.route === 'team').length), target: 'Tracked as deployment leads', ok: true, note: `${leadsAllTenants} across all tenants` },
      { k: 'Free to Pro', v: t.plan === 'pro' ? 'On Pro' : 'Free', target: 'Measured, no target yet', ok: true },
      { k: 'Card feedback', v: String((t.cardNotes || []).length + t.feedback.filter((f) => f.kind === 'not_interested').length), target: 'Read by the Brew team weekly', ok: true, note: t.cardNotes?.[0] ? `Latest on “${t.cardNotes[0].title.slice(0, 40)}”: ${t.cardNotes[0].text.slice(0, 120)}` : 'No notes yet' }
    ];
  };
  const engine = (t) => {
    const { ranked, top, scores } = rank(t);
    const states = {}; t.cards.forEach((c) => (states[c.state] = (states[c.state] || 0) + 1));
    const today = dayKey(now(t));
    const madeToday = [...t.cards.values()].filter((c) => c.origin === 'watcher' && dayKey(c.createdAt) === today);
    return {
      clock: now(t), speed: t.speed, plan: t.plan,
      watchers: WATCHERS.map((w) => ({ ...w, ...t.watchers[w.id], blocked: w.needs && !connOn(t, w.needs) ? (SEED.connectors[w.needs]?.name || w.needs) : null })),
      wlog: t.wlog.slice(0, 20), qa: t.qa.slice(0, 20), states,
      budget: { proposedToday: madeToday.length, keptToday: madeToday.filter((c) => c.state !== 'dropped' && c.state !== 'story').length },
      pipeline: [...t.cards.values()].filter((c) => c.origin !== 'seed').sort((a, b) => b.createdAt - a.createdAt).slice(0, 14).map((c) => ({ id: c.id, title: c.title, state: c.state, origin: c.origin, watcher: c.watcher, history: c.history, expiresAt: c.expiresAt })),
      ranking: [...top.map((c) => ({ id: c.id, title: c.title, agent: c.agent, kind: c.kind, fixed: 'Your post, on top' })), ...ranked.slice(0, 18).map((c) => ({ id: c.id, title: c.title, agent: c.agent, kind: c.kind, ...scores[c.id] }))],
      router: t.router.slice(0, 15), rules: ROUTE_RULES.map(([k]) => k).concat(['talk to a person (manual row)']),
      workbench: t.jams.filter((j) => j.route === 'team').map((j) => ({ ...j, card: j.cardId ? t.cards.get(j.cardId)?.title : null })),
      memory: t.memory.slice(0, 16), metrics: metrics(t),
      api: Object.entries(t.api).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.last - a.last),
      model: { tenant: { id: t.id, host: t.host, name: t.name, plan: t.plan, createdAt: t.createdAt },
        card: pub([...t.cards.values()].find((c) => c.origin === 'watcher') || t.cards.get('founder')),
        feedback: t.feedback.slice(-3), actionRun: t.runs.slice(-1)[0] || null, version: t.versions.slice(-1)[0] || null,
        jam: t.jams[0] || null, batch: t.batches[0], finding: t.memory.find((m) => m.type === 'finding') }
    };
  };
  // The four rings, from the shared research snapshot (research.js) plus this tenant's own events.
  // A ring is unseen when it has something newer than the last time this person opened it.
  /* a story lives 24 hours from when Brew first saw it (research.js pool), is scored, and only the ones over the cut-off show:
     score = 0.4 x how fresh (1 at first sight, 0 at 24 h) + 0.6 x how strong (ads: Meta rank, versions and run length against
     the best in the ring; trends: size of the move; news: how recent the story is; how-to: fixed). STORY_CUT sets the bar */
  const STORY_LIFE = 24 * 3600e3, STORY_CUT = () => +process.env.STORY_CUT || 0.45;
  const storyPick = (items, snapAt, strength, t, max = 8) => { const n = now(t);
    return (items || []).map((x) => { const at = x.firstSeen || snapAt || 0, age = n - at; if (age >= STORY_LIFE) return null;
      const score = 0.4 * (1 - age / STORY_LIFE) + 0.6 * Math.max(0, Math.min(1, strength(x))); return score >= STORY_CUT() ? { ...x, firstSeen: at, score: +score.toFixed(3) } : null; })
      .filter(Boolean).sort((a, b) => b.score - a.score).filter((x, i, a) => !a.slice(0, i).some((y) => near(x, y))).slice(0, max); }; /* two near-identical stories show once */
  const stories = (t) => {
    const r0 = research?.get() || {};
    const adTop = Math.max(1, ...(r0.ads?.items || []).map((a) => (30 - (a.rank || 30)) / 3 + Math.log2(1 + (a.versions || 1)) * 4 + Math.min(a.days || 0, 120) / 10));
    const r = {
      ads: r0.ads && { ...r0.ads, items: storyPick(r0.ads.items, r0.ads.fetchedAt, (a) => ((30 - (a.rank || 30)) / 3 + Math.log2(1 + (a.versions || 1)) * 4 + Math.min(a.days || 0, 120) / 10) / adTop, t) },
      trends: r0.trends && { ...r0.trends, items: storyPick((r0.trends.items || []).map((x) => ({ ...x, terms: (x.terms || []).filter((term) => r0.trends.series?.[term]) })), r0.trends.fetchedAt,
        (x) => (x.kind === 'rising' ? 0.8 : Math.max(0.35, ...x.terms.map((term) => Math.abs(r0.trends.series[term]?.change || 0) / 50))), t) },
      /* news: anything the scout found in its 21-day window is real and dated, so it starts strong and the newest ranks first; a
         7-day scale scored a niche brand's week-old rival news at zero and hid the whole ring (Comet, 2026-10-14) */
      news: r0.news && { ...r0.news, items: storyPick(r0.news.items, r0.news.fetchedAt, (x) => { const d = Date.parse(x.date); if (isNaN(d)) return 0.5; const a = Math.max(0, now(t) - d) / (21 * 24 * 3600e3); return a > 1 ? 0 : 0.45 + 0.55 * (1 - a); }, t, 10) },
      howto: r0.howto && { ...r0.howto, items: storyPick(r0.howto.items, r0.howto.fetchedAt, () => 0.7, t, 4) }
    };
    const lastAt = (o) => Math.max(0, ...(o?.items || []).map((x) => x.firstSeen || 0)) || o?.fetchedAt || null;
    /* a slide with no photo of its own gets the brand's own product photo it talks about (most shared words with a card
       that has one), shown faint behind the text; with no match it stays a plain dark slide, never a colour blob */
    const STOP = new Set('the and for with your you are was this that from have has not but our its into than then them they what when will more most over just only also about after before their there these those which while been being'.split(' '));
    const words = (x) => new Set(String(x || '').toLowerCase().match(/[a-z][a-z-]{3,}/g)?.filter((w) => !STOP.has(w)) || []);
    const pool = [...t.cards.values()].filter((c) => c.images?.[0] && !String(c.images[0]).startsWith('data:')).map((c) => ({ img: c.images[0], w: words(`${c.title} ${c.sub || ''}`) }));
    const bgFor = (sl) => { if (sl.img || sl.poster || !pool.length) return sl; const w = words([sl.h, sl.p, ...(sl.steps || [])].join(' ')); let best = null, top = 1;
      for (const c of pool) { let n = 0; for (const x of w) if (c.w.has(x)) n++; if (n > top) { top = n; best = c; } }
      return best ? { ...sl, bg: best.img } : sl; };
    /* a ring whose last read failed and has nothing left today says so, never just vanishes as if there was nothing (brew-external-data rule 1) */
    const failedNote = (k, title, slides) => (slides.length || !r0[k]?.lastError ? slides : [{ type: 'note', c: SEED.brand.wash[2], h: `Couldn't refresh ${title} this time`, p: 'The source didn’t answer. Brew tries again within the hour.', from: 'Brew', at: r0[k].lastError.at }]);
    const ring = (k, title, slides, o = {}) => { slides = failedNote(k, title, slides); return { k, title, slides: slides.map(bgFor), ...o, seen: !!o.updatedAt && (t.storySeen[k] || 0) >= o.updatedAt }; };
    const extra = (k) => t.storyExtra[k].slice().reverse().map((x) => ({ ...x, type: 'note' }));
    const ads = r.ads, tr = r.trends, nw = r.news, ht = r.howto;
    const adSlides = (ads?.items || []).map((a) => ({ type: 'ad', ...a, total: ads.brands.find((b) => b.name === a.brand)?.live, cardId: t.cards.has('r-ad-' + a.id) ? 'r-ad-' + a.id : null }));
    const trSlides = (tr?.items || []).map((x) => ({ type: x.kind === 'rising' ? 'rising' : 'trend', ...x, series: x.terms.map((term) => { const s = tr.series[term]; return { term, values: s.values, change: s.change, last: s.last }; }), dates: tr.series[x.terms[0]]?.dates || Object.values(tr.series)[0]?.dates }));
    const batches = t.batches.slice(0, 3).map((b) => ({ type: 'note', c: SEED.brand.wash[1], h: b.t, p: `${b.s}. ${b.st === 'Running' ? b.pct + '% done.' : b.st + '.'}`, from: 'Your work' }));
    const newsSlides = (nw?.items || []).map((x) => ({ type: 'news', ...x }));
    const spark = (term) => tr?.series[term]?.values;
    // the brand today: its own most important new things, never outside news.
    // The two top-ranked open cards, then work waiting on you, the latest measured result, and work the team finished.
    const { ranked } = rank(t);
    const topCards = ranked.filter((c) => !c.done && !c.loading && !String(c.id).startsWith('r-')).slice(0, 2).map((c, i) => ({ type: 'brand', chip: i ? 'Next up' : 'Biggest move today', h: c.title, p: c.sub, img: (c.images || [])[0], agent: c.agent, cardId: c.id, cta: c.cta?.label, at: c.createdAt }));
    const waiting = t.work.filter((w) => w.stage === 'needs_you').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 2).map((w) => { const v = w.versions.find((x) => x.n === w.current) || w.versions[w.versions.length - 1];
      return { type: 'brand', chip: 'Waiting on you', h: v?.title || w.title, p: v?.sub || `${w.with?.name || 'Your team'} sent it back for your OK.`, img: w.img, agent: w.agent, workId: w.id, at: w.updatedAt }; });
    const shipped = extra('news').map((x) => ({ ...x, type: 'brand', chip: x.from || 'Your team' }));
    const brandSlides = [...topCards, ...waiting, ...shipped, ...t.batches.slice(0, 3).map((b, i) => ({ type: 'brand', chip: 'Your agents, this week', h: b.t, p: `${b.s}.`, agent: b.team ? 'brew' : b.agent, pct: b.pct, st: b.st, at: batches[i]?.at }))].slice(0, 8);
    return [
      ring('brand', SEED.brand.name.length <= 8 ? `${SEED.brand.name} today` : 'Today', brandSlides, { updatedAt: Math.max(0, ...brandSlides.map((x) => x.at || 0)) || null, cover: topCards.find((x) => x.img)?.img, source: 'Your feed, work and results' }),
      ring('trends', 'Trends', [...trSlides, ...extra('trends')], { updatedAt: lastAt(tr), source: tr?.source, spark: spark(tr?.items?.[0]?.terms?.[0]), loading: !tr }),
      ring('ads', 'Popular ads', [...adSlides, ...extra('ads')], { updatedAt: lastAt(ads), source: ads?.source, cover: adSlides[0]?.poster, loading: !ads }),
      ring('news', 'Industry news', newsSlides.slice(0, 10), { updatedAt: lastAt(nw), source: nw?.source, cover: newsSlides.find((x) => x.img)?.img, loading: !nw }),
      ring('howto', 'How to', (ht?.items || []).map((x) => ({ type: 'howto', ...x, cardId: t.cards.has('r-' + x.id) ? 'r-' + x.id : null })), { updatedAt: lastAt(ht), source: ht?.source, cover: ht?.items.find((x) => x.img)?.img, loading: !ht })

    ].filter((x) => x.k === 'brand' || x.loading || x.slides.length); /* a ring with nothing over the cut-off today is hidden, never padded */
  };

  /* ---------- onboarding stream (SSE) ---------- */
  const FINDS = ['Found your story, word for word', 'Found your palette and type', 'Found your catalog and prices', 'Found your reviews', 'Found your packshots', 'Found what rivals run', 'Found what the AI says', 'Found your films'];
  /* Demo Mode's tour (o.liveReadFor): the store is read again, live, while the visitor watches. Events are paced so each
     finding has time to land (the cursor flies to it); if the read cannot run, the stored read is replayed instead */
  const PACE = { finding: 2200, step: 500 };
  const liveReadOnboarding = async (t, req, res, slug) => {
    let open = true, q = Promise.resolve(), sentReady = false; const ac = new AbortController(), t0 = Date.now();
    const write = (x) => open && res.write(`data: ${JSON.stringify(x)}\n\n`);
    const send = (x, gap = 0) => { q = q.then(async () => { write(x); if (gap && open) await new Promise((r) => setTimeout(r, gap)); }); };
    const ready = () => send({ type: 'ready', ms: Date.now() - t0 });
    const fallback = () => { if (sentReady) return; sentReady = true; const stop = followRead({ builder, slug, loadSeed: async () => (await packs.load(slug))?.seed, send: write, isOpen: () => open, startedAt: t0, replayMs: 1200 }); req.on('close', stop); };
    req.on('close', () => { open = false; ac.abort(); });
    /* the brand's saved read, step by step: a live step that comes back empty or partial (a paid source off, a search
       that failed) shows the saved step and its findings instead, marked as from the last read. The tour never tells a
       visitor "0 rivals" or "not asked" about a brand whose read has them; a step the saved read lacks too stays honest */
    const [pk, fj] = await Promise.all([packs.load(slug).catch(() => null), packs.getJSON(slug, 'findings.json', null).catch(() => null)]);
    const savedStep = (k) => { const a = (fj?.steps || []).find((x) => x.k === k), b = (pk?.seed?.steps || []).find((x) => x.k === k); if (!a && !b) return null; return { ...(a || {}), ...(b?.done ? { done: b.done } : {}) }; };
    const savedCards = (k) => { const c = (pk?.seed?.scrape || []).filter((x) => x.k === k); return c.length ? c : (fj?.cards || []).filter((x) => x.k === k); };
    const held = new Map(); /* each step's live findings wait for the step's verdict */
    builder.readLive(slug, { signal: ac.signal, onEvent: (ev) => { const i = STEP_KEYS.indexOf(ev.k);
      if (ev.type === 'step' && ev.state === 'reading' && i >= 0) send({ type: 'step', i, state: 'reading', tick: ev.tick || '' }, PACE.step);
      if (ev.type === 'finding') { if (i >= 0) { if (!held.has(ev.k)) held.set(ev.k, []); held.get(ev.k).push(ev); } else send({ type: 'finding', i, finding: ev.finding, say: ev.say || 'Found it' }, PACE.finding); }
      if (ev.type === 'step' && (ev.state === 'done' || ev.state === 'empty') && i >= 0) {
        const v = tourStep(ev, savedStep(ev.k), savedCards(ev.k), held.get(ev.k) || []); held.delete(ev.k);
        v.cards.forEach((c) => send({ type: 'finding', i, ...c }, PACE.finding));
        send({ type: 'step', i, state: 'done', empty: v.empty, done: v.done }, PACE.step); if (AGENT_OF[ev.k]) send({ type: 'agent', agent: AGENT_OF[ev.k] }); } } })
      .then((out) => { if (out?.opened === false) return q.then(fallback); for (const [k, evs] of held) evs.forEach((e) => send({ type: 'finding', i: STEP_KEYS.indexOf(k), finding: e.finding, say: e.say || 'Found it' }, PACE.finding)); held.clear(); sentReady = true; ready(); })
      .catch((e) => { if (!open) return; log.warn('[demo] live read', slug, e.message); q.then(fallback); });
  };
  const liveOnboarding = async (t, req, res, slug) => {
    if (o.liveReadFor && builder.readLive && await o.liveReadFor(slug).catch(() => false)) return liveReadOnboarding(t, req, res, slug);
    let open = true; t.onboarding.startedAt ||= Date.now();
    const stop = followRead({ builder, slug, loadSeed: async () => (await packs.load(slug))?.seed, send: (o) => open && res.write(`data: ${JSON.stringify(o)}\n\n`), isOpen: () => open, startedAt: t.onboarding.startedAt, replayMs: o.replayMs });
    req.on('close', () => { open = false; stop(); });
  };
  const onboardingStream = async (t, req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    if (B().kind === 'generated' && builder) return liveOnboarding(t, req, res, B().slug);
    let open = true; req.on('close', () => (open = false));
    const sendEv = (o) => open && res.write(`data: ${JSON.stringify(o)}\n\n`);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    t.onboarding.startedAt ||= Date.now();
    const steps = SEED.steps, cards = SEED.scrape;
    for (let i = 0; i < steps.length && open; i++) {
      for (const tk of (steps[i].tick || [cards[i]?.src || '/']).slice(0, 2)) { sendEv({ type: 'step', i, state: 'reading', tick: tk }); await wait(900); }
      if (cards[i]) { sendEv({ type: 'finding', i, finding: cards[i], say: FINDS[i] || 'Found it' }); }
      if (i === steps.length - 1 && cards[i + 1]) sendEv({ type: 'finding', i: i + 1, finding: cards[i + 1] });
      // dwell on each finding long enough to read it out loud in a demo
      await wait(2400);
      sendEv({ type: 'agent', agent: steps[i].agent || ['creative', 'performance', 'storefront', 'visibility', 'crm'][i % 5] });
      await wait(700);
      sendEv({ type: 'step', i, state: 'done', done: steps[i].done });
    }
    sendEv({ type: 'ready', ms: Date.now() - t.onboarding.startedAt }); if (open) res.end();
  };

  /* ---------- work board: a card you are working on, from first edit to deployment ----------
     drafting (you + AI, as many iterations as you like) → with your team / with Brew → needs you
     → ready to deploy → deploying → deployed. Every change from someone else is a notification. */
  const NEEDS = { 'Queue the 12': 'meta', 'Publish Campaign': 'meta', 'Shift budget': 'meta', 'Rotate creative': 'meta', 'Apply the plan': 'meta', 'Run Monday decisions': 'meta', 'Lock the Diwali set': 'meta',
    'Update landing page': 'shopify', 'Apply Update': 'shopify', 'Turn on guest checkout': 'shopify', 'Approve 6 popups': 'shopify', 'Publish the page': 'shopify', 'Approve the 3 offers': 'shopify', 'Approve the ladder': 'shopify',
    'Push 5 titles': 'marketplaces', 'Draft the listing': 'marketplaces', 'Send on WhatsApp': 'whatsapp', 'Turn on the journey': 'whatsapp', 'Send the review ask': 'loox',
    'Launch the ad group': 'google', 'Fix tracking': 'google', 'Approve the flows': 'klaviyo', 'Swap the images': 'meta', 'Pause those ads': 'meta',
    'Queue the ads': 'meta', 'Approve the offers': 'shopify', 'Push the titles': 'shopify' };
  /* labels a generated brand's cards use that the map does not know: the card's own words name the tool before its section does */
  const toolInWords = (c) => { const s = `${c?.title || ''} ${c?.sub || ''}`; return /\b(meta|facebook|instagram|reels?)\b/i.test(s) ? 'meta' : /\bgoogle (ads|search|shopping)\b|\bsearch ads?\b/i.test(s) ? 'google' : /\b(klaviyo|email flow|newsletter)\b/i.test(s) ? 'klaviyo' : null; };
  /* labels that are a decision, a review, research or people work: nothing to run on an account */
  const NO_TOOL = new Set(['Agree with the call', 'Open the moves', 'Open the scoreboard', 'Review draft', 'Brief the shoot', 'Shortlist creators', 'Draft the buyer deck', 'Fix tracking', 'Fix the markup']);
  /* a label that only fits some cards: it names its tool when the card's words agree, else nothing runs */
  const IF_WORDS = { 'Draft the listing': [/\b(amazon|myntra|nykaa|flipkart|ajio|tata cliq|marketplace|listing)\b/i, 'marketplaces'], 'Approve the flows': [/\b(email|flow|klaviyo|newsletter|win-?back|welcome|post-purchase|abandon)\b/i, 'klaviyo'], 'Turn on the journey': [/\b(whatsapp|message|journey|reminder|alert|nudge)\b/i, 'whatsapp'] };
  const deployTarget = (label, card) => { const mf = card?.mf || null, ai = mf?.by === 'ai' && mf.tool ? mf.tool : null, iw = IF_WORDS[label];
    let k = ai ? (ai === 'none' ? null : ai === 'reviews' ? 'loox' : ai) : NO_TOOL.has(label) ? null : iw ? (iw[0].test(`${card?.title || ''} ${card?.sub || ''}`) ? iw[1] : null) : NEEDS[label] || toolInWords(card) || (card?.sector === 'creatives' || card?.sector === 'ads' ? 'meta' : card?.sector === 'storefront' ? 'shopify' : null); if (k === 'loox' && !SEED.connectors.loox) k = SEED.connectors.reviews ? 'reviews' : null; return k && SEED.connectors[k] ? { conn: k, name: SEED.connectors[k].name } : { conn: null, name: 'Brew' }; };
  const colleagueFor = (c) => SEED.colleagues.find((x) => x.id === (c?.sector === 'creatives' || c?.sector === 'visibility' ? 'brandm' : c?.sector === 'ads' ? 'perf' : c?.sector === 'storefront' || c?.sector === 'catalog' ? 'ops' : 'growth'));
  // what a teammate pushes back with, per sector (plain, brand-neutral ones unless the brand's config has its own)
  const GENERIC_PUSHBACK = {
    creatives: 'Love the angle. Is every claim in it one we can back with a source? Legal will ask.',
    ads: 'Numbers look right. Are we raising budget in small steps so we don’t reset learning?',
    storefront: 'Fine by me. Can we test it on half the traffic first?',
    catalog: 'Yes. Which marketplace do we push first, and is the stock there?',
    visibility: 'Good. Keep the “as of” date in the first line so it stays honest.',
    signals: 'Do it. Make sure people who returned an order are left out of the first send.'
  };
  const PUSHBACK = liveView((b) => b.config.pushback || GENERIC_PUSHBACK);
  const later = (ms, fn) => setTimeout(() => { try { const r = fn(); r?.catch?.((e) => log.warn('[work timer]', e.message)); } catch (e) { log.warn('[work timer]', e.message); } }, ms);
  const notify = (t, w, text, kind = 'update') => { t.notes.unshift({ id: uid('n'), itemId: w.id, cardId: w.cardId, title: w.title, img: w.img, text, kind, at: now(t), read: false }); w.unread = true; w.updatedAt = now(t); };
  const move = (t, w, stage, text, kind) => { if (stage === 'deploying' && w.cardId) decideFromAction(t, t.cards.get(w.cardId), w); const was = w.stage; w.stage = stage; if (was !== stage) stepLearn(t, w, stage); w.history.push([stage, now(t)]); w.updatedAt = now(t); if (text) notify(t, w, text, kind); };
  const say = (t, w, m) => { const msg = { id: uid('m'), at: now(t), ...m }; if (msg.from === 'me' && !msg.by) { const p = meOf(t); if (p) { msg.by = p; JAMS.join(w, p, 'replied'); } } w.thread.push(msg); if (msg.by) mailEv(t, w, { kind: 'reply', to: (w.people || []).map((x) => x.email), by: msg.by, text: msg.body, id: msg.id }); if (msg.by) w.lastBy = msg.by.email; w.updatedAt = now(t); JB?.onSay(t, w, msg); };
  const curV = (w) => w.versions.find((v) => v.n === w.current) || w.versions[w.versions.length - 1];
  const addVersion = (t, w, v) => { const n = w.versions.length + 1; w.versions.push({ n, ...v, at: now(t) }); w.current = n; w.title = v.title; if (v.images?.[0]) w.img = v.images[0]; RMX?.onWorkVersion(t, w, v); return n; };
  const workFor = (t, cardId) => t.work.find((w) => w.cardId === cardId && !w.archived && !w.discarded && !['out', 'measuring', 'result'].includes(w.stage));
  const newWork = (t, c) => {
    const w = { id: uid('wk'), cardId: c.id, title: c.title, img: c.images?.[0] || null, agent: c.agent, sector: c.sector, cta: c.cta?.label || null, stage: 'drafting',
      versions: [{ n: 1, title: c.title, sub: c.sub, images: c.images || null, by: 'agent', who: AGENT[c.agent], note: 'The original card', at: now(t) }], current: 1,
      thread: [], with: null, ticket: null, deploy: null, createdAt: now(t), updatedAt: now(t), unread: false, history: [['drafting', now(t)]], ...(c.ctxKey ? { ctxKey: c.ctxKey } : {}), ...(c.bundle?.length ? { bundle: c.bundle } : {}) };
    const me0 = meOf(t); if (me0) { w.startedBy = me0; JAMS.join(w, me0, 'started'); }
    w.cardSnap = clone(c); // a teammate's workspace may not hold this card (an idea or story made elsewhere): the jam carries it
    seedDrafts(w, c, B().firstDrafts, { uid, at: now(t) }); // a first draft Brew made before the jam opened (drafts-bg.js)
    w.cardPlan = planOfCard(c); // the card's plan is the jam's input: the case, the brief and the make step read it
    t.work.unshift(w); t.acted.add(c.id); return w;
  };
  /* a teammate in Slack: answers what was actually asked, from their role, then signs off, asks one thing back, or wants a change */
  const SIGNOFF = /approv|ok to|okay to|good to go|sign.?off|go live|ship it|publish|look at|review|before it goes|green.?light|thoughts\?|happy with/i;
  const ROLE_ANGLE = liveView((b) => b.config.roleAngle || { growth: 'the monthly target and what it does to repeat orders', brandm: `claims, tone and how ${b.name} looks next to its rivals`, perf: 'cost per first order, small budget steps and not resetting Meta learning', ops: 'stock, delivery promises, returns and what the support team will get asked' });
  const colleagueReply = (t, w) => {
    const who = w.with?.name || 'A teammate', id = w.with?.id, role = SEED.colleagues.find((x) => x.id === id)?.role || who;
    const mine = (w.thread || []).filter((m) => m.from === 'me'), last = mine[mine.length - 1]?.body || '';
    const pushed = (w.thread || []).some((m) => m.from === 'colleague' && m.who === who);
    later(pushed ? 5e3 : 7e3, async () => {
      if (w.with?.kind !== 'team') return;
      let r = null;
      if (!isMock() && spend('text')) {
        try {
          const card = t.cards.get(w.cardId) || { title: w.title, sub: curV(w)?.sub || '', agent: w.agent };
          const convo = (w.thread || []).filter((m) => m.from !== 'system').slice(-8).map((m) => `${m.from === 'me' ? 'Colleague' : m.who || (m.from === 'ai' ? 'AI' : 'Brew')}: ${m.body}`).join('\n');
          r = await claudeTool(`${cardBrief({ ...card, ...curV(w), agent: w.agent }, seatLine(t.viewer))}\n\nYou are ${who}, ${BN()}'s ${role}, replying in Slack ${w.with.channel || ''} to a colleague about this work. You care most about ${ROLE_ANGLE[id] || `getting it right for ${BN()}`}.\nThe brief now:\n"""\n${String(w.doc?.md || '').slice(0, 2500)}\n"""\nThe thread so far:\n${convo || '(nothing yet)'}\n\nTheir latest message: "${last}"\n\nReply like a busy, friendly teammate: 1 to 3 short sentences, plain words, no greetings. Answer exactly what they asked, from your role, with one concrete point taken from the brief or the card (a number, a condition, a risk). Never invent numbers. Then decide the verdict: "approve" only if they asked for a sign-off and nothing in your area blocks it (if you already raised a point and they answered it, approve); "question" if you need one thing answered first; "changes" if something must change; "answer" if they asked a question that is not a sign-off.`,
            { type: 'object', required: ['reply', 'verdict'], properties: { reply: { type: 'string', description: '1 to 3 short sentences, in character' }, verdict: { type: 'string', description: 'approve, question, changes or answer' } } }, 700, 'colleague');
          if (r?.reply) r = { reply: clean(r.reply), verdict: String(r.verdict || '').toLowerCase() }; else r = null;
        } catch (e) { log.warn('[colleague]', e.message); r = null; }
      }
      if (!r) { // offline: the old rules, but they follow what was asked
        const ask = SIGNOFF.test(last) || !mine.length;
        r = pushed && ask ? { reply: 'Thanks, that answers my question.', verdict: 'answer' }
          : ask ? { reply: t.cards.get(w.cardId)?.pushback || PUSHBACK[w.sector] || 'Looks good. Anything I should know before it goes out?', verdict: 'question' }
          : /\?\s*$/.test(last) ? { reply: `From the ${role.toLowerCase()} side: fine as long as it stays inside what the brief says. Ping me when it’s ready for a yes.`, verdict: 'answer' }
          : { reply: 'Got it, thanks. Send it over when you want my yes.', verdict: 'answer' };
      }
      // DUMMY: a simulated reply is shown (tagged) but changes nothing: no stage, no approval, no brief, no lesson, no memory
      say(t, w, { from: 'colleague', who, body: r.reply, dummy: true });
      notify(t, w, `Simulated reply from ${who}`);
    });
  };
  const answerOnly = async (t, w, body) => {
    if (!isMock() && spend('text')) { try { const j = await claudeTool(`${cardBrief({ ...(t.cards.get(w.cardId) || {}), ...curV(w), agent: w.agent }, seatLine(t.viewer))}\n\nQuestion: "${body}"`, { type: 'object', required: ['answer'], properties: { answer: { type: 'string', description: 'Under 60 words, plain words, lead with the answer' } } }, 600, 'answer'); if (j.answer) return clean(j.answer); } catch (e) { log.warn('[answer]', e.message); if (e.billing) return 'I can’t answer right now: Brew’s writing is paused for a while. Your question stays here in the jam; ask again later, or tag a teammate.'; } }
    return 'I couldn’t answer that just now. Your question stays here in the jam; try again in a minute, or tag a teammate.'; /* never a canned yes (DUMMY.md: no canned answers) */
  };
  const hashN = (str) => [...String(str)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  // deployment happens off the feed: the item is handed to whoever ships it, then confirmed live
  // the money question, as numbers: the client words it and draws the weekly meter
  // running a card's action carries out its recommended option, so the card is decided from here on
  const decideFromAction = (t, c, w) => { if (!c || (t.decided ||= {})[c.id]) { if (w && !w.decided && t.decided?.[c?.id]) w.decided = t.decided[c.id]; return; }
    const pg = pageNow(t, fillCard(c, t)); const o = pg?.options?.find((x) => x.pick) || pg?.options?.[0]; if (!o) return;
    t.decided[c.id] = o.id; if (w && !w.decided) w.decided = o.id; };
  /* learning from concrete steps only: a decision, a sign-off or pushback, the shared brief.
     Each step runs one pass over the whole context and keeps 0 to 2 lessons that should still hold next month. */
  const STEP = { feedback: 'told us what they think of the card', dismissed: 'said the card is not for them', decided: 'picked a path', ready: 'approved it', signed_off: 'got a teammate’s sign-off', needs_you: 'got pushback', shared: 'shared the brief' };
  // name the step for what really happened: a teammate's yes is not your approval
  const stepOf = (w, stage) => {
    if (stage === 'ready' && w.signedBy) { delete w.signedBy; return 'signed_off'; }
    return stage; };
  const stepLearn = (t, w, stage0) => {
    if (!STEP[stage0] || !w?.cardId) return; const stage = stepOf(w, stage0);
    if (stage === 'needs_you' || stage === 'signed_off') return; // teammate replies are simulated, so they never teach
    if (!stepOnce(t, `${w.id}:${stage}:${w.current}:${stage === 'decided' ? w.decided : ''}`)) return;
    later(1200, () => learnFrom(t, w, stage).catch((e) => log.warn('[learn]', e.message)));
  };
  const learnFrom = async (t, w, stage) => {
    const raw = t.cards.get(w.cardId); if (!raw) return; const c = fillCard(raw, t), pg = pageNow(t, c), ag = c.agent;
    const dec = w.decided || t.decided?.[c.id], chosen = pg?.options?.find((o) => o.id === dec), pick = pg?.options?.find((o) => o.pick);
    const v = curV(w) || {}, have = lessonsFor(t).slice(0, 14);
    let out = null;
    if (!isMock() && spend('text')) {
      const convo = (w.thread || []).filter((m) => m.body && m.from !== 'system' && !m.dummy && !['colleague', 'brew'].includes(m.from)).slice(-14).map((m) => `${m.from === 'me' ? 'Them' : m.who || (m.from === 'ai' ? 'AI' : 'Brew')}: ${String(m.body).slice(0, 300)}`).join('\n');
      const ctx = [`The card (${AGENT[ag]}): ${c.title}. ${c.sub}`,
        pg?.options?.length ? `The options: ${pg.options.map((o) => `${o.name}${o.pick ? ' (Brew pick)' : ''}`).join(' | ')}` : '',
        chosen ? `They chose: ${chosen.name}${pick && pick.id !== chosen.id ? ` (not Brew’s pick, ${pick.name})` : ''}. What changes: ${chosen.effect || ''}` : '',
        v.title ? `Current version v${w.current}: ${v.title}. ${v.sub || ''}` : '',
        w.doc?.md ? `The brief:\n${String(w.doc.md).slice(0, 1800)}` : '',
        convo ? `The conversation:\n${convo}` : ''].filter(Boolean).join('\n\n');
      try {
        const task = '';
        const j = await claudeTool(`${task ? task + '\n\n' : ''}You are Brew’s memory for the brand ${BN()}. A concrete step just happened: the person ${STEP[stage]} on this card. Viewing as: ${SEED.roles[t.viewer?.role]?.title || 'a team member'}.\n\n${ctx}\n\nLessons we already have (id: text):\n${have.map((x) => `${x.id}: ${x.text}`).join('\n') || '(none)'}\n\nWrite 0 to 2 lessons that will still be true next month and would change how Brew recommends, writes or ships for ${BN()} or for this person. A lesson is a preference, a constraint, or what works, said in one plain sentence under 20 words. Never restate this one card, never guess beyond the evidence, never invent numbers. If nothing durable was shown, return an empty list. If a lesson is one we already have, put its id in same (else empty). kind is brand (true for ${BN()} whoever is looking: team taste, legal lines, what works) or you (how this person likes to work). Write every you lesson to the person, in second person, as a working preference they would nod at: start with “You” (“You like plans with dated milestones, so progress shows early”). Never write “this person”, “the user” or “the founder”, never describe their personality, and never use judge, judged or judging. why is the evidence from this step, under 15 words. Never guess anyone’s gender: write about the person with they/their, or leave the pronoun out.`,
          { type: 'object', required: ['lessons'], properties: { lessons: { type: 'array', items: { type: 'object', required: ['kind', 'text', 'why', 'same'], properties: { kind: { type: 'string' }, text: { type: 'string' }, why: { type: 'string' }, same: { type: 'string' }, ...(stage === 'result' ? { effect: { type: 'string', description: 'moved, flat, or other (other = not about what moved the number)' } } : {}) } } } } }, 900, 'learn');
        out = (j?.lessons || []).slice(0, 2).map((x) => ({ kind: x.kind, text: clean(x.text), why: clean(x.why), same: x.same || null, effect: x.effect || null }));
      } catch (e) { log.warn('[learn]', e.message); }
    }
    if (!out) { // offline: only what the step itself proves
      const cut = (x, n) => { x = String(x || ''); return x.length <= n ? x : x.slice(0, n).replace(/\s+\S*$/, '') + '…'; };
      out = [];
      if (stage === 'decided' && chosen && pick) out.push(chosen.id === pick.id ? { kind: 'you', text: `You usually go with Brew’s pick on ${AGENT[ag]} calls`, why: `Chose “${chosen.name}”` } : { kind: 'you', text: `You often take your own path on ${AGENT[ag]} calls`, why: `Chose “${chosen.name}” over “${pick.name}”` });
      if (stage === 'needs_you') { const m = w.thread.slice(-1)[0]; out.push({ kind: 'brand', text: `${m.who} checks this before a yes: ${String(m.body).replace(/^[^.?!]*[.!]\s*/, '').slice(0, 110)}`, why: `Pushback on “${cut(c.title, 40)}”` }); }
      if (stage === 'feedback') out.push({ kind: 'you', text: `On ${AGENT[ag]} cards: ${String(w.thread[0]?.body || '').slice(0, 100)}`, why: `Feedback on “${cut(c.title, 40)}”` });
      if (stage === 'dismissed') out.push({ kind: 'you', text: `You’d rather skip cards like “${cut(c.title, 50)}”`, why: 'Tapped Not for me' });
    }
    out.forEach((x) => { const y = addLesson(t, { ...x, agent: ag, step: STEP[stage], title: c.title }, now(t)); if (y) log.log?.(`[learn] ${stage}: ${y.text}`); });
    if (out.length) store?.save(t);
  };
  const actWork = (t, p) => t.work.find((x) => x.id === p.wid);
  // the canvas for a card nothing matched: the AI picks the blocks from the same library (data/canvas-blocks.json)
  const CANVAS_LIB = JSON.parse(fs.readFileSync(path.join(PUB, 'data/canvas-blocks.json'), 'utf8'));
  const canvasCompose = async (t, w) => {
    const c0 = t.cards.get(w.cardId), c = c0 ? fillCard(c0, t) : { title: w.title, sub: curV(w)?.sub || '', agent: w.agent, sector: w.sector }, ids = Object.keys(CANVAS_LIB.blocks);
    if (isMock() || !claudeTool) return { blocks: CANVAS_LIB.fallback, by: 'fallback' };
    const r = await claudeTool(`${cardBrief(c)}\n\nThe brief:\n${String(w.doc?.md || '').slice(0, 2000)}\n\nPick the blocks that show this work as it will really look, in order (2 to 5). Blocks:\n${ids.map((k) => `- ${k}: ${CANVAS_LIB.blocks[k]}`).join('\n')}`,
      { type: 'object', properties: { blocks: { type: 'array', items: { type: 'string', enum: ids } } }, required: ['blocks'] }, 300, 'canvas').catch(() => null);
    return { blocks: (r?.blocks || []).filter((b) => ids.includes(b)).slice(0, 5).concat(r?.blocks?.length ? [] : CANVAS_LIB.fallback), by: r?.blocks?.length ? 'ai' : 'fallback' };
  };
  // the brief's audience in plain words → the segment rules Brew can run on the brand's customers
  /* what goes out is the version on the jam's stage (its package), then the brief's words, then the card's */

  const setupOn = () => {
    // sending setup: the sender, the brand's own customers, WhatsApp on their number
    // a photo added in the jam: the product shot drafts are made from
    on('POST', '/api/work/:wid/reference', async (b, t, p) => { const w = actWork(t, p); if (!w) return { error: 'not found' };
      const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/.exec(String(b.data || '')); if (!m) return { error: 'Add a PNG, JPG or WebP photo.' };
      const buf = Buffer.from(m[3], 'base64'); if (buf.length > 8e6) return { error: 'That photo is over 8 MB.' };
      const name = `ref-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${m[2] === 'jpeg' ? 'jpg' : m[2]}`; saveGen(name, buf);
      const rel = `gen/${name}`, c = t.cards.get(w.cardId); w.refImages = [rel, ...(w.refImages || [])].slice(0, 4); if (c) c.refImages = w.refImages;
      say(t, w, { from: 'system', body: `Added a photo${b.name ? ` (${String(b.name).slice(0, 60)})` : ''}. Drafts use it as the product shot.` }); store?.save(t); return { work: w }; });
    // knobs on every jam: a jam on a card that has a remix recipe gets its change package (the knobs and versions read it)
    /* fast: the package is made from the card at once and its copy is written in the background (remix.js fillLater) */
    linkChange = async (t, w) => { if (w.changeId || !w.cardId || !t.cards.get(w.cardId)) return { work: w };
      const r = await routeFn('POST', '/api/cards/:cid/remix')({ fast: true }, t, { cid: w.cardId }).catch((e) => ({ error: e.message })); const ch = r?.changes?.[0]; if (!ch) return { work: w };
      w.changeId = ch.id; const raw = t.changes?.[ch.id]; if (raw) raw.workId = w.id; store?.save(t); return { work: w, change: ch }; };
    on('POST', '/api/work/:wid/link-change', async (b, t, p) => { const w = actWork(t, p); if (!w) return { error: 'not found' }; return linkChange(t, w); });
    on('POST', '/api/work/:wid/canvas', async (b, t, p) => { const w = actWork(t, p); if (!w) return { error: 'not found' }; if (!w.canvas || b.again) { w.canvas = await canvasCompose(t, w); store?.save(t); } return { work: w }; });
    /* how this change would be measured: what the brief says about it
       (holdout = the control group share the tray starts with; the grade is A only when a control group can be kept) */
  };

  /* ---------- http ---------- */
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
  const routeFn = (m, pat) => ROUTES.find((r) => r.method === m && r.pattern === pat)?.fn;
  const ROUTES = [];
  const on = (method, pattern, fn) => ROUTES.push({ method, pattern, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
  const T = (id) => tenants.get(id);

  on('POST', '/api/tenants', async (b) => { const t = newTenant(b.url, b.snapshot); if (b.snapshot?.onboarded) t.onboarding.readyAt = t.onboarding.startedAt = Date.now(); return { id: t.id, host: t.host }; });
  on('GET', '/api/tenants/:id/onboarding', null); // SSE, handled below
  on('POST', '/api/tenants/:id/ready', async (b, t) => { t.onboarding.readyAt = Date.now(); t.onboarding.startedAt ||= Date.now(); WATCHERS.forEach((w) => (t.watchers[w.id].nextRun = now(t) + w.firstAt)); return { ms: t.onboarding.readyAt - t.onboarding.startedAt }; });
  on('GET', '/api/tenants/:id/feed-config', async (b, t) => ({ brand: SEED.brand, vocab: SEED.vocab, plan: t.plan, currency: B().config?.currency || null }));
  /* "in your own words": not a menu. What works for the brand, what doesn't, what they've learned and what comes first,
     typed or said. It maps onto the picks (focus, product) and a few terms the ranker lifts, and it is brand learnings:
     for the brand's team it runs through brand-learnings.js (the brief every move and doc is written from, brand memory,
     the moves it changes, then the cards); for anyone else it stays in this feed's memory, which its agents read */
  on('POST', '/api/tenants/:id/focus', async (b, t) => {
    const full = String(b.text || '').replace(/\r/g, '').trim().slice(0, 20000), text = clean(full).slice(0, 600).trim(); if (!text) return { error: 'Tell Brew what works for you, what doesn’t, or what comes first.' };
    const W = Object.entries(SEED.wants || {}), L = Object.entries(SEED.lanes || {});
    let j = null;
    if (!isMock() && spend('text')) { try { j = await claudeJSON(`A ${SEED.roles[t.viewer.role]?.title || 'founder'} at ${BN()} told Brew about the brand: what works, what doesn't, what they've learned, what should come first:\n"${text}"\n\nMap it. Card types (pick up to 2 that fit what they want first, or none): ${W.map(([k, w]) => `${k} = ${w.name}: ${w.line}`).join('; ')}.\nProducts (pick one only if they name or clearly mean it, else null): ${L.map(([k, l]) => `${k} = ${l.name}`).join('; ')}.\nTerms: up to 8 short lowercase words or phrases a matching card would contain (products, channels, metrics, rivals, topics they named). Note: what they told Brew in one plain sentence, max 25 words, their words where possible.\nJSON: {"wants":[],"lane":null,"terms":[],"note":""}`, 400); } catch {} }
    const terms = (Array.isArray(j?.terms) && j.terms.length ? j.terms : (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{3,}/gu) || []).filter((w) => !/^(want|need|more|less|first|feed|show|about|that|this|with|from|have|like|what|which|should|would|really|focus|care|they|their|them|then|than|into|just|only|also|some|very|works|doesn't|does|learned|learnt)$/.test(w)))
      .map((x) => String(x).toLowerCase().trim()).filter((x) => x.length > 2 && x.length < 40).slice(0, 8);
    const wants = (Array.isArray(j?.wants) ? j.wants : []).filter((k) => SEED.wants?.[k]).slice(0, 2);
    const lane = (j?.lane && SEED.lanes?.[j.lane] ? j.lane : null) || L.find(([, l]) => l.name && text.toLowerCase().includes(String(l.name).toLowerCase()))?.[0] || null; /* naming a product picks it, AI or not */
    t.viewer = { ...t.viewer, focusNote: full.slice(0, 4000), focusTerms: terms, ...(wants.length ? { wants } : {}), ...(lane ? { lane } : {}) };
    t.memory = (t.memory || []).filter((m) => m.kind !== 'focus'); t.memory.unshift({ id: uid('m'), type: 'preference', kind: 'focus', fact: `${SEED.roles[t.viewer.role]?.title || 'The founder'} told Brew: ${cutWords(clean(full), 500)}`, source: 'Said in setup', at: now(t) });
    /* the brand's team: brand learnings, in the background (reading, the brief, memory and move rewrites take minutes) */
    const r = reqOf(t); let learning = false;
    if (o.learnings && r?.member && process.env.DEMO_MODE !== '1' && full.length >= 40) {
      learning = true; const by = r.name || r.email || 'the team', byShort = r.name ? String(r.name).split(/\s+/)[0] : r.email || '';
      o.learnings.run(t.brandId || DEFAULT_BRAND, { text: full, by, byShort, why: 'setup', ask: false })
        .then((out) => { t.learnedFromSetup = { at: Date.now(), n: out.applied?.length ?? 0, moves: out.moves?.rewrite?.ns?.length || 0 }; store?.save(t); })
        .catch((e) => log.warn?.('[learn] setup', t.brandId, e.message));
    }
    store?.save(t);
    return { viewer: t.viewer, note: String(j?.note || '').slice(0, 200) || null, wants, lane, terms, learning };
  });
  on('PUT', '/api/tenants/:id/state', async (b, t) => {
    if (b.viewer) { t.viewer = { ...t.viewer, ...b.viewer }; clampSeat(t); }
    if (b.conn) { const was = t.conn || {}; t.conn = { ...b.conn };
      // a newly connected source: work that measures from it starts reading real numbers
      const added = Object.keys(t.conn).filter((k) => t.conn[k] && !was[k] && !t.liveConn?.[k]);
      if (added.length) for (const w of Object.values(t.work || {})) if (w?.measure?.from && added.includes(w.measure.from)) w.measure.connected = true;
      // a generated brand: the account's (demo) numbers join the moves' evidence and flag the moves they change
      const gone = Object.keys(was).filter((k) => was[k] && !t.conn[k] && !t.liveConn?.[k]);
      if (B().kind === 'generated' && !t.claimed) { if (added.length) builder?.connected(B().slug, added, true).catch(() => {}); if (gone.length) builder?.connected(B().slug, gone, false).catch(() => {}); }
    }
    if (typeof b.pro === 'boolean' && b.pro && t.plan !== 'pro') { t.plan = 'pro'; t.proAt = Date.now(); }
    return { ok: true };
  });
  on('GET', '/api/tenants/:id/feed', async (b, t) => { repairHeartKids(t); syncBatches(t); if (B().kind === 'generated') streamSync(t, SEED.posts); const f = feed(t); return { ...f, cards: allCards(t), batches: t.batches, health: t.health, decided: t.decided || {}, clock: now(t) }; });
  on('GET', '/api/tenants/:id/deck', async (b, t) => {
    const { top, ranked, scores } = rank(t); const list = withChildren(t, [...top, ...ranked]);
    const cols = {}; ['signals', 'catalog', 'creatives', 'ads', 'storefront', 'visibility'].forEach((k) => (cols[k] = list.filter((c) => c.sector === k).map((c) => c.id)));
    return { columns: cols, counts: Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.length])), layout: t.deck, cards: allCards(t), scores };
  });
  on('PUT', '/api/tenants/:id/deck-layout', async (b, t) => { if (Array.isArray(b.hidden)) t.deck.hidden = b.hidden; if (b.colWidth) t.deck.colWidth = b.colWidth; return t.deck; });
  on('GET', '/api/tenants/:id/stories', async (b, t) => { await Promise.race([research?.ready?.(), new Promise((r) => setTimeout(r, 8000).unref?.())]).catch(() => {}); return { rings: stories(t) }; });
  on('POST', '/api/tenants/:id/stories/:ring/seen', async (b, t, p) => { t.storySeen[p.ring] = Date.now(); return { ok: true }; });
  // a story slide's button: the matching card, made now if the watcher has not posted it yet
  on('POST', '/api/tenants/:id/research-card', async (b, t) => {
    const base = researchCard(b.kind, b.id); if (!base) return { error: 'not found' };
    if (t.cards.has(base.id)) return { card: pub(t.cards.get(base.id), t) };
    t.used.add(base.id);
    const c = { ...fillCard(base, t), family: base.family || FAMILY[base.type] || 'idea', origin: 'story', createdAt: now(t), time: 'Just now', history: [], shownCount: 0 };
    setState(t, c, 'proposed'); setState(t, c, 'qa');
    t.qa.unshift({ id: uid('qa'), cardId: c.id, title: c.title, by: 'Story', attempt: 1, checks: qaCheck(c, t), result: 'pass', at: now(t) });
    setState(t, c, 'ready'); t.cards.set(c.id, c);
    return { card: pub(c, t) };
  });
  on('POST', '/api/tenants/:id/pin', async (b, t) => { const ids = new Set(b.ids || []); t.pinned = [...[...ids].map((id) => ({ id, at: now(t) })), ...(t.pinned || []).filter((x) => !ids.has(x.id))].slice(0, 8); return { pinned: t.pinned.map((x) => x.id) }; });
  /* genuinely new since the person last looked: posted by a watcher after `since`, not part of the first load, not shown
     before, still waiting to be seen, and one per title (a rotation that re-posts the same card doesn't count again) */
  const newSince = (t, since) => { const seen = new Set(); return [...t.cards.values()].filter((c) => c.origin === 'watcher' && c.state === 'ready' && !c.initial && !t.shown?.[c.id] && c.createdAt > since && visible(t, c))
    .filter((c) => { const k = String(c.title || c.id).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
  on('GET', '/api/tenants/:id/pulse', async (b, t, p, q) => {
    const since = +q.get('since') || 0;
    const fresh = newSince(t, since);
    return { newCards: fresh.length, ids: fresh.map((c) => c.id), titles: fresh.slice(0, 3).map((c) => c.title), batches: t.batches, health: t.health, jams: t.jams.map((j) => ({ id: j.id, ticket: j.ticket, status: j.status, last: j.messages.slice(-1)[0], updatedAt: j.updatedAt })), clock: now(t) };
  });
  on('POST', '/api/tenants/:id/events', async (b, t) => { const n = now(t); (b.shown || []).forEach((id) => { const c = t.cards.get(id); if (!c) return; (t.shown[id] ||= []).push(n); c.shownCount = (c.shownCount || 0) + 1; if (c.state === 'ready') setState(t, c, 'shown'); }); return { ok: true }; });
  on('POST', '/api/tenants/:id/cards', async (b, t) => {
    const parent = b.parentCardId ? t.cards.get(b.parentCardId) : null;
    const c = { ...(parent ? clone(parent) : {}), ...b.card, id: uid(b.origin || 'user'), parentCardId: b.asChild ? b.parentCardId : null, origin: b.asChild ? (b.origin || 'jam') : 'user', byRole: null, live: null, done: null, time: 'Just now', createdAt: now(t), history: [] };
    delete c.state; setState(t, c, 'proposed'); setState(t, c, 'qa');
    const checks = qaCheck(c, t); t.qa.unshift({ id: uid('qa'), cardId: c.id, title: c.title, by: b.origin === 'remix' ? 'Remix' : 'Jam', attempt: 1, checks, result: checks.every((x) => x.ok || x.k === 'Names a number') ? 'pass' : 'pass with notes', at: now(t) });
    setState(t, c, 'ready'); t.cards.set(c.id, c); if (parent) t.acted.add(parent.id);
    return { card: pub(c) };
  });
  on('GET', '/api/cards/:cid', async (b, t, p) => { const c = t.cards.get(p.cid); return c ? { card: pub(c) } : { error: 'not found' }; });
  on('POST', '/api/cards/:cid/feedback', async (b, t, p) => {
    const c = t.cards.get(p.cid); if (!c) return { error: 'not found' };
    const W = { heart: 1, unheart: -1, not_interested: -1, fewer_agent: -2, snooze: 0, snooze_agent: 0 };
    t.feedback.push({ id: uid('f'), cardId: c.id, userId: 'viewer', kind: b.kind, weight: W[b.kind] ?? 0, at: now(t) });
    if (b.kind === 'heart') { t.acted.add(c.id); t.memory.unshift({ id: uid('m'), type: 'feedback', fact: `Hearted a ${AGENT[c.agent]} card: “${c.title}”`, source: 'card feedback', at: now(t) }); return { child: pub(heartChild(t, c)) }; }
    if (b.kind === 'not_interested') { setState(t, c, 'dismissed'); t.memory.unshift({ id: uid('m'), type: 'feedback', fact: `Not interested: “${c.title}”`, source: 'card feedback', at: now(t) }); }
    if (b.kind === 'fewer_agent') { t.fewer[c.agent] = (t.fewer[c.agent] || 0) + 1; t.memory.unshift({ id: uid('m'), type: 'feedback', fact: `Show fewer from ${AGENT[c.agent]}`, source: 'card feedback', at: now(t) }); }
    if (b.kind === 'snooze') t.snoozed[c.id] = dayKey(now(t));
    // "Tell us why": kept for the ShopOS team, written to brand memory, and a step Brew learns from
    if (b.kind === 'note' && String(b.text || '').trim()) { const text = String(b.text).trim().slice(0, 500); (t.cardNotes ||= []).unshift({ id: uid('cn'), cardId: c.id, title: c.title, agent: c.agent, text, useful: b.useful ?? null, at: now(t) }); t.memory.unshift({ id: uid('m'), type: 'feedback', fact: `On “${c.title}”: ${text}`, source: 'card feedback', at: now(t) }); }
    if (['note', 'not_interested'].includes(b.kind)) stepLearn(t, { id: `fb:${c.id}:${now(t)}`, cardId: c.id, thread: [{ from: 'me', body: b.kind === 'note' ? String(b.text || '') : 'Not for me' }], versions: [], current: 1 }, b.kind === 'note' ? 'feedback' : 'dismissed');
    return { ok: true };
  });
  // what an action will do, before it runs: the path it carries out, what changes and where, who ships it, what it spends,
  // how and when we measure it, when we stop, and where it shows up next. Built from the same data the action uses.
  /* a card's action never runs from the card (Param, 2026-10-14): it opens the card's jam with the card's plan as its input.
     Nothing ships, spends, or counts as decided here; the jam's make step and Share the brief do that */
  on('POST', '/api/cards/:cid/actions', async (b, t, p) => {
    const c = t.cards.get(p.cid); if (!c) return { error: 'not found' };
    const w = workFor(t, c.id) || newWork(t, c); w.cardPlan ||= planOfCard(c); JB.seed(t, w);
    return { jam: true, work: w, plan: w.cardPlan };
  });
  // remake a card's image when its generated file is gone (or on request). Same model and rules as the creative agent.
  on('POST', '/api/cards/:cid/image', async (b, t, p) => {
    const c = t.cards.get(p.cid); if (!c) return { error: 'not found' };
    if (isMock() || !spend('image')) return { error: 'Images are paused right now. Try again in a bit.' };
    const lane = LANE_PHOTO[c.lane] ? c.lane : Object.keys(LANE_PHOTO)[0];
    const buf = await geminiImage({ srcFile: photoFile(LANE_PHOTO[lane] || Object.values(LANE_PHOTO)[0]), prompt: `Create a new product photograph for this ad idea: ${c.title}. ${c.scene || ''} ${`Keep the ${BN()} ${B().config.product?.noun || 'product'} and its label exactly as in the reference`}. ${B().config.product?.avoid || 'No text, no before/after.'} ${(B().config.product?.style || 'Premium D2C product ad photography') + '.'}`, ratio: '4:5', model: process.env.WATCHER_IMAGE_MODEL || 'gemini-2.5-flash-image' });
    const key = crypto.createHash('sha1').update(c.id + ':' + Date.now()).digest('hex').slice(0, 16), url = `gen/${key}.png`; saveGen(key + '.png', buf);
    const old = String(b.src || '').replace(/^\/+/, '');
    const swap = (arr) => { if (!Array.isArray(arr)) return arr; const i = arr.findIndex((u) => u === old); if (i >= 0) { const n = arr.slice(); n[i] = url; return n; } return arr; };
    c.images = old && (c.images || []).includes(old) ? swap(c.images) : [url, ...(c.images || []).slice(1)];
    for (const w of t.work) if (w.cardId === c.id) { if (w.img === old) w.img = url; (w.versions || []).forEach((v) => { v.images = swap(v.images); }); }
    return { url, card: pub(c, t) };
  });
  on('GET', '/api/tenants/:id/engine', async (b, t) => engine(t));
  on('POST', '/api/tenants/:id/watchers/:wid/run', async (b, t, p) => { const w = WATCHERS.find((x) => x.id === p.wid); if (!w) return { error: 'no watcher' }; const made = await runWatcher(t, w, 'manual'); return { made: made.map(pub) }; });
  /* run every watcher now; the creative one writes with the AI (~15 s), so it finishes in the background and its card
     lands through the feed's pulse instead of holding the reply */
  const runAll = async (t, why) => { const made = [], slow = WATCHERS.filter((w) => w.id === 'creative');
    for (const w of WATCHERS) if (!slow.includes(w)) made.push(...(await runWatcher(t, w, why)));
    slow.forEach((w) => runWatcher(t, w, why).then(() => touch(t), (e) => console.warn('[watchers] creative', e.message)));
    return { made: made.length, pending: slow.length }; };
  on('POST', '/api/tenants/:id/watchers/run-all', async (b, t) => runAll(t, 'manual'));
  on('POST', '/api/tenants/:id/clock', async (b, t) => {
    t.clock += (b.days || 1) * D; touch(t); housekeep(t);
    return { clock: now(t), ...(await runAll(t, 'overnight')) };
  });

  /* work board endpoints */
  const teamJam = (t, id) => (JAMS.peek(t.brandId || DEFAULT_BRAND)?.work || []).find((x) => x.id === id) || null; /* a link's jam, whoever opens it */
  const W = (t, id) => { const w = t.work.find((x) => x.id === id); return w && DR ? DR.heal(w) : w; }; /* heal: a draft cut off by a restart stops showing as 'making' */
  // a jam started from scratch is called "New jam" until its brief has a name; then it takes the brief's heading
  const GENERIC = /^(new jam|untitled)$/i;
  const titleFromDoc = (w) => { if (!GENERIC.test(String(w.title || '').trim())) return; const h = /^#\s+(.+)$/m.exec(w.doc?.md || '')?.[1]?.trim(); if (h && !GENERIC.test(h)) w.title = h.slice(0, 120); };
  // before shortcut jams were reused, every click made a copy. Keep the one with the most in it, hide the empty copies (archived, not deleted)
  const SHORTCUT = new Proxy({}, { get: (_, k) => /^Lift .+’s score$/.test(String(k)) ? 'moves' : k === 'Week-one statics batch' ? 'batch' : undefined }); // any brand's name
  const dedupeShortcuts = (t) => {
    if (t._dedupe1) return; t._dedupe1 = true;
    const groups = {};
    for (const w of t.work) if (String(w.cardId || '').startsWith('jam-') && !w.archived && (SHORTCUT[w.title] || /^\d+ saved cards, (one plan|\d+ plans)$/.test(w.title))) (groups[w.title] ||= []).push(w);
    for (const [title, ws] of Object.entries(groups)) {
      const weight = (w) => (w.thread || []).length * 10 + (w.doc?.rev || 0) + (w.stage === 'drafting' ? 0 : 100);
      const keep = [...ws].sort((a, b) => weight(b) - weight(a) || b.updatedAt - a.updatedAt)[0];
      if (SHORTCUT[title] && !keep.ctxKey) keep.ctxKey = SHORTCUT[title];
      for (const w of ws) if (w !== keep && w.stage === 'drafting' && (w.thread || []).filter((m) => m.from === 'me').length <= 1) w.archived = true;
    }
  };
  const shown0 = (w) => !w.archived && !w.discarded;
  /* a guest of a jam sees that jam only, never the rest of the team's */
  const guestSees = (t) => { const g = reqOf(t)?.guest; return g ? (w) => g.wids.includes(w.id) : () => true; };
  let shown = shown0;
  /* a jam out to the client: unread is this person's (they haven't opened it since it changed), and who has it open now */
  const jamOut = (t, w) => { const me0 = meOf(t), seen = me0 ? w.reads?.[me0.email] : null; return { ...w, cardSnap: undefined, unread: me0 ? (w.updatedAt > (seen || 0) && (w.people || []).some((p) => p.email === me0.email) && w.lastBy !== me0.email) : !!w.unread, mine: !!me0 && JAMS.isIn(w, me0.email), here: JAMS.here(w.id).filter((p) => p.email !== me0?.email) }; };
  const workOut = (t) => { const see = guestSees(t); shown = (w) => shown0(w) && see(w); try { return workOut0(t); } finally { shown = shown0; } };
  const workOut0 = (t) => (repairHeartKids(t), dedupeShortcuts(t), fixTickets(t), t.work.forEach((w) => { RMX.ensurePlan(t, w); if (w.cardId && !w.cardPlan && t.cards.get(w.cardId)) w.cardPlan = planOfCard(t.cards.get(w.cardId)); /* jams opened before plans heal */ if (!['measuring', 'result'].includes(w.stage)) JB.seed(t, w); titleFromDoc(w); }), { items: t.work.filter(shown).map((w) => jamOut(t, w)), discarded: t.work.filter((w) => !w.archived && w.discarded && guestSees(t)(w)).map((w) => jamOut(t, w)), me: meOf(t), notes: t.notes.slice(0, 40), unread: t.notes.filter((n) => !n.read).length, needsYou: t.work.filter((w) => shown(w) && w.stage === 'needs_you').length });
  on('GET', '/api/tenants/:id/work', async (b, t) => workOut(t));
  // discard a jam (kept under Discarded, can be restored). Something live is undone first, never discarded under people.
  on('POST', '/api/work/:wid/discard', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' };
    if (['deploying', 'measuring'].includes(w.stage)) return { error: 'It’s live. Undo it first, then discard it.' };
    w.discarded = now(t); w.unread = false;
    // its remix leaves the jam too, back in the studio
    const ch = w.changeId && RMX?.changes(t)[w.changeId]; if (ch?.state === 'jam') ch.state = 'draft';
    return { work: w };
  });
  on('POST', '/api/work/:wid/restore', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' };
    if (w.cardId && !String(w.cardId).startsWith('jam-') && workFor(t, w.cardId)) return { error: 'This card already has an open jam. Discard that one first.' };
    delete w.discarded; w.updatedAt = now(t); return { work: w };
  });
  // clear: drop notifications (all, or one jam's) from the list. The jams themselves are untouched
  on('POST', '/api/tenants/:id/notes/clear', async (b, t) => { const keep = (n) => (b.itemId ? n.itemId !== b.itemId : false); t.notes = t.notes.filter(keep); if (!b.itemId) t.work.forEach((w) => (w.unread = false)); else { const w = W(t, b.itemId); if (w) w.unread = false; } return { notes: t.notes.slice(0, 40), unread: t.notes.filter((n) => !n.read).length }; });
  on('POST', '/api/tenants/:id/notes/read', async (b, t) => { t.notes.forEach((n) => { if (!b.ids || b.ids.includes(n.id) || (b.itemId && n.itemId === b.itemId)) n.read = true; }); if (b.itemId) { const w = W(t, b.itemId); if (w) w.unread = false; } return { unread: t.notes.filter((n) => !n.read).length }; });
  on('POST', '/api/work', async (b, t) => {
    const ctxKey = typeof b.card?.ctxKey === 'string' ? b.card.ctxKey.slice(0, 400) : null;
    const live = (w) => !w.archived && !w.discarded && !['deploying', 'out', 'measuring', 'result'].includes(w.stage);
    const running = ctxKey && (t.work.find((w) => w.ctxKey === ctxKey && live(w)) || t.work.find((w) => !w.ctxKey && live(w) && String(w.cardId).startsWith('jam-') && w.title === b.card.title));
    if (running) { const me0 = meOf(t); if (me0 && !JAMS.isIn(running, me0.email)) JAMS.join(running, me0, 'joined'); running.ctxKey ||= ctxKey; JB.seed(t, running); return { work: running }; }
    let c = t.cards.get(b.cardId);
    if (!c && b.card?.title) { c = { ...b.card, id: String(b.cardId).replace(/^work:/, 'wc-'), state: 'ready', origin: 'signal', createdAt: now(t), history: [['ready', now(t)]] }; delete c.measure; if (c.bundle != null) c.bundle = Array.isArray(c.bundle) ? [...new Set(c.bundle)].filter((id) => typeof id === 'string' && t.cards.has(id)).slice(0, 12) : null; t.cards.set(c.id, c); }
    if (!c) return { error: 'not found' }; const had = workFor(t, c.id), w = had || newWork(t, c);
    /* one jam per card, the team over: a second person tapping Jam joins the open one */
    if (had) { const me0 = meOf(t); if (me0 && !JAMS.isIn(had, me0.email)) { JAMS.join(had, me0, 'joined'); say(t, had, { from: 'system', body: `${me0.name || me0.email} joined the jam` }); } } if (b.decided && !w.decided) w.decided = b.decided; if (!w.decided && t.decided?.[c.id]) w.decided = t.decided[c.id]; JB.seed(t, w);
    /* opening a jam: the work and its change package in one round trip (link) */
    if (b.link && linkChange) return linkChange(t, w);
    return { work: w }; });
  on('POST', '/api/work/:wid/iterate', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' };
    const body = String(b.body || '').trim();
    // a jam that came from the remix studio keeps working on the package itself
    if (w.changeId && RMX) { const r = await RMX.iterateFromJam(t, w, body); if (r?.error) return r; if (r) { if (w.stage !== 'drafting' && ['team', 'brew', 'needs_you'].includes(w.stage) === false) move(t, w, 'drafting', null); return { work: w, change: r.change }; } }
    say(t, w, { from: 'me', body });
    const decision = await routeJam(t, body, false);
    t.router.unshift({ id: uid('r'), body: body.slice(0, 140), card: w.title, ...decision, at: now(t) });
    if (decision.route === 'team') {
      /* a person is needed: Brew says so; the brief goes to the team by Share the brief (copied), nothing is sent from here */
      say(t, w, { from: 'system', body: `This needs ${decision.label}. Finish the jam, then share the brief with your team or the ShopOS team.` });
      return { decision, work: w };
    }
    if (w.stage !== 'drafting') move(t, w, 'drafting', null);
    if (decision.intent === 'answer') { say(t, w, { from: 'ai', who: AGENT[w.agent], body: await answerOnly(t, w, body) }); return { decision, work: w }; }
    const base = curV(w); const card = t.cards.get(w.cardId) || { agent: w.agent };
    const r = await makeVersions(t, { ...card, title: base.title, sub: base.sub }, body);
    say(t, w, { from: 'ai', who: AGENT[w.agent] || 'Agent', body: r.line, tiles: r.versions, live: r.live });
    t.versions.push({ id: uid('v'), cardId: w.cardId, workId: w.id, prompt: body, by: 'agent', at: now(t), versions: r.versions });
    return { decision, work: w };
  });
  on('POST', '/api/work/:wid/pick', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' };
    const m = w.thread.find((x) => x.id === b.msgId); const tile = m?.tiles?.[b.i]; if (!tile) return { error: 'no tile' };
    m.picked = b.i; const base = curV(w);
    const n = addVersion(t, w, { title: tile.title, sub: tile.sub, images: base.images, by: 'ai', who: AGENT[w.agent], note: tile.angle });
    say(t, w, { from: 'system', body: `v${n} saved: ${tile.angle || 'new version'}` }); return { work: w };
  });
  on('POST', '/api/work/:wid/edit', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const base = curV(w); const n = addVersion(t, w, { title: clean(b.title || base.title), sub: clean(b.sub || base.sub), images: b.images || base.images, by: 'you', who: 'You', note: b.note || 'Your edit' }); say(t, w, { from: 'system', body: `v${n} saved: ${b.note || 'your edit'}` }); if (w.stage !== 'drafting') move(t, w, 'drafting', null); return { work: w }; });
  on('POST', '/api/work/:wid/version', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; if (w.versions.some((v) => v.n === b.n)) { RMX?.pickFromJam(t, w, b.n); w.current = b.n; w.title = curV(w).title; say(t, w, { from: 'system', body: `Back to v${b.n}` }); } return { work: w }; });
  /* @teammate in the jam. DUMMY: the teammate's reply is simulated (colleagueReply, from their role); the real build posts
     to the brand's Slack and brings the replies back. See DUMMY.md */
  on('POST', '/api/work/:wid/send', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' }; const note = String(b.note || '').trim();
    if (b.to !== 'team') return { error: 'Share the brief to send it to the ShopOS team.' };
    if (process.env.DEMO_MODE !== '1') return { error: 'Tag a teammate with @ in the chat.' }; /* the simulated teammate lives on the demo site only */
    const c = SEED.colleagues.find((x) => x.id === b.colleague) || colleagueFor({ sector: w.sector });
    w.with = { kind: 'team', id: c.id, name: b.name || b.names?.[c.id] || c.name, channel: b.channel || '#growth', dummy: true };
    say(t, w, { from: 'me', body: note || `@${w.with.name} can you look at v${w.current}?`, to: w.with.name });
    move(t, w, 'team', null); colleagueReply(t, w);
    return { work: w };
  });
  /* a message to the people in the jam. @someone tags them: they join the jam and get an email right away */
  on('POST', '/api/work/:wid/message', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' }; const body = String(b.body || '').trim(); if (!body) return { error: 'Write something first.' };
    const me0 = meOf(t), EM = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
    /* an email nobody on the team has yet: tagging it invites them (they join on sign-in) and pulls them into this jam */
    const fresh = [...new Set((Array.isArray(b.invite) ? b.invite : []).map((e) => String(e || '').toLowerCase().trim()).filter((e) => EM.test(e) && e !== me0?.email))].slice(0, 5); const invited = [];
    if (fresh.length && me0 && o.inviteTo && reqOf(t)?.member) { for (const e of fresh) { if ((await tagsOf(t, w, [e])).length) continue; const r = await o.inviteTo(t.brandId || DEFAULT_BRAND, me0, e).catch((x) => ({ error: x.message })); if (r?.error) return { error: r.error }; invited.push(e); } }
    const tags = (await tagsOf(t, w, [...(b.mentions || []), ...fresh])).filter((x) => x.email !== me0?.email);
    for (const x of tags) JAMS.join(w, x, 'tagged');
    say(t, w, { from: 'me', body, ...(tags.length ? { to: tags.map((x) => x.email) } : {}) });
    if (tags.length) mailEv(t, w, { kind: 'tagged', to: tags.map((x) => x.email), by: me0, text: body, id: w.thread[w.thread.length - 1].id });
    if (b.shopos) shoposMail(t, w, { why: 'tagged the ShopOS team', text: body });
    if (w.with?.kind === 'team' && process.env.DEMO_MODE === '1') { move(t, w, 'team', null); colleagueReply(t, w); }
    return { work: jamOut(t, w), tagged: tags.map((x) => x.email), invited };
  });
  /* give the jam to someone, or ask them for their OK on the version now (ask: work | approve); no email = nobody */
  on('POST', '/api/work/:wid/assign', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' }; const me0 = meOf(t);
    if (!b.email) { if (w.assignee) say(t, w, { from: 'system', body: `${nameOf(me0)} took ${nameOf(w.assignee)} off this jam` }); w.assignee = null; w.updatedAt = now(t); return { work: jamOut(t, w) }; }
    const [x] = await tagsOf(t, w, [b.email]); if (!x) return { error: 'They’re not on the team yet. Invite them from Team and access first.' };
    const ask = b.ask === 'approve' ? 'approve' : 'work';
    w.assignee = { ...x, ask, by: me0?.email || null, at: now(t) }; JAMS.join(w, x, 'assigned');
    say(t, w, { from: 'system', body: ask === 'approve' ? `${nameOf(me0)} asked ${nameOf(x)} for their OK on v${w.current}` : `${nameOf(me0)} gave this jam to ${nameOf(x)}` });
    if (ask === 'approve') move(t, w, 'needs_you', null);
    mailEv(t, w, { kind: ask === 'approve' ? 'approve' : 'assigned', to: [x.email], by: me0, text: String(b.note || '').slice(0, 400), id: `as_${w.id}_${x.email}_${ask}_${w.current}` });
    return { work: jamOut(t, w) };
  });
  on('POST', '/api/work/:wid/approve', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const me0 = meOf(t);
    if (b.rev != null && w.current !== b.rev) return { stale: true, work: jamOut(t, w), error: `It changed to v${w.current} while you looked. Check it, then approve.` };
    say(t, w, { from: 'system', body: me0 ? `${nameOf(me0)} approved v${w.current}` : `You approved v${w.current}` }); w.approvedBy = me0 ? { ...me0, n: w.current, at: now(t) } : null;
    const asker = w.assignee?.ask === 'approve' ? w.assignee.by : null; if (w.assignee?.ask === 'approve') w.assignee = null;
    move(t, w, 'ready', null);
    if (me0) mailEv(t, w, { kind: 'approved', to: [w.startedBy?.email, asker].filter(Boolean), by: me0, text: '', id: `ap_${w.id}_${w.current}` });
    return { work: jamOut(t, w) }; });
  /* the open jam's poll: who's here (and typing), what this person has seen, and the jam itself only when it changed */
  on('GET', '/api/jams/:wid', async (b, t, p, q) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' }; const me0 = meOf(t), see = guestSees(t); if (!see(w)) return { error: 'not found' };
    if (me0) { JAMS.beat(w.id, me0, q?.get('typing') === '1'); if (JAMS.isIn(w, me0.email) || reqOf(t)?.member) (w.reads ||= {})[me0.email] = Math.max(now(t), w.updatedAt || 0); }
    const since = +(q?.get('since') || 0), here = JAMS.here(w.id).filter((x) => x.email !== me0?.email);
    return since && since >= (w.updatedAt || 0) ? { same: true, here, updatedAt: w.updatedAt } : { work: jamOut(t, w), here, updatedAt: w.updatedAt };
  });
  on('POST', '/api/work/:wid/reopen', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; say(t, w, { from: 'system', body: 'New round started' }); move(t, w, 'drafting', null); return { work: w }; });


  MOVES ||= createMoves(path.dirname(PUB));
  JB = createJamBrief({ onShopos: (t, w, x) => shoposMail(t, w, x), planOf: (t, c) => planOfCard(c), pageOf: (t, c) => pageNow(t, c), MOVES, cardOf: (t, id) => { const c = t.cards.get(id); return c ? fillCard(c, t) : null; }, measureOf, claudeTool, cardBrief, seatLine, isMock, spend, clean, now, AGENT, SEED, log, changeOf: (t, w) => (w.changeId && t.changes?.[w.changeId]) || null, targetOf: (t, w) => { const tg = deployTarget(w.cta, t.cards.get(w.cardId)); return tg.conn ? tg.name : null; } });
  /* brand learnings (brand-learnings.js): /update-brand-learnings in any jam, or a pasted transcript / "update my brand learnings"
     in a fresh jam. Only the brand's team or the Brew team (this request's viewer); the demo site gets a polite no */
  const learnOf = async (t, w, text) => {
    if (!o.learnings) return null;
    const c = t.cards.get(w.cardId) || {}, generic = String(w.cardId || '').startsWith('jam-') && !w.ctxKey && !c.ctxKey && !(Array.isArray(c.bundle) && c.bundle.length) && !w.changeId;
    /* the answer to a first-learnings warning ("go ahead" / "just the top 6") */
    if (text.length < 600) { const r0 = reqOf(t); if (r0?.member && process.env.DEMO_MODE !== '1') { const sl = t.brandId || DEFAULT_BRAND;
      /* an answer to a learnings draft ("save", "drop 3", "change 2 to …", "add belief: …", "cancel") */
      const rv = o.learnings.review ? await o.learnings.review(sl, text).catch((e) => { log.warn?.('[learn] review', e.message); return null; }) : null; if (rv) return { said: text, reply: rv.reply };
      /* the answer to a first-learnings warning ("go ahead" / "just the top 6") */
      if (text.length < 80 && o.learnings.confirm) { const c0 = await o.learnings.confirm(sl, text).catch(() => null); if (c0) return { said: text, reply: c0.reply }; } } }
    const cmd = parseLearnCommand(text, { generic }); if (!cmd) return null;
    const said = text.length > 600 ? `${cutWords(text, 280)} (${text.length.toLocaleString('en-US')} characters pasted)` : text;
    const r = reqOf(t), no = learnGate({ member: !!r?.member, demoSite: process.env.DEMO_MODE === '1', name: BN() });
    if (no) return { said, reply: no };
    const by = r.name || r.email || 'the team', byShort = r.name ? String(r.name).split(/\s+/)[0] : r.email || '';
    const out = await o.learnings.run(t.brandId || DEFAULT_BRAND, { text: cmd.body, by, byShort, why: cmd.why, workId: w.id });
    return { said, reply: out.reply, n: out.applied?.length ?? null };
  };
  JB.routes({ on, W, say, move, notify, learn: learnOf, nextTicket: (t) => { leadsAllTenants++; return nextBrandTicket(t); }, handoff: { build: (...a) => HO.build(...a), text: (...a) => HO.text(...a) } });
  // first drafts in a jam, one tap away: image, video, voice or text, made only when someone asks (drafts.js)
  DR = createDrafts({ claudeTool, geminiImage, treg: o.treg, launchBrowser: o.launchBrowser, zipBuffer: o.zipBuffer, photoAsync: o.photoAsync, photoFile, catalogOf: (t) => (t ? brandOfT(t)?.catalog : null), brandName: (t) => (t ? brandOfT(t)?.seed?.brand?.name || '' : ''), photoOf: (c) => LANE_PHOTO[c?.lane] || Object.values(LANE_PHOTO || {})[0], cardOf: (t, id) => { const c = t.cards.get(id); return c ? fillCard(c, t) : null; },
    briefOf: (t, w) => JB.seed(t, w)?.md, cardBrief, seatLine, isMock, spend, clean, now, uid, say, save: (t) => store?.save(t), AGENT, log }); DR.routes({ on, W });
  MOVES ||= createMoves(path.dirname(PUB));
  // the card page: options, our pick, recommendation, what follows, and the move details that matter.
  // Seed cards are prebuilt (tools/build_card_pages.mjs); any other card is built once on first open.
  // card pages, move documents and the fact list for prompts: the active brand's
  const PAGES = liveView((b) => b.pages), MOVE_DOCS = liveView((b) => b.moveDocs);
  /* a card page is paid for once: written pages are kept in the brand pack (pages.json), so a reload or a deploy doesn't write them again */
  const pageLocks = new Map();
  const keepPage = (key, page) => { const slug = B()?.slug, P = o.globalPacks; if (!slug || !P?.getJSON || B()?.kind !== 'generated') return;
    const run = (pageLocks.get(slug) || Promise.resolve()).catch(() => {}).then(async () => { const all = await P.getJSON(slug, 'pages.json', {}).catch(() => ({})); all[key] = page; await P.put(slug, 'pages.json', all); }).catch((e) => log.warn('[card page] keep', e.message));
    pageLocks.set(slug, run); };
  const PAGE_FACTS_OF = () => B().pageFacts;
  const building = new Map();
  // what the card page says right now, without waiting on AI (for the first brief)
  const pageNow = (t, c) => { if (!c) return null; const key = c.id + '|' + (c.title || ''); if (PAGES[c.id] && (!PAGES[c.id].title || PAGES[c.id].title === c.title)) return PAGES[c.id]; return PAGES[key] || fallbackPage(c, MOVE_DOCS, MOVES); };
  const pageOf = async (t, c) => {
    const key = c.id + '|' + (c.title || '');
    if (PAGES[c.id] && (!PAGES[c.id].title || PAGES[c.id].title === c.title)) return PAGES[c.id];
    if (PAGES[key]) return PAGES[key];
    if (isMock() || demoReq() || !spend('text')) return fallbackPage(c, MOVE_DOCS, MOVES); // demo mode: a page already written, or the plain one
    if (!building.has(key)) building.set(key, (async () => {
      const { nums, moveText } = moveTextOf(MOVE_DOCS, MOVES, c);
      const measure = measureOf(t, c), mNums = new Set([measure.baseline, measure.target].filter((x) => x != null).flatMap((v) => numbersIn(`₹${v} ${v}% ${v}`)));
      const ok = (s) => unbacked({ text: String(s || '') }, FACT_OK).every((x) => mNums.has(x.n));
      const j = await claudeTool(pagePrompt({ card: c, factBrief: PAGE_FACTS_OF(), moveText, nums, measure }), PAGE_SCHEMA, 3500, 'card_page');
      const pg = (PAGES[key] = { ...sanitizePage(j, { card: c, M: MOVE_DOCS, nums, ok }), title: c.title }); keepPage(key, pg); return pg;
    })().catch((e) => { log.warn('[card page]', e.message); return fallbackPage(c, MOVE_DOCS, MOVES); }).finally(() => building.delete(key)));
    return building.get(key);
  };
  HO = createHandoff({ RMX: { packageOf: (...a) => RMX?.packageOf(...a) }, pageOf, fillCard, AGENT, SEED });
  setupOn();
  // the option you went with on the card page travels with every handoff
  on('POST', '/api/work/:wid/decided', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; w.decided = b.id || null; if (b.id) stepLearn(t, w, 'decided'); if (w.cardId) { t.decided ||= {}; if (b.id) t.decided[w.cardId] = b.id; else delete t.decided[w.cardId]; } return { work: w }; });
  // a choice made on the card page before any jam: kept on the tenant, so every device and link sees it
  on('POST', '/api/cards/:cid/decided', async (b, t, p) => { t.decided ||= {}; const w = workFor(t, p.cid), shipped = t.work.find((x) => x.cardId === p.cid && ['deploying', 'out', 'measuring', 'result'].includes(x.stage));
    if (!b.id && shipped) return { error: 'already shipped' };
    if (b.id) t.decided[p.cid] = b.id; else delete t.decided[p.cid]; if (w) w.decided = b.id || null;
    if (b.id) stepLearn(t, w || { id: 'card:' + p.cid, cardId: p.cid, decided: b.id, thread: [], versions: [], current: 1 }, 'decided');
    return { decided: t.decided }; });
  /* a jam link is made by someone in that jam (the team, or that jam's guest), never by whoever holds a workspace id */
  on('GET', '/api/tenants/:id/share', async (b, t, p, q) => { const r = reqOf(t), wid = q?.get?.('wid') || null;
    if (!(r?.member || (wid && r?.guest?.wids?.includes(wid)))) return { status: 403, error: 'Sign in as part of the team to share this jam.' };
    if (wid && !W(t, wid)) return { status: 404, error: 'not found' };
    return { token: shareToken(t.id, wid) }; });
  on('GET', '/api/work/:wid/handoff', async (b, t, p, q) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; { const r = reqOf(t); if (!(r?.member || r?.guest?.wids?.includes(w.id)) && process.env.DEMO_MODE !== '1') return { status: 403, error: 'Sign in as part of the team to share this jam.' }; } /* its links carry a jam token: only someone in the jam makes them */ const x = await HO.build(t, w, { base: q.get('base') || undefined, changeId: q.get('ch') || undefined }); return { handoff: x, text: HO.text(x, q.get('to') || 'whatsapp') }; });
  /* what Brew has learned that bears on this card's pick: the brand (taste rules from edits, past results)
     and this person (how they decided before, hearts, "fewer", their seat). Short lines, newest evidence first. */
  const learnedFor = (t, c) => {
    const out = [], ag = c.agent, name = AGENT[ag] || 'this agent', ls = lessonsFor(t, ag).slice(0, 2);
    const cap = (x) => { x = String(x || '').trim().replace(/[.]$/, ''); return x.charAt(0).toUpperCase() + x.slice(1); };
    const tidy = (x) => String(x || '').replace(/\{[^}]*\}/g, '').replace(/\s+([,.])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s,]+/, '').trim();
    ls.forEach((x) => out.push({ k: x.results?.length ? 'result' : x.kind === 'you' ? 'you' : 'brand', text: cap(x.text), n: x.n, ...(x.results?.length ? { value: `${x.results[0].before} → ${x.results[0].after}`, win: x.results[0].win } : {}) }));
    rulesFor(t, ag).slice(0, 2).forEach((r) => out.push({ k: 'brand', text: cap(r.text) }));
    const calls = Object.entries(t.decided || {}).filter(([id]) => id !== c.id).map(([id, o]) => { const x = t.cards.get(id); const pg = x && pageNow(t, fillCard(x, t)); const pk = pg?.options?.find((y) => y.pick); return pk ? { mine: o !== pk.id } : null; }).filter(Boolean);
    if (calls.length >= 2 && !ls.some((x) => x.kind === 'you')) { const own = calls.filter((x) => x.mine).length; out.push({ k: 'you', text: own ? `Went your own way on ${own} of your last ${calls.length} calls` : `Went with Brew’s pick on your last ${calls.length} calls` }); }
    const hearts = (t.feedback || []).filter((f) => f.userId === 'viewer' && f.kind === 'heart' && t.cards.get(f.cardId)?.agent === ag).length;
    if (hearts) out.push({ k: 'you', text: `Liked ${hearts} ${name} card${hearts > 1 ? 's' : ''}` });
    if (t.fewer?.[ag]) out.push({ k: 'you', text: `Asked for fewer ${name} cards` });
    const role = SEED.roles[t.viewer?.role]; if (role) out.push({ k: 'you', text: `${role.title} seat: ${role.line.charAt(0).toLowerCase()}${role.line.slice(1)}` });
    // no repeats, and at most two per group
    const seen = new Set(), per = {}; return out.filter((x) => { const key = x.text.toLowerCase(); if (seen.has(key)) return false; seen.add(key); per[x.k] = (per[x.k] || 0) + 1; return per[x.k] <= 2; });
  };
  on('GET', '/api/cards/:cid/learned', async (b, t, p) => { const raw = t.cards.get(p.cid); return raw ? { learned: learnedFor(t, fillCard(raw, t)) } : { learned: [] }; });
  on('GET', '/api/cards/:cid/page', async (b, t, p) => { const raw = t.cards.get(p.cid); if (!raw) return { error: 'not found' }; const c = fillCard(raw, t); return { page: await pageOf(t, c) }; });
  // a card's source moves: what each one says, and the passages that speak to this card
  on('GET', '/api/cards/:cid/moves', async (b, t, p) => { const c = t.cards.get(p.cid); if (!c) return { error: 'not found' }; return { moves: MOVES.numsOf(c.src).map((n) => ({ ...MOVES.summary(n), passages: MOVES.passages({ ...c, src: `Move ${n}` }, 4) })) }; });
  /* MEDIA_FAKE=1 on a local server: the jam's short video runs end to end for free (drafts.js fakeMakers) */
  const FAKE = process.env.MEDIA_FAKE === '1' && !process.env.K_SERVICE ? fakeMakers() : null;
  RMX = createRemix({ onShopos: (t, w, x) => shoposMail(t, w, x), askPerson: async (t, w, q, email) => { const [x] = await tagsOf(t, w, [email]); if (!x) return { error: 'They’re not on the team yet. Invite them first.' }; const me0 = meOf(t);
      JAMS.join(w, x, 'asked'); say(t, w, { from: 'system', body: `${nameOf(me0)} asked ${nameOf(x)}: ${q.q}` }); mailEv(t, w, { kind: 'asked', to: [x.email], by: me0, text: q.q, id: `q_${w.id}_${q.id}` }); return x; }, ...(FAKE ? { makers: FAKE.makers, videoImage: FAKE.image, mediaFake: true } : {}), planOf: (t, c) => (c ? planOfCard(c) : null), save: (t) => store?.save(t), catalogOf: (t) => (t ? brandOfT(t)?.catalog : null), photoAsync: o.photoAsync, photoFile, handoffPath, MOVES, seedJam: (t, w) => JB?.seed(t, w), claudeTool, geminiImage, PUB, LANE_PHOTO, FACTS, unbackedNums: (text) => unbacked({ text: String(text).replace(/\b(?:Rs\.?|INR)\s?(?=\d)/gi, '₹') }, FACT_OK).map((x) => x.n), SEED, AGENT, claudeJSON, cardBrief, seatLine, qaCheck, mechanicalFix, clean, BANNED, isMock, spend, uid, now, clone, inr, on, newWork, addVersion, say, move, notify, later, setState, weekKey, curV, measureOf, log  });
  // tenants survive restarts (store.js); a tenant not in memory is read back from disk or GCS before we give up on it
  const getTenant = async (id) => {
    let t = tenants.get(id); if (t || !store || !id) return t;
    t = await store.load(id); if (!t) return null;
    const br = await packs.load(t.brandId || DEFAULT_BRAND); if (!br) return null;
    await JAMS.load(br.slug);
    return runIn(br, () => {
      // seed and pool cards follow the current copy (descriptions get rewritten); runtime cards keep their own
      const SRC = new Map([...SEED.posts, ...Object.values(POOLS).flat()].map((x) => [x.id, x]));
      for (const c of t.cards?.values?.() || []) { const src = SRC.get(c.id); if (!src) continue; if (typeof src.sub === 'string') c.sub = src.sub; if (src.byRole) c.byRole = clone(src.byRole); }
      // a generated brand: cards from moves that landed while this workspace was away
      if (br.kind === 'generated') streamSync(t, SEED.posts);
      if (br.kind === 'generated') { followMoves(t, br); const t0 = now(t); for (const p of SEED.posts) if (!t.cards.has(p.id)) t.cards.set(p.id, { ...clone(p), family: p.family || FAMILY[p.type] || 'idea', state: 'ready', origin: 'move', createdAt: t0, expiresAt: null, history: [['ready', t0]], shownCount: 0, ...(mvOf(br, p.id) ? { mv: mvOf(br, p.id) } : {}) }); }
      t.lastSeen = Date.now(); tenants.set(t.id, t); log.log?.(`[store] loaded ${t.id}`); return t;
    });
  };
  /* jam guests: people who signed in through a shared jam link. They may act on that jam (its work item, the studio change
     linked to it, its card's remix) and nothing else; they are never members, so private moves, memory and the team stay closed */
  const GUEST_DO = /^(message|iterate|pick|version|edit|reference|canvas|doc|doc\/(ask|add|sync)|jb|jb\/import|draft|draft\/[^/]+\/drop|plan\/(answer|add))$/;
  const guestOk = (t, email, path) => {
    const wids = JAMS.guestWids(t.brandId || DEFAULT_BRAND, email), g = { wids }; if (!g.wids.length) return false;
    const all = JAMS.peek(t.brandId || DEFAULT_BRAND)?.work || [], ch0 = JAMS.peek(t.brandId || DEFAULT_BRAND)?.changes || {};
    const jams = all.filter((w) => g.wids.includes(w.id)), cards = new Set(jams.map((w) => w.cardId).filter(Boolean));
    /* a guest chats, edits the brief and makes drafts; sharing the brief, approving, assigning, deciding or discarding stays with the team */
    let m = path.match(/^\/api\/work\/([^/]+)(\/(.*))?$/); if (m) return g.wids.includes(m[1]) && GUEST_DO.test(m[3] || '');
    m = path.match(/^\/api\/changes\/([^/]+)(\/|$)/); if (m) { const ch = ch0[m[1]]; return !!ch && (g.wids.includes(ch.workId) || cards.has(ch.cardId)); }
    m = path.match(/^\/api\/cards\/([^/]+)\/(remix|batch|image|page|moves|learned|brief)(\/|$)/); if (m) return cards.has(decodeURIComponent(m[1]));
    return false;
  };
  /* the writes a demo-mode visitor may still make: none of them calls a model or makes an asset */
  const DEMO_OK = /^\/api\/(tenants|work|tenants\/[^/]+\/(ready|clock|events|pin|cards|notes\/(clear|read)|stories\/[^/]+\/seen|deck-layout|state|learning\/.+)|cards\/[^/]+\/(feedback|decided)|work\/[^/]+\/(decided|discard|restore|pick|version|approve|reopen|edit|jb\/move|draft\/[^/]+\/drop)|changes\/[^/]+\/(open|discard|restore|pick|notes|edit))$/;
  // every request runs inside its brand: the tenant's brand, or (creating one) the brand the page was opened for
  const handle = async (req, res, u) => {
    if (!/^\/(h\/|api\/(share|tenants|cards|jams|work|changes))/.test(u.pathname)) return false;
    let tid = null;
    const hm0 = u.pathname.match(/^\/h\/([\w~-]+)$/), sm0 = u.pathname.match(/^\/api\/share\/([\w~-]+)$/);
    if (hm0) tid = parseToken(hm0[1])?.tid; else if (sm0) tid = parseShare(sm0[1])?.tid; else tid = u.pathname.match(/^\/api\/tenants\/(t_[a-f0-9]+)/)?.[1] || req.headers['x-tenant'];
    const t0 = tid && /^t_[a-f0-9]+$/.test(tid) ? await getTenant(tid) : null;
    const slug = t0?.brandId || (u.pathname === '/api/tenants' ? (u.searchParams.get('brand') || req.headers['x-brand']) : null) || DEFAULT_BRAND;
    const br = await packs.load(slug) || await packs.load(DEFAULT_BRAND);
    if (t0 && !t0.brandId) t0.brandId = br.slug;
    const viewer = br.kind === 'generated' ? await viewerOf(req, br.slug).catch(() => null) : null;
    await JAMS.load(br.slug); /* the team's jams are in memory before anything reads t.work */
    /* demo mode: someone who may not make fresh work here (another domain, not invited) keeps the feed, cards and layout, but no
       route that writes new work runs for them: only the harmless writes below (seen, pinned, feedback, layout, picking a version) */
    let gen = o.genOk ? await o.genOk(req, br.slug).catch(() => false) : true;
    /* a guest (signed in through a shared jam link) takes part in that jam only: its work item, its studio change, its card */
    const guestJam = !gen && t0 && viewer?.email && guestOk(t0, viewer.email, u.pathname);
    if (guestJam) gen = true;
    // someone looking at a shared jam without signing in: signing in is how they take part
    if (!gen && req.method !== 'GET' && !viewer?.email && t0 && /^\/api\/work\/([^/]+)\//.test(u.pathname) && (JAMS.peek(br.slug)?.work || []).some((w) => u.pathname.startsWith(`/api/work/${w.id}/`))) { send(res, 401, { error: 'Sign in to take part in this jam.', signin: true, jam: true }); return true; }
    // a guest of the shared jam changes nothing else in the team's workspace (no new jams, no layout, no feedback)
    if (!gen && req.method !== 'GET' && viewer?.email && JAMS.guestWids(br.slug, viewer.email).length) { send(res, 403, { error: 'As a guest you can chat, edit the brief and make drafts in this jam. Ask the team to invite you for the rest.', guest: true }); return true; }
    /* a team's workspace (a member has opened it) takes no writes from someone outside the team, not even the harmless ones */
    if (!gen && req.method !== 'GET' && t0?.teamEmail && !viewer?.member && process.env.DEMO_MODE !== '1') { send(res, viewer?.email ? 403 : 401, { error: viewer?.email ? 'This is the team’s workspace. Ask them to invite you.' : 'Sign in to take part.', signin: !viewer?.email }); return true; }
    if (!gen && req.method !== 'GET' && !DEMO_OK.test(u.pathname)) { send(res, 403, { error: `Demo mode: sign in with your work email${viewer?.host ? ` at ${viewer.host}` : ''} to make this.`, demo: true, host: viewer?.host || null }); return true; }
    /* on live, a brand's feed, moves and read are for its team (Param, 2026-10-15); the demo site stays open. Someone outside the
       team sees an empty feed (the page still loads, and a guest still gets their jam), and only their own jam's card */
    const outside = br.kind === 'generated' && o.liveTeamOnly?.() && !viewer?.member && !viewer?.gen;
    if (outside && req.method === 'GET') {
      if (/^\/api\/tenants\/[^/]+\/feed$/.test(u.pathname)) { send(res, 200, { order: [], cards: {}, scores: {}, pinned: [], limit: { plan: 'free', daily: null, locked: 0 }, teamOnly: true }); return true; }
      if (/^\/api\/tenants\/[^/]+\/stories$/.test(u.pathname)) { send(res, 200, { rings: [], teamOnly: true }); return true; }
      /* the onboarding stream replays the brand's whole read (its findings): outside the team it only says it is ready */
      if (/^\/api\/tenants\/[^/]+\/onboarding$/.test(u.pathname)) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.end(`data: ${JSON.stringify({ type: 'ready', teamOnly: true })}\n\n`); return true; }
      if (/^\/api\/tenants\/[^/]+\/(deck|pulse|engine|remixes|learning)$/.test(u.pathname)) { send(res, 200, { teamOnly: true }); return true; }
      const bareCard = /^\/api\/cards\/([^/]+)$/.exec(u.pathname), guestCard = bareCard && viewer?.email && (JAMS.peek(br.slug)?.work || []).some((w) => JAMS.guestWids(br.slug, viewer.email).includes(w.id) && w.cardId === decodeURIComponent(bareCard[1]));
      if (/^\/api\/cards\//.test(u.pathname) && !guestJam && !guestCard && !(t0 && viewer?.email && guestOk(t0, viewer.email, u.pathname))) { send(res, viewer?.email ? 403 : 401, { error: 'This brand’s cards are for its team.', team: true, signin: !viewer?.email }); return true; }
    }
    /* workspaces cost memory (they stay loaded): someone outside a team makes at most 20 an hour from one address */
    if (req.method === 'POST' && u.pathname === '/api/tenants' && !viewer?.member && !gen) { const k = `${o.clientIp ? o.clientIp(req) : ''}|${Math.floor(Date.now() / 3600e3)}`; const n = (newWs.get(k) || 0) + 1; newWs.set(k, n); if (newWs.size > 5000) newWs.clear(); if (n > 20) { send(res, 429, { error: 'Too many new workspaces from this address. Try again in an hour.' }); return true; } }
    if (gen && t0) t0.lastGen = Date.now();
    if (gen && br.kind === 'generated' && req.method === 'GET' && /\/feed$/.test(u.pathname)) o.onOpen?.(br.slug); // the social scheduler and background drafts spend only on brands their team opens
    /* this request's viewer, checked from the signed-in user (REQ): t.member and t.memberEmail read it. A team member who opens
       the workspace becomes the one the background clock re-checks (teamEmail) */
    const gw = !viewer?.member && viewer?.email ? JAMS.guestWids(br.slug, viewer.email) : [];
    const who = { member: !!viewer?.member, email: viewer?.member ? viewer.email || null : null, name: viewer?.member ? viewer.name || null : null, pic: viewer?.member ? viewer.pic || null : null, claimed: !!viewer?.claimed, slug: br.slug, seats: viewer?.member && Array.isArray(viewer.seats) ? viewer.seats : null,
      guest: gw.length ? { email: String(viewer.email).toLowerCase(), name: viewer.name || null, pic: viewer.pic || null, wids: gw } : null };
    return GEN_CTX.run(gen, () => MC.run(who, t0, () => runIn(br, () => withPrefs(prefsOf(req), () => handleIn(req, res, u, viewer))))); // the jam's model and memory choice, for this request
  };
  const handleIn = async (req, res, u, viewer) => {
    const hm = u.pathname.match(/^\/h\/([\w~-]+)$/);
    if (hm && req.method === 'GET') {
      const tok = parseToken(hm[1]); const t = tok && await getTenant(tok.tid); const w = t && (W(t, tok.wid) || teamJam(t, tok.wid));
      if (!w) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('This handoff link is not valid.'); return true; }
      /* links shared before the jam link existed open the jam itself (same card, same change, latest state); ?full=1 is the read-only page */
      if (u.searchParams.get('full') !== '1') { res.writeHead(302, { location: jamPath(t, w), 'cache-control': 'no-store' }); res.end(); return true; }
      /* a shared brief is frozen: the page shows what was shared (w.jamBrief.context), not the jam as it is now; sharing again replaces it */
      const x = w.jamBrief?.context ? { ...w.jamBrief.context, frozenAt: w.jamBrief.sharedAt || null } : await HO.build(t, w, { base: `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers.host}` });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }); res.end(HO.html(x)); return true;
    }
    const sm = u.pathname.match(/^\/api\/share\/([\w~-]+)$/);
    if (sm && req.method === 'GET') { const tok = parseShare(sm[1]); const t = tok && await getTenant(tok.tid);
      if (!t) { send(res, 404, { error: 'This link has expired.' }); return true; }
      /* anyone with the link can look. Signed in, a person who isn't on the team becomes a guest of that one jam */
      let guest = false; const email = viewer?.email ? String(viewer.email).toLowerCase() : null, w = tok.wid ? (W(t, tok.wid) || teamJam(t, tok.wid)) : null;
      /* a shared jam needs a signed-in person (the team's jams are never open to an anonymous link) */
      if (!email && tok.wid) { send(res, 200, { signin: true, jam: tok.wid }); return true; }
      /* a teammate opens it in their own workspace: it is the team's jam already */
      if (viewer?.member && w) { if (!JAMS.isIn(w, email)) JAMS.join(w, { email, name: viewer.name, pic: viewer.pic }, 'joined'); send(res, 200, { member: true, jam: w.id }); return true; }
      if (email && w && !viewer?.member && !viewer?.gen) { JAMS.join(w, { email, name: viewer.name, pic: viewer.pic }, 'guest'); guest = true; }
      send(res, 200, { guest, signedIn: !!email, jam: tok.wid || null, tenant: t.id, viewer: t.viewer, conn: t.conn, pro: t.plan === 'pro', decided: t.decided || {} }); return true; }
    if (!/^\/api\/(tenants|cards|jams|work|changes)/.test(u.pathname)) return false;
    for (const r of ROUTES) {
      if (r.method !== req.method) continue; const m = u.pathname.match(r.re); if (!m) continue;
      const params = m.groups || {};
      const tid = params.id || req.headers['x-tenant'];
      const t = r.pattern === '/api/tenants' ? null : await getTenant(tid);
      if (r.pattern !== '/api/tenants' && !t) { send(res, 404, { error: 'unknown tenant' }); return true; }
      if (t) { clampSeat(t); const me0 = meOf(t); if (reqOf(t)?.member) JAMS.adopt(t, me0); JAMS.hydrate(t); }
      /* a card outside the viewer's views can't be opened, jammed or acted on by id either */
      if (t && params.cid) { const c = t.cards.get(params.cid); if (c && !seatOk(t, c)) { send(res, 404, { error: 'not found' }); return true; } }
      if (t) { touch(t); const k = `${r.method} ${r.pattern.replace('/api', '')}`; t.api[k] = { n: (t.api[k]?.n || 0) + 1, last: Date.now() }; if (viewer) await applyLive(t, viewer); }
      if (r.pattern === '/api/tenants/:id/onboarding') { await onboardingStream(t, req, res); return true; }
      const b = req.method === 'GET' ? {} : await readBody(req);
      try { const out = await r.fn(b, t, params, u.searchParams); if (!t && out?.id && viewer) await applyLive(tenants.get(out.id), viewer); send(res, out?.status || 200, out); if (store && req.method !== 'GET') store.save(t || (out?.id && tenants.get(out.id))); }
      catch (e) { log.error(`[feed ${r.pattern}]`, e); send(res, 200, { error: e.message, fallback: true }); }
      return true;
    }
    send(res, 404, { error: 'no route' }); return true;
  };
  const addCards = (slug, cards, o = {}) => { const br = packs.peek(slug); if (!br) return; runIn(br, () => { for (const t of brandTenants(br)) { if (o.private && !t.member) continue; const t0 = now(t); for (const p of cards) { const mv = mvOf(br, p.id), stamp = mv && !p.privateOf ? { mv } : {}; if (o.replace && t.cards.has(p.id)) Object.assign(t.cards.get(p.id), clone(br.fxDeep(p)), { createdAt: t0 }, stamp); else if (!t.cards.has(p.id)) t.cards.set(p.id, { ...clone(br.fxDeep(p)), family: p.family || FAMILY[p.type] || 'idea', state: 'ready', origin: 'move', createdAt: t0, expiresAt: null, history: [['ready', t0]], shownCount: 0, ...stamp }); }
    /* a rewritten move: an open workspace follows it now, the same way a closed one does when it loads (a card the rewrite no longer makes steps back) */
    if (o.replace && !o.private) followMoves(t, br); store?.save(t); } }); };
  // a connected account was read or dropped: every open workspace of that brand catches up
  const refreshLive = async (slug) => { const br = packs.peek(slug); if (!br) return; for (const t of brandTenants(br)) { if (demoSid() && t.demoSid !== demoSid()) continue; await runDemo(t.demoSid, () => applyLive(t, { member: t.member, claimed: t.claimed })).catch(() => {}); store?.save(t); } };
  // Approve, pressed on a card posted to the brand's Slack
  // new ideas or a new listen run landed (or the day's rotation turned): every open workspace of that brand catches up
  const syncSocial = (slug) => { const br = packs.peek(slug); if (!br) return; runIn(br, () => { for (const t of brandTenants(br)) { streamSync(t, SEED.posts); store?.save(t); } }); };
  // a cadence move was retired (moves-cadence.js): its cards leave every open workspace, unless someone acted on them
  const dropCards = (slug, ids) => { const br = packs.peek(slug); if (!br || !ids?.length) return; runIn(br, () => { for (const t of brandTenants(br)) { for (const id of ids) { const c = t.cards.get(id); if (c && ['ready', 'shown'].includes(c.state) && !t.acted?.has?.(id) && !(t.work || []).some((w) => w.cardId === id)) setState(t, c, 'expired'); } store?.save(t); } }); };
  return { handle, tenants, jams: JAMS, addCards, dropCards, refreshLive, syncSocial, save: (t) => store?.save(t), wire: (b) => { wireResearch(b); wireLive(b); } };
}
