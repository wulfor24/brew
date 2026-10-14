import { liveRe } from './brand-ctx.js';
// Versions + learning for the studio → jam loop.
// Versions: one graph for every object (card, change, jam plan, rule). Nothing is overwritten:
// every edit, reroll, answer, approval, deploy and undo is a new version with an author and a reason.
// Learning: signals from what people pick, edit, ship, undo and ask turn into taste rules, exemplars, a trust ladder
// per agent and learned checks. Every studio and jam turn reads them back, so the learning compounds.
import crypto from 'node:crypto';
import { prefs } from './model-ctx.js';

const uid = (p) => p + '_' + crypto.randomBytes(4).toString('hex');
/* ---------- brand memory hook (brand-memory.js; set by server.js unless BRAND_MEMORY=0). Never throws, never blocks ---------- */
let MEM = null; export const setMemoryHooks = (h) => { MEM = h; };
const memTell = (k, ...a) => { try { MEM?.[k]?.(...a); } catch {} };
export const memoryBlock = (t, agent) => { try { return MEM?.block?.(t, agent) || ''; } catch { return ''; } };
export const memoryBlockAsync = async (t, agent, query) => { try { return (await MEM?.blockAsync?.(t, agent, query)) || ''; } catch { return ''; } };
/* ---------- end brand memory hook ---------- */

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 140 ? s.slice(0, 138) + '…' : s; };

/* ---------- versions ---------- */
export const diffOf = (a = {}, b = {}) => {
  const out = []; const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  keys.forEach((k) => { const x = JSON.stringify(a?.[k] ?? null), y = JSON.stringify(b?.[k] ?? null); if (x !== y) out.push({ k, from: short(a?.[k] ?? ''), to: short(b?.[k] ?? '') }); });
  return out;
};
// author: 'ai:<agent>' | 'you' | 'teammate:<name>' | 'brew' | 'learning' | 'system'
export const addV = (t, type, objectId, snapshot, { author = 'system', reason = '', parent = null, at } = {}) => {
  t.vg ||= {}; const list = (t.vg[objectId] ||= []);
  const prev = parent ? list.find((v) => v.id === parent) : list[list.length - 1];
  const v = { id: uid('ver'), n: list.length + 1, type, objectId, parentVersionId: prev?.id || null, author, reason, diff: diffOf(prev?.snapshot, snapshot), snapshot: clone(snapshot), at: at || Date.now() };
  list.push(v); return v;
};
export const versionsOf = (t, objectId) => (t.vg?.[objectId] || []);
export const versionById = (t, objectId, id) => versionsOf(t, objectId).find((v) => v.id === id);

