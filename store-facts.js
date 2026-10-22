// One place for what a brand's store is, on any platform: the product link, the catalog's source, how many products it
// has and which links are product pages. Shopify keeps its own paths; every other platform uses what the read learned
// (reader/products.js), never /products/<handle> or products.json.
import { isProductUrl as learnedProductUrl } from './reader/products.js';

/** the product's own page: the URL the read saved, else Shopify's path on a Shopify store, else null (never a guess) */
export const productUrl = (p, host, platform) => p?.url || (p?.handle && host && (!platform || platform === 'shopify') ? `https://${host}/products/${p.handle}` : null);
/** where the catalog was read: products.json on Shopify, else the store's home (a sitemap and its product pages) */
export const catalogSourceUrl = (profile) => profile?.platform === 'shopify' && /products\.json|^shopify/i.test(profile?.catalog?.source || 'products.json') ? `https://${profile.host}/products.json` : profile?.host ? `https://${profile.host}/` : null;
/** every product the store lists (catalog.total: product pages in the sitemap), not just the ones read */
export const catalogTotal = (profile) => +profile?.catalog?.total || +profile?.catalog?.count || (profile?.catalog?.products || []).length || 0;
/** a link to one of this store's product pages (the shapes the read learned; Shopify's /products/ always) */
export function isProductLink(profile, url) {
  let u; try { u = new URL(/^https?:/.test(url) ? url : `https://${url}`); } catch { return false; }
  if (profile?.host && u.hostname.replace(/^www\./, '') !== String(profile.host).replace(/^www\./, '')) return false;
  if (/\/products\/[^/]+/.test(u.pathname)) return true;
  return learnedProductUrl(u.href, profile?.catalog?.shapes, profile?.catalog?.prefix || '');
}
/** the platform's name for people ("Salesforce Commerce Cloud", "your store") */
const PLATFORM = { shopify: 'Shopify', woocommerce: 'WooCommerce', magento: 'Magento', bigcommerce: 'BigCommerce', 'salesforce-commerce': 'Salesforce Commerce Cloud', wix: 'Wix', squarespace: 'Squarespace' };
export const platformLabel = (platform) => PLATFORM[platform] || null;
/** a brand that sells by enquiry, not a cart (catalog.js storeKind) */
export const sellsByEnquiry = (profile) => profile?.storeKind === 'enquiry';
