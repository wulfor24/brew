// node --test test/first-drafts.test.js — format-true first drafts on feed cards (drafts-bg.js, draft-mocks.js, cards-gen inferMake), free:
// no AI (a fake ai returns canned JSON), no image or video model (fake makers), no network. The format → draft mapping, the
// back-fill of "make" at pack load, keying by card id + move + format, real-cost booking under the cap, and the feed view.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { draftKind, draftKey, draftFor, needsDraft, draftView, estUsd, imageCost, FORMAT_KIND, DRAFTS_DEFAULTS, createDraftsBg, seedDrafts, DRAFT_K } from '../drafts-bg.js';
import { inferMake, fillMake } from '../cards-gen.js';
import { emailHtml, whatsappHtml, pageHtml, collectionHtml, splitCopy, mdHtml } from '../draft-mocks.js';
import { createPacks } from '../brand-pack.js';
import { createMakers } from '../drafts.js';

const NOW = Date.parse('2026-10-14T12:00:00Z'), DAY = 864e5;
const quiet = { warn: () => {}, info: () => {}, log: () => {}, error: () => {} };

test('every card format maps to a draft of that format', () => {
  const want = { 'video ad': 'video', reel: 'video', 'carousel ad': 'carousel', 'instagram carousel': 'carousel', 'instagram stories': 'stories', 'collection ad': 'collection', 'catalog ad': 'catalog', 'single image ad': 'image', 'instagram post': 'image', email: 'email', 'whatsapp message': 'whatsapp', 'page section': 'page' };
  assert.deepEqual(FORMAT_KIND, want);
  for (const [format, kind] of Object.entries(want)) assert.equal(draftKind({ id: 'm01-1', title: 'x', make: { format } }), kind, format);
  assert.equal(draftKind({ id: 'm02-1', type: 'report', kind: 'rows', title: 'Price report' }), 'text', 'no format: the cheapest fitting form');
  assert.equal(draftKind({ id: 'm03-1', type: 'idea', kind: 'media', images: ['a.jpg'], title: 'A new angle' }), 'image');
  // the cost before a draft is made: words, then pictures, then the clip
  const c = DRAFTS_DEFAULTS; assert.equal(estUsd('email'), c.textUsd); assert.equal(estUsd('image'), c.textUsd + c.imageUsd); assert.ok(Math.abs(estUsd('video') - (c.textUsd + c.imageUsd + c.videoUsd + c.voiceUsd)) < 1e-9);
  assert.ok(estUsd('video') > estUsd('image'), 'a clip costs more than a picture');
  assert.equal(imageCost(Object.assign(Buffer.from('x'), { guard: { retried: true } })), 2 * c.imageUsd, 'an image-guard retry is booked as two pictures'); assert.equal(imageCost(Buffer.from('x')), c.imageUsd);
});

