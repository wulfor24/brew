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
