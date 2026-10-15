// Brand learnings: the team (or the Brew team) pastes real-world context into a jam (a customer-call transcript, notes,
// emails, research) and Brew learns from it, for every brand the same way:
//   1. read it (chunked, so tens of thousands of characters work) into learnings: the brand's essence, its goals and plans,
//      its beliefs (customers, product, claims, tone, what to avoid) and concrete facts. Every learning carries the exact words
//      it rests on (checked against the paste: a learning whose quote is not in the text is dropped) and its source
//      ("Call transcript, added by <who>, <date>"). Nothing is inferred or invented.
//   2. update the brand context: learned.json (the store), brief.json / brief.md (a managed "What the team told Brew"
//      section the moves engine reads), the system prompt every AI call reads (brand-pack.js), and brand memory (new topics
//      essence, goals, beliefs; facts under their own topics). Numbers stay the fact sheet's: a learning that disagrees with
//      the sheet (connected tools are the source of truth for what they measure) is not applied, only reported.
//   3. moves: the ones the learnings make out of date are flagged (updates.json, like any other change) and the top few are
//      rewritten (build.js rewrite, its caps); what the learnings open that no move covers becomes new moves (the cadence
//      "learn" family, under the moves budget). Cards follow as the moves land.
//   4. a short chat reply says what was learned, what changed, what was not applied and what is being rewritten or added.
// The same paste again is recognised by its hash: nothing is learned twice and nothing is spent.
// Pure helpers are exported so tests run them free; createLearnings wires the store, memory, builder and cadence.
import crypto from 'node:crypto';

// connected tools by key prefix (the same names as facts-desk.js TOOL; kept here so brand-pack.js can import this file)
const TOOL = { shopify: 'Shopify', meta: 'Meta Ads', ga4: 'Google Analytics', gads: 'Google Ads', klaviyo: 'Klaviyo', reviews: 'Judge.me', market: 'Marketplaces' };

export const LEARN_CMD = '/update-brand-learnings';
export const KINDS = ['essence', 'goal', 'belief', 'fact'];
const BUCKET = { essence: 'essence', goal: 'goals', belief: 'beliefs', fact: 'facts' };
const HEAD = { essence: 'Essence', goals: 'Goals', beliefs: 'Beliefs', facts: 'Facts' };
const MEM_TOPICS = ['products', 'offers', 'audience', 'channels', 'voice', 'creative-style', 'what-works', 'rules'];
const KEEP = 40; // per kind in learned.json; the oldest go first
const D = 864e5;

