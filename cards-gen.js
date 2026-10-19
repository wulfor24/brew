// Feed cards from a finished move: 1 or 2 cards in the v1 card shape, plus the move's short labels.
// Same rules as the first hand-built feed: the title is the point, the sub is two sentences (25-35 words:
// what we saw with the number, then the move and what it gets the brand), every number is in the fact sheet.
import { numbersOf, dayOf } from './pack-numbers.js'; // one number, one source
import { mockAllowed } from './ai.js'; // a mock card stands in only on a mock run, never after a billing pause
import { unbacked, allowedFrom, numbersIn, backedNumbers } from './fact-gate.js';
import { CTA } from './seed-template.js';
import * as catalog from './creative-catalog.js'; /* what can be made: formats, the prompt block, generic and repeat checks */
import { evidenceKinds, claimGaps, gapLine, writerEvidence } from './proof-logic.js'; /* a card says Brew saw only what Brew holds */

const SECTOR = { know: ['signals', 'brew'], found: ['visibility', 'visibility'], reach: ['creatives', 'creative'], convert: ['storefront', 'storefront'], keep: ['signals', 'crm'], expand: ['signals', 'brew'] };
const BY_SKILL = { ads: ['ads', 'performance'], analytics: ['ads', 'performance'], attribution: ['ads', 'performance'], 'ab-testing': ['storefront', 'storefront'], aso: ['catalog', 'storefront'], 'seo-audit': ['visibility', 'visibility'], schema: ['visibility', 'visibility'], 'ai-seo': ['visibility', 'visibility'], 'site-architecture': ['storefront', 'storefront'], 'programmatic-seo': ['visibility', 'visibility'], pricing: ['storefront', 'storefront'], offers: ['storefront', 'storefront'], 'competitor-profiling': ['signals', 'brew'], competitors: ['visibility', 'visibility'] };
const ROLES = { signals: ['founder', 'crm', 'growth'], ads: ['growth', 'founder'], creatives: ['brand', 'growth'], storefront: ['ecom', 'founder'], catalog: ['ecom', 'growth'], visibility: ['brand', 'ecom', 'founder'] };
// what a card can ask to be made, and the button that makes it in the studio
const MAKE_FORMATS = catalog.formats(); /* the catalog's families (data/creative-catalog.json): the same 13 names as before, so saved packs still map */
/* a format the writer names (a family, or a Sloosh Space or model from the catalog) → the family the card carries; null when it is none of them or "other" */
const toFamily = (f) => { const fam = catalog.familyOf(f); return fam && fam !== 'other' ? fam : null; };
const MAKE_CTA = { 'single image ad': 'Generate versions', 'carousel ad': 'Make the carousel ad', 'collection ad': 'Build the collection ad', 'catalog ad': 'Build the catalog ad', 'video ad': 'Make the video', reel: 'Make the video', 'instagram post': 'Draft the post', 'instagram carousel': 'Draft the carousel post', 'instagram stories': 'Draft the stories', 'whatsapp message': 'Approve the flows', email: 'Approve the flows', 'page section': 'Update landing page' };
/* the button follows what the card asks to be made. Cause of "Draft the post" on a page card: the old rule kept any
   button that mentioned a post, carousel or video, so a page section kept the AI's social-post button. Now a making
   button of another format is replaced by the one for the planned format; a non-making button (a decision, a spend,
   "Publish the page") is the card's own choice and stays. Used when cards are written and when packs load. */
const OTHER_NETWORK = new Set(['Launch the ad group']);
const MAKE_LABELS = new Set([...Object.values(MAKE_CTA), 'Draft the post', 'Draft the carousel post', 'Draft the stories', 'Make the video', 'Generate versions']);
export function fitCta(card) {
  const want = card?.make?.format && MAKE_CTA[card.make.format], cur = card?.cta?.label;
  /* a Google search button ("Launch the ad group") on a card that makes a Meta or social asset promises the wrong thing: the format's own button */
  const wrongNet = OTHER_NETWORK.has(cur) && MAKES_CREATIVE.test(card?.make?.format || '');
  if (want && CTA[want] && cur !== want && (!cur || MAKE_LABELS.has(cur) || wrongNet)) card.cta = { ...(card.cta || {}), label: want };
  return card;
}
/* a card that names an asset carries what to make. Old packs were written before every such card set "make", so cards
   missing it get one at load from their own words (title, sub, button). Generic for every brand: the most specific
   format wins (a WhatsApp message before an ad, a carousel ad before a plain ad); reports, rival readings, live account
   cards and progress cards are left alone, and a card that only talks about an ad (pause it, its spend, a rival's) gets none */
