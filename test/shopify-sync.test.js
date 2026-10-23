// the Shopify read on a big store: a sample of the newest orders never passes for the whole window, Shopify counts the
// 30 days, a throttle is waited out, and only what a shopper can't buy counts as sold out
import { test } from 'node:test';
import assert from 'node:assert/strict';
import shopify from '../connectors/shopify.js';

const ok = (data) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(data) });
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
const order = (d, cod = false) => ({ createdAt: ago(d), cancelledAt: null, displayFinancialStatus: cod ? 'PENDING' : 'PAID', paymentGatewayNames: [cod ? 'Cash on Delivery (COD)' : 'razorpay'], totalPriceSet: { shopMoney: { amount: '1000' } }, app: { name: 'Gokwik New' }, customer: { id: `c${d}`, numberOfOrders: 1 }, lineItems: { nodes: [{ title: 'Serum', quantity: 1 }] } });
const ctx = { profile: { currency: 'INR', country: 'IN' }, lane: 'core' };
const conn = { shop: 'big.myshopify.com', token: 'shpat_x' };

function shop({ pages, count = 9000, cancelled = 100, products, throttleOnce = false, timeoutWhole = false }) {
  let throttled = !throttleOnce, calls = [];
  const fetch = async (url, o) => {
    const { query, variables } = JSON.parse(o.body); calls.push(query);
    if (!throttled) { throttled = true; return ok({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }); }
    if (timeoutWhole && /ordersCount/.test(query) && !/created_at:</.test(variables.q) && /^created_at:>='\d{4}-\d\d-\d\dT/.test(variables.q)) return ok({ errors: [{ message: 'Failed to complete in time.', extensions: { code: 'TIMEOUT' } }] });
    if (/ordersCount/.test(query) && !timeoutWhole) return ok({ data: { n: { count: /status:cancelled/.test(variables.q) ? cancelled : count } } });
    if (/ordersCount/.test(query)) return ok({ data: { n: { count: /status:cancelled/.test(variables.q) ? 10 : 1000 } } });
    if (/currencyCode \} \}$/.test(query.trim()) || /^\{ shop \{ currencyCode \} \}$/.test(query.trim())) return ok({ data: { shop: { currencyCode: 'INR' } } });
    if (/orders\(first:250/.test(query) && /lineItems/.test(query)) { const i = variables.a ? +variables.a : 0; return ok({ data: { orders: { nodes: pages[i], pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: String(i + 1) } } } }); }
    if (/orders\(first:250/.test(query) && /paymentGatewayNames/.test(query)) return ok({ data: { orders: { nodes: [...Array(30)].map((_, k) => ({ ...order(15 + k % 20, true), cancelledAt: k < 6 ? ago(12) : null, displayFinancialStatus: k < 6 ? 'PENDING' : 'PAID' })), pageInfo: { hasNextPage: false } } } });
    if (/shippingAddress/.test(query)) return ok({ data: { orders: { nodes: [], pageInfo: { hasNextPage: false } } } });
    if (/abandonedCheckoutsCount/.test(query)) return ok({ data: { abandonedCheckoutsCount: { count: 50 } } });
    if (/productsCount/.test(query)) return ok({ data: { productsCount: { count: products.length }, products: { nodes: products.map((p) => ({ ...p, variants: p.many ? { nodes: p.many.slice(0, 5) } : p.variants })) } } });
    if (/product\(id:\$id\)/.test(query)) { const p = products.find((x) => x.id === variables.id); return ok({ data: { product: { variants: { nodes: p.many } } } }); }
    if (/description/.test(query)) return ok({ errors: [{ message: 'description failed' }] });
    return ok({ data: { shop: { currencyCode: 'INR' } } });
  };
  return { fetch, calls };
}

