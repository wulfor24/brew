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
const setOf = (t, extra = {}) => ({ token: t.access_token, scope: t.scope || '', exp: t.expires_in ? Date.now() + t.expires_in * 1e3 : null, refresh: t.refresh_token || null, ...extra });

async function gql(c, query, variables) {
  const j = await getJSON(`https://${c.shop}/admin/api/${API}/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': c.token }, body: JSON.stringify({ query, variables }) }, 'shopify graphql');
  if (j.errors?.length) { const e = new Error(`shopify: ${j.errors.map((x) => x.message).join('; ').slice(0, 200)}`); e.denied = j.errors.some((x) => /access denied|not approved|protected customer data|ACCESS_DENIED/i.test(x.message + JSON.stringify(x.extensions || {}))); throw e; }
  return j.data;
}

export default {
  id: 'shopify', name: 'Shopify', modes: ['oauth', 'key'],
  ready: () => !!(app().id && app().secret),
  /* a dead token (the app uninstalled, the token revoked or run out, a refresh refused): only connecting again fixes it */
  expired: (e) => e?.status === 401 || /invalid.?(api )?(access )?token|invalid_grant|token (was )?(revoked|expired|has expired)|unauthorized|\[API\] Invalid API key/i.test(String(e?.message || '')),
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
    return setOf(await token(s, { grant_type: 'client_credentials', client_id: clientId.trim(), client_secret: clientSecret.trim() }), { shop: s, app: 'own', clientId: clientId.trim(), clientSecret: clientSecret.trim() });
  },
  // tokens expire: the public app refreshes with its refresh token, the brand's own app mints a new one
  async fresh(c) {
    if (!c.exp || c.exp > Date.now() + 120e3) return c;
    if (c.app === 'own') return { ...c, ...setOf(await token(c.shop, { grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret })) };
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
    const F = fmt(ctx.profile), notes = [], m = {};
    // orders, last 90 days (customers too when the token may read them)
    const since90 = dayISO(90 * 864e5), cut30 = Date.now() - 30 * 864e5;
    const Q = (cust) => `query($q:String,$a:String){ orders(first:250, after:$a, query:$q, sortKey:CREATED_AT, reverse:true){ pageInfo{ hasNextPage endCursor } nodes{ createdAt cancelledAt displayFinancialStatus paymentGatewayNames totalPriceSet{ shopMoney{ amount } } ${cust ? 'customer{ id numberOfOrders }' : ''} lineItems(first:5){ nodes{ title quantity } } } } }`;
    let orders = null, withCust = true;
    try {
      for (const cust of [true, false]) {
        try { orders = []; let a = null; for (let i = 0; i < 24; i++) { const d = await gql(c, Q(cust), { q: `created_at:>=${since90}`, a }); orders.push(...d.orders.nodes); if (!d.orders.pageInfo.hasNextPage) break; a = d.orders.pageInfo.endCursor; } withCust = cust; break; }
        catch (e) { if (!cust || !e.denied) throw e; }
      }
    } catch (e) { orders = null; notes.push(e.denied ? 'Orders need Shopify’s approval for this app; connect with your own app’s key to read them.' : `Orders: ${e.message.slice(0, 120)}`); }
    if (orders) {
      const live = orders.filter((o) => !o.cancelledAt), o30 = live.filter((o) => Date.parse(o.createdAt) >= cut30);
      m.orders = o30.length; m.revenue = o30.reduce((s, o) => s + +o.totalPriceSet.shopMoney.amount, 0); m.aov = m.orders ? m.revenue / m.orders : null;
      const isCod = (o) => (o.paymentGatewayNames || []).some((g) => /cash on delivery|\bcod\b|cash_on_delivery|pay on delivery/i.test(g));
      if (o30.length) m.cod = 100 * o30.filter(isCod).length / o30.length;
      // COD orders 10 to 40 days old that were cancelled or are still not paid
      const settled = orders.filter((o) => { const t = Date.parse(o.createdAt); return isCod(o) && t < Date.now() - 10 * 864e5 && t >= Date.now() - 40 * 864e5; });
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
    try { const d = await gql(c, '{ productsCount(query:"status:active"){ count } products(first:100, sortKey:INVENTORY_TOTAL, query:"status:active"){ nodes{ title totalInventory tracksInventory } } }');
      m.products = d.productsCount?.count ?? null; m.low = d.products.nodes.filter((p) => p.tracksInventory && p.totalInventory <= 5).map((p) => ({ title: p.title, left: p.totalInventory })); }
    catch (e) { notes.push(`Products: ${e.message.slice(0, 100)}`); }

    const src = `Shopify · ${c.shop}`, k = 'shopify', name = 'Shopify', lane = ctx.lane, out = [];
    const stats = [has(m.orders) && ['Orders, last 30 days', n0(m.orders)], has(m.aov) && ['Average order', F.money(m.aov)], has(m.repeat) && ['Customers with 2+ orders (90 days)', pct(m.repeat)], has(m.left) && ['Checkouts left, 30 days', n0(m.left)], has(m.products) && ['Active products', n0(m.products)]].filter(Boolean).slice(0, 4);
    if (has(m.left, m.started, m.aov) && m.left > 0) out.push(card(k, name, lane, 'carts', { agent: 'crm', sector: 'signals', type: 'decision', roles: ['crm', 'founder', 'ecom'], badge: ['Shopify', 'info'], cta: 'Turn on the journey',
      title: `${n0(m.left)} checkouts left in the last 30 days`, sub: `${n0(m.started)} people started checkout and ${n0(m.orders)} finished. A three-step reminder across email and WhatsApp, starting an hour after they leave, brings some of them back.`,
      rows: [['Checkouts started', n0(m.started)], ['Finished', n0(m.orders)], ['Left', n0(m.left)], ['Average order', F.money(m.aov)]], detail: { why: [`${pct(100 * m.left / m.started)} of checkouts were not finished.`, `The average order is ${F.money(m.aov)}.`], how: ['Send a reminder after one hour', 'Send the product and its reviews after a day', 'Stop the moment they buy'] } }));
    if (has(m.repeat)) out.push(card(k, name, lane, 'repeat', { agent: 'crm', sector: 'signals', type: 'idea', roles: ['crm', 'founder'], badge: [pct(m.repeat), m.repeat < 25 ? 'warn' : 'ok'], cta: 'Approve the flows',
      title: `${pct(m.repeat)} of your last 90 days’ customers have ordered more than once`, sub: `A second-order flow timed to when the first order runs out turns more first-time buyers into regulars, with no ad spend.`,
      rows: [['Customers with 2+ orders', pct(m.repeat)], ['Orders, 30 days', has(m.orders) ? n0(m.orders) : null], ['Top seller, 30 days', m.top?.[0]?.title], ['Average order', has(m.aov) ? F.money(m.aov) : null]], detail: { why: ['A second order costs no ad spend.'], how: ['Pick the day the flow starts', 'Write the three messages', 'Leave out anyone with an open return'] } }));
    if (F.india && has(m.cod, m.codFail) && m.cod >= 5 && m.codFail >= 5) out.push(card(k, name, lane, 'cod', { agent: 'storefront', sector: 'storefront', type: 'decision', roles: ['ecom', 'founder'], badge: [`${pct(m.codFail)} fail`, m.codFail > 15 ? 'warn' : 'info'], cta: 'Agree with the call',
      title: `${pct(m.codFail)} of cash-on-delivery orders were cancelled or never paid`, sub: `Cash on delivery is ${pct(m.cod)} of last month’s orders. A WhatsApp confirm before dispatch and a small prepaid nudge cut the failed ones without losing the buyers who need COD.`,
      rows: [['COD share of orders', pct(m.cod)], ['Cancelled or unpaid after 10 days', pct(m.codFail)], ['Orders, 30 days', n0(m.orders)]], detail: { why: ['A failed COD order costs shipping both ways.'], how: ['Ask for a WhatsApp confirm on COD', 'Offer a small prepaid discount', 'Read it again in 30 days'] } }));
    if (m.low?.length) out.push(card(k, name, lane, 'stock', { agent: 'storefront', sector: 'catalog', type: 'decision', roles: ['ecom', 'founder'], badge: [`${m.low.length} low`, 'warn'], cta: 'Plan the restock',
      title: `${m.low.length} active product${m.low.length === 1 ? ' has' : 's have'} 5 or fewer units left`, sub: `${m.low.slice(0, 2).map((x) => x.title).join(' and ')}${m.low.length > 2 ? ' and others' : ''} ${m.low.length === 1 ? 'is' : 'are'} close to selling out. Pause their ads before they do, and start a back-in-stock list.`,
      rows: m.low.slice(0, 4).map((x) => [x.title.slice(0, 40), `${n0(x.left)} left`]), detail: { why: ['Ads on a sold-out product waste spend.'], how: ['Pause ads on these products', 'Turn on a back-in-stock list', 'Restock the best sellers first'] } }));
    const changed = [has(m.orders) && (m.orders > 0 ? `Cards read your ${n0(m.orders)} orders from the last 30 days` : 'No orders in the last 30 days yet: order cards start with the first one'), has(m.left) && m.left > 0 && `${n0(m.left)} checkouts left get a reminder journey`, has(m.repeat) && `Second orders: ${pct(m.repeat)} of recent customers`, m.low?.length && `${m.low.length} product${m.low.length === 1 ? ' is' : 's are'} close to selling out`].filter(Boolean);
    const ledger = [has(m.orders) && L('shopify.orders.30d', 'Orders, last 30 days', n0(m.orders), m.orders, src), has(m.aov) && L('shopify.aov', 'Average order value, 30 days', F.money(m.aov), m.aov, src), has(m.revenue) && L('shopify.revenue.30d', 'Revenue, last 30 days', F.big(m.revenue), m.revenue, src),
      has(m.repeat) && L('shopify.repeat.90d', 'Customers in the last 90 days with 2+ orders', pct(m.repeat), m.repeat, src), has(m.left) && L('shopify.checkout.left', 'Checkouts started but not finished, 30 days', n0(m.left), m.left, src),
      has(m.cod) && L('shopify.cod.share', 'Cash on delivery share of orders, 30 days', pct(m.cod), m.cod, src), has(m.codFail) && L('shopify.cod.failed', 'COD orders cancelled or unpaid after 10 days', pct(m.codFail), m.codFail, src),
      m.shipTo?.length && L('shopify.orders.countries', 'Orders by shipping country, 90 days', m.shipTo.map(([x, s]) => `${x} ${s.toFixed(0)}%`).join('; '), m.shipToN, src),
      has(m.products) && L('shopify.products.active', 'Active products (Shopify admin)', n0(m.products), m.products, src), /* beats the public products.json count on the fact sheet (facts-desk.js PRECEDENCE) */
      m.top?.length && L('shopify.top.30d', 'Best sellers by units, 30 days', m.top.map((x) => `${x.title} (${x.units})`).join('; '), null, src)].filter(Boolean);
    return { metrics: m, stats, changed, cards: out, ledger, notes };
  }
};
