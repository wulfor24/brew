// The order a catalog card lists its products in (QA FEED-ARV-08): the ones that sell most first, by the best signal Brew holds,
// and the card says which. Units sold in 30 days (a connected Shopify, team only), else the store's own best-seller list, else
// review counts, else price. Products our cards and ads point to always lead. Pure: no reads, no calls.
export const handleOf = (i) => i?.handle || String(i?.url || '').split('?')[0].split('/products/')[1]?.split('/')[0] || null;

/* rank: { hero: [handle…] best sellers first, bestSellers: the hero list is the store's own sales order, reviews: {handle: n} };
   units: Map(lower-case title → units sold); quoted: Set(handle) of products our cards and ads point to */
export function salesRank(items = [], { rank = {}, units = new Map(), quoted = new Set() } = {}) {
  const u = (i) => units.get(String(i.title || '').trim().toLowerCase()) || 0, hero = rank.hero || [];
  const bi = (i) => { const k = hero.indexOf(handleOf(i)); return k < 0 ? 1e6 : k; }, rv = (i) => +rank.reviews?.[handleOf(i)] || 0, q = (i) => (quoted.has(handleOf(i)) ? 1 : 0);
  const by = items.some((i) => u(i)) ? 'units' : rank.bestSellers && items.some((i) => bi(i) < 1e6) ? 'best' : items.some((i) => rv(i)) ? 'reviews' : 'price';
  const sorted = [...items].sort((a, b) => q(b) - q(a) || (by === 'units' ? u(b) - u(a) : 0) || (by === 'units' || by === 'best' ? bi(a) - bi(b) : 0) || rv(b) - rv(a) || (+b.price || 0) - (+a.price || 0));
  const said = { units: 'most sold in the last 30 days (Shopify)', best: 'the store’s own best sellers', reviews: 'most reviewed', price: 'highest price (no sales numbers yet)' }[by];
  return { sorted, by, said: items.some(q) ? `products our ads point to, then ${said}` : said };
}

/* "Title (12); Other (4)": the best sellers line a connected Shopify writes (connectors/shopify.js shopify.top.30d) */
export const unitsFrom = (v) => { const m = new Map(); String(v || '').split(/;\s*/).forEach((s) => { const r = s.match(/^(.*)\s\((\d+)\)$/); if (r) m.set(r[1].trim().toLowerCase(), +r[2]); }); return m; };
