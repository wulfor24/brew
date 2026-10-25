// Prototype of the Feed service from the engineering spec (v13):
// tenants, card store + lifecycle, ranker (freshness + impact + affinity + seat − fatigue), daily free
// budget, feedback, action runs behind a weekly spend limit, versions, jam router + deployment
// workbench, stories, deck layout, always-on watchers with a QA agent, brand memory and metrics.
// State is in memory per tenant; the client re-creates its tenant from a snapshot after a restart.
import { isLeader } from './roles.js'; // paid background reads belong to the background lease holder
import { budgetWhy } from './budget.js'; // whose daily share ran out, in plain words
import { countsOf, freshCounts } from './card-nums.js'; /* a card's counts follow today's fact sheet */
import { numberRows } from './pack-numbers.js';
import { fitCta } from './cards-gen.js'; /* a saved card's button heals as it is read (renamed, or one about another topic) */
import { ctaName } from './seed-template.js';
import { realRows, isPrivateCard, acctRows } from './connectors/common.js';
import { baselineOf, healthReadings } from './on-connect.js'; // the team's own account numbers on cards and the health card
import fs from 'node:fs';
import { scoreText } from './viral-gate.js'; // viral cards: "47×" only when the creator's usual views were read
import { readRivalAd, rivalPicture, isResearchImage, isRivalCard } from './rival-ad.js'; // rival ads read ahead, kept with the brand; a final of our version keeps their composition
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { near, noPaise } from './research.js';
import { buildRecap, visitTick, sinceLabel } from './recap.js';
import { B, live as liveView, liveArr, liveRe, runIn, BN, BH, CTRY, FESTN, FESTD } from './brand-ctx.js';
import { cardValue, moveNo } from './value.js'; // what a card is worth doing (expected value), for the ranker
import { oneAsk, noiseOf, conflicts } from './same-ask.js'; // one card per ask: six moves saying "fix the pack prices" show once
import { moneyParse, safeLocale, viewerPack } from './brand-pack.js';
import { liveTruth, replacedKeys } from './facts-desk.js'; // one truth per viewer: the public sheet, or a member's with their live connected facts over
import { allowedFrom, unbacked, numbersIn } from './fact-gate.js';
import { createRemix } from './remix.js';
import { saveGen } from './gen-store.js';
import { createJamBrief } from './jam-brief.js';
import { createTeamBrief } from './team-brief.js';
import { briefParts, withTeam, LABEL as BRIEF_LABEL } from './brief-status.js';
import { createTuning, tuneScore, learnedSignals, withoutIgnored, noteTopics, noteSides, PREF_SCHEMA, prefPrompt, AGENTS as TUNE_AGENTS, WEIGHT as TUNE_WEIGHT } from './member-tuning.js'; // Your feed: per-member agent weights, topics, learned signals
import { memberKey, saveVoicePick } from './brand-memory.js';
import { isQuestion, photoAsk, answerGrounded } from './jam-answer.js'; // jam chat: questions answered from the evidence, "keep the photo" never makes one
import { parseDrop, DESTS } from './drop.js';
import { readDrop, dropKind } from './drop-read.js'; // Drop anything here: PDFs, Word, PowerPoint, Excel, text and photos, read for the learnings
import { createReferences } from './references.js';
import { createFinalsRoutes } from './finals-routes.js';
import { buildDraft } from './sloosh-prompt.js'; // one brief for every draft picture // Make the final: Sloosh, quote first, behind a button (finals.js) // References: the brand's uploaded photos, past ads, looks and videos, for the generators // Drop anything: memory, my preferences, just this once // Send brief: the full email and the "N with the team" pill
import { shipLine, oneCard, oneTake } from './text-fit.js';
import { createDrafts, fakeMakers, createMakers } from './drafts.js';
import { mountJam2 } from './jam2/routes.js';
import { createBrandbook } from './jam2/brandbook.js';
import { mountBrandBook } from './brand-book-routes.js'; // the Brand Book page, its edits and "bring your brand book"
import { fetcherWith } from './brand-book-read.js'; // Jam v2 (?v=2): its own routes and data, v1 untouched
import { makeVideo as jam2Video, makeVoice as jam2Voice } from './media.js';
import { genFile as jam2GenFile } from './gen-store.js';
import { vertexMusic as jam2Music } from './vertex-media.js';
import { cardProduct, cardScene, matchProduct, pricedProduct } from './product-match.js';
import { LOOKS_V } from './draft-quality.js'; // watcher pictures saved before the look check are swapped for the real product photo (housekeep)
import { gapFix } from './ai-gap.js';
import { newsForUs, newsCta, adForUs } from './for-us.js'; // every rival and news story ends on one line for the brand (QA FEED-ARV-10) // the AI-answers gap card's own fix (QA FEED-ARV-09)
import { seedDrafts, draftFor, draftView } from './drafts-bg.js';
import { planFor, planPrompt, PLAN_V, isBatchCard } from './card-plan.js';
import { createMoves } from './moves.js';
import { rulesFor, addLesson, stepOnce, lessonsFor, promptBlock, outcome, memoryBlock } from './learn.js';
import { createHandoff, parseToken, handoffPath, jamPath, shareToken, parseShare } from './handoff.js';
import { PAGE_SCHEMA, pagePrompt, moveTextOf, sanitizePage, fallbackPage } from './card-page.js';
import { withPrefs, prefsOf } from './model-ctx.js';
import { createMemberCtx } from './member-ctx.js';
import { createJams, askOf, waitsOn } from './jams.js';
import { parseLearnCommand, learnGate, cardUsesLearned } from './brand-learnings.js'; // /update-brand-learnings in a jam
import { AsyncLocalStorage } from 'node:async_hooks';
/* this request may make fresh work (the brand's team, SquareUp); false = demo mode. Unset off a request (the background clock) */
const GEN_CTX = new AsyncLocalStorage();
const demoReq = () => GEN_CTX.getStore() === false;
/* V1 hides Storefront everywhere (testing notes 18 Oct, QA FEED-ARV-05: not ready, it overwhelms the customer): its cards leave the
   feed, the deck and the stories. ?storefront=1 on the page (sent as ?sf=1, or read from the page address) shows it all to us */
const SF_CTX = new AsyncLocalStorage();
export const storefrontOn = () => process.env.STOREFRONT === '1' || SF_CTX.getStore() === true;
export const sfReq = (req, u) => u?.searchParams?.get('sf') === '1' || /[?&]storefront=1\b/.test(String(req?.headers?.referer || ''));
import { demoSid, runDemo, sk } from './demo-mode.js'; // Demo Mode: per-session workspaces
import { noteOk, NO_NOTE } from './notes.js'; // a margin note quotes only numbers its card still carries
import { createEvidence, EVIDENCE_ASK, proofAnswer, seenOf as EV_SEEN } from './evidence.js'; // the proof sheet on every card: why it was suggested, and the hard evidence
import { refine as refineProof0, evidenceKinds, cardNeeds } from './proof-logic.js'; // does the proof prove the claim: the card's own review pointer, no price-as-proof, claims that need an account
import { salesRank as salesRank0, handleOf, unitsFrom } from './catalog-rank.js'; // the catalog cards' order: what sells most first (QA FEED-ARV-08)
import { createPlain, dejargon } from './plain.js'; // plain words on every card, rewritten once per card and kept per brand
import { cardFrom } from './card-from.js'; // the plain "from" line on every card: what it rests on, never its routing
import { aiRingFromRun } from './health.js'; // the AI answers ring from the weekly check: score, rows and who the answers name, all one run
import { toolOf, channelFit, paceFit, paceOf, cleanViewer } from './channel-fit.js'; // where a card's work goes out, and how it fits the channels and ad pace the viewer told Brew in setup
import { moveLabel, moveNum, moveSay, playSrc } from './move-label.js'; // weekly moves read "Weekly move 11", never "Move 1011" (QA FEED-QA-12)
import { claimFlags, cleanDraftClaims, packSource, checkCopy, checkCopyIn } from './claims.js'; // drafts and finals carry only the store's own claims (QA-25)
import { isCommunityCard } from './social-feed.js'; // a reply or post in a community, from what listening heard: it keeps a first-screen seat
import { movedAway } from './moved.js'; // staging: no paid rival pre-read for a brand moved to production
// cut on a word boundary with an ellipsis, never mid-word or with a dangling space
const cutWords = (x, n) => { x = String(x).trim(); return x.length > n ? x.slice(0, n - 1).replace(/\s+\S*$/, '').replace(/[\s,;:·-]+$/, '') + '…' : x; };

const H = 3600e3, D = 24 * H;
const AGENT = { creative: 'Creative director', performance: 'Performance marketer', storefront: 'Storefront manager', visibility: 'AI visibility', crm: 'CRM specialist', brew: 'Brew' };
/* with Storefront hidden (V1, unless ?storefront=1) the storefront agent only owns catalog cards, so it signs as the Catalog manager (final QA pass 19 Oct, FEED-ARV-05) */
Object.defineProperty(AGENT, 'storefront', { get: () => (storefrontOn() ? 'Storefront manager' : 'Catalog manager'), enumerable: true });
const sfWho = (th) => (storefrontOn() || !Array.isArray(th) ? th : th.map((m) => (m?.who === 'Storefront manager' ? { ...m, who: AGENT.storefront } : m))); /* replies saved before say it too */
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
    visibility: mk('visibility', { metric: `AI answers that name ${n}`, unit: ` of ${(c.questions || []).length * 3 || 24}`, from: null, window: 28, watch: [`Which AI tools cite ${h}`, 'Whether claims are quoted correctly', 'How often rivals are named'], attribution: 'The same questions are asked again in the same AI tools every week. Nothing else changes the count.' }),
    signals: mk('signals', { metric: 'Reorders by day 45', unit: '%', from: 'shopify', window: 21, watch: ['Opt-outs', 'Messages read', 'Complaints'], attribution: 'A 10% holdout gets no message. The gap in reorders between the two groups is the lift.' })
  };
};
const measureFor = (b) => (b._measure ||= genericMeasure(b));
export const MEASURE = liveView((b) => measureFor(b));

/* ---------- move cards follow their moves (pure; the feed service and tests use it) ---------- */
/* the move a card belongs to, for the team's private copies (m04-1, m1004-1, m1004-1-p → 4, 1004); -1 for any other card */
/* a public static ad card (statics.js): it steps aside for a member whose team has its own set */
export const isStaticCard = (id) => /^(static-|statics-batch$)/.test(String(id || ''));
export const moveOfId = (id) => +((/^m(\d+)-/.exec(id) || [])[1] ?? -1);
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
    if (!docs[n] || docs[n].past) { drop(id, c); continue; } /* gone, or a festival plan whose festival is over (brand-pack fitMoves: past) */
    const v = moveVersion(docs, id); if (c.mv == null) { c.mv = v; continue; }
    if (c.mv === v) continue;
    c.mv = v; const p = src.get(id);
    if (p) { Object.assign(c, clone(p), { createdAt: at, mv: v }); out.replaced.push(id); } else drop(id, c);
  }
  return out;
}

/* ---------- what a person did with the feed, for the ranker (pure; the feed service and test/feed-engagement use them) ---------- */
const DAY_MS = 864e5;
/* "Remind me tomorrow": the lift lasts one day ({ v, until }). A bare number saved before 2026-10-17 lifted the card forever: it
   heals to one last day, once */
export const boostNow = (b, at) => (b && typeof b === 'object' && b.until > at ? +b.v || 0 : 0);
export function healBoosts(boost, at) { for (const [id, b] of Object.entries(boost || {})) { if (typeof b === 'number') boost[id] = { v: b, until: at + DAY_MS }; else if (!(b?.until > at)) delete boost[id]; } return boost; }
/* "seen": the distinct days a card was on screen in the last 7 (redraws and reloads on one day count once); fatigue starts on the
   second day, 1.5 a day, 6 at most. Seen times older than 14 days are dropped */
export function seenDays(ts, at, dayOf, win = 7 * DAY_MS) { const d = new Set(); for (const x of ts || []) if (x <= at && at - x < win) d.add(dayOf(x)); return d.size; }
export const seenFatigue = (days) => (days > 1 ? -Math.min(6, (days - 1) * 1.5) : 0);
export function pruneShown(shown, at, keep = 14 * DAY_MS) { for (const [id, ts] of Object.entries(shown || {})) { const k = (ts || []).filter((x) => at - x < keep); if (k.length) shown[id] = k; else delete shown[id]; } return shown; }
/* times an agent's cards were on screen in the last 24 hours: once per rank, not once per card */
export function agentShown(shown, cards, at) { const n = {}; for (const [id, ts] of Object.entries(shown || {})) { const a = cards.get(id)?.agent; if (!a) continue; for (const x of ts || []) if (at - x < DAY_MS) n[a] = (n[a] || 0) + 1; } return n; }
/* the last time someone worked on each card's jam: a message from a person or Brew (never "X joined") or a new version */
export function jamActivity(work) { const m = new Map();
  for (const w of work || []) { if (!w?.cardId || w.discarded) continue; let last = 0;
    for (const x of w.thread || []) if (x && x.from !== 'system' && x.at > last) last = x.at;
    for (const v of w.versions || []) if (v?.n > 1 && v.at > last) last = v.at;
    if (last > (m.get(w.cardId) || 0)) m.set(w.cardId, last); }
  return m; }
/* an opened (acted-on) card stays up for a day, then sinks by 6 unless its jam is still moving */
export const actedDecay = (actedAt, lastJam, at) => (at - Math.max(actedAt || 0, lastJam || 0) > DAY_MS ? -6 : 0);
/* cards someone really engaged with: a heart, or a person's message in the card's jam. Only these let a second card of the same
   move or rival into the first screen; opening a card is not enough */
export function engagedIds(hearts, work) { const s = new Set(hearts ? [...(hearts.keys ? hearts.keys() : hearts)] : []);
  for (const w of work || []) if (w?.cardId && !w.discarded && (w.thread || []).some((x) => x?.from === 'me' || (x?.by && !['ai', 'system'].includes(x.from)))) s.add(w.cardId);
  return s; }
/* the first screen (12 cards): one card per group (a move, a rival, a live check) unless the first was engaged with, one per
   near topic (the same story told twice), at most 3 from one agent and 2 of one format. The rest wait right after it; a seated
   card (the ad and social seats) is never moved, and nothing is ever dropped */
export function firstScreen(ranked, { groupOf = () => null, engaged = () => false, seated = new Set(), nearOf = () => false, size = 12, perAgent = 3, perFormat = 2 } = {}) {
  const head = [], defer = [], rest = [], seen = new Map(), agents = {}, fmts = {};
  for (const c of ranked) {
    if (head.length >= size) { rest.push(c); continue; }
    const g = groupOf(c), f = g && seen.get(g), fmt = c.make?.format || null, sit = seated.has(c);
    const again = !!f && !engaged(f.id), topic = head.some((h) => nearOf(h, c)), crowd = (agents[c.agent] || 0) >= perAgent || (!!fmt && (fmts[fmt] || 0) >= perFormat);
    if (!sit && (again || topic || crowd)) { defer.push(c); continue; }
    if (g && !f) seen.set(g, c); head.push(c); agents[c.agent] = (agents[c.agent] || 0) + 1; if (fmt) fmts[fmt] = (fmts[fmt] || 0) + 1;
  }
  return [...head, ...defer, ...rest];
}
/* a title near one the person marked Not for me (research.js near: most of the words shared) */
export const nearTitle = (a, b) => !!a && !!b && near({ h: String(a) }, { h: String(b) });

