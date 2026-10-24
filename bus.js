// What one instance tells the others (Postgres): a message is a row, NOTIFY wakes every instance, each reads it and hands it
// to its handlers; the instance that sent it never hears its own. Messages stay a day. Off without Postgres.
import os from 'node:os';
import { enabled as pgOn, q, listen } from './db/index.js';

const ME = `${process.env.K_REVISION || os.hostname()}:${process.pid}`;
export function createBus({ pg = pgOn(), log = console } = {}) {
  if (!pg) return null;
  const subs = new Map(); let started = null;
  const start = () => (started ||= listen('bus', async (id) => {
    const r = (await q('SELECT topic, payload, by FROM bus WHERE id = $1', [+id]).catch(() => ({ rows: [] }))).rows[0];
    if (!r || r.by === ME) return;
    for (const fn of subs.get(r.topic) || []) { try { await fn(r.payload); } catch (e) { log.warn?.(`[bus] ${r.topic}`, e.message); } }
  }));
  const publish = (topic, payload) => q('INSERT INTO bus (topic, payload, by) VALUES ($1, $2, $3)', [topic, JSON.stringify(payload ?? null), ME]).catch((e) => log.warn?.('[bus] publish', topic, e.message));
  const on = (topic, fn) => { if (!subs.has(topic)) subs.set(topic, new Set()); subs.get(topic).add(fn); start().catch((e) => log.warn?.('[bus] listen', e.message)); };
  const purge = () => q(`DELETE FROM bus WHERE at < now() - interval '1 day'`).catch(() => {});
  return { publish, on, purge, me: ME };
}
