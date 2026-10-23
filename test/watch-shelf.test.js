// Where a brand sells (shelf.js) and What Brew watches for you (watch-view.js), offline: rows are matched to the brand or a rival
// by name only, a failed actor falls to the next, the brand's month cap stops paid runs, a brand outside India runs no Indian
// shelves, and the view folds everything into four blocks with "couldn't read" kept apart from "not listed". Free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { whoseRow, trafficRow, createShelf, PLATFORMS } from '../shelf.js';
import { watchView } from '../watch-view.js';
import { createPulse } from '../market-pulse.js';
import { NORM, SOURCES } from '../listen-watch.js';
process.env.APIFY_RETRY_MS = '1'; /* the Instamart retry waits a minute in production */

const who = [{ name: 'Nutrova', own: true }, { name: 'OZiva' }, { name: 'Arata' }];
const mem = () => { const m = new Map(); return { m, getJSON: async (s, n, d = null) => (m.has(`${s}/${n}`) ? structuredClone(m.get(`${s}/${n}`)) : d), put: async (s, n, v) => { m.set(`${s}/${n}`, structuredClone(v)); } }; };

test('a row is the brand’s only when its brand is the brand (or the title starts with it); look-alike names never count', () => {
  assert.equal(whoseRow({ name: 'NutroVally Seabuckthorn Pulp', brand: 'NutroVally' }, who), null);
  assert.equal(whoseRow({ name: 'NUTROVA Magnesium+D3', brand: 'NUTROVA' }, who)?.name, 'Nutrova');
  assert.equal(whoseRow({ name: 'Arata MitoActive Serum', brand: null }, who)?.name, 'Arata');
  assert.equal(whoseRow({ name: 'Curl gel', brand: 'Arata India' }, who)?.name, 'Arata');
  assert.equal(whoseRow({ name: 'Nutrabay Pea Protein', brand: 'Nutrabay' }, who), null);
  assert.equal(whoseRow({ name: 'OZiva Gluta Fizzy', brand: 'OZiva' }, who)?.name, 'OZiva');
});

test('Similarweb rows from either actor read into one shape, with the site even when the row only links Similarweb', () => {
  const a = trafficRow({ domain: 'nutrova.com', visits: '42369', estimatedMonthlyVisits: "{'2026-07-01': 39478, '2026-09-01': 42369}", trafficSources: "{'Search': 0.5, 'Mail': None}", bounceRate: '0.48' });
  assert.deepEqual([a.host, a.visits, a.months.length, a.sources.Search, a.bounce], ['nutrova.com', 42369, 2, 50, 48]);
  const b = trafficRow({ url: 'https://www.similarweb.com/website/theoodie.com/', name: 'theoodie.com', totalVisits: 623618 });
  assert.deepEqual([b.host, b.visits], ['theoodie.com', 623618]);
});

test('a platform runs the brand alone, then its rivals; a failed actor falls to the next; rows land by name with reviews kept apart', async () => {
  const calls = [];
  const apify = { live: true, run: async (id, input) => { calls.push([id, input]);
    if (id === 'scrapesage/flipkart-scraper') throw new Error('apify 400: run failed');
    const q = input.keyword || input.searchTerms?.[0];
    return q === 'Nutrova' ? [{ title: 'NUTROVA Collagen', brand: 'NUTROVA', price: 2575, mrp: 2860, rating: 4.2, url: 'https://f/1' }, { title: 'NutroVally Pulp', brand: 'NutroVally', price: 487 }] : [{ title: 'OZiva Collagen', brand: 'OZiva', price: 999 }]; } };
  const S = createShelf({ slug: 'x', packs: mem(), apify, monthUsd: async () => 0 });
  const r = await S.platform('flipkart', who.slice(0, 2));
  assert.equal(r.actor, 'shahidirfan/Flipkart-Product-Scraper', 'the backup actor answered');
  assert.equal(r.byName.Nutrova.length, 1, 'NutroVally is not Nutrova'); assert.equal(r.byName.Nutrova[0].price, 2575);
  assert.equal(calls[0][0], 'scrapesage/flipkart-scraper'); assert.deepEqual(calls[0][1].searchTerms, ['Nutrova'], 'the brand’s own search runs alone');
  assert.ok(r.byName.OZiva !== undefined);
});

