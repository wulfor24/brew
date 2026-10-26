// Phase 6: copy design partners from staging to production (db/partner-copy.js says what is copied and what stays).
// A dry run unless --apply. Run as the Cloud Run Job brew-partner-copy (inside the VPC: both databases have private IPs only):
//   node db/migrate-to-prod.mjs --slug scrubroom-in [--slug …] [--global] [--jams] [--workspaces] [--sync] [--apply] [--any]
// Needs SRC_DATABASE_URL (staging), DATABASE_URL (production), SRC_VAULT_KEY (staging's FEED_VAULT_KEY), FEED_VAULT_KEY
// (production's), SRC_BUCKET (brew-prototype) and RESEARCH_BUCKET (brew-prod). BACKUP_BUCKET (default brew-prod-backups) takes
// the pre-sync export: a sync apply first writes gs://<BACKUP_BUCKET>/presync/<UTC>/run.json, and STOPs with nothing written if
// that write is refused. Exits 1 if anything failed or a row changed on production during the run (run it again).
import pg from 'pg';
import { copyBrand, copyGlobal, copyWorkspaces, gcsStore, PARTNERS } from './partner-copy.js';
import { migrate } from './migrate.js';

/* also plain words (gcloud mangles repeated flags in a job's args): `scrubroom-in nutrova-com global jams workspaces sync apply` */
const WORDS = { apply: '--apply', global: '--global', any: '--any', jams: '--jams', sync: '--sync', workspaces: '--workspaces' };
const raw = process.argv.slice(2), args = raw.flatMap((a, i) => (WORDS[a] ? [WORDS[a]] : !a.startsWith('--') && raw[i - 1] !== '--slug' ? ['--slug', a] : [a]));
const flag = (k) => args.includes(k), vals = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const APPLY = flag('--apply'), JAMS = flag('--jams'), SYNC = flag('--sync'), WORKSPACES = flag('--workspaces'), slugs = vals('--slug');
const need = (k) => { const v = process.env[k]; if (!v) { console.log(`[partner] STOP: ${k} is not set`); process.exit(1); } return v; };
const SRC_DB = need('SRC_DATABASE_URL'), DST_DB = need('DATABASE_URL'), SRC_BUCKET = need('SRC_BUCKET'), DST_BUCKET = need('RESEARCH_BUCKET');
const BACKUP_BUCKET = process.env.BACKUP_BUCKET || 'brew-prod-backups';
if (SRC_DB === DST_DB || SRC_BUCKET === DST_BUCKET) { console.log('[partner] STOP: staging and production are the same database or bucket'); process.exit(1); }
if (DST_BUCKET !== 'brew-prod' && !flag('--any')) { console.log(`[partner] STOP: production's bucket is brew-prod, not ${DST_BUCKET}`); process.exit(1); }
const keys = { src: need('SRC_VAULT_KEY'), dst: need('FEED_VAULT_KEY') };
if (keys.src === keys.dst) { console.log('[partner] STOP: production must have its own vault key'); process.exit(1); }
for (const s of slugs) if (!PARTNERS.includes(s) && !flag('--any')) { console.log(`[partner] STOP: ${s} is not one of the design partners (${PARTNERS.join(', ')}); --any to copy it anyway`); process.exit(1); }
if (!slugs.length && !flag('--global')) { console.log('[partner] STOP: name a brand (--slug) or --global'); process.exit(1); }
console.log(`[partner] ${APPLY ? 'apply' : 'dry run'}: ${slugs.join(', ') || 'no brands'}${flag('--global') ? ' + shared rows' : ''}${JAMS ? ' + jams' : ''}${WORKSPACES ? ' + workspaces' : ''}${SYNC ? ' (sync: staging wins, connections and production-only parts and members kept)' : ''}`);

