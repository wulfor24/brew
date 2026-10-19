// The AI answers ring comes from ONE check: its score, the rows under it and the rival panel count the same answers, and its
// source names only the AI tools that answered (Param, 19 Oct: Arata showed 21/100 over rows adding to 15, a "0 of 10" row over
// a "1 of 15" panel, and "ChatGPT, Gemini, Perplexity, Claude" under answers from 3 tools).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthFrom, aiRingFromRun } from '../health.js';

const ring = (h) => h.rings.find((r) => r.k === 'AI answers');
const sum = (r) => r.parts.reduce((a, x) => a + x.v, 0);

test('the read: a tool that failed is no answer, in the score, the panel and the source line', () => {
  const ans = [];
  for (const [q, branded] of [['best serum for hair fall', false], ['serum for receding hairline', false], ['is Acme serum good', true]]) {
    ans.push({ q, branded, tool: 'chatgpt', named: branded, at: '2026-10-18', brandsNamed: ['Beta'] });
    ans.push({ q, branded, tool: 'perplexity', named: false, at: '2026-10-18', brandsNamed: ['Beta'] });
    ans.push({ q, branded, tool: 'gemini', error: 'treg 500' });
  }
  const p = { name: 'Acme', rivals: [{ name: 'Beta' }], ai: { answers: ans, score: { named: 1, of: 6, unbrandedNamed: 0, unbrandedOf: 4 } } };
  const r = ring(healthFrom(p));
  assert.equal(r.v, sum(r), 'the score is the rows added up');
  assert.equal(r.src, 'ChatGPT, Perplexity', 'Gemini failed and Claude wasn’t asked: neither is listed');
  assert.equal(r.stand.of, 6, 'the panel counts the 6 answers, not the 3 failures');
  assert.equal(r.stand.unOf, 4); assert.equal(r.stand.tools, 2);
  assert.equal(r.parts[0].note, `${r.stand.brand.un} of ${r.stand.unOf} answers`, 'the row and the panel say the same count');
  assert.equal(r.from, 'read'); assert.equal(r.at, '2026-10-18');
});

test('the weekly run: ring, rows, finding and panel are all that run', () => {
  const qs = [{ id: 'q1', q: 'best hair growth serum', branded: false }, { id: 'q2', q: 'which grey hair serum works', branded: false }, { id: 'q3', q: 'is Acme serum good', branded: true }];
  const answers = qs.flatMap((q) => ['chatgpt', 'gemini', 'perplexity'].map((engine) => ({ q: q.id, engine, named: q.branded || (q.id === 'q2' && engine === 'gemini'), brandsNamed: ['Beta'], rivals: [] })));
  const run = { at: Date.parse('2026-10-18T21:24:53Z'), answers, qs, named: 4, total: 9 };
  const r = aiRingFromRun(run, { questions: qs, rivals: ['Beta'], brand: 'Acme' });
  assert.equal(r.from, 'weekly'); assert.equal(r.at, '2026-10-18T21:24:53.000Z');
  assert.equal(r.src, 'ChatGPT, Gemini, Perplexity');
  assert.deepEqual(r.parts.map((x) => x.note), ['1 of 6 answers', '3 of 3 answers']);
  assert.equal(r.v, sum(r)); assert.equal(r.v, Math.round(85 / 6) + 15);
  assert.equal(r.stand.brand.un, 1); assert.equal(r.stand.unOf, 6, 'the panel counts what the row counts');
  assert.match(r.fixT, /1 of 6 answers where the shopper didn’t ask for it by name/, 'the headline is this run’s finding');
  assert.equal(aiRingFromRun(null, {}), null);
});
