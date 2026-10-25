// A brand's PDFs inside the Shopify admin: a link or a new tab sends no session token header, so public/shopify-embed.js
// puts a fresh id_token on every PDF link (move PDFs, named PDFs, Download) as it is pressed, and the server reads it there.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createShopifyApp } from '../shopify-app.js';

const ID = 'test-client-id', SECRET = 'test-secret';
process.env.FEED_SHOPIFY_CLIENT_ID = ID; process.env.FEED_SHOPIFY_CLIENT_SECRET = SECRET; process.env.PUBLIC_URL = 'https://brew.test';
const src = (f) => fs.readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');

/* the admin page, faked: App Bridge's idToken, a clock, links, and the listeners the script adds */
function page({ shopify = true, clock = { t: 1e12 } } = {}) {
  const on = {}, opened = [], alerts = []; let n = 0;
  const location = { origin: 'https://brew.test', href: 'https://brew.test/devshop-myshopify-com?embedded=1&shop=devshop.myshopify.com&host=abc', search: '?embedded=1&shop=devshop.myshopify.com&host=abc', pathname: '/devshop-myshopify-com', hash: '', replace() {}, assign(h) { opened.push({ frame: h }); } };
  const win = {
    location, opened, alerts, clock,
    history: { state: null, replaceState() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: () => null, addEventListener: (ev, f) => { (on[ev] ||= []).push(f); } },
    setInterval() {}, alert: (m) => alerts.push(m), URL, URLSearchParams,
    Date: { now: () => clock.t },
    open: () => { const w = { location: null, close() { w.closed = true; } }; opened.push(w); return w; },
    shopify: shopify ? { idToken: async () => `T${++n}` } : undefined,
  };
  win.window = win;
  vm.runInNewContext(src('public/shopify-embed.js'), win);
  const link = (href, o = {}) => { const a = { href, target: o.target || '', attrs: { href, ...(o.download ? { download: '' } : {}) },
    getAttribute: (k) => a.attrs[k] ?? null, setAttribute: (k, v) => { a.attrs[k] = v; }, hasAttribute: (k) => k in a.attrs,
    closest: (s) => (s === 'a[href]' ? a : null) }; return a; };
  const fire = (ev, a) => { const e = { target: a, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } }; for (const f of on[ev] || []) f(e); return e; };
  return { win, on, link, fire, settle: () => new Promise((r) => setImmediate(r)) };
}
const tokOf = (a) => new URL(a.getAttribute('href'), 'https://brew.test').searchParams.get('id_token');

test('inside the admin, every PDF link carries the fresh session token and keeps the rest of its address', async () => {
  const p = page(); await p.settle(); /* the first token has arrived */
  for (const [href, o] of [['/b/devshop-myshopify-com/pdf/move-3.pdf', { target: '_blank' }], /* Open the PDF, the move's PDF icon */
    ['/b/devshop-myshopify-com/pdf/move-3.pdf?dl=1', {}], /* Download the PDF */
    ['/b/devshop-myshopify-com/pdf/01%20One.pdf', { target: '_blank' }], /* a named PDF */
    ['https://brew.test/b/devshop-myshopify-com/pdf/moves.zip?dl=1', { download: true }]]) {
    const a = p.link(href, o), e = p.fire('click', a);
    assert.equal(e.defaultPrevented, false, `${href}: the browser opens it as usual`);
    assert.equal(tokOf(a), 'T1', href);
    const was = new URL(href, 'https://brew.test'), now = new URL(a.getAttribute('href'), 'https://brew.test');
    assert.equal(now.pathname, was.pathname); assert.equal(now.searchParams.get('dl'), was.searchParams.get('dl'), 'Download stays a download');
  }
  assert.equal(p.win.opened.length, 0, 'nothing else opened');
});

test('a PDF opened by right-click (Open in new tab), middle click or a press already has the token', async () => {
  const p = page(); await p.settle();
  for (const ev of ['contextmenu', 'auxclick', 'pointerdown']) { const a = p.link('/b/devshop-myshopify-com/pdf/move-7.pdf', { target: '_blank' }); p.fire(ev, a); assert.equal(tokOf(a), 'T1', ev); }
  const a = p.link('/b/devshop-myshopify-com/pdf/move-7.pdf?id_token=old', { target: '_blank' }); p.fire('click', a); assert.equal(tokOf(a), 'T1', 'an old token on the link is replaced');
});

test('a token older than 45 s is asked for again; the PDF opens in a tab taken inside the tap', async () => {
  const p = page(); await p.settle(); p.win.clock.t += 50e3;
  const a = p.link('/b/devshop-myshopify-com/pdf/move-3.pdf', { target: '_blank' }), e = p.fire('click', a);
  assert.equal(e.defaultPrevented, true); assert.equal(p.win.opened.length, 1, 'the tab opens at once, before the token comes back');
  await p.settle();
  assert.equal(p.win.opened[0].location, '/b/devshop-myshopify-com/pdf/move-3.pdf?id_token=T2'); assert.equal(tokOf(a), 'T2');
  const b = p.link('/b/devshop-myshopify-com/pdf/move-4.pdf?dl=1'); p.fire('click', b); assert.equal(tokOf(b), 'T2', 'the new token is used at once next time');
});

