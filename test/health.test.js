// The health rings are scored from what the read found (health.js): every part names its evidence, a part or ring that
// couldn't be read is left out (never scored as zero), and a saved simulated score is replaced at load. Generic, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.REFRESH_AUTO = '0';
const { healthFrom, HEALTH_V, geoOf, pageSpeed } = await import('../health.js');
const { createPacks } = await import('../brand-pack.js');
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), quiet = { log() {}, warn() {}, error() {}, info() {} };

const ad = (hook, video = false) => ({ hook, ...(video ? { format: 'video' } : {}) });
const walked = (o = {}) => ({ v: 3, steps: 5, clicks: 2, guest: true, payments: ['UPI', 'Cards', 'COD'], direct: false, walk: [{ step: 'Checkout entry', ok: true }], ...o });
const brand = (o = {}) => ({ url: 'https://acme.in', host: 'acme.in', slug: 'acme-in', name: 'Acme',
  catalog: { count: 2, products: [{ handle: 'a', images: ['1', '2', '3', '4'] }, { handle: 'b', images: ['1'] }] },
  ads: { own: { page: 'Acme', live: 40, items: [ad('Hook one'), ad('Hook two', true), ad('Hook three'), ad('Hook four')] }, rivals: [{ name: 'R1', live: 20, items: [] }, { name: 'R2', live: 60, items: [] }], at: '2026-10-16' },
  site: { checkout: walked(), pagespeed: { score: 42, lcp: '4.1 s', at: '2026-10-16' } },
  reviews: { total: 300, platforms: [{ name: 'Judge.me', count: 120 }, { name: 'Amazon', count: 5000 }] },
  ai: { score: { named: 14, of: 30, unbrandedNamed: 4, unbrandedOf: 20 } }, ...o });
const ring = (h, k) => h.rings.find((r) => r.k === k);

test('every ring is scored from the read, with its evidence, and nothing says Simulated', () => {
  const h = healthFrom(brand());
  assert.equal(h.v, HEALTH_V); assert.ok(!h.dummy); assert.ok(h.rings.every((r) => r.read));
  assert.doesNotMatch(JSON.stringify(h), /simulat/i);
  const cr = ring(h, 'Creative');
  assert.ok(cr.v <= 85, 'public ads never score past 85');
  assert.match(cr.parts.find((p) => p.k === 'Volume').note, /40 live against a rival median of 60/);
  assert.equal(cr.parts.find((p) => p.k === 'Formats').note, 'video and image');
  const st = ring(h, 'Storefront');
  assert.match(st.parts.find((p) => p.k === 'Mobile speed').note, /PageSpeed 42/);
  assert.match(st.parts.find((p) => p.k === 'Reviews on the site').note, /^120 on the site \(marketplaces not counted\)/);
  assert.equal(st.parts.find((p) => p.k === 'Payment options').v, 10);
  const ai = ring(h, 'AI answers');
  assert.equal(ai.parts[0].note, '4 of 20 answers'); assert.equal(ai.parts[1].note, '10 of 10 answers');
  assert.equal(ai.v, Math.round(85 * 4 / 20) + 15);
  assert.equal(h.score, Math.round((cr.v + st.v + ai.v) / 3));
  assert.ok(h.moves.length && h.moves.length <= 3 && h.moves.every((m) => m.k && m.t));
  assert.deepEqual(geoOf(h), { score: ai.v, band: ai.v >= 60 ? 'Good' : ai.v >= 35 ? 'Fair' : 'Low' });
});

test('ads that couldn’t be read leave Creative unread and out of the score; an error is never "no ads"', () => {
  const h = healthFrom(brand({ ads: { own: { page: null, live: null, items: [], error: 'treg 402' }, rivals: [] } }));
  const cr = ring(h, 'Creative');
  assert.equal(cr.read, false); assert.match(cr.what, /couldn’t be read/); assert.doesNotMatch(cr.what, /No live ads/);
  const rd = h.rings.filter((r) => r.read); assert.equal(h.score, Math.round(rd.reduce((a, r) => a + r.v, 0) / rd.length));
  const none = ring(healthFrom(brand({ ads: { own: { page: 'Acme', live: 0, items: [] }, rivals: [] } })), 'Creative');
  assert.equal(none.read, true); assert.equal(none.v, 0); assert.match(none.what, /No live ads/);
});

test('the walk only counts what it saw: a stopped walk or a checkout opened by URL scores no payments or guest part', () => {
  for (const co of [walked({ walk: [{ step: 'Cart', ok: true }], payments: [], guest: null }), walked({ direct: true, payments: [], guest: false }), { v: 3, error: 'no Chrome on this machine' }]) {
    const st = ring(healthFrom(brand({ site: { checkout: co } })), 'Storefront'), ks = st.parts.map((p) => p.k);
    assert.ok(!ks.includes('Payment options') && !ks.includes('Guest checkout'), JSON.stringify(co));
    assert.ok(!ks.includes('Mobile speed'), 'no PageSpeed read, no speed part');
  }
  const seenNone = ring(healthFrom(brand({ site: { checkout: walked({ payments: [] }) } })), 'Storefront');
  assert.ok(!seenNone.parts.some((p) => p.k === 'Payment options'), 'payments not shown yet is not 0 of 10');
});

test('AI answers not read is shown as not read, never full marks', () => {
  const h = healthFrom(brand({ ai: null }));
  assert.equal(ring(h, 'AI answers').read, false); assert.equal(geoOf(h), null);
  const empty = healthFrom({ name: 'X' });
  assert.ok(empty.rings.every((r) => !r.read)); assert.equal(empty.score, 0);
});

test('PageSpeed: a failed call is kept as an error, never a score', async () => {
  const bad = await pageSpeed('https://acme.in', { fetchImpl: async () => ({ ok: false, status: 429 }), log: quiet });
  assert.ok(bad.error && bad.score == null);
  const ok = await pageSpeed('https://acme.in', { fetchImpl: async () => ({ ok: true, json: async () => ({ lighthouseResult: { categories: { performance: { score: 0.37 } }, audits: { 'largest-contentful-paint': { displayValue: '5.0 s' } } } }) }), log: quiet });
  assert.equal(ok.score, 37); assert.equal(ok.lcp, '5.0 s');
});

test('a saved simulated score is replaced at load for every brand, no rebuild', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-health-'));
  const P = createPacks({ ROOT, PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet }), slug = 'acme-in';
  await P.put(slug, 'status.json', { name: 'Acme', host: 'acme.in', done: true, ready: true });
  await P.put(slug, 'profile.json', brand()); await P.put(slug, 'moves.json', {});
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [],
    health: { v: 'dummy-2', dummy: true, delta: 4, score: 61, rings: [{ k: 'Creative', v: 61, what: 'Simulated score', src: 'Simulated (Dummy)' }] } });
  await P.load(slug, { fresh: true });
  const seed = await P.getJSON(slug, 'seed.json');
  assert.equal(seed.health.v, HEALTH_V); assert.ok(!seed.health.dummy); assert.equal(seed.health.delta, 0, 'a simulated delta is not carried');
  assert.doesNotMatch(JSON.stringify(seed.health), /simulat/i); assert.equal(seed.geo.score, ring(seed.health, 'AI answers').v);
});
