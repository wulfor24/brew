// First drafts are never collages (25 Oct, Param, Arata: a hair swatch on white beside three bottles pasted over a dark panel
// running off the frame, jagged edges). The pixel checks, the cut-out check, the cleanest reference, and the image guard's
// redo-then-hold-back, for every caller and every brand. draft-quality.js, image-guard.js, jam2/make.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { collageEdges, plainness, plainest, cutQuality, lookVerdict, lookPrompt, FIX, LOOKS_V } from '../draft-quality.js';
import { createImageGuard } from '../image-guard.js';
import { pricedProduct } from '../product-match.js';

const quiet = { warn() {}, log() {}, info() {} };
const W = 400, H = 500;
/* a busy "photograph": smooth gradient plus grain, nothing flat at the frame */
const photo = async () => { const px = Buffer.alloc(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3, n = (x * 7 + y * 13) % 23;
  px[i] = (120 + x / 4 + n) & 255; px[i + 1] = (90 + y / 5 + n * 2) & 255; px[i + 2] = (60 + (x + y) / 9 + n) & 255; } return sharp(px, { raw: { width: W, height: H, channels: 3 } }).jpeg().toBuffer(); };
const rect = (w, h, fill) => sharp({ create: { width: w, height: h, channels: 3, background: fill } }).png().toBuffer();
/* the Arata paste-up: a product on white, beside a flat dark panel that runs off the right edge */
const pasteUp = async () => sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
  .composite([{ input: await rect(220, 340, '#2b2b2b'), left: 180, top: 100 }, { input: await rect(70, 160, '#e5534b'), left: 220, top: 180 }, { input: await rect(60, 200, '#6b4a33'), left: 40, top: 120 }]).png().toBuffer();
const packshot = async () => sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite([{ input: await rect(120, 260, '#e5534b'), left: 140, top: 120 }]).png().toBuffer();

test('the paste-up is caught for free; a real photo and a packshot on white are not', async () => {
  assert.equal((await collageEdges(await pasteUp())).collage, true, 'two flat grounds at the frame: a collage');
  assert.equal((await collageEdges(await photo())).collage, false, 'a photograph has no flat edges');
  assert.equal((await collageEdges(await packshot())).collage, false, 'one flat ground is a clean product shot');
  assert.equal((await collageEdges(Buffer.from('not an image'))).collage, false, 'a file that is not a picture is never called a collage');
  const letterbox = await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } }).composite([{ input: await photo(), top: 0, left: 0 }]).png().toBuffer().then((b) => sharp(b).extract({ left: 0, top: 0, width: W, height: H }).toBuffer());
  const boxed = await sharp({ create: { width: W, height: H + 160, channels: 3, background: '#000000' } }).composite([{ input: await photo(), top: 0, left: 0 }]).png().toBuffer();
  assert.equal((await collageEdges(letterbox)).collage, false); assert.equal((await collageEdges(boxed)).collage, true, 'a picture-in-picture over a black band');
});

test('the cleanest reference: a packshot on a plain ground over a busy designed card, the main photo kept when none is clearly plainer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-')), card = path.join(dir, 'card.jpg'), shot = path.join(dir, 'shot.png'), shot2 = path.join(dir, 'shot2.png');
  fs.writeFileSync(card, await photo()); fs.writeFileSync(shot, await packshot()); fs.writeFileSync(shot2, await packshot());
  assert.ok(await plainness(shot) > 0.9 && await plainness(card) < 0.2);
  assert.equal(await plainest([{ key: 'card', file: card }, { key: 'shot', file: shot }]), 'shot', 'the store card listed first loses to the packshot');
  assert.equal(await plainest([{ key: 'a', file: shot }, { key: 'b', file: shot2 }]), 'a', 'a tie keeps the main photo');
  assert.equal(await plainest([{ key: 'only', file: card }]), 'only');
});

