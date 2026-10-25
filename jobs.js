// Work any instance can ask for and exactly one worker does: a Postgres table claimed with FOR UPDATE SKIP LOCKED, leased
// while it runs (a heartbeat keeps the lease; a worker that dies lets it go and the job runs again), retried with backoff,
// at most one open job per key. Delivery is at least once, so every handler is safe to run twice (paid calls carry their
// own idempotency keys, as finals already do). Two queues: 'interactive' (someone clicked and waits) and 'batch', worked by
// separate loops so batch work never holds up a click.
// Without Postgres (demo, local, tests) a job runs at once in this process, as the code always did.
import { ME } from './instance.js'; // one id per process
import { enabled as pgOn, q, listen } from './db/index.js';
import { isWorker } from './roles.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createJobs({ log = console, leaseMs = 120e3, pollMs = 5e3, pg = pgOn(), worker = isWorker() } = {}) {
  const handlers = new Map(); // name → { fn, queue, maxTries }
  const waiters = new Map(); // job id → Set(resolve): several callers may wait on one keyed job
  let running = 0, stopped = false;
  const define = (name, fn, { queue = 'batch', maxTries = 3 } = {}) => { handlers.set(name, { fn, queue, maxTries }); };

  /* ask for a job; { key } makes it the one open job for that key (asking again while it is open returns the same job) */
  async function enqueue(name, data = {}, { key = null, queue, delayMs = 0, maxTries } = {}) {
    const h = handlers.get(name);
    if (!pg) { if (!h) throw new Error(`no job ${name}`); const p = Promise.resolve().then(() => h.fn(data)); p.catch((e) => log.warn?.(`[jobs] ${name}`, e.message)); return { id: null, local: p }; }
    const qn = queue || h?.queue || 'batch';
    const r = await q(`INSERT INTO jobs (name, queue, data, key, max_tries, run_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
      ON CONFLICT (key) WHERE key IS NOT NULL AND state IN ('queued', 'running') DO NOTHING RETURNING id`, [name, qn, JSON.stringify(data), key, maxTries || h?.maxTries || 3, delayMs / 1e3]);
    if (r.rows[0]) return { id: +r.rows[0].id };
    const open = await q(`SELECT id FROM jobs WHERE key = $1 AND state IN ('queued', 'running') LIMIT 1`, [key]);
    return { id: open.rows[0] ? +open.rows[0].id : null, joined: true };
  }
  /* ask and wait for the answer (a web instance asking the worker): resolves with the handler's result, throws its error */
  async function call(name, data = {}, { key = null, timeoutMs = 60e3, queue = 'interactive', maxTries } = {}) {
    const j = await enqueue(name, data, { key, queue, maxTries });
    if (j.local) return j.local;
    if (!j.id) throw new Error(`${name}: not queued`);
    return wait(j.id, timeoutMs);
  }
  async function wait(id, timeoutMs = 60e3) {
    let mine; const done = new Promise((resolve) => { mine = resolve; if (!waiters.has(id)) waiters.set(id, new Set()); waiters.get(id).add(resolve); });
    const check = async () => { const r = (await q('SELECT state, result, error FROM jobs WHERE id = $1', [id])).rows[0]; if (r && (r.state === 'done' || r.state === 'failed')) mine(r); };
    await check(); /* it may have finished before we listened */
    const poll = setInterval(() => check().catch(() => {}), 2000); poll.unref?.();
    try {
      const r = await Promise.race([done, sleep(timeoutMs).then(() => null)]);
      if (!r) throw Object.assign(new Error('That is taking longer than it should. It carries on in the background.'), { timeout: true, jobId: id });
      if (r.state === 'failed') throw Object.assign(new Error(r.error || 'job failed'), { jobId: id });
      return r.result?.v;
    } finally { clearInterval(poll); const w = waiters.get(id); w?.delete(mine); if (!w?.size) waiters.delete(id); }
  }

  /* ---------- the worker side ---------- */
  async function claim(queues) {
    const r = await q(`UPDATE jobs SET state = 'running', tries = tries + 1, locked_until = now() + make_interval(secs => $2), locked_by = $3
      WHERE id = (SELECT id FROM jobs WHERE state = 'queued' AND run_at <= now() AND queue = ANY($1) AND name = ANY($4)
                  ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, name, data, tries, max_tries`, [queues, leaseMs / 1e3, ME, [...handlers.keys()]]);
    return r.rows[0] || null;
  }
  async function runOne(job) {
    const h = handlers.get(job.name); running++;
    const beat = setInterval(() => q(`UPDATE jobs SET locked_until = now() + make_interval(secs => $2) WHERE id = $1 AND locked_by = $3`, [job.id, leaseMs / 1e3, ME]).catch(() => {}), leaseMs / 3); beat.unref?.();
    try {
      const v = await h.fn(job.data || {}, { id: +job.id, tries: job.tries }), res = JSON.stringify({ v: v === undefined ? null : v });
      /* the work is done: the result is written however many tries it takes, so a database blip never runs the job again */
      for (let i = 0; ; i++) { try { await q(`UPDATE jobs SET state = 'done', result = $2, done_at = now(), locked_until = NULL WHERE id = $1 AND locked_by = $3`, [job.id, res, ME]); break; }
        catch (e) { if (i >= 5) throw Object.assign(e, { afterDone: true }); await sleep(500 * 2 ** i); } }
    } catch (e) {
      if (e.afterDone) { log.warn?.(`[jobs] ${job.name} #${job.id} done but its result could not be saved: ${e.message}`); return; }
      const last = job.tries >= job.max_tries;
      log.warn?.(`[jobs] ${job.name} #${job.id} try ${job.tries}/${job.max_tries}: ${e.message}`);
      /* only a run this worker still holds: a lease that ran out meanwhile (a database failover) was handed on, and that run is not reset */
      await q(last ? `UPDATE jobs SET state = 'failed', error = $2, done_at = now(), locked_until = NULL WHERE id = $1 AND locked_by = $3 AND state = 'running'`
        : `UPDATE jobs SET state = 'queued', error = $2, locked_until = NULL, run_at = now() + make_interval(secs => $4) WHERE id = $1 AND locked_by = $3 AND state = 'running'`,
        last ? [job.id, String(e.message).slice(0, 2000), ME] : [job.id, String(e.message).slice(0, 2000), ME, Math.min(3600, 15 * 2 ** job.tries)]).catch(() => {});
    } finally { clearInterval(beat); running--; }
  }
  /* a lease that ran out (its worker died): the job goes back in the queue, or fails once it has had its tries */
  const reap = () => q(`UPDATE jobs SET state = CASE WHEN tries >= max_tries THEN 'failed' ELSE 'queued' END,
      error = COALESCE(error, 'the worker running it stopped'), done_at = CASE WHEN tries >= max_tries THEN now() END, locked_until = NULL
      WHERE state = 'running' AND locked_until < now()`).catch((e) => log.warn?.('[jobs] reap', e.message));
  const purge = () => q(`DELETE FROM jobs WHERE state IN ('done', 'failed') AND done_at < now() - interval '7 days'`).catch(() => {});
  async function loop(queues, concurrency) {
    let wake = null; const nudge = () => wake?.();
    await listen('jobs_ready', (qn) => { if (queues.includes(qn)) nudge(); });
    while (!stopped) {
      if (running < concurrency) {
        const job = await claim(queues).catch((e) => { log.warn?.('[jobs] claim', e.message); return null; });
        if (job) { runOne(job); continue; }
      }
      await new Promise((r) => { wake = r; setTimeout(r, pollMs).unref?.(); }); wake = null;
    }
  }
  async function start({ interactive = 4, batch = 4, slow = 2 } = {}) {
    if (!pg) return;
    await listen('jobs_done', (id) => { const w = waiters.get(+id); if (w?.size) q('SELECT state, result, error FROM jobs WHERE id = $1', [+id]).then((r) => { if (r.rows[0]) for (const f of [...w]) f(r.rows[0]); }).catch(() => {}); });
    if (!worker) return;
    const r = setInterval(reap, 30e3), p = setInterval(purge, 3600e3); r.unref?.(); p.unref?.(); reap();
    const keep = (qs, n) => loop(qs, n).catch((e) => { log.warn?.('[jobs] loop', qs[0], e.message); if (!stopped) setTimeout(() => keep(qs, n), 5000).unref?.(); }); /* a loop that fails starts again */
    keep(['interactive'], interactive); keep(['batch'], batch); keep(['slow'], slow); /* slow: clicks that wait on long work (a PDF, statics, a data check), so they never hold every interactive slot */
    log.log?.(`[jobs] worker ${ME} on interactive (${interactive}) and batch (${batch})`);
  }
  const stop = () => { stopped = true; };
  const busy = () => running;
  /* jobs waiting longer than they should: for the alert on queue age */
  const age = async () => (pg ? (await q(`SELECT queue, count(*)::int AS n, EXTRACT(EPOCH FROM now() - min(run_at))::int AS oldest_s FROM jobs WHERE state = 'queued' AND run_at <= now() GROUP BY queue`)).rows : []);
  return { define, enqueue, call, wait, start, stop, busy, age, me: ME };
}
