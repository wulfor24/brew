// The 26 Oct QA of the feed pages (Brand Book, research slides and cards, Heard and Work on a phone, picture weight): each problem
// class kept from coming back, for any brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { blankBook, readLayer, viewOf, oneClaimEach } from '../jam2/brandbook.js';
import { bookNumbers, srcLine, dayLine } from '../facts-desk.js';
import { auditBook } from '../tools/audit-brand-book.mjs';
import { createResearch, howtoTitle, healHowto, tidyWords, plural, poss, unquote, fbExpiry, picDead } from '../research.js';
import { brandVocab, fitRising, fitTrends, onTopic } from '../trend-fit.js';
import { lighter, hasAlpha } from '../img-light.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/* ---------- Brand Book ---------- */
test('Brand Book: a claim shows once, with or without its bracketed note or a cut "…"', () => {
  const xs = oneClaimEach([{ text: 'Clinically studied on 34 Indian women (Improvements were observed in 8 weeks)', src: null }, { text: 'Clinically studied on 34 Indian women', src: 'https://x.com/a' },
    { text: '24g protein per serving' }, { text: '24g protein per serving.' }, { text: 'Lactose free whey, easy on the stomach for everyone…' }, { text: 'Lactose free whey, easy on the stomach for everyone who tries it' }]);
  assert.equal(xs.length, 3, xs.map((x) => x.text).join(' | '));
  assert.equal(xs[0].src, 'https://x.com/a', 'the kept claim takes the source the twin had');
  const profile = { name: 'N', category: 'Health', catalog: { products: [] } }, book = { proof: { claims: [{ text: 'Made with 3% Redensyl' }, { text: 'Made with 3% Redensyl (as tested)' }] } };
  const v = viewOf({ ...blankBook(), claimsAllowed: [{ text: 'Made with 3% Redensyl', from: 'team' }], read: readLayer({ slug: 'n', profile, brief: { claims: [{ claim: 'Made with 3% Redensyl', basis: 'site' }] }, config: {}, book }) }, { scope: 'member' });
  assert.equal(v.claims.length, 1, 'the team’s, the read’s and the brief’s copies are one claim');
});

