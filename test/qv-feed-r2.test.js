// QV round 2 of the feed pages (26 Oct night): each fix kept from coming back, for any brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aiRingNow, aiFact, healAiText, healAiCard } from '../ai-count.js';
import { healthFrom } from '../health.js';
import { draftFits, draftName, draftView, notHeadline, noPlanNo } from '../drafts-bg.js';
import { aiTextsOf, fromAi, dropAiQuotes } from '../quote-guard.js';
import { ownAdsSay, oosSay, ownSayIn, outInRows } from '../own-say.js';
import { stockSay } from '../stock-say.js';
import { healNote, healDaysIn, eventsFor } from '../day-count.js';
import { brandVocab, fitRising, fitTrends } from '../trend-fit.js';
import { heardCards } from '../social-feed.js';
import { isCdn, cdnExpiry, cdnDead, keepName, createCdnKeep, keepRes } from '../cdn-keep.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const hex = (iso) => Math.floor(Date.parse(iso) / 1000).toString(16).toUpperCase();
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);

/* ---------- 1. CDN pictures ---------- */
test('CDN links: fbcdn, cdninstagram and scontent are known, their expiry read; other hosts are left alone', () => {
  const fb = `https://scontent-bom1-1.xx.fbcdn.net/v/t39.30808-1/1_n.jpg?stp=x&oe=${hex('2026-10-29T07:53:00Z')}&_nc_sid=1`;
  const ig = `https://scontent-ord5-1.cdninstagram.com/v/t51.2885-15/2_n.jpg?oe=${hex('2026-10-29T10:00:00Z')}`;
  assert.ok(isCdn(fb) && isCdn(ig) && isCdn('https://scontent.fdel1-1.fna.fbcdn.net/a.png'));
  assert.ok(!isCdn('https://www.facebook.com/ads/library/?id=1') && !isCdn('https://cdn.shopify.com/x.jpg?oe=6AE30BEC') && !isCdn('research/abc.jpg'));
  assert.equal(cdnExpiry(fb), Date.parse('2026-10-29T07:53:00Z')); assert.equal(cdnExpiry(ig), Date.parse('2026-10-29T10:00:00Z'));
  assert.ok(cdnDead(fb, Date.parse('2026-10-30'))); assert.ok(!cdnDead(fb, Date.parse('2026-10-26')));
  assert.equal(keepName(fb), keepName(fb.replace('scontent-bom1-1.xx', 'scontent-del2-1.xx').replace(/oe=\w+/, 'oe=AAAAAAAA')), 'one name per picture, whatever host or signature');
  assert.match(keepName(fb), /^[a-f0-9]{20}\.jpg$/); assert.match(keepName('https://x.fbcdn.net/a/b.png?oe=1'), /\.png$/);
});

test('CDN links: a live one is copied in the background and then served from our storage; an expired one is dropped', async () => {
  let clock = Date.parse('2026-10-26T18:00:00Z'); const saved = new Map(), fetched = [];
  const K = createCdnKeep({ now: () => clock, has: async (n) => saved.has(n), save: async (n, b) => saved.set(n, b), fetchBuf: async (u) => { fetched.push(u); if (/gone/.test(u)) throw new Error('fetch 403'); if (/html/.test(u)) return Buffer.from('<html>error page</html>'.repeat(5)); return JPG; }, log: {} });
  const live = `https://scontent-bom1-1.xx.fbcdn.net/v/logo.jpg?oe=${hex('2026-10-29T07:53:00Z')}`, old = `https://scontent.cdninstagram.com/v/old.jpg?oe=${hex('2026-10-20T00:00:00Z')}`;
  const body = { rivals: [{ name: 'Rival', avatar: live }, { name: 'Gone', avatar: old }], tagged: [{ image: old, text: 'hi' }], images: [live, old, 'research/x.jpg'], note: `see ${old} here` };
  const first = K.deep(body);
  assert.equal(first.rivals[0].avatar, live, 'not copied yet: served while it still loads');
  assert.equal(first.rivals[1].avatar, null, 'expired: no picture, the page shows the name');
  assert.equal(first.tagged[0].image, null); assert.deepEqual(first.images, [live, 'research/x.jpg'], 'a dead picture leaves a list');
  assert.equal(first.note, 'see  here');
  await K.idle();
  assert.equal(saved.size, 1, 'the live link was copied, the expired one never fetched'); assert.ok(!fetched.includes(old));
  const again = K.deep(body); assert.equal(again.rivals[0].avatar, `research/${keepName(live)}`);
  clock = Date.parse('2026-11-02'); assert.equal(K.deep(body).rivals[0].avatar, `research/${keepName(live)}`, 'our copy outlives the link');
  const s = K.body(JSON.stringify(body)); assert.ok(!/fbcdn|cdninstagram/.test(s), s);
  /* refused or not a picture: dropped, never saved */
  const gone = `https://x.fbcdn.net/gone.jpg?oe=${hex('2026-12-01T00:00:00Z')}`, html = `https://x.fbcdn.net/html.jpg?oe=${hex('2026-12-01T00:00:00Z')}`;
  clock = Date.parse('2026-10-26T18:00:00Z'); K.keep(gone); K.keep(html); await K.idle();
  assert.equal(K.keep(gone), null, 'a 403 is a dead link'); assert.equal(saved.has(keepName(html)), false, 'an error page is never kept');
});

