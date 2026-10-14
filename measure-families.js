// Which kind of action a card is, and so how it gets measured. The families live in data/measure-families.json and are
// built from a fixed set of blocks (metric source, scope, comparisons, fingerprint, window), so a new kind of move never
// needs engine code: it lands in a family, or in Other, and Other is watched for repeats that deserve a family of their own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEP_UP, METHOD_NAME, METHOD_GRADE } from './measure-stats.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = JSON.parse(fs.readFileSync(path.join(HERE, 'data/measure-families.json'), 'utf8'));

/* ---------- when we look: every family has a check schedule, a decide day and early-stop rules ----------
   checks: the days after launch we read and note an early read (never a grade); decideDay: the only day a grade is given.
   weekly/daily: checks repeat until decideDay; minSample + wholeWeeks: a test decides once its sample is reached, in whole weeks,
   never before minDays. earlyStops raise a flag at their day; action names what Brew does (pause, revert, write_moves). */
export const TIMINGS = {
  paid: { label: 'Paid ads', checks: [1, 3, 7], decideDay: 14, minSample: 30, earlyStops: [{ rule: 'Spend reaches 2× the target cost per order with 0 orders', at: 3, key: 'spend_no_conv', action: 'pause' }] },
  messages: { label: 'Email, WhatsApp and SMS', checks: [1, 3], decideDay: 7, minSample: 500, earlyStops: [{ rule: 'Bounce or complaint rate spikes above normal', at: 1, key: 'bounce_complaint', action: 'pause' }] },
  organic: { label: 'Organic social', checks: [1, 3], decideDay: 7, minSample: 0, earlyStops: [{ rule: 'Replies turn negative on the post', at: 1, key: 'neg_replies', action: 'review' }] },
  community: { label: 'Community research', checks: [1, 3, 7], decideDay: 14, minSample: 5, earlyStops: [{ rule: 'Reply threshold met: write the moves from the replies', at: 1, key: 'threshold', action: 'write_moves' }, { rule: 'Moderators remove the post', at: 1, key: 'removed', action: 'stop' }] },
  creators: { label: 'Creators', checks: [3, 14], decideDay: 30, minSample: 10, earlyStops: [{ rule: 'A creator posts off-brief or makes a claim we cannot back', at: 3, key: 'off_brief', action: 'review' }] },
  cro: { label: 'Product pages and checkout', checks: [7, 14, 21, 28, 35, 42, 49, 56], weekly: true, decideDay: 14, maxDay: 56, minDays: 14, wholeWeeks: true, untilSample: true, minSample: 1000, earlyStops: [{ rule: 'Guard metric (checkout drop-off or order value) falls past its limit: revert', at: 7, key: 'guard', action: 'revert' }] },
  offer: { label: 'Price and offers', checks: [7], decideDay: 14, afterEnd: 7, minSample: 100, earlyStops: [{ rule: 'Margin per order falls below the floor', at: 3, key: 'margin', action: 'revert' }] },
  seo: { label: 'Search (SEO)', checks: [14, 28, 56], decideDay: 90, minSample: 0, earlyStops: [{ rule: 'Pages drop out of the index', at: 14, key: 'deindexed', action: 'revert' }] },
  aiseo: { label: 'AI answers', checks: [7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84], weekly: true, decideDay: 56, maxDay: 84, minSample: 20, earlyStops: [] },
  complaint: { label: 'Complaint fix', checks: [30], decideDay: 60, minSample: 20, earlyStops: [{ rule: 'The complaint share rises after the fix', at: 30, key: 'worse', action: 'review' }] },
  seasonal: { label: 'Seasonal and festival', daily: true, checks: [1, 2, 3, 4, 5, 6, 7], decideDay: 7, afterEvent: 7, compare: 'same window last year', minSample: 0, earlyStops: [{ rule: 'Stock of the hero runs under 7 days of cover', at: 1, key: 'stock', action: 'review' }] },
  automation: { label: 'Automations', checks: [7, 14, 21, 28], weekly: true, rolling: 28, decideDay: 28, minSample: 50, earlyStops: [{ rule: 'The rule fires far more often than planned', at: 1, key: 'runaway', action: 'pause' }] },
  listing: { label: 'Marketplace listings', checks: [7, 14], weekly: true, decideDay: 14, minDays: 14, wholeWeeks: true, minSample: 0, earlyStops: [{ rule: 'The listing is suppressed or rank collapses', at: 3, key: 'suppressed', action: 'revert' }] },
  partners: { label: 'Partners and PR', checks: [7, 14], decideDay: 28, minSample: 10, earlyStops: [] },
  offline: { label: 'Events and B2B', checks: [7, 14], decideDay: 28, minSample: 5, earlyStops: [] },
  tracking: { label: 'Tracking and measurement', checks: [1, 7], decideDay: 14, minSample: 0, earlyStops: [{ rule: 'Orders stop arriving in the data after the change', at: 1, key: 'broke', action: 'revert' }] },
  strategy: { label: 'Strategy', checks: [30, 60], decideDay: 90, minSample: 0, earlyStops: [] },
  research: { label: 'Research', checks: [7, 14, 30], decideDay: 60, minSample: 0, earlyStops: [] },
  default: { label: 'Other', checks: [3, 7], decideDay: 14, minSample: 0, earlyStops: [] } };
