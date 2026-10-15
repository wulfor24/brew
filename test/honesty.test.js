// The showcase never presents simulated or invented content as real (handover P0, 2026-10-15):
// no canned sign-offs, simulated teammates change nothing and leak nowhere, simulated account numbers are never evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { simulated, realRows } from '../connectors/common.js';
import { createHandoff } from '../handoff.js';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('no canned sign-offs: nothing claims a check, approval or consent that nobody gave', () => {
  const s = src('remix.js') + src('feed-service.js');
  for (const re of [/Verified this morning/, /Cleared\. Every claim/, /used with consent/, /Approving ✅/, /approved v\$\{w\.current\}\. Ready to ship/, /const ANSWERS = \{/])
    assert.doesNotMatch(s, re, `found ${re}`);
  assert.doesNotMatch(src('public/jam-room.js'), /Posted to \$\{/, 'no toast says something was posted');
});

test('a simulated teammate reply changes no stage and is tagged', () => {
  const s = src('feed-service.js'); const i = s.indexOf('const colleagueReply'); const body = s.slice(i, s.indexOf('const answerOnly', i));
  assert.match(body, /say\(t, w, \{ from: 'colleague', who, body: r\.reply, dummy: true \}\)/);
  assert.doesNotMatch(body, /move\(t, w, '(ready|needs_you)'/);
});

test('simulated account rows: flagged ones and old unflagged connector rows never count; real rows do', () => {
  const sim = { key: 'shopify.revenue.30d', v: '₹1 Cr', method: 'connected account', demo: true };
  const old = { key: 'meta.roas', v: '3.1x', method: 'connected account' }; // saved before the flag was kept
  const real = { key: 'meta.ads.live', v: '42', method: 'account:meta' };
  assert.ok(simulated(sim) && simulated(old) && !simulated(real));
  assert.deepEqual(realRows([sim, old, real]), [real]);
  assert.deepEqual(realRows({ a: sim, b: real }), [real]);
});

test('the shared brief leaves out simulated chat and simulated answers', async () => {
  const HO = createHandoff({ RMX: null, pageOf: async () => null, fillCard: (c) => c, SEED: { brand: { name: 'Acme' } } });
  const w = { id: 'wk_1', cardId: 'c1', title: 'A card', agent: 'creative', stage: 'drafting', versions: [], current: 1,
    thread: [{ id: 'm1', from: 'me', body: 'Can we ship Friday?' }, { id: 'm2', from: 'colleague', who: 'Brand manager', body: 'Approved.', dummy: true },
      { id: 'm3', from: 'brew', who: 'Deploy lead', body: 'The ShopOS team has it.' }, { id: 'm4', from: 'ai', body: 'Suggested: Friday works.' }],
    plan: { questions: [{ q: 'Are the claims cleared?', answer: 'Cleared.', by: 'teammate:Brand manager' }, { q: 'Sizes?', answer: 'Suggested: 1:1 and 4:5.', by: 'ai:creative' }, { q: 'Owner?', answer: 'Me', by: 'you' }] } };
  const t = { id: 't_1', cards: new Map(), viewer: {} };
  const x = await HO.build(t, w);
  assert.deepEqual(x.jam.map((m) => m.text), ['Can we ship Friday?', 'Suggested: Friday works.']);
  assert.deepEqual(x.questions.map((q) => q.a), [null, 'Suggested: 1:1 and 4:5.', 'Me']);
});

test('the festival is always the next one: it rolls to next year once the day has passed', async () => {
  const { nextFestival } = await import('../calendar.js');
  assert.equal(nextFestival('IN', new Date('2026-10-15')).date.slice(0, 10), '2026-11-08');
  assert.equal(nextFestival('IN', new Date('2026-11-09')).date.slice(0, 10), '2027-10-29');
  const us = nextFestival('US', new Date('2026-11-28')); assert.equal(us.name, 'Black Friday'); assert.equal(us.date.slice(0, 10), '2027-11-26');
  assert.match(us.label, /2027$/, 'a date next year says the year');
});
