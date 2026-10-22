// Jam v2: every button a feed card shows today opens on real boards; one-line edits, slides, timeline and the brief work in mock mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFor, recipe, RECIPES } from '../jam2/catalogue.js';
import { newJam, briefOf, jamView, headOf } from '../jam2/core.js';
import { createMaker } from '../jam2/make.js';
import { sentencesOf } from '../public/jam2/scene.js';

const LABELS = ['Reply as the brand', 'Reply in r/IndianSkincareAddicts', 'Post in r/IndianSkincareAddicts', 'Post on Reddit', 'Answer on Quora', 'Post in the group', 'Make the reel', 'Make the video', 'Make the carousel', 'Post it',
  'Make our version', 'Turn into an idea', 'Start this', 'Rotate creative', 'Make the ad', 'Shift budget', 'Queue the ads', 'Queue the 12', 'Generate versions', 'Publish the campaign', 'Draft the switcher ad', 'Lock the Diwali set',
  'Make the carousel ad', 'Build the collection ad', 'Build the catalog ad', 'Draft the post', 'Draft the carousel post', 'Draft the stories',
  'Pause what points there', 'Restart what was paused', 'Update the prices', 'Fix the links', 'Plan the launch', 'Add photos',
  'Draft the page', 'Fix the markup', 'Publish the claims ledger', 'Review draft', 'Set the watch',
  'Send the review ask', 'Approve the flows', 'Turn on the journey', 'Send on WhatsApp', 'Plan the flows', 'Open the club', 'Reply in Judge.me',
  'Update landing page', 'Publish the page', 'Apply Update', 'Start the tests', 'Approve 6 popups', 'Build the score', 'Answer it on the product page', 'Turn on guest checkout', 'Fix tracking',
  'Approve the offers', 'Approve the ladder', 'Approve the 3 offers', 'Push the titles', 'Push 5 titles', 'Apply 34 edits', 'Draft the listing', 'Generate the sets', 'Request takedown', 'Read the reviews',
  'Brief the shoot', 'Plan the shoot', 'Shortlist creators', 'Draft the buyer deck', 'Approve the box insert', 'Launch the ad group',
  'Agree with the call', 'Apply the plan', 'Ship the five', 'Plan the restock', 'Work on this', 'Use their words in a post'];

test('every feed button opens on boards that exist', () => {
  for (const l of LABELS) { const p = planFor({ title: 'x' }, l); assert.ok(p.length >= 1, l); for (const b of p) assert.ok(recipe(b.recipe), `${l} → ${b.recipe}`); }
  assert.equal(planFor({}, 'Pause what points there')[0].recipe, 'changes');
  assert.equal(planFor({}, 'Answer it on the product page')[0].recipe, 'ai-faq');
  assert.equal(planFor({}, 'Answer on Quora')[0].recipe, 'community-post');
  assert.equal(planFor({ research: { kind: 'viral' } }, 'Make our version')[0].recipe, 'reel');
  assert.equal(planFor({ research: { kind: 'ad' } }, 'Make our version')[0].recipe, 'remake');
  assert.deepEqual(planFor({}, 'Send the review ask').map((b) => b.recipe), ['email', 'whatsapp', 'changes']);
});
test('a jam opens with the plan’s boards, labelled', () => {
  const j = newJam({ card: { id: 'c1', title: 'Loofah sold out' }, owner: 'team', plan: planFor({}, 'Pause what points there'), cta: 'Pause what points there' });
  assert.deepEqual(j.boards.map((b) => b.label), ['Pause list', 'Ad for what’s in stock']); assert.equal(j.cta, 'Pause what points there'); assert.ok(j.boards[0].ask);
});
test('sentences split and join back exactly', () => { const t = 'Fair worry. Mesh stays wet!\n\nOurs dries fast? Yes'; assert.equal(sentencesOf(t).join(''), t); assert.equal(sentencesOf(t)[2], 'Mesh stays wet!'); });

const maker = () => createMaker({ engines: { run: async () => { throw new Error('no paid calls in tests'); }, quote: async () => ({ usd: 0.04 }) }, brandbook: { promptBlock: () => '' }, claudeTool: async () => { throw new Error('no AI'); }, isMock: () => true,
  saveGen: () => {}, genFile: async () => null, photoAsync: async () => null, launchBrowser: async () => ({ close: async () => {} }), shoot: async () => Buffer.from('x') });
const ctxOf = (jam) => ({ slug: 's', jam, card: { title: 'Are loofahs bacteria sponges', sub: 'People ask. Ours dries fast.' }, bbv: { kit: {}, never: [] }, product: null, by: { email: 'a@b.c' }, source: '', cuts: {} });

