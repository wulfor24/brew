// The Brand Book: built from evidence only, references by deliverable, scopes that never leak, and every writer reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify, evidenceOf, libraryOf, familiesFor, tiersOf, freeChapters, createBookReader } from '../brand-book-read.js';
import { viewOf, readLayer, blankBook, refsFor, promptBlock, creativeBlock, createBrandbook, loadView } from '../jam2/brandbook.js';
import { bannedWith } from '../brand-pack.js';

const profile = {
  host: 'cozy.example', url: 'https://cozy.example/', name: 'Cozy', tagline: 'Cold feet, fixed.', descriptor: 'Heated warmers for women', about: 'Started by a team with cold feet in freezing offices.',
  identity: { logo: '/b/cozy/a/logo.png', colors: ['#2e1a33', '#eed8de', '#5c3466'], fonts: { heading: 'Nunito', body: 'Corben' } },
  catalog: { hero: ['paw'], products: [{ handle: 'paw', title: 'Paw Warmer', price: 39, img: '/b/cozy/a/pack-paw.jpg', url: 'https://cozy.example/products/paw', about: 'A plush paw that warms in 3 minutes.' },
    { handle: 'sock', title: 'Fuzzy Socks', price: 12, img: 'https://cdn.example/sock.jpg' }, { handle: 'hood', title: 'Blanket Hoodie', price: 79 }, { handle: 'mask', title: 'Eye Mask', price: 19 }] },
  ads: { own: { items: [{ id: '1', hook: 'Cold feet, fixed.', body: 'Warm in 3 minutes.', format: 'image', poster: '/b/cozy/a/ad-1.jpg', days: 40, versions: 3 },
    { id: '2', hook: 'Snuggle season', format: 'video', poster: '/b/cozy/a/ad-2.jpg', video: '/b/cozy/a/ad-2-video.mp4', days: 12 },
    { id: '3', hook: 'Expired', format: 'image', poster: null, posterSrc: 'https://scontent.example/x.jpg', days: 99 }] } },
  socials: { instagram: { url: 'https://instagram.com/cozy', posts: [{ url: 'https://instagram.com/p/a', caption: 'Toasty toes all winter long', likes: 900, kind: 'reel', img: '/b/cozy/a/ig-a.jpg' },
    { url: 'https://instagram.com/p/b', caption: 'Desk-day comfort', likes: 50, kind: 'post', imageSrc: 'https://cdn.ig/expired.jpg' }] } },
  reviews: { quotes: [{ text: 'My feet are finally warm at my desk', url: 'https://judge.me/r/1' }], platforms: [{ label: 'Judge.me', count: 120, rating: 4.8 }] },
  meta: { readAt: '2026-10-20T00:00:00Z' }
};
const brief = { language: ['cozy', 'toasty'], personas: [{ name: 'The freezing office worker', who: 'A woman with cold feet at her desk', job: 'Stay warm discreetly' }], claims: [{ claim: 'Warms in 3 minutes', basis: 'product page' }] };

test('a made-up quote, an uncited trait or a colour the site never used never survives', () => {
  const E = evidenceOf({ profile, brief });
  const out = verify({
    story: { positioning: 'Warmers for cold offices', e: ['E1'] },
    voice: { summary: 'Warm and playful', traits: [{ trait: 'Playful', sounds: 'Toasty toes all winter long', e: ['E7'] }, { trait: 'Made up', sounds: 'We are the best in the world', e: ['E99'] }, { trait: 'Fake line', sounds: 'Unbeatable warmth guaranteed', e: ['E1'] }],
      pairs: [{ do: 'Cold feet, fixed.', dont: 'Our product solves cold feet' }, { do: 'Invented do', dont: 'x' }] },
    words: { use: ['toasty', 'super premium'] },
    claims: [{ text: 'Warm in 3 minutes', e: ['E9'] }, { text: 'Clinically proven', e: ['E1'] }],
    colors: [{ hex: '#2E1A33', role: 'primary' }, { hex: '#ff0000', role: 'accent' }]
  }, E, profile.identity);
  assert.equal(out.story.positioning, 'Warmers for cold offices');
  assert.deepEqual(out.voice.traits.map((t) => [t.trait, t.sounds]), [['Playful', 'Toasty toes all winter long'], ['Fake line', null]]);
  assert.deepEqual(out.voice.pairs.map((p) => p.do), ['Cold feet, fixed.']);
  assert.deepEqual(out.words.use, ['toasty']);
  assert.deepEqual(out.claims.map((c) => c.text), ['Warm in 3 minutes']);
  assert.deepEqual(out.colors.map((c) => c.hex), ['#2e1a33']);
});

