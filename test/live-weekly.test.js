// Connected accounts' re-reads (every 6 or 12 hours): every move an account touches is flagged once a number moved 10% or
// more since the move was written, a quiet re-read never clears a flag, and the flagged moves are rewritten once a week.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liveMaterial, CONNECTED_MOVES } from '../refresh.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const at = new Date().toISOString();
const row = (key, label, v, n) => ({ key, label, v: String(v), ...(n != null ? { n } : {}), layer: 'observed', src: 'Shopify · acme', method: `account:${key.split('.')[0]}`, at });
const shop = (orders, top = 'Rosemary Hair Oil (320); Onion Shampoo (140)') => [row('shopify.orders.30d', 'Orders, last 30 days', orders.toLocaleString('en'), orders), row('shopify.top.30d', 'Best sellers by units, 30 days', top)];
const STORE = CONNECTED_MOVES.store;
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

test('liveMaterial: 10% against the base, drift adds up, a list counts when its names change', () => {
  const first = liveMaterial({}, shop(1000));
  assert.deepEqual(first.changes, [], 'a key seen for the first time is the base, not a change');
  const small = liveMaterial(first.base, shop(1060, 'Rosemary Hair Oil (300); Onion Shampoo (170)'));
  assert.deepEqual(small.changes, [], '6% and new shares with the same names: nothing');
  assert.equal(small.base['shopify.orders.30d'].n, 1000, 'a quiet key keeps its base, so drift adds up');
  const big = liveMaterial(small.base, shop(1110, 'Hair Serum (300); Onion Shampoo (170)'));
  assert.deepEqual(big.changes.map((c) => [c.key, c.pct]), [['shopify.orders.30d', 11], ['shopify.top.30d', null]]);
  assert.equal(big.base['shopify.orders.30d'].n, 1110, 'a key that moved takes its new value');
});

async function brand() {
  process.env.CONNECT_SETTLE_MS = '20';
  const { createPacks } = await import('../brand-pack.js'); const { createBuilder } = await import('../build.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-live-'));
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = 'acme-com', runs = [];
  await P.put(slug, 'status.json', { slug, name: 'Acme', done: true, ready: true, state: 'Ready' });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.com', catalog: { products: [] } });
  await P.put(slug, 'ledger.json', []);
  await P.put(slug, 'brief.json', { name: 'Acme', catalogue: [], claims: [], platforms: [], quotes: [], channels: [], company: [], personas: [], objections: [], rivals: [], gaps: [], toConfirm: [], goal: 'To confirm', at: '2026-10-01' });
  await P.put(slug, 'moves.json', Object.fromEntries([1, ...STORE].map((n) => [n, { n, title: `Move ${n}`, meta: { at: 'a' } }])));
  const moves = { SPECS: [1, ...STORE].map((n) => ({ n })), createMovesEngine: () => ({ runAll: async (ctx, { only }) => { runs.push(only); for (const n of only) if (n) await ctx.save(n, { n, title: `Rewritten ${n}`, meta: {} }); } }) };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {} }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves, pdf: null } });
  return { b, P, slug, runs };
}
const flags = async (P, slug) => Object.values((await P.getJSON(slug, 'updates.json', {})).stale || {}).filter((f) => f.via === 'shopify');

test('re-reads flag every move the account touches, only on a material move, and keep the flag until the weekly rewrite', async () => {
  const { b, P, slug, runs } = await brand();
  await b.liveConnected(slug, 'shopify', shop(1000), true, { public: false });
  await settle(); runs.length = 0; /* the first-connect run rewrote everything; re-reads start from here */
  assert.deepEqual(await flags(P, slug), []);

  await b.liveConnected(slug, 'shopify', shop(1060), true, { public: false });
  assert.deepEqual(await flags(P, slug), [], '6% is noise');
  await b.liveConnected(slug, 'shopify', shop(1120), true, { public: false });
  const f = await flags(P, slug);
  assert.deepEqual(f.map((x) => x.n).sort((a, z) => a - z), [...STORE].sort((a, z) => a - z), 'every store move, not six');
  assert.match(f[0].why, /Shopify moved since this plan was written: Orders, last 30 days: 1,000 → 1,120 \(\+12%\)/);
  assert.equal(runs.length, 0, 'a re-read never rewrites on its own');

  await b.liveConnected(slug, 'shopify', shop(1100), true, { public: false });
  assert.equal((await flags(P, slug)).length, STORE.length, 'a quiet re-read keeps the flags');

  const r = await b.liveWeekly(slug); await settle();
  assert.equal(r.ok, true);
  assert.deepEqual([...runs.at(-1)].sort((a, z) => a - z), [0, ...STORE].sort((a, z) => a - z), 'the weekly run rewrites every flagged move');
  assert.deepEqual(await flags(P, slug), [], 'and a rewritten move loses its flag');

  await b.liveConnected(slug, 'shopify', shop(1300), true, { public: false });
  assert.equal((await flags(P, slug)).length, STORE.length);
  assert.equal((await b.liveWeekly(slug)).skipped, 'this week', 'at most once a week');
  const n = runs.length, r2 = await b.liveWeekly(slug, { now: Date.now() + 8 * 864e5 }); await settle();
  assert.equal(r2.ok, true); assert.equal(runs.length, n + 1, 'a week later it runs again');

  await b.liveConnected(slug, 'shopify', [], false, { public: false });
  assert.deepEqual(await flags(P, slug), [], 'a disconnect clears its flags');
  assert.deepEqual(await P.getJSON(slug, 'private/live-base.json', {}), {}, 'and its base');
});

test('the weekly run waits for the first-connect run and never takes its flags', async () => {
  const { b, P, slug } = await brand();
  await b.liveConnected(slug, 'shopify', shop(1000), true, { public: false });
  assert.equal((await b.liveWeekly(slug)).skipped, 'waiting', 'the connect run is still settling');
  await settle();
  assert.equal((await b.liveWeekly(slug)).skipped, 'nothing flagged');
  assert.equal((await P.getJSON(slug, 'updates.json', {})).liveRun, undefined, 'no week is used up when nothing ran');
});

test('the first connected account rewrites every move once; a later one only the moves it touches, skipping fresh ones', async () => {
  process.env.CONNECT_FRESH_MS = '1500';
  const { b, P, slug, runs } = await brand();
  delete process.env.CONNECT_FRESH_MS;
  await b.liveConnected(slug, 'shopify', shop(1000), true, { public: false });
  await settle();
  assert.deepEqual([...runs.at(-1)].sort((a, z) => a - z), [0, 1, ...STORE].sort((a, z) => a - z), 'the first connect: every move and the index');
  assert.ok((await P.getJSON(slug, 'updates.json', {})).connectFull);
  const n0 = runs.length;
  await b.liveConnected(slug, 'klaviyo', [row('klaviyo.list', 'List size', '1,200', 1200)], true, { public: false }); /* inside a day of the full run */
  await settle();
  assert.equal(runs.length, n0, 'every move it touches was rewritten moments ago: nothing to pay for');
  await settle(1500); /* the moves are no longer fresh */
  await b.liveConnected(slug, 'meta', [row('meta.spend.30d', 'Spend, 30 days', '$900', 900)], true, { public: false });
  await settle();
  const email = CONNECTED_MOVES.paid.filter((n) => STORE.includes(n));
  assert.deepEqual([...runs.at(-1)].sort((a, z) => a - z), email.sort((a, z) => a - z), 'a later account: only its own moves, never the whole set');
});