/* ---------- learning ---------- */
const DISCOUNT = /(\d+\s*%\s*off|\bdiscount\w*|\bsale\b|\bcheaper\b|\bsave ₹|\bflat ₹\d+ off)/i;
const RIVALS = liveRe((b) => b.rivalsRe); // the active brand's rivals
const HAIRS = /\d[\d,]*\s+new hairs/i;
const NUMBER_FIRST = /^\W{0,3}(up to\s+)?[₹\d]/i;
// What an edit can show about taste. `test` reads one edit (before → after); `check` scores new copy against the rule.
export const DETECTORS = [
  { k: 'no-discount', hard: true, text: 'Leave out discount framing (% off, sale, cheaper)', test: (b, a) => DISCOUNT.test(b.all) && !DISCOUNT.test(a.all), check: (c) => !DISCOUNT.test(c.all) },
  { k: 'up-to-window', hard: true, text: 'Write results as “up to”, with the day window', test: (b, a) => (!/up to/i.test(b.all) && /up to/i.test(a.all)) || (!/\b\d+\s*days\b/i.test(b.all) && /\b\d+\s*days\b/i.test(a.all)), check: (c) => !HAIRS.test(c.all) || (/up to/i.test(c.all) && /\d+\s*days/i.test(c.all)) },
  { k: 'number-first', text: 'Lead the title with the number', test: (b, a) => !NUMBER_FIRST.test(b.title) && NUMBER_FIRST.test(a.title), check: (c) => NUMBER_FIRST.test(c.title) },
  { k: 'short-title', text: 'Keep titles short, under 45 characters', test: (b, a) => a.title.length <= 50 && a.title.length < b.title.length * 0.8, check: (c) => c.title.length <= 48 },
  { k: 'no-rival', hard: true, text: 'Don’t name rivals in our copy', test: (b, a) => RIVALS.test(b.all) && !RIVALS.test(a.all), check: (c) => !RIVALS.test(c.all) },
  { k: 'no-exclaim', text: 'No exclamation marks', test: (b, a) => /!/.test(b.all) && !/!/.test(a.all), check: (c) => !/!/.test(c.all) },
  { k: 'plain-words', text: 'Plain words, no jargon', test: (b, a) => /\b(synerg\w*|leverage|clinically|scientifically|revolutionary|potent)\b/i.test(b.all) && !/\b(synerg\w*|leverage|clinically|scientifically|revolutionary|potent)\b/i.test(a.all), check: (c) => !/\b(synerg\w*|leverage|revolutionary|potent)\b/i.test(c.all) }
];
const DET = Object.fromEntries(DETECTORS.map((d) => [d.k, d]));
export const PROMOTE_AT = 3;
// Trust ladder: how far an agent may go on its own. Never about money: money always goes to the deployment team.
export const LEVELS = [
  { name: 'Starter', objects: 1, traffic: 10 },
  { name: 'Trusted', objects: 3, traffic: 25 },
  { name: 'Proven', objects: 12, traffic: 50 },
  { name: 'Autopilot', objects: 40, traffic: 100 }
];
export const CLEAN_TO_LEVEL_UP = 5;
const AGENTS = ['creative', 'performance', 'storefront', 'visibility', 'crm', 'brew'];

export const L = (t) => {
  t.L ||= { signals: [], tags: {}, rules: [], exemplars: [], trust: {}, questions: {}, autoChecks: [], intents: {}, angles: {}, actions: {}, newRules: [] };
  t.L.lessons ||= []; t.L.stepsSeen ||= {};
  AGENTS.forEach((a) => (t.L.trust[a] ||= { level: 0, clean: 0, history: [] }));
  return t.L;
};
const copyOf = (x = {}) => { const title = String(x.title || ''); const all = [x.title, x.sub, ...(x.bullets || []), ...(x.publicText || [])].filter(Boolean).join(' '); return { title, all }; };

export const trustOf = (t, agent) => { const tr = L(t).trust[agent] || { level: 0, clean: 0 }; return { ...tr, ...LEVELS[tr.level], max: LEVELS.length - 1, toNext: tr.level < LEVELS.length - 1 ? CLEAN_TO_LEVEL_UP - tr.clean : 0 }; };

// promote a tag to a rule once it has PROMOTE_AT consistent signals
const promote = (t, k, { text, scope = null, source = 'edits' }, now) => {
  const l = L(t); const tag = l.tags[k]; if (!tag || tag.n < PROMOTE_AT) return null;
  let r = l.rules.find((x) => x.k === k);
  if (r) { r.n = tag.n; r.evidence = tag.evidence.slice(-6); return null; }
  r = { id: uid('rule'), k, text: text || DET[k]?.text || k, n: tag.n, evidence: tag.evidence.slice(-6), on: true, scope, source, createdAt: now };
  l.rules.unshift(r); l.newRules.push({ id: r.id, text: r.text, at: now });
  memTell('onRule', t, r); // brand memory
  addV(t, 'rule', r.id, { text: r.text, on: r.on, n: r.n }, { author: 'learning', reason: `Formed from ${r.n} ${source === 'jam' ? 'jam answers' : source === 'picks' ? 'picks' : 'edits'}`, at: now });
  return r;
};
const bump = (t, k, ev, now, opts = {}) => { const l = L(t); const tag = (l.tags[k] ||= { n: 0, evidence: [] }); tag.n++; tag.evidence.push({ ...ev, at: now }); return promote(t, k, opts, now); };

