// Stage 3 · catalog: Shopify products.json + collections.json, WooCommerce Store API, or JSON-LD Product on the
// product pages in the sitemap. Live prices with currency, MRP, packs, stock, images, launch dates, claim lines.
// Hero packshots: the store's own best-seller order when it has one, else the main collection's order.
import { jsonLd, typeIs, clean, stripTags, pathOf, money, num, pool, hostOf, meta, links } from '../util.js';
import { moneyFmt } from '../../brand-pack.js'; // the price label the check page prints (build.js normalizeProfile)
import { adminUrl } from './admin.js';
import { findProductUrls, isProductPage, productFromPage, PACK, claimsOf, storeKindOf, offeringUrls, offeringFromPage, spread } from '../products.js';

/** bump when the catalog starts reading differently: heal() re-reads every saved catalog with an older version */
export const CATALOG_V = 2;

const NOT_PRODUCT = /gift ?wrap|gift ?card|e-?gift|shipping protection|route protection|insurance|sample|tester|donation/i; // what the check page leaves out (build.js checkData)
const NONPRODUCT = /gift ?card|e-?gift|shipping protection|route|insurance|free gift|freebie|sample|tester|donation|\bwarranty\b|\bfee\b/i;

export async function catalog(ctx) {
  const { http, ledger, profile, state } = ctx; const origin = state.origin; const cur = profile.currency;
  let products = [], collections = [], how = null;

  // Shopify answers products.json in the visitor's market (a store can show INR to a visit from India): ask
  // for the home market explicitly so prices match the shop currency
  const mk = state.shopMeta?.country ? `&country=${state.shopMeta.country}` : '';
  /* a closed store (stages/admin.js): the active products and collections its Shopify admin gave, in the products.json shape */
  const admin = state.admin;
  if (admin) {
    ctx.tick('catalog', 'Shopify admin');
    products = (admin.products || []).map((p) => shopifyItem(p, origin, cur)); collections = admin.collections || [];
    how = 'shopify admin';
  } else if (profile.platform === 'shopify') {
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
  let shapes = null, prefix = '', total = null;
  // every other store (Salesforce Commerce, Magento, BigCommerce, headless, custom): learn which of the sitemap's URLs
  // are product pages from the pages themselves (reader/products.js), then read a spread of them
  /* probe: learning the shapes renders only a blocked page (a category page is not a product, rendered or not);
     a page picked as a product is rendered when its plain HTML shows none (drawn by script) */
  const page = async (u, key, probe = false) => {
    const r = await http.get(u, { key }).catch(() => null);
    if (r?.ok && r.text && isProductPage(r.text)) return { html: r.text, url: r.url || u };
    /* a paid browser render: 24 at most for one catalog (a store that blocks every plain fetch reads a smaller sample) */
    if ((!r?.ok || !r.text || (!probe && !/ld\+json|og:type/i.test(r.text))) && (state.catRenders = (state.catRenders || 0) + 1) <= 24) { const rr = await ctx.render(u, key + '-rendered'); if (rr?.html) return { html: rr.html, url: u }; }
    return r?.ok ? { html: r.text, url: r.url || u } : null;
  };
  if (!products.length) {
    ctx.tick('catalog', 'product pages');
    const found = await findProductUrls({ urls: state.pageUrls || [], homeLinks: state.homeLinks || [], origin, market: state.localePath || profile.country, fetchPage: async (u, k) => (await page(u, k, true))?.html, tick: (t) => ctx.tick('catalog', '/' + t + '/') });
    shapes = found.shapes; prefix = found.prefix; total = found.total;
    ctx.state.productPageCount = found.total;
    await pool(found.urls, 6, async (u, i) => {
      if (i % 5 === 0) ctx.tick('catalog', pathOf(u).replace(profile.host, ''));
      const pg = await page(u, 'pp-' + i); if (!pg) return;
      const item = productFromPage(pg.html, u); if (item) products.push(item);
    });
    if (products.length) how = `jsonld (${found.urls.length} of ${found.total} product pages read)`;
    else if (found.total && !products.length) ctx.state.catalogNote = `${found.total} product pages found, but none of the ${found.urls.length} opened showed a product`;
  }
  /* no catalog, and the site asks visitors to get in touch rather than buy (real estate, services, B2B): read what it offers
     (its biggest non-content URL group: /project/, /services/, /courses/) as the catalog, and say it is not a store */
  let group = null;
  if (!products.length && !admin && storeKindOf(state.home, []) === 'enquiry') {
    profile.storeKind = 'enquiry';
    const off = offeringUrls(state.pageUrls || []); group = off.group;
    if (off.urls.length) { ctx.tick('catalog', '/' + off.group + '/');
      await pool(spread(off.urls, 16), 6, async (u, i) => { const pg = await page(u, 'off-' + i); const it = pg && offeringFromPage(pg.html, u); if (it) products.push(it); });
      if (products.length) { how = `offerings (/${off.group}/ pages)`; total = off.urls.length; ctx.state.productPageCount = off.urls.length; ctx.state.catalogNote = null; } }
  } else profile.storeKind = 'store';


  products = products.filter((p) => p && p.title && !NONPRODUCT.test(p.title + ' ' + (p.type || '')));
  const currency = products.find((p) => p.currency)?.currency || cur;
  products.forEach((p) => (p.currency ||= currency));
  if (!profile.currency && currency) profile.currency = currency;

  // order: the store's own best-selling sort → a best-seller collection → main collection order
  let order = null, orderHow = null;
  if (profile.platform === 'shopify' && !admin) {
    const bs = collections.find((c) => /best-?sell|bestseller|top-?sell|most-?loved|most-?popular|top-?rated/i.test(c.handle + ' ' + c.title));
    if (bs) { const r = await http.get(`${origin}/collections/${bs.handle}/products.json?limit=50${mk}`, { as: 'json', key: 'bestsellers' }); if (r.ok && r.json?.products?.length) { order = r.json.products.map((p) => p.handle); orderHow = `the "${clean(bs.title)}" collection`; } }
    if (!order) { const r = await http.get(`${origin}/collections/all?sort_by=best-selling${mk}`, { key: 'all-best-selling' });
      if (r.ok && r.text) { const hs = [...new Set([...r.text.matchAll(/\/products\/([a-z0-9][a-z0-9-]*)/gi)].map((m) => m[1].toLowerCase()))].filter((h) => products.some((p) => p.handle === h)); if (hs.length >= 3) { order = hs; orderHow = 'the store\'s best-selling sort (/collections/all?sort_by=best-selling)'; } } }
  }
  const rank = (p) => { const i = order ? order.indexOf(p.handle) : -1; return i < 0 ? 1e4 + products.indexOf(p) : i; };
  const sellable = products.filter((p) => p.price > 0 || p.kind === 'offering'); /* an offering may not print a price */
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
  const listUrl = admin ? adminUrl(admin.shop?.myshopify, '/products') : `${origin}/products.json`, listHow = admin ? 'shopify-admin' : 'products.json';
  const collOut = [];
  for (const c of collections.slice(0, 200)) collOut.push({ handle: c.handle, title: clean(c.title), count: c.products_count ?? null });
  profile.catalog = {
    count: products.length, collections: collOut,
    products: products.map((p) => ({ ...(p.id ? { id: p.id } : {}), handle: p.handle, title: p.title, type: p.type || null, price: p.price || null, mrp: p.mrp || null, currency: p.currency || null, inStock: p.inStock, variants: p.variants, images: p.images.slice(0, 6), img: p.img || null, url: p.url, published: p.published || null, tags: p.tags || [], claims: p.claims || [], pack: !!p.pack, reviews: p.reviews || null, ...(p.kind ? { kind: p.kind, priceText: p.priceText || null, summary: p.summary || null } : {}) })),
    hero: hero.map((p) => p.handle), order: orderHow || 'catalog order', source: how,
    /* every product page the store lists (count is only the ones read) and the URL shapes learned for them */
    ...(group ? { offerings: group } : {}), total: total ?? products.length, ...(shapes?.length ? { shapes, prefix } : {}), v: CATALOG_V
  };
  if (products.length) ledger.add({ key: 'catalog.count', label: 'Products in the catalog', v: String(products.length), n: products.length, unit: 'products', url: admin ? listUrl : how === 'products.json' ? `${origin}/products.json` : origin, method: how?.startsWith('jsonld') ? 'jsonld' : admin ? listHow : how || 'crawl', note: how?.startsWith('jsonld') ? `only product pages read so far; ${ctx.state.productPageCount || 0} product pages in the sitemap${shapes?.length ? ` (${shapes.map((x) => '/' + x.split('/')[0] + '/').join(', ')})` : ''}` : admin ? `active products in the Shopify admin${admin.partial ? `; the first ${products.length} of ${admin.count} read` : ''}` : undefined });
  if (collections.length) ledger.add({ key: 'catalog.collections', label: 'Collections', v: String(collections.length), n: collections.length, url: admin ? adminUrl(admin.shop?.myshopify, '/collections') : `${origin}/collections.json`, method: listHow });
  const packs = products.filter((p) => p.pack); if (products.length) ledger.add({ key: 'catalog.packs', label: 'Packs, kits and bundles', v: String(packs.length), n: packs.length, url: listUrl, method: how?.startsWith('jsonld') ? 'jsonld' : listHow, layer: 'inferred', conf: 'medium', note: 'titles that say pack/kit/combo/set/duo/trio' });
  const oos = products.filter((p) => p.inStock === false); if (products.length) ledger.add({ key: 'catalog.out_of_stock', label: 'Products out of stock', v: String(oos.length), n: oos.length, url: listUrl, method: how?.startsWith('jsonld') ? 'jsonld' : listHow });
  for (const p of products.slice(0, 400)) {
    const pu = admin && p.id ? adminUrl(admin.shop?.myshopify, `/products/${p.id}`) : p.url; /* a closed store's product page isn't public yet: its admin page */
    if (p.price > 0) ledger.add({ key: `price.${p.handle}`, label: `${p.title} price`, v: money(p.price, p.currency), n: p.price, unit: p.currency, url: pu, method: how?.startsWith('jsonld') ? 'jsonld' : admin ? listHow : how === 'products.json' ? 'products.json' : 'crawl' });
    if (p.mrp > p.price) ledger.add({ key: `mrp.${p.handle}`, label: `${p.title} list price (compare-at)`, v: money(p.mrp, p.currency), n: p.mrp, unit: p.currency, url: pu, method: admin ? listHow : how === 'products.json' ? 'products.json' : 'jsonld' });
  }
  const dated = products.filter((p) => p.published).sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  const newest = dated.find((p) => !p.pack) || dated[0];
  if (newest) ledger.add({ key: 'catalog.newest', label: 'Newest product (published date)', v: `${newest.title}, ${newest.published.slice(0, 10)}`, url: admin ? listUrl : newest.url, method: listHow, note: 'Shopify published_at: the date it went live in this store, which can differ from a launch date' });
  if (order) ledger.add({ key: 'catalog.order', label: 'Best-seller order used for heroes', v: orderHow, url: origin, method: 'crawl' });

  // findings
  if (!products.length) {
    ctx.finding('catalog', { kind: 'rows', t: 'The catalog', src: admin ? 'Shopify admin' : pathOf(origin), rows: [], cap: admin ? 'The Shopify admin has no active products yet.' : ctx.state.catalogNote ? `${ctx.state.catalogNote}.` : 'No product pages found on the site.' });
    return ctx.done('catalog', ctx.state.catalogNote ? 'product pages found, none readable' : 'no products found', 'empty');
  }
  const top = hero.slice(0, 5);
  const rows = top.map((p) => [shortTitle(p.title), p.mrp > p.price ? `${money(p.price, p.currency)} (MRP ${money(p.mrp, p.currency)})` : money(p.price, p.currency)]);
  const partial = how?.startsWith('jsonld') && (ctx.state.productPageCount || 0) > products.length;
  if (profile.storeKind === 'enquiry') {
    /* the group's own word when it names what is offered (projects, services, courses); a city or a section name is not one */
    const noun = group && /^(projects?|propert(y|ies)|residences?|homes?|developments?|listings?|services?|solutions?|products?|programs?|programmes?|courses?|plans?|packages?|treatments?|collections?|models?|vehicles?|cars?|tours?|rooms?|destinations?)$/i.test(group) ? group.replace(/ies$/, 'y').replace(/s$/, '').replace(/y$/, (m) => (/propert$/.test(group.replace(/ies$|y$/, '')) ? 'ie' : 'y')) + 's' : 'offerings';
    ctx.finding('catalog', { kind: 'rows', t: `What ${profile.brandName || profile.name} offers`, src: pathOf(origin + '/' + (group || '')), rows: top.map((p) => [shortTitle(p.title), p.priceText || '']), cap: `${num(total || products.length, currency)} ${noun} on the site${products.length < (total || 0) ? `, ${products.length} read` : ''}. No online store: visitors enquire.`, order: 'site order' }, 'Read what you offer');
    if (shots.length) ctx.finding('catalog', { kind: 'grid', t: 'Pictures on your site', src: pathOf(origin), imgs: shots.slice(0, 4), all: shots, cap: `${shots.length} pictures saved.` }, 'Saved the pictures');
    return ctx.done('catalog', `${num(total || products.length, currency)} ${noun}, sells by enquiry`);
  }
  const capBits = [partial ? `${num(ctx.state.productPageCount, currency)} product pages in the sitemap, ${products.length} read.` : admin?.partial ? `${num(products.length, currency)} of ${num(admin.count, currency)} active products read from the Shopify admin.` : `${num(products.length, currency)} products${admin ? ' from the Shopify admin' : ''}.`];
  if (newest) capBits.push(`Newest: ${shortTitle(newest.title)}, ${fmtDate(newest.published)}.`);
  ctx.finding('catalog', { kind: 'rows', t: 'The catalog', src: admin ? 'Shopify admin' : pathOf(how === 'products.json' ? `${origin}/products.json` : origin), rows, cap: capBits.join(' '), order: orderHow || 'catalog order' }, 'Read live prices');
  if (shots.length) ctx.finding('catalog', { kind: 'grid', t: admin ? 'Your product photos' : 'Packshots on your site', src: admin ? 'Shopify admin' : pathOf(origin + '/products'), imgs: shots.slice(0, 4), all: shots, cap: `${shots.length} product photos saved${orderHow ? `, best sellers first (${orderHow.replace(/ \(.*\)/, '')})` : ''}.` }, 'Saved the packshots');
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
const sizeUp = (src) => (/cdn\.shopify\.com|\/cdn\/shop\//.test(src) ? src.replace(/^\/\//, 'https://') + (src.includes('?') ? '&' : '?') + 'width=1200' : src.replace(/^\/\//, 'https://'));
export const shortTitle = (t) => clean(String(t).replace(/\s*[|]\s*.*$/, '').replace(/™|®/g, '')).slice(0, 60);
const fmtDate = (s) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
