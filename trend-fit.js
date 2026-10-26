// Rising Google searches that belong to the brand (26 Oct QA: "best laptop for work" listed under a hair serum, "pharmacy online
// india" under running shoes). Google's rising list for a term carries whatever else people searched; a query stays only when it
// shares a real word with what the brand sells: its search terms, category, product names, product noun, its own name or a rival's.
// No per-brand lists: the words come from the brand's own config and catalogue, for any brand and any market.

/* words that say nothing about a category: shopping words, places, people, time ("best", "online", "india", "women", "2026") */
const GENERIC = new Set(('best top buy online shop shopping store stores near me price prices cheap offer offers sale deal deals discount coupon code review reviews rating ' +
  'vs versus new latest how what which why where when who is are can do does the a an and or for with without of in on at to from by my your our ' +
  'india indian usa us uk uae canada australia dubai delhi mumbai bangalore bengaluru chennai hyderabad pune kolkata city ' +
  'men mens man women womens woman girls boys kids kid baby babies unisex adult adults ' +
  'free fast delivery app apps website site brand brands product products use using work home good great quality original genuine real ' +
  'india’s world worlds no 1 one two under above rs inr usd today 2024 2025 2026 2027').split(/\s+/));
const stem = (w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export const termWords = (s) => String(s || '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w)).map(stem);

/** the brand's own words: search terms, category, product names and noun, its name and its rivals' */
export function brandVocab(brand = {}) {
  const c = brand.config || brand || {}, out = new Set();
  const add = (x) => { for (const w of termWords(x)) out.add(w); };
  [c.terms, c.rising, c.category, c.listingTerm, c.product?.noun, c.rivals, c.brandName, brand.name, brand.seed?.brand?.name, brand.profile?.category, brand.profile?.subcategory].flat(3).forEach(add);
  for (const p of (brand.catalog || []).slice(0, 400)) add(p?.t || p?.title);
  return out;
}

/** does one rising query belong to this brand? (the term it rose around counts as the brand's words too) */
export const onTopic = (q, vocab, seed = '') => { const ws = termWords(q); if (!ws.length) return false; const seedW = new Set(termWords(seed)); return ws.some((w) => vocab.has(w) || seedW.has(w)); };

/** a rising list with only the brand's searches left */
export const fitRising = (list = [], vocab = new Set(), seed = '') => (list || []).filter((x) => x?.q && onTopic(x.q, vocab, seed));

/** a saved trends read with only the brand's rising searches: each list filtered, a rising story left empty dropped, and a story
    whose words quote a search that was dropped ("…now also search "best laptop for work"") dropped too. Pure: research.js runs
    it on every load, so reads saved before 26 Oct heal without a new (paid) read */
export function fitTrends(tr, vocab) {
  if (!tr || typeof tr !== 'object') return tr;
  const gone = new Set(), fit = (l, q) => { const keep = fitRising(l, vocab, q); for (const x of l || []) if (!keep.includes(x) && x?.q) gone.add(String(x.q).toLowerCase()); return keep; };
  const rising = Object.fromEntries(Object.entries(tr.rising || {}).map(([q, l]) => [q, fit(l, q)]).filter(([, l]) => l.length));
  const said = (x) => { const t = `${x.h || ''} ${x.p || ''} ${x.card || ''}`.toLowerCase(); for (const q of gone) if (q.length >= 4 && t.includes(q)) return true; return false; };
  const items = (xs) => (xs || []).map((x) => (Array.isArray(x?.rising) ? { ...x, rising: fit(x.rising, x.risingOf) } : x)).filter((x) => x && !(x.kind === 'rising' && !(x.rising || []).length) && !said(x));
  return { ...tr, rising, items: items(tr.items), ...(tr.archive ? { archive: items(tr.archive) } : {}) };
}
