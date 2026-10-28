// Tools a brand doesn't use, hidden for that brand only (2026-10-28: Arata has no Klaviyo). A hidden tool is no connector on
// its page, no onboarding or Signals row, no "Connect …" target on a card, and its name never shows in the brand's words:
// cards, moves, the brief, the facts and the Brand Book say what it does instead ("your email tool"). Nothing is disconnected
// and nothing is rewritten: saved text is scrubbed each time it is served, so taking a row out brings everything back.
// Keyed by the brand's host (www. dropped) or its slug.
export const HIDE = { 'arata.in': ['klaviyo'], 'arata-in': ['klaviyo'] };
/* what each hidden tool is called instead. The name as written in words (capital K) only: ids, keys and links stay as they are
   (klaviyo, klaviyo.flows.off, klaviyo.com) */
const NEUTRAL = { klaviyo: { re: /\bKlaviyo(['’]s)?\b/g, say: 'your email tool',
  /* "Klaviyo flows" says the thing itself: "email flows" */
  thing: /\bKlaviyo( (?:flows?|campaigns?|lists?|emails?|segments?|forms?|popups?|sequences?|templates?))\b/g, as: 'email' } };
const NONE = new Set();

const clean = (x) => String(x || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
/* the hidden tools of a brand, from any of its host or slug (empty for every brand without a row) */
export function hiddenFor(...keys) {
  const out = new Set(); for (const k of keys.flat()) for (const id of HIDE[clean(k)] || []) out.add(id);
  return out.size ? out : NONE;
}

/* one string, with each hidden tool's name said as what it does. A link or an id keeps its letters (klaviyo.com, klaviyo.flows.off) */
export function scrubText(s, hidden) {
  if (typeof s !== 'string' || !hidden?.size) return s;
  const starts = (all, at) => at === 0 || /[.!?]\s*$|^\s*$|\n\s*$|[>"“]\s*$/.test(all.slice(Math.max(0, at - 3), at));
  const linky = (all, at, len) => /[./_\-@]/.test(all[at - 1] || '') || /^[_\-@/]|^\.[a-z0-9]/i.test(all.slice(at + len, at + len + 2));
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  let out = s;
  for (const id of hidden) { const n = NEUTRAL[id]; if (!n || !out.includes('Klaviyo')) continue;
    out = out.replace(n.thing, (m, rest, at, all) => (linky(all, at, m.length) ? m : `${starts(all, at) ? cap(n.as) : n.as}${rest}`));
    out = out.replace(n.re, (m, poss, at, all) => { if (linky(all, at, m.length)) return m;
      const words = `${n.say}${poss ? '’s' : ''}`; return starts(all, at) ? cap(words) : words; }); }
  return out;
}

/* a whole value (a seed, a move, a card list): every string in it scrubbed. Keys and ids are left alone; the same value comes back
   when the brand hides nothing */
const KEEP_KEYS = new Set(['id', 'key', 'url', 'href', 'src', 'img', 'image', 'images', 'photo', 'logo', 'k', 'conn', 'onlyWhen', 'slug', 'host']);
export function scrubTools(v, hidden, depth = 0) {
  if (!hidden?.size || v == null || depth > 40) return v;
  if (typeof v === 'string') return scrubText(v, hidden);
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = scrubTools(v[i], hidden, depth + 1); return v; }
  if (typeof v === 'object') { for (const k of Object.keys(v)) if (!KEEP_KEYS.has(k)) v[k] = scrubTools(v[k], hidden, depth + 1); return v; }
  return v;
}

/* the brand's seed without its hidden tools: no connector, no role chip, no card pointing at one, no name in the words */
export function hideInSeed(seed, hidden) {
  if (!seed || !hidden?.size) return seed;
  for (const id of hidden) if (seed.connectors) delete seed.connectors[id];
  for (const r of Object.values(seed.roles || {})) if (Array.isArray(r?.connectors)) r.connectors = r.connectors.filter((k) => !hidden.has(k));
  for (const p of seed.posts || []) { if (!p) continue; if (hidden.has(p.conn)) delete p.conn; if (hidden.has(p.onlyWhen)) p.hiddenTool = true;
    if (p.live) for (const id of hidden) delete p.live[id]; }
  seed.posts = (seed.posts || []).filter((p) => !p?.hiddenTool);
  seed.hiddenTools = [...hidden];
  return scrubTools(seed, hidden);
}

/* one line for the AI's system text: the brand doesn't use these tools, so they are never named (a streamed reply isn't scrubbed) */
const TOOL_NAME = { klaviyo: 'Klaviyo' };
export const hiddenNote = (hidden) => (!hidden?.size ? '' : `This brand does not use ${[...hidden].map((id) => TOOL_NAME[id] || id).join(' or ')}. Never name ${hidden.size > 1 ? 'them' : 'it'}; say "${[...hidden].map((id) => NEUTRAL[id]?.say || 'their tool').join('" or "')}" instead.`);
