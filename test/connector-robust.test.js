// Connected accounts (2026-10-16 audit): Meta sign-ins run out in about 60 days, so Brew tracks the end, renews where Meta
// allows and warns the brand's admins a week ahead (in the app and by email); an account that keeps failing, or whose last
// good read is too old, keeps its numbers on the fact sheet marked stale and stops being evidence; a rate limit backs off
// with Retry-After and jitter instead of a flat 3-hour wait. Free: fetch is stubbed, nothing leaves the machine.
process.env.BUILD_RESUME_OFF = '1'; process.env.DEMO_MODE = '';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backoff, retryAfterMs, getJSON, evidenceRows, realRows } from '../connectors/common.js';
import { due, failure, daysLeft, STALE_FAILS, createConnectors } from '../connectors/index.js';
import { freshMeta } from '../connectors/meta.js';
import { connectedFacts } from '../facts-desk.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const DAY = 864e5, H = 3600e3, NOW = Date.parse('2026-10-16T10:00:00Z');
const res = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });

test('backoff: Retry-After when the platform sends one, else doubling with jitter, capped; never the flat 3 hours', () => {
  const mid = () => 0.5;
  assert.equal(backoff(1, { base: 15 * 60e3, rnd: mid }), 15 * 60e3);
  assert.equal(backoff(3, { base: 15 * 60e3, rnd: mid }), 60 * 60e3);
  assert.equal(backoff(20, { base: 15 * 60e3, cap: 12 * H, rnd: mid }), 12 * H, 'capped');
  const lo = backoff(2, { rnd: () => 0 }), hi = backoff(2, { rnd: () => 0.999 }); assert.ok(lo < hi && lo >= 0.8 * 30 * 60e3 && hi <= 1.2 * 30 * 60e3, 'jitter ±20%');
  assert.equal(backoff(1, { retryAfter: 120e3, rnd: () => 0 }), 120e3, 'Retry-After wins');
  assert.equal(retryAfterMs('120'), 120e3); assert.equal(retryAfterMs(new Date(NOW + 60e3).toUTCString(), NOW), 60e3); assert.equal(retryAfterMs(null), null);
  /* the tick waits until retryAt; a record from before keeps its old wait */
  const s = { lastSync: NOW - 7 * H, error: 'x', errorAt: NOW - 10 * 60e3, retryAt: NOW + 20 * 60e3 };
  assert.equal(due('meta', s, NOW), false); assert.equal(due('meta', s, NOW + 21 * 60e3), true, 'not three hours');
  assert.equal(due('meta', { lastSync: NOW - 7 * H, error: 'x', errorAt: NOW - H }, NOW), false, 'old records: the old 3-hour wait');
});

test('a 429 waits and tries again inside the read when the wait is short; a long one goes back to the tick with its Retry-After', async () => {
  let n = 0; const waited = [];
  const j = await getJSON('https://x.test/a', { fetchImpl: async () => (++n < 2 ? res(429, { error: { message: 'slow down' } }, { 'retry-after': '2' }) : res(200, { ok: 1 })), wait: async (ms) => waited.push(ms) });
  assert.deepEqual(j, { ok: 1 }); assert.deepEqual(waited, [2000]);
  await assert.rejects(getJSON('https://x.test/a', { fetchImpl: async () => res(429, { error: { message: 'slow down' } }, { 'retry-after': '600' }), wait: async () => assert.fail('no wait this long') }),
    (e) => e.status === 429 && e.rateLimited && e.retryAfter === 600e3);
  await assert.rejects(getJSON('https://x.test/a', { fetchImpl: async () => res(400, { error: { message: 'User request limit reached', code: 17 } }) }), (e) => e.rateLimited && e.code === 17, 'Meta’s own rate-limit codes');
  await assert.rejects(getJSON('https://x.test/a', { fetchImpl: async () => res(400, { error: { message: 'Error validating access token', code: 190 } }) }), (e) => e.code === 190 && !e.rateLimited);
});

