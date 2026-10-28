// the brand's own Dev Dashboard app: Shopify's client-credentials errors come back in plain words
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import shopify, { OWN_SCOPES, ownUrls } from '../connectors/shopify.js';

const reply = (status, body) => async () => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const keys = { shop: 'some-brand', clientId: 'cid', clientSecret: 'sec' };

test('a store outside the app’s organization is sent to approve it, keys kept', async (t) => {
  t.mock.method(globalThis, 'fetch', reply(400, { error: 'shop_not_permitted', error_description: 'Oauth error shop_not_permitted: Client credentials cannot be performed on this shop.' }));
  await assert.rejects(shopify.fromKey(keys), (e) => e.user && /approve/.test(e.message) && /shop_not_permitted/.test(e.why)
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

/* ---------- 28 Oct RCA: "Install app" landed on Brew's home page, so the approve screen and the callback never came ----------
   The App URL was the bare site; with the legacy install flow Shopify opens it and waits for the app to start the approve.
   Now: the App URL is /shopify/own/b/<slug>, any refusal of the keys goes to the approve screen, and the box shows the very
   URLs and scopes the server uses (ownUrls), for every brand from the day it onboards. */
test('any refusal except wrong keys goes to the approve screen (not installed yet, missing scopes)', async (t) => {
  for (const body of [{ error: 'app_not_installed' }, { error: 'invalid_request', error_description: 'This app is not installed on this store' }, { errors: '[API] This action requires merchant approval for read_orders scope.' }]) {
    t.mock.method(globalThis, 'fetch', reply(400, body));
    await assert.rejects(shopify.fromKey(keys), (e) => e.user && e.approve?.shop === 'some-brand.myshopify.com' && e.approve.clientSecret === 'sec');
    t.mock.restoreAll();
  }
});

test('the URLs a brand pastes are the server’s own, the same for every brand, and never the bare site', () => {
  for (const slug of ['arata-in', 'thezeppelin-in', 'cozy']) {
    const o = ownUrls('https://brew.joinsquareup.com', slug);
    assert.equal(o.appUrl, `https://brew.joinsquareup.com/shopify/own/b/${slug}`); assert.notEqual(o.appUrl, 'https://brew.joinsquareup.com');
    assert.equal(o.redirect, 'https://brew.joinsquareup.com/shopify/own/callback'); assert.equal(o.scopes, OWN_SCOPES);
  }
  const u = new URL(shopify.ownAuthorize({ shop: 'some-brand.myshopify.com', clientId: 'cid', state: 'st', redirect: 'r' }));
  assert.equal(u.searchParams.get('scope'), OWN_SCOPES, 'the approve screen asks for exactly what the box says to paste');
  const live = fs.readFileSync(new URL('../public/live.js', import.meta.url), 'utf8');
  assert.match(live, /L\.ownApp/, 'the box reads the server’s URLs');
  assert.ok(live.includes(`'${OWN_SCOPES}'`), 'the box’s fallback scopes are the same list');
  assert.doesNotMatch(live, /copy: location\.origin\b/, 'the bare site is never offered as the App URL');
});

/* the whole own-app route through the server: Connect → approve screen; Install app → approve screen; callback swaps the code */
const memPacks = () => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), JSON.stringify(o)); }, list: async () => [{ slug: 'cozy' }] }; };
const reqOf = (method, { cookie = '', body = '' } = {}) => Object.assign(Readable.from(body ? [body] : []), { method, headers: { cookie, host: 'x.test', 'content-type': 'application/json' } });
const resOf = () => ({ code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; }, getHeader(n) { return this.headers[n]; }, setHeader(n, v) { this.headers[n] = v; } });
const signedQ = (q, secret = 'sec') => { const p = new URLSearchParams(q); const msg = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  p.set('hmac', crypto.createHmac('sha256', secret).update(msg).digest('hex')); return p; };