test('the library keeps only saved pictures, by deliverable, best first with proof', () => {
  const lib = libraryOf(profile);
  assert.deepEqual(Object.keys(lib).sort(), ['ad-image', 'ad-video', 'ig-reel', 'product-photo']);
  assert.equal(lib['ad-image'][0].proof, 'Running 40 days · 3 versions');
  assert.equal(lib['ad-video'][0].video, '/b/cozy/a/ad-2-video.mp4');
  assert.equal(lib['ig-reel'][0].proof, '900 likes');
  assert.ok(!JSON.stringify(lib).includes('expired'), 'an expired CDN link is no reference');
  assert.deepEqual(lib['product-photo'].map((x) => x.words), ['Paw Warmer']);
  assert.equal(familiesFor('reel')[0], 'ad-video');
  assert.equal(familiesFor('meta-static')[0], 'ad-image');
  assert.equal(familiesFor('carousel')[0], 'ad-carousel');
});

test('price tiers and free chapters come from the read with no AI', () => {
  const t = tiersOf(profile.catalog.products, 'USD');
  assert.deepEqual(t.map((x) => x.name), ['Entry', 'Core', 'Premium']);
  const f = freeChapters({ profile, brief, ledger: [{ key: 'offer.free_shipping_banner', v: 'Free shipping over $50' }], homeText: 'Try it risk free. 30-day money-back guarantee on every order.' });
  assert.equal(f.cover.tagline, 'Cold feet, fixed.');
  assert.deepEqual(f.products.offers, ['Free shipping over $50']);
  assert.match(f.products.guarantee, /30-day money-back guarantee/);
  assert.equal(f.proof.ratings[0].count, 120);
});

const read = { v: 1, kit: { colors: [{ hex: '#2e1a33', role: 'primary' }] }, library: libraryOf(profile), voice: { summary: 'Warm and playful', traits: [{ trait: 'Playful', sounds: 'Toasty toes all winter long' }] },
  look: { notes: 'Soft window light on cosy desks.', wordsOnImage: 'one short line, top' }, playbooks: [{ family: 'ig-reel', headline: '3 words', cta: 'Shop the warmth' }, { family: 'ad-image', headline: '4 words max' }],
  proof: { claims: [{ text: 'Warm in 3 minutes', from: [{ url: 'https://cozy.example/products/paw' }] }] } };
const bbOf = (saved = {}) => ({ ...blankBook(), ...saved, read: readLayer({ slug: 'cozy', profile, brief, config: { banned: '\\b(cure)\\b' }, book: read }) });

test('share and public views never carry private edits, uploads or team settings', () => {
  const bb = bbOf({ edits: { 'story.mission': { value: 'Warm every desk', src: 'team' }, 'tone.summary': { value: 'Secret launch voice', private: true, src: 'upload:Guide.pdf' } },
    uploads: [{ id: 'u1', name: 'Guide.pdf', private: true, proposed: [] }], neverSay: ['cheap'], cast: [{ id: 'c', label: 'Our founder', kind: 'real' }], comfort: { people: 'consented' } });
  const m = viewOf(bb), sh = viewOf(bb, { scope: 'share' }), pub = viewOf(bb, { scope: 'public' });
  assert.equal(m.tone.summary, 'Secret launch voice'); assert.equal(m.uploads.length, 1);
  assert.equal(sh.story.mission, 'Warm every desk'); assert.equal(sh.tone.summary, 'Warm and playful');
  assert.ok(!('uploads' in sh) && !('cast' in sh) && !('comfort' in sh) && !('taste' in sh));
  assert.ok(!JSON.stringify(sh).includes('Secret launch voice'));
  assert.equal(pub.story?.mission, undefined); assert.deepEqual(pub.neverSay, []);
  assert.ok(!JSON.stringify(pub).includes('cheap'));
  assert.equal(m.src['tone.summary'], 'upload:Guide.pdf');
});

