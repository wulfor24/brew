// The jam builds around the product and channel the card names, and says the spend its own package carries.
// Found live on 2026-10-16 (a test brand): a "Launch Meta prospecting" card opened a Google Search ad for the brand's
// first lane product, a foot-warmer carousel was remade as a sleep-mask reel, and a $15/day ad group read "About $1,000
// a week". Every case here is brand-agnostic: two made-up catalogs, any lane, any currency. No AI, nothing paid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runIn } from '../brand-ctx.js';
import { productFor, mockPkg } from '../studio.js';
import { recipeOfCard, amountOf, namedChannel } from '../remix.js';
import { catalogOf } from '../product-match.js';

const brand = (name, host, products, lanes) => {
  const profile = { catalog: { products: products.map(([title, price, claim]) => ({ title, priceLabel: price, url: `https://${host}/products/${title.toLowerCase().replace(/\W+/g, '-')}`, img: `https://cdn.${host}/${title.length}.jpg`, claims: claim ? [claim] : [] })) } };
  const laneProducts = Object.fromEntries(Object.entries(lanes).map(([k, title]) => [k, { name: title, short: title, price: '', claim: '', hook: title, page: `https://${host}/`, photo: `The ${title}` }]));
  return { slug: host, name, host, sym: '$', catalog: catalogOf(profile), config: { laneProducts }, seed: { brand: { name, host } } };
};
const COZY = brand('Cozy Snugglet', 'cozy.test', [['Snugglet Hush Mask – Wide Sleep Mask with Ear Covers', '$29'], ['Snugglet Toe Toasters – USB Heated Plush Bootie Slippers', '$34'], ['Snugglet Paw Warmer – USB Heated Foot Warmer', '$39', 'Warms in 60 seconds'], ['Snugglet Bear Socks – Fuzzy Sleep Socks', '$24'], ['Snugglet Duck Glow – Night Light', '$24']],
  { 'sleep-mask': 'Snugglet Hush Mask – Wide Sleep Mask with Ear Covers', 'night-light': 'Snugglet Duck Glow – Night Light' });
const TEA = brand('Leaf & Co', 'leaf.test', [['Assam Breakfast Tea', '₹450'], ['Kashmiri Kahwa Green Tea', '₹520'], ['Himalayan Oolong', '₹890']], { black: 'Assam Breakfast Tea' });

test('the jam is about the product the card names, not the first product of its lane', () => {
  const card = { id: 'm20-1-p', lane: 'sleep-mask', title: 'Launch Meta prospecting for freezing office workers', sub: 'Turn active USB-heating into a customer acquisition engine.', make: { format: 'single image ad', pieces: '1 raw photo: Snugglet Toe Toasters plugged into a laptop under a desk' } };
  const P = runIn(COZY, () => productFor(card, {}));
  assert.match(P.name, /Toe Toasters/);
  assert.equal(P.page, 'https://cozy.test/products/snugglet-toe-toasters-usb-heated-plush-bootie-slippers');
  assert.equal(P.price, '$34');
  assert.ok(P.img, 'the matched product brings its own photo');
  // the offline package follows it too
  const pkg = runIn(COZY, () => mockPkg('search', 'performance.search_ad', card, 0, '', {}));
  assert.doesNotMatch(JSON.stringify(pkg), /Hush Mask/);
  // another brand, another catalog: same rule
  const tea = runIn(TEA, () => productFor({ lane: 'black', title: 'Post the Kashmiri Kahwa ritual carousel', sub: 'Saffron and almonds.' }, {}));
  assert.equal(tea.name, 'Kashmiri Kahwa Green Tea');
});

