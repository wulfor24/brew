// Test and duplicate listings never become card photos, draft products or lane products (QA 20 Oct)
import test from 'node:test';
import assert from 'node:assert/strict';
import { sellable, catalogOf } from '../product-match.js';
import { laneProducts } from '../derive.js';
test('sellable', () => {
  assert.equal(sellable({ title: 'Sunscreen Gel - 50 ml - Pack of 3 Test Product' }), false);
  assert.equal(sellable({ title: 'GL Event test' }), false);
  assert.equal(sellable({ title: 'Hair Serum', url: 'https://x.com/products/hair-serum-copy' }), false);
  assert.equal(sellable({ title: 'UCARI Urine Test Kit' }), true, 'a real test kit');
  assert.equal(sellable({ title: 'Test Kit for pH' }), true);
  assert.equal(sellable({ title: 'Hair Growth Intensive Serum' }), true);
});
test('catalog and lanes skip them', () => {
  const profile = { host: 'x.com', catalog: { products: [{ title: 'Sunscreen Gel Test Product', img: 'a.jpg' }, { title: 'Sunscreen Gel', img: 'b.jpg' }] } };
  assert.deepEqual(catalogOf(profile).map((x) => x.t), ['Sunscreen Gel']);
  assert.equal(laneProducts({ lanes: { core: { line: 'Sunscreen Gel Test Product' } } }, profile).laneProducts.core.name, 'Sunscreen Gel');
});
