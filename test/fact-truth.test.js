// One connected truth (facts-desk.js truthOf): a visitor sees the public sheet only, a member sees their live connected facts over
// it, stale and simulated accounts never count, and a site value a connected one replaced leaves (it no longer passes the gate).
import test from 'node:test';
import assert from 'node:assert/strict';
import { truthOf, liveTruth, replacedKeys, connectedFacts, factTruth } from '../facts-desk.js';
import { viewerPack } from '../brand-pack.js';
import { countsOf, freshCounts } from '../card-nums.js';
import { packSource } from '../claims.js';

const pub = {
  catalog_count: { key: 'catalog.count', label: 'Products in the catalog', v: '42', n: 42, at: '2026-10-01' },
  catalog_out_of_stock: { key: 'catalog.out_of_stock', label: 'Products out of stock', v: '9', n: 9, at: '2026-10-01' },
  reviews_judgeme_count: { key: 'reviews.judgeme.count', label: 'Reviews on the store', v: '310', n: 310, at: '2026-10-01' },
  reviews_total: { key: 'reviews.total', label: 'Reviews', v: '305', n: 305, at: '2026-10-01' },
  brand_name: { key: 'brand.name', label: 'Brand', v: 'Cozy', at: '2026-10-01' }
};
const row = (key, label, v, n, extra = {}) => ({ key, label, v, n, at: '2026-10-23T08:00:00Z', method: `account:${key.split('.')[0]}`, src: 'Shopify · cozy.myshopify.com', ...extra });
const ledger = [row('shopify.products.active', 'Active products (Shopify admin)', '37', 37), row('shopify.products.out_of_stock', 'Out of stock products (Shopify admin)', '4', 4),
  row('shopify.aov', 'Average order value, 30 days', '$48.20', 48.2), row('reviews.judgeme.total', 'Judge.me reviews', '388', 388)];

test('a visitor gets the public sheet only: no connected number, nothing removed', () => {
  const priv = connectedFacts(ledger, pub), t = truthOf(pub, priv, { member: false });
  assert.deepEqual(t, pub);
  assert.ok(!Object.values(t).some((f) => f.connected));
});

test('a member: connected facts take over the site ones they replace (precedence), and replaced site keys leave', () => {
  const priv = connectedFacts(ledger, pub), t = truthOf(pub, priv, { member: true });
  assert.equal(t.catalog_count.v, '37'); assert.equal(t.catalog_count.connected, 'shopify'); assert.equal(t.catalog_count.was.v, '42');
  assert.equal(t.catalog_out_of_stock.v, '4');
  assert.equal(t.reviews_judgeme_count.v, '388');
  assert.ok(!('reviews_total' in t), 'every site key the connected fact replaces leaves, not only the first');
  assert.equal(t.shopify_aov.v, '$48.20'); assert.equal(t.brand_name.v, 'Cozy');
  assert.ok(!Object.values(t).some((f) => !f.connected && ['42', '9', '305', '310'].includes(f.v)));
  assert.deepEqual([...replacedKeys(pub, t)].sort(), ['catalog.count', 'catalog.out_of_stock', 'reviews.judgeme.count', 'reviews.total']);
});

test('stale and simulated accounts never count; the site value stays the truth', () => {
  const L = [row('shopify.products.active', 'Active products', '37', 37, { stale: true, staleWhy: 'kept failing' }), row('shopify.aov', 'AOV', '$10', 10, { demo: true })];
  const priv = connectedFacts(L, pub), t = truthOf(pub, priv, { member: true });
  assert.equal(t.catalog_count.v, '42');
  assert.ok(!Object.values(t).some((f) => f.connected));
  /* a stale row saved before the precedence (laid over the site key) is dropped too */
  const t2 = truthOf(pub, { catalog_count: { ...pub.catalog_count, v: '37', kind: 'connected', connected: 'shopify', key: 'shopify.products.active', stale: true } }, { member: true });
  assert.equal(t2.catalog_count.v, '42');
});

test('liveTruth from the team\'s live rows matches the private sheet', () => {
  const live = Object.fromEntries(ledger.map(({ key, ...e }) => [key, e]));
  const a = liveTruth(pub, live), b = truthOf(pub, connectedFacts(ledger, pub), { member: true });
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  assert.equal(a.catalog_count.v, '37');
});

test('the member pack gates on the truth: a replaced site number fails, the connected one passes; the public pack is unchanged', () => {
  const p = { facts: pub, catalog: [], seed: { brand: { name: 'Cozy' } }, numbers: null };
  p.factOk = new Set(['42']); /* the public pack's own, untouched */
  const t = truthOf(pub, connectedFacts(ledger, pub), { member: true }), v = viewerPack(p, t, replacedKeys(pub, t));
  assert.ok(v.factOk.has('$48.2'), 'the connected AOV passes the gate for the team');
  assert.ok(!viewerPack(p, pub).factOk.has('$48.2'), 'and never for the public sheet');
  assert.match(v.factBrief, /\$48\.20/); assert.doesNotMatch(v.factBrief, /: 42\b/);
  assert.equal(p.factOk.has('42'), true); assert.equal(p.facts, pub);
  assert.match(packSource(v), /48\.20/); assert.doesNotMatch(packSource(p), /48\.20/);
});

test('a public card never gets a connected number; a member\'s card heals to it (and the team\'s own cards too)', () => {
  const card = { id: 'm05-1', title: 'Sell out less', sub: 'Your 42 products in the catalog need photos.', rows: [['Products in the catalog', '42']] };
  const publicCounts = countsOf(pub, [], 'Cozy');
  assert.equal(freshCounts(card, publicCounts), card);
  const t = truthOf(pub, connectedFacts(ledger, pub), { member: true }), memberCounts = countsOf(t, [], 'Cozy');
  const out = freshCounts(card, memberCounts, { live: true });
  assert.equal(out.rows[0][1], '37'); assert.match(out.sub, /37 products/);
  const live = { ...card, id: 'm05-1-p', liveOnly: true };
  assert.equal(freshCounts(live, memberCounts), live, 'a public serve never touches a team card');
  assert.equal(freshCounts(live, memberCounts, { live: true }).rows[0][1], '37');
});

test('factTruth reads the pack and private/facts.json; a visitor never loads the private sheet', async () => {
  const read = [];
  const packs = { load: async () => ({ facts: pub }), getJSON: async (s, f, d) => { read.push(f); return f === 'private/facts.json' ? { facts: connectedFacts(ledger, pub) } : d; } };
  const v = await factTruth(packs, 'cozy', { member: false });
  assert.equal(v.catalog_count.v, '42'); assert.ok(!read.includes('private/facts.json'));
  const m = await factTruth(packs, 'cozy', { member: true });
  assert.equal(m.catalog_count.v, '37'); assert.equal(m.shopify_aov.v, '$48.20');
});
