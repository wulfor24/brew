// A move's cover number is the first thing a brand reads, so it has to mean what its label says, not only appear somewhere in
// the evidence: "₹2,625 · ENTRY SET PRICE" while Scrubroom's sets start at ₹1,899, "60 days · REFUND DELAY CITED IN REVIEWS"
// while Mana's reviews say 45 (24 Oct, design-partner audit). Pure and free: brand-pack.js runs it on every move as it loads,
// so the page, the card and the PDF read the same, and saved moves get it without a rewrite.

const LOW = /\b(?:entry|lowest|cheapest|starting|starts? at|from)\b/i, HIGH = /\b(?:highest|priciest|most expensive|top price)\b/i;
const CITED = /\b(?:cited|mentioned|named|quoted|reported|said|told|described) (?:in|by|across) (?:\w+ ){0,2}(?:reviews?|reviewers|buyers|customers)\b|\b(?:reviews?|reviewers|buyers|customers) (?:say|said|cite|mention|report|complain)/i;
const NOUN_STOP = new Set(['entry', 'lowest', 'cheapest', 'starting', 'starts', 'from', 'highest', 'priciest', 'expensive', 'price', 'prices', 'priced', 'the', 'our', 'your', 'their', 'rivals', 'rival', 'with', 'for', 'and', 'top', 'most', 'mrp', 'cost', 'point', 'level', 'tier', 'per', 'each', 'one', 'pack', 'vs', 'store', 'shop', 'site', 'catalog', 'catalogue', 'range', 'product', 'products', 'item', 'items', 'online', 'india', 'whole']);
const MONEY = /(?:₹|rs\.?\s?|inr\s?|\$|£|€)\s?(\d[\d,]*(?:\.\d+)?)\s?(k|l|lakh|cr|crore)?/i;
const SCALE = { k: 1e3, l: 1e5, lakh: 1e5, cr: 1e7, crore: 1e7 };
const moneyOf = (s) => { const m = String(s || '').match(MONEY); return m ? +m[1].replace(/,/g, '') * (SCALE[(m[2] || '').toLowerCase()] || 1) : null; };
const fmt = (n, cur) => { const inr = cur === 'INR' || !cur, sym = inr ? '₹' : cur === 'USD' ? '$' : `${cur} `;
  if (inr && n >= 1e7) return `${sym}${+(n / 1e7).toFixed(2)} Cr`; if (inr && n >= 1e5) return `${sym}${+(n / 1e5).toFixed(2)} L`;
  return `${sym}${Math.round(n).toLocaleString(inr ? 'en-IN' : 'en-US')}`; };
const moneyCount = (s) => (String(s || '').match(new RegExp(MONEY.source, 'gi')) || []).length;

/* every review text a read keeps (quotes, recent, each platform's lines), whatever the stage called the field */
export function reviewTexts(profile) {
  const out = []; const walk = (o, d = 0) => { if (d > 5 || o == null) return; if (Array.isArray(o)) return o.forEach((x) => walk(x, d + 1));
    if (typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (typeof v === 'string' && /^(?:text|body|quote|review|content)$/i.test(k) && v.length > 12) out.push(v); else if (typeof v === 'object') walk(v, d + 1); } };
  walk(profile?.reviews); for (const p of profile?.catalog?.products || []) walk(p?.reviews);
  return out;
}

/** → a sentence saying why the cover number doesn't hold, or null. products: [{ title, type, price }]; reviews: [text] */
export function statProblem(m, { products = [], reviews = [], currency = 'INR', brand = '' } = {}) {
  const stat = String(m?.stat || ''), label = String(m?.statLabel || '');
  if (!stat.trim() || /\b(?:target|goal|aim|plan|budget|forecast|projected|estimate)\b/i.test(label) || /\(derived\)|~/.test(stat)) return null;
  const money = moneyOf(stat), low = LOW.test(label), high = !low && HIGH.test(label);
  /* one amount only: "₹6,080 vs ₹2,625 · IMPORTED VS COTTON ENTRY" compares two, and which one is the entry is a guess */
  if (money != null && moneyCount(stat) === 1 && (low || high)) {
    const priced = products.filter((p) => +p?.price > 0);
    /* the label's own words pick the products ("SET" → the sets); the brand's name never does, and the narrowest word wins
       ("A MANA VISTA HOME" → Vista's homes, not every Mana home) */
    const own = new Set(String(brand || '').toLowerCase().split(/[^a-z]+/).filter(Boolean));
    const nouns = label.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !NOUN_STOP.has(w) && !own.has(w));
    const hits = (w) => priced.filter((p) => new RegExp(`\\b${w}s?\\b`, 'i').test(`${p.title || ''} ${p.type || ''}`));
    const noun = nouns.map((w) => [w, hits(w)]).filter(([, h]) => h.length).sort((a, b) => a[1].length - b[1].length)[0]?.[0] || null;
    const pool = noun ? hits(noun) : nouns.length ? [] : priced; /* a word that names no product: the catalog can't say, so no verdict */
    if (pool.length >= 2) { const prices = pool.map((p) => +p.price), want = low ? Math.min(...prices) : Math.max(...prices);
      if (Math.abs(want - money) > Math.max(1, want * 0.005)) return `The cover says ${stat.trim()} is the ${low ? 'lowest' : 'highest'}${noun ? ` ${noun}` : ''} price, but the catalog’s ${low ? 'lowest' : 'highest'} is ${fmt(want, currency)}`; }
  }
  /* a share or a count of reviews ("40%", "12 of 41") is worked out from them, not quoted: only a quoted figure is looked up */
  if (CITED.test(label) && reviews.length && !/%/.test(stat) && !/\d\s*(?:of|\/|out of)\s*\d/i.test(stat)) {
    const nums = [...stat.replace(MONEY, ' ').matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((x) => x[0].replace(/,/g, ''));
    const all = reviews.join('\n');
    const missing = nums.filter((n) => !new RegExp(`(?<![\\d.,])${n.replace('.', '\\.')}(?![\\d])`).test(all.replace(/(\d),(\d)/g, '$1$2')));
    if (nums.length && missing.length) return `The cover says ${stat.trim()} (“${label.trim().toLowerCase()}”), but no review the read kept says ${missing.join(', ')}`;
  }
  return null;
}

/** the move with a doubtful cover marked: its label says "to confirm" and To confirm says why. Idempotent */
export function markStat(m, ctx) {
  if (!m || typeof m !== 'object' || !m.stat) return m;
  /* the build's own check (moves-engine verify: statUnbacked) counts too, unless the cover says it is worked out ("(derived)", "~") */
  const derived = /\(derived\)|~/.test(String(m.stat));
  const why = statProblem(m, ctx) || (m.meta?.verify?.statUnbacked && !derived ? `The cover number ${String(m.stat).trim()} isn’t in the read’s evidence` : null);
  if (!why) return m;
  const line = `${why}, so the team checks it before the cover is used`, tc = Array.isArray(m.toConfirm) ? m.toConfirm : [];
  return { ...m, statLabel: /to confirm/i.test(m.statLabel || '') ? m.statLabel : `${String(m.statLabel || '').trim()} (to confirm)`.trim(), toConfirm: tc.includes(line) ? tc : [...tc, line] };
}
