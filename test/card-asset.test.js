// A card's picture and first draft show the product its words promise (product-match.js cardProduct, cardScene).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardProduct, cardScene } from '../product-match.js';
import { fitCta } from '../cards-gen.js';

const catalog = [
  { t: 'Snugglet Bunny Hand Warmer – USB Plush Hand Pillow', img: 'bunny.jpg' },
  { t: 'Snugglet Toe Toasters – USB Heated Plush Bootie Slippers', img: 'toe.jpg' },
  { t: 'Snugglet Donut Buddy – Plush Office Chair Back Cushion', img: 'donut.jpg' },
  { t: 'Snugglet Bear Socks – Fuzzy Coral Fleece Sleep Socks', img: 'socks.jpg' },
  { t: 'The Desk Day Kit – Heated Hand Pillow, Heated Mouse Pad + Bear Socks', img: 'kit.jpg' }
];
const brand = 'Cozy Snugglet';

test('the asset line names the product when the title names none', () => {
  const c = { title: 'Launch Meta prospecting for freezing office workers', sub: 'We saw Cozy Snugglet has zero active campaigns today.', make: { format: 'single image ad', pieces: '1 static image: a cozy office worker at her desk wearing Snugglet Toe Toasters' } };
  assert.equal(cardProduct(c, catalog, { brand })?.t, catalog[1].t);
  assert.match(cardScene(c), /office worker at her desk wearing Snugglet Toe Toasters\.$/);
});

test('a product the title names outright wins over the pieces its asset line lists', () => {
  const c = { title: 'Build the Desk Day Kit cold prospecting ad', sub: '', make: { format: 'single image ad', pieces: '1 static image: showing the heated hand pillow, heated mouse pad, and bear socks' } };
  assert.equal(cardProduct(c, catalog, { brand })?.t, catalog[4].t);
});

test('loose words in an asset line never pick a product', () => {
  const c = { title: 'Adopt a dual product model', sub: '', make: { format: 'single image ad', pieces: '2 target tracks: the Freezing Office Worker and the Sleep Seeker' } };
  assert.equal(cardProduct(c, catalog, { brand, byNameOnly: true }), null);
});

test('a Google search button on a Meta asset card becomes the format’s own button', () => {
  assert.equal(fitCta({ cta: { label: 'Launch the ad group' }, make: { format: 'single image ad' } }).cta.label, 'Generate versions');
  assert.equal(fitCta({ cta: { label: 'Launch the ad group' } }).cta.label, 'Launch the ad group');
});
