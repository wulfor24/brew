// Onboarding v2's server side (2026-10-18): GET /api/peek (a glance at the store's home page that writes nothing and starts no read),
// the reader's "picks" (the taps: products, rivals, who you are) saved with the findings and streamed to the setup screen, their
// replay for a brand read earlier, and the BREW_V / BREW_GATE switch on every page. No paid calls, no public network.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
process.env.REFRESH_AUTO = '0'; process.env.DEMO_MODE = '';
const { followRead } = await import('../feed-service.js');
const { createBuilder } = await import('../build.js');
const { createPacks } = await import('../brand-pack.js');
const { catalog } = await import('../reader/stages/catalog.js');
const { brand, whoOf } = await import('../reader/stages/brand.js');
const { findRivals } = await import('../reader/stages/ads.js');
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const getJSON = (url) => new Promise((res, rej) => { http.get(url, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res({ status: r.statusCode, body: JSON.parse(b) }); } catch (e) { rej(e); } }); }).on('error', rej); });

/* ---------- 1. GET /api/peek against a local fixture ----------
   server.js only listens (no exports), so it is booted as a child. Peeks go through safeFetch, which refuses private addresses,
   so the child gets a preload that resolves *.fixture.example to a public address and routes that host to the fixture here:
   the route runs exactly as on the live site, including its own host checks. */
const FIX_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Acme · Clean skincare</title><meta property="og:title" content="Acme Skincare"><meta name="description" content="Clean skincare for Indian skin."><meta property="og:image" content="/share.jpg"><meta name="theme-color" content="#1b4332"><link rel="icon" href="/favicon.png" sizes="32x32"><link rel="apple-touch-icon" href="//cdn.example/touch.png"></head><body>hi</body></html>';
const fixture = () => http.createServer((rq, rs) => {
  if (rq.url.startsWith('/slow')) return setTimeout(() => { try { rs.writeHead(200, { 'content-type': 'text/html' }); rs.end(FIX_HTML); } catch {} }, 4000);
  if (rq.url.startsWith('/plain')) { rs.writeHead(200, { 'content-type': 'text/plain' }); return rs.end('just text'); }
  rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); rs.end(FIX_HTML);
});
const snapshot = (dir) => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { try { const s = fs.statSync(p); out.push(`${path.relative(dir, p)}:${s.size}:${Math.round(s.mtimeMs)}`); } catch {} } } }; if (fs.existsSync(dir)) walk(dir); return out.sort().join('\n'); };