test('own app end to end: Connect, Install app and the callback all reach the approve flow, for any brand', async (t) => {
  process.env.BUILD_RESUME_OFF = '1'; process.env.PUBLIC_URL = 'https://brew.test';
  const { createAuth } = await import('../auth.js'), { createConnectors } = await import('../connectors/index.js');
  const packs = memPacks(), auth = createAuth({ packs, hostOf: async (s) => (s === 'cozy' ? 'cozysnugglet.shop' : null), log: { warn() {}, log() {} } });
  const C = createConnectors({ packs, auth, builder: {}, treg: null, log: { warn() {}, log() {}, info() {} } });
  const cookie = `fs_s=${encodeURIComponent(auth.sign({ email: 'ana@cozysnugglet.shop' }, 3600, 'session'))}`;
  const go = async (method, url, body) => { const res = resOf(); await C.handle(reqOf(method, { cookie, body: body ? JSON.stringify(body) : '' }), res, new URL(url)); return res; };

  /* the box's URLs, ready before anything is connected */
  const lv = JSON.parse((await go('GET', 'https://brew.test/api/brands/cozy/live')).body);
  assert.deepEqual(lv.ownApp, ownUrls('https://brew.test', 'cozy'));

  /* Install app before the keys are pasted: back to the box, never the home page */
  let r = await go('GET', `https://brew.test/shopify/own/b/cozy?${signedQ({ shop: 'cozy-test.myshopify.com', host: 'x', timestamp: '1' })}`);
  assert.equal(r.code, 302); assert.match(r.headers.location, /^\/cozy#v=connectors&cx=shopify&cxerr=/);

  /* Connect with keys the store hasn't approved yet: the approve screen, with the server's redirect and scopes */
  t.mock.method(globalThis, 'fetch', reply(400, { error: 'app_not_installed' }));
  r = await go('POST', 'https://brew.test/api/brands/cozy/connect/shopify', { action: 'key', fields: { shop: 'cozy-test', clientId: 'cid', clientSecret: 'sec' } });
  const j = JSON.parse(r.body), ap = new URL(j.approve);
  assert.equal(ap.host, 'cozy-test.myshopify.com'); assert.equal(ap.searchParams.get('redirect_uri'), lv.ownApp.redirect); assert.equal(ap.searchParams.get('scope'), lv.ownApp.scopes);
  t.mock.restoreAll();

  /* Install app now (also from the bare site, the old App URL): straight to the approve screen */
  for (const path of ['/shopify/own/b/cozy', '/']) {
    r = await go('GET', `https://brew.test${path}?${signedQ({ shop: 'cozy-test.myshopify.com', host: 'x', timestamp: '2' })}`);
    assert.equal(r.code, 302, path); const to = new URL(r.headers.location); assert.equal(to.host, 'cozy-test.myshopify.com', path); assert.equal(to.searchParams.get('redirect_uri'), lv.ownApp.redirect);
  }
  /* a launch signed with another secret is not trusted */
  r = await go('GET', `https://brew.test/shopify/own/b/cozy?${signedQ({ shop: 'cozy-test.myshopify.com', timestamp: '3' }, 'other')}`);
  assert.match(r.headers.location, /^\/cozy#v=connectors/);

  /* Shopify comes back: the callback swaps the code for a token */
  const f = t.mock.method(globalThis, 'fetch', reply(200, { access_token: 'shpat_z', scope: OWN_SCOPES }));
  r = await go('GET', `https://brew.test/shopify/own/callback?${signedQ({ code: 'abc', shop: 'cozy-test.myshopify.com', state: ap.searchParams.get('state'), timestamp: '4' })}`);
  assert.equal(r.code, 302); assert.match(r.headers.location, /^\/cozy#v=connectors&cx=shopify&/);
  assert.match(String(f.mock.calls[0].arguments[0]), /cozy-test\.myshopify\.com\/admin\/oauth\/access_token/); assert.match(String(f.mock.calls[0].arguments[1].body), /code=abc/);
});

test('the own app asks only for what sync reads, all read-only (no locations: nothing reads them)', () => {
  assert.equal(OWN_SCOPES, 'read_products,read_inventory,read_orders,read_customers');
  for (const s of OWN_SCOPES.split(',')) assert.match(s, /^read_/);
});
