// the capability registry: shape, every move family covered, every listening platform present. Free.
// TREG_LIVE=1 also checks every declared treg endpoint exists in the live catalog (free, open GET).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPS, FAMILIES, STAGES, LISTEN_PLATFORMS, byFamily, byStage, probeFor, endpoints, watchCatalog } from '../treg-map.js';

const SETS = ['brand', 'rivals', 'category', 'owned'], CAD = ['daily', 'weekly', 'monthly', 'on-demand'], OUT = ['ledger', 'heard', 'asset'], PROV = ['treg', 'apify', 'local', 'vertex'];

test('every capability has the declared shape', () => {
  const ids = new Set();
  for (const c of CAPS) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or empty id ${c.id}`); ids.add(c.id);
    assert.ok(PROV.includes(c.provider), `${c.id} provider ${c.provider}`);
    assert.ok(typeof c.endpoint === 'string' && c.endpoint, `${c.id} endpoint`);
    assert.ok(Array.isArray(c.fallbacks), `${c.id} fallbacks`);
    assert.ok(c.stages.length && c.stages.every((s) => STAGES.includes(s)), `${c.id} stages ${c.stages}`);
    assert.ok(c.families.length && c.families.every((f) => FAMILIES.includes(f)), `${c.id} families ${c.families}`);
    assert.ok(SETS.includes(c.set), `${c.id} set ${c.set}`);
    assert.ok(CAD.includes(c.cadence), `${c.id} cadence ${c.cadence}`);
    assert.ok(OUT.includes(c.output), `${c.id} output ${c.output}`);
    assert.equal(typeof c.brandSees, 'boolean');
    assert.ok(c.label && c.label !== c.id && !/treg|tikhub|anyapi|dataforseo|crawl4ai|scrapecreators|spyfu|serper/i.test(c.label), `${c.id} label must be a plain brand-facing name: ${c.label}`);
    if (c.provider === 'treg') assert.match(c.endpoint, /^[a-z0-9-]+\.[\w.-]+$/, `${c.id} endpoint id`);
  }
});

test('every move family has at least one capability', () => {
  for (const f of FAMILIES) assert.ok(byFamily(f).length >= 1, `no capability for family ${f}`);
});

test('every listening platform is present', () => {
  for (const p of LISTEN_PLATFORMS) assert.ok(CAPS.some((c) => c.platform === p && c.families.includes('listening')), `listening platform ${p} missing`);
});

test('jam, connected and probe capabilities are declared', () => {
  for (const id of ['creators.search', 'creators.profile', 'creators.email-verify', 'image.gemini', 'video.seedance', 'voice.tts']) assert.ok(byStage('jam').some((c) => c.id === id), `jam ${id}`);
  for (const e of ['google-analytics.report', 'google-search-console.performance', 'instagram.instagram.account.insights', 'google-ads.x.gaql-campaign']) assert.ok(CAPS.some((c) => c.endpoint === e && c.set === 'owned'), `connected ${e}`);
  assert.ok(probeFor('seo').length && probeFor('seo')[0].set === 'owned', 'seo probes start with an owned source');
  assert.ok(probeFor('ai-seo').length);
});

test('watchCatalog lists new endpoints not in the registry (mocked catalog)', async () => {
  const today = new Date().toISOString().slice(0, 10), old = '2026-01-01', known = endpoints()[0];
  const fetchFn = async () => ({ ok: true, json: async () => ({ results: [{ id: 'newvendor.tiktok.new.thing', added: today, provider: 'newvendor', summary: 'new', cost: { usd: 0.001 } }, { id: known, added: today }, { id: 'oldvendor.x.old', added: old },
    { id: 'treg.thing.routed', kind: 'routed', added: old, routed_children: [{ id: 'kid.vendor.fresh', added: today }] }] }) });
  const r = await watchCatalog(null, { queries: ['tiktok', 'reviews'], fetchFn, log: { warn() {} } });
  assert.deepEqual(r.added.map((x) => x.id).sort(), ['kid.vendor.fresh', 'newvendor.tiktok.new.thing']);
  assert.ok(r.since <= today && r.known > 50);
});

test('live: every declared treg endpoint exists in the catalog', { skip: process.env.TREG_LIVE !== '1' }, async () => {
  const miss = [];
  await Promise.all(endpoints().map(async (id) => { const r = await fetch(`https://treg.to/catalog/endpoints/${id}`); if (!r.ok) miss.push(`${id} ${r.status}`); }));
  assert.deepEqual(miss, []);
  const w = await watchCatalog(null, { queries: ['tiktok', 'keyword volume'] }); console.log(`catalog watch: ${w.added.length} new since ${w.since}`, w.added.slice(0, 5).map((x) => x.id));
});
