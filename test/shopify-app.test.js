// Brew inside the Shopify admin (shopify-app.js): session tokens, signed queries and webhooks, the embedded page, and the
// store → brand link (team + Shopify account), with Shopify and the brand store faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyIdToken, queryOk, webhookOk, embeddedReq, embedHtml, frameAncestors, createShopifyApp } from '../shopify-app.js';

const ID = 'test-client-id', SECRET = 'test-secret';
process.env.FEED_SHOPIFY_CLIENT_ID = ID; process.env.FEED_SHOPIFY_CLIENT_SECRET = SECRET; process.env.PUBLIC_URL = 'https://brew.test';
const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const jwt = (body, secret = SECRET, head = { alg: 'HS256', typ: 'JWT' }) => { const h = b64u(head), p = b64u(body); return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`; };
const now = Math.floor(Date.now() / 1e3);
const claims = (o = {}) => ({ iss: 'https://cozy.myshopify.com/admin', dest: 'https://cozy.myshopify.com', aud: ID, sub: '42', exp: now + 60, nbf: now - 5, iat: now, jti: 'x', sid: 's', ...o });

test('a session token from this app and one shop is accepted; anything else is refused', () => {
  assert.deepEqual(verifyIdToken(jwt(claims()), { id: ID, secret: SECRET }).shop, 'cozy.myshopify.com');
  assert.equal(verifyIdToken(jwt(claims(), 'other-secret'), { id: ID, secret: SECRET }), null, 'wrong signature');
  assert.equal(verifyIdToken(jwt(claims({ aud: 'another-app' })), { id: ID, secret: SECRET }), null, 'another app');
  assert.equal(verifyIdToken(jwt(claims({ exp: now - 60 })), { id: ID, secret: SECRET }), null, 'expired');
  assert.equal(verifyIdToken(jwt(claims({ nbf: now + 120 })), { id: ID, secret: SECRET }), null, 'not yet valid');
  assert.equal(verifyIdToken(jwt(claims({ dest: 'https://evil.com' })), { id: ID, secret: SECRET }), null, 'not a Shopify store');
  assert.equal(verifyIdToken(jwt(claims({ iss: 'https://other.myshopify.com/admin' })), { id: ID, secret: SECRET }), null, 'issuer is another store');
  assert.equal(verifyIdToken(jwt(claims(), SECRET, { alg: 'none' }), { id: ID, secret: SECRET }), null, 'alg none');
  assert.equal(verifyIdToken('not.a.token', { id: ID, secret: SECRET }), null);
});

test('Shopify’s signed launch query and webhook bodies are checked with the app secret', () => {
  const q = new URLSearchParams({ shop: 'cozy.myshopify.com', timestamp: '1', host: 'abc' });
  q.set('hmac', crypto.createHmac('sha256', SECRET).update('host=abc&shop=cozy.myshopify.com&timestamp=1').digest('hex'));
  assert.ok(queryOk(q, SECRET)); q.set('shop', 'evil.myshopify.com'); assert.ok(!queryOk(q, SECRET));
  const body = Buffer.from('{"shop_domain":"cozy.myshopify.com"}'), sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  assert.ok(webhookOk(body, sig, SECRET)); assert.ok(!webhookOk(body, 'nope', SECRET)); assert.ok(!webhookOk(Buffer.from('{}'), sig, SECRET));
});

test('a page inside the admin gets App Bridge first in <head> and may be framed only by the admin', () => {
  const u = (s) => new URL(s, 'https://brew.test');
  assert.ok(embeddedReq({ headers: {} }, u('/cozy?embedded=1')));
  assert.ok(embeddedReq({ headers: {} }, u('/cozy?shop=cozy.myshopify.com&host=abc')));
  assert.ok(embeddedReq({ headers: { 'sec-fetch-dest': 'iframe', referer: 'https://brew.test/cozy?embedded=1&shop=x' } }, u('/other')));
  assert.ok(!embeddedReq({ headers: { 'sec-fetch-dest': 'document' } }, u('/cozy')));
  assert.ok(!embeddedReq({ headers: { 'sec-fetch-dest': 'iframe', referer: 'https://someone-else.com/' } }, u('/cozy')), 'framed by another site is not the admin');
  const h = embedHtml('<!doctype html><html><head><meta charset=utf8><script src="app.js"></script></head></html>', 'cozy.myshopify.com', ID);
  assert.ok(h.indexOf('app-bridge.js') < h.indexOf('app.js'), 'App Bridge before every other script');
  assert.match(h, new RegExp(`shopify-api-key" content="${ID}"`));
  assert.equal(frameAncestors('cozy.myshopify.com'), 'frame-ancestors https://cozy.myshopify.com https://admin.shopify.com;');
  assert.equal(frameAncestors('bad host'), 'frame-ancestors https://*.myshopify.com https://admin.shopify.com;');
});

