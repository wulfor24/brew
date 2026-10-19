// QA 19 Oct (final-access audit): the landing at /index.html, capital addresses, a dead store's read, one card count, the write
// time said once, the check page as a setup step, the Shopify connector's name, demo sign-out, an unconfirmed market, the daily
// brand cap after a deploy and a dropped network on the landing. Every rule holds for every brand, live and demo. No paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.BUILD_RESUME_OFF = '1'; process.env.REFRESH_AUTO = '0';
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { createBuilder, confirmDueAt } = await import('../build.js');
const { createPacks } = await import('../brand-pack.js');
const { configFromProfile, marketConfig } = await import('../derive.js');
const { skeletonSeed } = await import('../seed-template.js');
const tmpPacks = () => createPacks({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'brew-final-')), PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
const builder = (P) => createBuilder({ ROOT: path.dirname(P.dirOf('x')), packs: P, ai: { onCharge() {}, call: async () => { throw new Error('AI is off'); } }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves: null, pdf: null } });
const app = () => src('public/app.js');

/* 1. /index.html */
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const get = (url) => new Promise((res, rej) => { http.get(url, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ status: r.statusCode, type: r.headers['content-type'] || '', body: b })); }).on('error', rej); });
test('1: /index.html opens the landing (not a plain-text "no"); other unknown files are still 404', { timeout: 60e3 }, async () => {
  const port = await freePort(), env = { ...process.env, PORT: String(port), AI_MOCK: '1', BUILD_RESUME_OFF: '1', ENV_FILE: '/nonexistent/.env', REFRESH_AUTO: '0', DEMO_MODE: '' };
  delete env.GOOGLE_CLOUD_PROJECT; delete env.RESEARCH_BUCKET;
  const child = spawn(process.execPath, ['server.js'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; child.stdout.on('data', (c) => (log += c)); child.stderr.on('data', (c) => (log += c));
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false; for (let i = 0; i < 100 && !up; i++) { await sleep(300); if (child.exitCode != null) break; up = await get(`${base}/api/config`).then((r) => r.status === 200).catch(() => false); }
    assert.ok(up, `the server did not come up:\n${log.slice(-2000)}`);
    const idx = await get(`${base}/index.html`), root = await get(`${base}/`);
    assert.equal(idx.status, 200); assert.match(idx.type, /text\/html/); assert.notEqual(idx.body.trim(), 'no');
    assert.equal(idx.body.length > 500, true); assert.equal(root.status, 200);
    assert.equal((await get(`${base}/no-such-file.png`)).status, 404);
  } finally { child.kill('SIGKILL'); }
});

/* 2. capital addresses */
test('2: an address in capitals is the same site, on the server as on the landing', async () => {
  const P = tmpPacks(), b = builder(P), user = { email: 'qa@joinsquareup.com' };
  for (const [u, slug] of [['ARATA.IN', 'arata-in'], ['WWW.Footshop.COM', 'footshop-com'], ['https://Arata.In/collections/hair', 'arata-in']]) {
    const r = await b.start(u, { user }); assert.ok(!r.error, `${u}: ${r.error}`); assert.equal(r.slug, slug); }
  assert.equal((await b.status('footshop-com')).host, 'footshop.com');
  assert.match((await b.start('not a site', { user })).error || '', /doesn’t look like a website/);
  const siteOf = (0, eval)(app().match(/const siteOf = (\(raw\)[\s\S]*?return \{ bad: true \}; \});/)[1]);
  for (const u of ['ARATA.IN', 'WWW.Footshop.COM', 'https://Arata.In/x']) assert.equal(siteOf(u).ok, true, u);
});

