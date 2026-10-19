// Final QA pass 19 Oct (final-feed): the verified gaps, each rule generic for any brand, card type and view. Free: no AI, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createJamBrief } from '../jam-brief.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/* FEED-ARV-01: evidence chat in the jam room and the card chat answers from the card's refined proof */
test('jam room: "what is the evidence for this?" and "show me the proof" get the card’s proof, never the general answer or a note in the brief', async () => {
  const tags = [];
  const claudeTool = async (p, s, m, tag) => { tags.push(tag); return { answer: 'I don’t know that yet.', known: false }; };
  const JB = createJamBrief({ claudeTool, proofOf: () => 'Here’s what this card is based on.\nSaw: 4.2★, average rating (Judge.me).', cardBrief: (c) => `Card: ${c.title}`, seatLine: () => '', isMock: () => false, spend: () => true, now: () => 1, cardOf: () => ({ id: 'm3-1', title: 'Lead with reviews', sub: '' }), log: quiet });
  const R = {}, t = { cards: new Map() }, w = { id: 'wk_1', cardId: 'm3-1', title: 'Lead with reviews', thread: [], stage: 'drafting' };
  JB.routes({ on: (m, p, fn) => { R[`${m} ${p}`] = fn; }, W: () => w, say: (t0, w0, m) => w0.thread.push(m), move: () => {} });
  JB.seed(t, w); const md0 = w.doc.md, rev0 = w.doc.rev;
  for (const q of ['What’s the evidence for this?', 'show me the proof', 'where did these numbers come from']) {
    const r = await R['POST /api/work/:wid/doc/ask']({ text: q }, t, { wid: 'wk_1' });
    assert.equal(r.answered, true, q); assert.match(w.thread.at(-1).body, /^Here’s what this card is based on/, q);
  }
  assert.deepEqual(tags, [], 'no AI call'); assert.equal(w.doc.md, md0, 'the brief is untouched'); assert.equal(w.doc.rev, rev0);
});
test('card chat and studio: the evidence ask is answered before routing, and the studio reads the refined proof', () => {
  const s = src('feed-service.js');
  assert.match(s, /say\(t, w, \{ from: 'me', body \}\);\s*\n\s*if \(EVIDENCE_ASK\.test\(body\)\) \{ const pa = proofSay\(t, w\.cardId\);[^\n]*\n\s*const decision = await routeJam/, '/iterate answers the evidence ask before routeJam');
  assert.match(s, /createRemix\(\{ evidenceOf: \(t, c\) => proofOfCard\(t, c\)/, 'the studio gets the same refined proof');
  assert.match(s, /const proofOfCard = [^\n]*refineProof\(/);
});

/* move numbers: weekly and timely moves never show their number on file */
import { moveSay, moveLabel, moveNum } from '../move-label.js';
import { dejargon, plainSrc } from '../plain.js';
import { noteOk, NO_NOTE } from '../notes.js';
test('timely moves (100–999 by hash) read "Timely move"; notes, sources and the build log use the label', () => {
  assert.equal(moveLabel(966), 'Timely move'); assert.equal(moveNum(966), 'T'); assert.equal(moveLabel(7), 'Move 07'); assert.equal(moveLabel(1011), 'Weekly move 11');
  assert.equal(moveSay('move 1006'), 'Weekly move 6', 'a margin note’s eyebrow'); assert.equal(moveSay('MOVE 1006'), 'Weekly move 6');
  assert.equal(moveSay('Move 966 · Diwali gifting'), 'Timely move · Diwali gifting'); assert.equal(plainSrc('Move 432 · Loop 2: Diwali'), 'Timely move · Diwali');
  assert.equal(moveSay('Moves 05 and 966'), 'Move 05 and timely move'); assert.equal(moveSay('Move 05 · 1999 rupees'), 'Move 05 · 1999 rupees');
  assert.match(src('feed-service.js'), /rest\.note = nt\.k \? \{ \.\.\.nt, k: nt\.k === nt\.k\.toLowerCase\(\) \? moveSay\(nt\.k\)\.toLowerCase\(\) : moveSay\(nt\.k\) \}/);
  assert.doesNotMatch(src('build.js'), /from Move \$\{pad\(e\.n\)\}/);
  for (const f of ['public/app.js', 'public/jam-room.js']) assert.match(src(f), /\+n >= 100 \? 'Timely move'/, f);
});
test('a count before a singular SKU or PDP reads plural', () => {
  assert.equal(dejargon('373 of 913 SKU are live'), '373 of 913 products are live'); assert.equal(dejargon('913 PDP'), '913 product pages'); assert.equal(dejargon('1 SKU is out'), '1 product is out');
});

/* plain words: no doubled swaps, no leftover "structured", the page plumbing and "page section" */
test('search-info swaps never double up or keep "structured"; meta.json, collections.json, rich snippets and page section read plain', () => {
  assert.equal(dejargon('Add Product schema structured data'), 'Add search-friendly product info');
  assert.equal(dejargon('Deploy structured JSON-LD for every product'), 'Deploy search-friendly product info for every product');
  assert.equal(dejargon('search-friendly product info search-friendly product info on every page'), 'search-friendly product info on every page');
  assert.equal(dejargon('Read meta.json and collections.json'), 'Read your store details and your collection list');
  assert.doesNotMatch(dejargon('Win rich snippets'), /snippet/);
  assert.equal(dejargon('Page section: Traya alternative page'), 'Page: Traya alternative page');
  assert.equal(dejargon('Build the page section layout in Shopify staging'), 'Build the page layout in Shopify staging');
  assert.match(src('feed-service.js'), /why: \{ \.\.\.ev\.why, because: dejargon\(ev\.why\.because\), reasons: \(ev\.why\.reasons \|\| \[\]\)\.map\(dejargon\) \}/, 'the proof sheet’s lead line and reasons');
  assert.match(src('feed-service.js'), /moves: ev\.moves\.map\(\(m\) => \(\{ \.\.\.m, title: dejargon\(m\.title\) \}\)\)/, '"How Brew worked it out"');
});

/* FEED-QA-21: a margin note is re-checked against the card as it reads now; live status cards get none */
test('a stale count never rides on a card: "only 1 of 52 done" fails on "All 65 written"; build, lv and live cards get no note', () => {
  assert.equal(noteOk({ k: 'build', h: 'only 1 of 52 done' }, { title: 'All 65 written', sub: '' }), false);
  for (const id of ['build-moves', 'lv-meta-1', 'live-ga4']) assert.ok(NO_NOTE.test(id), id); assert.ok(!NO_NOTE.test('m21-1'));
  assert.match(src('notes.js'), /!NO_NOTE\.test\(p\.id\)/); assert.match(src('feed-service.js'), /!NO_NOTE\.test\(c\.id\) && noteOk\(nt, c0\)/);
});

/* FEED-QA-20: buttons match the card, generically, on saved cards too */
import { fitCta } from '../cards-gen.js';
test('Make our version only on rival cards; Draft the listing only about marketplaces; Queue the ads waits for something made; demo replies and photos', () => {
  const email = { title: 'Send a day-14 is-it-working email to serum buyers', sub: 'Add this check to the hair fall flow.', make: { format: 'email', pieces: '1 email at day 14' }, cta: { label: 'Make our version' } };
  assert.equal(fitCta(email).cta.label, 'Approve the flows');
  const ownAd = { title: 'Show viewers a different offer for 30 days', sub: 'Three ads answer three objections.', make: { format: 'single image ad', pieces: '3 statics' }, cta: { label: 'Make our version' } };
  assert.equal(fitCta(ownAd).cta.label, 'Make the ad');
  const rival = { title: 'Mamaearth runs a routine ad', sub: 'Their ad leads with the routine.', research: { kind: 'ad' }, make: { format: 'single image ad', pieces: '' }, cta: { label: 'Make our version' } };
  assert.equal(fitCta(rival).cta.label, 'Make our version');
  const pitch = { title: 'Pitch Purifit on a shower-kit insert swap', sub: 'Email Purifit an insert swap.', make: { format: 'email', pieces: '1 outreach email to Purifit' }, cta: { label: 'Draft the listing' } };
  assert.equal(fitCta(pitch).cta.label, 'Approve the flows');
  assert.equal(fitCta({ title: 'Fix your Amazon listing titles', sub: 'Titles miss the search words.', cta: { label: 'Draft the listing' } }).cta.label, 'Draft the listing');
  const vid = { title: 'Run 10 routine and dandruff videos', sub: 'Lead video spend with routine.', make: { format: 'video ad', pieces: '10 cuts' }, cta: { label: 'Queue the ads' } };
  assert.equal(fitCta(vid).cta.label, 'Make the video');
  assert.equal(fitCta({ title: '12 low-star reviews have no reply yet', sub: 'A calm reply reads better than silence.', cta: { label: 'Send the review ask' } }).cta.label, 'Draft the replies');
  assert.equal(fitCta({ title: 'Ask happy buyers for reviews', sub: 'Only 12 reviews so far.', cta: { label: 'Send the review ask' } }).cta.label, 'Send the review ask');
  assert.equal(fitCta({ title: '40 of your 90 marketplace listings have one or two photos', sub: 'The photos already exist.', cta: { label: 'Push the titles' } }).cta.label, 'Add the photos');
  assert.equal(fitCta({ title: 'Rewrite 5 listing titles', sub: 'Titles miss the words.', cta: { label: 'Push the titles' } }).cta.label, 'Push the titles');
});

/* FEED-ARV-05: Storefront hidden → the storefront agent is the Catalog manager wherever its name shows */
test('with Storefront off the agent signs as the Catalog manager, on the server, in saved replies and in the app', () => {
  const s = src('feed-service.js');
  assert.match(s, /Object\.defineProperty\(AGENT, 'storefront', \{ get: \(\) => \(storefrontOn\(\) \? 'Storefront manager' : 'Catalog manager'\)/);
  assert.match(s, /thread: sfWho\(w\.thread\)/, 'replies saved before heal on read');
  assert.match(src('public/app.js'), /storefront: \/\[\?&\]storefront=1\\b\/\.test\(location\.search\) \? 'Storefront manager' : 'Catalog manager'/);
});

/* FEED-ARV-10 / NOT-07: the headline decides the For line; ad-platform news gets its own line and button */
import { newsForUs, newsCta } from '../for-us.js';
test('news For lines: ad-platform news, stakes and launches each get their own line, the headline first', () => {
  const p = 'The launch comes with a new price.';
  for (const h of ['Google Ads rolls out budget priority controls', 'Meta launches Customer Lifecycle Strategy']) { assert.match(newsForUs({ h, p }, 'Arata'), /how Arata's ads can run/, h); assert.equal(newsCta({ h, p }), 'Start the tests', h); }
  assert.match(newsForUs({ h: 'HUL eyes stake in WishCare', p }, 'Arata'), /bigger player/);
  assert.match(newsForUs({ h: 'Rival opens a store in Pune', p }, 'Arata'), /compare this launch/, 'the paragraph decides only when the headline says nothing');
  assert.equal(newsCta({ h: 'X launches a serum' }), 'Turn into an idea');
  assert.match(src('feed-service.js'), /cta: \{ label: newsCta\(x\) \}/); assert.match(src('public/app.js'), /esc\(sl\.cta \|\| 'Turn into an idea'\)/);
});

/* FEED-QA-28: a trend slide with no search series never sits under the Search interest chip */
test('trend slides with no series are dropped; calendar and rising slides stay', () => {
  const s = src('feed-service.js');
  assert.match(s, /const hasSeries = \(x\) => x\.kind === 'calendar' \|\| \(x\.kind === 'rising' && x\.rising\?\.length\) \|\| \(x\.terms \|\| \[\]\)\.some\(\(term\) => tr\?\.series\?\.\[term\]\?\.values\?\.length\);/);
  assert.match(s, /const trSlides = \(tr\?\.items \|\| \[\]\)\.filter\(hasSeries\)/);
});

/* FEED-QA-10: one name for the team everywhere */
test('no "Brew deployment team" anywhere a person reads; the agreed phrase on first mention', () => {
  for (const f of ['build.js', 'moves-engine.js', 'moves-cadence.js', 'prompts/move-house.md']) assert.doesNotMatch(src(f), /Brew deployment team/, f);
  assert.match(src('build.js'), /src: 'The ShopOS team, Brew’s build crew'/);
  assert.match(src('server.js'), /const crewName = /, 'saved move docs heal on read');
  assert.match(src('feed-service.js'), /or the ShopOS team, Brew’s build crew\.`/);
  assert.match(src('public/app.js'), /<b>With the ShopOS team<\/b><small>Brew’s build crew: /);
  assert.match(src('handoff.js'), /'The ShopOS team, Brew’s build crew'/);
});

/* FEED-QA-09 (demo): the feed's count and the banner read the same fresh session */
import { createDemoRoutes, simStatus } from '../demo-routes.js';
test('demo: confirming hands the fresh session to the feed’s copy at once, so the first feed and the banner count the same', async () => {
  const D = new Map([['acme/private/demo/session.json', { flow: 'onboarding' }]]), seen = [];
  const packs = { getJSON: async (s, n, d) => D.get(`${s}/${n}`) ?? d, put: async (s, n, o) => { D.set(`${s}/${n}`, o); } };
  const routes = createDemoRoutes({ packs, builder: { status: async () => ({ total: 64, stages: {} }) }, auth: { user: () => null, isAdmin: () => false }, connectors: {}, readBody: async () => ({}), send: () => {}, loadBrand: async () => null, onSession: (slug, s) => seen.push([slug, s]), log: quiet });
  await routes({ method: 'POST', headers: {} }, {}, new URL('http://x/api/brands/acme/confirm'));
  const last = seen.at(-1); assert.equal(last[0], 'acme'); assert.ok(last[1].confirmedAt, 'the feed’s copy has the confirm');
  const st = simStatus({ total: 64, stages: {}, done: true }, last[1]); assert.equal(st.movesDone, 0); assert.equal(st.done, false, 'not "All 64 written" while the banner says 0 of 64');
  assert.match(src('server.js'), /onSession: \(slug, s\) => demoSes\(slug, s\)/);
});

/* FEED-QA-18: every health row says when it was checked */
test('Creative and AI-answers rows carry a checked date, like Storefront’s', () => {
  assert.match(src('health.js'), /parts: parts\.map\(\(\[k, v, of, note\]\) => \(\{ k, v: Math\.round\(v\), of, note, at: adsAt \}\)\), src: 'Meta Ad Library', at: adsAt \}/);
  assert.match(src('public/app.js'), /\(x\.at \|\| r\.at\) \? ` · checked \$\{esc\(fmtDay\(Date\.parse\(x\.at \|\| r\.at\)\)/, 'a row with no date of its own shows its ring’s (AI answers)');
});

/* FEED-ARV-13: the gap card's question always closes its quote */
import { gapFix } from '../ai-gap.js';
test('a long question is cut inside its quotes, never through the closing one', () => {
  const q = 'Which is the best natural onion hair oil for hair fall and dandruff that is safe for coloured hair in India?';
  for (const brand of ['Arata', 'Forest Essentials India', 'X']) { const t = gapFix({ q, brand }).title; assert.ok(t.length <= 92, t); assert.match(t, /”$/, t); assert.equal((t.match(/“/g) || []).length, 1); }
  assert.equal(gapFix({ q: 'Is Arata safe?', brand: 'Arata' }).title, 'Get Arata named when shoppers ask “Is Arata safe”');
});

/* FEED-NOT-02: the Work board and the studio say whose ad it is the way the feed does */
test('Work board tiles say "Made for you" on our own ads; the studio uses the feed’s label, never from “title”', () => {
  const app = src('public/app.js');
  assert.match(app, /const c = w\.whose \|\| w\.cardSnap \|\| \{\}, rv = rivalOf\(c\), wa = rv \? ourVersionOf\(rv\.name\) : whoseAd\(/);
  assert.match(src('feed-service.js'), /whose: whoseOf\(t\.cards\.get\(w\.cardId\) \|\| w\.cardSnap\)/, 'the jam carries the card bits the board needs');
  assert.doesNotMatch(app, /`from “\$\{esc\(String\(ch\.before\.title/);
  assert.match(app, /return esc\(\(c && \(whoseAd\(c\) \|\| fromLabel\(c\)\)\) \|\| 'Made for you'\)/);
});