function rig({ brands = { 'cozysnugglet-shop': { claimed: false } }, connected = {} } = {}) {
  const team = {}, finished = [], disconnected = [], started = [];
  const auth = { baseOf: () => 'https://brew.test', sign: (x, s, kind) => `${kind}:${b64u(x)}`, verify: (t, kind) => { const [k, p] = String(t || '').split(':'); return k === kind ? JSON.parse(Buffer.from(p, 'base64url')) : null; }, setCookie: () => {},
    claimInfo: async (slug, me) => ({ role: team[slug]?.[me.email] || null, claimed: brands[slug]?.claimed || Object.values(team[slug] || {}).includes('owner') }),
    addMember: async (slug, me, role) => { (team[slug] ||= {})[me.email] = role; } };
  const connectors = { liveOf: async (slug) => ({ conns: connected[slug] ? { shopify: connected[slug] } : {} }), finish: async (slug, id, creds, me) => { finished.push({ slug, id, creds, me: me.email }); return { ok: true }; },
    disconnect: async (slug, id) => { disconnected.push([slug, id]); return { ok: true }; }, shopSlug: async (shop) => Object.entries(connected).find(([, c]) => c.account?.id === shop)?.[0] || null };
  const builder = { status: async (slug) => (brands[slug] ? { slug } : null), start: async (url, o) => { started.push({ url, user: o.user.email }); return { slug: url.replace(/\./g, '-') }; } };
  const fetchFn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.endsWith('/admin/oauth/access_token')) return new Response(JSON.stringify(body.requested_token_type?.includes('online') ? { access_token: 'online', associated_user: { id: 7, email: 'Founder@CozySnugglet.shop', first_name: 'Ana', account_owner: true } } : { access_token: 'offline-tok', scope: 'read_products', expires_in: 3600, refresh_token: 'r' }));
    if (url.includes('/graphql.json')) return new Response(JSON.stringify({ data: { shop: { name: 'Cozy', myshopifyDomain: 'cozy.myshopify.com', primaryDomain: { host: 'cozysnugglet.shop' } } } }));
    if (url === 'https://newbrand.com/') return Object.assign(new Response('ok'), {}); /* open storefront */
    throw new Error('unexpected ' + url);
  };
  const sa = createShopifyApp({ auth, connectors, builder, packs: {}, log: { log() {}, warn() {} }, fetchFn });
  return { sa, team, finished, disconnected, started };
}
const call = async (sa, method, path, { headers = {}, body = '' } = {}) => {
  const { Readable } = await import('node:stream'); const req = Readable.from(body ? [Buffer.from(body)] : []); Object.assign(req, { method, url: path, headers });
  const u = new URL(path, 'https://brew.test'); let out = { code: 0, head: {}, body: '' };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { out.code = c; out.head = h || {}; }, end(b) { out.body = b ? String(b) : ''; } };
  await sa.attach(req, u); const handled = await sa.handle(req, res, u); return { ...out, handled, json: () => JSON.parse(out.body || '{}'), req };
};

test('opening the app links the store to the brand read at its domain: the owner joins as admin and Shopify connects itself', async () => {
  const { sa, team, finished } = rig();
  const r = await call(sa, 'POST', '/shopify/api/session', { headers: { authorization: `Bearer ${jwt(claims())}` } });
  assert.equal(r.req.brewUser.email, 'founder@cozysnugglet.shop', 'the staff member from Shopify, email lowercased');
  assert.deepEqual(r.json(), { state: 'linked', slug: 'cozysnugglet-shop', connected: true, error: null });
  assert.equal(team['cozysnugglet-shop']['founder@cozysnugglet.shop'], 'owner', 'an unclaimed brand: the installer owns it');
  assert.equal(finished[0].creds.token, 'offline-tok'); assert.equal(finished[0].creds.app, 'brew'); assert.equal(finished[0].creds.shop, 'cozy.myshopify.com');
});

