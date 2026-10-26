// The read/build pipeline never saves a placeholder or a failure as a fact (2026-10-17): a Vertex billing pause records moves
// as failed instead of writing "[MOCK]" ones, a failed reviews/ads/socials stage reads "couldn't check" (never "none"), and the
// AI-written brief never shows "null". Generic: no brand names in the rules. No network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.REFRESH_AUTO = '0'; process.env.DEMO_MODE = '';
const { mockAllowed, billingError } = await import('../ai.js');
const { createMovesEngine } = await import('../moves-engine.js');
const { createCardsGen, readSrc } = await import('../cards-gen.js');
const { createBuilder } = await import('../build.js');
const { createPacks } = await import('../brand-pack.js');
const { createReader } = await import('../reader/index.js');
const { ADS_V } = await import('../reader/stages/ads.js');
const N = await import('../pack-numbers.js');
const { healthFrom } = await import('../health.js');
const { cleanBrief, renderBrief } = await import('../brief.js');
const { aboutOf, configFromProfile } = await import('../derive.js');

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const tmpPacks = () => { const ROOT = tmp('brew-honest-'); return createPacks({ ROOT, PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet }); };
const withEnv = async (k, v, fn) => { const was = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; try { return await fn(); } finally { if (was == null) delete process.env[k]; else process.env[k] = was; } };
const aiThrowing = (mk) => ({ onCharge() {}, call: async () => { throw mk(); } });
const mockErr = () => Object.assign(new Error('AI is off (mock)'), { mock: true });

/* 1 */
test('a billing pause never becomes a [MOCK] move, card or brief; a mock stands in only on a mock run', async () => {
  await withEnv('AI_MOCK', '1', () => { assert.equal(mockAllowed(mockErr()), true); assert.equal(mockAllowed(billingError()), false, 'a billing pause is never a mock'); });
  await withEnv('AI_MOCK', null, () => { assert.equal(mockAllowed(mockErr()), false, 'the live site never writes a mock'); assert.equal(mockAllowed(billingError()), false); });
  const ctx = { brand: { name: 'Acme', host: 'acme.in' }, brief: { md: '# Acme brief' }, profile: { name: 'Acme', host: 'acme.in', country: 'IN' }, ledger: [] };
  await assert.rejects(createMovesEngine({ ai: aiThrowing(billingError), log: quiet }).writeMove(1, ctx), (e) => e.billing === true, 'the move fails (onFail) instead of saving a mock');
  await withEnv('AI_MOCK', null, () => assert.rejects(createMovesEngine({ ai: aiThrowing(mockErr), log: quiet }).writeMove(1, ctx), /mock/));
  await withEnv('AI_MOCK', '1', async () => { const m = await createMovesEngine({ ai: aiThrowing(mockErr), log: quiet }).writeMove(1, ctx); assert.equal(m.meta.mock, true); });
  const gen = createCardsGen({ ai: aiThrowing(billingError), log: quiet });
  await assert.rejects(gen.fromMove({ n: 3, title: 'T', gives: 'g', live: 'l', sections: [] }, { brand: { name: 'Acme', host: 'acme.in' }, facts: {}, lanes: {}, laneImg: {} }), (e) => e.billing);
  await assert.rejects(gen.fromRead({ name: 'Acme', host: 'acme.in' }, { brand: { name: 'Acme', host: 'acme.in' }, facts: {}, lanes: {}, laneImg: {} }), (e) => e.billing);
});

/* the build with stand-in modules: the read is on file and checked, so it goes straight to the brief and the moves */
async function builtBrand(P, slug, { brief, moves }) {
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [] });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.in', slug, url: 'https://acme.in', catalog: { products: [] }, reviews: {}, rivals: [], meta: { readAt: '2026-10-16T08:00:00Z' } });
  await P.put(slug, 'ledger.json', []); await P.put(slug, 'findings.json', { steps: [], cards: [] });
  await P.put(slug, 'status.json', { slug, host: 'acme.in', url: 'https://acme.in', name: 'Acme', confirmedAt: 1, stages: { read: { state: 'done' }, confirm: { state: 'done' } }, error: 'an old failure' });
  const calls = { runAll: 0 };
  const modules = { reader: { createReader: () => ({ read: async () => { throw new Error('not called'); } }) },
    brief: { createBrief: () => ({ write: async () => brief() }) },
    moves: { SPECS: [], createMovesEngine: () => ({ runAll: async (ctx) => { calls.runAll++; return moves(ctx, calls.runAll); } }) }, pdf: null };
  const b = createBuilder({ ROOT: P.dirOf ? path.dirname(P.dirOf(slug)) : tmp('x'), packs: P, ai: { onCharge() {}, call: async () => { throw mockErr(); } }, treg: { onCharge() {} }, log: quiet, modules });
  return { b, calls };
}

