// A card's counts follow today's fact sheet. A card is written once from the numbers of its day ("Out of stock products: 10",
// "Live Meta ads: 1,577") and stays in the feed for days, so its rows went stale while the fact sheet moved on (Arata 22 Oct:
// 12 out of stock, 1,337 live ads, under an "Updated" badge). On every serve, each row whose label names one of the brand's
// counts takes today's value, and the same old number in the card's words (in a sentence about that count) changes with it.
// Generic for every brand and card: only plain counts (no %, money or ratios), only a label that matches exactly one fact,
// and the team's own numbers (learnings, baselines) are never touched because no fact carries them. For a member, every connected
// account (Shopify, GA4, Meta, Google Ads, Klaviyo, Judge.me) is the truth: a row named like its measure (facts-desk.js NAMES)
// takes the account's value, shares, money and returns included.
const STOP = new Set(['of', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'and', 'with', 'from', 'by', 'your', 'our', 'their', 'its', 'all', 'today', 'now', 'right', 'number', 'count', 'total']);
const stem = (w) => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
const words = (s, drop = new Set()) => new Set((String(s || '').toLowerCase().replace(/\(read [^)]*\)/g, ' ').match(/[a-z]+/g) || []).map(stem).filter((w) => !STOP.has(w) && !drop.has(w)));
const COUNT = /^\d{1,3}(?:,\d{2,3})*$|^\d+$/; /* "12", "1,337", "1,23,456": a plain count, nothing else */
const toN = (x) => +String(x).replace(/,/g, '');
/* a value's kind: a plain count, a share, money or a return ("2.1x"); anything else (lists, "0 of 5") is never swapped */
const kindOf = (v) => (COUNT.test(v) ? 'count' : /^-?\d+(?:\.\d+)?%$/.test(v) ? 'pct' : /^[₹$£€]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:L|Cr|k|K|M))?$/.test(v) ? 'money' : /^\d+(?:\.\d+)?x$/i.test(v) ? 'x' : null);
const numOf = (v) => +String(v).replace(/[^\d.-]/g, '');
const fmt = (n, like) => (!/,/.test(like) && n >= 1000 ? String(n) : /,\d{2},/.test(like) ? n.toLocaleString('en-IN') : n.toLocaleString('en-US')); /* written the way the card wrote it */

/* the brand's counts as { words, n, at }: facts with a plain count value, and today's numbers (pack-numbers numberRows), newest wins */
export function countsOf(facts = {}, rows = [], brandName = '') {
  const drop = words(brandName), out = new Map();
  const add = (label, v, n, at) => { const num = Number.isFinite(+n) ? +n : COUNT.test(String(v ?? '').trim()) ? toN(v) : NaN; if (!Number.isFinite(num) || !label) return;
    const w = words(label, drop); if (!w.size) return; const k = [...w].sort().join(' '); const t = Date.parse(at || 0) || 0, was = out.get(k);
    const owner = (/^([^:]{2,60}):/.exec(String(label)) || [])[1]; /* "Comet: live Meta ads": a rival's count names its owner */
    if (!was || t >= was.t) out.set(k, { words: w, n: num, t, owner: owner && !words(owner, drop).size ? null : owner || null }); };
  for (const f of Object.values(facts || {})) { if (!f || typeof f !== 'object' || f.kind === 'demo' || f.kind === 'proposed' || f.kind === 'price' || f.connected || /price|mrp|₹|\$|%/i.test(`${f.label} ${f.v}`)) continue; if (!COUNT.test(String(f.v ?? '').trim())) continue; add(String(f.label || '').replace(/\s*\(read [^)]*\)$/, ''), f.v, f.n, f.at); }
  for (const r of rows || []) add(r.label, r.v, r.n, r.at);
  /* a connected account's number (a member's truth, facts-desk.js): its own label and each plain name a card row gives it,
     money, shares and returns too. The account is the truth, so it wins over any site count of the same words */
  for (const f of Object.values(facts || {})) { if (!f?.connected || f.stale || f.demo) continue; const v = String(f.v ?? '').trim(), kind = kindOf(v); if (!kind) continue;
    const n = kind === 'count' ? toN(v) : numOf(v); if (!Number.isFinite(n)) continue;
    for (const label of [String(f.label || ''), ...(f.names || [])]) { const w = words(label, drop); if (!w.size) continue; out.set([...w].sort().join(' '), { words: w, n, v, kind, t: Infinity, owner: null, live: true }); } }
  return [...out.values()];
}
/* the one count a row's label names: the same words first ("Live Meta ads" is the brand's own, not "Pilgrim: live Meta ads"),
   else every word of the label in the fact's label with at most one word more; two candidates means no match */
