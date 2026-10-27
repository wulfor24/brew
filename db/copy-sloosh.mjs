// Brew's Sloosh connection moved from staging to production (27 Oct): production had never been connected, and a staff connect needs
// a person at a browser. The connection is one signed-in workspace: its client registration (brands/_brew/private/sloosh-client.json)
// and its tokens (brands/_brew/private/vault/sloosh.json, decrypted with staging's vault key and encrypted with production's). Run it
// once as the Cloud Run Job brew-partner-copy (inside the VPC, the same identity and secrets as tools/partner-copy.sh), then disconnect
// staging so only production ever refreshes the tokens. A dry run unless the word apply is given.
//   gcloud run jobs deploy brew-partner-copy … --command=node --args=db/copy-sloosh.mjs:apply
import pg from 'pg';
import { decryptWith, encryptWith } from '../vault.js';

const APPLY = process.argv.slice(2).includes('apply');
const need = (k) => { const v = process.env[k]; if (!v) { console.log(`[sloosh-copy] STOP: ${k} is not set`); process.exit(1); } return v; };
const SRC = need('SRC_DATABASE_URL'), DST = need('DATABASE_URL'), KEYS = { src: need('SRC_VAULT_KEY'), dst: need('FEED_VAULT_KEY') };
if (SRC === DST || KEYS.src === KEYS.dst) { console.log('[sloosh-copy] STOP: staging and production must differ'); process.exit(1); }
const VAULT = 'brands/_brew/private/vault/sloosh.json', CLIENT = 'brands/_brew/private/sloosh-client.json';
const src = new pg.Pool({ connectionString: SRC, max: 1, application_name: 'brew-sloosh-copy' }), dst = new pg.Pool({ connectionString: DST, max: 1, application_name: 'brew-sloosh-copy' });
try {
  const rows = (await src.query('SELECT key, body, content_type FROM objects WHERE key = ANY($1)', [[VAULT, CLIENT]])).rows;
  const v = rows.find((r) => r.key === VAULT), c = rows.find((r) => r.key === CLIENT);
  if (!v || !c) { console.log(`[sloosh-copy] STOP: staging has no Sloosh connection (${!v ? 'no tokens' : ''} ${!c ? 'no client' : ''})`); process.exit(1); }
  const vx = JSON.parse(v.body.toString('utf8')); if (!vx.c) { console.log('[sloosh-copy] STOP: staging is disconnected'); process.exit(1); }
  const plain = decryptWith(KEYS.src, vx.c), tok = JSON.parse(plain);
  console.log(`[sloosh-copy] staging: workspace ${tok.workspace?.name || tok.workspace?.id || '?'} · connected by ${tok.connectedBy || '?'} · refresh token ${tok.refresh ? 'yes' : 'NO'}`);
  if (!tok.refresh) { console.log('[sloosh-copy] STOP: no refresh token to move'); process.exit(1); }
  const cur = (await dst.query('SELECT key FROM objects WHERE key = ANY($1)', [[VAULT, CLIENT]])).rows.map((r) => r.key);
  console.log(`[sloosh-copy] production has: ${cur.join(', ') || 'nothing'}`);
  if (!APPLY) { console.log('[sloosh-copy] dry run: nothing written'); process.exit(0); }
  const body = Buffer.from(JSON.stringify({ c: encryptWith(KEYS.dst, plain), at: Date.now() }));
  for (const [key, b, type] of [[CLIENT, c.body, c.content_type], [VAULT, body, v.content_type]]) {
    await dst.query(`INSERT INTO objects (key, body, content_type, updated_at, src) VALUES ($1, $2, $3, now(), 'migrate')
      ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, updated_at = now(), version = nextval('objects_version')`, [key, b, type]); }
  const back = (await dst.query('SELECT body FROM objects WHERE key = $1', [VAULT])).rows[0];
  const ok = JSON.parse(decryptWith(KEYS.dst, JSON.parse(back.body.toString('utf8')).c)).refresh === tok.refresh;
  console.log(`[sloosh-copy] written to production; read back ${ok ? 'OK' : 'MISMATCH'}`); if (!ok) process.exit(1);
} finally { await src.end().catch(() => {}); await dst.end().catch(() => {}); }
