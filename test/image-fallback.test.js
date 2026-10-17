// node --test test/image-fallback.test.js — a picture never fails into a broken card, free (no model, no bucket, no network):
// the image guard retries the model and falls back to the real product photo; first drafts show that photo, say so, and
// make the picture again later with backoff; saved drafts whose picture is gone heal; a failed clip is retried; the
// page's onerror chain (public/asset-fallback.js) asks once more, then shows the fallback, never the alt text; generated
// files are in the bucket before a draft names them (genFlush), and research media is served from the bucket whichever
// brand asks (researchFile).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createImageGuard } from '../image-guard.js';
import { createDraftsBg, draftView, draftFor, retryWait } from '../drafts-bg.js';
import { createPacks } from '../brand-pack.js';
import { configureGen, saveGen, genFlush, researchFile } from '../gen-store.js';
import '../public/asset-fallback.js';

const NOW = Date.parse('2026-10-14T12:00:00Z'), DAY = 864e5;
const quiet = { warn: () => {}, info: () => {}, log: () => {}, error: () => {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brew-img-'));
const jpg = (dir, name = 'p.jpg') => { const f = path.join(dir, name); fs.writeFileSync(f, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])); return f; };

/* ---------- the image guard ---------- */
test('the model is tried again with backoff; with no picture at all the real product photo comes back, marked', async () => {
  const dir = tmp(), photo = jpg(dir); let calls = 0;
  const gen = async () => { calls++; throw new Error('Gemini gemini-3-pro-image 503: overloaded'); };
  const G = createImageGuard({ gen, backoffMs: 0, log: quiet });
  const buf = await G({ srcFile: photo, prompt: 'a scene', fallback: true });
  assert.equal(calls, 3, 'three tries before giving up');
  assert.deepEqual([...buf], [...fs.readFileSync(photo)], 'the real photo, not a broken picture');
  assert.equal(buf.guard.genFailed, true); assert.equal(buf.guard.fallback, true); assert.match(buf.guard.error, /503/);
  calls = 0; await assert.rejects(G({ srcFile: photo, prompt: 'a scene' }), /503/, 'without fallback the caller still hears the failure'); assert.equal(calls, 3);
  // a blip: the second try works
  let n = 0; const G2 = createImageGuard({ gen: async () => { if (++n === 1) throw new Error('Gemini returned no image'); return Buffer.from('png'); }, backoffMs: 0, log: quiet });
  const ok = await G2({ srcFile: photo, prompt: 'x', fallback: true }); assert.equal(ok.toString(), 'png'); assert.equal(ok.guard.genFailed, false);
  // a refused prompt is not hammered
  let r = 0; const G3 = createImageGuard({ gen: async () => { r++; throw new Error('Gemini 400: blocked by safety'); }, backoffMs: 0, log: quiet });
  await assert.rejects(G3({ srcFile: photo, prompt: 'x' })); assert.equal(r, 1);
});

test('a reference this instance lacks is fetched (resolve), then the lead catalog photo; with none, a clear error, never ENOENT', async () => {
  const dir = tmp(), photo = jpg(dir), seen = [];
  const gen = async (o) => { seen.push(o.srcFile); return Buffer.from('png'); };
  const missing = path.join(dir, 'brands', 'acme-com', 'assets', 'runner.jpg');
  const G = createImageGuard({ gen, resolve: async (f) => (f === missing ? photo : null), log: quiet });
  await G({ srcFile: missing, prompt: 'x' }); assert.equal(seen.pop(), photo, 'the bucket copy');
  const G2 = createImageGuard({ gen, fetchPhoto: async (u) => (u === 'b/acme-com/a/lead.jpg' ? photo : null), log: quiet });
  await G2({ srcFile: path.join(dir, 'nope.jpg'), prompt: 'x', catalog: [{ t: 'Lead', img: 'b/acme-com/a/lead.jpg' }] }); assert.equal(seen.pop(), photo, 'the brand’s lead product');
  await assert.rejects(G2({ srcFile: dir /* a directory, as photoFile('') used to give */, prompt: 'x' }), /no product photo for this yet/i);
  /* a logo or brand mark is never the product (arata-com, 16 Oct: every picture was checked against the logo): the lead product stands in, else no picture */
  const logo = path.join(dir, 'b', 'acme-com', 'a', 'logo.png'); fs.mkdirSync(path.dirname(logo), { recursive: true }); fs.copyFileSync(photo, logo);
  await G2({ srcFile: logo, prompt: 'x', catalog: [{ t: 'Lead', img: 'b/acme-com/a/lead.jpg' }] }); assert.equal(seen.pop(), photo, 'the lead product, not the logo');
  await assert.rejects(G2({ srcFile: logo, prompt: 'x', catalog: [] }), /no product photo for this yet/i);
});