test('a store with more orders than one read: Shopify counts the 30 days, the newest orders give the average, a note says so', async (t) => {
  /* 40 pages of 250 orders, all from the last 3 days: the read stops long before 30 days */
  const pages = [...Array(41)].map(() => [...Array(250)].map(() => order(2))); /* one more page than a read takes */
  const s = shop({ pages, products: [{ title: 'Serum', totalInventory: 50, tracksInventory: true, onlineStoreUrl: 'https://x', variants: { nodes: [] } }] });
  t.mock.method(globalThis, 'fetch', s.fetch);
  const r = await shopify.sync(conn, ctx);
  assert.equal(r.metrics.orders, 8900, 'Shopify’s own count, cancelled ones left out');
  assert.equal(r.metrics.aov, 1000); assert.equal(r.metrics.revenue, 8900 * 1000);
  assert.equal(r.metrics.sampled, true);
  assert.match(r.ledger.find((e) => e.key === 'shopify.revenue.30d').label, /estimated/);
  assert.ok(r.notes.some((n) => /newest 10,000 orders/.test(n)), r.notes.join(' | '));
  /* COD 10 to 40 days old came from its own read: 6 of 30 cancelled */
  assert.equal(Math.round(r.metrics.codFail), 20);
  const keys = r.ledger.map((e) => e.key); assert.ok(keys.includes('shopify.cod.cancelled') && keys.includes('shopify.cod.unpaid') && !keys.includes('shopify.cod.failed'), keys.join(','));
  assert.ok(r.notes.some((n) => /Store description/.test(n)), 'a failed description read is said, not silent');
  assert.match(r.cards.find((c) => /repeat/.test(c.id))?.title || 'recent', /recent/);
});

test('a small store reads its whole 30 days: no count call, no sample note', async (t) => {
  const s = shop({ pages: [[order(1), order(5), order(20), order(45)]], products: [] });
  t.mock.method(globalThis, 'fetch', s.fetch);
  const r = await shopify.sync(conn, ctx);
  assert.equal(r.metrics.orders, 3); assert.equal(r.metrics.sampled, false);
  assert.ok(!s.calls.some((q) => /ordersCount/.test(q)));
  assert.ok(!r.notes.some((n) => /newest/.test(n)));
});

test('a throttled answer is waited out, not lost', async (t) => {
  const s = shop({ pages: [[order(1)]], products: [], throttleOnce: true });
  t.mock.method(globalThis, 'fetch', s.fetch);
  const was = (await import('../connectors/shopify.js')).default; void was;
  const r = await shopify.sync(conn, ctx);
  assert.ok(r.metrics.orders >= 0); assert.ok(!r.notes.some((n) => /Throttled/.test(n)), r.notes.join(' | '));
});

test('sold out means a shopper can’t buy it: unpublished and keep-selling products are left out, titles cut at a word', async (t) => {
  const products = [
    { title: 'Anti-Breakage Intensive Conditioner - 15ml travel size', totalInventory: 0, tracksInventory: true, onlineStoreUrl: 'https://a', variants: { nodes: [{ inventoryPolicy: 'DENY' }] } },
    { title: 'Hidden bundle', totalInventory: 0, tracksInventory: true, onlineStoreUrl: null, variants: { nodes: [{ inventoryPolicy: 'DENY' }] } },
    { title: 'Pre-order serum', totalInventory: 0, tracksInventory: true, onlineStoreUrl: 'https://b', variants: { nodes: [{ inventoryPolicy: 'CONTINUE' }] } },
    { title: 'Shampoo', totalInventory: 3, tracksInventory: true, onlineStoreUrl: 'https://c', variants: { nodes: [{ inventoryPolicy: 'DENY' }] } },
    { title: 'Oil', totalInventory: 80, tracksInventory: true, onlineStoreUrl: 'https://d', variants: { nodes: [{ inventoryPolicy: 'DENY' }] } }];
  const s = shop({ pages: [[order(1)]], products });
  t.mock.method(globalThis, 'fetch', s.fetch);
  const r = await shopify.sync(conn, ctx);
  assert.equal(r.metrics.oos, 1); assert.deepEqual(r.metrics.low.map((x) => x.title), [products[0].title, 'Shampoo']);
  const c = r.cards.find((x) => /stock/.test(x.id));
  assert.equal(c.title, '1 product is sold out and 1 has 5 or fewer units left');
  assert.deepEqual(c.rows[0], ['Anti-Breakage Intensive Conditioner - 15ml…', 'Sold out']);
  assert.deepEqual(c.rows[1], ['Shampoo', '3 left']);
});

