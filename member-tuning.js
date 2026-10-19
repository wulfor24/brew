import { sk } from './demo-mode.js';
// Your feed, tuned (UI2 Memory → "Your feed"): per member, per brand.
//   weights  less | normal | more for each agent (creative, performance, storefront, visibility, crm): the ranker adds WEIGHT[w]
//   topics   up to 12 short topics; a card that mentions one is lifted (two at most count)
//   notes    "My preferences" dropped into Brew (drop.js dest=prefs): kept for the member, read by nothing that spends
//   ignored  learned signals the member deleted ("picked up from your choices"): the ranker stops using them
//   saved    the cards this person saved (the bookmark), so every device they open shows them; a save counts as 1.5 hearts
// Notes ("My preferences") and the workspace's "Tell us why" notes also feed the ranker as a few keywords (noteTopics).
// Learned signals are not stored: they are read from the workspace's own card feedback (hearts, Not for me, Fewer) every time,
// so they always match what the ranker uses, and deleting one only adds its id to `ignored`.
// Kept in the brand pack at private/tuning.json { [memberKey]: tuning }. JSON in GCS: safe at max-instances=1 (brew-storage).
const FILE = 'private/tuning.json';
export const AGENTS = ['creative', 'performance', 'storefront', 'visibility', 'crm'];
export const WEIGHT = { less: -4, normal: 0, more: 4 };
const NAME = { creative: 'Creative', performance: 'Performance', storefront: 'Storefront', visibility: 'AI visibility', crm: 'CRM' };

const str = (x, n) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const emptyTuning = () => ({ weights: Object.fromEntries(AGENTS.map((a) => [a, 'normal'])), topics: [], notes: [], ignored: [], saved: [], at: null });
/* what a client may set: unknown agents, weights and anything else are dropped */
export function cleanTuning(x = {}, base = emptyTuning()) {
  const out = { ...emptyTuning(), ...base, weights: { ...emptyTuning().weights, ...(base.weights || {}) } };
  if (x.weights && typeof x.weights === 'object') for (const a of AGENTS) if (WEIGHT[x.weights[a]] != null) out.weights[a] = x.weights[a];
  if (Array.isArray(x.topics)) out.topics = [...new Set(x.topics.map((t) => str(t, 40).toLowerCase()).filter((t) => t.length >= 2))].slice(0, 12);
  if (Array.isArray(x.ignored)) out.ignored = [...new Set(x.ignored.map((t) => str(t, 80)).filter(Boolean))].slice(0, 100);
  out.setup = base.setup && typeof base.setup === 'object' ? base.setup : null; /* set only by setSetup */
  out.saved = Array.isArray(base.saved) ? [...new Set(base.saved.map((t) => str(t, 120)).filter(Boolean))].slice(0, 300) : []; /* set only by setSaved, never by a client's put */
  return out;
}
const textOf = (c) => `${c.title || ''} ${c.sub || ''} ${c.campaign || ''} ${c.src || ''} ${(c.detail?.why || []).join(' ')}`.toLowerCase();
/* the ranker's lift for one card: the agent's weight, plus 2 for each topic the card mentions (two at most), plus the words the
   person's notes keep using (noteTopics: +1 each, two at most) and minus the words of the notes on cards they marked not useful */