// family id → timing id (existing families and the new ones below)
export const FAMILY_TIMING = { paid_ads: 'paid', site: 'cro', messages: 'messages', pricing: 'offer', listings: 'listing', search: 'seo', content: 'organic', partners: 'partners',
  offline: 'offline', foundations: 'tracking', strategy: 'strategy', research: 'research', community: 'community', creators: 'creators',
  ai_search: 'aiseo', complaint_fix: 'complaint', seasonal: 'seasonal', automation: 'automation', other: 'default' };
// families Brew added with the listening loop (merged into the JSON base; a family in the JSON with the same id wins)
const NEW_FAMILIES = [
  { id: 'community', name: 'Ask the community', surface: 'research', lever: 'a question asked in a real community to learn what buyers think', metric: { key: 'useful_replies', name: 'Useful replies to the question', unit: 'count', lower: false }, goal: 'insight', scope: 'questions', fingerprint: ['ticket', 'start_date'], controls: [], ceiling: 'D', claims: false, how: { children: 'Counted by the replies, and by the moves the replies lead to' }, guard: ['The community’s rules are followed', 'Brand affiliation is disclosed where the rules ask'], sources: ['listen'], sectors: [], moves: [], words: ['ask the community', 'ask in', 'community question', 'subreddit', 'forum', 'poll'] },
  { id: 'creators', name: 'Creators', surface: 'partners', lever: 'product seeded to, or paid work with, people already posting about the category', metric: { key: 'creator_orders', name: 'Orders from creator codes and links', unit: 'count', lower: false }, goal: 'acquisition', scope: 'codes', fingerprint: ['ticket', 'code', 'utm', 'start_date'], controls: ['tagged', 'prepost'], ceiling: 'C', claims: true, how: { tagged: 'Orders on each creator’s code or link' }, guard: ['Every post carries the paid-partnership label', 'Claims stay inside the claims ledger'], sources: ['shopify', 'report'], sectors: [], moves: [25], words: ['creator', 'influencer', 'seeding', 'ugc creator', 'ambassador', 'affiliate code'] },
  { id: 'ai_search', name: 'AI answers', surface: 'search', lever: 'answers, pages and facts that AI assistants read and cite', metric: { key: 'ai_named', name: 'Buyer questions where AI names the brand', unit: '%', lower: false }, goal: 'discovery', scope: 'questions', fingerprint: ['ticket', 'page_list', 'start_date'], controls: ['did', 'prepost'], ceiling: 'B', claims: true, how: { did: 'The questions we answered against the ones we did not touch', prepost: 'The same fixed questions, asked the same way every week' }, guard: ['Claims are quoted correctly'], sources: ['report'], sectors: ['visibility'], moves: [15], words: ['ai answer', 'chatgpt', 'perplexity', 'gemini', 'ai overview', 'llms.txt', 'ai search', 'cited'] },
  { id: 'complaint_fix', name: 'Complaint fix', surface: 'site', lever: 'fixing what people keep complaining about, and saying so', metric: { key: 'complaint_share', name: 'Share of mentions about the complaint', unit: '%', lower: true }, alt: [{ key: 'rating', name: 'Average rating', unit: 'count' }], goal: 'retention', scope: 'products', fingerprint: ['ticket', 'product_list', 'start_date'], controls: ['did', 'prepost'], ceiling: 'B', claims: true, how: { did: 'The fixed products against the ones left as they were', prepost: 'The complaint’s share of mentions, before and after' }, guard: ['Returns do not rise'], sources: ['listen', 'reviews'], sectors: [], moves: [], words: ['complaint', 'fix the', 'sizing', 'returns', 'refund', 'delivery delay', 'faq'] },
  { id: 'seasonal', name: 'Seasonal and festival', surface: 'ads', lever: 'creative, offer, stock and ads planned for a dated event', metric: { key: 'event_revenue', name: 'Revenue in the event window vs the same window last year', unit: 'money', lower: false }, goal: 'revenue', scope: 'campaigns', fingerprint: ['ticket', 'campaign_name', 'code', 'start_date'], controls: ['tagged', 'prepost'], ceiling: 'C', claims: true, how: { tagged: 'Orders on the event’s code and campaign', prepost: 'The event window against the same window last year' }, guard: ['Hero stock covers the window', 'Margin per order holds'], sources: ['shopify', 'meta'], sectors: [], moves: [], words: ['diwali', 'black friday', 'christmas', 'festival', 'festive', 'holiday', 'season', 'sale window', 'mother’s day', 'eid', 'rakhi'] },
  { id: 'automation', name: 'Automations', surface: 'messages', lever: 'a standing rule that acts on its own when a signal fires (weather, stock, reorder day, a theme spiking)', metric: { key: 'auto_rev', name: 'Revenue from the automation, rolling 28 days', unit: 'money', lower: false }, goal: 'revenue', scope: 'audience', fingerprint: ['ticket', 'campaign_name', 'utm', 'start_date'], controls: ['holdout', 'tagged', 'prepost'], ceiling: 'A', claims: true, how: { holdout: 'A share of the times it fires, nothing is sent', tagged: 'Orders on the automation’s tracked link' }, guard: ['It fires within the planned rate', 'Spend stays inside the weekly limit'], sources: ['shopify', 'klaviyo', 'meta'], sectors: [], moves: [], words: ['automation', 'trigger', 'when the weather', 'rule', 'always on', 'routine', 'auto-run'] }];
