// What a real connected account changes besides its own cards: the team's view of the brand, worked out from the account's
// numbers (private/connected-ledger.json, real rows only). Pure functions; build.js writes the results to the brand's private
// folder when an account connects (onConnect), and the feed reads them for members. Nothing here calls AI or a paid source.

const by = (rows) => Object.fromEntries((rows || []).filter((e) => e?.key && e.v != null).map((e) => [e.key, e]));
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* "Hair Oil (120); Shampoo 200ml (64)" → [{ title, units }] (Shopify's best sellers by units, 30 days) */
export function topSellers(v) {
  return String(v || '').split(/;\s*/).map((s) => { const m = /^(.*?)\s*\((\d[\d,]*)\)\s*$/.exec(s.trim()); return m ? { title: m[1].trim(), units: +m[2].replace(/,/g, '') } : (s.trim() ? { title: s.trim(), units: null } : null); }).filter(Boolean);
}
/* a best seller's catalog handle: the same title, or a catalog title that starts with it (variants add " - 200ml") */
export function handleOf(title, products = []) {
  const t = norm(title); if (!t) return null;
  const hit = products.find((p) => norm(p.title) === t) || products.find((p) => norm(p.title).startsWith(t) || t.startsWith(norm(p.title)));
  return hit?.handle || null;
}
const num = (e) => (e?.n != null && Number.isFinite(+e.n) ? +e.n : null);
/* a revenue band, never the number itself, for the places that only need the size of the business */
export const bandOf = (rev30) => rev30 == null ? null : rev30 < 1e5 ? 'early' : rev30 < 1e6 ? 'growing' : rev30 < 1e7 ? 'scaling' : 'large';

/* the profile fields a connected account corrects, laid over profile.json for the team (private/profile-live.json) */
export function profileLive(rows, profile = {}) {
  const L = by(rows), out = { at: new Date().toISOString(), from: [...new Set(Object.keys(L).map((k) => k.split('.')[0]))] };
  const top = topSellers(L['shopify.top.30d']?.v), hero = [...new Set(top.map((x) => handleOf(x.title, profile.catalog?.products || [])).filter(Boolean))];
  if (hero.length) { out.hero = hero.slice(0, 8); out.bestSellers = top.slice(0, 8); }
  if (L['shopify.aov']) out.aov = { v: L['shopify.aov'].v, n: num(L['shopify.aov']) };
  if (L['shopify.revenue.30d']) out.revenueBand = bandOf(num(L['shopify.revenue.30d']));
  if (L['shopify.cod.share']) out.codShare = num(L['shopify.cod.share']);
  if (L['ga4.channels']) out.channelMix = String(L['ga4.channels'].v).split(/;\s*/).map((s) => { const m = /^(.*\S)\s+(\d+(?:\.\d+)?)%$/.exec(s.trim()); return m ? { channel: m[1], share: +m[2] } : null; }).filter(Boolean);
  if (L['meta.ads.live'] || L['meta.spend.30d']) out.adsLive = { meta: num(L['meta.ads.live']), spend30: L['meta.spend.30d']?.v ?? null };
  if (L['klaviyo.flows.live'] || L['klaviyo.flows.off']) out.emailFlows = { tool: 'Klaviyo', live: String(L['klaviyo.flows.live']?.v ?? ''), off: String(L['klaviyo.flows.off']?.v ?? '') };
  if (L['ga4.countries']) out.countries = String(L['ga4.countries'].v).split(/;\s*/).map((s) => { const m = /^([A-Z]{2})\s+(\d+(?:\.\d+)?)%$/.exec(s.trim()); return m ? { code: m[1], share: +m[2] / 100 } : null; }).filter(Boolean);
  return out;
}
/* the profile a member's rewrite writes from: best sellers lead the catalog's heroes, and the corrected fields ride along */
export function withLive(profile, live) {
  if (!profile || !live) return profile;
  const p = { ...profile, live: { aov: live.aov, revenueBand: live.revenueBand, codShare: live.codShare, channelMix: live.channelMix, adsLive: live.adsLive, emailFlows: live.emailFlows, bestSellers: live.bestSellers } };
  if (live.hero?.length && p.catalog) p.catalog = { ...p.catalog, hero: [...new Set([...live.hero, ...(p.catalog.hero || [])])].slice(0, 12), order: 'best sellers (Shopify, 30 days)' };
  return p;
}

/* the health card's Storefront and Creative rings, for members: the real readings behind them (the score stays simulated) */
export function healthReadings(liveLedger = {}) {
  const L = liveLedger || {}, v = (k) => L[k]?.v, out = {};
  const sf = [['Conversion', v('ga4.conversion')], ['Visits on phones', v('ga4.mobile.share')], ['Product page to cart', v('ga4.pdp.to.cart')], ['Checkouts left, 30 days', v('shopify.checkout.left')]].filter(([, x]) => x != null);
  const cr = [['Live Meta ads', v('meta.ads.live')], ['Cost per order', v('meta.cpa')], ['Highest frequency', v('meta.frequency.max')], ['Return on ad spend', v('meta.roas')]].filter(([, x]) => x != null);
  if (sf.length) out.Storefront = { what: sf.slice(0, 3).map(([k, x]) => `${k} ${x}`).join(' · '), parts: sf.map(([k, x]) => ({ k, v: String(x), real: true })) };
  if (cr.length) out.Creative = { what: cr.slice(0, 3).map(([k, x]) => `${k} ${x}`).join(' · '), parts: cr.map(([k, x]) => ({ k, v: String(x), real: true })) };
  return out;
}

/* a card's measure baseline from the team's own account (members only): the number the result is read against */
const BASE = { creatives: ['meta.cpa'], ads: ['meta.cpa', 'gads.roas'], storefront: ['ga4.conversion'], signals: ['shopify.repeat.90d'] };
export function baselineOf(sector, liveLedger = {}) {
  for (const k of BASE[sector] || []) { const e = liveLedger?.[k]; if (e && e.n != null && Number.isFinite(+e.n)) return { baseline: +(+e.n).toFixed(2), baselineV: String(e.v), baselineFrom: e.label || k }; }
  return null;
}

/* ---------- when a connected run may start, and which moves it writes (build.js onConnect) ----------
   run: updates.json connectRun { ids, waiting: { id: connectedAt }, due }. Returns the time to look again, or 0 to go now:
   not before due (a quiet CONNECT_SETTLE after the last connect or first read), and not while a just-connected account's
   first read is still out (at most readMaxMs after it connected; checked again every 5 minutes) */
export function settleWait(run, { now = Date.now(), readMaxMs = 2 * 3600e3 } = {}) {
  if (!run) return 0;
  if ((+run.due || 0) > now + 1e3) return +run.due;
  const waits = Object.values(run.waiting || {}).filter((at) => now - at < readMaxMs);
  return waits.length ? Math.min(now + 5 * 60e3, ...waits.map((at) => at + readMaxMs)) : 0;
}
/* the moves a connected run rewrites: every rewritable move on the brand's first run, else the ones the new accounts touch.
   A move is written once per set of accounts: its private version's meta.connectedWith already holding every account it
   needs leaves it alone. A move written before connectedWith existed falls back to "rewritten within freshMs" */
export function connectTargets({ all = [], full = false, runIds = [], nowIds = [], pm = {}, moves = {}, touches = () => true, at = Date.now(), freshMs = 24 * 3600e3 }) {
  const when = (m) => Date.parse(m?.meta?.rewrittenAt || 0) || 0;
  const recent = (n) => at - Math.max(when(pm?.[n]), when(moves?.[n])) < freshMs;
  const needs = (n) => { const w = pm?.[n]?.meta?.connectedWith, want = full ? nowIds : runIds.filter((id) => touches(id, n));
    if (!want.length) return false; if (!w) return full || !recent(n); return want.some((id) => !w.includes(id)); };
  /* the moves the accounts touch go first: when the weekly pot runs out mid-run the rest wait for next week, never these */
  const hit = (n) => (full ? nowIds : runIds).some((id) => touches(id, n));
  const ns = (full ? all : all.filter((n) => runIds.some((id) => touches(id, n)))).filter(needs);
  return [...ns.filter(hit), ...ns.filter((n) => !hit(n))];
}
