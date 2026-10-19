// v2 cards never wait on an asset (2026-10-18): POST /api/cards/:cid/remix {words:true} rewrites only the words and makes a version
// at once, no picture; {queue:true} makes the next version with drawing:true at once and draws in the background, landing the asset
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

test('words mode: new words, a new version at once, the why untouched, no asset drawn', async () => {
  const t = tenant(), { call, RMX } = studio();
  const r = await call('POST /api/cards/:cid/remix', { words: true, chip: 'Shorter' }, t, { cid: 'c1' });
  assert.equal(r.ok, true); assert.ok(r.versionId && r.changeId, 'a version of the card’s change');
  assert.ok(r.words.title && r.words.body, 'the new words come back');
  assert.notEqual(r.words.body, 'Cold hands, sorted. One balm, every morning.', 'the body was rewritten');
  const vs = versionsOf(t, r.changeId); assert.equal(vs.length, 2, 'the original, then the new words'); assert.equal(vs.at(-1).id, r.versionId);
  assert.equal(vs.at(-1).drawing, undefined); assert.equal(vs.at(-1).asset, undefined, 'no picture was made');
  assert.equal(RMX.v2.jobs.size, 0, 'nothing runs in the background');
  const c = t.cards.get('c1'); assert.deepEqual(c.detail.why, ['Searches for hand balm doubled this week'], 'the why is not touched');
  assert.equal(c.take.versionId, r.versionId); assert.equal(c.take.title, r.words.title); assert.equal(c.take.drawing, false, 'the card mirrors the version, so a reload shows the words');
  const g = await call('GET /api/changes/:chid', {}, t, { chid: r.changeId }); assert.equal(g.change.head, r.versionId); assert.equal(g.change.after.title, r.words.title, 'the studio opens on the same words');
  /* a chip's instruction is read literally and the words follow it */
  const lead = await call('POST /api/cards/:cid/remix', { words: true, chip: 'Lead with the balm' }, t, { cid: 'c1' });
  assert.match(lead.words.title, /^the balm: /i); assert.equal(versionsOf(t, r.changeId).length, 3, 'the same change, one more version');
  assert.ok(RMX.v2.updatedSince(t, 0).includes('c1'), 'the pulse learns the card changed');
});

test('words mode with set: words typed by hand land exactly as given, no model call, no spend; set wins over a prompt', async () => {
  let called = 0; const t = tenant(), { call } = studio({ isMock: () => false, spend: () => { called++; return false; }, claudeTool: async () => { called++; throw new Error('must not be called'); } });
  const r = await call('POST /api/cards/:cid/remix', { words: true, prompt: 'Shorter', set: { title: 'Hands that stay warm', body: 'One balm in the morning. That is the whole routine.' } }, t, { cid: 'c1' });
  assert.equal(r.ok, true); assert.deepEqual(r.words, { title: 'Hands that stay warm', body: 'One balm in the morning. That is the whole routine.' });
  assert.equal(called, 0, 'neither the model nor the budget was asked');
  const vs = versionsOf(t, r.changeId); assert.equal(vs.length, 2); assert.equal(vs.at(-1).author, 'you'); assert.equal(vs.at(-1).label, 'Your words');
  const c = t.cards.get('c1'); assert.equal(c.take.title, 'Hands that stay warm'); assert.deepEqual(c.detail.why, ['Searches for hand balm doubled this week']);
  /* one field alone keeps the other as it was; nothing typed is an error, not a version */
  const r2 = await call('POST /api/cards/:cid/remix', { words: true, set: { title: 'Warm hands, every morning' } }, t, { cid: 'c1' });
  assert.equal(r2.words.body, 'One balm in the morning. That is the whole routine.'); assert.equal(versionsOf(t, r.changeId).length, 3);
  const r3 = await call('POST /api/cards/:cid/remix', { words: true, set: { title: ' ', body: '' } }, t, { cid: 'c1' }); assert.match(r3.error, /Type a title or a body/); assert.equal(versionsOf(t, r.changeId).length, 3);
});