for (const f of NEW_FAMILIES) if (!BASE.families.some((x) => x.id === f.id)) BASE.families.splice(BASE.families.findIndex((x) => x.id === 'other'), 0, f);
// a move claimed by a new family leaves the old one (25 moves from content to creators, 15 from search to AI answers)
for (const f of NEW_FAMILIES) for (const n of f.moves) for (const g of BASE.families) if (g.id !== f.id && (g.moves || []).includes(n)) g.moves = g.moves.filter((x) => x !== n);
// the timing of a family (or a timing id), with window/minDays derived for the code that still reads them
export function timingOf(familyOrId) {
  const id = typeof familyOrId === 'string' ? familyOrId : familyOrId?.id;
  const own = typeof familyOrId === 'object' && +familyOrId?.window > 0 && !FAMILY_TIMING[id] && !TIMINGS[familyOrId.timing] ? { label: familyOrId.name, checks: [Math.max(1, Math.round(familyOrId.window / 4)), Math.max(2, Math.round(familyOrId.window / 2))], decideDay: +familyOrId.window, minSample: 0, earlyStops: [] } : null; // an admin-approved family keeps its own window
  const tm = own || TIMINGS[familyOrId?.timing] || TIMINGS[FAMILY_TIMING[id]] || TIMINGS[id] || TIMINGS.default;
  const checks = [...tm.checks].filter((d) => d <= (tm.maxDay || tm.decideDay)).sort((a, b) => a - b);
  const window = tm.decideDay, minDays = tm.minDays || Math.max(1, checks.filter((d) => d < window).pop() || Math.round(window / 2));
  return { id: FAMILY_TIMING[id] || (TIMINGS[id] ? id : 'default'), ...tm, checks, window, minDays };
}
// "Checks on day 1, 3 and 7; decides on day 14" — what a move document and a card print
export function timingLine(familyOrId) {
  const t = timingOf(familyOrId), and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : String(xs[0]));
  const checks = t.daily ? 'every day inside the event window' : t.weekly ? `every week (day ${and(t.checks.slice(0, 4))}${t.checks.length > 4 ? ', …' : ''})` : `on day ${and(t.checks)}`;
  const decide = t.untilSample ? `decides once the sample is reached, in whole weeks, never before day ${t.minDays}` : t.afterEvent ? `decides ${t.afterEvent} days after the event ends, against ${t.compare}` : t.afterEnd ? `decides on day ${t.decideDay} and again ${t.afterEnd} days after the offer ends` : t.maxDay ? `decides between day ${t.decideDay} and day ${t.maxDay}` : t.rolling ? `decides on a rolling ${t.rolling}-day window` : `decides on day ${t.decideDay}`;
  const stops = (t.earlyStops || []).map((s) => `${s.rule} (day ${s.at})`).join('; ');
  return `Checks ${checks}; ${decide}.${stops ? ` Early stop: ${stops}.` : ''}`;
}
const GLOBAL = '_brew', EXTRA = 'measure-families.extra.json'; // admin-approved families and pending proposals, shared by every brand

