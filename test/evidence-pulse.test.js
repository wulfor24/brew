// The proof sheet finds a rival's search numbers in the market pulse (pulse/latest.json → pack.pulseEv), for every brand
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidence } from '../evidence.js';
import { refine } from '../proof-logic.js';
import { withLearned } from '../brand-learnings.js';

const P = [
  { key: 'search.gap.moxiebeauty-in', label: 'Google searches Moxie Beauty ranks for and Arata does not', v: '3749 keywords', src: 'Google rankings', url: null, at: '2026-10-16T16:09:52.296Z', subject: 'moxiebeauty.in', own: false },
  { key: 'search.organic.clicks.arata-in', label: 'Arata: estimated monthly clicks from Google (unpaid)', v: '1520 clicks/mo', src: 'Search traffic estimates', url: null, at: '2026-10-16', subject: 'arata.in', own: true }];

test('a rival search number on a card is matched to the pulse line it came from, as web proof with its source', () => {
  const E = createEvidence({ factsOf: () => ({}), movesOf: () => ({}), numsOf: () => [], pulseOf: () => P });
  const c = { id: 'm1-2', title: 'Target Moxie Beauty’s curly hair audience', sub: 'Moxie Beauty ranks for 3,749 organic searches Arata is missing.' };
  const e = E.evidenceOf(c), x = e.items.find((i) => i.num === '3749');
  assert.ok(x, 'matched'); assert.equal(x.kind, 'web'); assert.match(x.src, /Google rankings · moxiebeauty\.in/); assert.equal(x.at, '2026-10-16');
  assert.deepEqual(e.unbacked, []);
  assert.ok(refine(c, e, {}).items.some((i) => i.num === '3749'), 'the proof filter keeps it');
  const own = E.evidenceOf({ id: 'm2-1', title: 'Arata search clicks', sub: 'Arata gets 1,520 clicks a month from Google.' }).items.find((i) => i.num === '1520');
  assert.equal(own?.kind, 'fact', 'the brand’s own pulse line is its own fact');
});

test('a pulse number never backs a card it shares no words with, and no pulse is fine', () => {
  const E = createEvidence({ factsOf: () => ({}), movesOf: () => ({}), numsOf: () => [], pulseOf: () => P });
  assert.equal(E.evidenceOf({ id: 'x', title: 'Gift sets', sub: 'Sell 37 gift sets this week.' }).items.some((i) => /pulse|rankings/.test(i.src || '')), false);
  const T = [{ key: 'trends.curly', label: 'Google interest in "curly hair products", last 4 weeks vs the 4 before', v: '100', src: 'Google Trends', subject: null }];
  const E2 = createEvidence({ factsOf: () => ({}), movesOf: () => ({}), numsOf: () => [], pulseOf: () => T });
  assert.equal(E2.evidenceOf({ id: 'z', title: 'Curly hair gel 100 ml', sub: 'Our curly hair gel, 100 ml, for wash days.' }).items.some((i) => i.num === '100'), false, 'a plain count needs its move to have used the line');
  const N = createEvidence({ factsOf: () => ({}), movesOf: () => ({}), numsOf: () => [] });
  assert.ok(N.evidenceOf({ id: 'y', title: 'Moxie Beauty', sub: '3,749 searches' }));
});

test('every belief (the team’s guardrails) reaches the moves’ brief, not the first six', () => {
  const beliefs = Array.from({ length: 14 }, (_, i) => ({ text: `Rule number ${i + 1} on claims.`, source: 'Upload' }));
  const md = withLearned('# Brief', { beliefs, goals: [], essence: [], facts: [], tried: [] }, { name: 'Glow' });
  assert.match(md, /Rule number 14 on claims/);
});
