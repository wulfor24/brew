// The four go-live guards: per-brand daily budgets, one rewrite per move when accounts connect, deploys that wait for paid
// work, and ops alerts. All free and offline (stub store, stub mail, stub gcloud/curl).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBudget, capsFrom } from '../budget.js';
import { createAlerts, noteVertex, noteAlert } from '../alerts.js';
import { settleWait, connectTargets } from '../on-connect.js';
import { teamStaticsDue } from '../statics.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const memStore = (init = null) => { let v = init; return { get: async () => v && JSON.parse(JSON.stringify(v)), put: async (x) => { v = JSON.parse(JSON.stringify(x)); }, peek: () => v }; };
const T0 = Date.parse('2026-10-16T10:00:00Z');

/* ---------- 1. budgets ---------- */
test('budget: each brand gets its own share, under one ceiling', () => {
  const b = createBudget({ env: { DAILY_IMAGE_CAP: '6', DAILY_BRAND_SHARE: '0.5' }, now: () => T0 });
  assert.equal(b.caps.brand.image, 3);
  for (let i = 0; i < 3; i++) assert.equal(b.spend('image', 'a'), true);
  assert.equal(b.spend('image', 'a'), false, 'brand a used its share');
  assert.equal(b.left('a').image.out, 'brand');
  assert.match(b.why('image', 'a', 'Acme'), /Acme’s picture share for today is used up/);
  assert.equal(b.spend('image', 'b'), true, 'brand b still has its own');
  b.spend('image', 'b'); b.spend('image', 'b');
  assert.equal(b.spend('image', 'c'), false, 'the ceiling holds for everyone');
  assert.equal(b.left('c').image.out, 'all');
  assert.match(b.why('image', 'c'), /across all brands/);
  assert.equal(b.spend('image', null), false);
});
test('budget: BRAND_<KIND>_CAP overrides the share; unknown kinds are free', () => {
  assert.equal(capsFrom({ DAILY_TEXT_CAP: '1500', BRAND_TEXT_CAP: '200' }).brand.text, 200);
  assert.equal(capsFrom({ DAILY_IMAGE_CAP: '120' }).brand.image, 40);
  assert.equal(createBudget({ env: {} }).spend('nonsense', 'a'), true);
});
test('budget: counters survive a restart and a new day starts empty', async () => {
  const store = memStore();
  const b1 = createBudget({ env: { DAILY_VIDEO_CAP: '4', DAILY_BRAND_SHARE: '0.5' }, store, now: () => T0, debounceMs: 0 });
  await b1.load(); b1.spend('video', 'a'); b1.spend('video', 'a'); await b1.flush();
  const b2 = createBudget({ env: { DAILY_VIDEO_CAP: '4', DAILY_BRAND_SHARE: '0.5' }, store, now: () => T0 });
  await b2.load();
  assert.equal(b2.loaded, true);
  assert.equal(b2.spend('video', 'a'), false, 'the share used before the restart still counts');
  assert.equal(b2.state.all.video, 2);
  const b3 = createBudget({ env: { DAILY_VIDEO_CAP: '4' }, store, now: () => T0 + 864e5 });
  await b3.load(); assert.equal(b3.state.all.video, 0);
});
test('budget: reads the old usage-day.json (totals only) without losing them', async () => {
  const store = memStore({ day: new Date(T0).toDateString(), text: 7, image: 2, video: 0, voice: 1, treg: { usd: 1 } });
  const b = createBudget({ env: {}, store, now: () => T0 }); await b.load();
  assert.deepEqual(b.state.all, { text: 7, image: 2, video: 0, voice: 1 });
});

