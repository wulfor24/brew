// The reading screen's questions, server side (2026-10-18): the reader's "picks" (the taps: products, rivals, who you are) saved
// with the findings and streamed to the setup screen, and their replay for a brand read earlier. No paid calls, no public network.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.REFRESH_AUTO = '0'; process.env.DEMO_MODE = '';
const { followRead } = await import('../feed-service.js');
const { createBuilder } = await import('../build.js');
const { createPacks } = await import('../brand-pack.js');
const { catalog } = await import('../reader/stages/catalog.js');
const { brand, whoOf } = await import('../reader/stages/brand.js');
const { findRivals } = await import('../reader/stages/ads.js');
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const quiet = { log() {}, warn() {}, error() {}, info() {} };

/* ---------- 1. the setup stream forwards the reader's picks ---------- */
const fakeBuilder = (events, status) => { const ls = new Set();
  return { events: () => events, status: async () => status, subscribe: (_s, f) => { events.forEach(f); ls.add(f); return () => ls.delete(f); }, emit: (e) => { events.push(e); ls.forEach((f) => f(e)); } }; };
test('followRead forwards a picks event as {type:"picks", k, items}', async () => {
  const items = [{ handle: 'serum', title: 'Serum', price: '₹499', img: null }];
  const ev = [{ type: 'reader', ev: { type: 'step', k: 'catalog', state: 'reading' } }, { type: 'reader', ev: { type: 'picks', k: 'catalog', items } }, { type: 'reader', ev: { type: 'picks', k: 'rivals', items: { error: 'paid sources off' } } }, { type: 'reader', ev: { type: 'step', k: 'catalog', state: 'done', done: '3 products' } }, { type: 'read-done' }];
  const out = await new Promise((res) => { const o = []; followRead({ builder: fakeBuilder(ev, { stages: { read: { state: 'done' } } }), slug: 'x', loadSeed: async () => ({}), replayMs: 0, send: (e) => { o.push(e); if (e.type === 'ready') res(o); } }); });
  assert.deepEqual(out.filter((e) => e.type === 'picks'), [{ type: 'picks', k: 'catalog', items }, { type: 'picks', k: 'rivals', items: { error: 'paid sources off' } }]);
  assert.ok(out.findIndex((e) => e.type === 'picks') < out.findIndex((e) => e.type === 'step' && e.state === 'done'), 'picks arrive as they are found, before the step closes');
});

/* ---------- 2. a brand read earlier replays its saved picks after the step that found them ---------- */
test('replayRead emits findings.picks: who after brand, catalog after catalog, the rest after the last step', { timeout: 20e3 }, async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-v2-replay-'));
  const P = createPacks({ ROOT, PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
  const modules = { reader: { createReader: () => ({ read: async () => { throw new Error('not called'); } }) }, brief: { createBrief: () => ({ write: async () => ({}) }) }, moves: { SPECS: [], createMovesEngine: () => ({ runAll: async () => ({}) }) }, pdf: null };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {}, call: async () => { throw Object.assign(new Error('mock'), { mock: true }); } }, treg: { onCharge() {} }, log: quiet, modules });
  assert.equal(typeof b.replayRead, 'function');
  const seen = []; b.subscribe('acme-in', (e) => { if (e.type === 'reader') seen.push(e.ev); });
  const who = { name: 'Acme', descriptor: 'Clean skincare', category: 'Skin care', country: 'IN', currency: 'INR' }, cat = [{ handle: 'serum', title: 'Serum', price: '₹499', img: null }];
  await b.replayRead('acme-in', { steps: [{ k: 'open', done: 'Opened', state: 'done' }, { k: 'brand', done: '1 logo', state: 'done' }, { k: 'catalog', done: '3 products', state: 'done' }], cards: [], picks: { who, catalog: cat, rivals: { error: 'rival search failed' } } });
  const at = (f) => seen.findIndex(f), stepDone = (k) => at((e) => e.type === 'step' && e.k === k && e.state === 'done');
  assert.equal(seen.filter((e) => e.type === 'picks').length, 3, 'each key once');
  assert.ok(at((e) => e.type === 'picks' && e.k === 'who') > stepDone('brand') && at((e) => e.type === 'picks' && e.k === 'who') < stepDone('catalog'), 'who follows the brand step');
  assert.ok(at((e) => e.type === 'picks' && e.k === 'catalog') > stepDone('catalog'), 'catalog follows the catalog step');
  assert.deepEqual(seen.at(-1), { type: 'picks', k: 'rivals', items: { error: 'rival search failed' } }, 'a key whose step was not replayed comes last, error kept');
  assert.deepEqual(seen.find((e) => e.type === 'picks' && e.k === 'catalog').items, cat);
  await b.replayRead('acme-in', { steps: [{ k: 'open', done: 'Opened', state: 'done' }], cards: [] }); /* a read saved before picks existed replays as before */
});

