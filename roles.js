// Who does what in this process. ROLE=web serves pages and the API; ROLE=worker does the background work; both (the default:
// local, staging) do both, as one instance always did. On Postgres, one worker at a time holds the background lease, a
// session advisory lock on a connection of its own that Postgres frees the moment that connection dies. Only the lease
// holder runs ticks, resumes builds and pays for watchers, so two instances (a deploy's overlap, a second worker) never
// do the same paid work twice. Without Postgres there is one instance and it is always the leader.
import pg from 'pg';
import { enabled as pgOn, clientConf } from './db/index.js';

const ROLES = new Set(String(process.env.ROLE || 'web,worker').split(',').map((s) => s.trim()).filter(Boolean));
export const isWeb = () => ROLES.has('web');
export const isWorker = () => ROLES.has('worker');
let leader = !pgOn() && isWorker();
export const isLeader = () => leader;
const waiting = [];
/* fn runs once this process holds the lease (at once when it already does) */
export const whenLeader = (fn) => { if (leader) { try { fn(); } catch (e) { console.warn('[roles] leader start', e.message); } } else waiting.push(fn); };

const LEASE_KEY = 727275;
export async function startLease({ everyMs = 10e3, log = console, exit = (c) => process.exit(c) } = {}) {
  if (!pgOn() || !isWorker() || leader) return;
  const tryOnce = async () => {
    const c = new pg.Client({ ...clientConf(), application_name: 'brew-lease' });
    try {
      await c.connect();
      const got = (await c.query('SELECT pg_try_advisory_lock($1) AS ok', [LEASE_KEY])).rows[0].ok;
      if (!got) { await c.end(); return false; }
      /* the lease is this connection: if it drops, another worker may already be leading, so this one stops at once and
         Cloud Run starts it again (in-flight work resumes on the new leader from what was saved) */
      const lost = (why) => { if (!leader) return; leader = false; log.warn(`[roles] background lease lost (${why}): restarting`); exit(1); };
      c.on('error', (e) => lost(e.message)); c.on('end', () => lost('connection closed'));
      const ping = setInterval(() => c.query('SELECT 1').catch((e) => lost(e.message)), 15e3); ping.unref?.();
      leader = true; log.log('[roles] this worker holds the background lease');
      for (const fn of waiting.splice(0)) { try { fn(); } catch (e) { log.warn('[roles] leader start', e.message); } }
      return true;
    } catch (e) { log.warn('[roles] lease', e.message); await c.end().catch(() => {}); return false; }
  };
  if (await tryOnce()) return;
  const t = setInterval(async () => { if (leader) return clearInterval(t); if (await tryOnce()) clearInterval(t); }, everyMs); t.unref?.();
}
/* a timer's work, on the lease holder only (every instance keeps its timers; the others skip the beat) */
export const leaderOnly = (fn) => (leader ? Promise.resolve().then(fn) : Promise.resolve());
