// Your feed, tuned (UI2 Memory → "Your feed"): per member, per brand.
//   weights  less | normal | more for each agent (creative, performance, storefront, visibility, crm): the ranker adds WEIGHT[w]
//   topics   up to 12 short topics; a card that mentions one is lifted (two at most count)
//   notes    "My preferences" dropped into Brew (drop.js dest=prefs): kept for the member, read by nothing that spends
//   ignored  learned signals the member deleted ("picked up from your choices"): the ranker stops using them
// Learned signals are not stored: they are read from the workspace's own card feedback (hearts, Not for me, Fewer) every time,
// so they always match what the ranker uses, and deleting one only adds its id to `ignored`.
// Kept in the brand pack at private/tuning.json { [memberKey]: tuning }. JSON in GCS: safe at max-instances=1 (brew-storage).
const FILE = 'private/tuning.json';
export const AGENTS = ['creative', 'performance', 'storefront', 'visibility', 'crm'];
export const WEIGHT = { less: -4, normal: 0, more: 4 };
const NAME = { creative: 'Creative', performance: 'Performance', storefront: 'Storefront', visibility: 'AI visibility', crm: 'CRM' };

const str = (x, n) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const emptyTuning = () => ({ weights: Object.fromEntries(AGENTS.map((a) => [a, 'normal'])), topics: [], notes: [], ignored: [], at: null });
/* what a client may set: unknown agents, weights and anything else are dropped */
export function cleanTuning(x = {}, base = emptyTuning()) {
  const out = { ...emptyTuning(), ...base, weights: { ...emptyTuning().weights, ...(base.weights || {}) } };
  if (x.weights && typeof x.weights === 'object') for (const a of AGENTS) if (WEIGHT[x.weights[a]] != null) out.weights[a] = x.weights[a];
  if (Array.isArray(x.topics)) out.topics = [...new Set(x.topics.map((t) => str(t, 40).toLowerCase()).filter((t) => t.length >= 2))].slice(0, 12);
  if (Array.isArray(x.ignored)) out.ignored = [...new Set(x.ignored.map((t) => str(t, 80)).filter(Boolean))].slice(0, 100);
  return out;
}
const textOf = (c) => `${c.title || ''} ${c.sub || ''} ${c.campaign || ''} ${c.src || ''} ${(c.detail?.why || []).join(' ')}`.toLowerCase();
/* the ranker's lift for one card: the agent's weight, plus 2 for each topic the card mentions (two at most) */
export function tuneScore(tuning, c) {
  if (!tuning || !c) return 0;
  const w = WEIGHT[tuning.weights?.[c.agent]] || 0;
  const tx = (tuning.topics || []).length ? textOf(c) : '';
  const hits = (tuning.topics || []).filter((t) => tx.includes(t)).length;
  return w + Math.min(2, hits) * 2;
}

/* "Picked up from your choices": what the workspace's card feedback teaches the ranker (feed-service affinityMap and fewer).
   Each has a stable id so the member can delete it. A like needs 2 hearts on that agent or campaign; a skip needs one Not for me
   on that agent, two in one area; fewer is the Fewer button */