const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const norm = (s) => String(s || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}%₹$€£ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('a an the and or of to in on for with at by from is are was were be been it its this that these those as their they them our we you your has have had not no but if so than then into over under per vs via about more most very just really also like will would can could should do does did i me my us'.split(' '));
const words = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|ers|er|ies|es|s|ed|ly)$/, ''));
const jaccard = (a, b) => { const A = new Set(words(a)), Bs = new Set(words(b)); if (!A.size || !Bs.size) return 0; let i = 0; A.forEach((x) => Bs.has(x) && i++); return i / (A.size + Bs.size - i); };
export const sameLearning = (a, b) => norm(a) === norm(b) || jaccard(a, b) >= 0.8;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dateLabel = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const pad = (n) => String(n).padStart(2, '0');
// every number as written (12, 5,000, 899, 2.5), commas dropped: the fact gate's own pattern skips bare counts, these must not slip by
export const numsOf = (s) => [...new Set((String(s ?? '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/,(?=\d{2,3}\b)/g, '').replace(/,$/, '')))];
const listAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/* ---------- the command: typed, or read from what was said ---------- */
const CMD_RE = /^\s*\/(?:update[-_ ]?brand[-_ ]?learnings?|update[-_ ]?learnings?|brand[-_ ]?learnings?|learn(?:ings?)?)(?![\w-])[ \t]*[:,-]?\s*/i; /* /update-brand-learnings, or the short /learn, /learnings, /brand-learnings */
const PHRASES = [
  /\b(update|refresh|add to|improve)\s+(my|our|the|your)?\s*(brand('s)?\s+)?(learnings?|brand context|brand memory|context about us)\b/i,
  /\bhere('?s| is| are)\s+(the|a|an|our|my|this)?\s*(latest\s+)?(customer\s+|sales\s+|discovery\s+|founder\s+|team\s+|client\s+|brand\s+)?(call|meeting|interview|zoom|chat)\s+(transcript|notes|recording)\b/i,
  /\b(add|save) (this|these|it|them) to (what you know|your memory|the brand('s)? (memory|context|brief))\b/i,
  /\bwhat you know about (us|me|our brand|the brand)\b/i,
  /\b(remember|learn) (this|these|from this) (about|for) (us|our brand|the brand)\b/i,
  /\b(learn|take notes) from (this|these|the) (call|transcript|notes|meeting|emails?)\b/i
];
const MAKE_FIRST = /^\s*(please\s+)?(make|write|create|draft|design|build|generate|turn this|use this to|give me|plan)\b/i;
// speaker turns ("Priya: …", "[00:12:03] Sam: …", "00:12 - Host: …") and bare timestamps
const TURN = /^\s*(?:[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*[-–]?\s*)?([\p{Lu}][\p{L}\p{N}.'’ ()&/-]{0,40}?)\s*:\s+\S/gmu;
const STAMP = /^\s*[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?/gm;
const SPEAKER = /^\s*(?:[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*[-–]?\s*)?(?:[\p{Lu}][\p{L}\p{N}.'’ ()&/-]{0,40}?\s*:\s+)?/u; // the turn's prefix, so the words stand alone
export function looksLikeTranscript(text) {
  const s = String(text || ''); if (s.length < 600) return false;
  const turns = [...s.matchAll(TURN)].map((m) => m[1].trim().toLowerCase()).filter((x) => !/^(https?|note|subject|from|to|cc|date|re)$/.test(x));
  const speakers = new Set(turns);
  return (turns.length >= 6 && speakers.size >= 2) || (s.match(STAMP) || []).length >= 6 || /\btranscript\b/i.test(s.slice(0, 400));
}
/* → null (not a learnings message) or { mode: 'explicit' | 'implicit', why: 'command' | 'phrase' | 'transcript' | 'long', body } */
export function parseLearnCommand(text, { generic = false } = {}) {
  const s = String(text || '').replace(/\r/g, '');
  if (CMD_RE.test(s)) return { mode: 'explicit', why: 'command', body: s.replace(CMD_RE, '').trim() };
  if (!generic) return null;
  const head = s.trim().split('\n').slice(0, 3).join(' ').slice(0, 400);
  if (PHRASES.some((re) => re.test(head))) {
    // the asking line is not part of the source (so the same paste with or without it is the same source)
    const lines = s.trim().split('\n'); const first = lines[0];
    const body = first.length <= 240 && PHRASES.some((re) => re.test(first)) ? lines.slice(1).join('\n').trim() : s.trim();
    return { mode: 'implicit', why: 'phrase', body };
  }
  if (looksLikeTranscript(s) && !MAKE_FIRST.test(s)) return { mode: 'implicit', why: 'transcript', body: s.trim() };
  if (s.length >= 6000 && !MAKE_FIRST.test(s)) return { mode: 'implicit', why: 'long', body: s.trim() };
  return null;
}

/* who may teach Brew about a brand: its team and the Brew team (auth roleOf: owner, member or admin); never the demo site → null or the polite no */
export function learnGate({ member = false, demoSite = false, name = 'the brand' } = {}) {
  if (demoSite) return 'This is a demo copy of the brand, so it can’t change what Brew knows about it. On your own brand, anyone on its team can paste a call, notes or emails here and Brew learns from them.';
  if (!member) return `Only ${name}’s team or the Brew team can update what Brew knows about ${name}. Sign in with your work email, or ask the team to invite you. Nothing changed.`;
  return null;
}

/* ---------- the source ---------- */
export const sourceHash = (text) => crypto.createHash('sha256').update(norm(text)).digest('hex').slice(0, 16);
export function sourceKind(text) {
  const s = String(text || '');
  if (looksLikeTranscript(s) || /\b(call|meeting) transcript\b/i.test(s.slice(0, 400))) return 'Call transcript';
  if (/^\s*(from|subject|to|sent):\s/im.test(s.slice(0, 600))) return 'Email';
  if (/\b(survey|research|interviews?|study|findings)\b/i.test(s.slice(0, 400))) return 'Research';
  return 'Notes';
}
// paragraph-aware chunks with a small overlap, so a learning split across a boundary is still read whole once
export function chunkText(text, size = 14000, overlap = 400) {
  const s = String(text || ''); if (s.length <= size) return s ? [s] : [];
  const out = []; let i = 0;
  while (i < s.length) {
    let end = Math.min(s.length, i + size);
    if (end < s.length) { const nl = s.lastIndexOf('\n', end); if (nl > i + size * 0.6) end = nl; else { const sp = s.lastIndexOf(' ', end); if (sp > i + size * 0.6) end = sp; } }
    out.push(s.slice(i, end)); if (end >= s.length) break; i = Math.max(end - overlap, i + 1);
  }
  return out;
}

/* ---------- vetting: every learning rests on words that are really in the paste ---------- */
export function quoteIn(quote, src) {
  const q = norm(quote); if (q.length < 8) return false;
  const S = typeof src === 'string' ? norm(src) : src;
  return S.includes(q) || (q.length > 90 && S.includes(q.slice(0, 80)));
}
export function vetLearnings(raw = [], sourceText = '') {
  const S = norm(sourceText), out = [];
  for (const x of raw || []) {
    const kind = KINDS.includes(x?.kind) ? x.kind : null, text = cut(x?.text, 260), quote = cut(x?.quote, 300);
    if (!kind || text.length < 12 || !quoteIn(quote, S)) continue;
    // a number in the learning must be in the words it rests on: nothing is rounded up, converted or made up
    const qn = new Set(numsOf(quote)); if (numsOf(text).some((n) => !qn.has(n))) continue;
    const topic = kind === 'fact' || kind === 'belief' ? (MEM_TOPICS.includes(x.topic) ? x.topic : null) : null;
    out.push({ kind, text, quote, topic, conflictLabel: cut(x.conflictLabel, 120), conflictSays: cut(x.conflictSays, 120) });
  }
  return mergeLearnings([out]);
}
export const mergeLearnings = (lists) => { const out = []; for (const xs of lists) for (const x of xs || []) if (!out.some((y) => y.kind === x.kind && sameLearning(y.text, x.text))) out.push(x); return out; };

/* the AI-off reading: sentences that say what the brand is, wants, believes or has, quoted as they stand */
const ESSENCE_RE = /\b(we are|we're|our mission|we exist|stands? for|at (our|its) (heart|core)|our brand is|the brand is|what makes us|we started|founded)\b/i;
const GOAL_RE = /\b(goal|aim|plan(ning)?|priority|priorities|focus(ing)? on|this (quarter|year|month)|next (quarter|year|month|week)|by (q[1-4]|diwali|christmas|black friday|the end of)|launch(ing)?|want to|trying to|target|hope to|roadmap)\b/i;
const BELIEF_RE = /\b(we believe|we think|we feel|customers? (love|want|hate|care|buy|trust|don'?t)|never|always|avoid|don'?t (say|use|show|want)|we won'?t|no (discounts?|claims?)|tone|our voice)\b/i;
const FACT_RE = /(₹|\$|€|£|\brs\.?\s?\d|\b\d[\d,.]*\s?(%|percent|orders?|customers?|units|skus?|products?|stores?|cities|countries|reviews?)\b|\b(launch(es|ed)?|price[ds]?|sells?|bestsell|hero product|audience|aged?|subscribers?)\b)/i;
export function heuristicLearnings(text, { max = 14 } = {}) {
  const sents = String(text || '').replace(/\r/g, '').split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}"“])/u).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const raw of sents) {
    const line = raw.replace(SPEAKER, '').trim();
    if (line.length < 30 || line.length > 280 || /\?$/.test(line)) continue;
    const kind = ESSENCE_RE.test(line) ? 'essence' : BELIEF_RE.test(line) ? 'belief' : GOAL_RE.test(line) ? 'goal' : FACT_RE.test(line) ? 'fact' : null;
    if (!kind) continue;
    out.push({ kind, text: line, quote: line, topic: null, conflictLabel: '', conflictSays: '' });
    if (out.length >= max) break;
  }
  return out;
}

/* ---------- the fact sheet wins on numbers: a learning that disagrees with it is reported, not applied ---------- */
const findFact = (sheet, label) => { const l = norm(label); if (l.length < 3) return null;
  const xs = Object.values(sheet || {}).filter((f) => f?.label && !['demo'].includes(f.kind) && !f.demo);
  return xs.find((f) => norm(f.label) === l) || xs.find((f) => { const fl = norm(f.label); return fl.length >= 4 && (fl.includes(l) || l.includes(fl)); }) || null; };
export function conflictsOf(items = [], sheet = {}) {
  const applied = [], conflicts = [];
  for (const x of items) {
    const f = x.kind === 'fact' && x.conflictLabel ? findFact(sheet, x.conflictLabel) : null;
    if (!f) { applied.push(x); continue; }
    const told = x.conflictSays || x.text, tn = numsOf(told), fn = numsOf(String(f.v));
    const differs = tn.length && fn.length ? !tn.some((n) => fn.includes(n)) : !norm(String(f.v)) || !norm(told).includes(norm(String(f.v)));
    if (!differs) { applied.push(x); continue; }
    conflicts.push({ ...x, fact: { label: f.label, v: String(f.v), src: f.connected ? `${TOOL[f.connected] || f.connected} (connected)` : f.src || 'the fact sheet', connected: !!f.connected } });
  }
  return { applied, conflicts };
}

/* ---------- the brand context: learned.json → brief.md section, system prompt block, brief.json view ---------- */
export const emptyLearned = () => ({ v: 1, at: null, essence: [], goals: [], beliefs: [], facts: [], sources: [] });
export const learnedItems = (L) => ['essence', 'goals', 'beliefs', 'facts'].flatMap((k) => (L?.[k] || []).map((x) => ({ ...x, bucket: k })));
const OPEN = '<!-- brew:learned -->', CLOSE = '<!-- /brew:learned -->';
export function learnedSection(L, { name = 'the brand', per = 6 } = {}) {
  const parts = [['essence', 'Essence'], ['goals', 'Goals, priorities and plans'], ['beliefs', 'Beliefs (follow these)'], ['facts', 'Facts the team stated']]
    .filter(([k]) => L?.[k]?.length).map(([k, h]) => `**${h}**\n${L[k].slice(0, per).map((x) => `- ${x.text} (${x.source})`).join('\n')}`);
  if (!parts.length) return '';
  return `## What the team told Brew\nIn ${name}'s own words, from calls, notes and emails the team added. Follow the beliefs and plan toward the goals. A number here is what the team said: quote it as theirs, and the fact sheet and connected accounts win where they disagree.\n\n${parts.join('\n\n')}`;
}
export const stripLearned = (md) => String(md || '').replace(new RegExp(`\\n*${OPEN}[\\s\\S]*?${CLOSE}\\n*`, 'g'), '\n').trimEnd();
export const withLearned = (md, L, o) => { const base = stripLearned(md), sec = learnedSection(L, o); return sec ? `${base}${base ? '\n\n' : ''}${OPEN}\n${sec}\n${CLOSE}\n` : base; };
export const briefView = (L) => ({ at: L.at, ...Object.fromEntries(['essence', 'goals', 'beliefs', 'facts'].map((k) => [k, (L[k] || []).slice(0, 12).map(({ text, source, at, quote }) => ({ text, source, at, quote: cut(quote, 200) }))])) });
const memTopic = (x) => (x.bucket === 'essence' || x.kind === 'essence' ? 'essence' : x.kind === 'goal' ? 'goals' : x.kind === 'belief' ? (x.topic === 'rules' ? 'rules' : 'beliefs') : x.topic || null);

/* ---------- which moves and cards rest on what the team told Brew (the ranker lifts their cards) ---------- */
// moves quote the team's words as theirs (learnedSection asks for it): "the team says…", "team-reported 2.2%", "Arata team notes"
export const TEAM_CITE = /\b(?:the )?team(?:'s)? (?:notes|said|says|told|tells|reported|flagged|stated|plans?|wants?|will)\b|\bteam-(?:reported|stated)\b|\bwhat the team told\b/i;
// a card that itself carries a learning: it quotes the team, or shares three or more telling words with one learning
const TELL_STOP = new Set('about after again their there these those which while would could should with from into than then they them this that have has will your ours were been more most only also very just over under across before every other same each such what when where using used make made need needs only'.split(' '));
const telling = (x) => [...new Set(String(x || '').toLowerCase().match(/[a-z0-9][a-z0-9%.-]{3,}/g) || [])].filter((w) => !TELL_STOP.has(w) && !/^\d{1,3}$/.test(w));
// words common across the brand's own cards ("mitoactive", "serum", "meta") tell nothing: only the rarer ones count
export const learnedTerms = (L, corpus = []) => {
  const df = new Map(); for (const t of corpus) for (const w of telling(t)) df.set(w, (df.get(w) || 0) + 1);
  const common = (w) => corpus.length >= 10 && (df.get(w) || 0) / corpus.length > 0.06;
  return learnedItems(L).map((x) => telling(x.text).filter((w) => !common(w))).filter((ws) => ws.length >= 3);
};
// with no learnings there is nothing to rest on: "the team says" in AI-written move text is not what the team told Brew
export function cardUsesLearned(text, terms = []) {
  const s = String(text || ''); if (!terms?.length) return false; if (TEAM_CITE.test(s)) return true;
  const have = new Set(telling(s)); return terms.some((ws) => ws.filter((w) => have.has(w)).length >= 3);
}
export function learnedMoveNs(moves = {}, L = null) {
  if (!learnedItems(L).length) return new Set();
  // only a move written after the team's words arrived can rest on them (older moves that say "the team" quote the read)
  const since = Date.parse(L?.at || 0) || +L?.at || 0;
  return new Set(Object.entries(moves || {}).filter(([n, m]) => +n > 0 && m && (Date.parse(m.meta?.at || 0) || 0) >= since && TEAM_CITE.test(JSON.stringify([m.title, m.gives, m.sections, m.sources]))).map(([n]) => +n));
}

/* ---------- moves: which ones the learnings change, without AI (words they share) ---------- */
export function planLocal(items = [], moves = {}, { max = 50 } = {}) {
  const cand = Object.entries(moves || {}).filter(([n, m]) => +n >= 1 && +n <= 50 && m?.title && !m.meta?.cadence);
  const scored = cand.map(([n, m]) => { const mt = new Set(words(`${m.title} ${m.gives || ''}`)); let best = 0, uses = [];
    items.forEach((x, i) => { const hit = words(x.text).filter((w) => w.length >= 5 && mt.has(w)).length; if (hit >= 3) { uses.push(i); best = Math.max(best, hit); } });
    return { n: +n, score: best, uses }; }).filter((x) => x.score >= 3).sort((a, b) => b.score - a.score).slice(0, max);
  return { stale: scored.map((x) => ({ n: x.n, why: `It works on what the team just spoke about: ${cut(items[x.uses[0]].text, 140)}`, uses: x.uses.slice(0, 4) })), fresh: [] };
}

/* ---------- the reply ---------- */
const WHY_NOTE = { setup: '', transcript: 'This looks like a call transcript, so I read it as brand learnings (the same as /update-brand-learnings).', phrase: 'Reading this as brand learnings (the same as /update-brand-learnings).', long: 'This is a long paste, so I read it as brand learnings (the same as /update-brand-learnings). If you wanted something made from it, say what and I’ll make it.' };
const capWhy = (why = []) => { const w = why.join(' · ');
  return /weekly cap/.test(w) ? `this brand's weekly budget for new moves is used up (${(w.match(/\$\d+(\.\d+)?/) || ['the cap'])[0]} a week)` : /mock|AI is off/i.test(w) ? 'AI is off on this server' : /REFRESH_OFF/.test(w) ? 'new moves are switched off on this server' : /not built/.test(w) ? 'the brand’s moves are not written yet' : 'they can’t start right now'; };
/* the draft the team checks before anything is saved: numbered lines by heading, conflicts, how to answer */
export function draftText({ name, d, again = false }) {
  if (d.replace && !again) return [`**Already saved on ${dateLabel(d.replace.at)}${d.replace.by ? ` by ${d.replace.by}` : ''}**`, 'Here is what Brew saved from it. Edit it and “save” to replace it, or “cancel” to keep it as it is.', ...draftText({ name, d: { ...d, replace: null }, again: true }).split('\n').slice(2)].join('\n');
  const out = [...(!again && d.note ? [d.note, ''] : []), again ? '**Updated draft**' : `**Check before it becomes ${name}’s brand context**`, again ? 'Here is what Brew will save:' : `What Brew read from the ${String(d.kind || 'source').toLowerCase()}${d.again ? ` (${d.again} it already knew are left out)` : ''}. Nothing is saved yet.`];
  const HD = { essence: 'Essence', goal: 'Goals', belief: 'Beliefs', fact: 'Facts' };
  for (const k of ['essence', 'goal', 'belief', 'fact']) { const xs = d.items.map((x, i) => [x, i]).filter(([x]) => x.kind === k); if (!xs.length) continue; out.push('', `**${HD[k]}**`); xs.forEach(([x, i]) => out.push(`${i + 1}. ${x.text}`)); }
  if (d.conflicts?.length) { out.push('', '**Left out: the fact sheet wins on numbers**'); d.conflicts.slice(0, 4).forEach((c) => out.push(`- It says ${cut(c.conflictSays || c.text, 90)}; ${c.fact?.label || 'the fact sheet'} reads ${c.fact?.v ?? ''}${c.fact?.src ? ` from ${c.fact.src}` : ''}.`)); }
  out.push('', '**What next**', '- “save” adds these to the brief and Brew’s memory, then refreshes the moves they change', '- “drop 3” removes a line', '- “change 2 to …” rewrites one', '- “add belief: …” adds one (essence, goal, belief or fact)', '- “cancel” saves nothing');
  return out.join('\n');
}
export function replyText(r) {
  const out = [];
  if (r.note) out.push(r.note, '');
  if (r.dup) { out.push(`Brew already learned from this ${r.dup.kind.toLowerCase()} on ${dateLabel(r.dup.at)}${r.dup.by ? ` (added by ${r.dup.by})` : ''}: ${r.dup.n} learning${r.dup.n === 1 ? '' : 's'}. Nothing changed and nothing was spent.`); return out.join('\n'); }
  if (r.clipped) out.push(`It was long, so I read the first ${r.clipped.toLocaleString('en-US')} characters.`);
  const n = r.applied.length;
  if (!n && !r.conflicts.length) { out.push(r.again ? `Nothing new in it: the ${r.again} thing${r.again === 1 ? '' : 's'} it says, Brew already knew. Nothing changed.` : `I couldn’t find anything in it that changes what Brew knows about ${r.name}: no essence, goals, beliefs or facts it states. Nothing changed.`); return out.join('\n'); }
  out.push(`**Saved ${n} learning${n === 1 ? '' : 's'} to ${r.name}’s brand context**`, `From the ${r.kind.toLowerCase()} ${r.byShort ? `${r.byShort} added` : 'you added'}${r.again ? `; ${r.again} Brew already had` : ''}. They are in the brief and Brew’s memory, each with its source, and every jam, card and note reads them from now on.`);
  for (const k of ['essence', 'goal', 'belief', 'fact']) { const xs = r.applied.filter((x) => x.kind === k); if (!xs.length) continue;
    out.push('', `**${HEAD[BUCKET[k]]}**`, ...xs.slice(0, 4).map((x) => `- ${x.text}`), ...(xs.length > 4 ? [`- and ${xs.length - 4} more`] : [])); }
  if (r.conflicts.length) { out.push('', '**Not saved: the fact sheet wins on numbers**');
    for (const c of r.conflicts.slice(0, 4)) out.push(`- It says ${cut(c.conflictSays || c.text, 90)}; ${c.fact.label} reads ${c.fact.v} from ${c.fact.src}.${c.fact.connected ? ' Connected accounts are the source of truth for their numbers.' : ' If the new number is right, fix it on the fact sheet with a link.'}`); }
  if (n) out.push('', '**Moves**', movesLine(r.moves || {}, r.name));
  return out.join('\n');
}
function movesLine(m, name = 'the brand') {
  const ns = (xs) => listAnd(xs.map((n) => `Move ${pad(n)}`));
  const parts = [];
  const mins = (k) => (k <= 2 ? '10 to 15 minutes' : k <= 6 ? '15 to 20 minutes' : k <= 18 ? 'about 30 to 45 minutes' : 'about an hour'); /* six at a time */
  if (m.pending?.ns?.length) parts.push(`This is the first time ${name} has shared learnings, so Brew can refresh every move they change: ${m.pending.ns.length} moves (${ns(m.pending.ns)}). \n- Time: ${mins(m.pending.ns.length)}\n- Cost: about $${m.pending.est}\n- After this, new learnings refresh up to ${6} moves at a time\n\nReply “go ahead” to refresh all ${m.pending.ns.length}, or “just the top 6” for the six most affected.`);
  else if (m.rewrite?.ns?.length) parts.push(`${m.rewrite.queued ? 'First in line once the work running now finishes: rewriting' : 'Rewriting'} ${m.rewrite.ns.length} move${m.rewrite.ns.length === 1 ? '' : 's'} this changes (${ns(m.rewrite.ns)}), ${mins(m.rewrite.ns.length)}.${m.flaggedOnly?.length ? ` ${m.flaggedOnly.length} more ${m.flaggedOnly.length === 1 ? 'is' : 'are'} marked to rewrite on the Moves tab (${ns(m.flaggedOnly)}).` : ''}`);
  else if (m.stale?.length) parts.push(`${m.stale.length} move${m.stale.length === 1 ? ' is' : 's are'} out of date with this (${ns(m.stale.map((s) => s.n))}) and marked to rewrite on the Moves tab${m.rewrite?.error ? `, but the rewrite can’t start now: ${m.rewrite.error.replace(/\.$/, '')}.` : m.rewrite?.off ? ` (AI is off on this server, so nothing was rewritten).` : '.'}`);
  if (m.learn?.n) parts.push(`${parts.length ? 'Then ' : ''}${m.learn.n} new move${m.learn.n === 1 ? '' : 's'} from what you told us${m.learn.after ? ', once the rewrite is in' : ', about 5 minutes'}.`);
  else if (m.learn?.why) parts.push(`New moves from this wait: ${capWhy(m.learn.why)}.`);
  if (!parts.length) return 'Nothing in this changes the current moves.';
  return `${parts.join(' ')}${m.rewrite?.ns?.length || m.learn?.n ? ' Cards refresh as they land.' : ''}`;
}

/* ---------- prompts ---------- */
const S = { type: 'string' };
export const EXTRACT_SCHEMA = { type: 'object', properties: { learnings: { type: 'array', items: { type: 'object', properties: {
  kind: { type: 'string', enum: KINDS, description: 'essence: who the brand is at heart, why it exists, what it stands for. goal: what they are trying to do (goals, priorities, upcoming plans, launches, dates). belief: what they believe about customers, product, claims and tone, and what to avoid. fact: a concrete fact (a product, a price, a launch, an audience, a channel, a number).' },
  text: { type: 'string', description: 'One plain sentence under 30 words about the brand, in the third person ("They…", "Customers…"). Only what the input states.' },
  quote: { type: 'string', description: 'The exact words from the input this rests on, copied character for character (up to 200 characters)' },
  topic: { type: 'string', enum: [...MEM_TOPICS, 'none'], description: 'facts and beliefs: where it belongs (rules = something they never or always do in public); others: none' },
  conflictLabel: { type: 'string', description: 'facts only: the label of the fact-sheet line this states a DIFFERENT value for, copied exactly; empty when it agrees or the sheet does not have it' },
  conflictSays: { type: 'string', description: 'when conflictLabel is set: the value the input states, as written' } } } } } };
export function extractPrompt({ name, host, chunk, part, parts, kind, sheet }) {
  const lines = Object.values(sheet || {}).filter((f) => f?.label && !f.demo && f.kind !== 'demo').slice(0, 80).map((f) => `- ${f.label}: ${f.v}${f.connected ? ` (from ${TOOL[f.connected] || f.connected}, connected)` : ''}`);
  return `The team at ${name}${host ? ` (${host})` : ''} gave Brew this ${kind.toLowerCase()}${parts > 1 ? ` (part ${part} of ${parts})` : ''}. It may be a call between the brand's people and Brew or a customer, notes, emails or research.
Pull out what Brew should learn about ${name}: its essence, its goals and plans, its beliefs, and concrete facts.
Rules:
- Only what the input states. Never infer, round, convert or add a number, name, date or claim. Skip greetings, scheduling and small talk.
- What the brand's own people say is the brand's view. What a customer says is about customers ("Customers say…"). What Brew or an interviewer suggests is not a learning unless the brand agreed to it.
- One learning per item, no duplicates; 0 to 25 items. quote is copied exactly from the input.
- A fact that gives a different value for a line on the fact sheet below: set conflictLabel and conflictSays. The sheet and connected accounts are the source of truth for numbers.
${lines.length ? `\nFACT SHEET (what Brew already has):\n${lines.join('\n')}\n` : ''}
INPUT:
"""
${chunk}
"""`;
}
export const PLAN_SCHEMA = { type: 'object', properties: {
  stale: { type: 'array', description: 'Every move these learnings change, as many as they really touch (none to all of them), the most affected first', items: { type: 'object', properties: { n: { type: 'integer' }, why: { type: 'string', description: 'One plain sentence: what in the learnings changes this move' }, uses: { type: 'array', items: { type: 'integer' }, description: 'the learning numbers it rests on' } } } },
  fresh: { type: 'array', description: 'New moves the learnings open that no current move covers (0 to 3)', items: { type: 'object', properties: { title: S, why: { type: 'string', description: 'One sentence, naming the learning it comes from' } } } } } };
export function planPrompt({ name, items, moves }) {
  const ms = Object.entries(moves || {}).filter(([n, m]) => +n >= 1 && m?.title).map(([n, m]) => `${n} | ${cut(m.title, 90)} | ${cut(m.gives || m.stat || '', 140)}${m.meta?.cadence ? ' | (weekly move)' : ''}`);
  return `${name}'s team just told Brew these learnings:\n${items.map((x, i) => `${i}. [${x.kind}] ${x.text}`).join('\n')}\n\nBrew's current moves for ${name} (number | title | what it gives):\n${ms.join('\n')}\n\nDecide:\n- stale: the moves these learnings make out of date: a goal changes what comes first, a belief rules out what the move proposes, a fact changes a product, price, launch or audience the move relies on. Include every move the learnings really change: what works for them, what does not, what they believe, their goals, a product or price, an audience. That can be many or all of them. A move the learnings do not touch stays as it is. Never a weekly move.\n- fresh: what the learnings open that no move covers yet (a goal, a launch, a belief to build on). Empty when the current moves already cover it.\nNever invent anything the learnings do not say.`;
}

/* ---------- the run ---------- */
export function createLearnings({ ai = null, packs, memory = null, builder = null, cadence = null, onPack = async () => {}, log = console, now = () => Date.now(), env = process.env, wait = (ms) => new Promise((r) => setTimeout(r, ms).unref?.()) } = {}) {
  const MAX_CHARS = +env.LEARN_MAX_CHARS || 120000, CHUNK = +env.LEARN_CHUNK_CHARS || 14000, REWRITE_MAX = env.LEARN_REWRITE_MAX != null && env.LEARN_REWRITE_MAX !== '' ? +env.LEARN_REWRITE_MAX : 6, /* later learnings rewrite up to 6; the first ones may refresh every move they change, after a warning */ DAY_MAX = +env.LEARN_DAY_MAX || 12;
  const locks = new Map(); const serial = (slug, f) => { const p = (locks.get(slug) || Promise.resolve()).then(f, f); locks.set(slug, p.catch(() => {})); return p; };
  const live = () => !!ai?.live;

  async function extract({ name, host, text, kind, sheet }) {
    const parts = chunkText(text, CHUNK), box = { usd: 0 }, lists = [];
    // three chunks at a time: a long transcript reads in a minute, not ten
    for (let i = 0; i < parts.length; i += 3) {
      const rs = await Promise.all(parts.slice(i, i + 3).map((chunk, j) => ai.call({ model: 'sonnet', tag: 'learn-extract', max: 6000, effort: 'low', schema: EXTRACT_SCHEMA,
        system: 'You read what a brand’s team shared and keep only what it states, word for word. You never invent.',
        prompt: extractPrompt({ name, host, chunk, part: i + j + 1, parts: parts.length, kind, sheet }) }).then((r) => { box.usd += r.usd || 0; return vetLearnings((r.json?.learnings || []).map((x) => ({ ...x, topic: x.topic === 'none' ? null : x.topic })), chunk); })));
      lists.push(...rs);
    }
    return { items: mergeLearnings(lists), usd: box.usd, parts: parts.length };
  }
  async function plan({ name, items, moves }) {
    const r = await ai.call({ model: 'sonnet', tag: 'learn-plan', max: 3000, effort: 'low', schema: PLAN_SCHEMA, prompt: planPrompt({ name, items, moves }) });
    const ok = (n) => +n >= 1 && +n <= 50 && moves[n] && !moves[n].meta?.cadence;
    const stale = []; for (const s of r.json?.stale || []) if (ok(s.n) && !stale.some((x) => x.n === +s.n)) stale.push({ n: +s.n, why: cut(s.why, 220), uses: (s.uses || []).filter((i) => items[i]).slice(0, 4) });
    return { stale, fresh: (r.json?.fresh || []).filter((x) => x?.title).slice(0, 3).map((x) => ({ title: cut(x.title, 90), why: cut(x.why, 220) })), usd: r.usd || 0 };
  }
  // the new moves run once the rewrite is in (both write moves.json), in the background
  const afterRewrite = (slug, hints) => (async () => { for (let i = 0; i < 270 && builder?.busy?.(slug); i++) await wait(20e3);
    const r = await cadence.runOne(slug, ['learn'], { manual: true, hints }); log.log?.(`[learn] ${slug}: ${r?.written?.length || 0} new moves from learnings, $${r?.usd ?? 0}`); })().catch((e) => log.warn?.('[learn] new moves', slug, e.message));

  /* run(slug, { text, by, byShort, mode, why, workId }) → the reply and what changed */
  async function run(slug, { text, by = 'the team', byShort = '', why = 'command', workId = null, ask = true } = {}) { /* ask false (the setup box): no jam to answer a warning in, so the first learnings rewrite the top moves and mark the rest */
    return serial(slug, async () => {
      const t0 = now(), raw = String(text || '').trim();
      const p = await packs.load(slug, { fresh: true }).catch(() => null), name = p?.name || slug, host = p?.host || '';
      const note = WHY_NOTE[why] || '';
      if (raw.length < 40) return { reply: `${note ? `${note}\n\n` : ''}Paste the transcript, notes or email after ${LEARN_CMD} and send it. Brew pulls out ${name}’s essence, goals, beliefs and facts, each with its source, then updates the brief, its memory and the moves.`, asked: true };
      const hash = sourceHash(raw), L = { ...emptyLearned(), ...((await packs.getJSON(slug, 'learned.json', null)) || {}) };
      const seen = L.sources.find((s) => s.hash === hash);
      /* the same paste again: what was saved from it comes back as a draft to edit; save replaces it, cancel keeps it (no new read, nothing spent) */
      if (seen) { const items = Object.keys(BUCKET).flatMap((k) => (L[BUCKET[k]] || []).filter((x) => x.hash === hash).map((x) => ({ kind: k, text: x.text, quote: x.quote, topic: x.topic || null })));
        if (!ask || !items.length) return { dup: true, reply: replyText({ note, dup: { kind: seen.kind, at: seen.at, by: seen.byShort || seen.by, n: seen.n } }) };
        const d = { hash, kind: seen.kind, label: seen.label, by, byShort, at: t0, chars: seen.chars, how: seen.how, workId, items, conflicts: [], again: 0, clipped: 0, usd: 0, note: '', first: false, replace: { at: seen.at, by: seen.byShort || seen.by } };
        L.draft = d; await packs.put(slug, 'learned.json', L); return { draft: true, dup: true, reply: draftText({ name, d }) }; }
      if (L.draft?.hash === hash) return { draft: true, reply: draftText({ name, d: L.draft }) }; /* the same paste again while its draft waits: the draft, no new read */
      const reads = L.reads || L.sources.map((x) => x.at); /* every read counts toward the day, saved or not */
      if (reads.filter((at) => dayOf(at) === dayOf(t0)).length >= DAY_MAX) return { capped: true, reply: `${note ? `${note}\n\n` : ''}${name} has added ${DAY_MAX} sources today, the daily limit. Paste it again tomorrow and Brew learns from it then. Nothing was spent.` };
      const clipped = raw.length > MAX_CHARS ? MAX_CHARS : 0, src = clipped ? raw.slice(0, MAX_CHARS) : raw;
      const kind = sourceKind(src), label = `${kind}, added by ${by}, ${dayOf(t0)}`;
      const pf = await packs.getJSON(slug, 'private/facts.json', null).catch(() => null), sheet = { ...(p?.facts || {}), ...(pf?.facts || {}) };
      // 1. read it
      let items = null, usd = 0, how = 'words';
      if (live()) { try { const r = await extract({ name, host, text: src, kind, sheet }); items = r.items; usd += r.usd; how = 'ai'; } catch (e) { if (!e.mock) log.warn?.('[learn] extract', slug, e.message); } }
      if (!items) items = vetLearnings(heuristicLearnings(src), src);
      // 2. what is new, what the fact sheet disagrees with
      const first = !(L.sources || []).some((x) => x.n > 0); /* the brand's first learnings: the only time every move they change is rewritten */
      const known = learnedItems(L), fresh = items.filter((x) => !known.some((k) => sameLearning(k.text, x.text))), again = items.length - fresh.length;
      const { applied, conflicts } = conflictsOf(fresh, sheet);
      await packs.put(slug, `private/learnings/${hash}.txt`, raw, 'text/plain; charset=utf-8').catch((e) => log.warn?.('[learn] source', e.message));
      L.reads = [t0, ...reads].slice(0, 100);
      const d = { hash, kind, label, by, byShort, at: t0, chars: raw.length, how, workId, items: applied, conflicts, again, clipped, usd: +usd.toFixed(4), note, first };
      /* the team checks what Brew read before it becomes brand context: nothing is saved, and no move starts, until "save" */
      if (ask && applied.length) { L.draft = d; await packs.put(slug, 'learned.json', L); log.log?.(`[learn] ${slug}: ${kind} ${raw.length} chars → ${applied.length} to review (${again} known, ${conflicts.length} conflicts) by ${how}, $${d.usd}`); return { draft: true, reply: draftText({ name, d }) }; }
      return apply(slug, d, { L, p, ask });
    });
  }
  /* save checked learnings as brand context: the brief, Brew's memory, then the moves they change */
  async function apply(slug, d, { L, p, ask = true } = {}) {
      const { hash, kind, label, by, byShort, how, workId, conflicts, again, clipped, note, first } = d, t0 = d.at, applied = d.items; let usd = d.usd || 0;
      p ||= await packs.load(slug, { fresh: true }).catch(() => null); const name = p?.name || slug;
      L ||= { ...emptyLearned(), ...((await packs.getJSON(slug, 'learned.json', null)) || {}) }; delete L.draft;
      if (d.replace) { for (const k of Object.values(BUCKET)) L[k] = (L[k] || []).filter((x) => x.hash !== hash); L.sources = (L.sources || []).filter((x) => x.hash !== hash); } /* an edited, already-saved source: its new lines replace the old */
      const stamp = (x) => ({ id: `l_${crypto.randomBytes(4).toString('hex')}`, text: x.text, quote: x.quote, topic: x.topic || null, kind: x.kind, source: label, hash, at: t0 });
      for (const x of applied) L[BUCKET[x.kind]] = [stamp(x), ...(L[BUCKET[x.kind]] || [])].slice(0, KEEP);
      L.at = t0; L.sources = [{ hash, kind, label, by, byShort, at: t0, chars: d.chars, n: applied.length, conflicts: conflicts.length, how, workId }, ...L.sources].slice(0, 200);
      await packs.put(slug, 'learned.json', L);
      if (applied.length) {
        // the brief every move is written from, and the brief.json view the weekly moves read
        const bj = await packs.getJSON(slug, 'brief.json', null).catch(() => null);
        if (bj && typeof bj === 'object') await packs.put(slug, 'brief.json', { ...bj, learned: briefView(L) });
        const bm = await packs.get(slug, 'brief.md').catch(() => null);
        if (bm != null && String(bm).trim()) await packs.put(slug, 'brief.md', withLearned(bm.toString('utf8'), L, { name }), 'text/markdown; charset=utf-8');
        // brand memory: one line per learning, with its source
        if (memory?.addFacts) await memory.addFacts(slug, applied.map((x) => ({ text: x.text, topic: memTopic(x), source: { kind: 'team', label, ref: hash } })), { by: 'learnings', infer: live() ? true : 'local' }).catch((e) => log.warn?.('[learn] memory', slug, e.message));
        await onPack(slug);
      }
      // 3. moves
      const moves = { stale: [], rewrite: null, flaggedOnly: [], learn: null };
      if (applied.length && p?.kind === 'generated') {
        const docs = await packs.getJSON(slug, 'moves.json', {}).catch(() => ({}));
        let pl = null;
        if (live() && Object.keys(docs).length) { try { pl = await plan({ name, items: applied, moves: docs }); usd += pl.usd; } catch (e) { if (!e.mock) log.warn?.('[learn] plan', slug, e.message); } }
        pl ||= planLocal(applied, docs);
        moves.stale = pl.stale;
        if (pl.stale.length && builder?.flagStale) await builder.flagStale(slug, pl.stale.map((s) => ({ n: s.n, priority: 'high', why: `What the team told us (${label}): ${s.why}`, changes: s.uses.map((i) => `Learned: ${cut(applied[i]?.text, 160)}`).filter((x) => x.length > 9), via: 'learnings' }))).catch((e) => log.warn?.('[learn] flag', e.message));
        if (ask && first && pl.stale.length > REWRITE_MAX && live() && builder?.rewrite) {
          /* the first learnings can refresh every move they change: warn first (time and cost), start only on a yes */
          const ns = pl.stale.map((s) => s.n); L.pendingFull = { ns, top: ns.slice(0, REWRITE_MAX), at: t0, label }; await packs.put(slug, 'learned.json', L);
          moves.pending = { ns, est: Math.round(ns.length * 0.6) };
        } else if (pl.stale.length && live() && builder?.rewrite && REWRITE_MAX > 0) {
          const ns = pl.stale.slice(0, REWRITE_MAX).map((s) => s.n), r = await builder.rewrite(slug, ns, { via: 'learnings' }).catch((e) => ({ error: e.message })); /* first in the queue, never turned away */
          moves.rewrite = r?.error ? { error: r.error } : { ns, est: r?.est, queued: !!r?.queued }; if (!r?.error) moves.flaggedOnly = pl.stale.slice(REWRITE_MAX).map((s) => s.n);
        } else if (pl.stale.length) moves.rewrite = live() ? { error: 'rewrites are switched off here' } : { off: true };
        if (pl.fresh.length && cadence) {
          const d = await cadence.due(slug, { manual: true, only: ['learn'] }).catch((e) => ({ families: [], why: [e.message] }));
          if (d.families.includes('learn')) { moves.learn = { n: Math.min(3, pl.fresh.length), after: !!moves.rewrite?.ns || !!moves.pending }; if (moves.pending) { L.pendingFull.fresh = pl.fresh; await packs.put(slug, 'learned.json', L); } else afterRewrite(slug, pl.fresh); } /* waiting on the first-time answer: the new moves start after it */ else moves.learn = { why: d.why || [] };
        }
      }
      const out = { name, kind, label, by, byShort, applied, conflicts, again, clipped, moves, note, usd: +usd.toFixed(4), how, hash };
      log.log?.(`[learn] ${slug}: ${kind} ${d.chars} chars → ${applied.length} learned (${again} known, ${conflicts.length} conflicts) by ${how}, ${moves.stale.length} moves out of date, rewrite ${moves.rewrite?.ns?.join(',') || moves.rewrite?.error || '-'}, new ${moves.learn?.n || 0}, $${out.usd}`);
      return { ...out, reply: replyText(out) };
  }
  /* the answer to a draft: save it, drop or change a line, add one, or cancel. null when the message isn't about the draft */
  async function review(slug, text) {
    const L = { ...emptyLearned(), ...((await packs.getJSON(slug, 'learned.json', null)) || {}) }, d = L.draft; if (!d?.items) return null;
    const t = String(text || '').trim(), lo = t.toLowerCase(), p = await packs.load(slug, { fresh: true }).catch(() => null), name = p?.name || slug;
    const nums = (x) => [...new Set((x.match(/\d+/g) || []).map(Number))].filter((n) => n >= 1 && n <= d.items.length);
    let m;
    if (/^(save|save it|save them|looks good|looks right|all good|yes|yep|confirm|ok(ay)?|approve|correct)\b/.test(lo)) return { ...(await serial(slug, () => apply(slug, { ...d, note: '' }, { L, p }))), saved: true }; /* the draft already said how it was read */
    if (/^(cancel|discard|don'?t save|no\b|scrap)/.test(lo)) { delete L.draft; await packs.put(slug, 'learned.json', L); if (d.replace) return { reply: 'Okay, kept as it was. Nothing changed.' }; return { reply: 'Okay, nothing was saved. Paste it again with /update-brand-learnings whenever you want Brew to learn from it.' }; }
    if ((m = lo.match(/^(drop|remove|delete)\b(.*)$/))) { const ns = nums(m[2]); if (!ns.length) return { reply: `Which one? Say e.g. “drop 3” (1 to ${d.items.length}).` }; d.items = d.items.filter((_, i) => !ns.includes(i + 1)); }
    else if ((m = t.match(/^(?:change|edit|fix|reword)\s+(\d+)\s*(?:to|:|-|=)?\s*([\s\S]{4,})$/i))) { const i = +m[1] - 1; if (!d.items[i]) return { reply: `There is no line ${m[1]}. Pick 1 to ${d.items.length}.` }; d.items[i] = { ...d.items[i], text: cut(m[2].trim(), 400), quote: m[2].trim(), edited: true }; }
    else if ((m = t.match(/^add\s*(essence|goal|belief|fact)?s?\s*[:-]?\s*([\s\S]{4,})$/i))) { const k = (m[1] || 'fact').toLowerCase(); d.items.push({ kind: k, text: cut(m[2].trim(), 400), quote: m[2].trim(), topic: null, typed: true }); }
    else return null;
    L.draft = d; await packs.put(slug, 'learned.json', L);
    if (!d.items.length) { delete L.draft; await packs.put(slug, 'learned.json', L); return { reply: 'That leaves nothing to save, so nothing was saved.' }; }
    return { reply: draftText({ name, d, again: true }) };
  }

  /* the answer to the first-learnings warning: "go ahead" refreshes every move it named, "just the top 6" the six most affected */
  async function confirm(slug, text) {
    const L = (await packs.getJSON(slug, 'learned.json', null)) || {}, pf = L.pendingFull; if (!pf?.ns?.length) return null;
    const t = String(text || '').trim().toLowerCase();
    const all = /^(yes|yep|go ahead|go|start|confirm|do it|ok(ay)?|refresh (them )?all|all)\b/.test(t), top = /\b(top|just|only)\s*(the\s*)?(6|six)\b/.test(t), no = /^(no|cancel|not now|stop|skip)\b/.test(t);
    if (!all && !top && !no) return null;
    delete L.pendingFull; await packs.put(slug, 'learned.json', L);
    const fresh = pf.fresh || [], newMoves = () => { if (fresh.length && cadence) afterRewrite(slug, fresh); }; /* after the rewrite starts, so they wait for it */
    if (no) { newMoves(); return { reply: 'Okay, no moves are rewritten. The learnings are still in the brief and Brew’s memory, so every new card and jam uses them.' }; }
    const ns = top ? pf.top : pf.ns, r = builder?.rewrite ? await builder.rewrite(slug, ns, { via: 'learnings' }).catch((e) => ({ error: e.message })) : { error: 'rewrites are switched off here' };
    newMoves();
    if (r?.error) return { reply: `The refresh can’t start now: ${String(r.error).replace(/\.$/, '')}. The moves stay marked to rewrite on the Moves tab.` };
    const k = ns.length, mins = k <= 2 ? '10 to 15 minutes' : k <= 6 ? '15 to 20 minutes' : k <= 18 ? 'about 30 to 45 minutes' : 'about an hour';
    return { reply: `Refreshing ${k} move${k === 1 ? '' : 's'} with what the team told us, ${mins}. Cards refresh as they land.` };
  }
  return { run, live, confirm, review };
}