test('cards that name an asset get "make" back-filled from their own words; others are left alone', () => {
  const f = (o) => inferMake({ id: 'm21-1', type: 'idea', ...o })?.format || null;
  assert.equal(f({ title: 'Run the Hukum carousel as a paid ad', cta: { label: 'Publish Campaign' } }), 'carousel ad');
  assert.equal(f({ title: 'Open every gallery with a carousel of the craft', cta: { label: 'Generate versions' } }), 'instagram carousel');
  assert.equal(f({ title: 'Rewrite the review ask around fit', cta: { label: 'Send the review ask' } }), 'email', 'the button says what ships');
  assert.equal(f({ title: 'Text customers two days after delivery', cta: { label: 'Approve the flows' } }), 'whatsapp message');
  assert.equal(f({ title: 'A win-back email for lapsed buyers', cta: { label: 'Approve the flows' } }), 'email');
  assert.equal(f({ title: 'Make the sold-out page a way to buy', cta: { label: 'Turn on the journey' } }), 'page section');
  assert.equal(f({ title: 'Lead the ads with comfort and story', cta: { label: 'Generate versions' } }), 'single image ad');
  assert.equal(f({ title: 'Cut the slow intro from the reel', cta: { label: 'Make the video' } }), 'reel');
  assert.equal(f({ title: 'Three stories for the drop', cta: { label: 'Draft the stories' } }), 'instagram stories');
  assert.equal(f({ title: 'Video ads that open on the sole', cta: { label: 'Queue the ads' } }), 'video ad');
  assert.equal(f({ title: 'Sort 397 collections down to 40', cta: { label: 'Approve the flows' } }), null, 'a flow button alone names no format');
  assert.equal(f({ title: 'Check the Meta purchase event before moving budget', cta: { label: 'Fix tracking' } }), null, 'a fix is not an asset');
  assert.equal(f({ title: 'Pause the ad that burns budget', sub: 'It spent 400 with no sales.', cta: { label: 'Agree with the call' } }), null);
  assert.equal(inferMake({ id: 'm05-1', type: 'report', title: 'Rival email every week', cta: { label: 'Review draft' } }), null, 'reports are left alone');
  assert.equal(inferMake({ id: 'read-2', type: 'idea', title: 'Neeman’s runs 654 ads' }), null, 'read cards are left alone');
  const kept = { id: 'm09-1', type: 'idea', title: 'An email', make: { format: 'reel', pieces: '1 reel' } }; assert.deepEqual(fillMake(kept).make, kept.make, 'a card that has "make" keeps it');
  assert.deepEqual(fillMake({ ...kept, roles: ['ecom'] }).roles, ['ecom', 'brand', 'growth', 'founder'], 'an ad or post card reaches the creative seats and the founder');
  assert.deepEqual(fillMake({ id: 'm11-1', type: 'idea', title: 'Add the search info', roles: ['ecom'], cta: { label: 'Add the search info' } }).roles, ['ecom'], 'other cards keep their roles');
  assert.deepEqual(fillMake({ id: 'm10-1', type: 'idea', title: 'Send the WhatsApp back-in-stock alert' }).make, { format: 'whatsapp message', pieces: '', inferred: true });
});

test('old packs get "make" at load, with the button fitted to it', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-fd-')), P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  await P.put('acme-com', 'seed.json', { brand: { name: 'Acme', host: 'acme.com' }, lanes: { core: { name: 'Core' } }, roles: {}, posts: [
    { id: 'm21-1', type: 'idea', kind: 'rows', rows: [['a', 'b']], title: 'Run the runner carousel as a paid ad', sub: 's', src: 'Move 21', cta: { label: 'Draft the post' } },
    { id: 'm05-1', type: 'decision', kind: 'rows', rows: [['a', 'b']], title: 'Agree the price', sub: 's', src: 'Move 05', cta: { label: 'Agree with the call' } }] });
  await P.put('acme-com', 'status.json', { name: 'Acme', ready: true }); await P.put('acme-com', 'config.json', {}); await P.put('acme-com', 'facts.json', {});
  const p = await P.load('acme-com'), [a, b] = p.seed.posts;
  assert.equal(a.make.format, 'carousel ad'); assert.equal(a.cta.label, 'Make the carousel ad', 'the making button follows the back-filled format');
  assert.equal(b.make, undefined); assert.equal(b.cta.label, 'Agree with the call');
  assert.equal(draftKind(a), 'carousel');
});

