// Projected impact of one change version: a range for the metric the change moves, over the window it is judged in.
// It is an estimate, labelled as one ("a projection, not a promise"), never a measured result. It rests only on what
// Brew holds: the move's grade (value.js), how the family is measured (measure-families.js and the card's measure plan),
// the team's real connected-account rows (connectors/common.js realRows; demo rows never count), and the fact sheet.
// A line in its basis whose number the fact sheet or the account rows don't back is moved to the assumptions.
// The AI (claudeTool: the provider ai.js is set to, Vertex Gemini today) writes the range; when it is off or fails, the
// rule-based range from the grade stands, and an AI failure is said, never hidden. remix.js serves it and caches it per head version.
import { numbersIn } from './fact-gate.js';

const IMPROVE = { 1: [0, 2], 2: [1, 4], 3: [2, 8], 4: [5, 15], 5: [10, 25] }; // % better on the metric, by impact grade
export const PROJECTION = 'A projection, not a promise';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const confWord = (n) => (n >= 0.7 ? 'high' : n >= 0.45 ? 'medium' : 'low');
const RANK = { low: 0, medium: 1, high: 2 };
const capConf = (c, max) => (RANK[c] > RANK[max] ? max : c);

/* what the estimate stands on, gathered once: the same for the AI and the rules */
export function impactInputs({ card = {}, ch = {}, grade = null, recipe = null, measure = null, ledger = [], connected = {} }) {
  /* the family's own metric and window (measure-families.js) lead; the card's measure plan fills in, and gives the tool and baseline */
  const metric = recipe?.metric?.name || measure?.metric || 'The result this change is judged on';
  const lower = recipe?.metric?.lower ?? measure?.lower ?? false;
  const window = +(recipe?.window || measure?.window || 14) || 14;
  const from = measure?.from || null;
  const rows = ledger.filter((e) => e && e.v != null && !e.error);
  const near = from ? rows.filter((e) => String(e.key || '').startsWith(from + '.')) : [];
  const pick = (near.length ? near : rows).slice(0, 6);
  const gaps = ledger.filter((e) => e?.error).map((e) => `${e.label || e.key} couldn’t be read from the connected account this time; the next refresh tries again.`);
  return { metric, lower, window, from, rows: pick, gaps, grade, recipe, card, ch, connected,
    baseline: recipe?.metric?.name && measure?.metric && recipe.metric.name !== measure.metric ? null : measure?.baseline ?? null, unit: measure?.unit ?? recipe?.metric?.unit ?? '', timing: recipe?.timingLine || null, family: recipe?.name || null };
}

/* the range from the grade alone: impact sets the band, confidence narrows it; no grade is a wide, low-confidence band */
export function rulesImpact(x) {
  const g = x.grade, band = IMPROVE[g?.impact] || [1, 10], conf = g ? clamp(+g.confidence || 0.3, 0.2, 1) : 0.25;
  const low = Math.round(band[0] * (0.5 + conf / 2) * 10) / 10, high = Math.round(band[1] * (1.5 - conf / 2) * 10) / 10;
  let confidence = confWord(conf);
  if (!x.rows.length) confidence = capConf(confidence, 'medium'); if (!g) confidence = 'low';
  const basis = [], assumptions = [];
  if (g) basis.push(`Brew graded this move ${g.impact} of 5 for impact (${['', 'hygiene', 'under 0.5% of revenue', '0.5–2% of revenue', '2–5% of revenue', 'over 5% of revenue'][g.impact] || ''}), with ${Math.round(conf * 100)}% of it resting on facts Brew read${g.why ? `: ${g.why}` : ''}.`);
  else assumptions.push('This move has no grade yet, so the range is wide.');
  for (const e of x.rows) basis.push(`${e.label || e.key}: ${e.v} (${e.src || 'your connected account'})`);
  if (x.baseline != null) basis.push(`${x.metric} today: ${x.baseline}${/^\s*of /.test(x.unit || '') ? x.unit : ''} (your measure plan).`);
  if (x.timing) basis.push(`How it’s judged: ${x.timing}`);
  if (x.from && !x.connected?.[x.from]) assumptions.push(`${x.from[0].toUpperCase() + x.from.slice(1)} isn’t connected, so there’s no baseline from your own account.`);
  assumptions.push('It ships as drafted, to the audience and pages it names.', `Nothing else big changes in the same ${x.window} days (a sale, a price change, a new campaign).`);
  return { metric: x.metric, low, high, unit: '% better', direction: x.lower ? 'down' : 'up', window: x.window, windowLabel: `the first ${x.window} days after it goes live`, confidence, basis, assumptions, by: 'rules' };
}

