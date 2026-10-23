// Shopify: the SquareUp Shopify app (OAuth, lifted from SquareUp's integrations/shopify.ts + shopify-token.ts), or the
// brand's own app (Dev Dashboard client id + secret, client-credentials grant) or an Admin API token from a custom
// app made in its admin. Reads orders, checkouts, customers' repeat rate and stock through the Admin GraphQL API.
// Orders and customers are protected customer data: the public app only asks for them once Shopify approves it
// (SHOPIFY_PCD_APPROVED=1); the brand's own app always can, so that is the route for order numbers until then.
import crypto from 'node:crypto';
import { exactSite } from '../auth.js';
import { card, L, n0, pct, has, fmt, getJSON, form, dayISO } from './common.js';

const API = '2026-04';
const BASE = 'read_products,read_inventory'; /* only what sync reads (App Store requirement 3.2); the same list as docs/shopify.app.toml */
const PCD = 'read_orders,read_customers';
// read only: Brew never changes the store (SCOPE.md)
const scopes = () => [BASE, process.env.SHOPIFY_PCD_APPROVED === '1' && PCD].filter(Boolean).join(',');
// the feed's own app (squareup-prod: public, allows the feed's callback); SquareUp's custom app is only a fallback
const app = () => ({ id: process.env.FEED_SHOPIFY_CLIENT_ID || process.env.SHOPIFY_APP_CLIENT_ID || '', secret: process.env.FEED_SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_APP_CLIENT_SECRET || '' });
export const shopOf = (s) => { const h = String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, ''); const x = h.endsWith('.myshopify.com') ? h : h ? `${h.replace(/\.myshopify\.com$/, '')}.myshopify.com` : ''; return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(x) ? x : null; };
// Shopify signs its redirect: HMAC-SHA256 over the sorted query, without hmac/signature
const hmacOk = (q, secret) => { const p = [...q.entries()].filter(([k]) => k !== 'hmac' && k !== 'signature').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const want = crypto.createHmac('sha256', secret).update(p).digest('hex'), got = String(q.get('hmac') || ''); return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want)); };
const token = async (shop, body) => getJSON(`https://${shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form(body) }, 'shopify token');
/* a refresh answer without a new refresh token keeps the old one (fresh spreads this over the saved creds) */
const setOf = (t, extra = {}) => ({ token: t.access_token, scope: t.scope || '', exp: t.expires_in ? Date.now() + t.expires_in * 1e3 : null, ...(t.refresh_token ? { refresh: t.refresh_token } : {}), ...extra });

const nap = (ms) => new Promise((r) => setTimeout(r, ms));
async function gql(c, query, variables, tries = 0) {
  const j = await getJSON(`https://${c.shop}/admin/api/${API}/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': c.token }, body: JSON.stringify({ query, variables }) }, 'shopify graphql');
  /* Shopify answers a throttled query with 200 and THROTTLED: wait for the bucket to refill and ask again */
  if (j.errors?.some((x) => x.extensions?.code === 'THROTTLED') && tries < 4) { await nap(gql.wait ?? 2e3 * 2 ** tries); return gql(c, query, variables, tries + 1); }
  if (j.errors?.length) { const e = new Error(`shopify: ${j.errors.map((x) => x.message).join('; ').slice(0, 200)}`); e.denied = j.errors.some((x) => /access denied|not approved|protected customer data|ACCESS_DENIED/i.test(x.message + JSON.stringify(x.extensions || {}))); throw e; }
  return j.data;
}

const ORDER_PAGES = 40; /* 10,000 orders */
/* orders since a day, cancelled ones left out. limit:null counts past Shopify's default cap of 10,000; a big store's whole
   30 days can time out (TIMEOUT), so then it is counted again in 5-day windows, each small enough to finish */