test('App Bridge has no token: the blank tab closes and the person is told, never a page that says sign in', async () => {
  const p = page(); await p.settle(); p.win.clock.t += 50e3; p.win.shopify.idToken = async () => { throw new Error('no'); };
  p.fire('click', p.link('/b/devshop-myshopify-com/pdf/move-3.pdf', { target: '_blank' })); await p.settle();
  assert.equal(p.win.opened[0].closed, true); assert.equal(p.win.alerts.length, 1);
});

test('only PDFs get the token: photos, brand pages, the API and other sites never do', async () => {
  const p = page(); await p.settle();
  for (const href of ['/b/devshop-myshopify-com/a/hero.jpg', '/b/devshop-myshopify-com/seed.js', '/devshop-myshopify-com', '/api/brands/devshop-myshopify-com/moves', 'https://other.com/b/x/pdf/move-1.pdf']) {
    const a = p.link(href, { target: '_blank' }); for (const ev of ['pointerdown', 'contextmenu', 'click']) p.fire(ev, a); assert.equal(tokOf(a), null, href);
  }
});

test('outside the admin nothing changes: the script does nothing without App Bridge and app.js PDF links stay plain', () => {
  const p = page({ shopify: false }); assert.deepEqual(Object.keys(p.on), [], 'no listeners outside the admin');
  const app = src('public/app.js'); assert.match(app, /const pdfUrl = \(f, dl\) => `\/b\/\$\{mvSlug\(\)\}\/pdf\/\$\{encodeURIComponent\(f\)\}\$\{dl \? '\?dl=1' : ''\}`;/);
  assert.doesNotMatch(app, /pdf[^\n]{0,80}id_token/, 'no token is written into app.js PDF links');
});

/* the server half: a PDF address with the token is that person (shopify-app.js attach), for server.js teamRead */
const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const jwt = (body, secret = SECRET) => { const h = b64u({ alg: 'HS256', typ: 'JWT' }), p = b64u(body); return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`; };
const now = Math.floor(Date.now() / 1e3);
const claims = { iss: 'https://devshop.myshopify.com/admin', dest: 'https://devshop.myshopify.com', aud: ID, sub: '42', exp: now + 60, nbf: now - 5, iat: now, jti: 'x', sid: 's' };
test('on the server, a PDF address with the token from the admin is the staff member; a forged or missing one is nobody', async () => {
  const fetchFn = async (url) => { if (url.endsWith('/admin/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'online', associated_user: { id: 7, email_verified: true, email: 'Ana@Devshop.test', first_name: 'Ana' } })); throw new Error('unexpected ' + url); };
  const sa = createShopifyApp({ auth: {}, connectors: {}, builder: {}, packs: {}, log: { log() {}, warn() {} }, fetchFn });
  const who = async (tk) => { const q = tk ? `?dl=1&id_token=${encodeURIComponent(tk)}` : '?dl=1', req = { method: 'GET', url: `/b/devshop-myshopify-com/pdf/move-3.pdf${q}`, headers: {} };
    await sa.attach(req, new URL(req.url, 'https://brew.test')); return req.brewUser?.email || null; };
  assert.equal(await who(jwt(claims)), 'ana@devshop.test');
  assert.equal(await who(jwt(claims, 'forged')), null); assert.equal(await who(jwt({ ...claims, exp: now - 60 })), null, 'expired'); assert.equal(await who(null), null);
});

test('the "Opening Brew…" hand-off waits for the page body: the script runs in <head>, before the box exists', async () => {
  const on = {}; let box = null, replaced = null;
  const location = { origin: 'https://brew.test', href: 'https://brew.test/devshop-myshopify-com?embedded=1&shop=devshop.myshopify.com&host=abc', search: '?embedded=1&shop=devshop.myshopify.com&host=abc', pathname: '/devshop-myshopify-com', hash: '', replace: (u) => { replaced = u; } };
  const win = { location, history: { state: null, replaceState() {} }, sessionStorage: { getItem: () => null, setItem() {} }, setInterval() {}, URL, URLSearchParams, Date,
    document: { readyState: 'loading', getElementById: (id) => (id === 'brew-renew' ? box : null), addEventListener: (ev, f) => { (on[ev] ||= []).push(f); } },
    shopify: { idToken: async () => 'TOKEN' } };
  win.window = win;
  vm.runInNewContext(src('public/shopify-embed.js'), win);
  assert.equal(replaced, null, 'nothing yet: the body is not parsed');
  box = { textContent: 'Opening Brew…' }; win.document.readyState = 'interactive';
  for (const f of on.DOMContentLoaded || []) f();
  await new Promise((r) => setImmediate(r));
  const u = new URL(replaced, 'https://brew.test');
  assert.equal(u.searchParams.get('id_token'), 'TOKEN'); assert.equal(u.searchParams.get('fresh'), '1'); assert.equal(u.pathname, '/devshop-myshopify-com');
});
