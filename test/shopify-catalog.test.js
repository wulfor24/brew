// A store behind Shopify's password page (every development store, so every Shopify app reviewer) is read from its Admin API
// (reader/stages/admin.js): the catalog read, the read built from it, the stages that need the public site saying plainly they
// didn't run, the daily look for a reopened store, and the Shopify app's locked path and brand keying (shopify-app.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { adminCatalog, reopenCheck } from '../reader/stages/admin.js';
import { createReader, siteFailed, answersFailed } from '../reader/index.js';
import { ADS_V } from '../reader/stages/ads.js';
import { isPasswordPage, CLOSED_WHY } from '../reader/closed.js';
import { healthFrom } from '../health.js';
import { auditScorecard } from '../moves-cadence.js';
import { slugOf as readerSlug } from '../reader/util.js';
import { createShopifyApp } from '../shopify-app.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const DAY = new Date().toISOString().slice(0, 10);
const node = (handle, title, price, o = {}) => ({ id: `gid://shopify/Product/${o.id || 1}`, handle, title, descriptionHtml: `<p>${title}: clinically tested in 14 days.</p>`, productType: 'Serum', vendor: 'Dev Shop', tags: ['skin'],
  createdAt: '2026-10-01T00:00:00Z', publishedAt: '2026-10-02T00:00:00Z', media: { nodes: [{ image: { url: `https://cdn.brew-test.invalid/${handle}.jpg` } }, {}] },
  variants: { nodes: [{ price: String(price), compareAtPrice: o.mrp ? String(o.mrp) : null, availableForSale: o.stock !== false }] } });
