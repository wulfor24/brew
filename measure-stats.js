// The maths behind a result: how much did this one launch move its number, how sure are we, and what do we call it.
// Pure functions, no state. Every estimate is a difference against something (a control group, untouched products,
// or the days before) with a bootstrap range, so "it went up" is never mistaken for "we made it go up".
//
// Methods, strongest first (the grade a result can earn):
//   A  holdout   test group vs a control group over the same days (the control cancels everything else)
//   B  did       difference-in-differences: what changed on the launched scope minus what changed on untouched scope
//   C  tagged    outcomes carrying the launch's fingerprint (code, UTM, campaign): an upper bound, some would have bought anyway
//   D  prepost   the launched scope after vs before, with the pre-launch trend taken out when there are enough days

export const GRADES = ['A', 'B', 'C', 'D'];
export const METHOD_GRADE = { holdout: 'A', did: 'B', tagged: 'C', prepost: 'D' };
export const METHOD_NAME = { holdout: 'Test vs control group', did: 'Launched vs untouched', tagged: 'Tagged sales only', prepost: 'Before vs after' };
export const GRADE_WORDS = {
  A: 'High: measured against a control group that got nothing',
  B: 'Good: compared with similar things we did not change',
  C: 'Medium: counted only what carried the launch’s tag; some of it would have happened anyway',
  D: 'Low: before vs after only, anything else that changed is mixed in'
};
export const lowerGrade = (g, by = 1) => GRADES[Math.min(GRADES.length - 1, GRADES.indexOf(g) + by)] || 'D';
export const capGrade = (g, cap) => (cap && GRADES.indexOf(g) < GRADES.indexOf(cap) ? cap : g);