export function tuneScore(tuning, c, nt = null) {
  if (!c || (!tuning && !nt)) return 0;
  const w = WEIGHT[tuning?.weights?.[c.agent]] || 0;
  const tx = (tuning?.topics || []).length || nt?.up?.length || nt?.down?.length ? textOf(c) : '';
  const hits = (tuning?.topics || []).filter((t) => tx.includes(t)).length;
  const has = (k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(tx);
  const up = (nt?.up || []).filter(has).length, down = (nt?.down || []).filter(has).length;
  return w + Math.min(2, hits) * 2 + Math.min(2, up) - Math.min(2, down) * 1.5;
}
/* the few words a person's notes keep coming back to: lowercased content words (4+ letters, no filler), most used first, at most
   10. Notes on a card they marked not useful go to `down`, never `up`: "we don't sell gift sets" must not lift gift-set cards */
const NOTE_STOP = new Set(('about above after again against also always another because been before being below between both brand brew cards card could does doing done down during each even every feed from further have having here hers into just like make more most much must need never only other ours over really same should some such than that their them then there these they this those through under until very want what when where which while will with would your yours just show shows think thing things good great better best please thanks maybe also lets dont doesnt cant wont isnt arent didnt').split(' '));
export function noteTopics(up = [], down = []) {
  const top = (texts) => { const n = new Map();
    for (const x of texts) for (const w of new Set(String(x || '').toLowerCase().replace(/[’']/g, '').match(/\p{L}[\p{L}\p{N}-]{3,}/gu) || [])) if (!NOTE_STOP.has(w) && !/^\d/.test(w)) n.set(w, (n.get(w) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w); };
  const d = top(down), u = top(up).filter((w) => !d.includes(w));
  return u.length || d.length ? { up: u, down: d } : null;
}

/* which way a note points, so "no discount cards" pushes discount cards down instead of lifting them:
   notePrefs (Gemini, when the note is saved) gives { more, less } in a few words each; a note saved before that, or with the AI
   off, is split by sentence: one that says no, never, don't, avoid, stop, fewer or less goes to `down` */
const NEG = /\b(no|not|never|don'?t|doesn'?t|won'?t|can'?t|avoid|stop|without|less|fewer|hate|dislike|skip|nothing|neither|nor)\b|n't\b/i;
export function noteSides(notes = []) {
  const up = [], down = [];
  for (const n of notes || []) {
    if (Array.isArray(n?.more) || Array.isArray(n?.less)) { up.push(...(n.more || [])); down.push(...(n.less || [])); continue; }
    for (const x of String(n?.text ?? n ?? '').replace(/[’]/g, "'").split(/(?<=[.!?;])\s+|\n+/)) if (x.trim()) (NEG.test(x) ? down : up).push(x);
  }
  return { up, down };
}
const cleanSides = (x) => { if (!x || typeof x !== 'object') return {}; const l = (a) => (Array.isArray(a) ? a.map((w) => str(w, 60).toLowerCase()).filter((w) => w.length > 2).slice(0, 8) : []);
  const more = l(x.more), less = l(x.less); return more.length || less.length ? { more, less } : {}; };
export const PREF_SCHEMA = { type: 'object', properties: {
  more: { type: 'array', items: { type: 'string' }, description: 'What this person wants MORE of in their feed: 0 to 8 short topic words or two-word phrases as a card would say them (e.g. "gifting", "reels", "email flows")' },
  less: { type: 'array', items: { type: 'string' }, description: 'What they want LESS of or never: 0 to 8 short topic words or two-word phrases as a card would say them (e.g. "discounts", "influencers")' } } };
export const prefPrompt = (text) => `A member of a brand's team saved this as their own preference for the Brew feed (cards with marketing ideas and fixes):\n"""\n${String(text).slice(0, 4000)}\n"""\nWhat do they want more of, and what do they want less of or never? Only what the note says; a "no", "never", "stop" or "less" is less. Words a card about it would use.`;

/* "Picked up from your choices": what the workspace's card feedback teaches the ranker (feed-service affinityMap and fewer).
   Each has a stable id so the member can delete it. A like needs 2 hearts on that agent or campaign; a skip needs one Not for me
   on that agent, two in one area; fewer is the Fewer button */
export function learnedSignals({ feedback = [], cards = new Map(), fewer = {}, ignored = [], saved = null } = {}) {
  const hearts = new Map(); feedback.forEach((f) => { if (f.kind === 'heart') hearts.set(f.cardId, 1); if (f.kind === 'unheart') hearts.delete(f.cardId); });
  /* a saved card is liked too (the ranker counts a save as 1.5 hearts): saved = this person's saved ids, else the workspace's saves */
  const sv = new Set(saved || []); if (!saved) feedback.forEach((f) => { if (f.kind === 'save') sv.add(f.cardId); if (f.kind === 'unsave') sv.delete(f.cardId); }); sv.forEach((id) => hearts.set(id, 1));
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
  /* keyed per demo session too (sk): on the demo site each visitor's tuning lives in its own sandbox file, like brand-memory.js */
  const load = async (slug) => { const k = sk(slug); if (cache.has(k)) return cache.get(k); const all = (await packs.getJSON(slug, FILE, null).catch(() => null)) || {}; cache.set(k, all); return all; };
  const peek = (slug, key) => (key && cache.get(sk(slug))?.[key]) || null;
  const get = async (slug, key) => cleanTuning({}, (await load(slug))[key] || emptyTuning());
  const write = (slug, key, fn) => { const lk = sk(slug); const run = (locks.get(lk) || Promise.resolve()).catch(() => {}).then(async () => {
    const all = await load(slug); const cur = cleanTuning({}, all[key] || emptyTuning()); const next = fn(cur) || cur; next.at = now(); all[key] = next; await packs.put(slug, FILE, all); return next; });
    locks.set(lk, run); return run; };
  const put = (slug, key, patch) => write(slug, key, (cur) => cleanTuning(patch, cur));
  /* sides: what Gemini read the note as ({ more, less }, notePrefs), kept so the ranker never reads a "no" as a "yes" */
  const addNote = (slug, key, text, { source = 'note', sides = null } = {}) => write(slug, key, (cur) => { const id = 'pn_' + Math.random().toString(16).slice(2, 10); cur.notes = [{ id, text: str(text, 4000), source: str(source, 140), at: now(), ...cleanSides(sides) }, ...(cur.notes || [])].slice(0, 50); return cur; });
  const dropNote = (slug, key, id) => write(slug, key, (cur) => { cur.notes = (cur.notes || []).filter((n) => n.id !== id); return cur; });
  /* the bookmark: a card saved or unsaved by this person, on every device they open (the newest first) */
  const setSaved = (slug, key, id, on) => write(slug, key, (cur) => { const x = str(id, 120); if (!x) return cur; const rest = (cur.saved || []).filter((y) => y !== x); cur.saved = (on ? [x, ...rest] : rest).slice(0, 300); return cur; });
  /* the setup answers (feed-service /setup): seat, what comes first, channels, done; merged, never a client's whole object */
  const setSetup = (slug, key, x = {}) => write(slug, key, (cur) => { const was = cur.setup || {}, nx = { ...was };
    if (typeof x.role === 'string') nx.role = str(x.role, 24); if (Array.isArray(x.wants)) nx.wants = x.wants.map((w) => str(w, 24)).slice(0, 2);
    if (Array.isArray(x.channels)) nx.channels = x.channels.map((c) => str(c, 24)).slice(0, 6); if (x.done) nx.done = true; nx.at = now(); cur.setup = nx; return cur; });
  const ignore = (slug, key, id) => write(slug, key, (cur) => { cur.ignored = [...new Set([...(cur.ignored || []), str(id, 80)])].slice(-100); return cur; });
  const unignore = (slug, key, id) => write(slug, key, (cur) => { cur.ignored = (cur.ignored || []).filter((x) => x !== id); return cur; });
  return { load, peek, get, put, addNote, dropNote, ignore, unignore, setSaved, setSetup, _cache: cache };
}