test('GET /api/peek: a home page → {host,title,description,ogImage,favicon,themeColor,ms}; a slow, non-HTML, private or blocked address → {host,error}; nothing written', { timeout: 90e3 }, async () => {
  const fx = fixture(); await new Promise((r) => fx.listen(0, '127.0.0.1', r)); const fxPort = fx.address().port;
  const port = await freePort();
  const preload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brew-v2-')), 'preload.mjs');
  fs.writeFileSync(preload, `import dns from 'node:dns/promises';
const isFix = (h) => /(^|\\.)fixture\\.example$/i.test(String(h));
const lookup0 = dns.lookup.bind(dns);
dns.lookup = (h, o) => isFix(h) ? Promise.resolve(o && o.all ? [{ address: '93.184.216.34', family: 4 }] : { address: '93.184.216.34', family: 4 }) : lookup0(h, o);
const fetch0 = globalThis.fetch;
globalThis.fetch = async (u, o) => { const s = u instanceof URL ? u.href : String(u); const t = s.replace(/^https?:\\/\\/[a-z0-9.-]*fixture\\.example(?::\\d+)?/i, 'http://127.0.0.1:${fxPort}'); const r = await fetch0(t, o); if (t !== s) Object.defineProperty(r, 'url', { value: s }); return r; };
`);
  const env = { ...process.env, PORT: String(port), AI_MOCK: '1', BUILD_RESUME_OFF: '1', ENV_FILE: '/nonexistent/.env', REFRESH_AUTO: '0', DEMO_MODE: '', BUILD_BLOCK: 'blocked-brand-com', BREW_V: '2', BREW_GATE: 'open' };
  delete env.GOOGLE_CLOUD_PROJECT; delete env.RESEARCH_BUCKET;
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'server.js'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (c) => (log += c)); child.stderr.on('data', (c) => (log += c));
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false; for (let i = 0; i < 100 && !up; i++) { await sleep(300); if (child.exitCode != null) break; up = await getJSON(`${base}/api/config`).then((r) => r.status === 200).catch(() => false); }
    assert.ok(up, `the server did not come up:\n${log.slice(-2000)}`);
    const brands = path.join(REPO, '.brands'); const before = snapshot(brands);
    const ok = await getJSON(`${base}/api/peek?url=${encodeURIComponent('ok.fixture.example:' + fxPort)}`);
    assert.equal(ok.status, 200);
    assert.deepEqual({ ...ok.body, ms: typeof ok.body.ms }, { host: `ok.fixture.example:${fxPort}`.replace(/:\d+$/, ''), title: 'Acme Skincare', description: 'Clean skincare for Indian skin.', ogImage: `https://ok.fixture.example:${fxPort}/share.jpg`, favicon: 'https://cdn.example/touch.png', themeColor: '#1b4332', ms: 'number' });
    const again = await getJSON(`${base}/api/peek?url=${encodeURIComponent('https://www.ok.fixture.example:' + fxPort + '/')}`); /* the same host within 10 minutes: the kept answer */
    assert.deepEqual(again.body, ok.body);
    const t0 = Date.now(); const slow = await getJSON(`${base}/api/peek?url=${encodeURIComponent('http://slow.fixture.example:' + fxPort + '/slow')}`);
    assert.deepEqual(slow.body, { host: 'slow.fixture.example', error: 'did not open' }); assert.ok(Date.now() - t0 < 3800, 'a slow page is given up at 2.5 s');
    const plain = await getJSON(`${base}/api/peek?url=${encodeURIComponent('http://plain.fixture.example:' + fxPort + '/plain')}`);
    assert.deepEqual(plain.body, { host: 'plain.fixture.example', error: 'did not open' });
    for (const [u, host] of [['127.0.0.1', '127.0.0.1'], ['http://localhost:3000', 'localhost'], ['ftp://acme.in/x', 'acme.in'], ['https://blocked-brand.com', 'blocked-brand.com'], ['http://[::1]/', '[']]) {
      const r = await getJSON(`${base}/api/peek?url=${encodeURIComponent(u)}`); assert.equal(r.status, 200, u); assert.equal(r.body.error, 'did not open', u); assert.ok('host' in r.body, u); if (host !== '[') assert.equal(r.body.host, host, u); }
    const empty = await getJSON(`${base}/api/peek`); assert.deepEqual(empty.body, { host: null, error: 'did not open' });
    assert.equal(snapshot(brands), before, 'a peek writes nothing under .brands');
    assert.doesNotMatch(log, /\[build\].*(start|Reading)/, 'a peek never starts a read');
    /* the switch on every page */
    const page = await new Promise((res, rej) => http.get(`${base}/`, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b)); }).on('error', rej));
    assert.match(page, /<script>window\.BREW_V="2";window\.BREW_GATE="open";<\/script>/);
  } finally { child.kill('SIGKILL'); fx.closeAllConnections?.(); fx.close(); }
});

/* ---------- 2. the setup stream forwards the reader's picks ---------- */
const fakeBuilder = (events, status) => { const ls = new Set();
  return { events: () => events, status: async () => status, subscribe: (_s, f) => { events.forEach(f); ls.add(f); return () => ls.delete(f); }, emit: (e) => { events.push(e); ls.forEach((f) => f(e)); } }; };
test('followRead forwards a picks event as {type:"picks", k, items}', async () => {
  const items = [{ handle: 'serum', title: 'Serum', price: '₹499', img: null }];
  const ev = [{ type: 'reader', ev: { type: 'step', k: 'catalog', state: 'reading' } }, { type: 'reader', ev: { type: 'picks', k: 'catalog', items } }, { type: 'reader', ev: { type: 'picks', k: 'rivals', items: { error: 'paid sources off' } } }, { type: 'reader', ev: { type: 'step', k: 'catalog', state: 'done', done: '3 products' } }, { type: 'read-done' }];
  const out = await new Promise((res) => { const o = []; followRead({ builder: fakeBuilder(ev, { stages: { read: { state: 'done' } } }), slug: 'x', loadSeed: async () => ({}), replayMs: 0, send: (e) => { o.push(e); if (e.type === 'ready') res(o); } }); });
  assert.deepEqual(out.filter((e) => e.type === 'picks'), [{ type: 'picks', k: 'catalog', items }, { type: 'picks', k: 'rivals', items: { error: 'paid sources off' } }]);
  assert.ok(out.findIndex((e) => e.type === 'picks') < out.findIndex((e) => e.type === 'step' && e.state === 'done'), 'picks arrive as they are found, before the step closes');
});