test('the brand’s month of Apify spend stops paid runs at the cap, and the error says so (never "not listed")', async () => {
  let ran = 0; const apify = { live: true, run: async () => { ran++; return []; } };
  process.env.APIFY_BRAND_MONTH_CAP_USD = '10';
  const S = createShelf({ slug: 'x', packs: mem(), apify, monthUsd: async () => 10.2 });
  await assert.rejects(() => S.platform('blinkit', who, { city: { name: 'Mumbai', area: 'Bandra West, Mumbai' } }), /budget/);
  assert.equal(ran, 0); delete process.env.APIFY_BRAND_MONTH_CAP_USD;
});

test('the pulse reads shelves only for India; a US brand gets a note, no Apify run', async () => {
  const packs = mem(); let ran = 0;
  packs.m.set('us/profile.json', { name: 'Cozy', host: 'cozy.shop', country: 'US', rivals: [{ name: 'The Oodie', host: 'theoodie.com' }] });
  const apify = { live: true, meter: { usd: 0 }, run: async () => { ran++; return []; } };
  const treg = { live: true, meter: { usd: 0 }, call: async () => { throw new Error('no treg here'); } };
  const r = await createPulse({ slug: 'us', packs, treg, apify, ai: null }).run({ only: ['shelf', 'marketplace'], fresh: true });
  assert.equal(ran, 0); assert.ok(r.notes.some((n) => /India/.test(n)));
});

test('a shelf read keeps last week, and a 10% price move or a new out-of-stock is a change; a failed read keeps the last good one', async () => {
  const packs = mem(); let week = 1;
  packs.m.set('in/profile.json', { name: 'Nutrova', host: 'nutrova.com', country: 'IN', rivals: [{ name: 'OZiva', host: 'oziva.in' }] });
  const rows = () => (week === 1 ? [{ name: 'OZiva Collagen', brand: 'OZiva', price: 1000, inStock: true, productId: 'o1' }] : [{ name: 'OZiva Collagen', brand: 'OZiva', price: 850, inStock: false, productId: 'o1' }]);
  const apify = { live: true, meter: { usd: 0 }, run: async (id) => { if (week === 3) throw new Error('apify 400: blocked'); return /blinkit/.test(id) ? rows() : []; } };
  const treg = { live: true, meter: { usd: 0 }, call: async () => ({}) };
  const P = () => createPulse({ slug: 'in', packs, treg, apify, ai: null });
  await P().run({ only: ['shelf'], fresh: true }); week = 2;
  const r2 = await P().run({ only: ['shelf'], fresh: true });
  const ch = r2.lines.find((l) => l.key === 'shelf.blinkit.changes');
  assert.ok(ch, 'a change line'); assert.deepEqual(ch.changes.map((c) => c.kind).sort(), ['price', 'stock']);
  week = 3; await P().run({ only: ['shelf'], fresh: true });
  const f = await packs.getJSON('in', 'shelf/blinkit.json');
  assert.match(f.error, /blocked/); assert.equal(f.byName.OZiva[0].price, 850, 'last good read kept');
});