test('drafts are keyed by card id, move and format: a rewrite in the same format keeps its draft, a new format re-drafts', () => {
  const card = { id: 'm21-1', src: 'Move 21 · Ads', title: 'Run the carousel', type: 'idea', make: { format: 'carousel ad' } };
  assert.equal(draftKey(card), 'm21-1|21|carousel');
  const all = { 'm21-1': { k: DRAFT_K, key: draftKey(card), as: 'carousel', slides: [{ image: 'gen/a.jpg' }], cardTitle: card.title } };
  assert.ok(draftFor(card, all)); assert.ok(draftFor({ ...card, title: 'Run the Hukum carousel', sub: 'rewritten' }, all), 'same format, new words: the draft stays');
  assert.equal(draftFor({ ...card, make: { format: 'instagram carousel' } }, all) && 'kept', 'kept', 'carousel ad and Instagram carousel are one draft format');
  assert.equal(draftFor({ ...card, make: { format: 'reel' } }, all), null, 'a new format: the old draft is not shown');
  assert.equal(draftFor({ ...card, src: 'Move 1002 · Ads' }, all), null, 'another move');
  assert.equal(needsDraft(card, all, NOW), false); assert.equal(needsDraft({ ...card, make: { format: 'email' } }, all, NOW), true);
  // drafts made before keys carried the format: shown while the title is unchanged, always re-made in the format
  const old = { 'm21-1': { key: 'abc', cardTitle: 'Run the carousel', as: 'text', copy: 'x' } };
  assert.ok(draftFor(card, old)); assert.equal(draftFor({ ...card, title: 'Other' }, old), null); assert.equal(needsDraft(card, old, NOW), true);
  // a failure is tried again with backoff (30 min after the first, 2 h after the second, never more than a day), and is never shown
  const failed = { 'm21-1': { k: DRAFT_K, key: draftKey(card), failedAt: NOW - 20 * 60e3 } };
  assert.equal(draftFor(card, failed), null); assert.equal(needsDraft(card, failed, NOW), false); assert.equal(needsDraft(card, failed, NOW + 15 * 60e3), true);
  const twice = { 'm21-1': { k: DRAFT_K, key: draftKey(card), failedAt: NOW - 3600e3, fails: 2 } };
  assert.equal(needsDraft(card, twice, NOW), false, 'the second failure waits 2 hours'); assert.equal(needsDraft(card, twice, NOW + 3600e3), true);
  const many = { 'm21-1': { k: DRAFT_K, key: draftKey(card), failedAt: NOW, fails: 9 } };
  assert.equal(needsDraft(card, many, NOW + DAY - 1), false); assert.equal(needsDraft(card, many, NOW + DAY), true, 'never more than a day');
  // the feed sees only drafts with something to look at
  assert.deepEqual(draftView({ as: 'carousel', ratio: '4:5', title: 'T', copy: '**Bold** words', slides: [{ image: 'gen/1.jpg' }, { image: 'gen/2.jpg' }], image: 'gen/1.jpg' }), { as: 'carousel', kind: 'carousel', images: ['gen/1.jpg', 'gen/2.jpg'], video: null, poster: null, ratio: '4:5', title: 'T', copy: 'Bold words' });
  assert.equal(draftView({ as: 'video', video: 'gen/v.mp4', image: 'gen/f.png' }).poster, 'gen/f.png');
  assert.deepEqual(draftView({ as: 'email', render: 'gen/m.jpg', image: null }).images, ['gen/m.jpg']);
  assert.equal(draftView({ as: 'text', copy: 'words only' }), null);
});

test('the mocks carry the draft’s own words, escaped, in the brand’s colour', () => {
  const s = splitCopy('Subject: Your size, saved\nPreview: One tap next time\n\nHi there,\n\n**We kept** your size.\n\n- Fits like before\n\nButton: Shop your size');
  assert.deepEqual([s.subject, s.preview, s.button], ['Your size, saved', 'One tap next time', 'Shop your size']); assert.ok(!/Subject|Button/.test(s.body));
  assert.match(mdHtml('# Hi\n**b** and *c*\n- one\n- two'), /<h3>Hi<\/h3><p><b>b<\/b> and <b>c<\/b><\/p><ul><li>one<\/li><li>two<\/li><\/ul>/);
  const brand = { name: 'Acme', host: 'acme.com', colors: ['#f5f5f5', '#1d3557'] };
  const e = emailHtml({ brand, title: 'T', copy: 'Subject: <script>x</script>\nHello' }); assert.ok(e.includes('&lt;script&gt;') && !e.includes('<script>x')); assert.ok(e.includes('#1d3557'), 'the dark brand colour carries the button');
  assert.match(whatsappHtml({ brand, copy: 'Back in stock: the Runner.\nButton: See sizes' }), /Business account[\s\S]*Back in stock[\s\S]*See sizes/);
  assert.match(pageHtml({ brand, title: 'T', copy: 'Headline: Free size swaps\nWords' }), /acme\.com[\s\S]*Free size swaps/);
  const g = collectionHtml({ brand, title: 'Drop 4', hero: 'data:image/png;base64,AA', products: [{ t: 'Runner', price: '$98', img: 'data:x' }, { t: 'Slide', img: 'data:y' }] });
  assert.match(g, /Drop 4[\s\S]*Runner[\s\S]*\$98[\s\S]*Slide/);
});