const CTA_MAKE = { 'Make the carousel ad': 'carousel ad', 'Build the collection ad': 'collection ad', 'Build the catalog ad': 'catalog ad', 'Draft the post': 'instagram post', 'Draft the carousel post': 'instagram carousel', 'Draft the stories': 'instagram stories', 'Update landing page': 'page section' };
const MAKE_RE = [
  ['whatsapp message', /\bwhats\s?app\b|\bsms\b|\btext (?:customers|buyers|shoppers|them|every buyer)\b/i],
  ['email', /\be-?mails?\b|\bnewsletters?\b|\b(?:win-?back|welcome|abandon(?:ed)?[- ]cart|post-?purchase|review[- ]ask) (?:flow|sequence|series)\b/i],
  ['reel', /\breels?\b|\btik\s?toks?\b|\bshorts\b/i],
  ['instagram stories', /\b(?:instagram|ig|insta)\s+stor(?:y|ies)\b|\bstories (?:ad|ads|set|frames?|sequence)\b|\b\d+\s+stories\b/i],
  ['carousel ad', /\bcarousel\b(?=[\s\S]*\b(?:ads?|paid|meta|facebook|campaign)\b)|\b(?:ads?|paid|meta|facebook|campaign)\b[\s\S]*\bcarousel\b/i],
  ['instagram carousel', /\bcarousels?\b/i],
  ['collection ad', /\bcollection ads?\b/i],
  ['catalog ad', /\b(?:catalog(?:ue)?|dynamic product|dpa|advantage\+? (?:shopping|catalog))\s+ads?\b/i],
  ['video ad', /\b(?:video|ugc)\s+(?:ads?|cuts?|spots?)\b|\bvideos?\b(?=[\s\S]*\bads?\b)/i],
  ['reel', /\b(?:videos?|clips?)\b/i],
  ['page section', /\b(?:landing|product|collection|sold-?out|comparison|compare|launch|vs)\s+pages?\b|\b(?:pdp|homepage|home page|hero section|faq section|size guide|fit guide|page section|above add to cart)\b/i],
  ['instagram post', /\b(?:instagram|ig|insta|social)\s+posts?\b|\bpost (?:it|this|one) on instagram\b/i],
  ['single image ad', /\b(?:new|an?|one|fresh|static|image|meta|facebook|instagram|ig|cold|paid|test|run|write|make|launch|draft|lead(?:s|ing)? the|hook(?:s)? (?:for|in) the)\s+(?:\w+\s+)?ads?\b(?!\s*(?:spend|account|accounts|budget|library|manager|group|set|sets|platform|tracking|pixel|price))/i]
];
const NO_MAKE = /^(build-|statics-batch$|story-|live-|read-|heard-)/;
/* buttons that decide, fix or open something: such a card is not asking for an asset, whatever its words mention */
const NOT_MAKING = new Set(['Fix tracking', 'Agree with the call', 'Open the moves', 'Open the scoreboard', 'Shift budget', 'Fix the markup', 'Push the titles', 'Launch the ad group', 'Turn on guest checkout', 'Publish the claims ledger', 'Shortlist creators', 'Draft the buyer deck', 'Brief the shoot', 'Open report', 'Approve the offers']);
/* buttons that ship an asset: the body may say which, and with nothing named the button's own format is used (flows and journeys name theirs) */
const CTA_DEFAULT = { 'Send the review ask': 'email', 'Make the video': 'reel', 'Generate versions': 'single image ad', 'Rotate creative': 'single image ad', 'Queue the ads': 'single image ad', 'Publish Campaign': 'single image ad', 'Make our version': 'single image ad', 'Approve the flows': null, 'Turn on the journey': null, 'Publish the page': 'page section', 'Draft the listing': 'page section' };
const TALKS_ABOUT = /\b(?:pause|stop|kill|cut|turn off|switch off|audit|check|fix|track|measure|count|confirm|install|restart|rival'?s?|competitor'?s?)\b[^.]{0,30}\bads?\b/i;
const formatIn = (text) => { for (const [format, re] of MAKE_RE) { if (!re.test(text)) continue; if (format === 'single image ad' && TALKS_ABOUT.test(text) && !/\b(?:new|write|make|draft|launch)\b/i.test(text)) return null; return format; } return null; };
export function inferMake(c = {}) {
  if (!c || typeof c !== 'object' || c.make?.format || NO_MAKE.test(String(c.id || '')) || c.liveOnly || c.mock || c.demo || ['report', 'competitor'].includes(c.type) || (c.origin === 'listen' && c.heard)) return null;
  const cta = c.cta?.label || ''; if (CTA_MAKE[cta]) return { format: toFamily(formatIn(c.title || '')) || CTA_MAKE[cta], pieces: '', inferred: true }; /* the title's own format is more exact than a making button */
  if (NOT_MAKING.has(cta)) return null;
  const f = toFamily(formatIn(c.title || '') || (cta in CTA_DEFAULT ? formatIn(c.sub || '') || CTA_DEFAULT[cta] : null)); /* the title names it; the body only counts under a button that ships something; only a catalog family is ever set */
  return f ? { format: f, pieces: '', inferred: true } : null;
}
/* an ad or a social post reaches every seat that makes or approves creative, the founder included: its roles were set from
   the move's area before the format moved it to creatives, so a founder-only seat never saw ad and post cards */