test('the view: four blocks, quiet when empty, "couldn’t read" apart from "not listed", meta topics left out', () => {
  const now = Date.parse('2026-10-23');
  const v = watchView({ name: 'Nutrova', host: 'nutrova.com', now,
    profile: { name: 'Nutrova', rivals: [{ name: 'OZiva', host: 'oziva.in' }], ads: { at: '2026-10-22', rivals: [{ name: 'OZiva', live: 784, items: [{ days: 105, hook: 'Glow from within', since: '2026-07-10' }] }] },
      marketplaces: [{ name: 'amazon.in', listings: [{ title: 'Nutrova', price: '₹2,575', rating: 4.2, reviews: 895, url: 'https://a/1' }, { title: 'Nutrova', price: '₹2,575', url: 'https://a/1' }] }, { name: 'amazon.in', listings: [{ title: 'x', url: 'https://a/2' }] }] },
    listen: { items: [{ platform: 'reddit', about: 'brand', text: 'Nutrova collagen really helped my skin over two months', link: 'https://r/1', postedAt: now - 864e5 }, { platform: 'nykaa', reach: 'indirect', text: 'Collagen powders all taste the same honestly', link: 'https://n/1', postedAt: now - 864e5 }],
      themes: [{ name: 'product review', n: 40 }, { name: 'collagen taste', n: 12 }], status: { at: '2026-10-23', sources: { myntra: { state: 'error', error: 'timeout' }, google: { state: 'needs', error: 'skipped: no places' } } } },
    shelf: { blinkit: { at: '2026-10-23T00:00:00Z', city: 'Mumbai', byName: { Nutrova: [], OZiva: [{ name: 'OZiva C', price: 999, inStock: true }] } }, instamart: { error: 'blocked', errorAt: '2026-10-23' } },
    traffic: { rows: [{ host: 'oziva.in', visits: 1760640, months: [{ m: '2026-09', v: 1760640 }] }] } });
  assert.equal(v.people.total, 2); assert.equal(v.people.you, 1); assert.equal(v.people.category, 1);
  assert.deepEqual(v.people.topics.map((t) => t.name), ['collagen taste'], 'a kind of post is no topic');
  const bl = v.sell.shelves.find((x) => x.id === 'blinkit'), im = v.sell.shelves.find((x) => x.id === 'instamart');
  assert.equal(bl.listed, 0, 'read, and not listed'); assert.equal(bl.rivals[0].name, 'OZiva');
  assert.equal(im.listed, null, 'never read is not "not listed"'); assert.equal(im.error, 'blocked');
  assert.deepEqual(v.sell.marketplaces.map((m) => [m.id, m.listings.length, m.listings[0].price, m.listings[0].name]), [['amazon', 1, 2575, null]], 'one Amazon, prices as numbers, a title that is just the brand name is dropped');
  assert.equal(v.rivals[0].liveAds, 784); assert.equal(v.rivals[0].longest.days, 105); assert.equal(v.rivals[0].visits, 1760640);
  assert.deepEqual(v.cant.map((c) => c.name).sort(), ['Instamart', 'Myntra'], 'skipped sources are not failures');
  assert.equal(v.show, null, 'no AI answers read: no block');
  const empty = watchView({ name: 'New', profile: {}, listen: {}, shelf: {} });
  assert.equal(empty.people, null); assert.equal(empty.sell, null); assert.equal(empty.rivals, null);
});

test('a post that tags the brand is a listening item with its picture, and the source is declared', () => {
  const x = NORM.igTagged({ shortCode: 'abc', url: 'https://www.instagram.com/p/abc/', caption: 'THEY ARE BEST. @arata.in', ownerUsername: 'fan1', likesCount: 5, timestamp: '2026-10-21T03:25:43Z', displayUrl: 'https://cdn/x.jpg', mentionType: 'caption-mention' }, { acct: 'own' });
  assert.equal(x.platform, 'instagram'); assert.equal(x.id, 'ig:abc'); assert.equal(x.image, 'https://cdn/x.jpg'); assert.equal(x.tagged, 'caption-mention');
  assert.ok(SOURCES.igtag); assert.ok(Object.keys(PLATFORMS).length >= 6);
});

test('source health: every call counts; a source failing most of its week is skipped, keeps one try a day, and healthy ones go first', async () => {
  const H = await import('../source-health.js'); H._reset(); const now = Date.parse('2026-10-24T10:00:00Z');
  for (let i = 0; i < 6; i++) H.recordCall('bad/actor', 'apify', { error: '403', at: now });
  for (let i = 0; i < 6; i++) H.recordCall('good/actor', 'apify', { ok: true, at: now });
  assert.equal(H.healthOf('bad/actor', { now }).rate, 0); assert.equal(H.healthOf('good/actor', { now }).rate, 1);
  assert.deepEqual(H.byHealth(['bad/actor', 'good/actor']), ['good/actor', 'bad/actor']);
  assert.equal(H.unhealthy('bad/actor', { now }), false, 'its one try today'); assert.equal(H.unhealthy('bad/actor', { now }), true, 'then skipped');
  assert.equal(H.unhealthy('good/actor', { now }), false);
  assert.equal(H.sourceTable()[0].id, 'bad/actor', 'worst first'); H._reset();
});

