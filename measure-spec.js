/* How we measure it, designed from the brief.
   An outcome can be measured many ways (two checkpoints, a holdout, a funnel, a ratio, a stop rule), so the
   section is not a fixed template. Each brief change writes a small spec: an ordered list of blocks picked
   from the vocabulary below, and the card page draws whatever comes back.
   The brief is the source of truth: every number in the spec must appear in the brief, or it's dropped. */

export const BLOCKS = ['scope', 'track', 'compare', 'funnel', 'formula', 'guard', 'watch', 'north', 'attribution', 'open'];

export const MEASURE_SCHEMA = {
  type: 'object', required: ['metric', 'summary', 'blocks'],
  description: 'How we measure it, designed for THIS brief. Pick only the blocks that fit how this outcome is actually measured, in the order a reader needs them.',
  properties: {
    metric: { type: 'string', description: 'The number we judge it on, as a short title (max 60 chars), e.g. "Serum reorders by day 25 and by day 45"' },
    summary: { type: 'string', description: 'The goal at a glance for the header, max 40 chars, e.g. "25% by day 25, 30% by day 45". Empty if the brief sets no target.' },
    blocks: { type: 'array', items: { type: 'object', required: ['type'], properties: {
      type: { type: 'string', enum: BLOCKS, description: [
        'scope: who and where it is counted (text), e.g. "Serum buyers on the store, by order date".',
        'track: the timeline from go-live to each checkpoint (points). Use one point per checkpoint the brief names; "read" is the day we first read it if the brief says so.',
        'compare: two groups compared (groups) when the brief measures lift against a holdout, control or A/B split; result says what the gap means.',
        'funnel: steps from first touch to the outcome (steps) when the brief tracks a chain like sent > read > clicked > reordered.',
        'formula: how the number is worked out (top ÷ bottom) when the metric is a ratio people could count differently.',
        'guard: the stop rules (rules: if / then).',
        'watch: what we watch along the way (items).',
        'north: the bigger goal this serves (text), only when it is a different number from the main metric and the brief states it.',
        'attribution: how we know it was this and not something else (text).',
        'open: what the brief has not settled about measuring it yet, as short questions (items), e.g. "Do coupon reorders count?"'].join(' ') },
      text: { type: 'string' },
      read: { type: 'integer', description: 'track: the day we first read it, if the brief says' },
      start: { type: 'string', description: 'track: the starting value or "At go-live"' },
      points: { type: 'array', items: { type: 'object', required: ['day', 'value'], properties: { day: { type: 'integer' }, value: { type: 'string', description: 'The target at that day, exactly as the brief writes it' }, label: { type: 'string', description: 'Optional 1-3 words, e.g. "First check", "Target"' } } } },
      groups: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, gets: { type: 'string', description: 'What this group gets, a few words' }, share: { type: 'string', description: 'Its share, e.g. "90%"' } } } },
      result: { type: 'string' },
      steps: { type: 'array', items: { type: 'object', required: ['label'], properties: { label: { type: 'string' }, value: { type: 'string', description: 'A target for this step, only if the brief gives one' } } } },
      top: { type: 'string' }, bottom: { type: 'string' },
      rules: { type: 'array', items: { type: 'object', required: ['if'], properties: { if: { type: 'string', description: 'The condition only, without "stop if"' }, then: { type: 'string', description: 'What we do, e.g. "Pause the nudge"' } } } },
      items: { type: 'array', items: { type: 'string' } }
    } } }
  }
};

export const MEASURE_ASK = 'Also return measure: design the "How we measure it" section for this brief from the block types. Pick only blocks that fit how THIS outcome is measured (two checkpoints = a track with two points; a holdout = compare; a ratio people could count differently = formula; gaps = open). Every number must come from the brief, written as the brief writes it; never carry over a number the brief has changed. No block repeats another. Plain words, short.';

