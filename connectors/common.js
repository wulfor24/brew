// Shared pieces for the (simulated) connectors: number formats in the brand's currency, the card shape the feed already
// renders, and ledger entries for the moves.
// DUMMY: the numbers are simulated from the brand's read (connectors/sim.js); a real connector fills the same shapes.
import { moneyFmt } from '../brand-pack.js';

export const n0 = (x) => Math.round(x).toLocaleString('en-US');
export const pct = (x, d = 0) => `${(+x).toFixed(d)}%`;
export const has = (...xs) => xs.every((x) => x != null && Number.isFinite(+x));
export const fmt = (profile = {}) => {
  const india = (profile.country || 'IN') === 'IN', cur = profile.currency || (india ? 'INR' : 'USD'), money = moneyFmt(cur, profile.locale || (india ? 'en-IN' : 'en-US'));
  const big = (x) => (cur === 'INR' && x >= 1e7 ? `₹${(x / 1e7).toFixed(2)} Cr` : cur === 'INR' && x >= 1e5 ? `₹${(x / 1e5).toFixed(1)} L` : money(Math.round(x)));
  return { india, cur, money: (x) => money(Math.round(x)), big };
};
// a feed card from a connected account (hidden until that account is on: onlyWhen; members only: liveOnly)
export const card = (k, name, lane, id, o) => ({ id: `live-${k}-${id}`, onlyWhen: k, liveOnly: true, lane, roles: o.roles, agent: o.agent, sector: o.sector, type: o.type, kind: 'rows', time: 'just now',
  src: `${name} · live`, title: o.title, sub: o.sub, rows: o.rows.filter((r) => r[1] != null && r[1] !== ''), badge: o.badge, detail: o.detail, cta: { label: o.cta } });
// evidence for the moves (refresh.js reads these keys): observed, with where it came from
export const L = (key, label, v, n, src) => ({ key, label, v: String(v), ...(n != null && Number.isFinite(+n) ? { n: +(+n).toFixed(2) } : {}), layer: 'observed', src, method: 'connected account', at: new Date().toISOString() });


/* DUMMY: every connector in the prototype is simulated (connectors/sim.js). A row is simulated when it says so, or when it
   came from a connector before the flag was kept (method 'connected account'). Real connectors write method 'account:<id>' (never 'connected account'). */
export const simulated = (e) => !!(e && (e.demo || e.method === 'connected account'));
export const realRows = (xs) => (Array.isArray(xs) ? xs : Object.values(xs || {})).filter((e) => e && !simulated(e));