const token = async () => (await (await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })).json()).access_token;
const conf = (u) => ({ connectionString: u, max: 4, statement_timeout: 120e3, application_name: 'brew-partner-copy' });
/* staging is opened read-only: every connection of this pool refuses writes */
const src = new pg.Pool({ ...conf(SRC_DB), options: '-c default_transaction_read_only=on' }), dst = new pg.Pool(conf(DST_DB));
let failed = 0, conflicts = 0, stopped = false;
try {
  const store = gcsStore({ src: SRC_BUCKET, dst: DST_BUCKET, token });
  /* sync apply: the export place must take a write before anything at all is written (schema, shared rows, any brand) */
  let exportRows = null;
  if (APPLY && SYNC) {
    const base = `presync/${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}/`;
    try { await store.put(BACKUP_BUCKET, `${base}run.json`, JSON.stringify({ at: new Date().toISOString(), slugs, jams: JAMS, workspaces: WORKSPACES, global: flag('--global') }));
      console.log(`[partner] pre-sync export to gs://${BACKUP_BUCKET}/${base}`); }
    catch (e) { stopped = true; console.log(`[partner] STOP: the pre-sync export to gs://${BACKUP_BUCKET}/${base} could not be written (${e.message}); nothing written${/403/.test(e.message) ? `. brew-partner-copy@ needs roles/storage.objectCreator on gs://${BACKUP_BUCKET}` : ''}`); }
    exportRows = async (name, text) => { await store.put(BACKUP_BUCKET, base + name, text, 'application/x-ndjson'); console.log(`[partner] exported production's rows to gs://${BACKUP_BUCKET}/${base}${name} (${text.split('\n').length - 1} lines)`); };
  }
  if (!stopped) {
    if (APPLY) await migrate(); /* production's schema up to date (db/index.js uses DATABASE_URL: production) */
    if (flag('--global')) await copyGlobal({ src, dst, apply: APPLY });
    const did = APPLY ? 'replaced' : 'would replace';
    for (const slug of slugs) {
      try { const r = await copyBrand({ src, dst, slug, keys, store, apply: APPLY, jams: JAMS, sync: SYNC, exportRows });
        for (const v of r.vault) console.log(`[partner] ${slug} sign-in ${v.file}: ${v.kinds} (saved ${v.at})`); /* field names only, never a value */
        for (const k of r.kept) console.log(`[partner] ${slug} keptProd ${k} (a connection: production's row is never written)`);
        for (const o of r.replaced) if (o.by === 'production' || o.action !== 'overwrite') {
          console.log(`[partner] ${slug} ${did} ${o.action} ${o.key} (staging ${o.staging}, production ${o.production}${o.by === 'production' ? ', production wrote it' : ''})`);
          if (o.prodOnlyParts?.length) console.log(`[partner] ${slug}   kept ${o.prodOnlyParts.length} part(s) only production has: ${o.prodOnlyParts.map((p) => JSON.stringify(p)).join(', ')}`);
          if (o.droppedParts?.length) console.log(`[partner] ${slug}   DROPPED ${o.droppedParts.length} production part(s) staging keeps another shape for: ${o.droppedParts.map((p) => JSON.stringify(p)).join(', ')}`);
          if (o.prodOnlyMembers?.length) console.log(`[partner] ${slug}   kept member(s) only production has: ${o.prodOnlyMembers.join(', ')}`); }
        for (const k of r.conflicts) console.log(`[partner] ${slug} CONFLICT ${k}: production changed it during the run; not written (run again)`);
        conflicts += r.conflicts.length;
        for (const [why, n] of Object.entries(r.skipped)) console.log(`[partner] ${slug} left on staging: ${n} × ${why}`);
        if (r.mediaMissing.length) console.log(`[partner] ${slug} ${r.mediaMissing.length} media file(s) already missing on staging, e.g. ${r.mediaMissing.slice(0, 3).join(', ')}`); }
      catch (e) { failed++; console.log(`[partner] ${slug} FAILED: ${e.message}`); }
    }
    if (WORKSPACES) {
      try { const r = await copyWorkspaces({ src, dst, slugs, store, apply: APPLY });
        for (const k of r.keys) console.log(`[partner] workspace ${APPLY ? 'copied' : 'would copy'} ${k}`);
        for (const k of r.conflicts) console.log(`[partner] workspace CONFLICT ${k}: appeared on production during the run; not written`);
        conflicts += r.conflicts.length; }
      catch (e) { failed++; console.log(`[partner] workspaces FAILED: ${e.message}`); }
    }
  }
} finally { await Promise.all([src.end(), dst.end()]); const { close } = await import('./index.js'); await close().catch(() => {}); }
if (stopped) process.exit(1);
console.log(`[partner] ${APPLY ? 'done' : 'dry run done (nothing written; --apply to copy)'}${failed ? `, ${failed} failed` : ''}${conflicts ? `, ${conflicts} changed on production during the run (not written)` : ''}`);
if (failed || conflicts) process.exit(1);
