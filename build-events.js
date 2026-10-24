// A build's progress lines on Postgres (build_events), so the page on any instance can follow a build the worker runs:
// the worker writes each line as it emits it, every other instance hears it (NOTIFY) and hands it to its own listeners,
// and an instance that joins late reads the lines so far. Kept 3 days. Off without Postgres (one instance, in memory).
import { ME } from './instance.js'; // one id per process
import { enabled as pgOn, q, listen } from './db/index.js';

export function createBuildEvents({ pg = pgOn(), log = console } = {}) {
  if (!pg) return null;
  let chain = Promise.resolve();
  /* written in order, one after another (the order is the build's story) */
  const persist = (slug, e) => { chain = chain.then(() => q('INSERT INTO build_events (slug, ev) VALUES ($1, $2)', [slug, JSON.stringify({ ...e, _by: ME })])).catch((err) => log.warn?.('[build-events] save', err.message)); return chain; };
  /* fn(slug, ev) for every line another instance wrote */
  /* one at a time, in the order the notices came, each with its row id */
  let inbox = Promise.resolve();
  const onRemote = (fn) => listen('build_events', (payload) => { inbox = inbox.then(async () => {
    const [slug, id] = String(payload).split(' '); if (!id || !Number.isFinite(+id)) return;
    const r = (await q('SELECT ev FROM build_events WHERE id = $1', [+id]).catch(() => ({ rows: [] }))).rows[0];
    if (!r || r.ev._by === ME) return; const { _by, ...ev } = r.ev; fn(slug, { ...ev, _id: +id });
  }).catch(() => {}); });
  /* the lines so far for a brand's latest run (the last 2000) */
  const history = async (slug) => (await q('SELECT id, ev FROM (SELECT id, ev FROM build_events WHERE slug = $1 ORDER BY id DESC LIMIT 2000) x ORDER BY id', [slug])).rows.map(({ id, ev }) => { const { _by, ...e } = ev; return { ...e, _id: +id }; });
  const clear = (slug) => q('DELETE FROM build_events WHERE slug = $1', [slug]).catch(() => {});
  /* a fresh read: the old lines go and a '_reset' line tells every instance, in the same order as the lines that follow */
  const reset = (slug) => { chain = chain.then(async () => { await q('DELETE FROM build_events WHERE slug = $1', [slug]); await q('INSERT INTO build_events (slug, ev) VALUES ($1, $2)', [slug, JSON.stringify({ k: '_reset', at: Date.now(), _by: ME })]); }).catch((err) => log.warn?.('[build-events] reset', err.message)); return chain; };
  const purge = () => q(`DELETE FROM build_events WHERE at < now() - interval '3 days'`).catch(() => {});
  return { persist, onRemote, history, clear, reset, purge };
}
