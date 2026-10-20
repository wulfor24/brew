// A store not open yet (2026-10-20): a brand read from its Shopify Admin API while its storefront is behind Shopify's password
// page (status.source.kind 'shopify-admin', profile.closed) holds the merchant's unpublished catalog, so only its team sees it:
// members and Brew's own full-access people. Everyone else gets a plain "This store isn't open yet" page (never a 404, never
// demo mode), the API and files a 401/403. Once a heal finds the store open, it is public like every other brand. No paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isClosedRead, slugIn, createClosedGate, CLOSED_H } from '../closed-gate.js';
import { reopenCheck } from '../reader/stages/admin.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN = { kind: 'shopify-admin', shop: 'devshop.myshopify.com', at: '2026-10-20T00:00:00Z' };

test('closed: an admin read whose store hasn’t opened (or whose profile isn’t written yet); a web read never is', () => {
  assert.equal(isClosedRead({ source: ADMIN }, { closed: { why: 'password' } }), true);
  assert.equal(isClosedRead({ source: ADMIN }, null), true, 'the read is still running: closed, as build.js adminFor reads it');
  assert.equal(isClosedRead({ source: ADMIN }, { name: 'Devshop' }), false, 'a heal found it open');
  assert.equal(isClosedRead({ source: null }, { closed: { why: 'password' } }), false);
  assert.equal(isClosedRead({}, null), false); assert.equal(isClosedRead(null, null), false);
});

test('the brand a request names: page, seed/facts/PDFs, brand routes, the connector start, x-brand calls', () => {
  const R = (p, h = {}) => slugIn({ headers: h }, new URL('http://x' + p));
  assert.equal(R('/devshop-myshopify-com'), 'devshop-myshopify-com'); assert.equal(R('/Devshop-Myshopify-Com/'), 'devshop-myshopify-com');
  for (const f of ['seed.js', 'facts.js', 'pdf/move-3.pdf', 'pdf/01 One.pdf']) assert.equal(R(`/b/devshop-myshopify-com/${f}`), 'devshop-myshopify-com', f);
  assert.equal(R('/b/devshop-myshopify-com/a/logo.svg'), null, 'photos load inside the Shopify admin, where an <img> carries no token');
  for (const p of ['status', 'moves', 'moves/4', 'facts', 'heard', 'told', 'calendar', 'memory', 'drop']) assert.equal(R(`/api/brands/devshop-myshopify-com/${p}`), 'devshop-myshopify-com', p);
  assert.equal(R('/connect/ga4/start?brand=devshop-myshopify-com'), 'devshop-myshopify-com');
  assert.equal(R('/api/tenants', { 'x-brand': 'devshop-myshopify-com' }), 'devshop-myshopify-com');
  assert.equal(R('/api/tenants?brand=devshop-myshopify-com'), 'devshop-myshopify-com');
  assert.equal(R('/api/research', { 'x-brand': 'devshop-myshopify-com' }), 'devshop-myshopify-com');
  for (const p of ['/', '/api/config', '/auth/google', '/privacy', '/app.js', '/shopify', '/gen/x.png']) assert.equal(R(p), null, p);
});

/* a fake response: what the gate wrote */
const resOf = () => { const r = { code: null, head: {}, body: '', setHeader(k, v) { this.head[k.toLowerCase()] = v; }, writeHead(c, h = {}) { this.code = c; for (const [k, v] of Object.entries(h)) this.head[k.toLowerCase()] = v; }, end(b = '') { this.body = String(b); } }; return r; };
const gateOf = ({ status, profile, team = {}, on = true, renew } = {}) => {
  const reads = { profile: 0 };
  const G = createClosedGate({ status: async () => status, profile: async () => (reads.profile++, profile), user: (req) => req.me || null, roleOf: async (slug, me) => team[me.email] || null, on: () => on, renew, ttl: 0, log: quiet });
  return { G, reads, ask: async (p, me = null, h = {}) => { const res = resOf(), u = new URL('http://x' + p); const hit = await G.gate({ me, headers: h }, res, u); return { hit, ...res }; } };
};

