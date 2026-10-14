// Stage 4 · reviews: detect the review app from page source and read its public endpoints (totals + recent
// reviews); per-product ratings from JSON-LD; marketplace listings and ratings via treg (Amazon search, and
// Amazon review text for the most-reviewed listing). Verbatims are kept exactly, with rating, date and URL.
import { jsonLd, typeIs, clean, stripTags, pathOf, num, pool, attr, withTimeout } from '../util.js';

const AMAZON = { IN: ['in', 'amazon.in'], US: ['us', 'amazon.com'], GB: ['uk', 'amazon.co.uk'], CA: ['ca', 'amazon.ca'], AU: ['au', 'amazon.com.au'], DE: ['de', 'amazon.de'], FR: ['fr', 'amazon.fr'], AE: ['ae', 'amazon.ae'], JP: ['jp', 'amazon.co.jp'] };
const RESULT = /\b\d+\s*(days?|weeks?|months?)\b|\bdifference\b|\bresults?\b|\bnoticed?\b|\breduced\b|\bless\b|\bthicker\b|\bvisible\b|\bimprov|\bwithin\b|\bafter\b.*\b(use|using)\b|\bcleared?\b|\bsofter\b|\bgone\b/i;

export function detectReviewApp(html) {
  const h = String(html || '');
  if (/judge\.me|jdgm-|judgeme/i.test(h)) return 'judge.me';
  if (/loox\.io|loox-rating/i.test(h)) return 'loox';
  if (/staticw2\.yotpo\.com|yotpo/i.test(h)) return 'yotpo';
  if (/okendo\.io|data-oke-/i.test(h)) return 'okendo';
  if (/stamped\.io|stamped-main-badge/i.test(h)) return 'stamped';
  if (/reviews\.io|reviewsio|widget\.reviews\.co\.uk/i.test(h)) return 'reviews.io';
  if (/bazaarvoice|bvapi|bv-/i.test(h) && /bazaarvoice/i.test(h)) return 'bazaarvoice';
  if (/powerreviews/i.test(h)) return 'powerreviews';
  if (/spr-badge|shopify-product-reviews|productReviews/i.test(h)) return 'shopify product reviews';
  if (/trustpilot/i.test(h)) return 'trustpilot (widget)';
  return null;
}

