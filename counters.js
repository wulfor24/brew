// The day's counters every instance shares (Postgres `counters`, one row per UTC day, scope and key): AI calls by kind and
// brand, treg dollars, build dollars. add() is instant and batched (written within a second); total() is this instance's
// latest view (everyone's writes, pulled every two seconds, plus its own not yet written), so a cap check stays a plain
// synchronous call. Two instances can overshoot a cap by what they spend inside that window, never more; take() is the
// strict, atomic check for the rare spend that must never pass its cap.
import { enabled as pgOn, q } from './db/index.js';

const dayOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export function createCounters({ pg = pgOn(), flushMs = 1000, pullMs = 2000, log = console, now = () => Date.now() } = {}) {
  let day = dayOf(now()), seen = new Map(), mine = new Map(), flushT = null, pullT = null;
  const k = (scope, key) => `${scope}\u0001${key}`;
  const roll = () => { const d = dayOf(now()); if (d !== day) { const old = mine, oldDay = day; day = d; seen = new Map(); mine = new Map(); if (old.size) write(oldDay, [...old.entries()]).catch((e) => log.warn?.('[counters] last of the day', e.message)); } }; /* yesterday's last unwritten counts still land on yesterday */
  function add(scope, key, n = 1) {
    if (!pg || !n) return; roll();
    mine.set(k(scope, key), (mine.get(k(scope, key)) || 0) + n);
    if (!flushT) { flushT = setTimeout(() => { flushT = null; flush().catch((e) => log.warn?.('[counters] flush', e.message)); }, flushMs); flushT.unref?.(); }
  }
  const write = (d, rows) => q(`INSERT INTO counters (day, scope, key, n) SELECT $1::date, s, k, n FROM unnest($2::text[], $3::text[], $4::float8[]) AS x(s, k, n)
    ON CONFLICT (day, scope, key) DO UPDATE SET n = counters.n + EXCLUDED.n`, [d, rows.map(([x]) => x.split('\u0001')[0]), rows.map(([x]) => x.split('\u0001')[1]), rows.map(([, n]) => n)]);
  async function flush() {
    if (!mine.size) return; const d = day, rows = [...mine.entries()]; mine = new Map();
    try { await write(d, rows); if (d === day) for (const [x, n] of rows) seen.set(x, (seen.get(x) || 0) + n); /* until the next pull */ }
    catch (e) { if (d === day) for (const [x, n] of rows) mine.set(x, (mine.get(x) || 0) + n); throw e; } /* kept: the next flush tries again */
  }
  async function pull() { roll(); const r = await q('SELECT scope, key, n FROM counters WHERE day = $1', [day]); const m = new Map(); for (const x of r.rows) m.set(k(x.scope, x.key), +x.n); seen = m; }
  const total = (scope, key) => { roll(); return (seen.get(k(scope, key)) || 0) + (mine.get(k(scope, key)) || 0); };
  /* n more if that keeps the counter at or under cap: true when taken (atomic across instances) */
  async function take(scope, key, n, cap) {
    if (!pg) return true; roll();
    const r = await q(`INSERT INTO counters (day, scope, key, n) VALUES ($1, $2, $3, $4) ON CONFLICT (day, scope, key) DO UPDATE SET n = counters.n + EXCLUDED.n
      WHERE counters.n + EXCLUDED.n <= $5 RETURNING n`, [day, scope, key, n, cap]);
    if (r.rows[0] && +r.rows[0].n <= cap) { seen.set(k(scope, key), +r.rows[0].n); return true; }
    if (r.rows[0]) { await q('UPDATE counters SET n = n - $4 WHERE day = $1 AND scope = $2 AND key = $3', [day, scope, key, n]); } /* a first insert over the cap */
    return false;
  }
  async function start() { if (!pg) return; await pull().catch((e) => log.warn?.('[counters] pull', e.message)); pullT = setInterval(() => pull().catch(() => {}), pullMs); pullT.unref?.(); }
  const stop = async () => { clearInterval(pullT); clearTimeout(flushT); flushT = null; await flush().catch(() => {}); };
  return { add, total, take, flush, pull, start, stop, on: pg };
}
