// One brand's data in Postgres (STORAGE=pg) and its bucket files: what a reset to a fresh first run removes
// (db/reset-brand.mjs), and what a data request deletes (db/delete-brand.mjs). Both are dry runs until --yes.
// - reset: the brand's rows under brands/<slug>/ (minus its connections: KEEP), its workspaces, its build progress,
//   its queued and finished jobs and its bus messages. Connections, sign-in tokens and connected numbers stay, always.
// - delete: everything of the brand we hold (rows, parts, workspaces, archives in _deleted/, build progress, jobs, bus,
//   counters, access log, bucket files and the made/research media nobody else points at), our stored tokens included.
//   It never calls a platform: no grant is revoked or disconnected; the operator is told which grants the brand revokes.
// The five design partners are refused unless --partner-override and --confirm-slug <slug> are both given. A brand in
// PROTECTED_CONNECTIONS is never deleted at all (take it out of that setting first).
import { mediaRefs, PARTNERS } from './partner-copy.js';
import { PROTECTED as PROTECTED_CONNECTIONS } from '../connectors/protected.js';

const STUB = 'application/x-parted';
export { PARTNERS };
/* a brand's own paths a reset never touches (relative to brands/<slug>/): its connections, sign-in tokens and what the
   connected accounts said. Same set db/reset-jams.mjs protects, plus the connected numbers */
export const KEEP = /^(private\/connections\.json$|private\/vault\/|live\/|private\/live\/|private\/live-base\.json$|private\/connected-ledger\.json$)/;
export const NEVER = new Set(['_brew', 'brew-sample']); /* the server's own state and the hidden fallback pack */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export class Refused extends Error { constructor(m) { super(m); this.refused = true; } }

/* → null when allowed; throws Refused otherwise */
export function guard({ slug, mode, partnerOverride = false, confirmSlug = null }) {
  if (!slug) throw new Refused('--slug <slug> is needed (one brand per run)');
  if (!SLUG_RE.test(slug) || NEVER.has(slug)) throw new Refused(`not a brand that can be ${mode === 'delete' ? 'deleted' : 'reset'}: ${slug}`);
  if (mode === 'delete' && PROTECTED_CONNECTIONS().has(slug)) throw new Refused(`${slug} is in PROTECTED_CONNECTIONS: its live connections are never dropped by a tool. Take it out of that setting first, deliberately.`);
  if (PARTNERS.includes(slug)) {
    if (!partnerOverride || confirmSlug !== slug) throw new Refused(`${slug} is a design partner (${PARTNERS.join(', ')}). Refused. Only if the partner asked: add --partner-override --confirm-slug ${slug}`);
  }
  return null;
}

const jsonOf = (b) => { try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b)); } catch { return null; } };
const relOf = (slug, key) => key.slice(`brands/${slug}/`.length);
const archivedOf = (slug, key) => key.startsWith('_deleted/') && key.includes(`/${slug}/`);

