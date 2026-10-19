// QA sheet fixes (FEED-QA, TRU, ONB, ACC, MOB, FEED-NOT): every rule here holds for every brand, card and view. No network,
// no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const { pageOf, privacyPage, termsPage, notFoundPage } = await import('../legal-pages.js');

/* ---------- FEED-QA-01: a real 404 ---------- */
test('FEED-QA-01: unknown pages and unknown /api paths are real 404s; the landing, brand pages and legal pages still open', () => {
  assert.deepEqual(pageOf('/'), { kind: 'landing' });
  assert.deepEqual(pageOf('/index.html'), { kind: 'landing' });
  assert.deepEqual(pageOf('/arata-in'), { kind: 'slug', slug: 'arata-in' });
  assert.deepEqual(pageOf('/arata-in/'), { kind: 'slug', slug: 'arata-in' });
  assert.deepEqual(pageOf('/Arata-In'), { kind: 'slug', slug: 'arata-in', redirect: true });
  assert.deepEqual(pageOf('/api/nope'), { kind: 'api' });
  assert.deepEqual(pageOf('/api'), { kind: 'api' });
  assert.deepEqual(pageOf('/no-such-page-xyz/deeper'), { kind: 'missing' });
  assert.deepEqual(pageOf('/privacy'), { kind: 'legal', page: '/privacy' });
  assert.deepEqual(pageOf('/terms/'), { kind: 'legal', page: '/terms' });
  const s = src('server.js');
  assert.doesNotMatch(s, /\|\| \(await pageFor\(''\)\)/, 'an unknown slug never falls back to the landing');
  assert.match(s, /send\(res, 404, notFoundPage\(\)/);
  assert.match(s, /pg\.kind === 'api'\) return send\(res, 404/);
  const nf = notFoundPage(); assert.match(nf, /couldn’t find that page/); assert.match(nf, /href="\/"/);
});

/* ---------- FEED-QA-23 / TRU-01: privacy and terms ---------- */
test('FEED-QA-23: privacy and terms are plain preview pages, linked from the landing and the demo landing', () => {
  const p = privacyPage(), t = termsPage();
  for (const h of [p, t]) { assert.match(h, /Preview (policy|terms)/); assert.match(h, /hello@joinsquareup\.com/); assert.match(h, /href="\/privacy"/); assert.match(h, /href="\/terms"/); }
  assert.match(p, /read-only/); assert.match(p, /Google/); assert.match(p, /Google Cloud/); assert.match(p, /Delet/);
  assert.match(p, /reviews/); assert.match(p, /rivals/); assert.match(p, /AI assistants/);
  assert.match(src('public/app.js'), /class="ob2-legal">Preview · <a href="\/privacy">Privacy<\/a> · <a href="\/terms">Terms<\/a>/);
  assert.match(src('public/demo-picker.html'), /href="\/privacy">Privacy<\/a>/);
});

/* ---------- FEED-QA-04 / 26 / ONB-02, FEED-QA-16, FEED-QA-17: the landing field ---------- */
const appSrc = () => src('public/app.js');
const siteOf = (() => { const m = appSrc().match(/const siteOf = (\(raw\)[\s\S]*?return \{ bad: true \}; \});/); return (0, eval)(m[1]); })();
test('FEED-QA-04: the landing checks the address inline; a brand name gets one guess that only fills the field', () => {
  for (const ok of ['footshop.com', 'https://www.arata.in/collections/x', 'shop.co.uk', 'WWW.Brand.IN']) assert.equal(siteOf(ok).ok, true, ok);
  assert.deepEqual(siteOf('Footshop'), { name: true, guess: 'footshop.com' });
  assert.deepEqual(siteOf('Mama Earth'), { name: true, guess: 'mamaearth.com' });
  for (const bad of ['foo bar.com', 'http://', 'a.b', 'brand.c0m']) assert.equal(siteOf(bad).bad, true, bad);
  const a = appSrc(), go = a.slice(a.indexOf('const go = async (e)'), a.indexOf("$('#url-form').onsubmit"));
  assert.match(go, /urlErr\(r\?\.error \|\|/, 'a server refusal (bad address, the daily limit, anything) stays under the field');
  assert.doesNotMatch(go, /toast\(/, 'never a toast that is gone in 3 s');
  assert.match(go, /That doesn’t look like a website\. Try yourbrand\.com/);
  assert.match(a, /role="alert" hidden><\/p><p class="ob2-own">\$\{OWN_LINE\}/);
  assert.match(src('build.js'), /That doesn’t look like a website\. Try yourbrand\.com/);
});
test('FEED-QA-16 / 17: the landing and the check page say who may run Brew; the landing says Google sign-in only', () => {
  const a = appSrc();
  assert.match(a, /const OWN_LINE = 'Run Brew on your own store, or one you work on\. Your team claims the workspace; others only see what’s public\.'/);
  assert.match(a, /<p class="q-note">\$\{OWN_LINE\}<\/p>/);
  assert.match(a, /Sign in with Google\. Email sign-in is coming\./);
});

/* ---------- FEED-QA-05: a store that can't be read ---------- */
test('FEED-QA-05: steps that end empty (a store that did not open) wake no agent, and the error is one sentence', async () => {
  const { followRead } = await import('../feed-service.js');
  const subs = new Set(), events = [];
  const builder = { events: () => events, status: async () => ({ stages: { read: { state: 'running' } } }), subscribe: (slug, f) => { subs.add(f); return () => subs.delete(f); } };
  const sent = []; const off = followRead({ builder, slug: 'x', loadSeed: async () => null, send: (e) => sent.push(e), replayMs: 0 });
  const emit = (e) => { events.push(e); subs.forEach((f) => f(e)); };
  emit({ type: 'reader', ev: { type: 'step', k: 'open', state: 'empty', done: 'could not open the store' } });
  for (const k of ['brand', 'catalog', 'reviews', 'ads', 'site', 'answers']) emit({ type: 'reader', ev: { type: 'step', k, state: 'empty', done: 'skipped: the store did not open' } });
  emit({ type: 'status', status: { error: 'store did not open', state: 'We could not open acme.in. Check the address and try again.' } });
  off();
  assert.equal(sent.filter((e) => e.type === 'agent').length, 0, 'no agent says it has ideas');
  assert.equal(sent.filter((e) => e.type === 'step' && e.empty).length, 7);
  assert.equal(sent.find((e) => e.type === 'error')?.msg, 'We could not open acme.in. Check the address and try again.');
  /* a step that found something still wakes its agent */
  const sent2 = [], subs2 = new Set(); followRead({ builder: { ...builder, subscribe: (s, f) => { subs2.add(f); return () => {}; } }, slug: 'y', loadSeed: async () => null, send: (e) => sent2.push(e), replayMs: 0 });
  subs2.forEach((f) => f({ type: 'reader', ev: { type: 'step', k: 'catalog', state: 'done', done: '12 products' } }));
  assert.deepEqual(sent2.filter((e) => e.type === 'agent').map((e) => e.agent), ['storefront']);
  /* the page says it once: the server's sentence already tells them what to do */
  const a = appSrc(), m = a.match(/const readFail = (\(msg\) => \{[\s\S]*?\};)/), readFail = (0, eval)(m[1].replace(/;$/, ''));
  assert.equal(readFail('We could not open acme.in. Check the address and try again.'), 'We could not open acme.in. Check the address and try again.');
  assert.equal(readFail('The site timed out'), 'The site timed out. Check the address, or try again in a few minutes.');
  assert.equal(readFail(''), 'The store did not open for us. Check the address, or try again in a few minutes.');
  assert.doesNotMatch(src('public/onboard2.js'), /\$\{esc\(st\.error\)\} Check the address/);
  assert.match(a, /r\.querySelector\('\.st'\)\.textContent = 'Nothing read'/);
});

/* ---------- FEED-QA-06 / FEED-QA-13: the ready card ---------- */
test('FEED-QA-06 / 13: the ready card always shows numbers, counts cards from the loaded feed, and names both counts', () => {
  const a = appSrc(), fo = a.slice(a.indexOf('const finishOnboarding = async'), a.indexOf("$('#open-feed').onclick"));
  assert.match(fo, /if \(!rank\(\)\.length\) await Promise\.race\(\[loadFeed\(\)/, 'the feed is loaded before it is counted');
  assert.doesNotMatch(fo, /<b class="tnum">\$\{ic\(/, 'never an icon where a number goes');
  assert.match(fo, /\$\{CARDS_WORD\(n\)\}/); assert.match(fo, /\$\{MOVES_WORD\(movesInPlan\(\)\)\}/);
  const [cw, mw] = a.match(/const CARDS_WORD = (\(n\) => `[^`]+`), MOVES_WORD = (\(n\) => `[^`]+`);/).slice(1).map((x) => (0, eval)(x));
  assert.equal(cw(12), 'cards in your feed'); assert.equal(cw(1), 'card in your feed'); assert.equal(mw(51), 'moves in your plan');
  const mip = a.match(/const movesInPlan = (\(\) => \{[^}]+\});/)[1];
  const run = (BREW, w = {}) => new Function('BREW', 'window', `return (${mip})();`)(BREW, w);
  assert.equal(run(null, { MOVES_WRITTEN: 7, MOVES_TOTAL: 51 }), 7, 'before status loads: the seed’s count');
  assert.equal(run({ movesDone: 57, total: 51 }, {}), 51, 'never more than the plan');
  assert.equal(run(null, {}), 0);
  assert.match(a, /moves in your plan written\$\{etaOf\(BREW\)\}/, 'the feed’s own counter uses the same words');
});

/* ---------- ONB-15: a refresh mid-setup ---------- */
test('ONB-15: each setup step is saved per brand and a refresh resumes there (not a step back); #setup still replays', () => {
  const a = appSrc();
  assert.match(a, /const OB_AT = \{ who: \(\) => whoFor\(\), want: \(\) => wantWhat\(\), connect: \(\) => connectWhat\(\), team: \(\) => teamStep\(\) \}/);
  for (const [fn, k] of [['const whoFor', 'who'], ['const wantWhat', 'want'], ['const connectWhat', 'connect'], ['const teamStep', 'team']]) {
    const body = a.slice(a.indexOf(fn), a.indexOf(fn) + 1600); assert.match(body, new RegExp(`obAt\\('${k}'\\)`), `${fn} saves its step`); }
  assert.match(a, /S\.onboarded = true; delete S\.obStep;/, 'finishing setup forgets the step');
  assert.match(a, /else if \(GEN && !V2 && !askedSetup && OB_AT\[S\.obStep\] && !S\.onboarded\) ensureTenant\(true\)\.then\(resumeOb\)/);
  assert.match(a, /const KEY = `\$\{LSP\(\)\}demo-v1`/, 'S (and the step in it) is kept per brand');
});

/* ---------- FEED-QA-15: the write time is set once ---------- */
test('FEED-QA-15: "Brew starts writing at" is set on the first open of the check page and never moves on a revisit', async () => {
  const os = await import('node:os'), path = await import('node:path');
  process.env.BUILD_RESUME_OFF = '1'; process.env.REFRESH_AUTO = '0';
  const { createBuilder } = await import('../build.js'), { createPacks } = await import('../brand-pack.js');
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const P = createPacks({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'brew-qa-')), PUB: new URL('../public', import.meta.url).pathname, bucket: null, gToken: null, log: quiet });
  const slug = 'wait-example-com', since = Date.now() - 60e3;
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [] });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.in', slug, catalog: { products: [] } }); await P.put(slug, 'ledger.json', []);
  await P.put(slug, 'status.json', { slug, name: 'Acme', host: 'acme.in', waitingSince: since, checkOpenAt: since - 864e5, stages: { read: { state: 'done' }, confirm: { state: 'waiting', at: since } } });
  const ai = { onCharge() {}, call: async () => { throw new Error('AI is off'); } };
  const b = createBuilder({ ROOT: path.dirname(P.dirOf(slug)), packs: P, ai, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves: null, pdf: null } });
  await b.checkData(slug, { heal: false, opened: true });
  const s1 = await b.status(slug); assert.ok(s1.checkOpenAt >= since, 'a stamp from an earlier build does not count: the first open of this wait sets it');
  const first = s1.writeAt; assert.ok(first > Date.now());
  const realNow = Date.now; Date.now = () => realNow() + 5 * 60e3; /* a revisit five minutes later */
  try { await b.checkData(slug, { heal: false, opened: true }); } finally { Date.now = realNow; }
  const s2 = await b.status(slug); assert.equal(s2.writeAt, first, 'the time never moves later'); assert.equal(s2.checkOpenAt, s1.checkOpenAt);
});