test('CDN links: a copy another instance made is found in storage, not fetched again; boot scan queues saved reads', async () => {
  const live = `https://scontent.xx.fbcdn.net/v/a.jpg?oe=${hex('2026-12-01T00:00:00Z')}`, dead = `https://scontent.xx.fbcdn.net/v/b.jpg?oe=${hex('2026-10-01T00:00:00Z')}`;
  let fetches = 0; const K = createCdnKeep({ now: () => Date.parse('2026-10-26'), has: async (n) => n === keepName(live) || n === keepName(dead), fetchBuf: async () => { fetches++; return JPG; }, log: {} });
  assert.equal(K.scan({ ads: { brands: [{ avatar: live }, { avatar: dead }] } }), 1, 'expired links are not queued on boot'); await K.idle();
  assert.equal(fetches, 0); assert.equal(K.keep(live), `research/${keepName(live)}`);
  K.keep(dead); await K.idle(); assert.equal(K.keep(dead), `research/${keepName(dead)}`, 'an expired link we copied before is still served from storage');
});

test('CDN links: every server answer goes through keepRes, and the research tick copies logos for moved brands too', () => {
  const K = createCdnKeep({ now: () => Date.parse('2026-10-26'), log: {} }); const out = [];
  const res = { end(b) { out.push(b); }, write(b) { out.push(b); } }; keepRes(res, K);
  const dead = `https://scontent.xx.fbcdn.net/v/b.jpg?oe=${hex('2026-10-01T00:00:00Z')}`;
  res.end(JSON.stringify({ a: dead, b: 'ok' })); res.write(`data: ${JSON.stringify({ img: dead })}\n\n`);
  assert.deepEqual(JSON.parse(out[0]), { a: null, b: 'ok' }); assert.equal(out[1], 'data: {"img":null}\n\n');
  const srv = read('server.js'); assert.match(srv, /zipRes\(req, res\);\n\s*keepRes\(res, CDN\);/); assert.match(srv, /CDN\.scan\(x\.research\.get\(\)\)/);
  assert.match(read('research.js'), /if \(!isLeader\(\)\) return; healLogos\(\)\.catch\(\(\) => \{\}\); if \(movedAway\(brand\.slug\)\) return;/);
});