/* the workspaces on a brand: whole ones carry brandId in the body, parted ones in their brandId part */
async function tenantsOf(q, slug) {
  const out = new Set();
  for (const r of (await q(`SELECT key, body FROM objects WHERE starts_with(key, 'tenants/') AND content_type <> $1`, [STUB])).rows) if (jsonOf(r.body)?.brandId === slug) out.add(r.key);
  for (const r of (await q(`SELECT o.key, p.body FROM objects o JOIN doc_parts p ON p.key = o.key AND p.part = 'brandId' WHERE starts_with(o.key, 'tenants/')`)).rows) if (jsonOf(r.body) === slug) out.add(r.key);
  return [...out].sort();
}
/* archived workspaces (a reset's copy in _deleted/…/tenants/) on the brand */
async function archivedTenantsOf(q, slug) {
  const out = [];
  for (const r of (await q(`SELECT key, body, content_type FROM objects WHERE starts_with(key, '_deleted/') AND key ~ '/tenants/t_[a-f0-9]+\\.json$'`)).rows) {
    let id = null;
    if (r.content_type === STUB) id = jsonOf((await q(`SELECT body FROM doc_parts WHERE key = $1 AND part = 'brandId'`, [r.key])).rows[0]?.body);
    else id = jsonOf(r.body)?.brandId;
    if (id === slug) out.push(r.key);
  }
  return out;
}
const textOfRows = async (q, keys) => {
  if (!keys.length) return '';
  const a = (await q(`SELECT body FROM objects WHERE key = ANY($1) AND content_type <> $2`, [keys, STUB])).rows.map((r) => r.body.toString('utf8'));
  const b = (await q(`SELECT body FROM doc_parts WHERE key = ANY($1)`, [keys])).rows.map((r) => r.body.toString('utf8'));
  return a.concat(b).join('\n');
};
/* media names every row outside `mine` points at (one pass over the tables, in pages) */
async function mediaElsewhere(q, mine) {
  const out = { research: new Set(), gen: new Set(), maybe: new Set() };
  let last = '';
  for (;;) { const rs = (await q(`SELECT key, body FROM objects WHERE key > $1 AND content_type <> $2 ORDER BY key LIMIT 300`, [last, STUB])).rows; if (!rs.length) break;
    for (const r of rs) if (!mine.has(r.key)) mediaRefs(r.body.toString('utf8'), out); last = rs[rs.length - 1].key; }
  let lk = '', lp = '';
  for (;;) { const rs = (await q(`SELECT key, part, body FROM doc_parts WHERE (key, part) > ($1, $2) ORDER BY key, part LIMIT 500`, [lk, lp])).rows; if (!rs.length) break;
    for (const r of rs) if (!mine.has(r.key)) mediaRefs(r.body.toString('utf8'), out); lk = rs[rs.length - 1].key; lp = rs[rs.length - 1].part; }
  return out;
}

/* where the brand revokes each grant itself (we never call the platform) */
export function revokeHint(id) {
  const s = String(id).toLowerCase();
  if (/shopify/.test(s)) return 'Shopify admin > Settings > Apps and sales channels: uninstall Brew';
  if (/meta|facebook|instagram/.test(s)) return 'Meta Business Settings > Integrations > Business integrations: remove Brew';
  if (/ga4|google|gads|adwords/.test(s)) return 'myaccount.google.com/permissions: remove Brew; GA4 Admin > Property access management: remove the Brew service account';
  if (/slack/.test(s)) return 'Slack > Settings > Manage apps > Brew: Remove app';
  if (/klaviyo/.test(s)) return 'Klaviyo > Settings > API keys: revoke the key given to Brew';
  if (/review|judge/.test(s)) return 'the reviews app (Judge.me) > Settings > Integrations: regenerate the API token given to Brew';
  return `${id}: revoke Brew's access in that platform's own settings`;
}