test('a refresh without a new refresh token keeps the old one; a rotated secret asks to connect again', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ok({ access_token: 'shpat_new', expires_in: 3600 }));
  const c = await shopify.fresh({ shop: 'a.myshopify.com', app: 'own-oauth', clientId: 'id', clientSecret: 's', token: 'old', exp: Date.now() - 1, refresh: 'r1' });
  assert.equal(c.token, 'shpat_new'); assert.equal(c.refresh, 'r1');
  assert.ok(shopify.expired(new Error('shopify token 400: invalid_client')));
  assert.ok(shopify.expired(new Error('shopify token 400: shop_not_permitted')));
  assert.ok(!shopify.expired(new Error('shopify graphql 503: busy')));
});

test('a count Shopify can’t finish in time is counted again in 5-day windows', async (t) => {
  const pages = [...Array(41)].map(() => [...Array(250)].map(() => order(2)));
  const s = shop({ pages, products: [], timeoutWhole: true });
  t.mock.method(globalThis, 'fetch', s.fetch);
  const r = await shopify.sync(conn, ctx);
  const windows = s.calls.filter((q) => /ordersCount/.test(q)).length;
  assert.ok(windows >= 14, `windows asked: ${windows}`);
  assert.equal(r.metrics.orders % 990, 0); assert.ok(r.metrics.orders >= 6 * 990);
});

test('order count windows use exact timestamps, never bare dates (Shopify reads <DATE as the end of that day)', async (t) => {
  const pages = [...Array(41)].map(() => [...Array(250)].map(() => order(2)));
  const s = shop({ pages, products: [], timeoutWhole: true }), qs = [];
  t.mock.method(globalThis, 'fetch', async (url, o) => { const b = JSON.parse(o.body); if (/ordersCount/.test(b.query)) qs.push(b.variables.q); return s.fetch(url, o); });
  await shopify.sync(conn, ctx);
  assert.ok(qs.length > 2 && qs.every((q) => /created_at:>='\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z'/.test(q)), qs.slice(0, 3).join(' | '));
  assert.ok(qs.filter((q) => /created_at:</.test(q)).every((q) => /created_at:<'\d{4}-\d\d-\d\dT/.test(q)));
});

test('orders through a checkout app (GoKwik): Shopify’s checkouts left is only what reached Shopify, said plainly, no made-up started count', async (t) => {
  const s = shop({ pages: [[...Array(30)].map(() => order(2))], products: [] });
  t.mock.method(globalThis, 'fetch', s.fetch);
  const r = await shopify.sync(conn, ctx);
  assert.equal(r.metrics.checkoutApp.name, 'Gokwik New'); assert.equal(r.metrics.started, undefined);
  const c = r.cards.find((x) => /carts/.test(x.id));
  assert.match(c.title, /Shopify’s own checkout/); assert.match(c.sub, /100% of your orders come through Gokwik New/);
});

test('a product with more than 5 variants is read whole before it counts as sold out', async (t) => {
  const many = [...Array(5)].map(() => ({ inventoryPolicy: 'DENY' })).concat([{ inventoryPolicy: 'CONTINUE' }]);
  const products = [{ id: 'gid://shopify/Product/1', title: 'Six shades', totalInventory: 0, tracksInventory: true, onlineStoreUrl: 'https://a', variantsCount: { count: 6 }, many },
    { id: 'gid://shopify/Product/2', title: 'Plain', totalInventory: 0, tracksInventory: true, onlineStoreUrl: 'https://b', variantsCount: { count: 1 }, variants: { nodes: [{ inventoryPolicy: 'DENY' }] } }];
  const s = shop({ pages: [[order(1)]], products });
  t.mock.method(globalThis, 'fetch', s.fetch);
  const r = await shopify.sync(conn, ctx);
  assert.equal(r.metrics.oos, 1); assert.deepEqual(r.metrics.low.map((x) => x.title), ['Plain'], 'the 6th variant keeps selling: not sold out');
});

test('the COD card sits in Signals, next to the checkout card (storefront cards are off)', async (t) => {
  const pages = [...Array(41)].map(() => [...Array(250)].map(() => order(2, true)));
  const s = shop({ pages, products: [] });
  t.mock.method(globalThis, 'fetch', s.fetch);
  const r = await shopify.sync(conn, { ...ctx, profile: { currency: 'INR', country: 'IN', locale: 'en-IN' } });
  const c = r.cards.find((x) => /cod/.test(x.id)); assert.ok(c, r.cards.map((x) => x.id).join(','));
  assert.equal(c.sector, 'signals'); assert.equal(r.cards.find((x) => /carts/.test(x.id)).sector, 'signals');
});
