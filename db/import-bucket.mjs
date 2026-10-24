// Copies the bucket's structured objects (JSON, markdown, text) into Postgres `objects`, keeping each object's own
// timestamp. Idempotent and safe to repeat: a row is written only when the bucket's copy is newer than the row, so once
// the app writes to Postgres a later run never overwrites that. Run it as a Cloud Run Job inside the VPC (the database
// has a private IP only), before and right after switching a service to STORAGE=pg:
//   node db/import-bucket.mjs [--prefix tenants/ --prefix brands/arata-in/] [--dry] [--cache-days 2]
// Binaries (pictures, video, PDFs) stay in the bucket and are skipped. _cache/ entries older than --cache-days are skipped.
import { isRow } from '../objects.js';
import { q, close } from '../db/index.js';
import { migrate } from '../db/migrate.js';

const args = process.argv.slice(2), flag = (k) => args.includes(k), vals = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const BUCKET = process.env.RESEARCH_BUCKET || 'brew-prototype', DRY = flag('--dry'), CACHE_DAYS = +(vals('--cache-days')[0] || 2);
/* a row the app wrote is copied to the bucket a moment later (OBJECTS_MIRROR): only a bucket copy clearly newer than the row
   (another revision wrote it there) replaces the row */
const LAG_MS = +(vals('--min-lag-s')[0] ?? 60) * 1e3;
const PREFIXES = vals('--prefix').length ? vals('--prefix') : ['tenants/', 'brands/', '_brew/', 'control/', '_cache/'];
const SKIP = /^(?:_deleted|backups|video-tmp|gen|research-media|media)\//;
async function token() {
  if (process.env.GCS_TOKEN) return process.env.GCS_TOKEN;
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  return (await r.json()).access_token;
}
let tk = await token(), tkAt = Date.now();
const auth = async () => { if (Date.now() - tkAt > 30 * 60e3) { tk = await token(); tkAt = Date.now(); } return { authorization: `Bearer ${tk}` }; };
async function* listAll(prefix) {
  let pt = '';
  do { const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=${encodeURIComponent(prefix)}&fields=items(name,updated,size),nextPageToken${pt ? '&pageToken=' + pt : ''}`, { headers: await auth() });
    if (!r.ok) throw new Error(`list ${prefix} ${r.status}`); const j = await r.json(); for (const x of j.items || []) yield x; pt = j.nextPageToken || ''; } while (pt);
}
const get = async (name) => { for (let i = 0; i < 4; i++) { const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media`, { headers: await auth() }); if (r.ok) return Buffer.from(await r.arrayBuffer()); if (r.status === 404) return null; await new Promise((s) => setTimeout(s, 500 * 2 ** i)); } throw new Error(`get ${name} failed`); };
const typeOf = (k) => (/\.json$/i.test(k) ? 'application/json' : /\.md$/i.test(k) ? 'text/markdown' : 'text/plain');

if (!DRY) await migrate();
const seen = { listed: 0, rows: 0, copied: 0, newerInDb: 0, skipped: 0, bytes: 0, failed: 0 };
const queue = [];
const work = async (x) => {
  try {
    const at = new Date(x.updated);
    const cur = (await q('SELECT updated_at FROM objects WHERE key = $1', [x.name])).rows[0];
    if (cur && cur.updated_at.getTime() + LAG_MS >= at.getTime()) { seen.newerInDb++; return; }
    if (DRY) { seen.copied++; seen.bytes += +x.size || 0; return; }
    const body = await get(x.name); if (!body) return;
    const r = await q(`INSERT INTO objects (key, body, content_type, updated_at) VALUES ($1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, version = objects.version + 1, updated_at = EXCLUDED.updated_at
      WHERE objects.updated_at + make_interval(secs => $5) < EXCLUDED.updated_at`, [x.name, body, typeOf(x.name), at, LAG_MS / 1e3]);
    if (r.rowCount) { seen.copied++; seen.bytes += body.length; } else seen.newerInDb++;
  } catch (e) { seen.failed++; console.warn('[import]', x.name, e.message); }
};
for (const prefix of PREFIXES) {
  for await (const x of listAll(prefix)) {
    seen.listed++;
    if (SKIP.test(x.name) || !isRow(x.name)) { seen.skipped++; continue; }
    if (x.name.startsWith('_cache/') && Date.now() - Date.parse(x.updated) > CACHE_DAYS * 864e5) { seen.skipped++; continue; }
    seen.rows++;
    queue.push(work(x)); if (queue.length >= 16) await Promise.all(queue.splice(0));
    if (seen.rows % 2000 === 0) console.log('[import]', JSON.stringify(seen));
  }
}
await Promise.all(queue);
console.log(`[import] ${DRY ? 'dry run ' : ''}done`, JSON.stringify({ ...seen, mb: Math.round(seen.bytes / 1e5) / 10 }));
await close();
if (seen.failed) process.exit(1);
