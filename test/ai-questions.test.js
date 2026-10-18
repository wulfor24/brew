// The AI answers questions, each earned by evidence (ai-questions.js), and the AI answers card reading the set each run asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiQuestions, whyOf, Q_V } from '../ai-questions.js';
import { standFromRun } from '../ai-standing.js';

const files = {
  'profile.json': { name: 'Arata', host: 'arata.in', country: 'IN', category: 'Hair care', rivals: [{ name: 'Traya' }, { name: 'Minimalist' }],
    catalog: { hero: ['serum'], products: [{ handle: 'serum', title: 'MitoActive Hair Growth Serum', reviews: { count: 474 } }, { handle: 'shampoo', title: 'Anti Hair Fall Shampoo' }] } },
  'config.json': { questions: [{ id: 't1', q: 'does it work for crown thinning?', why: { kind: 'team', label: 'Added by Param' } }] },
  'listen/threads.json': { threads: [{ title: 'Which serum actually works for hair fall?', platform: 'reddit', url: 'https://reddit.com/r/x/1', replies: 42 }] }
};
const packs = { getJSON: async (s, f, d) => files[f] ?? d };
const fetchFn = async (url) => { const q = decodeURIComponent(new URL(url).searchParams.get('q'));
  const out = { 'best hair growth serum': ['best hair growth serum in india', 'best hair growth serum for men'], 'arata vs': ['arata vs traya'], 'is arata': ['is arata good'] }[q] || [];
  return { ok: true, text: async () => JSON.stringify([q, out]) }; };
let volCalls = 0;
const treg = { call: async (id, o) => { if (id === 'dataforseo.google.keywords.volume') { volCalls++; const v = { 'best hair growth serum in india': 74000, 'best hair growth serum': 90500, 'arata vs traya': 30 };
  return { tasks: [{ status_code: 20000, result: o.body[0].keywords.map((k) => ({ keyword: k, search_volume: v[k] || 0 })) }] }; } throw new Error('not faked'); } };
const ai = async (o) => { if (o.tag === 'ai-questions-seeds') return { json: { seeds: ['hair growth serum', 'Arata serum'] } };
  const ids = (re) => (o.prompt.match(new RegExp(`(c\\d+) \\[[^\\]]*\\] ${re}`)) || [])[1];
  return { json: { questions: [
    { q: 'best hair growth serum in India?', branded: false, refs: [ids('best hair growth serum in india')] },
    { q: 'which serum works for hair fall?', branded: false, refs: [ids('Which serum actually works for hair fall\\?')] },
    { q: 'best dog food for puppies', branded: false, refs: ['c999'] }, /* no real evidence: dropped */
    { q: 'is arata good for hair fall?', branded: false, refs: [ids('is arata good')] }, /* names the brand: branded whatever the model said */
    { q: 'Arata vs Traya, which is better?', branded: true, refs: [ids('arata vs traya')] },
    { q: 'does the MitoActive serum really work?', branded: true, refs: [ids('MitoActive Hair Growth Serum')] }] } }; };

test('questions come from real searches, suggestions, threads and best sellers; each why is built from its evidence, never the model', async () => {
  const Q = createAiQuestions({ packs, treg, ai, fetchFn, log: { warn() {} } });
  const r = await Q.source('arata-in');
  assert.equal(r.ok, true); assert.equal(volCalls, 1, 'one volume call for every phrase');
  const by = Object.fromEntries(r.questions.map((x) => [x.q, x]));
  assert.match(by['best hair growth serum in India?'].why.label, /^74,000 Google searches a month in India for “best hair growth serum in india”/);
  assert.equal(by['which serum works for hair fall?'].why.kind, 'thread'); assert.equal(by['which serum works for hair fall?'].why.url, 'https://reddit.com/r/x/1');
  assert.ok(!by['best dog food for puppies'], 'a pick with no evidence is dropped');
  assert.equal(by['is arata good for hair fall?'].branded, true, 'naming the brand makes it branded');
  assert.match(by['does the MitoActive serum really work?'].why.label, /your best seller \(474 reviews\)/);
  assert.equal(r.questions.at(-1).why.kind, 'team', 'the team’s own question is kept'); assert.deepEqual(r.rivals, ['Traya', 'Minimalist']);
  assert.equal(r.method.v, Q_V); assert.ok(!r.questions.some((x) => /arata serum/i.test(r.method.seeds.join(' '))), 'no brand name in the search seeds');
});

