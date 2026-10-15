// Marketplaces + reviews, read in public (no sign-in to the marketplace): the brand's Amazon listings now (treg
// crawl4ai Amazon search, about $0.002 a read), compared with its own site's prices, plus the review totals the read
// found on the site's review app. Flipkart, Nykaa and the rest need the seller account; nothing is guessed for them.
import { card, L, n0, has, fmt } from './common.js';

const AMAZON = { IN: ['in', 'amazon.in'], US: ['us', 'amazon.com'], GB: ['uk', 'amazon.co.uk'], CA: ['ca', 'amazon.ca'], AU: ['au', 'amazon.com.au'], DE: ['de', 'amazon.de'], FR: ['fr', 'amazon.fr'], AE: ['ae', 'amazon.ae'], JP: ['jp', 'amazon.co.jp'] };
const words = (s, drop) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !drop?.has(w)));
/* Is this marketplace listing the same product as a site product? The old test (shared words / the shorter title) paired
   a short site title like "UNO x COMET" with any Amazon listing carrying the brand name: ₹190 against ₹5,899. Now the
   brand's own words don't count, the match is two-sided (Dice), at least one distinctive word must be shared, and the
   price must be plausible for the same item (a marketplace price under half the site's is a different product). */
const STOP = new Set(['for', 'and', 'the', 'with', 'men', 'women', 'mens', 'womens', 'unisex', 'pack', 'size', 'new', 'shoes', 'shoe', 'sneakers', 'sneaker', 'pair']);
export function pairListing(site, title, amazonPrice, brand = '') {
  const drop = new Set([...words(brand), ...STOP]), T = words(title, drop); if (!T.size) return null;
  let best = null;
  for (const s of site) { const S = words(s.title, drop); if (!S.size) continue; let n = 0; for (const w of S) if (T.has(w)) n++;
    const dice = (2 * n) / (S.size + T.size), cover = n / S.size; /* every distinctive word of the site title should be in the listing */
    if (n >= 1 && cover >= 0.75 && dice >= 0.4 && (!best || dice > best.dice)) best = { s, dice }; }
  if (!best) return null;
  const sp = +best.s.price; if (!(sp > 0) || !(amazonPrice >= sp * 0.5)) return null; // not the same item at that price
  return best.s;
}
const price = (p) => { const m = String(p ?? '').replace(/,/g, '').match(/(\d+(\.\d+)?)/); return m ? +m[1] : null; };

