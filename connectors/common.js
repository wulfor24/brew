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
/* the rows a move, a card or an answer may rest on: real, and not stale (an account that kept failing, or whose last read is
   too old, keeps its numbers on the fact sheet, marked stale, but they stop being evidence until it reads again) */
export const evidenceRows = (xs) => realRows(xs).filter((e) => !e.stale);

/* how long to wait before the next try after `fails` failures in a row: the platform's Retry-After when it sent one,
   else doubling from `base` up to `cap`, with ±20% jitter so many brands never retry in step */
export function backoff(fails, { base = 15 * 60e3, cap = 12 * 3600e3, retryAfter = null, rnd = Math.random } = {}) {
  if (retryAfter != null && Number.isFinite(+retryAfter) && +retryAfter > 0) return Math.min(cap, +retryAfter) + Math.round(rnd() * 30e3);
  const raw = Math.min(cap, base * 2 ** Math.max(0, (fails || 1) - 1));
  return Math.max(60e3, Math.round(raw * (0.8 + rnd() * 0.4)));
}
/* Retry-After: seconds, or an HTTP date → milliseconds (null when absent or unreadable) */
export function retryAfterMs(h, now = Date.now()) {
  if (h == null || h === '') return null;
  if (/^\d+(\.\d+)?$/.test(String(h).trim())) return Math.round(+h * 1e3);
  const t = Date.parse(h); return Number.isFinite(t) ? Math.max(0, t - now) : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a move card rewritten from the team's connected accounts: its own id next to the shared card (m04-1 → m04-1-p)
export const privId = (id) => (/-p$/.test(String(id)) ? String(id) : `${id}-p`);

/* a rate limit (429) waits and tries again within the read when the wait is short (Retry-After up to 20 seconds, else a
   few seconds with jitter), at most `retries` times; a longer one is thrown with e.retryAfter, and the hourly tick backs off */
export async function getJSON(url, opts = {}, what = url.split('?')[0]) {
  const { retries = 2, fetchImpl = fetch, wait = sleep, ...o } = opts;
  for (let i = 0; ; i++) {
    const r = await fetchImpl(url, { ...o, redirect: 'manual', signal: AbortSignal.timeout(o.ms || 30e3) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    if (r.ok) return j;
    const ra = r.status === 429 ? retryAfterMs(r.headers?.get?.('retry-after')) : null;
    if (r.status === 429 && i < retries && (ra == null || ra <= 20e3)) { await wait(ra ?? Math.round(2e3 * 2 ** i * (0.8 + Math.random() * 0.4))); continue; }
    const msg = j?.error?.message || (typeof j?.error === 'string' && j.error) || j?.error_description || j?.errors?.[0]?.detail || j?.errors?.[0]?.message || j?.message || j?.errors || t.slice(0, 160);
    const e = new Error(`${what} ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 160)}`); e.status = r.status;
    if (j?.error?.code != null) e.code = j.error.code; /* Meta: 190 is an expired or revoked sign-in, 4/17/32/613 are rate limits */
    if (r.status === 429 || [4, 17, 32, 613].includes(+e.code)) { e.rateLimited = true; e.retryAfter = ra; }
    throw e;
  }
}
export const form = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)));
export const dayISO = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);
