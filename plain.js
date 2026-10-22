// Plain words on every card (Param, 19 Oct: "should unblock me without any additional mental stress, don't make me decode
// it. EVERY move"). Cards are written by many writers (moves, the read, research, listening, ideas, watchers, statics);
// this one pass rewrites what a person reads on any of them in simple language, the same way for every brand:
// title, body, reasons and steps, plus one line on why Brew suggests it (the proof sheet's "Why").
//
// Rules the rewrite keeps, checked in code, not just asked for:
//   - every number stays exactly as written: a rewrite that adds, drops or changes a number keeps the original field
//   - product, brand and rival names stay as they are
// Saved per brand in plain.json, keyed by a hash of the card's own words: a card that changes is rewritten once more, a
// card that doesn't is never paid for twice. Runs in the background on the fast model (Gemini Flash), a batch at a time;
// until a card's rewrite lands it shows its own words with the jargon swapped for plain ones (dejargon, no AI).
import crypto from 'node:crypto';
import { numbersIn } from './fact-gate.js';
import { claimGaps } from './proof-logic.js';
import { moveSay } from './move-label.js'; /* a rewrite never claims Brew saw more than the card did */

export const PLAIN_V = 3; /* 2: outcome-first titles, no technical steps in the title or body (testing notes 18 Oct); 3: every field required, half answers never kept */
const FILE = 'plain.json';
const BATCH = 12, MAX_KEEP = 2500;

