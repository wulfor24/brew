// "Make our version" of a rival's ad (rival-ad.js): read how it is made, then remake it in its style with our product
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isResearchImage, isRivalCard, readRivalAd, rivalBlock, rivalPicture, forgetRivalReads } from '../rival-ad.js';
import { buildDraft } from '../sloosh-prompt.js';

const ad = { id: 'a1', brand: 'Rivalco', format: 'image', days: 40, versions: 3, headline: 'Cold feet at your desk?', body: 'Our heated slippers warm up in 30 seconds.', cta: 'Shop now', hook: 'Cold feet at your desk?', angle: 'pain first', poster: 'research/abc.png' };
const style = { format: 'studio product photo with a headline', hookPattern: 'names a daily pain as a question', layout: 'The product sits low in the centre on a desk, cropped tight.', look: 'Soft window light, warm beige colours.', words: [{ role: 'headline', where: 'top third, centred', lettering: 'bold white sans-serif', words: 5 }], beats: [], works: ['the pain in the first words'] };

test('a rival poster is never our product photo, and only ad cards are rival cards', () => {
  assert.equal(isResearchImage('research/abc.png'), true);
  assert.equal(isResearchImage('/research/abc.png'), true);
  assert.equal(isResearchImage('b/acme/a/shoe.jpg'), false);
  assert.equal(isRivalCard({ research: { kind: 'ad', id: 'a1' } }), true);
  assert.equal(isRivalCard({ research: { kind: 'trend' } }), false);
  assert.equal(isRivalCard({}), false);
});

test('the writers get the rival ad, how it is made and the rule: same angle and style, our product and words', () => {
  const b = rivalBlock(ad, style, 'Cozy');
  for (const x of ['Rivalco', 'names a daily pain as a question', 'top third, centred', 'Soft window light', "COZY'S OWN VERSION", 'never Rivalco', 'Option 1 is the closest remake']) assert.ok(b.includes(x), x);
  assert.ok(rivalBlock(ad, null, 'Cozy').includes('Format: image ad'), 'works from the copy when the creative could not be read');
  assert.equal(rivalBlock(null, style, 'Cozy'), '');
});

test('the picture: our product is the only image; their ad arrives as its written composition and look, our words where theirs sit', () => {
  const pic = rivalPicture(ad, style, { headline: 'Warm toes by the second sip of coffee, every single morning' });
  assert.equal(pic.refs.length, 1, 'never their picture'); assert.equal(pic.refs[0].job, 'product');
  assert.match(pic.visual, /cropped tight/); assert.match(pic.visual, /no other products, brands, logos/);
  assert.equal(pic.look, style.look);
  assert.equal(pic.text[0].where, 'top third, centred');
  assert.ok(pic.text[0].words.split(' ').length <= 5, 'about as long as theirs');
  const prompt = buildDraft({ kind: 'image', title: 'a Meta ad', visual: pic.visual, refs: pic.refs, text: pic.text, hasSrc: true, ratio: '4:5', brand: { style: pic.look } }).prompt;
  assert.match(prompt, /Image 1 is the product/); assert.doesNotMatch(prompt, /Image 2/); assert.match(prompt, /top third, centred/);
  assert.deepEqual(rivalPicture(ad, null, { headline: 'x y z' }).text, [], 'no words on the image when the rival had none read');
});

test('the creative is read once per ad, from its poster, and a failure reads nothing (never a made-up style)', async () => {
  forgetRivalReads();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rival-')); const f = path.join(dir, 'p.png'); fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]));
  let calls = 0, sawImage = false;
  const call = async (parts) => { calls++; sawImage = parts.some((p) => p.type === 'image'); return { ...style, words: style.words }; };
  const a = await readRivalAd(ad, { call, fileOf: async () => f, video: false, log: { warn() {} } });
  const b = await readRivalAd(ad, { call, fileOf: async () => f, video: false, log: { warn() {} } });
  assert.equal(calls, 1); assert.equal(sawImage, true); assert.equal(a.layout, style.layout); assert.equal(a.from, 'poster'); assert.deepEqual(a, b);
  forgetRivalReads();
  const none = await readRivalAd({ ...ad, id: 'a2' }, { call: async () => { throw new Error('busy'); }, fileOf: async () => f, video: false, log: { warn() {} } });
  assert.equal(none, null);
  const nothing = await readRivalAd({ ...ad, id: 'a3' }, { call, fileOf: async () => null, video: false, log: { warn() {} } });
  assert.equal(nothing, null, 'no picture to look at: no read');
});

test('a read is kept with the brand: a kept read costs nothing, a new read is saved, and the selling logic is read too', async () => {
  forgetRivalReads();
  const kept = { ...style, angle: 'pain first', stopper: 'a cold foot in the first frame' };
  let calls = 0, saved = null;
  const store = { get: async (id) => (id === 'k1' ? kept : null), put: async (id, r) => { saved = { id, r }; } };
  const call = async () => { calls++; return { ...style, angle: 'social proof', stopper: 'a face', audience: 'office workers', proof: 'reviews' }; };
  assert.deepEqual(await readRivalAd({ ...ad, id: 'k1' }, { call, store, video: false, log: { warn() {} } }), kept); assert.equal(calls, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rival-')); const f = path.join(dir, 'p.png');
  fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]));
  const r = await readRivalAd({ ...ad, id: 'n1' }, { call, store, fileOf: async () => f, video: false, log: { warn() {}, info() {} } });
  assert.equal(calls, 1); assert.equal(r.angle, 'social proof'); assert.equal(r.proof, 'reviews'); assert.equal(saved.id, 'n1');
  assert.match(rivalBlock(ad, r, 'Cozy'), /Angle: social proof/); assert.match(rivalBlock(ad, r, 'Cozy'), /What stops the scroll: a face/);
});

test('viral cards are reference cards, never rival cards; the viral block names the format and forbids copying', async () => {
  const { isReferenceCard, isViralCard, isRivalCard, viralBlock } = await import('../rival-ad.js');
  const v = { research: { kind: 'viral', id: 'tt:1' } };
  assert.ok(isViralCard(v) && isReferenceCard(v) && !isRivalCard(v));
  assert.ok(isReferenceCard({ research: { kind: 'ad', id: '1' } }));
  const b = viralBlock({ platform: 'tiktok', author: 'maker', views: 900000, score: 30, read: { hook: { first3s: 'A hand slams the jar down' }, format: 'demo', pacing: '4 cuts', whyItWorks: 'Pattern break', scenes: [{ t: '0:00', shot: 'Jar slam', onScreenText: 'wait', voice: '' }] } }, 'Cozy');
  assert.match(b, /30x their usual/); assert.match(b, /Jar slam/); assert.match(b, /Never reuse the creator's sentences/); assert.match(b, /filming directions/);
  assert.equal(viralBlock(null), '');
});
