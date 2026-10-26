// The production clean gate (Param, 25 Oct: nothing dummy or from our testing ever goes live). Read-only: it prints every
// finding as [clean] and exits 1 if there is any, so tools/promote.sh never moves traffic onto an unclean production.
// Checks the services' own settings (no demo, mock, open-site or dev sign-in; production bucket and URL) and the production
// database (no test brands, test keys, archives, demo sandboxes or workspaces of test brands).
// Param's kept exceptions (25 Oct): the Pro plan sheet, Marketplaces "Coming soon", the catalog-photo fallback, and Delete my
// data as an honest email request — they are code, not data, and need no exception here.
import { q, close } from './index.js';
import { isClosedRead } from '../closed-gate.js';

const P = process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617', R = process.env.REGION || 'asia-south1';
const SERVICES = String(process.env.PROD_SERVICES || '').split(',').filter(Boolean);
const TEST_BRANDS = new Set(String(process.env.TEST_BRANDS || 'cozysnugglet-shop,zenant-club,zenant-club-yt,adpage,adpage-ads,questions').split(','));
/* production's own address, and staging's (a partner whose home is staging is sent there): tools/promote.sh passes both from
   tools/prod-env.sh, so the go-live swap changes them in one place; the defaults are the addresses before the swap */
const EXPECT_PUBLIC_URL = String(process.env.EXPECT_PUBLIC_URL || 'https://feed.joinsquareup.com').replace(/\/+$/, '');
const EXPECT_STAGING_URL = String(process.env.EXPECT_STAGING_URL || 'https://brew.joinsquareup.com').replace(/\/+$/, '');
const found = []; const bad = (why) => { found.push(why); console.log(`[clean] ${why}`); };