/* only a word that narrows the same count may be missing from the row ("Comet live ads" is "Comet: live Meta ads"), never a name or a place */
const QUAL = new Set(['meta', 'catalog', 'catalogue', 'store', 'site', 'live', 'active', 'running', 'listed']);
const matchOf = (label, counts) => { const w = words(label); if (!w.size) return null;
  const has = (c) => [...w].every((x) => c.words.has(x));
  const exact = counts.filter((c) => has(c) && c.words.size === w.size); if (exact.length) return exact.length === 1 ? exact[0] : null;
  const hits = counts.filter((c) => has(c) && c.words.size - w.size === 1 && [...c.words].every((x) => w.has(x) || QUAL.has(x)));
  return hits.length === 1 ? hits[0] : null; };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* the old number in a sentence that also names the count ("any of your 10 products sell out"), never a %, ₹ or decimal */
const swapIn = (text, from, to, key) => { if (typeof text !== 'string' || !text) return text;
  const re = new RegExp(`(?<![\\d.,₹$£€])${esc(from)}(?![\\d%]|[.,]\\d|x\\b)`, 'g');
  return text.split(/(?<=[.!?])\s+/).map((s) => { const sw = words(s); return [...key].filter((k) => sw.has(k)).length >= Math.min(2, key.size) ? s.replace(re, to) : s; }).join(' '); }; /* the sentence names the count (two of its words), not one passing word like "stock" */

/* the card with today's counts: a new object only when a row changed */
/* live: a member's view, whose counts carry their connected accounts, so the team's own cards follow them too */
export function freshCounts(card, counts, { live = false } = {}) {
  if (!card || typeof card !== 'object' || !Array.isArray(card.rows) || !counts?.length || (card.liveOnly && !live) || card.demo || card.mock) return card;
  const said = `${card.title || ''} ${card.sub || ''}`.toLowerCase();
  /* a card about someone else's numbers (a rival named in its words) never takes the brand's own count for a row that names no one */
  const others = counts.filter((c) => c.owner).map((c) => c.owner.toLowerCase()).filter((o) => said.includes(o));
  const swaps = []; const rows = card.rows.map((r) => { if (!Array.isArray(r) || r.length < 2) return r; const v = String(r[1] ?? '').trim(), kind = kindOf(v); if (!kind) return r;
    const m = matchOf(r[0], counts.filter((c) => (c.kind || 'count') === kind)); if (!m) return r;
    if (!m.owner && others.length) return r;
    if (m.live) { /* a connected account's number: the row takes it as the account says it (to or from none still waits for the rewrite; money only in the row's own currency) */
      if (kind === 'money' && v.trim()[0] !== m.v.trim()[0]) return r; if (v === m.v || numOf(v) === m.n) return r; if (!m.n || !numOf(v)) return r; swaps.push({ from: v, to: m.v, key: words(r[0]) }); return [r[0], m.v, ...r.slice(2)]; }
    if (m.n === toN(v)) return r;
    if (!m.owner && others.length) return r;
    const was = toN(v); if (!m.n || !was || Math.max(m.n, was) > 5 * Math.min(m.n, was)) return r; /* to or from none changes what the card means: it waits for its rewrite */ /* a jump this big is another measure or a read that failed, never a quiet edit */ const now = fmt(m.n, v); swaps.push({ from: v, to: now, key: words(r[0]) }); return [r[0], now, ...r.slice(2)]; });
  if (!swaps.length) return card;
  const fix = (x) => swaps.reduce((t, s) => swapIn(t, s.from, s.to, s.key), x);
  const out = { ...card, rows, title: fix(card.title), sub: fix(card.sub) };
  if (card.detail) out.detail = { ...card.detail, why: (card.detail.why || []).map(fix), how: (card.detail.how || []).map(fix) };
  if (card.because) out.because = fix(card.because);
  out.liveNums = [...new Set([...(card.liveNums || []), ...swaps.map((s) => s.to)])]; /* the proof sheet backs the new numbers */
  return out;
}
