// QV 26 Oct (docs/qv/feed-pages.md): the feed, cards, stories, Work and counts before the client handover. Each fix for every brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { daysUntil, healDays, healDaysIn, eventsFor, brandDay } from '../day-count.js';
import { stockSay } from '../stock-say.js';
import { playSrc } from '../move-label.js';
import { oneTake } from '../text-fit.js';
import { buildRecap } from '../recap.js';
import { watchView } from '../watch-view.js';
import { draftFits, onceLines, draftView } from '../drafts-bg.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const app = read('public/app.js'), fsvc = read('feed-service.js');
const IN = { country: 'IN', timezone: 'Asia/Kolkata', festival: { name: 'Diwali', date: '2026-11-08T00:00:00+05:30', label: '8 November' } };
const EVE = Date.parse('2026-10-26T14:30:00Z'); /* 26 Oct, 8 pm in India */

test('P0-1: a rows card with no rows and no picture has no slot; one naming a product shows its photo', () => {
  assert.match(app, /if \(!nonZero\(c\.rows \|\| \[\]\)\.length\) return '';/, 'slotHtml never draws an empty inset');
  assert.match(fsvc, /rest\.kind === 'rows' && !\(rest\.rows \|\| \[\]\)\.some\([^\n]*cardProduct\(rest, cat, \{ brand: BN\(\), byNameOnly: true \}\)/, 'pub serves the named product as a media card');
  assert.match(fsvc, /Object\.assign\(rest, \{ kind: 'media', images: \[named\.img\]/);
});

test('P0-2: "needs you" is the Work board\'s rule; the statics batch is finished work, never "needs you"', () => {
  assert.match(fsvc, /st: st\.statics\.state === 'done' \? 'Done'/);
  assert.doesNotMatch(fsvc, /s: st\.statics\.state === 'done' \? `\$\{st\.statics\.n\} ads ready for your review/);
  assert.match(fsvc, /const mine = waitsOn\(w, me, studioOf\(t, w\)\);/, 'a jam says Needs you only when it waits on this viewer');
  assert.match(fsvc, /const waiting = t\.work\.filter\(\(w\) => [^\n]*waitsOn\(w, meOf\(t\)\?\.email/, 'the brand story\'s "Waiting on you" too');
  const w = { id: 'w1', title: 'Budget rules', stage: 'needs_you', updatedAt: 2000, versions: [] };
  const say = (waits) => JSON.stringify(buildRecap({ since: 1000, sinceReal: 1000, work: [w], notes: [], cards: [], waits }));
  assert.match(say(() => true), /Needs your OK/);
  assert.doesNotMatch(say(() => false), /Needs your OK/, 'the recap never says "needs your OK" of a jam waiting on someone else');
});

test('P1-10: days are counted on the brand\'s calendar, never a UTC midnight rounded against the time now', () => {
  assert.equal(brandDay(EVE, IN), '2026-10-26');
  assert.equal(brandDay(Date.parse('2026-10-26T20:00:00Z'), IN), '2026-10-27', 'after midnight in India it is the 27th there');
  assert.equal(daysUntil('2026-10-28', EVE, IN), 2, 'Karva Chauth on the 28th is 2 days away on the 26th (it read "in 1 day")');
  assert.equal(daysUntil('2026-11-08', EVE, IN), 13);
  assert.equal(daysUntil('2026-11-08T00:00:00+05:30', EVE, IN), 13, 'a date with a zone is its own wall date');
  assert.equal(daysUntil('2026-10-26', EVE, IN), 0);
  assert.equal(daysUntil(null, EVE, IN), null);
  assert.equal(daysUntil('2026-11-08', EVE, { timezone: 'UTC', tzOffsetH: -5 }), 13, 'an offset when the zone is unknown');
  assert.match(app, /dd = \(t\) => daysTo\(t\) \?\? 0;/, 'Learned "Coming up" counts with daysTo');
  assert.match(app, /const daysTo = [^\n]*brandClock\(at\)\.day/);
  assert.doesNotMatch(app, /Math\.round\(\(new Date\(t\) - \(SRV\.clock/);
});

test('P1-10: a countdown baked into saved words reads today\'s count, from the calendar the Learned page shows', () => {
  const cal = [{ name: 'Karva Chauth', date: '2026-10-28' }, { name: 'Diwali', date: '2026-11-08' }, { name: 'Wedding season (winter)', date: '2026-11-15', end: '2027-02-12' }];
  const evs = eventsFor(IN, EVE, cal), h = (s) => healDays(s, evs, EVE, IN);
  assert.equal(evs.find((e) => e.names.includes('Karva Chauth')).date, '2026-10-28', 'the calendar date wins over the curated estimate');
  assert.equal(h('Diwali is 14 days away'), 'Diwali is 13 days away');
  assert.equal(h('Get Diwali ads and offers live within 15 days'), 'Get Diwali ads and offers live within 13 days');
  assert.equal(h('Diwali falls on 8 November, 14 days from today. Searches climb'), 'Diwali falls on 8 November, 13 days from today. Searches climb');
  assert.equal(h('Diwali in 14 days: get creative live first'), 'Diwali in 13 days: get creative live first');
  assert.equal(h('Karva Chauth in 1 day'), 'Karva Chauth in 2 days');
  assert.equal(h('Wedding season starts in 19 days'), 'Wedding season starts in 20 days');
  assert.equal(h('Post 7 days before Diwali'), 'Post 7 days before Diwali', 'a lead time is not a countdown');
  assert.equal(h('Ads that ran 90 days. Diwali is 14 days away'), 'Ads that ran 90 days. Diwali is 13 days away', 'a run length is never touched');
  assert.equal(h('Diwali and Karva Chauth are 14 days away'), 'Diwali and Karva Chauth are 14 days away', 'two events named: no guess');
  assert.equal(h('Refresh ads every 14 days'), 'Refresh ads every 14 days', 'no event named: unchanged');
  assert.equal(healDays('Diwali is 1 day away', evs, Date.parse('2026-11-08T06:00:00Z'), IN), 'Diwali is today');
  const c = healDaysIn({ title: 'Diwali is 14 days away', rows: [['When', 'Diwali, 14 days from today'], ['Refresh', '14 days from today']], detail: { why: ['Diwali in 15 days'] }, h: 'x' }, evs, EVE, IN);
  assert.deepEqual([c.title, c.rows[0][1], c.rows[1][1], c.detail.why[0]], ['Diwali is 13 days away', 'Diwali, 13 days from today', '14 days from today', 'Diwali in 13 days'], 'a row that names no event is never guessed at');
  /* every brand: a US brand's Black Friday from the curated list when its calendar has not loaded */
  const us = eventsFor({ country: 'US', timezone: 'America/New_York' }, Date.parse('2026-11-01T15:00:00Z'));
  assert.equal(healDays('Black Friday is 30 days away', us, Date.parse('2026-11-01T15:00:00Z'), { timezone: 'America/New_York' }), 'Black Friday is 26 days away');
  assert.match(fsvc, /return healCount\(\{ \.\.\.rest, history:/, 'every served card');
  assert.match(fsvc, /slides: slides\.map\(\(x\) => healCount\(bgFor\(x\), t\)\)/, 'every story slide');
  assert.match(read('server.js'), /calendarOf: async \(slug\) =>[^\n]*calendar\/\$\{x\}\.json/, 'the saved calendar, no new AI call');
});

test('P1-14 and P1-15: the loader never calls a method on false; /api/jobs is answered', async () => {
  assert.match(read('public/loader.js'), /const m = media \? b\.querySelector\('img,video'\) : null, mr = m\?\.getBoundingClientRect\?\.\(\)/);
  const { API_GATE } = await import('../feed-service.js');
  const files = fs.readdirSync(new URL('../', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => read(f)).concat(fs.readdirSync(new URL('../jam2/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => read(`jam2/${f}`)));
  const routes = [...new Set(files.flatMap((s) => [...s.matchAll(/\bon\('(?:GET|POST|PUT|DELETE|PATCH)', '(\/api\/[^']+)'/g)].map((m) => m[1])))];
  assert.ok(routes.includes('/api/jobs'));
  for (const r of routes) assert.ok(API_GATE.test(r.replace(/:(\w+)/g, 'x1')), `${r} is inside the service's gate (it answered 404)`);
});

test('P1-7: a fact about an ad already running keeps its count ("in 3 versions"); a count of takes still says one', () => {
  assert.equal(oneTake('oldest running for 139 days in 3 versions'), 'oldest running for 139 days in 3 versions');
  assert.equal(oneTake('WishCare ad live 44 days in 2 versions'), 'WishCare ad live 44 days in 2 versions');
  assert.equal(oneTake('3 versions live since September'), '3 versions live since September');
  assert.equal(oneTake('Has run 62 days across 4 variations'), 'Has run 62 days across 4 variations');
  assert.equal(oneTake('Write 3 new hooks per winner'), 'Write one new hook per winner');
  assert.equal(oneTake('Make three reel scripts'), 'Make one reel script');
  assert.match(fsvc, /const c = \{ \.\.\.c0, \.\.\.pub\(t\.cards\.get\(c0\.id\) \|\| c0, t\) \}/, 'the brand story says the card in the feed\'s served words');
});

test('P1-8: a sold-out row is never "nearly gone" in the card\'s words', () => {
  const rows = [['Anti-Grey Hair Serum Pack of 2', 'Sold out'], ['Anti-Breakage Intensive Conditioner 15ml', 'Sold out'], ['Hair Oil 100ml', '1 left'], ['Face Wash', '3 left']];
  assert.equal(stockSay('Restock now. Anti-Grey Hair Serum Pack of 2 and Anti-Breakage Intensive Conditioner - 15ml are nearly gone.', rows),
    'Restock now. Anti-Grey Hair Serum Pack of 2 and Anti-Breakage Intensive Conditioner - 15ml are sold out; Hair Oil 100ml and Face Wash are nearly gone.');
  assert.equal(stockSay('Hair Oil 100ml and Anti-Grey Hair Serum Pack of 2 are nearly gone.', rows), 'Anti-Grey Hair Serum Pack of 2 is sold out; Hair Oil 100ml is nearly gone.');
  assert.equal(stockSay('Hair Oil 100ml is nearly gone.', rows), 'Hair Oil 100ml is nearly gone.', 'a true sentence stands');
  assert.equal(stockSay('Two products are nearly gone.', [['A', '2 left']]), 'Two products are nearly gone.');
  assert.match(fsvc, /rest\.title = stockSay\(rest\.title, rest\.rows\)/);
});

test('P1-9: a source line says each part once', () => {
  assert.equal(playSrc('Move 05 · Play 05 · Should the ₹6,080 set be the face'), 'Play 05 · Should the ₹6,080 set be the face');
  assert.equal(playSrc('Play 08 · Play 08 · Three named bundles'), 'Play 08 · Three named bundles');
  assert.equal(playSrc('Move 1011 · Ads'), 'Weekly play 11 · Ads');
  assert.equal(playSrc('Reddit · Heard online'), 'Reddit · Heard online');
});

test('P1-11: "things people said" is one number on Watch, Learned and What we heard (everything heard)', () => {
  const now = Date.parse('2026-10-26'), old = now - 200 * 864e5;
  const items = [{ platform: 'reddit', about: 'brand', text: 'x'.repeat(40), link: 'https://r/1', postedAt: now - 864e5 }, { platform: 'reddit', about: 'brand', text: 'y'.repeat(40), link: 'https://r/2', postedAt: old }, { platform: 'nykaa', text: 'z'.repeat(40), link: 'https://n/1', postedAt: old }];
  const v = watchView({ name: 'Arata', now, profile: {}, listen: { items, themes: [], status: {} }, shelf: {} });
  assert.equal(v.people.total, 3, 'every item heard, as Learned counts it (social-feed heardView total)'); assert.equal(v.people.you, 2); assert.equal(v.people.category, 1);
  assert.equal(v.header.heard, 3); assert.equal(v.people.notes.you.length, 1, 'the wall still shows the recent ones');
});

test('P1-16: the plays\' "out of date" banner and counts are our team\'s (staff only)', () => {
  assert.match(app, /staleSay = window\.LIVE\?\.full \? nStale : 0/);
  assert.match(app, /\$\{staleSay && MVT\.tab === 'moves' \? `<button class="up-banner"/);
  assert.match(app, /mvStale = window\.LIVE\?\.full \?/);
});

test('P1-17: a draft about another product is not shown under the card; a line said twice reads once', () => {
  const cat = [{ t: 'Honeymoon Travel Pack', img: 'h.jpg' }, { t: 'Velocity Nitro 3 Running Shoes', img: 'v.jpg' }, { t: 'Suede Classic', img: 's.jpg' }];
  assert.equal(draftFits({ product: 'Honeymoon Travel Pack' }, { title: 'Set automated budget rules to protect hero inventory', rows: [['Out of Stock', '2 products']] }, { catalog: cat, brand: 'PUMA' }), false);
  assert.equal(draftFits({ product: 'Velocity Nitro 3 Running Shoes' }, { title: 'Build a lightweight running shoe video ad' }, { catalog: cat, brand: 'PUMA' }), true);
  assert.equal(draftFits({ product: 'Velocity Nitro 3 Running Shoes' }, { title: 'Put the Suede Classic in a reel' }, { catalog: cat, brand: 'PUMA' }), false, 'the card names another product');
  assert.equal(draftFits({}, { title: 'Anything' }), true, 'a draft with no product stands');
  assert.equal(onceLines('• The biggest plus is how light these shoes are.\nRun more.\n• The biggest plus is how light these shoes are.'), '• The biggest plus is how light these shoes are.\nRun more.');
  assert.equal(onceLines('Edit this post 21 template and use it in your ads.'), 'Edit this template and use it in your ads.');
  assert.equal(draftView({ image: 'a.png', copy: 'Light.\nThe biggest plus is how light they are.\nThe biggest plus is how light they are.' }).copy, 'Light. The biggest plus is how light they are.');
  assert.match(fsvc, /dv = dv0 && draftFits\(dv0, c,/);
});