test('a closed store: its team and Brew’s people get through; anyone else gets the plain page, a 401/403, never a 404', async () => {
  const { ask } = gateOf({ status: { source: ADMIN }, profile: { closed: { why: 'password' } }, team: { 'ana@devshop.in': 'owner', 'raj@devshop.in': 'member', 'staff@joinsquareup.com': 'admin' } });
  for (const who of ['ana@devshop.in', 'raj@devshop.in', 'staff@joinsquareup.com']) for (const p of ['/devshop-myshopify-com', '/b/devshop-myshopify-com/seed.js', '/api/brands/devshop-myshopify-com/status'])
    assert.equal((await ask(p, { email: who })).hit, false, `${who} ${p}`);
  const page = await ask('/devshop-myshopify-com');
  assert.equal(page.hit, true); assert.equal(page.code, 403); assert.match(page.head['content-type'], /text\/html/);
  assert.ok(page.body.includes('This store isn’t open yet'), 'the plain page'); assert.match(page.body, /href="\/auth\/google\?next=%2Fdevshop-myshopify-com"/, 'the team can sign in');
  assert.doesNotMatch(page.body, /seed\.js|facts\.js|Demo/i, 'not the brand page, not demo mode');
  assert.equal(page.head['x-robots-tag'], 'noindex');
  const signedIn = await ask('/devshop-myshopify-com', { email: 'x@gmail.com' });
  assert.equal(signedIn.code, 403); assert.match(signedIn.body, /signed in as x@gmail\.com/); assert.match(signedIn.body, /Switch account/);
  const api = await ask('/api/brands/devshop-myshopify-com/moves'); assert.equal(api.code, 401); const j = JSON.parse(api.body); assert.equal(j.closed, true); assert.equal(j.signin, true); assert.ok(j.error.startsWith(CLOSED_H));
  assert.equal((await ask('/api/brands/devshop-myshopify-com/status', { email: 'x@gmail.com' })).code, 403);
  const seed = await ask('/b/devshop-myshopify-com/seed.js'); assert.equal(seed.code, 401); assert.match(seed.head['content-type'], /javascript/); assert.doesNotMatch(seed.body, /window\.|Secret/);
  assert.equal((await ask('/b/devshop-myshopify-com/pdf/move-1.pdf', { email: 'x@gmail.com' })).code, 403);
  assert.equal((await ask('/api/tenants', null, { 'x-brand': 'devshop-myshopify-com' })).code, 401);
});

test('inside the Shopify admin a page with nobody on it asks who is looking (renew) before it says closed', async () => {
  let asked = 0; const renew = () => (asked++, '<div id="brew-renew">Opening Brew…</div>');
  const { ask } = gateOf({ status: { source: ADMIN }, profile: { closed: {} }, renew });
  const r = await ask('/devshop-myshopify-com'); assert.equal(r.code, 200); assert.match(r.body, /brew-renew/); assert.equal(asked, 1);
  assert.equal((await ask('/devshop-myshopify-com', { email: 'x@gmail.com' })).code, 403, 'someone signed in is judged as they are');
  assert.equal((await ask('/api/brands/devshop-myshopify-com/status')).code, 401, 'the API never renews: fetch carries the token');
});

test('every other brand is untouched: a web read, an opened store, the gate off; only an admin read pays for its profile', async () => {
  const web = gateOf({ status: { source: null }, profile: { closed: {} } });
  assert.equal((await web.ask('/acme-com')).hit, false); assert.equal(web.reads.profile, 0, 'a web read never reads its profile here');
  assert.equal((await gateOf({ status: { source: ADMIN }, profile: { name: 'Devshop' } }).ask('/devshop-myshopify-com')).hit, false, 'open now: public');
  assert.equal((await gateOf({ status: null }).ask('/no-such-brand')).hit, false, 'an unknown brand: its own route answers (404)');
  assert.equal((await gateOf({ status: { source: ADMIN }, profile: { closed: {} }, on: false }).ask('/devshop-myshopify-com')).hit, false, 'demo site, sign-in off');
});

