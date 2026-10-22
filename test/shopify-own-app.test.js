// the brand's own Dev Dashboard app: Shopify's client-credentials errors come back in plain words
import { test } from 'node:test';
import assert from 'node:assert/strict';
import shopify from '../connectors/shopify.js';

const reply = (status, body) => async () => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const keys = { shop: 'some-brand', clientId: 'cid', clientSecret: 'sec' };

test('a store outside the app’s organization says so', async (t) => {
  t.mock.method(globalThis, 'fetch', reply(400, { error: 'shop_not_permitted', error_description: 'Oauth error shop_not_permitted: Client credentials cannot be performed on this shop.' }));
  await assert.rejects(shopify.fromKey(keys), (e) => e.user && /same Shopify organization/.test(e.message) && /some-brand\.myshopify\.com/.test(e.message));
});

test('wrong keys say to copy them again', async (t) => {
  t.mock.method(globalThis, 'fetch', reply(401, { error: 'invalid_client' }));
  await assert.rejects(shopify.fromKey(keys), (e) => e.user && /Client ID and secret/.test(e.message));
});

test('a good answer connects with the own app', async (t) => {
  t.mock.method(globalThis, 'fetch', reply(200, { access_token: 'shpat_x', scope: 'read_products', expires_in: 86399 }));
  const c = await shopify.fromKey(keys);
  assert.equal(c.app, 'own'); assert.equal(c.shop, 'some-brand.myshopify.com'); assert.equal(c.token, 'shpat_x');
});
