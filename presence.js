// Who has a jam open right now (the open jam's poll is the heartbeat). In memory per instance; on Postgres the beats are
// also written (jam_presence, an unlogged table: losing it in a crash costs nothing) and a jam's room is read back every
// 2 s while someone here looks at it, so teammates on different instances see each other.
import { enabled as pgOn, q } from './db/index.js';

export function createPresence({ pg = pgOn(), log = console, everyMs = 2000 } = {}) {
  const HERE = new Map(); // wid → Map(email → { email, name, pic, at, typing })
  const out = new Map(), asked = new Map(); let timer = null;
  const put = (wid, x) => { let m = HERE.get(wid); if (!m) HERE.set(wid, (m = new Map())); const cur = m.get(x.email); if (!cur || cur.at <= x.at) m.set(x.email, x); };
  const beat = (wid, p, typing = false) => { const x = { ...p, at: Date.now(), typing: !!typing }; put(wid, x); if (pg) { out.set(`${wid}|${p.email}`, { wid, ...x }); asked.set(wid, Date.now()); tick(); } };
  const here = (wid, ms = 30e3) => { if (pg) { asked.set(wid, Date.now()); tick(); } const m = HERE.get(wid); if (!m) return []; const r = []; for (const [e, x] of m) { if (Date.now() - x.at > ms) m.delete(e); else r.push(x); } return r; };
  const watching = (wid, email, ms = 120e3) => { const x = HERE.get(wid)?.get(email); return !!x && Date.now() - x.at < ms; };
  const tick = () => { if (timer) return; timer = setTimeout(sync, everyMs); timer.unref?.(); };
  async function sync() {
    timer = null;
    try {
      const rows = [...out.values()]; out.clear();
      if (rows.length) await q(`INSERT INTO jam_presence (wid, email, name, pic, typing, at) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bool[], $6::timestamptz[])
        ON CONFLICT (wid, email) DO UPDATE SET name = EXCLUDED.name, pic = EXCLUDED.pic, typing = EXCLUDED.typing, at = EXCLUDED.at`,
        [rows.map((x) => x.wid), rows.map((x) => x.email), rows.map((x) => x.name || null), rows.map((x) => x.pic || null), rows.map((x) => !!x.typing), rows.map((x) => new Date(x.at))]);
      const wids = [...asked.entries()].filter(([, at]) => Date.now() - at < 30e3).map(([w]) => w);
      for (const [w, at] of asked) if (Date.now() - at >= 30e3) asked.delete(w);
      if (wids.length) for (const r of (await q(`SELECT wid, email, name, pic, typing, extract(epoch from at) * 1000 AS at FROM jam_presence WHERE wid = ANY($1) AND at > now() - interval '2 minutes'`, [wids])).rows)
        put(r.wid, { email: r.email, name: r.name, pic: r.pic, typing: r.typing, at: +r.at });
      if (Math.random() < 0.01) await q(`DELETE FROM jam_presence WHERE at < now() - interval '1 hour'`);
    } catch (e) { log.warn?.('[presence]', e.message); }
    if (asked.size) tick();
  }
  return { beat, here, watching };
}