export const signal = (t, kind, data, now = Date.now()) => {
  const l = L(t); l.signals.unshift({ id: uid('sig'), kind, ...data, at: now }); if (l.signals.length > 400) l.signals.length = 400;
  const formed = [];
  if (kind === 'edit' && data.before && data.after) {
    const b = copyOf(data.before), a = copyOf(data.after);
    DETECTORS.forEach((d) => { if (d.test(b, a)) { const r = bump(t, d.k, { changeId: data.changeId, agent: data.agent, before: b.title.slice(0, 80), after: a.title.slice(0, 80), by: data.by }, now); if (r) formed.push(r); } });
  }
  if (kind === 'pick' || kind === 'live' || kind === 'jam' || kind === 'deploy-team') {
    if (data.intent) { const m = (l.intents[data.agent] ||= {}); m[data.intent] = (m[data.intent] || 0) + (kind === 'pick' ? 1 : 2); }
    if (data.angle) { const m = (l.angles[data.agent] ||= {}); m[data.angle] = (m[data.angle] || 0) + 1; }
    if (data.action) { const m = (l.actions[data.agent] ||= {}); m[data.action] = (m[data.action] || 0) + 1; }
  }
  if (kind === 'deploy-team-edit' && data.k) { const r = bump(t, data.k, { changeId: data.changeId, agent: data.agent, before: data.reason, by: 'deployment team' }, now, { text: data.text, scope: data.agent, source: 'deployment team' }); if (r) formed.push(r); }
  return formed;
};

// a question answered in a jam; the same question answered PROMOTE_AT times becomes a learned check
export const answered = (t, q, answer, by, now = Date.now()) => {
  const l = L(t); const e = (l.questions[q.k] ||= { k: q.k, q: q.q, n: 0, answers: [] });
  e.n++; e.answers.push({ a: String(answer).slice(0, 200), by, at: now });
  if (e.n >= PROMOTE_AT && !l.autoChecks.find((x) => x.k === q.k)) {
    const ac = { id: uid('ac'), k: q.k, q: q.q, answer: e.answers[e.answers.length - 1].a, n: e.n, on: true, createdAt: now };
    l.autoChecks.unshift(ac); l.newRules.push({ id: ac.id, text: `Learned check: ${q.q}`, at: now });
    memTell('onCheck', t, ac); // brand memory
    addV(t, 'rule', ac.id, { check: ac.q, answer: ac.answer, on: true }, { author: 'learning', reason: `Answered the same way in ${e.n} jams`, at: now });
    return ac;
  }
  return null;
};
export const autoCheck = (t, k) => L(t).autoChecks.find((x) => x.k === k && x.on);

// a measured result (or an undo) moves the trust ladder and keeps winners as exemplars
export const outcome = (t, { agent, win, undo, change, now = Date.now() }) => {
  const l = L(t); const tr = l.trust[agent] || (l.trust[agent] = { level: 0, clean: 0, history: [] });
  const from = tr.level;
  if (undo || win === false) { tr.clean = 0; if (tr.level > 0) tr.level--; }
  else if (win) { tr.clean++; if (tr.clean >= CLEAN_TO_LEVEL_UP && tr.level < LEVELS.length - 1) { tr.level++; tr.clean = 0; } }
  tr.history.unshift({ at: now, win: !!win, undo: !!undo, from, to: tr.level, title: change?.after?.title || '' }); tr.history.length = Math.min(tr.history.length, 12);
  if (tr.level !== from) { l.newRules.push({ id: uid('tl'), text: `${LEVELS[tr.level].name} trust for ${agent}: Brew may now ship up to ${LEVELS[tr.level].objects} at once`, at: now }); addV(t, 'rule', 'trust:' + agent, { level: tr.level, name: LEVELS[tr.level].name }, { author: 'learning', reason: undo ? 'Undone' : win ? `${CLEAN_TO_LEVEL_UP} clean launches` : 'Result fell flat', at: now }); }
  if (win && change) { l.exemplars.unshift({ id: uid('ex'), agent, type: change.type, action: change.action, title: change.after.title, sub: change.after.sub, at: now }); l.exemplars = l.exemplars.filter((x, i, a) => a.filter((y) => y.agent === x.agent).indexOf(x) < 3); }
  return { from, to: tr.level };
};

