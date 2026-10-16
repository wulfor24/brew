// One number, one source (pack-numbers.js): live ads, products, moves, "need your yes" and AI visibility are each worked
// out one way, and every screen (demo picker, read, check page, moves page, health rings, the tour) reads that one value.
// Saved packs heal on load. Generic: no brand names in the rules. No network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.REFRESH_AUTO = '0'; process.env.DEMO_MODE = process.env.DEMO_MODE || '';
const N = await import('../pack-numbers.js');
const { healthFrom, HEALTH_V, healthKey } = await import('../health.js');
const { createPacks } = await import('../brand-pack.js');
const { createBuilder } = await import('../build.js');
const { createFactsDesk } = await import('../facts-desk.js');
const { createDemoRoutes } = await import('../demo-routes.js');
const { tourStep } = await import('../feed-service.js');

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.join(HERE, '..');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const DAY = 864e5;

/* a brand like the ones in the bucket: own ads, five rivals' ads, an index move and weekly moves beside the playbook */
const profileOf = (o = {}) => ({ url: 'https://acme.in', host: 'acme.in', slug: 'acme-in', name: 'Acme', country: 'IN', currency: 'INR', platform: 'shopify',
  catalog: { count: 3, products: [1, 2, 3].map((i) => ({ handle: `p${i}`, title: `Product ${i}`, price: 100 * i, url: `https://acme.in/products/p${i}`, inStock: true, images: [] })) },
  rivals: ['A', 'B', 'C'].map((x) => ({ name: `Rival ${x}`, host: `rival-${x.toLowerCase()}.in` })),
  ads: { own: { page: 'Acme', live: 1143, items: [] }, rivals: [{ name: 'Rival A', live: 188, items: [] }, { name: 'Rival B', live: 1532, items: [] }, { name: 'Rival C', live: null, error: 'treg 402', items: [] }], country: 'IN', at: '2026-10-14', v: 4 },
  ai: { score: { named: 12, of: 32, unbrandedNamed: 0, unbrandedOf: 20 } }, reviews: { total: 900 }, ...o });
const movesOf = () => ({ 0: { n: 0, title: 'Index' }, ...Object.fromEntries(Array.from({ length: 64 }, (_, i) => [i + 1, { n: i + 1, title: `Move ${i + 1}` }])),
  1006: { n: 1006, title: 'Weekly', meta: { cadence: 'weekly' } }, 1007: { n: 1007, title: 'Weekly 2', meta: { cadence: 'weekly' } } });

test('live ads: the brand’s own count, never added to the rivals’; rivals that failed count apart, never as 0', () => {
  const x = N.numbersOf({ profile: profileOf() });
  assert.equal(x.ownAds.n, 1143, 'own ads only');
  assert.equal(x.rivalAds.n, 188 + 1532, 'rivals summed over the ones read');
  assert.equal(x.rivalAds.failed, 1); assert.equal(x.rivalAds.read, 2); assert.equal(x.rivalAds.of, 3);
  const line = N.adsStepLine(x, 'Acme');
  assert.match(line, /^Acme: 1,143 live ads · 3 rivals: 1,720 live ads \(1 couldn’t be read\)$/);
  assert.doesNotMatch(line, /2,863|2863/, 'the sum of both is never shown');
  /* a rival search that failed is not "no rivals" */
  assert.match(N.adsStepLine(N.numbersOf({ profile: profileOf({ rivals: [], ads: { own: { page: 'Acme', live: 5, items: [] }, rivals: [] } }) }), 'Acme'), /rivals not identified/);
  /* own ads that could not be read are said so, never "0" */
  const err = N.numbersOf({ profile: profileOf({ ads: { own: { page: null, live: null, items: [], error: 'treg 402' }, rivals: [] } }) });
  assert.equal(err.ownAds.n, null); assert.equal(err.ownAds.error, 'treg 402'); assert.match(N.adsStepLine(err, 'Acme'), /couldn’t check/);
});