/* a brand with a catalog, a feed of cards in every format, fake models: what the job makes, what it books, what the jam gets */
async function setup(posts) {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-fd-')), P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const photo = path.join(ROOT, 'p.jpg'); fs.writeFileSync(photo, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  await P.put('acme-com', 'seed.json', { brand: { name: 'Acme', host: 'acme.com', colors: ['#ffffff', '#123456'] }, lanes: { core: { name: 'Core' } }, laneImg: { core: 'b/acme-com/a/runner.jpg' }, roles: {}, posts });
  await P.put('acme-com', 'status.json', { name: 'Acme', ready: true }); await P.put('acme-com', 'config.json', {}); await P.put('acme-com', 'facts.json', {});
  await P.put('acme-com', 'profile.json', { catalog: { products: ['Runner', 'Slide', 'Loafer', 'Sock'].map((t, i) => ({ title: t, img: `b/acme-com/a/${t.toLowerCase()}.jpg`, priceLabel: `$${40 + i}`, inStock: true })) } });
  return { P, photo };
}
const fakeAI = () => { const calls = []; return { live: true, calls, call: async (q) => { calls.push(q.prompt); const as = /Make it as a carousel/.test(q.prompt) ? 'carousel' : 'text';
  return { usd: 0.03, json: { as, title: 'Draft for the Runner', copy: 'Subject: Your Runner is back\nHi.\nButton: Shop', visual: 'On a track', motion: 'Slow push in', script: 'Run further', ratio: '4:5', slides: [{ onSlide: 'One', visual: 'a' }, { onSlide: 'Two', visual: 'b' }, { onSlide: 'Three', visual: 'c' }] } }; } }; };