/* ---------- first drafts ---------- */
async function setup(posts) {
  const ROOT = tmp(), P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet }), photo = jpg(ROOT);
  await P.put('acme-com', 'seed.json', { brand: { name: 'Acme', host: 'acme.com', colors: ['#fff', '#123'] }, lanes: { core: { name: 'Core' } }, roles: {}, posts });
  await P.put('acme-com', 'status.json', { name: 'Acme', ready: true }); await P.put('acme-com', 'config.json', {}); await P.put('acme-com', 'facts.json', {});
  await P.put('acme-com', 'profile.json', { catalog: { products: ['Runner', 'Slide'].map((t, i) => ({ title: t, img: `b/acme-com/a/${t.toLowerCase()}.jpg`, priceLabel: `$${40 + i}`, inStock: true })) } });
  return { P, photo };
}
const fakeAI = () => ({ live: true, call: async () => ({ usd: 0.03, json: { as: 'image', title: 'Draft for the Runner', copy: 'The Runner, on a track.', visual: 'On a track', motion: 'Slow push in', ratio: '4:5' } }) });
const card = (o) => ({ type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], sub: 's', time: '5 min', agent: 'creative', ...o });

test('a first draft whose picture fails shows the real product photo, says so, and is made again later with backoff', async () => {
  const { P, photo } = await setup([card({ id: 'm01-1', title: 'A Runner ad', src: 'Move 01', make: { format: 'single image ad' } })]);
  let down = true, gens = 0; const saved = new Map(); let clock = NOW;
  const geminiImage = createImageGuard({ gen: async () => { gens++; if (down) throw new Error('Gemini 503'); return Buffer.from('new-png'); }, backoffMs: 0, log: quiet });
  const J = createDraftsBg({ packs: P, ai: fakeAI(), geminiImage, saveGen: (n, b) => saved.set(n, b), genFile: async () => photo, genFlush: async () => {}, photoAsync: async () => photo,
    loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW, log: quiet, env: { DRAFTS_BG: '1' }, now: () => clock });
  await J.runOne('acme-com');
  let d = (await J.cacheOf('acme-com'))['m01-1'];
  assert.equal(d.as, 'image'); assert.ok(d.photoOnly); assert.match(d.image, /^gen\/[a-f0-9]{16}\.jpg$/, 'the real photo, saved as a generated file');
  assert.deepEqual([...saved.get(d.image.slice(4))], [...fs.readFileSync(photo)]);
  assert.equal(d.imgRetry.n, 1); assert.equal(d.imgRetry.next, NOW + retryWait(1)); assert.match(d.note, /real product photo/);
  assert.equal(d.photo, 'b/acme-com/a/runner.jpg', 'the page knows the real photo to fall back to');
  const p = await P.load('acme-com', { fresh: true }), v = draftView(draftFor(p.seed.posts[0], p.firstDrafts), p.seed.posts[0]);
  assert.deepEqual(v.images, [d.image]); assert.equal(v.fallback, 'b/acme-com/a/runner.jpg'); assert.equal(v.remaking, true);
  // not yet due: nothing is tried
  down = false; gens = 0; clock = NOW + 10 * 60e3; await J.runOne('acme-com'); assert.equal(gens, 0);
  // due: the picture is made again, the stand-in goes, and the card heals
  clock = NOW + retryWait(1) + 1; const r = await J.runOne('acme-com');
  d = (await J.cacheOf('acme-com'))['m01-1'];
  assert.equal(gens, 1); assert.ok(r.made.some((x) => x.remade)); assert.match(d.image, /\.png$/); assert.equal(saved.get(d.image.slice(4)).toString(), 'new-png');
  assert.ok(!d.imgRetry && !d.photoOnly); assert.doesNotMatch(d.note, /real product photo/);
  // a retry that fails again waits longer
  const { P: P2, photo: ph2 } = await setup([card({ id: 'm01-1', title: 'A Runner ad', src: 'Move 01', make: { format: 'single image ad' } })]);
  const J2 = createDraftsBg({ packs: P2, ai: fakeAI(), geminiImage: createImageGuard({ gen: async () => { throw new Error('Gemini 500'); }, backoffMs: 0, log: quiet }), saveGen: () => {}, genFile: async () => ph2, genFlush: async () => {}, photoAsync: async () => ph2,
    loadPack: (slug) => P2.load(slug, { fresh: true }), lastOpenOf: async () => NOW, log: quiet, env: { DRAFTS_BG: '1' }, now: () => clock });
  clock = NOW; await J2.runOne('acme-com'); clock = NOW + retryWait(1) + 1; await J2.runOne('acme-com');
  d = (await J2.cacheOf("acme-com"))["m01-1"]; assert.equal(d.imgRetry.n, 2); assert.equal(d.imgRetry.next, clock + retryWait(2)); assert.ok(d.image, 'still the real photo, never nothing');
});

