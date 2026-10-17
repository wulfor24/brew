// Stage 3 · catalog: Shopify products.json + collections.json, WooCommerce Store API, or JSON-LD Product on the
// product pages in the sitemap. Live prices with currency, MRP, packs, stock, images, launch dates, claim lines.
// Hero packshots: the store's own best-seller order when it has one, else the main collection's order.
import { jsonLd, typeIs, clean, stripTags, pathOf, money, num, pool, hostOf, meta, links } from '../util.js';
import { moneyFmt } from '../../brand-pack.js'; // the price label the check page prints (build.js normalizeProfile)

const PACK = /\bpack of \d+|\b\d+\s?x\s?\d+|\bcombo\b|\bkit\b|\bbundle\b|\bset of\b|\bduo\b|\btrio\b|\bregimen\b|\broutine\b|\bvalue pack\b|\bgift set\b/i;
const CLAIM = /(\d+(\.\d+)?\s?%|\bup to\b|\bclinically\b|\bdermatologist|\bproven\b|\bstudy\b|\btested\b|\bin \d+ (days|weeks)|\b\d+[xX]\b|\bcertified\b|\bno\. ?1\b|#1\b)/i;
const NOT_PRODUCT = /gift ?wrap|gift ?card|e-?gift|shipping protection|route protection|insurance|sample|tester|donation/i; // what the check page leaves out (build.js checkData)
const NONPRODUCT = /gift ?card|e-?gift|shipping protection|route|insurance|free gift|freebie|sample|tester|donation|\bwarranty\b|\bfee\b/i;

export async function catalog(ctx) {
  const { http, ledger, profile, state } = ctx; const origin = state.origin; const cur = profile.currency;
  let products = [], collections = [], how = null;

  // Shopify answers products.json in the visitor's market (a store can show INR to a visit from India): ask
  // for the home market explicitly so prices match the shop currency
  const mk = state.shopMeta?.country ? `&country=${state.shopMeta.country}` : '';
  if (profile.platform === 'shopify') {
    ctx.tick('catalog', '/products.json');
    for (let page = 1; page <= 12; page++) {
      const r = await http.get(`${origin}/products.json?limit=250&page=${page}${mk}`, { as: 'json', key: `products-${page}`, ms: 30e3 });
      const ps = r.ok ? r.json?.products || [] : []; products.push(...ps); if (ps.length < 250) break;
    }
    ctx.tick('catalog', '/collections.json');
    for (let page = 1; page <= 4; page++) {
      const r = await http.get(`${origin}/collections.json?limit=250&page=${page}`, { as: 'json', key: `collections-${page}` });
      const cs = r.ok ? r.json?.collections || [] : []; collections.push(...cs); if (cs.length < 250) break;
    }
    products = products.map((p) => shopifyItem(p, origin, cur));
    how = 'products.json';
  }
  if (!products.length && profile.platform === 'woocommerce') {
    ctx.tick('catalog', '/wp-json/wc/store/v1/products');
    for (let page = 1; page <= 10; page++) {
      const r = await http.get(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { as: 'json', key: `wc-products-${page}` });
      const ps = r.ok && Array.isArray(r.json) ? r.json : []; products.push(...ps.map((p) => wooItem(p))); if (ps.length < 100) break;
    }
    if (products.length) how = 'woocommerce store api';
  }
  if (!products.length) {
    // JSON-LD on product pages from the sitemap (or the home page's product links)
    const all = state.pageUrls || [];
    let pu = all.filter((u) => /\/(products?|p|item|shop)\/[^/]+|\/[^/]+\/p\/|\.html$|\/dp\//i.test(new URL(u).pathname) && !/\/(collections?|category|categories|blog|pages?)\//i.test(u));
    if (!pu.length) pu = (state.homeLinks || []).map((l) => l.url).filter((u) => hostOf(u) === hostOf(origin) && /\/(products?|p)\/|\.html$/i.test(new URL(u).pathname));
    pu = [...new Set(pu.map((u) => u.split('?')[0]))];
    ctx.state.productPageCount = pu.length;
    const sample = pu.slice(0, 30);
    await pool(sample, 6, async (u, i) => {
      if (i % 5 === 0) ctx.tick('catalog', pathOf(u).replace(profile.host, ''));
      let r = await http.get(u, { key: 'pp-' + i });
      let html = r.ok ? r.text : null;
      if (!html || !/ld\+json/i.test(html)) { const rr = await ctx.render(u, 'pp-' + i + '-rendered'); if (rr) html = rr.html; }
      if (!html) return;
      const ld = jsonLd(html).find((x) => typeIs(x, 'Product') || typeIs(x, 'ProductGroup'));
      if (ld) products.push(ldItem(ld, r.url || u, html));
    });
    if (products.length) how = `jsonld (${sample.length} of ${pu.length} product pages read)`;
  }

  products = products.filter((p) => p && p.title && !NONPRODUCT.test(p.title + ' ' + (p.type || '')));
  const currency = products.find((p) => p.currency)?.currency || cur;
  products.forEach((p) => (p.currency ||= currency));
  if (!profile.currency && currency) profile.currency = currency;

  // order: the store's own best-selling sort → a best-seller collection → main collection order
  let order = null, orderHow = null;
  if (profile.platform === 'shopify') {
    const bs = collections.find((c) => /best-?sell|bestseller|top-?sell|most-?loved|most-?popular|top-?rated/i.test(c.handle + ' ' + c.title));
    if (bs) { const r = await http.get(`${origin}/collections/${bs.handle}/products.json?limit=50${mk}`, { as: 'json', key: 'bestsellers' }); if (r.ok && r.json?.products?.length) { order = r.json.products.map((p) => p.handle); orderHow = `the "${clean(bs.title)}" collection`; } }
    if (!order) { const r = await http.get(`${origin}/collections/all?sort_by=best-selling${mk}`, { key: 'all-best-selling' });
      if (r.ok && r.text) { const hs = [...new Set([...r.text.matchAll(/\/products\/([a-z0-9][a-z0-9-]*)/gi)].map((m) => m[1].toLowerCase()))].filter((h) => products.some((p) => p.handle === h)); if (hs.length >= 3) { order = hs; orderHow = 'the store\'s best-selling sort (/collections/all?sort_by=best-selling)'; } } }
  }
  const rank = (p) => { const i = order ? order.indexOf(p.handle) : -1; return i < 0 ? 1e4 + products.indexOf(p) : i; };
  const sellable = products.filter((p) => p.price > 0);
  const ranked = [...sellable].sort((a, b) => rank(a) - rank(b));
  const singles = ranked.filter((p) => !p.pack);
  const hero = [...singles, ...ranked.filter((p) => p.pack)].slice(0, 8);

  // packshots
  ctx.tick('catalog', 'packshots');
  const shots = [];
  await pool(hero.filter((p) => p.images[0]).slice(0, 8), 4, async (p) => {
    const src = sizeUp(p.images[0]); const a = await ctx.asset(src, `pack-${p.handle}`.slice(0, 80), { max: 8e6 }); if (a) { p.img = a; shots.push(a); }
  });
  /* the onboarding's product taps: the rows the check page shows (build.js checkData), hero first, prices as the brand writes them */
  if (products.length && ctx.picks) { const fmt = moneyFmt(profile.currency || currency || 'INR', profile.locale || 'en-IN');
    ctx.picks('catalog', [...hero, ...products.filter((p) => !hero.includes(p))].filter((p) => !NOT_PRODUCT.test(p.title || '')).slice(0, 12).map((p) => ({ handle: p.handle, title: p.title, price: p.price > 0 ? fmt(p.price) : '', img: p.img || p.images.find((u) => /^https?:/.test(u)) || null }))); }

  // ledger: every price and count
  const collOut = [];
  for (const c of collections.slice(0, 200)) collOut.push({ handle: c.handle, title: clean(c.title), count: c.products_count ?? null });
  profile.catalog = {
    count: products.length, collections: collOut,
    products: products.map((p) => ({ ...(p.id ? { id: p.id } : {}), handle: p.handle, title: p.title, type: p.type || null, price: p.price || null, mrp: p.mrp || null, currency: p.currency || null, inStock: p.inStock, variants: p.variants, images: p.images.slice(0, 6), img: p.img || null, url: p.url, published: p.published || null, tags: p.tags || [], claims: p.claims || [], pack: !!p.pack, reviews: p.reviews || null })),
    hero: hero.map((p) => p.handle), order: orderHow || 'catalog order', source: how
  };
  if (products.length) ledger.add({ key: 'catalog.count', label: 'Products in the catalog', v: String(products.length), n: products.length, unit: 'products', url: how === 'products.json' ? `${origin}/products.json` : origin, method: how?.startsWith('jsonld') ? 'jsonld' : how || 'crawl', note: how?.startsWith('jsonld') ? `only product pages read so far; ${ctx.state.productPageCount || 0} product URLs in the sitemap` : undefined });
  if (collections.length) ledger.add({ key: 'catalog.collections', label: 'Collections', v: String(collections.length), n: collections.length, url: `${origin}/collections.json`, method: 'products.json' });
  const packs = products.filter((p) => p.pack); if (products.length) ledger.add({ key: 'catalog.packs', label: 'Packs, kits and bundles', v: String(packs.length), n: packs.length, url: `${origin}/products.json`, method: how?.startsWith('jsonld') ? 'jsonld' : 'products.json', layer: 'inferred', conf: 'medium', note: 'titles that say pack/kit/combo/set/duo/trio' });
  const oos = products.filter((p) => p.inStock === false); if (products.length) ledger.add({ key: 'catalog.out_of_stock', label: 'Products out of stock', v: String(oos.length), n: oos.length, url: `${origin}/products.json`, method: how?.startsWith('jsonld') ? 'jsonld' : 'products.json' });
  for (const p of products.slice(0, 400)) {
    if (p.price > 0) ledger.add({ key: `price.${p.handle}`, label: `${p.title} price`, v: money(p.price, p.currency), n: p.price, unit: p.currency, url: p.url, method: how?.startsWith('jsonld') ? 'jsonld' : how === 'products.json' ? 'products.json' : 'crawl' });
    if (p.mrp > p.price) ledger.add({ key: `mrp.${p.handle}`, label: `${p.title} list price (compare-at)`, v: money(p.mrp, p.currency), n: p.mrp, unit: p.currency, url: p.url, method: how === 'products.json' ? 'products.json' : 'jsonld' });
  }
  const dated = products.filter((p) => p.published).sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  const newest = dated.find((p) => !p.pack) || dated[0];
  if (newest) ledger.add({ key: 'catalog.newest', label: 'Newest product (published date)', v: `${newest.title}, ${newest.published.slice(0, 10)}`, url: newest.url, method: 'products.json', note: 'Shopify published_at: the date it went live in this store, which can differ from a launch date' });
  if (order) ledger.add({ key: 'catalog.order', label: 'Best-seller order used for heroes', v: orderHow, url: origin, method: 'crawl' });

  // findings
  if (!products.length) {
    ctx.finding('catalog', { kind: 'rows', t: 'The catalog', src: pathOf(origin), rows: [], cap: 'No product catalog found on the site.' });
    return ctx.done('catalog', 'no products found', 'empty');
  }
  const top = hero.slice(0, 5);
  const rows = top.map((p) => [shortTitle(p.title), p.mrp > p.price ? `${money(p.price, p.currency)} (MRP ${money(p.mrp, p.currency)})` : money(p.price, p.currency)]);
  const partial = how?.startsWith('jsonld') && (ctx.state.productPageCount || 0) > products.length;
  const capBits = [partial ? `${num(ctx.state.productPageCount, currency)} product pages in the sitemap, ${products.length} read.` : `${num(products.length, currency)} products.`];
  if (newest) capBits.push(`Newest: ${shortTitle(newest.title)}, ${fmtDate(newest.published)}.`);
  ctx.finding('catalog', { kind: 'rows', t: 'The catalog', src: pathOf(how === 'products.json' ? `${origin}/products.json` : origin), rows, cap: capBits.join(' '), order: orderHow || 'catalog order' }, 'Read live prices');
  if (shots.length) ctx.finding('catalog', { kind: 'grid', t: 'Packshots on your site', src: pathOf(origin + '/products'), imgs: shots.slice(0, 4), all: shots, cap: `${shots.length} product photos saved${orderHow ? `, best sellers first (${orderHow.replace(/ \(.*\)/, '')})` : ''}.` }, 'Saved the packshots');
  const types = new Set(products.map((p) => p.type).filter(Boolean));
  ctx.done('catalog', `${partial ? `${num(ctx.state.productPageCount, currency)} product pages, ${products.length} read` : `${num(products.length, currency)} products`}${collections.length ? `, ${collections.length} collections` : types.size ? `, ${types.size} types` : ''}`);
}

function shopifyItem(p, origin, cur) {
  const vs = p.variants || []; const avail = vs.filter((v) => v.available);
  const v = avail[0] || vs[0] || {}; const price = +v.price || 0; const mrp = Math.max(+v.compare_at_price || 0, 0);
  const body = stripTags(p.body_html || '');
  return { handle: p.handle, title: clean(p.title), type: clean(p.product_type), vendor: clean(p.vendor), price, mrp: mrp > price ? mrp : null, currency: cur || null,
    inStock: vs.some((x) => x.available), variants: vs.length, images: (p.images || []).map((i) => i.src), url: `${origin}/products/${p.handle}`, published: p.published_at || p.created_at || null,
    tags: (Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',')).map((t) => clean(t)).filter(Boolean).slice(0, 30), claims: claimsOf(body), pack: PACK.test(p.title), id: p.id };
}
function wooItem(p) {
  const minor = +(p.prices?.currency_minor_unit ?? 2); const f = (x) => (x == null || x === '' ? null : +x / 10 ** minor);
  const price = f(p.prices?.price) || 0, reg = f(p.prices?.regular_price);
  return { handle: p.slug, title: clean(stripTags(p.name)), type: clean(p.categories?.[0]?.name || ''), price, mrp: reg > price ? reg : null, currency: p.prices?.currency_code || null, inStock: !!p.is_in_stock, variants: (p.variations || []).length || 1, images: (p.images || []).map((i) => i.src), url: p.permalink, published: null, tags: (p.tags || []).map((t) => t.name), claims: claimsOf(stripTags(p.description || p.short_description || '')), pack: PACK.test(p.name), reviews: p.review_count ? { count: +p.review_count, rating: +p.average_rating || null } : null };
}
function ldItem(ld, url, html) {
  const offers = [].concat(ld.offers || ld.hasVariant?.flatMap?.((v) => [].concat(v.offers || [])) || []).flatMap((o) => (o && o['@type'] === 'AggregateOffer' ? [{ price: o.lowPrice, priceCurrency: o.priceCurrency, availability: o.availability }].concat(o.offers || []) : [o])).filter(Boolean);
  const o = offers.find((x) => x.price != null) || {};
  const price = +String(o.price ?? '').replace(/[^\d.]/g, '') || 0;
  const list = offers.map((x) => +(x.priceSpecification?.price ?? NaN)).find((x) => x > price) || null;
  const imgs = [].concat(ld.image || []).map((i) => (typeof i === 'string' ? i : i.url || i.contentUrl)).filter(Boolean);
  const handle = new URL(url).pathname.split('/').filter(Boolean).pop().replace(/\.html$/, '').toLowerCase().slice(0, 80);
  const ar = ld.aggregateRating;
  return { handle, title: clean(ld.name), type: clean(typeof ld.category === 'string' ? ld.category : ''), price, mrp: list, currency: o.priceCurrency || null, inStock: o.availability ? /InStock|LimitedAvailability|PreOrder/i.test(o.availability) : null, variants: Math.max(1, offers.length), images: imgs.length ? imgs : [meta(html, 'og:image')].filter(Boolean), url, published: null, tags: [], claims: claimsOf(stripTags(ld.description || '')), pack: PACK.test(ld.name || ''), reviews: ar ? { count: +(ar.reviewCount || ar.ratingCount) || null, rating: +ar.ratingValue || null } : null };
}
function claimsOf(text) {
  const s = String(text).replace(/\n/g, '. ').match(/[^.!?]{12,220}[.!?]?/g) || [];
  return [...new Set(s.map(clean).filter((x) => CLAIM.test(x)))].slice(0, 6);
}
const sizeUp = (src) => (/cdn\.shopify\.com|\/cdn\/shop\//.test(src) ? src.replace(/^\/\//, 'https://') + (src.includes('?') ? '&' : '?') + 'width=1200' : src.replace(/^\/\//, 'https://'));
export const shortTitle = (t) => clean(String(t).replace(/\s*[|]\s*.*$/, '').replace(/™|®/g, '')).slice(0, 60);
const fmtDate = (s) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
