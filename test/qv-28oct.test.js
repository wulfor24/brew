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
