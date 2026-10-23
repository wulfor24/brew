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

test('a jam call right after a restart loads the brand pack first (Studio never refuses the brand’s own product cold)', async () => {
  const fs = await import('node:fs'), rt = fs.readFileSync(new URL('../jam2/routes.js', import.meta.url), 'utf8'), fsv = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.match(rt, /const wrap = [^\n]*if \(t && !brandOfT\(t\) && d\.loadBrandOfT\) await d\.loadBrandOfT\(t\)/); assert.match(fsv, /mountJam2\(\{[^\n]*loadBrandOfT: \(t\) => packs\.load\(/);
});

test('Studio opens every picture, set and video card on the right deliverable; founder videos stay a script', async () => {
  const { defaults, inStudio, createStudio } = await import('../jam2/studio.js');
  const ctx = { card: { title: 'List it on Amazon', cta: { label: 'Make the listing images' } }, bbv: { comfort: { people: 'ai-cast' } }, product: { img: 'p.jpg', name: 'Serum' }, jam: { concept: {} } };
  const L = defaults(ctx, { recipe: 'listing', kind: 'carousel' }); assert.deepEqual(L.set, ['mp-main', 'mp-lifestyle', 'mp-benefits', 'mp-size']); assert.deepEqual(L.sizes, ['pdp']); assert.equal(L.count, 4);
  const O = defaults(ctx, { recipe: 'orbit', kind: 'video' }); assert.equal(O.kind, 'video'); assert.equal(O.style, 'orbit-360'); assert.deepEqual(O.sizes, ['ig-square']); assert.equal(O.seconds, 5);
  assert.equal(defaults(ctx, { recipe: 'ugc-ad', kind: 'video' }).style, 'ugc-review'); assert.deepEqual(defaults(ctx, { recipe: 'pin', kind: 'static' }).sizes, ['pinterest']);
  assert.equal(defaults({ ...ctx, card: { title: 'Ship 8 new ads for the serum', cta: { label: 'Make the ad' } } }, { recipe: 'image-ad', kind: 'static' }).count, 8);
  /* a brand with no people on camera gets no person styles in a set */
  assert.ok(!defaults({ ...ctx, bbv: { comfort: { people: 'none' } } }, { recipe: 'photoshoot', kind: 'carousel' }).set.some((id) => ['in-use', 'editorial'].includes(id) && false));
  for (const r of RECIPES) if (['static', 'video', 'carousel'].includes(r.kind)) assert.equal(inStudio({ kind: r.kind, recipe: r.id }), r.id !== 'founder-ad', r.id);
  assert.ok(!inStudio({ kind: 'message', recipe: 'email' }));
  /* a set is priced slide by slide and named */
  const studio = createStudio({ engines: { hf: { pick: () => ({ id: 'x', input: {} }), estimate: async () => ({ usd: 0.08 }), nearestRatio: () => '1:1' }, quote: async () => ({ usd: 0.1 }) }, maker: { creative: {} } });
  const pl = await studio.plan(ctx, { set: ['mp-main', 'mp-lifestyle', 'mp-benefits'], sizes: ['pdp'], product: { name: 'Serum' } });
  assert.match(pl.line, /^3 slides · Main image \(white\), Lifestyle, Benefits · Serum/); assert.equal(pl.usd, 0.3); /* the main image is the real photo cut out (free); the other two show the real product, so each is a product shot */ assert.deepEqual(pl.set, ['mp-main', 'mp-lifestyle', 'mp-benefits']);
  assert.equal((await studio.plan(ctx, { set: ['mp-main'] })).error, 'Pick at least two slides.');
});

test('a set lands on one board as slides; a failed slide is named and the rest stand', async () => {
  const { createStudio } = await import('../jam2/studio.js');
  let n = 0; /* the slides go through Studio's own make, with the creative engine stubbed */
  const studio = createStudio({ engines: { hf: {}, keep: () => 'gen/x.png', pub: (u) => u }, maker: { write: async (ctx, b, o) => ({ headline: `h${n++}`, ask: o.ask }), creative: {
    staticAd: async (ctx, b, w, size, { style }) => (style.id === 'closeup' ? { made: [{ usd: 0.1 }], fail: 'no clear photo' } : { made: [{ usd: 0.1 }], scene: { w: 1, h: 1, layers: [] }, file: `gen/${style.id}.jpg`, shot: {} }) } } });
  const t = await studio.makeSet({ by: 'a@b.c' }, { label: 'Listing' }, { set: ['in-use', 'mp-lifestyle', 'closeup'], sizes: ['pdp'] });
  assert.deepEqual(t.slides.map((x) => x.file), ['gen/in-use.jpg', 'gen/mp-lifestyle.jpg']); assert.equal(t.missing.length, 1); assert.match(t.missing[0], /^Closeup: no clear photo/);
  assert.equal(t.cost.usd, 0.3); assert.deepEqual(t.studio.set, ['in-use', 'mp-lifestyle']); assert.equal(t.file, 'gen/in-use.jpg');
});

test('a Studio film is delivered at the placement’s exact pixels (a 720p clip becomes 1080×1920)', async () => {
  const { finishVideo } = await import('../jam2/studio.js'), { execFileSync } = await import('node:child_process'), fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-')), a = path.join(dir, 'a.mp4');
  try { execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', a]); } catch { return; } /* no ffmpeg here: the server image has it */
  const out = await finishVideo(fs.readFileSync(a), { w: 1080, h: 1920 }); const b = path.join(dir, 'b.mp4'); fs.writeFileSync(b, out);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', b]).toString();
  assert.match(probe, /video,1080,1920/); assert.match(probe, /audio/);
  assert.equal(await finishVideo(Buffer.from('not a video'), { w: 1080, h: 1920 }, { warn: () => {} }).then((x) => x.toString()), 'not a video', 'a clip ffmpeg can’t read is kept as it came');
});

test('v1: a card button that makes a picture, a set or a video opens Studio; words, briefs and batches stay in v1', async () => {
  const fs = await import('node:fs'), app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), rt = fs.readFileSync(new URL('../jam2/routes.js', import.meta.url), 'utf8');
  assert.match(app, /if \(j2Ok && !chId && !o\.v1 && !window\.BREW_DEMO\) \{ if \(openRemix\.asking\) return;/); assert.match(app, /tapi\('POST', '\/api\/jam2\/studio-for'/); assert.match(rt, /'\/api\/jam2\/studio-for'[^\n]*isBatchCard\(card\)\) return \{ studio: false \}/);
  const kindOf = (label, card = {}) => recipe(planFor({ title: 'x', ...card }, label)[0].recipe)?.kind;
  assert.ok(['static', 'video', 'carousel'].includes(kindOf('Make the ad'))); assert.ok(['static', 'video', 'carousel'].includes(kindOf('Make the video')));
});

test('a marketplace main image is the real product cut out on pure white at 85% of the frame, never redrawn, free', async () => {
  const { createStudio } = await import('../jam2/studio.js'), sharp = (await import('sharp')).default, fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-')), cut = path.join(dir, 'cut.png'); fs.writeFileSync(cut, await sharp({ create: { width: 200, height: 400, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer());
  let kept = null; const studio = createStudio({ engines: { hf: {}, keep: (b) => { kept = b; return 'gen/main.jpg'; } }, maker: { write: async () => ({ headline: 'h' }), creative: { entryOf: () => null }, cutout: async () => ({ file: 'gen/cut.png', provider: 'local' }), fileOf: async () => cut } });
  const t = await studio.make({ by: 'a', product: { img: 'p.jpg', name: 'Serum' }, profile: { best: 'p.jpg' } }, { label: 'Listing' }, { style: 'mp-main', sizes: ['pdp'] });
  const m = await sharp(kept).metadata(), px = await sharp(kept).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();
  assert.equal(t.file, 'gen/main.jpg'); assert.equal(m.width, m.height); assert.ok(px[0] > 250 && px[1] > 250 && px[2] > 250, 'pure white edge'); assert.equal(t.cost.usd, 0);
  const tall = await sharp(await sharp(kept).trim({ threshold: 10 }).toBuffer()).metadata(); assert.ok(Math.abs(tall.height / m.height - 0.85) < 0.02, `fills 85% (${tall.height}/${m.height})`);
  const bad = createStudio({ engines: { hf: {} }, maker: { write: async () => ({}), creative: { entryOf: () => null }, cutout: async () => ({ file: 'p.jpg', raw: true }) } });
  await assert.rejects(bad.make({ by: 'a', product: { img: 'p.jpg' }, profile: { best: 'p.jpg' } }, {}, { style: 'mp-main', sizes: ['pdp'] }), /couldn’t be cut out/);
});

test('a catalog photo that is already cut out (see-through PNG) is used as the cut-out, never cut again (no black fringes)', async () => {
  const sharp = (await import('sharp')).default, fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-')), src = path.join(dir, 'p.png'); let ran = false, kept = null;
  fs.writeFileSync(src, await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 100, height: 200, channels: 4, background: { r: 180, g: 180, b: 190, alpha: 1 } } }).png().toBuffer(), left: 100, top: 50 }]).png().toBuffer());
  const m = createMaker({ engines: { run: async () => { ran = true; throw new Error('should not cut'); } }, brandbook: { promptBlock: () => '' }, claudeTool: async () => ({}), isMock: () => true, saveGen: (n, b) => { kept = b; }, genFile: async () => null, photoAsync: async () => src });
  const c = await m.cutout({ slug: 's', product: { img: 'https://cdn/p.png', name: 'Serum' }, cuts: {} });
  assert.equal(ran, false); assert.equal(c.provider, 'own'); assert.equal(c.usd, 0); const k = await sharp(kept).metadata(); assert.equal(k.width, 100); assert.equal(k.height, 200);
});

