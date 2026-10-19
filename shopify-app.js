// Brew inside the Shopify admin: the public app's install, its embedded pages and the webhooks Shopify requires.
// What Shopify's app review checks (shopify.dev App Store requirements 1.1.1, 2.2.3, 2.3.1–2.3.4) and how Brew meets it:
//   - install happens only from Shopify (managed install, scopes in docs/shopify.app.toml); nobody types a store address
//   - the app opens at /shopify inside the admin; a session token (App Bridge id token) proves the shop and the staff member,
//     traded for the shop's offline token (token exchange), so there is no cookie and no Brew sign-in inside the admin
//   - the store's primary domain is the brand: a store whose domain Brew has read is linked to that brand, its staff join the team
//     (the store's owner, or the installer of an unclaimed brand, is admin), and the Shopify account connects itself
//   - a store Brew hasn't read waits for the merchant to start the read (a paid run, so never on install by itself)
//   - every Brew page opened inside the admin gets App Bridge first in <head> and frame-ancestors for the admin only
//   - Google, Meta and Slack refuse to sign in inside a frame: those open in a new tab through a short signed hop
//   - app/uninstalled and the three compliance webhooks are HMAC-checked; Brew keeps no per-customer record, so the customer
//     ones have nothing to send or erase, and shop/redact (and uninstall) drop the store's token and its numbers
import crypto from 'node:crypto';
import { slugOf } from './brand-pack.js';

const API = '2026-04';
const SCOPES = 'read_products,read_inventory,read_orders,read_customers'; /* the same list as docs/shopify.app.toml (legacy install only) */
const app = () => ({ id: process.env.FEED_SHOPIFY_CLIENT_ID || '', secret: process.env.FEED_SHOPIFY_CLIENT_SECRET || '' });
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64u = (b) => Buffer.from(b).toString('base64url');
const same = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };

/* a session token (App Bridge id token): HS256 JWT signed with the app's secret, for this app (aud), from one shop (dest) */
export function verifyIdToken(tok, { id, secret } = app(), now = Date.now()) {
  const parts = String(tok || '').split('.'); if (parts.length !== 3 || !id || !secret) return null;
  let head, body; try { head = JSON.parse(Buffer.from(parts[0], 'base64url')); body = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { return null; }
  if (head?.alg !== 'HS256') return null;
  if (!same(b64u(crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest()), parts[2])) return null;
  const t = now / 1e3, skew = 10;
  if (!(+body.exp > t - skew) || (body.nbf != null && +body.nbf > t + skew) || body.aud !== id) return null;
  let shop; try { shop = new URL(body.dest).host; } catch { return null; }
  if (!SHOP.test(shop)) return null;
  try { if (new URL(body.iss).host !== shop) return null; } catch { return null; }
  return { shop, sub: String(body.sub || ''), sid: body.sid || null, raw: String(tok) };
}
/* what Shopify signs: the redirect/launch query (hex HMAC over the sorted query) and a webhook body (base64 HMAC over the raw bytes) */
export const queryOk = (q, secret = app().secret) => { if (!secret || !q.get('hmac')) return false;
  const p = [...q.entries()].filter(([k]) => k !== 'hmac' && k !== 'signature').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return same(crypto.createHmac('sha256', secret).update(p).digest('hex'), q.get('hmac')); };
export const webhookOk = (raw, header, secret = app().secret) => !!secret && !!header && same(crypto.createHmac('sha256', secret).update(raw).digest('base64'), header);

/* a request from a page inside the Shopify admin: the launch query, or a frame Brew's own embedded page navigated */
export function embeddedReq(req, u) {
  const q = u.searchParams; if (q.get('embedded') === '1' || (q.has('host') && SHOP.test(q.get('shop') || ''))) return true;
  if (req.headers['sec-fetch-dest'] !== 'iframe') return false;
  const ref = String(req.headers.referer || '');
  return /^https:\/\/(admin\.shopify\.com|[a-z0-9-]+\.myshopify\.com)\//.test(ref) || /[?&]embedded=1(&|$)/.test(ref);
}
/* App Bridge goes first in <head> (requirement 2.2.3), then Brew's small bridge; the admin is the only page that may frame it */
export function embedHtml(html, shop, key = app().id) {
  const tags = `<meta name="shopify-api-key" content="${esc(key)}"><script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script><script src="/shopify-embed.js"></script>`;
  return String(html).replace(/<head>/i, (m) => m + tags);
}
export const frameAncestors = (shop) => `frame-ancestors ${SHOP.test(shop || '') ? `https://${shop}` : 'https://*.myshopify.com'} https://admin.shopify.com;`;

export function createShopifyApp({ auth, connectors, builder, packs, log = console, fetchFn = (...a) => fetch(...a) }) {
  const base = (req) => process.env.PUBLIC_URL || auth.baseOf(req);
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const html = (res, code, body, shop) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': frameAncestors(shop) }); res.end(body); };
  const raw = (req) => new Promise((r) => { const cs = []; let n = 0; req.on('data', (c) => { n += c.length; if (n < 2e6) cs.push(c); }); req.on('end', () => r(Buffer.concat(cs))); });
  const post = async (shop, path, body) => { const r = await fetchFn(`https://${shop}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20e3) });
    const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {} if (!r.ok) throw Object.assign(new Error(`shopify ${r.status}: ${(j.error_description || j.error || j.errors || t).toString().slice(0, 160)}`), { status: r.status, code: j.error }); return j; };
  const gql = async (shop, token, query) => { const r = await fetchFn(`https://${shop}/admin/api/${API}/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': token }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(20e3) });
    const j = await r.json().catch(() => ({})); if (!r.ok || j.errors) throw new Error(`shopify graphql ${r.status}: ${JSON.stringify(j.errors || '').slice(0, 160)}`); return j.data; };

  /* token exchange: the session token for the shop's offline token (what the Shopify connector reads with), or for an online one,
     which says who the staff member is (their email). Fails when the app isn't installed there (legacy install: authorize first) */
  const exchange = (t, kind) => post(t.shop, '/admin/oauth/access_token', { client_id: app().id, client_secret: app().secret, grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: t.raw, subject_token_type: 'urn:ietf:params:oauth:token-type:id_token', requested_token_type: `urn:shopify:params:oauth:token-type:${kind}-access-token`, ...(kind === 'offline' ? { expiring: '1' } : {}) });
  const credsOf = (j, shop) => ({ token: j.access_token, scope: j.scope || '', exp: j.expires_in ? Date.now() + j.expires_in * 1e3 : null, refresh: j.refresh_token || null, shop, app: 'brew' });

  const tokenOf = (req, u) => { const h = String(req.headers.authorization || ''); return verifyIdToken(/^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '') : u.searchParams.get('id_token')); };
  /* the staff member behind a session token, as a Brew person: their Shopify email (cached for a few hours per shop and user) */
  const people = new Map(), PEOPLE_MS = 6 * 3600e3;
  async function personOf(t) {
    const k = `${t.shop}|${t.sub}`, hit = people.get(k); if (hit && Date.now() - hit.at < PEOPLE_MS) return hit.me;
    const j = await exchange(t, 'online'), a = j.associated_user || {}; const email = String(a.email || '').toLowerCase().trim(); if (!email) return null;
    const me = { email, name: [a.first_name, a.last_name].filter(Boolean).join(' ') || null, pic: null, sub: `shopify:${t.shop}:${a.id || t.sub}`, shop: t.shop, shopOwner: !!a.account_owner };
    if (people.size > 2000) people.clear(); people.set(k, { at: Date.now(), me }); return me;
  }
  /* every request from inside the admin (App Bridge adds the session token to fetch): the person, for auth.user(req) */
  async function attach(req, u) {
    if (!app().id || req.brewUser !== undefined) return; const t = tokenOf(req, u); if (!t) return;
    try { const me = await personOf(t); if (me) { req.brewUser = me; req.shopify = t; } } catch (e) { log.warn('[shopify-app] who', t.shop, e.message); }
  }

  /* the store's own facts: its name and the domain it sells on (its primary domain is the brand) */
  const shopInfo = async (shop, token) => (await gql(shop, token, '{ shop { name myshopifyDomain primaryDomain { host } } }')).shop;
  /* a storefront behind Shopify's password page can't be read (a development store, a store not launched yet) */
  async function locked(host) {
    try { const r = await fetchFn(`https://${host}/`, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Brew (+https://brew.joinsquareup.com)' } }); return new URL(r.url).pathname === '/password'; }
    catch { return false; }
  }
  /* the store's staff join the brand's team: the store's owner (or whoever installs on a brand nobody has claimed) as admin */
  async function joinTeam(slug, me) {
    const access = await auth.claimInfo(slug, me); if (access.role) return access.role;
    const role = !access.claimed ? 'owner' : me.shopOwner ? 'admin' : 'member';
    await auth.addMember(slug, me, role, `Shopify admin (${me.shop})`); log.log?.(`[shopify-app] ${slug}: ${me.email} joined as ${role} from ${me.shop}`); return role;
  }
  /* link the store to its brand: the team, then the Shopify account (the app's own offline token), unless it already reads */
  async function link(slug, t, me, creds) {
    await joinTeam(slug, me);
    const live = (await connectors.liveOf(slug, true)).conns.shopify;
    if (live?.state === 'live' && live.account?.id === t.shop && !live.needsReconnect && !live.stale) return { slug, connected: true };
    creds ||= credsOf(await exchange(t, 'offline'), t.shop);
    const r = await connectors.finish(slug, 'shopify', creds, me).catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) log.warn('[shopify-app] connect', slug, r.error);
    return { slug, connected: !!r.ok, error: r.ok ? null : r.error || null };
  }
  /* which brand a store is: the brand already connected to it, else the brand read at its primary domain */
  async function brandOf(t, creds) {
    const known = await connectors.shopSlug?.(t.shop).catch(() => null); if (known && (await builder.status(known))) return { slug: known, info: null };
    const info = await shopInfo(t.shop, creds.token), host = info.primaryDomain?.host || t.shop, slug = slugOf(host);
    return { slug: slug && (await builder.status(slug)) ? slug : null, host, info };
  }

  const authorizeUrl = (req, shop) => `https://${shop}/admin/oauth/authorize?${new URLSearchParams({ client_id: app().id, scope: SCOPES, redirect_uri: `${base(req)}/shopify/callback`, state: auth.sign({ shop, n: crypto.randomBytes(9).toString('base64url') }, 900, 'shopify-install') })}`;
  const adminApp = (shop) => `https://${shop}/admin/apps/${app().id}`;

  /* the session the embedded home asks for: linked (open the brand), unread (offer the read) or authorize (legacy install) */
  async function session(req, t) {
    const me = req.brewUser; if (!me) return { state: 'error', error: 'Shopify didn’t say who you are. Open Brew again from your Shopify admin.' };
    let creds; try { creds = credsOf(await exchange(t, 'offline'), t.shop); }
    catch (e) { if (e.status === 400 || e.status === 401) return { state: 'authorize', url: authorizeUrl(req, t.shop) }; throw e; }
    const b = await brandOf(t, creds);
    if (b.slug) { const l = await link(b.slug, t, me, creds); return { state: 'linked', slug: b.slug, connected: l.connected, error: l.error }; }
    return { state: 'unread', host: b.host, name: b.info?.name || null, locked: await locked(b.host) };
  }
  /* the merchant starts the read of their store's domain (a paid run, so only on their tap), then the store links to it */
  async function startRead(req, t) {
    const me = req.brewUser; if (!me) return { error: 'Open Brew again from your Shopify admin.' };
    const creds = credsOf(await exchange(t, 'offline'), t.shop), info = await shopInfo(t.shop, creds.token), host = info.primaryDomain?.host || t.shop;
    if (await locked(host)) return { error: `${host} is behind Shopify’s password page, so Brew can’t read it yet. Remove the password in Online Store → Preferences, then try again.`, locked: true };
    const r = await builder.start(host, { user: me, ip: null }); if (r.error || !r.slug) return { error: r.error || 'The read didn’t start. Try again in a minute.' };
    await link(r.slug, t, me, creds).catch((e) => log.warn('[shopify-app] link after read', r.slug, e.message));
    return { slug: r.slug };
  }

  /* a signed one-time hop from the admin to a top-level tab: Google, Meta and Slack sign-ins can't run inside a frame */
  const HOP_S = 120;
  const hopUrl = (req, me, next) => `${base(req)}/shopify/hop?${new URLSearchParams({ t: auth.sign({ email: me.email, name: me.name, sub: me.sub, next }, HOP_S, 'shopify-hop') })}`;
  const safeNext = (n) => (typeof n === 'string' && /^\/(?![/\\])/.test(n) ? n : '/');

  async function webhook(req, res) {
    const body = await raw(req);
    if (!webhookOk(body, req.headers['x-shopify-hmac-sha256'])) return json(res, 401, { error: 'bad signature' }), true;
    const topic = String(req.headers['x-shopify-topic'] || ''), shop = String(req.headers['x-shopify-shop-domain'] || '').toLowerCase();
    log.log?.(`[shopify-app] webhook ${topic} ${shop}`);
    /* answer at once (Shopify wants 200 within seconds); the work runs after */
    json(res, 200, { ok: true });
    if (topic === 'app/uninstalled' || topic === 'shop/redact') {
      const slug = SHOP.test(shop) ? await connectors.shopSlug?.(shop).catch(() => null) : null;
      if (slug) await connectors.disconnect(slug, 'shopify').then(() => log.log?.(`[shopify-app] ${slug}: Shopify disconnected (${topic})`)).catch((e) => log.warn('[shopify-app] disconnect', slug, e.message));
    }
    /* customers/data_request, customers/redact: Brew stores order counts and shares, never a customer's record, so nothing to send or erase */
    return true;
  }

  async function handle(req, res, u) {
    const p = u.pathname;
    if (!p.startsWith('/shopify') && !(embeddedReq(req, u) && /^\/(connect\/[a-z0-9]+\/start|auth\/google)$/.test(p))) return false;
    if (p === '/shopify/webhooks' && req.method === 'POST') return webhook(req, res);
    if (!app().id || !app().secret) return json(res, 404, { error: 'The Shopify app is not set up on this server.' }), true;
    const shop = SHOP.test(u.searchParams.get('shop') || '') ? u.searchParams.get('shop') : null;

    /* a sign-in that can't run in a frame (Google, Meta, Slack): one tap opens it in a new tab, signed in as this person */
    if (!p.startsWith('/shopify')) return html(res, 200, embedHtml(page('Opens in a new tab', `<p>Signing in here opens in a new tab, because ${p.startsWith('/auth') ? 'Google' : 'that service'} doesn’t allow it inside Shopify.</p>
<p><button class="go" data-next="${esc(p + u.search)}">Continue in a new tab</button></p><p><a href="javascript:history.back()">Back</a></p>`), shop), shop), true;

    if (p === '/shopify' && req.method === 'GET') {
      /* opened outside the admin with Shopify's signed launch query: open it inside the admin, where the session token is */
      if (shop && u.searchParams.get('hmac') && u.searchParams.get('embedded') !== '1' && !u.searchParams.get('id_token')) {
        if (!queryOk(u.searchParams)) return json(res, 400, { error: 'bad signature' }), true;
        res.writeHead(302, { location: adminApp(shop), 'cache-control': 'no-store' }); return res.end(), true; }
      if (!shop) return html(res, 200, page('Brew for Shopify', `<p>Open Brew from your Shopify admin, under Apps.</p><p><a href="/">Go to Brew</a></p>`), null), true;
      return html(res, 200, embedHtml(page('Brew', `<div id="sh">Opening Brew…</div>`, true), shop), shop), true;
    }
    if (p === '/shopify/callback' && req.method === 'GET') { /* legacy install: Shopify's authorize, then back into the admin */
      const st = auth.verify(u.searchParams.get('state'), 'shopify-install');
      if (!queryOk(u.searchParams) || !st || st.shop !== shop) return json(res, 400, { error: 'This install link expired. Install Brew again from Shopify.' }), true;
      try { await post(shop, '/admin/oauth/access_token', { client_id: app().id, client_secret: app().secret, code: u.searchParams.get('code'), expiring: '1' }); }
      catch (e) { log.warn('[shopify-app] callback', shop, e.message); return json(res, 400, { error: 'Shopify didn’t accept the install. Install Brew again from Shopify.' }), true; }
      res.writeHead(302, { location: adminApp(shop), 'cache-control': 'no-store' }); return res.end(), true;
    }
    if (p === '/shopify/hop' && req.method === 'GET') { /* the new tab: a Brew session for the person the admin vouched for, then on */
      const h = auth.verify(u.searchParams.get('t'), 'shopify-hop'); if (!h?.email) return html(res, 400, page('Link expired', '<p>That link expired. Go back to Shopify and tap it again.</p>'), null), true;
      auth.setCookie(res, 'fs_s', auth.sign({ email: h.email, name: h.name || null, pic: null, sub: h.sub || null }, 7 * 86400, 'session'), 7 * 86400);
      res.writeHead(302, { location: safeNext(h.next), 'cache-control': 'no-store' }); return res.end(), true;
    }
    if (p.startsWith('/shopify/api/') && req.method === 'POST') {
      const t = req.shopify || tokenOf(req, u); if (!t) return json(res, 401, { error: 'Open Brew again from your Shopify admin.', reauth: true }), true;
      if (!req.brewUser) await attach(req, u);
      try {
        if (p === '/shopify/api/session') return json(res, 200, await session(req, t)), true;
        if (p === '/shopify/api/read') return json(res, 200, await startRead(req, t)), true;
        if (p === '/shopify/api/hop') { const b = JSON.parse((await raw(req)).toString() || '{}'); if (!req.brewUser) return json(res, 401, { error: 'Open Brew again from your Shopify admin.' }), true;
          return json(res, 200, { url: hopUrl(req, req.brewUser, safeNext(b.next)) }), true; }
      } catch (e) { log.warn('[shopify-app]', p, t.shop, e.message); return json(res, 200, { state: 'error', error: 'Shopify didn’t answer. Try again in a minute.' }), true; }
    }
    return json(res, 404, { error: 'not found' }), true;
  }

  /* the embedded home: asks for the session, then opens the brand, offers the read, or authorizes (a legacy install) */
  function page(title, body, home = false) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;background:#f1f1f1;color:#303030}main{max-width:560px;margin:48px auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 0 rgba(0,0,0,.07)}h1{font-size:18px;margin:0 0 12px}button.go{font:inherit;font-weight:600;background:#303030;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}button.go[disabled]{opacity:.5}.err{color:#8e1f0b}a{color:#005bd3}</style></head>
<body><main><h1>${esc(title)}</h1>${body}</main>${home ? '<script src="/shopify-home.js"></script>' : ''}</body></html>`;
  }

  return { handle, attach, embeddedReq, embed: (req, u, res, body) => { if (!app().id || !embeddedReq(req, u)) return body; const shop = SHOP.test(u.searchParams.get('shop') || '') ? u.searchParams.get('shop') : null; res.setHeader('content-security-policy', frameAncestors(shop)); return embedHtml(body, shop); } };
}
