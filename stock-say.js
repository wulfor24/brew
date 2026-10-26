// A stock sentence that matches its own rows (QV P1-8, 26 Oct): a card listed "Anti-Grey Hair Serum Pack of 2 – Sold out" in its rows
// and said "Anti-Grey Hair Serum Pack of 2 and … are nearly gone" in its words. The writer names the first rows whatever their state;
// on every serve the sentence is said again from the rows: the sold-out ones "are sold out", the low ones "are nearly gone".
const norm = (x) => String(x || '').toLowerCase().replace(/[–—-]/g, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const SOLD = /^(?:sold out|out of stock|0 left|none left|unavailable)$/i, LOW = /^(?:(?:only )?\d+ left|low|low stock|running low|almost gone|nearly gone)$/i;
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const LOW_SAID = /([^.;:!?]+?)\s+(are|is)\s+(nearly gone|almost gone|running low|running out|low on stock|about to sell out)\b/i;
/* the rows of a stock card as { name, sold, low } (rows the card carries as [name, state]) */
export const stockRows = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => Array.isArray(r) && r.length >= 2).map(([k, v]) => ({ name: String(k), sold: SOLD.test(String(v).trim()), low: LOW.test(String(v).trim()) })).filter((r) => r.sold || r.low);
export function stockSay(text, rows) {
  if (typeof text !== 'string' || !LOW_SAID.test(text)) return text;
  const st = stockRows(rows); if (!st.some((r) => r.sold)) return text;
  const rowOf = (name) => { const n = norm(name); return n.length >= 4 ? st.find((r) => { const k = norm(r.name); return k === n || k.includes(n) || n.includes(k); }) : null; };
  return text.replace(LOW_SAID, (m, subj, verb, said) => {
    const lead = /^\s*/.exec(subj)[0], names = subj.trim().split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).filter(Boolean), found = names.map((n) => ({ n, r: rowOf(n) }));
    if (!found.some((x) => x.r?.sold)) return m; /* the sentence names no sold-out row: it stands */
    const sold = found.filter((x) => x.r?.sold).map((x) => x.n), low = found.filter((x) => !x.r?.sold).map((x) => x.n);
    if (!low.length) low.push(...st.filter((r) => r.low && !found.some((x) => x.r === r)).slice(0, 2).map((r) => r.name)); /* the low ones the rows list, as the card shows them */
    const be = (xs) => (xs.length > 1 ? 'are' : 'is');
    return `${lead}${andList(sold)} ${be(sold)} sold out${low.length ? `; ${andList(low)} ${be(low)} ${said}` : ''}`; });
}