/* 3 */
test('moves still missing after the second pass leave the brand unfinished with a retry note, and a later run finishes it', async () => {
  const P = tmpPacks(), slug = 'acme-in';
  let save = false;
  const { b, calls } = await builtBrand(P, slug, { brief: () => ({ json: { name: 'Acme' }, md: '# Acme brief' }),
    moves: async (ctx) => { if (save) { await ctx.save(1, { n: 1, title: 'One', meta: {} }); await ctx.save(2, { n: 2, title: 'Two', meta: {} }); } return { moves: {}, errors: [], applicable: [1, 2] }; } });
  await b.resume(slug);
  let s = await b.status(slug);
  assert.equal(calls.runAll, 2, 'one more pass for the missing moves');
  assert.notEqual(s.done, true, 'never "Ready" with moves missing'); assert.equal(s.retryMoves, 2); assert.match(s.state, /^2 plays still to write; we retry within the hour/);
  assert.equal(s.error, null, 'a new run clears the last error');
  save = true; await b.resume(slug); s = await b.status(slug);
  assert.equal(s.done, true); assert.equal(s.retryMoves, null); assert.equal(s.state, 'Ready');
});

test('the AI paused for credit while writing the brief: a pause the hourly tick resumes, never "Stopped" with an error', async () => {
  const P = tmpPacks(), slug = 'paused-example-com';
  const { b } = await builtBrand(P, slug, { brief: () => { throw billingError(); }, moves: () => ({ moves: {}, errors: [], applicable: [] }) });
  await b.resume(slug);
  const s = await b.status(slug);
  assert.match(s.state, /AI is paused/); assert.ok(!s.error, 'no error: the brand stays listed and resumable'); assert.ok(s.aiPausedAt); assert.notEqual(s.done, true);
});

/* 2a */
test('a reviews stage that failed or timed out is an error everywhere, never "No reviews found" or 0 of 15', async () => {
  const profile = { name: 'Acme', host: 'acme.in', catalog: { products: [{ handle: 'a', images: ['1', '2'] }] }, reviews: { platforms: [], total: null, quotes: [] },
    ads: { own: { page: 'Acme', live: 12, items: [] }, rivals: [], at: '2026-10-16' }, site: { pagespeed: { score: 70, at: '2026-10-16' } }, meta: { errors: { reviews: 'reviews timed out after 75s' } } };
  const x = N.numbersOf({ profile });
  assert.equal(x.reviews.n, null); assert.match(x.reviews.error, /timed out/);
  const st = healthFrom(profile).rings.find((r) => r.k === 'Storefront');
  assert.ok(!st.parts.some((p) => p.k === 'Reviews on the site'), 'the part is left out, never scored 0');
  assert.match(st.what, /reviews couldn’t be read this time/);
  /* a read that truly found none still says so */
  const none = healthFrom({ ...profile, meta: {} }).rings.find((r) => r.k === 'Storefront');
  assert.equal(none.parts.find((p) => p.k === 'Reviews on the site').note, 'no reviews on the site');
});

test('the check page says "Couldn’t check this time" for a failed reviews, ads or socials stage', async () => {
  const P = tmpPacks(), slug = 'acme-in';
  const { b } = await builtBrand(P, slug, { brief: () => ({ json: {}, md: '' }), moves: () => ({ moves: {}, errors: [], applicable: [] }) });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.in', slug, url: 'https://acme.in', catalog: { products: [] }, reviews: { platforms: [], total: null }, ads: { own: null, rivals: [] }, socials: { instagram: null }, rivals: [],
    meta: { errors: { reviews: 'timed out', ads: 'ads timed out', socials: 'socials failed' } } });
  const d = await b.checkData(slug, { heal: false });
  const v = (k) => d.sources.find((x) => x.key === k).v;
  assert.equal(v('reviews'), 'Couldn’t check this time'); assert.equal(v('adpage'), 'Couldn’t check this time'); assert.equal(v('instagram'), 'Couldn’t check this time');
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.in', slug, url: 'https://acme.in', catalog: { products: [] }, reviews: { platforms: [], total: null }, ads: { own: { page: null, live: null }, rivals: [] }, socials: { instagram: null }, rivals: [], meta: { errors: {} } });
  const d2 = await b.checkData(slug, { heal: false });
  assert.equal(d2.sources.find((x) => x.key === 'reviews').v, 'No reviews found', 'a stage that ran and found none says so');
});