test('a change list board is written as rows, edited one line at a time, and briefs from its take', async () => {
  const m = maker(), jam = newJam({ card: { id: 'c', title: 'Sold out' }, owner: 'team', plan: [{ recipe: 'changes', label: 'Pause list', ask: 'Pause them' }] }), b = jam.boards[0];
  await m.first(ctxOf(jam), b); const t = headOf(b); assert.equal(t.words.rows.length, 3); assert.equal(t.words.cols.length, 3);
  await m.edit(ctxOf(jam), b, { op: 'line', target: { kind: 'row', i: 0, col: 'b' }, ask: 'shorter' }); assert.equal(b.takes.length, 2);
  b.brief = { owner: 'Your agency', due: 'Fri', edits: { 1: 'Because.' } }; const bv = briefOf(jam, b);
  assert.equal(bv.length, 8); assert.equal(bv[1].t, 'Because.'); assert.match(bv[6].t, /Your agency · due Fri/); assert.ok(jamView(jam).boards[0].briefView);
});
test('a post board: one sentence rewritten, the rest untouched', async () => {
  const m = maker(), jam = newJam({ card: { id: 'c', title: 'Q' }, owner: 'team', plan: [{ recipe: 'community-post' }] }), b = jam.boards[0];
  await m.first(ctxOf(jam), b); headOf(b).words.body = 'Fair worry, honestly. Ours dries by lunch.';
  await m.edit(ctxOf(jam), b, { op: 'line', target: { kind: 'sent', i: 0 }, ask: 'shorter' }); assert.equal(headOf(b).words.body, 'Fair worry. Ours dries by lunch.');
});
test('a video storyboard: timeline edits are free and keep a quote', async () => {
  const m = maker(), jam = newJam({ card: { id: 'c', title: 'Reel' }, owner: 'team', plan: [{ recipe: 'reel' }] }), b = jam.boards[0];
  await m.first(ctxOf(jam), b); const tl = JSON.parse(JSON.stringify(headOf(b).timeline)); tl.shots[0].vo = 'New line'; tl.voice = 'Puck';
  await m.edit(ctxOf(jam), b, { patch: { timeline: tl } }); assert.equal(headOf(b).timeline.shots[0].vo, 'New line'); assert.equal(headOf(b).timeline.voice, 'Puck'); assert.ok(headOf(b).quote);
});
test('every recipe has a kind the page draws', () => { const KNOWN = new Set(['static', 'carousel', 'video', 'post', 'message', 'page', 'script', 'creator', 'shoot', 'act', 'table']); for (const r of RECIPES) assert.ok(KNOWN.has(r.kind), r.id); });
test('a scene can’t carry script or outside files: styles are whitelisted, page patches keep only the board’s own pictures', async () => {
  const { sceneBody } = await import('../public/jam2/scene.js');
  const h = sceneBody({ w: 10, h: 10, bg: { color: 'red" onload="x' }, layers: [{ id: 'a', kind: 'text', words: '<b>', style: { color: 'x" onmouseover="alert(1)', font: 'A;b:url(x)', bg: 'url(http://x)' } }] });
  assert.doesNotMatch(h, /onmouseover|onload|url\(|<b>/);
  const m = maker(), jam = newJam({ card: { id: 'c', title: 'Ad' }, owner: 'team', plan: [{ recipe: 'image-ad' }] }), b = jam.boards[0];
  b.takes.push({ id: 't1', n: 1, words: {}, scene: { w: 100, h: 100, bg: { src: 'gen/bg.jpg' }, kit: {}, layers: [{ id: 'p', kind: 'product', src: 'gen/cut.png', x: 1, y: 1, w: 10, h: 10 }] } }); b.head = 't1';
  await m.edit(ctxOf(jam), b, { patch: { scene: { w: 9999, h: 1, bg: { src: '/b/other-brand/a/x.jpg' }, layers: [{ id: 'p', kind: 'product', src: 'gen/cut.png', x: 5, y: 1, w: 10, h: 10, onclick: 'x' }, { id: 'q', kind: 'image', src: 'http://169.254.169.254/x' }] } } });
  const sc = headOf(b).scene; assert.equal(sc.w, 100); assert.equal(sc.bg.src, 'gen/bg.jpg'); assert.deepEqual(sc.layers.map((l) => l.id), ['p']); assert.equal(sc.layers[0].x, 5); assert.equal(sc.layers[0].onclick, undefined);
});
test('more button wordings land on the right board; navigation-only buttons make nothing paid', () => {
  assert.equal(planFor({}, 'Draft the replies')[0].recipe, 'community-post'); assert.equal(planFor({}, 'Draft the pitch')[0].recipe, 'creator-dm');
  assert.equal(planFor({}, 'Pause those ads')[0].recipe, 'changes'); assert.equal(planFor({}, 'Add the photos')[0].recipe, 'listing');
});
test('a jam list that couldn’t be read is never written over; a failed write is tried again', async () => {
  const { createJam2Store } = await import('../jam2/store.js');
  let reads = 0; const writes = []; let failWrite = true;
  const packs = { readJSON: async () => (++reads === 1 ? { ok: false, error: 'gcs 503' } : { ok: true, data: { jams: { j_old: { id: 'j_old', owner: 'team' } } } }),
    putStrict: async (s, f, d) => { if (failWrite) { failWrite = false; throw new Error('gcs 503'); } writes.push(d); } };
  const st = createJam2Store({ packs, everyMs: 0, log: { warn() {} } });
  await st.flush(); assert.equal(writes.length, 0);
  await st.put('s', { id: 'j_new', owner: 'team' }); const all = await st.list('s', { member: true });
  assert.deepEqual(all.map((j) => j.id).sort(), ['j_new', 'j_old']);
  await st.flush(); assert.equal(writes.length, 0, 'first write failed'); await st.flush(); assert.equal(writes.length, 1); assert.ok(writes[0].jams.j_old && writes[0].jams.j_new);
});