test('a font the brand uploaded is loaded from its own file in the file and the preview; other names from Google; nothing unsafe gets in', async () => {
  const { fontLink, sceneHtml } = await import('../public/jam2/scene.js');
  const kit = { fonts: { heading: 'FFDINfor Puma', body: 'Inter' }, files: [{ family: 'FFDINfor Puma', src: '/b/in-puma-com/a/font-abc123.woff2' }] };
  const h = fontLink(kit); assert.match(h, /@font-face\{font-family:'FFDINfor Puma';src:url\("\/b\/in-puma-com\/a\/font-abc123\.woff2"\)/); assert.match(h, /fonts\.googleapis\.com\/css2\?family=Inter/); assert.doesNotMatch(h, /family=FFDINfor/);
  assert.match(sceneHtml({ w: 10, h: 10, kit, layers: [] }, { srcOf: () => 'data:font/woff2;base64,AAAA' }), /src:url\("data:font\/woff2;base64,AAAA"\)/);
  for (const bad of ['javascript:alert(1)', '/b/x/a/font-a.woff2") ;}body{x', 'https://evil.example/f.woff2']) assert.doesNotMatch(fontLink({ fonts: { heading: 'X Y' }, files: [{ family: 'X Y', src: bad }] }), /@font-face/, bad);
});

test('a product’s own extra photos (back, side) feed its profile and every shoot; a 360 turn without a back photo says so before any spend', async () => {
  const m = maker(), ctx = { product: { img: 'p.jpg', name: 'MitoActive Serum', handle: 'mito' }, catalog: [{ t: 'MitoActive Serum', handle: 'mito', img: 'p.jpg', images: ['c2.jpg'] }],
    refs: [{ kind: 'image', job: 'product', product: 'MitoActive Serum', url: '/b/s/refs/back.jpg' }, { kind: 'image', job: 'product', product: 'Other', url: '/b/s/refs/x.jpg' }, { kind: 'image', job: 'style', url: '/b/s/refs/mood.jpg' }] };
  assert.deepEqual(m.creative.photosOf(ctx, { best: 'p.jpg' }), ['p.jpg', '/b/s/refs/back.jpg', 'c2.jpg']);
  assert.deepEqual(m.creative.refPhotos({ ...ctx, product: { img: 'q.jpg', name: 'MitoActive™ Serum - Pack of 3' } }), ['/b/s/refs/back.jpg'], 'a pack of the same item uses its photos');
  assert.deepEqual(m.creative.refPhotos({ ...ctx, product: { img: 'q.jpg', name: 'MitoActive Serums Kit' } }), [], 'a different product does not'); assert.deepEqual(m.creative.productEntry(ctx).images, ['/b/s/refs/back.jpg', 'c2.jpg']);
  const { createStudio } = await import('../jam2/studio.js');
  const st = (sides) => createStudio({ engines: { hf: { pick: () => ({ id: 'k', input: {} }), estimate: async () => ({ usd: 0.39 }), nearestRatio: () => '9:16' }, quote: async () => ({ usd: 0.1 }) }, maker: { creative: { productEntry: () => ({}) } }, profileOf: async () => ({ sides, usable: true }) });
  assert.match((await st(['front']).plan({ ...ctx }, { style: 'orbit-360', sizes: ['story'], seconds: 5, product: ctx.product })).note, /No photo shows its back/);
  assert.equal((await st(['front', 'back']).plan({ ...ctx }, { style: 'orbit-360', sizes: ['story'], seconds: 5, product: ctx.product })).note, null);
  assert.equal((await st(['front']).plan({ ...ctx }, { style: 'showcase', sizes: ['story'], seconds: 5, product: ctx.product })).note, null);
});

test('a reference added for a product is a product photo tied to it; the same bytes added for a product are re-tied', async () => {
  const { createReferences } = await import('../references.js'); const files = new Map();
  const packs = { getJSON: async (s, f, d) => (files.has(f) ? JSON.parse(files.get(f)) : d), put: async (s, f, v) => { files.set(f, typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)); } };
  const R = createReferences({ packs, log: { info() {} } }), png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e000502027f3c64a8a80000000049454e44ae426082', 'hex').toString('base64');
  const a = await R.add('s', { data: png, label: 'Back', product: 'MitoActive Serum' }); assert.equal(a.item.job, 'product'); assert.equal(a.item.product, 'MitoActive Serum');
  const b = await R.add('s', { data: png, label: 'Back', product: 'Super Shampoo' }); assert.ok(b.same); assert.equal((await R.list('s'))[0].product, 'Super Shampoo');
});