test('heal runs a stage recorded as failed again, once a day per stage', async () => {
  const root = tmp('brew-heal-');
  const reader = createReader({ root, log: quiet });
  const saved = { url: 'http://127.0.0.1:9/', host: 'acme.test', slug: 'acme-test', name: 'Acme', descriptorBy: 'brand', catalog: { products: [], hero: [] },
    reviews: { platforms: [], total: null, quotes: [] }, ads: { own: { page: 'Acme', live: 3, items: [] }, rivals: [], v: ADS_V }, rivals: [],
    ai: { questionsBy: 'ai', answers: [{ tool: 'chatgpt', q: 'q', named: false }] }, meta: { errors: { reviews: 'reviews timed out' } } };
  const out = await reader.heal(saved, { findings: { steps: [{ k: 'reviews', state: 'empty', done: 'could not finish (timed out)' }], cards: [] }, log: quiet });
  assert.ok(out, 'something healed'); assert.ok(out.changed.includes('reviews'));
  assert.equal(out.profile.meta.errors.reviews, undefined, 'the stage ran, so its error is gone'); assert.ok(out.profile.meta.healTried.reviews);
  assert.equal(out.findings.steps.find((s) => s.k === 'reviews').done, 'no reviews found', 'the step now says what the stage found');
  /* failed again today: the stamp holds it for a day */
  const again = await reader.heal({ ...out.profile, meta: { ...out.profile.meta, errors: { reviews: 'failed again' } } }, { log: quiet });
  assert.equal(again, null);
});

/* 2c */
test('every AI-answer tool errored: the read keeps the error, so the ring says it couldn’t be read', async () => {
  const { answers } = await import('../reader/stages/answers.js');
  const profile = { name: 'Acme', host: 'acme.in', country: 'IN', catalog: { products: [], hero: [] }, meta: { errors: {} } };
  const ctx = { profile, ledger: { add() {} }, tregOn: true, aiOn: false, today: '2026-10-16', log: quiet, prev: { ai: { questionsBy: 'ai', questions: ['a', 'b', 'c', 'd', 'e', 'f'], answers: [] } },
    tick() {}, finding() {}, done() {}, dfs: async () => { throw new Error('treg 402'); } };
  await answers(ctx);
  assert.match(profile.meta.errors.answers, /treg 402/);
  const ring = healthFrom(profile).rings.find((r) => r.k === 'AI answers');
  assert.equal(ring.read, false); assert.match(ring.what, /couldn’t be read/);
});

