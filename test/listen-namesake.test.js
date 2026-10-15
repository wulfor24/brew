// A brand's bare one-word name is also a person, a show or a shop: alone it never makes a post "about the brand" (every brand).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createListenWatch } from '../listen-watch.js';

const cfg = { name: 'Acme', host: 'acme.in', products: ['MitoActive™ Hair Serum - 30 ml'], terms: { brand: [], products: [], rivals: [], category: [], problems: [], questions: ['does acme die in season two', 'is acme serum good for hair fall'] },
  filter: { strong: ['acme.in', 'acme', 'acme serum'], weak: ['acme'], must: ['hair', 'serum'], junk: [], rivals: ['rivalco'], needs: ['hair fall'] } };
const item = (id, title, extra = {}) => ({ id, platform: 'news', title, text: title, about: 'brand', q: 'brand', ...extra });
const items = [item('a', 'Japan names Acme Takebe as farm minister'), item('b', 'Acme serum stopped my hair fall'), item('c', 'day 8/90 acme mitoactive journey'),
  item('d', 'Been using it for three weeks and my partner noticed the difference', { platform: 'youtube', kind: 'comment', threadTitle: 'Acme on Shark Tank' }), item('e', 'acme.in delivered fast')];
const packs = { getJSON: async (s, n, d) => (n === 'listen/items.json' ? { items } : n === 'listen/config.json' ? cfg : d), put: async () => {} };

test('saved posts about a namesake leave on read; posts naming a product, a phrase, the domain or under a brand video stay', async () => {
  const r = await createListenWatch({ slug: 'acme', packs, log: { warn() {} } }).read();
  assert.deepEqual(r.items.map((x) => x.id).sort(), ['b', 'c', 'd', 'e']);
});