/* a fake Admin GraphQL: the shop, its plan, two pages of products, collections refused (a scope), the brand kit */
function fakeAdmin({ products = [node('glow-serum', 'Glow Serum', 24, { id: 11, mrp: 30 }), node('night-cream', 'Night Cream', 18, { id: 12, stock: false })], throttleOnce = true, collections = 'denied', host = 'devshop.myshopify.com' } = {}) {
  const asked = []; let throttled = !throttleOnce;
  const gql = async (q, v) => {
    asked.push(q.replace(/\s+/g, ' ').slice(0, 40));
    if (/productsCount\(query/.test(q) && /shop\{ name/.test(q)) return { shop: { name: 'Dev Shop', description: 'Small-batch skincare made in Pune.', myshopifyDomain: 'devshop.myshopify.com', primaryDomain: { host }, currencyCode: 'INR', shipsToCountries: ['IN'], billingAddress: { countryCodeV2: 'IN', city: 'Pune', province: 'MH' } }, productsCount: { count: products.length } };
    if (/partnerDevelopment/.test(q)) return { shop: { plan: { partnerDevelopment: true } } };
    if (/products\(first/.test(q)) {
      if (!throttled) { throttled = true; throw new Error('shopify graphql 200: [{"message":"Throttled","extensions":{"code":"THROTTLED"}}]'); }
      const page = v?.c ? 1 : 0, half = Math.ceil(products.length / 2), nodes = page ? products.slice(half) : products.slice(0, half);
      return { products: { pageInfo: { hasNextPage: !page && products.length > half, endCursor: page ? null : 'c1' }, nodes } };
    }
    if (/collections\(first/.test(q)) { if (collections === 'denied') throw new Error('shopify graphql 200: ACCESS_DENIED'); return { collections: { nodes: [{ handle: 'all', title: 'All', productsCount: { count: 2 } }] } }; }
    if (/brand\{/.test(q)) return { shop: { brand: { slogan: 'Skin that glows', shortDescription: null, logo: { image: { url: 'https://cdn.brew-test.invalid/logo.png' } }, colors: { primary: [{ background: '#AA3366' }], secondary: [] } } } };
    throw new Error('unexpected query ' + q.slice(0, 60));
  };
  return { gql, asked };
}

test('the Admin API catalog: active products in the products.json shape, the shop’s facts, a throttle waited out, a refused scope kept as an error', async () => {
  const { gql } = fakeAdmin();
  const s = await adminCatalog({ gql, log: quiet });
  assert.equal(s.shop.name, 'Dev Shop'); assert.equal(s.shop.currency, 'INR'); assert.equal(s.shop.country, 'IN'); assert.equal(s.shop.dev, true); assert.equal(s.shop.myshopify, 'devshop.myshopify.com');
  assert.equal(s.products.length, 2, 'both pages read'); assert.equal(s.count, 2); assert.equal(s.partial, false);
  const p = s.products[0];
  assert.equal(p.id, 11); assert.equal(p.handle, 'glow-serum'); assert.equal(p.variants[0].price, '24'); assert.equal(p.variants[0].compare_at_price, '30'); assert.equal(p.variants[0].available, true);
  assert.deepEqual(p.images, [{ src: 'https://cdn.brew-test.invalid/glow-serum.jpg' }], 'images only, an empty media node dropped');
  assert.equal(s.products[1].variants[0].available, false);
  assert.equal(s.collections, null, 'collections Shopify refused are not "none"'); assert.match(s.errors.collections, /ACCESS_DENIED/);
  assert.equal(s.brand.logo, 'https://cdn.brew-test.invalid/logo.png'); assert.deepEqual(s.brand.colors, ['#aa3366']);
  const capped = await adminCatalog({ gql: fakeAdmin({ products: Array.from({ length: 4 }, (_, i) => node('p' + i, 'P' + i, 5, { id: i + 1 })), throttleOnce: false }).gql, max: 50, log: quiet });
  assert.equal(capped.products.length, 2); assert.equal(capped.partial, true, 'more products than read is said, not hidden');
});

test('the password page is recognised by its path or its form, and a store page is not', () => {
  assert.ok(isPasswordPage({ url: 'https://x.myshopify.com/password', text: '' }));
  assert.ok(isPasswordPage({ url: 'https://x.com/', text: '<form method="post" action="/password" id="login_form">' }));
  assert.ok(!isPasswordPage({ url: 'https://x.com/', text: '<html><a href="/products/a">A</a></html>' }));
});

test('a myshopify (shared platform) host is its own brand in the reader too, never "myshopify-com"', () => {
  assert.equal(readerSlug('https://devshop.myshopify.com/'), 'devshop-myshopify-com');
  assert.equal(readerSlug('https://www.arata.in/collections/all'), 'arata-in');
});

/* the reader with no network: pages come from a fake raw cache (the password page, a reopened home), photos fail (.invalid) */
const PASSWORD_HTML = `<!doctype html><html><head><title>Dev Shop</title><style>:root{--color-button: 170, 51, 102;}</style></head><body class="template-password"><h1>Opening soon</h1><form method="post" action="/password"><input type="password" name="password"></form>${'<p>Be the first to know.</p>'.repeat(80)}</body></html>`;
const rawFake = (pages) => async (slug, key) => { for (const [pre, hit] of Object.entries(pages)) if (key.startsWith(pre)) return hit; return null; };

async function closedRead() {
  const { gql } = fakeAdmin({ throttleOnce: false });
  const snap = await adminCatalog({ gql, log: quiet });
  const saved = {};
  const reader = createReader({ ai: null, treg: null, log: quiet, saveAsset: async () => null, saveRaw: async (s, k, v) => { saved[k] = v; },
    loadRaw: rawFake({ 'password-page-': { ok: true, status: 200, url: 'https://devshop.myshopify.com/password', text: PASSWORD_HTML } }) });
  const out = await reader.read('https://devshop.myshopify.com/', { admin: snap, only: ['open', 'brand', 'catalog', 'reviews', 'site', 'answers'] });
  return { out, snap };
}

test('a closed store’s read opens from the admin: name, market, catalog with prices and sources, then a profile the moves can use', async () => {
  const { out } = await closedRead(), p = out.profile;
  assert.equal(out.opened, true, 'the read opened (the build goes on to the brief and the moves)');
  assert.equal(out.slug, 'devshop-myshopify-com');
  assert.equal(p.name, 'Dev Shop'); assert.equal(p.platform, 'shopify'); assert.equal(p.currency, 'INR'); assert.equal(p.country, 'IN');
  assert.equal(p.about, 'Small-batch skincare made in Pune.'); assert.equal(p.descriptor, 'Skin that glows');
  assert.equal(p.closed.why, 'password'); assert.equal(p.source.kind, 'shopify-admin');
  assert.equal(p.catalog.count, 2); assert.equal(p.catalog.source, 'shopify admin');
  const g = p.catalog.products.find((x) => x.handle === 'glow-serum');
  assert.equal(g.price, 24); assert.equal(g.mrp, 30); assert.equal(g.inStock, true); assert.ok(g.claims.length, 'claim lines come from the description');
  const price = out.ledger.find((e) => e.key === 'price.glow-serum');
  assert.equal(price.method, 'shopify-admin'); assert.match(price.url, /^https:\/\/admin\.shopify\.com\/store\/devshop\/products\/11$/);
  assert.equal(out.ledger.find((e) => e.key === 'catalog.out_of_stock').n, 1);
  assert.ok(!/opening soon/i.test(p.tagline || ''), 'the password page’s "Opening soon" is not the tagline');
  assert.ok((p.identity.colors || []).includes('#aa3366'), 'the theme colour from the password page (or the brand settings)');
});

test('the stages that need the public site say plainly they didn’t run because the store is closed, never "none"', async () => {
  const { out } = await closedRead(), p = out.profile, step = (k) => out.findings.steps.find((s) => s.k === k);
  for (const k of ['site', 'answers']) { assert.equal(step(k).state, 'empty'); assert.match(step(k).done, /password page/); }
  assert.match(step('reviews').done, /password page/); assert.ok(!/no reviews found/i.test(step('reviews').done));
  assert.match(step('open').done, /Shopify admin: 2 products/);
  const cards = out.findings.cards;
  assert.match(cards.find((c) => c.k === 'site').cap, /didn’t run: the storefront is behind Shopify’s password page/);
  assert.match(cards.find((c) => c.k === 'answers').a, /weren’t asked/);
  assert.match(cards.find((c) => c.k === 'reviews').cap, /not read: the storefront is behind/); assert.ok(!/No reviews found/.test(cards.find((c) => c.k === 'reviews').cap));
  assert.ok(p.site.checkout.closed && p.site.pagespeed.closed && p.ai.closed && p.reviews.closed);
  assert.equal(siteFailed(p), false, 'heal doesn’t walk a closed store'); assert.equal(answersFailed(p, out.findings), false, 'nor ask the AI tools');
  /* the rings and the scorecard: closed parts are left out with the reason, never scored as zero or "none" */
  const h = healthFrom(p), ring = (k) => h.rings.find((r) => r.k === k);
  assert.equal(ring('AI answers').read, false); assert.match(ring('AI answers').what, /Not asked: the storefront is behind/);
  assert.equal(ring('Storefront').read, true, 'photos per product still count'); assert.match(ring('Storefront').what, /wait: the storefront is behind/);
  assert.ok(!ring('Storefront').parts.some((x) => /Reviews on the site/.test(x.k)), 'site reviews not scored as 0');
  const sc = auditScorecard({ profile: p, slug: 'devshop-myshopify-com' }).areas, area = (k) => sc.find((a) => a.k === k);
  const notes = sc.flatMap((a) => a.parts.map((x) => x.note)).join('\n');
  assert.ok(!/: none|no review widget|no YouTube|no reviews/i.test(notes), notes);
  assert.match(area('ai').parts[0].note, /AI answers: not checked, the storefront is behind/);
  assert.match(area('seo').parts.find((x) => x.k === 'Ranks for category searches').note, /Google rank: not checked/);
});

test('a public read of Shopify’s password page does not open: the store is closed, not read as a brand', async () => {
  const reader = createReader({ ai: null, treg: null, log: quiet, saveAsset: async () => null, saveRaw: async () => {},
    loadRaw: rawFake({ 'home-': { ok: true, status: 200, url: 'https://devshop.myshopify.com/password', text: PASSWORD_HTML } }) });
  const out = await reader.read('https://devshop.myshopify.com/');
  assert.equal(out.opened, false); assert.equal(out.closed, true);
  assert.match(out.findings.steps.find((s) => s.k === 'open').done, /could not open/);
});

test('heal: a closed store is looked at once a day; still closed it only says when, open again the skipped stages are marked to run', async () => {
  const { out } = await closedRead();
  const twoDays = new Date(Date.now() - 2 * 864e5).toISOString();
  const saved = { ...out.profile, closed: { ...out.profile.closed, checkedAt: twoDays }, descriptorBy: 'claude', ads: { v: ADS_V, own: { page: 'Dev Shop', live: 0 }, rivals: [] }, meta: { ...out.profile.meta, errors: {} } };
  const still = createReader({ ai: null, treg: null, log: quiet, saveAsset: async () => null, saveRaw: async () => {}, loadRaw: rawFake({ ['reopen-' + DAY]: { ok: true, status: 200, url: 'https://devshop.myshopify.com/password', text: PASSWORD_HTML } }) });
  const h = await still.heal(saved, { findings: out.findings, ledger: out.ledger, log: quiet });
  assert.deepEqual(h.changed, ['closed']); assert.ok(h.profile.closed); assert.ok(Date.parse(h.profile.closed.checkedAt) > Date.parse(twoDays));
  assert.equal(await still.heal(h.profile, { findings: out.findings, log: quiet }), null, 'checked today: nothing to do until tomorrow');
  /* open now: every stage the closed read skipped is marked, so the read's own heal runs it */
  const p = structuredClone(saved);
  const r = await reopenCheck({ profile: p, http: { get: async () => ({ ok: true, status: 200, url: 'https://devshop.myshopify.com/', text: '<html><a href="/products/glow-serum">Glow</a></html>' }) } });
  assert.equal(r, 'reopened'); assert.equal(p.closed, undefined); assert.equal(p.site.checkout, null); assert.equal(p.site.pagespeed, null); assert.equal(p.ai.closed, undefined);
  assert.equal(siteFailed(p), true, 'the checkout walk runs'); assert.equal(answersFailed(p, null), true, 'the AI tools are asked');
  assert.ok(p.meta.errors.reviews && p.meta.errors.socials, 'reviews and socials are read again');
});

/* ---------- the Shopify app: the locked path and which brand a store becomes ---------- */
const ID = 'test-client-id', SECRET = 'test-secret';
const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const jwt = (body) => { const h = b64u({ alg: 'HS256', typ: 'JWT' }), p = b64u(body); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const now = Math.floor(Date.now() / 1e3);
const claims = (shop = 'devshop.myshopify.com') => ({ iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: ID, sub: '42', exp: now + 60, nbf: now - 5, iat: now, jti: 'x', sid: 's' });

function rig({ brands = {}, primary = 'devshop.myshopify.com', pages = {}, products } = {}) {
  process.env.FEED_SHOPIFY_CLIENT_ID = ID; process.env.FEED_SHOPIFY_CLIENT_SECRET = SECRET; process.env.PUBLIC_URL = 'https://brew.test';
  const team = {}, finished = [], started = [];
  const admin = fakeAdmin({ throttleOnce: false, host: primary, ...(products ? { products } : {}) });
  const auth = { baseOf: () => 'https://brew.test', sign: (x, s, kind) => `${kind}:${b64u(x)}`, verify: () => null, setCookie: () => {},
    claimInfo: async (slug, me) => ({ role: team[slug]?.[me.email] || null, claimed: !!brands[slug]?.claimed || Object.values(team[slug] || {}).includes('owner') }),
    addMember: async (slug, me, role) => { (team[slug] ||= {})[me.email] = role; } };
  const connectors = { liveOf: async () => ({ conns: {} }), finish: async (slug, id, creds) => { finished.push({ slug, creds }); return { ok: true }; }, disconnect: async () => ({ ok: true }), shopSlug: async () => null };
  const builder = { status: async (slug) => brands[slug] || null, saveAdmin: async () => true,
    start: async (url, o) => { started.push({ url, ...o, user: o.user.email }); return { slug: url.replace(/\./g, '-') }; } };
  const fetchFn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.endsWith('/admin/oauth/access_token')) return new Response(JSON.stringify(body.requested_token_type?.includes('online') ? { access_token: 'online', associated_user: { id: 7, email: 'dev@devshop.test', first_name: 'Dee', account_owner: true } } : { access_token: 'offline-tok', scope: 'read_products', expires_in: 3600 }));
    if (url.includes('/graphql.json')) { const q = body.query;
      if (/\{ shop \{ id name/.test(q)) return new Response(JSON.stringify({ data: { shop: { id: 'gid://shopify/Shop/555', name: 'Dev Shop', myshopifyDomain: 'devshop.myshopify.com', primaryDomain: { host: primary } } } }));
      try { return new Response(JSON.stringify({ data: await admin.gql(q, body.variables) })); } catch (e) { return new Response(JSON.stringify({ errors: [{ message: e.message }] })); } }
    const page = pages[url]; if (page instanceof Error) throw page;
    if (page) return Object.defineProperty(new Response(page.text, { headers: page.headers || {} }), 'url', { value: page.url || url });
    throw new Error('unexpected ' + url);
  };
  const sa = createShopifyApp({ auth, connectors, builder, packs: {}, log: quiet, fetchFn });
  return { sa, team, finished, started };
}
const call = async (sa, path, shop) => {
  const { Readable } = await import('node:stream'); const req = Readable.from([]); Object.assign(req, { method: 'POST', url: path, headers: { authorization: `Bearer ${jwt(claims(shop))}` } });
  const u = new URL(path, 'https://brew.test'); let out = { code: 0, body: '' };
  const res = { setHeader() {}, writeHead(c) { out.code = c; }, end(b) { out.body = b ? String(b) : ''; } };
  await sa.attach(req, u); await sa.handle(req, res, u); return JSON.parse(out.body || '{}');
};
const password = (shop = 'devshop.myshopify.com', host = shop) => ({ url: `https://${host}/password`, text: `<html><script>Shopify.shop = "${shop}";</script>${PASSWORD_HTML}</html>` });

test('a development store behind the password page: the home offers the read, and the tap reads it from the admin as that store’s own brand', async () => {
  const x = rig({ pages: { 'https://devshop.myshopify.com/': password() } });
  const s = await call(x.sa, '/shopify/api/session');
  assert.deepEqual(s, { state: 'unread', host: 'devshop.myshopify.com', name: 'Dev Shop', locked: true });
  assert.equal(x.started.length, 0, 'never a read on install by itself');
  const r = await call(x.sa, '/shopify/api/read');
  assert.equal(r.slug, 'devshop-myshopify-com'); assert.equal(r.error, undefined);
  assert.equal(x.started[0].url, 'devshop.myshopify.com'); assert.equal(x.started[0].user, 'dev@devshop.test');
  assert.equal(x.started[0].admin.products.length, 2, 'the Admin API snapshot goes with the read'); assert.equal(x.started[0].admin.shop.host, 'devshop.myshopify.com');
  assert.equal(x.team['devshop-myshopify-com']['dev@devshop.test'], 'owner', 'the store’s own brand: its installer owns it');
  assert.equal(x.finished[0].creds.token, 'offline-tok', 'Shopify connects itself');
});

test('a closed store with no active products says what to do instead of starting an empty read', async () => {
  const x = rig({ pages: { 'https://devshop.myshopify.com/': password() }, products: [] });
  const r = await call(x.sa, '/shopify/api/read');
  assert.match(r.error, /no active products yet/); assert.equal(x.started.length, 0);
});

test('a dev store can’t reach another brand’s domain: a custom domain counts only when it serves this very store', async () => {
  /* the primary domain is another brand Brew has read, and its page names another Shopify store */
  const other = rig({ brands: { 'arata-in': { slug: 'arata-in' } }, primary: 'arata.in', pages: { 'https://arata.in/': { text: '<script>Shopify.shop = "arata-real.myshopify.com";</script><a href="/products/x">x</a>', headers: { 'x-shopid': '999' } } } });
  const s = await call(other.sa, '/shopify/api/session');
  assert.equal(s.state, 'unread'); assert.equal(s.host, 'devshop.myshopify.com', 'keyed by its own myshopify host');
  assert.deepEqual(other.team, {}, 'nobody joined arata-in');
  /* the domain doesn't answer: a development store still keeps to its own host */
  const quietDomain = rig({ brands: { 'arata-in': { slug: 'arata-in' } }, primary: 'arata.in', pages: { 'https://arata.in/': new Error('timeout') } });
  assert.equal((await call(quietDomain.sa, '/shopify/api/session')).host, 'devshop.myshopify.com');
  /* the domain's password page names this shop (or its id): it is this store's domain, and the read keys by it */
  const mine = rig({ primary: 'devshop.in', pages: { 'https://devshop.in/': { ...password('devshop.myshopify.com', 'devshop.in'), headers: { 'x-shopid': '555' } } } });
  const s2 = await call(mine.sa, '/shopify/api/session');
  assert.deepEqual(s2, { state: 'unread', host: 'devshop.in', name: 'Dev Shop', locked: true });
  const r2 = await call(mine.sa, '/shopify/api/read'); assert.equal(r2.slug, 'devshop-in'); assert.equal(mine.started[0].admin.shop.host, 'devshop.in');
});

test('a brand whose web read hit the password page is read again from the admin, not linked as it is', async () => {
  const x = rig({ brands: { 'devshop-myshopify-com': { slug: 'devshop-myshopify-com', unreadable: true } }, pages: { 'https://devshop.myshopify.com/': password() } });
  assert.equal((await call(x.sa, '/shopify/api/session')).state, 'unread');
  await call(x.sa, '/shopify/api/read');
  assert.equal(x.started[0].fresh, true, 'a fresh start over the failed one'); assert.ok(x.started[0].admin);
});

test('every closed-store line names the reason the same way', () => { assert.match(CLOSED_WHY, /password page/); });

/* ---------- the build: the snapshot is kept privately and every read of the brand opens from it while the store is closed ---------- */
test('the build keeps the Admin API snapshot privately and hands it to the read; a web read of a password page says how to read it', async () => {
  process.env.REFRESH_AUTO = '0';
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { createBuilder } = await import('../build.js'), { createPacks } = await import('../brand-pack.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-closed-')), P = createPacks({ ROOT, PUB: path.join(process.cwd(), 'public'), bucket: null, gToken: null, log: quiet });
  const reads = []; let done; const read = new Promise((r) => { done = r; });
  const modules = { reader: { createReader: () => ({ read: async (url, o) => { reads.push({ url, admin: o.admin }); done(); return { opened: false, closed: !o.admin, findings: { steps: [], cards: [] } }; } }) }, brief: null, moves: null, pdf: null };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {} }, treg: { onCharge() {} }, log: quiet, modules });
  const snap = await adminCatalog({ gql: fakeAdmin({ throttleOnce: false }).gql, log: quiet });
  const r = await b.start('devshop.myshopify.com', { user: { email: 'dev@devshop.test' }, admin: snap });
  assert.equal(r.slug, 'devshop-myshopify-com'); await read; await new Promise((x) => setTimeout(x, 50));
  assert.equal(reads[0].admin.products.length, 2, 'the read opens from the snapshot');
  assert.equal((await P.getJSON(r.slug, 'private/admin-catalog.json')).shop.name, 'Dev Shop', 'kept under private/, never served');
  const s = await b.status(r.slug); assert.equal(s.source.kind, 'shopify-admin'); assert.equal(s.source.shop, 'devshop.myshopify.com');
  assert.equal(await b.saveAdmin('devshop-myshopify-com', { ...snap, at: '2026-10-21T00:00:00Z' }), true, 'a newer snapshot from the app');
  assert.equal((await b.status(r.slug)).source.at, '2026-10-21T00:00:00Z');
  /* a brand started from the web whose storefront is the password page: no snapshot, and the status says where to read it */
  const w = await b.start('closed-example.myshopify.com', { user: { email: 'web@example.test' } });
  await new Promise((x) => setTimeout(x, 80));
  assert.equal(reads.at(-1).admin, null); assert.equal(await b.saveAdmin(w.slug, snap), false, 'only a brand started from the app takes snapshots');
  const ws = await b.status(w.slug); assert.equal(ws.unreadable, true); assert.match(ws.state, /behind Shopify’s password page.*Open Brew from your Shopify admin/);
});

test('the embedded home’s own scripts are files, not app routes: /shopify-home.js and /shopify-embed.js are left to the static server', async () => {
  const x = rig();
  for (const f of ['/shopify-home.js', '/shopify-embed.js']) {
    const { Readable } = await import('node:stream'); const req = Readable.from([]); Object.assign(req, { method: 'GET', url: f, headers: { 'sec-fetch-dest': 'script' } });
    const res = { setHeader() {}, writeHead() {}, end() {} };
    assert.equal(await x.sa.handle(req, res, new URL(f, 'https://brew.test')), false, f);
  }
});
