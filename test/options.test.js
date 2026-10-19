// One, always (Param, 19 Oct, later the same day: "let's not give 3 options anywhere: lead with only 1 and let them redo it").
// New jams never make options; jams saved with options (the earlier "3 options, pick one") still heal and still work: cuts are tabs named by their angle, a pick folds the others away, a clip lands in its own option
// and never as a new "Video added" version, and jams saved before this heal.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { versionsOf } from '../learn.js';
import { createRemix } from '../remix.js';
import { runIn } from '../brand-ctx.js';

const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', sym: '$', config: { product: { noun: 'balm' } }, seed: { brand: { name: 'Acme', host: 'acme.com' } } };
const studio = () => {
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, claudeTool: null, geminiImage: null, PUB: os.tmpdir(), LANE_PHOTO: {}, FACTS: {}, SEED: { connectors: {}, colleagues: [] }, AGENT: { creative: 'Creative' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => true, spend: () => true, uid: (p) => `${p}_${++n}`, now: () => Date.now(), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `$${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: { warn() {}, log() {} } });
  return { R, RMX, call: (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p)) };
};
const tenant = () => ({ id: 't_1', brandId: 'acme', cards: new Map([['c1', { id: 'c1', title: 'Warm paws all winter', sub: 'Lead with cold hands', agent: 'creative', sector: 'creatives' }]]), changes: {}, work: [], conn: {}, acted: new Set() });
const change = (id, x = {}) => ({ id, cardId: 'c1', agent: 'creative', action: 'creative.add_variants', actionLabel: 'Add to the live test', family: 'meta_ad', target: { conn: 'meta', name: 'Meta Ads', object: 'Test ad' }, scope: [{ n: 1, label: 'One ad' }], before: { title: 'Warm paws' }, after: { title: 'Warm paws' }, state: 'draft', thread: [], pkg: { headline: 'Warm paws', primaryText: 'Cold hands, sorted.', knobs: {} }, createdAt: 1, ...x });

test('one, always (Param, 19 Oct): "three cuts of this ad" makes one new take on the stage, never options to pick from', async () => {
  const t = tenant(); t.changes.ch_1 = change('ch_1'); const { call } = studio();
  await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' }); const n0 = versionsOf(t, 'ch_1').length;
  const r = await call('POST /api/changes/:chid/iterate', { message: 'Three cuts of this ad' }, t, { chid: 'ch_1' });
  assert.equal(versionsOf(t, 'ch_1').length, n0 + 1, 'one new take'); assert.equal(r.change.options, null, 'no options');
  assert.equal(r.change.head, versionsOf(t, 'ch_1').at(-1).id, 'the new take is on the stage');
  assert.match(r.change.thread.at(-1).text, /^Redid it/);
});

test('a clip made for one option of an old jam lands in that option only, never as a new version and never on the option on stage', async () => {
  const t = tenant(); const { call, RMX } = studio();
  t.changes.ch_1 = change('ch_1', { headVersionId: 'v4' });
  t.vg = { ch_1: [{ id: 'v1', n: 1, at: 1, reason: 'The first draft on the card', label: 'First draft', snapshot: { headline: 'First' } },
    { id: 'v2', n: 2, at: 2, parentVersionId: 'v1', reason: 'Version A: cold hands', snapshot: { headline: 'A' } },
    { id: 'v3', n: 3, at: 3, parentVersionId: 'v1', reason: 'Version B: the desk', snapshot: { headline: 'B' } },
    { id: 'v4', n: 4, at: 4, parentVersionId: 'v1', reason: 'Version C: the commute', snapshot: { headline: 'C' } }] };
  const r = await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  const [A, , C] = r.change.options.list; await call('POST /api/changes/:chid/options/pick', { opt: A.id, use: false }, t, { chid: 'ch_1' });
  const n0 = versionsOf(t, 'ch_1').length, ch = t.changes.ch_1, vC = versionsOf(t, 'ch_1').find((v) => v.id === C.id);
  const place = RMX.landMedia(t, ch, vC, { video: 'gen/c.mp4', poster: 'gen/c.png' });
  assert.equal(place.onStage, false); assert.equal(versionsOf(t, 'ch_1').length, n0, 'no “Video added” version');
  assert.equal(ch.pkg.video, undefined, 'option A on the stage keeps its own media'); assert.equal(vC.snapshot.video, 'gen/c.mp4');
  const vA = versionsOf(t, 'ch_1').find((v) => v.id === A.id); const on = RMX.landMedia(t, ch, vA, { video: 'gen/a.mp4' });
  assert.equal(on.onStage, true); assert.equal(ch.pkg.video, 'gen/a.mp4');
});

test('a jam saved before options heals: v2–v4 are the options, the old “Video added” copy folds away and the stage goes to the option whose clip it carried', async () => {
  const t = tenant(); const { call } = studio();
  t.changes.ch_1 = change('ch_1', { action: 'creative.short_video', family: 'post', headVersionId: 'v5', thread: [{ from: 'ai', v: 5, text: 'The video for v4 is ready: 6 seconds, vertical. It’s on v5 too, the version on screen.' }], pkg: { title: 'Festive', script: [{ line: 'festive prep is chaotic!' }], video: 'gen/c.mp4', knobs: {} } });
  t.vg = { ch_1: [
    { id: 'v1', n: 1, at: 1, reason: 'The first draft on the card', label: 'First draft', snapshot: { title: 'First' } },
    { id: 'v2', n: 2, at: 2, parentVersionId: 'v1', reason: 'Version A: festive brand-team comedy skit', snapshot: { title: 'A' } },
    { id: 'v3', n: 3, at: 3, parentVersionId: 'v1', reason: 'Version B: dermatologist says science backed', snapshot: { title: 'B' } },
    { id: 'v4', n: 4, at: 4, parentVersionId: 'v1', reason: 'Version C: curly girl routine', snapshot: { title: 'C' } } /* live data: the clip never reached v4 */,
    { id: 'v5', n: 5, at: 5, parentVersionId: 'v2', reason: 'Video added', label: 'Video added', snapshot: { title: 'A', video: 'gen/c.mp4' } }] };
  const r = await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  const op = r.change.options; assert.ok(op); assert.deepEqual(op.list.map((x) => x.id), ['v2', 'v3', 'v4']);
  assert.deepEqual(op.list.map((x) => x.name), ['Festive brand-team comedy', 'Dermatologist says science', 'Curly girl routine']);
  assert.equal(op.list[0].tip, 'v2', 'the stray copy is not option A'); assert.equal(op.list[0].has, 'words'); assert.equal(op.list[2].has, 'video');
  assert.equal(r.change.head, 'v4', 'the stage shows the option whose clip it was'); assert.equal(op.on, 'v4');
});

test('Redo it makes one new take on the stage; the last take stays in History', async () => {
  const t = tenant(); t.changes.ch_1 = change('ch_1'); const { call } = studio();
  await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' }); await call('POST /api/changes/:chid/more', {}, t, { chid: 'ch_1' });
  const was = versionsOf(t, 'ch_1').at(-1), n0 = versionsOf(t, 'ch_1').length;
  const m = await call('POST /api/changes/:chid/more', {}, t, { chid: 'ch_1' });
  assert.equal(m.change.options, null); assert.notEqual(m.change.head, was.id); assert.ok(versionsOf(t, 'ch_1').some((v) => v.id === was.id), 'kept in History');
  assert.equal(versionsOf(t, 'ch_1').length, n0 + 1, 'exactly one new take');
  const v = await call('POST /api/changes/:chid/variants', {}, t, { chid: 'ch_1' }); /* More like this is a redo too */
  assert.equal(v.change.options, null); assert.equal(versionsOf(t, 'ch_1').length, n0 + 2);
});

test('a card that lists its ideas leads with one: each Redo makes the next idea, one at a time', async () => {
  const t = tenant(); const card = t.cards.get('c1'); card.kind = 'variants';
  card.variants = [{ angle: 'Hairfall combo hook', title: 'Stop thinning with the combo', sub: 'a' }, { angle: 'Dandruff relief focus', title: 'Scale the dandruff combo', sub: 'b' }];
  t.changes.ch_1 = change('ch_1'); const { call } = studio();
  await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  await call('POST /api/changes/:chid/more', {}, t, { chid: 'ch_1' }); assert.match(versionsOf(t, 'ch_1').at(-1).reason, /Hairfall combo hook/);
  await call('POST /api/changes/:chid/more', {}, t, { chid: 'ch_1' }); assert.match(versionsOf(t, 'ch_1').at(-1).reason, /Dandruff relief focus/);
});
