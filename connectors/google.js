// Google Analytics and Google Ads: two connectors on one Google client (offline consent, so it keeps working), on SquareUp's
// Google Ads OAuth client. Google Ads through GAQL searchStream (lifted from SquareUp's tej/ads/google-client.ts);
// GA4 through the Analytics Data API runReport. The brand picks the Ads account and the GA4 property.
// It proves the brand's own when the GA4 web stream or the ads' final URLs are the brand's site.
// GA4 also connects with no Google review at all: the brand adds Brew's service account as a Viewer on its property and
// pastes the property ID (the 'key' mode). The service account is GA4_SA_KEY (a JSON key) or, on Cloud Run, the service's own.
// One-click Google sign-in (adwords + analytics.readonly, both sensitive scopes) is on only with GOOGLE_OAUTH=1, once the
// consent screen and the Ads developer token are set up.
import crypto from 'node:crypto';
import { exactSite, bareHost } from '../auth.js';
import { UA } from '../reader/util.js';
import { card, L, n0, pct, has, fmt, getJSON, form } from './common.js';

/* Google retires each Ads API version about a year after release, and a retired one answers 404 to every call (v21 did by
   2026-10-16, which showed as "no Google Ads account"). Bump GOOGLE_ADS_API_VERSION when Google's sunset email comes. */
