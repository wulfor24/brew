// Shared pieces for the connectors: number formats in the brand's currency, the card shape the feed already renders,
// ledger entries for the moves and small fetch helpers. The real connectors (shopify.js, meta.js, google.js, klaviyo.js,
// reviews.js, market.js) and the demo site's simulated ones (sim.js, which marks every row demo) fill the same shapes.
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
export const L = (key, label, v, n, src) => ({ key, label, v: String(v), ...(n != null && Number.isFinite(+n) ? { n: +(+n).toFixed(2) } : {}), layer: 'observed', src, method: `account:${String(key).split('.')[0]}`, at: new Date().toISOString() });


/* A row is simulated when it says so (the demo site's sim.js marks every row demo), or when it came from a connector before
   the flag was kept (method 'connected account'). Real connectors write method 'account:<id>' (never 'connected account'). */
export const simulated = (e) => !!(e && (e.demo || e.method === 'connected account'));
export const realRows = (xs) => (Array.isArray(xs) ? xs : Object.values(xs || {})).filter((e) => e && !simulated(e));
// a move card rewritten from the team's connected accounts: its own id next to the shared card (m04-1 → m04-1-p)
export const privId = (id) => (/-p$/.test(String(id)) ? String(id) : `${id}-p`);

export async function getJSON(url, opts = {}, what = url.split('?')[0]) {
  const r = await fetch(url, { ...opts, redirect: 'manual', signal: AbortSignal.timeout(opts.ms || 30e3) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const msg = j?.error?.message || (typeof j?.error === 'string' && j.error) || j?.error_description || j?.errors?.[0]?.detail || j?.errors?.[0]?.message || j?.message || j?.errors || t.slice(0, 160); const e = new Error(`${what} ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 160)}`); e.status = r.status; throw e; }
  return j;
}
export const form = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)));
export const dayISO = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);