const MAKES_CREATIVE = /carousel|collection|catalog|instagram|reel|video|image ad/;
export const fitRoles = (c) => (c?.make?.format && MAKES_CREATIVE.test(c.make.format) ? { ...c, roles: [...new Set([...(c.roles || []), ...ROLES.creatives, 'founder'])] } : c);
/* at pack load: the card gets the back-filled "make" (never replacing one it has), and the roles its format needs */
export const fillMake = (c) => { const m = inferMake(c); return fitRoles(m ? { ...c, make: m } : c); };
const LEAK = /\b(?:typeface|font|kerning|letter-?spacing|#[0-9a-f]{6}|Move \d+ of 50)\b/i;

const SCHEMA = {
  type: 'object', properties: {
    label: { type: 'object', properties: { short: { type: 'string', description: 'Up to 26 characters: what this plan is, in plain words' }, line: { type: 'string', description: 'Up to 110 characters: what it gets the brand' } } },
    cards: { type: 'array', description: '1 or 2 cards', items: { type: 'object', properties: {
      type: { type: 'string', enum: ['idea', 'decision', 'report', 'competitor'] },
      title: { type: 'string', description: 'Under 60 characters, the point first, plain words, at most one number' },
      sub: { type: 'string', description: 'Exactly two sentences, 25 to 35 words: what we saw, with the number, then the move and what it gets the brand' },
      why: { type: 'array', items: { type: 'string' }, description: '3 short reasons, each under 14 words, from the move' },
      how: { type: 'array', items: { type: 'string' }, description: '3 steps, each under 12 words' },
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '0 to 5 [label, value] pairs from the move, values short; empty when the card is an idea' },
      cta: { type: 'string', enum: Object.keys(CTA) },
      make: { type: 'object', description: 'Required when the card asks for something to be made or its title, body or button names an ad, email, reel, video, post, carousel, Stories, WhatsApp message or page: the format and the pieces in it. Omit only for reports and plans that make nothing', properties: {
        format: { type: 'string', enum: MAKE_FORMATS, description: 'A family from WHAT CAN BE MADE' },
        pieces: { type: 'string', description: 'Under 90 characters: a concrete asset from the catalog: format, the exact product as the store lists it, the scene or angle, the hook; e.g. "6 slides: the fit room, one body type per slide". Never starts with the format’s own name or a URL path. Never a generic ad ("a new ad", "fresh creative", "some visuals")' },
        backedBy: { type: 'string', description: 'Under 60 characters: which of the brand\'s own lines this asset rests on: a fact sheet line, the brand style, a team learning, a ledger line or a listening line, named' } } },
      plan: { type: 'array', items: { type: 'string' }, description: '3 to 5 ground-work steps toward the card’s button, in order, each under 14 words, naming the real ads, products, pages or people from the move (e.g. "Pick the two winning ads: Fit room and Rain test", "Write 3 new hooks per winner", "Make the carousels", "Review them", "Ready to launch on Meta or hand to the team"). The last step is ready to deploy or hand to the team. Never a step that says it is decided or done.' },
      section: { type: 'string', description: 'The move section heading this card comes from' }
    } } }
  }
};