test('a cut-out is placed only when it is a real matte: never a rectangle, never a jagged edge', async () => {
  const S = 200, alpha = (soft) => { const b = Buffer.alloc(S * S * 4); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4, d = Math.hypot(x - 100, y - 100) - 70;
    b[i] = 200; b[i + 1] = 60; b[i + 2] = 60; b[i + 3] = soft ? Math.max(0, Math.min(255, Math.round(128 - d * 64))) : d < 0 ? 255 : 0; } return sharp(b, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer(); };
  const solid = await sharp({ create: { width: S, height: S, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
  const r = await cutQuality(solid); assert.equal(r.ok, false); assert.equal(r.rect, true, 'the photo\'s own panel came with it');
  const j = await cutQuality(await alpha(false)); assert.equal(j.ok, false); assert.equal(j.jagged, true, 'hard steps only');
  assert.equal((await cutQuality(await alpha(true))).ok, true, 'a soft edge is a clean matte');
  assert.equal((await cutQuality(await rect(50, 50, '#fff'))).ok, false, 'no transparency is no cut-out');
});

test('the judge\'s answer is read as one word; no word is no answer (never a failure)', () => {
  assert.deepEqual(lookVerdict('GOOD. One photograph.'), { ok: true, verdict: 'good', why: 'GOOD. One photograph.' });
  assert.equal(lookVerdict('collage: the bottles sit on a dark panel').verdict, 'collage');
  assert.equal(lookVerdict('Off-topic, a shoe').verdict, 'offtopic');
  assert.equal(lookVerdict('I think it is fine'), null);
  assert.match(lookPrompt('Protect damaged hair with your ₹449 super shampoo'), /₹449 super shampoo/, 'the card\'s own words are what the picture is judged against');
  assert.ok(FIX.collage && FIX.cropped && FIX.offtopic && LOOKS_V >= 1);
  assert.match(lookPrompt(''), /split-screen[^.]*GOOD/, 'a deliberate split-screen is not a collage (Cozy cold/warm)'); assert.match(lookPrompt(''), /When in doubt, GOOD/);
});

/* the guard: a picture that fails the look is made once more with the reason; a second failure is held back */
const guardWith = (seq, o = {}) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqg-')), ref = path.join(dir, 'ref.png'); fs.writeFileSync(ref, 'REAL-PHOTO');
  const prompts = [], judged = []; let i = 0;
  const gen = async (x) => { prompts.push(x.prompt); return Buffer.from(seq[Math.min(i++, seq.length - 1)]); };
  const looks = async (buf, words) => { judged.push(words); const b = buf.toString(); return b === 'BAD' ? { ok: false, verdict: 'collage', why: 'pasted on a dark panel' } : b === 'CROP' ? { ok: false, verdict: 'cropped', why: 'cut off' } : { ok: true, verdict: 'good', why: 'ok' }; };
  const G = createImageGuard({ gen, verify: async () => ({ same: true }), looks, pixels: async () => ({ collage: false }), fetchPhoto: async () => ref, backoffMs: 0, log: quiet, ...o });
  return { G, ref, prompts, judged }; };

test('guard: a collage is made again with the reason, and the clean one is kept', async () => {
  const { G, ref, prompts, judged } = guardWith(['BAD', 'GOOD']);
  const r = await G({ srcFile: ref, prompt: 'the shampoo in a shower', text: 'Protect damaged hair with your super shampoo', fallback: true });
  assert.equal(r.toString(), 'GOOD'); assert.equal(r.guard.looksFixed, 'collage'); assert.equal(r.guard.gens, 2, 'both pictures are booked');
  assert.ok(prompts[1].includes(FIX.collage), 'the retry says what was wrong'); assert.equal(judged[0], 'Protect damaged hair with your super shampoo', 'judged against the card\'s words');
});

test('guard: two failures are held back: the real photo for callers that take one, a plain error for the rest; never the bad picture', async () => {
  const a = guardWith(['BAD', 'CROP']); const r = await a.G({ srcFile: a.ref, prompt: 'p', text: 't', fallback: true });
  assert.equal(r.toString(), 'REAL-PHOTO'); assert.equal(r.guard.genFailed, true); assert.equal(r.guard.held, 'collage'); assert.equal(r.guard.gens, 2);
  const b = guardWith(['BAD', 'BAD']); await assert.rejects(b.G({ srcFile: b.ref, prompt: 'p', text: 't' }), (e) => e.held === 'collage' && e.soft === true);
  const c = guardWith(['BAD'], { pixels: async () => ({ collage: true, why: 'two flat grounds' }), looks: null }); /* the free check alone holds it back too */
  assert.equal((await c.G({ srcFile: c.ref, prompt: 'p', fallback: true })).guard.held, 'collage');
});

test('guard: a background-only scene, an edit and a cut-out are not judged as ads; an unanswered judge never costs a picture', async () => {
  for (const extra of [{ product: false }, { edit: true }, { gate: false }]) { const { G, prompts } = guardWith(['BAD']); const r = await G({ prompt: 'p', ...extra }); assert.equal(r.toString(), 'BAD'); assert.equal(prompts.length, 1); }
  const { G, ref, prompts } = guardWith(['BAD'], { looks: async () => null }); const r = await G({ srcFile: ref, prompt: 'p', fallback: true });
  assert.equal(r.toString(), 'BAD'); assert.equal(prompts.length, 1, 'no answer is not a failure');
});

test('guard: the named product\'s cleanest photo is the reference, never its designed store card', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqr-')), card = path.join(dir, 'card.jpg'), shot = path.join(dir, 'shot.png');
  fs.writeFileSync(card, await photo()); fs.writeFileSync(shot, await packshot());
  const seen = []; const G = createImageGuard({ gen: async (x) => { seen.push(x.srcFile); return Buffer.from('GOOD'); }, verify: async () => ({ same: true }), looks: async () => ({ ok: true, verdict: 'good' }),
    fetchPhoto: async (u) => (u === 'https://cdn/card.jpg' ? card : u === 'https://cdn/shot.png' ? shot : null), backoffMs: 0, log: quiet });
  const named = { t: 'Damage Defence Super Shampoo', img: 'https://cdn/card.jpg', imgs: ['https://cdn/card.jpg', 'https://cdn/shot.png'] };
  await G({ srcFile: card, prompt: 'p', named, fallback: true });
  assert.equal(seen[0], shot, 'the packshot, not the infographic listed first');
});

test('Studio: a raw photo (no clean cut-out) is never pasted into a scene, and a take without one is held back', () => {
  const src = fs.readFileSync(new URL('../jam2/make.js', import.meta.url), 'utf8');
  assert.match(src, /if \(cut\?\.file && !cut\.raw\) layers\.push\(\{ id: 'product'/, 'composeScene skips a raw cut');
  assert.match(src, /cut-v3/, 'cuts kept before the check are made and checked again');
  assert.match(src, /take\.held = cut\?\.poor/, 'no clean cut-out: held, not composited');
  assert.match(src, /cutQuality\(/, 'every cut-out is checked');
});

test('watcher idea pictures are context driven: the product the idea names, the card\'s words, judged; old ones heal to the real photo', () => {
  const src = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8'), i = src.indexOf('const creativeIdea'), body = src.slice(i, src.indexOf('/* ---------- cards from real research', i));
  assert.match(body, /pricedProduct\(words, cat/, 'the product the idea names');
  assert.match(body, /text: words, catalog:/, 'the card\'s words go to the guard (product and look checks)');
  assert.doesNotMatch(body, /'gemini-2\.5-flash-image'/, 'never the cheap model by default');
  assert.match(src, /const healWatcherLooks = /); assert.match(src, /healWatcherLooks\(t\)/, 'saved watcher pictures heal on every rank');
});

test('an idea that states a price picks its product among those at that price; a name written out still wins', () => {
  const cat = [{ t: 'Sleek Hair Styling Stick - 15 ml', img: 'a', price: '₹349' }, { t: 'Damage Defence Super Conditioner - 200 ml', img: 'b', price: '₹449' }, { t: 'Damage Defence Super Shampoo - 200 ml', img: 'c', price: '₹449' },
    { t: 'The Desk Day Kit – Heated Hand Pillow, Heated Mouse Pad + Bear Socks', img: 'd', price: '$44' }, { t: 'Snugglet Pup Warmer – Rechargeable Puppy Hand Warmer', img: 'e', price: '$44' }];
  assert.equal(pricedProduct('Hydrate curls without buildup using your ₹449 conditioner', cat, { brand: 'Arata' })?.img, 'b');
  assert.equal(pricedProduct('Warm frozen fingers with a $44 puppy warmer', cat, { brand: 'Snugglet' })?.img, 'e');
  assert.equal(pricedProduct('Warm frozen fingers with a $44 puppy warmer. Office workers struggle with freezing desk hands. Our rechargeable $44 puppy warmer helps.', cat, { brand: 'Snugglet' })?.img, 'e', '"desk hands" never names the Desk Day Kit');
  assert.equal(pricedProduct('Gift the Desk Day Kit for $44', cat, { brand: 'Snugglet' })?.img, 'd', 'written out whole, it is named');
  assert.equal(pricedProduct('Style it sleek with the Sleek Hair Styling Stick for ₹449', cat, { brand: 'Arata' })?.img, 'a', 'the name written out');
  assert.equal(pricedProduct('A ₹449 gift for your hair', cat, { brand: 'Arata' }), null, 'a common word at that price is no match'); assert.equal(pricedProduct('A ₹999 gift for curls', cat, { brand: 'Arata' }), null, 'nothing at that price: no guess');
});

test('a see-through packshot reaches the model on white, never on the black hidden under its clear pixels (Arata Damage Defence)', async () => {
  const { createImageNorm } = await import('../img-norm.js');
  const S = 120, raw = Buffer.alloc(S * S * 4); /* black under every clear pixel, a red bottle, a semi-clear dark shadow to its right */
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4, bottle = x > 30 && x < 70 && y > 20 && y < 100, shadow = !bottle && x >= 70 && x < 90 && y > 30 && y < 100;
    raw[i] = bottle ? 230 : 0; raw[i + 1] = bottle ? 80 : 0; raw[i + 2] = bottle ? 75 : 0; raw[i + 3] = bottle ? 255 : shadow ? 60 : 0; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqn-')), f = path.join(dir, 'pack.png'); fs.writeFileSync(f, await sharp(raw, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer());
  const N = createImageNorm({ tmp: dir, log: quiet }), out = await N.normalize(f);
  assert.notEqual(out, f, 'flattened to a new file');
  const m = await sharp(out).metadata(), px = await sharp(out).removeAlpha().raw().toBuffer();
  assert.ok(!m.hasAlpha || (await sharp(out).stats()).channels[3]?.min === 255);
  assert.deepEqual([...px.slice(0, 3)], [255, 255, 255], 'the corner is white, not the hidden black');
  const sh = ((60 * S) + 80) * 3; assert.ok(px[sh] > 150, 'the soft shadow stays soft on white, never a dark panel');
  const jpg = path.join(dir, 'photo.jpg'); fs.writeFileSync(jpg, await sharp({ create: { width: 40, height: 40, channels: 3, background: '#335' } }).jpeg().toBuffer());
  assert.equal(await N.normalize(jpg), jpg, 'an opaque photo is used as it is');
});