test('saved drafts heal: a picture gone from the bucket is made again; a clip that failed (treg 402) keeps its still and is tried again', async () => {
  const { P, photo } = await setup([card({ id: 'm01-1', title: 'A Runner ad', src: 'Move 01', make: { format: 'single image ad' } }), card({ id: 'm02-1', title: 'The Runner reel', src: 'Move 02', make: { format: 'reel' } })]);
  const gone = new Set(); let clock = NOW, tregDown = true, clips = 0;
  const makers = { video: async () => { clips++; if (tregDown) throw new Error('treg minimax.video-gen.from_image 402: insufficient_balance'); return 'clip.mp4'; }, voice: async () => 'vo.wav', mux: async () => 'both.mp4', render: async () => null };
  const J = createDraftsBg({ packs: P, ai: fakeAI(), geminiImage: createImageGuard({ gen: async () => Buffer.from('png'), log: quiet }), saveGen: () => {}, genFile: async (n) => (gone.has(n) ? null : photo), genFlush: async () => {}, photoAsync: async () => photo,
    treg: { onCharge: () => {} }, makers, spend: () => true, loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW, log: quiet, env: { DRAFTS_BG: '1' }, now: () => clock });
  await J.runOne('acme-com');
  let c = await J.cacheOf('acme-com');
  assert.equal(c['m02-1'].as, 'image'); assert.equal(c['m02-1'].wants, 'video', 'the reel waits as its still'); assert.equal(c['m02-1'].clipRetry.n, 1); assert.match(c['m02-1'].err, /tried again/);
  // the clip is not retried before its wait, then is
  clips = 0; clock = NOW + 60e3; await J.runOne('acme-com'); assert.equal(clips, 0);
  tregDown = false; clock = NOW + retryWait(1) + 1; await J.runOne('acme-com'); c = await J.cacheOf('acme-com');
  assert.equal(clips, 1); assert.equal(c['m02-1'].as, 'video'); assert.ok(!c['m02-1'].clipRetry && !c['m02-1'].err);
  // the first draft's picture vanished from the bucket: checked once a day, made again
  const img = c['m01-1'].image; gone.add(img.slice(4)); c['m01-1'].checkedAt = 0; await P.put('acme-com', 'drafts/cards.json', c);
  clock += DAY; await J.runOne('acme-com'); c = await J.cacheOf('acme-com');
  assert.ok(c['m01-1'].image && !c['m01-1'].imgRetry, 'made again in the same run'); assert.ok(c['m01-1'].checkedAt);
});

/* ---------- the page: onerror never shows alt text ---------- */
const el = (tag, attrs = {}, inMedia = true) => { const a = { ...attrs }; const e = { tagName: tag, dataset: {}, style: {}, replaced: null,
  getAttribute: (k) => a[k] ?? null, setAttribute: (k, v) => { a[k] = String(v); }, closest: () => (inMedia ? {} : null), replaceWith: (x) => { e.replaced = x; }, attrs: a }; return e; };