/* ---------- 2. one rewrite per move when accounts connect ---------- */
test('connect: the run waits for the quiet window and every first read', () => {
  const now = T0, run = { ids: ['ga4'], due: now + 60e3 };
  assert.equal(settleWait(run, { now }), now + 60e3, 'not before due');
  const r2 = { ids: ['ga4'], due: now - 1, waiting: { klaviyo: now - 10 * 60e3 } };
  assert.equal(settleWait(r2, { now, readMaxMs: 3600e3 }), now + 5 * 60e3, 'a first read still out holds the run');
  const r3 = { ids: ['ga4'], due: now - 1, waiting: { klaviyo: now - 3 * 3600e3 } };
  assert.equal(settleWait(r3, { now, readMaxMs: 2 * 3600e3 }), 0, 'a read that never came stops holding it');
  assert.equal(settleWait({ ids: ['ga4'], due: now - 1, waiting: {} }, { now }), 0);
});
test('connect: each move is rewritten once per set of accounts', () => {
  const at = T0, all = [1, 2, 3, 4];
  const touches = (id, n) => ({ ga4: [1, 2], klaviyo: [3], shopify: [1, 2, 3, 4] })[id]?.includes(n);
  /* the first run writes every move */
  assert.deepEqual(connectTargets({ all, full: true, runIds: ['ga4', 'klaviyo'], nowIds: ['ga4', 'klaviyo'], pm: {}, touches, at }), [1, 2, 3, 4]);
  /* a repeat of the first run (a deploy, an overwritten updates.json) skips moves already written with those accounts */
  const pm = Object.fromEntries(all.map((n) => [n, { meta: { rewrittenAt: new Date(at - 3600e3).toISOString(), connectedWith: ['ga4', 'klaviyo'] } }]));
  assert.deepEqual(connectTargets({ all, full: true, runIds: ['ga4', 'klaviyo'], nowIds: ['ga4', 'klaviyo'], pm, touches, at }), []);
  /* a later account rewrites only the moves it changes, and only those not yet written with it */
  assert.deepEqual(connectTargets({ all, runIds: ['klaviyo'], nowIds: ['ga4', 'klaviyo'], pm, touches, at }), []);
  const pm2 = { ...pm, 3: { meta: { rewrittenAt: pm[3].meta.rewrittenAt, connectedWith: ['ga4'] } } };
  assert.deepEqual(connectTargets({ all, runIds: ['klaviyo'], nowIds: ['ga4', 'klaviyo'], pm: pm2, touches, at }), [3]);
  assert.deepEqual(connectTargets({ all, runIds: ['shopify'], nowIds: ['ga4', 'klaviyo', 'shopify'], pm, touches, at }), [1, 2, 3, 4]);
  /* moves from before connectedWith: rewritten in the last day counts as done */
  const old = { 1: { meta: { rewrittenAt: new Date(at - 3600e3).toISOString() } }, 2: { meta: { rewrittenAt: new Date(at - 3 * 864e5).toISOString() } } };
  assert.deepEqual(connectTargets({ all, runIds: ['ga4'], nowIds: ['ga4'], pm: old, touches, at }), [2]);
});
test('team statics: made once, a failed try goes again at most once a day', () => {
  assert.equal(teamStaticsDue(null), true);
  assert.equal(teamStaticsDue({ state: 'done', at: 0 }), false);
  assert.equal(teamStaticsDue({ state: 'failed', at: T0 - 3600e3 }, { now: T0 }), false, 'not on every Move 21 rewrite');
  assert.equal(teamStaticsDue({ state: 'running', at: T0 - 25 * 3600e3 }, { now: T0 }), true, 'a run a restart cut off goes again the next day');
});
test('connect: build.js saves which accounts a private rewrite used and skips the index on resume', () => {
  const src = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
  assert.match(src, /connectedWith: idsOfRows\(privL\)/);
  assert.match(src, /noIndex: !!r\.indexDone/);
  assert.match(src, /tries: r\.tries \|\| 0/);
  assert.match(src, /connectPending/);
  assert.match(fs.readFileSync(path.join(ROOT, 'connectors/index.js'), 'utf8'), /builder\.connectPending\?\.\(slug, id\)/);
});

