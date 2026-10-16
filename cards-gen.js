// Feed cards from a finished move: 1 or 2 cards in the v1 card shape, plus the move's short labels.
// Same rules as the first hand-built feed: the title is the point, the sub is two sentences (25-35 words:
// what we saw with the number, then the move and what it gets the brand), every number is in the fact sheet.
import { numbersOf } from './pack-numbers.js'; // one number, one source
import { unbacked, allowedFrom, numbersIn, backedNumbers } from './fact-gate.js';
import { CTA } from './seed-template.js';

const SECTOR = { know: ['signals', 'brew'], found: ['visibility', 'visibility'], reach: ['creatives', 'creative'], convert: ['storefront', 'storefront'], keep: ['signals', 'crm'], expand: ['signals', 'brew'] };
const BY_SKILL = { ads: ['ads', 'performance'], analytics: ['ads', 'performance'], attribution: ['ads', 'performance'], 'ab-testing': ['storefront', 'storefront'], aso: ['catalog', 'storefront'], 'seo-audit': ['visibility', 'visibility'], schema: ['visibility', 'visibility'], 'ai-seo': ['visibility', 'visibility'], 'site-architecture': ['storefront', 'storefront'], 'programmatic-seo': ['visibility', 'visibility'], pricing: ['storefront', 'storefront'], offers: ['storefront', 'storefront'], 'competitor-profiling': ['signals', 'brew'], competitors: ['visibility', 'visibility'] };
const ROLES = { signals: ['founder', 'crm', 'growth'], ads: ['growth', 'founder'], creatives: ['brand', 'growth'], storefront: ['ecom', 'founder'], catalog: ['ecom', 'growth'], visibility: ['brand', 'ecom', 'founder'] };
// what a card can ask to be made, and the button that makes it in the studio
const MAKE_FORMATS = ['single image ad', 'carousel ad', 'collection ad', 'catalog ad', 'video ad', 'instagram post', 'instagram carousel', 'instagram stories', 'reel', 'whatsapp message', 'email', 'page section', 'other'];
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
  const cta = c.cta?.label || ''; if (CTA_MAKE[cta]) return { format: formatIn(c.title || '') || CTA_MAKE[cta], pieces: '', inferred: true }; /* the title's own format is more exact than a making button */
  if (NOT_MAKING.has(cta)) return null;
  const f = formatIn(c.title || '') || (cta in CTA_DEFAULT ? formatIn(c.sub || '') || CTA_DEFAULT[cta] : null); /* the title names it; the body only counts under a button that ships something */
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
        format: { type: 'string', enum: MAKE_FORMATS },
        pieces: { type: 'string', description: 'Under 90 characters, from the move: how many and what, e.g. "6 slides: the fit room, one body type per slide". Name the product exactly as the store lists it when the asset shows one' } } },
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
export function createCardsGen({ ai, log = console }) {
  // move → { cards, label }; facts is the brand fact sheet (factsFromLedger)
  async function fromMove(move, { brand, facts, lanes, laneImg, spec, ledger = [] }) {
    const [sector0, agent0] = BY_SKILL[spec?.skill] || SECTOR[spec?.group || move.group] || ['signals', 'brew'];
    const ok = allowedFrom(facts), fromLedger = ledgerNums(ledger);
    /* numbers the move states as observed are allowed too (they carry their own citation in the move); a number the
       move marks "to confirm", or gives as a target, assumption or example, is not (fact-gate.js backedNumbers) */
    const moveNums = backedNumbers(move);
    const factList = Object.values(facts).slice(0, 120).map((f) => `- ${f.label}: ${f.v}`).join('\n');
    const text = (move.sections || []).map((s) => `## ${s.h}\n` + (s.blocks || []).map((b) => b.t === 'table' ? [b.head, ...(b.rows || [])].map((r) => (r || []).join(' | ')).join('\n') : b.t === 'list' ? (b.items || []).map((x) => '- ' + x).join('\n') : b.t === 'example' ? `[${b.title}] ${b.body}` : b.text || '').join('\n')).join('\n\n').slice(0, 24000);
    const prompt = `You turn one Brew strategy document ("move") for ${brand.name} (${brand.host}) into feed cards for the brand's team.

THE MOVE: Move ${String(move.n).padStart(2, '0')} · ${move.title}
What it gives: ${move.gives}
Live in 30 days: ${move.live}
${text}

FACTS YOU MAY QUOTE (use these exact numbers; any other number must appear in the move above with its source):
${factList}

Write 1 or 2 cards. Each card is one thing the team can act on now, taken from the move (its plan, its worked examples or a decision it asks for). Rules:
- Plain, one-glance words. No jargon, no "leverage", no em dashes.
- Never invent a number, a quote, a result or a customer. If the move marks something "to confirm", the card says so.
- Never name a rival in ad copy; a card may name a rival only when it reports what that rival does.
- The card speaks to ${brand.name}'s team (internal), not to customers.
- Pick the button (cta) that does what the card asks.
- When the move plans a specific asset (a carousel, a set of Stories, a collection or catalog ad, a reel, a post), say so in "make" with the format and the pieces exactly as the move plans them, and pick the button that makes that format (carousel ad: "Make the carousel ad"; Instagram carousel: "Draft the carousel post"; Stories: "Draft the stories"; single post: "Draft the post"; collection ad: "Build the collection ad"; catalog ad: "Build the catalog ad").
- Any card whose title, body or button names an ad, an email, a reel or video, a post, a carousel, Stories, a WhatsApp message or a page must set "make" to that format, even a decision; Brew drafts it before anyone opens the card. Only a card that reports on an ad (its spend, a rival's ad, pausing one) leaves "make" out.
- The card's words and its asset agree: when "make" names a product or a scene, the title or body names that same product, and "pieces" uses the product's name exactly as the store lists it (Brew drafts the asset from it).
- Also write the move's short label and one-line summary.`;
    let j;
    try { j = (await ai.call({ model: 'sonnet', prompt, schema: SCHEMA, max: 4000, tag: 'cards' })).json; }
    catch (e) { if (e.mock) return mockCards(move, { sector0, agent0, lanes, laneImg }); throw e; }
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
      if (c.make?.format && MAKE_FORMATS.includes(c.make.format) && c.make.format !== 'other') {
        card.make = { format: c.make.format, pieces: String(c.make.pieces || '').trim().slice(0, 100) };
        fitCta(card);
        if (MAKES_CREATIVE.test(c.make.format)) { card.sector = 'creatives'; if (card.agent !== 'brew') card.agent = 'creative'; Object.assign(card, fitRoles(card)); }
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
    return { cards, label: { short: j.label?.short || move.title.slice(0, 26), line: j.label?.line || move.gives, heads: {} } };
  }
  // the feed's first cards, from the read alone: what we saw on the site, in reviews, ads and AI answers
  async function fromRead(profile, { brand, facts, lanes, laneImg }) {
    const p = profile, ok = allowedFrom(facts), N = numbersOf({ profile: p }); /* the same counts every other screen shows (pack-numbers.js) */
    const ev = JSON.stringify({ catalog: (p.catalog?.products || []).slice(0, 12).map((x) => ({ t: x.title, price: x.priceLabel, mrp: x.mrp, stock: x.inStock, photos: (x.images || []).length, reviews: x.reviews })), count: N.products.n,
      reviews: { total: N.reviews.n, platforms: N.reviews.platforms, quotes: (p.reviews?.quotes || []).slice(0, 8) }, ads: { own: N.ownAds.n, rivals: N.rivals.map((r) => ({ name: r.name, live: r.live, hooks: ((p.ads?.rivals || []).find((x) => x.name === r.name)?.items || []).slice(0, 3).map((a) => a.hook) })) },
      ai: { score: p.ai?.score, answers: (p.ai?.answers || []).slice(0, 8).map((a) => ({ tool: a.tool, q: a.q, named: a.named, rivals: a.rivalsNamed })) }, checkout: p.site?.checkout, tech: p.site?.tech }).slice(0, 18000);
    const SCH = { type: 'object', properties: { cards: { type: 'array', items: SCHEMA.properties.cards.items } } };
    let j;
    try { j = (await ai.call({ model: 'sonnet', schema: SCH, max: 5000, tag: 'cards-read', prompt: `You write the first feed cards for ${brand.name} (${brand.host}), from what Brew just read on its live site, reviews, ads and AI answers.\n\nWHAT WE READ (JSON):\n${ev}\n\nFACTS YOU MAY QUOTE:\n${Object.values(facts).slice(0, 100).map((f) => `- ${f.label}: ${f.v}`).join('\n')}\n\nWrite 4 cards, each a real finding the team can act on today: one about AI answers (named or not, who is named instead), one about rivals' live ads, one about the catalog or checkout, one about what customers say. Only use what is in the JSON above; every number must be in it or in the facts. If a finding is missing from the JSON, skip that card. Plain one-glance words, no em dashes. Pick the button that does what the card asks.` })).json; }
    catch (e) { if (e.mock) return []; throw e; }
    const nums = readNums(ev); const lane = Object.keys(lanes || {})[0] || 'core'; const out = [];
    const SEC = (t) => /ai answer|chatgpt|gemini|perplexity|named/i.test(t) ? ['visibility', 'visibility'] : /\bads?\b|meta|rival/i.test(t) ? ['ads', 'performance'] : /review|customer|say/i.test(t) ? ['creatives', 'creative'] : ['storefront', 'storefront'];
    (j.cards || []).slice(0, 4).forEach((c, i) => {
      const [sector, agent] = SEC(`${c.title} ${c.sub}`);
      const card = { id: `read-${i + 1}`, origin: 'read', agent, sector, type: c.type, lane, roles: ROLES[sector] || ['founder'], src: `Read from ${brand.host} today`, time: `${4 + i * 3} min`,
        kind: (c.rows || []).filter((r) => r?.length >= 2).length ? 'rows' : 'media', title: String(c.title || '').trim(), sub: String(c.sub || '').trim(), detail: { why: (c.why || []).slice(0, 3), how: (c.how || []).slice(0, 3) }, cta: { label: CTA[c.cta] ? c.cta : 'Generate versions' } };
      const rows = (c.rows || []).filter((r) => r?.length >= 2).slice(0, 5).map((r) => [String(r[0]).slice(0, 40), String(r[1]).slice(0, 48)]);
      if (c.make?.format && MAKE_FORMATS.includes(c.make.format) && c.make.format !== 'other') { card.make = { format: c.make.format, pieces: String(c.make.pieces || '').trim().slice(0, 100) }; fitCta(card); }
      if (card.kind === 'rows') card.rows = rows; else { const img = laneImg?.[lane]; if (img) card.images = [img]; else { card.kind = 'rows'; card.rows = rows; } }
      if (unbacked({ title: card.title, sub: card.sub, rows: card.rows, detail: card.detail, make: card.make }, { has: (n) => ok.has(n) || nums.has(n) }, { strict: true }).length) return;
      if (!card.title || !card.sub || LEAK.test(card.title + card.sub)) return;
      out.push(card);
    });
    return out;
  }
  const mockCards = (move, { sector0, agent0, lanes, laneImg }) => {
    const lane = Object.keys(lanes || {})[0] || 'core';
    return { cards: [{ id: `m${String(move.n).padStart(2, '0')}-1`, agent: agent0, sector: sector0, type: 'report', lane, roles: ROLES[sector0] || ['founder'], src: `Move ${String(move.n).padStart(2, '0')}`, time: '20 min', kind: 'rows', rows: [['Move', move.title.slice(0, 40)]], title: move.title.slice(0, 60), sub: String(move.gives || '').slice(0, 220), detail: { why: [], how: [] }, cta: { label: 'Open the scoreboard' }, mock: true }], label: { short: move.title.slice(0, 26), line: move.gives, heads: {} } };
  };
  return { fromMove, fromRead };
}