test('stale: after repeated failures or a too-old last read, never on the first failure; an expired sign-in at once', () => {
  const s0 = { lastSync: NOW - 2 * H };
  let s = { ...s0 };
  for (let i = 1; i < STALE_FAILS; i++) { s = { ...s, ...failure(s, { message: 'x' }, NOW) }; assert.equal(s.stale, false, `failure ${i}`); }
  s = { ...s, ...failure(s, { message: 'x' }, NOW) }; assert.equal(s.stale, true); assert.match(s.staleWhy, /3 reads in a row failed/);
  const old = failure({ lastSync: NOW - 80 * H }, { message: 'x' }, NOW); assert.equal(old.stale, true); assert.match(old.staleWhy, /no good read for 80 hours/);
  const ex = failure(s0, { expired: true }, NOW); assert.equal(ex.stale, true); assert.equal(ex.needsReconnect, true); assert.equal(ex.retryAt - NOW, 12 * H);
  const rl = failure(s0, { rateLimited: true, retryAfter: 900e3 }, NOW, () => 0); assert.equal(rl.retryAt - NOW, 900e3); assert.equal(rl.rateLimited, true);
  assert.equal(failure({}, { message: 'x' }, NOW).stale, false, 'an account that never read has nothing to go stale');
  assert.equal(daysLeft({ expiresAt: NOW + 5.5 * DAY }, NOW), 5); assert.equal(daysLeft({}, NOW), null);
});

test('a stale account’s numbers stay on the fact sheet, marked, but no longer beat the site or count as evidence', () => {
  const rows = [{ key: 'meta.ads.live', label: 'Live ads', v: '12', n: 12, src: 'act_1', at: '2026-10-12', method: 'account:meta', stale: true, staleWhy: '3 reads in a row failed' }, { key: 'klaviyo.list.size', label: 'List', v: '900', n: 900, at: '2026-10-16', method: 'account:klaviyo' }];
  const F = connectedFacts(rows, { ads_own_live: { key: 'ads.own.live', label: 'Live ads', v: '664' } });
  const meta = Object.values(F).find((f) => f.key === 'meta.ads.live');
  assert.equal(meta.stale, true); assert.ok(!meta.was, 'it doesn’t replace the site’s number'); assert.ok(!F.ads_own_live, 'the site’s fact is the truth again');
  assert.deepEqual(evidenceRows(rows).map((e) => e.key), ['klaviyo.list.size']); assert.equal(realRows(rows).length, 2);
  const fd = fs.readFileSync(new URL('../facts-desk.js', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(fd, /memberFacts\(slug\) \{[^\n]*!f\.stale/, 'cards never quote it'); assert.match(app, /stale\$\{r\.staleWhy[^\n]*not used until it reads again/, 'the sheet says so');
});

/* ---------- the connectors module with a stubbed Graph ---------- */
const memPacks = () => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d = null) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), typeof o === 'string' ? o : JSON.stringify(o)); }, list: async () => [{ slug: 'acme-in', status: { name: 'Acme' } }] }; };
const setup = async (conn = {}) => {
  const P = memPacks(), stale = [], mails = [];
  await P.put('acme-in', 'profile.json', { name: 'Acme', host: 'acme.in' });
  await P.put('acme-in', 'private/connections.json', { meta: { state: 'live', lastSync: Date.now() - 7 * H, account: { name: 'Acme ads' }, verified: true, ...conn } });
  await P.put('acme-in', 'private/live/meta.json', { at: Date.now() - 7 * H, ledger: [{ key: 'meta.ads.live', label: 'Live ads', v: '12', n: 12, method: 'account:meta' }], cards: [] });
  const auth = { getMembers: async () => ({ members: [{ email: 'owner@acme.in', role: 'owner' }, { email: 'admin@acme.in', role: 'admin' }, { email: 'm@acme.in', role: 'member' }] }), mail: async (to, subject) => { mails.push({ to, subject }); return true; } };
  const builder = { staleConnected: async (slug, id, why) => { stale.push({ slug, id, why }); }, liveConnected: async () => {} };
  const C = createConnectors({ packs: P, auth, builder, log: quiet });
  const { createVault } = await import('../vault.js'); await createVault(P).save('acme-in', 'meta', { token: 'tok', account: '1', exp: conn.exp || null, expChecked: 1 });
  return { P, C, stale, mails, conns: async () => (await P.getJSON('acme-in', 'private/connections.json')).meta };
};

test('an expired Meta sign-in: the last read stays, marked stale, the team is told to connect again, and nothing quotes it', async () => {
  const { C, stale, conns } = await setup(), f0 = globalThis.fetch;
  globalThis.fetch = async () => res(400, { error: { message: 'Error validating access token: Session has expired', code: 190 } });
  try { const r = await C.sync('acme-in', 'meta'); assert.equal(r.ok, false); } finally { globalThis.fetch = f0; }
  const s = await conns();
  assert.equal(s.state, 'live', 'the last read stays'); assert.equal(s.stale, true); assert.equal(s.needsReconnect, true); assert.match(s.error, /sign-in expired: connect it again/);
  assert.deepEqual(stale.map((x) => x.id), ['meta'], 'its rows stop being evidence');
  assert.deepEqual((await C.forViewer('acme-in', true)).ledger, {}, 'a stale account is never quoted in the feed, the jam or Ask Brew');
});