/* what a run would remove → plan. bucket: { list(prefix) → [{ name }], exists(name) } or null (bucket not checked) */
export async function collect({ q, slug, mode, bucket = null }) {
  const pre = `brands/${slug}/`;
  const brandRows = (await q(`SELECT key, content_type FROM objects WHERE starts_with(key, $1) ORDER BY key`, [pre])).rows;
  const keep = mode === 'reset' ? brandRows.filter((r) => KEEP.test(relOf(slug, r.key))).map((r) => r.key) : [];
  const rows = brandRows.map((r) => r.key).filter((k) => !keep.includes(k));
  const tenants = await tenantsOf(q, slug);
  const archives = mode === 'delete' ? [...(await q(`SELECT key FROM objects WHERE starts_with(key, '_deleted/') AND position($1 in key) > 0 ORDER BY key`, [`/${slug}/`])).rows.map((r) => r.key), ...(await archivedTenantsOf(q, slug))] : [];
  const needle = JSON.stringify(slug); /* the slug as a JSON string anywhere in a job's data or a bus message */
  const jobs = (await q(`SELECT id, name, state FROM jobs WHERE position($1 in data::text) > 0 OR key = $2 OR key LIKE $3 OR key LIKE $4 ORDER BY id`, [needle, slug, `%:${slug}`, `%:${slug}:%`])).rows;
  const bus = (await q(`SELECT id FROM bus WHERE position($1 in payload::text) > 0`, [needle])).rows.map((r) => +r.id);
  const buildEvents = (await q(`SELECT count(*)::int AS n FROM build_events WHERE slug = $1`, [slug])).rows[0].n;
  const counters = mode === 'delete' ? (await q(`SELECT count(*)::int AS n FROM counters WHERE key = $1 OR starts_with(key, $2)`, [slug, `${slug}:`])).rows[0].n : 0;
  const accessLog = mode === 'delete' ? (await q(`SELECT count(*)::int AS n FROM access_log WHERE slug = $1`, [slug])).rows[0].n : 0;
  /* the grants the brand gave (connections and sign-in tokens): delete names them so the brand can revoke them */
  let grants = [];
  if (mode === 'delete') {
    const conns = jsonOf((await q(`SELECT body FROM objects WHERE key = $1`, [`${pre}private/connections.json`])).rows[0]?.body) || {};
    const vault = brandRows.map((r) => relOf(slug, r.key)).filter((k) => /^private\/vault\/[^/]+\.json$/.test(k)).map((k) => k.slice('private/vault/'.length, -5)).filter((k) => !/-pending-/.test(k));
    grants = [...new Set([...Object.keys(conns), ...vault])].sort().map((id) => ({ id, state: conns[id]?.state || (vault.includes(id) ? 'token saved' : 'unknown'), revoke: revokeHint(id) }));
  }
  /* bucket files: the brand folder (binaries; on a mirrored staging, the rows' copies too), the workspaces' copies, archives, media */
  let files = [], media = [], bucketChecked = !!bucket;
  if (bucket) {
    const fl = (await bucket.list(pre)).map((f) => f.name).filter((n) => mode !== 'reset' || !KEEP.test(relOf(slug, n)));
    for (const t of tenants) if (await bucket.exists(t)) fl.push(t);
    if (mode === 'delete') {
      for (const f of await bucket.list('_deleted/')) {
        if (archivedOf(slug, f.name)) fl.push(f.name);
        else if (/\/tenants\/t_[a-f0-9]+\.json$/.test(f.name) && bucket.get && jsonOf(await bucket.get(f.name))?.brandId === slug) fl.push(f.name);
      }
      /* made and research media the brand's rows point at, unless any other row does */
      const mine = new Set([...rows, ...tenants, ...archives]);
      const refs = mediaRefs(await textOfRows(q, [...mine]));
      const other = await mediaElsewhere(q, mine);
      const want = [...[...refs.gen, ...refs.maybe].filter((n) => !other.gen.has(n) && !other.maybe.has(n)).map((n) => [`gen/${n}`]),
        ...[...refs.research].filter((n) => !other.research.has(n)).map((n) => [`research-media/${n}`, `media/${n}`])];
      for (const alts of want) for (const k of alts) if (await bucket.exists(k)) media.push(k);
    }
    files = [...new Set(fl)].sort();
  }
  return { slug, mode, rows, keep, tenants, archives, jobs, bus, buildEvents, counters, accessLog, grants, files, media: [...new Set(media)].sort(), bucketChecked };
}

export const removable = (p) => p.rows.length + p.tenants.length + p.archives.length + p.jobs.length + p.bus.length + p.buildEvents + p.counters + p.accessLog + p.files.length + p.media.length;
export const summary = (p) => ({ rows: p.rows.length, workspaces: p.tenants.length, archives: p.archives.length, jobs: p.jobs.length, bus: p.bus.length, buildEvents: p.buildEvents, counters: p.counters, accessLog: p.accessLog, bucketFiles: p.files.length, media: p.media.length, kept: p.keep.length, bucketChecked: p.bucketChecked });
/* by folder (brands/<slug>/<first part>), for the audit row: what kinds of data went, never the contents or member names */
export const byFolder = (p) => { const m = {}; for (const k of [...p.rows, ...p.files.filter((f) => f.startsWith(`brands/${p.slug}/`))]) { const r = relOf(p.slug, k), f = r.includes('/') ? r.split('/').slice(0, r.startsWith('private/') ? 2 : 1).join('/') + '/' : r; m[f] = (m[f] || 0) + 1; } return m; };

