// Another take never waits on an asset (2026-10-18): POST /api/cards/:cid/remix {queue:true} makes the next version with
// drawing:true at once and draws in the background, landing the asset
// (or a drawError) on that version and on the card's `take` mirror, which the feed's pulse reports as `updated`. take:true marks the
// previous version passed. Free: AI_MOCK words, a stand-in image maker, a temp dir for the gen store, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemix } from '../remix.js';
import { versionsOf } from '../learn.js';
import { configureGen } from '../gen-store.js';
import { runIn } from '../brand-ctx.js';

process.env.AI_MOCK = '1';
const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', sym: '$', config: { product: { noun: 'balm' } }, seed: { brand: { name: 'Acme', host: 'acme.com' } } };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-remix-')); fs.mkdirSync(path.join(DIR, 'gen'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'balm.png'), Buffer.from('89504e470d0a1a0a', 'hex')); /* the lane's product photo, as a file */
configureGen({ dir: path.join(DIR, 'gen'), remote: false, log: { warn() {} } });
const quiet = { warn() {}, log() {}, error() {} };

/* a studio on a bare workspace, as jam-team.test.js builds one; extra: the image maker and the spend answer under test */
const studio = (extra = {}) => {
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, claudeTool: null, geminiImage: null, PUB: DIR, LANE_PHOTO: { lane1: 'balm.png' }, FACTS: {}, SEED: { connectors: { meta: { name: 'Meta Ads' } }, colleagues: [] }, AGENT: { creative: 'Creative' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => true, spend: () => true, uid: (p) => `${p}_${++n}`, now: (t) => Date.now() + (t?.clock || 0), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `$${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: quiet, ...extra });
  const call = (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p));
  return { R, RMX, call };
};
const tenant = () => ({ id: 't_1', brandId: 'acme', clock: 0, cards: new Map([['c1', { id: 'c1', title: 'Warm paws all winter', sub: 'Cold hands, sorted. One balm, every morning.', agent: 'creative', sector: 'creatives', type: 'idea', lane: 'lane1', detail: { why: ['Searches for hand balm doubled this week'] } }]]), changes: {}, work: [], conn: {}, acted: new Set(), shown: {} });
const fakeImage = async () => Buffer.from('89504e470d0a1a0a', 'hex');




test('queue mode: returns at once with drawing:true; the picture lands later on that version and the pulse reports the card', async () => {
  const t = tenant(), onMedia = [], { call, RMX } = studio({ geminiImage: fakeImage, mediaFake: true, onMedia: (t2, ch, m) => onMedia.push(m) });
  const since = Date.now() - 1;
  const t1 = Date.now(), r = await call('POST /api/cards/:cid/remix', { queue: true }, t, { cid: 'c1' });
  assert.ok(Date.now() - t1 < 800, 'the reply does not wait on the picture');
  assert.equal(r.queued, true); assert.equal(r.drawing, true); assert.equal(r.drawError, undefined); assert.ok(r.versionId);
  const v = versionsOf(t, r.changeId).find((x) => x.id === r.versionId); assert.equal(v.drawing, true); assert.equal(v.asset, undefined);
  assert.equal(t.cards.get('c1').take.drawing, true, 'the card shows the corner badge');
  assert.equal(RMX.v2.jobs.size, 1, 'one draw in flight');
  const pubV = (await call('GET /api/changes/:chid', {}, t, { chid: r.changeId })).change.versions.find((x) => x.id === r.versionId); assert.equal(pubV.drawing, true, 'the studio sees it drawing too');
  await RMX.v2.settle();
  assert.equal(v.drawing, false); assert.equal(v.drawError, null); assert.match(v.asset?.url, /^gen\/[a-f0-9]{16}\.png$/); assert.equal(v.snapshot.image, v.asset.url);
  assert.ok(fs.existsSync(path.join(DIR, 'gen', path.basename(v.asset.url))), 'the picture is a real file in the gen store');
  const c = t.cards.get('c1'); assert.equal(c.take.drawing, false); assert.equal(c.take.image, v.asset.url); assert.equal(c.take.versionId, v.id);
  assert.deepEqual(RMX.v2.updatedSince(t, since), ['c1'], 'the pulse lists the card as updated'); assert.deepEqual(RMX.v2.updatedSince(t, Date.now() + 1), [], 'and only since the clock asked for');
  assert.equal(onMedia.length, 1, 'the asset went where the jam is');
  assert.equal(RMX.v2.jobs.size, 0); assert.equal(t.changes[r.changeId].imagePending, false);
  const pubV2 = (await call('GET /api/changes/:chid', {}, t, { chid: r.changeId })).change.versions.find((x) => x.id === r.versionId); assert.equal(pubV2.drawing, undefined); assert.deepEqual(pubV2.asset, v.asset);
});

test('take:true answers at once, marks the previous version passed, then rewrites the words and draws the new take in the background', async () => {
  const t = tenant(), { call, RMX } = studio({ geminiImage: fakeImage, mediaFake: true });
  const first = await call('POST /api/cards/:cid/remix', { queue: true, take: true }, t, { cid: 'c1' }); await RMX.v2.settle();
  const r = await call('POST /api/cards/:cid/remix', { queue: true, take: true, prompt: 'Make it about mittens' }, t, { cid: 'c1' });
  assert.equal(r.queued, true); assert.equal(r.drawing, true); assert.equal(r.words, undefined, 'the reply never waits on the words (an AI call)');
  assert.ok(RMX.v2.jobs.has(r.versionId), 'the take is held while its words are written, so healTakes leaves it be');
  assert.equal(RMX.v2.healTakes(t), 0);
  const vs = versionsOf(t, r.changeId); assert.equal(vs.length, 3, 'one version for the take, not two');
  assert.equal(vs.find((x) => x.id === first.versionId).passed, true, 'the version passed over'); assert.equal(vs.at(-1).passed, undefined); assert.equal(vs.at(-1).take, true);
  assert.equal(t.cards.get('c1').take.passed.at(-1), first.versionId, 'the take passed over is the last one passed');
  const pub = (await call('GET /api/changes/:chid', {}, t, { chid: r.changeId })).change; assert.equal(pub.versions.find((x) => x.id === first.versionId).passed, true);
  await RMX.v2.settle();
  assert.equal(vs.at(-1).drawing, false); assert.ok(vs.at(-1).asset?.url);
  assert.match(t.cards.get('c1').take.body, /mittens/i, 'the typed prompt shaped the words, on the take the card carries');
  assert.match(vs.at(-1).snapshot.sub || JSON.stringify(vs.at(-1).snapshot), /mittens/i, 'and on the version itself');
});

test('a failing generator: the version ends with drawing:false and a drawError, the card and the pulse carry it', async () => {
  const t = tenant(), { call, RMX } = studio({ geminiImage: async () => { throw new Error('vertex 500'); }, mediaFake: true });
  t.cards.get('c1').title = 'Soft hands, no fuss'; /* its own brief: a picture already in the gen store comes back free, and this test wants the maker called */
  const r = await call('POST /api/cards/:cid/remix', { queue: true }, t, { cid: 'c1' });
  assert.equal(r.drawing, true);
  await RMX.v2.settle();
  const v = versionsOf(t, r.changeId).find((x) => x.id === r.versionId);
  assert.equal(v.drawing, false); assert.match(v.drawError, /vertex 500/); assert.equal(v.asset, undefined);
  const c = t.cards.get('c1'); assert.equal(c.take.drawing, false); assert.match(c.take.drawError, /vertex 500/);
  assert.ok(RMX.v2.updatedSince(t, 0).includes('c1'));
  /* a refusal known at once (AI offline, no stand-in): said in the reply, the version still holds the words */
  const t2 = tenant(), off = studio();
  const r2 = await off.call('POST /api/cards/:cid/remix', { queue: true }, t2, { cid: 'c1' });
  assert.equal(r2.queued, true); assert.equal(r2.drawing, false); assert.match(r2.drawError, /offline/);
  assert.equal(off.RMX.v2.jobs.size, 0);
  /* a refused image spend: the real reason */
  const t3 = tenant(), broke = studio({ geminiImage: fakeImage, mediaFake: true, spend: (k) => k !== 'image' });
  const r3 = await broke.call('POST /api/cards/:cid/remix', { queue: true }, t3, { cid: 'c1' });
  assert.equal(r3.drawing, false); assert.match(r3.drawError, /picture limit|share for today|used up/i);
});

test('a take left drawing by a server that stopped resolves to a drawError on the next load, pulse or v2 call, never hangs', async () => {
  const t = tenant(), { call, RMX } = studio({ geminiImage: fakeImage, mediaFake: true });
  const r = await call('POST /api/cards/:cid/remix', { queue: true }, t, { cid: 'c1' }); await RMX.v2.settle();
  /* the same workspace in a fresh process: the draw is not running here */
  const v = versionsOf(t, r.changeId).find((x) => x.id === r.versionId); v.drawing = true; v.drawError = null; delete v.asset; t.cards.get('c1').take.drawing = true;
  const fresh = studio({ geminiImage: fakeImage, mediaFake: true });
  assert.equal(fresh.RMX.v2.healTakes(t), 1, 'the pulse’s heal resolves it');
  assert.equal(v.drawing, false); assert.match(v.drawError, /restart/); assert.equal(t.cards.get('c1').take.drawing, false); assert.match(t.cards.get('c1').take.drawError, /restart/);
  assert.equal(fresh.RMX.v2.healTakes(t), 0, 'once');
  v.drawing = true; const g = await fresh.call('GET /api/changes/:chid', {}, t, { chid: r.changeId });
  assert.equal(g.change.versions.find((x) => x.id === r.versionId).drawing, undefined, 'loading the change resolves it too'); assert.match(v.drawError, /restart/);
});

test('the existing remix bodies are untouched: no flags builds the studio’s packages as before', async () => {
  const t = tenant(), { call } = studio();
  const r = await call('POST /api/cards/:cid/remix', {}, t, { cid: 'c1' });
  assert.ok(Array.isArray(r.changes) && r.changes.length === 1, 'one package, always'); assert.ok(r.line); assert.equal(r.queued, undefined); assert.equal(r.ok, undefined);
  assert.equal(t.cards.get('c1').take, undefined, 'no take mirror on the card');
});

test('the feed’s pulse hands out the updated card ids and heals stale takes (feed-service wiring)', () => {
  const src = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("on('GET', '/api/tenants/:id/pulse'"), src.indexOf("on('POST', '/api/tenants/:id/events'"));
  assert.match(route, /RMX\?\.v2\?\.healTakes\(t\)/); assert.match(route, /updated = RMX\?\.v2\?\.updatedSince\(t, since\)/); assert.match(route, /\bupdated,/, 'the reply carries `updated`');
  assert.match(route, /ids: fresh\.map/, 'brand-new cards stay in `ids`');
});