test('rate limits: Retry-After sets the next try; three failures in a row go stale; a good read clears it all', async () => {
  const { C, stale, conns } = await setup(), f0 = globalThis.fetch;
  globalThis.fetch = async () => res(429, { error: { message: 'Too many calls' } }, { 'retry-after': '1800' });
  try {
    for (let i = 0; i < 3; i++) { await C.sync('acme-in', 'meta'); const s = await conns(); assert.ok(s.retryAt - Date.now() > 29 * 60e3 && s.retryAt - Date.now() <= 31 * 60e3, 'Retry-After, plus a little jitter'); assert.equal(s.rateLimited, true); }
  } finally { globalThis.fetch = f0; }
  assert.equal((await conns()).fails, 3); assert.equal((await conns()).stale, true); assert.equal(stale.length, 1, 'marked once');
});

test('a sign-in that runs out: the admins get one email a week ahead and one when it ran out; the page says so', async () => {
  const { C, mails, conns } = await setup({ expiresAt: Date.now() + 5 * DAY + 60e3 });
  const r = await C.expiryCheck('acme-in', 'meta');
  assert.equal(r.stage, 'soon'); assert.deepEqual(mails.map((m) => m.to).sort(), ['admin@acme.in', 'owner@acme.in'], 'owners and admins, not every member');
  assert.match(mails[0].subject, /Meta Ads sign-in runs out on/);
  assert.equal(await C.expiryCheck('acme-in', 'meta'), null, 'once'); assert.equal(mails.length, 2);
  assert.equal(await C.expiryCheck('acme-in', 'meta', Date.now() + 3 * DAY), null, 'still the week-ahead stage: no second email');
  const out = await C.expiryCheck('acme-in', 'meta', Date.now() + 7 * DAY); assert.equal(out.stage, 'expired'); assert.match(mails.at(-1).subject, /ran out/);
  assert.match((await conns()).expiryWarned, /^expired:/);
  const live = fs.readFileSync(new URL('../public/live.js', import.meta.url), 'utf8');
  assert.match(live, /Sign-in runs out in \$\{left\} day/); assert.match(live, /Sign-in expired: connect again/); assert.match(live, />Stale</);
});

test('a last good read too old goes stale even with no failed read', async () => {
  const { C, stale, conns } = await setup({ lastSync: Date.now() - 80 * H });
  assert.equal(await C.ageCheck('acme-in', 'meta'), true); assert.equal((await conns()).stale, true); assert.match(stale[0].why, /no good read for 80 hours/);
  assert.equal(await C.ageCheck('acme-in', 'meta'), false, 'once');
});

test('Meta renews where it can: the end is looked up once, a token near its end is swapped for a new one, at most once a day', async () => {
  process.env.META_ADS_OAUTH_CLIENT_ID = 'app'; process.env.META_ADS_OAUTH_CLIENT_SECRET = 'sec';
  try {
    const calls = [];
    const g = async (url) => { calls.push(url.split('?')[0].split('/').pop()); if (/debug_token/.test(url)) return { data: { expires_at: Math.round((NOW + 40 * DAY) / 1e3) } }; return { access_token: 'tok2', expires_in: 60 * 86400 }; };
    const a = await freshMeta({ token: 'tok' }, { now: NOW, getJSONImpl: g });
    assert.equal(a.exp, Math.round((NOW + 40 * DAY) / 1e3) * 1e3); assert.equal(a.token, 'tok', 'far from its end: kept'); assert.deepEqual(calls, ['debug_token']);
    const b = await freshMeta({ token: 'tok', exp: NOW + 6 * DAY }, { now: NOW, getJSONImpl: g });
    assert.equal(b.token, 'tok2'); assert.equal(b.exp, NOW + 60 * DAY); assert.equal(b.refreshedAt, NOW);
    const failing = async () => { throw new Error('meta refresh 400'); };
    const c = await freshMeta({ token: 'tok', exp: NOW + 6 * DAY }, { now: NOW, getJSONImpl: failing });
    assert.equal(c.token, 'tok'); assert.equal(c.refreshTriedAt, NOW);
    const d = await freshMeta(c, { now: NOW + H, getJSONImpl: async () => assert.fail('not again within a day') }); assert.equal(d, c);
  } finally { delete process.env.META_ADS_OAUTH_CLIENT_ID; delete process.env.META_ADS_OAUTH_CLIENT_SECRET; }
});
