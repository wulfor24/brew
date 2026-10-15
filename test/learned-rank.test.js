import test from 'node:test';
import assert from 'node:assert/strict';
import { learnedTerms, cardUsesLearned, learnedMoveNs } from '../brand-learnings.js';

const L = { goals: [{ text: 'They will configure PMax to bid for new customers only, with retargeting split out separately.' }], beliefs: [], facts: [{ text: 'MitoActive has near-zero traction in Chennai and Tamil Nadu, where Curls outperforms it.' }] };
const corpus = Array.from({ length: 20 }, (_, i) => `MitoActive serum card ${i} customers`);

test('a card that shares telling words with a learning uses it; common brand words do not count', () => {
  const T = learnedTerms(L, corpus);
  assert.ok(cardUsesLearned('Set PMax to bid on new customers, retargeting split out', T));
  assert.ok(cardUsesLearned('Tamil copy for Chennai, where Curls already sells', T));
  assert.ok(!cardUsesLearned('MitoActive serum for new customers', T));
  assert.ok(cardUsesLearned('As the team said on the call, slow down', T));
  assert.ok(!cardUsesLearned('As the team said on the call, slow down', []), 'no learnings: "the team said" in AI text lifts nothing');
});

test('moves that quote the team are marked only when the brand has learnings', () => {
  const moves = { 0: { title: 'Index' }, 3: { title: 'Ads', sections: [{ blocks: ['Team-reported 2.2% conversion'] }] }, 4: { title: 'Pages' } };
  assert.deepEqual([...learnedMoveNs(moves, L)], [3]);
  assert.equal(learnedMoveNs(moves, null).size, 0);
});
