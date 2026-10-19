// The card's making button, pressed in the feed (POST /api/changes/:chid/cta-make): it makes what it names, once per jam.
// Param, 19 Oct: "the CTA to generate creatives never generates, it simply changes the brief".
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
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cta-make-')); fs.mkdirSync(path.join(DIR, 'gen'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'balm.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
configureGen({ dir: path.join(DIR, 'gen'), remote: false, log: { warn() {} } });
const quiet = { warn() {}, log() {}, error() {} };
let k = 0; const fakeImage = async () => Buffer.from(`89504e470d0a1a0a${(++k).toString(16).padStart(4, '0')}`, 'hex');

const studio = (extra = {}) => {
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, claudeTool: null, geminiImage: fakeImage, mediaFake: true, PUB: DIR, LANE_PHOTO: { lane1: 'balm.png' }, FACTS: {}, SEED: { connectors: { meta: { name: 'Meta Ads' } }, colleagues: [] }, AGENT: { creative: 'Creative', storefront: 'Storefront' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => false, spend: () => true, uid: (p) => `${p}_${++n}`, now: (t) => Date.now() + (t?.clock || 0), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `$${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: quiet, ...extra });
  const call = (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p));
  return { R, RMX, call };
};
const tenant = (card) => ({ id: 't_1', brandId: 'acme', clock: 0, cards: new Map([[card.id, card]]), changes: {}, work: [], conn: {}, acted: new Set(), shown: {} });
const card = (o) => ({ id: 'c1', title: 'Warm paws all winter', sub: 'Cold hands, sorted. One balm, every morning.', agent: 'creative', sector: 'creatives', type: 'idea', lane: 'lane1', images: ['balm.png'], detail: { why: ['Searches for hand balm doubled this week'], how: ['Write the hook'] }, ...o });
const settle = async (ch, ms = 8000) => { const end = Date.now() + ms; await new Promise((r) => setTimeout(r, 30)); while (Date.now() < end && (ch.ctaPending || ch.ctaQueued || ch.imagePending || ch.copyPending)) await new Promise((r) => setTimeout(r, 25)); };
/* the jam opened from the button: the package first (as linkChange does), then the press */
const press = async (S, t, label) => { const r = await S.call('POST /api/cards/:cid/remix', { fast: true }, t, { cid: 'c1' }); const id = r.changes[0].id;
  const m = await S.call('POST /api/changes/:chid/cta-make', { label }, t, { chid: id }); return { id, m, ch: t.changes[id] }; };

test('Make the ad (and an old Generate versions card) makes ONE ad with its picture on the version on stage, never options', async () => {
  for (const label of ['Make the ad', 'Generate versions']) {
    const S = studio(), t = tenant(card({ cta: { label }, make: { format: 'single image ad', pieces: 'The balm on a frosty windowsill' } }));
    const { id, m, ch } = await press(S, t, label); assert.equal(m.making, true);
    await settle(ch);
    const vs = versionsOf(t, id); assert.ok(!vs.some((v) => /^Version [ABC]/.test(v.reason || '')), `no options (${vs.map((v) => v.reason).join(' | ')})`);
    assert.equal(ch.options || null, null); assert.ok(/^gen\//.test(ch.pkg.image || ''), 'the one ad has a picture that was made');
    assert.ok(!ch.thread.some((x) => /options|versions:/i.test(x.text || '')), `no options in the chat: ${ch.thread.map((x) => x.text).join(' | ')}`);
    assert.ok(vs.filter((v) => /^gen\//.test(v.snapshot?.image || '')).length <= 1, 'one picture made, not one per option');
    const again = await S.call('POST /api/changes/:chid/cta-make', { label }, t, { chid: id });
    assert.equal(again.already, true); assert.equal(versionsOf(t, id).length, vs.length, 'the next press opens the jam, it never pays twice');
  }
});

test('Draft the post makes the picture, as a new version', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Draft the post' }, make: { format: 'instagram post', pieces: 'One post: the balm by a window' } }));
  const { id, m, ch } = await press(S, t, 'Draft the post'); assert.equal(m.making, true);
  await settle(ch);
  assert.ok(versionsOf(t, id).some((v) => /^gen\//.test(v.snapshot?.image || '')), 'a made picture is on a version');
  assert.equal(ch.ctaPending, null);
});

test('a decision button makes nothing; Add photos on a listing makes the photo set, not a written shot list', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Agree with the call' }, type: 'decision' }));
  const d = await press(S, t, 'Agree with the call'); assert.equal(d.m.making, false);
  const S2 = studio(), t2 = tenant(card({ agent: 'storefront', sector: 'catalog', title: 'Add photos to the balm listing', cta: { label: 'Add photos' } }));
  const { id, m, ch } = await press(S2, t2, 'Add photos'); assert.equal(m.making, true);
  await settle(ch);
  assert.equal(ch.family, 'listing');
  assert.ok((ch.pkg.photoSet || []).length >= 3, `the listing has its photos (${(ch.pkg.photoSet || []).length})`);
  assert.ok(ch.pkg.photoSet.every((x) => /^gen\//.test(x.image) && x.shot), 'each photo is made and named by its shot');
  assert.ok(versionsOf(t2, id).some((v) => (v.snapshot?.photoSet || []).length), 'it lands as a version');
});

// Param, 19 Oct: "if the video is already there, what does Make the video do?", then "lead with only 1 and let them redo it".
// A first draft that already has its clip is the one: the button makes nothing more and never films it again; Redo it makes
// one new take with its own new clip, and the first draft stays in History
test('Make the video on a first draft that has its clip makes nothing more; Redo it makes one new take, filmed', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Make the video' }, make: { format: 'reel', pieces: 'The balm in a cold hand' } }));
  const r = await S.call('POST /api/cards/:cid/remix', { fast: true }, t, { cid: 'c1' }); const id = r.changes[0].id, ch = t.changes[id];
  ch.v0 = 'draft'; ch.pkg = { ...ch.pkg, video: 'gen/first.mp4', image: 'gen/first.png' }; versionsOf(t, id)[0].snapshot = { ...versionsOf(t, id)[0].snapshot, video: 'gen/first.mp4' };
  const n0 = versionsOf(t, id).length;
  await S.call('POST /api/changes/:chid/cta-make', { label: 'Make the video' }, t, { chid: id });
  await settle(ch);
  assert.equal(versionsOf(t, id).length, n0, 'nothing new: the first draft is the one'); assert.equal(ch.pkg.video, 'gen/first.mp4'); assert.ok(ch.planRun, 'the jam moves on');
  await S.call('POST /api/changes/:chid/more', {}, t, { chid: id });
  const vs = versionsOf(t, id); assert.equal(vs.length, n0 + 1, 'one new take');
  assert.equal(vs[0].snapshot.video, 'gen/first.mp4', 'the first draft keeps its clip in History');
  assert.notEqual(ch.pkg.video, 'gen/first.mp4', 'the new take never shows the old clip');
  assert.ok(ch.thread.some((x) => /^Redid it/.test(x.text || '')), ch.thread.map((x) => x.text).join(' | '));
});