async function countOrders(c, since) {
  const one = async (q) => { const d = await gql(c, 'query($q:String){ n: ordersCount(query:$q, limit:null){ count } }', { q }); if (!has(d?.n?.count)) throw new Error('no count'); return d.n.count; };
  const net = async (w) => (await one(w)) - (await one(`${w} status:cancelled`));
  /* exact timestamps, never bare dates: Shopify reads created_at:<2026-10-20 as "up to the end of the 20th", so date windows
     overlap and count every order twice. The same UTC start for the whole count and the windows */
  const iso = (t) => `'${new Date(t).toISOString()}'`, from = Date.parse(since), DAY = 864e5;
  try { return await net(`created_at:>=${iso(from)}`); }
  catch { let n = 0; for (let t = from; t < Date.now() + DAY; t += 5 * DAY) n += await net(`created_at:>=${iso(t)} created_at:<${iso(t + 5 * DAY)}`); return n; }
}
/* COD orders 10 to 40 days old, newest first, up to 8 pages: a sample big enough for the failed share */
async function codWindow(c) {
  const out = []; let a = null;
  for (let i = 0; i < 8; i++) { const d = await gql(c, 'query($q:String,$a:String){ orders(first:250, after:$a, query:$q, sortKey:CREATED_AT, reverse:true){ pageInfo{ hasNextPage endCursor } nodes{ createdAt cancelledAt displayFinancialStatus paymentGatewayNames } } }', { q: `created_at:>=${dayISO(40 * 864e5)} created_at:<=${dayISO(10 * 864e5)}`, a });
    out.push(...d.orders.nodes); if (!d.orders.pageInfo.hasNextPage) break; a = d.orders.pageInfo.endCursor; }
  return out;
}
/* a product title cut at a word, never mid-word ("Conditioner - 15") */
const cut = (t, n = 44) => { t = String(t || '').trim(); if (t.length <= n) return t; const s = t.slice(0, n - 1), i = s.lastIndexOf(' '); return `${(i > n * 0.6 ? s.slice(0, i) : s).replace(/[\s,–—-]+$/, '')}…`; };