test('the job drafts every card that names a format, in that format, booked at real cost, and the jam and feed get it', async () => {
  const posts = [
    { id: 'm01-1', type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], title: 'A Runner ad', sub: 's', src: 'Move 01', time: '5 min', agent: 'creative', make: { format: 'single image ad' } },
    { id: 'm02-1', type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], title: 'The Runner reel', sub: 's', src: 'Move 02', time: '6 min', agent: 'creative', make: { format: 'reel' } },
    { id: 'm03-1', type: 'idea', kind: 'rows', rows: [['a', 'b']], title: 'Win-back email', sub: 's', src: 'Move 03', time: '7 min', agent: 'crm', make: { format: 'email' } },
    { id: 'm04-1', type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], title: 'Drop stories', sub: 's', src: 'Move 04', time: '8 min', agent: 'creative', make: { format: 'instagram stories' } },
    { id: 'm05-1', type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], title: 'The drop collection', sub: 's', src: 'Move 05', time: '9 min', agent: 'creative', make: { format: 'collection ad' } },
    { id: 'm06-1', type: 'decision', kind: 'rows', rows: [['a', 'b']], title: 'Back-in-stock WhatsApp alert', sub: 's', src: 'Move 06', time: '10 min', agent: 'crm', cta: { label: 'Approve the flows' } }, /* no make: back-filled at load */
    { id: 'm07-1', type: 'report', kind: 'rows', rows: [['a', 'b']], title: 'Price report', sub: 's', src: 'Move 07', time: '11 min', agent: 'brew' }];
  const { P, photo } = await setup(posts);
  let videoOk = false, charge = null; const html = [], made = { video: 0, carousel: [] };
  const treg = { onCharge: (f) => { charge = f; } };
  const makers = { render: async (h, ratio) => { html.push(h); return `gen/mock${html.length}.jpg`; },
    carousel: async (o) => { made.carousel.push(o.ratio); o.slides.forEach((_, i) => o.canSpend(i)); return { slides: o.slides.map((x, i) => ({ text: x.onSlide, image: `gen/s${i}.jpg` })), image: 'gen/s0.jpg', made: o.slides.length, retried: 1 }; },
    video: async () => { made.video++; return 'clip.mp4'; } /* made on our Vertex account: booked at the clip's set price */, voice: async () => 'vo.wav', mux: async () => 'both.mp4' };
  let n = 0; const geminiImage = async () => Object.assign(Buffer.from('png'), { guard: { retried: ++n === 1 } }); /* the first picture needed an image-guard retry */
  const J = createDraftsBg({ packs: P, ai: fakeAI(), geminiImage, saveGen: () => {}, genFile: async () => photo, photoAsync: async () => photo, treg, launchBrowser: () => ({}), makers, spend: (k) => (k === 'video' ? videoOk : true),
    loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW - DAY, log: quiet, env: { DRAFTS_BG: '1', DRAFTS_PER_RUN: '20', DRAFTS_CLIPS_PER_DAY: '0' }, now: () => NOW });
  const r = await J.runOne('acme-com');
  const cache = await J.cacheOf('acme-com'), by = (id) => cache[id];
  assert.deepEqual(Object.keys(cache).filter((k) => cache[k].format).sort(), ['m01-1', 'm02-1', 'm03-1', 'm04-1', 'm05-1', 'm06-1'], 'every card that names a format (m06-1 by back-fill)');
  assert.equal(by('m01-1').as, 'image'); assert.match(by('m01-1').image, /^gen\/[a-f0-9]{16}\.png$/);
  assert.equal(by('m02-1').as, 'image'); assert.equal(by('m02-1').wants, 'video', 'over DAILY_VIDEO_CAP the reel waits as its first frame'); assert.equal(made.video, 0);
  assert.equal(by('m03-1').as, 'email'); assert.equal(by('m03-1').render, 'gen/mock1.jpg'); assert.match(html[0], /Your Runner is back/);
  assert.equal(by('m04-1').as, 'carousel'); assert.equal(by('m04-1').ratio, '9:16'); assert.deepEqual(made.carousel, ['9:16']); assert.equal(by('m04-1').slides.length, 3);
  assert.equal(by('m05-1').as, 'collection'); assert.ok(by('m05-1').image && by('m05-1').render); assert.match(html[1], /Runner[\s\S]*\$40[\s\S]*Slide/, 'the grid shows real catalog products');
  assert.equal(by('m06-1').as, 'whatsapp'); assert.equal(by('m06-1').format, 'whatsapp message'); assert.match(html[2], /Business account/);
  // real cost: the words, each picture (the first one twice for its retry), every slide and its retry; the mocks are free
  const c = DRAFTS_DEFAULTS, want = 6 * 0.03 + 3 * c.imageUsd /* image, first frame, hero */ + c.imageUsd /* the retry */ + 4 * c.imageUsd /* 3 slides + 1 retry */;
  assert.ok(Math.abs(r.usd - want) < 1e-6, `${r.usd} vs ${want}`); assert.equal((await J.stateOf('acme-com')).spend.usd, +want.toFixed(4));
  // the next run: nothing to redo, but the reel gets its clip now the video limit allows it, booked at the clip's price
  videoOk = true; const r2 = await J.runOne('acme-com');
  assert.equal(r2.made.length, 1); assert.equal(r2.made[0].cardId, 'm02-1'); assert.equal(made.video, 1); assert.ok(Math.abs(r2.usd - c.videoUsd) < 1e-9, String(r2.usd));
  const reel = (await J.cacheOf('acme-com'))['m02-1']; assert.equal(reel.as, 'video'); assert.equal(reel.video, 'gen/both.mp4', 'the voiceover is in the clip'); assert.ok(!reel.wants);
  // what the feed card and the jam get
  assert.deepEqual(draftView(reel).video, 'gen/both.mp4'); assert.equal(draftView(reel).poster, reel.image);
  const p = await P.load('acme-com', { fresh: true }), wa = p.seed.posts.find((x) => x.id === 'm06-1');
  assert.deepEqual(draftView(draftFor(wa, p.firstDrafts)).images, ['gen/mock3.jpg']);
  const w = { id: 'wk1' }; assert.ok(seedDrafts(w, wa, p.firstDrafts, { uid: () => 'dr1', at: NOW })); assert.equal(w.drafts[0].render, 'gen/mock3.jpg'); assert.equal(w.drafts[0].asked, 'auto'); assert.ok(!('key' in w.drafts[0]) && !('kind' in w.drafts[0]));
});