/* the words people decode: replaced in the card's own text while its rewrite is on its way, and banned in the rewrite */
const JARGON = [
  [/\bROAS\b/g, 'return on ad spend'], [/\bAOV\b/g, 'average order'], [/\bCAC\b/g, 'cost to win a customer'], [/\bCPA\b/g, 'cost per sale'],
  [/\bCTR\b/g, 'click rate'], [/\bCVR\b/g, 'buy rate'], [/\bLTV\b/g, 'lifetime spend'], [/\b(\d[\d,]*)\s+PDP\b/g, (m, n) => `${n} product page${n === '1' ? '' : 's'}`], [/\b(\d[\d,]*)\s+SKU\b/g, (m, n) => `${n} product${n === '1' ? '' : 's'}`], /* "913 SKU are" reads "913 products are", never "913 product are" */
  [/\bPDPs\b/g, 'product pages'], [/\bPDP\b/g, 'product page'], [/\bSKUs\b/g, 'products'], [/\bSKU\b/g, 'product'],
  [/\bUGC\b/g, 'customer-style'], [/\bATC\b/g, 'add to cart'], [/\bSERPs?\b/g, 'Google results'], [/\bCRO\b/g, 'store fixes'],
  [/\bunbranded (?:queries|searches|questions)\b/gi, 'searches that name no brand'], [/\bcold (?:buyers|audiences?|traffic)\b/gi, 'people new to you'],
  [/\bretargeting(?:\s+(?:ads?|campaigns?|audiences?))?\b/gi, 'ads to past visitors'], /* "retargeting ads" said "ads to past visitors ads" (QA 20 Oct) */ [/\bconversion rate\b/gi, 'share of visitors who buy'], [/\bhero (?:product|SKU)\b/gi, 'best seller'],
  /* the store's plumbing (QA 19 Oct, FEED-ARV-07: jam plans and source lines said GMC, webhook, products.json, JSON-LD) */
  [/(?:\b(?:our|your|the)\s+)?(?:Shopify(?:'s|’s)?\s+)?`?(?:\b(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+)?\/?\b(products|collections|meta)\.json\b`?/gi, (m, f) => ({ products: 'your product list', collections: 'your collection list', meta: 'your store details' })[f.toLowerCase()]],
  [/\b(?:(?:an?|the|your|structured|root|new)\s+)*`?\/?\bllms\.txt\b`?(?:\s+(?:file|signpost|page))?/gi, 'a page for AI tools'],
  /* one pattern for the whole phrase, a leading "structured" included: "Add Product schema structured data" was swapped twice ("search-friendly product info search-friendly product info") and "structured JSON-LD" kept "structured" (final QA pass 19 Oct) */
  [/\b(?:structured\s+)?(?:(?:FAQPage|FAQ|Product|Review|Organi[sz]ation|LocalBusiness|BreadcrumbList|WebSite|Article|HowTo|Offer|AggregateRating|ItemList)\s+)?(?:JSON-LD|schema\.org|structured data|schemas?)(?:\s+(?:FAQPage|FAQ|Product|Review|Organi[sz]ation))?(?:\s+(?:JSON-LD|schema|markup|structured data))*\b/gi, 'search-friendly product info'],
  [/\brich (?:snippets?|results?)\b/gi, 'star ratings and prices in Google'],
  [/\b(P|p)age sections?\b/g, (m, p) => `${p}age`], /* "Page section: Traya alternative page" reads "Page: …"; the make format on file stays "page section" */
  [/\b(?:Google Merchant Center|GMC)(?: feeds?)?\b/g, 'Google Shopping feed'], [/\bMerchant Center\b/g, 'Google Shopping'],
  [/\bwebhooks\b/gi, 'automatic alerts'], [/\bwebhook\b/gi, 'automatic alert'], [/\bGTM\b/g, 'Google Tag Manager'],
  [/\bcustom (?:web )?pixels?(?:\s+sandbox)?\b/gi, 'tracking code'],
  /* the rest of the page plumbing that reached fact rows, asset lines and move names (final QA pass 19 Oct: "SKUs with Schema",
     "Sitemap files", "organisation markup", "meta description, H1", "Headless Platform", "crawl budget") */
  [/\b(rating|review|organi[sz]ation|product|stock|return|price|FAQ|breadcrumb|search|page)\s+markup\b/gi, (m, w) => `${w} info for Google`],
  [/\bmeta descriptions?\b/gi, 'search snippet'], [/\btitle tags?\b/gi, 'page title'], [/\bH1s?\b/g, 'main heading'],
  [/\bsitemap (?:pages|urls|links)\b/gi, 'pages listed for Google'], [/\bsitemap files\b/gi, 'page lists for Google'], [/\bsitemaps\b/gi, 'page lists for Google'], [/\bsitemap\b/gi, 'page list for Google'], [/\bcrawl budget\b/gi, 'Google’s visits'], [/\bcrawlers?\b/gi, 'search bots'],
  [/\bheadless (?:platform|commerce|store(?:front)?)\b/gi, 'store platform'], [/\bscript blocks?\b/gi, 'code snippet'],
  [/\bstructured (answer|content|FAQ|data block)/gi, (m, w) => w]
];
/* a swap at the start of a sentence starts with a capital, like the words it replaced */
const cap1 = (to, m, at, all) => (/^[A-Z`/]/.test(m) && /^[a-z]/.test(to) && (at === 0 || /[.!?:·]\s+$/.test(all.slice(Math.max(0, at - 3), at)) || /^-[A-Z]/.test(all.slice(at + m.length, at + m.length + 2))) ? to[0].toUpperCase() + to.slice(1) : to); /* and in a Title-Case compound ("SKU-Specific" → "Product-Specific") */
/* a swap that lands next to its own words ("search-friendly product info search-friendly product info") says it once */
const SWAPS = [...new Set(JARGON.map(([, to]) => to).filter((x) => typeof x === 'string'))].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const TWICE = new RegExp(`\\b(${SWAPS.join('|')})(?:\\s+\\1\\b)+`, 'gi');
const twice = (x) => x.replace(TWICE, '$1');
export const dejargon = (s) => { if (typeof s !== 'string' || !s) return s; let x = s; for (const [re, to] of JARGON) x = x.replace(re, (m, ...a) => { const at = a[a.length - 2], all = a[a.length - 1]; return cap1(typeof to === 'function' ? to(m, ...a) : to, m, at, all); }); return moveSay(twice(x)); }; /* and "Weekly move 11", never "Move 1011" */
/* the source line under a card ("Move 64 · Loop 3: SKU-Specific Reorder Clocks"): the move's own words, without the plan's
   internal numbering (Loop 3, Pillar 2, Phase 1) and in plain words */
export const plainSrc = (s) => (typeof s !== 'string' || !s ? s : dejargon(s.replace(/(·\s*)(?:Loop|Pillar|Phase|Step|Part|Stage|Track|Wave|Tier|Layer|Workstream|Sprint|Decision)s?\s*\d+[a-z]?(?:\s*(?:and|&|to|[–—-])\s*\d+[a-z]?)*\s*[:.\-–—]\s*/gi, '$1')));

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
export const plainKey = (c) => sha(JSON.stringify([PLAIN_V, c?.title || '', c?.sub || '', c?.detail?.why || [], c?.detail?.how || []]));
/* the numbers a text may carry: as written, money and counts alike (years and plain small numbers are not gated) */
const nums = (s) => new Set([...numbersIn(String(s || ''), { strict: true }), ...numbersIn(String(s || ''))]);
const subset = (out, src) => { for (const n of nums(out)) if (!src.has(n)) return false; return true; };
const keepsAll = (out, need) => { const o = nums(out); for (const n of need) if (!o.has(n)) return false; return true; };
/* the kinds of thing a text says Brew saw that the brand's evidence can't show (proof-logic.js), sentence by sentence */
const gapsIn = (s, kinds) => new Set(String(s || '').split(/(?<=[.!?])\s+/).flatMap((x) => claimGaps(x, kinds).map((g) => g.kind)));
const addsGap = (out, orig, kinds) => { const was = gapsIn(orig, kinds); for (const g of gapsIn(out, kinds)) if (!was.has(g)) return true; return false; };
const tidy = (s, n) => String(s || '').replace(/\u2039(?=\s?\d)/g, '₹') /* the model sometimes writes ₹ as ‹ */.replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n);

export const SCHEMA = { type: 'object', properties: { cards: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' },
  title: { type: 'string', description: 'At most 60 characters. What to do, or what is wrong, in everyday words. Keep the main number if the original title has one.' },
  sub: { type: 'string', description: 'Two short sentences, at most 32 words in all: what Brew saw (with its number), then what to do and what the brand gets.' },
  why: { type: 'array', items: { type: 'string' }, description: 'The same reasons as the original, each under 12 everyday words. Same count as the original, at most 3.' },
  how: { type: 'array', items: { type: 'string' }, description: 'The same steps as the original, each under 10 everyday words, starting with a verb. Same count as the original, at most 3.' },
  because: { type: 'string', description: 'One or two sentences, under 40 words: why Brew suggests this, naming the evidence in plain words ("Brew suggests this because ...").' }
}, required: ['id', 'title', 'sub', 'why', 'how', 'because'] } } }, required: ['cards'] }; /* every field asked for: an optional one was often left out (19 Oct: 154 of 167 Arata cards came back with no body, steps or reason) */

export const prompt = (brand, list) => `You rewrite cards in a marketing app for ${brand || 'a brand'}'s team so anyone gets each one in two seconds, with no decoding.

How to write:
- Everyday words a busy shop owner uses when texting a friend. Short sentences. One idea per sentence.
- Say plainly what is going on and what to do. Lead with the point.
- The title says what the brand gets, in an owner's words ("Show your star ratings in Google and AI answers"), never the technical step. JSON-LD, schema, structured data, markup, meta tags, theme files, llms.txt, products.json, webhooks, GMC, custom pixels, sitemaps and code never go anywhere on the card, steps included: say what they do ("add your reviews to your store pages' code", "your product list", "an automatic alert", "your Google Shopping feed").
- No marketing or ad-industry jargon or abbreviations: no ROAS, AOV, CAC, CPA, CTR, CVR, LTV, PDP, SKU, UGC, SERP, CRO, SEO, AEO, funnel, cohort, retargeting, lookalike, cold audience, hero product, unbranded queries, lanes, gates, levers, "front the ads", "proof gate". Say what they mean instead ("people new to the brand", "the product page", "searches that don't name a brand", "lead your ads with").
- No hype or filler: no "unlock", "leverage", "optimize", "supercharge", "game-changer", "seamless". No em dashes.
- Keep every number exactly as written (same symbol, same digits). Never add a number, never drop the card's main number, never round.
- Keep product names, brand names and rival names exactly as written.
- Never add a fact, claim or promise the original doesn't make. Same meaning, same advice, simpler words.
- Never turn an idea into something Brew saw. "May", "might" and "can" stay. Say people are asking, complaining or worried, that visitors leave, bounce or abandon carts, that sales, orders or ad results are up or down, or that people search for something, only when the original says Brew saw it. Happy reviews are proof that it works, never doubt.
- "because" names the evidence the original names (a review, a thread, a page Brew read, an account number). When the original gives a reason without evidence, say it as an idea: "Brew suggests this because buyers may worry ...".
- Write in the same language as the original.

Cards (JSON):
${JSON.stringify(list)}

Return every card by its id.`;

/* isPrivate(card): a card only the brand's team sees (a connected account's card, a move rewritten from the team's numbers);
   its rewrite carries the team's real numbers, so it is kept in private/plain.json, never in the brand's shared plain.json */
const PRIV_FILE = 'private/plain.json';
const isPrivate0 = (c) => !!c && !c.publicLive && (c.liveOnly === true || c.privateOf != null || !!c.memberIdea || !!c.teamStatics || /^live-(?!marketplaces-)|-p$/.test(String(c.id || '')));
export function createPlain({ ai, store, spend = () => true, isMock = () => false, log = console, kindsOf = () => ({}), isPrivate = isPrivate0 }) { /* kindsOf(slug): what Brew holds for the brand (proof-logic.js evidenceKinds) */
  const mem = new Map(), chain = new Map(), running = new Map(), failedAt = new Map(), tries = new Map();
  const mk = (slug, priv) => (priv ? `${slug}\u0000p` : slug);
  const load = async (slug, priv = false) => { const k = mk(slug, priv); if (!mem.has(k)) mem.set(k, (await store?.getJSON(slug, priv ? PRIV_FILE : FILE, {}).catch(() => ({}))) || {}); return mem.get(k); };
  const save = (slug, priv = false) => { const k = mk(slug, priv), all = mem.get(k); if (!all || !store?.put) return;
    const ks = Object.keys(all); if (ks.length > MAX_KEEP) for (const x of ks.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, ks.length - MAX_KEEP)) delete all[x];
    const run = (chain.get(k) || Promise.resolve()).then(() => store.put(slug, priv ? PRIV_FILE : FILE, all)); chain.set(k, run.catch(() => {})); return run; };
  /* the cached rewrite for a card, if its words haven't changed since (sync: the feed never waits on a load) */
  const get = (slug, c) => { const priv = isPrivate(c), all = mem.get(mk(slug, priv)); if (!all) { load(slug, priv).catch(() => {}); return null; } return all[plainKey(c)] || null; };
  /* the card a person reads: the rewrite where there is one, else its own words with the jargon swapped */
  /* a rewrite is swapped too: one written before a word joined the list still never shows it */
  const apply = (slug, c) => { if (!c || typeof c !== 'object') return c; const p = get(slug, c);
    const d = c.detail || {}, out = { ...c, title: dejargon(p?.title || c.title), sub: dejargon(p?.sub || c.sub) };
    if (c.detail) out.detail = { ...d, why: (p?.why?.length ? p.why : d.why || []).map(dejargon), how: (p?.how?.length ? p.how : d.how || []).map(dejargon) };
    if (c.make?.pieces) out.make = { ...c.make, pieces: dejargon(c.make.pieces) }; /* the make chip under the words ("Homepage: JSON-LD …") */
    if (Array.isArray(c.rows)) out.rows = c.rows.map((r) => (Array.isArray(r) ? r.map((x) => (typeof x === 'string' ? dejargon(x) : x)) : r)); /* the fact rows ("SKUs with Schema", "Sitemap files") */
    if (c.src) out.src = plainSrc(c.src);
    if (p?.because) out.because = p.because;
    if (p && (p.title !== c.title || p.sub !== c.sub)) out.orig = { title: c.title, sub: c.sub }; /* the words as written, for the proof sheet */
    return out; };
  /* one checked rewrite: each field is kept only when it carries the original's numbers and no new one */
  /* ... and says Brew saw nothing the card itself didn't: a rewrite that turns "may worry" into "are worried", or adds "visitors are leaving", keeps the original */
  const check = (c, r, kinds = {}) => { if (!r) return null; const src = nums([c.title, c.sub, ...(c.detail?.why || []), ...(c.detail?.how || [])].join(' '));
    const said = [c.title, c.sub, ...(c.detail?.why || [])].filter(Boolean).join(' ');
    const field = (orig, out, n) => { const t = tidy(out, n); if (!t) return null; if (!subset(t, src) || !keepsAll(t, nums(orig)) || addsGap(t, said, kinds)) return null; return t; };
    const list = (orig = [], out = [], n) => { const xs = (out || []).slice(0, Math.max(orig.length, 0) || 3).map((x, i) => field(orig[i] || '', x, n)); return xs.length && xs.every(Boolean) ? xs : null; };
    const title = field(c.title, r.title, 90), sub = field(c.sub, r.sub, 320);
    const because = (() => { const t = tidy(r.because, 280); return t && subset(t, src) && !addsGap(t, said, kinds) ? t : null; })();
    return { title: title || c.title, sub: sub || c.sub, why: (c.detail?.why || []).length ? list(c.detail.why, r.why, 120) : null, how: (c.detail?.how || []).length ? list(c.detail.how, r.how, 100) : null, because, at: Date.now() }; };
  /* rewrite the cards that have none yet, a batch at a time, one run per brand. Never twice at once, never in a mock run */
  const queue = (slug, cards, brand) => {
    if (!slug || !ai || isMock() || running.has(slug) || Date.now() - (failedAt.get(slug) || 0) < 10 * 60e3) return false;
    const job = (async () => {
      const pub = await load(slug), priv = await load(slug, true), allOf = (c) => (isPrivate(c) ? priv : pub);
      const todo = (cards || []).filter((c) => c?.id && c.title && !allOf(c)[plainKey(c)]);
      for (let i = 0; i < todo.length; i += BATCH) {
        if (!spend('text')) break;
        const part = todo.slice(i, i + BATCH);
        const list = part.map((c) => ({ id: c.id, title: c.title, sub: c.sub || '', why: (c.detail?.why || []).slice(0, 3), how: (c.detail?.how || []).slice(0, 3), from: c.src || '' }));
        try {
          const j = await ai(prompt(brand, list), SCHEMA, 6000, 'plain_cards');
          const by = new Map((j?.cards || []).map((x) => [x.id, x]));
          /* a card is kept only with its whole rewrite (title, body and the reason); a half answer is tried again on a later load,
             at most 3 times, then the card keeps its own words with the jargon swapped */
          let kept = 0, half = 0;
          const kinds = (() => { try { return kindsOf(slug) || {}; } catch { return {}; } })();
          for (const c of part) { const x = by.get(c.id), r = check(c, x, kinds), k = plainKey(c), all = allOf(c);
            if (r && x?.sub && x?.because) { all[k] = r; kept++; tries.delete(k); }
            else { half++; const n = (tries.get(k) || 0) + 1; tries.set(k, n); if (n >= 3 && r) { all[k] = r; tries.delete(k); } } }
          log.log?.(`[plain] ${slug} ${part.length} cards: ${kept} rewritten${half ? `, ${half} came back incomplete (tried again later)` : ''}`);
          await save(slug); if (part.some(isPrivate)) await save(slug, true);
        } catch (e) { log.warn('[plain]', slug, e.message); failedAt.set(slug, Date.now()); break; }
      }
    })().finally(() => running.delete(slug));
    running.set(slug, job); return true;
  };
  return { get, apply, queue, load, check, busy: (slug) => running.has(slug), _mem: mem };
}
