// node --test test/drafts-engagement.test.js — first drafts that hook (17 Oct), free: no AI (canned plans), no image or video
// model (fakes), no network, no Chromium (a fake browser that records the page it is asked to shoot).
//   1. the product check's four answers (image-guard.js): SAME keeps, TEXT is made once more on the other model and then kept,
//      NOREF moves to the next catalog photo or keeps the picture unchecked, DIFFERENT retries and then the real photo stands in
//   2. a picture the day's budget refused is made after the reset from the saved prompt, with no new plan; slides the budget
//      refused are a failure that waits for the reset (never words for good); a picture is booked at its real flash price
//   3. the headline is set on the picture in exact type (never asked of the image model), a stand-in gets it too, and the feed
//      shows the set picture; the plan opens on buyers' words, the rival ads that keep running and the scenes already shown
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createImageGuard, verdictOf } from '../image-guard.js';
import { createDraftsBg, draftView, draftFor, needsDraft, nextDay, DRAFTS_DEFAULTS, imageCost } from '../drafts-bg.js';
import { createPacks, hooksOf } from '../brand-pack.js';
import { sceneOf } from '../product-match.js';

const NOW = Date.parse('2026-10-14T12:00:00Z'), DAY = 864e5;
const quiet = { warn: () => {}, info: () => {}, log: () => {}, error: () => {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brew-hook-'));

/* ---------- 1. the four answers ---------- */
const gdir = tmp(), gfile = (n, body) => { const f = path.join(gdir, n); fs.writeFileSync(f, body); return f; };
const HUKUM = gfile('hukum.jpg', 'HUKUM-PHOTO'), DEEP = gfile('deep.jpg', 'DEEP-PHOTO'), CARD = gfile('card.jpg', 'CARD-PHOTO');
const catalog = [{ t: 'Aeres HUKUM IVORY', img: 'https://cdn/hukum.jpg' }, { t: 'Aeon V2 DEEPSPACE', img: 'https://cdn/deep.jpg' }];
const fetchPhoto = async (u) => ({ 'https://cdn/hukum.jpg': HUKUM, 'https://cdn/deep.jpg': DEEP }[u] || null);
const rig = (answers, o = {}) => { const calls = [], checks = [];
  const gen = async (x) => { calls.push(x); return Buffer.from(`GEN${calls.length}`); };
  const verify = async (ref, buf, name) => { checks.push({ ref, buf: buf.toString(), name }); const v = answers.shift(); if (v instanceof Error) throw v; return typeof v === 'string' ? { same: v === 'same' || v === 'noref', text: v === 'text', noref: v === 'noref' } : v; };
  return { calls, checks, guard: createImageGuard({ gen, verify, fetchPhoto, textModel: 'pro-image', log: quiet, ...o }) }; };

test('the check answers in one of four words; old checkers that say only same still read right', () => {
  assert.equal(verdictOf({ same: true }), 'same'); assert.equal(verdictOf({ same: false }), 'different');
  assert.equal(verdictOf({ same: false, text: true }), 'text'); assert.equal(verdictOf({ same: true, noref: true }), 'noref');
});

test('SAME keeps the picture; the prompt asks for the product, never its exact small print', async () => {
  const a = rig(['same']); const b = await a.guard({ srcFile: CARD, prompt: 'A scene', text: 'The Hukum collection', catalog });
  assert.equal(b.toString(), 'GEN1'); assert.equal(a.calls.length, 1); assert.equal(b.guard.same, true); assert.equal(b.guard.gens, 1);
  assert.match(a.calls[0].prompt, /same product type, shape, colours, materials, pack design and brand mark/); assert.match(a.calls[0].prompt, /small print may be soft or turned away, never rewritten/);
  assert.doesNotMatch(a.calls[0].prompt, /every printed word|exactly as in the reference/);
});

test('TEXT is made once more on the other model, turned and smaller; still TEXT keeps the new picture marked, never the packshot', async () => {
  const a = rig(['text', 'same']); const b1 = await a.guard({ srcFile: CARD, prompt: 'p', text: 'The Hukum collection', catalog, fallback: true });
  assert.equal(a.calls.length, 2); assert.equal(a.calls[1].model, 'pro-image'); assert.match(a.calls[1].prompt, /turned slightly, at most a third of the frame/);
  assert.equal(b1.toString(), 'GEN2'); assert.equal(b1.guard.same, true); assert.ok(!b1.guard.labelApprox); assert.equal(b1.guard.gens, 2); assert.equal(b1.guard.pro, 1);
  const b = rig(['text', 'text']); const b2 = await b.guard({ srcFile: CARD, prompt: 'p', text: 'The Hukum collection', catalog, fallback: true });
  assert.equal(b2.toString(), 'GEN2', 'the new picture, kept'); assert.equal(b2.guard.labelApprox, true); assert.equal(b2.guard.genFailed, false, 'not a stand-in: nothing is retried later');
  const c = rig(['text', 'different']); const b3 = await c.guard({ srcFile: CARD, prompt: 'p', text: 'The Hukum collection', catalog, fallback: true });
  assert.equal(b3.toString(), 'GEN1', 'the retry showed another product: the first picture had the right one'); assert.equal(b3.guard.labelApprox, true);
  assert.equal(imageCost(b1), +(DRAFTS_DEFAULTS.imageUsd + DRAFTS_DEFAULTS.proImageUsd).toFixed(4), 'booked at real cost: one flash, one pro');
});

test('NOREF moves to the next catalog photo; with none, the picture is kept unchecked', async () => {
  const a = rig(['noref', 'same']); const b1 = await a.guard({ srcFile: CARD, prompt: 'p', text: 'The Hukum collection', catalog, fallback: true });
  assert.equal(a.calls.length, 2); assert.equal(a.calls[0].srcFile, HUKUM); assert.equal(a.calls[1].srcFile, DEEP, 'the next product photo');
  assert.equal(a.checks[1].ref, DEEP); assert.equal(a.checks[1].name, 'Aeon V2 DEEPSPACE'); assert.equal(b1.toString(), 'GEN2'); assert.equal(b1.guard.refSwitched, true);
  const one = [{ t: 'Aeres HUKUM IVORY', img: 'https://cdn/hukum.jpg' }];
  const b = rig(['noref']); const b2 = await b.guard({ srcFile: CARD, prompt: 'p', text: 'The Hukum collection', catalog: one, fallback: true });
  assert.equal(b.calls.length, 1); assert.equal(b2.toString(), 'GEN1'); assert.equal(b2.guard.unchecked, true); assert.equal(b2.guard.genFailed, false);
});

test('DIFFERENT retries stricter, then the real photo stands in (a wrong product never ships)', async () => {
  const a = rig(['different', 'same']); const b1 = await a.guard({ srcFile: CARD, prompt: 'p', text: 'The Hukum collection', catalog, fallback: true });
  assert.equal(b1.toString(), 'GEN2'); assert.match(a.calls[1].prompt, /different product/); assert.ok(!a.calls[1].model, 'the same model, stricter');
  const b = rig(['different', 'different']); const b2 = await b.guard({ srcFile: CARD, prompt: 'p', text: 'The Hukum collection', catalog, fallback: true });
  assert.equal(b2.toString(), 'HUKUM-PHOTO'); assert.equal(b2.guard.genFailed, true);
  const c = rig(['different', 'text']); const b3 = await c.guard({ srcFile: CARD, prompt: 'p', text: 'The Hukum collection', catalog, fallback: true });
  assert.equal(b3.toString(), 'GEN2', 'the retry is the right product with a soft name: kept'); assert.equal(b3.guard.labelApprox, true);
});

/* ---------- a brand with reviews, rival ads and a catalog ---------- */
async function setup(posts, { reads = true } = {}) {
  const ROOT = tmp(), P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const photo = path.join(ROOT, 'p.jpg'); fs.writeFileSync(photo, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  await P.put('acme-com', 'seed.json', { brand: { name: 'Acme', host: 'acme.com', colors: ['#fff', '#123'] }, lanes: { core: { name: 'Core' } }, roles: {}, posts });
  await P.put('acme-com', 'status.json', { name: 'Acme', ready: true }); await P.put('acme-com', 'config.json', {}); await P.put('acme-com', 'facts.json', {});
  await P.put('acme-com', 'profile.json', { name: 'Acme',
    catalog: { products: ['Runner', 'Slide'].map((t, i) => ({ title: t, img: `b/acme-com/a/${t.toLowerCase()}.jpg`, priceLabel: `$${40 + i}`, inStock: true })) },
    reviews: { quotes: [{ text: 'My feet stopped aching by noon, first time in years.', rating: 5 }, { text: 'Arrived late and the box was crushed.', rating: 2 }], recent: [{ text: 'I wore them on a 12 hour shift and forgot they were on.', rating: 5 }] },
    ads: { rivals: [{ name: 'Rival One', items: [{ id: 'a1', hook: 'Still wearing shoes that hurt?', days: 210, format: 'video' }, { id: 'a2', hook: 'New colours', days: 12, format: 'image' }] }, { name: 'Rival Two', items: [{ id: 'b1', hook: '10,000 nurses switched', days: 95, format: 'image' }] }] } });
  if (reads) await P.put('acme-com', 'rival-reads.json', { a1: { hookPattern: 'names a daily pain as a question', stopper: 'a sore foot in the first frame', layout: 'x' } });
  return { P, photo };
}
const card = (o) => ({ type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], sub: 's', time: '5 min', agent: 'creative', ...o });
const plan = (o = {}) => ({ as: 'image', title: 'Ad: aching feet', headline: 'My feet stopped aching by noon', copy: 'Headline: My feet stopped aching by noon\nWalk the whole shift in the Runner.\nButton: Shop the Runner', visual: 'A nurse ties the Runner laces on a hospital bench', ratio: '4:5', ...o });
const fakeAI = (j = plan()) => { const prompts = []; return { live: true, prompts, call: async (q) => { prompts.push(q.prompt); return { usd: 0.03, json: typeof j === 'function' ? j(prompts.length) : j }; } }; };
/* a Chromium stand-in: records each page it is asked to shoot */
const fakeBrowser = (pages) => async () => ({ newPage: async () => ({ setViewport: async () => {}, setContent: async (h) => { pages.push(h); }, screenshot: async () => Buffer.from([0xff, 0xd8, 0xff, 0xdb]), close: async () => {} }), close: async () => {} });

/* ---------- 2. the budget ---------- */
test('a picture refused by the day’s budget is made after the reset from the saved prompt, with no new plan', async () => {
  assert.equal(DRAFTS_DEFAULTS.imageUsd, 0.04, 'a flash picture at its real price');
  const { P, photo } = await setup([card({ id: 'm01-1', title: 'A Runner ad', src: 'Move 01', make: { format: 'single image ad' } })]);
  let refuse = true, gens = 0; const ai = fakeAI(); let clock = NOW;
  const geminiImage = async () => { if (refuse) throw Object.assign(new Error('Pictures are kept for the team for the rest of today.'), { soft: true, budget: true }); gens++; return Buffer.from('png'); };
  const J = createDraftsBg({ packs: P, ai, geminiImage, saveGen: () => {}, genFile: async () => photo, genFlush: async () => {}, photoAsync: async () => photo, spend: (k) => k !== 'video',
    loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW, log: quiet, env: { DRAFTS_BG: '1' }, now: () => clock });
  await J.runOne('acme-com');
  let d = (await J.cacheOf('acme-com'))['m01-1'];
  assert.ok(!d.failedAt, 'not a failure'); assert.equal(d.as, 'text'); assert.ok(d.ip, 'the picture prompt is kept');
  assert.deepEqual(d.imgRetry, { n: 0, next: nextDay(NOW), err: 'budget' }); assert.equal(nextDay(NOW), Date.parse('2026-10-15T00:05:00Z'));
  assert.equal(ai.prompts.length, 1);
  clock = NOW + 3600e3; refuse = false; await J.runOne('acme-com'); assert.equal(gens, 0, 'not before the reset');
  clock = nextDay(NOW) + 1; const r = await J.runOne('acme-com'); d = (await J.cacheOf('acme-com'))['m01-1'];
  assert.equal(gens, 1); assert.equal(ai.prompts.length, 1, 'no new plan: the saved prompt'); assert.ok(r.made.some((x) => x.remade));
  assert.equal(d.as, 'image'); assert.match(d.image, /^gen\/[a-f0-9]{16}\.png$/); assert.ok(!d.imgRetry);
});

test('slides the budget refused are a failure that waits for the reset, then the card is drafted again', async () => {
  const { P, photo } = await setup([card({ id: 'm02-1', title: 'The Runner carousel', src: 'Move 02', make: { format: 'carousel ad' } })]);
  const slides = [{ onSlide: 'One', visual: 'a' }, { onSlide: 'Two', visual: 'b' }, { onSlide: 'Three', visual: 'c' }];
  const makers = { carousel: async () => { throw Object.assign(new Error('The slides wait for the picture budget.'), { budget: true, noSlides: true }); }, render: async () => null };
  const J = createDraftsBg({ packs: P, ai: fakeAI(plan({ as: 'carousel', slides })), geminiImage: async () => Buffer.from('png'), saveGen: () => {}, genFile: async () => photo, genFlush: async () => {}, photoAsync: async () => photo, launchBrowser: fakeBrowser([]), makers,
    spend: (k) => k !== 'video', loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW, log: quiet, env: { DRAFTS_BG: '1' }, now: () => NOW });
  await J.runOne('acme-com');
  const all = await J.cacheOf('acme-com'), d = all['m02-1'], c = (await P.load('acme-com', { fresh: true })).seed.posts[0];
  assert.ok(d.failedAt, 'never left as words for good'); assert.equal(d.retryAt, nextDay(NOW));
  assert.equal(needsDraft(c, all, NOW + 6 * 3600e3), false, 'not before the reset'); assert.equal(needsDraft(c, all, nextDay(NOW)), true);
  assert.equal(draftFor(c, all), null, 'the feed shows the card, not a failed draft');
});

/* ---------- 3. the headline, in exact type ---------- */
test('a still ad headline is set in the picture by Sloosh, in the brand type, and the feed shows that picture (27 Oct; it was a Chromium panel)', async () => {
  const posts = [card({ id: 'm01-1', title: 'A Runner ad', src: 'Move 01', make: { format: 'single image ad', pieces: '1 static image: a nurse on a bench in the Runner, headline "Shift-proof", price line $40' } }),
    card({ id: 'm03-1', title: 'The Slide post', src: 'Move 03', make: { format: 'instagram post' } })];
  const { P, photo } = await setup(posts);
  const pages = [], prompts = [], wordsAsked = [], saved = new Map(), ai = fakeAI((n) => plan(n === 2 ? { headline: 'Slip on, walk out', visual: 'A hand drops the Slide by the door' } : {}));
  const J = createDraftsBg({ packs: P, ai, geminiImage: async (o) => { prompts.push(o.prompt); wordsAsked.push(o.words || null); return Buffer.from('png'); }, saveGen: (n, b) => saved.set(n, b), genFile: async () => photo, genFlush: async () => {}, photoAsync: async () => photo,
    launchBrowser: fakeBrowser(pages), spend: (k) => k !== 'video', loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW, log: quiet, env: { DRAFTS_BG: '1' }, now: () => NOW });
  await J.runOne('acme-com');
  const all = await J.cacheOf('acme-com'), d = all['m01-1'];
  assert.equal(d.headline, 'My feet stopped aching by noon'); assert.equal(d.headSmall, 'Shop the Runner', 'the button line under it');
  assert.equal(wordsAsked[0], 'My feet stopped aching by noon', 'the headline goes to Sloosh as the words to set'); assert.equal(d.wordsIn, true); assert.equal(d.render, undefined, 'nothing laid over it');
  assert.ok(!pages.some((h) => h.includes('My feet stopped aching by noon')), 'no Chromium panel'); assert.doesNotMatch(prompts[0], /top third calm|Shift-proof|\$40/);
  assert.equal(sceneOf(posts[0]), 'a nurse on a bench in the Runner');
  const v = draftView(d, posts[0]); assert.deepEqual(v.images, [d.image]); assert.equal(v.headline, 'My feet stopped aching by noon'); assert.ok(!v.photoOnly && !v.remaking);
  // the plan opens on what buyers say, the rival ads that keep running, and (for the next card) the scenes already shown
  assert.match(ai.prompts[0], /WHAT BUYERS SAY[\s\S]*My feet stopped aching by noon, first time in years/); assert.doesNotMatch(ai.prompts[0], /box was crushed/, 'no low ratings');
  assert.match(ai.prompts[0], /RIVAL ADS THAT KEEP RUNNING[\s\S]*live 210 days, video ad; hook pattern: names a daily pain as a question; what stops the scroll: a sore foot/);
  assert.doesNotMatch(ai.prompts[0], /Rival One|Rival Two/, 'never a rival’s name'); assert.match(ai.prompts[0], /Open with the hook/);
  assert.match(ai.prompts[1], /SCENES ALREADY IN THIS FEED[\s\S]*A nurse ties the Runner laces/);
});

test('a real-photo stand-in gets the headline set too; with no headline it says it is a stand-in, never "First draft"', async () => {
  const posts = [card({ id: 'm01-1', title: 'A Runner ad', src: 'Move 01', make: { format: 'single image ad' } })];
  const standIn = async ({ srcFile }) => Object.assign(fs.readFileSync(srcFile), { guard: { genFailed: true, fallback: true, error: 'still a different product' } });
  const run = async (j) => { const { P, photo } = await setup(posts); const pages = [];
    const J = createDraftsBg({ packs: P, ai: fakeAI(j), geminiImage: standIn, saveGen: () => {}, genFile: async () => photo, genFlush: async () => {}, photoAsync: async () => photo, launchBrowser: fakeBrowser(pages), spend: (k) => k !== 'video',
      loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW, log: quiet, env: { DRAFTS_BG: '1' }, now: () => NOW });
    await J.runOne('acme-com'); return { d: (await J.cacheOf('acme-com'))['m01-1'], pages }; };
  const a = await run(plan()); assert.ok(a.d.photoOnly && a.d.imgRetry); assert.ok(a.d.render, 'a real static ad on the real photo'); assert.ok(a.pages.some((h) => h.includes('data:image/jpeg') && h.includes('My feet stopped aching by noon')));
  const va = draftView(a.d, posts[0]); assert.deepEqual(va.images, [a.d.render]); assert.equal(va.remaking, true); assert.ok(!va.photoOnly);
  const b = await run(plan({ headline: '' })); assert.ok(!b.d.render);
  const vb = draftView(b.d, posts[0]); assert.equal(vb.photoOnly, true); assert.equal(vb.remaking, true); assert.deepEqual(vb.images, [b.d.image]);
});

test('hooks come from the read: short real review lines first, the three rival ads live longest with how they are built', () => {
  const { reviewQuotes, rivalHooks } = hooksOf({ reviews: { quotes: [{ text: 'x'.repeat(30) + '. ' + 'y'.repeat(200), rating: 5 }, { text: 'Meh, it broke.', rating: 1 }], recent: [{ text: 'Best purchase for night shifts, honestly.', rating: 5 }] },
    ads: { rivals: [{ name: 'R', items: [{ id: '1', hook: 'a', days: 5 }, { id: '2', hook: 'b', days: 300, format: 'video' }, { id: '3', hook: 'c', days: 40 }, { id: '4', hook: 'd', days: 90 }] }] } }, { 2: { hookPattern: 'a number of happy buyers' } });
  assert.ok(reviewQuotes.every((q) => q.length <= 120)); assert.equal(reviewQuotes[0], 'x'.repeat(30) + '.'); assert.ok(!reviewQuotes.some((q) => /broke/.test(q)));
  assert.deepEqual(rivalHooks.map((h) => h.days), [300, 90, 40]); assert.equal(rivalHooks[0].hookPattern, 'a number of happy buyers'); assert.ok(!rivalHooks.some((h) => 'name' in h));
  assert.deepEqual(hooksOf(null), { reviewQuotes: [], rivalHooks: [] });
});
