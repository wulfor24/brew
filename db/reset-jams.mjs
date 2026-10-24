// Clear jams and remixes on a live site that runs on Postgres (STORAGE=pg), keeping cards, moves, drafts, learnings and
// every connection. Run as a Cloud Run Job inside the VPC (the database has a private IP only):
//   node db/reset-jams.mjs --all --rev-n 706 [--url https://brew.joinsquareup.com]      (or --slug arata-in, repeatable)
// 1 archive each brand's jams (v1 private/jams.json, Studio private/jams-v2.json) and its workspaces to _deleted/jams-<time>/
// 2 stop the live revision and hide the brands (control/live.json, retire.js), so no instance flushes jams over the reset
// 3 empty the jams and strip jam/remix state from the workspaces   4 stop again with nothing hidden   5 verify
// Never touched: private/connections.json, private/vault/*, live/*, private/live/* (a test pins this).
import { createObjects } from '../objects.js';
import { q, close } from '../db/index.js';

const args = process.argv.slice(2), vals = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const ALL = args.includes('--all'), N = +vals('--rev-n')[0], URL0 = vals('--url')[0] || process.env.PUBLIC_URL || 'https://brew.joinsquareup.com';
if (!N) throw new Error('--rev-n <live revision number> is needed (the stop marker must match the live revision)');
const BUCKET = process.env.RESEARCH_BUCKET || 'brew-prototype';
const token = async () => (process.env.GCS_TOKEN || (await (await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })).json()).access_token);
const O = createObjects({ bucket: BUCKET, gToken: token, mirror: true, readThrough: false, log: console }); /* the bucket keeps a copy, as the app does */
export const PROTECTED = /(^|\/)(private\/connections\.json|private\/vault\/|live\/|private\/live\/)/;
const put = async (key, v) => { if (PROTECTED.test(key)) throw new Error(`refusing to write ${key}`); await O.put(key, typeof v === 'string' ? v : JSON.stringify(v)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const poke = async () => { for (const p of ['/api/config', '/']) await fetch(URL0 + p).catch(() => {}); };
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', ARCH = `_deleted/jams-${stamp}`;

const slugs = ALL ? (await q(`SELECT split_part(key, '/', 2) AS s FROM objects WHERE key LIKE 'brands/%/status.json'`)).rows.map((r) => r.s).filter((s) => s && s !== '_brew') : vals('--slug');
if (!slugs.length) throw new Error('no brands: --all or --slug <slug>');
const tenants = (await q(`SELECT key, body FROM objects WHERE key LIKE 'tenants/%.json'`)).rows
  .map((r) => { try { return { key: r.key, t: JSON.parse(r.body.toString('utf8')) }; } catch { return null; } })
  .filter((x) => x && (ALL || slugs.includes(x.t.brandId)));
console.log(`[reset-jams] ${slugs.length} brands, ${tenants.length} workspaces, archive ${ARCH}`);

console.log('1/5 archive');
for (const s of slugs) for (const f of ['private/jams.json', 'private/jams-v2.json']) { const b = await O.get(`brands/${s}/${f}`); if (b) await put(`${ARCH}/${s}/${f.split('/').pop()}`, b.toString('utf8')); }
for (const { key, t } of tenants) await put(`${ARCH}/${key}`, JSON.stringify(t));

console.log('2/5 stop the live revision, hide the brands');
await O.put('control/live.json', { rev: 'stop', n: N, at: Date.now(), wipe: slugs }); await sleep(+process.env.RESET_WAIT_MS || 25e3); await poke(); await sleep(+process.env.RESET_WAIT_MS || 8e3);

console.log('3/5 empty the jams, strip jam and remix state from the workspaces');
for (const s of slugs) { await put(`brands/${s}/private/jams.json`, { at: Date.now(), work: [], changes: {}, vg: {} }); await put(`brands/${s}/private/jams-v2.json`, { at: Date.now(), jams: {} }); }
let takes = 0;
const strip = (c) => { if (c && typeof c === 'object' && 'take' in c) { delete c.take; takes++; } };
for (const { key } of tenants) {
  const b = await O.get(key); if (!b) continue; const t = JSON.parse(b.toString('utf8')); /* re-read: the archive copy may be a moment old */
  for (const [k, v] of [['vg', {}], ['versions', []], ['router', []], ['ownWork', []], ['ownChanges', {}], ['work', []], ['changes', {}], ['actedAt', {}]]) if (k in t) t[k] = v;
  if ('acted' in t) t.acted = { __s: [] }; /* a Set in store.js's tagged form (a bare {} broke every feed: "t.acted is not iterable") */
  const cs = t.cards?.__m || t.cards; /* cards is a Map in tagged form ({ __m: [[id, card]] }) or a plain list/object */
  for (const e of Array.isArray(cs) ? cs : Object.values(cs || {})) { const v = Array.isArray(e) ? e[1] : e; if (Array.isArray(v)) v.forEach((x) => strip(Array.isArray(x) ? x[1] : x)); else strip(v); }
  await put(key, JSON.stringify(t));
}
console.log(`   ${takes} remix takes removed from cards`);

console.log('4/5 stop once more, nothing hidden');
await O.put('control/live.json', { rev: 'stop', n: N, at: Date.now(), wipe: [] }); await sleep(+process.env.RESET_WAIT_MS || 25e3); await poke(); await sleep(+process.env.RESET_WAIT_MS || 20e3);

console.log('5/5 verify');
for (const s of slugs) { const j = JSON.parse((await O.get(`brands/${s}/private/jams.json`)).toString()), v2 = JSON.parse((await O.get(`brands/${s}/private/jams-v2.json`)).toString());
  if (j.work.length || Object.keys(v2.jams).length) console.log(`   ${s}: NOT EMPTY (${j.work.length} v1, ${Object.keys(v2.jams).length} Studio)`); }
const conn = (await q(`SELECT count(*)::int AS n FROM objects WHERE key LIKE 'brands/arata-in/private/vault/%' OR key = 'brands/arata-in/private/connections.json'`)).rows[0].n;
console.log(`   arata-in connection files still there: ${conn}`);
const r = await fetch(URL0 + '/api/config').catch(() => null); console.log(`   ${URL0}/api/config -> ${r?.status}`);
await O.mirrored(); await close();
