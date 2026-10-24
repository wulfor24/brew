// Whose products a store sells (assortment.js), for every kind of store: a curated retailer with its own label (Scrubroom,
// 24 Oct: 68 of 140 Littmann, read as a plain apparel brand), a multi-brand shop, a mixed one, and the D2C brands that must
// stay "own" whatever their vendor field says
import test from 'node:test';
import assert from 'node:assert/strict';
import { assortmentOf, assortmentLine, brandGroups } from '../assortment.js';
import { productFromPage } from '../reader/products.js';

const many = (brand, n) => Array.from({ length: n }, () => ({ brand }));
const scrub = [...many('Littmann', 68), ...many('3M Littmann', 6), ...many('ScrubStory LivFresh', 16), ...many('Scrubstory', 13), ...many('ScrubStory Lite', 6), ...many('Cherokee WW Originals Ultra', 11), ...many('Cherokee WW Revolution', 8), ...many('Healing Hands HH Works', 10), ...many('Scrubroom', 1)];
const about = 'The brand brings international medical labels to India and has its own homegrown performance scrub brand, Scrub Story.';

test('a store selling mostly other brands is a curated retailer, and its own label is named', () => {
  const a = assortmentOf({ products: scrub, name: 'Scrubroom', host: 'scrubroom.in', about });
  assert.equal(a.kind, 'retailer'); assert.ok(a.otherShare > 0.6);
  assert.deepEqual(a.others.map((g) => g.name), ['Littmann', 'Cherokee WW', 'Healing Hands HH Works']);
  assert.deepEqual(a.own.map((x) => x.toLowerCase()).sort(), ['scrubroom', 'scrubstory']);
  const line = assortmentLine(a, 'Scrubroom'); assert.match(line, /curated retailer/); assert.match(line, /Littmann/); assert.match(line, /never as their maker/);
});

test('a multi-brand shop with no label of its own, and a mixed one', () => {
  const shoes = assortmentOf({ products: [...many('Nike', 40), ...many('Adidas', 30), ...many('New Balance', 20)], name: 'Sole Street', host: 'solestreet.in' });
  assert.equal(shoes.kind, 'retailer'); assert.deepEqual(shoes.own, []); assert.match(assortmentLine(shoes, 'Sole Street'), /No own label/);
  const mixed = assortmentOf({ products: [...many('Bloom Tea', 60), ...many('Twinings', 25), ...many('Lipton', 15)], name: 'Bloom Tea', host: 'bloomtea.com' });
  assert.equal(mixed.kind, 'mixed'); assert.match(assortmentLine(mixed, 'Bloom Tea'), /own label and other brands/);
});

test('a D2C brand stays its own: one vendor whatever it is called, a supplier vendor, a small collab', () => {
  assert.equal(assortmentOf({ products: many('Arata', 93), name: 'Arata', host: 'arata.in' }).kind, 'own');
  assert.equal(assortmentOf({ products: many('Zero Chemicals Pvt Ltd', 50), name: 'Arata', host: 'arata.in' }).kind, 'own', 'a company name as vendor is still one brand');
  assert.equal(assortmentOf({ products: [...many('Cozy Snugglet', 40), ...many('Zendrop', 30)], name: 'Cozy Snugglet', host: 'cozysnugglet.shop' }).kind, 'own', 'a dropship supplier is not a brand');
  assert.equal(assortmentOf({ products: [...many('Nutrova', 40), ...many('Nutrova x Mira', 2)], name: 'Nutrova', host: 'nutrova.com' }).kind, 'own');
  assert.equal(assortmentLine({ kind: 'own', own: ['Arata'], others: [] }, 'Arata'), null);
});

test('a catalog that names no brands says nothing rather than guessing', () => {
  const a = assortmentOf({ products: [{ title: 'Tee' }, { title: 'Cap' }, { title: 'Bag' }, { title: 'Sock' }], name: 'Shop', host: 'shop.com' });
  assert.equal(a.kind, null); assert.equal(assortmentLine(a, 'Shop'), null);
  assert.equal(brandGroups([{ brand: 'Default Vendor' }, { brand: 'vendor' }]).length, 0);
});

test('a product page on any platform keeps its JSON-LD brand', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Classic III Stethoscope', brand: { '@type': 'Brand', name: 'Littmann' }, offers: { '@type': 'Offer', price: '9800', priceCurrency: 'INR', availability: 'https://schema.org/InStock' } })}</script>`;
  const p = productFromPage(html, 'https://example.com/p/classic-iii');
  assert.equal(p.vendor, 'Littmann');
});

test('a saved read gets its assortment by adding brands to its catalog, never by reading the catalog again', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../reader/index.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('if (assortStale && '), src.indexOf("if (reviewsStale || changed.includes('catalog'))"));
  assert.ok(block.length > 100); assert.doesNotMatch(block, /catalog\(ctx\)/, 'a heal re-run once read 6 of 140 products');
  assert.match(block, /p\.brand = byHandle\.get/); assert.match(block, /429/);
});