test('the heal’s reopen lifts the gate: reopenCheck clears profile.closed and the brand is public again', async () => {
  const profile = { url: 'https://devshop.myshopify.com/', closed: { why: 'password', at: '2026-10-01T00:00:00Z', checkedAt: '2026-10-01T00:00:00Z' }, site: { closed: true }, ai: { closed: true } };
  let st = profile; const G = createClosedGate({ status: async () => ({ source: ADMIN }), profile: async () => st, user: () => null, roleOf: async () => null, ttl: 0, log: quiet });
  const at = async () => G.gate({ headers: {} }, resOf(), new URL('http://x/devshop-myshopify-com'));
  assert.equal(await at(), true);
  const http0 = { get: async () => ({ ok: true, url: 'https://devshop.myshopify.com/', text: '<html><body>Shop now</body></html>' }) };
  assert.equal(await reopenCheck({ profile, http: http0 }, { now: Date.parse('2026-10-20T00:00:00Z') }), 'reopened');
  assert.equal(profile.closed, undefined); st = { ...profile };
  assert.equal(await at(), false, 'public like every other brand');
});

test('the wiring: the gate runs right after sign-in routes, feed workspaces ask it, the Shopify admin carries the token', () => {
  const s = src('server.js'), f = src('feed-service.js'), sa = src('shopify-app.js'), home = src('public/shopify-home.js'), em = src('public/shopify-embed.js');
  assert.match(s, /if \(await auth\.handle\(req, res, u\)\) return;\n    if \(await closedGate\.gate\(req, res, u\)\) return;/);
  assert.match(s, /on: \(\) => !DEMO && auth\.signinOn\(\)/);
  assert.match(f, /if \(br\.kind === 'generated' && o\.closedFor && await o\.closedFor\(req, res, u, br\.slug\)\) return true;/);
  assert.match(s, /closedFor: \(req, res, u, slug\) => closedGate\.closedFor\(req, res, u, slug\)/);
  assert.match(home, /k\.set\('id_token', t\)/, 'the home opens the brand page as the person');
  assert.match(em, /getElementById\('brew-renew'\)/); assert.match(em, /u\.searchParams\.delete\('id_token'\)/, 'the token leaves the address once the page is up');
  assert.ok(sa.includes('(?:seed|facts)') && sa.includes('?id_token=${encodeURIComponent(tk)}'), 'the seed and facts scripts load as the person');
});

/* the real server: a closed store, the same store once open, as a stranger, signed out, a member and Brew staff */
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const req = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((res, rej) => { const r = http.request(url, { method, headers }, (x) => { let b = ''; x.on('data', (c) => (b += c)); x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: b })); }); r.on('error', rej); if (body) r.write(body); r.end(); });
/* the server runs from a scratch root (its own server.js, every other file linked): its .brands/ and .tenants/ are its own, so
   the repo's saved packs (other tests read them) never see these brands */
const scratchRoot = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-closed-'));
  for (const e of fs.readdirSync(REPO)) if (!['.brands', '.tenants', '.git', 'test', 'server.js'].includes(e)) fs.symlinkSync(path.join(REPO, e), path.join(root, e));
  fs.copyFileSync(path.join(REPO, 'server.js'), path.join(root, 'server.js')); return root; };
