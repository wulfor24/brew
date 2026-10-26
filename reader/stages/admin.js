// A store whose storefront is behind Shopify's password page (a development store, a store not launched yet): the read
// starts from the Shopify Admin API instead of the public site. Shopify app reviewers always install on a development
// store, and those are always password-protected, so this is the read they see.
//   adminCatalog({ gql })  → the snapshot: the shop (name, domain, currency, country, ships-to, description), its active
//                            products in the products.json shape the catalog stage already reads, collections, brand kit
//   openAdmin(ctx)         → the open stage for that snapshot; the catalog stage then reads its products
//   CLOSED_STAGE           → what the stages that need the public site (checkout walk, PageSpeed, AI answers) say instead:
//                            plainly that they didn't run because the store is closed, never "none"
// Free: Admin API reads cost nothing, the password page is one plain fetch. Only active products are read (never drafts).
import { clean, today } from '../util.js';
import { sellingMarket, applyMarket } from '../../market.js';
import { SITE_V } from './site.js';
import { CLOSED_WHY, isPasswordPage } from '../closed.js';

export const ADMIN_V = 1; /* bump when the snapshot is read differently: saved snapshots are then read again on the next start */

const PRODUCTS = `query($c:String){ products(first:50, after:$c, query:"status:active"){ pageInfo{ hasNextPage endCursor }
  nodes{ id handle title descriptionHtml productType vendor tags createdAt publishedAt
    media(first:6){ nodes{ ... on MediaImage{ image{ url } } } }
    variants(first:10){ nodes{ price compareAtPrice availableForSale } } } } }`;
const SHOP = `{ shop{ name description myshopifyDomain primaryDomain{ host } currencyCode shipsToCountries billingAddress{ countryCodeV2 city province } } productsCount(query:"status:active"){ count } }`;
const PLAN = '{ shop{ plan{ partnerDevelopment } } }';
const COLLECTIONS = '{ collections(first:100){ nodes{ handle title productsCount{ count } } } }';
const BRAND = '{ shop{ brand{ slogan shortDescription logo{ image{ url } } squareLogo{ image{ url } } colors{ primary{ background } secondary{ background } } } } }';