export const IMPACT_SCHEMA = { type: 'object', required: ['metric', 'low', 'high', 'unit', 'direction', 'windowDays', 'confidence', 'basis', 'assumptions'], properties: {
  metric: { type: 'string', description: 'The one metric this change moves, plainly, e.g. "Cost per first order"' },
  low: { type: 'number', description: 'The cautious end of the range' }, high: { type: 'number', description: 'The hopeful end of the range' },
  unit: { type: 'string', description: 'What low and high are in: "% better" (preferred), or the metric’s own unit when the account rows give a baseline' },
  direction: { type: 'string', enum: ['up', 'down'], description: 'Which way the metric moves when the change works' },
  windowDays: { type: 'integer', description: 'Days after it goes live that the range covers' },
  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  basis: { type: 'array', items: { type: 'string' }, description: '2 to 5 short lines: what the range rests on. Only numbers from the inputs given; name the source of each' },
  assumptions: { type: 'array', items: { type: 'string' }, description: '2 to 4 short lines: what has to hold for the range to be right, and any benchmark you used, said as an assumption' } } };

export const impactPrompt = (x, brand = '') => `Project the impact of one marketing change for ${brand || 'a brand'}. It is an estimate the team sees before they ship it, labelled "a projection, not a promise".
Give a cautious-to-hopeful range for the one metric it moves over the window, never a single number. Use only the numbers below; a benchmark you know from outside is an assumption, said as one. If the inputs are thin, say so with a wide range and low confidence.

THE CHANGE: ${x.ch.actionLabel || ''} — ${x.ch.after?.title || x.card.title || ''}${x.ch.after?.sub ? `\n${x.ch.after.sub}` : ''}
FROM THE CARD: ${x.card.title || ''}${x.card.sub ? ` — ${x.card.sub}` : ''}
HOW IT’S MEASURED: ${x.metric}${x.family ? ` (${x.family})` : ''}; judged over ${x.window} days${x.timing ? `. ${x.timing}` : ''}${x.baseline != null ? `\nTODAY: ${x.baseline}${x.unit || ''}` : ''}
BREW’S GRADE OF THE MOVE: ${x.grade ? `impact ${x.grade.impact}/5 (5 = over 5% of monthly revenue, 1 = hygiene), confidence ${x.grade.confidence}, effort ${x.grade.effort}/4${x.grade.why ? `, because: ${x.grade.why}` : ''}` : 'not graded'}
THE TEAM’S CONNECTED ACCOUNTS (real rows only): ${x.rows.length ? x.rows.map((e) => `\n- ${e.label || e.key}: ${e.v} (${e.src || 'account'})`).join('') : 'none connected for this metric'}`;

/* the AI's answer, made safe: a real range, a known confidence, and every basis number backed (else it is an assumption) */
export function cleanImpact(j, x, unbacked = () => []) {
  if (!j || typeof j !== 'object') return null;
  let low = +j.low, high = +j.high; if (!Number.isFinite(low) || !Number.isFinite(high)) return null; if (low > high) [low, high] = [high, low];
  low = clamp(low, -100, 1e9); high = clamp(high, -100, 1e9);
  const ok = new Set(x.rows.flatMap((e) => numbersIn(String(e.v), { strict: true })));
  const basis = [], assumptions = (Array.isArray(j.assumptions) ? j.assumptions : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
  for (const s of (Array.isArray(j.basis) ? j.basis : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 6)) {
    const bad = unbacked(s).filter((n) => !ok.has(n)); if (bad.length) assumptions.push(`Assumed, not from your facts: ${s}`); else basis.push(s); }
  let confidence = ['low', 'medium', 'high'].includes(j.confidence) ? j.confidence : 'low'; if (!x.rows.length) confidence = capConf(confidence, 'medium'); if (!x.grade && !x.rows.length) confidence = 'low';
  const window = clamp(Math.round(+j.windowDays || x.window), 1, 365);
  return { metric: String(j.metric || x.metric).slice(0, 80), low: +low.toFixed(1), high: +high.toFixed(1), unit: String(j.unit || '% better').slice(0, 24), direction: j.direction === 'down' ? 'down' : 'up',
    window, windowLabel: `the first ${window} days after it goes live`, confidence, basis, assumptions, by: 'ai' };
}

/* one estimate: the AI when it may run, else (or when it fails) the rules. The failure is said, and such a result isn't cached */
export async function projectImpact(x, { ai = null, unbacked = () => [], brand = '', log = console } = {}) {
  let out = null, aiError = null;
  if (ai) { try { out = cleanImpact(await ai(impactPrompt(x, brand), IMPACT_SCHEMA), x, unbacked); if (!out) aiError = 'the AI’s range came back unusable'; } catch (e) { aiError = String(e?.message || e).slice(0, 140); log.warn?.('[impact]', aiError); } }
  out ||= rulesImpact(x);
  return { ...out, estimate: true, label: PROJECTION, ...(x.gaps.length ? { gaps: x.gaps } : {}),
    ...(aiError ? { aiError: `The AI estimate didn’t come through (${aiError}). This is Brew’s rule-based range from the move’s grade; ask again for the AI’s.` } : {}) };
}