export default {
  id: 'shopify', name: 'Shopify', modes: ['oauth', 'key'],
  ready: () => !!(app().id && app().secret),
  /* a dead token (the app uninstalled, the token revoked or run out, a refresh refused): only connecting again fixes it */
  /* also an own app whose secret was rotated (invalid_client) or a store that left the app's organization (shop_not_permitted) */
  expired: (e) => e?.status === 401 || /invalid.?(api )?(access )?token|invalid_grant|invalid_client|shop_not_permitted|token (was )?(revoked|expired|has expired)|unauthorized|\[API\] Invalid API key/i.test(String(e?.message || '')),
  // one-click sign-in only once Shopify has reviewed squareup-prod (SHOPIFY_OAUTH=1); until then a brand pastes its own app's key
  oauthOn: () => process.env.SHOPIFY_OAUTH === '1',
  keyFields: [{ k: 'shop', label: 'Store address', hint: 'your-store.myshopify.com' }, { k: 'clientId', label: 'Client ID', hint: 'From your app in the Shopify Dev Dashboard', optional: true }, { k: 'clientSecret', label: 'Client secret', secret: true, optional: true }, { k: 'token', label: 'Or an Admin API access token', hint: 'shpat_…, from a custom app in your Shopify admin', secret: true, optional: true }],
  authorize({ state, redirect, shop }) {
    const s = shopOf(shop); if (!s) throw Object.assign(new Error('Enter your store address, like your-store.myshopify.com.'), { user: true });
    return `https://${s}/admin/oauth/authorize?${form({ client_id: app().id, scope: scopes(), redirect_uri: redirect, state })}`;
  },
  async exchange({ query }) {
    const a = app(); if (!hmacOk(query, a.secret)) throw new Error('shopify: the redirect signature did not match');
    const shop = shopOf(query.get('shop')); if (!shop) throw new Error('shopify: bad shop');
    return setOf(await token(shop, { client_id: a.id, client_secret: a.secret, code: query.get('code'), expiring: 1 }), { shop, app: 'brew' });
  },
  async fromKey({ shop, token: tk, clientId, clientSecret }) {
    const s = shopOf(shop); if (!s) throw Object.assign(new Error('Enter your store address, like your-store.myshopify.com.'), { user: true });
    if (tk) { if (!/^shp(at|ca|ss|pa)_/.test(tk.trim())) throw Object.assign(new Error('That does not look like an Admin API access token (it starts with shpat_).'), { user: true }); return { shop: s, token: tk.trim(), app: 'token' }; }
    if (!clientId || !clientSecret) throw Object.assign(new Error('Paste the client ID and secret of your app, or an Admin API access token.'), { user: true });
    const t = await token(s, { grant_type: 'client_credentials', client_id: clientId.trim(), client_secret: clientSecret.trim() }).catch((e) => {
      /* the own-app route only reaches a store in the app's own Shopify organization; say so instead of Shopify's code */
      /* the app sits in another Shopify organization (an agency's or a collaborator's): the store approves it once (ownAuthorize), and the code comes back as an offline token */
      if (/shop_not_permitted/i.test(e.message)) throw Object.assign(new Error(`${s} is in another Shopify organization than this app, so Shopify asks the store to approve it once. Approve it in the Shopify tab that opens.`), { user: true, approve: { shop: s, clientId: clientId.trim(), clientSecret: clientSecret.trim() } });
      if (/invalid_client/i.test(e.message)) throw Object.assign(new Error('Shopify did not accept that Client ID and secret. Copy both again from the app’s Settings.'), { user: true });
      throw e;
    });
    return setOf(t, { shop: s, app: 'own', clientId: clientId.trim(), clientSecret: clientSecret.trim() });
  },
  /* the brand's own app installed from another organization (custom distribution): Shopify's approve screen, back to /shopify/own/callback */
  ownAuthorize: ({ shop, clientId, state, redirect }) => `https://${shop}/admin/oauth/authorize?${form({ client_id: clientId, scope: 'read_products,read_inventory,read_orders,read_customers', redirect_uri: redirect, state })}`,
  async ownExchange({ query, pend }) {
    if (!hmacOk(query, pend.clientSecret)) throw new Error('shopify: the redirect signature did not match');
    const shop = shopOf(query.get('shop')); if (!shop || shop !== pend.shop) throw new Error('shopify: the store that answered is not the one being connected');
    /* an offline token that doesn't expire: nothing to refresh, and connecting again replaces it */
    return setOf(await token(shop, { client_id: pend.clientId, client_secret: pend.clientSecret, code: query.get('code') }), { shop, app: 'own-oauth', clientId: pend.clientId, clientSecret: pend.clientSecret });
  },
  // tokens expire: the public app refreshes with its refresh token, the brand's own app mints a new one
  async fresh(c) {
    if (!c.exp || c.exp > Date.now() + 120e3) return c;
    if (c.app === 'own') return { ...c, ...setOf(await token(c.shop, { grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret })) };
    if (c.refresh && c.app === 'own-oauth') return { ...c, ...setOf(await token(c.shop, { client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token', refresh_token: c.refresh })) };
    if (c.refresh) { const a = app(); return { ...c, ...setOf(await token(c.shop, { client_id: a.id, client_secret: a.secret, grant_type: 'refresh_token', refresh_token: c.refresh })) }; }
    return c;
  },
  async owns(c, ctx) {
    const d = await gql(c, '{ shop { name myshopifyDomain primaryDomain { host } currencyCode } }');
    /* strong proof: the token only works on that store, and a store's primary domain needs the domain's DNS. The same site exactly,
       or the store the read found on the brand's site; never a parent domain (brand.myshopify.com is not myshopify.com) */
    const s = d.shop, ok = exactSite(s.primaryDomain?.host, ctx.host) || (!!ctx.shopifyShop && s.myshopifyDomain === ctx.shopifyShop);
    return { ok, strong: ok, account: { id: s.myshopifyDomain, name: `${s.name} · ${s.primaryDomain?.host || s.myshopifyDomain}` }, why: ok ? `Shopify store ${s.myshopifyDomain} is ${ctx.host}` : `${s.myshopifyDomain} serves ${s.primaryDomain?.host || 'another domain'}, not ${ctx.host}` };
  },
  async sync(c, ctx) {
    /* money in the store's own currency (a store in USD for a brand read as Indian said "₹" before), and each row says which */
    const cur = await gql(c, '{ shop { currencyCode } }').then((d) => d?.shop?.currencyCode || null).catch(() => null);
    const F = fmt(cur ? { ...ctx.profile, currency: cur, ...(cur === 'INR' ? { country: 'IN', locale: 'en-IN' } : ctx.profile?.country === 'IN' ? { country: 'XX', locale: 'en-US' } : {}) } : ctx.profile), notes = [], m = {};
    // orders, last 90 days (customers too when the token may read them)
    const since90 = dayISO(90 * 864e5), since30 = dayISO(30 * 864e5), cut30 = Date.now() - 30 * 864e5;
    const Q = (cust) => `query($q:String,$a:String){ orders(first:250, after:$a, query:$q, sortKey:CREATED_AT, reverse:true){ pageInfo{ hasNextPage endCursor } nodes{ createdAt cancelledAt displayFinancialStatus paymentGatewayNames totalPriceSet{ shopMoney{ amount } } ${cust ? 'customer{ id numberOfOrders }' : ''} lineItems(first:5){ nodes{ title quantity } } } } }`;
    /* newest first, up to ORDER_PAGES pages: a big store's 90 days don't fit, so what was read is a sample of the newest orders
       (full30/full90 say whether a window was read whole). Counts then come from Shopify's own ordersCount, and averages and
       shares from the sample; a note says how far back the read reached */
    let orders = null, withCust = true, full90 = false;
    try {
      for (const cust of [true, false]) {
        try { orders = []; full90 = false; let a = null; for (let i = 0; i < ORDER_PAGES; i++) { const d = await gql(c, Q(cust), { q: `created_at:>=${since90}`, a }); orders.push(...d.orders.nodes); if (!d.orders.pageInfo.hasNextPage) { full90 = true; break; } a = d.orders.pageInfo.endCursor; } withCust = cust; break; }
        catch (e) { if (!cust || !e.denied) throw e; }
      }
    } catch (e) { orders = null; notes.push(e.denied ? 'Orders need Shopify’s approval for this app; connect with your own app’s key to read them.' : `Orders: ${e.message.slice(0, 120)}`); }
    if (orders) {
      const live = orders.filter((o) => !o.cancelledAt), o30 = live.filter((o) => Date.parse(o.createdAt) >= cut30);
      const oldest = orders.length ? Math.min(...orders.map((o) => Date.parse(o.createdAt))) : Date.now(), full30 = full90 || oldest <= cut30;
      m.sampled = !full30; m.readDays = Math.max(1, Math.round((Date.now() - oldest) / 864e5));
      const sum = o30.reduce((s, o) => s + +o.totalPriceSet.shopMoney.amount, 0); m.aov = o30.length ? sum / o30.length : null;
      if (full30) { m.orders = o30.length; m.revenue = sum; }
      else { /* the 30 days didn't fit: Shopify counts them, the newest orders give the average */
        const n = await countOrders(c, since30).catch((e) => { notes.push(`Order count: ${e.message.slice(0, 100)}`); return null; });
        m.orders = n; m.revenue = has(n, m.aov) ? n * m.aov : null;
        notes.push(`Read the newest ${n0(orders.length)} orders (${m.readDays} days); averages and shares come from those.`); }
      const isCod = (o) => (o.paymentGatewayNames || []).some((g) => /cash on delivery|\bcod\b|cash_on_delivery|pay on delivery/i.test(g));
      if (o30.length) m.cod = 100 * o30.filter(isCod).length / o30.length;
      // COD orders 10 to 40 days old that were cancelled or are still not paid: their own read when the main one stopped short of 40 days
      const inWin = (o) => { const t = Date.parse(o.createdAt); return t < Date.now() - 10 * 864e5 && t >= Date.now() - 40 * 864e5; };
      const older = full90 || oldest <= Date.now() - 40 * 864e5 ? orders : await codWindow(c).catch((e) => { notes.push(`COD orders 10 to 40 days old: ${e.message.slice(0, 100)}`); return []; });
      const settled = older.filter((o) => isCod(o) && inWin(o));
      if (settled.length >= 20) m.codFail = 100 * settled.filter((o) => o.cancelledAt || !/^(PAID|PARTIALLY_PAID|PARTIALLY_REFUNDED|REFUNDED)$/.test(o.displayFinancialStatus)).length / settled.length;
      if (withCust) { const cs = new Map(); for (const o of live) if (o.customer?.id) cs.set(o.customer.id, o.customer.numberOfOrders); if (cs.size >= 30) m.repeat = 100 * [...cs.values()].filter((n) => +n >= 2).length / cs.size; }
      const units = new Map(); for (const o of o30) for (const li of o.lineItems.nodes) units.set(li.title, (units.get(li.title) || 0) + li.quantity);
      m.top = [...units.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, u]) => ({ title, units: u }));
    }
    /* where the orders ship, 90 days: the brand's real selling market (market.js), which beats the read's guess from the site.
       Its own query (an address field may need Shopify's protected-data approval): a refusal leaves every other number alone */
    if (orders?.length) try {
      const cc = new Map(); let a = null, n = 0;
      for (let i = 0; i < 4; i++) { const d = await gql(c, 'query($q:String,$a:String){ orders(first:250, after:$a, query:$q){ pageInfo{ hasNextPage endCursor } nodes{ cancelledAt shippingAddress{ countryCodeV2 } } } }', { q: `created_at:>=${since90}`, a });
        for (const o of d.orders.nodes) { const x = o.shippingAddress?.countryCodeV2; if (!o.cancelledAt && x) { cc.set(x, (cc.get(x) || 0) + 1); n++; } }
        if (!d.orders.pageInfo.hasNextPage) break; a = d.orders.pageInfo.endCursor; }
      if (n) { m.shipTo = [...cc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([x, k]) => [x, 100 * k / n]); m.shipToN = n; }
    } catch (e) { if (!e.denied) notes.push(`Order countries: ${e.message.slice(0, 100)}`); }
    try { const d = await gql(c, 'query($q:String){ abandonedCheckoutsCount(query:$q){ count } }', { q: `created_at:>=${dayISO(30 * 864e5)}` }); m.left = d.abandonedCheckoutsCount?.count ?? null; if (has(m.left, m.orders)) m.started = m.left + m.orders; }
    catch (e) { if (!e.denied) notes.push(`Checkouts: ${e.message.slice(0, 100)}`); }
    try { const d = await gql(c, '{ productsCount(query:"status:active"){ count } products(first:100, sortKey:INVENTORY_TOTAL, query:"status:active"){ nodes{ title totalInventory tracksInventory onlineStoreUrl variants(first:5){ nodes{ inventoryPolicy } } } } }');
      /* only what a shopper can't buy: on the online store (onlineStoreUrl), tracked, and no variant that keeps selling at zero (CONTINUE) */
      const shown = (p) => p.tracksInventory && p.onlineStoreUrl !== null && !(p.variants?.nodes || []).some((v) => v.inventoryPolicy === 'CONTINUE');
      m.products = d.productsCount?.count ?? null; m.low = d.products.nodes.filter((p) => shown(p) && p.totalInventory <= 5).map((p) => ({ title: p.title, left: p.totalInventory }));
      /* sold out: tracked products with none left. The list comes lowest stock first, so the count is whole once a product with stock shows (or every product was read) */
      const ns = d.products.nodes; if (has(m.products) && (m.products <= ns.length || ns.some((p) => p.totalInventory > 0))) m.oos = ns.filter((p) => shown(p) && p.totalInventory <= 0).length; }
    catch (e) { notes.push(`Products: ${e.message.slice(0, 100)}`); }

    const src = `Shopify · ${c.shop}`, k = 'shopify', name = 'Shopify', lane = ctx.lane, out = [];
    const stats = [has(m.orders) && ['Orders, last 30 days', n0(m.orders)], has(m.aov) && ['Average order', F.money(m.aov)], has(m.repeat) && ['Customers with 2+ orders (90 days)', pct(m.repeat)], has(m.left) && ['Checkouts left, 30 days', n0(m.left)], has(m.products) && ['Active products', n0(m.products)]].filter(Boolean).slice(0, 4);
    if (has(m.left, m.started, m.aov) && m.left > 0) out.push(card(k, name, lane, 'carts', { agent: 'crm', sector: 'signals', type: 'decision', roles: ['crm', 'founder', 'ecom'], badge: ['Shopify', 'info'], cta: 'Turn on the journey',
      title: `${n0(m.left)} checkouts left in the last 30 days`, sub: `${n0(m.started)} people started checkout and ${n0(m.orders)} finished. A three-step reminder across email and WhatsApp, starting an hour after they leave, brings some of them back.`,
      rows: [['Checkouts started', n0(m.started)], ['Finished', n0(m.orders)], ['Left', n0(m.left)], ['Average order', F.money(m.aov)]], detail: { why: [`${pct(100 * m.left / m.started)} of checkouts were not finished.`, `The average order is ${F.money(m.aov)}.`], how: ['Send a reminder after one hour', 'Send the product and its reviews after a day', 'Stop the moment they buy'] } }));
    if (has(m.repeat)) out.push(card(k, name, lane, 'repeat', { agent: 'crm', sector: 'signals', type: 'idea', roles: ['crm', 'founder'], badge: [pct(m.repeat), m.repeat < 25 ? 'warn' : 'ok'], cta: 'Approve the flows',
      title: `${pct(m.repeat)} of your ${m.sampled ? 'recent' : 'last 90 days’'} customers have ordered more than once`, sub: `A second-order flow timed to when the first order runs out turns more first-time buyers into regulars, with no ad spend.`,
      rows: [['Customers with 2+ orders', pct(m.repeat)], ['Orders, 30 days', has(m.orders) ? n0(m.orders) : null], ['Top seller, 30 days', m.top?.[0]?.title], ['Average order', has(m.aov) ? F.money(m.aov) : null]], detail: { why: ['A second order costs no ad spend.'], how: ['Pick the day the flow starts', 'Write the three messages', 'Leave out anyone with an open return'] } }));
    if (F.india && has(m.cod, m.codFail) && m.cod >= 5 && m.codFail >= 5) out.push(card(k, name, lane, 'cod', { agent: 'storefront', sector: 'storefront', type: 'decision', roles: ['ecom', 'founder'], badge: [`${pct(m.codFail)} fail`, m.codFail > 15 ? 'warn' : 'info'], cta: 'Agree with the call',
      title: `${pct(m.codFail)} of cash-on-delivery orders were cancelled or never paid`, sub: `Cash on delivery is ${pct(m.cod)} of last month’s orders. A WhatsApp confirm before dispatch and a small prepaid nudge cut the failed ones without losing the buyers who need COD.`,
      rows: [['COD share of orders', pct(m.cod)], ['Cancelled or unpaid after 10 days', pct(m.codFail)], ['Orders, 30 days', n0(m.orders)]], detail: { why: ['A failed COD order costs shipping both ways.'], how: ['Ask for a WhatsApp confirm on COD', 'Offer a small prepaid discount', 'Read it again in 30 days'] } }));
    const gone = (m.low || []).filter((x) => x.left <= 0).length, near = (m.low?.length || 0) - gone;
    if (m.low?.length) out.push(card(k, name, lane, 'stock', { agent: 'storefront', sector: 'catalog', type: 'decision', roles: ['ecom', 'founder'], badge: [gone ? `${gone} sold out` : `${m.low.length} low`, 'warn'], cta: 'Plan the restock',
      title: gone && near ? `${gone} product${gone === 1 ? ' is' : 's are'} sold out and ${near} ${near === 1 ? 'has' : 'have'} 5 or fewer units left` : gone ? `${gone} product${gone === 1 ? ' is' : 's are'} sold out on your store` : `${near} product${near === 1 ? ' has' : 's have'} 5 or fewer units left`,
      sub: `${m.low.slice(0, 2).map((x) => x.title).join(' and ')}${m.low.length > 2 ? ` and ${m.low.length - 2} more` : ''} ${gone && !near ? (m.low.length === 1 ? 'is' : 'are') + ' sold out' : gone ? 'are sold out or close to it' : (m.low.length === 1 ? 'is' : 'are') + ' close to selling out'}. Pause their ads, and start a back-in-stock list.`,
      rows: m.low.slice(0, 4).map((x) => [cut(x.title), x.left <= 0 ? 'Sold out' : `${n0(x.left)} left`]), detail: { why: ['Ads on a sold-out product waste spend.'], how: ['Pause ads on these products', 'Turn on a back-in-stock list', 'Restock the best sellers first'] } }));
    const changed = [has(m.orders) && (m.orders > 0 ? `Cards read your ${n0(m.orders)} orders from the last 30 days` : 'No orders in the last 30 days yet: order cards start with the first one'), has(m.left) && m.left > 0 && `${n0(m.left)} checkouts left get a reminder journey`, has(m.repeat) && `Second orders: ${pct(m.repeat)} of recent customers`, m.low?.length && `${m.low.length} product${m.low.length === 1 ? ' is' : 's are'} close to selling out`].filter(Boolean);
    const ledger = [has(m.orders) && L('shopify.orders.30d', 'Orders, last 30 days', n0(m.orders), m.orders, src), has(m.aov) && L('shopify.aov', 'Average order value, 30 days', F.money(m.aov), m.aov, src), has(m.revenue) && L('shopify.revenue.30d', 'Revenue, last 30 days', F.big(m.revenue), m.revenue, src),
      has(m.repeat) && L('shopify.repeat.90d', 'Customers in the last 90 days with 2+ orders', pct(m.repeat), m.repeat, src), has(m.left) && L('shopify.checkout.left', 'Checkouts started but not finished, 30 days', n0(m.left), m.left, src),
      has(m.cod) && L('shopify.cod.share', 'Cash on delivery share of orders, 30 days', pct(m.cod), m.cod, src), has(m.codFail) && L('shopify.cod.failed', 'COD orders cancelled or unpaid after 10 days', pct(m.codFail), m.codFail, src),
      m.shipTo?.length && L('shopify.orders.countries', 'Orders by shipping country, 90 days', m.shipTo.map(([x, s]) => `${x} ${s.toFixed(0)}%`).join('; '), m.shipToN, src),
      has(m.products) && L('shopify.products.active', 'Active products (Shopify admin)', n0(m.products), m.products, src), /* beats the public products.json count on the fact sheet (facts-desk.js PRECEDENCE) */
      has(m.oos) && L('shopify.products.out_of_stock', 'Out of stock products (Shopify admin)', n0(m.oos), m.oos, src), /* beats the site's out-of-stock count (facts-desk.js PRECEDENCE) */
      m.top?.length && L('shopify.top.30d', 'Best sellers by units, 30 days', m.top.map((x) => `${x.title} (${x.units})`).join('; '), null, src)].filter(Boolean);
    if (cur) ledger.push(L('shopify.currency', 'Shop currency (Shopify admin)', cur, null, src)); /* beats the site's /meta.json currency on the fact sheet */
    if (cur) for (const r of ledger) r.cur = cur;
    /* the store's own brand settings (Settings › Brand): the logo, colours, slogan and short description the merchant set on
       purpose. The Brand Book ranks them above anything read off the site; a store that set none (or a refusal) changes nothing */
    /* the Admin API (2026-04) has no shop.brand any more (Settings › Brand is Storefront-only now): the store's own description
       is what is left. Logo and colours stay with the site read */
    const brand = await gql(c, '{ shop{ description } }')
      .then((d) => { const about = String(d?.shop?.description || '').trim(); return about ? { slogan: null, about, logo: null, squareLogo: null, cover: null, colors: [] } : null; })
      .catch((e) => { if (!e.denied) notes.push(`Store description: ${e.message.slice(0, 100)}`); return null; });
    return { metrics: m, stats, changed, cards: out, ledger, notes, brand };
  }
};
