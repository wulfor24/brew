// A real account connecting: every move is rewritten with its numbers for the team, the team's view of the brand follows
// (best sellers, the brief), and nothing happens for a resync, a disconnect or a simulated account.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { topSellers, handleOf, profileLive, withLive, baselineOf, healthReadings, bandOf } from '../on-connect.js';
import { briefWithConnected } from '../brief.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const at = new Date().toISOString();
const row = (key, label, v, n) => ({ key, label, v: String(v), ...(n != null ? { n } : {}), layer: 'observed', src: 'Shopify · acme', method: `account:${key.split('.')[0]}`, at });
const SHOP = [row('shopify.orders.30d', 'Orders, last 30 days', '1,240', 1240), row('shopify.aov', 'Average order value, 30 days', '₹899', 899), row('shopify.revenue.30d', 'Revenue, last 30 days', '₹11.1 lakh', 1114760),
  row('shopify.top.30d', 'Best sellers by units, 30 days', 'Rosemary Hair Oil (320); Onion Shampoo - 200ml (140); Mystery Item (9)')];
const products = [{ handle: 'onion-shampoo', title: 'Onion Shampoo' }, { handle: 'rosemary-oil', title: 'Rosemary Hair Oil' }, { handle: 'serum', title: 'Hair Serum' }];

test('best sellers become the heroes, matched to the catalog by title', () => {
  assert.deepEqual(topSellers('A (3); B C (12)'), [{ title: 'A', units: 3 }, { title: 'B C', units: 12 }]);
  assert.equal(handleOf('Onion Shampoo - 200ml', products), 'onion-shampoo', 'a variant title still finds its product');
  assert.equal(handleOf('Mystery Item', products), null);
  const live = profileLive(SHOP, { catalog: { products } });
  assert.deepEqual(live.hero, ['rosemary-oil', 'onion-shampoo']);
  assert.equal(live.revenueBand, 'scaling'); assert.equal(bandOf(5e4), 'early');
  const p = withLive({ name: 'Acme', catalog: { products, hero: ['serum'] } }, live);
  assert.deepEqual(p.catalog.hero, ['rosemary-oil', 'onion-shampoo', 'serum'], 'best sellers lead, the site heroes stay after them');
  assert.equal(p.live.aov.v, '₹899');
});

test('the private brief takes the account numbers and drops the questions they answer', () => {
  const brief = { name: 'Acme', descriptor: '', oneLine: '', businessModel: '', catalogue: [], claims: [], reviewSummary: '', platforms: [], quotes: [], language: [], praise: [], complaints: [], personas: [], objections: [], rivals: [], gaps: [],
    channels: [{ channel: 'Instagram', evidence: 'linked from the site', k: 'social.ig' }], company: [{ fact: 'Founded', value: '2019', src: 'About page', k: 'company.founded' }], goal: 'To confirm', goalKeys: '',
    toConfirm: ['Monthly revenue and order volume', 'The brand goal for this quarter'], at: '2026-10-01' };
  const r = briefWithConnected(brief, SHOP);
  assert.ok(r.json.company.some((c) => c.k === 'shopify.revenue.30d' && c.value === '₹11.1 lakh'));
  assert.ok(r.json.company.some((c) => c.k === 'company.founded'), 'the site facts stay');
  assert.deepEqual(r.json.toConfirm, ['The brand goal for this quarter'], 'the goal is still the team’s to say');
  assert.match(r.md, /Revenue, last 30 days: ₹11\.1 lakh/);
  assert.equal(briefWithConnected(brief, []), null, 'no rows, no private brief');
});

test('members read cards against their own numbers; the health rings say what the accounts read', () => {
  const L = { 'meta.cpa': { v: '₹410', n: 410, label: 'Cost per purchase' }, 'ga4.conversion': { v: '1.8%', n: 1.8, label: 'Conversion' } };
  assert.equal(baselineOf('creatives', L).baseline, 410);
  assert.equal(baselineOf('storefront', L).baselineV, '1.8%');
  assert.equal(baselineOf('visibility', L), null);
  const h = healthReadings(L);
  assert.match(h.Storefront.what, /Conversion 1\.8%/); assert.match(h.Creative.what, /Cost per order ₹410/);
  assert.deepEqual(healthReadings({}), {});
});