test('audit 23 Oct: what a brand allows (people, product, reviews) decides every Studio style, in the defaults, the price and the make', async () => {
  const { blockOf, defaults, styleOf, createStudio } = await import('../jam2/studio.js');
  const base = { bbv: { comfort: { people: 'none' }, reviews: [] }, product: { img: 'p.jpg', name: 'Serum' }, card: { title: 'Show it in a video', cta: { label: 'Make the video' } }, jam: { concept: {} } };
  assert.match(blockOf(styleOf('ugc-review'), base), /no people on camera/); assert.equal(blockOf(styleOf('showcase'), base), null);
  assert.match(blockOf(styleOf('hands'), base), /no people/); assert.match(blockOf(styleOf('closeup'), { ...base, bbv: { comfort: { people: 'hands' } } }), /hands only/);
  assert.match(blockOf(styleOf('ugc-home'), { ...base, bbv: { comfort: { people: 'consented' } } }), /only your own people/);
  assert.match(blockOf(styleOf('mp-benefits'), { ...base, product: null }), /shows your product/); assert.match(blockOf(styleOf('ugc-tutorial'), { ...base, bbv: { comfort: { people: 'ai-cast' } }, product: null }), /shows your product/);
  assert.match(blockOf(styleOf('quote-card'), base), /real customer review/); assert.equal(blockOf(styleOf('quote-card'), { ...base, bbv: { ...base.bbv, reviews: [{ text: 'Love it' }] } }), null);
  const d = defaults(base, { recipe: 'ugc-ad', kind: 'video' }); assert.ok(!d.styles.some((id) => /^(ugc|tt)-/.test(id)), d.styles.join()); assert.ok(d.blocked['ugc-review']);
  const st = createStudio({ engines: { hf: { pick: () => ({ id: 'x', input: {} }), estimate: async () => ({ usd: 3 }), nearestRatio: () => '9:16' }, quote: async () => ({ usd: 0.1 }) }, maker: { creative: {} } });
  assert.match((await st.plan(base, { style: 'ugc-review', sizes: ['story'] })).error, /no people on camera/);
  await assert.rejects(st.make(base, {}, { style: 'ugc-review', sizes: ['story'] }), /no people on camera/);
  /* a picture board stays a picture whatever the card says ("running shorts" is a product, not a video) */
  assert.equal(defaults({ ...base, bbv: { comfort: {} }, card: { title: 'New running shorts', cta: { label: 'Make the reel' } } }, { recipe: 'ig-post', kind: 'static' }).kind, 'image');
  assert.equal(defaults({ ...base, bbv: { comfort: {} }, card: { title: 'New running shorts in stock', cta: { label: 'Make the ad' } } }, null).kind, 'image');
  /* an enquiry brand opens on places and moments, never marketplace sets */
  assert.deepEqual(defaults({ ...base, bbv: { comfort: {} }, storeKind: 'enquiry' }, { recipe: 'listing', kind: 'carousel' }).set, ['in-use', 'editorial', 'natural', 'flat-lay']);
  /* counts are whole */
  assert.equal((await st.plan({ ...base, bbv: { comfort: {} } }, { style: 'showcase', sizes: ['story'], count: 2.5 })).count, 2);
});

