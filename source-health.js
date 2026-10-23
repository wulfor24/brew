// How well each outside source works, measured on Brew's own calls: every treg and Apify call records ok, empty or error with
// its time and cost, per endpoint per day. The router (treg-map.js runCap, shelf.js) puts the healthiest source first and skips
// one that has failed most of its last week (it still gets one try a day, so a source that recovers comes back by itself).
// Kept in memory and flushed to _brew/ops/sources-<YYYY-MM>.json; GET /api/admin/sources shows the table.
const DAY = 864e5;
const days = new Map(); /* `${day}|${id}` → { day, id, provider, ok, empty, err, ms, usd, lastErr } */
let loaded = false, store = null, dirty = false, timer = null;
const tried = new Map(); /* id → last day a skipped source was given its daily try */

export function recordCall(id, provider, { ok = true, empty = false, ms = 0, usd = 0, error = null, at = Date.now() } = {}) {
  if (!id) return; const day = new Date(at).toISOString().slice(0, 10), k = `${day}|${id}`;
  const r = days.get(k) || { day, id, provider, ok: 0, empty: 0, err: 0, ms: 0, usd: 0, lastErr: null };
  if (error) { r.err++; r.lastErr = String(error).slice(0, 160); } else if (empty) r.empty++; else r.ok++;
  r.ms += ms || 0; r.usd = +(r.usd + (usd || 0)).toFixed(6); days.set(k, r); dirty = true;
  if (store && !timer) { timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, 10e3); timer.unref?.(); }
}
/* the last n days for one endpoint: calls, success share (empty answers count as answered), median-ish time */
export function healthOf(id, { n = 7, now = Date.now() } = {}) {
  const since = new Date(now - n * DAY).toISOString().slice(0, 10); let ok = 0, empty = 0, err = 0, ms = 0, usd = 0, lastErr = null;
  for (const r of days.values()) if (r.id === id && r.day >= since) { ok += r.ok; empty += r.empty; err += r.err; ms += r.ms; usd += r.usd; lastErr = r.lastErr || lastErr; }
  const calls = ok + empty + err; return { id, calls, ok, empty, err, rate: calls ? +((ok + empty) / calls).toFixed(3) : null, avgMs: calls ? Math.round(ms / calls) : null, usd: +usd.toFixed(4), lastErr };
}
/* a source is skipped when it failed most of its recent calls (at least 5 of them), except for one try a day */
export function unhealthy(id, { min = 5, floor = 0.8, now = Date.now() } = {}) {
  const h = healthOf(id, { now }); if (h.calls < min || h.rate >= floor) return false;
  const today = new Date(now).toISOString().slice(0, 10); if (tried.get(id) !== today) { tried.set(id, today); return false; }
  return true;
}
/* healthiest first: known-good sources by success, then untried ones in their declared order, unhealthy ones last */
export function byHealth(ids) {
  return [...ids].map((id, i) => ({ id, i, h: healthOf(id) })).sort((a, b) => {
    const s = (x) => (x.h.calls < 3 ? 0.9 : x.h.rate); return s(b) - s(a) || a.i - b.i; }).map((x) => x.id);
}
export function sourceTable({ n = 7 } = {}) {
  const ids = [...new Set([...days.values()].map((r) => r.id))];
  return ids.map((id) => ({ ...healthOf(id, { n }), provider: [...days.values()].find((r) => r.id === id)?.provider })).sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1) || b.calls - a.calls);
}

/* persistence: one file a month in the _brew pack */
const fileOf = (d) => `ops/sources-${d.slice(0, 7)}.json`;
export async function attachHealthStore(packs, { now = Date.now() } = {}) {
  store = packs; if (loaded) return; loaded = true;
  const months = [new Date(now).toISOString(), new Date(now - 10 * DAY).toISOString()].map((d) => fileOf(d));
  for (const f of [...new Set(months)]) { const j = await packs.getJSON('_brew', f, null).catch(() => null); for (const r of j?.rows || []) { const k = `${r.day}|${r.id}`; if (!days.has(k)) days.set(k, r); } }
}
export async function flush() {
  if (!store || !dirty) return; dirty = false; const byMonth = new Map();
  for (const r of days.values()) { const f = fileOf(r.day); if (!byMonth.has(f)) byMonth.set(f, []); byMonth.get(f).push(r); }
  for (const [f, rows] of byMonth) await store.put('_brew', f, { at: new Date().toISOString(), rows }).catch(() => { dirty = true; });
}
export const _reset = () => { days.clear(); tried.clear(); loaded = false; store = null; dirty = false; };