/* every line a person reads before saying --yes: exactly what would go */
export function describe(p, log = console) {
  const L = (s) => log.log(s);
  L(`[${p.mode}] ${p.slug}: ${removable(p)} things to remove`);
  const list = (title, xs) => { L(`  ${title}: ${xs.length}`); for (const x of xs) L(`    - ${x}`); };
  list('rows under brands/' + p.slug + '/', p.rows);
  if (p.mode === 'reset') list('KEPT (connections, tokens, connected numbers)', p.keep);
  list('workspaces', p.tenants);
  if (p.mode === 'delete') list('archived copies in _deleted/', p.archives);
  L(`  jobs: ${p.jobs.length}${p.jobs.length ? ' (' + p.jobs.map((j) => `${j.id} ${j.name} ${j.state}`).join(', ') + ')' : ''}`);
  L(`  bus messages: ${p.bus.length}   build progress lines: ${p.buildEvents}${p.mode === 'delete' ? `   counters: ${p.counters}   access log rows: ${p.accessLog}` : ''}`);
  if (p.bucketChecked) { list('bucket files', p.files); if (p.mode === 'delete') list('made/research media only this brand points at', p.media); }
  else L('  bucket: NOT CHECKED (no bucket given): its files stay');
  if (p.mode === 'delete') { L(`  grants we never revoke (the brand revokes them itself):`); for (const g of p.grants) L(`    - ${g.id} (${g.state}): ${g.revoke}`); if (!p.grants.length) L('    - none saved'); }
}

const fp = async (q, keys) => (keys.length ? (await q(`SELECT o.key, md5(o.body) AS h, (SELECT string_agg(md5(p.body), ',' ORDER BY p.part) FROM doc_parts p WHERE p.key = o.key) AS ph FROM objects o WHERE o.key = ANY($1) ORDER BY o.key`, [keys])).rows.map((r) => `${r.key}:${r.h}:${r.ph || ''}`).join('|') : '');
/* fingerprint of what a reset must leave as it is */
export const keptPrint = (q, p) => fp(q, p.keep);

/* remove what the plan lists. archive: a key prefix (e.g. _deleted/brand-<time>) the rows are copied under first, or null.
   tx(fn(client)) runs the database part in one transaction; the bucket goes after the commit */
export async function apply({ tx, plan, bucket = null, archive = null, log = console }) {
  const p = plan, pre = `brands/${p.slug}/`;
  for (const k of p.rows) { if (!k.startsWith(pre)) throw new Error(`refusing ${k}: not the brand's`); if (p.mode === 'reset' && KEEP.test(relOf(p.slug, k))) throw new Error(`refusing to remove ${k}: a connection`); }
  for (const k of p.tenants) if (!/^tenants\/t_[a-f0-9]+\.json$/.test(k)) throw new Error(`refusing ${k}: not a workspace`);
  for (const k of p.archives) if (!k.startsWith('_deleted/')) throw new Error(`refusing ${k}: not an archive`);
  const keys = [...p.rows, ...p.tenants, ...p.archives];
  if (p.jobs.some((j) => j.state === 'running')) throw new Error('a job for this brand is running: wait for it to finish, then run again');
  await tx(async (c) => {
    if (archive && keys.length) {
      const to = (k) => `${archive}/${k}`;
      for (const k of [...p.rows, ...p.tenants]) {
        await c.query(`INSERT INTO objects (key, body, content_type) SELECT $2, body, content_type FROM objects WHERE key = $1 ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, version = nextval('objects_version'), updated_at = now()`, [k, to(k)]);
        await c.query('DELETE FROM doc_parts WHERE key = $1', [to(k)]);
        await c.query('INSERT INTO doc_parts (key, part, ord, body) SELECT $2, part, ord, body FROM doc_parts WHERE key = $1', [k, to(k)]);
      }
    }
    if (keys.length) { await c.query('DELETE FROM doc_parts WHERE key = ANY($1)', [keys]); await c.query('DELETE FROM objects WHERE key = ANY($1)', [keys]); }
    if (p.jobs.length) await c.query(`DELETE FROM jobs WHERE id = ANY($1) AND state <> 'running'`, [p.jobs.map((j) => j.id)]);
    if (p.bus.length) await c.query('DELETE FROM bus WHERE id = ANY($1)', [p.bus]);
    if (p.buildEvents) await c.query('DELETE FROM build_events WHERE slug = $1', [p.slug]);
    if (p.mode === 'delete') { await c.query('DELETE FROM counters WHERE key = $1 OR starts_with(key, $2)', [p.slug, `${p.slug}:`]); await c.query('DELETE FROM access_log WHERE slug = $1', [p.slug]); }
  });
  if (bucket) {
    for (const f of p.files) { if (p.mode === 'reset' && f.startsWith(pre) && KEEP.test(relOf(p.slug, f))) throw new Error(`refusing to remove ${f}: a connection`);
      if (archive && bucket.copy && !f.startsWith('_deleted/')) await bucket.copy(f, `${archive}/${f}`); await bucket.del(f, { allVersions: p.mode === 'delete' }); }
    for (const f of p.media) await bucket.del(f, { allVersions: true });
  }
  log.log?.(`[${p.mode}] ${p.slug}: removed ${JSON.stringify(summary(p))}${archive ? `, copy in ${archive}/` : ''}`);
}