test('makers get the brand’s own references for the piece, and the words and art blocks', () => {
  const v = viewOf(bbOf());
  assert.equal(refsFor(v, 'reel', 1)[0].family, 'ad-video');
  assert.equal(refsFor(v, 'meta-static', 1)[0].family, 'ad-image');
  const w = promptBlock(v, { kind: 'reel' });
  assert.match(w, /Toasty toes all winter long/); assert.match(w, /Warm in 3 minutes/); assert.match(w, /headline 3 words/);
  const c = creativeBlock(v, 'meta-static');
  assert.match(c, /Soft window light/); assert.match(c, /headings in Nunito/); assert.match(c, /#2e1a33 primary/);
});

test('the team’s never-say words join the category’s banned list in one regex', () => {
  const r = bannedWith('\\b(miracle\\w*)\\b', ['clinically proven', 'cheap', 'x']);
  assert.ok(r.test('Clinically   proven results')); assert.ok(r.test('a miracle')); assert.ok(!r.test('cheapest')); assert.ok(!r.test('x marks'));
  assert.ok(bannedWith('(', ['ok words']).test('ok words'), 'a broken category regex still bans the team’s words');
});

test('edits by path, undo, and an upload’s proposed changes taken in one tap', async () => {
  const files = new Map([['cozy|profile.json', profile], ['cozy|brief.json', brief], ['cozy|brandbook-read.json', read]]);
  const packs = { getJSON: async (s, n, d) => (files.has(`${s}|${n}`) ? structuredClone(files.get(`${s}|${n}`)) : d), put: async (s, n, v) => files.set(`${s}|${n}`, v) };
  const bb = createBrandbook({ packs, log: { warn() {} } });
  await bb.update('cozy', { edit: { path: 'story.mission', value: 'Warm every desk' } }, { email: 'a@cozy.example' });
  await bb.update('cozy', { edit: { path: 'kit.secret', value: 'nope' } });
  await bb.update('cozy', { upload: { id: 'u1', name: 'Guide.pdf', private: false, proposed: [{ path: 'tone.summary', value: 'Bright and kind' }, { path: 'story.mission', value: 'From the PDF' }], neverSay: ['cheap'] } });
  await bb.update('cozy', { confirm: 'story.mission' });
  const raw = await bb.update('cozy', { applyUpload: { id: 'u1' } });
  const v = bb.view(raw);
  assert.equal(v.story.mission, 'Warm every desk', 'a confirmed field is never overwritten by an upload');
  assert.equal(v.tone.summary, 'Bright and kind'); assert.equal(v.src['tone.summary'], 'upload:Guide.pdf');
  assert.ok(v.neverSay.includes('cheap')); assert.ok(!('kit.secret' in raw.edits));
  const v2 = bb.view(await bb.update('cozy', { unedit: 'tone.summary' }));
  assert.equal(v2.tone.summary, 'Warm and playful');
  const lv = await loadView(packs, 'cozy', { scope: 'share' });
  assert.equal(lv.story.mission, 'Warm every desk');
});

test('the reader skips a store not read yet and keeps the free chapters when the AI is off', async () => {
  const files = new Map([['cozy|profile.json', profile], ['cozy|brief.json', brief]]);
  const packs = { getJSON: async (s, n, d) => (files.has(`${s}|${n}`) ? files.get(`${s}|${n}`) : d), get: async () => null, put: async (s, n, v) => files.set(`${s}|${n}`, v) };
  const r = createBookReader({ packs, ai: null, fetchText: async () => ({ html: '<html><body><a href="/pages/brand-guidelines">Brand guidelines</a>Free shipping on all orders. 30-day money-back guarantee.</body></html>' }) });
  const b = await r.ensure('cozy');
  assert.match(b.error, /AI is off/); assert.equal(b.cover.name, 'Cozy'); assert.ok(b.products.guarantee);
  assert.deepEqual(b.guides, ['https://cozy.example/pages/brand-guidelines']);
  assert.ok(files.has('cozy|brandbook-read.json'));
  assert.equal(await r.stale('cozy'), false, 'a fresh book is not rebuilt');
  const none = await createBookReader({ packs: { getJSON: async (s, n, d) => d, put: async () => assert.fail('nothing saved') }, ai: null }).ensure('nobody');
  assert.equal(none, null);
});
