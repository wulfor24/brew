import test from 'node:test';
import assert from 'node:assert/strict';
import { noteOk, withNotes } from '../notes.js';

const card = { id: 'a', src: 'Move 21 · static ads', title: '12 ads this week', sub: 'Aim for 40 by day 30.', rows: [['Gemini', '4 of 7']] };

test('a note may only quote numbers on its card', () => {
  assert.equal(noteOk({ k: 'move 21', h: 'twelve this week. forty by day 30.' }, card), true);
  assert.equal(noteOk({ k: 'gemini', h: '4 of 7. fix it.' }, card), true);
  assert.equal(noteOk({ k: 'move 21', h: 'fifty by friday.' }, card), false);
  assert.equal(noteOk({ k: 'move 21', h: 'up 18% already.' }, card), false);
  assert.equal(noteOk({ k: 'x', h: 'one thing — only.' }, card), false);
});

test('notes land only on cards without one', () => {
  const out = withNotes([{ id: 'a' }, { id: 'b', note: { k: 'k', h: 'mine.' } }], { a: { k: 'move 21', h: 'go.' }, b: { k: 'x', h: 'no.' } });
  assert.deepEqual(out[0].note, { k: 'move 21', h: 'go.' });
  assert.equal(out[1].note.h, 'mine.');
});

import { createNotes, MIN_NOTES } from '../notes.js';
const memPacks = (files) => ({ getJSON: async (s, n, d) => (files[n] ?? d), put: async (s, n, v) => { files[n] = v; } });
const posts = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `Card ${i}`, sub: `${i + 2} of 9 done.` }));

test('a brand with too few notes gets one more pass over its cards without one, once', async () => {
  const files = { 'notes.json': { notes: { c0: { k: 'move 01', h: 'go.' } }, seen: posts(30).map((p) => p.id) } };
  const asked = [];
  const ai = { call: async ({ prompt }) => { const list = JSON.parse(prompt.slice(prompt.indexOf('['))); asked.push(list.length); return { json: { notes: list.slice(0, 15).map((p) => ({ id: p.id, k: 'move 01', h: 'go now.' })) }, usd: 0 }; } };
  const N = createNotes({ ai, packs: memPacks(files), log: { log() {}, warn() {} } });
  const pack = { slug: 'x', kind: 'generated', seed: { brand: { name: 'X' }, posts: posts(30) } };
  await N.fill(pack);
  assert.equal(asked.length, 1); assert.equal(asked[0], 29); // every card without a note, the one with a note skipped
  assert.ok(Object.keys(files['notes.json'].notes).length >= Math.min(MIN_NOTES, 10));
  assert.ok(files['notes.json'].toppedAt);
  await N.fill(pack); assert.equal(asked.length, 1); // never again
});

test('a brand with enough notes is left alone', async () => {
  const notes = Object.fromEntries(posts(12).map((p) => [p.id, { k: 'k', h: 'go.' }]));
  const files = { 'notes.json': { notes, seen: posts(30).map((p) => p.id) } }; let calls = 0;
  const N = createNotes({ ai: { call: async () => { calls++; return { json: { notes: [] } }; } }, packs: memPacks(files), log: { log() {}, warn() {} } });
  await N.fill({ slug: 'x', kind: 'generated', seed: { brand: { name: 'X' }, posts: posts(30) } });
  assert.equal(calls, 0);
});
