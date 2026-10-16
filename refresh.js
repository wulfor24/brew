// Keeping the moves current. A fresh read of the brand (or new data from a connected account) is compared with the
// evidence the moves were written from. Only material changes count: a price, a product, a rival, a claim, a policy,
// live ads, or a number that moved by 10% or more. Each change is matched to the moves that quote it or rest on it,
// and Sonnet judges which of those plans would actually change. Those moves are flagged with the reason; a rewrite
// writes them again from the new evidence (Opus), keeps the old version, and refreshes their cards and PDFs.

// what a ledger key is about (same prefixes the moves engine slices evidence by), plus connected accounts
const AREAS = [['price', ['price.', 'mrp.']], ['catalog', ['catalog.', 'product.']], ['claim', ['claim.']], ['reviews', ['reviews.', 'review.']],
  ['company', ['company.']], ['rival', ['rival.']], ['ads', ['ads.']], ['checkout', ['site.checkout', 'checkout.']], ['tech', ['site.tech', 'tech.']],
  ['policies', ['policy.']], ['site', ['site.']], ['socials', ['social.', 'socials.']], ['ai', ['ai.']], ['search', ['search.']],
  // connected accounts (Shopify, Meta, GA4, Klaviyo): their numbers enter the ledger under these prefixes
  ['store', ['shopify.', 'store.']], ['paid', ['meta.', 'gads.', 'paid.']], ['analytics', ['ga4.', 'analytics.']], ['email', ['klaviyo.', 'email.']]];
