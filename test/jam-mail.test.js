import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJamMail } from '../jam-mail.js';

const setup = (o = {}) => {
  const sent = [], files = new Map(); let t = 1e9;
  const packs = { getJSON: async (s, n, d) => (files.has(n) ? JSON.parse(files.get(n)) : d), put: async (s, n, v) => files.set(n, JSON.stringify(v)) };
  const M = createJamMail({ mail: async (to, subject, html) => (sent.push({ to, subject, html }), true), packs, sign: (x) => Buffer.from(JSON.stringify(x)).toString('base64url'), verify: (x) => JSON.parse(Buffer.from(x, 'base64url')), everyMs: 0, clock: () => t, ...o });
  return { M, sent, tick: (ms) => (t += ms), now: () => t };
};
const jam = { id: 'wk_1', title: 'Diwali reel', people: [{ email: 'a@acme.com' }, { email: 'b@acme.com' }, { email: 'c@acme.com' }], reads: {} };
const A = { email: 'a@acme.com', name: 'Asha Rao' };

test('a tag emails the tagged person right away, never the author, never twice', async () => {
  const { M, sent } = setup();
  await M.event('acme', jam, { kind: 'tagged', to: ['b@acme.com', 'a@acme.com'], by: A, text: '@Bo can you check the price?', id: 'm1' });
  await M.event('acme', jam, { kind: 'tagged', to: ['b@acme.com'], by: A, text: 'same', id: 'm1' });
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'b@acme.com'); assert.match(sent[0].subject, /Asha tagged you/); assert.match(sent[0].html, /#jam=wk_1/);
});

test('replies are batched: one email per jam per person, after they settle, at most every 15 minutes', async () => {
  const { M, sent, tick } = setup();
  await M.event('acme', jam, { kind: 'reply', to: jam.people.map((p) => p.email), by: A, text: 'first', id: 'm1' });
  await M.event('acme', jam, { kind: 'reply', to: jam.people.map((p) => p.email), by: A, text: 'second', id: 'm2' });
  assert.equal(await M.flush(), 0, 'not before a minute has passed');
  tick(61e3); assert.equal(await M.flush(), 2); assert.deepEqual(sent.map((x) => x.to).sort(), ['b@acme.com', 'c@acme.com']);
  assert.match(sent[0].html, /first/); assert.match(sent[0].html, /second/);
  await M.event('acme', jam, { kind: 'reply', to: ['b@acme.com'], by: A, text: 'third', id: 'm3' });
  tick(61e3); assert.equal(await M.flush(), 0, 'within 15 minutes of the last one');
  tick(15 * 60e3); assert.equal(await M.flush(), 1);
});

test('no email about lines already read, or while the jam is open', async () => {
  let open = true; const { M, sent, tick, now } = setup({ watching: () => open });
  await M.event('acme', jam, { kind: 'reply', to: ['b@acme.com'], by: A, text: 'x', id: 'm1' }); tick(61e3); assert.equal(await M.flush(), 0);
  open = false; const w2 = { ...jam, reads: { 'b@acme.com': now() + 1 } };
  await M.event('acme', w2, { kind: 'reply', to: ['b@acme.com'], by: A, text: 'y', id: 'm2' }); tick(61e3); assert.equal(await M.flush(), 0);
  assert.equal(sent.length, 0);
});

test('mute and only-tags are honoured', async () => {
  const { M, sent, tick } = setup();
  await M.setPref('acme', 'b@acme.com', { mute: 'wk_1' }); await M.setPref('acme', 'c@acme.com', { mail: 'tags' });
  await M.event('acme', jam, { kind: 'reply', to: ['b@acme.com', 'c@acme.com'], by: A, text: 'r', id: 'm1' }); tick(61e3); assert.equal(await M.flush(), 0);
  await M.event('acme', jam, { kind: 'assigned', to: ['b@acme.com', 'c@acme.com'], by: A, id: 'e1' });
  assert.deepEqual(sent.map((x) => x.to), ['c@acme.com'], 'a muted jam sends only tags');
  await M.event('acme', jam, { kind: 'tagged', to: ['b@acme.com'], by: A, text: 'hey', id: 'm2' }); assert.equal(sent.at(-1).to, 'b@acme.com');
});

test('the footer link mutes a jam with one tap', async () => {
  const { M } = setup(); const url = new URL(M.prefLink('acme', 'b@acme.com', 'mute', 'wk_1'));
  let html = ''; const res = { writeHead() {}, end: (s) => (html = s) };
  assert.equal(await M.handle({ method: 'GET' }, res, url), true); assert.match(html, /Muted/);
  assert.deepEqual((await M.prefsOf('acme'))['b@acme.com'].muted, ['wk_1']);
});