if (!SERVICES.length) bad('no production services named (PROD_SERVICES): nothing about them was checked'); /* a gate with nothing to check never passes */
/* 1. the services as Cloud Run runs them (the newest revision, which is the one about to get traffic) */
const token = async () => (await (await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })).json()).access_token;
for (const s of SERVICES) {
  try {
    const r = await fetch(`https://run.googleapis.com/v2/projects/${P}/locations/${R}/services/${s}`, { headers: { authorization: `Bearer ${await token()}` } });
    if (!r.ok) { bad(`${s}: its settings could not be read (${r.status}), so it was not checked`); continue; }
    const svc = await r.json(), c0 = (svc.template?.containers || [])[0] || {};
    const env = Object.fromEntries((c0.env || []).map((e) => [e.name, e.value ?? `(secret ${e.valueSource?.secretKeyRef?.secret || ''})`]));
    const role = s === 'brew-worker' ? 'worker' : 'web';
    if (env.ROLE !== role) bad(`${s}: ROLE is ${env.ROLE || 'unset'}, not ${role}`);
    if (s === 'brew-web' && svc.ingress !== 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER') bad(`${s}: takes traffic that skips the load balancer (ingress ${svc.ingress})`);
    if (s === 'brew-worker' && svc.ingress !== 'INGRESS_TRAFFIC_INTERNAL_ONLY') bad(`${s}: is reachable from outside (ingress ${svc.ingress})`);
    if (process.env.EXPECT_IMAGE && c0.image !== process.env.EXPECT_IMAGE) bad(`${s}: the candidate runs ${c0.image}, not the image being promoted`);
    if (!/brew-prod-runtime@/.test(svc.template?.serviceAccount || '')) bad(`${s}: runs as ${svc.template?.serviceAccount || 'the default account'}, not brew-prod-runtime`);
    if (env.MIGRATE_ON_BOOT !== '0') bad(`${s}: runs migrations on boot (only the migrate job does on production)`);
    for (const k of ['DEMO_MODE', 'AI_MOCK', 'OPEN_SITE', 'DEV_LOGIN', 'DEV_MEMBER', 'SLOOSH_DUMMY']) if (env[k] && env[k] !== '0') bad(`${s}: ${k}=${env[k]} (never on production)`);
    if (env.ENV !== 'production') bad(`${s}: ENV is ${env.ENV || 'unset'}, not production`);
    if (env.RESEARCH_BUCKET !== 'brew-prod') bad(`${s}: RESEARCH_BUCKET is ${env.RESEARCH_BUCKET || 'unset'}, not brew-prod`);
    if (env.STORAGE !== 'pg') bad(`${s}: STORAGE is ${env.STORAGE || 'unset'}, not pg`);
    if ((env.PUBLIC_URL || '') !== EXPECT_PUBLIC_URL) bad(`${s}: PUBLIC_URL is ${env.PUBLIC_URL || 'unset'}`);
    if (env.OBJECTS_READTHROUGH === '1' || env.OBJECTS_MIRROR === '1') bad(`${s}: reads or writes the staging bucket path (OBJECTS_READTHROUGH/MIRROR)`);
    if (!/(secret BREW_PROD_DATABASE_URL)/.test(env.DATABASE_URL || '')) bad(`${s}: DATABASE_URL is not the production database`);
    /* production's own secrets (a staging key here would open staging's vault and sessions), sign-in on, the access policy set */
    for (const [k, sec] of [['FEED_VAULT_KEY', 'FEED_VAULT_KEY_PROD'], ['FEED_SESSION_SECRET', 'FEED_SESSION_SECRET_PROD'], ['HANDOFF_SECRET', 'HANDOFF_SECRET_PROD']]) if (!new RegExp(`\\(secret ${sec}\\)`).test(env[k] || '')) bad(`${s}: ${k} is not ${sec}`);
    if (env.FEED_SIGNIN === '0' || env.BUILD_SIGNIN === '0') bad(`${s}: sign-in is switched off (FEED_SIGNIN/BUILD_SIGNIN=0)`);
    if (!env.ADMIN_EMAILS) bad(`${s}: ADMIN_EMAILS is not set`);
    if (!env.FULL_ACCESS_DOMAINS) bad(`${s}: FULL_ACCESS_DOMAINS is not set`);
    if (!/brew-prod-runtime@/.test(env.GA4_SA_EMAIL || '')) bad(`${s}: GA4_SA_EMAIL is ${env.GA4_SA_EMAIL || 'unset'}, not production's runtime account`);
    if (!env.RESEND_API_KEY) bad(`${s}: no RESEND_API_KEY (no email, no alerts)`);
    if (s === 'brew-web' && process.env.EXPECT_WEB_REV && svc.latestCreatedRevision && !svc.latestCreatedRevision.endsWith(`/${process.env.EXPECT_WEB_REV}`)) bad(`${s}: the newest revision is ${svc.latestCreatedRevision.split('/').pop()}, not the candidate ${process.env.EXPECT_WEB_REV}`);
    console.log(`[clean] ${s}: settings checked`);
  } catch (e) { bad(`${s}: settings check failed (${e.message})`); }
}

/* 2. the candidate answers (from inside the VPC: the service takes no other outside traffic) */
if (process.env.SMOKE_URL) {
  /* every built brand (a brand still being read has no pack yet); a store behind Shopify's password page answers its team only (401/403) */
  const st = (await q(`SELECT split_part(key, '/', 2) AS s, body FROM objects WHERE key ~ '^brands/[^/]+/status\\.json$' AND content_type <> 'application/x-parted' ORDER BY key`)).rows.filter((r) => r.s !== '_brew');
  const closed = new Set(), brandsNow = [];
  for (const r of st) { let s0 = null; try { s0 = JSON.parse(r.body.toString('utf8')); } catch {} if (!s0?.done) continue; brandsNow.push(r.s);
    if (s0.source?.kind === 'shopify-admin') { const pr = (await q('SELECT body FROM objects WHERE key = $1', [`brands/${r.s}/profile.json`])).rows[0]; let p0 = null; try { p0 = JSON.parse(pr?.body?.toString('utf8') || 'null'); } catch {} if (isClosedRead(s0, p0)) closed.add(r.s); } }
  for (const p of ['/', '/healthz/ready', '/api/config', '/privacy', ...brandsNow.slice(0, 12).flatMap((b) => [`/${b}`, `/b/${b}/seed.js`])]) {
    const b = (/^\/(?:b\/)?([a-z0-9-]+)/.exec(p) || [])[1], ok = (c, r) => c === 200 || (closed.has(b) && (c === 401 || c === 403)) || (c === 302 && (r?.headers?.get?.('location') || '').startsWith(`${EXPECT_STAGING_URL}/`)); /* a partner whose home is staging (STAGING_HOME) is sent there */
    try { const r = await fetch(process.env.SMOKE_URL + p, { signal: AbortSignal.timeout(30e3), redirect: 'manual' }); if (!ok(r.status, r)) bad(`smoke: ${p} answered ${r.status}`); else console.log(`[clean] smoke ${p} ${r.status}`); }
    catch (e) { bad(`smoke: ${p} did not answer (${e.message})`); } } }

/* the new worker took the background lease (its connection is named after its revision, roles.js): an old revision still holding it
   would keep running the previous release's background work */
if (process.env.EXPECT_WORKER_REV) { let holder = null;
  for (let i = 0; i < 24; i++) { holder = (await q(`SELECT a.application_name AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.objid = 727275 AND l.objsubid = 1 AND l.granted`)).rows[0]?.n || null;
    if (holder === `brew-lease:${process.env.EXPECT_WORKER_REV}`) break; await new Promise((r) => setTimeout(r, 5000)); }
  if (holder !== `brew-lease:${process.env.EXPECT_WORKER_REV}`) bad(`the background lease is held by ${holder || 'nobody'}, not the new worker ${process.env.EXPECT_WORKER_REV}`); else console.log(`[clean] the new worker ${process.env.EXPECT_WORKER_REV} holds the background lease`); }

/* 3. the production database */
const brands = (await q(`SELECT DISTINCT split_part(key, '/', 2) AS s FROM objects WHERE key LIKE 'brands/%'`)).rows.map((r) => r.s).filter((x) => x && x !== '_brew');
for (const s of brands) { if (TEST_BRANDS.has(s)) bad(`a test brand is on production: ${s}`); if (/^zz-/.test(s)) bad(`a test key is on production: brands/${s}/`); }
const n = async (sql, args = []) => +(await q(sql, args)).rows[0].n;
const del = await n(`SELECT count(*) AS n FROM objects WHERE key LIKE '\\_deleted/%' ESCAPE '\\'`); if (del) bad(`${del} archived object(s) (_deleted/) on production`);
const demo = await n(`SELECT count(*) AS n FROM objects WHERE key ~ '^brands/[^/]+/(demo/|demo\\.json$)'`); if (demo) bad(`${demo} demo sandbox object(s) on production`);
const zz = await n(`SELECT count(*) AS n FROM objects WHERE key LIKE '%zz-%'`); if (zz) bad(`${zz} object(s) with test keys (zz-) on production`);
let tws = 0; for (const r of (await q(`SELECT key, body, content_type FROM objects WHERE key LIKE 'tenants/%' AND content_type <> 'application/x-parted'`)).rows) { try { if (TEST_BRANDS.has(JSON.parse(r.body.toString('utf8')).brandId)) tws++; } catch {} }
const tp = (await q(`SELECT o.key, p.body FROM objects o JOIN doc_parts p ON p.key = o.key AND p.part = 'brandId' WHERE o.key LIKE 'tenants/%'`)).rows; for (const r of tp) { try { if (TEST_BRANDS.has(JSON.parse(r.body.toString('utf8')))) tws++; } catch {} }
if (tws) bad(`${tws} workspace(s) of test brands on production`);
/* simulated connector accounts (staff testing on staging) and the demo rows they wrote */
const simRows = (await q(`SELECT key FROM objects WHERE key ~ '^brands/[^/]+/private/(connections|connected-ledger)\\.json$' AND content_type <> 'application/x-parted' AND (convert_from(body, 'UTF8') ~ '"sim"\\s*:\\s*true' OR convert_from(body, 'UTF8') ~ '"demo"\\s*:\\s*true')`)).rows.map((r) => r.key);
for (const k of simRows) bad(`simulated connector data on production: ${k}`);
console.log(`[clean] database checked: ${brands.length} brand(s): ${brands.join(', ') || 'none yet'}`);

await close();
if (found.length) { console.log(`[clean] REFUSED: ${found.length} finding(s)`); process.exit(1); }
console.log('[clean] production is clean');
