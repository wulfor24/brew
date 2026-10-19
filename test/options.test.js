// Options, not versions (Param, 19 Oct: "the multiple versions and all is super confusing" → "3 options, pick one", for every
// move that makes options): cuts are tabs named by their angle, a pick folds the others away, a clip lands in its own option
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

test('three cuts are three options: tabs named by angle, the chat names them by letter, a tab shows one, Use picks it, Change reopens', async () => {
  const t = tenant(); t.changes.ch_1 = change('ch_1'); const { call } = studio();
  await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  const r = await call('POST /api/changes/:chid/iterate', { message: 'Three cuts of this ad' }, t, { chid: 'ch_1' });
  const op = r.change.options; assert.ok(op, 'the cuts are options'); assert.equal(op.list.length, 3); assert.equal(op.picked, null);
  assert.deepEqual(op.list.map((x) => x.letter), ['A', 'B', 'C']); assert.ok(op.list.every((x) => x.name && x.name.split(' ').length <= 3), 'short names');
  assert.equal(op.on, op.list[2].id, 'the stage shows the last one'); assert.doesNotMatch(r.change.thread.at(-1).text, /\bv\d+\b/, 'no v-numbers in the chat');
  const a = await call('POST /api/changes/:chid/options/pick', { opt: op.list[0].id, use: false }, t, { chid: 'ch_1' });
  assert.equal(a.change.head, op.list[0].tip); assert.equal(a.change.options.on, op.list[0].id); assert.equal(a.change.options.picked, null, 'a tab only shows it');
  const n0 = versionsOf(t, 'ch_1').length;
  const u = await call('POST /api/changes/:chid/options/pick', { opt: op.list[0].id }, t, { chid: 'ch_1' });
  assert.equal(u.change.options.picked, op.list[0].id); assert.equal(versionsOf(t, 'ch_1').length, n0, 'picking makes no copy');
  /* an edit on the picked option stays in it: its tab's newest version is the edit */
  const e = await call('POST /api/changes/:chid/iterate', { message: 'Make the headline shorter' }, t, { chid: 'ch_1' });
  assert.equal(e.change.options.on, op.list[0].id); assert.equal(e.change.options.list[0].tip, e.change.head);
  const c = await call('POST /api/changes/:chid/options/pick', { opt: null }, t, { chid: 'ch_1' }); assert.equal(c.change.options.picked, null);
});

test('a clip made for one option lands in that option only, never as a new version and never on the option on stage', async () => {
  const t = tenant(); t.changes.ch_1 = change('ch_1'); const { call, RMX } = studio();
  await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  const r = await call('POST /api/changes/:chid/iterate', { message: 'Three cuts of this ad' }, t, { chid: 'ch_1' });
  const [A, , C] = r.change.options.list; await call('POST /api/changes/:chid/options/pick', { opt: A.id, use: false }, t, { chid: 'ch_1' });
  const n0 = versionsOf(t, 'ch_1').length, ch = t.changes.ch_1, vC = versionsOf(t, 'ch_1').find((v) => v.id === C.id);
  const place = RMX.landMedia(t, ch, vC, { video: 'gen/c.mp4', poster: 'gen/c.png' });
  assert.equal(place.onStage, false); assert.equal(versionsOf(t, 'ch_1').length, n0, 'no “Video added” version');
  assert.equal(ch.pkg.video, undefined, 'option A on the stage keeps its own media'); assert.equal(vC.snapshot.video, 'gen/c.mp4');
  const g = await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  assert.equal(g.change.options.list[2].has, 'video'); assert.notEqual(g.change.options.list[0].has, 'video');
  /* on the stage: the clip shows at once */
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

test('One more beside the options is one more option: same parent, its own tab, on the stage', async () => {
  const t = tenant(); t.changes.ch_1 = change('ch_1'); const { call } = studio();
  await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  const r = await call('POST /api/changes/:chid/iterate', { message: 'Three cuts of this ad' }, t, { chid: 'ch_1' });
  const m = await call('POST /api/changes/:chid/more', {}, t, { chid: 'ch_1' });
  const op = m.change.options; assert.equal(op.list.length, 4); assert.equal(op.list[3].letter, 'D'); assert.equal(op.on, op.list[3].id); assert.equal(m.change.head, op.list[3].id);
  assert.equal(op.list[3].tip, op.list[3].id, 'its own tab, not part of another option'); assert.equal(op.list[2].tip, r.change.options.list[2].tip, 'C is untouched');
});

test('a card that lists its ideas makes exactly those: one option per idea, in order, named as the card names them; One more makes the missing one', async () => {
  const t = tenant(); const card = t.cards.get('c1'); card.kind = 'variants';
  card.variants = [{ angle: 'Hairfall combo hook', title: 'Stop thinning with the combo', sub: 'a' }, { angle: 'Dandruff relief focus', title: 'Scale the dandruff combo', sub: 'b' }, { angle: 'Scale ad volume', title: 'Match Pilgrim', sub: 'c' }];
  t.changes.ch_1 = change('ch_1'); const { call } = studio();
  await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  const r = await call('POST /api/changes/:chid/iterate', { message: 'Two cuts of this ad' }, t, { chid: 'ch_1' });
  assert.deepEqual(r.change.options.list.map((o) => o.name), ['Hairfall combo hook', 'Dandruff relief focus', 'Scale ad volume']);
  /* a jam made before this with only two of them: One more makes the third idea */
  t.changes.ch_1.options.ids.pop(); const m = await call('POST /api/changes/:chid/more', {}, t, { chid: 'ch_1' });
  assert.equal(m.change.options.list.at(-1).name, 'Scale ad volume');
});
