import { B, BN, BH, CTRY, FESTN, FESTD } from './brand-ctx.js';
// The card page: an extended version of the card in the feed, laid out like a decision.
// Every card (any agent, type or action) gets the same shape:
//   the options (2–3 real ways to act on it, each with what changes and which moves back it, one is our pick),
//   our recommendation, what follows from it, and the few details from its moves that matter, in plain words.
// Built once per seed card by tools/build_card_pages.mjs (data/card-pages.json), and on first open for any card
// made at runtime. Every ₹ and % must be in the fact sheet, or that sentence is dropped.

export const PAGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['lead', 'options', 'reason', 'follows', 'moves'], properties: {
  lead: { type: 'string', description: 'One line: what this card asks the brand to decide or do. Under 18 words.' },
  options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'says', 'effect', 'moves', 'pick'], properties: {
    name: { type: 'string', description: 'The option, under 8 words, concrete (e.g. "Lead the sale with the 3-pack").' },
    says: { type: 'string', description: 'What we would do, one sentence under 20 words.' },
    effect: { type: 'string', description: 'What changes for the brand if we go with it: prices, pages, audiences, spend, timing, claims. Under 26 words.' },
    moves: { type: 'array', items: { type: 'integer' }, description: 'Which of the card’s moves back this option. Empty if none.' },
    pick: { type: 'boolean', description: 'True for exactly one option: the one we recommend.' },
    measure: { type: 'object', additionalProperties: false, required: ['metric', 'where', 'target', 'window', 'watch', 'guard'], description: 'How we would know THIS option worked. Different options usually count different things, in different places, over different windows.', properties: {
      metric: { type: 'string', description: 'The one number we read for this option, plain, under 8 words (e.g. "Click-through on the new titles").' },
      where: { type: 'string', description: 'Where we read it, under 8 words (e.g. "Blinkit, Zepto and Instamart only").' },
      target: { type: 'string', description: 'The target, only with a number from the facts list, the card or the card measure. Empty if none is backed.' },
      window: { type: 'integer', description: 'Days until we read it (7, 14, 21 or 28).' },
      watch: { type: 'array', items: { type: 'string' }, description: '1 to 3 things the team watches along the way, under 9 words each.' },
      guard: { type: 'string', description: 'When the team should stop or roll it back, under 16 words. Numbers only if backed. Brew does not watch or stop anything.' }
    } }
  } } },
  reason: { type: 'string', description: 'Our recommendation: why the pick wins, under 40 words, plain.' },
  follows: { type: 'array', items: { type: 'string' }, description: '0 to 4 short names of the things that change once this is decided (ads, pages, flows, other cards). Under 6 words each.' },
  moves: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'plain', 'says', 'points', 'number'], properties: {
    n: { type: 'integer' },
    plain: { type: 'string', description: 'What this move is, in plain words, under 14 words. No jargon.' },
    says: { type: 'string', description: 'The one thing it says that matters for THIS card, under 24 words.' },
    points: { type: 'array', items: { type: 'string', description: 'A key detail that backs or sharpens the card. Under 18 words.' } },
    number: { type: 'string', description: 'The single most telling number for this card with a 2–5 word label, or empty.' }
  } } }
} };

const CURU = (u) => /^(₹|\$|£|€|[ACS]\$)$/.test(u || '');
const measureLine = (m) => m ? `The card's main measure: ${m.metric}${m.baseline != null ? `, today ${CURU(m.unit) ? m.unit + m.baseline : m.baseline + (m.unit || '')}` : ', no baseline yet (to be measured)'}${m.target != null ? `, target ${CURU(m.unit) ? m.unit + m.target : m.target + (m.unit || '')}` : ', target to be set from the first reading'}, read after ${m.window} days. Watched: ${(m.watch || []).join('; ')}.` : '';
export const pagePrompt = ({ card: c, factBrief, moveText, nums, measure }) => `You are writing the card page inside the Brew Feed for ${BN()}'s team. The page is an extended version of the card they tapped: it must let them decide in under a minute. Plain words, short sentences, no internal notes, never mention "the document".

Facts you may quote (exact numbers, no others):
${factBrief}

THE CARD (by the ${c.agent || 'Brew'} agent, type ${c.type || 'idea'}${c.sector ? ', ' + c.sector : ''})
Title: ${c.title}
Body: ${c.sub}
${(c.rows || []).map((r) => `- ${r[0]}: ${r[1]}`).join('\n')}
${c.cta?.label ? `Its button: ${c.cta.label}` : ''}
${(c.detail?.how || []).length ? 'What it recommends: ' + c.detail.how.join(' / ') : ''}
${(c.detail?.why || []).length ? 'Why: ' + c.detail.why.join(' / ') : ''}
${c.detail?.watch ? 'Watch: ' + c.detail.watch : ''}
${measureLine(measure)}
${(c.options || []).length ? 'Its options: ' + c.options.map((o) => `${o.name} (${o.says}; changes: ${o.effect}; moves ${o.moves})`).join(' | ') + (c.pick ? ` · our pick: ${c.options.find((o) => o.id === c.pick)?.name}` : '') : ''}

${moveText ? `THE MOVES IT CAME FROM (deep plans Brew wrote for ${BN()})\n${moveText}` : 'This card did not come from a move document. Leave moves empty and option moves empty.'}

Write:
- lead: what this card asks them to decide or do.
- options: 2 or 3 REAL alternatives for acting on this card (for example: the full plan now, a smaller test first, a different angle, a different order). The first is what the card recommends. Exactly one is our pick. Never "do nothing". Each option's moves lists only moves (${nums.length ? nums.join(', ') : 'none'}) that back it.
- each option's measure: how we would know THAT option worked. Make them genuinely different where the options differ (a test on one shelf reads a fast signal there; a full rollout reads the main outcome everywhere; a smaller fix reads whether the fix landed). Keep the card's main measure for the option it fits. Targets only with backed numbers, otherwise leave target empty.
- reason: why our pick wins.
- follows: what changes once this is decided.
- moves: for each move (${nums.length ? nums.join(', ') : 'none'}), what it is, what it says for this card, 2–3 key details (not a repeat of the card), and one telling number if there is one.
Only numbers from the facts list or the card.`;

