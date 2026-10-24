// Phase 2 on Postgres: the job queue (one worker does each job, retries, leases that run out, one open job per key, a web
// instance waits for the answer), the day's counters every instance shares (a strict cap never passed under parallel spend),
// the background lease (exactly one worker leads, another takes over when it dies) and build progress seen from another instance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startPg } from './pg-helper.js';

const url = startPg();
const skip = !url && 'no Postgres on this machine';
let db, J, C, BE;
const quiet = { log() {}, warn() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test.before(async () => {
  if (skip) return;
  process.env.STORAGE = 'pg'; process.env.DATABASE_URL = url;
  db = await import('../db/index.js'); await (await import('../db/migrate.js')).migrate({ log: quiet });
  J = await import('../jobs.js'); C = await import('../counters.js'); BE = await import('../build-events.js');
});
test.after(async () => { if (!skip) await db.close(); });

test('jobs: a web instance asks, the worker answers; a key keeps one open job', { skip }, async () => {
  const web = J.createJobs({ worker: false, log: quiet, pollMs: 200 }), wk = J.createJobs({ worker: true, log: quiet, pollMs: 200 });
  let ran = 0; wk.define('add', async ({ a, b }) => { ran++; await sleep(50); return a + b; }, { queue: 'interactive' });
  web.define('add', async () => { throw new Error('the web instance never runs it'); }, { queue: 'interactive' });
  await web.start(); await wk.start({ interactive: 2, batch: 1 });
  assert.equal(await web.call('add', { a: 2, b: 3 }, { timeoutMs: 5000 }), 5);
  const [x, y] = await Promise.all([web.enqueue('add', { a: 1, b: 1 }, { key: 'same' }), web.enqueue('add', { a: 1, b: 1 }, { key: 'same' })]);
  assert.equal(x.id, y.id, 'asking twice while it is open joins the same job');
  assert.equal(await web.wait(x.id, 5000), 2);
  assert.equal(ran, 2); wk.stop();
});

test('jobs: a failing job is tried again with backoff, then fails; a dead worker’s lease runs out and the job runs again', { skip }, async () => {
  const wk = J.createJobs({ worker: true, log: quiet, pollMs: 100 });
  let n = 0; wk.define('flaky', async () => { n++; throw new Error('nope'); }, { maxTries: 2 });
  await wk.start({ interactive: 1, batch: 1 });
  const { id } = await wk.enqueue('flaky', {});
  await sleep(600); await db.q("UPDATE jobs SET run_at = now() WHERE id = $1 AND state = 'queued'", [id]); /* skip the backoff */
  await assert.rejects(wk.wait(id, 5000), /nope/); assert.equal(n, 2);
  /* a job a dead worker held: its lease ran out, the reaper puts it back, it runs */
  let ok = 0; wk.define('again', async () => { ok++; return 'done'; });
  const r = await db.q(`INSERT INTO jobs (name, state, tries, locked_until, locked_by) VALUES ('again', 'running', 1, now() - interval '1 minute', 'dead') RETURNING id`);
  await db.q(`UPDATE jobs SET state = 'queued', locked_until = NULL WHERE state = 'running' AND locked_until < now()`); /* what reap() does every 30 s */
  assert.equal(await wk.wait(+r.rows[0].id, 5000), 'done'); assert.equal(ok, 1); wk.stop();
});

test('counters: two instances share the day; a strict cap is never passed under parallel spend', { skip }, async () => {
  const a = C.createCounters({ flushMs: 20, pullMs: 50, log: quiet }), b = C.createCounters({ flushMs: 20, pullMs: 50, log: quiet });
  await a.start(); await b.start();
  for (let i = 0; i < 10; i++) { a.add('ai', 'text|*', 1); b.add('ai', 'text|*', 2); }
  await sleep(250); assert.equal(a.total('ai', 'text|*'), 30); assert.equal(b.total('ai', 'text|*'), 30);
  const got = await Promise.all(Array.from({ length: 50 }, (_, i) => (i % 2 ? a : b).take('build', 'cap-test', 1, 20)));
  assert.equal(got.filter(Boolean).length, 20);
  assert.equal((await db.q("SELECT n FROM counters WHERE scope = 'build' AND key = 'cap-test'")).rows[0].n, 20);
  await a.stop(); await b.stop();
});

test('budget on shared counters: what one instance spends counts on the other', { skip }, async () => {
  const { createBudget } = await import('../budget.js');
  const env = { DAILY_TEXT_CAP: '1000', BRAND_TEXT_CAP: '6' };
  const ca = C.createCounters({ flushMs: 10, pullMs: 30, log: quiet }), cb = C.createCounters({ flushMs: 10, pullMs: 30, log: quiet }); await ca.start(); await cb.start();
  const A = createBudget({ env, shared: ca, log: quiet }), Bd = createBudget({ env, shared: cb, log: quiet });
  for (let i = 0; i < 4; i++) assert.ok(A.spend('text', 'zz-budget'));
  await sleep(150);
  assert.ok(Bd.spend('text', 'zz-budget')); assert.ok(Bd.spend('text', 'zz-budget'));
  assert.equal(Bd.spend('text', 'zz-budget'), false, 'the brand’s share is used across both instances');
  await ca.stop(); await cb.stop();
});

test('lease: exactly one of two workers leads; when it dies the other takes over', { skip }, async () => {
  const kid = () => { const p = spawn(process.execPath, [new URL('./lease-child.mjs', import.meta.url).pathname], { env: { ...process.env } }); p.out = ''; p.stdout.on('data', (d) => { p.out += d; }); return p; };
  const one = kid(), two = kid();
  await sleep(2500);
  const leaders = [one, two].filter((p) => /leader/.test(p.out));
  assert.equal(leaders.length, 1, 'one leader');
  const other = leaders[0] === one ? two : one; leaders[0].kill('SIGKILL');
  for (let i = 0; i < 40 && !/leader/.test(other.out); i++) await sleep(250);
  assert.match(other.out, /leader/, 'the other worker took the lease');
  other.kill('SIGKILL');
});

test('build events: a line written on one instance reaches another, and a late page reads the lines so far', { skip }, async () => {
  const a = BE.createBuildEvents({ log: quiet }); await a.clear('zz-build');
  const heard = []; await a.onRemote((slug, e) => heard.push([slug, e.k]));
  await a.persist('zz-build', { k: 'read', at: 1 }); await a.persist('zz-build', { k: 'moves', at: 2 });
  await sleep(300);
  assert.deepEqual(heard, [], 'its own lines are not delivered back to itself');
  await db.q(`INSERT INTO build_events (slug, ev) VALUES ('zz-build', '{"k":"done","_by":"other-instance"}')`);
  await sleep(300); assert.deepEqual(heard, [['zz-build', 'done']]);
  assert.deepEqual((await a.history('zz-build')).map((e) => e.k), ['read', 'moves', 'done']);
});