/* ---------- 3. deploys wait for paid work ---------- */
function guard(busyJson, { lastMinAgo = 60, force = '0', wait = '0' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  const last = new Date(Date.now() - lastMinAgo * 60e3).toISOString();
  fs.writeFileSync(path.join(dir, 'gcloud'), `#!/bin/sh\necho ${last}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'curl'), `#!/bin/sh\nprintf '%s' '${busyJson}'\n`, { mode: 0o755 });
  try { return { ok: true, out: execFileSync('bash', ['-c', `. ${path.join(ROOT, 'tools/deploy-guard.sh')}; deploy_guard svc https://x`], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FORCE: force, DEPLOY_WAIT_MIN: wait }, encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || '') }; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('deploy guard: goes when nothing is running', () => { const r = guard('{"busy":0}'); assert.equal(r.ok, true); assert.match(r.out, /no paid work/); });
test('deploy guard: refuses while paid work runs', () => { const r = guard('{"busy":2,"by":{"rewrite":1,"drafts":1}}'); assert.equal(r.ok, false); assert.match(r.out, /still doing paid work/); });
test('deploy guard: a recent deploy does not block the next one', () => { const r = guard('{"busy":0}', { lastMinAgo: 1 }); assert.equal(r.ok, true); });
test('deploy guard: FORCE=1 skips the paid-work check', () => { const r = guard('{"busy":3}', { lastMinAgo: 1, force: '1' }); assert.equal(r.ok, true); });
test('deploy guard: both deploy scripts use it', () => {
  for (const f of ['deploy.sh', 'tools/deploy-demo.sh']) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /deploy_guard (shopos-feed|brew-demo) https:\/\//);
});

/* ---------- 4. alerts ---------- */
const mk = (o = {}) => { const mails = [], store = o.store || memStore(); const a = createAlerts({ env: { ALERTS: '1', TREG_LOW_USD: '10', ...(o.env || {}) }, store, treg: o.treg || null, sendMail: async (m) => { mails.push(m); }, now: o.now || (() => T0), log: { warn() {} } }); return { a, mails, store }; };
test('alerts: once per issue per day, even across a restart', async () => {
  const { a, mails, store } = mk();
  await a.fire('ai-pause', 'credit out'); await a.fire('ai-pause', 'again');
  assert.equal(mails.length, 1); assert.equal(mails[0].to, 'hello@joinsquareup.com'); assert.match(mails[0].subject, /AI is paused/); assert.match(mails[0].html, /<table/);
  const { a: a2, mails: m2 } = mk({ store }); await a2.fire('ai-pause', 'after a deploy'); assert.equal(m2.length, 0);
  const { a: a3, mails: m3 } = mk({ store, now: () => T0 + 864e5 }); await a3.fire('ai-pause', 'next day'); assert.equal(m3.length, 1);
});
test('alerts: Vertex billing at once, 429s only when they pile up', async () => {
  const { a, mails } = mk({ env: { VERTEX_429_ALERT: '3' } });
  noteVertex(429, 'Resource exhausted'); noteVertex(429, 'RESOURCE_EXHAUSTED'); await a.ready; await new Promise((r) => setTimeout(r, 10));
  assert.equal(mails.length, 0);
  noteVertex(429, 'quota'); await new Promise((r) => setTimeout(r, 10));
  assert.equal(mails.length, 1); assert.match(mails[0].subject, /quota/);
  noteVertex(403, 'This API method requires billing to be enabled'); await new Promise((r) => setTimeout(r, 10));
  assert.equal(mails.length, 2); assert.match(mails[1].subject, /billing/);
  noteAlert('ai-pause', 'x'); await new Promise((r) => setTimeout(r, 10)); assert.equal(mails.length, 3);
});
test('alerts: treg balance under the threshold, and the 5xx rate', async () => {
  const { a, mails } = mk({ treg: { balance: async () => ({ usd: 6 }) } });
  for (let i = 0; i < 60; i++) a.response(i < 5 ? 503 : 200);
  await a.check();
  assert.deepEqual(mails.map((m) => m.subject).sort(), ['Brew alert: Brew is returning server errors', 'Brew alert: treg balance is low']);
  const { a: b, mails: m2 } = mk({ treg: { balance: async () => ({ usd: 50 }) } });
  for (let i = 0; i < 60; i++) b.response(200); b.response(500);
  await b.check(); assert.equal(m2.length, 0);
});
test('alerts: off on the demo site and under AI_MOCK unless ALERTS=1', () => {
  assert.equal(createAlerts({ env: { K_SERVICE: 'x', DEMO_MODE: '1' } }).on, false);
  assert.equal(createAlerts({ env: { K_SERVICE: 'x', AI_MOCK: '1' } }).on, false);
  assert.equal(createAlerts({ env: { K_SERVICE: 'x' } }).on, true);
});
