// Read-only audit of a brand's connected Shopify store: reads the Admin API with the stored token and prints what Brew shows
// next to what Shopify says (the whole 30 days, not a sample). Writes nothing (no vault save, no token refresh, no pack write).
// Usage: FEED_VAULT_KEY=$(gcloud secrets versions access latest --secret=FEED_VAULT_KEY) node tools/shopify-audit.mjs <slug>
import { execFileSync } from 'node:child_process';
import { decrypt } from '../vault.js';

const slug = process.argv[2]; if (!slug) { console.error('usage: node tools/shopify-audit.mjs <slug>'); process.exit(1); }
const API = '2026-04', MAX_PAGES = +(process.env.AUDIT_PAGES || 120);
const cat = (p) => JSON.parse(execFileSync('gcloud', ['storage', 'cat', `gs://brew-prototype/brands/${slug}/${p}`], { encoding: 'utf8', maxBuffer: 64e6 }));
const c = JSON.parse(decrypt(cat('private/vault/shopify.json').c)), snap = cat('private/live/shopify.json');
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
async function gql(query, variables = {}, tries = 0) {
  const r = await fetch(`https://${c.shop}/admin/api/${API}/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': c.token }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  if (j.errors?.some?.((x) => x.extensions?.code === 'THROTTLED') && tries < 6) { await nap(2e3 * 2 ** tries); return gql(query, variables, tries + 1); }
  if (!r.ok || j.errors) throw new Error(`${r.status}: ${JSON.stringify(j.errors || j).slice(0, 300)}`);
  return j.data;
}
const day = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const safe = (p) => p.catch((e) => ({ error: e.message }));
const count = async (q) => (await gql('query($q:String){ ordersCount(query:$q, limit:null){ count precision } }', { q })).ordersCount;

const out = { slug, shop: c.shop, route: c.app, scopeSaved: c.scope || null, exp: c.exp ? new Date(c.exp).toISOString() : null };
out.shopInfo = await safe(gql('{ shop { name myshopifyDomain primaryDomain { host } currencyCode ianaTimezone plan { partnerDevelopment shopifyPlus } } }').then((d) => d.shop));
out.scopes = await safe(gql('{ currentAppInstallation { accessScopes { handle } } }').then((d) => d.currentAppInstallation.accessScopes.map((x) => x.handle)));
out.counts = await safe((async () => ({ all30: await count(`created_at:>=${day(30)}`), cancelled30: await count(`created_at:>=${day(30)} status:cancelled`), all90: await count(`created_at:>=${day(90)}`) }))());

/* the whole 30 days, light fields: the exact numbers Brew estimates from a sample */
const o30 = []; let a = null, capped = true;
for (let i = 0; i < MAX_PAGES; i++) {
  const d = await gql('query($q:String,$a:String){ orders(first:250, after:$a, query:$q, sortKey:CREATED_AT, reverse:true){ pageInfo{ hasNextPage endCursor } nodes{ createdAt cancelledAt displayFinancialStatus paymentGatewayNames totalPriceSet{ shopMoney{ amount } } customer{ id numberOfOrders } } } }', { q: `created_at:>=${day(30)}`, a });
  o30.push(...d.orders.nodes); if (!d.orders.pageInfo.hasNextPage) { capped = false; break; } a = d.orders.pageInfo.endCursor;
}
const live = o30.filter((o) => !o.cancelledAt), rev = live.reduce((s, o) => s + +o.totalPriceSet.shopMoney.amount, 0);
const isCod = (o) => (o.paymentGatewayNames || []).some((g) => /cash on delivery|\bcod\b|cash_on_delivery|pay on delivery/i.test(g));
const cs = new Map(); for (const o of live) if (o.customer?.id) cs.set(o.customer.id, o.customer.numberOfOrders);
out.truth30 = { read: o30.length, capped, orders: live.length, revenue: Math.round(rev), aov: live.length ? Math.round(rev / live.length) : null,
  codShare: live.length ? +(100 * live.filter(isCod).length / live.length).toFixed(1) : null,
  repeat30dCustomers: cs.size ? +(100 * [...cs.values()].filter((n) => +n >= 2).length / cs.size).toFixed(1) : null };
out.checkoutsLeft30 = await safe(gql('query($q:String){ abandonedCheckoutsCount(query:$q){ count } }', { q: `created_at:>=${day(30)}` }).then((d) => d.abandonedCheckoutsCount.count));

/* stock under each definition: what Brew used before (tracked, <= 0) and now (on the online store, no keep-selling variant) */
out.stock = await safe(gql('{ productsCount(query:"status:active"){ count } products(first:100, sortKey:INVENTORY_TOTAL, query:"status:active"){ nodes{ title totalInventory tracksInventory onlineStoreUrl variants(first:5){ nodes{ inventoryPolicy availableForSale } } } } }').then((d) => {
  const ns = d.products.nodes, zero = ns.filter((p) => p.tracksInventory && p.totalInventory <= 0);
  const shown = (p) => p.onlineStoreUrl !== null && !(p.variants?.nodes || []).some((v) => v.inventoryPolicy === 'CONTINUE');
  return { active: d.productsCount.count, trackedZero: zero.length, nowRule: zero.filter(shown).length,
    zero: zero.map((p) => ({ title: p.title, onStore: p.onlineStoreUrl !== null, continue: (p.variants?.nodes || []).some((v) => v.inventoryPolicy === 'CONTINUE'), forSale: (p.variants?.nodes || []).some((v) => v.availableForSale) })) }; }));
out.brand = await safe(gql('{ shop{ brand{ slogan shortDescription logo{ image{ url } } colors{ primary{ background } } } } }').then((d) => d.shop.brand));
out.brewShows = { at: new Date(snap.at).toISOString(), ledger: Object.fromEntries((snap.ledger || []).map((e) => [e.key, e.v])), notes: snap.notes, cards: (snap.cards || []).map((x) => ({ id: x.id, title: x.title, rows: x.rows })) };
console.log(JSON.stringify(out, null, 1));
