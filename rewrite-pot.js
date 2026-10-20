// One weekly move-rewrite budget per brand (updates.json pot). Every automatic rewrite draws from it, in this order:
// what the team said (learnings) > events (a price, launch or rival move, out of stock) > the site check's high flags >
// connected accounts' flags > learnings' low and weekly flags (and the check's medium ones) > new moves. A lower kind may
// only spend down to its share of the pot, so a busy week of connector flags never takes what a learnings upload needs on
// Friday. What the pot doesn't cover keeps its flag and waits for next week. Manual rewrites stay outside it (they show
// their cost first). Costs per move come from the brand's own moves on today's model, else an estimate per provider.
/* the ISO week, as moves-cadence.js counts it (copied here so build.js doesn't load the moves engine to read it) */
const pad = (n) => String(n).padStart(2, '0');
export const weekKey = (ms) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); const y = d.getUTCFullYear(), w1 = new Date(Date.UTC(y, 0, 4)); return `${y}-W${pad(1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7))}`; };

export const KINDS = ['learnings', 'event', 'check', 'live', 'low', 'new'];
export const RANK = Object.fromEntries(KINDS.map((k, i) => [k, i]));
/* how much of the week's pot each kind may have spent by the time it draws: learnings the whole pot, new moves half */
export const SHARE = { learnings: 1, event: 0.9, check: 0.8, live: 0.7, low: 0.6, new: 0.5 };
/* the Gemini deep model (moves, briefs) is Flash while we build and Pro for clients (GEMINI_DEEP_MODEL): a Pro move costs
   about four times a Flash one, so the estimate and the pot follow the model, not just the provider */
export const deepIsPro = (env = process.env) => /pro/i.test(env.GEMINI_MOVES_MODEL || env.GEMINI_DEEP_MODEL || ''); /* a rewrite is a move: the moves' model sets its price */
/* $ a move, before the brand has moves on today's model (Cozy on Gemini Flash: 65 moves for $6.40; Pro from list price) */
export const EST = { anthropic: 0.6, gemini: 0.1, 'gemini-pro': 0.4 };
/* the week's pot by provider: about 80 Opus moves, 100 Flash moves, or 100 Pro moves */
export const CAP = { anthropic: 50, gemini: 10, 'gemini-pro': 40 };
const key = (provider, env = process.env) => (provider === 'gemini' && deepIsPro(env) ? 'gemini-pro' : provider);
/* a move's own call (meta.usd) leaves out its search, verify and fix calls: a run's real cost is about half again */
export const OVERHEAD = 1.5;

/* a rewrite run's kind, from the queue's via (manual ones are not drawn: null) */
export const KIND_OF_VIA = { learnings: 'learnings', event: 'event', weekly: 'check', live: 'event', connected: 'live', new: 'new' };
export const runKind = (via, auto) => KIND_OF_VIA[via] || (auto ? 'check' : null);

/* the kind of a flag in updates.json stale: who raised it, and how much it matters */
export function flagKind(f = {}) {
  if (f.stock || f.via === 'stock' || f.src === 'event') return 'event';
  if (f.via === 'learnings') return f.impact === 'low' ? 'low' : 'learnings';
  if (f.via === 'facts-connected' || (f.live && f.real)) return 'live';
  if (f.via === 'facts') return f.priority === 'high' ? 'check' : 'low'; /* the fact sheet changed (an edit or a re-read) */
  return f.priority === 'high' ? 'check' : 'low'; /* the site check's triage, a fresh reload, anything older */
}

const DAY = 864e5;
/* the start of next ISO week (Monday 00:00 UTC): what the pot did not cover starts then */
export function nextWeek(now = Date.now()) { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.getTime() + (7 - ((d.getUTCDay() + 6) % 7)) * DAY; }

/* this week's pot from updates.json (a new week starts empty) */
export function potOf(u = {}, now = Date.now()) {
  const week = weekKey(now), p = u.pot;
  return p?.week === week ? { usd: 0, by: {}, waits: {}, ...p } : { week, usd: 0, by: {}, waits: {} };
}
/* what a kind may still spend this week */
export const potLeft = (pot, cap, kind) => Math.max(0, cap * (SHARE[kind] ?? SHARE.low) - (pot.usd || 0));
export function potAdd(pot, kind, usd) {
  if (!(usd > 0)) return pot;
  pot.usd = +((pot.usd || 0) + usd).toFixed(4); pot.by = { ...(pot.by || {}), [kind]: +(((pot.by || {})[kind] || 0) + usd).toFixed(4) };
  return pot;
}
/* which items the pot covers now, best kind first (an item marked top, out of stock, before all), then oldest flag, then
   move number; the rest wait */
export function potFit(pot, cap, est, items = []) {
  const r = (it) => (it.top ? -1 : RANK[it.kind] ?? 9), sorted = [...items].sort((a, b) => r(a) - r(b) || (a.at || 0) - (b.at || 0) || a.n - b.n);
  const now = [], wait = []; let spent = pot.usd || 0;
  for (const it of sorted) { if (spent + est <= cap * (SHARE[it.kind] ?? SHARE.low) + 1e-9) { now.push(it); spent += est; } else wait.push(it); }
  return { now, wait };
}

/* $ a move on today's model: the brand's own moves written on it (meta.usd, with the run's overhead), once there are
   five; else the provider's estimate */
export function perMove({ moves = [], model = '', provider = 'gemini', env = process.env } = {}) {
  const xs = moves.filter((m) => m?.meta?.model === model && +m.meta.usd > 0).map((m) => +m.meta.usd);
  if (xs.length < 5) return EST[key(provider, env)] ?? EST.anthropic;
  return +((xs.reduce((a, b) => a + b, 0) / xs.length) * OVERHEAD).toFixed(3);
}
export const capOf = (env = process.env, provider = 'gemini') => +env.BRAND_WEEK_CAP_USD || CAP[key(provider, env)] || CAP.anthropic;
