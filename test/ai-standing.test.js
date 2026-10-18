import test from 'node:test';
import assert from 'node:assert/strict';
import { standFromRead, standFromRun } from '../ai-standing.js';

const ans = (tool, q, branded, named, text, rivalsNamed = []) => ({ tool, q, branded, named, text, rivalsNamed, at: '2026-10-14' });
const profile = { name: 'Acme', rivals: [{ name: 'Rival One' }, { name: 'Beta Co' }, { name: 'Gamma' }], ai: { answers: [
  ans('chatgpt', 'best serum for hair fall', false, false, 'Try Rival One or Beta Co.'),
  ans('gemini', 'best serum for hair fall', false, false, 'Rival One is popular.'),
  ans('chatgpt', 'shampoo for itchy scalp', false, false, 'Nothing branded here.'),
  ans('chatgpt', 'is Acme good?', true, true, 'Acme is fine, as is Rival One.', ['Rival One'])
] } };

test('standings: each rival counted where the shopper named no brand, with the questions it was named for', () => {
  const s = standFromRead(profile);
  assert.equal(s.of, 4); assert.equal(s.unOf, 3); assert.equal(s.questions, 3); assert.equal(s.tools, 2);
  assert.deepEqual(s.brand, { name: 'Acme', n: 1, un: 0 });
  const r1 = s.rivals.find((r) => r.name === 'Rival One');
  assert.equal(r1.n, 3); assert.equal(r1.un, 2);
  assert.equal(r1.qs[0].q, 'best serum for hair fall'); assert.equal(r1.qs[0].k, 2); assert.equal(r1.qs[0].branded, false);
  assert.equal(s.rivals[0].name, 'Rival One'); // most named first
  assert.equal(s.rivals.find((r) => r.name === 'Gamma').n, 0); // read and truly not named
});

test('standings: an unread answer set is an error, never zeros; a failed rival search says so, never "no rivals"', () => {
  assert.equal(standFromRead({ name: 'Acme' }), null);
  assert.match(standFromRead({ name: 'Acme', meta: { errors: { answers: 'timeout' } } }).error, /couldn’t be read/);
  const s = standFromRead({ ...profile, rivals: [], meta: { errors: { rivals: 'search failed' } } });
  assert.equal(s.rivals.length, 0); assert.match(s.rivalsError, /couldn’t be read/);
  assert.equal(standFromRead({ ...profile, rivals: [] }).rivalsError, null);
});

test('standings from the weekly check: question ids become their text, a question with the brand in it counts as branded', () => {
  const run = { at: Date.parse('2026-10-15'), answers: [
    { q: 'q1', engine: 'chatgpt', named: false, rivals: ['Beta Co'], excerpt: '' },
    { q: 'q2', engine: 'chatgpt', named: true, rivals: [], excerpt: 'Acme is good' }] };
  const s = standFromRun(run, { questions: [{ id: 'q1', q: 'best serum?' }, { id: 'q2', q: 'is Acme good?' }], rivals: ['Beta Co'], brand: 'Acme' });
  assert.equal(s.src, 'weekly'); assert.equal(s.at, '2026-10-15'); assert.equal(s.unOf, 1);
  assert.equal(s.rivals[0].un, 1); assert.equal(s.rivals[0].qs[0].q, 'best serum?');
  assert.equal(standFromRun(null, {}), null);
});

test('who the answers name: with the brands pass the rows are the brands named most; without it the rivals stand in; a failed pass is an error', () => {
  const withNamed = (pass, brands) => ({ ...profile, ai: { named: pass, answers: profile.ai.answers.map((a, i) => ({ ...a, brandsNamed: brands[i] })) } });
  const s = standFromRead(withNamed({ v: 1, at: '2026-10-19' }, [['Rival One', 'Beta Co', 'WishCare'], ['Rival One', 'wishcare', 'Himalaya Herbals Anti-Dandruff', 'Himalaya'], [], ['Acme', 'Rival One', 'Bare Anatomy']]));
  /* with the brands pass read, the rows are who the answers name most (19 Oct): no second list under them */
  assert.equal(s.rivalsBy, 'named'); assert.equal(s.named, null);
  assert.ok(['Rival One', 'WishCare'].every((n) => s.rivals.some((r) => r.name === n)), s.rivals.map((r) => r.name).join());
  assert.equal(s.rivals.find((r) => r.name === 'WishCare').un, 2);
  assert.equal(standFromRead(profile).named, null); // pass not run yet: nothing shown, never "none"
  assert.match(standFromRead(withNamed({ v: 1, at: '2026-10-19', error: 'timeout' }, [])).named.error, /couldn’t be read/);
  assert.deepEqual(standFromRead(withNamed({ v: 1, at: '2026-10-19' }, [[], [], [], []])).named.list, []); // read, and truly no other brand
});