/* ---------- FEED-QA-27: a store Brew can't read well says so, once ---------- */
test('FEED-QA-27: one plain note when the catalog is truly empty or the store is not Shopify; a failed or skipped read is not empty', async () => {
  const { storeNote, numbersOf, NO_CATALOG_NOTE, NOT_SHOPIFY_NOTE } = await import('../pack-numbers.js');
  const prof = (o = {}) => ({ name: 'Acme', platform: 'shopify', catalog: { products: [] }, meta: { timings: { open: 1, catalog: 2 }, errors: {} }, ...o });
  assert.equal(storeNote({ profile: prof() }), NO_CATALOG_NOTE, 'the catalog stage ran and found nothing');
  assert.equal(storeNote({ profile: prof({ platform: 'custom' }) }), NO_CATALOG_NOTE);
  assert.equal(storeNote({ profile: prof({ meta: { timings: { catalog: 2 }, errors: { catalog: 'timed out' } } }) }), null, 'a failed read is never "no catalog"');
  assert.equal(storeNote({ profile: prof({ meta: { timings: { open: 1 }, errors: {} } }) }), null, 'a catalog step that never ran says nothing');
  assert.equal(storeNote({ profile: prof({ catalog: { products: [{ handle: 'a' }] } }) }), null, 'a Shopify store with products: no note');
  assert.equal(storeNote({ profile: prof({ platform: 'woocommerce', catalog: { count: 67, products: [] } }) }), NOT_SHOPIFY_NOTE);
  assert.equal(storeNote({ profile: prof({ platform: 'unknown', catalog: { count: 9 } }) }), null);
  assert.equal(storeNote({ profile: null }), null);
  assert.equal(numbersOf({ profile: prof() }).storeNote, NO_CATALOG_NOTE, 'every screen gets it from the one count (seed and check page)');
  assert.match(NO_CATALOG_NOTE, /^Brew is built for Shopify stores today\. We couldn’t read a product catalog here, so product cards will be thin\.$/);
  assert.match(src('build.js'), /storeNote: N\.storeNote \|\| null/);
  const a = appSrc(); assert.match(a, /D\.storeNote \? `<p class="ck2-note">/); assert.match(a, /window\.BREW_NUMBERS\?\.storeNote \? `<p class="ready-note">/);
});

