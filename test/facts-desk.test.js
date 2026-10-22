// The fact sheet (facts-desk.js): the daily price and stock diff, team edits → facts rebuild → stale moves,
// connected accounts as the source of truth (members only, demo never), and Arata's patched hand-made sheet. No paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.REFRESH_AUTO = '0'; delete process.env.PAGESPEED_API_KEY;
const { createBuilder } = await import('../build.js');
const { createPacks } = await import('../brand-pack.js');
const { allowedFrom, canon, retiredSet, scrubRetired, backedNumbers } = await import('../fact-gate.js');
const { createFactsDesk, diffCatalog, quotedBy, connectedFacts, storeItems, overrides } = await import('../facts-desk.js');

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.join(HERE, '..');
const quiet = { log() {}, warn() {}, error() {} };
const day = new Date().toISOString().slice(0, 10);
const prod = (handle, title, price, { available = true, mrp = null } = {}) => ({ handle, title, product_type: 'Shoe', published_at: '2026-01-01', images: [{ src: `https://cdn.x/${handle}.jpg` }], variants: [{ price: String(price), compare_at_price: mrp ? String(mrp) : null, available }] });
const storeFetch = (products) => async (url) => { const page = +new URL(url).searchParams.get('page'); return { ok: true, status: 200, json: async () => ({ products: page === 1 ? products : [] }), text: async () => '' }; };