test('live ads: the freshest real read of the same page wins (the read or the daily tracker), whichever screen asks', () => {
  const profile = profileOf();
  const newer = { own: { page: 'Acme', live: 1296, fetchedAt: Date.parse('2026-10-15T09:00:00Z') } };
  assert.equal(N.ownAds({ profile, research: newer }).n, 1296, 'the tracker read later');
  const older = { own: { page: 'Acme', live: 664, fetchedAt: Date.parse('2026-10-10T09:00:00Z') } };
  assert.equal(N.ownAds({ profile, research: older }).n, 1143, 'the read is newer than the tracker');
  const other = { own: { page: 'Somebody Else', live: 9, fetchedAt: Date.parse('2026-10-16T09:00:00Z') } };
  assert.equal(N.ownAds({ profile, research: other }).n, 1143, 'a tracker on another page is not a newer count');
});

test('products: the catalog count, and the freshest products.json read of it', () => {
  assert.equal(N.products({ profile: profileOf() }).n, 3);
  const p = profileOf(); delete p.catalog.count;
  assert.equal(N.products({ profile: p }).n, 3, 'an old read without catalog.count counts its products');
  const watch = { catalog: { count: 4, fetchedAt: Date.parse('2026-10-15T12:00:00Z') } };
  assert.equal(N.products({ profile: profileOf(), liveWatch: watch, daily: { at: Date.parse('2026-10-15T06:00:00Z') } }).n, 4, 'the watcher read later');
  assert.equal(N.products({ profile: profileOf(), liveWatch: watch, daily: { at: Date.parse('2026-10-15T18:00:00Z') } }).n, 3, 'the daily check read later');
});

test('moves: the playbook is status.total, never moves.json’s length (index 00 and weekly 1001+ count apart)', () => {
  const m = N.moves({ status: { total: 64, done: true }, moves: movesOf() });
  assert.equal(Object.keys(movesOf()).length, 67, 'the file has more entries than the playbook');
  assert.deepEqual(m, { total: 64, written: 64, weekly: 2 });
  assert.equal(N.moves({ status: { done: true }, moves: movesOf() }).total, 64, 'a brand finished before the one count: the moves it has');
  assert.equal(N.moves({ status: {}, moves: {} }).total, 50, 'before the engine counted');
  assert.equal(N.totalOf({ total: 64 }), 64);
});

test('AI visibility: the answers to questions that don’t name the brand; all answers kept apart and labelled', () => {
  const a = N.ai({ profile: profileOf() });
  assert.equal(a.named, 0); assert.equal(a.of, 20); assert.ok(a.unbranded); assert.deepEqual(a.all, { named: 12, of: 32 });
  const ring = healthFrom(profileOf()).rings.find((r) => r.k === 'AI answers');
  assert.match(ring.what, /Named in 0 of 20 answers when not asked by name/, 'the ring says the same 0 of 20 the brief says');
  const cr = healthFrom(profileOf()).rings.find((r) => r.k === 'Creative');
  assert.match(cr.what, /your 1,143 live ads/);
});