test('the daily cap holds: dear drafts wait, cheaper ones further down still fit', async () => {
  const posts = [
    { id: 'm01-1', type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], title: 'Carousel', sub: 's', src: 'Move 01', time: '1 min', agent: 'creative', make: { format: 'carousel ad' } },
    { id: 'm02-1', type: 'idea', kind: 'rows', rows: [['a', 'b']], title: 'Email', sub: 's', src: 'Move 02', time: '2 min', agent: 'crm', make: { format: 'email' } }];
  const { P, photo } = await setup(posts);
  const makers = { render: async () => 'gen/m.jpg', carousel: async (o) => { let k = 0; o.slides.forEach((_, i) => { if (o.canSpend(i)) k++; }); return { slides: [], image: null, made: k, retried: 0 }; } };
  const J = createDraftsBg({ packs: P, ai: fakeAI(), geminiImage: async () => Buffer.from('png'), saveGen: () => {}, genFile: async () => photo, photoAsync: async () => photo, launchBrowser: () => ({}), makers,
    loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW - DAY, log: quiet, env: { DRAFTS_BG: '1', DRAFTS_DAY_CAP_USD: '0.3' }, now: () => NOW });
  const r = await J.runOne('acme-com'); assert.ok(r.usd <= 0.3 + 1e-9, String(r.usd));
  const cache = await J.cacheOf('acme-com'); assert.equal(cache['m02-1'].as, 'email', 'the free mock still fits');
  assert.ok(!cache['m01-1'] || cache['m01-1'].as !== 'carousel' || cache['m01-1'].usd <= 0.3, 'the carousel never runs past the cap');
});

const R = await import('../pdf/render.js').catch(() => null); /* puppeteer-core may be missing where only the unit tests run */
test('Chromium renders the mocks at 1080 x 1350 (skipped without Chrome)', { skip: !R || !fs.existsSync(R.chromePath()) }, async (t) => {
  const b0 = await R.launchBrowser().catch(() => null); if (!b0) return t.skip('Chrome could not start here'); await b0.close(); /* a sandbox may block Chrome */
  const saved = []; const M = createMakers({ launchBrowser: R.launchBrowser, save: (name, buf) => saved.push([name, buf]) });
  const out = await M.render(emailHtml({ brand: { name: 'Acme', colors: ['#123456'] }, title: 'Hi', copy: 'Subject: Your size\nHello' }), '4:5');
  assert.match(out, /^gen\/[a-f0-9]{16}\.jpg$/); const buf = Buffer.from(saved[0][1]); assert.equal(buf[0], 0xff, 'a JPEG');
  assert.equal(buf.readUInt16BE(buf.indexOf(Buffer.from([0xff, 0xc0])) + 5), 1350); assert.equal(buf.readUInt16BE(buf.indexOf(Buffer.from([0xff, 0xc0])) + 7), 1080);
});

test('a draft made before Sloosh (k 2) stays on its card until its Sloosh draft lands, and is asked for again (27 Oct)', async () => {
  const { draftFor, needsDraft, draftKey: dk, DRAFT_K } = await import('../drafts-bg.js');
  const card = { id: 'm9-1', title: 'Warm feet at the desk', make: { format: 'image' } };
  const old = { 'm9-1': { k: 2, key: dk(card), as: 'image', image: 'gen/old.png', cardTitle: card.title } };
  assert.equal(DRAFT_K, 4); assert.ok(draftFor(card, old), 'still shown'); assert.equal(needsDraft(card, old), true, 'remade on Sloosh');
  assert.equal(needsDraft(card, { 'm9-1': { ...old['m9-1'], k: DRAFT_K } }), false);
});

