// QA 19 Oct (FEED-ARV-08, FEED-11): catalog cards read product · issue · fix, best sellers first (saying by what), one label,
// and one stock-out card that names the products our ads point to (never a second roll-up of the same products).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { salesRank, unitsFrom, handleOf } from '../catalog-rank.js';

const items = [{ handle: 'a', title: 'Cheap Thing', price: 100 }, { handle: 'b', title: 'Big Serum', price: 900 }, { handle: 'c', title: 'Mid Wash', price: 400, url: 'https://x.com/products/c?v=1' }];

test('order by units sold when a connected store has them, then the best-seller list, reviews, else price, and say which', () => {
  assert.deepEqual(salesRank(items, { units: unitsFrom('Cheap Thing (40); Mid Wash (9)') }).sorted.map((i) => i.handle), ['a', 'c', 'b']);
  assert.match(salesRank(items, { units: unitsFrom('Cheap Thing (40)') }).said, /most sold in the last 30 days/);
  assert.deepEqual(salesRank(items, { rank: { hero: ['c', 'a'], bestSellers: true } }).sorted.map((i) => i.handle), ['c', 'a', 'b']);
  assert.deepEqual(salesRank(items, { rank: { reviews: { a: 474, c: 20 } } }).sorted.map((i) => i.handle), ['a', 'c', 'b']);
  const p = salesRank(items, {}); assert.deepEqual(p.sorted.map((i) => i.handle), ['b', 'c', 'a']); assert.match(p.said, /highest price \(no sales numbers yet\)/);
  const q = salesRank(items, { quoted: new Set(['a']) }); assert.equal(q.sorted[0].handle, 'a'); assert.match(q.said, /^products our ads point to, then/);
  assert.equal(handleOf({ url: 'https://x.com/products/c?v=1' }), 'c');
});

test('one stock-out reading holds the products our ads point to; saved duplicates step aside; one label everywhere', () => {
  const lw = fs.readFileSync(new URL('../live-watch.js', import.meta.url), 'utf8'), fsvc = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(lw, /'cat-oos-q-'/, 'no second reading of the same stock-outs');
  assert.match(lw, /quoted: oosQuoted\.map\(\(x\) => x\.handle\)/);
  assert.match(fsvc, /if \(\/\^cat-oos-q-\/\.test\(e\.id\)\) return null;/, 'an old q reading makes no card');
  assert.match(fsvc, /healCatalog\(t, keep\)/, 'saved catalog cards are written again');
  assert.match(fsvc, /our ads point to/);
  assert.match(app, /catalog: 'Catalog'/); assert.doesNotMatch(app, /catalog: 'Marketplaces'/);
});
