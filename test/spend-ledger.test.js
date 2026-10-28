// The spend ledger books treg charges per brand: only to a brand that exists. A tag with no brand in it ('ai-questions' read as
// brand "questions") goes to Brew's own ledger with the whole tag, never a new brand folder (28 Oct: it blocked a production release).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spendLedger, tagParts } from '../treg.js';

const memPacks = () => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), JSON.stringify(o)); } }; };

test('tags carry their brand: aiq-, rivalads-, adpage-, adpageads- read the slug after one word', () => {
  for (const w of ['aiq', 'rivalads', 'adpage', 'adpageads']) assert.deepEqual(tagParts(`${w}-thezeppelin-in`), { what: w, slug: 'thezeppelin-in' });
});

test('a real brand gets its spend; a tag naming no brand books to _brew, never a new folder', async () => {
  const packs = memPacks(), fns = []; await packs.put('thezeppelin-in', 'status.json', { slug: 'thezeppelin-in' });
  const L = spendLedger({ onCharge: (f) => fns.push(f) }, packs, { debounceMs: 60e3, log: { warn() {} } });
  const charge = (tag, usd) => fns.forEach((f) => f(tag, usd));
  charge('aiq-thezeppelin-in', 0.05); charge('ai-questions', 0.09); charge('check-adpage-ads', 0.02);
  await L.flush();
  const month = new Date().toISOString().slice(0, 7), keys = [...packs.D.keys()];
  assert.ok(!keys.some((k) => /^(questions|adpage|adpage-ads)\//.test(k)), keys.join(', '));
  assert.equal((await packs.getJSON('thezeppelin-in', `spend/${month}.json`)).usd, 0.05);
  const brew = await packs.getJSON('_brew', `spend/${month}.json`);
  assert.equal(brew.usd, 0.11); assert.deepEqual(brew.rows.map((r) => r.tag).sort(), ['ai-questions', 'check-adpage-ads']);
});