test('the team’s private move cards (private/cards.json, ids ending -p) get first drafts too; live readings still never do (27 Oct)', async () => {
  const { rankCards } = await import('../drafts-bg.js');
  const posts = [{ id: 'm24-2-p', title: 'Stop curl buildup', liveOnly: true, privateOf: 24, make: { format: 'instagram carousel' } }, { id: 'live-ga4', title: 'Sessions', liveOnly: true }];
  const r = rankCards(posts).map((c) => c.id); assert.ok(r.includes('m24-2-p')); assert.ok(!r.includes('live-ga4'));
  const src = fs.readFileSync(new URL('../drafts-bg.js', import.meta.url), 'utf8'); assert.match(src, /getJSON\(slug, 'private\/cards\.json'/);
});

/* 27 Oct (Arata's feed was one bottle on a plain ground after another, and hardly a clip): every card takes a look the feed has
   used least, and up to three cards a day get a clip, image cards too, never on the real product photo */
test('looks rotate across the feed, and up to DRAFTS_CLIPS_PER_DAY image cards get a clip, never a real-photo stand-in', async () => {
  const { LOOKS, pickLook, clipMotion } = await import('../drafts-bg.js');
  const a = pickLook({}, 'm1-1'), seen = { 'm1-1': { cardId: 'm1-1', look: a.key } }, b = pickLook(seen, 'm2-1');
  assert.notEqual(a.key, b.key, 'the next card takes another look'); assert.ok(LOOKS.length >= 5);
  const all = {}; for (let i = 0; i < LOOKS.length; i++) { const l = pickLook(all, `c${i}`); all[`c${i}`] = { cardId: `c${i}`, look: l.key }; }
  assert.equal(new Set(Object.values(all).map((d) => d.look)).size, LOOKS.length, 'one of each before any repeats');
  assert.notEqual(pickLook({}, 'v', 'video').key, 'poster'); assert.match(clipMotion({ visual: 'a woman at a misty mirror' }), /misty mirror[\s\S]*moves naturally/);
  const posts = [1, 2, 3, 4, 5].map((i) => ({ id: `m0${i}-1`, type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], title: `Runner ad ${i}`, sub: 's', src: `Move 0${i}`, time: '5 min', agent: 'creative', make: { format: 'single image ad' } }));
  const { P, photo } = await setup(posts); let clips = 0, k = 0;
  const makers = { render: async () => 'gen/r.jpg', video: async () => { clips++; return `clip${clips}.mp4`; }, voice: async () => 'vo.wav', mux: async () => 'both.mp4', head: async () => null };
  const geminiImage = async () => Object.assign(Buffer.from('png'), { guard: ++k === 2 ? { genFailed: true } : {} }); /* card 2 is the real photo */
  const J = createDraftsBg({ packs: P, ai: fakeAI(), geminiImage, saveGen: () => {}, genFile: async () => photo, photoAsync: async () => photo, treg: { onCharge: () => {} }, launchBrowser: () => ({}), makers, spend: () => true,
    loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW - DAY, log: quiet, env: { DRAFTS_BG: '1', DRAFTS_PER_RUN: '20' }, now: () => NOW });
  await J.runOne('acme-com'); await J.runOne('acme-com');
  const cache = await J.cacheOf('acme-com'), ds = posts.map((p) => cache[p.id]);
  assert.ok(ds.every((d) => d.look), 'every picture card has its look'); assert.ok(new Set(ds.map((d) => d.look)).size >= 4, 'neighbours look different');
  const withClip = ds.filter((d) => d.video); assert.equal(withClip.length, 3, 'three clips a day'); assert.ok(!withClip.some((d) => d.photoOnly), 'never on the real photo');
  assert.ok(withClip.every((d) => d.kind === 'image' && d.clipStill), 'an image card clip opens on its own 9:16 still');
});

test('a redraft (DRAFT_K bump) that comes back without a picture keeps the card\'s old draft and waits', async () => {
  const { hasPicture } = await import('../drafts-bg.js');
  const posts = [{ id: 'm01-1', type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], title: 'Runner ad', sub: 's', src: 'Move 01', time: '5 min', agent: 'creative', make: { format: 'single image ad' } }];
  const { P, photo } = await setup(posts);
  const old = { k: DRAFT_K - 1, key: draftKey(posts[0]), cardId: 'm01-1', cardTitle: 'Runner ad', as: 'image', kind: 'image', image: 'gen/old.png', product: 'Runner', photo: 'b/acme-com/a/runner.jpg', qv: 3, checkedAt: NOW, at: NOW - DAY };
  await P.put('acme-com', 'drafts/cards.json', { 'm01-1': old });
  const geminiImage = async () => Object.assign(Buffer.from('jpg'), { guard: { genFailed: true, gens: 1, error: 'quota' } }); /* the new picture is only the real photo */
  const J = createDraftsBg({ packs: P, ai: fakeAI(), geminiImage, saveGen: () => {}, genFile: async () => photo, photoAsync: async () => photo, treg: { onCharge: () => {} }, launchBrowser: () => ({}), makers: { render: async () => 'gen/r.jpg', head: async () => null }, spend: () => true,
    loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW - DAY, log: quiet, env: { DRAFTS_BG: '1', DRAFTS_CLIPS_PER_DAY: '0' }, now: () => NOW });
  await J.runOne('acme-com'); const d = (await J.cacheOf('acme-com'))['m01-1'];
  assert.equal(d.image, 'gen/old.png', 'the old picture stays'); assert.ok(hasPicture(d)); assert.ok(d.retryAt > NOW, 'the redraft is tried again later');
  assert.equal(needsDraft(posts[0], { 'm01-1': d }, NOW), false); assert.equal(needsDraft(posts[0], { 'm01-1': d }, d.retryAt + 1), true);
});