test('Brand Book numbers: a person’s source line and day, never a raw URL, a file name or an ISO date', () => {
  assert.equal(srcLine('https://nutrova.com/products/nutrova-collagen-antioxidants', 'nutrova.com'), 'from your product page');
  assert.equal(srcLine('nutrova.com/meta.json', 'nutrova.com'), 'from your store’s product list');
  assert.equal(srcLine('www.nutrova.com/sitemap.xml', 'nutrova.com'), 'from your sitemap');
  assert.equal(srcLine('nutrova.com', 'nutrova.com'), 'from your site');
  assert.equal(srcLine('https://www.amazon.in/dp/B0X', 'nutrova.com'), 'from amazon.in');
  assert.equal(srcLine('Shopify (connected)'), 'from Shopify');
  assert.equal(srcLine('Meta Ad Library (daily own-ads read)'), 'from the Meta Ad Library');
  assert.equal(dayLine('2026-10-22', Date.parse('2026-10-26')), '22 Oct');
  assert.equal(dayLine('2025-10-22', Date.parse('2026-10-26')), '22 Oct 2025');
  const rows = bookNumbers({ a: { key: 'catalog.count', label: 'Products', v: '1', src: 'nutrova.com/meta.json', at: '2026-10-22' },
    b: { key: 'checkout.time', label: 'Time from product page to cart (headless, one run)', v: '12.1 s', src: 'https://nutrova.com/products/x', at: '2026-10-22T10:00:00Z' },
    c: { key: 'site.offer', label: 'Free shipping', v: 'Free Shipping above ₹650,', src: 'nutrova.com', at: '2026-10-22' } }, { host: 'nutrova.com', now: Date.parse('2026-10-26') });
  for (const x of rows) { assert.doesNotMatch(`${x.from} ${x.day}`, /https?:|\.json|\d{4}-\d{2}-\d{2}/, JSON.stringify(x)); assert.equal(x.day, '22 Oct'); }
  assert.equal(rows.find((x) => x.key === 'checkout.time').label, 'Time from product page to cart');
  assert.equal(rows.find((x) => x.key === 'site.offer').v, 'Free Shipping above ₹650');
  const page = read('public/brand-book.js');
  assert.match(page, /<dd><b>\$\{esc\(x\.v\)\}<\/b><small>\$\{esc\(\[x\.from/, 'the page shows the source line, not x.src');
  assert.doesNotMatch(page, /String\(x\.at\)\.slice\(0, 10\)/, 'no ISO day on the page');
  assert.match(read('public/brand-book.css'), /\.bb-nums dd b \{ display: block;/, 'the number sits on its own line');
  assert.match(read('brand-book-routes.js'), /bookNumbers\(tr, \{ host: v\.host \}\)/);
});

test('Brand Book: the page never scrolls sideways (the dock’s window-wide fade is clipped by the book, which stays sticky)', () => {
  const css = read('public/brand-book.css');
  assert.match(css, /\.bb \{ overflow-x: clip; \}/);
  assert.doesNotMatch(css, /\.bb \{[^}]*overflow-x: hidden/, 'hidden would break the sticky dock');
});

test('the Brand Book audit flags doubled claims and raw number sources', () => {
  const profile = { name: 'X', host: 'x.com', category: 'Beauty', market: { primary: 'IN' }, catalog: { products: [] } };
  const P = auditBook({ slug: 'x', profile, brief: { claims: [{ claim: 'Vegan and cruelty free', basis: 'site' }] }, config: {}, bookRead: { v: 99, cover: { tagline: 'Glow on' }, products: { heroes: [], tiers: [] } }, saved: null, shop: null, winners: null,
    facts: { a: { key: 'catalog.count', label: 'Products (headless, one run)', v: '12', src: 'x.com/products.json', at: '2026-10-22' } } });
  assert.doesNotMatch(P.join('\n'), /raw source|test note|listed twice/, 'the numbers chapter says it in words; claims show once');
});

/* ---------- How to test {rival}'s angle ---------- */
test('how-to slides: whole-word titles, one pair of quotes, plurals and possessives right, saved slides heal', () => {
  for (const [b, a] of [['Wellbeing Nutrition', 'ingredient'], ['Godrej Properties', 'location'], ['A Very Long Rival Brand Name Private Limited', 'urgency'], ['Hirawats', null]]) {
    const h = howtoTitle(b, a), full = `How to test ${poss(b)} ad`; assert.ok(h.length <= 48, h); assert.doesNotMatch(h, /s’s\b|s's\b/);
    assert.ok(/(angle|ad)$/.test(h) || (full.startsWith(h) && full[h.length] === ' '), `ends on a whole word: ${h}`);
  }
  assert.equal(howtoTitle('Pilgrim', 'urgency'), 'How to test Pilgrim’s urgency angle');
  assert.equal(poss('Hirawats'), 'Hirawats’'); assert.equal(plural(1, 'day'), '1 day'); assert.equal(plural(62, 'day'), '62 days');
  assert.equal(unquote('"24 HOURS ONLY"'), '24 HOURS ONLY'); assert.equal(unquote('“Glow”'), 'Glow'); assert.equal(unquote('No quotes'), 'No quotes');
  assert.equal(tidyWords('Pilgrim’s ad ""24 HOURS ONLY"" has run 1 days in 1 versions.'), 'Pilgrim’s ad “24 HOURS ONLY” has run 1 day in 1 version.');
  assert.equal(tidyWords('Godrej Properties\'s ad has run 62 days in 1 versions.'), 'Godrej Properties’ ad has run 62 days in 1 version.');
  assert.equal(healHowto({ h: 'How to test Pilgrim’s urgency hook for Arata', by: undefined }).h, 'How to test Pilgrim’s urgency hook for Arata', 'an AI title is left as written');
  const healed = healHowto({ id: 'ht-1', adId: 'a1', by: 'data', h: 'How to test Wellbeing Nutrition\'s ingredient ang', p: 'x' }, [{ id: 'a1', brand: 'Wellbeing Nutrition', angle: 'ingredient' }]);
  assert.equal(healed.h, 'How to test Wellbeing Nutrition’s angle'); assert.equal(healed.id, 'ht-1', 'the id stays, so its card still finds it');
  assert.equal(healHowto({ h: 'How to meet this week\'s search trend' }).h, 'How to meet this week\'s search trend', 'other titles are left alone');
  const src = read('research.js');
  assert.doesNotMatch(src, /angle`\.slice\(0, 48\)/, 'no title cut by characters');
  assert.match(src, /snap\.howto = \{ \.\.\.snap\.howto, items: \(snap\.howto\.items \|\| \[\]\)\.map\(\(x\) => healHowto\(x, ads\)\)/, 'saved slides heal on load');
});

test('Rivals page and team names: "1 day live · 1 version", "Mana Projects’ team"', () => {
  const app = read('public/app.js'), live = read('public/live.js');
  assert.match(app, /day\$\{\+a\.days === 1 \? '' : 's'\} live/); assert.match(app, /version\$\{\+a\.versions === 1 \? '' : 's'\}/);
  assert.doesNotMatch(live, /\$\{n\}’s|\$\{esc\(n\)\}’s/, 'live.js names take possT()');
  assert.doesNotMatch(app.split('\n').filter((l) => !/jp-|jpHead|jpFrame|st-panel|rv-read|ship-go|ourVersionOf/.test(l)).join('\n'), /\$\{esc\(B\.brand\.name\)\}’s|\$\{B\.brand\.name\}’s/);
});

/* ---------- rising searches ---------- */
const hairBrand = { name: 'Arata', config: { category: 'hair care, personal care', terms: [['hair serum', 'hair fall']], rising: ['hair serum'], product: { noun: 'serum' }, rivals: ['WishCare'] }, catalog: [{ t: 'Anti-Grey Hair Serum' }, { t: 'Zero Nasties Body Wash' }] };
const shoeBrand = { name: 'PUMA India', config: { category: 'Footwear, Sportswear', terms: [['running shoes', 'sneakers']], rising: ['running shoes'], rivals: ['Nike', 'ASICS'] }, catalog: [{ t: 'Velocity Nitro 3 Running Shoes' }] };
test('rising searches keep only what belongs to the brand, for any brand, from its own words', () => {
  const V = brandVocab(hairBrand), S = brandVocab(shoeBrand);
  assert.equal(onTopic('best laptop for work', V), false); assert.equal(onTopic('pharmacy online india', S), false);
  assert.equal(onTopic('hair serum for frizzy hair', V), true); assert.equal(onTopic('body wash', V), true, 'the brand sells a body wash');
  assert.equal(onTopic('asics novablast 5', S), true, 'a rival’s name belongs'); assert.equal(onTopic('best running shoes under 5000', S), true);
  assert.deepEqual(fitRising([{ q: 'best laptop for work', v: 1950 }, { q: 'rosemary hair oil', v: 300 }], V).map((x) => x.q), ['rosemary hair oil']);
});
test('saved trend reads heal: lists filtered, an emptied rising story and one quoting a dropped search leave', () => {
  const tr = { rising: { 'running shoes': [{ q: 'pharmacy online india', v: 841400 }, { q: 'nike pegasus 41', v: 200 }], 'sneakers': [{ q: 'online pharmacy', v: 300 }] },
    items: [{ id: 'tr-1', kind: 'rising', risingOf: 'sneakers', rising: [{ q: 'online pharmacy', v: 300 }], h: 'Rising searches around "sneakers"' },
      { id: 'tr-2', kind: 'rising', risingOf: 'running shoes', rising: [{ q: 'pharmacy online india', v: 841400 }, { q: 'nike pegasus 41', v: 200 }], h: 'Rising', p: 'People now also search "pharmacy online india".' },
      { id: 'tr-3', kind: 'rising', risingOf: 'running shoes', rising: [{ q: 'pharmacy online india', v: 841400 }, { q: 'nike pegasus 41', v: 200 }], h: 'Rising', p: 'People now also search "nike pegasus 41".' },
      { id: 'tr-4', kind: 'calendar', h: 'Diwali is 13 days away' }] };
  const out = fitTrends(tr, brandVocab(shoeBrand));
  assert.deepEqual(out.items.map((x) => x.id), ['tr-3', 'tr-4']);
  assert.deepEqual(out.items[0].rising.map((x) => x.q), ['nike pegasus 41']);
  assert.deepEqual(Object.keys(out.rising), ['running shoes']);
  assert.match(read('research.js'), /if \(snap\.trends\) snap\.trends = fitTrends\(snap\.trends, brandVocab\(brand\)\)/, 'research heals on load');
});

/* ---------- own live ads: one count, never "none" from a failed check, never in Trends ---------- */
test('own ads: a name search that finds no page is no "none" day; the feed asks the one count before saying none', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-own-'));
  const brand = { slug: 'puma-x', name: 'PUMA India', kind: 'generated', seed: {}, config: { country: 'IN', countryName: 'India', category: 'Footwear', rivals: [] } };
  const tregClient = { meter: { usd: 0 }, call: async (id) => { if (/company-ads/.test(id)) return { results: [{ ad_archive_id: '1', page_name: 'PUMA', page_id: '9', snapshot: { title: 'x', body: { text: 'y' } } }], searchResultsCount: 1 }; throw new Error('402'); } };
  const R = createResearch({ ROOT: dir, PUB: dir, anthropic: null, claudeParams: (m) => ({ messages: m }), textOf: () => '', geminiImage: async () => {}, gToken: async () => { throw new Error('no gcs'); }, clean: (s) => String(s || ''), brand, tregClient, log: { log() {}, warn() {}, error() {} } });
  await R.refresh(['own']);
  assert.ok(!(R.get().own?.events || []).some((e) => e.kind === 'none'), 'the page wasn’t found by name: that is not "no ads"');
  const fsrc = read('feed-service.js');
  assert.match(fsrc, /if \(e\.kind === 'none' && !\(B\(\)\?\.numbers\?\.ownAds\?\.n === 0\)\) continue;/);
  assert.match(fsrc, /const ring = c\.story\?\.ring \|\| \(\/\^ow-\/\.test\(String\(c\.id\)\) \|\| c\.sector === 'ads' \? null : 'trends'\);/, 'an own-ads card is never a Trends slide');
  assert.match(fsrc, /return !\(k === 'trends' && \(ADS_NOTE\.test/, 'saved own-ads notes leave Trends, and each note shows once');
  const ADS_NOTE = /\bAd Library\b|\blive (?:\S+ ){0,3}ads?\b/i;
  assert.ok(ADS_NOTE.test('No live PUMA India ads found in the Meta Ad Library')); assert.ok(!ADS_NOTE.test('Diwali is 13 days away'));
});

/* ---------- rival logos ---------- */
test('rival logos: a Facebook CDN link’s expiry is read, a dead one is never served, a live one is copied into our storage', () => {
  const at = Math.floor(Date.parse('2026-10-29T00:00:00Z') / 1000).toString(16).toUpperCase();
  const u = `https://scontent-bom1-1.xx.fbcdn.net/v/t39/1.jpg?stp=x&oe=${at}&_nc_sid=1`;
  assert.equal(fbExpiry(u), Date.parse('2026-10-29T00:00:00Z'));
  assert.equal(picDead(u, Date.parse('2026-10-30')), true); assert.equal(picDead(u, Date.parse('2026-10-26')), false);
  assert.equal(picDead('research/abc.jpg'), false); assert.equal(fbExpiry('https://cdn.shopify.com/x.jpg?oe=6AE30BEC'), null);
  const src = read('research.js'), fsrc = read('feed-service.js');
  assert.match(src, /avatar = await saveMedia\(b, imgExt\(b\)\)/, 'a fresh read saves the logo');
  assert.match(src, /async function healLogos\(\)/); assert.match(src, /if \(!isLeader\(\)\) return; healLogos\(\)\.catch\(\(\) => \{\}\); if \(movedAway/, 'logos heal before the moved-brand return (QV round 2)');
  assert.match(fsrc, /avatar: meta\.avatar && !picDead\(meta\.avatar\) \? meta\.avatar : null/);
});

/* ---------- picture weight ---------- */
test('big pictures go to the page as a light copy; downloads, fetches and small files get the original', async (t) => {
  let sharp; try { sharp = (await import('sharp')).default; } catch { return t.skip('sharp not installed here'); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-light-'));
  const noise = Buffer.alloc(1200 * 1200 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (((i / 3) % 1200) / 5 + Math.floor(i / 3600) / 5 + Math.random() * 40) & 255; /* a photo-like gradient with grain: big as a PNG */
  const opaque = path.join(dir, 'a.png'); fs.writeFileSync(opaque, await sharp(noise, { raw: { width: 1200, height: 1200, channels: 3 } }).png().toBuffer());
  const rgba = Buffer.alloc(1200 * 1200 * 4); for (let i = 0; i < rgba.length; i++) rgba[i] = i % 4 === 3 ? (i % 800 < 400 ? 0 : 255) : (Math.random() * 255) & 255;
  const clear = path.join(dir, 'b.png'); fs.writeFileSync(clear, await sharp(rgba, { raw: { width: 1200, height: 1200, channels: 4 } }).png().toBuffer());
  assert.ok(fs.statSync(opaque).size > 250e3);
  assert.equal(hasAlpha(fs.readFileSync(clear)), true); assert.equal(hasAlpha(fs.readFileSync(opaque)), false);
  const w = await lighter(opaque, 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8');
  assert.ok(w && w.endsWith('.webp') && fs.statSync(w).size < fs.statSync(opaque).size, 'a WebP copy, lighter');
  const j = await lighter(opaque, 'image/png,image/*;q=0.8'); assert.ok(j && j.endsWith('.jpg'), 'no WebP: a JPEG for an opaque picture');
  assert.equal(await lighter(clear, 'image/png,image/*;q=0.8'), null, 'see-through and no WebP: the original');
  assert.equal(await lighter(opaque, '*/*'), null, 'a fetch or a download gets the original');
  assert.equal(await lighter(opaque, 'text/html,application/xhtml+xml'), null);
  assert.ok(fs.statSync(opaque).size > 250e3, 'the original is untouched');
  assert.match(read('server.js'), /serveFile\(req, res, \(await lighter\(f, req\.headers\.accept\)\.catch\(\(\) => null\)\) \|\| f, \{ immutable: true, vary: 'Accept' \}\)/);
});

/* ---------- Heard and Work on a phone ---------- */
test('Heard on a phone: the source line ellipsises in its card; a quote cut keeps whole words and says so', () => {
  const q = read('public/quiet.css');
  assert.match(q, /\.hd-q \.hd-qs\{flex-direction:column;align-items:stretch;gap:1px\}/); assert.match(q, /\.hd-q \.hd-qs em\{max-width:100%\}/);
  assert.match(read('listen-watch.js'), /q\.slice\(0, 260\)\.replace\(\/\\s\+\\S\*\$\/, ''\)/);
});
test('Work on a phone: the title has its own line above the buttons', () => {
  assert.match(read('public/brew.css'), /@media \(max-width:700px\)\{\.wb-head\{flex-wrap:wrap;row-gap:8px\}\.wb-head > span\{flex:1 0 100%\}/); /* phones: the Work title on its own line */
});

/* ---------- drawn: the real stylesheets in headless Chrome (skipped where Chrome can't start) ---------- */
test('drawn: Brand Book at 1440, Heard and Work at 375 never scroll sideways, and "Work" never sits on the jam button', async (t) => {
  const { launchBrowser } = await import('../pdf/render.js');
  let b; try { b = await launchBrowser(); } catch (e) { return t.skip(`no Chrome here: ${e.message.slice(0, 60)}`); }
  try {
    const base = ['brew.css', 'quiet.css', 'heard.css', 'brand-book.css'].map((f) => read(`public/${f}`)).join('\n'), p = await b.newPage();
    const draw = async (w, body) => { await p.setViewport({ width: w, height: 860 }); await p.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${base}</style></head><body style="margin:0">${body}</body></html>`);
      return p.evaluate(() => { const t = document.querySelector('.wb-head b'), x = document.querySelector('.wb-head .side-act'), a = t?.getBoundingClientRect(), c = x?.getBoundingClientRect();
        return { wide: document.documentElement.scrollWidth - innerWidth, overlap: !!(a && c && !(a.right <= c.left || a.bottom <= c.top || c.bottom <= a.top)) }; }); };
    const ideas = Array.from({ length: 14 }, (_, i) => `<button>Make the tagline shorter ${i}</button>`).join('');
    assert.deepEqual(await draw(1440, `<div style="display:flex"><nav style="width:72px;flex:none"></nav><main class="stage" style="flex:1;min-width:0"><div id="view"><div class="bb"><div style="height:1200px"></div><div class="bb-dock"><div class="bb-askbox"><div class="bb-ideas"><div><span>Try</span>${ideas}</div></div><form class="bb-ask"><input name="q"><button>Send</button></form></div></div></div></div></main></div>`), { wide: 0, overlap: false });
    assert.deepEqual(await draw(375, `<div class="hd-wall"><figure class="hd-q"><blockquote>This serum reduced my hairfall a lot</blockquote><figcaption><span class="hd-lg is-mk" style="--mk:#0a66c2">in</span><span class="hd-qs"><b>Priya</b><em>YouTube comments · Fix My Curls - Embrace Your Natural Hair With This Simple Routine · 12 Oct</em></span><u>›</u></figcaption></figure></div>`), { wide: 0, overlap: false });
    assert.deepEqual(await draw(375, `<div class="wb-head"><span><b>Work</b><small>From first draft to a shared brief.</small></span><button class="side-act"><svg width="16" height="16"></svg> Start a new jam</button><button class="side-act"><svg width="16" height="16"></svg> Jams in the Library</button></div>`), { wide: 0, overlap: false });
  } finally { await b.close(); }
});