/* ---------- FEED-QA-30: the selling market ---------- */
test('FEED-QA-30: hreflang ties never pick a market; EU currencies, domains and the site language count; a close call is "to confirm"', async () => {
  const { sellingMarket, marketFor } = await import('../market.js');
  const eu = ['bg-bg', 'cs-cz', 'sk-sk', 'pl-pl', 'hu-hu', 'ro-ro', 'de-de', 'x-default'];
  const tie = sellingMarket({ currency: 'EUR', hreflang: eu, tld: 'com', lang: 'en' });
  assert.equal(tie.primary, null, 'a dozen hreflang regions and euro prices: no market is picked'); assert.equal(tie.toConfirm, true); assert.match(tie.why, /^to confirm/);
  assert.equal(sellingMarket({ currency: 'CZK', hreflang: eu, tld: 'com' }).primary, 'CZ', 'the currency outweighs hreflang counts');
  assert.equal(sellingMarket({ currency: 'EUR', hreflang: eu, tld: 'com', lang: 'cs' }).primary, 'CZ', 'and so does the site’s language');
  assert.equal(sellingMarket({ currency: 'PLN', tld: 'pl' }).primary, 'PL');
  assert.equal(sellingMarket({ currency: 'EUR', tld: 'com', lang: 'de' }).primary, 'DE');
  assert.equal(sellingMarket({ currency: 'CHF', tld: 'com', lang: 'de' }).primary, 'CH', 'German with francs is Switzerland');
  assert.equal(sellingMarket({ currency: 'USD', tld: 'co' }).primary, 'US', '.co is a generic name, not Colombia');
  assert.equal(sellingMarket({ currency: 'EUR', tld: 'com', rivals: ['shop.bg', 'store.bg'] }).primary, null, 'rivals never decide the market');
  /* the old rules still hold */
  assert.equal(sellingMarket({ registered: 'US', currency: 'USD', hreflang: ['en-us', 'en-gb', 'en-ca'], tld: 'com' }).primary, 'US');
  assert.equal(sellingMarket({ registered: 'IN', currency: 'INR', shipsTo: ['IN'], tld: 'in' }).primary, 'IN');
  /* a saved read that guessed BG from hreflang heals to "to confirm"; a brand answer pins it */
  const prof = { slug: 'shoe-com', host: 'shoe.com', country: 'BG', currency: 'EUR', market: { v: 1, primary: 'BG', by: 'site', conf: 'low', signals: { currency: 'EUR', hreflang: eu, tld: 'com', lang: 'en' } } };
  const r = marketFor(prof, []); assert.equal(r.market.primary, null); assert.equal(r.changed, true);
  assert.equal(marketFor(prof, [{ key: 'market.country.confirmed', v: 'CZ', method: 'brand-confirmed' }]).market.primary, 'CZ');
  const a = appSrc(); assert.match(a, /\[\[x\.v, x\.v \|\| 'To confirm'\], \.\.\.opts\]/);
  assert.match(src('build.js'), /if \(!m\.primary && m\.toConfirm\) \{ if \(!p\.country \|\| p\.market\?\.by !== 'site'\) return null;/, 'only a market the site guessed is cleared, never the brand’s or a connected account’s');
  assert.match(src('reader/stages/open.js'), /lang: lang \? String\(lang\)/);
});
test('FEED-QA-30: a saved read whose market the site only guessed heals to "to confirm" on load, without flagging moves', async () => {
  const os = await import('node:os'), path = await import('node:path');
  const { createBuilder } = await import('../build.js'), { createPacks } = await import('../brand-pack.js');
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-qa-mk-')), P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet }), slug = 'shoe-com';
  const eu = ['bg-bg', 'cs-cz', 'sk-sk', 'pl-pl', 'hu-hu', 'ro-ro', 'x-default'];
  await P.put(slug, 'status.json', { slug, name: 'Shoe', done: true, ready: true, state: 'Ready' });
  await P.put(slug, 'profile.json', { slug, name: 'Shoe', host: 'shoe.com', country: 'BG', markets: ['BG'], currency: 'EUR', catalog: { products: [] }, market: { v: 1, primary: 'BG', by: 'site', conf: 'low', signals: { currency: 'EUR', hreflang: eu, tld: 'com', lang: 'en' } } });
  await P.put(slug, 'ledger.json', [{ key: 'market.country', v: 'BG', note: 'the UK: hreflang' }]); await P.put(slug, 'config.json', { country: 'BG' });
  await P.put(slug, 'moves.json', { 1: { n: 1, title: 'Move 1', meta: { at: 'a' } } });
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {} }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves: { SPECS: [{ n: 1 }], createMovesEngine: () => ({ runAll: async () => {} }) }, pdf: null } });
  const r = await b.marketCheck(slug);
  assert.deepEqual([r.was, r.now, r.moved, r.toConfirm], ['BG', null, false, true]);
  const p = await P.getJSON(slug, 'profile.json'); assert.equal(p.country, null); assert.equal(p.market.toConfirm, true);
  assert.equal((await P.getJSON(slug, 'ledger.json')).find((e) => e.key === 'market.country'), undefined, 'no guessed market left on the fact sheet');
  assert.deepEqual(Object.keys((await P.getJSON(slug, 'updates.json', {}))?.stale || {}), [], 'nothing rewritten, nothing spent');
  assert.equal(await b.marketCheck(slug), null, 'healed once');
});