/* the audit of a deletion: the only thing kept (db/migrations/010_data_deletions.sql) */
export async function auditStart(q, { slug, request = null, operator = null, plan }) {
  const has = (await q(`SELECT to_regclass('public.data_deletions') AS t`)).rows[0].t;
  if (!has) throw new Refused('table data_deletions is missing: run the migrations first (node db/migrate.js, or promote)');
  return +(await q(`INSERT INTO data_deletions (slug, request, operator, planned) VALUES ($1, $2, $3, $4) RETURNING id`, [slug, request, operator, JSON.stringify({ ...summary(plan), folders: byFolder(plan) })])).rows[0].id;
}
export async function auditDone(q, id, { removed, grants, residual, cameBack = 0, left = 0 }) {
  await q(`UPDATE data_deletions SET done_at = now(), removed = $2, grants = $3, residual = $4, came_back = $5, left_after = $6 WHERE id = $1`, [id, JSON.stringify(removed), JSON.stringify(grants), JSON.stringify(residual), cameBack, left]);
}

/* the bucket through the JSON API (token(): an access token) */
export function gcsBucket({ bucket, token }) {
  const enc = encodeURIComponent, B = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`;
  const call = async (url, init = {}) => { for (let i = 0; ; i++) { const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${await token()}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(120e3) }); if (r.ok || r.status === 404 || i >= 4 || (r.status < 500 && r.status !== 429)) return r; await new Promise((s) => setTimeout(s, 500 * 2 ** i)); } };
  const list = async (prefix, { versions = false } = {}) => { const out = []; let pt = ''; do { const r = await call(`${B}?prefix=${enc(prefix)}${versions ? '&versions=true' : ''}&fields=items(name,generation),nextPageToken${pt ? '&pageToken=' + enc(pt) : ''}`); if (!r.ok) throw new Error(`list ${prefix} ${r.status}`); const j = await r.json(); out.push(...(j.items || [])); pt = j.nextPageToken || ''; } while (pt); return out; };
  return { name: bucket, list,
    async exists(name) { const r = await call(`${B}/${enc(name)}?fields=name`); if (r.status === 404) return false; if (!r.ok) throw new Error(`stat ${name} ${r.status}`); return true; },
    async get(name) { const r = await call(`${B}/${enc(name)}?alt=media`); if (r.status === 404) return null; if (!r.ok) throw new Error(`get ${name} ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
    async copy(from, to) { let rt = ''; do { const r = await call(`${B}/${enc(from)}/rewriteTo/b/${bucket}/o/${enc(to)}${rt ? '?rewriteToken=' + enc(rt) : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); if (!r.ok) throw new Error(`copy ${from} ${r.status}`); const j = await r.json(); rt = j.done ? '' : j.rewriteToken; } while (rt); },
    /* allVersions: the older (noncurrent) generations too, so a data request leaves no copy in object versioning */
    async del(name, { allVersions = false } = {}) {
      const gens = allVersions ? (await list(name, { versions: true })).filter((x) => x.name === name).map((x) => x.generation) : [null];
      for (const g of gens.length ? gens : [null]) { const r = await call(`${B}/${enc(name)}${g ? `?generation=${g}` : ''}`, { method: 'DELETE' }); if (!r.ok && r.status !== 404) throw new Error(`delete ${name} ${r.status}`); } } };
}

/* the whole run, shared by both tools. o: { mode, slug, yes, partnerOverride, confirmSlug, revN, url, archive, request, operator,
   settleMs, waitMs, retireOn }. env: { q, tx, bucket, log, sleep, poke } */
export async function run(o, { q, tx, bucket = null, log = console, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), poke = async () => {} }) {
  guard(o);
  const plan = await collect({ q, slug: o.slug, mode: o.mode, bucket });
  describe(plan, log);
  if (!o.yes) { log.log(`DRY RUN: nothing was removed. Run again with --yes to ${o.mode} ${o.slug}.`); return { dry: true, plan }; }
  if (plan.jobs.some((j) => j.state === 'running')) throw new Refused('a job for this brand is running: wait for it to finish, then run again (nothing removed)');
  if (o.retireOn && !o.revN) throw new Refused('--rev-n <live revision number> is needed on a site whose instances obey the stop marker (retire.js), so the live instance does not write the brand back (nothing removed)');
  const before = o.mode === 'reset' ? await keptPrint(q, plan) : null;
  const auditId = o.mode === 'delete' ? await auditStart(q, { slug: o.slug, request: o.request, operator: o.operator, plan }) : null;
  const marker = async (wipe) => { if (!o.retireOn) return; await q(`INSERT INTO objects (key, body, content_type) VALUES ($1, $2, 'application/json') ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, src = NULL, version = nextval('objects_version'), updated_at = now()`, [o.control || 'control/live.json', Buffer.from(JSON.stringify({ rev: 'stop', n: +o.revN, at: Date.now(), wipe }))]); await sleep(o.waitMs ?? 25e3); await poke(); await sleep(o.waitMs ?? 8e3); };
  log.log(o.retireOn ? `stop the live revision ${o.revN} and hide ${o.slug}` : 'no stop marker (RETIRE_OFF=1 here): sweeping again after a pause instead');
  await marker([o.slug]);
  await apply({ tx, plan, bucket, archive: o.archive || null, log });
  /* what an instance still holding the brand in memory wrote back meanwhile */
  let cameBack = 0;
  for (let i = 0; i < 3; i++) { await sleep(o.settleMs ?? 20e3); const again = await collect({ q, slug: o.slug, mode: o.mode, bucket });
    const n = removable(again) - again.media.length; if (!n) { log.log(`   nothing came back (${i + 1})`); continue; }
    cameBack += n; log.log(`   ${n} came back and are removed`); await apply({ tx, plan: { ...again, media: [] }, bucket, archive: null, log }); }
  await marker([]);
  const after = await collect({ q, slug: o.slug, mode: o.mode, bucket }), left = removable(after) - after.media.length;
  log.log(left ? `VERIFY: ${left} still there: ${JSON.stringify(summary(after))}` : `VERIFY: ${o.slug} holds nothing to ${o.mode} any more`);
  if (o.mode === 'reset') { const now = await keptPrint(q, after); if (now !== before) throw new Error('VERIFY FAILED: the kept connection rows changed during the reset'); log.log(`VERIFY: ${plan.keep.length} connection rows unchanged`); }
  const residual = ['Cloud SQL backups and point-in-time logs keep the rows until they age out (7-day PITR, 14 daily backups, the nightly export overwritten nightly)',
    ...(bucket ? ['the bucket\'s soft delete keeps deleted files up to its retention (production: 7 days)'] : ['bucket files were NOT checked (no bucket given)']),
    'sign-in sessions belong to people, not brands: they end on their own (or sign the person out everywhere)'];
  if (auditId) await auditDone(q, auditId, { removed: { ...summary(plan), folders: byFolder(plan) }, grants: plan.grants, residual, cameBack, left });
  if (o.mode === 'delete') { log.log('TELL THE BRAND to revoke these grants themselves (we never revoke or disconnect a platform grant):'); for (const g of plan.grants) log.log(`  - ${g.id}: ${g.revoke}`); if (!plan.grants.length) log.log('  - none were saved'); log.log('STILL HELD for a while (say so in the reply):'); for (const r of residual) log.log(`  - ${r}`); log.log(`audit row data_deletions.id = ${auditId}`); }
  return { dry: false, plan, cameBack, left, auditId };
}

/* --flag value and --flag parsing shared by the two tools */
export function parseArgs(argv) {
  const vals = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : [])), has = (k) => argv.includes(k);
  const slugs = vals('--slug');
  if (slugs.length > 1) throw new Refused('one brand per run: give --slug once');
  return { slug: slugs[0] || null, yes: has('--yes'), partnerOverride: has('--partner-override'), confirmSlug: vals('--confirm-slug')[0] || null, revN: vals('--rev-n')[0] || null, url: vals('--url')[0] || null,
    noArchive: has('--no-archive'), noBucket: has('--no-bucket'), request: vals('--request')[0] || null, operator: vals('--operator')[0] || null, control: vals('--control')[0] || null };
}