/* ---------- 3. a brand read earlier replays its saved picks after the step that found them ---------- */
test('replayRead emits findings.picks: who after brand, catalog after catalog, the rest after the last step', { timeout: 20e3 }, async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-v2-replay-'));
  const P = createPacks({ ROOT, PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
  const modules = { reader: { createReader: () => ({ read: async () => { throw new Error('not called'); } }) }, brief: { createBrief: () => ({ write: async () => ({}) }) }, moves: { SPECS: [], createMovesEngine: () => ({ runAll: async () => ({}) }) }, pdf: null };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {}, call: async () => { throw Object.assign(new Error('mock'), { mock: true }); } }, treg: { onCharge() {} }, log: quiet, modules });
  assert.equal(typeof b.replayRead, 'function');
  const seen = []; b.subscribe('acme-in', (e) => { if (e.type === 'reader') seen.push(e.ev); });
  const who = { name: 'Acme', descriptor: 'Clean skincare', category: 'Skin care', country: 'IN', currency: 'INR' }, cat = [{ handle: 'serum', title: 'Serum', price: '₹499', img: null }];
  await b.replayRead('acme-in', { steps: [{ k: 'open', done: 'Opened', state: 'done' }, { k: 'brand', done: '1 logo', state: 'done' }, { k: 'catalog', done: '3 products', state: 'done' }], cards: [], picks: { who, catalog: cat, rivals: { error: 'rival search failed' } } });
  const at = (f) => seen.findIndex(f), stepDone = (k) => at((e) => e.type === 'step' && e.k === k && e.state === 'done');
  assert.equal(seen.filter((e) => e.type === 'picks').length, 3, 'each key once');
  assert.ok(at((e) => e.type === 'picks' && e.k === 'who') > stepDone('brand') && at((e) => e.type === 'picks' && e.k === 'who') < stepDone('catalog'), 'who follows the brand step');
  assert.ok(at((e) => e.type === 'picks' && e.k === 'catalog') > stepDone('catalog'), 'catalog follows the catalog step');
  assert.deepEqual(seen.at(-1), { type: 'picks', k: 'rivals', items: { error: 'rival search failed' } }, 'a key whose step was not replayed comes last, error kept');
  assert.deepEqual(seen.find((e) => e.type === 'picks' && e.k === 'catalog').items, cat);
  await b.replayRead('acme-in', { steps: [{ k: 'open', done: 'Opened', state: 'done' }], cards: [] }); /* a read saved before picks existed replays as before */
});

