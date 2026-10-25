// Phase 6: copy design partners from staging to production (db/partner-copy.js says what is copied and what stays).
// A dry run unless --apply. Run as the Cloud Run Job brew-partner-copy (inside the VPC: both databases have private IPs only):
//   node db/migrate-to-prod.mjs --slug scrubroom-in [--slug …] [--global] [--apply] [--any]
// Needs SRC_DATABASE_URL (staging), DATABASE_URL (production), SRC_VAULT_KEY (staging's FEED_VAULT_KEY), FEED_VAULT_KEY
// (production's), SRC_BUCKET (brew-prototype) and RESEARCH_BUCKET (brew-prod). Exits 1 if anything failed.
import pg from 'pg';
import { copyBrand, copyGlobal, gcsStore, PARTNERS } from './partner-copy.js';
import { migrate } from './migrate.js';

const args = process.argv.slice(2), flag = (k) => args.includes(k), vals = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const APPLY = flag('--apply'), slugs = vals('--slug');
const need = (k) => { const v = process.env[k]; if (!v) { console.log(`[partner] STOP: ${k} is not set`); process.exit(1); } return v; };
const SRC_DB = need('SRC_DATABASE_URL'), DST_DB = need('DATABASE_URL'), SRC_BUCKET = need('SRC_BUCKET'), DST_BUCKET = need('RESEARCH_BUCKET');
if (SRC_DB === DST_DB || SRC_BUCKET === DST_BUCKET) { console.log('[partner] STOP: staging and production are the same database or bucket'); process.exit(1); }
if (DST_BUCKET !== 'brew-prod' && !flag('--any')) { console.log(`[partner] STOP: production's bucket is brew-prod, not ${DST_BUCKET}`); process.exit(1); }
const keys = { src: need('SRC_VAULT_KEY'), dst: need('FEED_VAULT_KEY') };
if (keys.src === keys.dst) { console.log('[partner] STOP: production must have its own vault key'); process.exit(1); }
for (const s of slugs) if (!PARTNERS.includes(s) && !flag('--any')) { console.log(`[partner] STOP: ${s} is not one of the design partners (${PARTNERS.join(', ')}); --any to copy it anyway`); process.exit(1); }
if (!slugs.length && !flag('--global')) { console.log('[partner] STOP: name a brand (--slug) or --global'); process.exit(1); }

const token = async () => (await (await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })).json()).access_token;
const conf = (u) => ({ connectionString: u, max: 4, statement_timeout: 120e3, application_name: 'brew-partner-copy' });
/* staging is opened read-only: every connection of this pool refuses writes */
const src = new pg.Pool({ ...conf(SRC_DB), options: '-c default_transaction_read_only=on' }), dst = new pg.Pool(conf(DST_DB));
let failed = 0;
try {
  if (APPLY) await migrate(); /* production's schema up to date (db/index.js uses DATABASE_URL: production) */
  const store = gcsStore({ src: SRC_BUCKET, dst: DST_BUCKET, token });
  if (flag('--global')) await copyGlobal({ src, dst, apply: APPLY });
  for (const slug of slugs) {
    try { const r = await copyBrand({ src, dst, slug, keys, store, apply: APPLY });
      for (const v of r.vault) console.log(`[partner] ${slug} sign-in ${v.file}: ${v.kinds} (saved ${v.at})`); /* field names only, never a value */
      for (const [why, n] of Object.entries(r.skipped)) console.log(`[partner] ${slug} left on staging: ${n} × ${why}`);
      if (r.mediaMissing.length) console.log(`[partner] ${slug} ${r.mediaMissing.length} media file(s) already missing on staging, e.g. ${r.mediaMissing.slice(0, 3).join(', ')}`); }
    catch (e) { failed++; console.log(`[partner] ${slug} FAILED: ${e.message}`); }
  }
} finally { await Promise.all([src.end(), dst.end()]); const { close } = await import('./index.js'); await close().catch(() => {}); }
console.log(`[partner] ${APPLY ? 'done' : 'dry run done (nothing written; --apply to copy)'}${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
