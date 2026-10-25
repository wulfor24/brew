// Read-only health of a Postgres-backed Brew (run as the brew-ops job: --args=db/status.mjs): every protected brand's
// connections (state, last read, stale/reconnect flags, vault files), and how much the tables hold. Prints no secrets.
import { q, close } from './index.js';
import { PROTECTED } from '../connectors/protected.js';

for (const slug of PROTECTED()) {
  const c = (await q('SELECT body FROM objects WHERE key = $1', [`brands/${slug}/private/connections.json`])).rows[0];
  if (!c) { console.log(`[status] ${slug}: connections NOT FOUND in the database (not imported, or a read failed)`); continue; } /* never "none" */
  let conns = {}; try { conns = JSON.parse(c.body.toString('utf8') || '{}'); } catch (e) { console.log(`[status] ${slug}: connections unreadable (${e.message})`); continue; }
  if (!Object.keys(conns).length) console.log(`[status] ${slug}: no connections saved`);
  for (const [id, v] of Object.entries(conns)) console.log(`[status] ${slug} ${id}: ${v.state}, last read ${v.lastSync ? new Date(v.lastSync).toISOString() : 'never'}${v.stale ? ', STALE' : ''}${v.needsReconnect ? ', NEEDS RECONNECT' : ''}${v.error ? `, error: ${String(v.error).slice(0, 80)}` : ''}`);
  const vault = (await q(`SELECT key, body FROM objects WHERE key LIKE $1`, [`brands/${slug}/private/vault/%`])).rows;
  const has = (b) => { try { return !!JSON.parse(b.toString('utf8') || '{}').c; } catch { return false; } }; /* a dropped sign-in is { c: null } */
  console.log(`[status] ${slug} vault: ${vault.map((r) => `${r.key.split('/').pop()}${has(r.body) ? '' : ' (empty)'}`).join(', ') || 'none saved'}`);
}
for (const t of ['objects', 'doc_parts', 'jobs', 'counters', 'build_events', 'sessions', 'access_log', 'bus', 'jam_presence']) {
  const r = (await q(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]; console.log(`[status] ${t}: ${r.n} rows`);
}
const j = (await q(`SELECT state, count(*)::int AS n FROM jobs GROUP BY state`)).rows; console.log(`[status] jobs by state: ${j.map((r) => `${r.state} ${r.n}`).join(', ') || 'none'}`);
/* --recent: what was written in the last 15 minutes (key, how often), to see what keeps a pack changing */
if (process.argv.includes('--recent')) {
  const r = (await q(`SELECT key, count(*) OVER (PARTITION BY regexp_replace(key, '^(brands/[^/]+/)?.*$', '\\1')) AS n, to_char(updated_at, 'HH24:MI:SS') AS at, version FROM objects WHERE updated_at > now() - interval '15 minutes' ORDER BY updated_at DESC LIMIT 80`)).rows;
  for (const x of r) console.log(`[status] recent ${x.at} v${x.version} ${x.key}`);
  const act = (await q(`SELECT state, wait_event_type, wait_event, count(*)::int AS n, max(EXTRACT(EPOCH FROM now() - query_start))::int AS longest_s FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1, 2, 3 ORDER BY n DESC`)).rows;
  for (const x of act) console.log(`[status] connections ${x.state || '-'} ${x.wait_event_type || ''}/${x.wait_event || ''}: ${x.n} (longest ${x.longest_s ?? 0} s)`);
}
await close();
