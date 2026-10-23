// Stage 4 · reviews: detect the review app from page source and read its public endpoints (totals + recent
// reviews); per-product ratings from JSON-LD; marketplace listings and ratings via treg (Amazon search, and
// Amazon review text for the most-reviewed listing). Verbatims are kept exactly, with rating, date and URL.
import { jsonLd, typeIs, clean, stripTags, pathOf, num, pool, attr, withTimeout, brandBase } from '../util.js';
import { CLOSED_WHY } from '../closed.js';

const AMAZON = { IN: ['in', 'amazon.in'], US: ['us', 'amazon.com'], GB: ['uk', 'amazon.co.uk'], CA: ['ca', 'amazon.ca'], AU: ['au', 'amazon.com.au'], DE: ['de', 'amazon.de'], FR: ['fr', 'amazon.fr'], AE: ['ae', 'amazon.ae'], JP: ['jp', 'amazon.co.jp'] };
const RESULT = /\b\d+\s*(days?|weeks?|months?)\b|\bdifference\b|\bresults?\b|\bnoticed?\b|\breduced\b|\bless\b|\bthicker\b|\bvisible\b|\bimprov|\bwithin\b|\bafter\b.*\b(use|using)\b|\bcleared?\b|\bsofter\b|\bgone\b/i;

