// node --test test/  — the estimators on made-up data where we know the true lift
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, verdictOf, methodFor } from '../measure-stats.js';

const noise = (seed) => { let s = seed; return () => ((s = (s * 9301 + 49297) % 233280) / 233280 - 0.5); };
const series = (n, base, { lift = 0, from = Infinity, sd = 0.05, seed = 1, shock = null } = {}) => { const r = noise(seed);
  return Array.from({ length: n }, (_, i) => base * (1 + (i >= from ? lift : 0) + (shock && i >= shock.from && i < shock.to ? shock.k : 0) + r() * sd * 2)); };

test('holdout finds a known lift and covers it', () => {
  const sale = { from: 3, to: 9, k: 0.3 }; // a sale lifts both groups: it must cancel
  const T = series(14, 100, { lift: 0.1, from: 0, seed: 2, shock: sale }), C = series(14, 100, { seed: 3, shock: sale });
  const e = estimate({ treated: { post: T }, control: { post: C } });
  assert.equal(e.method, 'holdout');
  assert.ok(e.ci[0] < 13 && e.ci[1] > 7, `range ${e.ci} should cover ~10`);
  assert.equal(verdictOf(e, { days: 14 }).key, 'win');
});

test('did cancels a brand-wide sale that before/after would credit to us', () => {
  const sale = { from: 14, to: 28, k: 0.25 };
  const T = series(28, 50, { lift: 0, from: 14, seed: 4, shock: sale }), C = series(28, 50, { seed: 5, shock: sale });
  const d = { treated: { pre: T.slice(0, 14), post: T.slice(14) }, control: { pre: C.slice(0, 14), post: C.slice(14) } };
  const did = estimate(d, { method: 'did' }), pp = estimate(d, { method: 'prepost' });
  assert.ok(Math.abs(did.effect) < 3, `did ${did.effect} should be ~0`);
  assert.ok(pp.effect > 9, `prepost ${pp.effect} wrongly sees the sale`);
  assert.notEqual(verdictOf(did, { days: 14 }).key, 'win');
});

test('lower-is-better metrics (cost per order) read the right way', () => {
  const T = series(10, 400, { lift: -0.12, from: 0, seed: 6 }), C = series(10, 400, { seed: 7 });
  const e = estimate({ treated: { post: T }, control: { post: C } }, { lower: true });
  assert.ok(e.effect < 0); assert.equal(verdictOf(e, { lower: true, days: 10 }).win, true);
  assert.equal(verdictOf(e, { lower: false, days: 10 }).key, 'hurt');
});

test('too few days is too early, never a loss', () => {
  const e = estimate({ treated: { pre: [10, 11], post: [10.5] } });
  const v = verdictOf(e, { days: 2, minDays: 7 });
  assert.equal(v.key, 'early'); assert.equal(v.win, false);
});

test('a hurt result shows up as hurt', () => {
  const T = series(14, 3, { lift: -0.3, from: 0, seed: 8 }), C = series(14, 3, { seed: 9 });
  assert.equal(verdictOf(estimate({ treated: { post: T }, control: { post: C } }), { days: 14 }).key, 'hurt');
});

test('tagged is an upper bound and picks the right method', () => {
  const d = { treated: { pre: [20, 22, 21] }, tagged: { value: 37, count: 37 } };
  assert.equal(methodFor(d), 'tagged');
  const e = estimate(d); assert.equal(e.upperBound, true); assert.equal(verdictOf(e, { days: 10 }).key, 'likely');
});

test('same data, same range (seeded)', () => {
  const d = { treated: { pre: series(14, 5, { seed: 10 }), post: series(14, 5.5, { seed: 11 }) } };
  assert.deepEqual(estimate(d).ci, estimate(d).ci);
});