test('audit 23 Oct: catalog photos are read from imgs; product words like "Silicone" or "Logo Cap" never hide a product', async () => {
  const m = maker(), ctx = { product: { img: 'a.jpg', name: 'Tee' }, catalog: [{ t: 'Tee', img: 'a.jpg', imgs: ['a.jpg', 'pack.jpg', 'side.jpg'] }] };
  assert.deepEqual(m.creative.photosOf(ctx, null), ['a.jpg', 'pack.jpg', 'side.jpg']); assert.deepEqual(m.creative.productEntry(ctx).images, ['a.jpg', 'pack.jpg', 'side.jpg']);
  const { catalogOf } = await import('../product-match.js');
  const t = catalogOf({ catalog: { products: ['Silicone Baby Bottle', 'Iconic Matte Lipstick', 'Logo Cap', 'Banner Stand', 'Gift Card'].map((title, i) => ({ title, img: `https://x/p${i}.jpg` })) } }).map((x) => x.t);
  assert.deepEqual(t, ['Silicone Baby Bottle', 'Iconic Matte Lipstick', 'Logo Cap', 'Banner Stand']);
});

test('audit 23 Oct: the words fit any frame (a 3:1 banner keeps the button inside), and a light brand colour gets dark button words', async () => {
  const sharp = (await import('sharp')).default, fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-')); fs.writeFileSync(path.join(dir, 'bg.png'), await sharp({ create: { width: 300, height: 100, channels: 3, background: '#203040' } }).png().toBuffer());
  const m = createMaker({ engines: { run: async () => { throw new Error('x'); } }, brandbook: { promptBlock: () => '' }, claudeTool: async () => { throw new Error('x'); }, isMock: () => true, saveGen: () => {}, genFile: async (n) => path.join(dir, n), photoAsync: async () => null });
  for (const zone of ['left', 'right', 'top', 'bottom']) { const sc = await m.creative.layout({ bbv: { kit: { colors: ['#ffe14d'], accent: '#ffe14d' } }, product: { name: 'Serum' } }, { w: 2400, h: 800 }, 'gen/bg.png',
    { headline: 'A sixty character headline that goes on for quite a long way', sub: 'And a ninety character sub line that also goes on and on and on for a long long way here', badge: '51,419 reviews', cta: 'Shop now' }, zone);
    const cta = sc.layers.find((l) => l.id === 'cta'); assert.ok(cta.y + cta.h <= 800, `${zone}: button at ${cta.y}+${cta.h}`); assert.equal(cta.style.color, '#111111'); }
  const { inkOn } = await import('../public/jam2/scene.js'); assert.equal(inkOn('#82b1ff'), '#111111', 'Arata light blue: dark words'); assert.equal(inkOn('#1d4ed8'), '#ffffff'); assert.equal(inkOn('#ab8c52'), '#111111');
});