/* 3. a dead store */
test('3: a failed read drops Skip ahead and "Reading …", and the skip never runs after a failure', () => {
  const a = app(), err = a.slice(a.indexOf("if (ev.type === 'error') { failed = true;"), a.indexOf("if (ev.type === 'ready') { es.close(); finishRead(); }"));
  assert.match(err, /\$\('#skip'\)\?\.remove\(\)/); assert.match(err, /We couldn’t read \$\{B\.brand\.name\}/);
  assert.match(a, /\$\('#skip'\)\.onclick = \(\) => \{ if \(failed\) return;/);
  assert.match(src('public/onboard2.js'), /const skipAhead = \(\) => \{ if \(st\.error && mode !== 'q'\) return errorScreen\(\);/);
});

/* 4. one count */
test('4: the preview counts every card with the ready card’s words; 0 cards never says "Your feed is ready"', () => {
  const a = app(), pv = a.slice(a.indexOf('const obPreview = async'), a.indexOf('const LANE_IMG'));
  assert.doesNotMatch(pv, /new ideas/); assert.match(pv, /<b>\$\{all\.length\}<\/b>\$\{all\.length === 1 \? 'card' : 'cards'\}/);
  const fo = a.slice(a.indexOf('const finishOnboarding = async'), a.indexOf("$('#open-feed').onclick"));
  assert.match(fo, /\$\{n \? `<h3>Your feed is ready/); assert.match(fo, /Your cards are still being written/);
  assert.match(fo, /\$\{n \? `<div><b class="tnum">\$\{n\}<\/b>\$\{CARDS_WORD\(n\)\}<\/div>` : ''\}/, 'no 0 cards tile');
});

/* 5. the write time */
test('5: a write time once said is the time: the check page’s first open never moves it, the timer keeps it', async () => {
  const W = 15 * 60e3; assert.equal(confirmDueAt({ waitingSince: 1000, checkOpenAt: 5000, writeAt: 2000 }, W), 2000); assert.equal(confirmDueAt({ waitingSince: 1000, checkOpenAt: 5000 }, W), 5000 + W);
  const P = tmpPacks(), slug = 'said-example-com', since = Date.now() - 60e3, said = since + W;
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [] });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.in', slug, catalog: { products: [] } }); await P.put(slug, 'ledger.json', []);
  await P.put(slug, 'private/created.json', { by: 'ana@acme.in', at: 1 });
  await P.put(slug, 'status.json', { slug, name: 'Acme', host: 'acme.in', waitingSince: since, writeAt: said, stages: { read: { state: 'done' }, confirm: { state: 'waiting', at: since } } });
  const b = builder(P); const d = await b.checkData(slug, { heal: false, opened: true });
  const s = await b.status(slug); assert.ok(s.checkOpenAt >= since); assert.equal(s.writeAt, said, 'the banner’s time stands'); assert.equal(d.writeAt, said);
});

/* 6. the check page is a setup step */
test('6: "Is this right?" is saved as a step, a refresh reopens it, and it has the quiet skip', () => {
  const a = app();
  assert.match(a, /const OB_AT = \{ check: \(\) => checkRead\(\),/);
  const ck = a.slice(a.indexOf('const checkRead = async'), a.indexOf('const waitMoves = async'));
  assert.match(ck, /if \(!S\.onboarded\) obAt\('check'\)/); assert.match(ck, /id="ck-skip">\$\{S\.onboarded \? 'Skip to my feed' : 'Skip for now'\}/); assert.match(ck, /\$\('#ck-skip'\)\.onclick/);
  assert.match(a, /const continueToFeed = \(\) => \{ clearTimeout\(waitMoves\.t\); if \(S\.obStep === 'check'\) \{ delete S\.obStep; save\(\); \}/, 'past the check, a reload never reopens it');
});

/* 7. the Shopify connector */
test('7: the store connector is always Shopify (never "Custom"), and a saved seed heals on load', async () => {
  assert.equal(skeletonSeed({ slug: 'acme-com', host: 'acme.com' }).connectors.shopify.name, 'Shopify');
  assert.doesNotMatch(src('seed-template.js'), /titleCase\(stack\.platform\)/);
  const P = tmpPacks(), slug = 'custom-example-com';
  await P.put(slug, 'status.json', { name: 'Acme', host: 'custom.example.com', done: true, stages: { read: { state: 'done' } } });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'custom.example.com', slug, country: 'IN', platform: 'custom', catalog: { products: [] } });
  await P.put(slug, 'config.json', { country: 'IN', countryName: 'India' });
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'custom.example.com' }, lanes: { core: { name: 'Core', line: 'x' } }, connectors: { shopify: { name: 'Custom' } }, posts: [] });
  const pk = await P.load(slug, { fresh: true });
  assert.equal(pk.seed.connectors.shopify.name, 'Shopify'); assert.equal((await P.getJSON(slug, 'seed.json')).connectors.shopify.name, 'Shopify');
});

/* 8. demo sign-out */
test('8: a demo visitor gets no Sign out (Start again covers it)', () => {
  assert.match(src('public/live.js'), /\$\{L\.me\.demo \|\| \/@demo\\\.brew\$\/i\.test\(L\.me\.email \|\| ''\) \? '' : `<a class="lc-out"/);
});

/* 9. a market to confirm */
test('9: a market "to confirm" saves no US, USD or Black Friday; saved configs heal; readers say "your market"', async () => {
  const c = configFromProfile({ host: 'footshop.com', name: 'Footshop' });
  assert.equal(c.country, ''); assert.equal(c.countryName, ''); assert.deepEqual(c.markets, []); assert.equal(c.festival, null); assert.equal(c.currency, '');
  assert.equal(configFromProfile({ host: 'f.com', currency: 'EUR' }).currency, 'EUR', 'the store’s own currency stays');
  const us = configFromProfile({ host: 'a.com', country: 'US' }); assert.equal(us.country, 'US'); assert.equal(us.currency, 'USD'); assert.ok(us.festival?.name);
  assert.equal(marketConfig({}).festival, null);
  const P = tmpPacks(), slug = 'footshop-example-com';
  await P.put(slug, 'status.json', { name: 'Footshop', host: 'footshop.example.com', done: true, stages: { read: { state: 'done' } } });
  await P.put(slug, 'profile.json', { name: 'Footshop', host: 'footshop.example.com', slug, country: null, market: { toConfirm: true, by: 'site' }, catalog: { products: [] } });
  await P.put(slug, 'config.json', { country: 'US', countryName: 'the US', markets: ['US'], currency: 'USD', symbol: '$', festival: { name: 'Black Friday', date: '2026-11-27T00:00:00-05:00' } });
  await P.put(slug, 'seed.json', { brand: { name: 'Footshop', host: 'footshop.example.com' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [] });
  const pk = await P.load(slug, { fresh: true }), saved = await P.getJSON(slug, 'config.json');
  for (const cfg of [pk.config, saved]) { assert.equal(cfg.country, ''); assert.equal(cfg.countryName, ''); assert.deepEqual(cfg.markets, []); assert.equal(cfg.festival, null); assert.equal(cfg.currency, ''); }
  assert.match(src('build.js'), /if \(cfg0\) await packs\.put\(slug, 'config\.json', \{ \.\.\.cfg0, \.\.\.marketConfig\(p\) \}\)/, 'the to-confirm self-heal clears the settings too');
  const mp = src('market-pulse.js'); assert.match(mp, /a shopper\$\{b\.market \? ` in \$\{b\.market\}` : ''\}/); assert.match(mp, /cities: market \?/);
  assert.match(src('ideas.js'), /c\.countryName \|\| 'selling market not confirmed'/);
});

/* 10. the daily cap and a dropped network */
test('10a: the 3-new-brands-a-day cap counts saved created stamps, so a deploy does not reset it', async () => {
  const P = tmpPacks(), email = 'cap@example.org';
  for (const h of ['one', 'two', 'three']) { const slug = `${h}-example-com`; await P.put(slug, 'status.json', { slug, host: `${h}.example.com`, name: `${h}.example.com`, createdAt: Date.now() - 3600e3, stages: {} }); await P.put(slug, 'private/created.json', { by: email, at: Date.now() - 3600e3 }); }
  const fresh = builder(P); /* a new instance: nothing in memory */
  assert.match((await fresh.start('four.example.com', { user: { email } })).error || '', /3 new brands a day per person/);
  const other = await fresh.start('four.example.com', { user: { email: 'someone@example.org' } }); assert.ok(!other.error, other.error);
});
test('10b: a dropped network on the landing shows the plain line, never "TypeError: Failed to fetch"', () => {
  const a = app(), go = a.slice(a.indexOf('const go = async (e)'), a.indexOf("$('#url-form').onsubmit"));
  assert.match(go, /api\('\/api\/brands', \{ url \}\)\.then\(\(j\) => \(j\?\.fallback \? null : j\)\)/);
  assert.match(go, /urlErr\(r\?\.error \|\| 'That address did not open\. Check it and try again\.'\)/);
});