/* observed ledger values back a card's numbers; inferred ones never do */
export const ledgerNums = (ledger = []) => { const ok = new Set(); for (const e of ledger || []) { if (!e || e.layer === 'inferred' || e.demo) continue; numbersIn(e.v, { strict: true }).forEach((n) => ok.add(n)); if (Number.isFinite(e.n) && e.unit && /^[A-Z]{3}$/.test(e.unit)) numbersIn(`${e.unit} ${e.n}`).forEach((n) => ok.add(n)); } return ok; };
/* the numbers in what was read: as written, and a bare price ("mrp": 4999) in the currency the read prints */
export const readNums = (ev) => { const all = numbersIn(ev, { strict: true }), ok = new Set(all), syms = new Set(all.map((n) => (n.match(/^([^\d]+)\d/) || [])[1]).filter(Boolean));
  for (const v of String(ev).match(/(?<=[:\[,]\s?)\d+(?:\.\d+)?(?=[,\]}])/g) || []) { ok.add(String(+v)); for (const sy of syms) ok.add(sy + String(+v)); } return ok; };
/* the read cards say the day of the read ("Read from acme.in on 16 Oct"), never a frozen "today" */
export const readSrc = (host, readAt) => `Read from ${host} on ${dayOf(readAt || Date.now())}`;
/* the reviews a writer may point at, the way the proof sheet reads them (feed-service voiceOf): text, stars, product */
export const voiceOfProfile = (p) => [...(p?.reviews?.quotes || []), ...(p?.reviews?.recent || [])].filter((q) => q?.text && String(q.text).length > 20).slice(0, 80)
  .map((q) => ({ kind: 'review', text: q.text, title: q.title || null, rating: q.rating || null, product: q.product || null }));
