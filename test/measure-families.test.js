// every card we have, and every move, must land in a measure family (or Other): the family gives each move's "how we
// measure" table and the brief's "how we'll know". Run whenever moves change
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFamilies } from '../measure-families.js';

const F = createFamilies({});
const ROOTS = [process.env.BRANDS_DIR, '.brands', '../feed/.brands'].filter(Boolean).filter((d) => fs.existsSync(d));
const cards = [];
for (const root of ROOTS.slice(0, 1)) for (const slug of fs.readdirSync(root)) {
  for (const f of ['seed.json', 'pools.json']) { const p = path.join(root, slug, f); if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8')); const xs = f === 'seed.json' ? j.posts || [] : Object.values(j).flat();
    xs.filter((c) => c && c.title).forEach((c) => cards.push({ slug, ...c })); }
}
test('every card lands in a family', (t) => {
  if (!cards.length) return t.skip('no local packs (.brands/ or BRANDS_DIR): a clean checkout has none, so deploy.sh must not fail on it'); /* a saved-data check, not a code check */
  assert.ok(cards.length > 10, `only ${cards.length} cards found`);
  const spread = {}; const other = [];
  for (const c of cards) { const m = F.classify(c); assert.ok(F.byId(m.family)); spread[m.family] = (spread[m.family] || 0) + 1; if (m.family === 'other') other.push(c.title); }
  console.log(`${cards.length} cards:`, JSON.stringify(spread)); if (other.length) console.log('Other:', other.slice(0, 15));
});

test('every move lands in its family by number', () => {
  const dir = 'sources/moves'; const names = fs.readdirSync(dir).filter((x) => /^\d\d /.test(x));
  const miss = names.filter((n) => !F.all().some((f) => (f.moves || []).includes(+n.slice(0, 2))));
  assert.deepEqual(miss, [], 'moves with no family');
});

test('recipes are complete', () => { for (const f of F.all()) { const r = F.recipeOf(f.id); assert.ok(r.metric.name && r.goalName && r.ceiling); } });

/* ---------- timing: when each family is checked and decided ---------- */
import { TIMINGS, timingOf, timingLine } from '../measure-families.js';

const T = (id) => F.recipeOf(id).timing;
test('every family has a check schedule, a decide day and derived window/minDays', () => {
  for (const f of F.all()) { const r = F.recipeOf(f.id), t = r.timing;
    assert.ok(t.checks.length && t.checks.every((d, i, a) => d > 0 && (!i || d > a[i - 1])), `${f.id} checks sorted`);
    assert.ok(t.decideDay > 0 && r.window === t.decideDay && r.minDays <= r.window, `${f.id} window/minDays derived`);
    assert.ok(Array.isArray(t.earlyStops) && /^Checks /.test(r.timingLine), `${f.id} early stops and line`); }
});
test('timings follow the brief', () => {
  assert.deepEqual([T('paid_ads').checks, T('paid_ads').decideDay], [[1, 3, 7], 14]);
  assert.deepEqual(T('paid_ads').earlyStops.map((s) => [s.key, s.at]), [['spend_no_conv', 3]]);
  assert.deepEqual([T('messages').checks, T('messages').decideDay, T('messages').earlyStops[0].at], [[1, 3], 7, 1]);
  assert.deepEqual([T('content').checks, T('content').decideDay], [[1, 3], 7]);
  assert.deepEqual([T('community').checks, T('community').decideDay], [[1, 3, 7], 14]);
  assert.ok(T('community').earlyStops.some((s) => s.action === 'write_moves'));
  assert.deepEqual([T('creators').checks, T('creators').decideDay], [[3, 14], 30]);
  assert.ok(T('site').weekly && T('site').untilSample && T('site').wholeWeeks && T('site').minDays === 14 && T('site').earlyStops[0].action === 'revert');
  assert.deepEqual([T('pricing').checks, T('pricing').decideDay, T('pricing').afterEnd], [[7], 14, 7]);
  assert.deepEqual([T('search').checks, T('search').decideDay], [[14, 28, 56], 90]);
  assert.ok(T('ai_search').weekly && T('ai_search').decideDay === 56 && T('ai_search').maxDay === 84 && T('ai_search').checks.at(-1) === 84);
  assert.deepEqual([T('complaint_fix').checks, T('complaint_fix').decideDay], [[30], 60]);
  assert.ok(T('seasonal').daily && T('seasonal').afterEvent === 7 && /last year/.test(T('seasonal').compare));
  assert.ok(T('automation').weekly && T('automation').rolling === 28);
  assert.match(timingLine('paid_ads'), /day 1, 3 and 7; decides on day 14/);
  assert.equal(timingOf('nope').id, 'default');
  assert.ok(Object.keys(TIMINGS).length >= 15);
});
test('every move spec names a known family for its timing, matching its move number', async () => {
  const specs = JSON.parse(fs.readFileSync('data/move-specs.json', 'utf8'));
  for (const s of specs) { assert.ok(s.timing && F.byId(s.timing).id === s.timing, `move ${s.n} timing ${s.timing}`);
    const home = F.all().find((f) => (f.moves || []).includes(s.n)); if (home && s.n <= 50) assert.equal(s.timing, home.id, `move ${s.n}`); }
});