function brand(ROOT) {
  const P = createPacks({ ROOT, PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
  const modules = { reader: { createReader: () => ({ read: async () => { throw new Error('no read in tests'); } }) }, brief: { createBrief: () => ({}) }, moves: { SPECS: [], createMovesEngine: () => ({}) }, pdf: null };
  const builder = createBuilder({ ROOT, packs: P, ai: { onCharge() {}, call: async () => { throw Object.assign(new Error('mock'), { mock: true }); } }, treg: { onCharge() {} }, log: quiet, modules });
  return { P, builder };
}
const ledgerRow = (handle, title, n, v) => ({ key: `price.${handle}`, label: `${title} price`, v, n, unit: 'INR', layer: 'observed', src: `acme.in/products/${handle}`, url: `https://www.acme.in/products/${handle}`, at: '2026-10-01', method: 'products.json' });
async function seedBrand(P) {
  const slug = 'acme-in';
  const profile = { url: 'https://acme.in', host: 'acme.in', slug, name: 'Acme', descriptor: 'Shoes for walking', category: 'Footwear', country: 'IN', currency: 'INR', locale: 'en-IN', platform: 'shopify',
    catalog: { products: [{ handle: 'aero', title: 'Aero Runner', price: 4999, url: 'https://acme.in/products/aero', inStock: true, images: [] }, { handle: 'bolt', title: 'Bolt Low', price: 3299, url: 'https://acme.in/products/bolt', inStock: true, images: [] }, { handle: 'cove', title: 'Cove Slide', price: 1499, url: 'https://acme.in/products/cove', inStock: true, images: [] }], hero: ['aero', 'bolt'] },
    rivals: [{ name: 'Rival', host: 'rival.in', why: 'w' }], reviews: { total: 812 }, socials: {}, ads: { own: { page: 'Acme', live: 18 } } };
  const ledger = [ledgerRow('aero', 'Aero Runner', 4999, '₹4,999'), ledgerRow('bolt', 'Bolt Low', 3299, '₹3,299'), ledgerRow('cove', 'Cove Slide', 1499, '₹1,499'),
    { key: 'brand.descriptor', label: 'Descriptor in the page title', v: 'Shoes for walking', layer: 'observed', src: 'acme.in', url: 'https://acme.in/', at: '2026-10-01', method: 'crawl' },
    { key: 'ads.own.live', label: 'Acme: live Meta ads in IN', v: '18', n: 18, layer: 'observed', src: 'facebook.com/ads/library', at: '2026-10-01', method: 'treg' },
    { key: 'reviews.total', label: 'Reviews and ratings found', v: '812', n: 812, layer: 'observed', src: 'judge.me', at: '2026-10-01', method: 'crawl' },
    { key: 'catalog.count', label: 'Products in the catalog', v: '3', n: 3, layer: 'observed', src: 'acme.in/products.json', at: '2026-10-01' }];
  const sec = (text) => [{ h: 'Why', kind: 'why', blocks: [{ t: 'p', text }] }];
  const moves = { 3: { n: 3, title: 'Price ladder', sections: sec('The Bolt Low sells at ₹3,299 and the Aero Runner at ₹4,999. Lead with the Bolt Low.') },
    7: { n: 7, title: 'Slides for summer', sections: sec('The Cove Slide at ₹1,499 is the entry product.') },
    9: { n: 9, title: 'Ads', sections: sec('Acme runs 18 live ads on Meta and has 812 reviews.') },
    12: { n: 12, title: 'Search', sections: sec('Nothing here quotes a price.') } };
  await P.put(slug, 'status.json', { name: 'Acme', host: 'acme.in', done: true, ready: true, doneAt: Date.now(), seenAt: Date.now() });
  await P.put(slug, 'profile.json', profile); await P.put(slug, 'ledger.json', ledger); await P.put(slug, 'moves.json', moves);
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in', mark: 'x.png' }, lanes: { core: { name: 'Core', line: 'Aero Runner' } }, posts: [] });
  return slug;
}

test('daily diff: a changed price is updated with today and the product URL, a gone product drops, a new one is added', () => {
  const L = [ledgerRow('aero', 'Aero Runner', 4999, '₹4,999'), ledgerRow('bolt', 'Bolt Low', 3299, '₹3,299'), { key: 'rival.r-in.price.1', label: 'R: x', v: '₹999', n: 999, url: 'https://r.in/products/x' }, { key: 'brand.name', v: 'Acme' }];
  const items = storeItems([prod('aero', 'Aero Runner', 5299), prod('dash', 'Dash Trainer', 2799), prod('gift-card', 'Gift Card', 500)], 'acme.in');
  const d = diffCatalog(L, items, { host: 'acme.in', currency: 'INR', locale: 'en-IN', at: day });
  const by = Object.fromEntries(d.changes.map((c) => [c.kind + ':' + c.handle, c]));
  assert.equal(by['changed:aero'].was, '₹4,999'); assert.equal(by['changed:aero'].now, '₹5,299');
  const aero = d.ledger.find((e) => e.key === 'price.aero'); assert.equal(aero.n, 5299); assert.equal(aero.at, day); assert.equal(aero.src, 'acme.in/products/aero');
  assert.ok(by['removed:bolt']); assert.deepEqual(d.gone, ['bolt']); assert.ok(!d.ledger.some((e) => e.key === 'price.bolt'));
  assert.ok(by['new:dash']); assert.ok(d.ledger.some((e) => e.key === 'price.dash' && e.n === 2799));
  assert.ok(!d.changes.some((c) => c.handle === 'gift-card'), 'a gift card is not a product');
  assert.ok(d.ledger.some((e) => e.key === 'rival.r-in.price.1'), 'rival prices are not the store’s');
  const d2 = diffCatalog(L, items, { host: 'acme.in', currency: 'INR', removedByBrand: ['dash'] });
  assert.ok(!d2.changes.some((c) => c.kind === 'new'), 'a product the brand removed is not added back');
});

test('quotedBy: a move quoting the old price next to the product, or naming a gone product, is hit; a shared number alone is not', () => {
  const sec = (text) => [{ blocks: [{ t: 'p', text }] }];
  const moves = { 1: { sections: sec('Bolt Low at ₹3,299.') }, 2: { sections: sec('Another shoe at ₹3,299.') }, 3: { sections: sec('Cove Slide is the entry product.') }, 4: { sections: sec('We have 812 reviews.') } };
  const hits = quotedBy([{ kind: 'changed', key: 'price.bolt', label: 'Bolt Low price', was: '₹3,299', now: '₹3,499' }, { kind: 'removed', key: 'price.cove', label: 'Cove Slide price', was: '₹1,499' }, { kind: 'changed', key: 'reviews.total', label: 'Reviews', was: '812', now: '900' }], moves);
  assert.deepEqual(Object.keys(hits).sort(), ['1', '3', '4']);
});

test('daily check end to end: facts.json rebuilt, the gone price no longer passes the fact gate, moves flagged, edits recorded, re-read signal', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-facts-')); const { P, builder } = brand(ROOT); const slug = await seedBrand(P);
  await builder.republish(slug);
  assert.ok(allowedFrom(await P.getJSON(slug, 'facts.json')).has(canon('₹1,499')));
  const signals = []; builder.signal = async (s, ev) => signals.push(ev);
  const desk = createFactsDesk({ packs: P, builder, log: quiet, fetchImpl: storeFetch([prod('aero', 'Aero Runner', 5299), prod('bolt', 'Bolt Low', 3299, { available: false })]) });
  const r = await desk.daily(slug);
  assert.equal(r.changed, 1); assert.equal(r.removed, 1); assert.equal(r.stock, 1);
  const facts = await P.getJSON(slug, 'facts.json'), ok = allowedFrom(facts);
  assert.equal(facts.price_aero.v, '₹5,299'); assert.equal(facts.price_aero.at, day); assert.match(facts.price_aero.src, /acme\.in\/products\/aero/);
  assert.ok(!facts.price_cove && !ok.has(canon('₹1,499')), 'a gone product’s price no longer passes the gate');
  assert.ok(!ok.has(canon('₹4,999')), 'the old price no longer passes');
  assert.equal(facts.catalog_count.v, '2');
  const prof = await P.getJSON(slug, 'profile.json');
  assert.ok(!prof.catalog.products.some((x) => x.handle === 'cove'), 'the gone product leaves the catalog the cards use'); assert.equal(prof.catalog.products.find((x) => x.handle === 'bolt').inStock, false);
  const u = await P.getJSON(slug, 'updates.json');
  assert.ok(u.stale[3] && /Aero Runner/.test(u.stale[3].why), 'the move quoting the old price is out of date'); assert.ok(u.stale[7] && /no longer on the store/.test(u.stale[7].why)); assert.ok(!u.stale[12]);
  const E = await P.getJSON(slug, 'facts-edits.json'); assert.equal(E.edits[0].by, 'Brew daily check'); assert.ok(E.retired.includes(canon('₹1,499')));
  assert.equal(signals.length, 1, 'the same-day re-read is asked for');
  /* a move written before still quotes the gone price: it leaves the move before the move backs a card */
  const moved = scrubRetired((await P.getJSON(slug, 'moves.json'))[7], retiredSet(E.retired, ok)); assert.ok(!backedNumbers(moved).has(canon('₹1,499')));
  assert.equal((await desk.daily(slug)).skipped, 'done today');
  /* no products.json: the saved product pages are checked one by one; every page answering 404 is the site, never every product gone */
  const desk2 = createFactsDesk({ packs: P, builder, log: quiet, fetchImpl: async () => ({ ok: false, status: 404 }) }); assert.equal((await desk2.daily(slug, { force: true })).skipped, 'pages unreachable');
});

test('team edit: Not true any more removes the fact, keeps it in the audit list, flags the moves; a pasted link is read, never typed', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-facts-')); const { P, builder } = brand(ROOT); const slug = await seedBrand(P);
  await builder.republish(slug);
  const reloaded = []; const page = '<html><title>Acme</title><body><h1>Shoes for long walks</h1></body></html>';
  const ai = { call: async () => ({ json: { value: 'Shoes for long walks' } }) }; /* a stand-in: no paid call */
  const desk = createFactsDesk({ packs: P, builder, ai, log: quiet, onPack: async (s) => reloaded.push(s), fetchImpl: async () => ({ ok: true, status: 200, text: async () => page }) });
  const r = await desk.edit(slug, { action: 'remove', key: 'reviews_total' }, { by: 'ana@acme.in' });
  assert.ok(r.ok, r.error); assert.ok(reloaded.includes(slug), 'the pack is reloaded at once');
  assert.ok(!(await P.getJSON(slug, 'facts.json')).reviews_total); assert.ok(!(await P.getJSON(slug, 'ledger.json')).some((e) => e.key === 'reviews.total'));
  const E = await P.getJSON(slug, 'facts-edits.json'); assert.equal(E.edits[0].by, 'ana@acme.in'); assert.match(E.edits[0].what, /Removed/); assert.equal(E.removed[0].key, 'reviews.total');
  assert.match((await P.getJSON(slug, 'updates.json')).stale[9].why, /The team removed/);
  const l = await desk.edit(slug, { action: 'link', key: 'brand_descriptor', url: 'https://acme.in/about' });
  assert.ok(l.ok, l.error); const f = (await P.getJSON(slug, 'facts.json')).brand_descriptor;
  assert.equal(f.v, 'Shoes for long walks'); assert.equal(f.src, 'acme.in/about'); assert.equal(f.at, day);
  const bad = await createFactsDesk({ packs: P, builder, ai: { call: async () => ({ json: { value: 'Made up' } }) }, log: quiet, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<p>Other words</p>' }) }).edit(slug, { action: 'link', key: 'brand_descriptor', url: 'https://acme.in/x' });
  assert.ok(bad.error, 'a value the page does not show is never taken');
  assert.ok((await desk.edit(slug, { action: 'link', key: 'brand_descriptor', url: 'not a link' })).error);
  /* visitors read it without actions or names */
  const v = await desk.view(slug, { member: false, canEdit: false });
  assert.ok(v.groups.length && v.groups.every((g) => g.rows.every((x) => !x.canRemove && !x.canLink))); assert.equal(v.choices, null); assert.ok(v.edits.every((e) => !/@/.test(e.by)));
});

test('connected accounts: private facts beat the site read (was kept), demo never counts, members only, disconnect removes them', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-facts-')); const { P, builder } = brand(ROOT); const slug = await seedBrand(P);
  await builder.republish(slug);
  const desk = createFactsDesk({ packs: P, builder, log: quiet }); builder.setHooks({ connected: (s, t) => desk.connected(s, t) });
  await P.put(slug, 'connected-ledger.json', [{ key: 'meta.ads.live', label: 'Live Meta ads', v: '99', n: 99, demo: true, src: 'Meta (demo account)' }]);
  await builder.liveConnected(slug, 'meta', [{ key: 'meta.ads.live', label: 'Live Meta ads', v: '42', n: 42, layer: 'observed', src: 'Meta Ads · act_1', method: 'account:meta', at: new Date().toISOString() }, { key: 'meta.spend.30d', label: 'Meta spend, last 30 days', v: '₹2.1 lakh', n: 210000, src: 'Meta Ads · act_1', at: new Date().toISOString() }], true, { public: false });
  const pf = (await P.getJSON(slug, 'private/facts.json')).facts;
  assert.equal(pf.ads_own_live.v, '42'); assert.equal(pf.ads_own_live.was.v, '18'); assert.equal(pf.ads_own_live.src, 'Meta Ads (connected)'); assert.equal(pf.meta_spend_30d.connected, 'meta');
  assert.ok(!Object.values(pf).some((f) => f.v === '99'), 'a demo account is never a fact');
  const u = await P.getJSON(slug, 'updates.json'); assert.ok(u.stale[9]?.private && /connected Meta Ads/.test(u.stale[9].why), 'the move quoting the Ad Library count is flagged for the team');
  const mem = await desk.view(slug, { member: true, canEdit: true }), vis = await desk.view(slug, { member: false, canEdit: false });
  const row = (V, k) => V.groups.flatMap((g) => g.rows).find((x) => x.k === k);
  assert.equal(row(mem, 'ads_own_live').v, '42'); assert.equal(row(mem, 'ads_own_live').tool, 'Meta Ads'); assert.equal(row(mem, 'ads_own_live').canRemove, false);
  assert.equal(row(vis, 'ads_own_live').v, '18', 'a visitor keeps the public sheet'); assert.ok(!row(vis, 'meta_spend_30d'));
  assert.ok((await builder.updates(slug, { member: false })).stale.every((s) => !s.private));
  await builder.liveConnected(slug, 'meta', [], false, { public: false });
  assert.deepEqual((await P.getJSON(slug, 'private/facts.json')).facts, {}, 'disconnect removes that tool’s facts at once');
  assert.equal(overrides(connectedFacts([{ key: 'reviews.judgeme.total', v: '820', n: 820 }], { reviews_total: { key: 'reviews.total', v: '812', n: 812 } })).length, 0, 'a small wobble is not a correction');
});