/* ---------- FEED-QA-29 / TRU-07 / ACC-12: the account menu ---------- */
test('FEED-QA-29: everyone’s account menu has Help, Privacy & terms and Delete my data (marked Dummy: the team deletes by hand)', () => {
  const l = src('public/live.js'), menu = l.slice(l.indexOf('function menu(btn)'), l.indexOf('/* ---------- the team: invite by email'));
  assert.equal((menu.match(/\$\{helpRows\(\)\}/g) || []).length, 2, 'signed in or not, whatever the role');
  assert.match(l, /href="mailto:\$\{HELLO\}\?subject=\$\{encodeURIComponent\(`Brew help\$\{GENB \? ` · \$\{brandTag\(\)\}` : ''\}`\)\}"/);
  assert.match(l, /href="\/privacy"[^>]*>Privacy<\/a> &amp; <a href="\/terms"/);
  assert.match(l, /\/\* DUMMY: "Delete my data" deletes nothing itself/);
  assert.match(l, /Delete my data <span class="dummy-tag">Dummy<\/span>/);
  assert.match(l, /Brand: \$\{GENB \? brandTag\(\) : 'none'\}\\nMy email: \$\{em\}/, 'the request names the brand slug and the person’s email');
  assert.match(src('DUMMY.md'), /\| 9 \| \*\*Delete my data\*\*/);
  assert.match(appSrc(), /\$\{acctRows\(\)\}\$\{window\.LiveConn\?\.helpRows\?\.\(\) \|\| ''\}/, 'the menu without sign-in has them too');
});