/* ---------- 3. the stages send the taps the check page would show, from the same fields ---------- */
const stageCtx = (profile, state, http) => { const picks = {}; return { picks, ctx: { http, ledger: { add() {} }, profile, state, log: quiet, tick() {}, finding() {}, done() {}, asset: async () => null, saveAsset: async () => null, slug: 'acme-in', picks: (k, items) => { picks[k] = items; } } }; };
test('catalog picks: the first 12 products, hero first, the check page price label, no gift cards; never sent without products', async () => {
  const sp = (handle, price, extra = {}) => ({ id: handle, handle, title: handle[0].toUpperCase() + handle.slice(1), product_type: 'Serum', vendor: 'Acme', variants: [{ price, available: true, compare_at_price: null }], images: [{ src: `https://cdn.acme.in/${handle}.jpg` }], published_at: '2026-01-01', tags: [], body_html: '', ...extra });
  const products = [sp('gift-card', '500.00', { title: 'Gift Card' }), sp('serum', '499.00'), sp('cleanser', '299.00'), sp('kit', '899.00', { title: 'Starter Kit' })];
  const http = { get: async (u) => (/products\.json/.test(u) ? { ok: true, json: { products } } : /collections\.json/.test(u) ? { ok: true, json: { collections: [] } } : { ok: false }) };
  const { picks, ctx } = stageCtx({ platform: 'shopify', currency: 'INR', locale: 'en-IN', host: 'acme.in', name: 'Acme' }, { origin: 'https://acme.in', home: '', homeUrl: 'https://acme.in/' }, http);
  await catalog(ctx);
  assert.ok(Array.isArray(picks.catalog)); assert.ok(picks.catalog.length >= 2 && picks.catalog.length <= 12);
  assert.ok(!picks.catalog.some((p) => /gift card/i.test(p.title)), 'the check page leaves gift cards out');
  assert.deepEqual(Object.keys(picks.catalog[0]).sort(), ['handle', 'img', 'price', 'title']);
  assert.deepEqual(picks.catalog.map((p) => p.handle).slice(0, 2), ['serum', 'cleanser'], 'singles before the kit, as the check page ranks hero products');
  assert.equal(picks.catalog[0].price, '₹499'); assert.equal(picks.catalog[0].img, 'https://cdn.acme.in/serum.jpg');
  const none = stageCtx({ platform: 'shopify', currency: 'INR', host: 'acme.in', name: 'Acme' }, { origin: 'https://acme.in', home: '', homeUrl: 'https://acme.in/', pageUrls: [], homeLinks: [] }, { get: async () => ({ ok: false }) });
  await catalog(none.ctx); assert.equal(none.picks.catalog, undefined, 'no products: no catalog picks (the step says so)');
});
test('who picks: name, line, category, market and currency as the check page reads them', async () => {
  const home = '<html><head><title>Acme</title><meta name="description" content="Clean skincare for Indian skin."></head><body><header><a href="/">Acme</a></header><h1>Skin that breathes</h1></body></html>';
  const { picks, ctx } = stageCtx({ name: 'Acme', host: 'acme.in', country: 'IN', currency: 'INR', descriptor: null, identity: {} }, { home, homeUrl: 'https://acme.in/', origin: 'https://acme.in' }, { get: async () => ({ ok: false }) });
  await brand(ctx);
  assert.deepEqual(picks.who, { name: 'Acme', descriptor: 'Clean skincare for Indian skin.', category: null, country: 'IN', currency: 'INR' });
  assert.deepEqual(whoOf({ name: 'Acme', tagline: 'Skin that breathes', category: 'Skin care' }), { name: 'Acme', descriptor: 'Skin that breathes', category: 'Skin care', country: null, currency: null }, 'the tagline stands in for the line, as on the check page');
});
test('rivals picks: a search that did not go through is {error}, never []', async () => {
  const { picks, ctx } = stageCtx({ name: 'Acme', host: 'acme.in', country: 'IN', rivals: [] }, { origin: 'https://acme.in' }, { get: async () => ({ ok: false }) });
  ctx.tregOn = false; ctx.aiOn = false; await findRivals(ctx);
  assert.deepEqual(picks.rivals, { error: 'paid sources off' });
  const kept = stageCtx({ name: 'Acme', host: 'acme.in', country: 'IN', rivals: [] }, { origin: 'https://acme.in' }, { get: async () => ({ ok: false }) });
  kept.ctx.tregOn = false; kept.ctx.aiOn = true; kept.ctx.prev = { rivals: [{ name: 'Rival Co', host: 'rival.co', why: 'same shelf', how: 'web search (cited)' }] };
  await findRivals(kept.ctx);
  assert.deepEqual(kept.picks.rivals, [{ host: 'rival.co', name: 'Rival Co', logo: 'https://www.google.com/s2/favicons?domain=rival.co&sz=64', how: 'web search (cited)' }], 'a rival kept from the first read keeps how it was found');
});