const S = (x, n = 160) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
// numbers as written: "24.0%" and "24%" are the same number, "₹1,499" is 1499
const nums = (s) => (String(s || '').replace(/(\d),(?=\d{2,3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) || []).map((n) => String(+n));
const allowed = (md) => new Set(nums(md));
const ok = (s, A) => nums(s).every((n) => A.has(n));
const fam = (x) => String(x || '').toLowerCase().replace(/\s+(on|in|for|from|across|via|by)\s+.*$/, '').replace(/[^a-z0-9 ]/g, '').trim();

// keep only what the brief backs; tidy the words so no label repeats itself ("We stop if Stop the nudge if…")
export const vetMeasure = (spec, md) => {
  if (!spec || !Array.isArray(spec.blocks)) return null;
  const A = allowed(md), seen = new Set(), out = [];
  for (const b0 of spec.blocks.slice(0, 7)) {
    const type = BLOCKS.includes(b0?.type) ? b0.type : null; if (!type || (seen.has(type) && type !== 'open')) continue;
    let b = { type };
    if (type === 'scope' || type === 'north' || type === 'attribution') { const t = S(b0.text, 200); if (!t || !ok(t, A)) continue; b.text = t; }
    if (type === 'north' && fam(b.text) === fam(spec.metric)) continue;
    if (type === 'track') {
      const pts = (b0.points || []).map((p) => ({ day: Math.round(+p.day), value: S(p.value, 30), label: S(p.label, 24) })).filter((p) => p.day > 0 && p.day < 400 && p.value && ok(`${p.day} ${p.value}`, A)).sort((a, b) => a.day - b.day).slice(0, 4);
      if (!pts.length) continue; b.points = pts; b.start = S(b0.start, 30) && ok(b0.start, A) ? S(b0.start, 30) : 'At go-live';
      const r = Math.round(+b0.read); if (r > 0 && A.has(String(r)) && !pts.some((p) => p.day === r)) b.read = r;
    }
    if (type === 'compare') { const g = (b0.groups || []).map((x) => ({ name: S(x.name, 40), gets: S(x.gets, 60), share: S(x.share, 12) })).filter((x) => x.name && ok(`${x.name} ${x.gets} ${x.share}`, A)); if (g.length !== 2) continue; b.groups = g; b.result = ok(b0.result, A) ? S(b0.result, 160) : ''; }
    if (type === 'funnel') { const st = (b0.steps || []).map((x) => ({ label: S(x.label, 30), value: ok(x.value, A) ? S(x.value, 20) : '' })).filter((x) => x.label); if (st.length < 2) continue; b.steps = st.slice(0, 5); }
    if (type === 'formula') { if (!b0.top || !b0.bottom || !ok(`${b0.top} ${b0.bottom}`, A)) continue; b.top = S(b0.top, 80); b.bottom = S(b0.bottom, 80); b.text = ok(b0.text, A) ? S(b0.text, 140) : ''; }
    if (type === 'guard') { const rs = (b0.rules || []).map((r) => ({ if: S(r.if, 160).replace(/^(we\s+)?(stop|pause)\s+(the\s+\w+\s+)?(if|when)\s+/i, '').replace(/^(if|when)\s+/i, '').replace(/\.$/, ''), then: S(r.then, 60).replace(/\.$/, '') })).filter((r) => r.if && ok(`${r.if} ${r.then}`, A)); if (!rs.length) continue; b.rules = rs.slice(0, 3); }
    if (type === 'watch' || type === 'open') { const it = (b0.items || []).map((x) => S(x, 80)).filter((x) => x && ok(x, A)); if (!it.length) continue; b.items = [...new Set(it)].slice(0, 5); }
    seen.add(type); out.push(b);
  }
  if (!out.length) return null;
  const summary = ok(spec.summary, A) ? S(spec.summary, 48) : '';
  return { metric: S(spec.metric, 80), summary, blocks: out };
};

// no AI: read the measure straight from the brief's Markdown, with the card's watch list and attribution behind it
export const measureFromMd = (md, plan = {}, ctx = {}) => {
  const text = String(md || ''), sec = (text.match(/##\s*How we measure it\s*\n([\s\S]*?)(?=\n#{1,3}\s|$)/i) || [, text])[1];
  const pts = []; const re = /(₹\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?x)\s*(?:of [^,.;]{1,40}?\s)?(?:by|on|at|in|within)\s*day\s*(\d{1,3})/gi; let m;
  while ((m = re.exec(sec))) pts.push({ day: +m[2], value: m[1].replace(/\s+/g, '') });
  if (!pts.length && plan.target && plan.window) pts.push({ day: +plan.window, value: plan.target, label: 'Target' });
  const om = ctx.option || {}, cm = ctx.card || {}, blocks = [];
  const where = om.where || ''; if (where) blocks.push({ type: 'scope', text: where });
  if (pts.length) blocks.push({ type: 'track', start: 'At go-live', points: pts, read: plan.window && !pts.some((p) => p.day === +plan.window) ? +plan.window : undefined });
  const attr = om.attribution || cm.attribution || '';
  const hold = attr.match(/(\d+(?:\.\d+)?)\s?%\s*holdout/i);
  if (hold) blocks.push({ type: 'compare', groups: [{ name: 'Gets it', gets: 'Everyone else' }, { name: 'Holdout', gets: 'Nothing', share: `${hold[1]}%` }], result: 'The gap between the two groups is the lift.' });
  const guard = plan.guard || om.guard; if (guard) blocks.push({ type: 'guard', rules: [{ if: guard }] });
  const watch = om.watch || cm.watch; if (watch?.length) blocks.push({ type: 'watch', items: watch });
  if (attr && !hold) blocks.push({ type: 'attribution', text: attr });
  const open = []; if (!pts.length) open.push('What target do we sign up to?'); if (!plan.window && !pts.length) open.push('Which day do we read it?');
  if (open.length) blocks.push({ type: 'open', items: open });
  const metric = plan.metric || om.metric || cm.metric || 'The result';
  const summary = pts.map((p) => `${p.value} by day ${p.day}`).join(', ');
  // the card's own watch list and attribution count as backed; targets only come from the brief
  return vetMeasure({ metric, summary, blocks }, `${text}\n${(watch || []).join(' ')}\n${attr}\n${where}`);
};