test('a saved seed heals on load: the read’s ad step, the ads finding, the product count and the rings quote the one count', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-one-count-'));
  const P = createPacks({ ROOT, PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = 'acme-in', profile = profileOf();
  await P.put(slug, 'status.json', { name: 'Acme', host: 'acme.in', done: true, ready: true, total: 64, movesDone: 64, stages: { read: { state: 'done', at: Date.now() - DAY } } });
  await P.put(slug, 'profile.json', profile); await P.put(slug, 'moves.json', movesOf());
  /* written by an older build: the sum of own and rivals' ads, an older own count, a ring from an older version */
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in', products: '78', mark: 'x.png' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [],
    steps: [{ k: 'ads', t: 'Find live ads', done: '3 rivals, 2863 live ads' }],
    scrape: [{ k: 'ads', kind: 'ad', t: 'What rivals run', copy: 'Rival A: "Hello"', foot: 'Acme: 664 live ads. Rival A: a serum at ₹854.' }],
    health: { v: 'dummy-1', rings: [{ k: 'AI answers', v: 40, what: 'Named in 12 of 32 AI answers' }] } });
  const pk = await P.load(slug, { fresh: true });
  assert.equal(pk.numbers.ownAds.n, 1143); assert.equal(pk.numbers.moves.total, 64); assert.equal(pk.numbers.products.n, 3);
  const seed = await P.getJSON(slug, 'seed.json');
  assert.equal(seed.steps[0].done, N.adsStepLine(pk.numbers, 'Acme'), 'the step is the shared line');
  assert.equal(seed.scrape[0].foot, 'Acme: 1,143 live ads. Rival A: a serum at ₹854.', 'the finding’s own-ads line, the rest kept');
  assert.equal(seed.brand.products, '3');
  assert.equal(seed.health.v, HEALTH_V); assert.equal(seed.health.key, healthKey(pk.numbers, profile));
  assert.match(seed.health.rings.find((r) => r.k === 'AI answers').what, /0 of 20/);
  const js = P.clientSeed(pk);
  assert.match(js, /window\.MOVES_TOTAL = 64;/); assert.match(js, /window\.MOVES_WRITTEN = 64;/);
  assert.equal(JSON.parse(js.match(/window\.BREW_NUMBERS = (.*);/)[1]).ownAds.n, 1143, 'the client gets the same numbers');
  /* a newer own-ads read moves every screen together, and the ring heals again (its key changed) */
  await P.put(slug, 'research.json', { own: { page: 'Acme', live: 1296, fetchedAt: Date.now() } });
  const pk2 = await P.load(slug, { fresh: true }), seed2 = await P.getJSON(slug, 'seed.json');
  assert.equal(pk2.numbers.ownAds.n, 1296); assert.match(seed2.steps[0].done, /Acme: 1,296 live ads/); assert.match(seed2.scrape[0].foot, /^Acme: 1,296 live ads\./);
  assert.match(seed2.health.rings.find((r) => r.k === 'Creative').what, /1,296/);
});

test('the daily catalog check moves catalog.count with the ledger, and the check page and picker read the same count', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-one-count-'));
  const P = createPacks({ ROOT, PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
  const modules = { reader: { createReader: () => ({ read: async () => { throw new Error('no read in tests'); } }) }, brief: { createBrief: () => ({}) }, moves: { SPECS: [], createMovesEngine: () => ({}) }, pdf: null };
  const builder = createBuilder({ ROOT, packs: P, ai: { onCharge() {}, call: async () => { throw Object.assign(new Error('mock'), { mock: true }); } }, treg: { onCharge() {} }, log: quiet, modules });
  const slug = 'acme-in';
  await P.put(slug, 'status.json', { name: 'Acme', host: 'acme.in', done: true, ready: true, total: 64, movesDone: 64, doneAt: Date.now(), stages: { read: { state: 'done', at: Date.now() - DAY } } });
  await P.put(slug, 'profile.json', profileOf()); await P.put(slug, 'moves.json', movesOf());
  await P.put(slug, 'ledger.json', [{ key: 'catalog.count', label: 'Products in the catalog', v: '3', n: 3, layer: 'observed', src: 'acme.in/products.json', at: '2026-10-01' }]);
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in', products: '3', mark: 'x.png' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [] });
  const prod = (h) => ({ handle: h, title: `Product ${h}`, product_type: 'X', published_at: '2026-01-01', images: [], variants: [{ price: '100', available: true }] });
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => ({ products: +new URL(url).searchParams.get('page') === 1 ? ['p1', 'p2', 'p3', 'p4'].map(prod) : [] }), text: async () => '' });
  builder.signal = async () => {};
  await createFactsDesk({ packs: P, builder, log: quiet, fetchImpl }).daily(slug);
  const prof = await P.getJSON(slug, 'profile.json');
  assert.equal(prof.catalog.count, 4, 'catalog.count follows the check');
  assert.equal(prof.catalog.count, prof.catalog.products.length);
  assert.equal((await P.getJSON(slug, 'ledger.json')).find((e) => e.key === 'catalog.count').n, 4);
  const check = await builder.checkData(slug, { heal: false });
  assert.equal(check.count, 4, 'the check page');
  assert.match(check.sources.find((s) => s.key === 'adpage').v, /1,143 live ads/, 'the check page’s own ads: the same count and words');
  /* the demo picker reads the same numbers: own ads (not own + rivals), products, the playbook */
  let body = null;
  const routes = createDemoRoutes({ packs: P, builder, auth: { user: () => null, isAdmin: () => false }, connectors: {}, readBody: async () => ({}), send: (res, code, b) => { body = b; }, loadBrand: async () => null, log: quiet });
  await routes({ method: 'GET', headers: {} }, {}, new URL('http://x/api/demo/brands'));
  const card = body.brands.find((b) => b.slug === slug);
  assert.ok(card, 'the brand is listed');
  assert.equal(card.look.ads, 1143, 'own live ads, never 1143 + the rivals’');
  assert.equal(card.look.products, 4);
  assert.equal(card.moves, 64); assert.ok(card.checks.some((c) => c.t === '64 moves'));
  const picker = fs.readFileSync(path.join(REPO, 'public/demo-picker.html'), 'utf8');
  assert.doesNotMatch(picker, /theirs and rivals/, 'the picker never labels a sum');
});