test('the router walks a capability’s endpoint and fallbacks, each with its own input, and says why each failed', async () => {
  const { runCap } = await import('../treg-map.js'); (await import('../source-health.js'))._reset();
  const seen = []; const apify = { run: async (id, input) => { seen.push([id, input]); if (id === 'curious_coder/similarweb-scraper') throw new Error('apify 500'); return [{ name: 'x.com', totalVisits: 5 }]; } };
  const r = await runCap('traffic.similarweb', { apify }, { inputOf: (id) => (id.startsWith('curious') ? { domains: ['x.com'] } : { websites: ['x.com'] }) });
  assert.equal(r.endpoint, 'tri_angle/similarweb-scraper'); assert.deepEqual(seen.map((s) => Object.keys(s[1])[0]), ['domains', 'websites']);
  await assert.rejects(() => runCap('traffic.similarweb', { apify: { run: async () => [] } }, { inputOf: () => ({}) }), /empty/);
});

test('store links on the brand’s own site are found by host, once each, without tracking tails', async () => {
  const { storeLinks } = await import('../shelf.js');
  const xs = storeLinks('<a href="https://www.nykaa.com/arata/p/1?utm=x">Nykaa</a><a href="https://www.nykaa.com/arata/p/2">again</a><a href="https://www.amazon.in/dp/B0X">Amazon</a><a href="https://notamazon.example.com/">no</a><a href="https://www.purplle.com/brand/arata">P</a>');
  assert.deepEqual(xs.map((x) => x.platform), ['nykaa', 'amazon', 'purplle']); assert.equal(xs[0].url, 'https://www.nykaa.com/arata/p/1');
});

test('a card’s Seen-in line: the mention count, then up to two places, by plain names', async () => {
  const { seenOf } = await import('../evidence.js');
  assert.equal(seenOf({ items: [{ kind: 'count', label: 'Mentions Brew found', value: '1,580 (40 unhappy)' }, { kind: 'quote', src: 'reddit.com' }, { kind: 'quote', src: 'www.nykaa.com' }, { kind: 'quote', src: 'youtube.com' }] }), '1,580 mentions · Reddit · Nykaa');
  assert.equal(seenOf({ items: [{ kind: 'ad', label: 'OZiva’s live ad', src: 'Meta Ad Library · IN' }] }), 'Meta Ad Library');
  assert.equal(seenOf({ items: [] }), null);
});

test('Amazon is a weekly shelf in any market (treg), with this week’s 10% price moves, and the view merges it with no duplicate', async () => {
  const packs = mem(); let wk = 1;
  packs.m.set('us/profile.json', { name: 'Cozy', host: 'cozy.shop', country: 'US', rivals: [{ name: 'The Oodie', host: 'theoodie.com' }], marketplaces: [{ name: 'amazon.com', listings: [{ title: 'Cozy', url: 'https://a/1' }] }] });
  const treg = { live: true, meter: { usd: 0 }, call: async (id, { body }) => ({ rows: body.keywords === 'The Oodie' ? [{ asin: 'B1', title: 'The Oodie Original Blanket Hoodie', price: wk === 1 ? '$100' : '$80', rating: 4.5, reviews: 900 }] : [] }) };
  const P = () => createPulse({ slug: 'us', packs, treg, apify: null, ai: null });
  await P().run({ only: ['marketplace'], fresh: true }); wk = 2; const r = await P().run({ only: ['marketplace'], fresh: true });
  const f = await packs.getJSON('us', 'shelf/amazon.json'); assert.equal(f.byName['The Oodie'][0].price, 80); assert.equal(f.changes[0].kind, 'price');
  assert.ok(r.lines.some((l) => l.key === 'shelf.amazon.changes'));
  const v = watchView({ name: 'Cozy', profile: await packs.getJSON('us', 'profile.json'), listen: {}, shelf: { amazon: f }, channels: { found: [{ platform: 'walmart', url: 'https://walmart.com/x' }] } });
  assert.deepEqual(v.sell.marketplaces, [], 'the read’s amazon.com isn’t shown twice'); assert.equal(v.sell.shelves[0].id, 'amazon'); assert.equal(v.sell.alsoOn[0].label, 'Walmart');
});
