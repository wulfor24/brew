// The setup answers (v1's questions) are kept per signed-in person per brand (member-tuning setSetup, feed-service /setup), so a
// new browser, a private window or a phone never asks them again; signed out, nothing is kept on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTuning, cleanTuning } from '../member-tuning.js';

const fakePacks = () => { const files = new Map(); return { getJSON: async (s, f, d) => files.get(`${s}/${f}`) ?? d, put: async (s, f, v) => { files.set(`${s}/${f}`, JSON.parse(JSON.stringify(v))); } }; };

test('setSetup merges what was answered, per person, and a client put never overwrites it', async () => {
  const T = createTuning({ packs: fakePacks(), now: () => 1, log: { warn() {} } });
  await T.setSetup('b', 'm_a', { role: 'growth', wants: ['decision', 'report', 'idea'], done: true });
  await T.setSetup('b', 'm_a', { channels: ['instagram', 'email'] });
  const a = await T.get('b', 'm_a'); assert.deepEqual({ ...a.setup, at: 0 }, { role: 'growth', wants: ['decision', 'report'], channels: ['instagram', 'email'], done: true, at: 0 });
  assert.equal((await T.get('b', 'm_b')).setup, null, 'another person has their own');
  await T.put('b', 'm_a', { setup: { done: false }, topics: ['serum'] }); assert.equal((await T.get('b', 'm_a')).setup.done, true, 'only setSetup sets it');
  assert.equal(cleanTuning({ setup: { done: true } }).setup, null);
});

test('the page asks the server first and keeps the answers when the questions end', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), fsv = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.match(app, /const sv = \(await tapi\('GET', '\/api\/tenants\/:t\/setup'\)/);
  assert.match(app, /onDone: \(r\) => \{ qClose\(\); keepSetup\(\); qGo\(r \|\| \{\}\); \}/);
  assert.match(fsv, /const setupKey = \(t\) => \{ const r = MC\.REQ\.getStore\(\), e = r && r\.slug === \(t\.brandId \|\| DEFAULT_BRAND\) \? r\.me : null; return e \? memberKey\(e\) : null; \};/, 'keyed by whoever is signed in, never a workspace');
  assert.match(fsv, /me: viewer\?\.email \|\| null/);
});