export const moveTextOf = (M, MOVES, c) => {
  const ns = MOVES.numsOf(c.src); if (!ns.length) return { nums: [], moveText: '' };
  const passages = MOVES.passages(c, 8);
  return { nums: ns, moveText: ns.map((n) => { const m = M[n]; return `MOVE ${n}: ${m.title}\nWhat it gives: ${m.gives}\nLive in 30 days: ${m.live}\nThe stat: ${m.stat} ${m.statLabel}\nWhy (excerpt): ${String(m.why).slice(0, 1200)}\nHow it's measured (excerpt): ${String(m.measure).slice(0, 600)}\nPassages that match this card:\n${passages.filter((p) => p.n === n).map((p) => `[${p.h}] ${p.text}`).join('\n')}`; }).join('\n\n') };
};

// keep only sentences whose numbers the fact sheet backs
const scrub = (s, ok) => { s = String(s || '').replace(/—/g, ',').trim(); if (ok(s)) return s; return s.split(/(?<=[.!?])\s+/).filter(ok).join(' ').trim(); };

const cleanMeasure = (x, ok) => { if (!x || !x.metric) return null; const target = x.target && ok(x.target) ? String(x.target).trim() : '';
  return { metric: scrub(x.metric, ok), where: scrub(x.where, ok), target, window: [7, 14, 21, 28].includes(+x.window) ? +x.window : 14, watch: (x.watch || []).map((w) => scrub(w, ok)).filter(Boolean).slice(0, 3), guard: scrub(x.guard, ok) }; };
export const sanitizePage = (j, { card: c, M, nums, ok }) => {
  const moves = (j.moves || []).filter((x) => nums.includes(x.n) && M[x.n]).map((x) => ({ n: x.n, title: M[x.n].title, plain: scrub(x.plain, ok), says: scrub(x.says, ok), points: (x.points || []).map((p) => scrub(p, ok)).filter(Boolean).slice(0, 3), number: x.number && ok(x.number) ? x.number : '' }));
  let options = (j.options || []).map((o, i) => ({ id: 'o' + (i + 1), name: scrub(o.name, ok), says: scrub(o.says, ok), effect: scrub(o.effect, ok), moves: (o.moves || []).filter((n) => nums.includes(n)), pick: !!o.pick, measure: cleanMeasure(o.measure, ok) })).filter((o) => o.name && (o.says || o.effect)).slice(0, 3);
  // a card that already carries its options (moves disagree) keeps them word for word, with the measure written for each
  if (c.options?.length) options = c.options.map((o, i) => ({ id: o.id, name: o.name, says: o.says, effect: o.effect, moves: (String(o.moves || '').match(/\d+/g) || []).map(Number), pick: o.id === c.pick, measure: cleanMeasure(j.options?.[i]?.measure, ok) }));
  if (options.length && !options.some((o) => o.pick)) options[0].pick = true;
  if (options.filter((o) => o.pick).length > 1) { let seen = false; options.forEach((o) => { if (o.pick) { o.pick = !seen; seen = true; } }); }
  return { lead: scrub(j.lead, ok), options, reason: scrub(c.reason || j.reason, ok), follows: (c.affects?.length ? c.affects : j.follows || []).map((x) => scrub(x, ok)).filter(Boolean).slice(0, 4), moves, v: 2 };
};

// no AI: a page from the card's own fields, so every card opens even offline
export const fallbackPage = (c, M, MOVES) => {
  const how = c.detail?.how || [], ns = MOVES ? MOVES.numsOf(c.src) : [];
  const options = c.options?.length ? c.options.map((o) => ({ id: o.id, name: o.name, says: o.says, effect: o.effect, moves: (String(o.moves || '').match(/\d+/g) || []).map(Number), pick: o.id === c.pick }))
    : [{ id: 'o1', name: c.cta?.label || 'Do what it recommends', says: how[0] || c.sub, effect: how.slice(1).map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ') || (c.detail?.why || [])[0] || '', moves: ns, pick: true },
       ...(how.length > 1 ? [{ id: 'o2', name: 'Start smaller', says: `Only the first step: ${how[0]}`, effect: 'Less to set up, and a read on it before the rest.', moves: [], pick: false }] : [])];
  return { lead: c.sub, options, reason: c.reason || (c.detail?.why || [])[0] || '', follows: c.affects || [], moves: ns.filter((n) => M?.[n]).map((n) => ({ n, title: M[n].title, plain: M[n].gives ? M[n].gives.split('. ')[0].slice(0, 120) : '', says: '', points: [], number: M[n].stat ? `${M[n].stat} ${String(M[n].statLabel || '').toLowerCase()}` : '' })), v: 0, fallback: true };
};
