// The jam's one product (26 Oct, Arata ch_4bf67190): the card named the ₹2,182 combo, the Studio re-read the ad's loose words,
// met "Anti-Breakage Intensive Conditioner" as an ingredient and drew the free, sold-out 15ml sample. Guards for every brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { catalogOf, matchProduct, pricedProduct, inStockTwin, isRestock } from '../product-match.js';
import { productTiles, productFor } from '../jam2/ingredients.js';

const P = (title, price, o = {}) => ({ title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), price, priceLabel: price ? `₹${Math.round(price).toLocaleString('en-IN')}` : undefined, inStock: true, img: `${title}.jpg`, images: [`${title}.jpg`, `${title}-2.jpg`], tags: [], ...o });
const cat = catalogOf({ catalog: { products: [
  P('Anti-Breakage Intensive Conditioner - 15ml', null, { inStock: false, tags: ['free-product', 'search-hide'] }),
  P('Oil-Control Face Wash - 15 ml', null, { tags: ['free-product'] }),
  P('MitoActive + Anti-Hair Fall Shampoo & Conditioner Combo', 2182.15),
  P('MitoActive + Anti-Hair Fall Shampoo Combo', 1803),
  P('Brightening Face Serum - 30 ml', 399, { inStock: false }),
  P('Brightening Face Serum - 50 ml', 599),
  P('Oil-Control Face Wash - 100 ml - Pack of 3', 852),
  P('Oil-Control Face Wash - 100 ml', 299),
  P('Anti-Breakage Intensive Conditioner - 200 ml', 399),
  P('Hair Growth Intensive Serum - 30 ml - Pack of 3', 1947),
  P('Hair Growth Intensive Serum - 30 ml', 642),
] } });
const M = (s) => matchProduct(s, cat, { brand: 'Arata' })?.t;

test('catalog rows say what a shopper can buy: free samples and handles carried', () => {
  const s = cat.find((x) => /Conditioner - 15ml/.test(x.t)); assert.equal(s.free, true); assert.equal(s.out, true); assert.ok(s.handle);
  assert.equal(cat.find((x) => /200 ml/.test(x.t)).free, undefined);
});

test('the ad naming an ingredient never pulls the free sample; a stated price picks the product at that price', () => {
  assert.equal(M('78% stronger hair in 1 wash with Anti-Breakage Intensive Conditioner'), 'Anti-Breakage Intensive Conditioner - 200 ml');
  assert.equal(M('MitoActive + Anti-Hair Fall Combo at ₹2,182.15'), 'MitoActive + Anti-Hair Fall Shampoo & Conditioner Combo', 'paise against a rounded label');
  assert.equal(pricedProduct('Reduce hair fall with our ₹2,182.15 MitoActive combo', cat, { brand: 'Arata' })?.t, 'MitoActive + Anti-Hair Fall Shampoo & Conditioner Combo');
  assert.equal(M('Our Oil-Control Face Wash keeps shine down'), 'Oil-Control Face Wash - 100 ml', 'full size over the sample, single over the pack');
  assert.equal(M('Hair Growth Intensive Serum'), 'Hair Growth Intensive Serum - 30 ml');
  assert.equal(M('Stock up: Hair Growth Intensive Serum pack of 3'), 'Hair Growth Intensive Serum - 30 ml - Pack of 3', 'a pack asked for is a pack');
});

test('a sold-out product stays itself (flagged), and moves only to its own in-stock twin', () => {
  assert.equal(M('Brightening Face Serum for dull skin'), 'Brightening Face Serum - 50 ml', 'same name: the size in stock wins the tie');
  const s = matchProduct('Brightening Face Serum - 30 ml for dull skin', cat, { brand: 'Arata' });
  assert.equal(s.t, 'Brightening Face Serum - 30 ml', 'a size written out stays that size'); assert.equal(s.out, true, 'flagged, never re-matched to a face wash');
  assert.equal(inStockTwin(s, cat)?.t, 'Brightening Face Serum - 50 ml');
  assert.equal(inStockTwin(cat.find((x) => /Conditioner - 15ml/.test(x.t)), cat)?.t, 'Anti-Breakage Intensive Conditioner - 200 ml');
  const only = catalogOf({ catalog: { products: [P('Solo Balm', 200, { inStock: false }), P('Other Thing', 100)] } });
  assert.equal(inStockTwin(only[0], only), null, 'no twin: never a different product');
});

test('restock is read from the card only: the ad saying "before it sells out" is no restock', () => {
  assert.equal(isRestock({ title: 'Brightening serum is back in stock' }), true);
  assert.equal(isRestock({ title: 'Open pre-orders for the winter kit' }), true);
  assert.equal(isRestock({ title: 'Sell more serum', sub: 'Push it to new buyers' }), false);
  const rx = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.match(rx, /pr\?\.out && !isRestock\(card\)/, 'the publish check uses the card, not the copy');
  assert.match(fs.readFileSync(new URL('../jam2/studio.js', import.meta.url), 'utf8'), /return isRestock\(ctx\.card \|\| \{\}\) \? null/, 'Studio and publish share one restock rule');
});

test('the Studio and the words use one product: card first, then a touched jam’s words, then the draft', () => {
  const rx = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.match(rx, /const productOfCh = \(t, chId\) => \{[\s\S]{0,200}const r = jamProduct\(t, ch, c\)/, 'Studio reads jamProduct');
  assert.equal((rx.match(/productLine\(c, jamProduct\(t, ch, c\)\?\.t \|\| pkgWords\(ch\)/g) || []).length, 3, 'every rewrite of the words names the same product');
  assert.match(rx, /m = byTitle\(c\.product\)/, 'the product the card names outright leads');
  assert.match(rx, /touched && words && matchProduct\(words, cat, \{ brand, byNameOnly: true \}\)/, 'the words lead only once the team worked the jam');
});

test('picker tiles: sold out last and marked, samples after what a shopper can buy; the lead product is never a free sample', () => {
  const tiles = productTiles(cat, 50);
  assert.ok(tiles.at(-1).out && tiles.at(-2).out, 'sold out last'); assert.equal(tiles.filter((x) => x.out).length, 2);
  assert.ok(!tiles[0].out && !/15 ?ml$/.test(tiles[0].name));
  assert.equal(productFor({ card: { title: 'Say hello' }, catalog: cat })?.name, 'MitoActive + Anti-Hair Fall Shampoo & Conditioner Combo');
});

test('Studio: a make uses the product that was priced; a stale sold-out swap is let go; soldOut finds the row by handle or photo', () => {
  const rt = fs.readFileSync(new URL('../jam2/routes.js', import.meta.url), 'utf8');
  assert.match(rt, /else sp\.product = ctx\.product\?\.img \? \{ img: ctx\.product\.img/, 'cleanSpec pins the priced product');
  assert.match(rt, /const keep = jam\.product && !\(/, 'a sold-out swap is let go on read, never rewritten');
  const st = fs.readFileSync(new URL('../jam2/studio.js', import.meta.url), 'utf8');
  assert.match(st, /P\.handle && x\?\.handle === P\.handle\) \|\| \(P\.img && \(x\?\.img === P\.img/);
});
