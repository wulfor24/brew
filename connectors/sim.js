// DUMMY: the connected accounts, simulated for every brand (see connectors/index.js and DUMMY.md). sync() returns what a
// real connector would: the account's stats, what changed, feed cards and ledger entries for the moves. The numbers come
// from demo-data.js demoFor(): built from the brand's real read (its products and prices, review count, live ads, search
// terms), deterministic per brand. Nothing here touches a real account.
import { demoFor } from '../demo-data.js';
import { card, L, fmt, n0, pct } from './common.js';

export const SIM_IDS = ['shopify', 'meta', 'google', 'klaviyo', 'reviews', 'slack', 'marketplaces'];
export const NAME = { shopify: 'Shopify', meta: 'Meta Ads', google: 'Google Ads + GA4', klaviyo: 'Klaviyo', reviews: 'Judge.me', slack: 'Slack', marketplaces: 'Marketplaces' };

export function createSim({ packs, log = console }) {
  /* the brand's demo accounts (made once per read, kept as demo.json by brand-pack.js) and the read they come from */
  async function brandOf(slug) {
    const profile = { ...((await packs.getJSON(slug, 'profile.json', null)) || {}), slug }, seed = (await packs.getJSON(slug, 'seed.json', null)) || {};
    let demo = await packs.getJSON(slug, 'demo.json', null); if (!demo?.accounts) demo = demoFor(profile, seed);
    return { profile, seed, demo, A: demo.accounts, name: profile.name || seed.brand?.name || slug, F: fmt(profile), lane: Object.keys(seed.lanes || { core: 1 })[0] };
  }

  /* the session's account state (the pack store sandboxes private/ per demo session) */


  /* ---------- make a change: the same effect a real account would show, an undo for it ---------- */

  /* ---------- sync: what the real connector returns, in this brand's numbers ---------- */
  async function sync(slug, id) {
    const b = await brandOf(slug), { A, demo, name, F, lane } = b, nm = NAME[id];
    const cards = (demo.cards || []).filter((c) => c.onlyWhen === id)
      .map(({ id: cid, demo: _d, ...c }) => ({ ...c, id: cid.replace(/^demo-/, 'live-'), liveOnly: true, src: `${nm} · live`, time: 'just now' }));
    const relabel = (e) => ({ ...e, label: String(e.label).replace(/ \(demo account\)$/, ''), src: nm, method: 'connected account', demo: true, at: new Date().toISOString() });
    const KEY = { 'meta.cpa.first': 'meta.cpa', 'meta.retargeting.frequency': 'meta.frequency.max' };
    let ledger = (demo.ledger?.[id] || []).map(relabel).map((e) => ({ ...e, key: KEY[e.key] || e.key }));
    const s = A.shopify, m = A.meta, g = A.google, r = A.reviews, k = A.klaviyo, mk = A.marketplaces;
    if (id === 'shopify') ledger.push(L('shopify.revenue.30d', 'Revenue, last 30 days', F.big(s.revenue), s.revenue, nm), L('shopify.products.active', 'Active products', n0((b.profile.catalog?.products || []).length), (b.profile.catalog?.products || []).length, nm),
      L('shopify.top.30d', 'Best seller, last 30 days', s.top?.[0]?.title || '—', s.top?.[0]?.orders ?? null, nm));
    if (id === 'meta') ledger.push(L('meta.ads.live', 'Live Meta ads', n0(m.live), m.live, nm));
    if (id === 'google') ledger.push(L('ga4.conversion', 'Conversion rate (GA4)', pct(s.cr, 1), s.cr, nm), L('gads.spend.30d', 'Google Ads spend, last 30 days', F.big(g.gspend), g.gspend, nm), L('gads.roas', 'Google Ads return on spend', `${(m.roas * 1.15).toFixed(1)}x`, m.roas * 1.15, nm));
    if (id === 'klaviyo') ledger.push(L('klaviyo.flows.off', 'Email flows not built', '3 of 5', 3, nm));
    if (id === 'reviews') ledger = [L('reviews.judgeme.total', 'Reviews', n0(r.total), r.total, nm), L('reviews.judgeme.rating.recent', 'Average rating, last 90 days', `${r.rating} of 5`, r.rating, nm), L('reviews.judgeme.open', 'Low-star reviews with no reply', n0(r.unanswered), r.unanswered, nm)];
    if (id === 'marketplaces') ledger = [L('market.amazon.listings', 'Amazon listings', n0(mk.listings), mk.listings, nm), L('market.amazon.rating', 'Amazon rating', `${r.rating} of 5`, r.rating, nm)];
    const extra = id === 'slack' ? { stats: [['Workspace', `${name} team`], ['Channel', '#growth'], ['Replies', 'Simulated']], changed: ['Teammate replies in the jam are simulated until Slack is really connected'] }
      : null;
    const acc = A[id] || {};
    return { account: { name: id === 'shopify' ? `${b.profile.host || name}` : id === 'meta' ? `${name} · Ad account` : id === 'google' ? `${name} · Google Ads` : `${name}` },
      stats: extra?.stats || acc.stats || [], changed: extra?.changed || demo.changed?.[id] || [], cards: id === 'marketplaces' ? cards.map((c) => ({ ...c, liveOnly: false })) : cards, ledger: ledger.map((e) => ({ ...e, demo: true })), notes: [] }; /* DUMMY: every number stays marked simulated, so it is never evidence */
  }

  /* ---------- day by day for one launch (measurement): the launched scope vs the rest of the account ---------- */

  /* ---------- a connector driver with the real connector's shape ---------- */
  return { sync, brandOf, creds: (id) => ({ sim: true, id, at: Date.now() }) };
}
