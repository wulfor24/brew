// The production clean gate (Param, 25 Oct: nothing dummy or from our testing ever goes live). Read-only: it prints every
// finding as [clean] and exits 1 if there is any, so tools/promote.sh never moves traffic onto an unclean production.
// Checks the services' own settings (no demo, mock, open-site or dev sign-in; production bucket and URL) and the production
// database (no test brands, test keys, archives, demo sandboxes or workspaces of test brands).
// Param's kept exceptions (25 Oct): the Pro plan sheet, Marketplaces "Coming soon", the catalog-photo fallback, and Delete my
// data as an honest email request — they are code, not data, and need no exception here.
import { q, close } from './index.js';

const P = process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617', R = process.env.REGION || 'asia-south1';
const SERVICES = String(process.env.PROD_SERVICES || '').split(',').filter(Boolean);
const TEST_BRANDS = new Set(String(process.env.TEST_BRANDS || 'cozysnugglet-shop,zenant-club,zenant-club-yt,adpage,adpage-ads,questions').split(','));
const found = []; const bad = (why) => { found.push(why); console.log(`[clean] ${why}`); };

if (!SERVICES.length) bad('no production services named (PROD_SERVICES): nothing about them was checked'); /* a gate with nothing to check never passes */
/* 1. the services as Cloud Run runs them (the newest revision, which is the one about to get traffic) */
const token = async () => (await (await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })).json()).access_token;
for (const s of SERVICES) {
  try {
    const r = await fetch(`https://run.googleapis.com/v2/projects/${P}/locations/${R}/services/${s}`, { headers: { authorization: `Bearer ${await token()}` } });
    if (!r.ok) { bad(`${s}: its settings could not be read (${r.status}), so it was not checked`); continue; }
    const env = Object.fromEntries((((await r.json()).template?.containers || [])[0]?.env || []).map((e) => [e.name, e.value ?? `(secret ${e.valueSource?.secretKeyRef?.secret || ''})`]));
    for (const k of ['DEMO_MODE', 'AI_MOCK', 'OPEN_SITE', 'DEV_LOGIN', 'DEV_MEMBER', 'SLOOSH_DUMMY']) if (env[k] && env[k] !== '0') bad(`${s}: ${k}=${env[k]} (never on production)`);
    if (env.ENV !== 'production') bad(`${s}: ENV is ${env.ENV || 'unset'}, not production`);
    if (env.RESEARCH_BUCKET !== 'brew-prod') bad(`${s}: RESEARCH_BUCKET is ${env.RESEARCH_BUCKET || 'unset'}, not brew-prod`);
    if (env.STORAGE !== 'pg') bad(`${s}: STORAGE is ${env.STORAGE || 'unset'}, not pg`);
    if (!/^https:\/\/feed\.joinsquareup\.com$/.test(env.PUBLIC_URL || '')) bad(`${s}: PUBLIC_URL is ${env.PUBLIC_URL || 'unset'}`);
    if (env.OBJECTS_READTHROUGH === '1' || env.OBJECTS_MIRROR === '1') bad(`${s}: reads or writes the staging bucket path (OBJECTS_READTHROUGH/MIRROR)`);
    if (!/(secret BREW_PROD_DATABASE_URL)/.test(env.DATABASE_URL || '')) bad(`${s}: DATABASE_URL is not the production database`);
    console.log(`[clean] ${s}: settings checked`);
  } catch (e) { bad(`${s}: settings check failed (${e.message})`); }
}

/* 2. the production database */
const brands = (await q(`SELECT DISTINCT split_part(key, '/', 2) AS s FROM objects WHERE key LIKE 'brands/%'`)).rows.map((r) => r.s).filter((x) => x && x !== '_brew');
for (const s of brands) { if (TEST_BRANDS.has(s)) bad(`a test brand is on production: ${s}`); if (/^zz-/.test(s)) bad(`a test key is on production: brands/${s}/`); }
const n = async (sql, args = []) => +(await q(sql, args)).rows[0].n;
const del = await n(`SELECT count(*) AS n FROM objects WHERE key LIKE '\\_deleted/%' ESCAPE '\\'`); if (del) bad(`${del} archived object(s) (_deleted/) on production`);
const demo = await n(`SELECT count(*) AS n FROM objects WHERE key ~ '^brands/[^/]+/(demo/|demo\\.json$)'`); if (demo) bad(`${demo} demo sandbox object(s) on production`);
const zz = await n(`SELECT count(*) AS n FROM objects WHERE key LIKE '%zz-%'`); if (zz) bad(`${zz} object(s) with test keys (zz-) on production`);
let tws = 0; for (const r of (await q(`SELECT key, body, content_type FROM objects WHERE key LIKE 'tenants/%' AND content_type <> 'application/x-parted'`)).rows) { try { if (TEST_BRANDS.has(JSON.parse(r.body.toString('utf8')).brandId)) tws++; } catch {} }
const tp = (await q(`SELECT o.key, p.body FROM objects o JOIN doc_parts p ON p.key = o.key AND p.part = 'brandId' WHERE o.key LIKE 'tenants/%'`)).rows; for (const r of tp) { try { if (TEST_BRANDS.has(JSON.parse(r.body.toString('utf8')))) tws++; } catch {} }
if (tws) bad(`${tws} workspace(s) of test brands on production`);
console.log(`[clean] database checked: ${brands.length} brand(s): ${brands.join(', ') || 'none yet'}`);

await close();
if (found.length) { console.log(`[clean] REFUSED: ${found.length} finding(s)`); process.exit(1); }
console.log('[clean] production is clean');
