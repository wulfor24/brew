// Postgres for Brew (STORAGE=pg): one pool per process for queries, and one dedicated connection that LISTENs, because
// a listener must keep its own session (a pooled connection forgets LISTEN when it goes back to the pool).
// DATABASE_URL, or the PG* variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE). PG_POOL_MAX sizes the pool per instance:
// web 5, worker 10 (keep instances × pool under the server's max_connections).
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
/* time spent in the database by the request in hand (server.js Server-Timing) */
export const dbClock = new AsyncLocalStorage();

let pool = null, listener = null, closing = false, connecting = null, everConnected = false;
const handlers = new Map(); // channel → Set(fn)
const conf = () => ({ ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  max: +process.env.PG_POOL_MAX || 5, idleTimeoutMillis: 30e3, allowExitOnIdle: true, connectionTimeoutMillis: 10e3,
  statement_timeout: +process.env.PG_STATEMENT_MS || 30e3, application_name: `brew-${process.env.ROLE || 'all'}` });

export const enabled = () => process.env.STORAGE === 'pg';
export const clientConf = conf; /* a connection of its own (the background lease) */
export function db() {
  if (!pool) { pool = new pg.Pool(conf()); pool.on('error', (e) => console.warn('[db] idle client', e.message)); }
  return pool;
}
export const q = async (text, params) => { const c = dbClock.getStore(); if (!c) return db().query(text, params); const t = performance.now(); try { return await db().query(text, params); } finally { c.ms += performance.now() - t; c.n++; } };
/* fn(client) inside BEGIN … COMMIT; any throw rolls back */
export async function tx(fn) {
  const c = await db().connect();
  try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

/* LISTEN on its own connection, reconnecting with backoff; every channel asked for is listened to again after a reconnect */
async function connectListener(tries = 0) {
  if (closing) return;
  const c = new pg.Client(conf());
  c.on('notification', (m) => { for (const fn of handlers.get(m.channel) || []) { try { fn(m.payload); } catch (e) { console.warn('[db] listener', m.channel, e.message); } } });
  let gone = false; const again = () => { if (gone) return; gone = true; if (listener === c) listener = null; if (!closing) setTimeout(() => connectListener(tries + 1), Math.min(30e3, 500 * 2 ** tries)).unref?.(); }; /* once per connection, however many ways it ends */
  c.on('error', (e) => { console.warn('[db] listen connection', e.message); c.end().catch(() => {}); });
  c.on('end', again);
  try { await c.connect(); listener = c; for (const ch of handlers.keys()) await c.query(`LISTEN "${ch}"`);
    /* back after a drop: notices sent meanwhile are gone, so every listener is told to catch up ('*') */
    if (everConnected) for (const set of handlers.values()) for (const fn of set) { try { fn('*'); } catch (e) { console.warn('[db] resync', e.message); } }
    everConnected = true; tries = 0; }
  catch (e) { console.warn('[db] listen connect', e.message); again(); }
}
export async function listen(channel, fn) {
  if (!/^[a-z_]+$/.test(channel)) throw new Error('bad channel');
  closing = false;
  const first = !handlers.has(channel); if (first) handlers.set(channel, new Set());
  handlers.get(channel).add(fn);
  if (!listener) { connecting ||= connectListener().finally(() => { connecting = null; }); await connecting; } /* one listen connection, however many ask at once */
  else if (first) await listener.query(`LISTEN "${channel}"`);
  return () => handlers.get(channel)?.delete(fn);
}
export async function close() { closing = true; const l = listener; listener = null; handlers.clear(); await l?.end().catch(() => {}); await pool?.end().catch(() => {}); pool = null; } /* stays closed until the next listen() or query */
