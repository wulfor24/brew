// Where a brand sells, read from the outside: quick-commerce shelves (Blinkit, Zepto, Instamart: price, MRP, stock and delivery
// time, by city), marketplaces (Nykaa, Flipkart, Myntra: price, rating, reviews) and web traffic (Similarweb). Apify actors,
// each platform with a backup actor that was probed on real brands (tools/probe-sources.mjs, 23 Oct): when the first fails or
// returns nothing usable, the next one runs. Every row is matched to the brand or a rival by name, so a fuzzy search hit
// ("NutroVally" for Nutrova) never counts. An error stays an error: a platform that could not be read says so, never "not sold there".
// Spend: each run carries its own cap, and a brand's month of Apify spend stops at APIFY_BRAND_MONTH_CAP_USD (default $10).
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = (v) => { if (v == null || v === '') return null; const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/* a row is a name's when its brand field is that name, or its title starts with it (or names it as a word) */
export function nameRe(name) { const words = String(name || '').trim().split(/\s+/).map(esc).join('[\\s-]*'); return new RegExp(`(^|[^a-z0-9])${words}($|[^a-z0-9])`, 'i'); }
/* "Arata India" is Arata; "NutroVally" is not Nutrova */
const TAIL = /^(india|in|official|store|shop|labs|co|global|beauty|naturals|nutrition|wellness)$/;
export function whoseRow(row, who) {
  const brand = flat(row.brand), title = String(row.name || '');
  for (const w of who) { const f = flat(w.name); if (!f) continue; if (brand && (brand === f || (brand.startsWith(f) && TAIL.test(brand.slice(f.length))))) return w; if (!brand && nameRe(w.name).test(title)) return w; if (brand && f.length >= 4 && nameRe(w.name).test(title) && title.toLowerCase().startsWith(String(w.name).toLowerCase())) return w; }
  return null;
}

/* the platforms: which market, which actors in order, how to ask each, and how to read a row into one shape */
export const PLATFORMS = {
  blinkit: { kind: 'shelf', label: 'Blinkit', market: 'IN', home: 'https://blinkit.com', actors: [
    { id: 'memo23/blinkit-scraper', input: (qs, city) => ({ searchQueries: qs, locations: [city.area], productsLimit: 10, maxItems: qs.length * 10, includeEtaDetails: true }), start: 0.005, per: 0.003 },
    { id: 'krazee_kaushik/blinkit-product-results-scraper', input: (qs, city) => ({ searchQueries: qs, locations: [city.area], productsLimit: 10 }), start: 0.0001, per: 0.004 }],
    row: (r) => ({ name: r.name, brand: r.brand, price: num(r.price), mrp: num(r.mrp), inStock: r.inStock ?? (r.out_of_stock == null ? null : !r.out_of_stock), eta: num(r.etaMinutes ?? r.eta_in_minutes), rating: num(r.rating ?? r.rating_value), unit: r.unit || r.variant || null, url: r.productUrl || r.product_url || null, image: r.imageUrl || (Array.isArray(r.images) ? r.images[0] : null), q: r.query || r.search_keyword }) },
  zepto: { kind: 'shelf', label: 'Zepto', market: 'IN', home: 'https://www.zepto.com', actors: [
    { id: 'memo23/zepto-product-scraper', input: (qs, city) => ({ searchQueries: qs, locations: [city.area], maxItemsPerQuery: 10, maxItems: qs.length * 10 }), start: 0.0005, per: 0.0012 },
    { id: 'shahidirfan/zepto-product-scraper', input: (qs) => ({ query: qs[0], results_wanted: 10, max_pages: 1 }), start: 0.0005, per: 0.001, one: true }],
    row: (r) => ({ name: r.name, brand: r.brand, price: num(r.sellingPrice ?? r.discountedPrice ?? r.selling_price ?? r.price), mrp: num(r.mrp), inStock: r.inStock ?? (r.available_quantity == null ? null : r.available_quantity > 0), eta: null, rating: num(r.rating), unit: r.packSize || r.formatted_packsize || null, url: r.productUrl || null, image: Array.isArray(r.images) ? r.images[0] : null, q: r.sourceQuery || r.search_query }) },
  instamart: { kind: 'shelf', label: 'Instamart', market: 'IN', home: 'https://www.swiggy.com/instamart', actors: [
    { id: 'solidcode/swiggy-scraper', input: (qs, city) => ({ searchQueries: qs, city: city.name, maxResults: qs.length * 10 }), start: 0.005, per: 0.0048, retry: 1 /* Swiggy limits a run now and then; a minute later it reads */ }],
    row: (r) => ({ name: r.name, brand: r.brand, price: num(r.price), mrp: num(r.mrp), inStock: r.inStock ?? null, eta: null, rating: num(r.rating), unit: r.quantity || null, url: r.productUrl || null, image: r.imageUrl || null, q: r.sourceQuery, ad: !!r.isAd }) },
  nykaa: { kind: 'marketplace', label: 'Nykaa', market: 'IN', home: 'https://www.nykaa.com', actors: [
    { id: 'automation_craft/nykaa-scraper', input: (qs) => ({ searchTerms: qs, maxItemsPerSearch: 6, maxItems: qs.length * 6, includeReviews: true }), start: 0.006, per: 0.0027 }],
    row: (r) => ({ name: r.name || r.productTitle, brand: r.brand, price: num(r.price), mrp: num(r.mrp), inStock: r.inStock ?? null, rating: num(r.rating), ratings: num(r.ratingCount), url: r.url || null, image: r.image || null, id: r.productId }),
    review: (r) => ({ pid: r.productId, url: r.productUrl, product: r.productName, rating: num(r.rating), title: r.title, text: r.text, author: r.reviewerName, verified: !!r.isVerifiedBuyer, at: r.reviewedAt }) },
  flipkart: { kind: 'marketplace', label: 'Flipkart', market: 'IN', home: 'https://www.flipkart.com', actors: [
    { id: 'scrapesage/flipkart-scraper', input: (qs) => ({ searchTerms: qs, maxProducts: 5, maxPagesPerSearch: 1, includeReviews: true, maxReviewsPerProduct: 5 }), start: 0.005, per: 0.002 },
    { id: 'shahidirfan/Flipkart-Product-Scraper', input: (qs) => ({ keyword: qs[0], results_wanted: 8 }), start: 0.0005, per: 0.0015, one: true }],
    row: (r) => ({ name: r.title || r.name, brand: r.brand, price: num(r.price), mrp: num(r.mrp ?? r.original_price), inStock: r.inStock ?? null, rating: num(r.rating), ratings: num(r.ratingCount ?? r.rating_count), url: r.url || null, image: r.image || null, id: r.productId || r.id, rank: r.searchRank ?? null }),
    review: (r) => ({ pid: r.productId, url: r.reviewUrl || r.productUrl, product: r.productTitle, rating: num(r.rating), title: r.title, text: r.text, author: r.author, verified: !!r.certifiedBuyer, at: r.dateISO || r.date }) },
  myntra: { kind: 'marketplace', label: 'Myntra', market: 'IN', home: 'https://www.myntra.com', actors: [
    { id: 'codingfrontend/myntra-product-search-scraper', input: (qs) => ({ search: qs[0], sortBy: 'popularity', maxProductsPerSearch: 5, maxPages: 1, scrapeReviews: false }), start: 0.0001, per: 0.004, one: true }],
    row: (r) => ({ name: r.name, brand: r.brand, price: num(r.price), mrp: num(r.mrp), inStock: null, rating: num(r.rating), ratings: num(r.ratingCount), url: r.url || null, image: r.imageUrl || null, id: r.productId }) }
};
export const TRAFFIC = [
  { id: 'curious_coder/similarweb-scraper', input: (hosts) => ({ domains: hosts }), start: 0.001, per: 0.003 },
  { id: 'tri_angle/similarweb-scraper', input: (hosts) => ({ websites: hosts }), start: 0.001, per: 0.013 }];

const pyObj = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(String(v).replace(/'/g, '"').replace(/\bNone\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false')); } catch { return null; } };
export function trafficRow(r) {
  const host = String(r.domain || (/similarweb\.com/.test(r.url || '') ? r.name : r.url) || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const months = pyObj(r.estimatedMonthlyVisits) || pyObj(r.engagments?.monthlyVisits) || null, src = pyObj(r.trafficSources) || null;
  const visits = num(r.visits ?? r.totalVisits ?? r.engagements?.visits) ?? (months ? num(Object.values(months).slice(-1)[0]) : null);
  return { host, visits, months: months ? Object.entries(months).map(([m, v]) => ({ m: m.slice(0, 7), v: num(v) })) : [], sources: src ? Object.fromEntries(Object.entries(src).filter(([, v]) => v != null).map(([k, v]) => [k, Math.round(+v * 100)])) : null,
    bounce: r.bounceRate != null ? Math.round(+r.bounceRate * 100) : null, rank: num(r.globalRank ?? r.globalRank?.rank), snapshot: r.snapshotDate || null };
}

/* the brand's month of Apify spend (spend/<YYYY-MM>.json rows tagged apify…) */
export async function apifyMonthUsd(packs, slug, now = new Date()) {
  const f = await packs.getJSON(slug, `spend/${now.toISOString().slice(0, 7)}.json`, null).catch(() => null);
  return +((f?.rows || []).filter((r) => /^apify/.test(r.tag || '')).reduce((a, r) => a + (r.usd || 0), 0)).toFixed(4);
}
export const brandCapUsd = () => (Number.isFinite(+process.env.APIFY_BRAND_MONTH_CAP_USD) && process.env.APIFY_BRAND_MONTH_CAP_USD !== '' ? +process.env.APIFY_BRAND_MONTH_CAP_USD : 10);

export function createShelf({ slug, packs, apify, log = console, now = () => new Date(), monthUsd = () => apifyMonthUsd(packs, slug, now()) }) {
  const tag = `shelf-${slug}`;
  /* run a platform's actors in order: the first that returns rows wins; every failure is kept for the note */
  async function chain(actors, extra = {}) {
    if (!apify?.live) throw Object.assign(new Error('needs APIFY_TOKEN'), { needs: true });
    const cap = brandCapUsd(), used = await monthUsd(); if (used >= cap) throw Object.assign(new Error(`skipped: this month's Apify budget ($${cap}) is used`), { capped: true });
    const errs = [];
    for (const a of actors) {
      for (let k = 0; k <= (a.retry || 0); k++) try { if (k) await new Promise((r) => setTimeout(r, a.retryMs ?? (process.env.APIFY_RETRY_MS ? +process.env.APIFY_RETRY_MS : 45e3))); const rows = await apify.run(a.id, a.input(), { tag, startUsd: a.start, perItemUsd: a.per, maxUsd: extra.maxUsd ?? 0.25, maxItems: extra.maxItems ?? 60, timeoutSecs: 200 });
        if (rows.length) return { rows, actor: a.id }; errs.push(`${a.id}: no rows`); break; }
      catch (e) { errs.push(`${a.id}: ${String(e.message).slice(0, 120)}`); }
    }
    throw new Error(errs.join(' · ') || 'no actor ran');
  }
  /* one platform for the brand and its rivals: their rows, matched by name. who = [{ name, own }] */
  async function platform(key, who, { city = null } = {}) {
    const P = PLATFORMS[key], own = who.filter((w) => w.own).map((w) => w.name), rv = who.filter((w) => !w.own).map((w) => w.name).slice(0, 5);
    /* the brand's own search runs alone (a shared run's item cap can fill up with rival rows first); the rivals share a second run */
    const runFor = (qs) => chain(P.actors.filter((a) => !a.one || qs.length === 1).map((a) => ({ ...a, input: () => a.input(qs, city) })), { maxItems: qs.length * 14 + 20 });
    const first = await runFor(own); let rows = first.rows, actor = first.actor;
    if (rv.length && !P.actors.every((a) => a.one)) try { rows = rows.concat((await runFor(rv)).rows); } catch (e) { log.warn?.(`[shelf] ${key} rivals`, e.message); }
    const items = [], reviews = [], seenRow = new Set(); /* the brand's run and the rivals' run can both return the same listing */
    for (const r of rows) {
      if (P.review && /review/i.test(r.type || r.rowType || r.recordType || '')) { const x = P.review(r); if (x.text) reviews.push(x); continue; }
      const x = P.row(r); if (!x.name) continue; const w = whoseRow(x, who); if (!w) continue; const k = `${w.name}|${x.id || x.url || x.name}`; if (seenRow.has(k)) continue; seenRow.add(k); items.push({ ...x, who: w.name, own: !!w.own });
    }
    const byName = Object.fromEntries(who.map((w) => [w.name, items.filter((x) => x.who === w.name)]));
    const ownIds = new Set(items.filter((x) => x.own).map((x) => String(x.id || x.url || '')));
    const ownReviews = reviews.filter((r) => ownIds.has(String(r.pid || '')) || ownIds.has(String(r.url || '')) || (r.product && who.find((w) => w.own && nameRe(w.name).test(r.product))));
    return { platform: key, label: P.label, kind: P.kind, city: city?.name || null, actor, at: now().toISOString(), byName, reviews: ownReviews.slice(0, 30), rivalReviews: reviews.filter((r) => !ownReviews.includes(r)).slice(0, 30) };
  }
  async function traffic(hosts) {
    const { rows, actor } = await chain(TRAFFIC.map((a) => ({ ...a, input: () => a.input(hosts) })), { maxItems: hosts.length + 2, maxUsd: 0.1 });
    return { actor, at: now().toISOString(), rows: rows.map(trafficRow).filter((r) => r.host) };
  }
  return { platform, traffic };
}