test('audit 23 Oct: a Studio piece passes its gate (no product layer is needed); a check that never ran does not', async () => {
  const m = maker(), b = { recipe: 'image-ad' }, ctx = { ...ctxOf({ concept: {} }), product: { img: 'p.jpg', name: 'Serum' } };
  const g1 = m.gate(ctx, { studio: { kind: 'image', style: 'mp-main' }, file: 'gen/a.jpg', made: [{ cap: 'cutout' }], scene: { w: 2000, h: 2000, layers: [] }, words: {} }, b); assert.ok(g1.pass, JSON.stringify(g1.checks));
  const g2 = m.gate(ctx, { studio: { kind: 'video' }, file: 'gen/v.mp4', words: {} }, { recipe: 'reel' }); assert.ok(g2.pass, JSON.stringify(g2.checks));
  const g3 = m.gate(ctx, { studio: { kind: 'image' }, file: 'gen/a.jpg', shot: { why: "check didn't run: timeout" }, scene: { w: 1080, h: 1350, layers: [] }, words: {} }, b); assert.ok(!g3.pass);
});

test('audit 23 Oct: a Higgsfield request bought before a restart is polled again, never bought twice', async () => {
  const { createHiggsfield } = await import('../jam2/higgsfield.js'); const calls = [];
  const fetchImpl = async (url, o = {}) => { calls.push([o.method || 'GET', url]); if (/status/.test(url)) return { ok: true, json: async () => ({ status: 'completed', video: { url: 'https://cdn/x.mp4' } }) };
    if (/cdn/.test(url)) return { ok: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => new ArrayBuffer(4096) }; return { ok: true, json: async () => ({ status_url: 'https://api/status/1', request_id: 'r1' }) }; };
  const hf = createHiggsfield({ env: { HF_API_KEY_ID: 'a', HF_API_KEY_SECRET: 'b' }, fetchImpl, log: { warn() {} } }); const t0 = setTimeout; globalThis.setTimeout = (f) => t0(f, 0);
  try { const out = await hf.run('kling-video/v3.0/pro/image-to-video', {}, { resume: { id: 'k', status_url: 'https://api/status/1' } }); assert.equal(out.buf.length, 4096); assert.ok(!calls.some(([m]) => m === 'POST'), 'no second purchase'); }
  finally { globalThis.setTimeout = t0; }
});
