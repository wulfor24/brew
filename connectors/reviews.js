// Reviews: Judge.me, by one-click OAuth or the store's private API token (Judge.me → Settings → Integrations → View API token).
// Read-only: the review total, the recent average and the 1 and 2 star reviews nobody has answered (the team replies in
// Judge.me). It proves the brand's own when the token's store is the brand's Shopify store.
import { card, L, n0, has, getJSON, form } from './common.js';

const JM = 'https://judge.me/api/v1';
/* a pasted private token goes in X-Api-Token with the store; an OAuth token goes as Bearer and carries its own store */
const get = (c, path, q = {}) => getJSON(c.oauth ? `${JM}/${path}?${form(q)}` : `${JM}/${path}?${form({ ...q, shop_domain: c.shop, api_token: c.token })}`,
  { headers: c.oauth ? { authorization: `Bearer ${c.token}` } : { 'x-api-token': c.token } }, `judge.me ${path}`);
/* One-click sign-in (Judge.me OAuth, https://judge.me/api/docs#OAuth). It switches on by itself once Judge.me registers Brew and
   JUDGEME_CLIENT_ID / JUDGEME_CLIENT_SECRET are set (asked of partnerships@judge.me on 2026-10-16). The token address and scope
   names aren't in the public docs: set JUDGEME_TOKEN_URL / JUDGEME_SCOPES to what Judge.me sends if they differ. */
const app = () => ({ id: process.env.JUDGEME_CLIENT_ID || '', secret: process.env.JUDGEME_CLIENT_SECRET || '',
  tokenUrl: process.env.JUDGEME_TOKEN_URL || 'https://judge.me/oauth/token', scopes: process.env.JUDGEME_SCOPES || 'read_reviews read_shops' });
const tokenOf = async (body) => { const a = app();
  const t = await getJSON(a.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: a.id, client_secret: a.secret, ...body }) }, 'judge.me token');
  if (!t?.access_token) throw new Error('Judge.me sent no access token. Try again.');
  return { token: t.access_token, refresh: t.refresh_token || body.refresh_token || null, expires: t.expires_in ? Date.now() + (+t.expires_in - 120) * 1e3 : null }; };

export default {
  id: 'reviews', name: 'Judge.me reviews', modes: ['oauth', 'key'],
  ready: () => true,
  oauthOn: () => !!(app().id && app().secret),
  authorize({ state, redirect }) { return `https://app.judge.me/oauth/authorize?${form({ client_id: app().id, redirect_uri: redirect, response_type: 'code', scope: app().scopes, state })}`; },
  async exchange({ query, redirect }) {
    if (query.get('error')) throw Object.assign(new Error('Judge.me didn’t let us in. Try again and approve it.'), { user: true });
    const t = await tokenOf({ grant_type: 'authorization_code', code: query.get('code'), redirect_uri: redirect });
    const info = await get({ oauth: true, token: t.token }, 'shops/info').catch(() => ({}));
    const shop = String(info.shop?.domain || '').toLowerCase();
    if (!shop) throw new Error('Judge.me didn’t say which store this is. Try again.');
    return { oauth: true, ...t, shop };
  },
  async fresh(c) { if (!c.oauth || !c.expires || Date.now() < c.expires || !c.refresh) return c;
    return { ...c, ...(await tokenOf({ grant_type: 'refresh_token', refresh_token: c.refresh })) }; },
  keyFields: [{ k: 'shop', label: 'Store address', hint: 'your-store.myshopify.com' }, { k: 'token', label: 'Private API token', hint: 'Judge.me → Settings → Integrations → View API token', secret: true }],
  async fromKey({ shop, token }) {
    const s = String(shop || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), t = String(token || '').trim();
    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(s)) throw Object.assign(new Error('Enter the store address, like your-store.myshopify.com.'), { user: true });
    if (t.length < 16) throw Object.assign(new Error('Paste the private API token from Judge.me.'), { user: true });
    await get({ shop: s, token: t }, 'reviews', { per_page: 1 }).catch((e) => { throw Object.assign(new Error(e.status === 401 || e.status === 403 ? 'Judge.me did not accept that token.' : e.message), { user: true }); });
    return { shop: s, token: t };
  },
  async owns(c, ctx) { const ok = !!ctx.shopifyShop && c.shop === ctx.shopifyShop; return { ok, account: { id: c.shop, name: `Judge.me · ${c.shop}` }, why: ok ? `Judge.me reviews for ${ctx.host}’s store` : `${c.shop} is not the store the read found for ${ctx.host}` }; },
  async sync(c, ctx) {
    const m = {}, notes = [];
    const j = await get(c, 'reviews', { per_page: 100, page: 1 });
    const rs = j.reviews || []; m.recent = rs.length;
    /* the list has no total: Judge.me counts on its own endpoint */
    const n = await get(c, 'reviews/count').catch((e) => { notes.push(`Judge.me count: ${e.message.slice(0, 120)}`); return null; });
    m.total = n ? (+n.count || +n.total || +n.reviews_count || 0) : (+j.total || null);
    const low = rs.filter((r) => +r.rating <= 2 && !r.hidden), open = low.filter((r) => !(r.reply?.content || r.reply_content || r.replied_at));
    m.low = low.length; m.open = open.length; if (rs.length) m.rating = rs.reduce((a, r) => a + +r.rating, 0) / rs.length; m.photo = rs.length ? 100 * rs.filter((r) => (r.pictures || []).length).length / rs.length : null;
    const src = `Judge.me · ${c.shop}`, out = [];
    if (open.length) out.push(card('reviews', 'Judge.me reviews', ctx.lane, 'reply', { agent: 'crm', sector: 'signals', type: 'decision', roles: ['crm', 'brand', 'founder'], badge: [`${n0(open.length)} waiting`, 'warn'], cta: 'Reply in Judge.me',
      title: `${n0(open.length)} of the last ${n0(rs.length)} reviews are 1 or 2 stars with no reply`, sub: `“${String(open[0].title || open[0].body || '').slice(0, 90)}” is the latest. A calm reply that names the fix reads better than silence.`,
      rows: open.slice(0, 4).map((r) => [`${r.rating}★ ${String(r.product_title || '').slice(0, 24)}`, String(r.title || r.body || '').slice(0, 40)]), detail: { why: ['Shoppers read the bad reviews first.'], how: ['Reply to each one in Judge.me', 'Name the fix, not an excuse', 'The reply shows publicly and the reviewer gets an email'] } }));
    /* quiet: no zero tiles; a store with no reviews yet says so once */
    const stats = [m.total > 0 && ['Reviews', n0(m.total)], has(m.rating) && ['Average, last 100', `${m.rating.toFixed(1)} of 5`], m.open > 0 && ['1 and 2 star, no reply', n0(m.open)], m.photo > 0 && ['With a photo', `${m.photo.toFixed(0)}%`]].filter(Boolean);
    const changed = !rs.length ? ['No reviews in Judge.me yet. Cards use them once they come in.']
      : [m.total > 0 && `${n0(m.total)} reviews read`, m.open > 0 ? `${n0(m.open)} low-star reviews still need a reply` : 'Every 1 and 2 star review has a reply'].filter(Boolean);
    const ledger = [has(m.total) && L('reviews.judgeme.total', 'Judge.me reviews', n0(m.total), m.total, src), has(m.rating) && L('reviews.judgeme.rating.recent', 'Average rating, last 100 reviews', m.rating.toFixed(2), m.rating, src), L('reviews.judgeme.open', 'Low-star reviews with no reply', n0(m.open), m.open, src)].filter(Boolean);
    return { metrics: m, stats, changed, cards: out, ledger, notes };
  }
};
