// QV round 1 (roles, queue, security): each finding pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPg } from './pg-helper.js';

const quiet = { log() {}, warn() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('every process has its own id (hostname and PID are the same in every container)', async () => {
  const { ME } = await import('../instance.js'); assert.match(ME, /:[0-9a-f-]{12}$/);
});

test('a web-only instance without Postgres refuses to start', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['server.js'], { env: { ...process.env, ROLE: 'web', STORAGE: '', AI_MOCK: '1', PORT: '0', K_SERVICE: '' }, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /ROLE=web needs STORAGE=pg/);
});

test('server.js: the web builder forwards everything but reads; clicks once; heal and seen are batch nudges; cross-site changes refused', () => {
  const s = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(s, /const BUILD_LOCAL = new Set\(\['status', 'events', 'subscribe', 'list', 'summary', 'peek'/);
  assert.match(s, /JOBS\.call\('builder', \{ m: k, args \}, \{[^}]*maxTries: 1[^}]*\}\)/);
  assert.match(s, /BUILD_NUDGE = new Set\(\['seen', 'bookAfter', 'signal', 'heal'/);
  assert.match(s, /if \(crossSite\(req, u\)\)/);
});

const url = startPg();
const skip = !url && 'no Postgres on this machine';
test('Postgres group', { skip }, async (t) => {
  process.env.STORAGE = 'pg'; process.env.DATABASE_URL = url; delete process.env.K_SERVICE; process.env.PROTECTED_CONNECTIONS = 'arata-in'; process.env.BUILD_RESUME_OFF = '1';
  const db = await import('../db/index.js'); await (await import('../db/migrate.js')).migrate({ log: quiet });
  const O = await import('../objects.js'), { createPacks } = await import('../brand-pack.js');
  const mkPacks = () => createPacks({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'qv1r-')), PUB: path.resolve('public'), objects: O.createObjects({ log: quiet }), log: quiet });

  await t.test('jobs asked with maxTries 1 run once even when they fail', async () => {
    const J = await import('../jobs.js'); const web = J.createJobs({ worker: false, log: quiet, pollMs: 100 }), wk = J.createJobs({ worker: true, log: quiet, pollMs: 100 });
    let n = 0; wk.define('click', async () => { n++; throw new Error('boom'); }, { queue: 'interactive' }); await web.start(); await wk.start({ interactive: 1, batch: 1 });
    await assert.rejects(web.call('click', {}, { timeoutMs: 5000, maxTries: 1 }), /boom/); await sleep(300); assert.equal(n, 1); wk.stop();
  });

  await t.test('Arata: a re-pick, a new key or a sign-in over an existing connection is refused even while it is syncing; the vault refuses too', async () => {
    const packs = mkPacks(), { createVault } = await import('../vault.js'), { createConnectors } = await import('../connectors/index.js');
    const v = createVault(packs); await v.save('arata-in', 'meta', { token: 'keep' }); await packs.put('arata-in', 'private/connections.json', { meta: { state: 'syncing', lastSync: Date.now() - 3600e3 } });
    const C = createConnectors({ packs, auth: { user: () => null, isAdmin: () => true, isRootAdmin: () => false, claimInfo: async () => ({ role: 'admin' }), baseOf: () => 'http://x' }, builder: {}, log: quiet });
    const r = await C.finish('arata-in', 'meta', { token: 'new' }, { email: 'staff@joinsquareup.com' });
    assert.equal(r.protected, true); assert.equal((await v.load('arata-in', 'meta')).token, 'keep');
    await assert.rejects(v.save('arata-in', 'meta', { token: 'other' }), /protected/);
    await v.save('arata-in', 'meta-pending-abc', { creds: {} }); /* a sign-in waiting for its account pick is fine */
    await v.save('arata-in', 'meta', { token: 'refreshed' }, { refresh: true }); assert.equal((await v.load('arata-in', 'meta')).token, 'refreshed');
  });

  await t.test('sign-out ends the session everywhere even if its sign-in row never landed, and survives the 30 s reload', async () => {
    const { createSessions } = await import('../sessions.js'); const A = createSessions({ log: quiet, everyMs: 100 }), B = createSessions({ log: quiet, everyMs: 100 }); await A.start(); await B.start();
    const s = { sid: 'never-saved', email: 'a@zz.com', exp: Math.floor(Date.now() / 1000) + 3600 };
    await A.end(s); await sleep(400); assert.equal(B.live(s), false); assert.equal(A.live(s), false); A.stop(); B.stop();
  });

  await t.test('token refresh: no database transaction stays open while the provider answers', async () => {
    const { createVault } = await import('../vault.js'); const packs = mkPacks(), v = createVault(packs);
    await v.save('zz-ref', 'google', { token: 'old', exp: 0, refresh: 'r' });
    let during = null; await v.refresh('zz-ref', 'google', async (c) => { during = +(await db.q("SELECT count(*) AS n FROM pg_stat_activity WHERE state = 'idle in transaction' AND datname = current_database()")).rows[0].n; return { ...c, token: 'new', exp: Date.now() + 3600e3 }; });
    assert.equal(during, 0); assert.equal((await v.load('zz-ref', 'google')).token, 'new');
  });

  await t.test('build progress seen from another instance: nothing twice, in order, and a fresh read starts over', async () => {
    const BE = await import('../build-events.js'), w = BE.createBuildEvents({ log: quiet });
    const { createBuilder } = await import('../build.js');
    const webB = createBuilder({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'qv1b-')), packs: mkPacks(), ai: { live: false }, treg: { onCharge() {}, call: async () => ({}), meter: { dayUsd: 0 } }, events: BE.createBuildEvents({ log: quiet }), log: quiet });
    await db.q("DELETE FROM build_events WHERE slug = 'zz-be'");
    for (let i = 0; i < 3; i++) await db.q(`INSERT INTO build_events (slug, ev) VALUES ('zz-be', $1)`, [JSON.stringify({ k: `old${i}`, _by: 'worker-x' })]);
    await db.q(`INSERT INTO build_events (slug, ev) VALUES ('zz-be', '{"k":"_reset","_by":"worker-x"}')`);
    await db.q(`INSERT INTO build_events (slug, ev) VALUES ('zz-be', '{"k":"read","_by":"worker-x"}')`);
    const got = []; webB.subscribe('zz-be', (e) => got.push(e.k)); await sleep(300);
    await db.q(`INSERT INTO build_events (slug, ev) VALUES ('zz-be', '{"k":"moves","_by":"worker-x"}')`); await sleep(400);
    assert.deepEqual(got, ['read', 'moves']); void w;
  });

  await t.test('social: a page open on a web instance never rolls back the worker’s listening state', async () => {
    const { createSocialScheduler } = await import('../social-feed.js');
    const pw = mkPacks(), pk = mkPacks();
    const worker = createSocialScheduler({ packs: pw, ai: null, treg: null, log: quiet }), web = createSocialScheduler({ packs: pk, ai: null, treg: null, log: quiet });
    await pw.put('zz-soc', 'social/state.json', { spend: { day: 'x', usd: 1 } });
    const s = await worker.stateOf('zz-soc'); s.spend.usd = 2.5; s.listen = { state: 'done' };
    await web.opened('zz-soc');
    const back = await mkPacks().getJSON('zz-soc', 'social/state.json');
    assert.ok(back.lastOpen > 0);
    assert.ok((await worker.stateOf('zz-soc')).lastOpen > 0, 'the worker sees the open');
  });
  await db.close();
});