/* the observation a card makes (its body's first sentence, and its title) checked against what Brew holds (proof-logic.js) */
export const cardGaps = (c, kinds) => { const g = [...claimGaps(String(c.sub || '').split(/(?<=[.!?])\s+/)[0], kinds), ...claimGaps(c.title, kinds)]; return g.filter((x, i) => g.findIndex((y) => y.kind === x.kind) === i); };
const FIX_SCHEMA = { type: 'object', properties: { cards: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, sub: { type: 'string' } }, required: ['id', 'title', 'sub'] } } }, required: ['cards'] };
export function createCardsGen({ ai, log = console }) {
  // move → { cards, label }; facts is the brand fact sheet (factsFromLedger)
  async function fromMove(move, { brand, facts, lanes, laneImg, spec, ledger = [], profile = null, config = null, learned = null, seen = [], voice = null }) { /* profile, learned (learned.json) and seen (cards already in the feed) are optional: callers that pass them get style-, learning- and repeat-aware cards */
    const [sector0, agent0] = BY_SKILL[spec?.skill] || SECTOR[spec?.group || move.group] || ['signals', 'brew'];
    const ok = allowedFrom(facts), fromLedger = ledgerNums(ledger);
    /* numbers the move states as observed are allowed too (they carry their own citation in the move); a number the
       move marks "to confirm", or gives as a target, assumption or example, is not (fact-gate.js backedNumbers) */
    const moveNums = backedNumbers(move);
    /* what Brew holds for the brand (reviews and their stars, threads, connected accounts, search data): the card may say Brew saw only those (Param, 19 Oct) */
    const kinds = evidenceKinds({ voice: voice || voiceOfProfile(profile), ledger, facts, sources: move.sources || [] });
    const factList = Object.values(facts).slice(0, 120).map((f) => `- ${f.label}: ${f.v}`).join('\n');
    /* the catalog's examples read with the brand's own hero product; the team's style, learnings and listening lines are named so the writer can cite them */
    /* the hero rotates move by move over the lead in-stock products: one fixed hero put the same product on every card */
    const inStock = (profile?.catalog?.products || []).filter((x) => x?.title && x.inStock !== false).slice(0, 8);
    const heroName = inStock.length ? inStock[(+move.n || 0) % inStock.length].title.split(/\s+[–—|:-]\s+|,\s/)[0] : null;
    const st = config?.product || profile?.config?.product || {}; /* config.json product.style / look / avoid */
    const styleLine = st.style || st.look ? ` ("${[st.style, st.look].filter(Boolean).join('; ')}"${st.avoid ? `; avoid: ${st.avoid}` : ''})` : '';
    const learnList = [...(learned?.facts || []), ...(learned?.beliefs || []), ...(learned?.tried || [])].map((l) => l?.text).filter(Boolean).slice(0, 8);
    const learnLine = learnList.length ? ` (the team told us: ${learnList.map((t) => `"${String(t).slice(0, 120)}"`).join('; ')})` : '';
    const listenList = (ledger || []).filter((e) => e?.signal && e.v).slice(0, 6).map((e) => String(e.v).slice(0, 100));
    const listenLine = listenList.length ? ` (heard: ${listenList.map((t) => `"${t}"`).join('; ')})` : '';
    const seenKeys = (seen || []).filter((c) => c?.make?.format).slice(0, 40).map((c) => `${c.make.format}: ${String(c.make.pieces || c.title || '').slice(0, 70)}`);
    const seenLine = seenKeys.length ? `already in the feed, do not repeat: ${seenKeys.join(' / ')}.` : 'this move\'s cards differ from each other in format and angle.';
    const text = (move.sections || []).map((s) => `## ${s.h}\n` + (s.blocks || []).map((b) => b.t === 'table' ? [b.head, ...(b.rows || [])].map((r) => (r || []).join(' | ')).join('\n') : b.t === 'list' ? (b.items || []).map((x) => '- ' + x).join('\n') : b.t === 'example' ? `[${b.title}] ${b.body}` : b.text || '').join('\n')).join('\n\n').slice(0, 24000);
    const prompt = `You turn one Brew strategy document ("move") for ${brand.name} (${brand.host}) into feed cards for the brand's team.

THE MOVE: Move ${String(move.n).padStart(2, '0')} · ${move.title}
What it gives: ${move.gives}
Live in 30 days: ${move.live}
${text}

FACTS YOU MAY QUOTE (use these exact numbers; any other number must appear in the move above with its source):
${factList}

${writerEvidence(kinds, brand.name)}

Write 1 or 2 cards. Each card is one thing the team can act on now, taken from the move (its plan, its worked examples or a decision it asks for). Rules:
- Plain, one-glance words a busy shop owner uses when texting a friend: short sentences, the point first, what to do in everyday words. The reader must get it in two seconds with no decoding. No jargon or abbreviations (no ROAS, AOV, CAC, CTR, PDP, SKU, UGC, SERP, CRO, funnel, cohort, retargeting, cold audience, hero product, unbranded queries, lanes, gates, levers); say what they mean ("people new to the brand", "the product page", "searches that name no brand"). No "leverage", "unlock", "optimize", no em dashes.
- The title leads with what the brand gains, never the technical step: "Show your star ratings in Google and AI answers", not "Inject JSON-LD schema into the Shopify theme". JSON-LD, schema, markup, meta tags, theme files and llms.txt belong in the how-steps and the plan, never the title or body.
- Never invent a number, a quote, a result or a customer. If the move marks something "to confirm", the card says so.
- The body's first sentence says what Brew saw only of a kind WHAT BREW HOLDS lists; anything else the move reasons is said as an idea ("buyers may...", "a price this high can...").
- Never name a rival in ad copy; a card may name a rival only when it reports what that rival does.
- The card speaks to ${brand.name}'s team (internal), not to customers.
- Pick the button (cta) that does what the card asks.
- When the move plans a specific asset (a carousel, a set of Stories, a collection or catalog ad, a reel, a post), say so in "make" with the format and the pieces exactly as the move plans them, and pick the button that makes that format (carousel ad: "Make the carousel ad"; Instagram carousel: "Draft the carousel post"; Stories: "Draft the stories"; single post: "Draft the post"; collection ad: "Build the collection ad"; catalog ad: "Build the catalog ad").
- Any card whose title, body or button names an ad, an email, a reel or video, a post, a carousel, Stories, a WhatsApp message or a page must set "make" to that format, even a decision; Brew drafts it before anyone opens the card. Only a card that reports on an ad (its spend, a rival's ad, pausing one) leaves "make" out.
- The card's words and its asset agree: when "make" names a product or a scene, the title or body names that same product, and "pieces" uses the product's name exactly as the store lists it (Brew drafts the asset from it).
${catalog.promptBlock({ product: heroName })}
- Each asset is specific and makeable: pick a format from the list above and write "pieces" the way its examples read (how many, the exact product as the store lists it, the scene or angle, the hook). Never "a new ad", "fresh creative", "some visuals" or any asset with no product and no scene.
- No repeats: in one feed no two cards may share format + product + angle. Vary formats across the list (a reel after a static, a carousel after an email) and vary the product and the scene; ${seenLine}
- Each asset is backed by the brand's own context and says which in "backedBy": a fact sheet line above, the brand's own style${styleLine}, a team learning${learnLine}, a ledger line or a listening line${listenLine}. An asset nothing backs is left out.
- Also write the move's short label and one-line summary.`;
    let j;
    try { j = (await ai.call({ model: 'sonnet', prompt, schema: SCHEMA, max: 4000, tag: 'cards' })).json; }
    catch (e) { if (mockAllowed(e)) return mockCards(move, { sector0, agent0, lanes, laneImg }); throw e; }
    const laneKeys = Object.keys(lanes || {}); const lane = laneKeys[0] || 'core';
    const cards = [];
    (j.cards || []).slice(0, 2).forEach((c, i) => {
      const card = {
        id: `m${String(move.n).padStart(2, '0')}-${i + 1}`, agent: c.type === 'competitor' ? 'brew' : agent0, sector: sector0, type: c.type, lane, roles: ROLES[sector0] || ['founder'],
        src: `Move ${String(move.n).padStart(2, '0')}${c.section ? ` · ${c.section}` : ''}`, time: `${10 + i * 25 + (move.n % 7) * 9} min`,
        kind: (c.rows || []).filter((r) => r?.length >= 2).length && c.type !== 'idea' ? 'rows' : 'media',
        title: String(c.title || '').trim(), sub: String(c.sub || '').trim(),
        detail: { why: (c.why || []).slice(0, 3), how: (c.how || []).slice(0, 3) },
        cta: { label: CTA[c.cta] ? c.cta : 'Open the scoreboard' }
      };
      /* the plan the writer gave (card-plan.js keeps its words, and always the action's own make and last steps) */
      if (Array.isArray(c.plan) && c.plan.filter((x) => typeof x === 'string' && x.trim()).length >= 3) card.plan = { by: 'ai', steps: c.plan.filter((x) => typeof x === 'string' && x.trim()).slice(0, 6).map((x) => x.trim().slice(0, 120)) };
      // a card that names what to make carries it, and its button makes exactly that format
      const fam = toFamily(c.make?.format);
      if (fam) {
        card.make = { format: fam, pieces: String(c.make.pieces || '').trim().slice(0, 100), ...(c.make.backedBy ? { backedBy: String(c.make.backedBy).trim().slice(0, 80) } : {}) };
        if (catalog.isGeneric(card.make.pieces)) log.warn('[cards] generic asset', card.id, JSON.stringify(card.make.pieces)); /* the audit (tools/audit-cards.mjs) counts these per brand */
        fitCta(card);
        if (MAKES_CREATIVE.test(fam)) { card.sector = 'creatives'; if (card.agent !== 'brew') card.agent = 'creative'; Object.assign(card, fitRoles(card)); }
      }
      else { const m = inferMake(card); if (m) { card.make = { format: m.format, pieces: '' }; fitCta(card); } } /* the model left "make" out but the card names an asset */
      const rows = (c.rows || []).filter((r) => r?.length >= 2).slice(0, 5).map((r) => [String(r[0]).slice(0, 40), String(r[1]).slice(0, 48)]);
      if (card.kind === 'rows') card.rows = rows; else { const img = laneImg?.[lane] || Object.values(laneImg || {})[0]; if (img) card.images = [img]; else card.kind = 'rows', card.rows = rows; }
      // the fact gate: a number neither the fact sheet nor the move backs means the card doesn't ship
      const bad = unbacked({ title: card.title, sub: card.sub, rows: card.rows, detail: card.detail, make: card.make }, { has: (n) => ok.has(n) || moveNums.has(n) || fromLedger.has(n) }, { strict: true });
      if (bad.length) { log.warn('[cards] dropped', card.id, bad.map((b) => b.n).join(',')); return; }
      if (LEAK.test(card.title + ' ' + card.sub) || !card.title || !card.sub) return;
      cards.push(card);
    });
    await fixClaims(cards, kinds, { brand, has: (n) => ok.has(n) || moveNums.has(n) || fromLedger.has(n) });
    return { cards, label: { short: j.label?.short || move.title.slice(0, 26), line: j.label?.line || move.gives, heads: {} } };
  }
  /* a card whose observation outruns what Brew holds ("we saw high bounce" with no analytics account, "people doubt it" over happy
     reviews) gets its title and body reworded once, as an idea, in one small call for all such cards. The rewording keeps every
     number (the same fact gate) and never drops the card: with no good rewording the card keeps its words and the proof sheet says so */
  async function fixClaims(cards, kinds, { brand, has }) {
    const bad = cards.map((c) => ({ c, g: cardGaps(c, kinds) })).filter((x) => x.g.length);
    if (!bad.length) return 0;
    const prompt = `These feed cards for ${brand.name} say Brew saw something Brew does not hold. Reword each card's title and body so what Brew did not see is said as an idea ("buyers may worry...", "a price this high can make new visitors hesitate"), and what Brew does hold is named plainly. Keep the same advice, the same plain words, every number exactly as written and no new number. The body stays two sentences, 25 to 35 words: the idea or what Brew saw, then the move and what it gets the brand. The title stays under 60 characters, the point first. No em dashes.

${writerEvidence(kinds, brand.name)}

Cards:
${bad.map(({ c, g }) => JSON.stringify({ id: c.id, title: c.title, sub: c.sub, problem: g.map(gapLine).join('; ') })).join('\n')}

Return every card by its id.`;
    let j; try { j = (await ai.call({ model: 'sonnet', prompt, schema: FIX_SCHEMA, max: 1500, tag: 'cards-claims' })).json; } catch (e) { log.warn('[cards] claim fix', e.message); return 0; }
    const by = new Map((j?.cards || []).map((x) => [x.id, x])); let n = 0;
    for (const { c, g } of bad) { const x = by.get(c.id), title = String(x?.title || '').trim(), sub = String(x?.sub || '').trim();
      if (!title || !sub || LEAK.test(`${title} ${sub}`) || unbacked({ title, sub }, { has }, { strict: true }).length) continue;
      const next = { ...c, title: title.slice(0, 90), sub: sub.slice(0, 320) };
      if (cardGaps(next, kinds).length >= g.length) continue; /* only a rewording that says less than Brew holds replaces the card's words */
      c.title = next.title; c.sub = next.sub; n++; }
    log.log?.(`[cards] claim fix: ${n} of ${bad.length} reworded`);
    return n;
  }
  // the feed's first cards, from the read alone: what we saw on the site, in reviews, ads and AI answers
  async function fromRead(profile, { brand, facts, lanes, laneImg }) {
    const p = profile, ok = allowedFrom(facts), N = numbersOf({ profile: p }); /* the same counts every other screen shows (pack-numbers.js) */
    const ev = JSON.stringify({ catalog: (p.catalog?.products || []).slice(0, 12).map((x) => ({ t: x.title, price: x.priceLabel, mrp: x.mrp, stock: x.inStock, photos: (x.images || []).length, reviews: x.reviews })), count: N.products.n,
      reviews: { total: N.reviews.n, platforms: N.reviews.platforms, quotes: (p.reviews?.quotes || []).slice(0, 8) }, ads: { own: N.ownAds.n, rivals: N.rivals.map((r) => ({ name: r.name, live: r.live, hooks: ((p.ads?.rivals || []).find((x) => x.name === r.name)?.items || []).slice(0, 3).map((a) => a.hook) })) },
      ai: { score: p.ai?.score, answers: (p.ai?.answers || []).slice(0, 8).map((a) => ({ tool: a.tool, q: a.q, named: a.named, rivals: a.rivalsNamed })) }, checkout: p.site?.checkout, tech: p.site?.tech }).slice(0, 18000);
    const SCH = { type: 'object', properties: { cards: { type: 'array', items: SCHEMA.properties.cards.items } } };
    const kinds = evidenceKinds({ voice: voiceOfProfile(p), facts }); /* a first read has no connected account: no visits, carts or sales to claim */
    let j;
    try { j = (await ai.call({ model: 'sonnet', schema: SCH, max: 5000, tag: 'cards-read', prompt: `You write the first feed cards for ${brand.name} (${brand.host}), from what Brew just read on its live site, reviews, ads and AI answers.\n\nWHAT WE READ (JSON):\n${ev}\n\nFACTS YOU MAY QUOTE:\n${Object.values(facts).slice(0, 100).map((f) => `- ${f.label}: ${f.v}`).join('\n')}\n\n${writerEvidence(kinds, brand.name)}\n\nWrite 4 cards, each a real finding the team can act on today: one about AI answers (named or not, who is named instead), one about rivals' live ads, one about the catalog or checkout, one about what customers say. Only use what is in the JSON above; every number must be in it or in the facts. If a finding is missing from the JSON, skip that card. Plain one-glance words a busy shop owner uses when texting a friend, the point first, no jargon or abbreviations (no ROAS, AOV, CTR, PDP, SKU, SERP, unbranded queries), no em dashes. Pick the button that does what the card asks.\n${catalog.promptBlock({ product: (p.catalog?.products || []).find((x) => x?.title)?.title?.split(/\s+[–—|:-]\s+|,\s/)[0] || null, examples: 1 })}\nWhen a card asks for an asset, "make" names a format from that list and "pieces" reads like its examples (how many, the exact product as the store lists it, the scene, the hook), backed by a line in the JSON; never "a new ad" or "fresh creative", and no two cards share format + product + angle.` })).json; }
    catch (e) { if (mockAllowed(e)) return []; throw e; }
    const nums = readNums(ev); const lane = Object.keys(lanes || {})[0] || 'core'; const out = [];
    const SEC = (t) => /ai answer|chatgpt|gemini|perplexity|named/i.test(t) ? ['visibility', 'visibility'] : /\bads?\b|meta|rival/i.test(t) ? ['ads', 'performance'] : /review|customer|say/i.test(t) ? ['creatives', 'creative'] : ['storefront', 'storefront'];
    (j.cards || []).slice(0, 4).forEach((c, i) => {
      const [sector, agent] = SEC(`${c.title} ${c.sub}`);
      const card = { id: `read-${i + 1}`, origin: 'read', agent, sector, type: c.type, lane, roles: ROLES[sector] || ['founder'], src: readSrc(brand.host, p.meta?.readAt), time: `${4 + i * 3} min`,
        kind: (c.rows || []).filter((r) => r?.length >= 2).length ? 'rows' : 'media', title: String(c.title || '').trim(), sub: String(c.sub || '').trim(), detail: { why: (c.why || []).slice(0, 3), how: (c.how || []).slice(0, 3) }, cta: { label: CTA[c.cta] ? c.cta : 'Generate versions' } };
      const rows = (c.rows || []).filter((r) => r?.length >= 2).slice(0, 5).map((r) => [String(r[0]).slice(0, 40), String(r[1]).slice(0, 48)]);
      const fam = toFamily(c.make?.format);
      if (fam) { card.make = { format: fam, pieces: String(c.make.pieces || '').trim().slice(0, 100) }; fitCta(card); }
      if (card.kind === 'rows') card.rows = rows; else { const img = laneImg?.[lane]; if (img) card.images = [img]; else { card.kind = 'rows'; card.rows = rows; } }
      if (unbacked({ title: card.title, sub: card.sub, rows: card.rows, detail: card.detail, make: card.make }, { has: (n) => ok.has(n) || nums.has(n) }, { strict: true }).length) return;
      if (!card.title || !card.sub || LEAK.test(card.title + card.sub)) return;
      out.push(card);
    });
    await fixClaims(out, kinds, { brand, has: (n) => ok.has(n) || nums.has(n) });
    return out;
  }
  const mockCards = (move, { sector0, agent0, lanes, laneImg }) => {
    const lane = Object.keys(lanes || {})[0] || 'core';
    return { cards: [{ id: `m${String(move.n).padStart(2, '0')}-1`, agent: agent0, sector: sector0, type: 'report', lane, roles: ROLES[sector0] || ['founder'], src: `Move ${String(move.n).padStart(2, '0')}`, time: '20 min', kind: 'rows', rows: [['Move', move.title.slice(0, 40)]], title: move.title.slice(0, 60), sub: String(move.gives || '').slice(0, 220), detail: { why: [], how: [] }, cta: { label: 'Open the scoreboard' }, mock: true }], label: { short: move.title.slice(0, 26), line: move.gives, heads: {} } };
  };
  return { fromMove, fromRead };
}
