// One paid make per board, across every web instance. The board's busy mark (jam.running) reaches other instances only with
// the next doc sync (~1.5s), so two presses on two instances inside that gap could both pay (26 Oct). A make first claims
// its keys here, all or none, in one Postgres transaction (INSERT … ON CONFLICT: a key whose claim hasn't run out stays the
// holder's); the loser gets the board's busy answer. Without Postgres (tests, AI_MOCK) the claims live in this process.
import crypto from 'node:crypto';
import { enabled, tx, q } from '../db/index.js';
import { ME as INSTANCE } from '../instance.js';

export const BOARD_MS = 3 * 60e3; /* a board's claim, renewed while its make runs; a crashed instance's claim runs out on its own */
export const PRESS_MS = 15 * 60e3; /* a press's key: the same press sent again (a retry, a second tab replaying it) never makes twice */
const mem = new Map(); // key → { by, until }
let swept = 0;

/* keys: [{ key, ms }]; resolves to a claim ({ release() }) or null when any key is held by another make */
export async function claimMake(keys, { pg = enabled() } = {}) {
  keys = [...new Map(keys.filter((k) => k?.key).map((k) => [String(k.key).slice(0, 300), k])).values()].sort((a, c) => (a.key < c.key ? -1 : 1)); /* one order everywhere: no deadlock */
  if (!keys.length) return { release: async () => {} };
  const by = `${INSTANCE}:${crypto.randomUUID().slice(0, 8)}`;
  if (pg) {
    const won = await tx(async (c) => { const r = await c.query(`INSERT INTO make_claims (key, by, until) SELECT k, $2, now() + make_interval(secs => s / 1000.0) FROM unnest($1::text[], $3::int[]) AS x(k, s)
      ON CONFLICT (key) DO UPDATE SET by = EXCLUDED.by, until = EXCLUDED.until WHERE make_claims.until < now() RETURNING key`, [keys.map((k) => k.key), by, keys.map((k) => k.ms)]);
      if (r.rowCount !== keys.length) throw Object.assign(new Error('claimed'), { lost: true }); return true; }).catch((e) => { if (e.lost) return false; throw e; });
    if (!won) return null;
    if (Date.now() - swept > 3600e3) { swept = Date.now(); q("DELETE FROM make_claims WHERE until < now() - interval '1 day'").catch(() => {}); }
  } else {
    const now = Date.now(); if (keys.some((k) => (mem.get(k.key)?.until || 0) > now)) return null;
    for (const k of keys) mem.set(k.key, { by, until: now + k.ms });
  }
  /* the board keys are held while the make runs (renewed), and let go when it ends; a press key just runs out */
  const held = keys.filter((k) => k.hold).map((k) => k.key);
  const renew = held.length ? setInterval(() => { if (pg) q('UPDATE make_claims SET until = now() + make_interval(secs => $3) WHERE key = ANY($1) AND by = $2', [held, by, BOARD_MS / 1000]).catch(() => {});
    else for (const k of held) { const m = mem.get(k); if (m?.by === by) m.until = Date.now() + BOARD_MS; } }, BOARD_MS / 3) : null;
  renew?.unref?.();
  let done = false;
  return { by, release: async () => { if (done) return; done = true; clearInterval(renew); if (!held.length) return;
    if (pg) await q('DELETE FROM make_claims WHERE key = ANY($1) AND by = $2', [held, by]).catch(() => {});
    else for (const k of held) if (mem.get(k)?.by === by) mem.delete(k); } };
}
/* what a make claims: its board (or the jam's new boards when it names none), and the press that sent it */
export const makeKeys = (slug, jid, bid, press) => [{ key: `board:${slug}:${jid}:${bid || '-'}`, ms: BOARD_MS, hold: true }, ...(press ? [{ key: `press:${slug}:${String(press).slice(0, 80)}`, ms: PRESS_MS }] : [])];
export const _resetMakeClaims = () => mem.clear(); /* tests */