const vals = (xs) => (xs || []).map((x) => (typeof x === 'number' ? x : +x?.v)).filter(Number.isFinite);
export const mean = (xs) => { const v = vals(xs); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const sum = (xs) => vals(xs).reduce((a, b) => a + b, 0);

// a small seeded generator so the same data always gives the same range (results must not wobble on reload)
const rng = (seed = 7) => { let s = seed >>> 0 || 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const resample = (v, r) => v.map(() => v[Math.floor(r() * v.length)]);
const quant = (xs, q) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

// trend over the pre-launch days, projected to the middle of the post days (so a number already rising isn't credited to us)
const trendShift = (pre, nPost) => {
  const v = vals(pre); if (v.length < 14) return 0;
  const n = v.length, xm = (n - 1) / 2, ym = mean(v);
  let num = 0, den = 0; v.forEach((y, x) => { num += (x - xm) * (y - ym); den += (x - xm) ** 2; });
  const slope = den ? num / den : 0;
  return slope * (n - 1 - xm + (nPost + 1) / 2);
};

const point = {
  holdout: (d) => mean(d.treated.post) - mean(d.control.post),
  did: (d) => (mean(d.treated.post) - mean(d.treated.pre)) - (mean(d.control.post) - mean(d.control.pre)),
  prepost: (d) => mean(d.treated.post) - mean(d.treated.pre) - (d.trend ? trendShift(d.treated.pre, vals(d.treated.post).length) : 0)
};

// the least data a verdict may rest on: readings on each side of the comparison (a rolling 30-day figure moves slowly, so 2 each)
export const MIN_EACH = 3, MIN_EACH_ROLLING = 2;
// the fewest orders (or visits) carrying the launch's tag before "tagged" says anything at all
export const MIN_TAGGED = 5;

// which method the data on hand allows, strongest first. A lower-is-better number (cost per order) can't be read from
// tagged counts: a count of tagged orders says nothing about the cost of each, so tagged is skipped for it
export function methodFor(d, allowed = ['holdout', 'did', 'tagged', 'prepost'], { lower = false } = {}) {
  const n = (x) => vals(x).length;
  if (allowed.includes('holdout') && n(d.treated?.post) >= 2 && n(d.control?.post) >= 2) return 'holdout';
  if (allowed.includes('did') && n(d.treated?.pre) >= 2 && n(d.treated?.post) >= 2 && n(d.control?.pre) >= 2 && n(d.control?.post) >= 2) return 'did';
  if (allowed.includes('tagged') && !lower && d.tagged && Number.isFinite(+d.tagged.value)) return 'tagged';
  if (allowed.includes('prepost') && n(d.treated?.pre) >= 1 && n(d.treated?.post) >= 1) return 'prepost';
  return null;
}

// effect, relative effect, a 90% range, and how likely it is the effect points the good way
export function estimate(d, { method = methodFor(d), lower = false, boot = 1000, seed = 7 } = {}) {
  if (!method) return { method: null, ok: false, why: 'No readings yet' };
  const sign = lower ? -1 : 1;
  if (method === 'tagged') {
    if (lower) return { method, ok: false, why: 'Tagged orders can’t say what happened to a cost per order' };
    const v = +d.tagged.value, cnt = Number.isFinite(+d.tagged.count) ? +d.tagged.count : null;
    const se = cnt ? v / Math.sqrt(Math.max(1, cnt)) : Math.sqrt(Math.abs(v));
    const base = mean(d.treated?.pre) * Math.max(1, vals(d.treated?.post).length);
    /* an upper bound with no comparison: how sure we are grows with the count, never past 0.8 */
    const pGood = v > 0 && cnt != null && cnt >= MIN_TAGGED ? Math.min(0.8, 1 - 1 / Math.sqrt(cnt)) : 0.5;
    return { method, effect: v, rel: Number.isFinite(base) && base ? v / base : null, ci: [Math.max(0, v - 1.645 * se), v + 1.645 * se], pGood, ok: true, upperBound: true,
      base: Number.isFinite(mean(d.treated?.pre)) ? mean(d.treated.pre) : null, n: { tagged: cnt } };
  }
  const f = point[method], eff = f(d);
  if (!Number.isFinite(eff)) return { method, ok: false, why: 'Not enough readings for this comparison' };
  const r = rng(seed), arr = (x) => vals(x), T = { pre: arr(d.treated?.pre), post: arr(d.treated?.post) }, C = { pre: arr(d.control?.pre), post: arr(d.control?.post) };
  const draws = [];
  for (let i = 0; i < boot; i++) {
    const x = { trend: d.trend, treated: { pre: T.pre.length ? resample(T.pre, r) : [], post: resample(T.post, r) }, control: { pre: C.pre.length ? resample(C.pre, r) : [], post: C.post.length ? resample(C.post, r) : [] } };
    if (d.trend && method === 'prepost') x.treated.pre = T.pre; // keep the order the trend is fitted on
    const e = f(x); if (Number.isFinite(e)) draws.push(e);
  }
  const base = method === 'holdout' ? mean(C.post) : mean(T.pre);
  const ci = draws.length > 20 ? [quant(draws, 0.05), quant(draws, 0.95)] : [eff, eff];
  const pGood = draws.length ? draws.filter((e) => e * sign > 0).length / draws.length : 0.5;
  return { method, effect: eff, rel: Number.isFinite(base) && base ? eff / Math.abs(base) : null, ci, pGood, base: Number.isFinite(base) ? base : null, ok: true,
    n: { pre: T.pre.length, post: T.post.length, controlPre: C.pre.length, controlPost: C.post.length } };
}

// the words on the result. Inconclusive is a real answer: it never teaches "this doesn't work"
export const VERDICTS = { win: 'Win', helped: 'Helped, short of target', likely: 'Likely helped', none: 'No effect', inconclusive: 'Inconclusive', early: 'Too early to call', hurt: 'Hurt', notShipped: 'Not shipped' };
// enough readings on each side of the comparison for this method (n from estimate)
export function enoughData(est, minEach = MIN_EACH) {
  const n = est?.n || {};
  if (est?.method === 'holdout') return (n.post || 0) >= minEach && (n.controlPost || 0) >= minEach;
  if (est?.method === 'did') return (n.pre || 0) >= minEach && (n.post || 0) >= minEach && (n.controlPre || 0) >= minEach && (n.controlPost || 0) >= minEach;
  if (est?.method === 'prepost') return (n.pre || 0) >= minEach && (n.post || 0) >= minEach;
  return true;
}
export function verdictOf(est, { lower = false, target = null, minDays = 7, days = 0, guardHit = false, mde = 0.02, minEach = MIN_EACH } = {}) {
  if (guardHit) return { key: 'hurt', verdict: VERDICTS.hurt, win: false, why: 'A guardrail was crossed' };
  if (!est?.ok) return { key: 'inconclusive', verdict: VERDICTS.inconclusive, win: false, why: est?.why || 'No readings yet' };
  if (days < minDays) return { key: 'early', verdict: VERDICTS.early, win: false, why: `Only ${days} of ${minDays} days in` };
  const s = lower ? -1 : 1, g = est.effect * s, lo = Math.min(est.ci[0] * s, est.ci[1] * s), hi = Math.max(est.ci[0] * s, est.ci[1] * s);
  const reached = target != null && est.base != null && Number.isFinite(+target) ? (lower ? est.base + est.effect <= +target : est.base + est.effect >= +target) : null;
  if (est.method === 'tagged') { const cnt = est.n?.tagged;
    if (cnt == null || cnt < MIN_TAGGED) return { key: 'early', verdict: VERDICTS.early, win: false, why: `${cnt == null ? 'We can’t count the tagged orders yet' : `Only ${cnt} carried the launch’s tag`}; it takes at least ${MIN_TAGGED} to say anything` };
    return g > 0 ? { key: 'likely', verdict: VERDICTS.likely, win: true, why: `${cnt} carried the launch’s tag; without a control we can’t say how many were extra, so this is the most it could have done` } : { key: 'none', verdict: VERDICTS.none, win: false, why: 'Nothing carried the tag' }; }
  if (!enoughData(est, minEach)) return { key: 'early', verdict: VERDICTS.early, win: false, why: `Not enough readings yet: at least ${minEach} on each side of the comparison` };
  /* a range of no width is not certainty: it means the readings could not be resampled into a range at all */
  if (!(hi > lo)) return { key: 'inconclusive', verdict: VERDICTS.inconclusive, win: false, why: 'The readings don’t vary, so there is no range to call it on' };
  if (hi < 0) return { key: 'hurt', verdict: VERDICTS.hurt, win: false, why: 'The whole range points the wrong way' };
  if (lo > 0) return reached === false ? { key: 'helped', verdict: VERDICTS.helped, win: true, why: 'Clearly better, but short of the target' } : { key: 'win', verdict: VERDICTS.win, win: true, why: 'Clearly better than the comparison' };
  if (g > 0 && est.pGood >= 0.8) return { key: 'likely', verdict: VERDICTS.likely, win: true, why: `${Math.round(est.pGood * 100)}% likely it helped; the range still touches zero` };
  // narrow range around zero: it really did nothing. Wide range: we can't tell yet
  const rel = est.base ? (hi - lo) / Math.abs(est.base) : Infinity;
  if (rel <= mde * 4) return { key: 'none', verdict: VERDICTS.none, win: false, why: 'The range sits tight around zero' };
  return { key: 'inconclusive', verdict: VERDICTS.inconclusive, win: false, why: 'The range is too wide to call; more days or a control group would settle it' };
}

// the strongest grade the launch could still earn, and the one step that would lift it (the "make this measurable" nudge)
export const STEP_UP = {
  holdout: 'Keep a control group that gets nothing (10% of the list, or one region)',
  did: 'Launch on some products, pages or cities first and leave similar ones untouched',
  tagged: 'Give it its own code or tracked link',
  prepost: 'Note the start date and keep everything else steady for the window'
};

export { sum as total };
