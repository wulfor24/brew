// Product pages on any platform: which URLs are products, and what a product page says. Shopify and WooCommerce
// answer from their APIs (stages/catalog.js); every other store (Salesforce Commerce Cloud, Magento, BigCommerce,
// headless Next.js, custom) is read here from its own pages. The URL shape is learned from the store, never assumed:
// group the sitemap's URLs by path shape, open two of each, and keep the shapes whose pages carry a product.
import { jsonLd, typeIs, clean, stripTags, meta, attr, tags, pool, hostOf } from './util.js';

export const PACK = /\bpack of \d+|\b\d+\s?x\s?\d+|\bcombo\b|\bkit\b|\bbundle\b|\bset of\b|\bduo\b|\btrio\b|\bregimen\b|\broutine\b|\bvalue pack\b|\bgift set\b/i;
const CLAIM = /(\d+(\.\d+)?\s?%|\bup to\b|\bclinically\b|\bdermatologist|\bproven\b|\bstudy\b|\btested\b|\bin \d+ (days|weeks)|\b\d+[xX]\b|\bcertified\b|\bno\. ?1\b|#1\b)/i;
/* the common product paths: /products/x (Shopify), /product/x (Woo), /p/x, /pd/x (SFCC), /dp/x, /item/x, x.html (Magento), x-p-123 */
export const PRODUCT_PATH = /\/(products?|p|pd|prod|item|items|buy|dp|shop)\/[^/]+|\/[^/]+\/p\/|\.html$|-p-?\d{3,}\/?$|\/[^/]+-\d{5,}(\.html)?\/?$/i;
export const NOT_PRODUCT_PATH = /\/(collections?|category|categories|c|cat|blog|blogs|news|stories|articles?|pages?|help|faq|search|account|cart|wishlist|stores?|store-locator|sitemap)(\/|$)/i;
const LOCALE = /^[a-z]{2}([-_][a-z]{2})?$/i;

/**
 * The market prefix most of a store's URLs share (/in/en, /en-gb, /us): learned from the URLs, so a product path that
 * happens to look like a language code (/pd/, /it/) is never taken for one. Returns 'in/en', 'en-gb' or ''.
 */
export function marketPrefix(urls) {
  const segs = urls.map((u) => { try { return new URL(u).pathname.split('/').filter(Boolean); } catch { return []; } }).filter((s) => s.length);
  if (!segs.length) return '';
  let prefix = [];
  for (let d = 0; d < 2; d++) {
    const count = {}; for (const s of segs) if (s.length > d + 1 && prefix.every((p, i) => s[i] === p)) count[s[d]] = (count[s[d]] || 0) + 1;
    const [top, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [];
    if (!top || !LOCALE.test(top) || n < segs.length * 0.6) break;
    prefix.push(top);
  }
  if (!prefix.length) {
    /* many markets in one sitemap (store.google.com/us/…, /jp/…, /fr/…): no one prefix, but most URLs open with a market code */
    const lead = segs.filter((s) => s.length > 1 && LOCALE.test(s[0])); const kinds = new Set(lead.map((s) => s[0].toLowerCase()));
    if (lead.length >= segs.length * 0.6 && kinds.size >= 3) return '*';
  }
  return prefix.join('/');
}
/** the path parts a store uses after its market prefix (/in/en/pd/x with prefix 'in/en' → ['pd', 'x']) */
export function partsOf(u, prefix = '') {
  let segs; try { segs = new URL(u).pathname.split('/').filter(Boolean); } catch { return []; }
  if (prefix === '*') { if (segs.length > 1 && LOCALE.test(segs[0])) segs = segs.slice(1); if (segs.length > 1 && LOCALE.test(segs[0]) && /^[a-z]{2}$/i.test(segs[0])) segs = segs.slice(1); return segs; }
  const pre = prefix ? prefix.split('/') : [];
  if (pre.length && pre.every((p, i) => segs[i] === p)) segs = segs.slice(pre.length);
  return segs;
}
/** a URL's shape: its first path part plus the depth (/pd/slug/123 → "pd/3"); a one-part path is "*\/1" */
export const shapeOf = (u, prefix = '') => { const s = partsOf(u, prefix); return s.length ? `${s.length > 1 ? s[0].toLowerCase() : '*'}/${s.length}` : ''; };
/** the shape by how the path ends, for stores whose product URLs share no first part (/go-walk-x/216170.html → "~html/2") */
export const tailShapeOf = (u, prefix = '') => { const s = partsOf(u, prefix); if (s.length < 1) return ''; const t = s[s.length - 1];
  const kind = /\.html?$/i.test(t) ? 'html' : /^\d{5,}$/.test(t) ? 'num' : /-p-?\d+$/i.test(t) ? 'pid' : /^[a-z0-9]*\d[a-z0-9]*$/i.test(t) && t.length >= 6 && /[a-z]/i.test(t) && /\d{3}/.test(t) ? 'sku' : null;
  return kind ? `~${kind}/${s.length}` : ''; };
const shapeKeys = (u, prefix) => [shapeOf(u, prefix), tailShapeOf(u, prefix)].filter(Boolean);
/** shapes saved as { prefix, shapes } (profile.catalog.shapes) or a plain list */
export const matchesShape = (u, shapes, prefix = '') => !!shapes?.length && shapeKeys(u, prefix).some((k) => shapes.includes(k));

/** a product URL: the store's learned shapes when we have them, else the common paths */
export function isProductUrl(u, shapes, prefix = '') {
  if (shapes?.length) return matchesShape(u, shapes, prefix);
  let p; try { p = new URL(u).pathname; } catch { return false; }
  return PRODUCT_PATH.test(p) && !NOT_PRODUCT_PATH.test(p);
}

/** does this page show one product (JSON-LD Product, OpenGraph product, or product meta)? */
export function isProductPage(html) {
  if (!html) return false;
  if (jsonLd(html).some((x) => typeIs(x, 'Product') || typeIs(x, 'ProductGroup'))) return true;
  const ogType = (meta(html, 'og:type') || '').toLowerCase();
  return ogType === 'product' || ogType === 'og:product' || !!meta(html, 'product:price:amount') || /itemtype=["']https?:\/\/schema\.org\/Product["']/i.test(html);
}

/**
 * Pick the product pages to read. urls: the sitemap's page URLs; homeLinks: the home page's links. fetchPage(u, key)
 * returns html or null (plain fetch, then a rendered page). Returns { urls (to read, spread across the list), total
 * (product URLs known), shapes + prefix (the learned URL shapes, saved so later readers know a product link), probed }.
 */
export async function findProductUrls({ urls = [], homeLinks = [], origin, fetchPage, max = 30, market = null, tick = () => {}, groups: nGroups = 8, perGroup = 2 }) {
  const host = hostOf(origin);
  let own = [...new Set(urls.concat(homeLinks.map((l) => l.url || l)).map((u) => String(u).split(/[?#]/)[0]).filter((u) => hostOf(u) === host))];
  /* a sitemap of many markets: read the shopper's market (its code first in the path), or the biggest one */
  if (marketPrefix(own) === '*') { const lead = (u) => partsOf(u)[0]?.toLowerCase(); const by = {}; for (const u of own) by[lead(u)] = (by[lead(u)] || 0) + 1;
    const want = [market, 'us', 'in', 'gb', 'uk', 'en'].map((x) => x && String(x).toLowerCase()).find((x) => x && by[x] > 20) || Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (want) own = own.filter((u) => lead(u) === want); }
  // 1 · group every URL by shape after the store's market prefix; a product shape is a big group of deep pages
  const prefix = marketPrefix(own);
  const groups = new Map();
  for (const u of own) for (const s of shapeKeys(u, prefix)) { if (s.startsWith('*/1')) continue; if (!groups.has(s)) groups.set(s, []); groups.get(s).push(u); }
  // a group of one or two URLs says nothing about a shape (a product slug as the first part): the tail shapes cover those
  if (groups.size > 3) for (const [k, g] of groups) if (g.length < 3 && !k.startsWith('~')) groups.delete(k);
  // the common paths go first, then the biggest groups
  const known = (s) => groups.get(s).some((u) => isProductUrl(u));
  const order = [...groups.keys()].filter((s) => !NOT_PRODUCT_PATH.test('/' + s.split('/')[0] + '/')).sort((a, b) => (known(b) - known(a)) || groups.get(b).length - groups.get(a).length).slice(0, nGroups);
  // 2 · open two pages of each shape: the shapes whose pages carry a product are the store's product URLs
  const shapes = [], probed = {};
  await pool(order, 4, async (s, gi) => {
    const g = groups.get(s); const picks = [g[0], g[Math.floor(g.length / 2)]].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, perGroup);
    tick(s.split('/')[0]);
    let hits = 0;
    for (const [i, u] of picks.entries()) { const html = await fetchPage(u, `shape-${gi}-${i}`).catch(() => null); if (isProductPage(html)) hits++; }
    probed[s] = { pages: g.length, hits, of: picks.length };
    if (hits) shapes.push(s);
  });
  /* a tail shape (~num/3) stays only when it finds product URLs the first-part shapes (pd/3) miss: never wider than needed */
  const heads = shapes.filter((x) => !x.startsWith('~'));
  if (heads.length) for (const t of shapes.filter((x) => x.startsWith('~'))) if (own.filter((u) => matchesShape(u, [t], prefix)).every((u) => matchesShape(u, heads, prefix))) shapes.splice(shapes.indexOf(t), 1);
  let found = own.filter((u) => matchesShape(u, shapes, prefix));
  // nothing learned (no sitemap, or every probe failed): the common paths on the URLs we have
  if (!found.length) found = own.filter((u) => isProductUrl(u));
  return { urls: spread(found, max), total: found.length, shapes, prefix, probed };
}
/** a site's page URLs from its own sitemaps (robots.txt, product files first), for a store we visit once (a rival) */
export async function sitemapUrls(get, origin, { cap = 3000, files = 3 } = {}) {
  const txt = async (u) => { const r = await get(u).catch(() => null); return r?.ok ? String(r.text || '') : ''; };
  let roots = [...(await txt(`${origin}/robots.txt`)).matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1].trim());
  if (!roots.length) roots = [`${origin}/sitemap.xml`];
  const prod = (u) => /product|pdp|catalog|item/i.test(u.split('/').pop());
  roots.sort((a, b) => prod(b) - prod(a));
  const out = []; let read = 0;
  const walk = async (u, depth) => { if (read >= files * 3 || out.length >= cap) return; read++; const x = await txt(u); if (!x) return;
    if (/<sitemapindex/i.test(x) && depth < 2) { const kids = [...x.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)/gi)].map((m) => m[1].replace(/&amp;/g, '&')); kids.sort((a, b) => prod(b) - prod(a)); for (const k of kids.slice(0, files)) await walk(k, depth + 1); return; }
    for (const m of x.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)/gi)) { out.push(m[1].replace(/&amp;/g, '&')); if (out.length >= cap) break; } };
  for (const r of roots.slice(0, 3)) await walk(r, 0);
  return out;
}

/** n items spread across a list (a sitemap is often sorted by category: the first 30 are all caps) */
export function spread(list, n) {
  if (list.length <= n) return list.slice();
  const out = []; const step = list.length / n;
  for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

/** what one product page says: JSON-LD Product (merged with its ProductGroup's variants), else OpenGraph/microdata */
export function productFromPage(html, url) {
  const lds = jsonLd(html);
  const prod = lds.find((x) => typeIs(x, 'Product') && (x.offers || x.name));
  const group = lds.find((x) => typeIs(x, 'ProductGroup'));
  if (prod || group) return ldItem(prod || group, url, html, group && group !== prod ? group : null);
  return ogItem(html, url);
}

const num = (v) => +String(v ?? '').replace(/[^\d.]/g, '') || 0;
const IN_STOCK = /InStock|LimitedAvailability|PreOrder|BackOrder|OnlineOnly/i;

export function ldItem(ld, url, html, group = null) {
  const offersOf = (x) => [].concat(x?.offers || []).flatMap((o) => (o && o['@type'] === 'AggregateOffer' ? [{ price: o.lowPrice, priceCurrency: o.priceCurrency, availability: o.availability }].concat(o.offers || []) : [o])).filter(Boolean);
  const variantOffers = (x) => [].concat(x?.hasVariant || []).flatMap((v) => offersOf(v));
  const offers = [...offersOf(ld), ...variantOffers(ld), ...variantOffers(group)];
  const o = offers.find((x) => x.price != null && num(x.price) > 0) || offers.find((x) => x.price != null) || {};
  const price = num(o.price);
  const list = offers.map((x) => num(x.priceSpecification?.price ?? (x.priceSpecification?.priceType && /list|strikethrough/i.test(x.priceSpecification.priceType) ? x.priceSpecification.price : NaN))).find((x) => x > price) || null;
  const img = (i) => (typeof i === 'string' ? i : i?.url || i?.contentUrl || null);
  const imgs = [...new Set([].concat(ld.image || [], group?.image || []).map(img).filter(Boolean))];
  const og = meta(html, 'og:image');
  const avail = offers.map((x) => x.availability).filter(Boolean);
  const ar = ld.aggregateRating || group?.aggregateRating;
  const cat = typeof ld.category === 'string' ? ld.category : typeof group?.category === 'string' ? group.category : '';
  return {
    handle: handleOf(url), title: clean(ld.name || group?.name), type: clean(cat.split(/[>/|]/).pop() || ''), price, mrp: list, currency: o.priceCurrency || null,
    // a product is in stock when any of its offers (sizes, colours) is
    inStock: avail.length ? avail.some((a) => IN_STOCK.test(a)) : null, variants: Math.max(1, offers.length),
    images: imgs.length ? imgs : [og].filter(Boolean), url, published: null, tags: [], claims: claimsOf(stripTags(ld.description || group?.description || '')),
    pack: PACK.test(ld.name || ''), reviews: ar ? { count: +(ar.reviewCount || ar.ratingCount) || null, rating: +ar.ratingValue || null } : null, sku: ld.sku || ld.mpn || ld.productID || null
  };
}

export function ogItem(html, url) {
  const title = meta(html, 'og:title') || meta(html, 'name');
  const price = num(meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || itemprop(html, 'price'));
  if (!title || !isProductPage(html)) return null;
  const av = meta(html, 'product:availability') || meta(html, 'og:availability') || itemprop(html, 'availability') || '';
  return { handle: handleOf(url), title: clean(title.replace(/\s*[|–—]\s*[^|–—]+$/, '')), type: '', price, mrp: null, currency: meta(html, 'product:price:currency') || meta(html, 'og:price:currency') || itemprop(html, 'priceCurrency') || null,
    inStock: av ? /in ?stock|instock|available|preorder/i.test(av) && !/out ?of ?stock|unavailable/i.test(av) : null, variants: 1,
    images: [meta(html, 'og:image')].filter(Boolean), url, published: null, tags: [], claims: claimsOf(meta(html, 'og:description') || ''), pack: PACK.test(title), reviews: null, sku: null };
}
const itemprop = (html, name) => { for (const t of tags(html, 'meta').concat(tags(html, 'span'), tags(html, 'link'))) if ((attr(t, 'itemprop') || '').toLowerCase() === name.toLowerCase()) return attr(t, 'content') || attr(t, 'href'); return null; };
/* the last path part, as saved reads already key their products (moves and heroes refer to it) */
export const handleOf = (url) => { const s = partsOf(url); return (s.pop() || 'product').replace(/\.html$/, '').toLowerCase().slice(0, 80); };
export function claimsOf(text) {
  const s = String(text).replace(/\n/g, '. ').match(/[^.!?]{12,220}[.!?]?/g) || [];
  return [...new Set(s.map(clean).filter((x) => CLAIM.test(x)))].slice(0, 6);
}

/* ---------- brands that sell by enquiry (real estate, services, B2B, clinics, courses): no cart, offerings + a lead form ---------- */
const ENQUIRY = /\benquir(e|y|ies)\b|\binquir(e|y)\b|book an? (site |free |home )?(visit|demo|consultation|appointment|call)|schedule an? (visit|demo|call|consultation)|request an? (call ?back|quote|demo|callback|brochure)|get a quote|download (the )?brochure|talk to (an? )?(expert|advisor|sales)|get in touch|contact (us|sales)/gi;
const CART = /add to (cart|bag|basket)|\/cart\b|shopping (cart|bag)|buy now|checkout|data-cart|cart-count|mini-?cart/i;
/** 'enquiry' when a site with no catalog asks visitors to get in touch rather than buy, else 'store' */
export function storeKindOf(html, products = []) {
  if (products.length) return 'store';
  const h = String(html || ''); const cues = (stripTags(h).match(ENQUIRY) || []).length + (h.match(ENQUIRY) || []).length / 4;
  return cues >= 2 && !CART.test(h) ? 'enquiry' : 'store';
}
/* what an enquiry-led brand offers lives in a URL group that is not content (blog, news, careers, legal) */
const CONTENT = /^(blog|blogs|news|press|media|stories|articles?|insights|resources|careers?|jobs|events?|gallery|videos?|faq|help|legal|policy|policies|privacy|terms|tag|tags|category|categories|author|page|wp-content|amp)$/i;
const OFFER_HINT = /^(projects?|propert(y|ies)|residences?|homes?|developments?|listings?|services?|solutions?|products?|offerings?|programs?|programmes?|courses?|plans?|packages?|treatments?|collections?|models?|vehicles?|cars?|tours?|rooms?|destinations?|menu)$/i;
export function offeringUrls(urls, prefix = marketPrefix(urls)) {
  const groups = new Map();
  for (const u of urls) { const s = partsOf(u, prefix); if (s.length < 2 || CONTENT.test(s[0])) continue; const k = s[0].toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); }
  const best = [...groups.entries()].filter(([, g]) => g.length >= 2 && g.length <= 2000).sort((a, b) => (OFFER_HINT.test(b[0]) - OFFER_HINT.test(a[0])) || b[1].length - a[1].length)[0];
  return best ? { group: best[0], urls: [...new Set(best[1].map((u) => u.split(/[?#]/)[0]))] } : { group: null, urls: [] };
}
/** a price written on an offering's page ("Starting ₹1.60 Cr", "from $1,200"): the number in full, else null */
export function priceText(text) {
  /* "Rs" only as a word with a dot or space ("years 1" is not a price), and a bare number under 100 is not one either */
  const m = String(text || '').match(/(₹|(?<![a-z])rs\.\s?|(?<![a-z])rs\s|(?<![a-z])inr\s?|\$|(?<![a-z])usd\s?|£|€|(?<![a-z])aed\s?)\s?([\d,]+(?:\.\d+)?)\s?(cr(?:ore)?s?\b|lakhs?\b|lacs?\b|l\b|k\b|m\b|mn\b)?/i); if (!m) return null;
  const n = +m[2].replace(/,/g, ''); const u = (m[3] || '').toLowerCase(); if (!n || (!u && n < 100)) return null;
  const mult = /^cr/.test(u) ? 1e7 : /^(lakh|lac|l$)/.test(u) ? 1e5 : u === 'k' ? 1e3 : /^(m|mn)$/.test(u) ? 1e6 : 1;
  const cur = /₹|rs|inr/i.test(m[1]) ? 'INR' : /\$|usd/i.test(m[1]) ? 'USD' : m[1] === '£' ? 'GBP' : m[1] === '€' ? 'EUR' : 'AED';
  return { price: n * mult, currency: cur, label: m[0].trim() };
}
/** one offering's page: its name, picture, one line and a written price */
export function offeringFromPage(html, url) {
  const h1 = (String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const title = clean(stripTags(h1 || '')) || clean((meta(html, 'og:title') || '').replace(/\s*[|–—-]\s*[^|–—-]+$/, ''));
  if (!title) return null;
  const pr = priceText(stripTags(html).slice(0, 60000));
  return { handle: handleOf(url), title: title.slice(0, 100), type: '', price: pr?.price || null, priceText: pr?.label || null, mrp: null, currency: pr?.currency || null, inStock: null, variants: 1,
    images: [meta(html, 'og:image')].filter(Boolean), url, published: null, tags: [], claims: claimsOf(meta(html, 'og:description') || meta(html, 'description') || ''), pack: false, reviews: null, sku: null, kind: 'offering',
    summary: clean(meta(html, 'og:description') || meta(html, 'description') || '').slice(0, 240) || null };
}
