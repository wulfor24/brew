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
  saveGen: () => {}, genFile: async () => null, photoAsync: async () => null, launchBrowser: async () => ({ close: async () => {}, newPage: async () => ({ setViewport: async () => {}, setContent: async () => {}, evaluate: async () => {}, screenshot: async () => Buffer.from('x'), close: async () => {} }) }), shoot: async () => Buffer.from('x') });
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

test('Pick a day: date-only posts give best days, never a made-up hour; timed posts use the brand’s time zone', async () => {
  const { bestSlots } = await import('../jam2/slots.js');
  const dated = Array.from({ length: 10 }, (_, i) => ({ at: `2026-10-${String(1 + i).padStart(2, '0')}`, likes: i * 10 }));
  const d = bestSlots(dated, 'IN'); assert.ok(d.slots.length && d.slots.every((x) => x.from === null), JSON.stringify(d)); assert.match(d.basis, /dates only/);
  const timed = Array.from({ length: 10 }, (_, i) => ({ at: `2026-10-${String(1 + (i % 2) * 7).padStart(2, '0')}T14:30:00Z`, likes: 50 }));
  const u = bestSlots(timed, 'US'); assert.equal(u.slots[0].from, 9); assert.match(u.basis, /US Eastern/);
  assert.equal(bestSlots([], 'US').slots.length, 0);
});

test('creative engine: the best candidate that keeps the product wins; none kept → the caller composites; words never drawn', async () => {
  const { createCreative } = await import('../jam2/creative.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const f = path.join(os.tmpdir(), 'cr-ref.png'); fs.writeFileSync(f, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+P9/PQAJYAN0Zx7nPgAAAABJRU5ErkJggg==', 'base64'));
  let n = 0; const prompts = [];
  const engines = { run: async (cap, s) => { prompts.push(s.prompt); return { file: `gen/c${n++}.png`, provider: 'vertex', model: 'm', usd: 0.14 }; } };
  const verdicts = [{ same: false, shot: 9, ad: 9, zone: 'top', why: 'other product' }, { same: true, shot: 7, ad: 8, zone: 'bottom', why: 'ok' }];
  let call = 0; const ai = { call: async () => ({ json: verdicts[call++ % 2], usd: 0.001 }) };
  const mk = (over = {}) => createCreative({ engines, ai, claudeTool: async () => ({ family: 'product in use', moment: 'feet under a desk', zone: 'top' }), isMock: () => false, fileOf: async () => f,
    render: async () => 'gen/out.jpg', composeScene: (o) => ({ preset: o.preset, bg: o.bgFile, layers: [{ kind: 'text', words: o.words.headline }] }), ...over });
  const ctx = { slug: 'x', jam: { concept: { angle: 'cold feet' } }, card: null, bbv: { kit: {}, name: 'B' }, catalog: [{ t: 'Booties', handle: 'b', img: 'https://x/b1.jpg', images: ['https://x/b1.jpg', 'https://x/b2.jpg'] }], product: { img: 'https://x/b1.jpg', name: 'Booties', handle: 'b' }, notes: [] };
  const r = await mk().staticAd(ctx, { id: 'b1', recipe: 'image-ad', label: 'Image ad' }, { headline: 'Cold feet? Fixed.' }, { ratio: '4:5', w: 1080, h: 1350 });
  assert.equal(r.shot.file, 'gen/c1.png'); assert.equal(r.scene.preset, 'bottom-bar'); assert.match(prompts[0], /KEEP UNCHANGED/); assert.match(prompts[0], /No text, no letters/);
  assert.equal(r.made.length, 2);
  call = 0; verdicts[1] = { ...verdicts[1], same: false };
  const r2 = await mk().staticAd(ctx, { id: 'b1', recipe: 'image-ad', label: 'Image ad' }, { headline: 'x' }, { ratio: '4:5', w: 1080, h: 1350 });
  assert.equal(r2.scene, undefined); assert.match(r2.fail, /product changed/);
  /* a brand with no product photo: the moment alone, no KEEP list */
  prompts.length = 0; call = 0; verdicts[0] = { same: true, shot: 8, ad: 8, zone: 'left', why: 'ok' };
  const r3 = await mk().staticAd({ ...ctx, product: null }, { id: 'b1', recipe: 'image-ad', label: 'Image ad' }, { headline: 'x' }, { ratio: '1:1', w: 1080, h: 1080 });
  assert.ok(r3.scene); assert.doesNotMatch(prompts[0], /KEEP UNCHANGED/);
  /* the Brand Book's own posts ride after the product photos as the look, and the art director hears its rules */
  prompts.length = 0; call = 0; verdicts[0] = { same: true, shot: 8, ad: 8, zone: 'top', why: 'ok' }; let asked = ''; const specs = [];
  const eng2 = { run: async (cap, s) => { prompts.push(s.prompt); specs.push(s); return { file: `gen/d${n++}.png`, provider: 'vertex', usd: 0.14 }; } };
  await mk({ engines: eng2, claudeTool: async (pr) => { asked = pr; return { family: 'product hero', moment: 'm', zone: 'top' }; } }).staticAd({ ...ctx, bbv: { ...ctx.bbv, styleRefs: [{ src: 'https://x/ig1.jpg' }, { src: 'https://x/ig2.jpg' }], comfort: { people: 'hands' } } }, { id: 'b1', recipe: 'image-ad', label: 'Image ad' }, { headline: 'x' }, { ratio: '4:5', w: 1080, h: 1350 });
  assert.match(prompts[0], /brand's own published photos/); assert.equal(specs[0].refFiles.length, 3); assert.match(asked, /Hands only/);
});

