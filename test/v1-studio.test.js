// Brew Studio in the v1 jam (Param, 23 Oct): a card's picture, set or video is made on the stage by Studio (priced, on a yes),
// never drawn free on open; a finished take lands as the jam's next version and the Work item says where it stands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemix } from '../remix.js';
import { versionsOf } from '../learn.js';
import { configureGen } from '../gen-store.js';
import { runIn } from '../brand-ctx.js';
import { contextOf } from '../jam2/context.js';

delete process.env.V1_STUDIO;
process.env.AI_MOCK = '1';
const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', sym: '$', config: { product: { noun: 'balm' } }, seed: { brand: { name: 'Acme', host: 'acme.com' } } };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-studio-')); fs.mkdirSync(path.join(DIR, 'gen'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'balm.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
configureGen({ dir: path.join(DIR, 'gen'), remote: false, log: { warn() {} } });
const quiet = { warn() {}, log() {}, error() {} };
let k = 0; const fakeImage = async () => Buffer.from(`89504e470d0a1a0a${(++k).toString(16).padStart(4, '0')}`, 'hex');

const studio = (extra = {}) => {
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, claudeTool: null, geminiImage: fakeImage, mediaFake: true, PUB: DIR, LANE_PHOTO: { lane1: 'balm.png' }, FACTS: {}, SEED: { connectors: { meta: { name: 'Meta Ads' } }, colleagues: [] }, AGENT: { creative: 'Creative', storefront: 'Storefront' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => false, spend: () => true, uid: (p) => `${p}_${++n}`, now: (t) => Date.now() + (t?.clock || 0), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `$${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: quiet, ...extra });
  const call = (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p));
  return { R, RMX, call };
};
const tenant = (card) => ({ id: 't_1', brandId: 'acme', clock: 0, cards: new Map([[card.id, card]]), changes: {}, work: [], conn: {}, acted: new Set(), shown: {} });
const card = (o) => ({ id: 'c1', title: 'Warm paws all winter', sub: 'Cold hands, sorted. One balm, every morning.', agent: 'creative', sector: 'creatives', type: 'idea', lane: 'lane1', images: ['balm.png'], detail: { why: ['Searches for hand balm doubled this week'], how: ['Write the hook'] }, ...o });
const settle = async (ch, ms = 8000) => { const end = Date.now() + ms; await new Promise((r) => setTimeout(r, 30)); while (Date.now() < end && (ch.ctaPending || ch.ctaQueued || ch.imagePending || ch.copyPending)) await new Promise((r) => setTimeout(r, 25)); };
/* the jam opened from the button: the package first (as linkChange does), then the press */
const press = async (S, t, label) => { const r = await S.call('POST /api/cards/:cid/remix', { fast: true }, t, { cid: 'c1' }); const id = r.changes[0].id;
  const m = await S.call('POST /api/changes/:chid/cta-make', { label }, t, { chid: id }); return { id, m, ch: t.changes[id] }; };


test('Make the ad opens on the Studio composer: nothing is drawn on open or on the press, and the change says it is a Studio jam', async () => {
  for (const [label, fmt, want] of [['Make the ad', 'single image ad', 'image-ad'], ['Make the video', 'reel', 'reel'], ['Make the carousel ad', 'carousel ad', 'carousel-ad']]) {
    let drawn = 0; const S = studio({ geminiImage: async (...a) => { drawn++; return fakeImage(...a); } }), t = tenant(card({ cta: { label }, make: { format: fmt, pieces: 'The balm on a frosty windowsill' } }));
    const { id, m, ch } = await press(S, t, label); await settle(ch);
    assert.equal(m.studio, true, `${label}: the press hands over to the composer`); assert.equal(m.making, false);
    assert.equal(drawn, 0, `${label}: no free picture drawn`); assert.ok(!/^gen\//.test(ch.pkg.image || ''), `${label}: no made picture yet`);
    assert.equal(S.RMX.pubChange(t, ch).studio, want, `${label}: a ${want} Studio jam`); assert.equal(ch.studioLabel, label);
  }
});

test('words, community replies and the legacy switch stay as they were', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Draft the email' }, make: { format: 'email' } }));
  const { ch } = await press(S, t, 'Draft the email'); await settle(ch); assert.equal(S.RMX.pubChange(t, ch).studio, null, 'an email is written, not made in Studio');
  process.env.V1_STUDIO = '0'; try { const S2 = studio(), t2 = tenant(card({ cta: { label: 'Make the ad' }, make: { format: 'single image ad' } })); const r = await press(S2, t2, 'Make the ad'); assert.notEqual(r.m.studio, true); assert.equal(S2.RMX.pubChange(t2, r.ch).studio, null); } finally { delete process.env.V1_STUDIO; }
});

test('a Studio take lands as the next version (picture, set, film) and the Work item follows making → made / failed', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Make the ad' }, make: { format: 'single image ad' } }));
  const { id, ch } = await press(S, t, 'Make the ad'); await settle(ch); t.work.push({ id: 'w1', changeId: id, cardId: 'c1', versions: [], updatedAt: 0 });
  const n0 = versionsOf(t, id).length;
  S.RMX.studioState(t, id, { state: 'making', line: 'in use picture', usd: 0.21, n: 1 }); assert.equal(t.work[0].creative.state, 'making'); assert.equal(ch.studioState.usd, 0.21);
  const v = S.RMX.landStudio(t, id, { file: 'gen/ad.jpg', cost: { usd: 0.21 }, studio: { style: 'in-use', label: 'In use', kind: 'image', size: 'ig-portrait' }, jid: 'j2_x' });
  assert.equal(versionsOf(t, id).length, n0 + 1); assert.equal(ch.pkg.image, 'gen/ad.jpg'); assert.equal(v.studio.usd, 0.21); assert.equal(t.work[0].creative.state, 'made'); assert.equal(t.work[0].creative.thumb, 'gen/ad.jpg');
  assert.ok(S.RMX.pubChange(t, ch).versions.at(-1).studio, 'the version says Studio made it');
  S.RMX.landStudio(t, id, { file: 'gen/s1.jpg', slides: [{ file: 'gen/s1.jpg' }, { file: 'gen/s2.jpg' }], studio: { kind: 'image', label: 'Carousel' } }); assert.deepEqual(ch.pkg.cardImages, ['gen/s1.jpg', 'gen/s2.jpg']);
  S.RMX.landStudio(t, id, { file: 'gen/f.mp4', poster: 'gen/p.jpg', studio: { kind: 'video', label: 'UGC review' } }); assert.equal(ch.pkg.video, 'gen/f.mp4'); assert.equal(ch.pkg.image, 'gen/p.jpg');
  S.RMX.studioState(t, id, { state: 'failed', error: 'The picture changed the product, twice' }); assert.equal(t.work[0].creative.state, 'failed');
});

test('the composer arrives filled: every slot says why, gaps are said plainly, nothing is made up', () => {
  const base = { card: { title: 'Customers love it: 222 reviews say less hair fall', cta: { label: 'Make the ad' } }, product: { img: 'p.jpg', name: 'Shampoo', handle: 'shampoo' }, catalog: [{ handle: 'shampoo', title: 'Shampoo', images: ['p.jpg', 'p2.jpg', 'p3.jpg'] }] };
  const d0 = { kind: 'image', style: 'in-use', sizes: ['ig-portrait'], count: 1 };
  const a = contextOf({ ...base, bbv: { comfort: { people: 'ai-cast' }, kit: { colors: ['#123456'], logo: 'logo.png' }, reviews: [{ text: 'My hair fall stopped in 3 weeks' }], never: ['miracle'] } }, d0);
  for (const [k, s] of Object.entries(a.slots)) if (s) assert.ok(s.why && s.why.length > 8, `${k} says why`);
  assert.equal(a.slots.products.value[0].photos.length, 3, 'every photo of the product'); assert.match(a.slots.words.value.review, /hair fall stopped/); assert.match(a.slots.direction.value, /Never: miracle/);
  assert.equal(a.missing.length, 0, `nothing missing: ${a.missing.map((m) => m.text).join(' | ')}`); assert.doesNotMatch(a.slots.direction.value, /\.\./);
  const b = contextOf({ ...base, catalog: [], bbv: { comfort: { people: 'none' }, kit: {} } }, d0);
  assert.equal(b.slots.words.value.review, null, 'no review is ever invented'); assert.equal(b.slots.cast.value, 'none'); assert.match(b.slots.direction.value, /No people/);
  assert.ok(b.missing.some((m) => /logo/i.test(m.text)) && b.missing.some((m) => /one photo/i.test(m.text)), 'the gaps are said, with a fix');
  const r = contextOf({ ...base, card: { ...base.card, research: { kind: 'ad' }, rivalName: 'Rival', images: ['r.jpg'] }, bbv: {} }, d0); assert.equal(r.slots.reference.value.img, 'r.jpg'); assert.match(r.slots.reference.why, /rival ad/);
});

test('ready to publish: every part with its limit, Brew fills the link and alt text, the check reads the picture’s own words', async () => {
  const { readyOf, linkOf } = await import('../publish-ready.js');
  const base = { family: 'meta_ad', card: { title: 'Sell more combos' }, product: { name: 'Combo', url: 'https://shop.example/p/combo' }, catalog: [{ t: 'Combo', price: '1803' }], brand: 'Acme', host: 'shop.example', source: 'acme reviews rated 4.6 stars, combo ₹1,803', style: { id: 'in-use', label: 'In use' } };
  const ok = readyOf({ ...base, pkg: { primaryText: 'Two steps, one routine.', headline: 'The ₹1,803 combo', cta: 'Shop now' }, words: ['4.6 stars from reviews', 'SHOP NOW'] });
  assert.equal(ok.ready, true, JSON.stringify(ok.checks.filter((c) => !c.ok).concat(ok.parts.filter((p) => !p.ok))));
  const link = ok.parts.find((x) => x.k === 'link'); assert.match(link.value, /^https:\/\/shop\.example\/p\/combo\?utm_source=meta&utm_medium=paid_social&utm_campaign=sell-more-combos/); assert.equal(link.made, true);
  assert.match(ok.parts.find((x) => x.k === 'alt').value, /Acme Combo: in use/);
  const bad = readyOf({ ...base, pkg: { primaryText: 'x'.repeat(140), headline: 'A very long headline that Meta will cut on phones', cta: 'Buy it' }, words: ['4.9★ from 1,000 reviews', 'Now ₹999'] });
  assert.equal(bad.ready, false); assert.ok(bad.checks.find((c) => c.k === 'rating' && !c.ok), 'a rating that isn’t the brand’s'); assert.ok(bad.checks.find((c) => c.k === 'price' && !c.ok), 'a price that isn’t on the store');
  assert.ok(bad.parts.find((x) => x.k === 'cta' && !x.ok), 'a button Meta doesn’t offer'); assert.ok(bad.parts.find((x) => x.k === 'headline').warn.length, 'a headline Meta cuts'); assert.ok(bad.parts.find((x) => x.k === 'primaryText').warn.length);
  assert.ok(readyOf({ ...base, pkg: { primaryText: 'a', headline: 'b', cta: 'Shop now', publish: { link: 'https://evil.example/x' } } }).parts.find((x) => x.k === 'link' && !x.ok), 'a link off the brand’s site');
  assert.equal(linkOf({ family: 'social', host: 'www.shop.example', campaign: 'Warm paws' }), 'https://www.shop.example/?utm_source=instagram&utm_medium=social&utm_campaign=warm-paws', 'no guessed product path when the store gave none');
  const s = readyOf({ ...base, family: 'social', pkg: { caption: 'Warm paws.', hashtags: ['#cats'] } }); assert.ok(s.parts.find((x) => x.k === 'hashtags').warn.length, 'too few hashtags');
});

test('a Studio take’s jam carries the publish parts; an edit keeps the link, the alt text and the words-in-picture mark', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Make the ad' }, make: { format: 'single image ad' } }));
  const { id, ch } = await press(S, t, 'Make the ad'); await settle(ch);
  assert.equal(S.RMX.pubChange(t, ch).publish.made, false, 'nothing to publish before a take');
  S.RMX.landStudio(t, id, { file: 'gen/ad.jpg', cost: { usd: 0.1 }, words: { headline: 'Warm paws', proof: '4.9★ rated' }, studio: { style: 'in-use', label: 'In use', kind: 'image', spec: { product: { name: 'Balm', img: 'balm.png' } } } });
  const pb = S.RMX.pubChange(t, ch).publish; assert.equal(pb.made, true); assert.ok(pb.parts.some((x) => x.k === 'link') && pb.parts.some((x) => x.k === 'alt'));
  assert.ok(pb.checks.find((c) => c.k === 'rating' && !c.ok), 'the 4.9★ in the picture isn’t backed'); assert.equal(pb.ready, false);
  await S.call('POST /api/changes/:chid/edit', { pkg: { publish: { link: 'https://acme.com/balm', alt: 'Balm on a windowsill.' } } }, t, { chid: id });
  assert.equal(ch.pkg.publish.link, 'https://acme.com/balm'); assert.equal(ch.pkg.wordsIn, 'gen/ad.jpg', 'the picture still says its words are in it');
});

test('a picture with its own words is fitted whole into every placement, never cropped; a word-free photo is still cropped', async () => {
  const { fitTo, hasWords, buildPack } = await import('../publish-pack.js'), sharp = (await import('sharp')).default;
  const f = path.join(DIR, 'worded.png'); fs.writeFileSync(f, await sharp({ create: { width: 400, height: 500, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer());
  const out = await fitTo(f, '9:16'), m = await sharp(out).metadata(); assert.equal(m.width, 400); assert.equal(m.height, 711, 'the 9:16 frame around the whole 4:5 picture');
  const wide = await sharp(await fitTo(f, '1:1')).metadata(); assert.equal(wide.width, 500); assert.equal(wide.height, 500);
  assert.equal(hasWords('gen/j2-abc.jpg'), true); assert.equal(hasWords('gen/abc.png'), false); assert.equal(hasWords('gen/abc.png', { wordsIn: 'gen/abc.png' }), true);
  let fits = 0, crops = 0; const read = async () => f;
  await buildPack({ ch: { actionLabel: 'Ad' }, family: 'meta_ad', pkg: { image: 'gen/j2-x.png', format: '4:5', wordsIn: 'gen/j2-x.png' }, read, crop: async () => { crops++; return Buffer.from('c'); }, fit: async () => { fits++; return Buffer.from('f'); } });
  assert.equal(fits, 2); assert.equal(crops, 0);
  await buildPack({ ch: { actionLabel: 'Ad' }, family: 'meta_ad', pkg: { image: 'gen/plain.png', format: '4:5' }, read, crop: async () => { crops++; return Buffer.from('c'); }, fit: async () => { fits++; return Buffer.from('f'); } });
  assert.equal(crops, 2, 'a word-free photo is cropped as before');
});

test('a set lands whole: a carousel’s cards follow its slides, an A+ set lands as its modules, a listing as its photo set', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Make the carousel ad' }, make: { format: 'carousel ad' } }));
  const { id, ch } = await press(S, t, 'Make the carousel ad'); await settle(ch);
  S.RMX.landStudio(t, id, { file: 'gen/j2-a.jpg', slides: [{ file: 'gen/j2-a.jpg', style: 'in-use', words: { headline: 'Warm paws' } }, { file: 'gen/j2-b.jpg', style: 'closeup', words: { headline: 'One balm' } }, { file: 'gen/j2-c.jpg', style: 'flat-lay', words: { headline: 'Every morning' } }], studio: { kind: 'image', label: 'Carousel' } });
  assert.deepEqual(ch.pkg.cardImages, ['gen/j2-a.jpg', 'gen/j2-b.jpg', 'gen/j2-c.jpg']); if (ch.family === 'meta_ad' && ch.pkg.cards) assert.deepEqual(ch.pkg.cards.map((x) => x.headline), ['Warm paws', 'One balm', 'Every morning']);
  const head = versionsOf(t, id).at(-1); assert.equal(head.studio.slides.length, 3, 'the strip knows every slide');
  S.RMX.landStudio(t, id, { file: 'gen/j2-h.jpg', slides: [{ file: 'gen/j2-h.jpg', style: 'aplus-hero', words: { headline: 'Acme' } }, { file: 'gen/j2-t.jpg', style: 'aplus-use', words: { headline: 'Soft hands', sub: 'Every morning.' } }, { file: 'gen/j2-w.jpg', style: 'aplus-wide', words: {} }], studio: { kind: 'image', label: 'A+' } });
  assert.deepEqual(ch.pkg.aplus.map((m) => m.kind), ['header', 'tile', 'wide']); assert.equal(ch.pkg.aplus[1].body, 'Every morning.');
});

test('a Studio film lands with its cover as the poster, its clean cut, its .srt and GIF, and the spoken words go to the check', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Make the video' }, make: { format: 'reel' } }));
  const { id, ch } = await press(S, t, 'Make the video'); await settle(ch);
  S.RMX.landStudio(t, id, { file: 'gen/j2-cap.mp4', raw: 'gen/j2-raw.mp4', srt: 'gen/j2-a.srt', cover: 'gen/j2-cover.jpg', poster: 'gen/j2-frame.jpg', gif: 'gen/j2-l.gif', captions: { n: 2, segs: [{ from: 0, to: 1, text: 'Rated 4.9 stars' }] }, studio: { kind: 'video', label: 'UGC review' } });
  assert.equal(ch.pkg.video, 'gen/j2-cap.mp4'); assert.equal(ch.pkg.poster, 'gen/j2-cover.jpg'); assert.deepEqual([ch.pkg.film.raw, ch.pkg.film.srt, ch.pkg.film.gif], ['gen/j2-raw.mp4', 'gen/j2-a.srt', 'gen/j2-l.gif']);
  assert.ok(versionsOf(t, id).at(-1).studio.words.includes('Rated 4.9 stars'), 'what is said is checked like what is written');
});

test('collection and catalog ads show the catalog’s own photos; a catalog ad needs nothing made', async () => {
  const S = studio({ catalogOf: () => [{ t: 'Warm Balm', img: 'balm.png', price: '499' }, { t: 'Paw Wax', img: 'wax.png', price: '299' }] }), t = tenant(card({ cta: { label: 'Build the catalog ad' }, make: { format: 'catalog ad' } }));
  const { ch } = await press(S, t, 'Build the catalog ad'); await settle(ch); ch.pkg.productSet = 'Every in-stock best seller';
  const pub = S.RMX.pubChange(t, ch); assert.match(ch.action, /catalog_ad$/, ch.action); assert.equal(pub.studio, null, 'nothing to make for a catalog ad'); assert.equal(pub.catalogPics.length, 2); assert.equal(pub.catalogPics[0].img, 'balm.png');
});

/* jam audit, 24 Oct */
test('audit 24 Oct: the jam’s own action decides what Studio makes; marketplace titles are words only', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Make the ad' }, make: { format: 'single image ad' } }));
  const { ch } = await press(S, t, 'Make the ad'); await settle(ch);
  ch.action = 'creative.short_video'; ch.family = 'post'; assert.equal(S.RMX.pubChange(t, ch).studio, 'reel', 'a short-video jam on a "Make the ad" card makes a video');
  ch.action = 'creative.ig_carousel'; ch.family = 'social'; assert.equal(S.RMX.pubChange(t, ch).studio, 'ig-carousel', 'a carousel jam makes a set');
  ch.action = 'storefront.listing_titles'; ch.family = 'listing'; assert.equal(S.RMX.pubChange(t, ch).studio, null, 'titles are written, never drawn');
});

test('audit 24 Oct: a words edit keeps what Studio made (panel, strip, check); a picture after a film drops the film; an edit that changes nothing adds no version', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Make the ad' }, make: { format: 'single image ad' } }));
  const { id, ch } = await press(S, t, 'Make the ad'); await settle(ch);
  S.RMX.landStudio(t, id, { file: 'gen/f.mp4', poster: 'gen/p.jpg', srt: 'gen/c.srt', studio: { kind: 'video', label: 'UGC review', spec: { quality: 'preview' } } });
  assert.ok(ch.pkg.film, 'the film is on the package');
  const v = S.RMX.landStudio(t, id, { file: 'gen/ad2.jpg', studio: { kind: 'image', label: 'In use' } });
  assert.equal(ch.pkg.video, undefined, 'the old film is gone'); assert.equal(ch.pkg.film, undefined); assert.equal(ch.pkg.image, 'gen/ad2.jpg'); assert.ok(v.studio);
  const n0 = versionsOf(t, id).length;
  await S.call('POST /api/changes/:chid/edit', { pkg: { headline: 'Warm hands by nine' } }, t, { chid: id });
  const head = versionsOf(t, id).at(-1); assert.equal(versionsOf(t, id).length, n0 + 1); assert.ok(head.studio, 'the words version still says Studio made the picture');
  assert.equal(S.RMX.pubChange(t, ch).publish?.made, true, 'the ready-to-publish panel stays');
  const r = await S.call('POST /api/changes/:chid/edit', { pkg: { headline: 'Warm hands by nine' } }, t, { chid: id });
  assert.equal(r.same, true); assert.equal(versionsOf(t, id).length, n0 + 1, 'no empty version');
  await S.call('POST /api/changes/:chid/edit', { pkg: { description: '' } }, t, { chid: id }); assert.equal(ch.pkg.description, undefined, 'a cleared field stays cleared');
});

test('audit 24 Oct: a preview take is never called ready; nothing made yet has no picture-words check', async () => {
  const S = studio(), t = tenant(card({ cta: { label: 'Make the ad' }, make: { format: 'single image ad' } }));
  const { id, ch } = await press(S, t, 'Make the ad'); await settle(ch);
  assert.ok(!(S.RMX.pubChange(t, ch).publish?.checks || []).some((c) => c.k === 'picture'), 'no picture yet, no "words weren’t read"');
  S.RMX.landStudio(t, id, { file: 'gen/pv.jpg', words: { headline: 'Warm paws' }, studio: { kind: 'image', label: 'In use', spec: { quality: 'preview' } } });
  assert.ok(S.RMX.pubChange(t, ch).publish.checks.some((c) => c.k === 'preview' && !c.ok), 'the quick preview says to make the full one');
});