const watchersFor = (b) => (b._watchers ||= [
  { id: 'trends', data: 'live', name: 'Trends', agent: 'brew', cadence: 'Daily', demoEvery: D, firstAt: 45e3, watches: 'Category news, search interest, the festive calendar', produces: 'Trends ring slides; idea cards when a trend meets a product' },
  { id: 'ads-library', data: 'live', name: 'Popular ads', agent: 'performance', cadence: 'Daily', demoEvery: D, firstAt: 75e3, watches: 'Ad libraries in and around the category', produces: 'Popular ads ring; “rivals run this” cards' },
  { id: 'catalog', name: 'Catalog', agent: 'storefront', cadence: 'Every 3 hours', demoEvery: D, firstAt: 30e3, data: 'live', watches: `The live ${b.host} ${b.config?.catalogUrl ? 'catalog' : 'product pages'}: prices, stock, launches, removed items, photos`, produces: 'Exception cards: out of stock, price changes, prices our cards quote, thin listings, new launches' },
  b.kind === 'generated'
    ? { id: 'ads', data: 'live', name: 'Your ads', agent: 'performance', cadence: 'Daily', demoEvery: D, firstAt: 50e3, watches: `Your own live ads in the Meta Ad Library (${b.config.countryName || 'your market'}): how many run, how long each has run, versions, formats, new launches`, produces: 'Refresh cards for ads that have run for months unchanged; launch and count changes. Spend, cost per order and frequency need your Meta account' }
    : { id: 'ads', data: 'sample', name: 'Ads', agent: 'performance', cadence: 'Hourly with Meta connected', demoEvery: 2 * 60e3, firstAt: 25e3, needs: 'meta', watches: 'Frequency, cost per result, fatigue', produces: 'Rotate creative and Shift budget cards' },
  { id: 'visibility', name: 'AI visibility', agent: 'visibility', cadence: 'Weekly', demoEvery: D, firstAt: 40e3, data: 'live', watches: `${(b.config.questions || []).length || 8} shopper questions asked from ${b.config.countryName || 'your market'} to the real AI tools Brew can reach (ChatGPT, Gemini, Perplexity; Claude when Brew runs on Claude)`, produces: 'Score changes, publish-a-page cards, the health ring' },
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
  /* ready carries the read's own name: the reading page opened on the address's placeholder ("In" for in.puma.com) */
  const ready = async () => { if (sentReady || !isOpen()) return; sentReady = true; const f = await Promise.resolve(loadSeed?.()).catch(() => null); if (isOpen()) send({ type: 'ready', ms: Date.now() - startedAt, ...(f?.brand?.name ? { name: f.brand.name } : {}), ...(f?.steps?.length ? { steps: f.steps } : {}), ...(f?.scrape?.length ? { scrape: f.scrape } : {}) }); }; /* the saved read rides along: a viewer whose stream dropped mid-read (a deploy restarts the instance) fills in what it missed */
  const on = (e) => {
    if (e.type === 'reader') { const ev = e.ev, i = STEP_KEYS.indexOf(ev.k);
      if (ev.type === 'step' && ev.state === 'reading') send({ type: 'step', i, state: 'reading', tick: ev.tick || '' });
      if (ev.type === 'finding') send({ type: 'finding', i, finding: ev.finding, say: ev.say });
      if (ev.type === 'picks') send({ type: 'picks', k: ev.k, items: ev.items }); /* the onboarding's taps (products, rivals, who you are) as the reader learns them */
      if (ev.type === 'step' && (ev.state === 'done' || ev.state === 'empty')) { send({ type: 'step', i, state: 'done', empty: ev.state === 'empty', done: ev.done || (ev.state === 'empty' ? 'Nothing found' : 'Done') }); if (AGENT_OF[ev.k] && ev.state === 'done') send({ type: 'agent', agent: AGENT_OF[ev.k] }); } } /* an agent has ideas only from a step that found something: an empty or skipped step (a store that didn't open) wakes nobody */
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

/* jam guests: people who signed in through a shared jam link. They may act on that jam (its work item, the studio change
   linked to it, its card's remix) and nothing else; they are never members, so private moves, memory and the team stay closed.
   A guest chats, edits the brief and makes drafts; sharing or sending the brief, its status, approving, assigning, deciding and
   discarding (the jam, or its studio change, which discards the jam with it: remix.js) stay with the team */
export const GUEST_DO = /^(message|iterate|pick|version|edit|reference|canvas|doc|doc\/(ask|add|sync)|jb|jb\/import|draft|draft\/[^/]+\/drop|plan\/(answer|add))$/;
/* and the paid makes on a change (a final, a video, listing photos, a new picture or its variants, a CTA make): a guest's share link
   never spends the brand's budget on those (QV 25 Oct). A remake stays a guest's to press (Param, 25 Oct) */
export const GUEST_CHANGE_NO = /^(discard|restore|final\/(quote|run|checkpoint)|video|listing-photos|image|variants|cta-make)$/;
export function guestAllows(path, { wids = [], changes = {}, cards = new Set() } = {}) {
  if (!wids.length) return false;
  let m = path.match(/^\/api\/work\/([^/]+)(\/(.*))?$/); if (m) return wids.includes(m[1]) && GUEST_DO.test(m[3] || '');
  m = path.match(/^\/api\/changes\/([^/]+)(?:\/(.*))?$/); if (m) { const ch = changes[m[1]]; if (GUEST_CHANGE_NO.test(m[2] || '')) return false; return !!ch && (wids.includes(ch.workId) || cards.has(ch.cardId)); }
  m = path.match(/^\/api\/cards\/([^/]+)\/(remix|batch|image|page|moves|learned|brief)(\/|$)/); if (m) return cards.has(decodeURIComponent(m[1]));
  return false;
}

export function createFeedService(o) {
  const { PUB, claudeJSON, claudeTool, mockVariants, geminiImage, BANNED, clean, store, packs, builder, log = console } = o;
  /* every card's plan (card-plan.js): the ground-work steps toward its action, with its first draft as v0. Worked out from
     the card itself, so saved cards get it without new spend; every prompt that reads a card reads its plan too */
  const planOfCard = (c) => { if (!c?.id || !c.title) return null; try { return planFor(c, { draft: draftView(draftFor(c, B()?.firstDrafts), c) }); } catch (e) { log.warn?.('[plan]', e.message); return null; } };
  /* the Brand Book (voice, claims allowed, words, real reviews, what the team keeps undoing) reaches every v1 writer too, not only Studio:
     read from its 5-minute cache, filled in the background the first time a brand's writer runs */
  const BOOKTXT = new Map(); const bookText = (t) => { if (!t) return ''; const slug = slugOfT(t), hit = BOOKTXT.get(slug);
    if (!hit || Date.now() - hit.at > 5 * 60e3) { BOOKTXT.set(slug, { at: Date.now(), text: hit?.text || '' }); BOOK.load(slug).then((bb) => { const v = BOOK.view(bb); BOOKTXT.set(slug, { at: Date.now(), text: BOOK.promptBlock(v).slice(0, 3500), noPeople: v?.comfort?.people === 'none' }); }).catch(() => {}); }
    return hit?.text ? `\n\nTHE BRAND BOOK (follow it):\n${hit.text}` : ''; };
  const cardBrief = (c0, role, t = null) => { let c = c0; if (t && c0) { try { c = freshCounts(c0, countsFor(packFor(t)), { live: !!t.member }); } catch { c = c0; } } /* the card's counts as of today's fact sheet, the same numbers the writer is told */
    return `${o.cardBrief(c, role, t?.member ? packFor(t)?.factBrief : null)}${planPrompt(planOfCard(c))}${bookText(t)}`; }; /* a member's writers quote the team's truth (their connected accounts), a visitor's the public sheet */
  /* demo mode: a request from someone who may not make fresh work runs every AI path as mock (nothing spent, the plain
     version shown); the background clock and the team's requests are unchanged */
  const isMock = () => !!o.isMock?.() || demoReq(), spend = (k, n) => !demoReq() && (o.spend ? o.spend(k, undefined, n) : true);
  // real connected accounts (connectors/index.js): who is on the brand's team, and the live cards they get
  const viewerOf = o.viewerOf || (async () => ({ member: false, claimed: false })), liveFor = o.liveFor || (async () => ({ cards: [], on: {}, privMoves: [] }));
  const photoFile = o.photoFile || ((rel) => { const f = path.resolve(PUB, String(rel || '')); return /\.\./.test(String(rel || '')) || !f.startsWith(PUB + path.sep) ? null : f; });
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
  let TB = null; // the team brief (team-brief.js)
  let MOVES = null; // the move documents (moves.js)
  let RMX = null; // the studio (remix.js), wired up once the routes exist
  let JAM2 = null; // Jam v2 (jam2/routes.js), ?v=2 only
  /* the Brand Book: one store for v1 and Jam v2 (jam2/brandbook.js), its page, uploads and share routes (brand-book-routes.js) */
  const BOOK = createBrandbook({ packs: o.globalPacks || packs, log: console });
  builder?.onBook?.((slug) => { BOOK.drop(slug); BOOKTXT.delete(slug); }); /* a freshly written read layer reaches every maker at once */
  for (const k of ['update', 'save']) { const f0 = BOOK[k]; if (typeof f0 === 'function') BOOK[k] = async (slug, ...a) => { const r = await f0(slug, ...a); BOOKTXT.delete(slug); return r; }; } /* a Brand Book edit reaches the v1 writers at once, not in five minutes */
  let JAM_FINALS = null; // the jam's finals (finals-routes.js), for a final that lands after a restart
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
  /* Postgres: another instance wrote a workspace this one holds. An idle copy here (nobody on it for 30 s, nothing waiting
     to be saved) is dropped, so the next request reads the newer one; a copy in use stays, and its saves carry only its own
     changes (store.js) */
  store?.onRemote?.((id) => { const drop = (t) => { if (!t || Date.now() - (t.lastSeen || 0) < 30e3 || store.pending?.(t.id)) return; tenants.delete(t.id); store.forget?.(t.id); };
    if (id === '*') { for (const t of [...tenants.values()]) drop(t); } else drop(tenants.get(id)); });
  /* jam emails to the team (jam-mail.js); the demo site never sends */
  const mailEv = (t, w, ev) => { if (!o.jamMail || process.env.DEMO_MODE === '1') return; const ct = t.cards?.get?.(w.cardId)?.title; /* the email names the jam as the jam shows it (its card), never a draft's own headline */ o.jamMail.event(t.brandId || DEFAULT_BRAND, ct && ct !== w.title ? { ...w, title: ct } : w, ev).catch((e) => log.warn?.('[jam-mail]', e.message)); };
  const nameOf = (p) => p?.name || p?.email || 'Someone';
  /* Your feed (member-tuning.js): a member's tuning is theirs on every device (keyed by their email); anyone else tunes this workspace */
  const TUNE = o.tuning || createTuning({ packs: o.globalPacks || packs, log });
  const REFS = o.references || createReferences({ packs: o.globalPacks || packs, log }); /* references.js: brands/<slug>/private/references.json + refs/<sha>.<ext> */
  const tuneKey = (t) => { const r = reqOf(t), e = r?.member ? r.email : r?.guest?.email; return e ? memberKey(e) : `ws_${t.id}`; };
  const tuningOf = (t) => TUNE.peek(t.brandId || DEFAULT_BRAND, tuneKey(t));
  /* the ShopOS team was tagged: its shared inbox gets the jam link and the read-only brief (jam-mail.js shopos) */
  const shoposMail = (t, w, { why, text }) => { if (!o.jamMail || process.env.DEMO_MODE === '1') return; const base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com';
    o.jamMail.shopos(t.brandId || DEFAULT_BRAND, w, { by: meOf(t), why, text, ticket: w.ticket || null, jamUrl: `${base}${jamPath(t, w)}`, briefUrl: `${base}${handoffPath(t, w)}?full=1` }).catch((e) => log.warn?.('[jam-mail] shopos', e.message)); };
  /* Send brief (UI2): the whole brief to the ShopOS team's inbox (jam-mail.js briefSent), and each status the team sets back to
     the person who sent it (briefStatus). The demo site never sends: the brief is still frozen and tracked, the email is not sent */
  const bannedWords = () => String(B()?.config?.banned || '').replace(/\[[^\]]*\]\??/g, '').replace(/\\b|\\w\*|[()?]/g, '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 20);
  const briefSentMail = async (t, w) => { if (!o.jamMail?.briefSent || process.env.DEMO_MODE === '1') return false; const base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', jb = w.jamBrief || {};
    return o.jamMail.briefSent(t.brandId || DEFAULT_BRAND, w, { by: meOf(t) || jb.sender, md: jb.md || w.doc?.md || '', parts: briefParts(jb.context || {}, jb, { banned: bannedWords() }), ticket: w.ticket || null, jamUrl: `${base}${jamPath(t, w)}`, briefUrl: `${base}${handoffPath(t, w)}?full=1`, key: String(jb.sharedAt || '') }); };
  const briefStatusMail = (t, w, x) => { const to = w.jamBrief?.sender?.email; if (!to || !o.jamMail?.briefStatus || process.env.DEMO_MODE === '1') return; const base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com';
    o.jamMail.briefStatus(t.brandId || DEFAULT_BRAND, w, { ...x, to, ticket: w.ticket || null, jamUrl: `${base}${jamPath(t, w)}` }).catch((e) => log.warn?.('[jam-mail] brief status', e.message)); };
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
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x))); /* a live card with no rows or detail is fine (it threw on every request) */
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
      viewer: { role: 'founder', wants: ['decision', 'idea'], lane: firstLane(), ...cleanViewer(snap.viewer, { tools: Object.keys(SEED.connectors || {}) }) }, conn: { ...(snap.conn || {}) },
      cards: new Map(), feedback: [], runs: [], jams: [], versions: [], memory: [], qa: [], router: [], wlog: [], api: {},
      fewer: { ...(snap.fewer || {}) }, snoozed: {}, boost: {}, shown: {}, acted: new Set(), actedAt: {}, noTitles: [], days: new Set(),
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
    (Array.isArray(snap.saved) ? snap.saved : []).slice(0, 300).forEach((id) => { if (t.cards.has(id)) t.feedback.push({ id: uid('f'), cardId: id, kind: 'save', weight: 1.5, at: t0 }); }); /* saves kept in the browser before they were kept here */
    Object.keys(snap.dismissed || {}).forEach((id) => { const c = t.cards.get(id); if (c) c.state = 'dismissed'; });
    Object.entries(snap.done || {}).forEach(([id, label]) => { const c = t.cards.get(id); if (c) { c.state = 'done'; c.done = label; } });
    (snap.extra || []).forEach((e) => { if (e?.card?.id && !t.cards.has(e.card.id)) t.cards.set(e.card.id, { ...e.card, parentCardId: e.after || e.card.parentCardId || null, origin: e.card.origin || 'user', state: 'ready', createdAt: t0, history: [['ready', t0]], loading: false }); });
    tenants.set(t.id, t);
    return t;
  };
  const touch = (t) => { t.lastSeen = Date.now(); t.days.add(dayKey(now(t))); visitTick(t, now(t)); }; /* visits feed the Recap ring (recap.js) */
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
  /* a card someone opened, hearted or built on: when, so it can sink again a day later (actedDecay) */
  const markActed = (t, id) => { t.acted.add(id); (t.actedAt ||= {})[id] = now(t); };
  const housekeep = (t) => {
    const n = now(t), today = dayKey(n);
    t.cards.forEach((c) => { if (c.expiresAt && c.expiresAt < n && !['expired', 'dismissed', 'done', 'dropped', 'story'].includes(c.state)) setState(t, c, 'expired'); });
    /* Remind me tomorrow: back on top for one day, then ranked like any other card (it used to stay up for good) */
    healBoosts(t.boost ||= {}, n);
    Object.entries(t.snoozed).forEach(([id, d]) => { if (d !== today) { delete t.snoozed[id]; t.boost[id] = { v: 8, until: n + D }; } });
    pruneShown(t.shown ||= {}, n);
    /* an acted card with no time yet (saved before times were kept, or marked by the studio): the jam's start or the heart, else now */
    const at0 = (t.actedAt ||= {}), untimed = [...t.acted].filter((id) => at0[id] == null);
    if (untimed.length) { const hearts = new Map(t.feedback.filter((f) => f.kind === 'heart').map((f) => [f.cardId, f.at]));
      for (const id of untimed) at0[id] = Math.min(...(t.work || []).filter((w) => w.cardId === id).map((w) => w.createdAt || n), hearts.get(id) || n, n); }
    /* titles marked Not for me, so near ones sink too; healed from the feedback once */
    if (!t.noTitles) t.noTitles = t.feedback.filter((f) => f.kind === 'not_interested').map((f) => ({ h: t.cards.get(f.cardId)?.title, at: f.at })).filter((x) => x.h).slice(-40);
    /* expired cards leave the workspace a week later, unless someone worked on, versioned, saved or gave feedback on them */
    const keep = new Set([...(t.work || []).map((w) => w.cardId), ...(t.versions || []).map((v) => v.cardId), ...t.feedback.map((f) => f.cardId), ...t.acted, ...(t.pinned || []).map((x) => x.id)]);
    for (const c of t.cards.values()) if (c.parentCardId) keep.add(c.parentCardId);
    for (const [id, c] of t.cards) { if (c.state !== 'expired' || keep.has(id)) continue; const h = (c.history || []).filter((x) => x[0] === 'expired').at(-1); const at = h?.[1] ?? c.expiresAt ?? c.createdAt ?? n;
      if (n - at > 7 * D) t.cards.delete(id); }
    const wk = weekKey(n); t.runs.forEach((r) => { if (r.week !== wk) r.counted = false; });
    healCatalog(t, keep);
    healWatcherLooks(t);
  };
  /* a creative watcher's picture made before the look check (LOOKS_V: a generic prompt over the lane's photo, never judged) is
     swapped, free, for the real photo of the product the card names (else the brand's own product photo): the paste-ups it made
     (25 Oct, Arata) are never served again. New pictures are made around the named product and judged (creativeIdea) */
  const healWatcherLooks = (t) => { const cat = B()?.catalog || [];
    for (const c of t.cards.values()) { if (c.watcher !== 'creative' || c.imgQ === LOOKS_V + 0.4) continue; const was = c.imgQ; c.imgQ = LOOKS_V + 0.4; /* .1: matched by price too (healed again once) */
      if (!/^gen\//.test(String(c.images?.[0] || '')) && !(was >= LOOKS_V && c.product)) continue; /* a picture this heal already swapped is matched again */
      const named = cat.length ? pricedProduct(`${c.title || ''}. ${c.sub || ''}`, cat, { brand: BN() }) : null;
      /* the idea names no product the store sells (a price or a line the catalog doesn't carry): no picture at all, never another product's */
      if (named) { c.images = [named.img]; c.product = named.t; } else { delete c.product; c.images = []; c.kind = 'rows'; c.rows ||= []; } } };
  /* saved catalog cards are written again from their reading (QA FEED-ARV-08, CAT_V): product · issue · fix, best sellers first.
     The old "products our cards sell" reading is part of the one stock-out card now: its own card steps aside (kept if worked on) */
  const healCatalog = (t, keep = new Set()) => { const evs = live?.get()?.catalog?.events || [], vevs = live?.get()?.visibility?.events || [];
    if (vevs.length) for (const c of t.cards.values()) { if (c.liveSrc?.kind !== 'visibility' || c.visV === VIS_V) continue; const e = vevs.find((x) => x.id === c.liveSrc.id); if (e?.kind !== 'gap') continue; c.visV = VIS_V; /* saved gap cards say their own fix too */
      const f = liveCard('visibility', e, t); if (f) for (const k of ['title', 'sub', 'rows', 'detail', 'link']) if (f[k] !== undefined) c[k] = f[k]; }
    for (const c of t.cards.values()) { if (c.liveSrc?.kind !== 'catalog') continue;
      if (/^cat-oos-q-/.test(c.liveSrc.id) && !keep.has(c.id) && !['dismissed', 'done', 'dropped', 'expired'].includes(c.state)) { setState(t, c, 'dropped'); continue; }
      if (c.catV === CAT_V || !evs.length) continue; c.catV = CAT_V; /* the watcher's readings load after boot: heal once they are here */
      const e = evs.find((x) => x.id === c.liveSrc.id); const f = e && liveCard('catalog', e, t); if (!f) continue;
      for (const k of ['title', 'sub', 'rows', 'detail', 'badge', 'cta', 'liveNums', 'link']) if (f[k] !== undefined) c[k] = f[k]; } };

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
  /* the look a heart lifts: a finished static ad only (every card has a photo or rows, so "photo" or the kind lifted 70% of the feed) */
  const clusterOf = (c) => (c.images?.[0]?.includes('statics/') ? 'statics' : null);
  /* the product a card is about (product-match.js), remembered per catalog so a rank reads each card once */
  const prodMemo = new WeakMap();
  const productOf = (t, c) => { const cat = brandOfT(t)?.catalog; if (!cat?.length) return null; let m = prodMemo.get(cat); if (!m) { m = new Map(); prodMemo.set(cat, m); }
    const k = `${c.id}|${c.title || ''}`; if (!m.has(k)) { let p = null; try { p = cardProduct(c, cat, { brand: BN() })?.t || null; } catch {} m.set(k, p); if (m.size > 3000) m.clear(); } return m.get(k); };
  /* this person's saved cards: their own list (member-tuning.js, every device) once there is one, else this workspace's saves */
  const savedOf = (t, tu = tuningOf(t)) => { if (Array.isArray(tu?.saved) && tu.saved.length) return new Set(tu.saved);
    const s = new Set(); t.feedback.forEach((f) => { if (f.kind === 'save') s.add(f.cardId); if (f.kind === 'unsave') s.delete(f.cardId); }); return s; };
  /* hearts lift the same agent, campaign, format (what the card makes), product and look; a save counts as 1.5 hearts */
  const affinityMap = (t) => {
    const a = { agent: {}, campaign: {}, format: {}, cluster: {}, product: {} };
    const hearts = new Map(); t.feedback.forEach((f) => { if (f.kind === 'heart') hearts.set(f.cardId, 1); if (f.kind === 'unheart') hearts.delete(f.cardId); });
    a.no = {}; a.noSector = {}; t.feedback.forEach((f) => { if (f.kind !== 'not_interested') return; const c = t.cards.get(f.cardId); if (!c) return; a.no[c.agent] = (a.no[c.agent] || 0) + 1; a.noSector[c.sector] = (a.noSector[c.sector] || 0) + 1; });
    const liked = new Map(hearts); savedOf(t).forEach((id) => liked.set(id, (liked.get(id) || 0) + 1.5));
    const add = (o, k, w) => { if (k) o[k] = (o[k] || 0) + w; };
    liked.forEach((w, id) => { const c = t.cards.get(id); if (!c) return; add(a.agent, c.agent, w); add(a.campaign, c.campaign, w); add(a.format, c.make?.format, w); add(a.cluster, clusterOf(c), w); add(a.product, productOf(t, c), w); });
    return { a, hearts };
  };
  /* the ranker, v2 (2026-10-14): expected value first, then fit and learning; freshness decides between cards of similar value.
     value 0-10: value.js (a move's graded impact x confidence x urgency / effort; live exceptions high; research and listening
     middle). The old money-in-the-text impact only counts for a brand with a known monthly revenue and no grade.
     seat: role, lane and the types this person picked (x0.6). affinity: hearts lift the same agent, campaign, kind and look;
     "not for me" and "fewer" push them down. fatigue: a card shown again and again without being opened sinks */
  const STREAMY = (c) => !!(c.stream || c.liveOnly || c.live || c.research || c.liveSrc || c.family === 'exception' || c.origin === 'watcher'); /* a watcher's card (a paid Creative idea too) is news: it fades like one */
  // the "rests on what the team told Brew" lift, per pack (not saved on the card): new learnings re-rank every card
  const toldMemo = new WeakMap();
  const toldOf = (c) => { const terms = B()?.learnedTerms; let m = toldMemo.get(terms || toldMemo); if (!m) { m = new Map(); toldMemo.set(terms || toldMemo, m); }
    if (!m.has(c.id)) m.set(c.id, cardUsesLearned(`${c.title || ''} ${c.sub || ''} ${(c.detail?.why || []).join(' ')} ${(c.detail?.how || []).join(' ')}`, terms) ? 5 : 0); return m.get(c.id); };
  /* the feed's label "From what your team told Brew": a card the team's words made (told-…), lifted, or whose move was rewritten on
     them, or one that quotes them itself. One test for every card type, so a label never depends on how the card was written */
  /* the learnings name the public card (m12-1); a connected team sees its private twin (m12-1-p, connectors/common.js privId) */
  const inLearned = (k, id) => { const x = B()?.[k]; return !!x && (x.has(id) || x.has(String(id || '').replace(/-p$/, ''))); };
  /* the label is a promise the proof sheet keeps (evidence.js teamOf): a card the learnings made or lifted, or one of a move rewritten on
     them. Never shared words alone, and never a rival's ad or a listening find: what someone else does is not what the team told Brew */
  const toldCard = (c) => !!c && !(c.research?.kind === 'ad' || c.research?.kind === 'viral' || c.origin === 'listen' || c.stream === 'heard') && (c.origin === 'told' || c.told === true || inLearned('teamCards', c.id) || inLearned('learnedUp', c.id) || !!B()?.learnedMoves?.has(moveNo(c.id)));
  // who may see that a card rests on what the team told Brew: the same people as the told list (server.js /told)
  const toldSeen = (t) => process.env.DEMO_MODE === '1' || !!t?.member || process.env.FEED_SIGNIN === '0';
  const STOCK_NOW = /\b(?:sold[ -]?out|out of stock|0 left|5 or fewer units|stock-?outs?)\b/i;
  const urgencyOf = (c, at) => { if (c.research || c.post || /^(?:r-|heard-)/.test(String(c.id || ''))) return { score: 0, why: '' }; /* a rival's ad or a thread is news, not the brand's own money at stake */
    const txt = `${c.title || ''} ${c.sub || ''} ${(c.rows || []).flat().join(' ')}`; let score = 0, why = '';
    const m = /([₹$£€])\s?([\d,]+(?:\.\d+)?)\s?(k|L|lakh|Cr)?\s*(?:a|per|\/)\s*(day|week|month)/i.exec(txt);
    if (m) { const n = +m[2].replace(/,/g, '') * ({ k: 1e3, l: 1e5, lakh: 1e5, cr: 1e7 }[String(m[3] || '').toLowerCase()] || 1), perDay = n / ({ day: 1, week: 7, month: 30 }[m[4].toLowerCase()]); if (perDay > 0) { score += Math.min(4, Math.log10(1 + perDay) * (m[1] === '₹' ? 0.9 : 1.4)); why = `${m[1]}${m[2]}${m[3] || ''} a ${m[4].toLowerCase()} at stake`; } }
    if (STOCK_NOW.test(txt)) { score += 3; why ||= 'Sold out or nearly: it costs sales every day'; }
    const d = /\b(\d{1,2}) days? (?:away|left|to go)\b|\bin (\d{1,2}) days?\b/i.exec(txt), days = d ? +(d[1] || d[2]) : null; if (days != null && days <= 10) { score += 3 - days / 5; why ||= `${days} day${days === 1 ? '' : 's'} left`; }
    if (/^live-/.test(String(c.id || ''))) { score += 1.5; why ||= 'From your account today'; }
    return { score: +score.toFixed(2), why }; };
  const score = (t, c, af) => {
    const v = t.viewer, R = SEED.roles[v.role] || SEED.roles.founder;
    const ageH = Math.max(0, (now(t) - c.createdAt) / H);
    const fresh = +(STREAMY(c) ? 3 * Math.exp(-ageH / 24) : 1 * Math.exp(-ageH / 72)).toFixed(2);
    const imp = impactOf(c), graded = moveNo(c.id) != null && B()?.moveValue?.[moveNo(c.id)];
    let val = cardValue(c, B()?.moveValue || {}, now(t)); if (!graded && BASE()) val = Math.max(val, imp.s * 2);
    const g = graded ? B().moveValue[moveNo(c.id)] : null;
    const valNote = g ? `Impact ${g.impact}/5, confidence ${Math.round(g.confidence * 100)}%, effort ${['', 'hours', 'days', 'weeks', 'a month+'][g.effort]}${g.by ? `, by ${g.by}` : ''}${g.now ? ', doable now' : ''}` : imp.note;
    const pr = af.product && Object.keys(af.product).length ? productOf(t, c) : null;
    const aff = (af.agent[c.agent] || 0) * 1.5 + (c.campaign ? (af.campaign[c.campaign] || 0) * 1.5 : 0) + (c.make?.format ? af.format[c.make.format] || 0 : 0) + (pr ? (af.product[pr] || 0) * 1.5 : 0) + (clusterOf(c) ? af.cluster[clusterOf(c)] || 0 : 0) - (af.no?.[c.agent] || 0) * 0.75 - (af.noSector?.[c.sector] || 0) * 0.5
      - ((af.noTitles || []).some((x) => nearTitle(x.h, c.title)) ? 4 : 0); /* near a title they marked Not for me */
    const said = (v.focusTerms || []).length ? Math.min(2, (v.focusTerms || []).filter((w) => `${c.title || ''} ${c.sub || ''} ${c.campaign || ''} ${c.src || ''}`.toLowerCase().includes(w)).length) * 3 : 0; /* what they said should come first, in their words */
    const seat = said + 0.6 * ((R.sector[c.sector] || 0) * 3 + (R.type[c.type] || 0) * 2 + (v.wants.includes(c.type) ? 5 : 0) + (c.lane === v.lane ? 6 : 0) + ((c.roles || []).includes(v.role) ? 4 : 0) + (c.boostFor?.[v.role] || 0)) / 2.5;
    /* fatigue: the agent's cards on screen today, then this card: days it was seen (an opened card instead sinks a day after its
       jam goes quiet). Seen counts days, never page redraws */
    const seen = seenDays(t.shown[c.id], now(t), dayKey), acted = t.acted.has(c.id);
    const dec = acted ? actedDecay(t.actedAt?.[c.id], af.jamAt?.get(c.id), now(t)) : 0, fatigue = -Math.min(4, (af.shown24?.[c.agent] || 0) * 0.08) + (acted ? dec : seenFatigue(seen));
    const fb = -2 * ((af.fewer || t.fewer)[c.agent] || 0), tune = tuneScore(af.tune, c, af.notes); /* the member's own weights, topics and the words of their notes */
    // what the team told Brew comes first: cards of a move that rests on it, or that quote it themselves
    const told = toldOf(c) || (B()?.learnedMoves?.has(moveNo(c.id)) ? 6 : 0), /* a move rewritten on the team's strategy: its cards come first */ lift = inLearned('teamCards', c.id) ? 10 : inLearned('learnedUp', c.id) ? 8 : 0;
    const contra = inLearned('learnedHide', c.id) ? -40 : 0; /* the team said it doesn't work for them: off the top until someone says "bring back" (brand-learnings.js) */
    const art = draftView(draftFor(c, B()?.firstDrafts), c); /* a first draft with a picture or clip: the first screen should be things to look at */
    const look = (art?.images?.length || art?.video ? 3 : 0) + (isStaticCard(c.id) || c.research?.kind === 'ad' || c.research?.kind === 'viral' ? 2 : 0);
    const urg = urgencyOf(c, now(t)); /* urgency and money at stake (3.11): what is happening now and the money a day or week it names */
    const extra = urg.score + told + look + boostNow(t.boost?.[c.id], now(t)) + (c.onlyWhen && connOn(t, c.onlyWhen) ? 3 : 0) + (c.live && Object.keys(c.live).some((k) => connOn(t, k)) ? 2 : 0) + (c.liveOnly ? 2 : 0);
    const behind = B()?.staleMoves?.has(moveNo(c.id)) ? -8 : 0; /* its move is being rewritten: off the first screen until the new card lands */
    /* what they said in setup: a card only for channels they don't run sinks; their ad pace lifts new ads or groundwork (channel-fit.js). 0 with no answers */
    const chan = channelFit(v.channels, c), pace = paceFit(v.adPace || paceOf(B()?.numbers?.ownAds?.n), c); /* no answer: the pace the read counted */
    const total = val + seat + aff + fresh + fatigue + fb + extra + behind + tune + lift + contra + chan + pace;
    return { urgency: urg.score, rankWhy: urg.why || null, fresh, told, look, value: val, impact: +val.toFixed(2), impactNote: valNote, impactV: imp.v, impactPct: imp.pct, isDecision: imp.decision, affinity: +aff.toFixed(2), seat: +seat.toFixed(2), fatigue: +fatigue.toFixed(2), feedback: fb, tune, boost: boostNow(t.boost?.[c.id], now(t)), extra, chan, pace, total: +total.toFixed(2), seen, ...(dec ? { quiet: true } : {}) };
  };
  const connOn = (t, k) => !!(t.conn?.[k] || t.liveConn?.[k]);
  // live cards are the team's only; a real account hides its demo cards; a move rewritten privately replaces its shared cards
  /* views: a member limited to some seats sees only cards meant for one of them; cards with no roles are everyone's */
  const seatOk = (t, c) => { const S = t.seats; return !S || !c.roles?.length || c.roles.some((r) => S.includes(r)); };
  /* a limited member can only view as one of their seats */
  const clampSeat = (t) => { const S = t?.seats; if (S && t.viewer && !S.includes(t.viewer.role) && S.length) t.viewer = { ...t.viewer, role: S[0] }; };
  // a price card saved before the paise fix whose every row is "₹1,850 → ₹1,850" says nothing changed: never shown
  const noChange = (c) => c.liveSrc?.kind === 'catalog' && c.badge?.[0] === 'Price changed' && c.rows?.length && c.rows.every((r) => { const m = /^(.+) → (.+)$/.exec(r?.[1] || ''); return m && m[1] === m[2]; });
  /* a card made before the claim check (23 Oct QA 1.5: eight Arata cards still said "Dermat-approved"): a static ad whose words are
     set on its picture can't be edited, so one that carries a claim the store doesn't back is held back; other cards are cleaned
     when served (pub) */
  const CLAIM_HOLD = new Map();
  const claimHeld = (t, c) => { if (!/^static-/.test(String(c?.id || ''))) return false; const k = `${c.id}|${c.title}`; let v = CLAIM_HOLD.get(k);
    if (v === undefined) { try { v = claimFlags(String(c.title || ''), packSource(packFor(t))).length > 0; } catch { v = false; } /* the store's own words only: the ad plan that wrote the claim can't back it */ CLAIM_HOLD.set(k, v); if (CLAIM_HOLD.size > 5000) CLAIM_HOLD.clear(); } return v; };
  /* the Deck column a card belongs in, by what it changes (1.13: an order-confirmation message sat under Ads, store-page builds under
     Signals): an ad or post to make → Creatives; budgets, campaigns, audiences → Ads; a message to customers → Signals; a product page,
     listing, price or stock → Catalog; AI answers, search, press → AI answers. A connector's card, a rival's ad, a reading or a card
     whose words name none of these keeps the column it was given */
  const SECTOR_BY = [['signals', /\b(?:e-?mail|whatsapp|sms|flow|reminder|nudge|re-?order|replenish|win-?back|order confirmation|confirm (?:the )?order|review (?:ask|request)|customers? who|buyers? who|post-?purchase|cod confirm)/i],
    ['ads', /\b(?:budget|campaign|ad set|audience|retarget|lookalike|cost per|frequency|bid|scale (?:the )?(?:ad|winner)|pause (?:the )?ads?|exclude)/i],
    ['visibility', /\b(?:ai answers?|chatgpt|perplexity|gemini|llms?\.txt|search results?|google search|seo|press|citations?|faq block|schema|rank(?:ed|ing)? (?:on|in) google)/i],
    ['catalog', /\b(?:product page|listing|collection page|landing page|pdp|price|mrp|stock|sold out|bundle|combo page|catalog|amazon|myntra|nykaa|flipkart|quick commerce|blinkit|zepto|(?:store |home ?|referral |dedicated |custom |new )?page\b|hero section|section on)/i]];
  /* a page or section to build is the store's, whatever audience it is for ("a dedicated page for older buyers"): it is read before
     the message words so a page for buyers never lands under Signals */
  const PAGE_BUILD = /\b(?:build|launch|add|create|make|design)\b[^.]{0,40}\b(?:page|section|hero)\b/i;
  const ADMAKE = /carousel|collection|catalog ad|instagram|reel|video|image ad|static|post|stories/i;
  const sectorOf = (c) => { if (!c || /^(?:live-|r-ad-|lv-|heard-|static|build-)/.test(String(c.id || '')) || ['ad', 'viral'].includes(c.research?.kind) || c.type === 'report') return c?.sector;
    if (ADMAKE.test(c.make?.format || '')) return 'creatives';
    if (PAGE_BUILD.test(c.title || '') && !/\b(?:facebook|instagram) page\b/i.test(c.title || '')) return c.sector === 'storefront' && !storefrontOn() ? c.sector : 'catalog';
    const said = `${c.title || ''} ${c.cta?.label || ''}`; for (const [k, re] of SECTOR_BY) if (re.test(said)) return k === 'catalog' && !storefrontOn() && c.sector === 'storefront' ? c.sector : k;
    return c.sector; };
  const visible = (t, c) => seatOk(t, c) && (c.sector !== 'storefront' || storefrontOn()) && !claimHeld(t, c) && !noChange(c) && !(c.origin === 'watcher' && c.type === 'idea' && !titlePricesMatch(c)) && ['ready', 'shown', 'approved', 'done'].includes(c.state) && !t.snoozed[c.id] && (!c.onlyWhen || connOn(t, c.onlyWhen))
    && !(c.liveOnly && !t.member) && !(c.demo && (t.member || t.liveConn?.[c.onlyWhen])) && !(!c.liveOnly && t.privMoves?.includes(moveOfId(c.id))) && !(!c.liveOnly && t.privStatics && isStaticCard(c.id));
  // bring a workspace in line with what this viewer may see: add the live cards, drop the ones they may not have
  const applyLive = async (t, viewer) => {
    if (!t) return; t.member = !!viewer?.member; t.claimed = !!viewer?.claimed; t.memberEmail = viewer?.member && viewer?.email ? viewer.email : null; /* a signed-out or non-member viewer no longer carries the last member's name or personal memory */
    /* the live state is this request's own (member-ctx.js); a read that failed changes nothing, and only a member's view adds or
       drops the team's cards: a visitor's request, or a failed read, never takes the team's cards out of the workspace */
    const L = await liveFor(t.brandId || DEFAULT_BRAND, t.member).catch((e) => (log.warn?.('[live] read', t.brandId, e.message), null));
    if (!L) return;
    t.liveConn = L.on || {}; t.privMoves = L.privMoves || []; t.privStatics = !!L.privStatics; t.liveLedger = L.ledger || {};
    L.cards = (L.cards || []).filter((c) => c && c.id); /* one bad card from a connector (undefined) used to throw on every request for the brand */
    const fitLive = packs.peek(t.brandId || DEFAULT_BRAND)?.fitLive; if (fitLive) try { L.cards = fitLive(L.cards).filter((c) => c && c.id); } catch (e) { log.warn?.('[live] fit', e.message); } /* the same photo and button fitting as the shared cards */
    const ids = new Set(L.cards.map((c) => c.id)), t0 = now(t);
    if (t.member) for (const [id, c] of t.cards) if ((c.liveOnly || c.publicLive) && !ids.has(id)) t.cards.delete(id);
    for (const p of L.cards) { const have = t.cards.get(p.id);
      if (!have) t.cards.set(p.id, { ...clone(p), family: p.family || FAMILY[p.type] || 'idea', state: 'ready', origin: 'live', createdAt: t0, expiresAt: null, history: [['ready', t0]], shownCount: 0 });
      else if (have.title !== p.title || JSON.stringify(have.rows) !== JSON.stringify(p.rows)) Object.assign(have, { title: p.title, sub: p.sub, rows: clone(p.rows), badge: p.badge, detail: clone(p.detail) });
      if (have && (have.sector !== p.sector || have.agent !== p.agent || JSON.stringify(have.roles) !== JSON.stringify(p.roles))) Object.assign(have, { sector: p.sector, agent: p.agent, roles: clone(p.roles) }); /* a saved copy follows the card's section and seats (the COD card moved to Signals, 23 Oct) */
      if (have) { /* a saved copy heals: the photo, asset and button as the card's words now call for (never over a picture made in the jam) */
        if (p.images && !(have.images || []).some((u) => /^\/?gen\//.test(u)) && JSON.stringify(have.images) !== JSON.stringify(p.images)) have.images = clone(p.images);
        if (p.make && JSON.stringify(have.make) !== JSON.stringify(p.make)) have.make = clone(p.make);
        if (p.cta?.label && have.cta?.label !== p.cta.label) have.cta = clone(p.cta);
        /* a budget card's move (campaigns, amounts, ids) and the figures it may quote follow today's read, or go when the read has none:
           a saved copy kept yesterday's move, so its draft could move another amount than the card said (1.1) */
        for (const k of ['shift', 'liveNums']) { if (p[k] !== undefined) { if (JSON.stringify(have[k]) !== JSON.stringify(p[k])) have[k] = clone(p[k]); } else if (have[k] !== undefined) delete have[k]; } } }
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
    /* a reading taken again on another day (the AI answers score, the own-ads check) is the same news: only the newest stays (QA 20 Oct) */
    const day = /^(lv-vis-score|ow-own-[a-z]+)-\d{4}-\d\d-\d\d$/.exec(String(c.id || '')); if (day) return `one:day:${day[1]}`;
    /* two cards of one rival's ads with the same title ("Modivo: live 136 days in 1 version") */
    if (c.research?.kind === 'ad' && c.title) return `one:ad:${String(c.title).toLowerCase()}`;
    // the scheduled Creative agent pitching the brand's festival again: only its newest idea stays
    const fest = FESTN(); if (c.origin === 'watcher' && c.type === 'idea' && fest && fest !== 'the next sale' && new RegExp(`\\b${fest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(c.title || '')) return `one:fest`;
    return null; };
  const lastRank = new WeakMap(); /* the newest ranking per workspace: the rings reuse it for a minute instead of ranking again */
  const rank = (t) => {
    housekeep(t);
    const tu = tuningOf(t), { af: a, fewer } = withoutIgnored(affinityMap(t).a, t.fewer, tu?.ignored); a.fewer = fewer; a.tune = tu; /* signals the member deleted no longer count */
    /* read once per rank, not once per card: the agents' cards on screen today, each card's last jam activity, the words of the
       person's notes, and the titles they marked Not for me */
    a.shown24 = agentShown(t.shown, t.cards, now(t)); a.jamAt = jamActivity(t.work); a.noTitles = t.noTitles || [];
    const ns = noteSides(tu?.notes); /* a "no" in a note pushes its words down (member-tuning.js noteSides) */
    a.notes = noteTopics([...ns.up, ...(t.cardNotes || []).filter((n) => n.useful !== false).map((n) => n.text)], [...ns.down, ...(t.cardNotes || []).filter((n) => n.useful === false).map((n) => n.text)]);
    const eng = engagedIds(affinityMap(t).hearts, t.work);
    const all = [...t.cards.values()];
    const top = all.filter((c) => visible(t, c) && !c.parentCardId && c.origin === 'user').sort((x, y) => y.createdAt - x.createdAt);
    const pool = all.filter((c) => visible(t, c) && !c.parentCardId && c.origin !== 'user' && c.origin !== 'signal');
    const scores = {}; pool.forEach((c) => (scores[c.id] = score(t, c, a)));
    /* one card per ask: cards of different moves that ask for the same thing show once, as the best-graded of them, where the first
       of them ranked; the rest wait at the end of the feed (never dropped). A card someone engaged with or opened stays put */
    const asks = oneAsk(pool.sort((x, y) => scores[y.id].total - scores[x.id].total), { moveOf: (c) => moveNo(c.id), value: (c) => cardValue(c, B()?.moveValue || {}, now(t)), noise: noiseOf(SEED.brand?.name, BH()), keep: (c) => eng.has(c.id) || t.acted.has(c.id) });
    /* two cards that tell the team opposite things about one ad or campaign: the one on the account's numbers (or the stronger one)
       stays, the other waits like a repeat, unless someone engaged with it (1.4) */
    /* near-repeats that aren't plays (watcher, idea, listening and AI-answer cards): the same title with only a product or price
       changed ("Reduce hair fall with our ₹1,803 combo" five times) shows once, the best-ranked; the rest wait like repeats (1.4) */
    { const shown = (c) => { try { return PLAIN.get(slugOfT(t), c)?.title || c.title; } catch { return c.title; } }; /* the title as the feed shows it (plain words) */
      const head = (c) => String(shown(c) || '').toLowerCase().replace(/[₹$£€]\s?[\d,.]+|\d[\d,.]*%?|™|®/g, ' ').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
      const seenHead = new Map(); for (const c of asks.list) { if (moveNo(c.id) != null || /^live-/.test(String(c.id)) || eng.has(c.id) || t.acted.has(c.id)) continue; const h = head(c); if (h.split(' ').length < 3) continue;
        if (seenHead.has(h)) asks.sunk.add(c.id); else seenHead.set(h, c.id); } }
    const clash = conflicts(asks.list, { value: (c) => cardValue(c, B()?.moveValue || {}, now(t)) }); for (const [id, x] of clash) if (!eng.has(id) && !t.acted.has(id)) { asks.sunk.add(id); const w = t.cards.get(x.by); if (w) w.conflictNote = x.why; }
    const sorted0 = asks.list;
    /* one card per group in the first screen: a move's other cards, a live check's older readings and a second ad from the same
       rival wait until position 12, unless the first was already acted on. A live check that read the same thing again (stock-outs,
       price drift) keeps only its newest reading at all: the older ones are the same news */
    const newestLive = new Map(); for (const c of sorted0) { const d = dupOf(c); if (d) { const h = newestLive.get(d); if (!h || c.createdAt > h.createdAt) newestLive.set(d, c); } const g = groupOf(c); if (g?.startsWith('live:')) { const h = newestLive.get(g); if (!h || c.createdAt > h.createdAt) newestLive.set(g, c); } /* one stock-out card holds the products our cards sell (QA FEED-11): the newest reading wins */ }
    const sorted = []; const later = []; const firstOf = new Map(); const sunk = [];
    for (const c of sorted0) { if (asks.sunk.has(c.id)) { sunk.push(c); continue; } const d = dupOf(c); if (d && newestLive.get(d) !== c) continue; const g = groupOf(c); if (g == null) { sorted.push(c); continue; } if (g.startsWith('live:') && newestLive.get(g) !== c) continue; const f = firstOf.get(g);
      if (!f) { firstOf.set(g, c); sorted.push(c); } else if (eng.has(f.id)) sorted.push(c); else later.push(c); } /* a heart or a real jam message lets a second card in, not a mere open */
    for (const c of later) sorted.splice(Math.max(12, sorted.findIndex((x) => scores[x.id].total < scores[c.id].total) >>> 0), 0, c);
    /* cards that ask what a better card already asks are not served again at the end of the feed (ten "fix the pack prices" cards
       sat back to back: QA 20 Oct); one someone engaged with stays (oneAsk keep), and every card's move keeps it */
    sorted.push(...sunk.filter((c) => eng.has(c.id) || t.acted.has(c.id)));
    // interleave: no two of a kind together, no agent twice in a row
    const out = []; const rest = [...sorted];
    while (rest.length) {
      const prev = out[out.length - 1];
      let k = rest.findIndex((c) => !prev || (c.agent !== prev.agent && c.kind !== prev.kind));
      if (k < 0 || k > 10) k = rest.findIndex((c) => !prev || c.agent !== prev.agent);
      if (k < 0 || k > 10) k = 0;
      out.push(rest[k]); rest.splice(k, 1);
    }
    const r = { top, ranked: out, scores, engaged: eng }; lastRank.set(t, { at: Date.now(), r, sf: storefrontOn() }); return r;
  };
  const rankSoon = (t, ms = 60e3) => { const x = lastRank.get(t); return x && x.sf === storefrontOn() && Date.now() - x.at < ms ? x.r : rank(t); };
  const withChildren = (t, list) => { const res = []; list.forEach((c) => { res.push(c); [...t.cards.values()].filter((x) => x.parentCardId === c.id && visible(t, x)).sort((x, y) => y.createdAt - x.createdAt).forEach((x) => res.push(x)); }); return res; };
  const feed = (t) => {
    const { top, ranked: all, scores, engaged: eng } = rank(t);
    // cards the viewer pulled in from the "new cards" pill sit on top for 30 minutes
    const pins = (t.pinned || []).filter((x) => now(t) - x.at < 30 * 60e3).map((x) => all.find((c) => c.id === x.id)).filter(Boolean);
    /* a feed you look at, not a list you read: two visual cards for every text card, each kind kept in its rank order */
    const isVis = (c) => !!(c?.images?.length || c?.img || c?.video || ['media', 'chat', 'answer', 'variants'].includes(c?.kind) || (c && draftView(draftFor(c, B()?.firstDrafts), c))); /* a card with a first draft shows the draft: a picture card */
    const ranked0 = all.filter((c) => !pins.includes(c)), V = ranked0.filter(isVis), N = ranked0.filter((c) => !isVis(c)), ranked = [];
    /* the 2:1 picture/text rhythm, but it never lifts a clearly weaker card over a stronger one (more than 2 points apart) */
    const tot = (c) => scores[c.id]?.total ?? 0;
    for (let i = 0; V.length || N.length; i++) { let L = (i % 3 === 2 && N.length) || !V.length ? N : V; const O = L === V ? N : V; if (O.length && L.length && tot(O[0]) - tot(L[0]) > 2) L = O; ranked.push(L.shift()); }
    let seated = new Set();
    /* the social stream (ready posts, what people asked) always has seats in the first screen: at 3 the best reply or post in a
       community (a thread listening heard, a Reddit or Quora idea), at 7 the best picture post, at 9 the best other text card
       (what people say about the brand, a rival's complaints or the category's questions, before a second reply card). Scored on
       their own they sit near 100: moves outscore them */
    { const isSoc = (c) => /^(Ideas|Heard) ·/.test(c?.src || ''); const off = top.length + pins.length; /* seats 3, 7 and 9 count from the top of what the reader sees, pins and top cards included */
      const comm = ranked.find((c) => isSoc(c) && !isVis(c) && isCommunityCard(c)), text1 = comm || ranked.find((c) => isSoc(c) && !isVis(c));
      const soc = [[text1, Math.max(0, 2 - off)], [ranked.find((c) => isSoc(c) && isVis(c)), Math.max(1, 6 - off)], [comm && (ranked.find((c) => c !== comm && isSoc(c) && !isVis(c) && !isCommunityCard(c)) || ranked.find((c) => c !== comm && isSoc(c) && !isVis(c))), Math.max(2, 8 - off)]].filter((x) => x[0]);
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
    /* and one card per near topic (the same story twice), at most 3 from one agent and 2 of one format (firstScreen) */
    ranked.splice(0, ranked.length, ...firstScreen(ranked, { groupOf, engaged: (id) => eng.has(id), seated, nearOf: (a, b) => nearTitle(a.title, b.title) }));
    const shownList = ranked; /* no daily cap: every card is shown (the Pro plan is a Dummy) */
    const order = withChildren(t, [...top, ...pins, ...shownList]).map((c) => c.id); lastOrder.set(t, order);
    return { order, scores, pinned: pins.map((c) => c.id), limit: { plan: t.plan, daily: null, locked: 0 } };
  };
  const measureOf = (t, c) => { const m = { ...(MEASURE[c?.sector] || MEASURE.creatives), ...(c?.measure || {}) };
    // AI answers: today's number is the latest real run, not a sample
    const vr = live?.get()?.visibility?.runs?.[0]; if (c?.sector === 'visibility' && vr && !c?.measure) Object.assign(m, { unit: ` of ${vr.total}`, baseline: vr.named, target: Math.min(vr.total, vr.named + 4), window: 28, attribution: `The same questions, asked the same way every week from ${CTRY()}. A change in who gets named is the result.` }); m.connected = !m.from || connOn(t || {}, m.from); /* a team member's own account: the result is read against its number today */ if (t?.member && m.baseline == null) { const b = baselineOf(c?.sector, t.liveLedger); if (b) Object.assign(m, b); } m.fromName = m.from ? (SEED.connectors[m.from]?.name || m.from) : null; return m; };
  /* every card a person reads: plain words (plain.js) and how much proof backs it (evidence.js), the same way for every brand */
  const EV = createEvidence({ factsOf: () => B()?.facts || {}, movesOf: () => B()?.moveDocs || {}, numsOf: (src) => MOVES?.numsOf(src) || [], adOf: (id) => resAll(research?.get()?.ads).find((a) => a.id === id) || null, country: () => CTRY(), brandHost: () => B()?.host || '', learnedOf: () => B()?.learnedEv || null, pulseOf: () => B()?.pulseEv || null });
  /* real customer voice per brand for the proof: reviews (rating, product, link) and the threads Brew's listening found. Read in
     the background and kept 30 minutes, so the feed never waits on it; the first look at a brand may show none yet */
  const VOICE = new Map();
  const voiceOf = (slug) => { const v = VOICE.get(slug); if (v && Date.now() - v.at < 30 * 60e3) return v.list;
    const job = Promise.all([GP.getJSON(slug, 'profile.json', {}), GP.getJSON(slug, 'listen/threads.json', {})]).then(([p, th]) => {
      const rv = [...(p?.reviews?.quotes || []), ...(p?.reviews?.recent || [])].filter((q) => q?.text && String(q.text).length > 20).slice(0, 80).map((q) => ({ kind: 'review', text: q.text, title: q.title || null, rating: q.rating || null, product: q.product || null, src: q.src || null, url: q.url || null, at: q.at || null }));
      const tl = (th?.threads || []).filter((x) => x?.url && (x.quote || x.title)).slice(0, 100).map((x) => ({ kind: 'thread', text: x.quote || x.title, where: x.where || null, platform: x.platform || null, url: x.url, replies: x.replies || 0 }));
      VOICE.set(slug, { at: Date.now(), list: [...rv, ...tl] }); }).catch((e) => log.warn('[proof] voice', slug, e.message));
    VOICE.set(slug, { at: Date.now(), list: v?.list || [], job }); return VOICE.get(slug).list; };
  const voiceReady = async (slug) => { voiceOf(slug); await VOICE.get(slug)?.job?.catch(() => {}); return voiceOf(slug); }; /* the proof sheet waits for it; the feed never does */
  const PLAIN = o.plain || createPlain({ ai: claudeTool, store: o.globalPacks || packs, spend: (k) => spend(k), isMock, log, kindsOf: (slug) => evidenceKinds({ voice: voiceOf(slug) }) }); /* the rewrite claims no more than the brand's reviews and threads show */
  /* the proof filter knows the brand's own card words, so a page sharing only the product's name is not proof (proof-logic.js) */
  const refineProof = (c, e, o = {}) => refineProof0(c, e, { ...o, corpus: B()?.rawSeed?.posts || B()?.seed?.posts || null, names: (B()?.catalog || []).map((x) => x.t) });
  /* the brand's counts for the cards: its facts and today's numbers, worked out once per loaded pack */
  const COUNTS = new WeakMap();
  const countsFor = (b) => { if (!b || typeof b !== 'object') return []; let x = COUNTS.get(b); if (!x || x.facts !== b.facts || x.numbers !== b.numbers) { x = { facts: b.facts, numbers: b.numbers, list: countsOf(b.facts || {}, numberRows(b.numbers, b.name || b.seed?.brand?.name).filter((r) => !b.replacedKeys?.has(r.key)) /* a count a connected account replaced is the account's */, b.name || b.seed?.brand?.name || '') }; COUNTS.set(b, x); } return x.list; };
  /* the pack as this viewer sees it (facts-desk.js truthOf): a visitor's is the public pack, never a connected number; a member's
     carries their live connected facts over the public ones (replaced site values gone), and its factOk, factBrief and pageFacts
     follow. Worked out once per pack and set of live rows */
  const TRUTH = new WeakMap();
  const packFor = (t, p = t ? brandOfT(t) : B()) => { if (!t?.member || !p?.facts) return p; const live = t.liveLedger || {}, sig = JSON.stringify(Object.entries(live).map(([k, e]) => [k, e?.v, e?.at])); if (sig === '[]') return p;
    let x = TRUTH.get(p); if (!x || x.sig !== sig || x.facts !== p.facts) { const tr = liveTruth(p.facts, live); x = { sig, facts: p.facts, view: viewerPack(p, tr, replacedKeys(p.facts, tr)) }; TRUTH.set(p, x); } return x.view; };
  const pub = (c0, t) => { if (c0?.research?.kind === 'viral' && c0.cta?.label !== 'Make our version') c0.cta = { label: 'Make our version' }; /* viral cards served before fitCta knew them read "Make the video" (20 Oct) */ if (c0?.cta?.label) fitCta(c0); /* a saved card's button heals: renamed, or one about another topic (FEED-QA-20) */ const c = freshCounts(oneCard(process.env.PLAIN_OFF === '1' ? c0 : PLAIN.apply(t ? slugOfT(t) : B()?.slug || DEFAULT_BRAND, c0)), countsFor(packFor(t)), { live: !!t?.member }); /* one, always: a tenant's saved card says one too */ /* its counts are today's (card-nums.js) */ const { history, ...rest } = c; try { const sl = t ? slugOfT(t) : B()?.slug || DEFAULT_BRAND, vo = voiceOf(sl), e = refineProof(c0, EV.evidenceOf({ ...c0, brand: BN() }, { liveLedger: t?.member ? t.liveLedger : null, facts: t?.member ? packFor(t)?.facts : null, plain: PLAIN.get(sl, c0), voice: vo, team: toldSeen(t) }), { voice: vo, connected: (id) => !!t && connOn(t, id), has: (id) => !!SEED?.connectors?.[id] }); const nd = cardNeeds(c0, e?.claim?.needs, { connected: (id) => !!t && connOn(t, id), has: (id) => !!SEED?.connectors?.[id] }); rest.proof = e ? { n: e.count, strength: e.strength, ...(nd.length ? { needs: nd } : {}), ...(EV_SEEN(e) ? { seen: EV_SEEN(e) } : {}) } : null;
      /* a card whose work runs on, or whose figures name, a platform the team hasn't connected (2.6: Google Ads numbers and buttons with
         no Google Ads): the card says its figures are estimates and offers to connect instead */
      { const said = `${c0.title || ''} ${c0.sub || ''} ${(c0.rows || []).flat().join(' ')}`, tl = toolOf(c0.cta?.label, c0, { sectorFallback: false });
        /* only a card resting on the team's own account numbers: never a rival or trend finding (those figures are theirs), never an
           email the button merely drafts (an outreach email is not Klaviyo) */
        const own = !['ad', 'viral'].includes(c0.research?.kind) && !c0.post && !/^(?:live-|r-ad-|heard-|lv-)/.test(String(c0.id || '')); /* a how-to or trend card quoting the team's own Google numbers counts (2.6: "3.93x on Shopping") */
        const want = !own ? [] : [...new Set([tl === 'google' ? tl : null, /\bgoogle (?:shopping |search )?ads\b|\bgoogle shopping\b|\bbrand search\b/i.test(said) && /\d/.test(said) ? 'google' : null, /\bklaviyo\b/i.test(said) ? 'klaviyo' : null])].filter((id) => id && SEED?.connectors?.[id] && !(t && connOn(t, id)));
        if (want.length) { rest.toolNeeds = want; const gAcct = want.includes('google') && /\b(?:shift|scale|pause|stop|bid|budget|launch)\b/i.test(c0.cta?.label || '') && /\bgoogle (?:shopping |search )?ads\b|\bbrand search\b|\bgeneric search\b|\bsearch campaigns?\b|\bperformance max\b/i.test(said); /* an account move on Google figures ("Brand Search 22.10x" under Shift budget: QV 25 Oct) connects Google Ads first, whatever the action's own tool */ if ((tl && want.includes(tl) && tl === 'google') || gAcct) rest.cta = { label: `Connect ${SEED.connectors.google?.name || 'Google Ads'}`, connect: 'google' }; } } } /* no action on a platform that isn't connected: the button connects it (2.6) */ /* needs: the accounts the card rests on that aren't connected (the card's one-line Connect, FEED-ARV-07) */ /* the shield counts what the sheet shows: the proof checked against the claim (proof-logic.js) */ catch (e) { log.warn('[proof]', c0.id, e.message); } { const nt = rest.note || B()?.notes?.[c.id] || c0.conflictNote; delete rest.note; delete rest.conflictNote; /* a card that won over an opposite one says why (same-ask.js conflicts) */ if (typeof nt === 'string') rest.note = dejargon(nt); else if (nt?.h && !NO_NOTE.test(c.id) && noteOk(nt, c0)) rest.note = { ...nt, h: dejargon(nt.h), ...(nt.b ? { b: dejargon(nt.b) } : {}), ...(nt.k ? { k: nt.k === nt.k.toLowerCase() ? moveSay(nt.k).toLowerCase() : moveSay(nt.k) } : {}) }; /* a margin note in plain words too ("index all 7 sitemaps") */ } /* margin notes written after the card landed (notes.js), checked against the card as it reads now: a build card's "All 65 written" never carries an old "only 1 of 52 done" (FEED-QA-21); "move 1006" reads "weekly move 6" */ if (LEAK.test(`${rest.title} ${rest.sub}`)) { rest.title = scrubLeak(rest.title); rest.sub = scrubLeak(rest.sub); }
    /* the Ad Library counts every ad on the brand's Facebook page, the connected account only its own: the card says which (1.3/2.7:
       1,676 on the page beside 291 in the account read as one number that disagreed) */
    if (/^ow-/.test(String(c0.id || '')) && Array.isArray(rest.rows)) { const acct = t?.member ? t.liveLedger?.['meta.ads.live'] : null; rest.rows = [...rest.rows.slice(0, 4), ['Counted on', 'Your Facebook page, every ad account'], ...(acct && !acct.stale ? [['Your connected ad account', `${acct.v} live`]] : [])]; }
    /* every card's own words, cleaned of a claim the store's words don't back, whenever it was written (1.5); a rival's ad and a
       shopper's thread are quoted as they are */
    if (!c0.research && !c0.post && !/^(?:r-|heard-)/.test(String(c0.id || ''))) try { const src = packSource(packFor(t)), tf = claimFlags(String(rest.title || ''), src);
      if (tf.length) rest.title = tf.reduce((x, g) => x.replace(g.phrase, ''), rest.title).replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,:;–-]+|[\s,:;–-]+$/g, '').replace(/^(\w)/, (m) => m.toUpperCase());
      rest.sub = checkCopy(rest.sub, src).text || rest.sub; if (rest.detail) rest.detail = { ...rest.detail, why: (rest.detail.why || []).map((x) => checkCopy(x, src).text).filter(Boolean), how: (rest.detail.how || []).map((x) => checkCopy(x, src).text).filter(Boolean) };
      if (Array.isArray(rest.rows)) rest.rows = rest.rows.filter((r) => !Array.isArray(r) || !claimFlags(r.join(' '), src).length); } catch {}
    /* a post Brew wrote for the brand (an idea card's LinkedIn post, reel script, thread) is the brand's words too: its unbacked claims
       go before the feed shows it, as on every other card (QV 25 Oct: "entirely dermat-approved" showed in a founder post's preview);
       a rival's ad and a shopper's thread stay quoted as they are, and the post's evidence keeps its source wording */
    if (c0.post && !['ad', 'viral'].includes(c0.research?.kind) && !/^(?:r-|r-ad-|heard-)/.test(String(c0.id || ''))) try { const src = packSource(packFor(t)), post = JSON.parse(JSON.stringify(rest.post || c0.post));
      checkCopyIn(post, src, { skip: /^(id|url|src|img|image|images|key|handle|at|by|from|kind|state|status|evidence|moves|refs|sources?|quote|author|platform|where)$/i }); rest.post = post; } catch {} const dv = draftView(draftFor(c, B()?.firstDrafts), c); if (dv) { const said = { headline: dv.headline, copy: dv.copy }; try { cleanDraftClaims(said, packSource(packFor(t))); } catch {} rest.draft = { ...dv, headline: said.headline, copy: said.copy, ...(dv.title ? { title: dejargon(dv.title) } : {}) }; if (!said.headline) delete rest.draft.headline; } /* a draft saved before the claims check shows no unbacked claim under the card (QA-25) */ /* the draft's own name in plain words ("Saaya Blue PDP Comfort FAQ Section") */ /* the first draft Brew made for this card (drafts-bg.js), shown on the feed card */ const pl = planOfCard(c); if (pl) rest.plan = pl; /* its plan: what the jam opens on */ if (toldSeen(t) && toldCard(c)) rest.told = true; /* the card itself rests on what the team told Brew: the feed labels it (team only, like the told list) */ { const fr = cardFrom(c0, (t ? brandOfT(t) : B())?.moveDocs); if (fr) rest.from = fr; else delete rest.from; } /* where the card came from, in plain words (card-from.js), worked out on every serve so saved cards heal */ { const tc = (x) => (typeof x === 'string' ? x.replace(/\bRs\.?\s?(?=\d)/g, '₹').replace(/([₹$£€])(\d{1,3}(?:,\d{2,3})+|\d{3,})\.(\d{2})\b/g, (m, c, n, p) => `${c}${Math.round(+String(n).replace(/,/g, '') + +p / 100).toLocaleString(c === '₹' ? 'en-IN' : 'en-US')}`) /* ₹927.96 reads ₹928, Rs 285 reads ₹285 */.replace(/\s*\((?:exact (?:figures?|numbers?|dates?) )?(?:still )?to (?:be )?confirm(?:ed)?\)/gi, '').replace(/,?\s*(?:still )?to confirm\b\.?$/i, ' (not checked yet)').replace(/^to confirm$/i, 'Not checked yet') : x); rest.title = tc(rest.title); rest.sub = tc(rest.sub); if (typeof rest.sub === 'string') rest.sub = rest.sub.replace(/\b(your|from|in) Move (\d{1,2})\b/g, '$1 Play $2'); /* saved cards that named their play "Move 21" (3.10) */ { /* two AI-answer counts that read alike measure different things (1.3: "0 of 15 answers" beside "0 of 10 prompts"): a card about one
       question counts the AI tools that answered it; a play's count is across all the questions asked */
      const perQ = /^lv-vis-/.test(String(c0.id || '')), aiLbl = (x) => (typeof x !== 'string' ? x : perQ ? x.replace(/\b(\d+) of (\d+) answers\b/g, '$1 of $2 AI tools on this question') : x.replace(/\b(\d+) of (\d+) (?:AI )?prompts\b/gi, '$1 of $2 questions asked across AI tools'));
      rest.title = aiLbl(rest.title); rest.sub = aiLbl(rest.sub); if (Array.isArray(rest.rows)) rest.rows = rest.rows.map((r) => (Array.isArray(r) ? r.map(aiLbl) : r)); }
    { const yours = (x) => (typeof x === 'string' ? x.replace(/\b(O|o)ur (?=[₹$£€]\s?\d)/g, (m, o) => (o === 'O' ? 'Your ' : 'your ')) : x); rest.title = yours(rest.title); rest.sub = yours(rest.sub); } /* a card talks to the team: "your ₹449 shampoo", never "our" beside it (1.14); drafts for shoppers keep "our" */ if (Array.isArray(rest.rows)) rest.rows = rest.rows.map((r) => (Array.isArray(r) ? r.map((x, i) => (i === 0 && /^to confirm$/i.test(String(x)) ? 'Still to check' : tc(x))) : r)); } /* the moves' planning marker "(to confirm)" never shows on a card face (QA 20 Oct) */ { const sc = sectorOf(c0); if (sc && sc !== rest.sector) rest.sector = sc; } /* the column it changes (1.13) */ rest.src = rest.src === 'Brew deployment team' ? 'The ShopOS team, Brew’s build crew' : playSrc(rest.src); /* Plays, not moves (3.10) */ /* one name for the team (FEED-QA-10) */ /* the source line a person reads: "Weekly move 11" (QA FEED-QA-12); t.cards keeps "Move 1011" for numsOf */ return { ...rest, history: (history || []).slice(-6), measure: measureOf(t, c), decided: t?.decided?.[c.id] || null }; };
  /* the cards the page needs, not every card the workspace ever held: the feed's order, pinned ones, cards with a jam, saved and
     hearted ones (the Library and the jams open them by id). With no order yet, every card, as before */
  const lastOrder = new WeakMap();
  const allCards = (t, order = lastOrder.get(t)) => { const keep = order ? new Set(order) : null;
    if (keep) { (t.pinned || []).forEach((x) => keep.add(x.id)); (t.work || []).forEach((w) => w.cardId && keep.add(w.cardId)); savedOf(t).forEach((id) => keep.add(id)); affinityMap(t).hearts.forEach((_, id) => keep.add(id)); }
    const o = {}; t.cards.forEach((c, id) => { if ((!keep || keep.has(id)) && !['dropped'].includes(c.state) && seatOk(t, c)) o[id] = pub(c, t); }); return o; };

  /* ---------- QA agent ---------- */
  // research cards may also quote the numbers in their own source record (an ad's copy, a trend's measured change)
  const researchOK = (c) => {
    // only the source data counts (the rival's own copy, measured trends), never the agent's own words
    const r = research?.get() || {}; const ok = new Set(FACT_OK); const add = (x) => numbersIn(typeof x === 'string' ? x : JSON.stringify(x)).forEach((n) => ok.add(n));
    const pct = (s) => s?.change != null && add(`${Math.abs(s.change)}% ${s.change}%`);
    const adSrc = (a) => a && add([a.headline, a.body, a.hook].join(' '));
    if (c.research.kind === 'ad') adSrc(r.ads?.items.find((a) => a.id === c.research.id));
    if (c.research.kind === 'viral') { const x = resAll(r.viral).find((y) => y.id === c.research.id); if (x) { add([x.views, x.usual, x.score, x.days, x.likes, x.comments, x.caption, x.hook, x.read?.pacing, x.read?.whyItWorks].join(' ')); add(`${bigN(x.views)} ${bigN(x.usual)} ${scoreText(x.score)}`); } }
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
  /* a member's numbers are checked against their truth (packFor): a site value a connected account replaced no longer passes */
  const factOkFor = (t) => (t?.member ? packFor(t)?.factOk || FACT_OK : FACT_OK);
  /* the connected numbers a member's jam and studio quote: the rows of their truth (a stale or simulated account's never), each
     with its account and day; none for anyone else */
  const truthRows = (t) => (t?.member ? Object.entries(packFor(t)?.facts || {}).filter(([, f]) => f?.connected).map(([k, f]) => ({ key: f.key || k, label: f.label, v: f.v, n: f.n, at: f.at, src: f.src })) : []);
  // an idea's title quotes a price its text doesn't ("the ₹399 + ₹399 pair" over "₹399 shampoo with the ₹642.32 serum"): the AI mixed two items up
  const titlePricesMatch = (c) => { const money = (x) => numbersIn(x, { strict: true }).filter((n) => /^[^\d]+\d/.test(n)); const have = money([c.sub, ...(c.detail?.why || [])].join(' '));
    return money(c.title).every((n) => { const i = have.indexOf(n); if (i < 0) return false; have.splice(i, 1); return true; }); };
  /* a banned claim the brand itself makes: never inside quotes (a shopper's question, a thread title) and never denied ("it's not a
     miracle", "no overnight cure", "without a guarantee"): QA J-04 */
  const bannedSaid = (txt) => { const x = String(txt || '').replace(/“[^”]*(”|$)/g, ' ').replace(/"[^"\n]*"/g, ' '); if (!BANNED.test(x)) return false;
    let re; try { re = new RegExp(BANNED.source, [...new Set(`${BANNED.flags}gi`)].join('')); } catch { return true; }
    for (const m of x.matchAll(re)) { const before = x.slice(Math.max(0, m.index - 40), m.index).toLowerCase().split(/\s+/).filter(Boolean).slice(-4).join(' '); if (!/\b(?:not|no|never|isn['’]t|aren['’]t|without|nor|zero|neither)\b/.test(before)) return true; }
    return false; };
  const qaCheck = (c, t = null) => {
    const main = [c.title, c.sub, ...(c.rows || []).flat()].join(' ');
    const all = textOfCard(c) + ' ' + (c.detail?.why || []).join(' ');
    const claim = all.match(/[^.]*\b\d[\d,]*%?\s+(?:new|more|fewer|less)\s+[a-z]+\s+in\s+\d+\s*(?:days|weeks)[^.]*/i); // a counted result claim ("30% fewer breakouts in 28 days") keeps "up to" and its window
    return [
      { k: 'Names a number', ok: /\d/.test(main) },
      // a rival ad is quoted as it runs; the banned words apply to what the brand would say
      // a rival ad is quoted as it runs, and a shopper's question is quoted as they asked it: the banned words apply to
      // what the brand would say ("which serum works for hair regrowth?" is the shopper's word, not a claim)
      { k: 'No banned words', ok: !bannedSaid(c.research?.kind === 'ad' ? [c.title, ...(c.detail?.how || [])].join(' ') : c.q ? all.split(c.q).join(' ') : all) },
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
    const raw = builder?.peek?.(B().slug) || {}, st = o.viewStatus?.(B().slug, raw) || raw, out = []; /* the demo's replayed build reads the same as its status route (QA FEED-QA-09) */
    const done = st.movesDone || 0, N = +st.total || 50; /* the playbook (not the index, not weekly moves); PDFs are made on download */
    out.push({ id: 'b-moves', t: `Your moves`, s: done >= N ? `All ${N} written` : `${done} of ${N} written`, pct: Math.round(100 * Math.min(done, N) / N), st: done >= N ? 'Done' : 'Running', tone: done >= N ? 'ok' : 'info', agent: 'brew', team: true, real: true });
    if (st.statics) out.push({ id: 'b-statics', t: 'Static ads from Play 21', s: st.statics.state === 'done' ? `${st.statics.n} ads ready for your review` : st.statics.state === 'failed' ? 'Could not be made: ' + (st.statics.err || 'image model error') : 'Making the images from your product photos', pct: st.statics.state === 'done' ? 100 : 40, st: st.statics.state === 'done' ? 'Needs you' : st.statics.state === 'failed' ? 'Stopped' : 'Running', tone: st.statics.state === 'done' ? 'warn' : 'info', agent: 'creative', real: true });
    for (const w of t.work.filter((x) => !x.archived && !x.discarded).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6))
      out.push({ id: 'b-' + w.id, t: cutWords(w.title || 'Work', 48), s: `${STAGE_TXT[w.stage] || w.stage}${w.with?.name ? ' · ' + w.with.name : ''}${w.ticket ? ' · ' + w.ticket : ''}`, pct: STAGE_PCT[w.stage] || 30, st: w.stage === 'needs_you' ? 'Needs you' : w.stage === 'result' ? 'Done' : 'Running', tone: w.stage === 'needs_you' ? 'warn' : w.stage === 'result' ? 'ok' : 'info', agent: w.agent, team: w.with?.kind === 'brew', workId: w.id, real: true });
    return out;
  };
  const syncBatches = (t) => { if (B().kind !== 'generated') return; if (!builder?.peek?.(B().slug)) builder?.status?.(B().slug).catch(() => {}); t.batches = realBatches(t); };
  // the brand's own live ads (research.js "own"), read from the public Ad Library
  const fromOwnAds = (t, n = 2) => {
    const o = research?.get()?.own, out = [], at = o ? new Date(o.fetchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    for (const e of o?.events || []) {
      if (out.length >= n) break; const id = 'ow-' + e.id; if (t.used.has(id) || t.cards.has(id)) continue;
      if (e.kind === 'none' && +o.live > 0) continue; /* a day the page wasn't found, overtaken by a read that counts live ads */
      t.used.add(id);
      const base = { id, agent: 'performance', sector: 'creatives', lane: Object.keys(SEED.lanes)[0], roles: ['brand', 'growth', 'founder'], src: `Meta Ad Library · ${CTRY()} · ${at}`, link: { label: 'See it in the Ad Library', url: e.items?.[0]?.url || 'https://www.facebook.com/ads/library/' } };
      const nums = (e.items || []).flatMap((x) => [String(x.days), String(x.versions)]).concat([String(e.n || ''), String(e.was || ''), String(e.now || ''), String(o.live)]);
      if (e.kind === 'long') out.push({ ...base, type: 'decision', kind: (e.items || []).some((x) => x.poster) ? 'media' : 'rows', images: (e.items || []).filter((x) => x.poster).slice(0, 1).map((x) => x.poster), badge: ['Running long', 'warn'], liveNums: nums,
        title: `${e.n} of your live ads have run 60 days or more`, sub: `The oldest has run ${e.items[0].days} days in ${e.items[0].versions} version${e.items[0].versions === 1 ? '' : 's'}. We make fresh versions of the ones still worth keeping, so the winners don't tire.`,
        rows: e.items.slice(0, 4).map((x) => [String(x.hook || 'Untitled ad').slice(0, 38), `${x.days} days`]), detail: { why: ['Read from your live ads in the public Meta Ad Library.', 'Spend and results need your Meta account connected.'], how: ['We draft fresh versions of the long runners.', 'You pick which go live.', 'The old ones pause when the new ones start.'] }, cta: { label: 'Rotate creative' } });
      if (e.kind === 'new') out.push({ ...base, type: 'report', family: 'result', kind: 'rows', badge: ['New live', 'info'], liveNums: nums,
        title: `${e.n} new ad${e.n === 1 ? '' : 's'} went live since the last read`, sub: `We now count ${o.live} live ads for ${BN()} in the Meta Ad Library. The new ones are below, so the team can see what is being tested.`,
        rows: e.items.slice(0, 4).map((x) => [String(x.hook || 'Untitled ad').slice(0, 38), x.video ? 'Video' : 'Image']), detail: { why: ['Read from the public Meta Ad Library today.'], how: ['Connect Meta to see what each one costs and returns.'] }, cta: { label: 'Make the ad' } });
      if (e.kind === 'count') out.push({ ...base, type: 'report', family: 'result', kind: 'rows', badge: ['Live ads', e.now > e.was ? 'ok' : 'warn'], liveNums: nums,
        title: `Live ads went from ${e.was} to ${e.now}`, sub: `The count of ${BN()} ads running in the Meta Ad Library changed since the last read. A big drop can mean a paused account or a budget cut.`, rows: [['Before', String(e.was)], ['Now', String(e.now)]], detail: { why: ['Counted in the public Meta Ad Library.'], how: ['Check the account if the drop was not planned.'] }, cta: { label: 'Open report' } });
      if (e.kind === 'none') out.push({ ...base, type: 'decision', kind: 'rows', badge: ['No live ads', 'warn'], liveNums: [], title: `No live ${BN()} ads found in the Meta Ad Library`, sub: `We searched the Ad Library for ${CTRY()} and found no ads running for ${BN()} today. Your feed's ad cards start from your moves instead.`, rows: [['Live ads', 'None found']], detail: { why: ['Searched by brand name in the public Ad Library.'], how: ['If you run ads under another page name, tell us and we will track that page.'] }, cta: { label: 'Make the ad' } /* no rival ad behind it: our first ad, never "our version" of something */ });
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
    /* the pool's templated ideas fill a gap, never the feed: past 6 creative-watcher cards still showing, nothing more is added (23 Oct
       QA 1.4: 125 "Reduce hair fall with our ₹… combo" cards from three days of runs) */
    const showing = [...t.cards.values()].filter((c) => c.watcher === 'creative' && ['ready', 'shown'].includes(c.state) && (!c.expiresAt || c.expiresAt > now(t))).length;
    if (!live) return showing >= 6 ? { cards: [], how: 'enough creative ideas in the feed already' } : { cards: fromPool(t, 'creative'), how: isMock() ? 'from the mock pool (AI is on mock)' : 'from the pool (daily AI budget used)' };
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
      /* context first (25 Oct, Param: "context driven initial assets"): the picture is made around the product this idea names, on
         that product's cleanest photo, with the card's own words, so the image guard checks it is that product and judges it as an
         ad (a collage, a cropped product or an unrelated scene is made again, then held back). Never a generic "<brand> product"
         over the lane's default photo (Arata 25 Oct: a hair swatch and three bottles pasted over a dark panel) */
      const cat = B()?.catalog || [], words = `${clean(j.title)}. ${clean(j.sub)}`, named = cat.length ? (pricedProduct(words, cat, { brand: BN() }) || null) : null;
      /* a brand with a catalog: only the product the idea names (none named: no picture, never another product's). A brand
         without one (services, enquiry) keeps its own photo */
      const ref = named?.img || (cat.length ? null : refPhoto(lane));
      let img = named?.img || (cat.length ? null : STATICS.length ? stImg(STATICS.includes(j.image) ? j.image : STATICS[0]) : ref), imgNote = named ? `the real photo of ${named.t}` : img ? 'your own photo' : 'no picture: the idea names no product the store sells';
      const refFile = !ref ? null : named ? ref /* the guard fetches the named product's photos itself (a store URL too) */ : await fileOfRel(ref);
      if (refFile && spend('image')) {
        try {
          const buf = await geminiImage({ srcFile: refFile, prompt: buildDraft({ kind: 'image', title: 'an ad' /* never the card's words: the model draws a title it is given (25 Oct, Cozy) */, visual: j.scene || 'the product in use in a real moment, soft daylight', hasSrc: true, ratio: '4:5', topSpace: true, product: { name: named?.t || `${BN()} ${B().config.product?.noun || 'product'}` }, brand: { name: BN(), ...(B().config.product || {}) } }).prompt,
            ratio: '4:5', text: words, catalog: cat.length ? cat : null, brand: BN(), ...(named ? { named } : {}), slug: B()?.slug, fallback: true, ...(process.env.WATCHER_IMAGE_MODEL ? { model: process.env.WATCHER_IMAGE_MODEL } : {}) });
          if (buf?.guard?.genFailed) imgNote = `the real product photo (the new picture was held back: ${String(buf.guard.error || '').slice(0, 80)})`;
          else { const key = crypto.createHash('sha1').update(j.title + j.scene).digest('hex').slice(0, 16); saveGen(key + '.png', buf); img = `gen/${key}.png`; imgNote = 'made around the product the idea names, checked as an ad'; }
        } catch (e) { log.warn('[creative watcher] image', e.message); }
      }
      return { cards: [{ id: uid('w-c'), agent: 'creative', sector: 'creatives', type: 'idea', lane, roles: ['brand', 'growth', 'founder'], ...(img ? { kind: 'media', images: [img] } : { kind: 'rows', rows: [], images: [] }), imgQ: LOOKS_V + 0.4, ...(named ? { product: named.t } : {}), campaign: 'New from your agents', title: clean(j.title), sub: clean(j.sub), detail: { why: (j.why || []).map(clean), how: (j.how || []).map(clean) }, cta: { label: 'Make the ad' } }], how: `written live by Claude, image ${imgNote}` };
    } catch (e) { log.warn('[creative watcher]', e.message); return { cards: fromPool(t, 'creative'), how: 'from the pool (AI call failed)' }; }
  };
  /* ---------- cards from real research (research.js) ---------- */
  const dateIN = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const adCard = (a, at) => ({ id: 'r-ad-' + a.id, agent: 'performance', sector: 'ads', type: 'competitor', family: 'learning', lane: firstLane(), roles: ['founder', 'growth', 'brand'], kind: 'media', images: [a.poster],
    campaign: 'Popular ads', title: `${a.brand}: live ${a.days} day${+a.days === 1 ? '' : 's'} in ${a.versions} version${a.versions > 1 ? 's' : ''}`, sub: a.why || a.hook,
    rows: [['Hook', a.hook], ['Angle', a.angle], ['Live since', a.since], ['Format', a.format]],
    detail: { why: [a.why, `Hook: ${a.hook}`, `${a.brand} runs it as ${a.versions} version${a.versions > 1 ? 's' : ''}, ranked ${a.rank} by Meta for reach.`].filter(Boolean), how: [a.take, `Brew reads how ${a.brand}'s ad is made, then drafts yours on the same angle and style, with your product and your words.`, 'Brew drafts one; make the final (or redo it) and share the brief; your team runs it.'].filter(Boolean) },
    make: { format: a.format === 'video' ? 'reel' : 'single image ad', what: `Our version of ${a.brand}'s ${a.format === 'video' ? 'video' : 'image'} ad`, from: 'rival' }, /* the studio opens on the same kind of creative */
    cta: { label: 'Make our version' }, link: { label: 'See it in the Ad Library', url: a.url }, src: `Meta Ad Library · ${CTRY()} · ${dateIN(at)}`, research: { kind: 'ad', id: a.id }, rivalName: a.brand /* whose ad it is: "Seen on <rival>" (FEED-NOT-02) */ });
  /* a viral video in the brand's category (research.js refreshViral, viral-gate.js): make our version of the format, as a script to
     film or a Sloosh video. The numbers are the platform's own; the score shows only when the creator's usual views were read */
  const PLAT = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' };
  const bigN = (n) => (n == null ? '' : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
  const viralCardId = (id) => 'r-viral-' + String(id).replace(/[^a-z0-9]+/gi, '-');
  const viralCard = (x, at) => { const pl = PLAT[x.platform] || 'social', sc = scoreText(x.score);
    return { id: viralCardId(x.id), agent: 'creative', sector: 'creatives', type: 'idea', family: 'learning', lane: firstLane(), roles: ['founder', 'growth', 'brand'], kind: 'media', images: x.poster ? [x.poster] : [],
      campaign: 'Viral videos', title: x.title || `A ${pl} format to make our own`, sub: x.why || x.hook,
      rows: [['Views', bigN(x.views)], ...(sc ? [['Their usual', `${bigN(x.usual)} · this got ${sc}`]] : []), ...(x.interest ? [['Your buyers also watch', x.interest]] : []) /* found by an audience interest, outside the category */, ['Their hook', x.hook], ['Posted', `${x.days} day${x.days === 1 ? '' : 's'} ago on ${pl}`]].filter((r) => r[1]),
      detail: { why: [x.why, sc && `${bigN(x.views)} views where ${x.author} usually gets ${bigN(x.usual)}: ${sc} their normal reach.`, x.read?.pacing && `Pacing: ${x.read.pacing}`].filter(Boolean),
        how: [x.take, `Brew reads how the video is made, then writes our script on the same format: hook, beats, shot list and how to film it, with ${BN()}'s product and words.`, 'Lock the script, then send the brief to your team or make it with AI.'].filter(Boolean) },
      make: { format: 'reel', what: `Our version of this ${pl} video`, from: 'viral', pieces: [x.product, x.take].filter(Boolean).join('. ').slice(0, 200) }, /* the product that fits the video: the writer and the first frame use it (cardProduct reads pieces) */
      cta: { label: 'Make our version' }, link: { label: `Watch it on ${pl}`, url: x.url }, src: `${pl}${sc ? ` · ${sc} usual views` : ''} · ${dateIN(at)}`, research: { kind: 'viral', id: x.id, platform: x.platform }, creatorName: x.author }; };
  /* a trend story built on nothing ("0 terms", an empty rising list) is no finding: never a card (QA 20 Oct; quiet rule, no zero tiles) */
  const emptyTrend = (x) => (x.kind === 'rising' && !(x.rising || []).length) || /\b(?:0|zero|no) (?:terms|rising|listings|searches)\b|\bin 0 of\b/i.test(`${x.card || ''} ${x.h || ''}`);
  const trendCard = (x, at) => ({ id: 'r-' + x.id, agent: 'brew', sector: 'creatives', type: 'competitor', family: 'learning', lane: firstLane(), roles: ['founder', 'growth', 'brand'], kind: 'rows',
    campaign: 'Trends', title: x.card, sub: x.p,
    rows: x.rising ? x.rising.slice(0, 4).map((r) => [r.q.length > 38 ? r.q.slice(0, 36) + '…' : r.q, riseLabel(r.v)]) : x.terms.map((term) => { const s = research.get().trends.series[term]; return [term, s.change == null ? `index ${s.last}` : `${s.change > 0 ? '+' : ''}${s.change}% in 30 days`]; }),
    detail: { why: [x.p, x.h], how: ['Brew turns it into an ad idea or a page change.', 'You approve it before anything goes live.'] },
    cta: { label: 'Turn into an idea' }, src: `Google Trends · ${CTRY()} · ${dateIN(at)}`, research: { kind: 'trend', id: x.id } });
  /* a news story's card: what it means for the brand, as one idea to plan (the story slide's one button, QA FEED-ARV-10) */
  const newsId = (x) => 'nw-' + crypto.createHash('sha1').update(String(x?.url || x?.h || '')).digest('hex').slice(0, 10);
  const newsCard = (x, at) => ({ id: 'r-' + newsId(x), agent: 'brew', sector: 'signals', type: 'idea', family: 'idea', lane: firstLane(), roles: ['founder', 'growth', 'brand'], kind: 'rows',
    campaign: 'Industry news', title: `What “${short(String(x.h || ''), 60)}” means for ${BN()}`, sub: x.take || newsForUs(x, BN()),
    rows: [['The story', short(String(x.h || ''), 60)], ['Source', x.source || x.domain || 'the web']], detail: { why: [x.p].filter(Boolean), how: ['Brew drafts one idea for an ad or a page.', 'You decide if it goes out.'] },
    cta: { label: newsCta(x) }, link: x.url ? { label: 'Read the story', url: x.url } : undefined, src: `${x.source || x.domain || 'Web search'} · ${dateIN(at)}`, research: { kind: 'news', id: newsId(x) } });
  const howtoCard = (x, at) => ({ id: 'r-' + x.id, agent: 'creative', sector: 'creatives', type: 'idea', lane: x.lane, roles: ['founder', 'growth', 'brand'], kind: x.img ? 'media' : 'rows', images: x.img ? [x.img] : undefined,
    campaign: 'How to', title: x.card, sub: x.p, rows: x.steps.map((st, i) => [`Step ${i + 1}`, st]),
    detail: { why: [x.p], how: x.steps }, cta: { label: 'Start this' }, src: `How-to playbook · ${dateIN(at)}`, research: { kind: 'howto', id: x.id, ...(x.adId ? { ad: x.adId } : {}) } });
  /* a story and the archive behind it (research.js pool): a story past its 24 hours can still become a feed card */
  const resAll = (o) => [...(o?.items || []), ...(o?.archive || [])];
  /* ---------- rival ad reads (rival-ad.js): kept with the brand (rival-reads.json), so a deploy or a second instance never pays
     for one again; the top ads are read as soon as they arrive, so "Make our version" opens on a finished read ---------- */
  const READS_F = 'rival-reads.json', readsMem = new Map(), readsChain = new Map();
  const GP = o.globalPacks || packs; /* the brand-file store (getJSON/put): `packs` here is the loaded-pack cache, which has neither (17 Oct: every read failed to save) */
  const readsOf = async (slug) => { if (!readsMem.has(slug)) readsMem.set(slug, (await GP.getJSON(slug, READS_F, {}).catch(() => ({}))) || {}); return readsMem.get(slug); };
  const rivalStore = (slug) => (!slug ? null : {
    get: async (id) => (await readsOf(slug))[id] || null,
    put: async (id, r) => { const all = await readsOf(slug); all[id] = { ...r, at: Date.now() };
      const ks = Object.keys(all); if (ks.length > 150) for (const k of ks.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, ks.length - 150)) delete all[k];
      const run = (readsChain.get(slug) || Promise.resolve()).then(() => GP.put(slug, READS_F, all)); readsChain.set(slug, run.catch(() => {})); return run; } });
  const rivalStoreOf = (t) => rivalStore(t ? (t.brandId || DEFAULT_BRAND) : B()?.slug);
  const fileOfRel = async (rel) => { const f = (o.photoAsync ? await o.photoAsync(rel).catch(() => null) : null) || photoFile(rel); try { return f && fs.statSync(f).isFile() ? f : null; } catch { return null; } };
  const PREREAD = +(process.env.RIVAL_PREREAD ?? 4); /* how many of the newest top rival ads are read ahead per brand */
  const prereadRivals = async (b) => {
    if (!PREREAD || isMock() || !claudeTool || !b?.slug || !b.research?.get) return;
    const r = b.research.get() || {}, st = rivalStore(b.slug);
    const ads = resAll(r.ads).filter((a) => a?.id && (a.poster || a.video)).sort((a, x) => (a.rank || 99) - (x.rank || 99)).slice(0, PREREAD);
    for (const a of ads) { if ((await st.get(a.id))?.layout) continue; if (!spend('text')) break;
      await readRivalAd(a, { call: claudeTool, fileOf: fileOfRel, store: st, log }).catch(() => null); }
  };
  /* what the jam shows under "What Brew read from their ad": the ad, and the read when there is one */
  /* "Make our version" made final (finals-routes.js): the rival ad's composition and look in words, our words where theirs sit (a kept read costs nothing) */
  const rivalPicOf = async (t, c, words = {}) => { const ad = rivalAd(t, c); if (!ad) return null; const style = await readRivalAd(ad, { call: claudeTool, fileOf: fileOfRel, store: rivalStoreOf(t), log }).catch(() => null); return style ? rivalPicture(ad, style, words) : null; };
  const rivalSummary = (t, c) => { const ad = rivalAd(t, c); if (!ad) return null; const rd = readsMem.get(t?.brandId || DEFAULT_BRAND)?.[ad.id] || null;
    return { brand: ad.brand, url: ad.url || null, poster: ad.poster || null, format: ad.format || 'image', hook: ad.hook || '', angle: rd?.angle || ad.angle || '', days: ad.days || null, versions: ad.versions || null,
      read: rd ? { stopper: rd.stopper || '', audience: rd.audience || '', proof: rd.proof || '', hookPattern: rd.hookPattern || '', layout: rd.layout || '', look: rd.look || '', beats: rd.beats || [], works: rd.works || [], from: rd.from || 'poster' } : null }; };
  /* the rival ad behind a research ad card ("Make our version", rival-ad.js): the item the read saved, with its poster and clip */
  const rivalAd = (t, c) => { if (c?.research?.kind !== 'ad' && !c?.research?.ad) return null; const r = (t ? brandOfT(t)?.research : null)?.get?.() || research?.get?.() || {};
    const adId = c.research.kind === 'ad' ? c.research.id : c.research.ad; /* a how-to built on a rival ad names it */
    const a = resAll(r.ads).find((x) => x.id === adId); if (a) return a; if (c.research.kind !== 'ad') return null;
    /* the ad left the 30-day archive: the card still carries its poster, hook, angle and format, so the remake keeps its reference */
    const row = (k) => (c.rows || []).find((x) => x[0] === k)?.[1] || '';
    const poster = (c.images || []).find((u) => /^\/?research\//.test(String(u))) || null; if (!poster && !row('Hook')) return null;
    return { id: c.research.id, brand: String(c.title || '').split(':')[0].trim() || 'the rival', poster, format: /video/i.test(row('Format')) ? 'video' : 'image', hook: row('Hook'), angle: row('Angle'), headline: row('Hook'), body: String(c.sub || ''), cta: '', fromCard: true }; };
  /* the viral video behind a viral card (research.js refreshViral): the item the read saved, else what the card still carries */
  const viralOf = (t, c) => { if (c?.research?.kind !== 'viral') return null; const r = (t ? brandOfT(t)?.research : null)?.get?.() || research?.get?.() || {};
    const x = resAll(r.viral).find((y) => y.id === c.research.id); if (x) return x;
    const row = (k) => (c.rows || []).find((y) => y[0] === k)?.[1] || ''; const poster = (c.images || []).find((u) => /^\/?research\//.test(String(u))) || null;
    return { id: c.research.id, platform: /instagram/i.test(c.src) ? 'instagram' : /youtube/i.test(c.src) ? 'youtube' : 'tiktok', author: c.creatorName || 'the creator', url: c.link?.url || null, poster, video: null, views: null, usual: null, score: null, hook: row('Their hook') || row('Hook'), why: c.sub || '', read: null, fromCard: true }; };
  /* View references in the jam: the ad or the video "Make our version" remakes, theirs, shown only as a reference */
  const refSummary = (t, c) => {
    if (c?.research?.kind === 'viral') { const x = viralOf(t, c); if (!x) return null; const rd = x.read || {};
      return { kind: 'viral', platform: x.platform, platformName: PLAT[x.platform] || 'Social', author: x.author, handle: x.handle || null, url: x.url, poster: x.poster || null, video: x.video || null, views: x.views ?? null, usual: x.usual ?? null, score: x.score ?? null, scoreText: scoreText(x.score), days: x.days ?? null,
        hook: x.hook || rd.hook?.text || '', why: x.why || rd.whyItWorks || '', format: rd.format || '', pacing: rd.pacing || '', beats: (rd.scenes || []).slice(0, 8).map((s) => ({ t: s.t, shot: s.shot, text: s.onScreenText || s.voice || '' })) }; }
    const ad = rivalAd(t, c); if (!ad) return null; const sm = rivalSummary(t, c) || {};
    return { kind: 'ad', brand: ad.brand, url: ad.url || c.link?.url || null, poster: ad.poster || null, video: ad.video || null, format: ad.format || 'image', hook: ad.hook || '', why: ad.why || '', angle: sm.angle || ad.angle || '', days: ad.days ?? null, versions: ad.versions ?? null,
      beats: (sm.read?.beats || []).slice(0, 8).map((b) => ({ t: '', shot: typeof b === 'string' ? b : b?.shot || b?.what || '', text: typeof b === 'string' ? '' : b?.line || b?.words || '' })) }; };
  const researchCard = (kind, id) => {
    const r = research?.get() || {};
    if (kind === 'ad') { const a = resAll(r.ads).find((x) => x.id === id); return a && adCard(a, a.firstSeen || r.ads.fetchedAt); }
    if (kind === 'viral') { const x = resAll(r.viral).find((y) => y.id === id); return x && (x.poster || x.video) && viralCard(x, x.firstSeen || r.viral.fetchedAt); }
    if (kind === 'trend') { const x = resAll(r.trends).find((y) => y.id === id); return x && !emptyTrend(x) && x.terms?.every((term) => r.trends.series?.[term]) && trendCard(x, x.firstSeen || r.trends.fetchedAt); }
    if (kind === 'howto') { const x = resAll(r.howto).find((y) => y.id === id); return x && howtoCard(x, x.firstSeen || r.howto.fetchedAt); }
    if (kind === 'news') { const x = resAll(r.news).find((y) => newsId(y) === id); return x && newsCard(x, x.firstSeen || r.news.fetchedAt); }
  };
  /* which research becomes a card: live stories and archived ones alike, strongest first (ads: Meta rank, versions, run
     length; trends: size of the move), so a strong story that expired from the ring still reaches the feed, where the
     ranker places it like any other card */
  const resStrength = (wid, x, r) => wid === 'viral' ? (x.score || 0) * Math.log10(10 + (x.views || 0)) : wid === 'trends' ? (x.kind === 'rising' ? 40 : Math.max(0, ...(x.terms || []).map((term) => Math.abs(r.trends?.series?.[term]?.change || 0))))
    : (30 - (x.rank || 30)) / 3 + Math.log2(1 + (x.versions || 1)) * 4 + Math.min(x.days || 0, 120) / 10;
  const fromResearch = (t, wid, n) => {
    const r = research?.get() || {}; const out = [];
    const src = wid === 'trends' ? resAll(r.trends) : resAll(r.ads), list = src.slice().sort((a, b) => resStrength(wid, b, r) - resStrength(wid, a, r)).map((x) => researchCard(wid === 'trends' ? 'trend' : 'ad', x.id));
    for (const c of list) { if (out.length >= n) break; if (!c || t.used.has(c.id) || t.cards.has(c.id)) continue; t.used.add(c.id); out.push(c); }
    /* the "make our version" watcher brings one viral video in the category too (research.js refreshViral) */
    /* audience-interest videos (what the buyers also watch, outside the category) score lower than category hits, so they take
       every other seat: when the feed holds fewer of them than category ones, the best one comes first */
    if (wid === 'ads-library') { const vs = resAll(r.viral).slice().sort((a, b) => resStrength('viral', b, r) - resStrength('viral', a, r)), inFeed = vs.filter((x) => t.cards.has(viralCardId(x.id)));
      const order = inFeed.filter((x) => x.interest).length < inFeed.filter((x) => !x.interest).length ? [...vs.filter((x) => x.interest), ...vs.filter((x) => !x.interest)] : vs;
      for (const x of order) { const c = researchCard('viral', x.id); if (!c || t.used.has(c.id) || t.cards.has(c.id)) continue; t.used.add(c.id); out.push(c); break; } }
    return out;
  };
  const wireResearch = (b) => { if (b?.research) setTimeout(() => { if (isLeader() && !movedAway(b.slug)) runIn?.(b, () => prereadRivals(b))?.catch?.(() => {}); }, 90e3).unref?.(); return b.research?.onRefresh((done) => {
    if (done.includes('ads') && !movedAway(b.slug)) Promise.resolve(runIn ? runIn(b, () => prereadRivals(b)) : prereadRivals(b)).catch((e) => log.warn('[rival preread]', b.slug, e.message));
    for (const t of brandTenants(b)) {
      if (done.includes('trends') && t.watchers.trends) t.watchers.trends.nextRun = now(t) + 15e3;
      if ((done.includes('ads') || done.includes('viral')) && t.watchers['ads-library']) t.watchers['ads-library'].nextRun = now(t) + 30e3;
    }
  }); };

  /* ---------- cards from live data (live-watch.js): the brand's catalog and real AI answers ---------- */
  const ENG = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude' };
  const inrN = (n) => (B().sym || '') + Math.round(n).toLocaleString(safeLocale(B().config.locale || 'en-IN'));
  const andList = (xs) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
  const short = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  /* catalog cards: the products that sell most first, by the best signal Brew holds, and the card says which (QA FEED-ARV-08):
     units sold in 30 days (a connected Shopify, team only), else the store's own best-seller list, else review counts, else price.
     Products our cards and ads point to always lead */
  const CAT_V = 2, VIS_V = 2; /* VIS_V: AI-answers gap cards say their own fix */
  /* the products a price fact quotes, by handle: Shopify's /products/<handle>, or a watched product page on any other platform */
  const quotedOf = () => { const pages = new Map((B()?.config?.catalogPages || []).map((x) => { try { const u = new URL(x.url); return [u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''), x.handle]; } catch { return ['', null]; } }));
    return new Set(Object.values(B()?.facts || {}).filter((f) => f && f.kind === 'price').map((f) => { const src = String(f.src || '').replace(/^www\./, '').replace(/\/$/, ''); return pages.get(src) || (/\/products\//.test(src) ? src.split('/').pop() : null); }).filter(Boolean)); };
  const nameOfItem = (i) => { const f = /^[\w.-]+$/.test(String(i?.title || '')) ? B()?.facts?.[i.title] : null; return f?.label ? String(f.label).replace(/\s+(price|mrp)$/i, '') : String(i?.title || ''); }; /* a removed product saved as its fact key reads as its name */
  const unitsOf = (t) => { const e = t?.member ? t.liveLedger?.['shopify.units.30d'] || t.liveLedger?.['shopify.top.30d'] : null; /* every product that sold, else the top 5 */ return e && !e.demo && !e.stale ? unitsFrom(e.v) : new Map(); }; /* the team's own Shopify, never a simulated one */
  const salesRank = (x, t, quoted) => salesRank0(x, { rank: B()?.catalogRank || {}, units: unitsOf(t), quoted });
  const liveCard = (wid, e, t = null) => {
    const at = new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    if (wid === 'catalog') {
      /* one line per product, "issue · fix", the products that sell most first; the title names the product (or the count) and
         what to do (QA FEED-ARV-08). Saved cards are written again from their reading (housekeep, CAT_V) */
      if (/^cat-oos-q-/.test(e.id)) return null; /* an old reading of only the products our cards sell: the one stock-out card holds them (QA FEED-11) */
      const quoted = new Set([...(e.quoted || []), ...quotedOf()]), r = salesRank((e.items || []).map((i) => ({ ...i, title: nameOfItem(i) })), t, quoted), x = r.sorted, n = x.length;
      if (!n) return null;
      const t0 = short(x[0].title, 32), isQ = (i) => quoted.has(handleOf(i)), nq = x.filter(isQ).length;
      const base = { id: 'lv-' + e.id, catV: CAT_V, agent: 'storefront', sector: 'catalog', lane: firstLane(), roles: ['ecom', 'founder', 'growth'], kind: 'rows', src: `${BH()}, checked ${at}`, liveSrc: { kind: 'catalog', id: e.id }, link: x[0]?.url ? { label: `Open on ${BH()}`, url: x[0].url } : undefined, ttlDays: 7 };
      const rows = (f) => x.slice(0, 4).map((i) => [short(i.title, 34), f(i)]), order = `Order: ${r.said}.`;
      if (e.kind === 'oos') return { ...base, type: 'decision', family: 'exception', badge: ['Out of stock', 'warn'],
        title: n === 1 ? `${t0} is sold out: pause the ads that point to it` : `${plural(n, 'product is', 'products are')} sold out: pause the ads that point to them`,
        sub: `${nq ? (n === 1 ? 'Our ads point to it. ' : `${nq} of them ${nq === 1 ? 'is a product' : 'are products'} our ads point to. `) : ''}Shoppers who land there can’t buy until it’s back.`,
        rows: rows((i) => `Sold out · ${isQ(i) ? 'pause our ads' : 'pause links'}`), detail: { why: [`Checked on the live ${BH()} catalog.`, 'Shoppers who land there can’t buy.', order], how: ['Brew lists every ad and message that points there.', 'Your team pauses them or swaps in an in-stock product.', 'Brew posts a card when it is back in stock.'] }, cta: { label: 'Pause the ads for these' } };
      if (e.kind === 'back') return { ...base, type: 'report', family: 'result', badge: ['Back in stock', 'ok'], title: n === 1 ? `${t0} is back in stock: restart its ads` : `${plural(n, 'product is', 'products are')} back in stock: restart their ads`, sub: `${n === 1 ? 'It' : 'They'} can be bought again. Anything paused for ${n === 1 ? 'it' : 'them'} can restart.`, rows: rows(() => 'In stock · restart ads'), detail: { why: [`Checked on the live ${BH()} catalog.`, order], how: ['Your team restarts anything it paused for it.'] }, cta: { label: 'Restart what was paused' } };
      if (e.kind === 'price' || e.kind === 'drift') { const it = x.map((i) => ({ t: i.title, was: i.was != null ? (typeof i.was === 'number' ? inrN(i.was) : i.was) : '', now: i.now || inrN(i.price) })).filter((i) => i.was !== i.now); // saved events from before the paise fix: "₹1,850 → ₹1,850" is no change
        if (!it.length) return null;
        return { ...base, type: 'decision', family: 'exception', badge: ['Price changed', 'warn'], liveNums: it.flatMap((i) => [i.was, i.now]),
          title: it.length === 1 ? `${short(it[0].t, 32)} is now ${it[0].now}: update its ads` : e.kind === 'drift' ? `${plural(it.length, 'price our cards quote has', 'prices our cards quote have')} changed: update those ads` : `${plural(it.length, 'price', 'prices')} changed on ${BH()}: update the ads that quote them`,
          sub: `${short(it[0].t, 60)} is now ${it[0].now}${it[0].was ? `, was ${it[0].was}` : ''}${it.length > 1 ? `, plus ${plural(it.length - 1, 'more', 'more')}` : ''}. ${e.kind === 'drift' ? 'Cards and ads that quote the old price are now wrong.' : 'Ads and messages quoting the old price need the new one.'}`,
          rows: it.slice(0, 4).map((i) => [short(i.t, 34), `${i.was ? `${i.was} → ${i.now}` : i.now} · update ads`]), detail: { why: [`Read from the live ${BH()} catalog.`, 'A wrong price in an ad is a broken promise at checkout.', order], how: ['The fact sheet takes the new price on its daily check.', 'Brew lists the cards and moves that quote the old one.', 'Your team updates the ads and messages.'] }, cta: { label: 'Update the prices' } }; }
      if (e.kind === 'removed' || e.kind === 'gone') return { ...base, type: 'decision', family: 'exception', badge: ['Removed', 'warn'], title: n === 1 ? `${t0} was removed: redirect its link` : `${plural(n, 'product was', 'products were')} removed: redirect their links`, sub: `${n === 1 ? 'It is' : 'They are'} gone from the live store. Links and ads that point there now land on an error page.`, rows: rows(() => 'Removed · redirect link'), detail: { why: [`Checked on the live ${BH()} catalog.`, 'A dead link wastes every click.', order], how: ['Brew lists what points there.', 'Your team redirects it or pauses it.'] }, cta: { label: 'Fix the links' } };
      if (e.kind === 'new') return { ...base, type: 'idea', family: 'idea', badge: ['New on the store', 'info'], liveNums: x.map((i) => inrN(i.price)), title: n === 1 ? `${t0} is new on ${BH()}: plan its launch` : `${plural(n, 'new product is', 'new products are')} live: plan their launch`, sub: `${n === 1 ? 'It went' : 'They went'} live recently. None has launch content in the feed yet.`, rows: rows((i) => `New, ${inrN(i.price)} · plan launch`), detail: { why: [`Found on the live ${BH()} catalog.`, 'A launch with no ads or messages sells to nobody.', order], how: ['The Creative director drafts launch ideas.', 'The CRM specialist drafts a message to past buyers.', 'You pick what goes out.'] }, cta: { label: 'Plan the launch' } };
      if (e.kind === 'thin') return { ...base, type: 'decision', family: 'exception', badge: [plural(n, 'listing', 'listings'), 'warn'], title: n === 1 ? `${t0} has ${plural(x[0].images || 0, 'photo', 'photos').replace(/^0 photos$/, 'no photo')}: add more angles` : `${plural(n, 'listing has', 'listings have')} one photo or none: add more angles`, sub: 'Shoppers and catalog ads need more than one angle to trust a product.', rows: rows((i) => `${i.images ? plural(i.images, 'photo', 'photos') : 'No photo'} · add angles`), detail: { why: [`Counted on the live ${BH()} catalog.`, 'Listings with one image convert worse and look thin in catalog ads.', order], how: ['Brew drafts packshots from the single-product photos.', 'Keep each one or redo it.', 'Your team adds them to the listings.'] }, cta: { label: 'Add photos' } };
      return null;
    }
    /* the AI tools that really answered in this event's run, never the full list: a tool that failed or wasn't asked isn't named */
    const run = (live?.get()?.visibility?.runs || []).find((r) => r.at === e.run), engs = run ? [...new Set(run.answers.map((a) => a.engine))] : (e.byEngine || []).filter((b) => b.total).map((b) => b.engine);
    const tools = engs.length ? andList(engs.map((x) => ENG[x] || x)) : 'the AI tools', nq = run?.qs?.length || (engs.length ? Math.round((e.total || 0) / engs.length) : 0);
    const base = { id: 'lv-' + e.id, agent: 'visibility', sector: 'visibility', lane: firstLane(), roles: ['founder', 'brand', 'ecom'], src: `${tools}, asked from ${CTRY()} · ${at}`, liveSrc: { kind: 'visibility', id: e.id }, ttlDays: 7 };
    if (e.kind === 'score') { const d = e.was ? e.named - e.was.named : null;
      return { ...base, type: 'report', family: 'result', kind: 'rows', badge: [d == null ? 'This week' : d > 0 ? `+${d}` : d < 0 ? `${d}` : 'No change', d > 0 ? 'ok' : d < 0 ? 'warn' : 'info'], health: d ? { 'AI answers': d } : undefined,
        title: `${BN()} is named in ${e.named} of ${e.total} AI answers this week`, sub: `We asked ${nq ? plural(nq, 'shopper question', 'shopper questions') : 'shopper questions'} to ${tools}, from ${CTRY()}.${e.was ? ` Last time it was ${e.was.named} of ${e.was.total}.` : ' This is the first reading; next week shows the change.'}`,
        rows: e.byEngine.filter((b) => b.total).map((b) => [ENG[b.engine], `${b.named} of ${b.total}`]), detail: { why: ['Real answers from the consumer apps, with web search on.', 'Shoppers ask these before they buy.'], how: ['Brew asks the same questions every week.', 'Each gap becomes a card with a page or a claims fix to draft.'] }, cta: { label: 'Open report' } }; }
    if (e.kind === 'gap') { /* one specific fix per gap (QA FEED-ARV-09): the question, the rival named instead, the brand's page that fits it */
      const g = gapFix({ q: e.q, rivals: e.rivals || [], product: matchProduct(e.q, B()?.catalog || [], { brand: BN() }), brand: BN(), host: BH() });
      return { ...base, visV: VIS_V, type: 'decision', family: 'exception', kind: 'answer', q: e.q, a: `${andList(e.rivals)} ${e.rivals.length === 1 ? 'is' : 'are'} named. ${BN()} is in none of the ${e.of} answers.`,
        title: g.title, sub: `${tools} name ${andList(e.rivals.slice(0, 2))} instead${e.domains?.length ? ` and cite ${andList(e.domains.slice(0, 2))}` : ''}. The fix: ${g.fix}.`,
        rows: [['Named instead', short(e.rivals.join(', '), 40)], ['Page that fits', g.page], [`${BN()} named`, `0 of ${e.of}`]], ...(g.url ? { link: { label: `Open the page on ${BH()}`, url: g.url } } : {}),
        detail: { why: [`Real answers from the consumer apps, asked from ${CTRY()}.`, 'Answers lean on the sites they cite.'], how: [`Brew drafts ${g.fix}.`, `Your team puts it on ${BH()}.`, 'Brew asks again next week.'] }, cta: { label: 'Draft the page' } }; }
    if (e.kind === 'win') return { ...base, type: 'report', family: 'result', kind: 'answer', q: e.q, a: e.said || `${andList(e.engines.map((x) => ENG[x]))} now names ${BN()}.`, badge: ['Named', 'ok'], health: { 'AI answers': e.engines.length },
      title: short(`${andList(e.engines.map((x) => ENG[x]))} now names ${BN()} for “${e.q.replace(/\?$/, '')}”`, 76), sub: `${BN()} is now in ${e.yes.length} of ${e.of} answers to this question, up from ${e.yes.length - e.engines.length} last time.`, rows: [['Named in', `${e.yes.length} of ${e.of}`]], detail: { why: ['Real answers, compared with last week.'], how: ['We keep asking weekly.'] }, cta: { label: 'Open report' } };
    if (e.kind === 'loss') return { ...base, type: 'decision', family: 'exception', kind: 'rows', badge: ['Dropped', 'warn'], health: { 'AI answers': -e.engines.length },
      title: short(`${andList(e.engines.map((x) => ENG[x]))} stopped naming ${BN()} for “${e.q.replace(/\?$/, '')}”`, 76), sub: `${BN()} is in ${e.yes.length} of ${e.of} answers now${e.rivals?.length ? `; ${andList(e.rivals.slice(0, 3))} still show up` : ''}.`, rows: [['Named in', `${e.yes.length} of ${e.of}`], ['Lost', andList(e.engines.map((x) => ENG[x]))]], detail: { why: ['Real answers, compared with last week.'], how: ['Brew checks which page it used to cite.', 'Your team refreshes that page.'] }, cta: { label: 'See what changed' } };
    return null;
  };
  const fromLive = (t, wid, n) => {
    const s = live?.get()?.[wid]; const out = [];
    for (const e of s?.events || []) { if (out.length >= n) break; const id = 'lv-' + e.id; if (t.used.has(id) || t.cards.has(id)) continue; const c = liveCard(wid, e, t); t.used.add(id); if (c) out.push(c); }
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
      how = w.id === 'catalog' ? `from the live ${BH()} catalog (${s?.count || 0} products)` : `from real ${(() => { const r0 = live?.get()?.visibility?.runs?.[0]; return r0 ? andList([...new Set(r0.answers.map((a) => ENG[a.engine] || a.engine))]) : 'AI'; })()} answers`;
      if (!proposals.length) { wlog(t, w, !s ? (live?.running().includes(w.id) ? 'Reading the live source now' : w.id === 'catalog' && !B()?.config?.catalogUrl && !(B()?.config?.catalogPages || []).length ? 'Nothing to watch yet: the read found no product pages on the site' : 'Live source not read yet') : `Checked ${w.id === 'catalog' ? `${s.count} products on ${BH()}` : 'the latest AI answers'}: nothing new`); return []; } }
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
    wlog(t, w, `${why === 'manual' ? 'Run now' : why === 'overnight' ? 'Overnight run' : why === 'visit' ? 'When you came back' : 'Scheduled run'}: ${made.length} proposed${how ? ', ' + how : ''}`, made);
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
    const good = c.variants.filter((v) => variantOk(parent, v)); c.variants = good.length === c.variants.length ? c.variants : [...good, ...mockVariants(parent)].slice(0, 3); c._vfix = 1; }
    /* one, always (Param, 19 Oct): a heart card made with three cuts keeps its first; Redo it in the jam makes the next */
    for (const c of t.cards.values()) if (c.origin === 'heart' && (c.variants?.length || 0) > 1) { c.variants = c.variants.slice(0, 1); c.title = 'One more in the direction you hearted'; c.sub = String(c.sub || '').replace(/,? cut three ways/i, '').replace(/\s*Pick the one to run\./, ' Redo it in the jam if it isn’t right.'); } };
  const heartChild = (t, parent) => {
    const existing = [...t.cards.values()].find((c) => c.parentCardId === parent.id && c.origin === 'heart'); if (existing) return existing;
    const child = { id: uid('more'), parentCardId: parent.id, origin: 'heart', agent: parent.agent === 'brew' ? 'creative' : parent.agent, sector: parent.sector, type: 'idea', family: 'idea', lane: parent.lane, roles: parent.roles, time: 'Just now', campaign: 'More like this', kind: 'variants', loading: true, images: parent.images ? [parent.images[0]] : null, title: 'One more in the direction you hearted', sub: `Same idea as “${parent.title}”, one new cut.`, cta: { label: 'Make the ad' }, src: parent.src, createdAt: now(t), history: [] };
    setState(t, child, 'proposed'); t.cards.set(child.id, child);
    (async () => {
      setState(t, child, 'qa');
      let vs, how = 'mock';
      if (!isMock() && spend('text')) { try { const j = await claudeJSON(`${cardBrief(parent, seatLine(t.viewer), t)}\n\nThe reader hearted this card. Write ONE new feed card in the same direction, a different cut (persona, format or hook) from the card above. JSON: {"variants":[{"angle":"2-3 words","title":"under 60 chars, point first, plain words","sub":"two sentences, 25 to 35 words: what we saw with the number, then the move and what it gets ${BN()}; no fonts, design notes or file names; numbers only from the facts"}]}`); vs = j.variants; how = 'live'; } catch (e) { log.warn('[heart]', e.message); } }
      vs = (vs || mockVariants(parent)).slice(0, 1).map((v) => ({ ...v, title: clean(v.title), sub: clean(v.sub) })).filter((v) => !BANNED.test(v.title + v.sub) && variantOk(parent, v));
      child.variants = vs.length ? vs : mockVariants(parent).slice(0, 1); child.loading = false;
      child.sub = how === 'live' ? `Written just now from “${parent.title}”. Redo it in the jam if it isn’t right.` : `Same idea as “${parent.title}”, one new cut. Redo it in the jam if it isn’t right.`;
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
  /* one, always (Param, 19 Oct): a jam message makes ONE new version of the card, never three to pick from */
  const makeVersions = async (t, c, prompt, extra = '') => {
    if (!isMock() && spend('text')) {
      try {
        const j = await claudeTool(`${cardBrief(c, seatLine(t.viewer), t)}\n\nThe reader wants: "${prompt || 'a new angle'}". ${extra}\n${promptBlock(t, c.agent === 'brew' ? 'creative' : c.agent)}\nReply as the ${AGENT[c.agent] || 'agent'}: one short line, then ONE version of this card that do exactly that. Plain words, only numbers from the facts.`,
          { type: 'object', required: ['line', 'versions'], properties: { line: { type: 'string', description: 'Under 20 words' }, versions: { type: 'array', items: { type: 'object', required: ['angle', 'title', 'sub'], properties: { angle: { type: 'string', description: '2-3 words' }, title: { type: 'string', description: 'Under 60 characters' }, sub: { type: 'string', description: 'Under 100 characters, one exact number from the facts' } } } } } }, 1500, 'versions');
        const vs = (j.versions || []).slice(0, 1).map((v) => ({ ...v, title: clean(v.title), sub: clean(v.sub) })).filter((v) => !BANNED.test(v.title + v.sub) && qaCheck({ ...c, ...v }).every((x) => x.ok || x.k === 'Names a number'));
        if (vs.length) return { line: clean(j.line || 'Here it is.'), versions: vs, live: true };
      } catch (e) { log.warn('[versions]', e.message); }
    }
    return { line: 'Here it is. Not right? Ask again, or tell me what to change.', versions: mockVariants(c).slice(0, 1), live: false };
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
  /* Google's rising value is a percent, and a huge one (841400) marks a breakout: shown as "+200%" or "Breakout", never the raw number */
  const riseLabel = (v) => (/^\d+$/.test(String(v)) ? (+v >= 5000 ? 'Breakout' : `+${v}%`) : v);
  const STORY_LIFE = 24 * 3600e3, STORY_CUT = () => +process.env.STORY_CUT || 0.45;
  /* every ring always has stories: the fresh ones over the cut-off first; with none, the source is read again now (research.need)
     and, until that lands, the ring shows its best recent ones (under the cut, then the newest it has, marked older) instead
     of disappearing */
  const storyPick = (items, snapAt, strength, t, max = 8, src = null) => { const n = now(t);
    const scored = (items || []).map((x) => { const at = x.firstSeen || snapAt || 0, age = n - at;
      const score = 0.4 * Math.max(0, 1 - age / STORY_LIFE) + 0.6 * Math.max(0, Math.min(1, strength(x))); return { ...x, firstSeen: at, age, score: +score.toFixed(3) }; })
      .sort((a, b) => b.score - a.score).filter((x, i, a) => !a.slice(0, i).some((y) => near(x, y))); /* two near-identical stories show once */
    const strip = ({ age, ...x }) => x;
    const fresh = scored.filter((x) => x.age < STORY_LIFE && x.score >= STORY_CUT());
    if (fresh.length) return fresh.slice(0, max).map(strip);
    if (src) research?.need?.(src);
    const today = scored.filter((x) => x.age < STORY_LIFE);
    if (today.length) return today.slice(0, Math.min(max, 5)).map(strip);
    return scored.sort((a, b) => b.firstSeen - a.firstSeen).slice(0, Math.min(max, 5)).map((x) => ({ ...strip(x), older: true })); };
  const stories = (t) => {
    const r0 = research?.get() || {};
    const withArchive = (o) => [...(o.items || []), ...(o.archive || [])]; /* expired stories stay in reach for the older fallback */
    const adTop = Math.max(1, ...(r0.ads?.items || []).map((a) => (30 - (a.rank || 30)) / 3 + Math.log2(1 + (a.versions || 1)) * 4 + Math.min(a.days || 0, 120) / 10));
    const r = {
      ads: r0.ads && { ...r0.ads, items: storyPick(withArchive(r0.ads), r0.ads.fetchedAt, (a) => ((30 - (a.rank || 30)) / 3 + Math.log2(1 + (a.versions || 1)) * 4 + Math.min(a.days || 0, 120) / 10) / adTop, t, 8, 'ads') },
      trends: r0.trends && { ...r0.trends, items: storyPick(withArchive(r0.trends).map((x) => ({ ...x, terms: (x.terms || []).filter((term) => r0.trends.series?.[term]) })), r0.trends.fetchedAt,
        (x) => (x.kind === 'rising' ? 0.8 : Math.max(0.35, ...x.terms.map((term) => Math.abs(r0.trends.series[term]?.change || 0) / 50))), t, 8, 'trends') },
      /* news: anything the scout found in its 21-day window is real and dated, so it starts strong and the newest ranks first; a
         7-day scale scored a niche brand's week-old rival news at zero and hid the whole ring (Comet, 2026-10-14) */
      news: r0.news && { ...r0.news, items: storyPick(withArchive(r0.news), r0.news.fetchedAt, (x) => { const d = Date.parse(x.date); if (isNaN(d)) return 0.5; const a = Math.max(0, now(t) - d) / (21 * 24 * 3600e3); return a > 1 ? 0 : 0.45 + 0.55 * (1 - a); }, t, 10, 'news') },
      howto: r0.howto && { ...r0.howto, items: storyPick(withArchive(r0.howto), r0.howto.fetchedAt, () => 0.7, t, 4, 'howto') }
    };
    const lastAt = (o) => Math.max(0, ...(o?.items || []).map((x) => x.firstSeen || 0)) || o?.fetchedAt || null;
    /* a slide with no photo of its own gets the brand's own product photo it talks about (most shared words with a card
       that has one), shown faint behind the text; with no match it stays a plain dark slide, never a colour blob */
    const STOP = new Set('the and for with your you are was this that from have has not but our its into than then them they what when will more most over just only also about after before their there these those which while been being'.split(' '));
    const words = (x) => new Set(String(x || '').toLowerCase().match(/[a-z][a-z-]{3,}/g)?.filter((w) => !STOP.has(w)) || []);
    const pool = [...t.cards.values()].filter((c) => c.images?.[0] && !String(c.images[0]).startsWith('data:') && !isRivalCard(c)) /* a rival's poster is never the brand's photo */.map((c) => ({ img: c.images[0], w: words(`${c.title} ${c.sub || ''}`) }));
    const bgFor = (sl) => { if (sl.img || sl.poster || !pool.length) return sl; const w = words([sl.h, sl.p, ...(sl.steps || [])].join(' ')); let best = null, top = 1;
      for (const c of pool) { let n = 0; for (const x of w) if (c.w.has(x)) n++; if (n > top) { top = n; best = c; } }
      return best ? { ...sl, bg: best.img } : sl; };
    /* a ring whose last read failed and has nothing left today says so, never just vanishes as if there was nothing (brew-external-data rule 1) */
    const fails = research?.failures?.() || {};
    const failedNote = (k, title, slides) => (slides.length || k === 'brand' ? slides : !r0[k] && fails[k]
      ? [{ type: 'note', c: SEED.brand.wash[2], h: `No ${title.toLowerCase()} yet`, p: 'The first read found nothing to show. Brew tries again within the hour.', from: 'Brew', at: fails[k].at }]
      : r0[k]?.lastError
      ? [{ type: 'note', c: SEED.brand.wash[2], h: `Couldn't refresh ${title} this time`, p: 'The source didn’t answer. Brew tries again within the hour.', from: 'Brew', at: r0[k].lastError.at }]
      : slides); /* a ring that is only waiting for its next read has nothing to show: it is hidden, not a "Finding new stories" slide (QA FEED-QA-28) */
    const ring = (k, title, slides, o = {}) => { slides = failedNote(k, title, slides); return { k, title, slides: slides.map(bgFor), ...o, seen: !!o.updatedAt && (t.storySeen[k] || 0) >= o.updatedAt }; };
    const extra = (k) => t.storyExtra[k].slice().reverse().map((x) => ({ ...x, type: 'note' }));
    const ads = r.ads, tr = r.trends, nw = r.news, ht = r.howto;
    const adSlides = (ads?.items || []).map((a) => ({ type: 'ad', ...a, forUs: a.take || adForUs(a, BN()), total: ads.brands.find((b) => b.name === a.brand)?.live, cardId: t.cards.has('r-ad-' + a.id) ? 'r-ad-' + a.id : null }));
    const where = B()?.config?.countryName || null; /* the brand's own market, never a hard-coded country (QA STO-05/06) */
    /* a trend slide shows a search series under its "Search interest" chip: one the AI wrote with no series ("We currently have 0 live Meta ads") is dropped; calendar and rising-searches slides stand on their own (final QA pass 19 Oct, FEED-QA-28) */
    const hasSeries = (x) => x.kind === 'calendar' || (x.kind === 'rising' && x.rising?.length) || (x.terms || []).some((term) => tr?.series?.[term]?.values?.length);
    const trSlides = (tr?.items || []).filter(hasSeries).map((x) => ({ type: x.kind === 'rising' ? 'rising' : 'trend', ...x, where, rising: x.rising ? x.rising.map((r) => ({ ...r, v: riseLabel(r.v) })) : x.rising, series: (x.terms || []).filter((term) => tr.series?.[term]).map((term) => { const s = tr.series[term]; return { term, values: s.values, change: s.change, last: s.last }; }), dates: tr.series[x.terms[0]]?.dates || Object.values(tr.series)[0]?.dates }));
    const batches = t.batches.slice(0, 3).map((b) => ({ type: 'note', c: SEED.brand.wash[1], h: b.t, p: `${b.s}. ${b.st === 'Running' ? b.pct + '% done.' : b.st + '.'}`, from: 'Your work' }));
    const newsSlides = (nw?.items || []).map((x) => ({ type: 'news', ...x, id: newsId(x), forUs: x.take || newsForUs(x, BN()), cta: newsCta(x) }));
    const spark = (term) => tr?.series[term]?.values;
    // the brand today: its own most important new things, never outside news.
    // The two top-ranked open cards, then work waiting on you, the latest measured result, and work the team finished.
    const { ranked: ranked0 } = rankSoon(t); /* the feed just ranked (the page asks for both at once): reuse it for a minute */
    const ranked = (process.env.PLAIN_OFF === '1' ? ranked0 : ranked0.map((c) => PLAIN.apply(slugOfT(t), c))).map((c) => freshCounts(c, countsFor(packFor(t)), { live: !!t.member })); /* the stories say each card in the same plain words as the feed */
    /* the brand today leads with what is new since the last visit, when there is any; else the top of the feed */
    const open0 = ranked.filter((c) => !c.done && !c.loading && !String(c.id).startsWith('r-')), sinceV = t.visit?.prev, news = sinceV ? open0.filter((c) => c.createdAt > sinceV) : [];
    const topCards = (news.length ? news : open0).slice(0, 2).map((c, i) => ({ type: 'brand', chip: news.length ? (i ? 'Also new' : 'New since your last visit') : i ? 'Next up' : 'Biggest move today', h: c.title, p: c.sub, img: (c.images || [])[0], agent: c.agent, cardId: c.id, cta: c.cta?.label, at: c.createdAt }));
    const waiting = t.work.filter((w) => w.stage === 'needs_you').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 2).map((w) => { const v = w.versions.find((x) => x.n === w.current) || w.versions[w.versions.length - 1];
      return { type: 'brand', chip: 'Waiting on you', h: v?.title || w.title, p: v?.sub || `${w.with?.name || 'Your team'} sent it back for your OK.`, img: w.img, agent: w.agent, workId: w.id, at: w.updatedAt }; });
    const shipped = extra('news').map((x) => ({ ...x, type: 'brand', chip: x.from || 'Your team' }));
    const brandSlides = [...topCards, ...waiting, ...shipped, ...t.batches.slice(0, 3).map((b, i) => ({ type: 'brand', chip: 'Your agents, this week', h: b.t, p: `${b.s}.`, agent: b.team ? 'brew' : b.agent, pct: b.pct, st: b.st, at: batches[i]?.at }))].slice(0, 8);
    /* Recap: what happened since this person was last here (recap.js). No last visit, or nothing since: no ring */
    const v = t.visit, recapSlides = v?.prev ? buildRecap({ since: v.prev, sinceReal: v.prevReal, when: sinceLabel(v.prev, now(t), B()?.tzMs ?? 5.5 * H), work: t.work, notes: t.notes,
      cards: ranked.filter((c) => !c.done && !c.loading && !String(c.id).startsWith('r-')), moveDocs: brandOfT(t)?.moveDocs, plain: dejargon, ledger: t.member ? t.liveLedger : null, base: v.base,
      moveCard: (n) => ranked.find((c) => moveNo(c.id) === n)?.id || null }) : [];
    const recapRing = recapSlides.length ? [{ k: 'recap', title: 'Recap', slides: recapSlides, updatedAt: Math.max(...recapSlides.map((x) => x.at || 0)) || null, source: 'Since your last visit', seen: (t.storySeen.recap || 0) >= (v.atReal || v.at || 0) }] : [];
    return [
      ring('brand', SEED.brand.name.length <= 8 ? `${SEED.brand.name} today` : 'Today', brandSlides, { updatedAt: Math.max(0, ...brandSlides.map((x) => x.at || 0)) || null, cover: topCards.find((x) => x.img)?.img, source: 'Your feed, work and results' }),
      ...recapRing,
      ring('trends', 'Trends', [...trSlides, ...extra('trends')], { updatedAt: lastAt(tr), source: tr?.source, spark: spark(tr?.items?.[0]?.terms?.[0]), loading: !tr && !fails.trends }),
      ring('ads', 'Popular ads', [...adSlides, ...extra('ads')], { updatedAt: lastAt(ads), source: ads?.source, cover: adSlides[0]?.poster, loading: !ads && !fails.ads }),
      ring('news', 'Industry news', newsSlides.slice(0, 10), { updatedAt: lastAt(nw), source: nw?.source, cover: newsSlides.find((x) => x.img)?.img, loading: !nw && !fails.news }),
      ring('howto', 'How to', (ht?.items || []).map((x) => ({ type: 'howto', ...x, cardId: t.cards.has('r-' + x.id) ? 'r-' + x.id : null })), { updatedAt: lastAt(ht), source: ht?.source, cover: ht?.items.find((x) => x.img)?.img, loading: !ht && !fails.howto })

    ].filter((x) => x.k === 'brand' || x.slides.length); /* a ring with no slides is hidden (QA FEED-QA-28); the brand's own ring stays. A ring whose read failed keeps its note */
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
    const [pk, fj] = await Promise.all([packs.load(slug).catch(() => null), (o.globalPacks?.getJSON ? o.globalPacks.getJSON(slug, 'findings.json', null) : Promise.resolve(null)).catch(() => null) /* the brand packs here have no getJSON: the demo tour's read threw */]);
    const savedStep = (k) => { const a = (fj?.steps || []).find((x) => x.k === k), b = (pk?.seed?.steps || []).find((x) => x.k === k); if (!a && !b) return null; return { ...(a || {}), ...(b?.done ? { done: b.done } : {}) }; };
    const savedCards = (k) => { const c = (pk?.seed?.scrape || []).filter((x) => x.k === k); return c.length ? c : (fj?.cards || []).filter((x) => x.k === k); };
    const held = new Map(); /* each step's live findings wait for the step's verdict */
    builder.readLive(slug, { signal: ac.signal, onEvent: (ev) => { const i = STEP_KEYS.indexOf(ev.k);
      if (ev.type === 'step' && ev.state === 'reading' && i >= 0) send({ type: 'step', i, state: 'reading', tick: ev.tick || '' }, PACE.step);
      if (ev.type === 'finding') { if (i >= 0) { if (!held.has(ev.k)) held.set(ev.k, []); held.get(ev.k).push(ev); } else send({ type: 'finding', i, finding: ev.finding, say: ev.say || 'Found it' }, PACE.finding); }
      if (ev.type === 'step' && (ev.state === 'done' || ev.state === 'empty') && i >= 0) {
        const v = tourStep(ev, savedStep(ev.k), savedCards(ev.k), held.get(ev.k) || []); held.delete(ev.k);
        v.cards.forEach((c) => send({ type: 'finding', i, ...c }, PACE.finding));
        send({ type: 'step', i, state: 'done', empty: v.empty, done: v.done }, PACE.step); if (AGENT_OF[ev.k] && !v.empty) send({ type: 'agent', agent: AGENT_OF[ev.k] }); } } })
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
  /* where a card's action runs: NEEDS / NO_TOOL / IF_WORDS / toolInWords and the pure toolOf live in channel-fit.js */
  const deployTarget = (label, card) => { let k = toolOf(label, card); if (k === 'loox' && !SEED.connectors.loox) k = SEED.connectors.reviews ? 'reviews' : null; return k && SEED.connectors[k] ? { conn: k, name: SEED.connectors[k].name } : { conn: null, name: 'Brew' }; };
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
  const say = (t, w, m) => { const msg = { id: uid('m'), at: now(t), ...m }; if (msg.from === 'me' && !msg.by) { const p = meOf(t); if (p) { msg.by = p; JAMS.join(w, p, 'replied'); } } w.thread.push(msg); if ((msg.from === 'me' || msg.from === 'ai') && w.slack?.ts && o.slack && !msg.noMirror && msg.via !== 'slack' && !msg.learn) slackMirror(t, w, msg); if (msg.by) mailEv(t, w, { kind: 'reply', to: (w.people || []).map((x) => x.email), by: msg.by, text: msg.body, id: msg.id }); if (msg.by) w.lastBy = msg.by.email; w.updatedAt = now(t); JB?.onSay(t, w, msg); };
  const curV = (w) => w.versions.find((v) => v.n === w.current) || w.versions[w.versions.length - 1];
  const addVersion = (t, w, v) => { const n = w.versions.length + 1; w.versions.push({ n, ...v, at: now(t) }); w.current = n; w.title = v.title; if (v.images?.[0]) w.img = v.images[0]; RMX?.onWorkVersion(t, w, v); if (v.images?.[0] && v.by !== 'agent') slackAsset(t, w, { title: `v${n}: ${v.title}`, copy: v.sub, image: v.images[0], kind: 'version', note: v.note }); return n; };
  const workFor = (t, cardId) => t.work.find((w) => w.cardId === cardId && !w.archived && !w.discarded && !['out', 'measuring', 'result'].includes(w.stage));
  /* a rival's ad card's pictures are theirs: a workspace never holds them as our v1, its thumbnail or a notification's picture.
     Workspaces saved before this heal on load (getTenant); a card no longer held is known by its r-ad- id and research path */
  const theirPics = (t, cardId) => { const c = t.cards?.get?.(cardId); if (c) return isRivalCard(c) ? new Set((c.images || []).filter(Boolean)) : null; return /^r-ad-/.test(String(cardId || '')) ? { has: (u) => isResearchImage(u) } : null; };
  const healRivalWork = (t) => { let n = 0;
    for (const w of t.work || []) { const bad = theirPics(t, w.cardId); if (!bad) continue;
      for (const v of w.versions || []) if (v.images?.some((u) => bad.has(u))) { v.images = v.images.filter((u) => !bad.has(u)); if (!v.images.length) v.images = null; n++; }
      if (w.img && bad.has(w.img)) { w.img = [...(w.versions || [])].reverse().find((v) => v.images?.[0])?.images[0] || null; n++; } }
    for (const x of t.notes || []) { const bad = x.img && theirPics(t, x.cardId); if (bad && bad.has(x.img)) { x.img = (t.work || []).find((w) => w.id === x.itemId)?.img || null; n++; } }
    return n; };
  const newWork = (t, c) => { const own = isRivalCard(c) ? null : c.images?.length ? c.images : null;
    const w = { id: uid('wk'), cardId: c.id, title: c.title, img: own?.[0] || null, agent: c.agent, sector: c.sector, cta: c.cta?.label || null, stage: 'drafting',
      versions: [{ n: 1, title: c.title, sub: c.sub, images: own, by: 'agent', who: AGENT[c.agent], note: 'The original card', at: now(t) }], current: 1,
      thread: [], with: null, ticket: null, deploy: null, createdAt: now(t), updatedAt: now(t), unread: false, history: [['drafting', now(t)]], ...(c.ctxKey ? { ctxKey: c.ctxKey } : {}), ...(c.bundle?.length ? { bundle: c.bundle } : {}) };
    const me0 = meOf(t); if (me0) { w.startedBy = me0; JAMS.join(w, me0, 'started'); }
    w.cardSnap = clone(c); // a teammate's workspace may not hold this card (an idea or story made elsewhere): the jam carries it
    seedDrafts(w, c, B().firstDrafts, { uid, at: now(t) }); // a first draft Brew made before the jam opened (drafts-bg.js)
    w.cardPlan = planOfCard(c); // the card's plan is the jam's input: the case, the brief and the make step read it
    t.work.unshift(w); markActed(t, c.id); return w;
  };
  /* Slack (connectors/slack.js): a jam taken to Slack is one post in the brand's channel; what the team writes in the jam goes
     to that thread, and the thread's replies and its Approve button come back here (slackIn, from server.js /slack/events) */
  const slugOfT = (t) => t.brandId || DEFAULT_BRAND;
  const slackMirror = (t, w, msg) => { const who = msg.from === 'ai' ? null : msg.by?.name || msg.by?.email || 'Someone in Brew';
    o.slack.slackPost(slugOfT(t), { channel: w.slack.channel, thread_ts: w.slack.ts, text: who ? `*${who}* in Brew: ${String(msg.body || '').slice(0, 3000)}` : `${String(msg.body || '').slice(0, 3000)}${msg.edited?.length ? `\n_Updated in the brief: ${msg.edited.join(', ')}_` : ''}` }).then((r) => { if (r?.error) log.warn('[slack] mirror', r.error); }).catch(() => {}); };
  const slackBlocks = (t, w, text, page) => [{ type: 'section', text: { type: 'mrkdwn', text: String(text).slice(0, 2900) } },
    { type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: `Approve v${w.current}` }, action_id: 'approve', value: `${slugOfT(t)}|${w.id}|${w.current}` },
      ...(page ? [{ type: 'button', text: { type: 'plain_text', text: 'Open in Brew' }, url: page, action_id: 'open' }] : [])] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Reply in this thread: replies land in the Brew jam and its brief.' }] }];
  /* every new asset in a jam that has a Slack thread goes to that thread for review: the picture inline, a video, voice or the
     slides as a link, and Approve for the jam's current version */
  const pubUrl = (x) => { const s = String(x || ''); if (!s) return null; if (/^https:\/\//.test(s)) return s; const base = (process.env.PUBLIC_URL || 'https://brew.joinsquareup.com').replace(/\/$/, '');
    return /^https?:\/\/localhost/.test(base) ? null : `${base}/${s.replace(/^\//, '')}`; };
  /* Slack reads *bold* and • bullets, not Markdown: '### Head' and '**x**' would show as typed */
  const toMrkdwn = (md) => String(md || '').replace(/^#{1,6}\s+(.+)$/gm, '*$1*').replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^\s*[-*]\s+/gm, '• ');
  const slackAsset = (t, w, a) => {
    if (!o.slack || !w?.slack?.ts) return; const what = { image: 'image', video: 'video', voice: 'voiceover', carousel: 'carousel', text: 'copy', version: 'version' }[a.kind] || 'draft';
    const text = `*New ${what} for review:* ${a.title || w.title}${a.note ? `\n_${String(a.note).slice(0, 200)}_` : ''}`;
    const imgs = [...new Set([...(a.images || []), a.image].filter(Boolean))].map(pubUrl).filter((u) => u && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u)).slice(0, 10);
    const links = [a.video && ['Watch the video', a.video], a.audio && ['Play the voiceover', a.audio], a.zip && ['Get the slides', a.zip]].filter(Boolean).map(([l, u]) => [l, pubUrl(u)]).filter(([, u]) => u);
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `${text}${a.copy ? `\n${toMrkdwn(a.copy).slice(0, 2500)}` : ''}` } },
      ...imgs.map((u, i) => ({ type: 'image', image_url: u, alt_text: `${String(a.title || w.title).slice(0, 180)}${imgs.length > 1 ? ` ${i + 1}` : ''}` })),
      { type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: `Approve v${w.current}` }, action_id: 'approve', value: `${slugOfT(t)}|${w.id}|${w.current}` },
        ...links.map(([l, u], i) => ({ type: 'button', text: { type: 'plain_text', text: l }, url: u, action_id: `open_${i}` })),
        ...(w.slack.page ? [{ type: 'button', text: { type: 'plain_text', text: 'Open in Brew' }, url: w.slack.page, action_id: 'open' }] : [])] }];
    o.slack.slackPost(slugOfT(t), { channel: w.slack.channel, thread_ts: w.slack.ts, text, blocks }).then((r) => { if (r?.error) log.warn('[slack] asset', r.error); }).catch(() => {});
  };
  /* the studio (remix.js) made a new asset or version: it goes to the Slack thread of the jam built on that change */
  const jamOfChange = (t, ch) => [...(JAMS.peek(t.brandId || DEFAULT_BRAND)?.work || []), ...(t.ownWork || [])].find((w) => w.changeId === ch.id && w.slack?.ts) || null; /* media lands in the background: no request to tell whose list t.work is */
  const studioMedia = (t, ch, m) => { const w = jamOfChange(t, ch); if (!w) return; slackAsset(t, w, { kind: m.kind, title: `v${m.n || '?'} · ${m.label || ch.after?.title || w.title}`, images: m.images, video: m.video, copy: m.copy }); };
  /* a final made, paused or failed: a note in the bell, so the person who tapped Make the final can leave the studio */
  const studioFinal = (t, ch, r) => { const w = [...(JAMS.peek(t.brandId || DEFAULT_BRAND)?.work || []), ...(t.ownWork || [])].find((x) => x.changeId === ch.id); if (!w) return; const what = r.vid ? 'reel' : 'picture';
    notify(t, w, r.state === 'done' ? `Your final ${what} is ready` : r.state === 'checkpoint' ? `The final ${what} paused for a check` : `The final ${what} didn’t come through. Make it again.`, r.state === 'done' ? 'ready' : 'needs_you'); };
  const studioVersion = (t, ch, v, why) => { const w = jamOfChange(t, ch); if (!w || !o.slack) return;
    o.slack.slackPost(slugOfT(t), { channel: w.slack.channel, thread_ts: w.slack.ts, text: `*v${v.n} saved:* ${v.label || String(why || '').slice(0, 80)}\n${ch.after?.title ? `_${String(ch.after.title).slice(0, 200)}_` : ''}`.trim() }).catch(() => {}); };
  /* ---------- the jam's thread talks to Brew, without spending on chatter (Param's rule, 2026-10-16) ----------
     Every message from a person is sorted with one cheap text call: chat folds into the brief and nothing else; a question
     gets an answer; a change to the brief or copy is proposed (applied at once only when they wrote @Brew); anything that makes
     a new image or video is always proposed first. A proposal (w.pending) shows in Brew's jam and in the thread with
     buttons; it runs once, on whichever side says yes. */
  const PAID = new Set(['image', 'video', 'carousel']);
  const MAKE_ASK = /\b(make|create|generate|turn|redo|remake|new|another|fresh|shoot)\b[^.?!]{0,40}\b(videos?|reels?|clips?|carousels?|slides|images?|photos?|pictures?|visuals?|creatives?)\b/i;
  /* a paid make is proposed only for an ask to make one: never for a question, never for "keep the same photo" */
  const makeAsk = (text) => MAKE_ASK.test(text) && photoAsk(text) !== 'keep' && !isQuestion(text);
  const asOf = (x) => (/\b(video|reel|clip)/i.test(x) ? 'video' : /\b(carousel|slides)/i.test(x) ? 'carousel' : 'image');
  const pendText = (p) => { const what = String(p.summary || p.text || '').trim().replace(/[.\s]+$/, ''); return p.kind === 'make'
    ? `Ready to make ${p.as === 'video' ? 'a 6-second vertical video' : p.as === 'carousel' ? 'a carousel' : 'a new image'}${what ? ` (${what[0].toLowerCase() + what.slice(1)})` : ''}. It uses today’s ${p.as === 'video' ? 'video' : 'image'} allowance.`
    : `Ready to change this: ${what}.`; };
  const pendBlocks = (t, w, p, done) => [{ type: 'section', text: { type: 'mrkdwn', text: `${pendText(p)}${p.by ? `\n_Asked by ${p.by}_` : ''}` } },
    done ? { type: 'context', elements: [{ type: 'mrkdwn', text: done }] }
      : { type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: p.kind === 'make' ? 'Make it' : 'Make this change' }, action_id: 'apply', value: `${slugOfT(t)}|${w.id}|${p.id}` },
        { type: 'button', text: { type: 'plain_text', text: 'Not now' }, action_id: 'dismiss', value: `${slugOfT(t)}|${w.id}|${p.id}` }] }];
  const propose = async (t, w, p) => {
    w.pending = { id: uid('pd'), at: now(t), ...p };
    say(t, w, { from: 'ai', who: 'Brew', body: pendText(w.pending), pending: w.pending.id, noMirror: true });
    if (w.slack?.ts && o.slack) { const r = await o.slack.slackPost(slugOfT(t), { channel: w.slack.channel, thread_ts: w.slack.ts, text: pendText(w.pending), blocks: pendBlocks(t, w, w.pending) }).catch(() => null); if (r?.ts && w.pending) w.pending.slackTs = r.ts; }
    w.updatedAt = now(t); return w.pending;
  };
  /* yes or not now, from Brew's jam or the thread: it runs once */
  const applyPending = async (t, w, pid, who, go) => {
    const p = w.pending; if (!p || p.id !== pid) return { gone: true };
    w.pending = null; const name = who || 'Someone';
    const close = (line) => p.slackTs && w.slack?.ts && o.slack?.slackPost(slugOfT(t), { channel: w.slack.channel, update: p.slackTs, text: line, blocks: pendBlocks(t, w, p, line) }).catch(() => {});
    if (!go) { close(`Not now · ${name}`); say(t, w, { from: 'system', body: `${name}: not now, for “${pendText(p).slice(0, 90)}”`, noMirror: true }); return { ok: true }; }
    close(`On it · ${name} said yes`);
    let r = null;
    if (p.kind === 'change') {
      if (w.changeId && RMX) r = await RMX.iterateFromJam(t, w, p.text);
      if (!r) { const e = await JB.edit(t, w, p.text, { who: name, mode: 'ask' }); say(t, w, { from: 'ai', who: AGENT[w.agent] || 'Brew', body: e.reply || (e.changed.length ? 'Done.' : 'Nothing to change there.'), edited: e.changed }); r = { ok: true }; }
      else if (!r.error) say(t, w, { from: 'ai', who: AGENT[w.agent] || 'Brew', body: `Done: v${w.current} is ready.` });
    } else {
      if (w.changeId && RMX) r = p.as === 'image' ? RMX.photoFromJam(t, w, p.text) : await RMX.remakeFromJam(t, w, p.as);
      if (!r && DR) { DR.start(t, w, p.as, String(p.text || '').slice(0, 300)); r = { started: true }; }
      if (r && !r.error) say(t, w, { from: 'ai', who: 'Brew', body: `Making ${p.as === 'video' ? 'the video (about two minutes)' : p.as === 'carousel' ? 'the carousel' : 'the image'}. It lands here and in the thread for review.` });
    }
    if (r?.error) say(t, w, { from: 'ai', who: 'Brew', body: r.error });
    w.updatedAt = now(t); return { ok: !r?.error, error: r?.error || null };
  };
  /* one person's message in the thread: sorted, then folded, answered or proposed */
  const slackAct = async (t, w, { text, user = {}, mention = false }) => {
    let k = null;
    if (!isMock() && spend('text')) {
      const convo = (w.thread || []).filter((m) => m.from !== 'system').slice(-6).map((m) => `${m.who || (m.from === 'me' ? 'Teammate' : 'Brew')}: ${String(m.body).slice(0, 300)}`).join('\n');
      const prompt = [`A team is planning "${w.title}" for ${BN()} in a Slack thread with Brew, an AI that keeps the brief and makes the assets.`,
        `The brief now:\n---\n${String(w.doc?.md || '').slice(0, 1800)}\n---`, `The thread so far:\n${convo}`,
        `The newest message, from ${user.name || 'a teammate'}${mention ? ' (written to @Brew)' : ''}: "${String(text).slice(0, 1200)}"`,
        w.pending ? `Brew is waiting for a yes on: ${pendText(w.pending)}` : '',
        'Sort the newest message. chat: people discussing, giving opinions or agreeing among themselves. question: they ask Brew something. change: they ask for an edit to the brief, the copy or the plan. make: they ask for a new or different image, video or carousel. yes / no: a reply to Brew\'s waiting proposal. When unsure, chat.'].filter(Boolean).join('\n\n');
      try { k = await claudeTool(prompt, { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['chat', 'question', 'change', 'make', 'yes', 'no'] }, as: { type: 'string', enum: ['image', 'video', 'carousel', 'none'] }, summary: { type: 'string', description: 'For change/make: what exactly will change, in under 20 words' } } }, 300, 'slack-route'); }
      catch (e) { log.warn('[slack route]', e.message); }
    }
    const kind = k?.kind || (mention && makeAsk(text) ? 'make' : 'chat');
    if ((kind === 'yes' || kind === 'no') && w.pending) return applyPending(t, w, w.pending.id, user.name, kind === 'yes');
    if (kind === 'question') { say(t, w, { from: 'ai', who: 'Brew', body: await answerOnly(t, w, text) }); return; }
    if (kind === 'change') { const p = { kind: 'change', text, summary: k?.summary || '', by: user.name || null };
      if (mention) { w.pending = { id: uid('pd'), ...p }; return applyPending(t, w, w.pending.id, user.name, true); }
      return propose(t, w, p); }
    if (kind === 'make') return propose(t, w, { kind: 'make', as: PAID.has(k?.as) ? k.as : asOf(text), text, summary: k?.summary || '', by: user.name || null });
    /* chat: it already folded into the brief (jam-brief onSay, m.real) */
  };
  const toSlack = async (t, w, { text, page, channel }) => {
    if (!o.slack) return { error: 'Slack isn’t on here.' }; if (!reqOf(t)?.member) return { error: 'Only the brand’s team posts to its Slack.' };
    const r = await o.slack.slackPost(slugOfT(t), { channel, text, blocks: slackBlocks(t, w, text, page) }); if (r.error) return r;
    w.slack = { ts: r.ts, channel: r.channel, team: r.team, name: r.channelName || null, tid: t.id, at: now(t), page: page || null, n: w.current };
    w.slack.permalink = await o.slack.slackLink?.(slugOfT(t), r.channel, r.ts).catch(() => null) || null; return r;
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
          r = await claudeTool(`${cardBrief({ ...card, ...curV(w), agent: w.agent }, seatLine(t.viewer), t)}\n\nYou are ${who}, ${BN()}'s ${role}, replying in Slack ${w.with.channel || ''} to a colleague about this work. You care most about ${ROLE_ANGLE[id] || `getting it right for ${BN()}`}.\nThe brief now:\n"""\n${String(w.doc?.md || '').slice(0, 2500)}\n"""\nThe thread so far:\n${convo || '(nothing yet)'}\n\nTheir latest message: "${last}"\n\nReply like a busy, friendly teammate: 1 to 3 short sentences, plain words, no greetings. Answer exactly what they asked, from your role, with one concrete point taken from the brief or the card (a number, a condition, a risk). Never invent numbers. Then decide the verdict: "approve" only if they asked for a sign-off and nothing in your area blocks it (if you already raised a point and they answered it, approve); "question" if you need one thing answered first; "changes" if something must change; "answer" if they asked a question that is not a sign-off.`,
            { type: 'object', required: ['reply', 'verdict'], properties: { reply: { type: 'string', description: '1 to 3 short sentences, in character' }, verdict: { type: 'string', description: 'approve, question, changes or answer' } } }, 700, 'colleague');
          if (r?.reply) r = { reply: checkCopy(clean(r.reply), packSource(packFor(t), t.cards.get(w.cardId))).text || clean(r.reply).replace(/[^.!?]*$/, ''), verdict: String(r.verdict || '').toLowerCase() }; else r = null; /* a Slack reply carries no claim the store doesn't back (1.5) */
          if (r && !r.reply.trim()) r = null;
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
  /* the card's proof as the shield shows it (refined against the claim): one answer for "what's the evidence?" in the card chat, the jam room and the studio (final QA pass 19 Oct, FEED-ARV-01) */
  const proofOfCard = (t, c0) => { if (!c0) return null; const c1 = fillCard(c0, t), vo = voiceOf(slugOfT(t)); return refineProof(c1, EV.evidenceOf({ ...c1, brand: BN() }, { liveLedger: t.member ? t.liveLedger : null, facts: t.member ? packFor(t)?.facts : null, plain: PLAIN.get(slugOfT(t), c0), voice: vo, team: toldSeen(t) }), { voice: vo, connected: (id) => connOn(t, id), has: (id) => !!SEED?.connectors?.[id] }); };
  const proofSay = (t, cid) => { const rp = proofOfCard(t, t.cards.get(cid)), pa = proofAnswer(rp); return pa ? [pa.text, rp?.claim?.note].filter(Boolean).join('\n') : null; };
  const answerOnly = async (t, w, body) => {
    /* grounded and checked (jam-answer.js): numbers and performance claims only where the card and the facts hold them */
    if (EVIDENCE_ASK.test(body)) { const pa = proofSay(t, w.cardId); if (pa) return pa; } /* "what's the evidence?": the card's own proof */
    if (!isMock() && spend('text')) { try { const acct = acctRows(t).filter((e) => e.label && e.v != null).slice(0, 24); // DUMMY: simulated accounts are never quoted
      const j = await answerGrounded({ ai: (pr, sc, mx, tag) => claudeTool(pr, sc, mx, tag), question: body, who: AGENT[w.agent] || 'Brew',
        evidence: `${cardBrief({ ...(t.cards.get(w.cardId) || {}), ...curV(w), agent: w.agent }, seatLine(t.viewer), t)}${acct.length ? `\n\nConnected accounts:\n${acct.map((e) => `- ${e.label}: ${e.v}`).join('\n')}` : '\n\nConnected accounts: none with results for this yet.'}` });
      if (j.answer) return clean(j.answer); } catch (e) { log.warn('[answer]', e.message); if (e.billing) return 'I can’t answer right now: Brew’s writing is paused for a while. Your question stays here in the jam; ask again later, or tag a teammate.'; } }
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

  /* a photo on a jam: drafts use it as the product shot (the jam's reference, Drop anything "just this once", an ask's photo) */
  const addReference = (t, w, rel, name) => { const c = t.cards.get(w.cardId); w.refImages = [rel, ...(w.refImages || []).filter((x) => x !== rel)].slice(0, 4); if (c) c.refImages = w.refImages;
    say(t, w, { from: 'system', body: `Added a photo${name ? ` (${String(name).slice(0, 60)})` : ''}. Drafts use it as the product shot.` }); store?.save(t); };
  const setupOn = () => {
    // sending setup: the sender, the brand's own customers, WhatsApp on their number
    // a photo added in the jam: the product shot drafts are made from
    on('POST', '/api/work/:wid/reference', async (b, t, p) => { const w = actWork(t, p); if (!w) return { error: 'not found' };
      const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/.exec(String(b.data || '')); if (!m) return { error: 'Add a PNG, JPG or WebP photo.' };
      const buf = Buffer.from(m[3], 'base64'); if (buf.length > 8e6) return { error: 'That photo is over 8 MB.' };
      const name = `ref-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${m[2] === 'jpeg' ? 'jpg' : m[2]}`; saveGen(name, buf);
      addReference(t, w, `gen/${name}`, b.name); return { work: w }; });
    // knobs on every jam: a jam on a card that has a remix recipe gets its change package (the knobs and versions read it)
    /* fast: the package is made from the card at once and its copy is written in the background (remix.js fillLater) */
    /* a batch card's jam is its N finished ads (remix.js batch), never one package made from its first picture */
    linkChange = async (t, w) => { if (w.changeId || !w.cardId || !t.cards.get(w.cardId) || isBatchCard(t.cards.get(w.cardId))) return { work: w };
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
    if (b.viewer) { t.viewer = { ...t.viewer, ...cleanViewer(b.viewer, { tools: Object.keys(SEED.connectors || {}) }) }; clampSeat(t); } /* setup answers are whitelisted: channels, adPace, perDay, tools, teamSize, voice */
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
  /* the first feed of a new visit: the free watchers look first (a few seconds at most), so a return opens on today's cards, not
     yesterday's. newIds: cards made since the last visit that this person had not seen before this visit began */
  /* the weekly AI answers check (live-watch.js), as who is named for which question; the client shows it when newer than the read's */
  const aiRingWeekly = () => { try { const cfg = B()?.config || {}; return aiRingFromRun(live?.get()?.visibility?.runs?.[0], { questions: cfg.questions || [], rivals: cfg.rivalsAI || cfg.rivals || (B()?.profile?.rivals || []).map((r) => r?.name), brand: BN() }); } catch (e) { log.warn('[ai-ring]', e.message); return null; } };
  /* the AI answers card's proof (Param, 19 Oct: "how do I know which questions were asked? why should I trust you?"): how Brew
     asked, each question with why it is there (real searches, Google's suggestions, a real thread, a best seller: ai-questions.js),
     and every tool's own answer with the brands it named and its sources. src: the same set the card shows (weekly or read) */
  const AI_TOOL = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude', 'chat-gpt': 'ChatGPT' };
  const toolName = (x) => AI_TOOL[String(x || '').toLowerCase()] || String(x || 'AI tool');
  const ansText = (x) => String(x || '').replace(/(?:\s*:?-{3,}:?)+/g, ' ').replace(/\s{2,}/g, ' ').trim(); /* table rules from the answers' markdown */
  const domOf = (u) => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
  on('GET', '/api/tenants/:id/ai-answers', async (b, t, p, q) => {
    const slug = slugOfT(t), cfg = B()?.config || {}, src = q?.get?.('src') === 'read' ? 'read' : 'weekly', run = live?.get()?.visibility?.runs?.[0] || null;
    const qMeta = new Map((cfg.questions || []).map((x) => [x.q, x]));
    let qs = [], at = null, tools = [];
    if (src === 'weekly' && run && (run.qs || !(cfg.questions || []).some((x) => x?.why))) {
      const list = run.qs || cfg.questions || []; at = run.at;
      qs = list.map((x) => ({ q: x.q, branded: x.branded ?? null, why: x.why || qMeta.get(x.q)?.why || null, team: x.why?.kind === 'team',
        answers: run.answers.filter((a) => a.q === x.id).map((a) => ({ tool: toolName(a.engine), named: !!a.named, rivals: a.rivals || [], brands: (a.brands || []).slice(0, 12), text: ansText(a.text || [a.said, a.excerpt].filter(Boolean).join(' ')), full: !!a.text, sources: [...new Set((a.sources?.length ? a.sources : a.domains || []).map(domOf))].slice(0, 6) })) }));
      tools = [...new Set(run.answers.map((a) => toolName(a.engine)))];
    } else {
      const prof = await GP.getJSON(slug, 'profile.json', {}).catch(() => ({})), ans = prof?.ai?.answers || [];
      at = ans.map((a) => a.at).filter(Boolean).sort().pop() || null;
      qs = [...new Set(ans.map((a) => a.q))].map((qq) => ({ q: qq, branded: !!ans.find((a) => a.q === qq)?.branded, why: qMeta.get(qq)?.why || null,
        answers: ans.filter((a) => a.q === qq).map((a) => ({ tool: toolName(a.tool), named: !!a.named, rivals: a.rivalsNamed || [], brands: (a.brandsNamed || a.entities || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean).slice(0, 12), text: ansText(String(a.text || '').slice(0, 3000)), full: true, sources: [...new Set((a.sources || []).map((x) => domOf(typeof x === 'string' ? x : x?.url)))].filter(Boolean).slice(0, 6) })) }));
      tools = [...new Set(ans.map((a) => toolName(a.tool)))];
    }
    const sourced = qs.filter((x) => x.why && x.why.kind !== 'none' && x.why.kind !== 'team').length;
    const r = reqOf(t);
    return { ai: { src, at, brand: BN(), country: cfg.countryName || CTRY(), tools, questions: qs, sourced, pending: (cfg.questions || []).some((x) => x?.why) && !qs.some((x) => x.why),
      method: cfg.questionsMethod ? { at: cfg.questionsMethod.at, candidates: cfg.questionsMethod.candidates, errors: cfg.questionsMethod.errors || [] } : null,
      canAdd: !!(r?.member || meOf(t)?.staff) && process.env.DEMO_MODE !== '1', teamLeft: Math.max(0, 3 - (cfg.questions || []).filter((x) => x?.why?.kind === 'team').length) } };
  });
  /* "Add a question your customers ask": kept with the brand's set (up to 3, through every re-source) and asked now on every tool */
  on('POST', '/api/tenants/:id/ai-questions', async (b, t) => {
    const r = reqOf(t), me0 = meOf(t); if (!(r?.member || me0?.staff) || process.env.DEMO_MODE === '1') return { status: 403, error: 'Sign in as part of the team to add a question.' };
    const text = clean(String(b.q || '')).replace(/\s+/g, ' ').trim().slice(0, 160); if (text.length < 8) return { error: 'Type the question the way a customer would ask it.' };
    const slug = slugOfT(t), c = (await GP.getJSON(slug, 'config.json', {})) || {}, qs = c.questions || [];
    if (qs.some((x) => String(x.q).toLowerCase() === text.toLowerCase())) return { error: 'That question is already asked.' };
    const team = qs.filter((x) => x?.why?.kind === 'team'); if (team.length >= 3) return { error: 'Your team has added 3 questions. Remove one to add another.' };
    const who = me0?.name || me0?.email || 'your team', qn = { id: `t${Date.now().toString(36)}`, q: text, branded: new RegExp(`\\b${BN().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text), why: { kind: 'team', label: `Added by ${who}: a question your customers ask`, at: new Date().toISOString() } };
    await GP.put(slug, 'config.json', { ...c, questions: [...qs, qn] });
    if (B()?.config) B().config.questions = [...(B().config.questions || []), qn]; /* the pack in memory too, so the card and the next run see it */
    if (typeof live?.askOne !== 'function' || isMock()) return { ok: true, asked: false, note: 'Brew asks it in the next weekly check.' };
    live.askOne(qn).then((x) => log.log?.(`[ai-questions] ${slug} asked "${text}" on ${x.asked} tools`)).catch((e) => log.warn('[ai-questions] ask', slug, e.message));
    return { ok: true, asked: true, note: 'Brew is asking ChatGPT, Gemini and Perplexity now. The answers land here in a minute or two.' };
  });
  const newIdsOf = (t, order) => { const v = t.visit; if (!v?.prev) return []; const began = v.at || now(t);
    return order.filter((id) => { const c = t.cards.get(id); return c && !c.parentCardId && c.origin !== 'user' && c.state !== 'done' && c.createdAt > v.prev && !(t.shown[id] || []).some((x) => x < began); }); };
  /* "Yesterday" at the end of the feed (QA FEED-15): the cards this person saw or acted on the day before, newest first, from what the
     workspace already keeps (impressions, feedback, the cards they worked on). The page folds it by default */
  const DID = { heart: 'You liked it', save: 'You saved it', not_interested: 'You hid it', snooze: 'You put it off', fewer: 'You asked for fewer' };
  const yesterdayOf = (t) => { const n = now(t), y = dayKey(n - D), last = new Map(), did = new Map(), seen = (id, x) => last.set(id, Math.max(last.get(id) || 0, x));
    for (const [id, ts] of Object.entries(t.shown || {})) for (const x of ts || []) if (dayKey(x) === y) seen(id, x);
    for (const f of t.feedback || []) if (f?.cardId && f.at && dayKey(f.at) === y) { seen(f.cardId, f.at); if (DID[f.kind]) did.set(f.cardId, DID[f.kind]); }
    for (const [id, x] of Object.entries(t.actedAt || {})) if (x && dayKey(x) === y) { seen(id, x); if (!did.has(id)) did.set(id, 'You worked on it'); }
    const slug = slugOfT(t);
    return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => t.cards.get(id)).filter((c) => c?.title && seatOk(t, c) && !c.parentCardId).slice(0, 12)
      .map((c) => ({ id: c.id, title: (process.env.PLAIN_OFF === '1' ? c : PLAIN.apply(slug, c)).title, did: did.get(c.id) || 'You saw it' })); };
  /* the feed is built from cards that change a few times an hour: the same viewer asking again within 20 s, with nothing changed in
     the workspace since, gets the answer it just had (1.7: a fresh load spent 3.7 s on this call, a tab switch as long again) */
  const FEED_C = new Map(), STATE_SIG = new WeakMap(); /* the last saved state each workspace sent (kept in memory only) */
  on('GET', '/api/tenants/:id/feed', async (b, t) => { try { bookText(t); } catch {} /* warms the Brand Book for the jams opened from this feed */ const who = `${t.id}|${t.rev || 0}|${t.member ? 1 : 0}|${storefrontOn() ? 1 : 0}|${t.viewer?.role || ''}`, ck = `${who}|${t.cards.size}`, hit = FEED_C.get(t.id);
    const store = (v) => { if (!v?.error) { FEED_C.set(t.id, { k: ck, who, at: Date.now(), v }); if (FEED_C.size > 400) FEED_C.delete(FEED_C.keys().next().value); } return v; };
    if (hit && hit.k === ck && Date.now() - hit.at < 20e3) return hit.v;
    /* the same viewer, nothing they did since (rev): the last answer goes back at once and a fresh one is built behind, so a page load
       never waits on background cards (watchers, connector reads) arriving; anything the viewer changed is built fresh (1.7) */
    if (hit && hit.who === who && Date.now() - hit.at < 5 * 60e3) { if (!hit.busy) { hit.busy = true; /* after the page's own first calls (state, live, work), so the rebuild never holds them up */
      setTimeout(() => feedRoute(b, t).then(store).catch(() => {}).finally(() => { hit.busy = false; }), 4000); } return hit.v; }
    if (hit) log.log?.(`[feed] ${t.brandId || ''} built fresh: ${hit.who !== who ? `was ${hit.who.split('|').slice(1).join('|')} now ${who.split('|').slice(1).join('|')}` : `${Math.round((Date.now() - hit.at) / 1e3)} s old`}`); /* why a reload waited (1.7) */
    return store(await feedRoute(b, t)); });
  const feedRoute = async (b, t) => { repairHeartKids(t); syncBatches(t); if (B().kind === 'generated') streamSync(t, SEED.posts);
    if (t.visit && t.feedVisit !== t.visit.at) { t.feedVisit = t.visit.at; if (t.onboarding.readyAt && !t.freeRun) { t.freeRun = true; await runFree(t, 'visit', +process.env.VISIT_WAIT_MS || 600).finally(() => { setTimeout(() => { t.freeRun = false; }, 30e3).unref?.(); }); } } /* one visit run at a time: the one still running after the wait finishes first */ /* the free watchers get a moment; what they find later lands on the next refresh, never holding the page */
    await PLAIN.load(slugOfT(t)).catch(() => {}); if (t.member) await PLAIN.load(slugOfT(t), true).catch(() => {}); /* the team's private cards' rewrites */
    const f = feed(t); if (process.env.PLAIN_OFF !== '1' && !demoReq()) PLAIN.queue(slugOfT(t), f.order.map((id) => t.cards.get(id)).filter(Boolean), BN()); /* cards still in their first words get plain ones in the background */
    oneTitles(t);
    return { ...f, newIds: newIdsOf(t, f.order), saved: [...savedOf(t)], cards: allCards(t), withTeam: withTeam(t.work.filter((w) => shown0(w) && guestSees(t)(w))), batches: t.batches, health: t.health, healthLive: t.member ? healthReadings(t.liveLedger) : {}, aiRing: aiRingWeekly(), decided: t.decided || {}, yesterday: yesterdayOf(t), clock: now(t) }; };
  /* the product shelf (3.3): every product the store sells, best sellers first (Shopify units for the team, else the store's own
     order), each with the pictures, videos and drafts Brew made for it in the team's jams and where each one stands */
  on('GET', '/api/tenants/:id/shelf', async (b, t) => {
    const cat = (brandOfT(t)?.catalog || []).slice(0, 60), units = unitsOf(t), by = new Map(cat.map((x) => [x.t, { ...x, units: units.get(String(x.t).trim().toLowerCase()) || null, assets: [] }]));
    const stateOf = (ch, v) => (ch.lastFinal?.versionId === v.id || /^Final/.test(v.label || '') ? 'final' : (t.work || []).some((w) => w.changeId === ch.id && w.jamBrief?.frozen) ? 'in a brief' : 'draft');
    for (const ch of Object.values(t.changes || {})) { const c = t.cards.get(ch.cardId) || {}; let pr = null; try { pr = cardProduct(c, cat, { brand: BN() }); } catch {} const row = pr && by.get(pr.t); if (!row) continue;
      for (const v of (ch.versions || []).slice(-6)) { const sn = v.snapshot || {}, img = sn.image || sn.draft?.images?.[0] || v.studio?.file || null, vid = sn.video || null; if (!img && !vid) continue;
        row.assets.push({ img, video: vid, label: ch.actionLabel || ch.familyName || 'Draft', v: v.n || null, state: stateOf(ch, v), changeId: ch.id, cardId: ch.cardId, at: v.at || 0 }); } }
    /* each jam's own picture, as the Work board shows it (a Studio take, a final, the photo it started from) */
    for (const w of t.work || []) { if (!w || w.archived || w.discarded || !w.img || /^research\//.test(w.img)) continue; const c = t.cards.get(w.cardId) || { title: w.title };
      let pr = null; try { pr = cardProduct({ ...c, title: `${w.title || ''} ${c.title || ''}` }, cat, { brand: BN() }); } catch {} const row = pr && by.get(pr.t); if (!row || row.assets.some((a) => a.img === w.img)) continue;
      row.assets.push({ img: /^(https?:|\/)/.test(w.img) ? w.img : `/${w.img}`, label: w.title || 'Jam', state: /^gen\/fin-/.test(w.img) ? 'final' : w.jamBrief?.frozen || w.stage === 'team' ? 'in a brief' : 'draft', cardId: w.cardId, changeId: w.changeId || null, at: w.updatedAt || 0 }); }
    for (const c of t.cards.values()) { const d = draftFor(c, B()?.firstDrafts); const img = d?.images?.[0]; if (!img) continue; let pr = null; try { pr = cardProduct(c, cat, { brand: BN() }); } catch {} const row = pr && by.get(pr.t); if (row && !row.assets.some((a) => a.img === img)) row.assets.push({ img, label: 'First draft', state: 'draft', cardId: c.id, at: c.createdAt || 0 }); }
    const { sorted, said } = salesRank([...by.values()].map((x) => ({ ...x, title: x.t })), t);
    return { products: sorted.map((x) => ({ name: x.t, img: x.img, price: x.price || null, out: !!x.out, url: x.url || null, units: x.units, assets: x.assets.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 12) })), order: said };
  });
  /* rivals (3.5): every rival ad Brew read, filterable by rival, and a page per rival: its live ads, its prices from the read and
     how often AI answers name it. A rival whose ads couldn't be read says so (brew-external-data rule 1) */
  on('GET', '/api/tenants/:id/rivals', async (b, t) => {
    const R = research?.get() || {}, ads = resAll(R.ads).filter((a) => a && a.brand), prof = brandOfT(t)?.seed?.brand || {}, p0 = B()?.profile || null;
    const rivals = [...new Set([...(R.ads?.brands || []).map((x) => x.name), ...ads.map((a) => a.brand)])].filter((n) => n && n !== BN());
    const read = (p0?.rivals || brandOfT(t)?.rivals || []), aiNamed = (n) => { try { const st = B()?.aiStanding?.rivals || []; const x = st.find((y) => y.name === n); return x ? x.share ?? x.n ?? null : null; } catch { return null; } };
    return { rivals: rivals.map((n) => { const meta = (R.ads?.brands || []).find((x) => x.name === n) || {}, r = read.find((x) => x.name === n) || {};
      return { name: n, live: meta.live ?? null, page: meta.page || null, error: meta.error || r.error || null, avatar: meta.avatar || null, host: r.host || null, prices: (r.prices || []).slice(0, 6), ai: aiNamed(n),
        ads: ads.filter((a) => a.brand === n).slice(0, 24).map((a) => ({ id: a.id, poster: a.poster, video: a.video, format: a.format, title: a.title, hook: a.hook, angle: a.angle, why: a.why, days: a.days, versions: a.versions, url: a.url })) }; }),
      at: R.ads?.fetchedAt || null, brand: prof.name || BN() };
  });
  on('GET', '/api/tenants/:id/deck', async (b, t) => {
    /* the deck holds exactly the feed's cards, each once (1.13: its columns summed 123 while the feed showed 117): the same order
       the feed serves, and no Storefront column while Storefront is off */
    const { scores } = rank(t), list = [...new Set(feed(t).order)].map((id) => t.cards.get(id)).filter(Boolean);
    const cols = {}; ['signals', 'catalog', 'creatives', 'ads', ...(storefrontOn() ? ['storefront'] : []), 'visibility'].forEach((k) => (cols[k] = list.filter((c) => sectorOf(c) === k).map((c) => c.id)));
    return { columns: cols, counts: Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.length])), layout: t.deck, cards: allCards(t, list.map((c) => c.id)), scores };
  });
  /* Your feed (UI2 Memory): agent weights (less | normal | more), topics, notes, and what Brew picked up from your choices */
  const tuningOut = async (t) => { const slug = t.brandId || DEFAULT_BRAND, tu = await TUNE.get(slug, tuneKey(t));
    return { tuning: tu, agents: TUNE_AGENTS.map((a) => ({ id: a, name: AGENT[a], weight: tu.weights[a] })), weights: Object.keys(TUNE_WEIGHT), signals: learnedSignals({ feedback: t.feedback, cards: t.cards, fewer: t.fewer, ignored: tu.ignored, saved: tu.saved?.length ? tu.saved : null }), mine: !!reqOf(t)?.member }; };
  on('GET', '/api/tenants/:id/tuning', async (b, t) => tuningOut(t));
  /* the setup answers (v1's questions: seat, what comes first, channels), kept per signed-in person per brand, so a new browser,
     a private window or a teammate's phone never asks them again. Signed out: nothing kept here (the browser keeps its own) */
  const setupKey = (t) => { const r = MC.REQ.getStore(), e = r && r.slug === (t.brandId || DEFAULT_BRAND) ? r.me : null; return e ? memberKey(e) : null; };
  on('GET', '/api/tenants/:id/setup', async (b, t) => { const k = setupKey(t); return { setup: k ? (await TUNE.get(t.brandId || DEFAULT_BRAND, k)).setup || null : null, kept: !!k }; });
  on('PUT', '/api/tenants/:id/setup', async (b, t) => { const k = setupKey(t); if (!k) return { setup: null, kept: false };
    const x = await TUNE.setSetup(t.brandId || DEFAULT_BRAND, k, { ...cleanViewer(b, { tools: Object.keys(SEED.connectors || {}) }), role: SEED.roles?.[b.role] ? b.role : undefined, wants: Array.isArray(b.wants) ? b.wants.filter((w) => SEED.wants?.[w]).slice(0, 2) : undefined, done: !!b.done });
    return { setup: x.setup, kept: true }; });
  on('PUT', '/api/tenants/:id/tuning', async (b, t) => { await TUNE.put(t.brandId || DEFAULT_BRAND, tuneKey(t), { weights: b.weights, topics: b.topics }); return tuningOut(t); });
  on('DELETE', '/api/tenants/:id/tuning/signals/:sid', async (b, t, p) => { await TUNE.ignore(t.brandId || DEFAULT_BRAND, tuneKey(t), decodeURIComponent(p.sid)); return tuningOut(t); });
  on('POST', '/api/tenants/:id/tuning/signals/:sid/restore', async (b, t, p) => { await TUNE.unignore(t.brandId || DEFAULT_BRAND, tuneKey(t), decodeURIComponent(p.sid)); return tuningOut(t); });
  on('DELETE', '/api/tenants/:id/tuning/notes/:nid', async (b, t, p) => { await TUNE.dropNote(t.brandId || DEFAULT_BRAND, tuneKey(t), p.nid); return tuningOut(t); });
  /* the voice the team picked in setup: one keyed brand-memory fact (voice.pick), so a new pick replaces the old and every draft
     writer reads it (brand-memory.js puts it first in every prompt block). The team only, like the brand memory itself */
  on('POST', '/api/brands/:slug/voice', async (b, t, p) => {
    const slug = t.brandId || DEFAULT_BRAND; if (p.slug !== slug) return { status: 400, error: 'This workspace is for another brand.' };
    const x = await saveVoicePick(o.memory, slug, b.voice, { who: reqOf(t), demo: process.env.DEMO_MODE === '1' });
    if (x.ok) t.viewer = { ...t.viewer, voice: x.voice };
    return x;
  });
  /* Drop anything here, step 1: what one file says (drop-read.js: PDFs and photos read by Gemini, Word, PowerPoint and Excel
     unzipped here, text as it is). A photo or MP4 dropped for the brand also joins its References, which the generators work
     from (the team only, like the References page). The text comes back to the sheet, which sends it on with step 2 */
  const teamNo = (t, what) => { const r = reqOf(t); return r?.member || process.env.DEMO_MODE === '1' ? null : { status: r?.email ? 403 : 401, error: `Only this brand’s team can ${what}.`, team: true }; };
  mountBrandBook({ on, BOOK, GP, reqOf, meOf, factsOf: (t) => packFor(t)?.facts || null, isMock, spend: (k) => spend(k), ai: o.ai, builder, refreshPack: async (slug) => builder?.refreshPack?.(slug), render: (u) => fetcherWith(o.treg)(u).then((r) => r.html), log, DEFAULT_BRAND });
  on('POST', '/api/brands/:slug/drop/read', async (b, t, p) => {
    const slug = t.brandId || DEFAULT_BRAND; if (p.slug !== slug) return { status: 400, error: 'This workspace is for another brand.' };
    const forBrand = b.dest === 'memory'; if (forBrand) { const no = teamNo(t, 'add to its memory'); if (no) return no; }
    if (/\.mp4$/i.test(String(b.name || '')) || /^data:video\/mp4/.test(String(b.data || ''))) { if (!forBrand) return { error: 'Videos go to the brand’s References: pick Add to brand memory.' };
      const x = await REFS.add(slug, { data: b.data, label: b.name, job: 'style', by: meOf(t)?.email || null }); return x.error ? x : { ok: true, kind: 'video', text: '', ref: { id: x.item?.id, same: !!x.same } }; }
    const paid = ['pdf', 'image'].includes(dropKind(b.name, b.type)), ai = paid && !isMock() && spend('text') ? o.ai : null;
    /* the same file again (a second try, a cancelled draft) is not read or paid for twice: its words are kept per brand by its hash */
    const key = paid ? crypto.createHash('sha256').update(String(b.data || '')).digest('hex').slice(0, 24) : null, cacheF = key ? `private/drop-reads/${key}.json` : null;
    const hit = cacheF ? await Promise.resolve().then(() => GP.getJSON(slug, cacheF, null)).catch(() => null) : null; /* GP: the brand-file store; a cache that can't be read is just a miss */
    if (hit?.text && !(forBrand && dropKind(b.name, b.type) === 'image')) return { ok: true, kind: hit.kind, text: hit.text, chars: hit.chars, cut: !!hit.cut, usd: 0, ref: null, cached: true };
    const f = await readDrop(b, { ai }).catch((e) => { log.warn?.('[drop] read', slug, e.message); return { error: `Brew couldn’t read ${String(b.name || 'that file').slice(0, 80)}. Try again, or drop it as a PDF.` }; });
    if (f.error) return f;
    if (cacheF && f.text && f.chars > 200) await Promise.resolve().then(() => GP.put(slug, cacheF, { kind: f.kind, text: f.text, chars: f.chars, cut: f.cut, name: String(b.name || '').slice(0, 120), at: Date.now() })).catch((e) => log.warn?.('[drop] cache', e.message));
    let ref = null;
    if (forBrand && f.image) { const x = await REFS.add(slug, { data: `data:${f.image.ext === 'jpg' ? 'image/jpeg' : `image/${f.image.ext}`};base64,${f.image.buf.toString('base64')}`, label: b.name, job: f.image.job, keep: f.image.shows, by: meOf(t)?.email || null }).catch((e) => ({ error: e.message }));
      ref = x.error ? { error: x.error } : { id: x.item?.id, same: !!x.same }; }
    return { ok: true, kind: f.kind, text: f.text, chars: f.chars, cut: f.cut, usd: f.usd, ref };
  });
  /* Drop anything here, step 2 for the brand: the learnings draft the sheet shows (brand-learnings.js), then its answer: "save"
     (the brief, Brew's memory, the moves it changes and the feed), "drop 2 5", "go ahead" / "just the top ones", or "cancel" */
  const draftOut = (d) => d ? { kind: d.kind, label: d.label, chars: d.chars || 0, items: (d.items || []).map((x) => ({ kind: x.kind, text: x.text, quote: String(x.quote || '').slice(0, 220) })), again: d.again || 0, clipped: d.clipped || 0, replace: !!d.replace,
    conflicts: (d.conflicts || []).slice(0, 6).map((c) => ({ says: c.conflictSays || c.text, label: c.fact?.label || '', v: c.fact?.v ?? '', src: c.fact?.src || '' })) } : null;
  /* what the save changed, for the sheet's result view: the brief, the moves (rewriting now, waiting for the weekly run, new) and the feed */
  const titleOf = (n) => { const m = B()?.moveDocs?.[n] || B()?.moveDocs?.[String(n)]; return m?.title ? String(m.title).slice(0, 90) : null; };
  const changedOut = (x) => x.applied ? { learned: x.applied.length, again: x.again || 0, conflicts: (x.conflicts || []).length,
    rewrite: (x.moves?.rewrite?.ns || []).map((n) => ({ n, title: titleOf(n) })), queued: !!x.moves?.rewrite?.queued, rewriteError: x.moves?.rewrite?.error || (x.moves?.rewrite?.off ? 'AI is off here' : null),
    weekly: (x.moves?.weekly || []).map((w) => ({ n: w.n, title: titleOf(w.n) })), fresh: x.moves?.learn?.n || 0, freshWhy: x.moves?.learn?.why?.length ? 'waits for this week’s budget' : null,
    add: (x.cards?.add || []).map((c) => c.title), up: (x.cards?.up || []).map((c) => ({ title: c.title, why: c.why })), hide: (x.cards?.hide || []).map((c) => ({ title: c.title, why: c.why })) } : null;
  const learnOut = (x) => ({ ok: true, reply: x.reply, draft: x.d ? draftOut(x.d) : null, saved: !!x.saved || !!x.applied, cancelled: !!x.cancelled, n: x.applied?.length ?? null, changed: changedOut(x),
    pending: x.moves?.pending ? { all: x.moves.pending.ns.length, top: x.moves.pending.top.length } : null });
  on('POST', '/api/brands/:slug/learnings/answer', async (b, t, p) => {
    const slug = t.brandId || DEFAULT_BRAND; if (p.slug !== slug) return { status: 400, error: 'This workspace is for another brand.' };
    const r = reqOf(t), no = learnGate({ member: !!r?.member, demoSite: process.env.DEMO_MODE === '1', name: BN() }); if (no) return { error: no, team: true };
    if (!o.learnings) return { error: 'Brand learnings are off here.' };
    const text = String(b.text || '').trim().slice(0, 400); if (!text) return { error: 'Say save, cancel, or which lines to drop.' };
    const x = (await o.learnings.review(slug, text)) || (await o.learnings.confirm(slug, text));
    return x ? learnOut(x) : { error: 'There is nothing waiting to save. Drop the file again.' };
  });
  /* Drop anything here (drop.js): memory (the brand's memory), prefs (my preferences), once (this jam, or the next ask) */
  on('POST', '/api/brands/:slug/drop', async (b, t, p) => {
    const slug = t.brandId || DEFAULT_BRAND; if (p.slug !== slug) return { status: 400, error: 'This workspace is for another brand.' };
    const dest = DESTS.includes(b.dest) ? b.dest : null; if (!dest) return { error: 'Pick where it goes: brand memory, my preferences, just this once, or References.' };
    /* the brand's memory, from the team on the live site: brand learnings, so it reaches the brief, the moves and the feed, after
       the team checks the draft. The demo site (and a server without learnings) keeps the direct memory note below */
    if (dest === 'memory' && !b.data && o.learnings && process.env.DEMO_MODE !== '1') {
      const r0 = reqOf(t), no = learnGate({ member: !!r0?.member, demoSite: false, name: BN() }); if (no) return { status: r0?.email ? 403 : 401, error: no, team: true };
      const text = String(b.text || '').replace(/\r/g, '').trim(); if (text.length < 4) return { error: 'Nothing in it to read.' };
      const by = r0.name || r0.email || 'the team', byShort = r0.name ? String(r0.name).split(/\s+/)[0] : r0.email || '';
      const x = await o.learnings.run(slug, { text, by, byShort, why: 'drop', kind: 'Upload', files: (Array.isArray(b.files) ? b.files : [b.name]).map(String).filter(Boolean) });
      return { ...learnOut(x), dest, learn: true, dup: !!x.dup && !x.draft };
    }
    /* References: the file itself, for the generators (references.js); label + job + keep ride in the body. The team only */
    if (dest === 'references') { const r0 = reqOf(t); if (!(r0?.member || process.env.DEMO_MODE === '1')) return { status: r0?.email ? 403 : 401, error: 'Only this brand’s team adds References.', team: true };
      const x = await REFS.add(slug, { data: b.data, label: b.label || b.name, job: b.job, keep: b.keep, product: b.product, by: meOf(t)?.email || null }); return x.error ? x : { ok: true, dest, item: x.item, same: !!x.same }; }
    const f = parseDrop(b); if (f.error) return f;
    const r = reqOf(t), me0 = meOf(t), mk = r?.member && r.email ? memberKey(r.email) : null;
    const rel = f.kind === 'image' ? (saveGen(f.file, f.buf), `gen/${f.file}`) : null;
    const label = f.kind === 'image' ? `Photo${f.name ? ` “${f.name}”` : ''}${f.caption ? `: ${f.caption}` : ''} (/${rel})` : f.text;
    if (dest === 'memory') {
      if (!(r?.member || process.env.DEMO_MODE === '1')) return { status: r?.email ? 403 : 401, error: 'Only this brand’s team can add to its memory.', team: true };
      if (!o.memory) return { error: 'Brand memory is off here.', off: true };
      const by = mk ? `team member ${mk}` : 'a teammate', source = { kind: 'drop', label: `dropped into Brew by ${by}`, ...(rel ? { ref: `/${rel}` } : {}) };
      const x = f.kind === 'image' ? await o.memory.add(slug, `Reference photo from the team${f.name ? `, “${f.name}”` : ''}${f.caption ? `: ${f.caption}` : ''}. File: /${rel}`, { scope: 'brand', topic: 'creative-style', infer: false, source, by })
        : await o.memory.add(slug, f.text, { scope: 'brand', memberId: mk, source, by });
      return { ok: true, dest, added: x.added, updated: x.updated, confirmed: x.same?.length || 0, cut: !!f.cut, file: rel };
    }
    if (dest === 'prefs') {
      let sides = null; if (f.kind === 'text' && !isMock() && spend('text')) sides = await claudeTool(prefPrompt(f.text), PREF_SCHEMA, 600, 'pref-sides').catch((e) => { log.warn?.('[drop] prefs', e.message); return null; });
      const tu = await TUNE.addNote(slug, tuneKey(t), label, { source: 'Dropped into Brew', sides });
      if (o.memory && mk && f.kind === 'text') await o.memory.add(slug, f.text, { scope: 'member', memberId: mk, source: { kind: 'drop', label: `my preferences, dropped by team member ${mk}` }, by: `team member ${mk}` }).catch((e) => log.warn?.('[drop] prefs memory', e.message));
      return { ok: true, dest, note: tu.notes[0], cut: !!f.cut, file: rel };
    }
    /* once: a named jam takes the photo or the words now (the reference path) */
    const w = b.wid ? W(t, String(b.wid)) : null; if (b.wid && !w) return { error: 'not found' };
    if (w && f.kind === 'image') { addReference(t, w, rel, f.name); return { ok: true, dest, work: w, file: rel }; }
    if (w) { say(t, w, { from: 'me', body: f.text }); return { ok: true, dest, work: jamOut(t, w) }; }
    return { error: 'Open the jam it is for, then drop it there.' };
  });
  /* References (references.js): what the brand uploaded for the generators. Reading is for the team and a jam's guests (the
     picker shows them); adding, editing and removing are the team's, with the same member check as a drop into brand memory */
  const refSlug = (t, p) => { const slug = t.brandId || DEFAULT_BRAND; return p.slug === slug ? slug : null; };
  const refTeam = (t) => { const r = reqOf(t); return r?.member || process.env.DEMO_MODE === '1' ? null : { status: r?.email ? 403 : 401, error: 'Only this brand’s team changes its References.', team: true }; };
  /* reading is for the team, Brew's staff and a guest of one of the brand's jams: never a fresh workspace from outside (QV 25 Oct) */
  on('GET', '/api/brands/:slug/references', async (b, t, p) => { const slug = refSlug(t, p); if (!slug) return { status: 400, error: 'This workspace is for another brand.' }; const r = reqOf(t);
    if (!(r?.member || r?.guest || process.env.DEMO_MODE === '1')) return { status: r?.email ? 403 : 401, error: 'Only this brand’s team sees its References.', team: true };
    return { items: await REFS.list(slug), jobs: REFS.JOBS }; });
  on('POST', '/api/brands/:slug/references', async (b, t, p) => { const slug = refSlug(t, p); if (!slug) return { status: 400, error: 'This workspace is for another brand.' }; const no = refTeam(t); if (no) return no;
    const x = await REFS.add(slug, { data: b.data, label: b.label || b.name, job: b.job, keep: b.keep, product: b.product, by: meOf(t)?.email || null }); return x.error ? x : { ok: true, item: x.item, same: !!x.same, items: await REFS.list(slug) }; });
  on('POST', '/api/brands/:slug/references/:rid', async (b, t, p) => { const slug = refSlug(t, p); if (!slug) return { status: 400, error: 'This workspace is for another brand.' }; const no = refTeam(t); if (no) return no;
    const x = await REFS.update(slug, p.rid, { label: b.label, job: b.job, keep: b.keep, product: b.product }); /* :rid, not :id: the dispatcher reads params.id as the tenant */ return x.error ? x : { ok: true, item: x.item, items: await REFS.list(slug) }; });
  on('POST', '/api/brands/:slug/references/:rid/remove', async (b, t, p) => { const slug = refSlug(t, p); if (!slug) return { status: 400, error: 'This workspace is for another brand.' }; const no = refTeam(t); if (no) return no;
    return REFS.remove(slug, p.rid); });
  on('PUT', '/api/tenants/:id/deck-layout', async (b, t) => { if (Array.isArray(b.hidden)) t.deck.hidden = b.hidden; if (b.colWidth) t.deck.colWidth = b.colWidth; return t.deck; });
  on('GET', '/api/tenants/:id/stories', async (b, t) => { await Promise.race([research?.ready?.(), new Promise((r) => setTimeout(r, +process.env.STORIES_WAIT_MS || 1500).unref?.())]).catch(() => {}); return { rings: JSON.parse(noPaise(JSON.stringify(stories(t)))) }; }); /* stories saved before the paise fix read clean too */
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
    /* v2 takes (remix.js): cards whose words or picture changed since `since` (a take that landed, or failed) go in `updated`, apart
       from `ids` (brand-new cards): the feed re-fetches each one. A take left drawing by a stopped server resolves here too */
    RMX?.v2?.healTakes(t); const updated = RMX?.v2?.updatedSince(t, since) || [];
    return { newCards: fresh.length, ids: fresh.map((c) => c.id), titles: fresh.slice(0, 3).map((c) => c.title), updated, batches: t.batches, health: t.health, jams: t.jams.map((j) => ({ id: j.id, ticket: j.ticket, status: j.status, last: j.messages.slice(-1)[0], updatedAt: j.updatedAt })), clock: now(t) };
  });
  /* a card on screen: one mark per half hour at most (a reload is not a second look), so seen counts real looks */
  on('POST', '/api/tenants/:id/events', async (b, t) => { const n = now(t); [...new Set(Array.isArray(b.shown) ? b.shown : [])].slice(0, 200).forEach((id) => { const c = t.cards.get(id); if (!c) return; const ts = (t.shown[id] ||= []); if (ts.length && n - ts[ts.length - 1] < 30 * 60e3) return; ts.push(n); c.shownCount = (c.shownCount || 0) + 1; if (c.state === 'ready') setState(t, c, 'shown'); }); return { ok: true }; });
  on('POST', '/api/tenants/:id/cards', async (b, t) => {
    const parent = b.parentCardId ? t.cards.get(b.parentCardId) : null;
    const c = { ...(parent ? clone(parent) : {}), ...b.card, id: uid(b.origin || 'user'), parentCardId: b.asChild ? b.parentCardId : null, origin: b.asChild ? (b.origin || 'jam') : 'user', byRole: null, live: null, done: null, time: 'Just now', createdAt: now(t), history: [] };
    delete c.state; setState(t, c, 'proposed'); setState(t, c, 'qa');
    const checks = qaCheck(c, t); t.qa.unshift({ id: uid('qa'), cardId: c.id, title: c.title, by: b.origin === 'remix' ? 'Remix' : 'Jam', attempt: 1, checks, result: checks.every((x) => x.ok || x.k === 'Names a number') ? 'pass' : 'pass with notes', at: now(t) });
    setState(t, c, 'ready'); t.cards.set(c.id, c); if (parent) markActed(t, parent.id);
    return { card: pub(c) };
  });
  on('GET', '/api/cards/:cid', async (b, t, p) => { const c = t.cards.get(p.cid); return c ? { card: pub(c) } : { error: 'not found' }; });
  on('POST', '/api/cards/:cid/feedback', async (b, t, p) => {
    const c = t.cards.get(p.cid); if (!c) return { error: 'not found' };
    const W = { heart: 1, unheart: -1, save: 1.5, unsave: -1.5, not_interested: -1, fewer_agent: -2, snooze: 0, snooze_agent: 0, tune_more: 0.5, tune_less: -0.5 };
    t.feedback.push({ id: uid('f'), cardId: c.id, userId: 'viewer', kind: b.kind, weight: W[b.kind] ?? 0, at: now(t) });
    /* the bookmark: kept for this person on every device (member-tuning.js), and it lifts cards like it (1.5 hearts) */
    if (b.kind === 'save' || b.kind === 'unsave') { const tu = await TUNE.setSaved(t.brandId || DEFAULT_BRAND, tuneKey(t), c.id, b.kind === 'save').catch((e) => { log.warn?.('[saved]', e.message); return null; }); return { ok: true, saved: tu ? tu.saved : [...savedOf(t)] }; }
    if (b.kind === 'heart') { markActed(t, c.id); t.memory.unshift({ id: uid('m'), type: 'feedback', fact: `Hearted a ${AGENT[c.agent]} card: “${c.title}”`, source: 'card feedback', at: now(t) }); return { child: pub(heartChild(t, c)) }; }
    if (b.kind === 'not_interested') { setState(t, c, 'dismissed'); if (c.title) t.noTitles = [...(t.noTitles || []), { h: String(c.title).slice(0, 160), at: now(t) }].slice(-40); /* near titles sink by 4 */ t.memory.unshift({ id: uid('m'), type: 'feedback', fact: `Not interested: “${c.title}”`, source: 'card feedback', at: now(t) }); }
    if (b.kind === 'fewer_agent') { t.fewer[c.agent] = (t.fewer[c.agent] || 0) + 1; t.memory.unshift({ id: uid('m'), type: 'feedback', fact: `Show fewer from ${AGENT[c.agent]}`, source: 'card feedback', at: now(t) }); }
    if (b.kind === 'snooze') t.snoozed[c.id] = dayKey(now(t));
    /* the swipe tuner's light touch (3.1): more or less of this kind of card, half a "fewer" step on its agent, nothing dismissed */
    if (b.kind === 'tune_more' || b.kind === 'tune_less') { t.fewer[c.agent] = +((t.fewer[c.agent] || 0) + (b.kind === 'tune_less' ? 0.5 : -0.5)).toFixed(1); t.memory.unshift({ id: uid('m'), type: 'feedback', fact: `${b.kind === 'tune_less' ? 'Less' : 'More'} like “${c.title}” (setup swipe)`, source: 'swipe tuner', at: now(t) }); }
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
    if (isMock() || !spend('image')) return { error: (!isMock() && budgetWhy('image')) || 'Images are paused right now. Try again in a bit.' };
    /* the product the card's asset line (else its words) names, then the lane photo; the picture shows the scene the card promises */
    const named = cardProduct(c, brandOfT(t)?.catalog || [], { brand: BN() }), namedFile = named?.img ? (o.photoAsync ? await o.photoAsync(named.img).catch(() => null) : null) || (fs.existsSync(photoFile(named.img)) ? photoFile(named.img) : null) : null;
    const lane = LANE_PHOTO[c.lane] ? c.lane : Object.keys(LANE_PHOTO)[0], ref = namedFile || photoFile(LANE_PHOTO[lane] || Object.values(LANE_PHOTO)[0]); if (!ref || !fs.existsSync(ref)) return { error: 'There’s no product photo to start from.' };
    const buf = await geminiImage({ srcFile: ref, prompt: `Create a new product photograph for this ad idea: ${c.title}. ${cardScene(c)} ${c.scene || ''} ${`Keep the ${BN()} ${B().config.product?.noun || 'product'} and its label exactly as in the reference`}. ${B().config.product?.avoid || 'No text, no before/after.'} ${(B().config.product?.style || 'Premium D2C product ad photography') + '.'}`, ratio: '4:5', model: process.env.WATCHER_IMAGE_MODEL || 'gemini-2.5-flash-image' });
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
  /* the free watchers (never the paid Creative one), with a time limit: whatever is not done by then lands through the pulse */
  const FREE_W = new Set(['trends', 'ads-library', 'catalog', 'visibility', 'ads']);
  const runFree = async (t, why, ms = 6000) => { const made = [];
    const go = (async () => { for (const w of WATCHERS) { if (!FREE_W.has(w.id) || !t.watchers[w.id]?.enabled) continue; try { made.push(...(await runWatcher(t, w, why))); } catch (e) { log.warn?.('[watcher]', w.id, e.message); } } })();
    let tm; await Promise.race([go, new Promise((r) => { tm = setTimeout(r, ms); tm.unref?.(); })]); clearTimeout(tm); return made.slice(); };
  /* research the person never saw in the feed, strongest first: a card that expired unseen comes back, one they turned down never */
  const fromArchive = (t, n = 3) => { const r = research?.get() || {}, out = [];
    const by = (wid, xs) => xs.slice().sort((a, b) => resStrength(wid, b, r) - resStrength(wid, a, r)).map((x) => [wid, x]), A = by('ads-library', resAll(r.ads)), T2 = by('trends', resAll(r.trends)), V = by('viral', resAll(r.viral));
    const list = []; for (let i = 0; i < Math.max(A.length, T2.length, V.length); i++) { if (A[i]) list.push(A[i]); if (T2[i]) list.push(T2[i]); if (V[i]) list.push(V[i]); } /* rival ads and trends in turn, each strongest first */
    for (const [wid, x] of list) { if (out.length >= n) break; const base = researchCard(wid === 'trends' ? 'trend' : wid === 'viral' ? 'viral' : 'ad', x.id); if (!base) continue; const have = t.cards.get(base.id); if (!have && t.used.has(base.id)) continue; /* it was in the feed once */
      if (have) { if (have.state !== 'expired' || (t.shown[base.id] || []).length || t.feedback.some((f) => f.cardId === base.id)) continue; setState(t, have, 'ready'); have.createdAt = now(t); have.expiresAt = now(t) + 3 * D; out.push(have); continue; }
      t.used.add(base.id); const c = pipeline(t, base, WATCHERS.find((w) => w.id === (wid === 'viral' ? 'ads-library' : wid))); if (c?.state === 'ready') out.push(c); }
    return out; };
  /* Find more, at the end of the feed: the free watchers run now; what they make (else up to 3 from the research archive) is
     pinned to the top. Nothing new is said plainly */
  on('POST', '/api/tenants/:id/find-more', async (b, t) => {
    let made = (await runFree(t, 'manual', 8000)).filter((c) => c.state === 'ready' && visible(t, c)), from = 'watchers';
    if (!made.length) { made = fromArchive(t, 3).filter((c) => visible(t, c)); from = 'archive'; }
    if (!made.length) return { made: 0, ids: [], message: 'Nothing new right now. Your agents keep looking and new cards land at the top.' };
    const ids = made.map((c) => c.id); t.pinned = [...ids.map((id) => ({ id, at: now(t) })), ...(t.pinned || []).filter((x) => !ids.includes(x.id))].slice(0, 8);
    return { made: ids.length, ids, from, message: from === 'watchers' ? `${ids.length} new card${ids.length > 1 ? 's' : ''} at the top.` : `Nothing new from your agents yet. ${ids.length} from earlier research you hadn’t seen are at the top.` };
  });
  on('POST', '/api/tenants/:id/clock', async (b, t) => {
    t.clock += (b.days || 1) * D; touch(t); housekeep(t);
    return { clock: now(t), ...(await runAll(t, 'overnight')) };
  });

  /* work board endpoints */
  const teamJam = (t, id) => (JAMS.peek(t.brandId || DEFAULT_BRAND)?.work || []).find((x) => x.id === id) || null; /* a link's jam, whoever opens it */
  const W = (t, id) => { const w = t.work.find((x) => x.id === id); return w && DR ? DR.heal(w) : w; }; /* heal: a draft cut off by a restart stops showing as 'making' */
  // a jam started from scratch is called "New jam" until its brief has a name; then it takes the brief's heading
  const GENERIC = /^(new jam|untitled)$/i;
  /* one, always: a jam named before it ("Two fresh versions of each winner") says one, on the team list and the work board */
  const oneTitles = (t) => { for (const w of t.work || []) if (typeof w.title === 'string') { const x = oneTake(w.title); if (x !== w.title) w.title = x; } };
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
  const whoseOf = (c) => (c ? { id: c.id, kind: c.kind, rivalName: c.rivalName, research: c.research ? { kind: c.research.kind, ad: c.research.ad } : undefined, make: c.make ? { format: c.make.format, from: c.make.from, what: c.make.what } : undefined, images: (c.images || []).slice(0, 1), title: c.title } : null);
  const studioOf = (t, w) => (w.changeId && RMX?.changes(t)?.[w.changeId]?.thread) || []; /* the studio chat of the jam's ad */
  const jamOut = (t, w) => { const me0 = meOf(t), seen = me0 ? w.reads?.[me0.email] : null; return { ...w, askMe: askOf(w, me0?.email, studioOf(t, w)), waitsOnMe: waitsOn(w, me0?.email, studioOf(t, w)), title: dejargon(w.title), thread: sfWho(w.thread), cardSnap: undefined, whose: whoseOf(t.cards.get(w.cardId) || w.cardSnap), /* what the Work board needs to say whose ad it is (FEED-NOT-02) */ unread: me0 ? (w.updatedAt > (seen || 0) && (w.people || []).some((p) => p.email === me0.email) && w.lastBy !== me0.email) : !!w.unread, mine: !!me0 && JAMS.isIn(w, me0.email), here: JAMS.here(w.id).filter((p) => p.email !== me0?.email) }; };
  const workOut = (t) => { const see = guestSees(t); shown = (w) => shown0(w) && see(w); try { return workOut0(t); } finally { shown = shown0; } };
  const workOut0 = (t) => (repairHeartKids(t), dedupeShortcuts(t), fixTickets(t), oneTitles(t), t.work.forEach((w) => { if (typeof w.cta === 'string' && ctaName(w.cta) !== w.cta) w.cta = ctaName(w.cta); RMX.retype?.(t, w) /* a jam opened as the wrong deliverable, untouched, lets go so the card opens the right one */; RMX.ensurePlan(t, w); if (w.cardId && (!w.cardPlan || w.cardPlan.v !== PLAN_V) && t.cards.get(w.cardId)) { const made = w.cardPlan?.made; w.cardPlan = planOfCard(t.cards.get(w.cardId)); if (w.cardPlan && made) w.cardPlan.made = made; } /* jams opened before plans (or before one-always, plan v2) heal */ if (!['measuring', 'result'].includes(w.stage)) JB.seed(t, w); titleFromDoc(w); }), { items: t.work.filter(shown).map((w) => jamOut(t, w)), discarded: t.work.filter((w) => !w.archived && w.discarded && guestSees(t)(w)).map((w) => jamOut(t, w)), me: meOf(t), notes: t.notes.slice(0, 40), unread: t.notes.filter((n) => !n.read).length, needsYou: t.work.filter((w) => shown(w) && waitsOn(w, meOf(t)?.email, studioOf(t, w))).length, withTeam: withTeam(t.work.filter(shown)) });
  on('GET', '/api/tenants/:id/work', async (b, t) => workOut(t));
  // discard a jam (kept under Discarded, can be restored). Something live is undone first, never discarded under people.
  on('POST', '/api/work/:wid/discard', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' };
    if (['deploying', 'measuring'].includes(w.stage)) return { error: 'It was sent to your team already. Open a jam for the next version instead.' };
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
    if (makeAsk(body)) { say(t, w, { from: 'me', body }); const pd = await propose(t, w, { kind: 'make', as: asOf(body), text: body, summary: '', by: nameOf(meOf(t)) }); return { work: w, pending: pd }; } /* a paid image or video waits for a yes */
    if (w.changeId && RMX) { const r = await RMX.iterateFromJam(t, w, body); if (r?.error) return r; if (r) { if (w.stage !== 'drafting' && ['team', 'brew', 'needs_you'].includes(w.stage) === false) move(t, w, 'drafting', null); return { work: w, change: r.change }; } }
    say(t, w, { from: 'me', body });
    if (EVIDENCE_ASK.test(body)) { const pa = proofSay(t, w.cardId); if (pa) { say(t, w, { from: 'ai', who: AGENT[w.agent] || 'Brew', body: pa, answer: true }); return { decision: { intent: 'answer', route: 'agent' }, work: w }; } } /* "show me the proof" / "evidence for the price": the card's proof, never a new version or the team (FEED-ARV-01) */
    const decision = await routeJam(t, body, false);
    t.router.unshift({ id: uid('r'), body: body.slice(0, 140), card: w.title, ...decision, at: now(t) });
    if (decision.route === 'team') {
      /* a person is needed: Brew says so; the brief goes to the team by Share the brief (copied), nothing is sent from here */
      say(t, w, { from: 'system', body: `This needs ${decision.label}. Finish the jam, then share the brief with your team or the ShopOS team, Brew’s build crew.` });
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
    /* said in the chat as a tag from the person who assigned it (so the chat, Slack and the email all tell the same story);
       the assign email is the tag's email, never a second one */
    const at = `@${x.name || x.email.replace(/@.*/, '')}`, note = String(b.note || '').trim().slice(0, 400);
    const body = `${at} ${ask === 'approve' ? `can you OK v${w.current}?` : 'this one’s yours.'}${note ? ` ${note}` : ''}`;
    if (me0) say(t, w, { from: 'me', body, to: [x.email] }); else say(t, w, { from: 'system', body: ask === 'approve' ? `Asked ${nameOf(x)} for their OK on v${w.current}` : `Gave this jam to ${nameOf(x)}` });
    if (ask === 'approve') move(t, w, 'needs_you', null);
    mailEv(t, w, { kind: ask === 'approve' ? 'approve' : 'assigned', to: [x.email], by: me0, text: note, id: w.thread[w.thread.length - 1].id });
    return { work: jamOut(t, w) };
  });
  /* yes / not now on a proposal Brew made (from a typed ask here, or from the jam's Slack thread): it runs once */
  on('POST', '/api/work/:wid/pending/:pid', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' };
    const r = await applyPending(t, w, p.pid, nameOf(meOf(t)), !!b.go);
    return r.gone ? { error: 'That was already answered.', work: jamOut(t, w) } : { work: jamOut(t, w), ...(r.error ? { error: r.error } : {}) }; });
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
  JB = createJamBrief({ proofOf: (t, w) => (w.cardId ? proofSay(t, w.cardId) : null), onShopos: (t, w, x) => shoposMail(t, w, x), onBriefSent: briefSentMail, onBriefStatus: briefStatusMail, truthRows, meOf, staffOf: (t) => { const me0 = meOf(t); return me0?.staff ? me0 : null; }, planOf: (t, c) => planOfCard(c), pageOf: (t, c) => pageNow(t, c), MOVES, cardOf: (t, id) => { const c = t.cards.get(id); return c ? fillCard(c, t) : null; }, measureOf, claudeTool, cardBrief, seatLine, isMock, spend, clean, now, AGENT, SEED, log, changeOf: (t, w) => (w.changeId && t.changes?.[w.changeId]) || null, targetOf: (t, w) => { const tg = deployTarget(w.cta, t.cards.get(w.cardId)); return tg.conn ? tg.name : null; } });
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
  JB.routes({ askMake: (t, w, text) => (makeAsk(text) ? propose(t, w, { kind: 'make', as: asOf(text), text, summary: '', by: nameOf(meOf(t)) }) : null), toSlack: o.slack ? toSlack : null, on, W, say, move, notify, learn: learnOf, nextTicket: (t) => { leadsAllTenants++; return nextBrandTicket(t); }, handoff: { build: (...a) => HO.build(...a), text: (...a) => HO.text(...a) } });
  // first drafts in a jam, one tap away: image, video, voice or text, made only when someone asks (drafts.js)
  DR = createDrafts({ sourceOf: (t, c) => packSource(packFor(t), c), rivalAdOf: rivalAd, rivalStoreOf, claudeTool, geminiImage, treg: o.treg, launchBrowser: o.launchBrowser, zipBuffer: o.zipBuffer, photoAsync: o.photoAsync, photoFile, catalogOf: (t) => (t ? brandOfT(t)?.catalog : null), hooksOf: (t) => { const p = t ? brandOfT(t) : B(); return { reviewQuotes: p?.reviewQuotes || [], rivalHooks: p?.rivalHooks || [] }; } /* the brand's review quotes and rival hooks for the drafts (brand-pack.js hooksOf) */, brandName: (t) => (t ? brandOfT(t)?.seed?.brand?.name || '' : ''), photoOf: (c) => LANE_PHOTO[c?.lane] || Object.values(LANE_PHOTO || {})[0], cardOf: (t, id) => { const c = t.cards.get(id); return c ? fillCard(c, t) : null; },
    briefOf: (t, w) => JB.seed(t, w)?.md, cardBrief, seatLine, isMock, spend, clean, now, uid, say, save: (t) => store?.save(t), AGENT, onReady: (t, w, d) => slackAsset(t, w, { title: d.title, copy: d.copy, image: d.image, video: d.video, audio: d.audio, zip: d.zip, kind: d.as === 'video' && !d.video ? (d.image ? 'image' : 'text') : d.as, note: d.err || null }), /* a video that didn't come through says so, never 'New video' */ log });
  /* the jam's finals (finals-routes.js): the sheet's status, the quote, the run and a Space checkpoint; a final lands as a draft
     card marked final and posts to the thread like every asset. Off when the server has no Sloosh client (tests) */
  JAM_FINALS = o.finals && o.sloosh ? createFinalsRoutes({ blockOf: (t, w, d) => { const src = packSource(packFor(t), w?.cardId ? t.cards.get(w.cardId) : null), text = [d?.headline, d?.copy, d?.script, ...(d?.slides || []).map((x) => x?.text || x?.onSlide)].filter((x) => typeof x === 'string').join('\n'), f = claimFlags(text, src); return f.length ? `Fix this first: ${f.slice(0, 2).map((x) => x.why).join('; ')}. Then make the final.` : null; }, on, W, say, meOf, slugOfT, brandOfT, cardOfW: (t, w) => (w?.cardId ? t.cards.get(w.cardId) || null : null), references: (t, slug) => REFS.list(slug), finals: o.finals, sloosh: o.sloosh, creditsLeft: (slug) => o.budgetLeft?.(slug) || null, rivalOf: rivalPicOf,
    onReady: (t, w, d) => slackAsset(t, w, { title: d.title, copy: d.copy, image: d.image, video: d.video, kind: d.as === 'video' && !d.video ? 'image' : d.as, note: d.err || null }), save: (t) => store?.save(t), now: () => Date.now(), uid, log }) : null; DR.routes({ on, W });
  MOVES ||= createMoves(path.dirname(PUB));
  // the card page: options, our pick, recommendation, what follows, and the move details that matter.
  // Seed cards are prebuilt (tools/build_card_pages.mjs); any other card is built once on first open.
  // card pages, move documents and the fact list for prompts: the active brand's
  const PAGES = liveView((b) => b.pages), MOVE_DOCS = liveView((b) => b.moveDocs);
  /* a card page is paid for once: written pages are kept in the brand pack (pages.json), so a reload or a deploy doesn't write them again */
  const pageLocks = new Map();
  /* `file`: pages.json for everyone's cards; a page of a card only the team sees (isPrivateCard) goes to private/pages.json */
  const keepPage = (key, page, file = 'pages.json') => { const slug = B()?.slug, P = o.globalPacks; if (!slug || !P?.getJSON || B()?.kind !== 'generated') return;
    const run = (pageLocks.get(slug) || Promise.resolve()).catch(() => {}).then(async () => { const all = await P.getJSON(slug, file, {}).catch(() => ({})); all[key] = page; await P.put(slug, file, all); }).catch((e) => log.warn('[card page] keep', e.message));
    pageLocks.set(slug, run); };
  /* the team's card pages (a connected account's card, a move rewritten from the team's numbers): never in the brand's shared
     pages, never built for or shown to anyone outside the team, loaded once per brand from private/pages.json */
  const PRIV_PAGES = new Map();
  const privPages = async () => { const slug = B()?.slug; if (!slug) return {}; if (!PRIV_PAGES.has(slug)) PRIV_PAGES.set(slug, await (o.globalPacks?.getJSON?.(slug, 'private/pages.json', {}) || Promise.resolve({})).catch(() => ({})) || {}); return PRIV_PAGES.get(slug); };
  const PAGE_FACTS_OF = () => B().pageFacts;
  const building = new Map();
  // what the card page says right now, without waiting on AI (for the first brief)
  const pageNow = (t, c) => { if (!c) return null; const key = c.id + '|' + (c.title || '');
    if (isPrivateCard(c)) { if (!t?.member) return null; return PRIV_PAGES.get(B()?.slug)?.[`priv|${key}`] || fallbackPage(c, MOVE_DOCS, MOVES); } if (PAGES[c.id] && (!PAGES[c.id].title || PAGES[c.id].title === c.title)) return PAGES[c.id]; return PAGES[key] || fallbackPage(c, MOVE_DOCS, MOVES); };
  const pageOf = async (t, c) => {
    if (isPrivateCard(c)) return privPageOf(t, c);
    const key = c.id + '|' + (c.title || '');
    if (PAGES[c.id] && (!PAGES[c.id].title || PAGES[c.id].title === c.title)) return PAGES[c.id];
    if (PAGES[key]) return PAGES[key];
    if (isMock() || demoReq() || !spend('text')) return fallbackPage(c, MOVE_DOCS, MOVES); // demo mode: a page already written, or the plain one
    if (!building.has(key)) building.set(key, (async () => {
      const { nums, moveText } = moveTextOf(MOVE_DOCS, MOVES, c);
      /* a shared page is cached for every viewer, so it never carries the team's connected baseline (measureOf without a viewer) */
      const measure = measureOf(null, c), mNums = new Set([measure.baseline, measure.target].filter((x) => x != null).flatMap((v) => numbersIn(`₹${v} ${v}% ${v}`)));
      const ok = (s) => unbacked({ text: String(s || '') }, FACT_OK).every((x) => mNums.has(x.n));
      const j = await claudeTool(pagePrompt({ card: c, factBrief: PAGE_FACTS_OF(), moveText, nums, measure }), PAGE_SCHEMA, 3500, 'card_page');
      const pg = (PAGES[key] = { ...sanitizePage(j, { card: c, M: MOVE_DOCS, nums, ok }), title: c.title }); keepPage(key, pg); return pg;
    })().catch((e) => { log.warn('[card page]', e.message); return fallbackPage(c, MOVE_DOCS, MOVES); }).finally(() => building.delete(key)));
    return building.get(key);
  };
  /* a team-only card's page: members only, with the team's own baseline, kept apart (priv| keys, private/pages.json) */
  const privPageOf = async (t, c) => {
    if (!t?.member) return null;
    const key = `priv|${c.id}|${c.title || ''}`, PP = await privPages();
    if (PP[key]) return PP[key];
    if (isMock() || demoReq() || !spend('text')) return fallbackPage(c, MOVE_DOCS, MOVES);
    if (!building.has(key)) building.set(key, (async () => {
      const { nums, moveText } = moveTextOf(MOVE_DOCS, MOVES, c);
      const measure = measureOf(t, c), mNums = new Set([measure.baseline, measure.target, ...(c.liveNums || [])].filter((x) => x != null).flatMap((v) => numbersIn(`₹${v} ${v}% ${v}`)));
      const ok = (s) => unbacked({ text: String(s || '') }, factOkFor(t)).every((x) => mNums.has(x.n));
      const j = await claudeTool(pagePrompt({ card: c, factBrief: packFor(t)?.pageFacts || PAGE_FACTS_OF(), moveText, nums, measure }), PAGE_SCHEMA, 3500, 'card_page');
      const pg = (PP[key] = { ...sanitizePage(j, { card: c, M: MOVE_DOCS, nums, ok }), title: c.title }); keepPage(key, pg, 'private/pages.json'); return pg;
    })().catch((e) => { log.warn('[card page]', e.message); return fallbackPage(c, MOVE_DOCS, MOVES); }).finally(() => building.delete(key)));
    return building.get(key);
  };
  HO = createHandoff({ RMX: { packageOf: (...a) => RMX?.packageOf(...a) }, pageOf, fillCard, AGENT, SEED });
  /* the team brief: what the people who make it work from, on the studio's stage, as a PDF, or as an email draft (team-brief.js) */
  /* a change to the team brief on the stage goes into the jam brief too (the Brief tab), in the background, so both say the same */
  const tbToJam = (t, w, { ask, quote, recent, said }) => { if (!JB?.edit) return;
    const text = `${quote ? `In the part that says "${String(quote).slice(0, 300)}": ` : ''}${ask}${said ? `\n(Already done in the team brief: ${said})` : ''}${recent?.length ? `\nThe chat just before:\n${recent.slice(-3).map((l) => `- ${String(l.text).slice(0, 200)}`).join('\n')}` : ''}`;
    JB.edit(t, w, text, { who: meOf(t)?.name || 'You', mode: 'hear' }).then((r) => { if (r?.changed?.length) TB.follow(t, w); }).catch((e) => log.warn('[team brief → jam brief]', e.message)); };
  TB = createTeamBrief({ bookOf: (t) => bookText(t), onEdit: tbToJam, claudeTool, isMock, spend, clean, now, log, handoff: HO, proofOf: (t, w) => (w.cardId ? proofSay(t, w.cardId) : null) }); TB.routes({ on, W });
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
    if (wid && !r?.member && jamPrivate(t, W(t, wid))) return { status: 403, error: TEAM_ONLY };
    return { token: shareToken(t.id, wid) }; });
  on('GET', '/api/work/:wid/handoff', async (b, t, p, q) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; { const r = reqOf(t); if (!(r?.member || r?.guest?.wids?.includes(w.id)) && process.env.DEMO_MODE !== '1') return { status: 403, error: 'Sign in as part of the team to share this jam.' }; if (!r?.member && jamPrivate(t, w)) return { status: 403, error: TEAM_ONLY }; } /* its links carry a jam token: only someone in the jam makes them */ const x = await HO.build(t, w, { base: q.get('base') || undefined, changeId: q.get('ch') || undefined }); return { handoff: x, text: HO.text(x, q.get('to') || 'whatsapp') }; });
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
  /* the proof sheet (the shield on every card): why Brew suggested it, and the evidence it rests on, each line with its source */
  on('GET', '/api/cards/:cid/evidence', async (b, t, p) => { const raw = t.cards.get(p.cid); if (!raw || !seatOk(t, raw)) return { error: 'not found' };
    const slug = slugOfT(t); await PLAIN.load(slug).catch(() => {}); if (t.member) await PLAIN.load(slug, true).catch(() => {}); const c = fillCard(raw, t), pl = PLAIN.get(slug, raw), shown = PLAIN.apply(slug, raw);
    const voice = await voiceReady(slug), ev = refineProof(c, EV.evidenceOf({ ...c, brand: BN() }, { liveLedger: t.member ? t.liveLedger : null, facts: t.member ? packFor(t)?.facts : null, plain: pl, voice, team: toldSeen(t) }), { voice, connected: (id) => connOn(t, id), has: (id) => !!SEED?.connectors?.[id] });
    return { evidence: { ...ev, ...(ev.why ? { why: { ...ev.why, because: dejargon(ev.why.because), reasons: (ev.why.reasons || []).map(dejargon) } } : {}), ...(Array.isArray(ev.moves) ? { moves: ev.moves.map((m) => ({ ...m, title: dejargon(m.title) })) } : {}), items: (ev.items || []).map((x) => ({ ...x, label: dejargon(x.label), src: dejargon(x.src) })), card: { id: raw.id, title: shown.title, sub: shown.sub, orig: shown.orig || null }, brand: BN() } }; }); /* source lines, the lead line, the reasons and "How Brew worked it out" in plain words too (no products.json, no JSON-LD: final QA pass 19 Oct) */
  on('GET', '/api/cards/:cid/page', async (b, t, p) => { const raw = t.cards.get(p.cid); if (!raw) return { error: 'not found' }; const c = fillCard(raw, t); return { page: await pageOf(t, c) }; });
  // a card's source moves: what each one says, and the passages that speak to this card
  on('GET', '/api/cards/:cid/moves', async (b, t, p) => { const c = t.cards.get(p.cid); if (!c) return { error: 'not found' }; return { moves: MOVES.numsOf(c.src).map((n) => ({ ...MOVES.summary(n), passages: MOVES.passages({ ...c, src: `Move ${n}` }, 4) })) }; });
  /* MEDIA_FAKE=1 on a local server: the jam's short video runs end to end for free (drafts.js fakeMakers) */
  const FAKE = process.env.MEDIA_FAKE === '1' && !process.env.K_SERVICE ? fakeMakers() : null;
  /* the studio chat as people see it: its own lines and the jam's (a tagged teammate's line lives in the jam), oldest first */
  const chatOf = (t, ch) => { const w = ch?.workId ? W(t, ch.workId) : null;
    return [...(ch?.thread || []).map((m) => ({ at: m.at || 0, text: m.text || '', brief: !!m.brief })), ...(w?.thread || []).map((m) => ({ at: m.at || 0, text: m.body || '' }))].filter((l) => l.text && l.at < 9e15).sort((a, b) => a.at - b.at).slice(-6); };
  RMX = createRemix({ evidenceOf: (t, c) => proofOfCard(t, c), noPeople: (t) => { try { bookText(t); return !!BOOKTXT.get(slugOfT(t))?.noPeople; } catch { return false; } }, packSourceOf: (t, card) => { try { const p = packFor(t); return p ? packSource(p, card) : null; } catch { return null; } }, approvedClaimsOf: (t) => { try { return packFor(t)?.book?.claims || []; } catch { return []; } }, /* the writer reads the same approved claims the checks accept */ /* the viewer's own pack: connected facts, approved claims, review quotes */ teamStaticText: (t) => packs.getJSON(slugOfT(t), 'private/statics.json', {}), truthRows, briefEdit: async (t, ch, msg) => { const w = ch.workId ? W(t, ch.workId) : null; if (!w) return { skip: true }; return TB.aiEdit(t, w, { ask: msg, recent: chatOf(t, ch) }); }, isBriefAsk: (m, t, ch) => TB.isBriefAsk(m, chatOf(t, ch)), /* refined like the shield: the studio never lists proof the card's sheet removed (FEED-ARV-01) */ rivalAdOf: rivalAd, rivalStoreOf, rivalSummary, viralOf, refSummary, references: (t) => REFS.list(t.brandId || DEFAULT_BRAND), finals: o.finals || null, sloosh: o.sloosh || null, creditsLeft: (slug) => o.budgetLeft?.(slug) || null, brandOfT, slugOfT, meOf, onMedia: (t, ch, m) => studioMedia(t, ch, m), onFinal: (t, ch, r) => studioFinal(t, ch, r), onVersion: (t, ch, v, why) => studioVersion(t, ch, v, why), onShopos: (t, w, x) => shoposMail(t, w, x), askPerson: async (t, w, q, email) => { const [x] = await tagsOf(t, w, [email]); if (!x) return { error: 'They’re not on the team yet. Invite them first.' }; const me0 = meOf(t);
      JAMS.join(w, x, 'asked'); say(t, w, { from: 'system', body: `${nameOf(me0)} asked ${nameOf(x)}: ${q.q}` }); mailEv(t, w, { kind: 'asked', to: [x.email], by: me0, text: q.q, id: `q_${w.id}_${q.id}` }); return x; }, ...(FAKE ? { makers: FAKE.makers, videoImage: FAKE.image, mediaFake: true } : {}), planOf: (t, c) => (c ? planOfCard(c) : null), save: (t) => store?.save(t), catalogOf: (t) => (t ? brandOfT(t)?.catalog : null), photoAsync: o.photoAsync, photoFile, handoffPath, MOVES, seedJam: (t, w) => JB?.seed(t, w), claudeTool, geminiImage, PUB, LANE_PHOTO, FACTS, unbackedNums: (text, t = null) => unbacked({ text: String(text).replace(/\b(?:Rs\.?|INR)\s?(?=\d)/gi, '₹') }, factOkFor(t)).map((x) => x.n) /* a member's jam is checked against their truth */, SEED, AGENT, claudeJSON, cardBrief, seatLine, qaCheck, mechanicalFix, clean, BANNED, isMock, spend, uid, now, clone, inr, on, newWork, addVersion, say, move, notify, later, setState, weekKey, curV, measureOf, log  });
  /* Jam v2 (?v=2): the new jam lives beside v1 in jam2/, with its own routes (/api/jam2/*), data (jams-v2.json, brandbook.json) and
     public pages (/p/<token>, /brief/<token>); nothing in v1 calls it */
  /* Jam v2 is not on the demo site (its jams would be shared across visitors there); on live a card outside the viewer's seats can't be opened */
  if (process.env.DEMO_MODE !== '1') JAM2 = mountJam2({ factBriefOf: (t) => packFor(t)?.factBrief || null, v1Product: (t, chId) => RMX?.productOfCh?.(t, chId) || null, brandbook: BOOK, refOf: (t, c) => { try { return refSummary(t, c); } catch { return null; } }, /* the rival ad or viral post a card is about: its video, poster and beats */ onStudioTake: (t, chId, tk) => RMX?.landStudio(t, chId, tk), onStudioState: (t, chId, st) => RMX?.studioState(t, chId, st), on, packs: o.globalPacks || packs, slugOfT, brandOfT, loadBrandOfT: (t) => packs.load(t.brandId || DEFAULT_BRAND), meOf, reqOf, cardOf: (t, id) => { const c = t.cards.get(id); return c && seatOk(t, c) ? fillCard(c, t) : null; }, sourceOf: (t, c) => packSource(packFor(t), c), refsOf: (slug) => REFS.list(slug), isMock, spend: (k, slug, n) => spend(k, n), /* a count (a final's credits) is counted in full */ spendMany: (k, n) => spend(k, n), ai: o.ai || null, staticTextOf: (t, team) => (team ? packs.getJSON(slugOfT(t), 'private/statics.json', {}) : brandOfT(t)?.staticText || {}),
    geminiImage, vertexVideo: (frame, prompt, x) => jam2Video(frame, prompt, { ...x, priced: true }, log), vertexVoice: (text, v) => jam2Voice(text, v, {}, log), vertexMusic: (prompt) => jam2Music(prompt), presence: { beat: (id, u, typing) => JAMS.beat(id, u, typing), here: (id) => JAMS.here(id) }, teamOf: o.teamOf || null, inviteTo: o.inviteTo || null, jamMail: o.jamMail || null, slack: o.slack || null, memoryOf: (t, agent) => promptBlock(t, agent), finals: o.finals || null, saveGen, genFile: jam2GenFile, photoAsync: o.photoAsync, claudeTool, launchBrowser: o.launchBrowser, shoot: createMakers({ geminiImage, launchBrowser: o.launchBrowser, zipBuffer: o.zipBuffer, log }).shoot, zipBuffer: o.zipBuffer, log });
  // tenants survive restarts (store.js); a tenant not in memory is read back from disk or GCS before we give up on it
  const getTenant = async (id) => {
    let t = tenants.get(id); if (t || !store || !id) return t;
    t = await store.load(id); if (!t) return null;
    /* a workspace edited outside Brew (a reset script that blanked a Set to {}) loads with the right shapes, so the feed never throws "t.acted is not iterable" */
    for (const k of ['acted', 'days', 'used']) if (k in t && !(t[k] instanceof Set)) t[k] = new Set(Array.isArray(t[k]) ? t[k] : Array.isArray(t[k]?.__s) ? t[k].__s : []);
    if ('cards' in t && !(t.cards instanceof Map)) t.cards = new Map(Array.isArray(t.cards) ? t.cards : Array.isArray(t.cards?.__m) ? t.cards.__m : []);
    const br = await packs.load(t.brandId || DEFAULT_BRAND); if (!br) return null;
    await JAMS.load(br.slug);
    return runIn(br, () => {
      // seed and pool cards follow the current copy (descriptions get rewritten); runtime cards keep their own
      const SRC = new Map([...SEED.posts, ...Object.values(POOLS).flat()].map((x) => [x.id, x]));
      for (const c of t.cards?.values?.() || []) { const src = SRC.get(c.id); if (!src) continue; if (typeof src.sub === 'string') c.sub = src.sub; if (src.byRole) c.byRole = clone(src.byRole);
        /* a move card's status badge ("Being updated", "Updated") follows the move now, never the day the card was copied: a flag
           cleared after a restart left "Being updated" on every workspace's copy (Scrubroom m20-1, 25 Oct) */
        if (/^m\d+-\d+$/.test(String(c.id))) { const sb = src.badge, cb = c.badge; if (sb && ['Being updated', 'Updated'].includes(sb[0])) c.badge = clone(sb); else if (cb && ['Being updated', 'Updated'].includes(cb[0])) delete c.badge; } }
      // a generated brand: cards from moves that landed while this workspace was away
      if (br.kind === 'generated') streamSync(t, SEED.posts);
      if (br.kind === 'generated') { followMoves(t, br); const t0 = now(t); for (const p of SEED.posts) if (!t.cards.has(p.id)) t.cards.set(p.id, { ...clone(p), family: p.family || FAMILY[p.type] || 'idea', state: 'ready', origin: 'move', createdAt: t0, expiresAt: null, history: [['ready', t0]], shownCount: 0, ...(mvOf(br, p.id) ? { mv: mvOf(br, p.id) } : {}) }); }
      /* "No live ads" cards from days the tracker couldn't find the brand's page, while the one count says its ads run (PUMA India,
         Scrubroom, 24 Oct): gone unless someone is working on one */
      let stale = 0; if (+br.numbers?.ownAds?.n > 0) for (const id of [...t.cards.keys()]) if (/^ow-own-none-/.test(id) && !t.acted?.has?.(id) && !(t.work || []).some((w) => w.cardId === id)) { t.cards.delete(id); stale++; }
      if (healRivalWork(t) + stale) store?.save(t);
      t.lastSeen = Date.now(); tenants.set(t.id, t); log.log?.(`[store] loaded ${t.id}`); return t;
    });
  };
  /* a final Sloosh finished (or failed) while Brew restarted (finals.reconcileAll → server.js onDone): onto the jam card or the
     studio version it was asked from, in the workspace that asked (rec.land.tid) */
  const finalDone = async (slug, rec) => { const tid = rec?.land?.tid; if (!tid) return false;
    const t = await getTenant(tid).catch(() => null); if (!t || (t.brandId || DEFAULT_BRAND) !== slug) return false;
    const br = await packs.load(slug); if (!br) return false; await JAMS.load(br.slug); /* a team's jams load in the background: without this wait t.changes read empty and a final collected after a restart had "no card to land on" (19 Oct) */
    /* landed as the team: with no request the workspace reads the team's jams only when its last member is known (t.teamEmail), and
       a staff-made jam has none, so the change looked missing. A member context with no email lands it without naming anyone */
    return MC.run({ member: true, email: null, slug: br.slug, bg: 'finals' }, null, () => runIn(br, () => (rec.target?.wid ? JAM_FINALS?.landDone(t, rec) : rec.target?.chid ? RMX?.finalDone?.(t, rec) : false) || false)); };
  /* a reply in a jam's Slack thread, or its Approve button pressed (server.js checked Slack's signature and found the brand) */
  const slackIn = async ({ slug, kind, thread, ts, user = {}, text = '', n = null, pid = null, mention = false }) => {
    const br = await packs.load(slug); if (!br) return null; await JAMS.load(br.slug);
    /* approving a version or saying yes to a make (paid) is the brand's team's: someone in the channel whose Slack email isn't on the
       team is told to open it in Brew (QV 25 Oct). Replies stay open to the channel; their answers leave the team's numbers out */
    if (['approve', 'apply'].includes(kind) && !(user.email && o.isMemberEmail && await o.isMemberEmail(br.slug, user.email).catch(() => false))) return { notMember: true, w: { id: null } };
    const w = (JAMS.peek(br.slug)?.work || []).find((x) => x.slack?.ts === thread); if (!w) return JAM2 ? JAM2.slackIn({ slug: br.slug, kind, thread, ts, user, text, n }) : null; /* not a v1 jam's thread: maybe a Jam v2 one */
    const t = (w.slack.tid && await getTenant(w.slack.tid).catch(() => null)) || brandTenants(br)[0]; if (!t) return null;
    /* who wrote in Slack is a member of the brand's team only when their Slack email is on the team: then Brew's answer in the
       thread may quote the team's account numbers; anyone else in the channel gets answers without them (member-ctx.js) */
    const member = !!(user.email && o.isMemberEmail && await o.isMemberEmail(br.slug, user.email).catch(() => false));
    return MC.run({ member, email: member ? String(user.email).toLowerCase() : null, slug: br.slug, via: 'slack' }, t, async () => { if (member) await runIn(br, () => applyLive(t, { member: true })).catch(() => {});
    return runIn(br, () => {
      if (kind === 'reply') {
        const seen = (w.slack.seen ||= []); if (seen.includes(ts)) return { dup: true }; seen.push(ts); if (seen.length > 200) seen.splice(0, seen.length - 200);
        /* a real person's words: they fold into the brief (jam-brief onSay, m.real) */
        say(t, w, { from: 'colleague', who: user.name || 'Someone in Slack', body: String(text).slice(0, 4000), real: true, via: 'slack', ...(user.email ? { email: user.email } : {}) });
        notify(t, w, `${user.name || 'Someone'} replied in Slack`);
        Promise.resolve(runIn(br, () => slackAct(t, w, { text, user, mention }))).then(() => store?.save(t)).catch((e) => log.warn('[slack act]', e.message));
      } else if (kind === 'apply' || kind === 'dismiss') {
        return Promise.resolve(runIn(br, () => applyPending(t, w, pid, user.name, kind === 'apply'))).then((r) => { store?.save(t); return { w, ...r }; });
      } else if (kind === 'approve') {
        if (n != null && n !== w.current) return { stale: true, w };
        if (w.approvedBy?.n === w.current && w.stage === 'ready') return { already: true, w };
        say(t, w, { from: 'system', body: `${user.name || 'Someone'} approved v${w.current} in Slack` });
        w.approvedBy = { name: user.name || null, email: user.email || null, n: w.current, at: now(t), via: 'slack' };
        if (w.assignee?.ask === 'approve') w.assignee = null; move(t, w, 'ready', `${user.name || 'Someone'} approved it in Slack`);
      }
      store?.save(t); return { w };
    }); });
  };
  /* a jam on a team-only card (a connected account's card, a move rewritten from the team's numbers) stays with the team:
     no guests, no share or handoff link that opens it for anyone outside the team */
  const jamPrivate = (t, w) => !!w && (isPrivateCard(t?.cards?.get?.(w.cardId)) || isPrivateCard({ id: w.cardId }));
  const TEAM_ONLY = 'This jam uses the team’s own account numbers, so only the team can open or share it.';
  /* jam guests: what they may do is guestAllows (above), for the jams this email is a guest of */
  const guestOk = (t, email, path) => {
    const all = JAMS.peek(t.brandId || DEFAULT_BRAND)?.work || [], changes = JAMS.peek(t.brandId || DEFAULT_BRAND)?.changes || {};
    const wids = JAMS.guestWids(t.brandId || DEFAULT_BRAND, email).filter((id) => !jamPrivate(t, all.find((w) => w.id === id))); if (!wids.length) return false;
    return guestAllows(path, { wids, changes, cards: new Set(all.filter((w) => wids.includes(w.id)).map((w) => w.cardId).filter(Boolean)) });
  };
  /* the writes a demo-mode visitor may still make: none of them calls a model or makes an asset */
  const DEMO_OK = /^\/api\/(tenants|work|tenants\/[^/]+\/(ready|clock|events|pin|find-more|cards|notes\/(clear|read)|stories\/[^/]+\/seen|deck-layout|state|learning\/.+)|cards\/[^/]+\/(feedback|decided)|work\/[^/]+\/(decided|discard|restore|pick|version|approve|reopen|edit|jb\/move|draft\/[^/]+\/drop)|changes\/[^/]+\/(open|discard|restore|pick|notes|edit))$/;
  // every request runs inside its brand: the tenant's brand, or (creating one) the brand the page was opened for
  const handle = async (req, res, u) => {
    if (!/^\/(h\/|p\/|brief\/|api\/(share|tenants|cards|jams|jam2|work|changes|brands\/[a-z0-9-]+\/(?:drop\/read|learnings\/answer)$|brands\/[a-z0-9-]+\/(drop|references(\/[^/]+(\/remove)?)?|voice)$|brands\/[a-z0-9-]+\/book(\/(?:import|refresh|ask))?$))/.test(u.pathname)) return false;
    let tid = null;
    /* Jam v2's ready-to-post and brief links are signed: the link is the key, so they run before any sign-in, demo or team check (a team that got a brief marks its status without an account) */
    if (/^\/(p|brief)\//.test(u.pathname)) { if (JAM2 && await JAM2.publicHandle(req, res, u)) return true; send(res, 404, { error: 'not found' }); return true; }
    const hm0 = u.pathname.match(/^\/h\/([\w~-]+)$/), sm0 = u.pathname.match(/^\/api\/share\/([\w~-]+)$/);
    if (hm0) tid = parseToken(hm0[1])?.tid; else if (sm0) tid = parseShare(sm0[1])?.tid; else tid = u.pathname.match(/^\/api\/tenants\/(t_[a-f0-9]+)/)?.[1] || req.headers['x-tenant'];
    const t0 = tid && /^t_[a-f0-9]+$/.test(tid) ? await getTenant(tid) : null;
    const slug = t0?.brandId || (u.pathname === '/api/tenants' ? (u.searchParams.get('brand') || req.headers['x-brand']) : null) || DEFAULT_BRAND;
    const br = await packs.load(slug) || await packs.load(DEFAULT_BRAND);
    if (t0 && !t0.brandId) t0.brandId = br.slug;
    if (br.kind === 'generated' && o.closedFor && await o.closedFor(req, res, u, br.slug)) return true; /* a store not open yet (closed-gate.js): its workspaces, cards and jams are its team's only */
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
    /* Ask, Your feed and Drop are the team's: outside it, on live, no writes either (Ask's answers name the brand's cards) */
    /* Jam v2's Brand Book and product library hold the brand's reviews, personas and uploads: the team's only */
    if (outside && /^\/api\/jam2\/(brandbook|products)$/.test(u.pathname)) { send(res, 403, { error: 'This is for the brand’s team.', teamOnly: true }); return true; }
    if (outside && req.method !== 'GET' && /^\/api\/(tenants\/[^/]+\/tuning(\/.*)?|brands\/[^/]+\/(?:drop\/read|learnings\/answer)|brands\/[^/]+\/(drop|voice))$/.test(u.pathname)) { send(res, 403, { error: 'This is for the brand’s team.', teamOnly: true }); return true; }
    if (outside && req.method === 'GET') {
      if (/^\/api\/tenants\/[^/]+\/feed$/.test(u.pathname)) { send(res, 200, { order: [], cards: {}, scores: {}, pinned: [], limit: { plan: 'free', daily: null, locked: 0 }, teamOnly: true }); return true; }
      if (/^\/api\/tenants\/[^/]+\/stories$/.test(u.pathname)) { send(res, 200, { rings: [], teamOnly: true }); return true; }
      /* the onboarding stream replays the brand's whole read (its findings): outside the team it only says it is ready */
      if (/^\/api\/tenants\/[^/]+\/onboarding$/.test(u.pathname)) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.end(`data: ${JSON.stringify({ type: 'ready', teamOnly: true })}\n\n`); return true; }
      if (/^\/api\/tenants\/[^/]+\/(deck|pulse|engine|remixes|learning|ask|tuning|rivals)$/.test(u.pathname)) { send(res, 200, { teamOnly: true }); return true; } /* rivals: the brand's rival read is the team's, like research (QV 25 Oct) */
      if (/^\/api\/tenants\/[^/]+\/ai-answers$/.test(u.pathname)) { send(res, 200, { ai: null, teamOnly: true }); return true; } /* the AI answers ring is the team's, like stories */
      const bareCard = /^\/api\/cards\/([^/]+)$/.exec(u.pathname), guestCard = bareCard && viewer?.email && (JAMS.peek(br.slug)?.work || []).some((w) => JAMS.guestWids(br.slug, viewer.email).includes(w.id) && w.cardId === decodeURIComponent(bareCard[1]));
      if (/^\/api\/cards\//.test(u.pathname) && !guestJam && !guestCard && !(t0 && viewer?.email && guestOk(t0, viewer.email, u.pathname))) { send(res, viewer?.email ? 403 : 401, { error: 'This brand’s cards are for its team.', team: true, signin: !viewer?.email }); return true; }
    }
    /* workspaces cost memory (they stay loaded): someone outside a team makes at most 20 an hour from one address */
    if (req.method === 'POST' && u.pathname === '/api/tenants' && !viewer?.member && !gen) { const k = `${o.clientIp ? o.clientIp(req) : ''}|${Math.floor(Date.now() / 3600e3)}`; const n = (newWs.get(k) || 0) + 1; newWs.set(k, n); if (newWs.size > 5000) newWs.clear(); if (n > 20) { send(res, 429, { error: 'Too many new workspaces from this address. Try again in an hour.' }); return true; } }
    if (gen && t0) t0.lastGen = Date.now();
    if (gen && br.kind === 'generated' && req.method === 'GET' && /\/feed$/.test(u.pathname)) o.onOpen?.(br.slug); // the social scheduler and background drafts spend only on brands their team opens
    /* this request's viewer, checked from the signed-in user (REQ): t.member and t.memberEmail read it. A team member who opens
       the workspace becomes the one the background clock re-checks (teamEmail) */
    const gw = !viewer?.member && viewer?.email ? JAMS.guestWids(br.slug, viewer.email).filter((id) => !jamPrivate(t0, (JAMS.peek(br.slug)?.work || []).find((w) => w.id === id))) : [];
    const who = { member: !!viewer?.member, me: viewer?.email || null /* whoever is signed in, member or staff: their own setup answers */, email: viewer?.member ? viewer.email || null : null, name: viewer?.member ? viewer.name || null : null, pic: viewer?.member ? viewer.pic || null : null, claimed: !!viewer?.claimed, slug: br.slug, seats: viewer?.member && Array.isArray(viewer.seats) ? viewer.seats : null,
      guest: gw.length ? { email: String(viewer.email).toLowerCase(), name: viewer.name || null, pic: viewer.pic || null, wids: gw } : null };
    return SF_CTX.run(sfReq(req, u), () => GEN_CTX.run(gen, () => MC.run(who, t0, () => runIn(br, () => withPrefs(prefsOf(req), () => handleIn(req, res, u, viewer)))))); // the jam's model and memory choice, for this request
  };
  const handleIn = async (req, res, u, viewer) => {
    const hm = u.pathname.match(/^\/h\/([\w~-]+)$/);
    if (hm && req.method === 'GET') {
      const tok = parseToken(hm[1]); const t = tok && await getTenant(tok.tid); const w = t && (W(t, tok.wid) || teamJam(t, tok.wid));
      if (!w) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('This handoff link is not valid.'); return true; }
      /* a jam on the team's own numbers opens only for a signed-in member of the brand's team */
      if (jamPrivate(t, w) && !t.member) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(`${TEAM_ONLY} Sign in with your work email to open it.`); return true; }
      /* links shared before the jam link existed open the jam itself (same card, same change, latest state); ?full=1 is the read-only page */
      if (u.searchParams.get('full') !== '1') { res.writeHead(302, { location: jamPath(t, w), 'cache-control': 'no-store' }); res.end(); return true; }
      /* a shared brief is frozen: the page shows what was shared (w.jamBrief.context), not the jam as it is now; sharing again replaces it */
      const x = w.jamBrief?.context ? { ...w.jamBrief.context, frozenAt: w.jamBrief.sharedAt || null } : await HO.build(t, w, { base: `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers.host}` });
      /* the content is frozen, the stamp is not: it shows where the brief is now (Received, In progress, Delivered…) */
      const jb = w.jamBrief; if (jb) x.memo = { ...(x.memo || {}), status: jb.status ? BRIEF_LABEL[jb.status] || null : null, ...(jb.sender && !x.memo?.from ? { from: jb.sender.name || jb.sender.email || null } : {}) };
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
      if (email && w && !viewer?.member && jamPrivate(t, w)) { send(res, 403, { error: TEAM_ONLY, teamOnly: true }); return true; }
      if (email && w && !viewer?.member && !viewer?.gen) { JAMS.join(w, { email, name: viewer.name, pic: viewer.pic }, 'guest'); guest = true; }
      send(res, 200, { guest, signedIn: !!email, jam: tok.wid || null, tenant: t.id, viewer: t.viewer, conn: t.conn, pro: t.plan === 'pro', decided: t.decided || {} }); return true; }
    if (!/^\/api\/(tenants|cards|jams|jam2|work|changes|brands\/[a-z0-9-]+\/(?:drop\/read|learnings\/answer)$|brands\/[a-z0-9-]+\/(drop|references(\/[^/]+(\/remove)?)?|voice)$|brands\/[a-z0-9-]+\/book(\/(?:import|refresh|ask))?$)/.test(u.pathname)) return false;
    for (const r of ROUTES) {
      if (r.method !== req.method) continue; const m = u.pathname.match(r.re); if (!m) continue;
      const params = m.groups || {};
      const tid = params.id || req.headers['x-tenant'];
      const t = r.pattern === '/api/tenants' ? null : await getTenant(tid);
      if (r.pattern !== '/api/tenants' && !t) { send(res, 404, { error: 'unknown tenant' }); return true; }
      if (t) { clampSeat(t); const me0 = meOf(t); if (reqOf(t)?.member) JAMS.adopt(t, me0); JAMS.hydrate(t); }
      /* a card outside the viewer's views can't be opened, jammed or acted on by id either */
      /* a team-only card (a connected account's, a move rewritten from the team's numbers) is not found for anyone outside the team */
      if (t && params.cid) { const c = t.cards.get(params.cid); if (c && (!seatOk(t, c) || (isPrivateCard(c) && !t.member))) { send(res, 404, { error: 'not found' }); return true; } }
      if (t) await TUNE.load(t.brandId || DEFAULT_BRAND).catch(() => null); /* the ranker reads tuning without waiting */
      if (t) { touch(t); const k = `${r.method} ${r.pattern.replace('/api', '')}`; t.api[k] = { n: (t.api[k]?.n || 0) + 1, last: Date.now() }; if (viewer) await applyLive(t, viewer); }
      if (r.pattern === '/api/tenants/:id/onboarding') { await onboardingStream(t, req, res); return true; }
      const b = req.method === 'GET' ? {} : await readBody(req);
      /* anything that changes the workspace makes the feed's short cache stale; the page's own calls on every open (feed-open, and the
         saved state sent back unchanged) don't, so a reload is served at once (1.7) */
      if (t && r.method !== 'GET' && !/\/feed-open$/.test(r.pattern)) { const sig = r.pattern === '/api/tenants/:id/state' ? JSON.stringify([b.viewer, b.conn, b.pro]) : null; /* the only parts of it the server keeps */
        if (!sig || sig !== STATE_SIG.get(t)) t.rev = (t.rev || 0) + 1; if (sig) STATE_SIG.set(t, sig); }
      try { const out = await r.fn(b, t, params, u.searchParams); if (!t && out?.id && viewer) await applyLive(tenants.get(out.id), viewer); send(res, Number.isInteger(out?.status) && out.status >= 100 && out.status < 600 ? out.status : 200, out); /* a reply's own status word (Send brief: 'sent') is data, not the HTTP code */ if (store && req.method !== 'GET') store.save(t || (out?.id && tenants.get(out.id))); }
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
  return { handle, slackIn, finalDone, tenants, jams: JAMS, jam2: { flush: () => JAM2?.flush() }, brandbook: BOOK, addCards, dropCards, refreshLive, syncSocial, save: (t) => store?.save(t), wire: (b) => { wireResearch(b); wireLive(b); } };
}