const writeBrand = (root, slug, { closed }) => {
  const d = path.join(root, '.brands', slug), w = (f, x) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), typeof x === 'string' ? x : JSON.stringify(x)); };
  const host = slug.replace(/-myshopify-com$/, '.myshopify.com');
  w('status.json', { slug, name: 'Devshop', host, url: `https://${host}/`, done: true, ready: true, stages: { read: { state: 'done' } }, source: { ...ADMIN, shop: host } });
  w('profile.json', { name: 'Devshop', host, slug, url: `https://${host}/`, platform: 'shopify', ...(closed ? { closed: { why: 'password', at: new Date().toISOString(), checkedAt: new Date().toISOString(), shop: host } } : {}), catalog: { products: [{ title: 'Secret Launch Serum', price: 1299, url: 'https://admin.shopify.com/store/x/products/1' }] } });
  w('seed.json', { brand: { name: 'Devshop', host, mark: 'assets/brew-mark.svg' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [{ id: 'p1', type: 'idea', title: 'Secret Launch Serum at ₹1,299', time: '1h' }], scrape: [], steps: [] });
  w('facts.json', {}); w('config.json', { countryName: '', questions: [], rivals: [] }); w('ledger.json', []);
  w('private/members.json', { owner: 'ana@devshop.test', members: [{ email: 'ana@devshop.test', name: 'ana', role: 'owner', seats: 'all', via: 'Shopify admin', at: 1 }], invites: [] });
  return d;
};
test('on the server: a closed store is its team’s only; once open it is public; never a 404 or demo mode', { timeout: 120e3 }, async () => {
  const tag = Math.random().toString(36).slice(2, 8), closed = `closed${tag}-myshopify-com`, opened = `opened${tag}-myshopify-com`;
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const root = scratchRoot(); writeBrand(root, closed, { closed: true }); writeBrand(root, opened, { closed: false });
  const env = { ...process.env, PORT: String(port), AI_MOCK: '1', BUILD_RESUME_OFF: '1', HEAL_OFF: '1', RESEARCH_OFF: '1', LIVE_OFF: '1', TREG_OFF: '1', DRAFTS_BG_OFF: '1', REFRESH_AUTO: '0', DEMO_MODE: '',
    ENV_FILE: '/nonexistent/.env', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', FEED_SESSION_SECRET: 'closed-store-test', DEV_LOGIN: '1', FULL_ACCESS_DOMAINS: 'joinsquareup.com', CLOSED_GATE_TTL: '0' };
  for (const k of ['K_SERVICE', 'GOOGLE_CLOUD_PROJECT', 'RESEARCH_BUCKET', 'DEV_MEMBER', 'FEED_SIGNIN', 'ADMIN_EMAILS', 'FEED_SHOPIFY_CLIENT_ID']) delete env[k];
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; child.stdout.on('data', (c) => (log += c)); child.stderr.on('data', (c) => (log += c));
  try {
    let up = false; for (let i = 0; i < 100 && !up; i++) { await sleep(300); if (child.exitCode != null) break; up = await req(`${base}/api/config`).then((r) => r.status === 200).catch(() => false); }
    assert.ok(up, `the server did not come up:\n${log.slice(-2000)}`);
    const cookieOf = async (email) => { const r = await req(`${base}/auth/dev?email=${encodeURIComponent(email)}&name=${encodeURIComponent(email.split('@')[0])}&next=/`); return String(r.headers['set-cookie'] || '').split(';')[0]; };
    const as = { out: '', stranger: await cookieOf('x@gmail.com'), member: await cookieOf('ana@devshop.test'), staff: await cookieOf('staff@joinsquareup.com') };
    const get = (p, who, h = {}) => req(base + p, { headers: { ...(as[who] ? { cookie: as[who] } : {}), ...h } });

    for (const who of ['out', 'stranger']) {
      const pg = await get(`/${closed}`, who);
      assert.equal(pg.status, 403, `${who}: the page`); assert.ok(pg.body.includes('This store isn’t open yet'), `${who}: the plain page`);
      assert.doesNotMatch(pg.body, /Secret Launch Serum|\/b\/[a-z0-9-]+\/seed\.js|BREW_DEMO/, `${who}: no brand page, no demo`);
      for (const p of [`/b/${closed}/seed.js`, `/b/${closed}/facts.js`, `/b/${closed}/pdf/move-1.pdf`, `/api/brands/${closed}/status`, `/api/brands/${closed}/moves`, `/api/brands/${closed}/facts`, `/api/brands/${closed}/heard`]) {
        const r = await get(p, who); assert.equal(r.status, who === 'out' ? 401 : 403, `${who} ${p}`); assert.doesNotMatch(r.body, /Secret Launch Serum/, `${who} ${p}`); }
      const t = await req(`${base}/api/tenants`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-brand': closed, ...(as[who] ? { cookie: as[who] } : {}) }, body: JSON.stringify({ brand: closed }) });
      assert.equal(t.status, who === 'out' ? 401 : 403, `${who}: no workspace on a closed store`);
    }
    for (const who of ['member', 'staff']) {
      const pg = await get(`/${closed}`, who); assert.equal(pg.status, 200, `${who}: the brand page`); assert.match(pg.body, new RegExp(`/b/${closed}/seed\\.js`));
      const sd = await get(`/b/${closed}/seed.js`, who); assert.equal(sd.status, 200); assert.match(sd.body, /Secret Launch Serum/, `${who}: the team's seed has its cards`);
      assert.equal((await get(`/api/brands/${closed}/status`, who)).status, 200, `${who}: status`);
    }
    /* a workspace the team opened: someone outside it can't read it by its id (feed-service asks the gate) */
    const ws = JSON.parse((await req(`${base}/api/tenants`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-brand': closed, cookie: as.member }, body: JSON.stringify({ url: closed.replace(/-myshopify-com$/, '.myshopify.com'), brand: closed, snapshot: { onboarded: true } }) })).body);
    assert.ok(ws.id, `the team's workspace: ${JSON.stringify(ws).slice(0, 200)}\n${log.slice(-3000)}`);
    assert.equal((await get(`/api/tenants/${ws.id}/feed`, 'member')).status, 200);
    for (const who of ['out', 'stranger']) { const r = await get(`/api/tenants/${ws.id}/feed`, who); assert.equal(r.status, who === 'out' ? 401 : 403, `${who}: the team's workspace`); assert.equal(JSON.parse(r.body).closed, true); }

    /* the same store once open: public, as every brand is (the page loads; outside the team the seed has no cards) */
    const op = await get(`/${opened}`, 'out'); assert.equal(op.status, 200); assert.doesNotMatch(op.body, /isn’t open yet/);
    const os = await get(`/b/${opened}/seed.js`, 'stranger'); assert.equal(os.status, 200); assert.doesNotMatch(os.body, /Secret Launch Serum/, 'outside the team: name and look only, as before');
    assert.equal((await get(`/api/brands/${opened}/status`, 'out')).status, 200);
    assert.match(log, new RegExp(`\\[closed\\] ${closed}: x@gmail\\.com kept out`), 'the server says who it kept out');
    assert.ok(!fs.existsSync(path.join(REPO, '.brands', closed)), 'nothing written to the repo’s own packs');
  } finally { child.kill('SIGKILL'); fs.rmSync(root, { recursive: true, force: true }); }
});

test('inside the admin: renew asks App Bridge once (fresh=1 stops it), and the brand page’s seed and facts carry the token', async () => {
  const keep = { id: process.env.FEED_SHOPIFY_CLIENT_ID, secret: process.env.FEED_SHOPIFY_CLIENT_SECRET };
  process.env.FEED_SHOPIFY_CLIENT_ID = 'app-id'; process.env.FEED_SHOPIFY_CLIENT_SECRET = 'app-secret';
  try {
    const { createShopifyApp } = await import('../shopify-app.js');
    const A = createShopifyApp({ auth: { baseOf: () => 'https://brew.test' }, connectors: {}, builder: {}, packs: {}, log: quiet });
    const U = (q) => new URL(`http://x/devshop-myshopify-com?embedded=1&shop=devshop.myshopify.com&host=abc${q}`);
    const r1 = resOf(), page = A.renew({ headers: {} }, U(''), r1);
    assert.match(page, /id="brew-renew"/); assert.match(page, /app-bridge\.js/); assert.match(r1.head['content-security-policy'], /frame-ancestors https:\/\/devshop\.myshopify\.com https:\/\/admin\.shopify\.com/);
    assert.equal(A.renew({ headers: {} }, U('&fresh=1'), resOf()), null, 'asked once: then the closed page');
    assert.equal(A.renew({ headers: {}, brewUser: { email: 'a@b.c' } }, U(''), resOf()), null, 'someone on it: judged as they are');
    assert.equal(A.renew({ headers: {} }, new URL('http://x/devshop-myshopify-com'), resOf()), null, 'outside the admin: never');
    const html = '<html><head></head><script src="/b/devshop-myshopify-com/facts.js"></script>\n<script src="/b/devshop-myshopify-com/seed.js"></script><script src="/app.js?v=1"></script></html>';
    const out = A.embed({ headers: {}, shopify: { raw: 'tok.en.x' } }, U('&id_token=tok.en.x'), resOf(), html);
    assert.match(out, /facts\.js\?id_token=tok\.en\.x"/); assert.match(out, /seed\.js\?id_token=tok\.en\.x"/); assert.match(out, /src="\/app\.js\?v=1"/);
    assert.doesNotMatch(A.embed({ headers: {} }, U(''), resOf(), html), /id_token/, 'no token on the page: none on its scripts');
  } finally { for (const [k, v] of [['FEED_SHOPIFY_CLIENT_ID', keep.id], ['FEED_SHOPIFY_CLIENT_SECRET', keep.secret]]) if (v == null) delete process.env[k]; else process.env[k] = v; }
});