/* Shopify's GraphQL cost limit answers THROTTLED: wait and ask again (a few times), any other error is thrown */
const asked = async (gql, q, v, tries = 4) => {
  for (let i = 0; ; i++) {
    try { return await gql(q, v); }
    catch (e) { if (i + 1 >= tries || !/THROTTLED|throttled/.test(String(e.message))) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
};

/** The store as its Admin API sees it. gql(query, variables) → data (throws on errors). max: products read (50 a page). */
export async function adminCatalog({ gql, max = 500, log = console } = {}) {
  const errors = {};
  const s = await asked(gql, SHOP);
  const shop = s.shop || {};
  const plan = await asked(gql, PLAN).then((d) => d.shop?.plan || null).catch((e) => { errors.plan = String(e.message).slice(0, 160); return null; });
  const products = []; let c = null, more = false;
  for (let page = 0; page < Math.ceil(max / 50); page++) {
    const d = await asked(gql, PRODUCTS, { c }); const pr = d.products || {};
    for (const n of pr.nodes || []) products.push(asProduct(n));
    more = !!pr.pageInfo?.hasNextPage; c = pr.pageInfo?.endCursor || null; if (!more || !c) break;
  }
  /* collections and the brand kit are extras: a scope or field Shopify refuses is kept as an error, never as "none" */
  const collections = await asked(gql, COLLECTIONS).then((d) => (d.collections?.nodes || []).map((x) => ({ handle: x.handle, title: clean(x.title), products_count: x.productsCount?.count ?? null })))
    .catch((e) => { errors.collections = String(e.message).slice(0, 160); log.warn?.('[admin] collections', e.message); return null; });
  const brand = await asked(gql, BRAND).then((d) => { const b = d.shop?.brand; if (!b) return null;
    return { slogan: clean(b.slogan) || null, about: clean(b.shortDescription) || null, logo: b.logo?.image?.url || b.squareLogo?.image?.url || null, colors: [b.colors?.primary?.[0]?.background, b.colors?.secondary?.[0]?.background].filter((x) => /^#[0-9a-f]{6}$/i.test(x || '')).map((x) => x.toLowerCase()) }; })
    .catch((e) => { errors.brand = String(e.message).slice(0, 160); return null; });
  return { v: ADMIN_V, at: new Date().toISOString(), errors,
    shop: { name: clean(shop.name) || null, description: clean(shop.description) || null, myshopify: shop.myshopifyDomain || null, host: shop.primaryDomain?.host || shop.myshopifyDomain || null,
      currency: shop.currencyCode || null, country: shop.billingAddress?.countryCodeV2 || null, city: shop.billingAddress?.city || null, province: shop.billingAddress?.province || null,
      shipsTo: Array.isArray(shop.shipsToCountries) ? shop.shipsToCountries.slice(0, 300) : null, dev: plan ? !!plan.partnerDevelopment : null },
    count: s.productsCount?.count ?? products.length, products, partial: more, collections, brand };
}
/* one Admin product in the shape of a products.json product (reader/stages/catalog.js shopifyItem reads it) */
function asProduct(n) {
  const vs = n.variants?.nodes || [];
  return { id: Number(String(n.id || '').split('/').pop()) || n.id || null, handle: n.handle, title: n.title, body_html: n.descriptionHtml || '', product_type: n.productType || '', vendor: n.vendor || '',
    tags: n.tags || [], published_at: n.publishedAt || null, created_at: n.createdAt || null,
    images: (n.media?.nodes || []).map((m) => m?.image?.url).filter(Boolean).map((src) => ({ src })),
    variants: vs.map((v) => ({ price: v.price ?? null, compare_at_price: v.compareAtPrice ?? null, available: !!v.availableForSale })) };
}

/* the admin page a ledger row points to (only the store's own team can open it) */
export const adminUrl = (shop, path = '') => { const h = String(shop || '').replace(/\.myshopify\.com$/, ''); return h ? `https://admin.shopify.com/store/${h}${path}` : 'https://admin.shopify.com'; };

/** Stage 1 for a closed store: the shop's own facts from its admin, and its password page (the theme's logo, colours and
 *  fonts are on it) for the brand stage. ctx.state.admin is the snapshot; ctx.state.closed tells every later stage. */
export async function openAdmin(ctx) {
  const { http, ledger, profile, state } = ctx, a = state.admin, sh = a?.shop || {};
  if (!a || !sh.host) throw new Error('no Shopify admin snapshot for this store');
  ctx.tick('open', 'Shopify admin');
  const origin = `https://${sh.host}`, src = adminUrl(sh.myshopify);
  /* the password page itself: one plain fetch (no rendering, no treg); a store that opened since is read the normal way next time */
  let home = ''; try { const r = await http.get(origin + '/', { key: 'password-page', ms: 15e3 }); if (r.ok && isPasswordPage(r)) home = r.text || ''; } catch {}
  Object.assign(state, { home, origin, homeUrl: origin + '/', homeVia: 'shopify-admin', shopifyShop: sh.myshopify, pageUrls: [], homeLinks: [], pages: {},
    closed: { why: 'password', at: new Date().toISOString() } });
  profile.url = origin + '/'; profile.host = sh.host.replace(/^www\./, ''); profile.platform = 'shopify';
  profile.closed = { why: 'password', at: new Date().toISOString(), checkedAt: new Date().toISOString(), shop: sh.myshopify, dev: sh.dev };
  profile.name = sh.name || profile.host.split('.')[0];
  profile.source = { kind: 'shopify-admin', shop: sh.myshopify, at: a.at, products: a.count ?? a.products.length };
  ledger.add({ key: 'brand.name', label: 'Brand name', v: profile.name, url: src, method: 'shopify-admin', note: 'the store name in Shopify' });
  ledger.add({ key: 'site.platform', label: 'Store platform', v: 'shopify', url: src, method: 'shopify-admin', conf: 'high', note: `read from the Shopify admin of ${sh.myshopify}` });
  ledger.add({ key: 'site.closed', label: 'Storefront', v: `closed: ${CLOSED_WHY}`, url: origin, method: 'crawl', note: 'the checkout walk, page speed and AI answers wait until the store opens' });
  if (sh.currency) ledger.add({ key: 'shop.currency', label: 'Shop currency (Shopify admin)', v: sh.currency, url: src, method: 'shopify-admin' });
  if (sh.country) ledger.add({ key: 'shop.country', label: 'Country the store is registered in (Shopify admin; not where it sells)', v: sh.country, url: src, method: 'shopify-admin' });
  if (sh.city) ledger.add({ key: 'shop.address', label: 'Store address city (Shopify admin)', v: [sh.city, sh.province].filter(Boolean).join(', '), url: src, method: 'shopify-admin' });
  if (sh.shipsTo) ledger.add({ key: 'shop.ships_to', label: 'Countries the store ships to', v: String(sh.shipsTo.length), n: sh.shipsTo.length, unit: 'countries', url: src, method: 'shopify-admin' });

  /* the selling market from the shop's own settings (market.js), as the open stage does with /meta.json */
  profile.currency = sh.currency || null;
  const mk = sellingMarket({ registered: sh.country, currency: profile.currency, shipsTo: sh.shipsTo, hreflang: [], localePath: null, tld: profile.host.split('.').pop(), lang: null, phone: null, orgCountry: null, served: null });
  applyMarket(profile, mk);
  if (!mk.primary) { profile.country = null; profile.markets = []; profile.market = { ...mk, at: new Date().toISOString() }; }
  profile.locale ||= profile.country ? `en-${profile.country}` : null;
  if (profile.currency) ledger.add({ key: 'market.currency', label: 'Store currency', v: profile.currency, layer: 'inferred', url: src, method: 'shopify-admin', conf: 'high', note: 'the shop currency in Shopify' });
  if (profile.country) ledger.add({ key: 'market.country', label: 'Main selling market (where customers are)', v: profile.country, layer: 'inferred', url: src, method: 'shopify-admin', conf: mk.conf, note: mk.why });

  profile.site = { ...(profile.site || {}), pages: null, sitemaps: [], keyPages: [], policies: { shipping: null, returns: null }, closed: true };
  const about = sh.description || a.brand?.about || null;
  if (about) { profile.about = about; ctx.finding('open', { kind: 'text', t: 'About the brand', src: 'Shopify admin · store description', p: about, cap: `The storefront is closed (${CLOSED_WHY}), so this is the store’s own description.` }, 'Read the store description'); }
  if (a.brand?.slogan && a.brand.slogan.length <= 60) profile.descriptor = a.brand.slogan;
  ctx.done('open', `read from your Shopify admin: ${(a.count ?? a.products.length).toLocaleString('en-US')} products; ${CLOSED_WHY}`);
}

/* what a stage that needs the public site saves and says for a closed store (index.js runs these in its place) */
const said = (what) => `${what} didn’t run: ${CLOSED_WHY}. We run it once the store opens.`;
export const CLOSED_STAGE = {
  async site(ctx) {
    const { profile } = ctx, at = today();
    profile.site = { ...(profile.site || {}), checkout: { v: SITE_V, closed: true, at }, pagespeed: { closed: true, at }, closed: true };
    ctx.finding('site', { kind: 'rows', t: 'The path to checkout', src: 'not walked', rows: [], cap: said('The checkout walk and the page speed check') });
    ctx.done('site', `not walked: ${CLOSED_WHY}`, 'empty');
  },
  async answers(ctx) {
    ctx.profile.ai = { questions: [], answers: [], score: null, closed: true };
    ctx.finding('answers', { kind: 'answer', t: 'Asked ChatGPT', src: 'not asked', q: '', a: `AI tools weren’t asked: ${CLOSED_WHY}, so they can’t see the store yet. We ask them once the store opens.`, cap: '' });
    ctx.done('answers', `not asked: ${CLOSED_WHY}`, 'empty');
  }
};

/** heal: a closed store is looked at again once a day; when it has opened, the stages it skipped are marked to run again
 *  (the read's normal heal then walks the checkout, checks the speed, asks the AI tools and reads reviews and socials) */
export async function reopenCheck(ctx, { now = Date.now() } = {}) {
  const { profile, http } = ctx; if (!profile.closed) return null;
  if (now - Date.parse(profile.closed.checkedAt || profile.closed.at || 0) < 864e5) return null;
  let r = null; try { r = await http.get(profile.url, { key: 'reopen-' + today(), ms: 15e3 }); } catch {}
  const at = new Date(now).toISOString();
  if (!r?.ok || isPasswordPage(r)) { profile.closed = { ...profile.closed, checkedAt: at }; return 'closed'; }
  const was = profile.closed; delete profile.closed;
  profile.site = { ...(profile.site || {}), checkout: null, pagespeed: null }; delete profile.site.closed;
  if (profile.ai?.closed) profile.ai = { questions: [], answers: [], score: null };
  if (profile.reviews) delete profile.reviews.closed;
  if (profile.search) delete profile.search.closed;
  const errors = { ...(profile.meta?.errors || {}) }; for (const k of ['answers', 'reviews', 'socials']) errors[k] = `the storefront was closed (since ${String(was.at || '').slice(0, 10)}); it is open now`;
  profile.meta = { ...(profile.meta || {}), errors, healTried: Object.fromEntries(Object.entries(profile.meta?.healTried || {}).filter(([k]) => !['reviews', 'socials'].includes(k))), reopenedAt: at };
  return 'reopened';
}