test('a card that names no product keeps its lane product; a package\'s own words lead a remake', () => {
  const plain = { lane: 'night-light', title: 'Post a calm bedtime routine', sub: 'Three steps people can save.' };
  assert.match(runIn(COZY, () => productFor(plain, {})).name, /Duck Glow/);
  assert.match(runIn(COZY, () => productFor({ lane: 'nowhere', title: 'A plain card' }, {})).name, /Hush Mask/, 'an unknown lane still falls back to the first lane product');
  // the remake: the package talks about the Paw Warmer, the card about the brand's heating in general
  const card = { lane: 'sleep-mask', title: 'Publish pure comfort proof carousel post', sub: 'Standard socks only trap cold air while our products actively heat.' };
  const words = 'Is a USB heated foot warmer safe to sleep with? Ready for warm cozy nights? Snugglet Paw Warmer is only $39.';
  const P = runIn(COZY, () => productFor(card, {}, words));
  assert.match(P.name, /Paw Warmer/); assert.equal(P.claim, 'Warms in 60 seconds');
  // no catalog at all (a brand read without products): the lane product, as before
  assert.equal(runIn({ ...COZY, catalog: [] }, () => productFor(card, {}, words)).name, COZY.config.laneProducts['sleep-mask'].name);
});

test('a card that names Meta never opens as a Google Search ad, and the other way round', () => {
  const meta = { id: 'x', sector: 'creatives', agent: 'creative', kind: 'media', type: 'idea', title: 'Launch Meta prospecting for freezing office workers', sub: 'One image ad.', cta: { label: 'Launch the ad group' }, make: { format: 'single image ad' } };
  assert.equal(namedChannel(meta), 'meta');
  assert.equal(runIn(COZY, () => recipeOfCard(meta)).primary, 'creative.add_variants');
  assert.equal(runIn(COZY, () => recipeOfCard({ ...meta, make: null })).primary, 'performance.new_test', 'no planned format: Meta\'s own launch');
  const google = { ...meta, title: 'Launch Google search ads for "heated slippers"', cta: { label: 'Publish Campaign' }, sector: 'ads', make: null };
  assert.equal(runIn(COZY, () => recipeOfCard(google)).primary, 'performance.search_ad');
  // a card that names no channel keeps its button's job; a non-ad job is never moved
  assert.equal(runIn(COZY, () => recipeOfCard({ ...meta, title: 'Win the heated slipper searches', make: null })).primary, 'performance.search_ad');
  assert.equal(runIn(COZY, () => recipeOfCard({ ...meta, title: 'Meta pixel misses purchases', cta: { label: 'Fix tracking' }, sector: 'ads', make: null })).primary, 'performance.tracking_fix');
  // naming both channels decides nothing
  assert.equal(namedChannel({ title: 'Split budget between Meta and Google' }), null);
});

test('spend is a week of the package\'s own daily budget, in any currency, with no floor', () => {
  const money = { money: true };
  assert.equal(amountOf(money, 'search', { dailyBudget: 15 }), 105, '$15/day is $105 a week, not $1,000');
  assert.equal(amountOf(money, 'meta_ad', { dailyBudget: 2500 }), 17500);
  assert.equal(amountOf(money, 'meta_ad', {}), 0, 'no budget in the package: none is invented');
  assert.equal(amountOf(money, 'meta_ops', { spendChangeWeek: 300 }), 300);
  assert.equal(amountOf({ money: false }, 'search', { dailyBudget: 15 }), 0);
});

test('a product written out by its own name beats loose word overlap', async () => {
  const { matchProduct } = await import('../product-match.js');
  const cat = [{ t: 'Snugglet Kitty Toes – Plush USB Heated Foot Warmer', img: 'a' }, { t: 'Snugglet Paw Warmer – USB Heated Foot Warmer', img: 'b' }, { t: 'Snugglet Paw Gloves – Cat Paw Gloves', img: 'c' }, { t: 'Snugglet Toasty Toes – Heated Slippers', img: 'd' }];
  const text = 'Is a USB heated foot warmer safe? Plug it in to toast your toes. Snugglet Paw Warmer is only $39.';
  assert.equal(matchProduct(text, cat, { brand: 'Cozy Snugglet' })?.t, 'Snugglet Paw Warmer – USB Heated Foot Warmer');
  assert.equal(matchProduct('Our Himalayan Oolong, rolled by hand', [{ t: 'Assam Breakfast Tea', img: 'x' }, { t: 'Himalayan Oolong', img: 'y' }, { t: 'Himalayan Green', img: 'z' }])?.t, 'Himalayan Oolong');
});
