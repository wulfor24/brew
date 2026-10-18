// Outdated moves refresh on their own (Param, 19 Oct): staleSweep queues the flagged moves this week's pot covers, best kind
// first, within the hour (or at once after a stock signal); never a first-connect or demo flag, never a move written in the
// last day, never with automatic updates off; what the pot can't cover waits for next week. The move page reads the state.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { weekKey } from '../rewrite-pot.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

async function brand({ cap = '0.45' } = {}) {
  process.env.BRAND_WEEK_CAP_USD = cap; process.env.AI_PROVIDER = 'gemini'; delete process.env.STALE_SWEEP;
  const { createPacks } = await import('../brand-pack.js'); const { createBuilder } = await import('../build.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-sweep-'));
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = 'acme-com', runs = [], NS = [1, 2, 3, 4, 5, 6, 7, 8]; let spend = () => {};
  await P.put(slug, 'status.json', { slug, name: 'Acme', done: true, ready: true, state: 'Ready' });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.com', catalog: { products: [] } });
  await P.put(slug, 'ledger.json', []);
  await P.put(slug, 'brief.json', { name: 'Acme', goal: 'To confirm', at: '2026-10-01' });
  await P.put(slug, 'moves.json', Object.fromEntries(NS.map((n) => [n, { n, title: `Move ${n}`, meta: { at: 'a' } }])));
  const moves = { SPECS: NS.map((n) => ({ n })), createMovesEngine: () => ({ runAll: async (ctx, { only }) => { runs.push(only); for (const n of only) { if (!ctx.canSpend()) break; spend('move', 0.1); await ctx.save(n, { n, title: `Rewritten ${n}`, meta: { rewrittenAt: new Date().toISOString() } }); } } }) };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge(f) { spend = f; } }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves, pdf: null } });
  return { b, P, slug, runs };
}
const STALE = {
  2: { n: 2, priority: 'high', via: 'stock', stock: true, stockWhy: { x: 'X is out of stock.' }, why: 'X is out of stock.', at: 5 },
  3: { n: 3, priority: 'high', via: 'learnings', impact: 'high', why: 'What the team told us.', at: 9 },
  5: { n: 5, priority: 'high', via: 'facts', why: 'The fact sheet changed.', at: 2 },
  6: { n: 6, priority: 'medium', why: 'The site check: worth a look.', at: 1 },
  7: { n: 7, priority: 'medium', via: 'connected', live: true, real: true, why: 'The first-connect run.', at: 1 },
  8: { n: 8, priority: 'medium', via: 'meta', demo: true, why: 'A demo account.', at: 1 },
};

test('outdated moves are refreshed on their own, best kind first, as far as the week’s pot goes', async () => {
  const { b, P, slug, runs } = await brand();
  await P.put(slug, 'updates.json', { stale: STALE });
  const r = await b.staleSweep(slug); await settle();
  assert.equal(r.ok, true);
  assert.deepEqual(r.ns, [2, 3, 5], 'out of stock, then what the team said, then the fact sheet; never the connect run or a demo account');
  assert.deepEqual(r.wait, [6], 'the pot ran out: the site check’s medium flag waits');
  assert.deepEqual(runs.at(-1).filter((n) => n), [2, 3, 5]);
  const u = await P.getJSON(slug, 'updates.json');
  assert.deepEqual(Object.keys(u.stale).map(Number).sort(), [6, 7, 8], 'refreshed moves lose their flag');
  const up = await b.updates(slug), st = Object.fromEntries(up.stale.map((s) => [s.n, s.refresh]));
  assert.equal(st[6], 'next-week', 'the page can say it waits for next week'); assert.ok(up.potNext > Date.now());
});

test('the hourly tick runs at most once an hour; a stock signal runs at once; a move written today waits a day', async () => {
  const { b, P, slug, runs } = await brand();
  await P.put(slug, 'updates.json', { stale: { 6: STALE[6] }, sweep: { at: Date.now() - 60e3 } });
  assert.equal((await b.staleSweep(slug)).skipped, 'recent');
  const r = await b.staleSweep(slug, { why: 'stock' }); await settle();
  assert.deepEqual(r.ns, [6], 'a signal does not wait for the hour');
  await P.put(slug, 'moves.json', { ...(await P.getJSON(slug, 'moves.json')), 2: { n: 2, title: 'Move 2', meta: { rewrittenAt: new Date().toISOString() } } });
  await P.put(slug, 'updates.json', { ...(await P.getJSON(slug, 'updates.json')), stale: { 2: STALE[2] }, sweep: null });
  const n0 = runs.length, r2 = await b.staleSweep(slug); await settle();
  assert.equal(r2.skipped, 'nothing flagged', 'written in the last day: it waits, so a flag that flips can’t loop'); assert.equal(runs.length, n0);
});

test('automatic updates off, or a spent pot: nothing is written and the flags stay', async () => {
  const { b, P, slug, runs } = await brand();
  await P.put(slug, 'updates.json', { auto: false, stale: { 6: STALE[6] } });
  assert.equal((await b.staleSweep(slug)).skipped, 'auto off');
  assert.equal((await b.updates(slug)).stale[0].refresh, 'off');
  await P.put(slug, 'updates.json', { stale: { 6: STALE[6] }, pot: { week: weekKey(Date.now()), usd: 0.4, by: { event: 0.4 }, waits: {} } });
  const r = await b.staleSweep(slug); await settle();
  assert.equal(r.skipped, 'pot'); assert.equal(runs.length, 0);
  assert.ok((await P.getJSON(slug, 'updates.json')).stale[6], 'the flag stays for next week');
  process.env.STALE_SWEEP = '0'; assert.equal((await b.staleSweep(slug, { why: 'stock' })).skipped, 'off'); delete process.env.STALE_SWEEP;
});