export default {
  id: 'marketplaces', name: 'Marketplaces', modes: ['public'], proof: false,
  ready: (deps) => !!deps?.treg?.live,
  async sync(_c, ctx, deps) {
    const p = ctx.profile || {}, F = fmt(p), m = {}, notes = [];
    const [country, domain] = AMAZON[p.country || 'IN'] || AMAZON.US, name = p.name || ctx.host;
    const nameRe = new RegExp(`(^|\\b)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\b`, 'i');
    const j = await deps.treg.call('crawl4ai.amazon.search.products', { body: { keywords: name, country, limit: 60 }, tag: `market-${ctx.slug}` });
    const rows = [...new Map((j?.rows || []).filter((r) => r.title && nameRe.test(String(r.title).slice(0, 60))).map((r) => [r.asin, r])).values()];
    m.listings = rows.length; m.domain = domain;
    if (rows.length) { const tot = rows.reduce((a, r) => a + (+r.reviews || 0), 0); m.ratings = tot; m.rating = tot ? rows.reduce((a, r) => a + (+r.reviews || 0) * (+r.rating || 0), 0) / tot : null;
      m.low = rows.filter((r) => +r.rating && +r.rating < 3.8 && +r.reviews >= 20).sort((a, b) => a.rating - b.rating).slice(0, 3).map((r) => ({ title: r.title, rating: +r.rating, reviews: +r.reviews, url: `https://www.${domain}/dp/${r.asin}` }));
      // the same product cheaper on Amazon than on the brand's own site
      const site = (p.catalog?.products || []).filter((x) => +x.price > 0);
      m.gaps = []; for (const r of rows) { const ap = price(r.price); if (!ap) continue; const same = pairListing(site, r.title, ap, name);
        if (same && ap < +same.price * 0.95) m.gaps.push({ title: same.title, site: +same.price, amazon: ap, url: `https://www.${domain}/dp/${r.asin}` }); }
      m.gaps = m.gaps.slice(0, 4); }
    else notes.push(`No ${name} listings in the ${domain} search.`);
    const rv = p.reviews || {}; m.siteReviews = +rv.total || null; m.siteRating = rv.platforms?.find((x) => x.rating && !/amazon/i.test(x.name || ''))?.rating || null;
    const k = 'marketplaces', src = `${domain} search, read ${new Date().toISOString().slice(0, 10)}`, out = [], lane = ctx.lane;
    if (m.gaps?.length) out.push(card(k, 'Marketplaces', lane, 'price', { agent: 'storefront', sector: 'catalog', type: 'decision', roles: ['ecom', 'founder'], badge: [`${m.gaps.length} cheaper`, 'warn'], cta: 'Agree with the call',
      title: `${m.gaps.length} of your products sell for less on ${domain} than on ${ctx.host}`, sub: `${m.gaps[0].title} is ${F.money(m.gaps[0].amazon)} there and ${F.money(m.gaps[0].site)} on your site. Shoppers who compare buy on ${domain}, where you keep less of the price.`,
      rows: m.gaps.slice(0, 4).map((g) => [g.title.slice(0, 38), `${F.money(g.amazon)} vs ${F.money(g.site)}`]), detail: { why: ['A lower marketplace price pulls buyers off your site.'], how: ['Check who sells the cheaper listing', 'Match the price or add a site-only bundle', 'Read it again in 14 days'] } }));
    if (m.low?.length) out.push(card(k, 'Marketplaces', lane, 'low', { agent: 'crm', sector: 'signals', type: 'decision', roles: ['ecom', 'brand', 'founder'], badge: [`${m.low[0].rating}★`, 'warn'], cta: 'Read the reviews',
      title: `${m.low[0].title.slice(0, 60)} is rated ${m.low[0].rating} on ${domain}`, sub: `${n0(m.low[0].reviews)} ratings pull it below the listings around it. The low reviews usually name one fixable thing: size, smell, delivery or the listing’s promise.`,
      rows: m.low.map((x) => [x.title.slice(0, 38), `${x.rating}★ · ${n0(x.reviews)}`]), detail: { why: ['Shoppers filter by rating on marketplaces.'], how: ['Read the 1 and 2 star reviews', 'Fix the listing or the product note', 'Ask recent buyers for a review'] } }));
    const stats = [['Amazon listings', `${n0(m.listings)} on ${domain}`], has(m.rating) && ['Amazon rating', `${m.rating.toFixed(1)} of 5 (${n0(m.ratings)})`], has(m.siteReviews) && ['Reviews on your site', n0(m.siteReviews)], m.gaps && ['Cheaper on Amazon', n0(m.gaps.length)]].filter(Boolean);
    const changed = [`${n0(m.listings)} ${domain} listings read just now`, m.gaps?.length && `${m.gaps.length} products cheaper on ${domain} than on your site`, m.low?.length && `${m.low.length} low-rated listings flagged`, 'Flipkart, Nykaa and others need the seller account'].filter(Boolean);
    const ledger = [L('market.amazon.listings', `${domain} listings for ${name}`, n0(m.listings), m.listings, src), has(m.rating) && L('market.amazon.rating', `${domain} average rating, weighted by ratings`, m.rating.toFixed(2), m.rating, src),
      m.gaps && L('market.amazon.cheaper', `Products cheaper on ${domain} than on the site`, m.gaps.map((g) => `${g.title}: ${g.amazon} vs ${g.site}`).join('; ') || 'none', m.gaps.length, src)].filter(Boolean);
    return { metrics: m, stats, changed, cards: out, ledger, notes, account: { id: domain, name: `${domain} · public listings` } };
  }
};