export function createFamilies({ packs, claudeTool, isMock = () => false, log = console } = {}) {
  let extra = { approved: [], proposals: [], others: {} };
  const load = packs?.getJSON ? packs.getJSON(GLOBAL, EXTRA, null).then((x) => { if (x) extra = { approved: [], proposals: [], others: {}, ...x }; }).catch(() => {}) : Promise.resolve();
  const persist = () => packs?.put?.(GLOBAL, EXTRA, extra).catch((e) => log.warn('[families] save', e.message));
  const all = () => [...BASE.families.filter((f) => f.id !== 'other'), ...extra.approved, BASE.families.find((f) => f.id === 'other')];
  const byId = (id) => all().find((f) => f.id === id) || all().find((f) => f.id === 'other');
  const goalName = (g) => BASE.goals[g] || g;

  /* ---------- deciding the family ---------- */
  const moveOf = (c) => { const m = String(c?.id || '').match(/^m(\d{2})-/) || String(c?.src || '').match(/\bMove (\d{1,2})\b/); return m ? +m[1] : null; };
  const textOf = (c) => [c?.title, c?.sub, c?.cta?.label || c?.cta, ...(c?.detail?.how || []), ...(c?.rows || []).flat()].filter(Boolean).join(' ').toLowerCase();
  const score = (f, txt) => (f.words || []).reduce((a, w) => a + (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(txt) ? (w.includes(' ') ? 2 : 1) : 0), 0);
  // cheap and deterministic first: the card's own words beat its sector (a "creatives" card can be about a price);
  // the move it came from is the tie-breaker. Only a card nothing matches asks the AI.
  /* the AI reads every card once (words alone mistake "check the Meta purchase event" for an ad); kept per card text, so every workspace of a brand shares it */
  const AI_SEEN = new Map(), cardKey = (c) => `${c?.id}|${c?.title}`;
  const classify = (c) => {
    if (c?.mf?.family && ['ai', 'jam'].includes(c.mf.by) && byId(c.mf.family).id === c.mf.family) return c.mf;
    const hit = c && AI_SEEN.get(cardKey(c)); if (hit) { c.mf = { ...hit }; return c.mf; }
    if (c?.mf?.family && byId(c.mf.family).id === c.mf.family) return c.mf;
    const txt = textOf(c), n = moveOf(c);
    const title = String(c?.title || '').toLowerCase(); /* the title says what the card does: its words count twice */
    const ranked = all().filter((f) => f.id !== 'other').map((f) => ({ f, s: score(f, txt) + score(f, title) + ((f.sectors || []).includes(c?.sector) ? 1.5 : 0) + (n != null && (f.moves || []).includes(n) ? 2.5 : 0) })).sort((a, b) => b.s - a.s);
    const top = ranked[0], second = ranked[1];
    if (top && top.s >= 2) return { family: top.f.id, by: top.s - (second?.s || 0) >= 1 ? 'words' : 'words-close', sure: top.s - (second?.s || 0) >= 1 ? 'high' : 'low' };
    if (top && top.s > 0) return { family: top.f.id, by: 'weak', sure: 'low' };
    return { family: 'other', by: 'none', sure: 'low' };
  };
  // the AI pass: one short schema-bound call, kept on the card (never re-asked). Also names the lever and surface,
  // which is how repeats of the same "Other" are noticed
  const SCHEMA = { type: 'object', properties: {
    family: { type: 'string', enum: [] }, lever: { type: 'string', description: 'What the action changes, 2 to 5 words' },
    surface: { type: 'string', description: 'Where it happens, 1 to 3 words: ads, site, messages, price, listings, search, content, partners, offline, data, strategy, research, or another word' },
    tool: { type: 'string', enum: ['meta', 'google', 'shopify', 'klaviyo', 'whatsapp', 'reviews', 'marketplaces', 'none'], description: 'Where the action itself is done: meta = Meta/Instagram ads or posts, google = Google Ads, shopify = the store (pages, products, prices, discounts, theme), klaviyo = email, whatsapp = WhatsApp messages, reviews = the reviews app, marketplaces = Amazon/Myntra/Nykaa listings. none = a decision, research, tracking setup, or people work (a shoot, outreach, events, creators, PR)' } }, required: ['family', 'lever', 'surface', 'tool'] };
  const aiClassify = async (c) => {
    if (!claudeTool || isMock()) return null;
    const fams = all(); const schema = JSON.parse(JSON.stringify(SCHEMA)); schema.properties.family.enum = fams.map((f) => f.id);
    const list = fams.map((f) => `- ${f.id}: ${f.name}. ${f.lever}`).join('\n');
    const r = await claudeTool(`Which kind of marketing action is this card? Pick the family by what the action changes, not by the words it uses.\n\nFamilies:\n${list}\n\nCard:\nTitle: ${c.title}\nBody: ${c.sub || ''}\nAction: ${c.cta?.label || ''}\nSector: ${c.sector || ''}`, schema, 300, 'measure-family');
    return r?.family ? { family: r.family, lever: String(r.lever || '').slice(0, 60), surface: String(r.surface || '').toLowerCase().slice(0, 30), tool: r.tool || null, by: 'ai', sure: 'high' } : null;
  };
  // the family for a card, settled once: deterministic when sure, the AI when not, Other noted for repeats
  const settle = async (c) => {
    if (c.mf?.by === 'ai' || c.mf?.by === 'jam') return c.mf;
    const key = cardKey(c); if (AI_SEEN.has(key)) { c.mf = { ...AI_SEEN.get(key) }; return c.mf; }
    let mf = classify(c);
    const ai = await aiClassify(c).catch((e) => { log.warn('[families] ai', e.message); return null; }); if (ai) { mf = ai; AI_SEEN.set(key, ai); if (AI_SEEN.size > 5000) AI_SEEN.delete(AI_SEEN.keys().next().value); }
    c.mf = mf;
    if (mf.family === 'other') noteOther(c, mf);
    return mf;
  };

  /* ---------- the recipe a card shows: "How we'll know" ---------- */
  const recipeOf = (familyId, over = {}) => {
    const f = byId(familyId), metric = { ...f.metric, ...(over.metric || {}) }, best = f.controls?.[0] || null;
    return { family: f.id, name: f.name, goal: f.goal, goalName: goalName(f.goal), claims: f.claims !== false, metric, alt: f.alt || [],
      controls: f.controls || [], best, bestGrade: best ? METHOD_GRADE[best] : 'D', ceiling: f.ceiling || 'D',
      how: Object.fromEntries((f.controls || []).map((k) => [k, f.how?.[k] || METHOD_NAME[k]])), children: !!f.how?.children && !(f.controls || []).length,
      stepUp: best ? (f.how?.[best] || STEP_UP[best]) : null, fingerprint: f.fingerprint || ['ticket'], scope: f.scope, ...(() => { const tm = timingOf(f); return { window: tm.window, minDays: tm.minDays, timing: tm, timingLine: timingLine(f) }; })(),
      guard: f.guard || [], sources: f.sources || [] };
  };

  /* ---------- Other: noticed, counted, and turned into a proposal for a Brew admin ---------- */
  const keyOf = (mf) => `${(mf.surface || 'other').trim()}|${String(mf.lever || '').toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).slice(0, 3).join(' ')}`;
  const noteOther = (c, mf) => {
    const k = keyOf(mf); const o = (extra.others[k] ||= { surface: mf.surface || 'other', lever: mf.lever || '', n: 0, cards: [] });
    if (o.cards.some((x) => x.id === c.id)) return; o.n++; o.cards.push({ id: c.id, title: String(c.title || '').slice(0, 90) }); o.cards = o.cards.slice(-12);
    if (o.n >= 3 && !extra.proposals.some((p) => p.key === k) && !extra.approved.some((f) => f.fromKey === k)) propose(k, o).catch((e) => log.warn('[families] propose', e.message));
    persist();
  };
  const FAM_SCHEMA = { type: 'object', properties: {
    id: { type: 'string', description: 'snake_case, 1 to 3 words' }, name: { type: 'string', description: 'Up to 4 words' }, lever: { type: 'string' },
    metric: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' }, unit: { type: 'string', enum: ['money', '%', 'count', 'x', 'rank'] }, lower: { type: 'boolean' } }, required: ['key', 'name', 'unit', 'lower'] },
    goal: { type: 'string', enum: Object.keys(BASE.goals) }, scope: { type: 'string', enum: BASE.blocks.scope },
    fingerprint: { type: 'array', items: { type: 'string', enum: BASE.blocks.fingerprint } }, controls: { type: 'array', items: { type: 'string', enum: BASE.blocks.controls } },
    window: { type: 'integer' }, why: { type: 'string', description: 'One sentence: why these cards need their own family' } },
    required: ['id', 'name', 'lever', 'metric', 'goal', 'scope', 'fingerprint', 'controls', 'window', 'why'] };
  const propose = async (k, o) => {
    let draft = null;
    if (claudeTool && !isMock()) draft = await claudeTool(`These cards fit none of the measurement families. Draft one new family, built only from the allowed blocks, with the single closest number this kind of action can move and the strongest comparison it allows (controls strongest first).\n\nCards (${o.surface}, ${o.lever}):\n${o.cards.map((c) => `- ${c.title}`).join('\n')}\n\nExisting families:\n${all().map((f) => `- ${f.id}: ${f.lever}`).join('\n')}`, FAM_SCHEMA, 900, 'measure-family-propose');
    draft ||= { id: k.replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'new_family', name: o.lever || o.surface, lever: o.lever, metric: { key: 'custom', name: 'Picked in the jam', unit: 'count', lower: false }, goal: 'custom', scope: 'none', fingerprint: ['ticket', 'start_date'], controls: ['prepost'], window: 14, why: `${o.n} cards like this so far` };
    extra.proposals.push({ key: k, at: Date.now(), n: o.n, cards: o.cards, draft });
    log.log?.(`[families] proposed "${draft.name}" from ${o.n} Other cards`);
    persist();
  };
  // approving: the family joins the list, ceiling from its strongest comparison; the cards that were Other move into it
  const approve = (key, edits = {}) => {
    const p = extra.proposals.find((x) => x.key === key); if (!p) return null;
    const d = { ...p.draft, ...edits }, best = d.controls?.[0];
    const fam = { ...d, surface: extra.others[key]?.surface || 'other', ceiling: best ? METHOD_GRADE[best] : 'D', minDays: Math.max(3, Math.round((d.window || 14) / 2)), claims: !['enabling', 'direction', 'insight'].includes(d.goal), words: String(d.lever || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3), sectors: [], moves: [], sources: ['report'], fromKey: key, approvedAt: Date.now() };
    if (all().some((f) => f.id === fam.id)) fam.id = `${fam.id}_${extra.approved.length + 2}`;
    extra.approved.push(fam); extra.proposals = extra.proposals.filter((x) => x.key !== key);
    const moved = (extra.others[key]?.cards || []).map((c) => c.id); delete extra.others[key];
    persist(); return { family: fam, moved };
  };
  const reject = (key) => { extra.proposals = extra.proposals.filter((x) => x.key !== key); persist(); };
  const state = () => ({ families: all().map((f) => ({ id: f.id, name: f.name, goal: f.goal, ceiling: f.ceiling, metric: f.metric.name, approved: !!f.approvedAt })), proposals: extra.proposals, others: extra.others });

  return { ready: load, all, byId, goalName, classify, settle, aiClassify, recipeOf, approve, reject, state, moveOf, BASE, timingOf, timingLine };
}
