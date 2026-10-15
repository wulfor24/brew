// DUMMY: the store health rings (Creative, Storefront, AI answers) and the score on the feed's health card.
// The numbers are simulated: steady per brand (seeded by its host) and shaped by a few things the read really found
// (live ads, products with photos, reviews, AI answers), but no real scoring is done. The card shows a Dummy tag.
// The real build needs a scorer per ring with named sources (PageSpeed, a checkout walk, the Ad Library, AI answers)
// and tests; the old scorer had stale saved scores and unread parts counted as full marks. See DUMMY.md.
export const HEALTH_V = 'dummy-2'; // a saved score from another version is replaced at load (brand-pack.js); 2: the numbers come from pack-numbers.js
import { numbersOf } from '../pack-numbers.js';
/* the real numbers a ring quotes: a saved ring whose key differs is worked out again at load, so it never quotes an old count */
export const healthKey = (N) => `${N.ownAds.n ?? '-'}|${N.ai.named ?? '-'}/${N.ai.of ?? '-'}|${N.products.n ?? '-'}`;

const seeded = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));

export function healthFrom(p = {}, N = numbersOf({ profile: p })) {
  const R = seeded(p.host || p.name || 'brand'), around = (base, spread) => clamp(base + (R() - 0.5) * 2 * spread);
  /* the one count of each (pack-numbers.js): own live ads, products, and AI answers to questions that don't name the brand */
  const live = N.ownAds.n ?? 0, prods = N.products.n ?? (p.catalog?.products || []).length, reviews = p.reviews?.total || 0, ai = N.ai;
  const ring = (k, v, what, parts) => ({ k, v, read: true, what, parts: parts.map(([pk, pv, of]) => ({ k: pk, v: pv, of, note: 'Simulated' })), src: 'Simulated (Dummy)', dummy: true });
  const cr = around(live ? 62 : 38, 12), st = around(prods ? 58 : 45, 12) + (reviews ? 6 : 0), an = around(ai.of ? 30 + 40 * ((ai.named || 0) / Math.max(1, ai.of)) : 40, 10);
  const rings = [
    ring('Creative', clamp(cr), live ? `From ${live.toLocaleString('en-IN')} of your live ads in the Ad Library (simulated score)` : 'Simulated score', [['Volume', Math.round(cr * 0.3), 30], ['Hook variety', Math.round(cr * 0.3), 30], ['Formats', Math.round(cr * 0.25), 25]]),
    ring('Storefront', clamp(st), `${p.host || 'Your store'}: speed, checkout, photos, reviews (simulated score)`, [['Mobile speed', Math.round(st * 0.35), 35], ['Reaching checkout', Math.round(st * 0.15), 15], ['Photos per product', Math.round(st * 0.15), 15], ['Reviews on the site', Math.round(st * 0.15), 15]]),
    ring('AI answers', clamp(an), ai.of ? `Named in ${ai.named || 0} of ${ai.of} AI answers${ai.unbranded ? ` to questions that don't name ${p.name || 'the brand'}` : ''} (score simulated)` : 'Simulated score', [['Unbranded questions', Math.round(an * 0.85), 85], ['Branded questions', Math.round(an * 0.15), 15]]),
  ];
  return { v: HEALTH_V, key: healthKey(N), dummy: true, score: clamp(rings.reduce((a, r) => a + r.v, 0) / rings.length), delta: 0, public: true, rings, moves: [], at: new Date().toISOString().slice(0, 10) };
}