export function detectReviewApp(html) {
  const h = String(html || '');
  if (/judge\.me|jdgm-|judgeme/i.test(h)) return 'judge.me';
  if (/loox\.io|loox-rating/i.test(h)) return 'loox';
  if (/staticw2\.yotpo\.com|cdn-widgetsrepository\.yotpo\.com|class=["'][^"']*yotpo/i.test(h)) return 'yotpo';
  if (/okendo\.io|data-oke-/i.test(h)) return 'okendo';
  if (/stamped\.io|stamped-main-badge/i.test(h)) return 'stamped';
  if (/reviews\.io|reviewsio|widget\.reviews\.co\.uk/i.test(h)) return 'reviews.io';
  /* a vendor counts when its script or widget is on the page, never a config key that names it
     (in.puma.com has "bazaarVoiceReviewFormScriptUrl":null with reviews switched off) */
  if (/apps\.bazaarvoice\.com|display\.ugc\.bazaarvoice\.com|\/bvapi\.js|data-bv-show=/i.test(h)) return 'bazaarvoice';
  if (/ui\.powerreviews\.com|display\.powerreviews\.com|static\.powerreviews\.com|id=["']pr-reviewdisplay/i.test(h)) return 'powerreviews';
  if (/spr-badge|shopify-product-reviews|productReviews/i.test(h)) return 'shopify product reviews';
  if (/widget\.trustpilot\.com|class=["'][^"']*trustpilot-widget/i.test(h)) return 'trustpilot (widget)';
  return null;
}

/** the store switched its reviews off (a headless store's own config says so): reviews are not missing, there are none to read */
export const reviewsOff = (html) => /["'](ratingsAndReviews|reviews|productReviews|ratings)(Enabled|Active)["']\s*:\s*false\b|["'](enable|show|display)(Product)?Reviews["']\s*:\s*false\b/i.test(String(html || ''))
  && !/["'](ratingsAndReviews|reviews|productReviews)(Enabled|Active)["']\s*:\s*true\b/i.test(String(html || ''));

/** bump when reviews start reading differently: heal() reads every saved read with an older version again */
export const REVIEWS_V = 2;

export async function reviews(ctx) {
  const { http, ledger, profile, state } = ctx; const origin = state.origin;
  const platforms = []; const quotes = []; const notes = [];
  const prods = profile.catalog?.products || [];
  const heroes = (profile.catalog?.hero || []).map((h) => prods.find((p) => p.handle === h)).filter(Boolean);

  // product pages of the heroes: review app + JSON-LD ratings (the site stage reuses these through the cache)
  ctx.tick('reviews', 'product pages');
  /* a closed store (stages/admin.js): its product pages are Shopify's password page, so the site's review widgets can't be read */
  const closed = !!state.closed;
  const pages = closed ? [] : await pool(heroes.slice(0, 5), 5, async (p, i) => { const r = await http.get(state.mq ? `${p.url}?${state.mq}` : p.url, { key: 'hero-pp-' + i }); return r.ok ? { p, html: r.text, url: p.url } : null; });
  const ppHtml = pages.filter((x) => x && x.html);
  state.heroPages = ppHtml;
  const app = closed ? null : detectReviewApp(state.home) || ppHtml.map((x) => detectReviewApp(x.html)).find(Boolean) || null;
  for (const x of ppHtml) {
    // the page's own product, not a recommended one further down
    const norm = (t) => clean(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const path = (u) => { try { return new URL(u, x.url).pathname.replace(/\/$/, ''); } catch { return ''; } };
    const ld = jsonLd(x.html).filter((y) => (typeIs(y, 'Product') || typeIs(y, 'ProductGroup')) && y.aggregateRating).find((y) => norm(y.name) === norm(x.p.title) || (y.url || y['@id']) && path(y.url || y['@id']) === path(x.url) || String(y.url || y['@id'] || '').includes('/products/' + x.p.handle));
    const ar = ld?.aggregateRating; const count = +(ar?.reviewCount || ar?.ratingCount || 0); const rating = +ar?.ratingValue || null;
    if (count) { const pr = prods.find((p) => p.handle === x.p.handle); if (pr) pr.reviews = { count, rating };
      ledger.add({ key: `reviews.product.${x.p.handle}`, label: `${x.p.title} reviews on site`, v: `${num(count)} reviews${rating ? `, ${rating.toFixed(2).replace(/0$/, '')}★` : ''}`, n: count, unit: 'reviews', url: x.url, method: 'jsonld' }); }
  }

  /* the review app's own public feed */
  try {
    if (app === 'judge.me') await judgeme(); else if (app === 'yotpo') await yotpo(); else if (app === 'okendo') await okendo(); else if (app === 'stamped') await stamped(); else if (app === 'loox') await loox(); else if (app === 'reviews.io') await reviewsio();
    else if (app === 'bazaarvoice') await bazaarvoice(); else if (app === 'powerreviews') await powerreviews();
  } catch (e) { notes.push(`${app}: ${e.message}`); ctx.log.warn?.('[reader] reviews app', app, e.message); }
  /* an app the page loads by script (Bazaarvoice, PowerReviews, any we have no reader for): the rendered page's JSON-LD ratings */
  if (app && !platforms.some((p) => p.name === app) && !prods.some((p) => p.reviews?.count) && ppHtml.length) {
    await pool(ppHtml.slice(0, 3), 3, async (x, i) => { const rr = await ctx.render(x.url, 'hero-pp-rendered-' + i); const ar = rr && jsonLd(rr.html).find((y) => (typeIs(y, 'Product') || typeIs(y, 'ProductGroup')) && y.aggregateRating)?.aggregateRating;
      const count = +(ar?.reviewCount || ar?.ratingCount || 0); if (count) { const pr = prods.find((p) => p.handle === x.p.handle); if (pr) pr.reviews = { count, rating: +ar.ratingValue || null }; } });
  }
  /* reviews switched off on the store's own pages: not "none found", and not a failure */
  const off = !closed && !app && !prods.some((p) => p.reviews?.count) && [state.home, ...ppHtml.map((x) => x.html)].some(reviewsOff);
  if (app && !platforms.some((p) => p.name === app)) {
    // fall back to the JSON-LD counts of the pages we read (a floor, not a total)
    const known = prods.filter((p) => p.reviews?.count); const sum = known.reduce((a, p) => a + p.reviews.count, 0);
    if (sum) platforms.push({ name: app, count: sum, rating: null, url: origin, scope: `JSON-LD on ${known.length} product pages (not the store total)` });
  }
  if (closed) notes.push(`Review widgets on the site not read: ${CLOSED_WHY}.`);
  else if (off) notes.push('The store has reviews switched off on its own pages.');
  else if (!app) notes.push('No review widget found on the home page or the top product pages.');
  if (app) ledger.add({ key: 'site.tech.review_app', label: 'Review app on the site', v: app, url: state.homeUrl, method: 'crawl' });

  /* marketplaces through treg */
  /* a brand that sells by enquiry (catalog.js storeKind) is not on Amazon, Myntra or Flipkart: its reviews are on Google Maps */
  const enquiry = profile.storeKind === 'enquiry';
  const mk = enquiry ? null : AMAZON[profile.country] || null;
  if (enquiry && ctx.tregOn && !closed) { ctx.tick('reviews', 'Google Maps'); try { await withTimeout(googleMaps(), 60e3, 'Google Maps'); } catch (e) { notes.push(`Google Maps: ${e.message.slice(0, 100)}`); } }
  if (ctx.tregOn && mk && profile.name) {
    ctx.tick('reviews', mk[1]);
    try { await withTimeout(amazon(mk), 45e3, 'Amazon'); } catch (e) { notes.push(`Amazon: ${e.message.slice(0, 100)}`); }
  } else if (!ctx.tregOn) notes.push('Marketplaces not checked (treg off).');
  /* Indian marketplaces through Apify (treg has none): Myntra and Flipkart listings with their ratings, a few reviews.
     A check that fails is kept as { name, error } in checks, never shown as "no listings" */
  const checks = [];
  if (profile.country === 'IN' && !closed && !enquiry) {
    const runs = [['myntra.com', myntra], ['flipkart.com', flipkart]];
    if (!ctx.apify?.live) for (const [n] of runs) checks.push({ name: n, error: ctx.apify ? 'Apify not set up (APIFY_TOKEN)' : 'Apify off for this read' });
    else await Promise.all(runs.map(async ([n, fn]) => { ctx.tick('reviews', n); try { await withTimeout(fn(), 150e3, n); checks.push({ name: n, ok: true }); } catch (e) { checks.push({ name: n, error: e.message.slice(0, 120) }); notes.push(`${n}: ${e.message.slice(0, 100)}`); } }));
  }

  /* pick 3 real quotes: praise, a specific result, one complaint if there is one */
  const pool3 = quotes.filter((q) => q.text && q.text.length >= 25 && q.text.length <= 260 && !/https?:\/\//.test(q.text));
  const used = new Set(); const pick = (fn) => { const q = pool3.filter((x) => !used.has(x.text) && fn(x)).sort((a, b) => (Date.parse(b.at || 0) || 0) - (Date.parse(a.at || 0) || 0))[0]; if (q) used.add(q.text); return q; };
  const chosen = [pick((q) => q.rating >= 4 && RESULT.test(q.text)), pick((q) => q.rating === 5 && !RESULT.test(q.text) && q.text.length < 160), pick((q) => q.rating != null && q.rating <= 2)].filter(Boolean);
  while (chosen.length < 3) { const q = pick((x) => x.rating >= 4); if (!q) break; chosen.push(q); }
  /* onSite: 'found' (the store's own reviews were read), 'off' (switched off by the store), 'unread' (a vendor is there but
     could not be read), 'none' (no reviews on the site); the health card and scorecard branch on it (health.js, moves-cadence.js) */
  const siteFound = platforms.some((p) => !MARKET.test(p.name));
  const onSite = closed ? 'unread' : siteFound ? 'found' : off ? 'off' : app ? 'unread' : 'none';
  profile.reviews = { platforms, total: platforms.length ? platforms.reduce((a, p) => a + (p.count || 0), 0) : null, quotes: chosen, recent: quotes.slice(0, 40), app, notes, onSite, checks, v: REVIEWS_V, at: new Date().toISOString().slice(0, 10), ...(closed ? { closed: true } : {}) }; /* at: the day the counts were read (pack-numbers.js reviews) */
  if (profile.reviews.total) ledger.add({ key: 'reviews.total', label: 'Reviews and ratings found (all platforms read)', v: num(profile.reviews.total), n: profile.reviews.total, unit: 'reviews+ratings', url: platforms[0]?.url, method: 'crawl', note: platforms.map((p) => `${p.name} ${num(p.count)}${p.scope ? ` (${p.scope})` : ''}`).join('; ') });

  const failed = checks.filter((c) => c.error).map((c) => c.name);
  const siteLine = onSite === 'off' ? 'The store has reviews switched off on its own pages.' : onSite === 'unread' && app && !closed ? `${app} is on the site, but its reviews couldn't be read this time; the next refresh tries again.` : '';
  const cap = [platforms.length ? platforms.map((p) => `${num(p.count)} ${p.label || p.name}${p.rating ? ` (${p.rating.toFixed(1)}★)` : ''}`).join(' · ') + '.' : closed ? `Reviews on the site not read: ${CLOSED_WHY}. Brew reads them once the store opens.` : siteLine || 'No reviews found on the site.',
    platforms.length && siteLine ? siteLine : '', failed.length ? `${failed.join(' and ')} couldn't be read this time; the next refresh tries again.` : ''].filter(Boolean).join(' ');
  ctx.finding('reviews', { kind: 'quotes', t: 'How your customers write', src: [...new Set(chosen.map((q) => q.src))].join(' · ') || (app || 'site'), quotes: chosen.map((q) => `“${q.text}”`), items: chosen, cap: chosen.length ? cap : `${cap} No review text could be read.` }, chosen.length ? 'Read real reviews' : undefined);
  ctx.done('reviews', profile.reviews.total ? `${num(profile.reviews.total)} reviews and ratings${onSite === 'off' ? ' (off on the site)' : ''}` : closed ? `not read on the site: ${CLOSED_WHY}` : onSite === 'off' ? 'reviews switched off on the site' : app ? `${app} found, couldn't be read` : 'no reviews found', profile.reviews.total ? 'done' : 'empty', { partial: !!failed.length || onSite === 'unread' });

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
  /* ---------- marketplaces through Apify (India) ---------- */
  async function marketplace(domain, actor, input, how) {
    const name = profile.brandName || brandBase(profile.name, profile.host);
    const nameRe = new RegExp(`(^|\\b)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\b`, 'i');
    const items = await ctx.apify.run(actor, input, { maxItems: 30, maxUsd: 0.25, perItemUsd: 0.004, tag: `reader-${domain}` });
    // the brand's own listings: its name in the brand field or the title's start
    const rows = (items || []).map(listingOf).filter((r) => r.title && (nameRe.test(r.brand || '') || nameRe.test(r.title.slice(0, 60))));
    const src = how(name);
    ledger.add({ key: `reviews.${domain.split('.')[0]}.listings`, label: `${domain} listings found for "${name}"`, v: String(rows.length), n: rows.length, url: src, method: `apify:${actor}` });
    if (!rows.length) { notes.push(`No ${name} listings in the ${domain} search.`); return; }
    const total = rows.reduce((a, r) => a + (r.reviews || 0), 0), wr = rows.reduce((a, r) => a + (r.reviews || 0) * (r.rating || 0), 0);
    if (total) { platforms.push({ name: domain, label: `${domain} ratings on ${rows.length} listings`, count: total, rating: wr / total, listings: rows.length, url: src, scope: `top ${rows.length} search results for "${name}"` });
      ledger.add({ key: `reviews.${domain.split('.')[0]}.count`, label: `${domain} ratings across ${rows.length} ${name} listings`, v: num(total), n: total, unit: 'ratings', url: src, method: `apify:${actor}` }); }
    profile.marketplaces = [...(profile.marketplaces || []).filter((m) => m.name !== domain), { name: domain, listings: rows.slice(0, 20).map((r) => ({ title: r.title.slice(0, 140), price: r.price, rating: r.rating, reviews: r.reviews, url: r.url })) }];
    for (const r of rows) for (const q of r.texts.slice(0, 5)) quotes.push({ text: q.text, rating: q.rating, at: dateOf(q.at), product: r.title.slice(0, 80), src: domain.replace(/\.com$/, '').replace(/^./, (c) => c.toUpperCase()), url: r.url || src, id: `${domain}:${q.text.slice(0, 24)}` });
  }
  function myntra() { return marketplace('myntra.com', 'codingfrontend/myntra-product-search-scraper', { search: profile.brandName || profile.name, brand: profile.brandName || profile.name, sortBy: 'popularity', maxProductsPerSearch: 20, maxPages: 1, scrapeReviews: true, maxReviewsPerProduct: 5 }, (n) => `https://www.myntra.com/${encodeURIComponent(n.toLowerCase().replace(/\s+/g, '-'))}`); }
  function flipkart() { return marketplace('flipkart.com', 'shahidirfan/Flipkart-Product-Scraper', { keyword: profile.brandName || profile.name, results_wanted: 20 }, (n) => `https://www.flipkart.com/search?q=${encodeURIComponent(n)}`); }

  /* ---------- vendors the page loads by script: their public display APIs, with the key the page itself carries ---------- */
  async function bazaarvoice() {
    const all = [state.home, ...ppHtml.map((x) => x.html)].join('\n');
    let key = (all.match(/passkey["']?\s*[:=]\s*["']([A-Za-z0-9]{20,})/i) || [])[1];
    const dep = all.match(/https?:\/\/apps\.bazaarvoice\.com\/deployments\/([\w-]+)\/([\w-]+)\/([\w-]+)\/([\w_-]+)\/bv\.js/i);
    if (!key && dep) { const r = await http.get(dep[0], { key: 'bv-js' }); key = r.ok ? (String(r.text).match(/["']?(?:passkey|apiKey|conversationsApiKey)["']?\s*:\s*["']([A-Za-z0-9]{20,})/i) || [])[1] : null; }
    if (!key) throw new Error('Bazaarvoice key not found on the page');
    const ids = [...new Set([...all.matchAll(/data-bv-product-id=["']([^"']+)/gi)].map((m) => m[1]).concat(heroes.map((p) => p.sku || p.handle)))].slice(0, 10);
    if (!ids.length) throw new Error('no Bazaarvoice product ids on the page');
    const st = await http.get(`https://api.bazaarvoice.com/data/statistics.json?apiversion=5.4&passkey=${key}&stats=Reviews&filter=ProductId:${ids.map(encodeURIComponent).join(',')}`, { as: 'json', key: 'bv-stats' });
    if (!st.ok || st.json?.HasErrors) throw new Error(`Bazaarvoice answered ${st.json?.Errors?.[0]?.Message || st.status || 'an error'}`);
    const rs = (st.json.Results || []).map((x) => x.ProductStatistics?.ReviewStatistics).filter(Boolean);
    const count = rs.reduce((a, x) => a + (+x.TotalReviewCount || 0), 0), wr = rs.reduce((a, x) => a + (+x.TotalReviewCount || 0) * (+x.AverageOverallRating || 0), 0);
    if (count) platforms.push({ name: 'bazaarvoice', count, rating: wr / count, url: origin, scope: `${rs.length} top products (not the store total)` });
    const rv = await http.get(`https://api.bazaarvoice.com/data/reviews.json?apiversion=5.4&passkey=${key}&Filter=ProductId:${encodeURIComponent(ids[0])}&Sort=SubmissionTime:desc&Limit=20`, { as: 'json', key: 'bv-reviews' });
    for (const x of rv.json?.Results || []) quotes.push({ text: clean(x.ReviewText), title: clean(x.Title || ''), rating: +x.Rating || null, at: dateOf(x.SubmissionTime), src: 'site', url: origin, id: 'bv:' + x.Id });
  }
  async function powerreviews() {
    const all = [state.home, ...ppHtml.map((x) => x.html)].join('\n');
    const key = (all.match(/api_key["']?\s*[:=]\s*["']([\w-]{20,})/i) || [])[1], merchant = (all.match(/merchant_id["']?\s*[:=]\s*["']?(\d+)/i) || [])[1];
    if (!key || !merchant) throw new Error('PowerReviews key not found on the page');
    let count = 0, wr = 0;
    await pool(ppHtml.slice(0, 5), 3, async (x) => { const id = (x.html.match(/page_id["']?\s*[:=]\s*["']([^"']+)/i) || [])[1] || x.p.sku || x.p.handle;
      const r = await http.get(`https://display.powerreviews.com/m/${merchant}/l/en_US/product/${encodeURIComponent(id)}/reviews?apikey=${key}&paging.size=10`, { as: 'json', key: 'pr-' + id });
      const ro = r.json?.results?.[0]; const n = +ro?.rollup?.review_count || 0; count += n; wr += n * (+ro?.rollup?.average_rating || 0);
      for (const v of ro?.reviews || []) quotes.push({ text: clean(v.details?.comments || ''), title: clean(v.details?.headline || ''), rating: +v.metrics?.rating || null, at: dateOf(v.details?.created_date), product: x.p.title, src: 'site', url: x.url, id: 'pr:' + v.review_id }); });
    if (count) platforms.push({ name: 'powerreviews', count, rating: wr / count, url: origin, scope: `${Math.min(5, ppHtml.length)} top products (not the store total)` });
  }

  /* the brand's own places on Google Maps (offices, sites, show flats): their ratings and the newest reviews */
  async function googleMaps() {
    const name = profile.brandName || brandBase(profile.name, profile.host), host = profile.host.replace(/^www\./, '');
    const j = await ctx.treg('crawl4ai.google.serp.maps', { body: { query: `${name}${profile.country === 'IN' ? ' India' : ''}`, limit: 10 } }, `maps-${name}`);
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\b`, 'i');
    const places = (j?.rows || []).filter((p) => p.place_id && (String(p.website || '').includes(host.split('.').slice(-2).join('.')) || re.test(p.name || ''))).sort((a, b) => (b.review_count || 0) - (a.review_count || 0)).slice(0, 5);
    const src = `https://www.google.com/maps/search/${encodeURIComponent(name)}`;
    ledger.add({ key: 'reviews.gmaps.places', label: `Google Maps places found for "${name}"`, v: String(places.length), n: places.length, url: src, method: 'treg:crawl4ai.google.serp.maps' });
    if (!places.length) { notes.push(`No ${name} places on Google Maps.`); return; }
    const count = places.reduce((a, p) => a + (+p.review_count || 0), 0), wr = places.reduce((a, p) => a + (+p.review_count || 0) * (+p.rating || 0), 0);
    if (count) { platforms.push({ name: 'google maps', label: `Google reviews on ${places.length} place${places.length === 1 ? '' : 's'}`, count, rating: wr / count, url: src, scope: places.map((p) => p.name).slice(0, 3).join(', ') });
      ledger.add({ key: 'reviews.gmaps.count', label: `Google reviews across ${places.length} ${name} places`, v: num(count), n: count, unit: 'reviews', url: src, method: 'treg:crawl4ai.google.serp.maps', note: places.map((p) => `${p.name} ${p.rating}★ ${p.review_count}`).join('; ') }); }
    const top = places[0];
    const rv = await ctx.treg('crawl4ai.google.maps.reviews', { body: { place: top.place_id, limit: 20, sort: 'newest' } }, 'gmaps-' + top.place_id).catch(() => null);
    for (const x of rv?.rows || []) if (x.text) quotes.push({ text: clean(x.text), rating: +x.rating || null, at: dateOf(x.date), product: clean(top.name).slice(0, 80), src: 'Google Maps', url: x.url || src, id: 'gm:' + x.review_id });
  }

  async function amazon([country, domain]) {
    const name = profile.brandName || brandBase(profile.name, profile.host); /* "PUMA", not "PUMA India": Amazon lists the brand */ const nameRe = new RegExp(`(^|\\b)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\b`, 'i');
    const j = await ctx.treg('crawl4ai.amazon.search.products', { body: { keywords: name, country, limit: 60 } }, `${country}-${name}`);
    const rows = (j?.rows || []).filter((r) => r.title && nameRe.test(String(r.title).slice(0, 60)));
    const uniq = [...new Map(rows.map((r) => [r.asin, r])).values()];
    const src = `https://www.${domain}/s?k=${encodeURIComponent(name)}`;
    if (!uniq.length) { notes.push(`No ${name} listings in the ${domain} search.`); ledger.add({ key: 'reviews.amazon.listings', label: `${domain} listings found for "${name}"`, v: '0', n: 0, url: src, method: 'treg:crawl4ai.amazon.search.products' }); return; }
    const total = uniq.reduce((a, r) => a + (+r.reviews || 0), 0); const wr = uniq.reduce((a, r) => a + (+r.reviews || 0) * (+r.rating || 0), 0);
    platforms.push({ name: domain, label: `${domain} ratings on ${uniq.length} listings`, count: total, rating: total ? wr / total : null, listings: uniq.length, url: src, scope: `first search page for "${name}"` });
    ledger.add({ key: 'reviews.amazon.count', label: `${domain} ratings across ${uniq.length} ${name} listings (first search page)`, v: num(total), n: total, unit: 'ratings', url: src, method: 'treg:crawl4ai.amazon.search.products', note: uniq.slice(0, 8).map((r) => `${r.asin} ${r.rating}★ ${r.reviews}`).join('; ') });
    ledger.add({ key: 'reviews.amazon.listings', label: `${domain} listings found for "${name}"`, v: String(uniq.length), n: uniq.length, url: src, method: 'treg:crawl4ai.amazon.search.products' });
    profile.marketplaces = [...(profile.marketplaces || []).filter((m) => m?.name !== domain) /* a re-read replaces its own entry, never a second amazon.in */, { name: domain, listings: uniq.slice(0, 20).map((r) => ({ asin: r.asin, title: clean(r.title).slice(0, 140), price: r.price, rating: r.rating, reviews: r.reviews, url: `https://www.${domain}/dp/${r.asin}` })) }];
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
const MARKET = /amazon\.|myntra|flipkart|nykaa|google maps/i;
const pickNum = (o, ...ks) => { for (const k of ks) { const v = k.split('.').reduce((a, x) => (a == null ? a : a[x]), o); const n = +String(v ?? '').replace(/[^\d.]/g, ''); if (v != null && v !== '' && !isNaN(n) && n > 0) return n; } return null; };
const pickStr = (o, ...ks) => { for (const k of ks) { const v = k.split('.').reduce((a, x) => (a == null ? a : a[x]), o); if (typeof v === 'string' && v.trim()) return v.trim(); } return null; };
/** one marketplace listing from any actor's row: the field names differ per actor, the meaning doesn't */
export function listingOf(r) {
  return { title: clean(pickStr(r, 'title', 'name', 'productName', 'product_name') || ''), brand: pickStr(r, 'brand', 'brandName', 'brand_name', 'seller'),
    rating: pickNum(r, 'rating', 'averageRating', 'avgRating', 'ratings.average', 'rating.average', 'stars', 'product_rating'),
    reviews: pickNum(r, 'ratingCount', 'ratingsCount', 'ratings_count', 'totalRatings', 'reviewsCount', 'reviewCount', 'reviews_count', 'numberOfRatings', 'rating.count', 'ratings.count'),
    price: pickNum(r, 'price', 'sellingPrice', 'selling_price', 'discountedPrice', 'price.value', 'finalPrice'), url: pickStr(r, 'url', 'productUrl', 'product_url', 'link', 'landingPageUrl'),
    texts: [].concat(r.reviews || r.reviewList || r.topReviews || []).filter((x) => x && typeof x === 'object').map((x) => ({ text: clean(pickStr(x, 'text', 'review', 'reviewText', 'body', 'comment', 'content') || ''), rating: pickNum(x, 'rating', 'stars', 'userRating'), at: pickStr(x, 'date', 'createdAt', 'reviewDate', 'time') })).filter((x) => x.text) };
}
const dateOf = (s) => { const d = Date.parse(s); return isNaN(d) ? null : new Date(d).toISOString().slice(0, 10); };
