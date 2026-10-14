// Fact gate: every money amount and percentage on a card must be in the fact sheet (public/data/facts.js).
// Used by the QA agent before a card can reach the feed, and by tools/check_facts.mjs before every deploy.
// A number that isn't in the sheet is either a new fact (add it to data/facts.manual.json with its source)
// or a mistake. Either way it doesn't ship unchecked.
// Strict mode (cards written from moves and reads, cards-gen.js) also gates multipliers ("3x") and large counts
// ("12,000 customers", "5k followers").

// every currency moneyFmt prints (₹ $ £ € ¥, A$ C$ S$, AED and the three-letter codes) and the ways people write rupees
const CUR = String.raw`(?:₹|Rs\.?\s?|INR\s?|AED\s?|USD\s?|US\$|SGD\s?|AUD\s?|CAD\s?|GBP\s?|EUR\s?|JPY\s?|A\$|C\$|S\$|\$|£|€|¥)`;
const SCALEW = String.raw`(?:\s?(?:lakh|L|Cr|cr|crore|k|K|M|B|bn|mn|million|billion)\b)?`;
const MONEY = String.raw`${CUR}\s?\d[\d,]*(?:\.\d+)?${SCALEW}`;
const PCT = String.raw`\b\d+(?:\.\d+)?\s?%`;
const NUM = new RegExp(`${MONEY}|${PCT}`, 'g');
// strict: plus "3x"/"2.5×" and counts of a thousand or more (with commas, or a scale word); years are not counts
const MULT = String.raw`\b\d+(?:\.\d+)?\s?(?:x|X|×)(?![a-zA-Z0-9])`;
const BIG = String.raw`\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b|\b\d{4,}(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s?(?:k|K|M|lakh|crore|million|billion|mn|bn)\b`;
const NUM_STRICT = new RegExp(`${MONEY}|${PCT}|${MULT}|${BIG}`, 'g');

const SYM = [[/^(?:rs\.?|inr)/, '₹'], [/^(?:usd|us\$)/, '$'], [/^aud/, 'a$'], [/^cad/, 'c$'], [/^sgd/, 's$'], [/^gbp/, '£'], [/^eur/, '€'], [/^jpy/, '¥']];
const SCALE = { lakh: 1e5, l: 1e5, cr: 1e7, crore: 1e7, k: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };
const fmtN = (v) => String(Math.round(v * 100) / 100);
// one spelling per amount: "Rs 4,299", "₹4299.00" and "₹ 4,299" are the same; "₹2 lakh" is "₹200000"; "3 X" is "3x"
export const canon = (s) => {
  let t = String(s).replace(/\s+/g, '').replace(/,/g, '').toLowerCase();
  for (const [re, sym] of SYM) if (re.test(t)) { t = t.replace(re, sym); break; }
  if (/%$/.test(t)) return fmtN(parseFloat(t)) + '%';
  if (/^\d+(?:\.\d+)?[x×]$/.test(t)) return fmtN(parseFloat(t)) + 'x';
  const m = t.match(/^([^\d]*)(\d+(?:\.\d+)?)(lakh|crore|cr|l|k|m|b|bn|mn|million|billion)?$/);
  if (!m) return t;
  return m[1] + fmtN(parseFloat(m[2]) * (m[3] ? SCALE[m[3]] : 1));
};
export const numbersIn = (text, { strict = false } = {}) => {
  const s = String(text ?? '');
  const out = (s.match(strict ? NUM_STRICT : NUM) || []).map((x) => x.trim());
  // years ("2026") and plain small numbers are not gated
  return out.filter((x) => !(strict && /^\d{4}$/.test(x) && +x >= 1900 && +x <= 2100)).map(canon);
};

export const allowedFrom = (facts) => {
  const ok = new Set();
  for (const f of Object.values(facts || {})) {
    for (const s of [f.v, ...(f.aliases || [])]) numbersIn(s, { strict: true }).forEach((n) => ok.add(n));
    if (Number.isFinite(f.n) && Math.abs(f.n) >= 1000) ok.add(fmtN(f.n)); // a count fact ("5069") backs "5,069 reviews"
  }
  return ok;
};

const texts = (o, at = '', out = []) => {
  if (typeof o === 'string') out.push([at, o]);
  else if (Array.isArray(o)) o.forEach((x, i) => texts(x, `${at}[${i}]`, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!['images', 'img', 'id', 'src', 'logo', 'live'].includes(k)) texts(v, at ? `${at}.${k}` : k, out);
  return out;
};

// → [{ at, n, text }] for every number on the card that the fact sheet doesn't back, plus unresolved {{tokens}}
export const unbacked = (card, allowed, { strict = false } = {}) => {
  const bad = [];
  for (const [at, s] of texts(card)) {
    if (/⟨\w+\?⟩|\{\{\w+\}\}/.test(s)) bad.push({ at, n: s.match(/⟨\w+\?⟩|\{\{\w+\}\}/)[0], text: s });
    for (const n of numbersIn(s, { strict })) if (!allowed.has(n)) bad.push({ at, n, text: s });
  }
  return bad;
};

// the numbers a move's text backs for its cards: a number marked "(to confirm)", or in a sentence that says it is a
// target, an assumption, an estimate or an example, is the plan's, not a fact, and never reaches a card as one
const UNBACKED_CTX = /\(to confirm\)|to confirm|\btarget|assum|estimat|propos|hypothe|forecast|project(?:ed|ion)|scenario|illustrat|placeholder|dramati|for example|e\.g\.|\bsample\b|benchmark|\bgoal\b|\baim\b|\bwould\b|\bcould\b|\bexpect/i;
export function backedNumbers(move, { strict = true } = {}) {
  const ok = new Set(), strs = [];
  const walk = (o) => { if (typeof o === 'string') strs.push(o); else if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v); };
  walk(move?.sections || []);
  for (const s of strs) for (const sent of s.split(/(?<=[.!?;])\s+|\n+/)) {
    if (UNBACKED_CTX.test(sent)) continue;
    numbersIn(sent, { strict }).forEach((n) => ok.add(n));
  }
  return ok;
}

/* numbers that stopped being true (a product gone from the store, a price that changed, a fact the team removed): a move
   written before still quotes them, so the sentences that carry one are dropped before the move backs any card.
   retired: canon numbers (facts-edits.json "retired"); still: the current allowed set (a number another fact still backs stays) */
export const retiredSet = (retired = [], still = new Set()) => new Set((retired || []).map((r) => (typeof r === 'string' ? r : r?.n)).filter((n) => n && !still.has(n)));
export function scrubRetired(move, retired) {
  if (!move || !retired?.size) return move;
  const clean = (s) => typeof s !== 'string' ? s : s.split(/(?<=[.!?;])\s+/).filter((sent) => !numbersIn(sent, { strict: true }).some((n) => retired.has(n))).join(' ');
  const walk = (o) => typeof o === 'string' ? clean(o) : Array.isArray(o) ? o.map(walk) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)])) : o;
  return { ...move, sections: walk(move.sections || []) };
}