test('a claimed brand: the store’s owner joins as admin, other staff as members; an account already reading is left alone', async () => {
  const { sa, team, finished } = rig({ brands: { 'cozysnugglet-shop': { claimed: true } }, connected: { 'cozysnugglet-shop': { state: 'live', account: { id: 'cozy.myshopify.com' } } } });
  const r = await call(sa, 'POST', '/shopify/api/session', { headers: { authorization: `Bearer ${jwt(claims())}` } });
  assert.equal(r.json().state, 'linked'); assert.equal(team['cozysnugglet-shop']['founder@cozysnugglet.shop'], 'admin'); assert.equal(finished.length, 0);
});

test('a store Brew hasn’t read waits for the merchant’s tap; the read then starts for its domain as that person', async () => {
  const x = rig({ brands: {} });
  const s = await call(x.sa, 'POST', '/shopify/api/session', { headers: { authorization: `Bearer ${jwt(claims())}` } });
  assert.equal(s.json().state, 'unread'); assert.equal(s.json().host, 'cozysnugglet.shop'); assert.equal(x.started.length, 0, 'never a paid read on install by itself');
});

test('no session token, or a forged one: nothing is said about any store', async () => {
  const { sa } = rig();
  assert.equal((await call(sa, 'POST', '/shopify/api/session')).code, 401);
  assert.equal((await call(sa, 'POST', '/shopify/api/session', { headers: { authorization: `Bearer ${jwt(claims(), 'forged')}` } })).code, 401);
});

test('webhooks: a bad signature is 401; uninstall and shop/redact disconnect the store’s brand; customer requests are answered', async () => {
  const { sa, disconnected } = rig({ connected: { 'cozysnugglet-shop': { state: 'live', account: { id: 'cozy.myshopify.com' } } } });
  const body = JSON.stringify({ shop_domain: 'cozy.myshopify.com' }), sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  assert.equal((await call(sa, 'POST', '/shopify/webhooks', { body, headers: { 'x-shopify-hmac-sha256': 'bad', 'x-shopify-topic': 'shop/redact' } })).code, 401);
  for (const topic of ['customers/data_request', 'customers/redact']) assert.equal((await call(sa, 'POST', '/shopify/webhooks', { body, headers: { 'x-shopify-hmac-sha256': sig, 'x-shopify-topic': topic, 'x-shopify-shop-domain': 'cozy.myshopify.com' } })).code, 200);
  assert.equal(disconnected.length, 0);
  assert.equal((await call(sa, 'POST', '/shopify/webhooks', { body, headers: { 'x-shopify-hmac-sha256': sig, 'x-shopify-topic': 'app/uninstalled', 'x-shopify-shop-domain': 'cozy.myshopify.com' } })).code, 200);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(disconnected, [['cozysnugglet-shop', 'shopify']]);
});

test('the home page inside the admin: App Bridge, the admin-only frame rule; outside the admin it says where to open it', async () => {
  const { sa } = rig();
  const r = await call(sa, 'GET', '/shopify?shop=cozy.myshopify.com&host=abc&embedded=1&id_token=' + jwt(claims()));
  assert.equal(r.code, 200); assert.match(r.body, /app-bridge\.js/); assert.match(r.head['content-security-policy'], /frame-ancestors https:\/\/cozy\.myshopify\.com https:\/\/admin\.shopify\.com/);
  const bare = await call(sa, 'GET', '/shopify'); assert.match(bare.body, /Open Brew from your Shopify admin/);
});

test('a sign-in that refuses a frame (Google, Meta) is offered in a new tab, and the hop only goes to a Brew path', async () => {
  const { sa } = rig();
  const r = await call(sa, 'GET', '/connect/meta/start?brand=cozysnugglet-shop', { headers: { 'sec-fetch-dest': 'iframe', referer: 'https://brew.test/cozysnugglet-shop?embedded=1' } });
  assert.match(r.body, /Continue in a new tab/); assert.match(r.body, /data-next="\/connect\/meta\/start\?brand=cozysnugglet-shop"/);
  const top = await call(sa, 'GET', '/connect/meta/start?brand=x', { headers: { 'sec-fetch-dest': 'document' } }); assert.equal(top.handled, false, 'outside the admin the normal route runs');
  const hop = await call(sa, 'POST', '/shopify/api/hop', { headers: { authorization: `Bearer ${jwt(claims())}` }, body: JSON.stringify({ next: '//evil.com' }) });
  const t = new URL(hop.json().url).searchParams.get('t'); assert.equal(JSON.parse(Buffer.from(t.split(':')[1], 'base64url')).next, '/');
});
