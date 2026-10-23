// the brand's own Dev Dashboard app: Shopify's client-credentials errors come back in plain words
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import shopify from '../connectors/shopify.js';

const reply = (status, body) => async () => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const keys = { shop: 'some-brand', clientId: 'cid', clientSecret: 'sec' };

test('a store outside the app’s organization is sent to approve it, keys kept', async (t) => {
  t.mock.method(globalThis, 'fetch', reply(400, { error: 'shop_not_permitted', error_description: 'Oauth error shop_not_permitted: Client credentials cannot be performed on this shop.' }));
  await assert.rejects(shopify.fromKey(keys), (e) => e.user && /another Shopify organization/.test(e.message) && /some-brand\.myshopify\.com/.test(e.message)
    && e.approve?.shop === 'some-brand.myshopify.com' && e.approve.clientId === 'cid' && e.approve.clientSecret === 'sec');
  const u = new URL(shopify.ownAuthorize({ shop: 'some-brand.myshopify.com', clientId: 'cid', state: 'st', redirect: 'https://brew.test/shopify/own/callback' }));
  assert.equal(u.host, 'some-brand.myshopify.com'); assert.equal(u.searchParams.get('client_id'), 'cid'); assert.equal(u.searchParams.get('redirect_uri'), 'https://brew.test/shopify/own/callback');
});

test('the approve callback checks the signature and the store, then swaps the code', async (t) => {
  const pend = { shop: 'some-brand.myshopify.com', clientId: 'cid', clientSecret: 'sec' };
  const signed = (q) => { const p = new URLSearchParams(q); const msg = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
    p.set('hmac', crypto.createHmac('sha256', 'sec').update(msg).digest('hex')); return p; };
  await assert.rejects(shopify.ownExchange({ query: new URLSearchParams({ shop: pend.shop, code: 'c', hmac: 'bad' }), pend }), /signature/);
  await assert.rejects(shopify.ownExchange({ query: signed({ shop: 'other.myshopify.com', code: 'c' }), pend }), /not the one/);
  const f = t.mock.method(globalThis, 'fetch', reply(200, { access_token: 'shpat_y', scope: 'read_products' }));
  const c = await shopify.ownExchange({ query: signed({ shop: pend.shop, code: 'c', timestamp: '1' }), pend });
  assert.equal(c.app, 'own-oauth'); assert.equal(c.token, 'shpat_y'); assert.equal(c.exp, null);
  assert.match(String(f.mock.calls[0].arguments[1].body), /code=c/);
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
