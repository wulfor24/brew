// The shared start of db/reset-brand.mjs and db/delete-brand.mjs: arguments, the database, the bucket, the stop marker.
import { q, tx, close } from './index.js';
import { run, parseArgs, gcsBucket, Refused } from './brand-wipe.js';

export async function main(mode, argv = process.argv.slice(2), log = console) {
  let code = 0;
  try {
    const a = parseArgs(argv);
    if (process.env.STORAGE !== 'pg' || !(process.env.DATABASE_URL || process.env.PGHOST)) throw new Refused(`${mode}-brand runs against Postgres: STORAGE=pg and DATABASE_URL are needed`);
    const prod = process.env.ENV === 'production';
    const BUCKET = process.env.RESEARCH_BUCKET || (prod ? null : 'brew-prototype');
    if (a.noBucket) log.log('--no-bucket: bucket files are not checked and stay');
    else if (!BUCKET) throw new Refused('RESEARCH_BUCKET is not set (or pass --no-bucket to leave bucket files alone)');
    const token = async () => (process.env.GCS_TOKEN || (await (await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })).json()).access_token);
    const bucket = a.noBucket ? null : gcsBucket({ bucket: BUCKET, token });
    const URL0 = a.url || process.env.PUBLIC_URL || 'https://brew.joinsquareup.com';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    /* a reset keeps a copy in _deleted/ on staging; production's clean gate refuses _deleted/ rows, and backups cover it there */
    const archive = mode === 'reset' && !a.noArchive && !prod ? `_deleted/brand-${a.slug}-${stamp}` : null;
    if (mode === 'reset' && prod && !a.noArchive) log.log('production: no _deleted/ copy (the clean gate refuses one); the database backups hold the brand');
    await run({ mode, ...a, archive, retireOn: process.env.RETIRE_OFF !== '1', waitMs: process.env.RESET_WAIT_MS ? +process.env.RESET_WAIT_MS : undefined, settleMs: process.env.WIPE_SETTLE_MS ? +process.env.WIPE_SETTLE_MS : undefined },
      { q, tx, bucket, log, poke: async () => { for (const p of ['/api/config', '/']) await fetch(URL0 + p).catch(() => {}); } });
  } catch (e) { log.error(`${e.refused ? 'REFUSED' : 'FAILED'}: ${e.message}`); code = e.refused ? 2 : 1; }
  await close().catch(() => {});
  return code;
}