/* 7 */
test('the brief never says "null": cleaned on save and on read; config.about reads like a sentence and heals at load', async () => {
  const { brief, changed } = cleanBrief({ name: 'Acme', catalogue: [{ name: 'Tee', price: '₹999', mrp: 'null', note: 'undefined', k: 'price.tee' }, { name: 'Cap', price: null, mrp: '', note: 'New', k: '' }], claims: [{ product: 'null', claim: 'Soft', basis: 'site', k: '' }], platforms: [] });
  assert.equal(changed, true); assert.deepEqual(brief.catalogue[0], { name: 'Tee', price: '₹999', mrp: '', note: '', k: 'price.tee' }); assert.equal(brief.catalogue[1].price, ''); assert.equal(brief.claims[0].product, '');
  assert.equal(cleanBrief(brief).changed, false);
  const md = renderBrief({ name: 'Acme', descriptor: '', oneLine: 'x', businessModel: 'D2C', catalogue: [{ name: 'Tee', price: '₹999', mrp: 'null', note: '', k: '' }], claims: [], platforms: [], quotes: [], channels: [], company: [], personas: [], objections: [], rivals: [], gaps: [], language: [], praise: [], complaints: [], toConfirm: [] }, '2026-10-16');
  assert.doesNotMatch(md, /\bnull\b/);
  /* a saved brief heals on the build's next run (brief.json and brief.md) */
  const P = tmpPacks(), slug = 'acme-in';
  const { b } = await builtBrand(P, slug, { brief: () => { throw new Error('not written again'); }, moves: () => ({ moves: {}, errors: [], applicable: [] }) });
  await P.put(slug, 'brief.json', { name: 'Acme', at: '2026-10-16', oneLine: 'x', businessModel: 'D2C', catalogue: [{ name: 'Tee', price: '₹999', mrp: 'null', note: 'null', k: '' }], claims: [], platforms: [], quotes: [], channels: [], company: [], personas: [], objections: [], rivals: [], gaps: [], language: [], praise: [], complaints: [], toConfirm: [] });
  await P.put(slug, 'brief.md', '| Tee | ₹999 | null | null | |');
  await b.resume(slug);
  assert.equal((await P.getJSON(slug, 'brief.json')).catalogue[0].mrp, '');
  assert.doesNotMatch((await P.get(slug, 'brief.md')).toString('utf8'), /\bnull\b/);
  /* about: the brand's own words first, else the hero products with the right article, never the first three catalog rows */
  const prods = [{ handle: 'laces', title: 'Green Laces for Women', price: 199 }, { handle: 'jacket', title: 'Field Jacket – Olive', price: 4999, reviews: { count: 80 } }, { handle: 'tee', title: 'Heavy Tee', price: 1499 }];
  assert.equal(aboutOf({ category: 'Apparel', catalog: { products: prods, hero: ['jacket', 'tee'] } }), 'an Apparel brand selling Field Jacket, Heavy Tee');
  assert.equal(aboutOf({ category: 'Beauty', catalog: { products: prods, hero: [] } }), 'a Beauty brand selling Field Jacket, Heavy Tee, Green Laces for Women');
  assert.equal(aboutOf({ category: 'Apparel', descriptor: 'Workwear for city cyclists', catalog: { products: prods } }), 'Workwear for city cyclists');
  assert.equal(configFromProfile({ category: 'Apparel', tagline: 'Heavyweight basics, made to last', catalog: { products: prods } }).about, 'Heavyweight basics, made to last');
});

test('a live pack loads without simulated accounts, heals the old about line, and dates its read cards', async () => {
  const P = tmpPacks(), slug = 'acme-in';
  await P.put(slug, 'status.json', { name: 'Acme', host: 'acme.in', done: true, ready: true, stages: { read: { state: 'done', at: Date.parse('2026-10-16T08:00:00Z') } } });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.in', slug, url: 'https://acme.in', category: 'Apparel', descriptor: 'Workwear for city cyclists', catalog: { products: [{ handle: 'a', title: 'Green Laces for Women' }] }, meta: { readAt: '2026-10-16T08:00:00Z' } });
  await P.put(slug, 'config.json', { about: 'a Apparel brand selling Green Laces for Women, Blue Laces, Red Laces' });
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in' }, lanes: { core: { name: 'Core', line: 'x' } }, connectors: { meta: { name: 'Meta Ads' } },
    posts: [{ id: 'read-1', origin: 'read', title: 'A finding', sub: 's', src: 'Read from acme.in today', kind: 'rows', rows: [] },
      { id: 'statics-batch', title: '8 ads', sub: 'Each one puts a real Acme product photo in a new scene. Keep the ones you like and they go out together as one test.', detail: { how: ['Queue the kept ones as one test.'] }, cta: { label: 'Queue the ads' }, kind: 'rows', rows: [] }] });
  const pk = await P.load(slug, { fresh: true });
  assert.equal(pk.demo, null, 'no simulated accounts on the live site');
  assert.equal(fs.existsSync(path.join(P.dirOf(slug), 'demo.json')), false, 'no demo.json written');
  assert.ok(!pk.seed.posts.some((c) => c.demo || /^demo-/.test(c.id)), 'no simulated cards in the feed');
  assert.equal((await P.getJSON(slug, 'config.json')).about, 'Workwear for city cyclists');
  assert.equal(pk.seed.posts.find((c) => c.id === 'read-1').src, 'Read from acme.in on 16 Oct');
  const batch = pk.seed.posts.find((c) => c.id === 'statics-batch');
  assert.equal(batch.cta.label, 'Open the batch'); assert.doesNotMatch(batch.sub, /go out together/); assert.match(batch.detail.how[0], /Download/);
  assert.equal(readSrc('acme.in', '2026-10-16T08:00:00Z'), 'Read from acme.in on 16 Oct');
});
