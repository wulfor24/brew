// Audit fixes (build, refresh, fact gate, cadence numbering): each test runs free, with mocks and a temp pack store.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.REFRESH_AUTO = '0'; delete process.env.PAGESPEED_API_KEY; delete process.env.BUILD_CAP_USD; delete process.env.DAILY_BUILD_CAP_USD;
const { createBuilder, mergeProfile, hasData, isCore, removedKeys, storeOpened, clientIp } = await import('../build.js');
const { createPacks } = await import('../brand-pack.js');
const { numbersIn, canon, allowedFrom, unbacked, backedNumbers } = await import('../fact-gate.js');
const { createCardsGen } = await import('../cards-gen.js');
const { createMovesEngine } = await import('../moves-engine.js');
const { nextNumbers } = await import('../moves-cadence.js');
const { candidates } = await import('../refresh.js');
const { quoteIsReal } = await import('../brief.js');
const { blankProfile } = await import('../reader/index.js');

const quiet = { log() {}, warn() {}, error() {} };
const tmpPacks = () => { const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-audit-')); return { ROOT, P: createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet }) }; };
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timed out'); };
const mockAI = () => { const fs0 = []; return { onCharge: (f) => fs0.push(f), charge: (usd) => fs0.forEach((f) => f('t', usd)), call: async () => { throw Object.assign(new Error('mock'), { mock: true }); } }; };
const unread = (url) => ({ opened: false, profile: blankProfile(new URL(url), 'x'), ledger: [], findings: { steps: [{ k: 'open', state: 'empty', done: 'could not open the store' }], cards: [] } });
function builderWith(P, { reader, brief, moves, ai = mockAI(), caps } = {}) {
  const calls = { read: [], brief: 0, runAll: 0 };
  const modules = {
    reader: { createReader: () => ({ read: async (url, o) => { calls.read.push(o); return reader(url, o, ai); } }) },
    brief: { createBrief: () => ({ write: async () => { calls.brief++; return brief ? brief() : { json: { name: 'X' }, md: '# X brief' }; } }) },
    moves: { SPECS: [], createMovesEngine: () => ({ runAll: async (ctx) => { calls.runAll++; return moves ? moves(ctx) : { moves: {}, errors: [] }; } }) },
    pdf: null };
  const b = createBuilder({ ROOT: P.ROOT, packs: P, ai, treg: { onCharge() {} }, log: quiet, caps, modules });
  return { b, calls, ai };
}

/* 1 */
test('refresh: a section or social the read returned blank keeps the old data; real new data replaces it', () => {
  const old = { name: 'Acme', catalog: { products: [{ handle: 'a', title: 'A' }] }, reviews: { total: 812, platforms: [{ name: 'Judge.me' }], quotes: [{ text: 'Lovely fit' }] },
    ai: { score: 40, answers: [{ q: 'best shoe' }], questions: ['q'] }, site: { pages: 120, checkout: { steps: 3 }, sitemaps: ['s'] }, ads: { own: { page: 'Acme', live: 4 }, rivals: [] },
    socials: { instagram: { handle: 'acme' }, youtube: { url: 'https://youtube.com/@acme' }, facebook: { url: 'https://fb.com/acme' } }, rivals: [{ name: 'R', host: 'r.com', why: 'w' }] };
  const blank = blankProfile(new URL('https://acme.com'), 'acme-com');
  assert.equal(hasData(blank.reviews), false); assert.equal(hasData(blank.socials), false);
  const p = mergeProfile(old, blank);
  assert.equal(p.reviews.total, 812); assert.equal(p.ai.score, 40); assert.equal(p.site.pages, 120); assert.equal(p.ads.own.live, 4);
  assert.equal(p.socials.youtube.url, 'https://youtube.com/@acme'); assert.equal(p.socials.facebook.url, 'https://fb.com/acme');
  assert.deepEqual(p.catalog.products.map((x) => x.handle), ['a'], 'an empty catalog read keeps the catalog');
  const fresh = { ...blank, reviews: { ...blank.reviews, total: 900 }, socials: { ...blank.socials, youtube: { url: 'https://youtube.com/@acme2' } }, ai: { ...blank.ai, score: 55 } };
  const q = mergeProfile(old, fresh);
  assert.equal(q.reviews.total, 900); assert.equal(q.reviews.quotes[0].text, 'Lovely fit', 'quotes the read did not return stay');
  assert.equal(q.socials.youtube.url, 'https://youtube.com/@acme2'); assert.equal(q.socials.facebook.url, 'https://fb.com/acme'); assert.equal(q.ai.score, 55);
});

/* 2 */
test('fact gate: every printed currency, multipliers and large counts are gated; equal amounts match however written', () => {
  assert.deepEqual(numbersIn('AED 120 off, Rs 499, ¥3000, 15 %'), ['aed120', '₹499', '¥3000', '15%']);
  assert.deepEqual(numbersIn('12,000 customers, 3x ROAS, 5k followers, since 2019, 18 ads', { strict: true }), ['12000', '3x', '5000']);
  assert.equal(canon('Rs. 4,299'), canon('₹4299.00')); assert.equal(canon('₹2 lakh'), canon('₹2,00,000')); assert.equal(canon('$1.5M'), canon('USD 1,500,000'));
  const ok = allowedFrom({ p: { v: '₹4,299', n: 4299 }, r: { v: '5,069 reviews', n: 5069 } });
  assert.equal(unbacked({ title: 'Rs 4,299 for the pair', sub: '5069 reviews say so' }, ok, { strict: true }).length, 0, 'real numbers written another way still pass');
  assert.deepEqual(unbacked({ title: 'AED 99 off', sub: '12,000 happy customers', make: { pieces: 'a 3x ROAS carousel' } }, ok, { strict: true }).map((b) => b.n), ['aed99', '12000', '3x']);
  const back = backedNumbers({ sections: [{ blocks: [{ text: 'The pair sells at ₹4,299 on the site. We target ₹6,000 a day. Repeat rate is 27% (to confirm).' }] }] });
  assert.ok(back.has('₹4299')); assert.ok(!back.has('₹6000'), 'a target is not a fact'); assert.ok(!back.has('27%'), 'a to-confirm number is not a fact');
});

test('fact gate in cards-gen: a card quoting a to-confirm or target number is dropped; one backed by the ledger ships; make.pieces is checked', async () => {
  const cards = [
    { type: 'report', title: 'Repeat rate is 27%', sub: 'Repeat buyers are 27% of orders. Fix the second-pair flow to lift it.', why: ['a'], how: ['b'], rows: [], cta: 'Open the scoreboard' },
    { type: 'report', title: '5,069 reviews back the comfort claim', sub: 'Customers wrote 5,069 reviews. Put the comfort line on the product page.', why: ['a'], how: ['b'], rows: [], cta: 'Open the scoreboard' },
    { type: 'idea', title: 'Make the fit carousel', sub: 'The fit page converts. Make a six-slide carousel for it.', why: ['a'], how: ['b'], rows: [], cta: 'Open the scoreboard', make: { format: 'carousel ad', pieces: '6 slides for a 4x ROAS' } }];
  const ai = { call: async () => ({ json: { label: { short: 's', line: 'l' }, cards } }) };
  const move = { n: 7, title: 'T', gives: 'g', live: 'l', sections: [{ h: 'Why', blocks: [{ text: 'Repeat buyers are 27% of orders (to confirm).' }] }] };
  const r = await createCardsGen({ ai, log: quiet }).fromMove(move, { brand: { name: 'Acme', host: 'acme.com' }, facts: {}, lanes: { core: {} }, laneImg: {}, ledger: [{ key: 'reviews.total', v: '5,069', n: 5069, layer: 'observed' }] });
  assert.deepEqual(r.cards.map((c) => c.title), ['5,069 reviews back the comfort claim']);
});

/* 3 */
test('daily cap: read by date (yesterday’s spend never blocks today), kept across a restart, and refused when today’s is used', async (t) => {
  const { P } = tmpPacks();
  const now = Date.parse('2026-10-14T10:00:00Z'); t.mock.timers.enable({ apis: ['Date'], now });
  await P.put('_brew', 'spend-day.json', { d: '2026-10-13', usd: 999 });
  const { b } = builderWith(P, { reader: (url) => unread(url), caps: { day: 200 } });
  const r1 = await b.start('https://one-example.com', { ip: '1.1.1.1' }); assert.ok(r1.slug, 'yesterday’s spend does not block today');
  await P.put('_brew', 'spend-day.json', { d: '2026-10-14', usd: 250 });
  const { b: b2 } = builderWith(P, { reader: (url) => unread(url), caps: { day: 200 } });
  assert.match((await b2.start('https://two-example.com', { ip: '2.2.2.2' })).error, /budget is used up/, 'a restart keeps today’s spend');
  t.mock.timers.setTime(now + 864e5);
  assert.equal(b2.spentToday(), 0, 'the next day starts at zero without any new spend');
  assert.ok((await b2.start('https://two-example.com', { ip: '2.2.2.2' })).slug);
  t.mock.timers.reset();
});

/* 4 */
test('move numbers: cadence moves get 1001+, the build counts only 00-50, the engine never takes a cadence slot, refresh skips cadence moves', async () => {
  assert.deepEqual(nextNumbers({ 51: { meta: { cadence: true } } }, { nextN: 63 }, 1), [1001]);
  assert.ok(isCore(0) && isCore(50) && !isCore(51) && !isCore(1001));
  const saved = [], ai = { call: async () => { throw Object.assign(new Error('mock'), { mock: true }); } };
  const cad = { n: 58, title: 'Cadence', meta: { cadence: true }, sections: [] };
  const core = Object.fromEntries([...Array(50).keys()].map((i) => [i + 1, { n: i + 1, title: 'm' + (i + 1), sections: [], meta: {} }]));
  const ctx = { brand: { name: 'Acme' }, brief: { md: '# brief' }, profile: { name: 'Acme', host: 'acme.com' }, ledger: [{ key: 'search.terms', v: 'x' }, { key: 'ai.score', v: '1' }],
    signalLines: [{ key: 'listen.x', v: '1', family: 'listening', signal: true }], dynamicSpecs: [], load: (n) => (n === 58 ? cad : core[n] || null), save: async (n) => saved.push(n) };
  await createMovesEngine({ ai, log: quiet }).runAll(ctx, { verify: false, dynamic: false });
  assert.ok(!saved.includes(58), 'the cadence move at 58 is not overwritten'); assert.ok(saved.some((n) => n > 50 && n !== 58), 'other applicable listening-era specs are written');
  const cand = candidates([{ kind: 'changed', key: 'price.a', area: 'price', label: 'A price', was: '₹100', now: '₹120' }], { 58: cad, 5: { sections: [] } }, [{ n: 58, evidence: ['price'] }, { n: 5, evidence: ['price'] }]);
  assert.deepEqual(Object.keys(cand), ['5']);
});

/* 5 */
test('a store that does not open stops before the brief and the moves, with a plain reason and no more spend', async () => {
  const { P } = tmpPacks(); const { b, calls } = builderWith(P, { reader: (url) => unread(url) });
  const r = await b.start('https://down-example.com', { ip: '3.3.3.3' });
  const s = await until(async () => { const x = await b.status(r.slug); return x?.unreadable && !(await b.buildInfo(r.slug)).running ? x : null; });
  assert.match(s.state, /could not open down-example\.com/); assert.equal(s.error, 'store did not open'); assert.equal(s.stages.read.state, 'failed');
  assert.equal(calls.brief, 0); assert.equal(calls.runAll, 0); assert.equal(await P.getJSON(r.slug, 'profile.json'), null, 'nothing saved, so a retry reads again');
  assert.equal(storeOpened({ opened: true, findings: { steps: [{ k: 'open', state: 'done' }] } }), true);
});

/* 10 */
test('a confirmation made before the build reaches "Check what we read" is honoured (no 15-minute wait)', async () => {
  const { P } = tmpPacks(); const slug = 'early-example-com';
  await P.put(slug, 'seed.json', { brand: { name: 'Early', host: 'early-example.com' }, lanes: { core: { name: 'Core' } }, posts: [] });
  await P.put(slug, 'profile.json', { name: 'Early', host: 'early-example.com', url: 'https://early-example.com', catalog: { products: [] }, reviews: {}, rivals: [] });
  await P.put(slug, 'ledger.json', []); await P.put(slug, 'findings.json', { steps: [], cards: [] });
  await P.put(slug, 'status.json', { slug, host: 'early-example.com', url: 'https://early-example.com', name: 'Early', stages: { read: { state: 'done' } } });
  const { b, calls } = builderWith(P, { reader: () => { throw new Error('not called'); } });
  assert.equal((await b.confirm(slug, [])).ok, true);
  await b.resume(slug);
  assert.equal(calls.brief, 1, 'the brief was written straight away'); assert.equal((await b.status(slug)).stages.confirm.state, 'done');
});

/* 12 */
test('a fresh restart archives the last run, reads again with fresh data, rebuilds every stage and lifts a stop', async () => {
  const { ROOT, P } = tmpPacks(); const slug = 'again-example-com';
  await P.put(slug, 'seed.json', { brand: { name: 'Again' }, lanes: {}, posts: [{ id: 'm01-1' }] });
  await P.put(slug, 'profile.json', { name: 'Again' }); await P.put(slug, 'ledger.json', [{ key: 'price.a', v: '₹1' }]); await P.put(slug, 'brief.json', { name: 'Again' }); await P.put(slug, 'brief.md', '# old');
  await P.put(slug, 'moves.json', { 0: { n: 0 }, 1: { n: 1 }, 51: { n: 51, meta: { cadence: true } } }); await P.put(slug, 'cancel.json', { cancelled: true });
  await P.put(slug, 'status.json', { slug, host: 'again-example.com', url: 'https://again-example.com', name: 'Again', done: true, cancelled: true, stages: { confirm: { state: 'done' }, brief: { state: 'done' } }, pdfs: { 1: 'x.pdf' }, movesDone: 51, confirmedAt: 1 });
  const { b, calls } = builderWith(P, { reader: (url) => unread(url) });
  assert.match((await b.start('https://again-example.com', { ip: '4.4.4.4' })).error, /stopped/, 'without fresh a stopped brand stays stopped');
  const r = await b.start('https://again-example.com', { ip: '4.4.4.4', fresh: true });
  assert.equal(r.slug, slug); await until(async () => calls.read.length && !(await b.buildInfo(slug)).running);
  assert.equal(calls.read[0].fresh, true, 'the read skips the same-day cache');
  assert.equal(await P.getJSON(slug, 'brief.json'), null); assert.deepEqual(Object.keys(await P.getJSON(slug, 'moves.json', {})), ['51'], 'build moves cleared, cadence moves kept');
  assert.equal((await P.getJSON(slug, 'cancel.json')).cancelled, false);
  const s = await b.status(slug); assert.equal(s.cancelled, null); assert.equal(s.stages.confirm, undefined); assert.equal(s.pdfs, undefined); assert.equal(s.confirmedAt, undefined);
  const arch = fs.readdirSync(path.join(ROOT, '.brands', slug, 'archive')); assert.equal(arch.length, 1);
  assert.ok(fs.existsSync(path.join(ROOT, '.brands', slug, 'archive', arch[0], 'brief.json')));
});

test('removed products leave the evidence; quotes must be real; the client address is the one the front end appended', () => {
  const gone = removedKeys(['gift-card']);
  assert.ok(gone({ key: 'price.gift-card' }) && gone({ key: 'mrp.gift-card' }) && !gone({ key: 'price.shoe' }) && !gone({ key: 'claim.gift-card' }));
  const reviews = ['Lovely fit, I wear them every day and my feet never hurt', 'great', '😍😍'];
  assert.equal(quoteIsReal('I wear them every day and my feet never hurt', reviews), true);
  assert.equal(quoteIsReal('great', reviews), true, 'a short review quoted whole');
  assert.equal(quoteIsReal('Great shoes, they changed my life in two weeks', reviews), false, 'a short real review does not vouch for an invented one');
  assert.equal(quoteIsReal('Totally invented praise for the brand', ['😍']), false, 'an emoji-only review matches nothing');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' } }), '9.9.9.9');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 9.9.9.9, 35.1.1.1' } }, 1), '9.9.9.9');
});
