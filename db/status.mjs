// Read-only health of a Postgres-backed Brew (run as the brew-ops job: --args=db/status.mjs): every protected brand's
// connections (state, last read, stale/reconnect flags, vault files), and how much the tables hold. Prints no secrets.
import { q, close } from './index.js';
import { PROTECTED } from '../connectors/index.js';

for (const slug of PROTECTED()) {
  const c = (await q('SELECT body FROM objects WHERE key = $1', [`brands/${slug}/private/connections.json`])).rows[0];
  const conns = c ? JSON.parse(c.body.toString('utf8')) : {};
  for (const [id, v] of Object.entries(conns)) console.log(`[status] ${slug} ${id}: ${v.state}, last read ${v.lastSync ? new Date(v.lastSync).toISOString() : 'never'}${v.stale ? ', STALE' : ''}${v.needsReconnect ? ', NEEDS RECONNECT' : ''}${v.error ? `, error: ${String(v.error).slice(0, 80)}` : ''}`);
  const vault = (await q(`SELECT key, (length(body) > 20) AS has FROM objects WHERE key LIKE $1`, [`brands/${slug}/private/vault/%`])).rows;
  console.log(`[status] ${slug} vault: ${vault.map((r) => `${r.key.split('/').pop()}${r.has ? '' : ' (empty)'}`).join(', ') || 'none'}`);
}
for (const t of ['objects', 'doc_parts', 'jobs', 'counters', 'build_events', 'sessions', 'access_log', 'bus', 'jam_presence']) {
  const r = (await q(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]; console.log(`[status] ${t}: ${r.n} rows`);
}
const j = (await q(`SELECT state, count(*)::int AS n FROM jobs GROUP BY state`)).rows; console.log(`[status] jobs by state: ${j.map((r) => `${r.state} ${r.n}`).join(', ') || 'none'}`);
await close();
