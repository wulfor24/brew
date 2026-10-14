// A draft's picture shows the product its words name: the matcher, on a made-up catalog (any brand).
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchProduct, catalogOf } from '../product-match.js';

const profile = { catalog: { products: [
  { title: 'Aeres HUKUM IVORY', images: ['https://cdn/x/hukum.jpg'] },
  { title: 'Aeres DRIFTWOOD', images: ['https://cdn/x/drift.jpg'] },
  { title: 'Aeon V2 DEEPSPACE', img: '/b/acme/a/deep.jpg' },
  { title: 'X Lows DILLI', images: ['https://cdn/x/Sold_out_1.jpg', 'https://cdn/x/dilli.jpg'] },
  { title: 'Astra DAY DREAM', images: ['https://cdn/x/day.jpg'] },
  { title: "Women's Recycled Tee - Mother Nature", images: ['https://cdn/x/tee.jpg'] },
  { title: 'Gift Card', images: ['https://cdn/x/gift.jpg'] },
  ...Array.from({ length: 30 }, (_, i) => ({ title: `Aeres CORE ${i}`, images: [`https://cdn/x/core${i}.jpg`] })),
] } };
const cat = catalogOf(profile), m = (t) => matchProduct(t, cat, { brand: 'Acme' })?.t || null;

test('the catalog keeps a product whose first photo is a sold-out placeholder, and drops gift cards', () => {
  assert.equal(cat.find((x) => x.t === 'X Lows DILLI').img, 'https://cdn/x/dilli.jpg');
  assert.ok(!cat.some((x) => /gift card/i.test(x.t)));
});

test('copy that names a product gets that product', () => {
  assert.equal(m('Quiet elegance. The Hukum collection, lotus and paisley on ivory.'), 'Aeres HUKUM IVORY');
  assert.equal(m('Aeon V2 Deep Space: our lightest runner'), 'Aeon V2 DEEPSPACE', 'deep space names DEEPSPACE');
  assert.equal(m('X Lows DILLI, a tribute to Delhi'), 'X Lows DILLI');
});

test('everyday words never pick a product by accident', () => {
  assert.equal(m('Sneakers for every day'), null, '"day" is not Astra DAY DREAM');
  assert.equal(m('Made from nature'), null, 'lowercase "nature" is not the Mother Nature tee');
  assert.equal(m('Nature made this.'), null, 'a capital at the start of a sentence is not a name');
  assert.equal(m('Acme makes shoes'), null, 'the brand name counts for nothing');
  assert.equal(m('Aeres for the weekend'), null, 'a word shared by most of the catalog names no one product');
  assert.equal(matchProduct('Hukum', [], {}), null);
});

import { fitPhotos } from '../brand-pack.js';
test('every picture card that names a product shows that product (any card source)', () => {
  const seed = { brand: { name: 'Acme' }, posts: [
    { id: 'a', kind: 'media', title: 'Run the Hukum carousel as a paid ad', sub: '', images: ['https://cdn/x/drift.jpg'] },          // wrong catalog product → fixed
    { id: 'b', kind: 'media', title: 'Aeres DRIFTWOOD for the weekend', sub: '', images: ['https://cdn/x/drift.jpg'] },            // already right → kept
    { id: 'c', kind: 'media', title: 'The Hukum ad that ran in May', sub: '', images: ['/b/acme/a/ad-123.jpg'] },                   // a real ad, not a catalog shot → kept
    { id: 'd', kind: 'media', title: 'Hukum, three ways', sub: '', images: ['https://cdn/x/drift.jpg', 'https://cdn/x/core1.jpg'] }, // a carousel → kept
    { id: 'e', kind: 'rows', title: 'The Hukum collection', sub: '' },                                                               // not a picture card
    { id: 'f', kind: 'media', title: 'Comfort for every day', sub: '', images: ['https://cdn/x/drift.jpg'] },                     // names nothing → kept
  ] };
  fitPhotos(seed, profile);
  const img = (id) => seed.posts.find((x) => x.id === id).images?.[0];
  assert.equal(img('a'), 'https://cdn/x/hukum.jpg'); assert.deepEqual(seed.posts[0].photoFit, { was: 'Aeres DRIFTWOOD', now: 'Aeres HUKUM IVORY' });
  assert.equal(img('b'), 'https://cdn/x/drift.jpg'); assert.equal(img('c'), '/b/acme/a/ad-123.jpg'); assert.equal(img('d'), 'https://cdn/x/drift.jpg'); assert.equal(img('f'), 'https://cdn/x/drift.jpg');
});