async function brand(env = {}) {
  Object.assign(process.env, { CONNECT_SETTLE_MS: '30', ...env });
  const { createPacks } = await import('../brand-pack.js'); const { createBuilder } = await import('../build.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-conn-'));
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = 'acme-com', runs = [];
  await P.put(slug, 'status.json', { slug, name: 'Acme', done: true, ready: true, state: 'Ready' });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.com', catalog: { products, hero: ['serum'] } });
  await P.put(slug, 'ledger.json', [{ key: 'price.serum', label: 'Hair Serum price', v: '₹599' }]);
  await P.put(slug, 'brief.json', { name: 'Acme', catalogue: [], claims: [], platforms: [], quotes: [], channels: [], company: [], personas: [], objections: [], rivals: [], gaps: [], toConfirm: ['Monthly revenue'], goal: 'To confirm', at: '2026-10-01' });
  await P.put(slug, 'moves.json', { 1: { n: 1, title: 'One', meta: { at: 'a' } }, 2: { n: 2, title: 'Two', meta: { at: 'b' } }, 3: { n: 3, title: 'Three', meta: { at: 'c' } }, 1001: { n: 1001, title: 'Weekly', meta: { cadence: true } } });
  const moves = { SPECS: [{ n: 1 }, { n: 2 }, { n: 3 }], createMovesEngine: () => ({ runAll: async (ctx, { only }) => { await ctx.onTotal?.(only.length, only); /* as the real engine does */ runs.push({ only, hero: ctx.profile.catalog.hero, ledger: ctx.ledger.map((e) => e.key), brief: ctx.brief.json });
    for (const n of only) if (n) await ctx.save(n, { n, title: `Rewritten ${n}`, meta: {} }); } }) };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {} }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves, pdf: null } });
  return { b, P, slug, runs };
}
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

test('a real account connecting rewrites every move with its numbers, privately, once', async () => {
  const { b, P, slug, runs } = await brand();
  await b.liveConnected(slug, 'shopify', SHOP, true, { public: false });
  await b.liveConnected(slug, 'ga4', [row('ga4.conversion', 'Purchases per session', '1.8%', 1.8)], true, { public: false }); /* a second account inside the settle time */
  await settle();
  assert.equal(runs.length, 1, 'two connects, one run');
  assert.deepEqual(runs[0].only, [1, 2, 3, 0], 'every playbook move (and the index), never a weekly cadence move');
  assert.deepEqual(runs[0].hero.slice(0, 2), ['rosemary-oil', 'onion-shampoo'], 'the rewrite writes from the best sellers');
  assert.ok(runs[0].ledger.includes('shopify.aov') && runs[0].ledger.includes('ga4.conversion'), 'and from the account numbers');
  assert.ok(runs[0].brief.company.some((c) => c.k === 'shopify.revenue.30d'), 'and from the team’s brief');
  const priv = await P.getJSON(slug, 'private/moves.json', {});
  assert.match(priv[1].meta.because, /Shopify and Google Analytics are connected/);
  assert.equal((await P.getJSON(slug, 'moves.json'))[1].title, 'One', 'the shared moves stay as they were');
  const u = await P.getJSON(slug, 'updates.json');
  assert.ok(!u.connectRun && !(u.queue || []).length && !Object.keys(u.stale).length, 'nothing left waiting');
  assert.ok(u.connectDone.finished, 'the run says it finished');
  assert.ok(await P.getJSON(slug, 'private/brief.json', null), 'the private brief is saved');
  const view = await b.updates(slug, { member: false });
  assert.equal(view.connect, null, 'visitors never see the team’s run');

  await b.liveConnected(slug, 'shopify', SHOP, true, { public: false }); /* the daily resync: same numbers */
  await settle(); assert.equal(runs.length, 1, 'a resync does not rewrite everything again');
  await b.liveConnected(slug, 'shopify', [], false, { public: false }); /* disconnect */
  await settle(); assert.equal(runs.length, 1, 'a disconnect does not either');
});

test('a simulated account never starts a run', async () => {
  const { b, P, slug, runs } = await brand();
  await b.liveConnected(slug, 'shopify', SHOP.map((e) => ({ ...e, demo: true })), true, { public: false });
  await settle();
  assert.equal(runs.length, 0);
  assert.equal(await P.getJSON(slug, 'private/profile-live.json', null), null);
});
