// Brands that aren't Shopify stores: a headless Salesforce Commerce store (in.puma.com: /in/en/pd/<slug>/<id>, ProductGroup
// JSON-LD, reviews switched off), a brand that sells by enquiry (manaprojects.com: /project/ pages, a lead form) and the
// pieces every screen shares (base name, market, fonts, counts, connectors, listening). Offline: fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../reader/products.js';
import { catalog } from '../reader/stages/catalog.js';
import { detectReviewApp, reviewsOff, listingOf } from '../reader/stages/reviews.js';
import { brandBase, brandRe } from '../reader/util.js';
import { placeOf, sellingMarket } from '../market.js';
import { fontName } from '../reader/stages/brand.js';
import { rescoreNamed } from '../reader/stages/answers.js';
import { products, storeNote, PAGES_NOTE, ENQUIRY_NOTE } from '../pack-numbers.js';
import { storeConnectors } from '../seed-template.js';
import { diffCatalog } from '../facts-desk.js';
import { dueFor, socialConfig } from '../social-feed.js';
import { checkoutForPrompt } from '../cards-gen.js';

const SFCC = 'https://in.puma.com';
const pd = (slug, id) => `${SFCC}/in/en/pd/${slug}/${id}`;
const pdp = (name, price, stock) => `<html><head><meta property="og:type" content="product"><script type="application/ld+json">${JSON.stringify({ '@context': 'http://schema.org', '@type': 'Product', name, sku: '1', image: ['a.png', 'b.png', 'c.png'], offers: { '@type': 'Offer', price, priceCurrency: 'INR', availability: 'http://schema.org/OutOfStock' } })}</script>
<script type="application/ld+json">${JSON.stringify({ '@type': 'ProductGroup', name, hasVariant: [{ offers: { availability: 'http://schema.org/OutOfStock' } }, { offers: { availability: `http://schema.org/${stock ? 'InStock' : 'OutOfStock'}` } }] })}</script></head><body>"ratingsAndReviewsEnabled":false,"bazaarVoiceReviewFormScriptUrl":null</body></html>`;
const page = (title) => `<html><head><title>${title}</title><meta property="og:type" content="website"></head><body><h1>${title}</h1></body></html>`;

