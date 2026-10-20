// Viral gate: which short videos Brew may hand a brand as "make our version of this", for ANY brand. Pure, so tests run it on
// fixtures; viral.js (the finder) and feed-service (cards, saved items healed at load) share it. Nothing here is per brand.
//   counted  views and the creator's usual views are the platform's own; a number Brew could not read is unknown (null), never 0,
//            and an unknown score is never scored or shown
//   outlier  the video got at least MIN_SCORE times that creator's usual views (median of their recent posts), with real reach
//   fresh    posted in the last FRESH_DAYS (an old format is somebody else's moment)
//   organic  not a paid post or an ad (those are rival-ads territory), not the brand's own account
//   short    a short (≤ MAX_SECONDS) the brand can film or make
//   topic    its caption or the search that found it shares the brand's topic words; in English markets the caption reads English
import { topicStems, looksEnglish } from './community-gate.js';

export const MIN_SCORE = 10, FRESH_DAYS = 90, MAX_SECONDS = 90;
const DAY = 864e5;
const ENGLISH = new Set(['IN', 'US', 'GB', 'AU', 'CA', 'NZ', 'IE', 'SG', 'AE', 'PH', 'MY', 'ZA', 'NG', 'KE', 'PK']);
/* reach floor by market size: a 10x video in a small market is still small */
const BIG = new Set(['US', 'IN', 'BR', 'ID', 'MX', 'GB']);
export const minViewsFor = (country) => (BIG.has(String(country || '').toUpperCase()) ? 50e3 : 20e3);

/* the creator's usual views: the median of their recent posts, without this one; under 3 posts is unknown */
export function usualViews(views = [], self = null) {
  const xs = views.map((x) => (x == null ? null : +x)).filter((x) => Number.isFinite(x) && x >= 0);
  const i = self == null ? -1 : xs.indexOf(+self); if (i >= 0) xs.splice(i, 1);
  if (xs.length < 3) return null;
  xs.sort((a, b) => a - b); const m = xs.length >> 1; return Math.max(1, Math.round(xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2));
}
export const scoreOf = (views, usual) => (views == null || !usual ? null : Math.round((views / usual) * 10) / 10);
/* "47×" for a card; nothing when unknown */
export const scoreText = (s) => (s == null ? '' : `${s >= 10 ? Math.round(s) : s}×`);

const squash = (x) => String(x || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '');
const words = (s) => new Set((String(s || '').toLowerCase().replace(/["']/g, '').match(/[a-z]{4,}/g) || []).map((w) => w.replace(/(ies)$/, 'y').replace(/(ing|es|s)$/, '').replace(/y$/, '')));

/* the cheap checks, before paying for the creator's usual views: { ok, why[] } */
export function preViral(v, { now = Date.now(), country = '', stems = [], own = [] } = {}) {
  const why = [];
  if (v?.views == null) why.push('views unknown');
  else if (v.views < minViewsFor(country)) why.push(`under ${minViewsFor(country) / 1e3}k views`);
  if (!v?.postedAt) why.push('post date unknown'); else if (now - v.postedAt > FRESH_DAYS * DAY) why.push(`older than ${FRESH_DAYS} days`);
  if (v?.paid) why.push('a paid post');
  if (v?.durationS != null && v.durationS > MAX_SECONDS) why.push(`longer than ${MAX_SECONDS}s`);
  if (own.some((h) => h && squash(h) === squash(v?.handle))) why.push("the brand's own account");
  if (stems.length) { const w = words(`${v?.caption || ''} ${v?.q || ''}`); if (!stems.some((s) => w.has(s))) why.push('off-topic'); }
  if (ENGLISH.has(String(country).toUpperCase()) && v?.caption && !looksEnglish(v.caption)) why.push('not in English');
  return { ok: !why.length, why };
}
/* the whole gate: the cheap checks plus a known outlier score */
export function usableViral(v, o = {}) {
  const r = preViral(v, o), why = [...r.why], min = o.minScore ?? MIN_SCORE;
  if (v?.score == null) why.push("creator's usual views unknown");
  else if (v.score < min) why.push(`only ${scoreText(v.score)} usual views`);
  return { ok: !why.length, why };
}
/* topic words from the brand profile, the same stems the community gate uses */
export const viralStems = (profile = {}, terms = []) => topicStems({ noun: profile.config?.product?.noun || profile.noun || '', terms: [profile.config?.category || profile.category || '', ...terms], products: [] });
/* one video cross-posted (the same caption on TikTok and Instagram) is one pick: its first words, squashed */
const capKey = (x) => String(x?.caption || '').toLowerCase().replace(/#\S+/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 60);
/* best first, platforms taking turns so three picks are not three TikToks */
export function pickViral(xs, n = 3) {
  const seen = new Set(); xs = [...xs].sort((a, b) => b.score - a.score).filter((x) => { const k = capKey(x); if (k.length < 20) return true; if (seen.has(k)) return false; seen.add(k); return true; });
  const by = new Map(); for (const x of [...xs].sort((a, b) => b.score * Math.log10(10 + b.views) - a.score * Math.log10(10 + a.views))) { if (!by.has(x.platform)) by.set(x.platform, []); by.get(x.platform).push(x); }
  const out = []; for (let added = true; added && out.length < n;) { added = false; for (const q of by.values()) if (q.length && out.length < n) { out.push(q.shift()); added = true; } }
  return out;
}