test('the live tour: an empty or partial live step shows the saved read’s step and findings, marked carried; a step the saved read lacks stays honest', () => {
  const saved = { k: 'ads', state: 'done', done: 'Acme: 1,143 live ads · 5 rivals: 3,203 live ads' };
  const savedCards = [{ k: 'ads', kind: 'ad', t: 'What rivals run', copy: 'Rival A: "Hello"' }];
  const liveFinding = [{ finding: { k: 'ads', kind: 'ad', copy: 'Rivals couldn’t be identified this time' } }];
  const partial = tourStep({ type: 'step', k: 'ads', state: 'done', partial: true, done: 'Acme: 1,143 live ads · rivals not identified' }, saved, savedCards, liveFinding);
  assert.equal(partial.done, saved.done); assert.equal(partial.cards[0].finding.copy, 'Rival A: "Hello"'); assert.ok(partial.cards[0].finding.carried);
  const notAsked = tourStep({ type: 'step', k: 'answers', state: 'empty', done: 'not checked (paid sources off)' }, { k: 'answers', state: 'done', done: '8 questions, 4 AI tools' },
    [{ k: 'answers', kind: 'answer', src: 'chatgpt · asked from IN · 2026-10-14' }], [{ finding: { k: 'answers', src: 'not asked' } }]);
  assert.equal(notAsked.empty, false); assert.match(notAsked.cards[0].finding.src, /asked from IN/, 'never "not asked" over a saved answer');
  const whole = tourStep({ type: 'step', k: 'ads', state: 'done', done: 'live line' }, saved, savedCards, liveFinding);
  assert.equal(whole.done, 'live line'); assert.equal(whole.cards[0].finding.copy, 'Rivals couldn’t be identified this time');
  const noSaved = tourStep({ type: 'step', k: 'answers', state: 'empty', done: 'not checked (paid sources off)' }, { k: 'answers', state: 'empty', done: 'not checked' }, [], [{ finding: { src: 'not asked' } }]);
  assert.equal(noSaved.empty, true); assert.equal(noSaved.done, 'not checked (paid sources off)', 'an error stays an error');
});

test('the client: "need your yes" is one rule on the ranked feed, not on the list a view last painted; the Build tab counts the playbook', () => {
  const app = fs.readFileSync(path.join(REPO, 'public/app.js'), 'utf8');
  assert.match(app, /const gLists = \(\) => \{ const vis = todayOf\(RANKED\);/, 'the tiles read the ranked feed');
  assert.match(app, /yes: yesOf\(RANKED\)/);
  assert.match(app, /const yes = yesOf\(all\)\.length;/, 'the setup preview uses the same rule');
  assert.doesNotMatch(app, /Math\.max\(yes, 1\)/, 'no padded minimum');
  assert.doesNotMatch(app, /\/51`/, 'no hard-coded 51 moves');
  assert.match(app, /RANKED = FEED\.slice\(\); return r;/, 'only loadFeed sets the ranked feed');
});