const doc = { createElement: (t) => el(t.toUpperCase()) };

test('onerror: our own file is asked once more, then the fallback photo, then a quiet placeholder; a clip becomes its poster', () => {
  const A = globalThis.BrewAsset, im = el('IMG', { src: 'gen/abc1234567.png', alt: 'Traya: live 192 days in 13 versions' }); im.dataset.fb = 'b/acme-com/a/runner.jpg';
  assert.equal(A.onError(im, { doc }), 'retry'); assert.match(im.attrs.src, /^gen\/abc1234567\.png\?r=/);
  assert.equal(A.onError(im, { doc }), 'fallback'); assert.equal(im.attrs.src, 'b/acme-com/a/runner.jpg'); assert.equal(im.attrs.alt, '');
  assert.equal(A.onError(im, { doc }), 'retry', 'the fallback is our file too: asked once more');
  assert.equal(A.onError(im, { doc }), 'dead');
  assert.equal(A.quiet(im, { doc }), 'placeholder'); assert.equal(im.replaced.className, 'img-dead'); assert.equal(im.replaced.dataset.src, 'gen/abc1234567.png');
  // a rival's poster with no fallback: retried, then quiet; outside a media box it is hidden, never alt text
  const ad = el('IMG', { src: 'research/74ae882a71170b9c5ed9.jpg', alt: 'Traya: live 192 days' }, false);
  assert.equal(A.onError(ad, { doc }), 'retry'); assert.equal(A.onError(ad, { doc }), 'dead'); assert.equal(A.quiet(ad, { doc }), 'hidden'); assert.equal(ad.attrs.alt, ''); assert.equal(ad.style.visibility, 'hidden');
  // someone else's URL is not retried
  assert.equal(A.onError(el('IMG', { src: 'https://scontent.xx.fbcdn.net/x.jpg' }), { doc }), 'dead');
  // a first-draft clip that can't play shows its poster
  const v = el('VIDEO', { src: 'gen/clip123456.mp4', poster: 'gen/frame12345.png' }); v.dataset.fb = 'b/acme-com/a/runner.jpg';
  assert.equal(A.onError(v, { doc }), 'retry'); assert.equal(A.onError(v, { doc }), 'poster'); assert.equal(v.replaced.attrs.src, 'gen/frame12345.png'); assert.equal(v.replaced.dataset.fb, 'b/acme-com/a/runner.jpg');
});

/* ---------- the bucket ---------- */
test('a generated file is uploaded with retries and genFlush waits for it; research media comes from the bucket whichever brand asks', async () => {
  const dir = tmp(), bucket = new Map(); let fails = 2;
  const gcs = async (method, obj, buf) => { if (method === 'PUT') { if (fails-- > 0) throw new Error('gcs 503'); await new Promise((r) => setTimeout(r, 20)); bucket.set(obj, buf); return true; } if (!bucket.has(obj)) throw new Error('gcs GET 404'); return bucket.get(obj); };
  configureGen({ dir: path.join(dir, 'gen'), researchDir: path.join(dir, 'research'), remote: true, gcs, backoffMs: 1, log: quiet });
  saveGen('abcdef123456.png', Buffer.from('img'));
  assert.ok(!bucket.has('gen/abcdef123456.png')); await genFlush(); assert.equal(bucket.get('gen/abcdef123456.png').toString(), 'img', 'in the bucket after two failed tries');
  bucket.set('research-media/74ae882a71170b9c5ed9.jpg', Buffer.from('poster'));
  const f = await researchFile('74ae882a71170b9c5ed9.jpg'); assert.equal(fs.readFileSync(f, 'utf8'), 'poster', 'fetched from the bucket on a miss');
  bucket.set('media/da6539ae7b2176001771.jpg', Buffer.from('old')); assert.equal(fs.readFileSync(await researchFile('da6539ae7b2176001771.jpg'), 'utf8'), 'old', 'the older prefix too');
  assert.equal(await researchFile('../../etc/passwd'), null); assert.equal(await researchFile('0123456789abcdef0123.jpg'), null, 'gone everywhere: null, a 404');
});