test('words mode: a refused text spend is an error with its reason, never a silent fallback', async () => {
  const t = tenant(), { call } = studio({ isMock: () => false, spend: () => false, claudeTool: async () => { throw new Error('must not be called'); } });
  const r = await call('POST /api/cards/:cid/remix', { words: true, chip: 'Warmer' }, t, { cid: 'c1' });
  assert.match(r.error, /text budget|share for today|used up/i); assert.equal(r.ok, undefined);
  assert.equal(versionsOf(t, r.changeId).length, 1, 'no version was made'); assert.equal(t.cards.get('c1').take, undefined);
});

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
  const first = await call('POST /api/cards/:cid/remix', { words: true, chip: 'Warmer' }, t, { cid: 'c1' });
  const r = await call('POST /api/cards/:cid/remix', { queue: true, take: true, prompt: 'Make it about mittens' }, t, { cid: 'c1' });
  assert.equal(r.queued, true); assert.equal(r.drawing, true); assert.equal(r.words, undefined, 'the reply never waits on the words (an AI call)');
  assert.ok(RMX.v2.jobs.has(r.versionId), 'the take is held while its words are written, so healTakes leaves it be');
  assert.equal(RMX.v2.healTakes(t), 0);
  const vs = versionsOf(t, r.changeId); assert.equal(vs.length, 3, 'one version for the take, not two');
  assert.equal(vs.find((x) => x.id === first.versionId).passed, true, 'the version passed over'); assert.equal(vs.at(-1).passed, undefined); assert.equal(vs.at(-1).take, true);
  assert.deepEqual(t.cards.get('c1').take.passed, [first.versionId]);
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
  assert.equal(v.drawing, false); assert.match(v.drawError, /restarted/); assert.equal(t.cards.get('c1').take.drawing, false); assert.match(t.cards.get('c1').take.drawError, /restarted/);
  assert.equal(fresh.RMX.v2.healTakes(t), 0, 'once');
  v.drawing = true; const g = await fresh.call('GET /api/changes/:chid', {}, t, { chid: r.changeId });
  assert.equal(g.change.versions.find((x) => x.id === r.versionId).drawing, undefined, 'loading the change resolves it too'); assert.match(v.drawError, /restarted/);
});

test('the existing remix bodies are untouched: no flags builds the studio’s packages as before', async () => {
  const t = tenant(), { call } = studio();
  const r = await call('POST /api/cards/:cid/remix', {}, t, { cid: 'c1' });
  assert.ok(Array.isArray(r.changes) && r.changes.length === 3, 'three packages'); assert.ok(r.line); assert.equal(r.queued, undefined); assert.equal(r.ok, undefined);
  assert.equal(t.cards.get('c1').take, undefined, 'no take mirror on the card');
});

test('the feed’s pulse hands out the updated card ids and heals stale takes (feed-service wiring)', () => {
  const src = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("on('GET', '/api/tenants/:id/pulse'"), src.indexOf("on('POST', '/api/tenants/:id/events'"));
  assert.match(route, /RMX\?\.v2\?\.healTakes\(t\)/); assert.match(route, /updated = RMX\?\.v2\?\.updatedSince\(t, since\)/); assert.match(route, /\bupdated,/, 'the reply carries `updated`');
  assert.match(route, /ids: fresh\.map/, 'brand-new cards stay in `ids`');
});

test('peek: Make it yours opens on the words Save writes to, builds and spends nothing, never hands back a rival poster', async () => {
  const t = tenant(), { call } = studio();
  const n0 = Object.keys(t.changes || {}).length;
  const r = await call('POST /api/cards/:cid/remix', { peek: true }, t, { cid: 'c1' });
  assert.ok(r.words && (r.words.title || r.words.body), 'the words a first take starts from');
  assert.equal(Object.keys(t.changes || {}).length, n0, 'opening the sheet builds no change');
  const s = await call('POST /api/cards/:cid/remix', { words: true, set: { title: 'Soft on cold mornings', body: 'Warm paws, all walk long.' } }, t, { cid: 'c1' });
  const r2 = await call('POST /api/cards/:cid/remix', { peek: true }, t, { cid: 'c1' });
  assert.deepEqual(r2.words, { title: 'Soft on cold mornings', body: 'Warm paws, all walk long.' }); assert.equal(r2.changeId, s.changeId);
  /* a picture of theirs on the change (an old one, or a pick) is never what the sheet shows as ours */
  t.changes[s.changeId].pkg.image = 'research/abc123.jpg'; t.changes[s.changeId].headVersionId = null;
  const r3 = await call('POST /api/cards/:cid/remix', { peek: true }, t, { cid: 'c1' });
  assert.ok(!r3.image || !/^research\//.test(r3.image));
});