/* ---------- 2. one AI-answers count ---------- */
test('AI answers: cards quote the newest single check, the one Store health shows; other counts are left alone', () => {
  const p = { name: 'Arata', ai: { score: { named: 0, of: 15, unbrandedNamed: 0, unbrandedOf: 15 }, answers: [{ tool: 'chatgpt', at: '2026-10-20' }] } };
  const read1 = healthFrom(p).rings.find((r) => r.k === 'AI answers');
  assert.deepEqual(aiFact(read1), { n: 0, of: 15, unbranded: true, at: '2026-10-20' });
  const old = { ...read1 }; delete old.count; assert.equal(aiFact(old).of, 15, 'a ring saved before it carried its count');
  const weekly = { k: 'AI answers', read: true, at: '2026-10-25T00:00:00.000Z', count: { n: 1, of: 14, unbranded: true }, parts: [] };
  assert.equal(aiRingNow(read1, weekly), weekly, 'the weekly run when newer'); assert.equal(aiRingNow(read1, { ...weekly, at: '2026-10-01' }), read1); assert.equal(aiRingNow(read1, null), read1);
  const f = { n: 0, of: 15 };
  assert.equal(healAiText('Nutrova is named in just 1 of 18 generative answers', f), 'Nutrova is named in just 0 of 15 generative answers');
  assert.equal(healAiText('Brew saw Nutrova in 3 of 3 AI answers', f), 'Brew saw Nutrova in 0 of 15 AI answers');
  assert.equal(healAiText('zero of ten unbranded AI answers', f), '0 of 15 unbranded AI answers');
  assert.equal(healAiText('4 of 5 products are sold out; 3 of 10 reviews unanswered', f), '4 of 5 products are sold out; 3 of 10 reviews unanswered');
  const c = healAiCard({ id: 'm18-1-p', title: 'Get Arata named in AI answers', rows: [['Baseline mentions', '0 of 10'], ['Products', '3 of 5']] }, f);
  assert.deepEqual(c.rows, [['Baseline mentions', '0 of 15'], ['Products', '3 of 5']]);
  const perQ = { id: 'lv-vis-q1', title: 'ChatGPT named Arata in 1 of 3 answers' }; assert.equal(healAiCard(perQ, f), perQ, 'a per-question card is its own, labelled check');
  const shop = { id: 'x', title: '3 of 5 products sold out' }; assert.equal(healAiCard(shop, f), shop);
  const fsrc = read('feed-service.js'); assert.match(fsrc, /healAiCard\(\{ id: c0\.id/); assert.match(fsrc, /healCount\(healAiCard\(x\.type === 'ad' \? bgFor\(x\) : ownSayIn\(bgFor\(x\), ownNow\(t\)\), aiFactNow\(t\)\), t\)/);
});

/* ---------- 3. one count per thing ---------- */
test('counts: a Heard card counts everything heard, as every page does; the widget counts the Work board; Rivals lists every rival', () => {
  const items = Array.from({ length: 2952 }, (_, i) => ({ id: 'i' + i, platform: 'reddit', title: 'x', themes: i < 2720 ? ['frizz'] : [] }));
  const L = { total: 2720, items, themes: [{ name: 'frizz control', n: 70, pos: 50, neg: 5, neutral: 15, brand: 9, quoteIds: ['i1'] }], threads: [], status: {} };
  const c = heardCards(L, { brand: { name: 'Arata' }, lanes: { core: {} } }, { now: Date.parse('2026-10-26'), maxQ: 0, maxR: 0, maxC: 0 }).find((x) => /^heard-t-/.test(x.id));
  assert.match(c.src, /70 mentions of 2,952 /); assert.ok(!/2720/.test(JSON.stringify(c)), 'never the tagged-only total');
  const fsrc = read('feed-service.js'), app = read('public/app.js');
  assert.match(fsrc, /if \(\/\^heard-t-\/\.test\(String\(c0\.id \|\| ''\)\)\) \{ const sp = /, 'a saved Heard card takes today’s line');
  assert.match(fsrc, /for \(const r of read\.slice\(0, 6\)\) if \(r\?\.name/, 'every rival the read names is on the Rivals page');
  assert.match(app, /jams\.length \? `\$\{jams\.length\} jam\$\{jams\.length === 1 \? '' : 's'\} on the Work board/, 'the widget counts the Work board');
  assert.ok(!/thing\$\{n === 1 \? '' : 's'\} in progress/.test(app));
  assert.match(app, /class="shf-ini"/, 'a rival with no logo shows its initials');
});

/* ---------- 4. drafts that match their card ---------- */
test('drafts: one with no saved product is matched by the name in its title; a headline is not said again; no plan numbers', () => {
  const card = { title: 'Set automated budget rules to protect hero inventory', sub: 'Pause ads on sizes that run out', rows: [['Out of Stock', '2 products']] };
  const cat = [{ t: 'Velocity Nitro 3 Running Shoes' }, { t: 'Honeymoon Travel Pack' }];
  assert.equal(draftName({ title: 'Email: Honeymoon Travel Pack' }, cat), 'Honeymoon Travel Pack');
  assert.equal(draftName({ title: 'Email: Honeymoon Travel Pack' }, []), 'Honeymoon Travel Pack', 'a product-like title, with no catalog');
  assert.equal(draftName({ title: 'Email: three ways to wear it' }, []), '', 'a sentence is no product');
  assert.equal(draftFits({ title: 'Email: Honeymoon Travel Pack', copy: 'x' }, card, { catalog: cat, brand: 'PUMA' }), false);
  assert.equal(draftFits({ title: 'Video: Velocity Nitro 3 Running Shoes' }, { title: 'Show how light the Velocity Nitro 3 Running Shoes are' }, { catalog: cat, brand: 'PUMA' }), true);
  assert.equal(draftFits({ title: 'Post' }, card, { catalog: cat }), true, 'a draft naming nothing stays');
  assert.equal(notHeadline('• The biggest plus is how light these shoes are.\nBorn in the 1970s.', '• The biggest plus is how light these shoes are.'), 'Born in the 1970s.');
  assert.equal(notHeadline('Born in the 1970s.', 'Light as air'), 'Born in the 1970s.');
  const v = draftView({ image: 'gen/a.png', headline: 'The biggest plus is how light these shoes are', copy: '• The biggest plus is how light these shoes are.\nBorn in the 1970s.' });
  assert.ok(!/biggest plus/.test(v.copy), v.copy);
  assert.equal(noPlanNo('Edit this post 21 template and use it in your ads.'), 'Edit this template and use it in your ads.');
  assert.equal(noPlanNo('Run this Play 21 static next week'), 'Run this static next week');
  assert.match(read('feed-service.js'), /rest\.title = noPlanNo\(rest\.title\); rest\.sub = noPlanNo\(rest\.sub\)/);
});

/* ---------- 5. only real customers are quoted ---------- */
test('quotes: a draft line that repeats an AI answer leaves it; a real review stays', () => {
  const profile = { ai: { answers: [{ tool: 'chatgpt', text: 'Mana Projects offers a range of residential options in Bangalore, worth exploring based on location, budget and amenities.' }] } };
  const runs = [{ answers: [{ engine: 'gemini', text: 'For villas in Sarjapur, buyers often compare Mana Projects with Godrej Properties and Prestige on price and handover.' }] }];
  const T = aiTextsOf({ profile, runs }); assert.equal(T.length, 2);
  assert.ok(fromAi('“Mana Projects offers a range of r…”', T), 'a cut quote of an AI answer');
  assert.ok(fromAi('buyers often compare Mana Projects with Godrej Properties', T));
  assert.ok(!fromAi('“The handover was on time and the team answered every call.”', T), 'a real review');
  assert.ok(!fromAi('Mana Projects offers', T), 'too short to tell');
  const d = { headline: '“Mana Projects offers a range of r…”', headSmall: 'x', copy: 'Homes near your office.\n“Mana Projects offers a range of residential options in Bangalore”\nBook a visit.', title: 'Single image ad' };
  const out = dropAiQuotes(d, T);
  assert.equal(out.headline, undefined); assert.equal(out.copy, 'Homes near your office.\nBook a visit.');
  assert.equal(dropAiQuotes({ headline: 'Homes near your office' }, T).headline, 'Homes near your office');
  assert.match(read('drafts-bg.js'), /const ask = \[ASK\[kind\] \|\| '', QUOTE_RULE,/, 'the writer is told'); assert.match(read('drafts-bg.js'), /dropAiQuotes\(j, aiTextsOf\(\{ profile: p\.profile \}\)\)/);
  assert.match(read('feed-service.js'), /rest\.draft = dropAiQuotes\(rest\.draft, aiTextsNow\(t\)\)/, 'saved drafts heal on serve');
});

/* ---------- 6. no contradictions with the brand's own counts ---------- */
test('contradictions: own ads, out of stock and a counted "3 other items" are said from the counts', () => {
  assert.equal(ownAdsSay('Rivals are running up to 278 ads while we have none', 10), 'Rivals are running up to 278 ads while you run 10');
  assert.equal(ownAdsSay('We have no live ads in IN, so start one', 10), 'You run 10 in IN, so start one');
  assert.equal(ownAdsSay('Rivals are running up to 278 ads while we have none', 0), 'Rivals are running up to 278 ads while we have none', 'a true none stays');
  assert.equal(ownAdsSay('Rivals are running up to 278 ads while we have none', null), 'Rivals are running up to 278 ads while we have none', 'no count: untouched');
  assert.equal(oosSay('Since we have zero out-of-stock catalog items, push the hero', 2), 'Since we have 2 out-of-stock catalog items, push the hero');
  assert.equal(oosSay('zero out-of-stock catalog items', 0), 'zero out-of-stock catalog items');
  assert.equal(outInRows([['Hero SKUs', '4'], ['Out of Stock', '2 products']]), 2);
  const c = ownSayIn({ h: 'Protect your hero inventory', p: 'We have zero out-of-stock catalog items, so…', steps: ['Check no products are out of stock'] }, { ads: 10, out: 2 });
  assert.match(c.p, /2 out-of-stock/); assert.equal(c.steps[0], 'Check 2 products are out of stock');
  const rows = [['Anti-Grey Hair Serum Pack of 2', 'Sold out'], ['Anti-Hair Fall Intensive Shampoo - 15ml', 'Sold out'], ['Conditioner 15ml', 'Sold out'], ['Oil 50ml', 'Sold out'], ['Gel', '3 left']];
  assert.equal(stockSay('Anti-Grey Hair Serum Pack of 2, Anti-Hair Fall Intensive Shampoo - 15ml and 3 other items are low on stock.', rows),
    'Anti-Grey Hair Serum Pack of 2, Anti-Hair Fall Intensive Shampoo - 15ml and 2 more are sold out; 1 other item is low on stock.');
  assert.ok(!/items is\b/.test(stockSay('Anti-Grey Hair Serum Pack of 2 and 3 other items are low on stock.', [['Anti-Grey Hair Serum Pack of 2', 'Sold out']])), 'never "items is"');
  assert.match(read('feed-service.js'), /Object\.assign\(rest, ownSayIn\(\{ title: rest\.title/);
});

/* ---------- 7. margin notes count today ---------- */
test('margin notes: a countdown is counted today in the brand’s zone; one naming no event leaves the note', () => {
  const now = Date.parse('2026-10-26T15:00:00Z'), z = { country: 'IN', timezone: 'Asia/Kolkata' };
  const ev = eventsFor(z, now, [{ name: 'Diwali', date: '2026-11-08' }, { name: 'Karva Chauth', date: '2026-10-28' }]);
  assert.equal(healNote('diwali is 14 days away. start prep.', ev, now, z), 'diwali is 13 days away. start prep.');
  assert.equal(healNote('Diwali is fourteen days away', ev, now, z), 'Diwali is 13 days away');
  assert.equal(healNote('rivals have 958 live ads. critical twelve days.', ev, now, z), 'rivals have 958 live ads.');
  assert.equal(healNote('critical twelve days.', ev, now, z), '');
  assert.equal(healNote('results in 7 days', ev, now, z), 'results in 7 days', 'a plan length is no countdown');
  const card = healDaysIn({ title: 'x', note: { k: 'PLAY 04', h: 'diwali is 14 days away. start prep.' } }, ev, now, z); assert.equal(card.note.h, 'diwali is 13 days away. start prep.');
  assert.equal(healDaysIn({ title: 'x', note: { k: 'TIMELY PLAY', h: 'critical twelve days.' } }, ev, now, z).note, undefined, 'nothing left: no note');
  /* in the US zone, a day earlier at the same instant */
  const us = { country: 'US', timezone: 'America/Los_Angeles' }, evUS = eventsFor(us, Date.parse('2026-10-27T03:00:00Z'), [{ name: 'Diwali', date: '2026-11-08' }]);
  assert.equal(healNote('diwali is 9 days away', evUS, Date.parse('2026-10-27T03:00:00Z'), us), 'diwali is 13 days away');
});

/* ---------- 8. plays page and trends ---------- */
test('trends: a list that rose around a product keeps only that product’s searches, even ones the brand sells elsewhere; no stale-plays banner', () => {
  const V = brandVocab({ name: 'Arata', config: { terms: ['hair serum'], category: 'Hair and body care', rivals: ['Pilgrim'] }, catalog: [{ t: 'ARATA Exfoliating Body Wash' }] });
  assert.deepEqual(fitRising([{ q: 'body wash', v: 60 }, { q: 'hair serum for frizz' }, { q: 'pilgrim serum' }, { q: 'best laptop for work' }], V, 'arata hair serum').map((x) => x.q), ['hair serum for frizz', 'pilgrim serum']);
  assert.deepEqual(fitRising([{ q: 'body wash' }, { q: 'arata shampoo' }, { q: 'best laptop for work' }], V, 'arata').map((x) => x.q), ['body wash', 'arata shampoo'], 'around the name alone: what the brand sells');
  const saved = { rising: { 'hair serum': [{ q: 'body wash', v: '+60%' }, { q: 'hair serum for women' }] }, items: [{ kind: 'rising', h: 'Arata hair serum searches surge 100%', risingOf: 'hair serum', rising: [{ q: 'body wash' }, { q: 'hair serum for women' }] }] };
  const healed = fitTrends(saved, V); assert.deepEqual(healed.items[0].rising.map((x) => x.q), ['hair serum for women']); assert.deepEqual(healed.rising['hair serum'].map((x) => x.q), ['hair serum for women']);
  const PUMA = brandVocab({ name: 'PUMA India', config: { terms: ['running shoes'] } }); assert.deepEqual(fitRising([{ q: 'pharmacy online india' }, { q: 'running shoes for men' }], PUMA, 'running shoes').map((x) => x.q), ['running shoes for men']);
  assert.ok(!/class="up-banner"/.test(read('public/app.js')), 'no "36 plays are out of date" banner, staff included');
});
