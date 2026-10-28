// QV 28 Oct (found on one brand's feed, fixed for every brand): the card picks its own product, proof backs the claim,
// spaced number words, one stock card once a store is connected, community and complaint routing, said-once headlines,
// status words that match their numbers, and partner mode (no prices, our team makes it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.AI_MOCK = '1';

const { numeralsIn } = await import('../num-words.js');

test('C: "thirty one" is 31 and "day twenty one" is day 21, never "30 one"', () => {
  assert.equal(numeralsIn('only thirty one percent of customers buy again'), 'only 31 percent of customers buy again');
  assert.equal(numeralsIn('the reminder goes on day twenty one'), 'the reminder goes on day 21');
  assert.equal(numeralsIn('send on day twenty-one'), 'send on day 21');
  assert.equal(numeralsIn('forty one public reviews'), '41 public reviews');
  assert.equal(numeralsIn('one version, two posts a week'), 'one version, two posts a week', 'small counts stay words');
  assert.equal(numeralsIn('November twenty first'), '21 November');
});

const { cardProduct } = await import('../product-match.js');
const { draftFits } = await import('../drafts-bg.js');
const CAT = [
  { t: 'Anti-Breakage Intensive Conditioner 15ml', price: 0, tags: ['free-sample'], img: 'c15.jpg' },
  { t: 'Anti-Breakage Intensive Conditioner 200ml', price: 649, img: 'c200.jpg' },
  { t: 'Anti-Grey Hair Serum 30ml', price: 899, out: true, img: 's30.jpg' },
  { t: 'Anti-Grey Hair Serum 50ml', price: 1299, out: true, img: 's50.jpg' },
  { t: 'Scalp Massager', price: 349, img: 'm.jpg' },
];
const STOCK = { id: 'x1', title: 'Pause ads for 3 sold-out products', sub: 'Ads still send people to pages they cannot buy from.', kind: 'rows',
  rows: [['Anti-Grey Hair Serum 30ml', '0 left'], ['Anti-Grey Hair Serum 50ml', '0 left'], ['Kit', '0 left']] };

test('A: a card that lists its products in rows is about those products, never another one', () => {
  assert.equal(cardProduct(STOCK, CAT, { brand: 'Acme', byNameOnly: true })?.t, 'Anti-Grey Hair Serum 30ml');
  assert.equal(draftFits({ product: 'Anti-Breakage Intensive Conditioner 15ml' }, STOCK, { catalog: CAT, brand: 'Acme' }), false, 'a conditioner draft never sits under the serum card');
  assert.equal(draftFits({ product: 'Anti-Breakage Intensive Conditioner 200ml' }, { title: 'Show the anti-frizz routine' }, { catalog: CAT, brand: 'Acme' }), false, 'one shared word ("anti") is not a fit');
  assert.equal(draftFits({ product: 'Anti-Grey Hair Serum 30ml' }, STOCK, { catalog: CAT, brand: 'Acme' }), true);
});

const { createEvidence } = await import('../evidence.js');
test('B: an account line backs a small number only when it is about what the card says', () => {
  const EV = createEvidence({ factsOf: () => ({}), movesOf: () => ({}), numsOf: () => [] });
  const ledger = { 'shopify.carts.7d': { v: 'MitoActive (473 carts), Scalp Massager (3 carts)', label: 'Abandoned carts by product' }, 'shopify.stock': { v: '3 products sold out: Anti-Grey Hair Serum 30ml, 50ml, Kit', label: 'Sold out' } };
  const e = EV.evidenceOf(STOCK, { liveLedger: ledger });
  const acct = e.items.filter((x) => x.kind === 'account');
  assert.ok(!acct.some((x) => /carts/i.test(x.value)), 'the cart line never backs a sold-out card');
  assert.ok(acct.some((x) => /sold out/i.test(x.label)), 'the stock line does');
  const big = EV.evidenceOf({ id: 'r', title: 'Your store made ₹2,40,000', sub: 'A good month.' }, { liveLedger: { 'shopify.revenue.30d': { v: '₹2,40,000', label: 'Revenue, last 30 days' } } });
  assert.ok(big.items.some((x) => x.kind === 'account'), 'an exact big number still backs its card');
});

import fs from 'node:fs';
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test('D: once Shopify is connected, stock comes from it one to one; two stock cards on the same products are one', () => {
  const fsvc = src('feed-service.js');
  assert.match(fsvc, /\(e\.kind === 'oos' \|\| e\.kind === 'back'\) && t && connOn\(t, 'shopify'\)\) return null;/, 'the page check makes no stock card once Shopify is connected');
  assert.match(fsvc, /!\(c\.liveSrc\?\.kind === 'catalog' && \/\^\(Out of stock\|Back in stock\)\$\/\.test\(\(c\.badge \|\| \[\]\)\[0\] \|\| ''\) && connOn\(t, 'shopify'\)\)/, 'a saved one steps aside');
  assert.match(fsvc, /return `one:stock:\$\{ps\.join\('\|'\)\}`/, 'the same products make one stock card, whatever made them');
});