export async function reviews(ctx) {
  const { http, ledger, profile, state } = ctx; const origin = state.origin;
  const platforms = []; const quotes = []; const notes = [];
  const prods = profile.catalog?.products || [];
  const heroes = (profile.catalog?.hero || []).map((h) => prods.find((p) => p.handle === h)).filter(Boolean);

  // product pages of the heroes: review app + JSON-LD ratings (the site stage reuses these through the cache)
  ctx.tick('reviews', 'product pages');
  const pages = await pool(heroes.slice(0, 5), 5, async (p, i) => { const r = await http.get(state.mq ? `${p.url}?${state.mq}` : p.url, { key: 'hero-pp-' + i }); return r.ok ? { p, html: r.text, url: p.url } : null; });
  const ppHtml = pages.filter((x) => x && x.html);
  state.heroPages = ppHtml;
  const app = detectReviewApp(state.home) || ppHtml.map((x) => detectReviewApp(x.html)).find(Boolean) || null;
  for (const x of ppHtml) {
    // the page's own product, not a recommended one further down
    const norm = (t) => clean(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const ld = jsonLd(x.html).filter((y) => (typeIs(y, 'Product') || typeIs(y, 'ProductGroup')) && y.aggregateRating).find((y) => norm(y.name) === norm(x.p.title) || String(y.url || y['@id'] || '').includes('/products/' + x.p.handle));
    const ar = ld?.aggregateRating; const count = +(ar?.reviewCount || ar?.ratingCount || 0); const rating = +ar?.ratingValue || null;
    if (count) { const pr = prods.find((p) => p.handle === x.p.handle); if (pr) pr.reviews = { count, rating };
      ledger.add({ key: `reviews.product.${x.p.handle}`, label: `${x.p.title} reviews on site`, v: `${num(count)} reviews${rating ? `, ${rating.toFixed(2).replace(/0$/, '')}★` : ''}`, n: count, unit: 'reviews', url: x.url, method: 'jsonld' }); }
  }

  /* the review app's own public feed */
  try {
    if (app === 'judge.me') await judgeme(); else if (app === 'yotpo') await yotpo(); else if (app === 'okendo') await okendo(); else if (app === 'stamped') await stamped(); else if (app === 'loox') await loox(); else if (app === 'reviews.io') await reviewsio();
  } catch (e) { notes.push(`${app}: ${e.message}`); ctx.log.warn?.('[reader] reviews app', app, e.message); }
  if (app && !platforms.some((p) => p.name === app)) {
    // fall back to the JSON-LD counts of the pages we read (a floor, not a total)
    const known = prods.filter((p) => p.reviews?.count); const sum = known.reduce((a, p) => a + p.reviews.count, 0);
    if (sum) platforms.push({ name: app, count: sum, rating: null, url: origin, scope: `JSON-LD on ${known.length} product pages (not the store total)` });
  }
  if (!app) notes.push('No review widget found on the home page or the top product pages.');
  if (app) ledger.add({ key: 'site.tech.review_app', label: 'Review app on the site', v: app, url: state.homeUrl, method: 'crawl' });

  /* marketplaces through treg */
  const mk = AMAZON[profile.country] || null;
  if (ctx.tregOn && mk && profile.name) {
    ctx.tick('reviews', mk[1]);
    try { await withTimeout(amazon(mk), 45e3, 'Amazon'); } catch (e) { notes.push(`Amazon: ${e.message.slice(0, 100)}`); }
  } else if (!ctx.tregOn) notes.push('Marketplaces not checked (treg off).');
  if (profile.country === 'IN') notes.push('Flipkart and Nykaa ratings not read yet.');

  /* pick 3 real quotes: praise, a specific result, one complaint if there is one */
  const pool3 = quotes.filter((q) => q.text && q.text.length >= 25 && q.text.length <= 260 && !/https?:\/\//.test(q.text));
  const used = new Set(); const pick = (fn) => { const q = pool3.filter((x) => !used.has(x.text) && fn(x)).sort((a, b) => (Date.parse(b.at || 0) || 0) - (Date.parse(a.at || 0) || 0))[0]; if (q) used.add(q.text); return q; };
  const chosen = [pick((q) => q.rating >= 4 && RESULT.test(q.text)), pick((q) => q.rating === 5 && !RESULT.test(q.text) && q.text.length < 160), pick((q) => q.rating != null && q.rating <= 2)].filter(Boolean);
  while (chosen.length < 3) { const q = pick((x) => x.rating >= 4); if (!q) break; chosen.push(q); }
  profile.reviews = { platforms, total: platforms.length ? platforms.reduce((a, p) => a + (p.count || 0), 0) : null, quotes: chosen, recent: quotes.slice(0, 40), app, notes };
  if (profile.reviews.total) ledger.add({ key: 'reviews.total', label: 'Reviews and ratings found (all platforms read)', v: num(profile.reviews.total), n: profile.reviews.total, unit: 'reviews+ratings', url: platforms[0]?.url, method: 'crawl', note: platforms.map((p) => `${p.name} ${num(p.count)}${p.scope ? ` (${p.scope})` : ''}`).join('; ') });

  const cap = platforms.length ? platforms.map((p) => `${num(p.count)} ${p.label || p.name}${p.rating ? ` (${p.rating.toFixed(1)}★)` : ''}`).join(' · ') + '.' : 'No reviews found on the site.';
  ctx.finding('reviews', { kind: 'quotes', t: 'How your customers write', src: [...new Set(chosen.map((q) => q.src))].join(' · ') || (app || 'site'), quotes: chosen.map((q) => `“${q.text}”`), items: chosen, cap: chosen.length ? cap : `${cap} No review text could be read.` }, chosen.length ? 'Read real reviews' : undefined);
  ctx.done('reviews', profile.reviews.total ? `${num(profile.reviews.total)} reviews and ratings` : app ? `${app} found, no totals readable` : 'no reviews found', profile.reviews.total ? 'done' : 'empty');

  /* ---------- review apps ---------- */
  async function judgeme() {
    const shop = state.shopifyShop || (state.home.match(/shop_domain['"]?\s*[:=]\s*['"]([\w.-]+\.myshopify\.com)/) || [])[1];
    if (!shop) throw new Error('no myshopify domain on the page');
    ctx.tick('reviews', 'judge.me');
    const base = `https://judge.me/reviews/all_reviews_js_based?shop_domain=${shop}&platform=shopify&per_page=10&review_type=product-reviews&sort_by=created_at&sort_dir=desc`;
    const first = await http.get(base + '&page=1', { as: 'json', key: 'judgeme-1' });
    if (!first.ok || !first.json) throw new Error(`Judge.me feed ${first.status}`);
    const j = first.json; const pagesHtml = [j.html];
    for (const n of [2, 3]) { const r = await http.get(base + '&page=' + n, { as: 'json', key: 'judgeme-' + n }); if (r.ok && r.json?.html) pagesHtml.push(r.json.html); }
    let imported = 0, seen = 0;
    for (const h of pagesHtml) for (const m of String(h).matchAll(/<div class='jdgm-rev [^']*'[^>]*data-review-id='([^']+)'([\s\S]*?)<div class='jdgm-rev__reply'>/g)) {
      const b = m[2]; seen++; if (/review_collected_from_another_provider/.test(b)) imported++;
      const g = (re) => (b.match(re) || [])[1];
      const text = clean(stripTags(g(/<div class='jdgm-rev__body'>([\s\S]*?)<\/div>/) || '')); const title = clean(stripTags(g(/<b class='jdgm-rev__title'>([\s\S]*?)<\/b>/) || ''));
      const handle = (b.match(/href='\/products\/([^'?#]+)'/) || [])[1];
      quotes.push({ text, title, rating: +g(/data-score='(\d)'/) || null, at: (g(/data-content='([^']+)'/) || '').slice(0, 10) || null, product: clean(stripTags(g(/class='jdgm-rev__prod-link'>([\s\S]*?)<\/a>/) || '')) || null, src: 'Judge.me', url: handle ? `${origin}/products/${handle}#judgeme_product_reviews` : `${origin}`, id: 'jdgm:' + m[1], verified: /data-verified-buyer='true'/.test(m[0]) });
    }
    const n = +j.number_of_product_reviews || 0, s = +j.number_of_shop_reviews || 0;
    const src = `https://judge.me/reviews/all_reviews_js_based?shop_domain=${shop}`;
    const note = seen ? `${imported} of the ${seen} newest reviews carry Judge.me's "collected from another provider" badge (imported)` : undefined;
    if (n) { platforms.push({ name: 'judge.me', label: 'Judge.me product reviews', count: n, rating: null, url: src }); ledger.add({ key: 'reviews.judgeme.count', label: 'Judge.me product reviews (store total)', v: num(n), n, unit: 'reviews', url: src, method: 'crawl', note }); }
    if (s) { platforms.push({ name: 'judge.me store', label: 'Judge.me store reviews', count: s, rating: null, url: src }); ledger.add({ key: 'reviews.judgeme.store', label: 'Judge.me store reviews', v: num(s), n: s, unit: 'reviews', url: src, method: 'crawl' }); }
  }
  async function yotpo() {
    const key = (state.home.match(/staticw2\.yotpo\.com\/([A-Za-z0-9]{20,})\//) || state.home.match(/yotpoStoreId\\?":\\?"([A-Za-z0-9]{20,})/) || [])[1];
    if (!key) throw new Error('no Yotpo app key on the page');
    ctx.tick('reviews', 'yotpo');
    const site = await http.get(`https://api-cdn.yotpo.com/v1/widget/${key}/products/yotpo_site_reviews/reviews.json?per_page=20&page=1&sort=date`, { as: 'json', key: 'yotpo-site' });
    const bl = site.json?.response?.bottomline;
    const src = `https://api-cdn.yotpo.com/v1/widget/${key}/products/yotpo_site_reviews/reviews.json`;
    if (bl?.total_review) { platforms.push({ name: 'yotpo site', label: 'Yotpo store reviews', count: +bl.total_review, rating: +bl.average_score || null, url: src }); ledger.add({ key: 'reviews.yotpo.store', label: 'Yotpo store reviews', v: `${num(bl.total_review)} reviews, ${(+bl.average_score).toFixed(2)}★`, n: +bl.total_review, unit: 'reviews', url: src, method: 'crawl' }); }
    for (const r of site.json?.response?.reviews || []) quotes.push({ text: clean(stripTags(r.content)), title: clean(r.title), rating: r.score, at: (r.created_at || '').slice(0, 10), product: null, src: 'Yotpo', url: state.homeUrl, id: 'yotpo:' + r.id });
    // product reviews on the hero products (Shopify product id)
    let sum = 0, nP = 0, wsum = 0;
    await pool(heroes.slice(0, 6), 4, async (p) => {
      const id = (prods.find((x) => x.handle === p.handle) || {}).id || (await productId(p)); if (!id) return;
      const r = await http.get(`https://api-cdn.yotpo.com/v1/widget/${key}/products/${id}/reviews.json?per_page=10&page=1&sort=date`, { as: 'json', key: 'yotpo-p-' + id });
      const b = r.json?.response?.bottomline; if (!b?.total_review) return; sum += +b.total_review; wsum += b.total_review * b.average_score; nP++;
      const pr = prods.find((x) => x.handle === p.handle); if (pr) pr.reviews = { count: +b.total_review, rating: +(+b.average_score).toFixed(2) };
      ledger.add({ key: `reviews.product.${p.handle}`, label: `${p.title} reviews (Yotpo)`, v: `${num(b.total_review)} reviews, ${(+b.average_score).toFixed(2)}★`, n: +b.total_review, unit: 'reviews', url: p.url, method: 'crawl' });
      for (const x of r.json.response.reviews || []) quotes.push({ text: clean(stripTags(x.content)), title: clean(x.title), rating: x.score, at: (x.created_at || '').slice(0, 10), product: p.title, src: 'Yotpo', url: p.url, id: 'yotpo:' + x.id });
    });
    if (sum) platforms.push({ name: 'yotpo', label: `Yotpo reviews on ${nP} top products`, count: sum, rating: wsum / sum, url: src, scope: `${nP} top products only, not the store total` });
  }
  async function okendo() {
    const sub = (state.home.match(/subscriberId\\?["']?\s*[:=]\s*\\?["']([0-9a-f-]{36})/i) || state.home.match(/okendo[^"']*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1];
    if (!sub) throw new Error('no Okendo store id on the page');
    ctx.tick('reviews', 'okendo');
    const agg = await http.get(`https://api.okendo.io/v1/stores/${sub}/review_aggregate`, { as: 'json', key: 'okendo-agg' });
    const a = agg.json?.reviewAggregate; const src = `https://api.okendo.io/v1/stores/${sub}/review_aggregate`;
    if (a?.ratingAndReviewCount) { const n = +a.ratingAndReviewCount, rating = a.ratingAndReviewValuesTotal ? a.ratingAndReviewValuesTotal / n : null;
      platforms.push({ name: 'okendo', label: 'Okendo reviews', count: n, rating, url: src }); ledger.add({ key: 'reviews.okendo.count', label: 'Okendo reviews (store total)', v: `${num(n)} reviews${rating ? `, ${rating.toFixed(2)}★` : ''}`, n, unit: 'reviews', url: src, method: 'crawl' }); }
    for (const page of [0, 1]) {
      const r = await http.get(`https://api.okendo.io/v1/stores/${sub}/reviews?limit=25&orderBy=date%20desc${page ? '&offset=25' : ''}`, { as: 'json', key: 'okendo-rev-' + page });
      for (const x of r.json?.reviews || []) quotes.push({ text: clean(x.body), title: clean(x.title), rating: x.rating, at: (x.dateCreated || '').slice(0, 10), product: clean(x.productName), src: 'Okendo', url: x.productUrl ? 'https:' + x.productUrl.replace(/^https?:/, '') : origin, id: 'oke:' + x.reviewId });
      if (!(r.json?.reviews || []).length) break;
    }
  }
  async function stamped() {
    const key = (state.home.match(/data-api-key=["']([\w-]+)["']/) || state.home.match(/stamped[^"']*apiKey["']?\s*[:=]\s*["']([\w-]+)/i) || [])[1];
    const store = (state.home.match(/data-store-url=["']([\w.-]+)["']/) || [])[1] || state.shopifyShop || profile.host;
    if (!key) throw new Error('no Stamped API key on the page');
    const r = await http.get(`https://stamped.io/api/widget/reviews?storeUrl=${store}&apiKey=${key}&take=30&sort=recent`, { as: 'json', key: 'stamped' });
    const n = +r.json?.total || 0; const src = `https://stamped.io/api/widget/reviews?storeUrl=${store}`;
    if (n) { platforms.push({ name: 'stamped', label: 'Stamped reviews', count: n, rating: +r.json.rating || null, url: src }); ledger.add({ key: 'reviews.stamped.count', label: 'Stamped reviews', v: num(n), n, url: src, method: 'crawl' }); }
    for (const x of r.json?.data || []) quotes.push({ text: clean(x.reviewMessage), title: clean(x.reviewTitle), rating: +x.reviewRating, at: (x.reviewDate || '').slice(0, 10), product: clean(x.productName), src: 'Stamped', url: x.productUrl || origin, id: 'stamped:' + x.id });
  }
  async function loox() {
    // Loox writes each product's rating into the page: <div class="loox-rating" data-rating="4.8" data-raters="123">
    const pageList = [{ html: state.home }, ...ppHtml];
    const coll = await http.get(`${origin}/collections/all`, { key: 'collections-all' }); if (coll.ok) pageList.push({ html: coll.text });
    const seenIds = new Map();
    for (const x of pageList) for (const t of String(x.html).match(/<[^>]+class=["'][^"']*loox-rating[^"']*["'][^>]*>/gi) || []) { const id = attr(t, 'data-id') || attr(t, 'data-product-id'); const n = +attr(t, 'data-raters') || 0; if (id && n) seenIds.set(id, { n, r: +attr(t, 'data-rating') || null }); }
    const sum = [...seenIds.values()].reduce((a, b) => a + b.n, 0);
    if (sum) { platforms.push({ name: 'loox', label: `Loox reviews on ${seenIds.size} products seen`, count: sum, rating: null, url: `${origin}/collections/all`, scope: `${seenIds.size} products on the pages read` }); ledger.add({ key: 'reviews.loox.count', label: 'Loox reviews on the products seen', v: num(sum), n: sum, url: `${origin}/collections/all`, method: 'crawl', note: `${seenIds.size} products; a floor, not the store total` }); }
    else throw new Error('Loox found but no review counts on the pages read');
  }
  async function reviewsio() {
    const store = (state.home.match(/store\s*:\s*['"]([\w-]+)['"]/) || [])[1]; if (!store) throw new Error('no Reviews.io store id');
    const r = await http.get(`https://api.reviews.io/merchant/reviews?store=${store}&per_page=30&page=1`, { as: 'json', key: 'reviewsio' });
    const n = +r.json?.stats?.total_reviews || +r.json?.total || 0; const src = `https://api.reviews.io/merchant/reviews?store=${store}`;
    if (n) { platforms.push({ name: 'reviews.io', label: 'Reviews.io store reviews', count: n, rating: +r.json?.stats?.average_rating || null, url: src }); ledger.add({ key: 'reviews.reviewsio.count', label: 'Reviews.io store reviews', v: num(n), n, url: src, method: 'crawl' }); }
    for (const x of r.json?.reviews || []) quotes.push({ text: clean(x.comments), title: clean(x.title), rating: +x.rating, at: (x.date_created || '').slice(0, 10), product: null, src: 'Reviews.io', url: origin, id: 'rio:' + x.store_review_id });
  }
  async function productId(p) { const r = await http.get(`${origin}/products/${p.handle}.js`, { as: 'json', key: 'pjs-' + p.handle }); return r.json?.id || null; }

  /* ---------- Amazon ---------- */
  async function amazon([country, domain]) {
    const name = profile.name; const nameRe = new RegExp(`(^|\\b)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\b`, 'i');
    const j = await ctx.treg('crawl4ai.amazon.search.products', { body: { keywords: name, country, limit: 60 } }, `${country}-${name}`);
    const rows = (j?.rows || []).filter((r) => r.title && nameRe.test(String(r.title).slice(0, 60)));
    const uniq = [...new Map(rows.map((r) => [r.asin, r])).values()];
    const src = `https://www.${domain}/s?k=${encodeURIComponent(name)}`;
    if (!uniq.length) { notes.push(`No ${name} listings in the ${domain} search.`); ledger.add({ key: 'reviews.amazon.listings', label: `${domain} listings found for "${name}"`, v: '0', n: 0, url: src, method: 'treg:crawl4ai.amazon.search.products' }); return; }
    const total = uniq.reduce((a, r) => a + (+r.reviews || 0), 0); const wr = uniq.reduce((a, r) => a + (+r.reviews || 0) * (+r.rating || 0), 0);
    platforms.push({ name: domain, label: `${domain} ratings on ${uniq.length} listings`, count: total, rating: total ? wr / total : null, url: src, scope: `first search page for "${name}"` });
    ledger.add({ key: 'reviews.amazon.count', label: `${domain} ratings across ${uniq.length} ${name} listings (first search page)`, v: num(total), n: total, unit: 'ratings', url: src, method: 'treg:crawl4ai.amazon.search.products', note: uniq.slice(0, 8).map((r) => `${r.asin} ${r.rating}★ ${r.reviews}`).join('; ') });
    ledger.add({ key: 'reviews.amazon.listings', label: `${domain} listings found for "${name}"`, v: String(uniq.length), n: uniq.length, url: src, method: 'treg:crawl4ai.amazon.search.products' });
    profile.marketplaces = [...(profile.marketplaces || []), { name: domain, listings: uniq.slice(0, 20).map((r) => ({ asin: r.asin, title: clean(r.title).slice(0, 140), price: r.price, rating: r.rating, reviews: r.reviews, url: `https://www.${domain}/dp/${r.asin}` })) }];
    const top = [...uniq].sort((a, b) => (+b.reviews || 0) - (+a.reviews || 0))[0];
    if (!top) return;
    if (domain === 'amazon.com') {
      const rv = await ctx.treg('crawl4ai.amazon.product.reviews', { body: { product: top.asin, limit: 8 } }, top.asin).catch(() => null);
      for (const x of rv?.rows || []) quotes.push({ text: clean(x.text), title: clean(x.title), rating: +x.rating || null, at: x.date, product: clean(top.title).slice(0, 80), src: 'Amazon', url: `https://www.amazon.com/dp/${top.asin}#customerReviews`, id: 'amz:' + x.review_id, verified: !!x.verified });
    } else {
      const r = await ctx.treg('litescrape.web.fetch.post', { query: { timeout: 60 }, body: { url: `https://www.${domain}/dp/${top.asin}`, respond_with: 'text', engine: 'browser', respond_timing: 'network-idle', max_tokens: 12000 }, timeout: 75e3 }, 'dp-' + top.asin).catch(() => null);
      const t = String(r?.text || r?.content || '').split(/Top reviews from other countries/)[0];
      for (const m of t.matchAll(/\n([^\n]+)\n([1-5])(?:\.0)? out of 5 stars\n([^\n]*)\nReviewed in [A-Za-z ]+ on ([^\n]+)\n((?:[A-Z][^\n]{0,30}: [^\n]*\n)*)(?:Verified Purchase\n)?\n?([\s\S]*?)\n(?:[\d,]+ (?:people|person) found this helpful\n)?Helpful\n/g)) {
        const text = m[6].replace(/\s+/g, ' ').trim(); if (text) quotes.push({ text, title: m[3].trim(), rating: +m[2], at: dateOf(m[4]), product: clean(top.title).slice(0, 80), src: 'Amazon', url: `https://www.${domain}/dp/${top.asin}#customerReviews`, id: 'amz:' + top.asin + ':' + text.slice(0, 20) });
      }
    }
  }
}
const dateOf = (s) => { const d = Date.parse(s); return isNaN(d) ? null : new Date(d).toISOString().slice(0, 10); };
