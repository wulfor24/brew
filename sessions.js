// Sign-ins that can be ended (Postgres): every Google sign-in gets a session row whose id rides in the signed fs_s cookie.
// Signing out ends that session for real (a copied cookie stops working), and "sign out everywhere" ends every session of an
// email. The check stays synchronous: each instance keeps the ended sessions in memory, refreshed every 30 s and the moment
// any instance ends one (NOTIFY). Without Postgres, sessions are the signed cookie alone, as before.
import crypto from 'node:crypto';
import { enabled as pgOn, q, listen } from './db/index.js';

export function createSessions({ pg = pgOn(), log = console, everyMs = 30e3 } = {}) {
  let ended = new Set(), before = new Map(), timer = null;
  const load = async () => {
    const [a, b] = await Promise.all([q(`SELECT sid FROM sessions WHERE revoked_at IS NOT NULL AND expires_at > now()`), q('SELECT email, before FROM session_revocations')]);
    ended = new Set(a.rows.map((r) => r.sid)); before = new Map(b.rows.map((r) => [r.email, r.before.getTime()]));
  };
  async function start() { if (!pg) return; await load().catch((e) => log.warn?.('[sessions] load', e.message)); timer = setInterval(() => load().catch(() => {}), everyMs); timer.unref?.();
    await listen('sessions_revoked', () => load().catch(() => {})).catch((e) => log.warn?.('[sessions] listen', e.message)); }
  /* a new session for a sign-in: { sid, iat } to put in the cookie */
  function open(email, { ttlSec, ua = null, ip = null } = {}) {
    const sid = crypto.randomBytes(18).toString('base64url'), iat = Date.now();
    if (pg) q('INSERT INTO sessions (sid, email, expires_at, ua, ip) VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)', [sid, String(email).toLowerCase(), ttlSec, String(ua || '').slice(0, 300), ip]).catch((e) => log.warn?.('[sessions] open', e.message));
    return { sid, iat };
  }
  /* is this signed session still good? (its signature and expiry are checked by the caller) */
  const live = (s) => { if (!pg || !s) return true; if (s.sid && ended.has(s.sid)) return false; const b = before.get(String(s.email || '').toLowerCase()); return !(b && (+s.iat || 0) < b); };
  async function end(sid) { if (!pg || !sid) return; ended.add(sid); await q('UPDATE sessions SET revoked_at = now() WHERE sid = $1 AND revoked_at IS NULL', [sid]).catch((e) => log.warn?.('[sessions] end', e.message)); }
  async function endAll(email) { if (!pg) return 0; const e = String(email).toLowerCase(); before.set(e, Date.now());
    await q(`INSERT INTO session_revocations (email, before) VALUES ($1, now()) ON CONFLICT (email) DO UPDATE SET before = now()`, [e]);
    return (await q('UPDATE sessions SET revoked_at = now() WHERE email = $1 AND revoked_at IS NULL', [e])).rowCount; }
  const list = async (email) => (pg ? (await q('SELECT sid, created_at, expires_at, revoked_at, ua FROM sessions WHERE email = $1 ORDER BY created_at DESC LIMIT 50', [String(email).toLowerCase()])).rows : []);
  const stop = () => clearInterval(timer);
  return { start, open, live, end, endAll, list, stop, on: pg };
}