export const areaOf = (key) => (AREAS.find(([, ps]) => ps.some((p) => key.startsWith(p))) || ['other'])[0];
// connected-account areas map to the moves that measure or spend on them
export const CONNECTED_MOVES = { store: [4, 9, 10, 29, 30, 31, 32, 36, 37, 39, 40, 41, 42, 48], paid: [9, 10, 20, 21, 22, 23, 49], analytics: [9, 10, 11, 12, 13, 31, 32, 37], email: [39, 40, 41, 42, 43, 44], reviews: [29, 43, 62] };
// areas where any change matters; elsewhere a number has to move 10% or more
const ALWAYS = new Set(['price', 'catalog', 'claim', 'rival', 'policies', 'checkout', 'ads', 'company']);
const brandOwned = (e) => e.method === 'brand-confirmed' || /\.confirmed$|^brand\.confirmed\./.test(e.key) || /added by the brand/.test(e.method || '');
const num = (e) => (typeof e?.n === 'number' ? e.n : (() => { const m = String(e?.v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; })());
const same = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// the new ledger: the fresh read wins, except what the brand confirmed; keys the read didn't return stay as they were
// (a stage that failed today is not a change), unless the catalog was read and a priced product is no longer in it
export function mergeLedger(old = [], fresh = [], { catalogRead = false, connected = [] } = {}) {
  const by = new Map(old.map((e) => [e.key, e]));
  const out = new Map();
  for (const e of old) out.set(e.key, e);
  for (const e of [...fresh, ...connected]) { const o = by.get(e.key); if (o && brandOwned(o)) continue; out.set(e.key, e); }
  const removed = [];
  if (catalogRead) { const now = new Set(fresh.map((e) => e.key)); for (const e of old) if (/^price\./.test(e.key) && !brandOwned(e) && !/added by the brand/.test(e.method || '') && !now.has(e.key)) { out.delete(e.key); removed.push(e); } }
  return { ledger: [...out.values()], removed };
}

// what changed, material changes only, with plain wording
export function diffLedgers(old = [], next = [], removed = []) {
  const was = new Map(old.map((e) => [e.key, e])), changes = []; let minor = 0;
  for (const e of next) {
    const o = was.get(e.key), area = areaOf(e.key);
    if (!o) { if (ALWAYS.has(area) || area in CONNECTED_MOVES) changes.push({ kind: 'new', key: e.key, area, label: e.label || e.key, now: String(e.v), src: e.url || e.src || '', at: e.at }); else minor++; continue; }
    if (same(o.v, e.v)) continue;
    const a = num(o), b = num(e), rel = a != null && b != null ? Math.abs(b - a) / Math.max(Math.abs(a), 1) : null;
    const material = ALWAYS.has(area) || area in CONNECTED_MOVES ? (rel == null || rel > 0.005) : rel == null ? false : rel >= 0.1;
    if (!material) { minor++; continue; }
    changes.push({ kind: 'changed', key: e.key, area, label: e.label || o.label || e.key, was: String(o.v), now: String(e.v), pct: rel != null && a ? Math.round(100 * (b - a) / Math.abs(a)) : null, src: e.url || e.src || '', at: e.at });
  }
  for (const e of removed) changes.push({ kind: 'removed', key: e.key, area: areaOf(e.key), label: e.label || e.key, was: String(e.v), src: e.url || e.src || '' });
  return { changes, minor };
}
/* a connected account's re-read (every 6 or 12 hours) against the value each move was last written with (`base`), not the
   previous read: a number counts once it has moved `pct` (10%) or more since then, so slow drift adds up and noise never
   flags. A list (channels, countries, flows) counts when its names change, not its shares. Returns the material changes and
   the new base: a key that moved takes its new value (the rewrite will use it), one that didn't keeps its old one. */
const names = (v) => String(v ?? '').toLowerCase().replace(/[\d.,%$€£₹+\-]+/g, ' ').replace(/\s+/g, ' ').trim();
export function liveMaterial(base = {}, rows = [], { pct = 0.1 } = {}) {
  const next = { ...base }, changes = [];
  for (const e of rows) {
    const b = base[e.key];
    if (!b) { next[e.key] = { v: e.v, ...(typeof e.n === 'number' ? { n: e.n } : {}) }; continue; } /* a key seen for the first time is the base */
    let material, p = null;
    if (typeof e.n === 'number' && typeof b.n === 'number') { const rel = Math.abs(e.n - b.n) / Math.max(Math.abs(b.n), 1); material = rel >= pct; p = b.n ? Math.round(100 * (e.n - b.n) / Math.abs(b.n)) : null; }
    else material = names(b.v) !== names(e.v);
    if (!material) continue;
    changes.push({ kind: 'changed', key: e.key, label: e.label || e.key, was: String(b.v), now: String(e.v), pct: p });
    next[e.key] = { v: e.v, ...(typeof e.n === 'number' ? { n: e.n } : {}) };
  }
  return { changes, base: next };
}

export const changeLine = (c) => c.kind === 'new' ? `New: ${c.label}: ${c.now}` : c.kind === 'removed' ? `Gone: ${c.label} (was ${c.was})` : `${c.label}: ${c.was} → ${c.now}${c.pct != null ? ` (${c.pct > 0 ? '+' : ''}${c.pct}%)` : ''}`;

// which moves each change touches: the move quotes the old value or names the thing, or its evidence areas include it
export function candidates(changes, moves, specs) {
  const out = {};
  const txt = Object.fromEntries(Object.entries(moves).map(([n, m]) => [n, JSON.stringify(m.sections || []).toLowerCase()]));
  changes.forEach((c, i) => {
    // a move quotes a change when it has the old value next to the thing's name (a price shared by ten products only
    // counts where the move names this product); a removed product counts wherever it is named
    const thing = String(c.label).replace(/\s*(price|mrp|\(.*\))\s*$/i, '').split(':').pop().trim().toLowerCase();
    const distinct = (v) => v && String(v).trim().length >= 3 && !/^\d{1,2}(\.\d)?%?$/.test(String(v).trim());
    const hit = (t) => c.kind === 'removed' ? thing.length >= 4 && t.includes(thing)
      : c.kind === 'changed' && distinct(c.was) && t.includes(String(c.was).toLowerCase().trim()) && (thing.length < 4 || ['reviews', 'ads', 'ai', 'search', 'site'].includes(c.area) || t.includes(thing));
    for (const sp of specs) {
      /* a cadence move sitting on a spec's number is not that spec's plan: it is rewritten by its own weekly run from fresh evidence */
      if (!sp.n || !moves[sp.n] || moves[sp.n]?.meta?.cadence) continue;
      const quotes = hit(txt[sp.n]);
      const rests = (sp.evidence || []).includes(c.area) || (CONNECTED_MOVES[c.area] || []).includes(sp.n);
      if (quotes || rests) (out[sp.n] ||= { quotes: [], rests: [] })[quotes ? 'quotes' : 'rests'].push(i);
    }
  });
  return out;
}

const TRIAGE = { type: 'object', properties: {
  summary: { type: 'string', description: 'one sentence: what changed for the brand since the moves were written' },
  moves: { type: 'array', items: { type: 'object', properties: {
    n: { type: 'integer' }, priority: { type: 'string', enum: ['high', 'medium'] },
    why: { type: 'string', description: 'one plain sentence naming the change and what in the plan it affects, under 30 words' },
    changes: { type: 'array', items: { type: 'integer' }, description: 'indexes of the changes that matter to this move' } } } } } };

// Sonnet decides which flagged moves would really change; a move that quotes a changed value is always listed (medium if Sonnet left it out)
export async function triage(ai, { name, changes, cand, moves, specs }) {
  const list = Object.entries(cand).map(([n, c]) => { const m = moves[n], sp = specs.find((s) => s.n === +n);
    return `${String(n).padStart(2, '0')} ${m.title} | ${sp?.discipline || ''} | gives: ${String(m.gives || '').slice(0, 160)} | quotes changes: ${c.quotes.join(',') || '-'} | rests on: ${c.rests.slice(0, 12).join(',') || '-'}`; });
  if (!list.length) return { summary: 'Nothing that changes a move.', moves: [] };
  const r = await ai.call({ model: 'sonnet', schema: TRIAGE, max: 6000, tag: 'refresh-triage', system: 'You keep a brand\'s growth plans current. You are strict: a plan is only flagged when the change alters a number it quotes, a product or rival it is built on, its target, or its first 30 days.',
    prompt: `Brand: ${name}\n\nWhat changed in the evidence since the plans were written (index: change):\n${changes.map((c, i) => `${i}: ${changeLine(c)} [${c.area}]`).join('\n')}\n\nThe plans that touch these changes (n title | discipline | gives | changes it quotes word for word | changes in its evidence areas):\n${list.join('\n')}\n\nReturn only the plans that should be rewritten. high = it quotes a changed number or a removed product, or its core recommendation changes. medium = its evidence moved enough to change targets or examples. Leave out plans the change does not affect in substance.` });
  const keep = new Map((r.json?.moves || []).filter((x) => cand[x.n]).map((x) => [x.n, x]));
  for (const [n, c] of Object.entries(cand)) if (c.quotes.length && !keep.has(+n)) keep.set(+n, { n: +n, priority: 'medium', why: `It quotes ${changeLine(changes[c.quotes[0]])}.`, changes: c.quotes });
  return { summary: r.json?.summary || '', moves: [...keep.values()].sort((a, b) => (a.priority === b.priority ? a.n - b.n : a.priority === 'high' ? -1 : 1)), usd: r.usd };
}