test('product URLs are learned from the store: a market prefix (/in/en) is not a product path, /pd/ is found by its pages', async () => {
  const urls = [...Array.from({ length: 40 }, (_, i) => pd(`shoe-${i}`, 100000 + i)), ...Array.from({ length: 30 }, (_, i) => `${SFCC}/in/en/shop/cat-${i}`), `${SFCC}/in/en/help/faq`];
  assert.equal(P.marketPrefix(urls), 'in/en');
  assert.equal(P.shapeOf(pd('x', 1), 'in/en'), 'pd/3', 'pd is a path, never taken for a language code');
  const fetchPage = async (u) => (/\/pd\//.test(u) ? pdp('Shoe', 4999, true) : page('Category'));
  const f = await P.findProductUrls({ urls, origin: SFCC, fetchPage, max: 10 });
  assert.deepEqual(f.shapes, ['pd/3']); assert.equal(f.total, 40); assert.equal(f.urls.length, 10);
  assert.ok(P.isProductUrl(pd('y', 2), f.shapes, f.prefix)); assert.ok(!P.isProductUrl(`${SFCC}/in/en/shop/cat-1`, f.shapes, f.prefix));
});

test('stores whose product URLs share only their ending (/<slug>/<sku>.html) are found by the tail shape', async () => {
  const o = 'https://www.skechers.in';
  const urls = Array.from({ length: 12 }, (_, i) => `${o}/model-${i}/2161${i}0.html`).concat([`${o}/men.html`, `${o}/women.html`]);
  const f = await P.findProductUrls({ urls, origin: o, fetchPage: async (u) => (/\d{5}0\.html$/.test(u) ? pdp('Walk', 8999, true) : page('x')) });
  assert.ok(f.shapes.includes('~html/2')); assert.equal(f.total, 12, 'category pages at depth 1 are never products');
});

test('a ProductGroup page: in stock when any size is, every photo kept, the price and currency read', () => {
  const it = P.productFromPage(pdp('Easy Rider', 5199, true), pd('easy-rider', 399028));
  assert.equal(it.title, 'Easy Rider'); assert.equal(it.price, 5199); assert.equal(it.currency, 'INR');
  assert.equal(it.inStock, true, 'the first size is sold out, another is in stock'); assert.equal(it.images.length, 3); assert.equal(it.handle, '399028');
  assert.equal(P.productFromPage(pdp('Gone', 999, false), pd('gone', 1)).inStock, false);
});

test('the catalog stage reads a headless store and saves the real total, the shapes and its version', async () => {
  const urls = Array.from({ length: 50 }, (_, i) => pd(`shoe-${i}`, 200000 + i)).concat(Array.from({ length: 20 }, (_, i) => `${SFCC}/in/en/collections/c-${i}`));
  const profile = { host: 'in.puma.com', platform: 'salesforce-commerce', currency: 'INR', catalog: {} }, L = [];
  const http = { get: async (u) => ({ ok: true, status: 200, url: u, text: /\/pd\//.test(u) ? pdp('Shoe ' + u.split('/').pop(), 3999, true) : page('Collection') }) };
  const ctx = { http, profile, ledger: { add: (e) => L.push(e) }, state: { origin: SFCC, pageUrls: urls, home: page('PUMA India') }, tick() {}, finding() {}, done() {}, picks() {}, render: async () => null, asset: async (s) => s, log: { warn() {} } };
  await catalog(ctx);
  assert.equal(profile.catalog.total, 50); assert.equal(profile.catalog.count, 30); assert.deepEqual(profile.catalog.shapes, ['pd/3']); assert.equal(profile.catalog.v, 2);
  assert.equal(profile.storeKind, 'store'); assert.ok(profile.catalog.hero.length > 0, 'heroes to walk with and show');
  assert.equal(products({ profile }).n, 50, 'every screen counts the whole catalog, not the 30 pages opened');
  assert.equal(storeNote({ profile: { ...profile, meta: { timings: { catalog: 1 }, errors: {} } } }), PAGES_NOTE);
});

test('a brand that sells by enquiry: its offerings are the catalog, prices as written, and it says it is not a store', async () => {
  const o = 'https://www.manaprojects.com';
  const urls = [...Array.from({ length: 60 }, (_, i) => `${o}/blog/post-${i}/`), ...Array.from({ length: 6 }, (_, i) => `${o}/project/mana-${i}/`), `${o}/about-mana/`];
  const home = '<html><body><a href="#">ENQUIRE NOW</a> <button>Book a Site Visit</button> Get in touch</body></html>';
  const proj = (i) => `<html><head><meta property="og:image" content="https://x/p${i}.jpg"><meta name="description" content="3 BHK homes off Sarjapur Road"></head><body><h1>Mana ${i}</h1><p>Starting ₹ 1.4${i} Cr onwards. Built over 25 years 1 project at a time.</p></body></html>`;
  const profile = { host: 'manaprojects.com', platform: 'custom', catalog: {} };
  const http = { get: async (u) => ({ ok: true, status: 200, url: u, text: /\/project\//.test(u) ? proj(u.match(/mana-(\d)/)[1]) : page('Blog') }) };
  const ctx = { http, profile, ledger: { add() {} }, state: { origin: o, pageUrls: urls, home }, tick() {}, finding() {}, done() {}, picks() {}, render: async () => null, asset: async (s) => s, log: { warn() {} } };
  await catalog(ctx);
  assert.equal(profile.storeKind, 'enquiry'); assert.equal(profile.catalog.offerings, 'project'); assert.equal(profile.catalog.products.length, 6);
  assert.ok(profile.catalog.products.every((x) => /^₹ 1\.4\d Cr$/.test(x.priceText) && x.price >= 14e6), 'the written price, in full');
  assert.equal(P.priceText('Built over 25 years 1 project'), null, '"rs 1" inside a word is not a price');
  assert.equal(P.priceText('Starting ₹ 1.45 Cr').price, 14500000);
  assert.equal(storeNote({ profile: { ...profile, meta: { timings: { catalog: 1 }, errors: {} } } }), ENQUIRY_NOTE);
  assert.equal(P.storeKindOf('<a href="/cart">Cart</a> Enquire now, get in touch', []), 'store', 'a site with a cart is a store');
});

test('reviews: a config key naming a vendor is not the vendor; a store that switched reviews off says so', () => {
  assert.equal(detectReviewApp('"bazaarVoiceReviewFormScriptUrl":null'), null);
  assert.equal(detectReviewApp('<script src="https://apps.bazaarvoice.com/deployments/puma/main_site/production/en_IN/bv.js"></script>'), 'bazaarvoice');
  assert.equal(detectReviewApp('powerreviewsSettings: off'), null);
  assert.equal(reviewsOff('{"ratingsAndReviewsEnabled":false}'), true); assert.equal(reviewsOff('{"reviewsEnabled":true}'), false);
  assert.deepEqual([listingOf({ name: 'Puma Tee', brand: 'Puma', rating: '4.2', ratingCount: '1,203' }).reviews, listingOf({ title: 'x', ratings: { average: 4, count: 9 } }).reviews], [1203, 9]);
});

test('the brand by any of its names: "PUMA India" is PUMA, but "Air India" stays itself', () => {
  assert.equal(brandBase('PUMA India', 'in.puma.com'), 'PUMA'); assert.equal(brandBase('Air India', 'airindia.com'), 'Air India');
  assert.equal(brandBase('Nike UK Official Store', 'nike.com'), 'Nike'); assert.equal(brandBase('The Whole Truth', 'thewholetruthfoods.com'), 'The Whole Truth');
  assert.ok(brandRe('PUMA India', [], 'in.puma.com').test('Brands like Puma and Nike'));
  const profile = { name: 'PUMA India', brandName: 'PUMA', host: 'in.puma.com', country: 'IN', ai: { answers: [{ tool: 'chatgpt', q: 'best sneakers', text: 'Try Puma or Nike.', named: false, entities: ['Puma', 'Nike'] }] } };
  const card = rescoreNamed(profile); assert.ok(card); assert.equal(profile.ai.answers[0].named, true); assert.deepEqual(profile.ai.answers[0].entities, ['Nike']); assert.equal(profile.ai.score.named, 1);
});

test('market: a WordPress en-US default never outvotes an Indian phone and Bengaluru addresses', () => {
  assert.equal(placeOf('MANA Projects, Sarjapur Road, Bengaluru 560035. Homes in Bangalore'), 'IN');
  assert.equal(placeOf('Shipping worldwide'), null);
  assert.equal(sellingMarket({ lang: 'en-us', phone: 'IN', place: 'IN', tld: 'com', hreflang: [] }).primary, 'IN');
  assert.equal(sellingMarket({ lang: 'en-us', phone: 'IN', tld: 'com', hreflang: [] }).toConfirm, true, 'too close to call: asked, never guessed as the US');
});

test('fonts: a Google Fonts spec is the family name only', () => {
  assert.equal(fontName('Cormorant:100,100italic,200|Manrope:100,200'), 'Cormorant'); assert.equal(fontName('Cormorant%3A100%2C200%7CManrope%3A100'), 'Cormorant');
});

test('connectors fit the platform: no Shopify to connect on a Salesforce Commerce store, no review app when reviews are off', () => {
  const seed = () => ({ connectors: { shopify: { name: 'Shopify' }, reviews: { name: 'Judge.me' }, marketplaces: { name: 'Amazon' }, ga4: { name: 'Google Analytics' } }, vocab: { item: 'product' } });
  const a = seed(); storeConnectors(a, { platform: 'salesforce-commerce', reviews: { onSite: 'off' } }); assert.deepEqual(Object.keys(a.connectors), ['marketplaces', 'ga4']);
  const b = seed(); storeConnectors(b, { platform: 'custom', storeKind: 'enquiry' }); assert.deepEqual(Object.keys(b.connectors), ['ga4']);
  const c = seed(); assert.equal(storeConnectors(c, { platform: 'shopify', reviews: { onSite: 'found' } }), false); assert.ok(c.connectors.shopify);
});

test('the daily check off Shopify: only pages read are compared, a failed fetch never removes a product', () => {
  const L = [{ key: 'price.399028', v: '₹5,199', n: 5199, url: pd('easy', 399028) }, { key: 'price.111', v: '₹999', n: 999, url: pd('b', 111) }, { key: 'price.222', v: '₹1,999', n: 1999, url: pd('c', 222) }];
  const items = [{ handle: '399028', title: 'Easy', price: 4599, mrp: 5199, inStock: true, url: pd('easy', 399028) }];
  const d = diffCatalog(L, items, { host: 'in.puma.com', currency: 'INR', locale: 'en-IN', partial: true, gone404: ['222'] });
  assert.deepEqual(d.changes.map((c) => c.kind).sort(), ['changed', 'removed']); assert.deepEqual(d.gone, ['222'], 'only the page that answered 404 is gone');
  assert.ok(d.ledger.some((e) => e.key === 'price.111'), 'a page that did not open keeps its price');
  assert.equal(d.ledger.find((e) => e.key === 'price.399028').src, 'in.puma.com/in/en/pd/easy/399028', 'the source is the product page itself');
});

test('listening: a run cut off by a deploy is due again (Nutrova), one in flight is not', () => {
  const cfg = socialConfig({}), now = Date.now();
  const st = { lastListen: now - 60e3, lastFullListen: now - 60e3, listen: { state: 'running', startedAt: now - 60e3, full: true, killed: true } };
  const d = dueFor(st, cfg, { now }); assert.equal(d.listen, true); assert.equal(d.listenFull, true);
  assert.equal(dueFor({ ...st, listen: { state: 'running', startedAt: now - 60e3, full: true } }, cfg, { now }).listen, false, 'running on this instance: not twice');
  assert.equal(dueFor({ ...st, listen: { state: 'running', startedAt: now - 30 * 60e3, full: true } }, cfg, { now }).listen, true, 'stale after 20 minutes');
  assert.equal(dueFor({ lastListen: now - 60e3, listen: { at: now - 60e3, items: 40 } }, cfg, { now }).listen, false);
});

test('the cards prompt never hears that checkout is broken when only the headless walk stopped', () => {
  const p = checkoutForPrompt({ walk: [{ step: 'Home', ok: true }, { step: 'Add to cart', ok: false, err: 'no add-to-cart button found' }], stopReason: 'no-add-to-cart' }, 'store');
  assert.equal(p.reached, false); assert.match(p.note, /Never write a card that says checkout or add to cart is broken/); assert.equal(p.walk, undefined);
});

test('AI questions are asked from the brand\'s market and language, never a silent default, and fit how it sells', async () => {
  const { askMarket } = await import('../market.js');
  const { templateQuestions } = await import('../reader/stages/answers.js');
  assert.deepEqual(askMarket({ country: null, market: { others: ['IN', 'US'] } }), { cc: 'IN', loc: 2356, lang: 'en', guessed: true, name: 'India' }, 'to confirm: its best candidate, said so');
  assert.equal(askMarket({ country: 'DE', locale: 'de-DE' }).lang, 'de'); assert.equal(askMarket({ country: 'NL' }).loc, 2528, 'every named market has its location');
  const q = templateQuestions({ name: 'Mana Projects', storeKind: 'enquiry', subcategory: 'residential apartments', country: 'IN', host: 'manaprojects.com' }).map((x) => x.q).join(' | ');
  assert.doesNotMatch(q, /actually works|worth buying/); assert.match(q, /best residential apartments in India/);
  assert.match(templateQuestions({ name: 'PUMA India', brandName: 'PUMA', subcategory: 'sneakers', country: 'IN', host: 'in.puma.com' }).find((x) => x.branded).q, /^is PUMA good$/);
});