const ADS = `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || 'v26'}`, ADMIN = 'https://analyticsadmin.googleapis.com/v1beta', DATA = 'https://analyticsdata.googleapis.com/v1beta';
const app = () => ({ id: process.env.GOOGLE_ADS_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '', secret: process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '', dev: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '' });
const SCOPES = 'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly openid email';
const tok = (o) => getJSON('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(o) }, 'google token');
const auth = (c) => ({ authorization: `Bearer ${c.token}` });
async function gaql(c, customer, query) {
  const h = { ...auth(c), 'developer-token': app().dev, 'content-type': 'application/json', 'login-customer-id': String(c.login || customer) };
  const j = await getJSON(`${ADS}/customers/${customer}/googleAds:searchStream`, { method: 'POST', headers: h, body: JSON.stringify({ query }) }, 'google ads');
  return (j || []).flatMap((b) => b.results || []);
}
const report = (c, body) => getJSON(`${DATA}/${c.property}:runReport`, { method: 'POST', headers: { ...auth(c), 'content-type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate: '30daysAgo', endDate: 'yesterday' }], ...body }) }, 'ga4 report');

/* the service account: a pasted JSON key, or the Cloud Run service's own identity from the metadata server */
const SA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly', MD = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/';
const saKey = () => { try { return JSON.parse(process.env.GA4_SA_KEY || 'null'); } catch { return null; } };
const saOn = () => !!(saKey()?.private_key || process.env.K_SERVICE);
let saMail = process.env.GA4_SA_EMAIL || saKey()?.client_email || null;
export async function saEmail() {
  if (saMail || !process.env.K_SERVICE) return saMail;
  try { const r = await fetch(`${MD}email`, { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(3e3) }); if (r.ok) saMail = (await r.text()).trim(); } catch {}
  return saMail;
}
saEmail().catch(() => {});
async function saToken() {
  const k = saKey();
  if (k?.private_key) {
    const now = Math.floor(Date.now() / 1e3), b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const un = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({ iss: k.client_email, scope: SA_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const t = await tok({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${un}.${crypto.sign('RSA-SHA256', Buffer.from(un), k.private_key).toString('base64url')}` });
    return { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1e3 };
  }
  const j = await getJSON(`${MD}token?scopes=${encodeURIComponent(SA_SCOPE)}`, { headers: { 'metadata-flavor': 'Google' } }, 'ga4 service account');
  return { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1e3 };
}
// the ID, "properties/123", or the GA4 page address (…/#/a12p345678/… or …p345678/…): the property is the number after p
const propOf = (x) => { const raw = String(x || '').trim(), u = raw.match(/(?:\/|a\d+)p(\d{5,14})(?!\d)/); const d = u ? u[1] : raw.replace(/^properties\//, '').replace(/[\s-]/g, ''); return /^\d{5,14}$/.test(d) ? `properties/${d}` : null; };
const userErr = (m) => Object.assign(new Error(m), { user: true });

/* a stream's or an ad's URL is the brand's site when its host is the site (www. ignored), the Shopify store, or one of the
   other hosts the read found for the brand (ctx.hosts: the profile's site hosts and where the site redirects) */
export const siteMatch = (u, ctx) => { const h = bareHost(u); if (!h) return false;
  const hosts = [ctx.host, ctx.shopifyShop, ...(Array.isArray(ctx.hosts) ? ctx.hosts : [])].map(bareHost).filter(Boolean);
  return hosts.some((x) => x === h || exactSite(h, x)); };
/* a store's other myshopify address (cozysnugglet.myshopify.com next to hnhdsm-mc.myshopify.com) is the brand's when Shopify
   sends it to the brand's site: only the store's owner sets the primary domain it redirects to (Shopify answers 429 to Node's
   own user agent, so it goes as the reader's browser) */
export const shopRedirects = async (u, ctx, fetchImpl = fetch) => { const h = bareHost(u); if (!/\.myshopify\.com$/.test(h)) return false;
  try { const r = await fetchImpl(`https://${h}/`, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8e3) });
    return r.status >= 300 && r.status < 400 && siteMatch(r.headers.get('location'), ctx); } catch { return false; } };
const rows = (r) => (r?.rows || []).map((x) => ({ d: (x.dimensionValues || []).map((v) => v.value), m: (x.metricValues || []).map((v) => +v.value) }));

/* Google Analytics (ga4) and Google Ads (google) are two connectors on one Google client. They share the reads below;
   each keeps only its own half. Signing in for Google Ads can also fill Google Analytics in the same step (also()) */
const base = {
  picks: true,
  /* a dead Google token (refresh token revoked, the account's password changed, a 401 on the read): only a new sign-in fixes it */
  expired: (e) => e?.status === 401 || /invalid_grant|invalid_rapt|invalid_token/i.test(String(e?.message || '')),
  keyFields: [{ k: 'property', label: 'GA4 property ID', hint: 'GA4 → Admin → Property details, a number like 123456789' }],
  help: () => (saMail ? `In GA4 → Admin → Property access management, add ${saMail} as a Viewer, then paste the property ID. Brew only reads.` : null),
  helpEmail: () => saMail,
  async fromKey({ property }) {
    const p = propOf(property); if (!p) throw userErr('Paste the GA4 property ID: the number in GA4 → Admin → Property details.');
    if (!saOn()) throw userErr('GA4 by property ID is not set up on this server yet.');
    const t = await saToken(), c = { sa: true, property: p, ...t, accountName: `GA4 ${p.split('/')[1]}` };
    try { const j = await getJSON(`${ADMIN}/${p}`, { headers: auth(c) }, 'ga4 property'); c.accountName = `GA4 · ${j.displayName || p.split('/')[1]}`; }
    catch (e) { if (e.status === 403 || e.status === 404) throw userErr(`Brew can't see property ${p.split('/')[1]} yet. Add ${saMail || 'Brew’s service account'} as a Viewer in GA4 → Admin → Property access management, then try again.`); throw e; }
    return c;
  },
  async exchange({ query, redirect }) {
    const code = query.get('code'); if (!code) throw new Error(`google: ${query.get('error') || 'no code'}`);
    const t = await tok({ grant_type: 'authorization_code', code, client_id: app().id, client_secret: app().secret, redirect_uri: redirect });
    return { token: t.access_token, refresh: t.refresh_token || null, exp: Date.now() + (t.expires_in || 3600) * 1e3, scope: t.scope || '' };
  },
  async fresh(c) { if (c.sa) return c.exp > Date.now() + 120e3 ? c : { ...c, ...(await saToken()) }; if (c.exp > Date.now() + 120e3 || !c.refresh) return c; const t = await tok({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: app().id, client_secret: app().secret }); return { ...c, token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1e3 }; },
  async options(c, { ads = true } = {}) {
    const out = [];
    if (/analytics/.test(c.scope)) { const j = await getJSON(`${ADMIN}/accountSummaries?pageSize=200`, { headers: auth(c) }, 'ga4 accounts').catch(() => ({}));
      for (const a of j.accountSummaries || []) for (const p of a.propertySummaries || []) out.push({ id: p.property, kind: 'ga4', name: p.displayName, sub: `GA4 · ${a.displayName}` }); }
    /* why no Ads account came back is said, never shown as "none": the permission left unticked on Google's screen, or Google's error */
    if (ads) {
      if (!/adwords/.test(c.scope)) out.adsNote = 'Google Ads access wasn’t allowed on Google’s screen. Use another login and tick “See, edit, create and delete your Google Ads accounts”.';
      else if (!app().dev) out.adsNote = 'Google Ads isn’t switched on on this server yet.'; }
    if (ads && /adwords/.test(c.scope) && app().dev) { const j = await getJSON(`${ADS}/customers:listAccessibleCustomers`, { headers: { ...auth(c), 'developer-token': app().dev } }, 'google ads accounts')
        .catch((e) => { console.warn('[google] list ads accounts', e.message); out.adsNote = `Google didn’t list the Ads accounts: ${e.message.replace(/^google ads accounts /, '').slice(0, 140)}`; return {}; });
      if (!out.adsNote && !(j.resourceNames || []).length) out.adsNote = 'Google says this login has no Google Ads account. If you just made one, wait a minute and use another login, or check you picked the same Google account.';
      for (const rn of (j.resourceNames || []).slice(0, 25)) { const id = rn.split('/')[1];
        const r = await gaql(c, id, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1').catch(() => []);
        const x = r[0]?.customer, dash = (n) => String(n).replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
        /* an agency or group signs in with a manager account: list the ad accounts under it, read through the manager */
        if (x?.manager) { const kids = await gaql(c, id, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level <= 2").catch(() => []);
          for (const k2 of kids.map((y) => y.customerClient).filter((y) => y && !y.manager && y.status === 'ENABLED' && String(y.id) !== id))
            if (!out.some((o) => o.kind === 'ads' && o.id.split(':')[0] === String(k2.id))) out.push({ id: `${k2.id}:${id}`, kind: 'ads', name: k2.descriptiveName || `Ads account ${k2.id}`, sub: `Google Ads · ${k2.currencyCode || ''} · ${dash(k2.id)} · via ${x.descriptiveName || dash(id)}` });
          continue; }
        if (!out.some((o) => o.kind === 'ads' && o.id.split(':')[0] === id)) out.push({ id, kind: 'ads', name: x?.descriptiveName || `Ads account ${id}`, sub: `Google Ads · ${x?.currencyCode || ''} · ${dash(id)}` }); } }
    return out;
  },
  async owns(c, ctx) {
    let ok = false, why = '';
    if (c.property) {
      /* a failed read (permission, scope, a 5xx, the service account's token) is an error, never "the stream points elsewhere" */
      let j; try { j = await getJSON(`${ADMIN}/${c.property}/dataStreams`, { headers: auth(c) }, 'ga4 streams'); }
      catch (e) { return { ok: false, error: true, strong: false, why: `Couldn’t read the property’s web streams: ${String(e.message || e).slice(0, 140)}`, account: { id: [c.property, c.customer].filter(Boolean).join(' '), name: c.accountName || 'Google' } }; }
      const streams = j?.dataStreams || [], uris = streams.map((x) => x.webStreamData?.defaultUri).filter(Boolean);
      let s = streams.find((x) => siteMatch(x.webStreamData?.defaultUri, ctx));
      for (const x of s ? [] : streams) if (await shopRedirects(x.webStreamData?.defaultUri, ctx)) { s = x; break; }
      if (s) { ok = true; why = `GA4 stream ${s.displayName} is ${ctx.host}`; }
      else why = `The GA4 stream doesn’t point to ${ctx.host} (streams: ${uris.length ? uris.map(bareHost).join(', ') : 'none with a website'})`;
    }
    if (!ok && c.customer) { const r = await gaql(c, c.customer, "SELECT ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group_ad.status = 'ENABLED' LIMIT 50").catch(() => []);
      if (r.some((x) => (x.adGroupAd?.ad?.finalUrls || []).some((u) => siteMatch(u, ctx)))) { ok = true; why = `The Google ads point to ${ctx.host}`; }
      /* Performance Max has no ad-group ads: its landing pages are on the asset groups */
      if (!ok) { const g = await gaql(c, c.customer, "SELECT asset_group.final_urls FROM asset_group WHERE asset_group.status = 'ENABLED' LIMIT 50").catch(() => []);
        if (g.some((x) => (x.assetGroup?.finalUrls || []).some((u) => siteMatch(u, ctx)))) { ok = true; why = `The Google ads point to ${ctx.host}`; } } }
    /* a GA4 stream's URL and an ad's final URL are typed in by whoever owns the property: never strong enough to own the brand */
    return { ok, strong: false, why: why || (c.property ? `The GA4 stream doesn’t point to ${ctx.host}` : `The Google ads don’t point to ${ctx.host}`), account: { id: [c.property, c.customer].filter(Boolean).join(' '), name: c.accountName || 'Google' } };
  },
  async sync(c, ctx, _deps, k = c.customer ? 'google' : 'ga4') {
    const F = fmt(ctx.profile), m = {}, notes = [];
    if (c.property) {
      try {
        const dev = rows(await report(c, { dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }] }));
        const tot = dev.reduce((s, x) => s + x.m[0], 0), buys = dev.reduce((s, x) => s + x.m[1], 0), mob = dev.find((x) => x.d[0] === 'mobile'), desk = dev.find((x) => x.d[0] === 'desktop');
        m.sessions = tot || null; m.buys = buys; if (tot) { m.cr = 100 * buys / tot; if (mob) { m.mob = 100 * mob.m[0] / tot; m.mobCr = mob.m[0] ? 100 * mob.m[1] / mob.m[0] : null; } if (desk?.m[0]) m.deskCr = 100 * desk.m[1] / desk.m[0]; }
        const ev = rows(await report(c, { dimensions: [{ name: 'eventName' }], metrics: [{ name: 'totalUsers' }], dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: ['session_start', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase'] } } } }));
        const u = Object.fromEntries(ev.map((x) => [x.d[0], x.m[0]])); if (u.session_start && u.view_item) { m.pdp = 100 * u.view_item / u.session_start; if (u.add_to_cart) m.atc = 100 * u.add_to_cart / u.session_start; if (u.begin_checkout) m.checkout = 100 * u.begin_checkout / u.session_start; if (u.purchase) m.buy = 100 * u.purchase / u.session_start; }
        const ch = rows(await report(c, { dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 6 }));
        if (tot) m.mix = ch.map((x) => [x.d[0], 100 * x.m[0] / tot]);
        /* where the visits come from: the calendar plans around the brand's real markets (only the codes leave the team's folder) */
        const co = rows(await report(c, { dimensions: [{ name: 'countryId' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 5 })).filter((x) => /^[A-Z]{2}$/.test(x.d[0]));
        if (tot && co.length) m.countries = co.map((x) => [x.d[0], 100 * x.m[0] / tot]);
      } catch (e) { notes.push(`GA4: ${e.message.slice(0, 140)}`); }
    }
    if (c.customer) {
      try {
        const [t] = await gaql(c, c.customer, 'SELECT customer.currency_code, metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date DURING LAST_30_DAYS');
        if (t) { m.gcur = t.customer?.currencyCode || null; m.gspend = +t.metrics.costMicros / 1e6; m.gclicks = +t.metrics.clicks || 0; m.gconv = +t.metrics.conversions || 0; m.groas = m.gspend ? +t.metrics.conversionsValue / m.gspend : null; }
        const st = await gaql(c, c.customer, 'SELECT search_term_view.search_term, metrics.clicks FROM search_term_view WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.clicks DESC LIMIT 300');
        const name = String(ctx.profile?.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ''), words = name.split(/\s+/).filter((w) => w.length >= 3), host = String(ctx.host || '').split('.')[0];
        const brand = (q) => { q = String(q).toLowerCase(); return (name && q.includes(name)) || (host.length >= 4 && q.includes(host)) || (words.length === 1 && q.split(/\s+/).includes(words[0])); };
        const clicks = st.reduce((s, x) => s + (+x.metrics.clicks || 0), 0);
        if (clicks >= 50) { m.branded = 100 * st.filter((x) => brand(x.searchTermView.searchTerm)).reduce((s, x) => s + (+x.metrics.clicks || 0), 0) / clicks; m.terms = st.filter((x) => !brand(x.searchTermView.searchTerm)).slice(0, 4).map((x) => x.searchTermView.searchTerm); }
      } catch (e) { notes.push(`Google Ads: ${e.message.slice(0, 140)}`); }
    }
    const name = k === 'ga4' ? 'Google Analytics' : 'Google Ads', lane = ctx.lane, src = k === 'ga4' ? 'Google Analytics 4' : 'Google Ads', out = [];
    /* a card only stands on enough data: a few hundred visits and a few purchases, never one order's noise */
    const enough = (m.sessions || 0) >= 500 && (m.buys || 0) >= 5;
    if (enough && has(m.mob, m.mobCr, m.deskCr) && m.deskCr > m.mobCr * 1.3) out.push(card(k, name, lane, 'mobile', { agent: 'storefront', sector: 'storefront', type: 'report', roles: ['ecom', 'founder', 'growth'], badge: ['Mobile', 'warn'], cta: 'Start the tests',
      title: `Phones bring ${pct(m.mob)} of visits but convert at ${pct(m.mobCr, 1)}`, sub: `Desktop converts at ${pct(m.deskCr, 1)}. Closing part of that gap on phones is worth more than a new campaign, so the first test is the mobile product page.`,
      rows: [['Mobile visits', pct(m.mob)], ['Mobile conversion', pct(m.mobCr, 1)], ['Desktop conversion', pct(m.deskCr, 1)], ['Sessions, 30 days', n0(m.sessions)]], detail: { why: ['Most visits are on phones.'], how: ['Move price, size and reviews above the fold', 'Test it on half the visitors for 14 days', 'Keep the winner'] } }));
    if ((m.sessions || 0) >= 300 && has(m.pdp, m.atc) && m.pdp > 0) out.push(card(k, name, lane, 'funnel', { agent: 'storefront', sector: 'storefront', type: 'report', roles: ['ecom', 'growth'], badge: ['GA4', 'info'], cta: 'Start the tests',
      title: `${pct(100 - 100 * m.atc / m.pdp)} of product-page visitors never add to cart`, sub: `In the last 30 days ${pct(m.pdp)} of visitors opened a product page and ${pct(m.atc, 1)} added to cart. The product page is the biggest leak${has(m.checkout) ? ', ahead of checkout' : ''}.`,
      rows: [['Open a product page', pct(m.pdp)], ['Add to cart', pct(m.atc, 1)], ['Start checkout', has(m.checkout) ? pct(m.checkout, 1) : null], ['Buy', has(m.buy) ? pct(m.buy, 1) : null]], detail: { why: ['Fixes on the product page help every channel at once.'], how: ['Test the first screen of the product page', 'Add size and delivery date near the button', 'Read it after 14 days'] } }));
    /* Google Ads money in the ad account's own currency (an INR account is never shown in the site's dollars), as Meta does */
    const GF = m.gcur ? fmt({ ...ctx.profile, currency: m.gcur, ...(m.gcur === 'INR' ? { country: 'IN', locale: 'en-IN' } : ctx.profile?.country === 'IN' ? { country: 'XX', locale: 'en-US' } : {}) }) : F;
    if (has(m.branded) && m.branded >= 40) out.push(card(k, name, lane, 'brand', { agent: 'performance', sector: 'ads', type: 'idea', roles: ['growth', 'founder', 'ecom'], badge: [pct(m.branded), 'info'], cta: 'Launch the ad group',
      title: `${pct(m.branded)} of your search ad clicks are people typing ${ctx.profile?.name || 'your name'}`, sub: `Those buyers mostly know you already. New buyers search the category${m.terms?.[0] ? `, like “${m.terms[0]}”` : ''}; one category ad group on a small budget tests that.`,
      rows: [['Clicks on your own name', pct(m.branded)], ['Google Ads spend, 30 days', has(m.gspend) ? GF.big(m.gspend) : null], ['Return on Google Ads spend', has(m.groas) ? `${m.groas.toFixed(1)}x` : null], ['Term to test', m.terms?.[0]]], detail: { why: ['Branded clicks would mostly come anyway.'], how: ['Start with three category terms', 'Send them to the best-selling product page', 'Read cost per first order after 14 days'] } }));
    const stats = [has(m.sessions) && ['Sessions, last 30 days', n0(m.sessions)], has(m.cr) && ['Conversion (GA4)', pct(m.cr, 2)], has(m.mob) && ['Mobile share of visits', pct(m.mob)], has(m.gspend) && ['Google Ads spend, 30 days', GF.big(m.gspend)], has(m.groas) && ['Return on Google Ads spend', `${m.groas.toFixed(1)}x`], has(m.branded) && ['Search clicks on your name', pct(m.branded)]].filter(Boolean).slice(0, 4);
    const changed = [has(m.sessions) && `Cards read your ${n0(m.sessions)} sessions from GA4`, (m.sessions || 0) >= 300 && has(m.pdp, m.atc) && `The product-page leak: ${pct(100 - 100 * m.atc / m.pdp)} never add to cart`, has(m.branded) && `${pct(m.branded)} of search clicks are your own name`].filter(Boolean);
    const ledger = [has(m.sessions) && L('ga4.sessions.30d', 'Sessions, last 30 days (GA4)', n0(m.sessions), m.sessions, src), has(m.cr) && L('ga4.conversion', 'Purchases per session, 30 days (GA4)', pct(m.cr, 2), m.cr, src), has(m.mob) && L('ga4.mobile.share', 'Mobile share of sessions', pct(m.mob), m.mob, src),
      has(m.pdp, m.atc) && L('ga4.pdp.to.cart', 'Product page to add-to-cart', pct(100 * m.atc / m.pdp), 100 * m.atc / m.pdp, src), m.mix?.length && L('ga4.channels', 'Sessions by channel, 30 days', m.mix.map(([c2, s]) => `${c2} ${s.toFixed(0)}%`).join('; '), null, src),
      m.countries?.length && L('ga4.countries', 'Sessions by country, 30 days', m.countries.map(([c2, s]) => `${c2} ${s.toFixed(0)}%`).join('; '), null, src),
      has(m.gspend) && L('gads.spend.30d', 'Google Ads spend, last 30 days', GF.big(m.gspend), m.gspend, src), has(m.groas) && L('gads.roas', 'Google Ads conversion value per spend', `${m.groas.toFixed(1)}x`, m.groas, src), has(m.branded) && L('gads.branded.share', 'Branded share of search ad clicks', pct(m.branded), m.branded, src)].filter(Boolean);
    return { metrics: m, stats, changed, cards: out, ledger, notes };
  }
};
const GA4_SCOPES = 'https://www.googleapis.com/auth/analytics.readonly openid email';
/* no include_granted_scopes: it shows every scope the account ever gave this client (an old cloud-platform grant failed
   Google's review on 19 Oct), so the consent screen lists only the scopes Brew asks for */
const authUrl = (scope) => ({ state, redirect }) => `https://accounts.google.com/o/oauth2/v2/auth?${form({ client_id: app().id, redirect_uri: redirect, response_type: 'code', scope, state, access_type: 'offline', prompt: 'consent' })}`;
const oauthOn = () => process.env.GOOGLE_OAUTH === '1' && !!(app().id && app().secret);
const ga4Of = (c, ch) => ({ ...c, property: ch.ga4 || null, customer: null, login: null, accountName: ch.ga4Name || null });

/* Google Analytics: a property ID with Brew's service account as Viewer (no Google review), or a Google sign-in */
export const ga4 = {
  ...base, id: 'ga4', name: 'Google Analytics', modes: ['key', 'oauth'],
  cbAs: 'google', /* the Google OAuth client only knows /connect/google/callback: the GA4 sign-in comes back there too */
  ready: () => saOn() || !!(app().id && app().secret), oauthOn,
  authorize: authUrl(GA4_SCOPES),
  async options(c) { return (await base.options(c, { ads: false })).filter((o) => o.kind === 'ga4'); },
  select: (c, ch) => ga4Of(c, ch),
  owns: (c, ctx) => base.owns({ ...c, customer: null }, ctx),
  sync: (c, ctx, deps) => base.sync({ ...c, customer: null }, ctx, deps, 'ga4')
};
/* Google Ads: Google sign-in only (the developer token and the adwords scope); the same sign-in may pick a GA4 property too */
export default {
  ...base, id: 'google', name: 'Google Ads', modes: ['oauth'],
  keyFields: undefined, fromKey: undefined, help: () => null, helpEmail: () => null,
  ready: () => !!(app().id && app().secret && app().dev), oauthOn,
  authorize: authUrl(SCOPES),
  select: (c, ch) => ({ ...c, property: null, customer: ch.ads ? String(ch.ads).split(':')[0].replace(/\D/g, '') : null, login: ch.ads && String(ch.ads).includes(':') ? String(ch.ads).split(':')[1].replace(/\D/g, '') : null, accountName: ch.adsName || null }),
  also: (c, ch) => (ch.ga4 ? [{ id: 'ga4', creds: ga4Of(c, ch) }] : []),
  owns: (c, ctx) => base.owns({ ...c, property: null }, ctx),
  sync: (c, ctx, deps) => base.sync({ ...c, property: null }, ctx, deps, 'google')
};
