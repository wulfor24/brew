// The checkout walk against local stores: a plain cart → /checkout, a checkout app that opens in an iframe over the
// cart after a late button, and a store that sends /checkout back home. Needs Chrome; skipped without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { site, SITE_V, isCheckoutUrl } from '../reader/stages/site.js';
import { siteFailed } from '../reader/index.js';

const chrome = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const page = (body) => `<!doctype html><html><body>${body}</body></html>`;
const product = page('<h1>Wool Sneaker</h1><form action="/cart/add" method="post"><input name="id" value="1"><button type="submit" name="add">Add to cart</button></form>');

function store(kind) {
  return http.createServer((rq, rs) => {
    const u = new URL(rq.url, 'http://x');
    const send = (b, code = 200, h = {}) => { rs.writeHead(code, { 'content-type': 'text/html', ...h }); rs.end(b); };
    if (u.pathname === '/') return send(page('<a href="/products/sneaker">Shop</a>'));
    if (u.pathname === '/products/sneaker') return send(product);
    if (u.pathname === '/cart/add') return send('', 302, { location: '/cart' });
    if (u.pathname === '/cart.js') return send('{"item_count":1}', 200, { 'content-type': 'application/json' });
    if (u.pathname === '/cart') {
      if (kind === 'plain') return send(page('<a href="/checkouts/abc">Check out</a>'));
      if (kind === 'app') return send(page(`<div id="gk"></div><script>setTimeout(() => { const b = document.createElement('button'); b.className = 'gokwik-checkout'; b.textContent = 'Checkout';
        b.onclick = () => { const f = document.createElement('iframe'); f.src = 'http://gokwik.localhost:${rs.socket.localPort}/app'; f.style = 'width:400px;height:600px'; document.body.appendChild(f); }; document.getElementById('gk').appendChild(b); }, 2500);</script>`));
      return send(page('<p>Your cart</p>'));
    }
    if (u.pathname === '/app') return send(page('<p>Enter your mobile number</p><p>Pay with UPI or Cash on delivery</p>'));
    if (u.pathname.startsWith('/checkout')) {
      if (kind === 'bounce') return send('', 302, { location: '/' });
      return send(page('<p>Contact: email or phone</p><p>Credit card</p>'));
    }
    send('no', 404);
  });
}

async function walk(kind) {
  const srv = store(kind); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const home = `http://127.0.0.1:${port}/`;
  const profile = { host: '127.0.0.1', platform: 'shopify', catalog: { hero: ['sneaker'], products: [{ handle: 'sneaker', title: 'Wool Sneaker', url: `${home}products/sneaker`, inStock: true }] } };
  const cards = []; let done;
  const ctx = { profile, ledger: { add() {} }, state: { home: '<html></html>', homeUrl: home }, tick() {}, finding: (k, f) => cards.push(f), done: (k, text, state) => { done = { text, state }; } };
  try { await site(ctx); } finally { srv.close(); }
  return { co: profile.site.checkout, cards, done };
}

test('isCheckoutUrl and siteFailed', () => {
  assert.ok(isCheckoutUrl('https://a.com/checkouts/cn/x'));
  assert.ok(isCheckoutUrl('https://pdp.gokwik.co/x'));
  assert.ok(!isCheckoutUrl('https://a.com/'));
  const p = { host: 'a.com', catalog: { products: [{}] } };
  assert.equal(siteFailed(p), true);
  assert.equal(siteFailed({ ...p, site: { checkout: { v: SITE_V, walk: [{ step: 'Checkout entry', ok: true }] } } }), false);
  assert.equal(siteFailed({ ...p, site: { checkout: { v: 1, walk: [{ step: 'Checkout entry', ok: true }] } } }), true);
  assert.equal(siteFailed({ host: 'a.com', catalog: { products: [] } }), false);
});

test('walk: plain cart reaches the checkout page', { skip: !chrome, timeout: 120e3 }, async () => {
  const { co, done } = await walk('plain');
  assert.equal(co.v, SITE_V);
  assert.ok(co.walk.find((s) => s.step === 'Checkout entry')?.ok);
  assert.deepEqual(co.payments, ['Cards']);
  assert.equal(done.state, 'done');
});

test('walk: a late app button opens an iframe over the cart, which counts and is read', { skip: !chrome, timeout: 120e3 }, async () => {
  const { co, done } = await walk('app');
  assert.equal(co.inPage, 'gokwik');
  assert.ok(co.payments.includes('UPI') && co.payments.includes('Cash on delivery'));
  assert.equal(done.state, 'done');
});

test('walk: /checkout sent back home is not reached, with the reason', { skip: !chrome, timeout: 200e3 }, async () => {
  const { co, cards, done } = await walk('bounce');
  const st = co.walk.find((s) => s.step === 'Checkout entry');
  assert.equal(st.ok, false);
  assert.match(st.err, /went back to \//);
  assert.equal(done.state, 'empty');
  assert.ok(cards[0].rows.some(([k, v]) => k === 'Payments seen' && v === 'not checked'));
});

test('walk: no product does not crash', { skip: !chrome, timeout: 60e3 }, async () => {
  const profile = { host: 'x', catalog: { products: [] } }; let done;
  await site({ profile, ledger: { add() {} }, state: { home: '<html></html>', homeUrl: 'data:text/html,<p>hi</p>' }, tick() {}, finding() {}, done: (k, text, state) => { done = { text, state }; } });
  assert.equal(done.state, 'empty');
  assert.match(done.text, /no in-stock product/);
});