// active rules for an agent, with a check function where one exists
export const rulesFor = (t, agent) => L(t).rules.filter((r) => r.on && (!r.scope || r.scope === agent)).map((r) => ({ ...r, check: DET[r.k]?.check || null }));
// hard rules (claims, discounts, rivals) block auto-live; taste rules (tone, length, order) only shape and rank the options
export const ruleChecks = (t, agent, after) => { const c = copyOf(after); return rulesFor(t, agent).map((r) => ({ k: `Learned: ${r.text}`, ok: r.check ? r.check(c) : true, learned: true, soft: !r.check || !DET[r.k]?.hard, taste: !!r.check && !DET[r.k]?.hard })); };
// the block every remix prompt carries
export const promptBlock = (t, agent) => {
  if (!prefs().memory) return ''; // memory switched off in this jam
  const l = L(t); const rules = rulesFor(t, agent); const ex = l.exemplars.filter((x) => x.agent === agent).slice(0, 3);
  const ints = Object.entries(l.intents[agent] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  return [
    memoryBlock(t, agent), // brand memory: shared across the brand's team (brand-memory.js)
    rules.length ? `What this team taught us (follow every one):\n${rules.map((r) => `- ${r.text}`).join('\n')}` : '',
    ex.length ? `Shipped winners to learn from:\n${ex.map((x) => `- "${x.title}" / ${x.sub}`).join('\n')}` : '',
    ints.length ? `They usually want: ${ints.join(', ')}.` : '',
    lessonsFor(t, agent).some((x) => x.results?.length) ? `What MEASURED results showed (strongest evidence: lean on what moved the number, avoid what did not):\n${lessonsFor(t, agent).filter((x) => x.results?.length).slice(0, 5).map((x) => `- ${x.text} [${x.results.map(resLine).slice(0, 2).join('; ')}]`).join('\n')}` : '',
    lessonsFor(t, agent).some((x) => !x.results?.length) ? `What their decisions and sign-offs taught us (weigh these, below measured results):\n${lessonsFor(t, agent).filter((x) => !x.results?.length).slice(0, 5).map((x) => `- ${x.text}${x.n > 1 ? ` (seen ${x.n} times)` : ''}`).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
};
// order intent chips by what this team picks
export const orderIntents = (t, agent, intents) => { const m = L(t).intents[agent] || {}; return [...intents].sort((a, b) => (m[b] || 0) - (m[a] || 0)); };
// predicted pick: learned rules met + angles and actions this team keeps choosing
export const pickScore = (t, agent, ch) => {
  const l = L(t); const rc = ruleChecks(t, agent, ch.after).filter((x) => !x.soft || x.taste);
  return rc.filter((x) => x.ok).length * 2 - rc.filter((x) => !x.ok).length * 3 + (l.angles[agent]?.[ch.angle] || 0) + (l.actions[agent]?.[ch.action] || 0) * 1.5;
};
/* lessons: what a concrete step taught us (a decision, a sign-off or pushback, a brief sent, a launch, a result).
   Each one names who it is about (the brand or this person), the evidence, and the step that taught it.
   The same lesson again is a confirmation (n goes up), not a new line. */
// lessons about a person never guess their gender
export const neutral = (x) => String(x || '').replace(/\b(he|she) (is|was|has|does)\b/gi, (m, a, v) => `${a[0] === a[0].toUpperCase() ? 'They' : 'they'} ${{ is: 'are', was: 'were', has: 'have', does: 'do' }[v.toLowerCase()]}`)
  .replace(/\b(himself|herself)\b/gi, 'themselves').replace(/\b(his|her)\b/gi, (m) => m[0] === 'H' ? 'Their' : 'their').replace(/\b(him)\b/gi, 'them').replace(/\b(he|she)\b/gi, (m) => m[0] === m[0].toUpperCase() ? 'They' : 'they');
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9₹% ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const addLesson = (t, x, now = Date.now()) => {
  const l = L(t), text = neutral(String(x.text || '').trim()); if (!text || text.length < 12) return null;
  const same = (x.same && l.lessons.find((y) => y.id === x.same)) || l.lessons.find((y) => norm(y.text) === norm(text));
  if (same) { same.n += 1; same.at = now; if (x.measured) same.results = [x.measured, ...(same.results || [])].slice(0, 6); const why = neutral(x.why); if (why && !same.why.includes(why)) same.why = [why, ...same.why].slice(0, 4); same.steps = [{ step: x.step, title: x.title, at: now }, ...(same.steps || [])].slice(0, 6); memTell('onLesson', t, same, x); return same; }
  const y = { id: 'ls_' + Math.random().toString(36).slice(2, 9), kind: x.kind === 'you' ? 'you' : 'brand', agent: x.agent || null, text, why: x.why ? [neutral(x.why)] : [], n: 1, on: true, at: now, results: x.measured ? [x.measured] : [], steps: [{ step: x.step, title: x.title, at: now }] };
  l.lessons.unshift(y); l.newRules.push({ text: `Learned: ${text}`, lesson: true }); l.lessons = l.lessons.slice(0, 60); memTell('onLesson', t, y, x); return y;
};
// a step teaches once: the same step on the same work never runs the lesson pass twice
export const stepOnce = (t, key) => { const l = L(t); if (l.stepsSeen[key]) return false; l.stepsSeen[key] = Date.now(); return true; };
const weight = (x) => (x.results?.length ? 100 + x.results.length * 10 : 0) + (x.n || 1);
export const lessonsFor = (t, agent) => L(t).lessons.filter((x) => x.on && (!x.agent || !agent || x.agent === agent)).sort((a, b) => weight(b) - weight(a));
const numOf = (x) => parseFloat(String(x).replace(/[^\d.]/g, ''));
export const dirChange = (r) => { const a = numOf(r.before), b = numOf(r.after), p = String(r.change || '').replace(/^[+−-]/, ''); return Number.isFinite(a) && Number.isFinite(b) && a !== b ? `${b < a ? '−' : '+'}${p}` : p; };
const resLine = (r) => `${r.metric}: ${r.before} → ${r.after} (${dirChange(r)}), target ${r.target}${r.win ? '' : ', missed'}`;
export const takeNew = (t) => { const l = L(t); const out = l.newRules.splice(0); return out; };
// one before → after that actually shows the rule (titles alone), never a translation or an unrelated rewrite
const DEVA = /[\u0900-\u097F]/;
const exampleOf = (r) => {
  const d = DET[r.k]; const ev = (r.evidence || []).filter((x) => x.before && x.after && DEVA.test(x.before) === DEVA.test(x.after));
  const ok = d ? ev.filter((x) => d.test({ title: x.before, all: x.before }, { title: x.after, all: x.after })) : [];
  const x = ok[ok.length - 1]; return x ? { before: x.before, after: x.after } : null;
};
export const summary = (t) => {
  const l = L(t);
  return {
    rules: l.rules.map((r) => ({ ...r, example: exampleOf(r) })), autoChecks: l.autoChecks, exemplars: l.exemplars,
    lessons: l.lessons.map((x) => ({ ...x, text: neutral(x.text), why: (x.why || []).map(neutral) })),
    trust: Object.fromEntries(AGENTS.map((a) => [a, trustOf(t, a)])), levels: LEVELS, cleanToLevelUp: CLEAN_TO_LEVEL_UP, promoteAt: PROMOTE_AT,
    forming: Object.entries(l.tags).filter(([k, v]) => v.n < PROMOTE_AT).map(([k, v]) => ({ k, text: DET[k]?.text || k, n: v.n })),
    questions: Object.values(l.questions).filter((q) => !l.autoChecks.find((a) => a.k === q.k)).map((q) => ({ k: q.k, q: q.q, n: q.n })),
    intents: l.intents, signals: l.signals.slice(0, 30), signalCount: l.signals.length
  };
};