/* 27 Oct (Param: "why the same photo in all 4 carousel slides?"): a jam piece gets its own first look, a made picture per frame, each
   a different look, no words drawn in; a frame that fails is asked again later, never the store photo */
test('a jam piece\'s first look: one made picture per frame, each a different look, no words in them; a failed frame waits and is made later', async () => {
  const posts = [{ id: 'static-wash-p', type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], title: 'Runner ad', sub: 's', src: 'Move 01', time: '5 min', agent: 'creative', make: { format: 'single image ad' } }];
  const { P, photo } = await setup(posts); const asks = []; let fail = 1;
  const geminiImage = async (o) => { asks.push(o); if (asks.length === 3 && fail-- > 0) throw new Error('Vertex 429'); return Object.assign(Buffer.from(`png${asks.length}`), { guard: {} }); };
  let clock = NOW; const J = createDraftsBg({ packs: P, ai: fakeAI(), geminiImage, saveGen: () => {}, genFile: async () => photo, photoAsync: async () => photo, treg: { onCharge: () => {} }, launchBrowser: () => ({}), makers: { render: async () => 'gen/r.jpg' }, spend: () => true,
    loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW, log: quiet, env: { DRAFTS_BG: '1' }, now: () => clock });
  const o = { piece: 'carousel-ad', n: 4, ratio: '1:1', product: 'Runner', words: ['One', 'Two', 'Three', 'Four'] };
  assert.equal((await J.firstLook('acme-com', 'static-wash-p', o)).pending, true);
  await new Promise((r) => setTimeout(r, 50)); let v = await J.firstLook('acme-com', 'static-wash-p', o);
  assert.equal(asks.length, 4); assert.equal(v.images.filter(Boolean).length, 3, 'three made, one failed'); assert.equal(v.done, false);
  assert.equal(new Set(asks.map((a) => a.prompt)).size, 4, 'every frame its own brief'); assert.ok(asks.every((a) => !a.words), 'no words drawn in: the stage sets them');
  assert.ok(asks.every((a) => a.fallback === false || a.fallback === undefined), 'never the store photo as a frame'); assert.match(asks[0].prompt, /"One"/);
  clock = NOW + 31 * 60e3; await J.firstLook('acme-com', 'static-wash-p', o); await new Promise((r) => setTimeout(r, 50)); v = await J.firstLook('acme-com', 'static-wash-p', o);
  assert.equal(v.images.filter(Boolean).length, 4); assert.equal(v.done, true); assert.equal(asks.length, 5, 'only the missing frame is made again');
});

test('a first look for a card in no saved list (a team static, static-…-p) uses the card the jam hands it; a look that can\'t start says why', async () => {
  const { P, photo } = await setup([]); const asks = [];
  const geminiImage = async (o) => { asks.push(o); return Object.assign(Buffer.from(`png${asks.length}`), { guard: {} }); };
  const J = createDraftsBg({ packs: P, ai: fakeAI(), geminiImage, saveGen: () => {}, genFile: async () => photo, photoAsync: async () => photo, treg: { onCharge: () => {} }, launchBrowser: () => ({}), makers: {}, spend: () => true,
    loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW, log: quiet, env: { DRAFTS_BG: '1' }, now: () => NOW });
  const card = { id: 'static-trio-3-p', title: 'Wake up dormant follicles', sub: '3% Redensyl in every drop', product: 'Runner', images: ['/b/acme-com/team/statics/trio-3.jpg'] };
  await J.firstLook('acme-com', card.id, { card, piece: 'carousel-ad', n: 2, ratio: '1:1', product: 'Runner' }); await new Promise((r) => setTimeout(r, 50));
  const v = await J.firstLook('acme-com', card.id, { card, piece: 'carousel-ad', n: 2, ratio: '1:1', product: 'Runner' });
  assert.equal(v.images.filter(Boolean).length, 2); assert.match(asks[0].prompt, /Wake up dormant follicles/, 'the card\'s context in every frame');
  await J.firstLook('acme-com', 'nope-p', { piece: 'carousel-ad', n: 2 }); await new Promise((r) => setTimeout(r, 50));
  const s = await J.firstLook('acme-com', 'nope-p', { piece: 'carousel-ad', n: 2 }); assert.equal(s.stop, true); assert.match(s.err, /not in this brand/);
});