/* ---------- 4. the stages send the taps the check page would show, from the same fields ---------- */
const stageCtx = (profile, state, http) => { const picks = {}; return { picks, ctx: { http, ledger: { add() {} }, profile, state, log: quiet, tick() {}, finding() {}, done() {}, asset: async () => null, saveAsset: async () => null, slug: 'acme-in', picks: (k, items) => { picks[k] = items; } } }; };
test('catalog picks: the first 12 products, hero first, the check page price label, no gift cards; never sent without products', async () => {
  const sp = (handle, price, extra = {}) => ({ id: handle, handle, title: handle[0].toUpperCase() + handle.slice(1), product_type: 'Serum', vendor: 'Acme', variants: [{ price, available: true, compare_at_price: null }], images: [{ src: `https://cdn.acme.in/${handle}.jpg` }], published_at: '2026-01-01', tags: [], body_html: '', ...extra });
  const products = [sp('gift-card', '500.00', { title: 'Gift Card' }), sp('serum', '499.00'), sp('cleanser', '299.00'), sp('kit', '899.00', { title: 'Starter Kit' })];
  const http = { get: async (u) => (/products\.json/.test(u) ? { ok: true, json: { products } } : /collections\.json/.test(u) ? { ok: true, json: { collections: [] } } : { ok: false }) };
  const { picks, ctx } = stageCtx({ platform: 'shopify', currency: 'INR', locale: 'en-IN', host: 'acme.in', name: 'Acme' }, { origin: 'https://acme.in', home: '', homeUrl: 'https://acme.in/' }, http);
  await catalog(ctx);
  assert.ok(Array.isArray(picks.catalog)); assert.ok(picks.catalog.length >= 2 && picks.catalog.length <= 12);
  assert.ok(!picks.catalog.some((p) => /gift card/i.test(p.title)), 'the check page leaves gift cards out');
  assert.deepEqual(Object.keys(picks.catalog[0]).sort(), ['handle', 'img', 'price', 'title']);
  assert.deepEqual(picks.catalog.map((p) => p.handle).slice(0, 2), ['serum', 'cleanser'], 'singles before the kit, as the check page ranks hero products');
  assert.equal(picks.catalog[0].price, '₹499'); assert.equal(picks.catalog[0].img, 'https://cdn.acme.in/serum.jpg');
  const none = stageCtx({ platform: 'shopify', currency: 'INR', host: 'acme.in', name: 'Acme' }, { origin: 'https://acme.in', home: '', homeUrl: 'https://acme.in/', pageUrls: [], homeLinks: [] }, { get: async () => ({ ok: false }) });
  await catalog(none.ctx); assert.equal(none.picks.catalog, undefined, 'no products: no catalog picks (the step says so)');
});
test('who picks: name, line, category, market and currency as the check page reads them', async () => {
  const home = '<html><head><title>Acme</title><meta name="description" content="Clean skincare for Indian skin."></head><body><header><a href="/">Acme</a></header><h1>Skin that breathes</h1></body></html>';
  const { picks, ctx } = stageCtx({ name: 'Acme', host: 'acme.in', country: 'IN', currency: 'INR', descriptor: null, identity: {} }, { home, homeUrl: 'https://acme.in/', origin: 'https://acme.in' }, { get: async () => ({ ok: false }) });
  await brand(ctx);
  assert.deepEqual(picks.who, { name: 'Acme', descriptor: 'Clean skincare for Indian skin.', category: null, country: 'IN', currency: 'INR' });
  assert.deepEqual(whoOf({ name: 'Acme', tagline: 'Skin that breathes', category: 'Skin care' }), { name: 'Acme', descriptor: 'Skin that breathes', category: 'Skin care', country: null, currency: null }, 'the tagline stands in for the line, as on the check page');
});
test('rivals picks: a search that did not go through is {error}, never []', async () => {
  const { picks, ctx } = stageCtx({ name: 'Acme', host: 'acme.in', country: 'IN', rivals: [] }, { origin: 'https://acme.in' }, { get: async () => ({ ok: false }) });
  ctx.tregOn = false; ctx.aiOn = false; await findRivals(ctx);
  assert.deepEqual(picks.rivals, { error: 'paid sources off' });
  const kept = stageCtx({ name: 'Acme', host: 'acme.in', country: 'IN', rivals: [] }, { origin: 'https://acme.in' }, { get: async () => ({ ok: false }) });
  kept.ctx.tregOn = false; kept.ctx.aiOn = true; kept.ctx.prev = { rivals: [{ name: 'Rival Co', host: 'rival.co', why: 'same shelf', how: 'web search (cited)' }] };
  await findRivals(kept.ctx);
  assert.deepEqual(kept.picks.rivals, [{ host: 'rival.co', name: 'Rival Co', logo: 'https://www.google.com/s2/favicons?domain=rival.co&sz=64', how: 'web search (cited)' }], 'a rival kept from the first read keeps how it was found');
});

/* ---------- 5. the switch is wired everywhere the plan names ---------- */
test('server.js injects BREW_V and BREW_GATE on every page; deploy scripts pass them; the demo /tour keeps v=', () => {
  const s = src('server.js');
  assert.match(s, /window\.BREW_V=\$\{flagJson\(process\.env\.BREW_V \|\| '1'\)\};window\.BREW_GATE=\$\{flagJson\(process\.env\.BREW_GATE \|\| 'trial'\)\}/);
  assert.ok(s.indexOf('window.BREW_V=') > s.indexOf('window.BREW_DEMO = 1') && s.indexOf('window.BREW_V=') < s.indexOf('const p = slug && await loadBrand(slug);'), 'injected in pageFor, for the landing and brand pages alike');
  assert.match(s, /u\.pathname === '\/api\/peek'/); assert.ok(s.indexOf("u.pathname === '/api/peek'") < s.indexOf("req.method === 'POST' && u.pathname === '/api/brands'"), 'peek sits before the brands POST');
  assert.match(src('deploy.sh'), /\|BREW_V=\$\{BREW_V:-1\}\|BREW_GATE=\$\{BREW_GATE:-trial\}/);
  assert.match(src('tools/deploy-demo.sh'), /,BREW_V=\$\{BREW_V:-1\},BREW_GATE=\$\{BREW_GATE:-trial\}/);
  const d = src('demo-routes.js'); assert.match(d, /\/\[\?&\]\(ui=\\\\d\)\//); assert.match(d, /\/\[\?&\]\(v=\\\\d\)\//);
  assert.match(src('feed-service.js'), /ev\.type === 'picks'/);
  assert.match(src('reader/index.js'), /picks\(k, items\) \{ picks\[k\] = items; emit\(\{ type: 'picks', k, items \}\); \}/);
});