/* ---------- FEED-NOT-05: two starts of the same brand at once ---------- */
test('FEED-NOT-05: two near-simultaneous starts (two tabs, or two instances) make one paid read', async () => {
  const os = await import('node:os'), path = await import('node:path');
  process.env.BUILD_RESUME_OFF = '1'; process.env.REFRESH_AUTO = '0';
  const { createBuilder } = await import('../build.js'), { createPacks } = await import('../brand-pack.js'), { blankProfile } = await import('../reader/index.js');
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-qa-start-')), P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const reads = [];
  const make = () => createBuilder({ ROOT, packs: P, ai: { onCharge() {}, call: async () => { throw new Error('off'); } }, treg: { onCharge() {} }, log: quiet,
    modules: { reader: { createReader: () => ({ read: async (url) => { reads.push(url); await new Promise((r) => setTimeout(r, 50)); return { opened: false, profile: blankProfile(new URL(url), 'x'), ledger: [], findings: { steps: [{ k: 'open', state: 'empty', done: 'could not open the store' }], cards: [] } }; } }) }, brief: null, moves: null, pdf: null } });
  const a = make();
  /* two tabs on one instance: both answer with the same brand, one read runs */
  const [r1, r2] = await Promise.all([a.start('https://twin-example.com', { ip: '9.9.9.1' }), a.start('https://www.twin-example.com/', { ip: '9.9.9.2' })]);
  assert.equal(r1.slug, 'twin-example-com'); assert.equal(r2.slug, r1.slug); assert.ok(!r1.existing && r2.existing, 'the second joins the first');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(reads.length, 1, 'one read, not two');
  /* another instance a moment later: the marker in the pack says someone is starting it, so it joins and never resumes a second run */
  const b2 = make(); const r3 = await b2.start('https://twin-example.com', { ip: '9.9.9.3' });
  assert.deepEqual([r3.slug, r3.existing], ['twin-example-com', true]);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(reads.length, 1);
  assert.ok((await P.getJSON('twin-example-com', 'start-lock.json'))?.by, 'the marker names the instance that started it');
  /* a refusal on the first never blocks the second: each is judged on its own */
  const [e1] = await Promise.all([a.start('not a site', {})]); assert.match(e1.error, /look like a website/);
});
