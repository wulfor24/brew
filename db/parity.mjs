// Read-only: does Postgres hold everything the bucket holds? For every structured object in the bucket (tenants/, brands/,
// _brew/, control/), compare it with the database (a parted document read whole), as parsed JSON (text byte for byte).
// Prints counts and the first differences, never contents. Run as the brew-ops job: --args=db/parity.mjs[,--prefix,brands/arata-in/]
import { isRow, createObjects } from '../objects.js';
import { q, close } from './index.js';
import { isDeepStrictEqual } from 'node:util';

const args = process.argv.slice(2), pre = args.includes('--prefix') ? [args[args.indexOf('--prefix') + 1]] : ['tenants/', 'brands/', '_brew/', 'control/'];
const BUCKET = process.env.RESEARCH_BUCKET || 'brew-prototype';
const token = async () => process.env.GCS_TOKEN || (await (await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })).json()).access_token;
const O = createObjects({ log: { warn() {} } });
const tk = await token(), H = { authorization: `Bearer ${tk}` };
const n = { checked: 0, same: 0, differs: 0, bucketOnly: 0, dbNewer: 0, bucketNewer: 0, unreadable: 0 }, ex = { differs: [], bucketOnly: [], bucketNewer: [] };
const dbAt = new Map((await q(`SELECT key, updated_at FROM objects`)).rows.map((r) => [r.key, r.updated_at.getTime()]));
const parse = (b) => { try { return JSON.parse(b.toString('utf8')); } catch { return b.toString('utf8'); } };
async function* list(prefix) { let pt = ''; do { const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=${encodeURIComponent(prefix)}&fields=items(name,updated),nextPageToken${pt ? '&pageToken=' + pt : ''}`, { headers: H }); const j = await r.json(); for (const x of j.items || []) yield x; pt = j.nextPageToken || ''; } while (pt); }
const work = [];
for (const p of pre) for await (const x of list(p)) {
  if (!isRow(x.name) || /^(_deleted|backups)\//.test(x.name)) continue;
  work.push((async () => {
    n.checked++;
    const [g, d] = await Promise.all([fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(x.name)}?alt=media`, { headers: H }).then((r) => (r.ok ? r.arrayBuffer().then(Buffer.from) : null)), O.get(x.name).catch(() => null)]);
    if (!g) { n.unreadable++; return; }
    if (!d) { n.bucketOnly++; if (ex.bucketOnly.length < 15) ex.bucketOnly.push(x.name); return; }
    if (isDeepStrictEqual(parse(g), parse(d))) { n.same++; return; }
    n.differs++; const at = dbAt.get(x.name) || 0, gat = Date.parse(x.updated);
    if (gat > at + 60e3) { n.bucketNewer++; if (ex.bucketNewer.length < 15) ex.bucketNewer.push(`${x.name} (bucket ${x.updated}, db ${new Date(at).toISOString()})`); } else n.dbNewer++;
    if (ex.differs.length < 15) ex.differs.push(x.name);
  })());
  if (work.length >= 24) await Promise.all(work.splice(0));
}
await Promise.all(work);
console.log('[parity]', JSON.stringify(n));
for (const [k, v] of Object.entries(ex)) if (v.length) console.log(`[parity] ${k}: ${v.join(' | ')}`);
await close();
