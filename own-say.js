// Words that contradict the brand's own counts, said again on every serve (QV round 2, 26 Oct), for any brand:
// - "Rivals are running up to 278 ads while we have none" while Store health counts 10 live ads (P1-6): a "none" about the brand's
//   own ads is only kept when the one count (pack-numbers ownAds) says 0; with a count it reads "while you run 10".
// - "we have zero out-of-stock catalog items" beside a card whose rows say "Out of Stock · 2 products" (P1-19): with any product out
//   of stock, "zero out-of-stock" reads the count.
const ADS = 'live (?:Meta |Facebook |Instagram )?ads?|ads?(?: running| live)?|Meta ads?|campaigns?';
export function ownAdsSay(text, n) {
  if (typeof text !== 'string' || !(+n > 0)) return text;
  const run = `you run ${(+n).toLocaleString('en-IN')}`, cap = (m) => (/^[A-Z]/.test(m) ? run[0].toUpperCase() + run.slice(1) : run);
  return text
    .replace(/\bwhile (?:we|you) (?:have|run|are running|show) (?:none|zero|0|no (?:live )?(?:ads?|campaigns?)(?: at all)?)\b/gi, `while ${run}`)
    .replace(new RegExp(`\\b(?:we|you) (?:have|run|are running) (?:no|zero|0) (?:${ADS})\\b`, 'gi'), cap)
    .replace(new RegExp(`\\b(?:we|you) (?:aren['’]t|are not|don['’]t|do not) (?:running|run|have) any (?:${ADS})\\b`, 'gi'), cap);
}
export function oosSay(text, out) {
  if (typeof text !== 'string' || !(+out > 0)) return text;
  return text
    .replace(/\b(?:zero|no|0)\s+(out[- ]of[- ]stock)\b/gi, (m, w) => `${out} ${w}`)
    .replace(/\bnothing (?:is )?(?:out of stock|sold out)\b/gi, `${out} ${+out === 1 ? 'product is' : 'products are'} out of stock`)
    .replace(/\b(?:none|no products?|no items?) (?:are|is) (?:out of stock|sold out)\b/gi, `${out} ${+out === 1 ? 'product is' : 'products are'} out of stock`);
}
/* the count of products out of stock a card's own rows state ("Out of Stock · 2 products", "Sold out · 3") */
export const outInRows = (rows) => { for (const r of Array.isArray(rows) ? rows : []) { if (!Array.isArray(r)) continue; if (/^(?:out of stock|sold out)$/i.test(String(r[0]).trim())) { const m = /(\d+)/.exec(String(r[1])); if (m) return +m[1]; } } return 0; };
/* every word a card or slide shows, on a copy */
export function ownSayIn(o, { ads = null, out = 0 } = {}) {
  if (!o || typeof o !== 'object') return o; const o2 = { ...o }, oos = Math.max(+out || 0, outInRows(o.rows));
  const h = (x) => oosSay(ownAdsSay(x, ads), oos);
  for (const k of ['title', 'sub', 'h', 'p', 'card', 'forUs']) if (typeof o2[k] === 'string') o2[k] = h(o2[k]);
  if (Array.isArray(o2.steps)) o2.steps = o2.steps.map(h);
  if (o2.detail && typeof o2.detail === 'object') o2.detail = { ...o2.detail, ...(Array.isArray(o2.detail.why) ? { why: o2.detail.why.map(h) } : {}), ...(Array.isArray(o2.detail.how) ? { how: o2.detail.how.map(h) } : {}) };
  return o2;
}