export function learnedSignals({ feedback = [], cards = new Map(), fewer = {}, ignored = [] } = {}) {
  const hearts = new Map(); feedback.forEach((f) => { if (f.kind === 'heart') hearts.set(f.cardId, 1); if (f.kind === 'unheart') hearts.delete(f.cardId); });
  const n = {}; const inc = (k) => (n[k] = (n[k] || 0) + 1);
  hearts.forEach((_, id) => { const c = cards.get(id); if (!c) return; inc(`like:agent:${c.agent}`); if (c.campaign) inc(`like:campaign:${c.campaign}`); });
  feedback.forEach((f) => { if (f.kind !== 'not_interested') return; const c = cards.get(f.cardId); if (!c) return; inc(`skip:agent:${c.agent}`); if (c.sector) inc(`skip:sector:${c.sector}`); });
  Object.entries(fewer || {}).forEach(([a, k]) => { if (k > 0) n[`fewer:${a}`] = k; });
  const out = [];
  for (const [id, k] of Object.entries(n)) {
    const [kind, what, v0] = id.split(':'), v = v0 ?? what;
    const name = what === 'agent' || kind === 'fewer' ? NAME[v] || v : v;
    if (kind === 'like' && k >= 2) out.push({ id, kind: 'like', text: what === 'campaign' ? `You like cards about ${name}` : `You like ${name} cards`, why: `You liked ${k}`, n: k });
    if (kind === 'skip' && (what === 'agent' ? k >= 1 : k >= 2)) out.push({ id, kind: 'skip', text: what === 'sector' ? `You skip ${name} cards` : `You often pass on ${name} cards`, why: `Not for me on ${k}`, n: k });
    if (kind === 'fewer') out.push({ id, kind: 'fewer', text: `You asked for fewer ${name} cards`, why: `Fewer, ${k} time${k > 1 ? 's' : ''}`, n: k });
  }
  const gone = new Set(ignored || []);
  return out.filter((x) => !gone.has(x.id)).sort((a, b) => b.n - a.n);
}
/* the ranker's affinity and fewer maps, without the signals the member deleted */
export function withoutIgnored(af, fewer, ignored = []) {
  if (!ignored?.length) return { af, fewer };
  const a = { ...af, agent: { ...af.agent }, campaign: { ...af.campaign }, no: { ...(af.no || {}) }, noSector: { ...(af.noSector || {}) } }, f = { ...(fewer || {}) };
  for (const id of ignored) { const [kind, what, v] = String(id).split(':');
    if (kind === 'like' && what === 'agent') delete a.agent[v]; if (kind === 'like' && what === 'campaign') delete a.campaign[v];
    if (kind === 'skip' && what === 'agent') delete a.no[v]; if (kind === 'skip' && what === 'sector') delete a.noSector[v];
    if (kind === 'fewer') delete f[what]; }
  return { af: a, fewer: f };
}

/* the store: one JSON per brand, cached so the ranker reads it without waiting; writes per brand go one after another */
export function createTuning({ packs, now = () => Date.now(), log = console }) {
  const cache = new Map(), locks = new Map();
  const load = async (slug) => { if (cache.has(slug)) return cache.get(slug); const all = (await packs.getJSON(slug, FILE, null).catch(() => null)) || {}; cache.set(slug, all); return all; };
  const peek = (slug, key) => (key && cache.get(slug)?.[key]) || null;
  const get = async (slug, key) => cleanTuning({}, (await load(slug))[key] || emptyTuning());
  const write = (slug, key, fn) => { const run = (locks.get(slug) || Promise.resolve()).catch(() => {}).then(async () => {
    const all = await load(slug); const cur = cleanTuning({}, all[key] || emptyTuning()); const next = fn(cur) || cur; next.at = now(); all[key] = next; await packs.put(slug, FILE, all); return next; });
    locks.set(slug, run); return run; };
  const put = (slug, key, patch) => write(slug, key, (cur) => cleanTuning(patch, cur));
  const addNote = (slug, key, text, { source = 'note' } = {}) => write(slug, key, (cur) => { const id = 'pn_' + Math.random().toString(16).slice(2, 10); cur.notes = [{ id, text: str(text, 4000), source: str(source, 140), at: now() }, ...(cur.notes || [])].slice(0, 50); return cur; });
  const dropNote = (slug, key, id) => write(slug, key, (cur) => { cur.notes = (cur.notes || []).filter((n) => n.id !== id); return cur; });
  const ignore = (slug, key, id) => write(slug, key, (cur) => { cur.ignored = [...new Set([...(cur.ignored || []), str(id, 80)])].slice(-100); return cur; });
  const unignore = (slug, key, id) => write(slug, key, (cur) => { cur.ignored = (cur.ignored || []).filter((x) => x !== id); return cur; });
  return { load, peek, get, put, addNote, dropNote, ignore, unignore, _cache: cache };
}
