// Reviews: Judge.me, with the store's private API token (Judge.me → Settings → Integrations → View API token).
// Reads the review totals and the 1 and 2 star reviews nobody has answered; the reply action (actions.js) posts
// the team-approved replies. It proves the brand's own when the token works for the brand's Shopify store.
import { card, L, n0, has, getJSON, form } from './common.js';

const JM = 'https://judge.me/api/v1';
const get = (c, path, q = {}) => getJSON(`${JM}/${path}?${form({ ...q, shop_domain: c.shop, api_token: c.token })}`, { headers: { 'x-api-token': c.token } }, `judge.me ${path}`);

export default {
  id: 'reviews', name: 'Judge.me reviews', modes: ['key'],
  ready: () => true,
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
    const rs = j.reviews || []; m.total = +j.total || +j.reviews_count || null; m.recent = rs.length;
    const low = rs.filter((r) => +r.rating <= 2 && !r.hidden), open = low.filter((r) => !(r.reply?.content || r.reply_content || r.replied_at));
    m.low = low.length; m.open = open.length; if (rs.length) m.rating = rs.reduce((a, r) => a + +r.rating, 0) / rs.length; m.photo = rs.length ? 100 * rs.filter((r) => (r.pictures || []).length).length / rs.length : null;
    const src = `Judge.me · ${c.shop}`, out = [];
    if (open.length) out.push(card('reviews', 'Judge.me reviews', ctx.lane, 'reply', { agent: 'crm', sector: 'signals', type: 'decision', roles: ['crm', 'brand', 'founder'], badge: [`${n0(open.length)} waiting`, 'warn'], cta: 'Send the replies',
      title: `${n0(open.length)} of the last ${n0(rs.length)} reviews are 1 or 2 stars with no reply`, sub: `“${String(open[0].title || open[0].body || '').slice(0, 90)}” is the latest. A calm reply that names the fix reads better than silence; Brew drafts them and nothing posts without your OK.`,
      rows: open.slice(0, 4).map((r) => [`${r.rating}★ ${String(r.product_title || '').slice(0, 24)}`, String(r.title || r.body || '').slice(0, 40)]), detail: { why: ['Shoppers read the bad reviews first.'], how: ['Draft a reply for each', 'Approve them in one go', 'They post publicly and the reviewer gets an email'] } }));
    const stats = [has(m.total) && ['Reviews', n0(m.total)], has(m.rating) && ['Average, last 100', `${m.rating.toFixed(1)} of 5`], ['1 and 2 star, no reply', n0(m.open)], has(m.photo) && ['With a photo', `${m.photo.toFixed(0)}%`]].filter(Boolean);
    const changed = [`${n0(m.open)} low-star reviews get drafted replies`, has(m.total) && `${n0(m.total)} reviews read`].filter(Boolean);
    const ledger = [has(m.total) && L('reviews.judgeme.total', 'Judge.me reviews', n0(m.total), m.total, src), has(m.rating) && L('reviews.judgeme.rating.recent', 'Average rating, last 100 reviews', m.rating.toFixed(2), m.rating, src), L('reviews.judgeme.open', 'Low-star reviews with no reply', n0(m.open), m.open, src)].filter(Boolean);
    return { metrics: m, stats, changed, cards: out, ledger, notes };
  }
};