test('higgsfield layer: inputs fit each workflow schema, the nearest frame is asked for, prices come from estimate or formula', async () => {
  const { createHiggsfield, fitInput, nearestRatio } = await import('../jam2/higgsfield.js');
  const f = fitInput('kling-video/v3.0/std/image-to-video', { prompt: 'p', image_url: 'https://x/a.jpg', duration: 99, bogus: 1, sound: 'loud' });
  assert.equal(f.input.duration, 15); assert.equal(f.input.bogus, undefined); assert.match(f.problems.join(), /sound/);
  assert.match(fitInput('kling-video/v3.0/std/image-to-video', { prompt: 'p' }).problems.join(), /image_url is required/);
  assert.equal(nearestRatio('marketing-studio/image/flare', '4:5'), '3:4'); assert.equal(nearestRatio('marketing-studio/image/flare', '9:16'), '9:16');
  let posted = null; const fetchImpl = async (url, o) => { posted = url; return { ok: true, json: async () => (/kling/.test(url) ? { type: 'estimate', usd: '0.536', discount: { usd: '0.095' } } : { type: 'description' }) }; };
  const hf = createHiggsfield({ env: { HF_API_KEY_ID: 'a', HF_API_KEY_SECRET: 'b' }, fetchImpl });
  assert.equal((await hf.estimate('kling-video/v3.0/std/image-to-video', { prompt: 'p', image_url: 'https://x/a.jpg', duration: 5 })).usd, 0.441); assert.match(posted, /\/estimate\/kling-video/);
  assert.equal((await hf.estimate('marketing-studio/image/flare', { prompt: 'p', resolution: '2k' })).usd, 0.1);
  assert.equal(hf.pick('product-shot').id, 'marketing-studio/image/flare'); assert.equal(hf.pick('product-motion', 'premium').id, 'kling-video/v3.0/pro/image-to-video');
});

test('batch cards: public and team statics are both a batch (v1 opens the N ads, v2 one board per ad)', async () => {
  const { isBatchCard } = await import('../card-plan.js');
  const imgs = (pre) => [1, 2, 3].map((i) => `${pre}${i}.jpg`);
  assert.ok(isBatchCard({ images: imgs('b/in-puma-com/statics/s') })); assert.ok(isBatchCard({ images: imgs('/b/in-puma-com/team/statics/s') })); assert.ok(isBatchCard({ images: imgs('assets/statics/s') }));
  assert.ok(!isBatchCard({ images: imgs('b/in-puma-com/a/p') })); assert.ok(!isBatchCard({ images: imgs('b/x/statics/s').slice(0, 2) }));
  const app = (await import('node:fs')).readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const isBatchCard = \(p\) => [^\n]*team\\\/\)\?statics/); assert.match(app, /if \(!chId && !isBatchCard\(p\)\)/);
});

test('words over a shot go to the calm side measured on the photo, never the busy side the hint named; button and logo follow', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), sharp = (await import('sharp')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calm-')), W = 400, H = 500, px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = x < W / 2 ? (((x >> 3) + (y >> 3)) % 2 ? 230 : 20) : 30; px.set([v, v, v], (y * W + x) * 3); } /* left: a checker of edges; right: flat dark */
  fs.writeFileSync(path.join(dir, 'bg.png'), await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
  const m = createMaker({ engines: { run: async () => { throw new Error('x'); } }, brandbook: { promptBlock: () => '' }, claudeTool: async () => { throw new Error('x'); }, isMock: () => true, saveGen: () => {}, genFile: async (n) => path.join(dir, n), photoAsync: async () => null });
  for (const size of [{ w: 1080, h: 1350 }, { w: 1080, h: 1920 }]) {
    const sc = await m.creative.layout({ bbv: { kit: { colors: ['#3366ff'] } }, product: { name: 'Serum' } }, size, 'gen/bg.png', { headline: 'Steady drop in hairfall', sub: 'Within a month', badge: '51,419 reviews', cta: 'Shop now' }, 'left');
    const L = Object.fromEntries(sc.layers.map((l) => [l.id, l]));
    assert.ok(L.headline.x > size.w / 2, 'headline on the calm right'); assert.ok(L.cta.x === L.headline.x && L.cta.y > L.badge.y && L.badge.y > L.sub.y, 'badge and button stacked under the words');
    assert.equal(L.headline.style.color, '#ffffff'); assert.ok(!sc.layers.some((l) => l.id === 'card'), 'no panel behind the words'); }
});

test('art direction (photos and UGC films) casts the brand’s own market; a guessed market says nothing', async () => {
  let seen = ''; const m = createMaker({ engines: { run: async () => { throw new Error('x'); } }, brandbook: { promptBlock: () => '' }, claudeTool: async (p) => { seen = p; return { family: 'product in use', moment: 'm', zone: 'left' }; }, isMock: () => false, saveGen: () => {}, genFile: async () => null, photoAsync: async () => null });
  const ctx = (market) => ({ slug: 's', jam: { concept: { angle: 'a' } }, bbv: { name: 'Arata', kit: {} }, product: null, market });
  await m.creative.direct(ctx({ cc: 'IN', name: 'India', guessed: false }), { recipe: 'reel', label: 'Review' }, { headline: 'h' }, { label: '9:16', ratio: '9:16' }, { look: 'talks to camera', people: 'person' }, { film: true });
  assert.match(seen, /sells in India/); assert.match(seen, /vertical phone video/);
  await m.creative.direct(ctx({ cc: 'US', name: 'United States', guessed: true }), { recipe: 'image-ad' }, { headline: 'h' }, { label: '4:5', ratio: '4:5' });
  assert.doesNotMatch(seen, /sells in/);
});