test('a failed source is named, never "none"; with no model the most searched suggestions stand as they are', async () => {
  const Q = createAiQuestions({ packs, treg: null, ai: null, fetchFn: async () => ({ ok: false, status: 429 }), log: { warn() {} } });
  const r = await Q.source('arata-in');
  assert.ok(r.method.errors.some((e) => /Google suggestions: google 429/.test(e)));
  assert.equal(r.ok, false, 'too little evidence: the old set stays');
  assert.equal(whyOf([{ kind: 'product', text: 'X Serum', rank: 2 }]).label, 'X Serum is one of your best sellers');
});

test('the AI answers card reads each run with the questions it asked; a run from before sourcing stands down', () => {
  const qs = [{ id: 'q1', q: 'best hair growth serum in india', branded: false, why: { kind: 'search', label: '74,000…' } }];
  const run = { at: Date.UTC(2026, 9, 19), qs, answers: [{ q: 'q1', engine: 'chatgpt', named: false, rivals: ['Traya'], brands: ['Traya', 'Minimalist'], text: 'Try Traya or Minimalist.' }] };
  const st = standFromRun(run, { questions: qs, rivals: ['Traya'], brand: 'Arata' });
  assert.equal(st.qs[0].q, 'best hair growth serum in india'); assert.equal(st.rivals[0].un, 1);
  assert.equal(standFromRun({ ...run, qs: undefined }, { questions: qs, rivals: ['Traya'], brand: 'Arata' }), null, 'an old run can’t be matched to new questions');
  assert.ok(standFromRun({ ...run, qs: undefined }, { questions: [{ id: 'q1', q: 'old guess' }], rivals: ['Traya'], brand: 'Arata' }), 'before sourcing, old runs still show');
});

test('the AI answers card compares the brand with the brands the answers name most; the read’s rivals they never name are listed', () => {
  const qs = [{ id: 'q1', q: 'best hair growth serum in india', branded: false, why: { kind: 'search', label: 'x' } }, { id: 'q2', q: 'best anti hair fall shampoo', branded: false, why: { kind: 'search', label: 'y' } }];
  const a = (q, engine, brandsNamed, named = false) => ({ q, engine, named, rivals: [], brandsNamed, text: brandsNamed.join(', ') });
  const run = { at: Date.UTC(2026, 9, 19), qs, brandsPass: { v: 1, at: '2026-10-19' }, answers: [a('q1', 'chatgpt', ['Minimalist', 'WishCare']), a('q1', 'gemini', ['Minimalist', 'Traya']), a('q2', 'chatgpt', ['Mamaearth', 'Minimalist'])] };
  const st = standFromRun(run, { questions: qs, rivals: ['Fix My Curls', 'Moxie Beauty', 'WishCare'], brand: 'Arata' });
  assert.equal(st.rivalsBy, 'named'); assert.equal(st.rivals[0].name, 'Minimalist'); assert.equal(st.rivals[0].un, 3);
  assert.deepEqual(st.knownUnnamed, ['Fix My Curls', 'Moxie Beauty'], 'WishCare is named, so it is a row, not a note');
  assert.equal(st.named, null, 'no second list under the rows');
  const old = standFromRun({ ...run, brandsPass: undefined }, { questions: qs, rivals: ['Fix My Curls', 'WishCare'], brand: 'Arata' });
  assert.equal(old.rivalsBy, 'read', 'without the brands pass the read’s rivals stand in');
  const failed = standFromRun({ ...run, brandsPass: { v: 1, at: 'x', error: 'timeout' } }, { questions: qs, rivals: ['WishCare'], brand: 'Arata' });
  assert.equal(failed.rivalsBy, 'read'); assert.ok(failed.named?.error, 'a failed pass says so, never "names nobody"');
});
