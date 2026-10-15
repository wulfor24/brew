// Meta Ads: Facebook Login for Business on SquareUp's Meta app (config_id grants ads_read + business_management),
// then the Marketing API, read only (Graph calls lifted from SquareUp's tej/ads/meta-client.ts).
// The brand picks the ad account. It proves the brand's own when the ad account can promote the brand's Facebook
// page (the page the Ad Library read found) or a page whose website is the brand's site.
import { exactSite } from '../auth.js';
import { card, L, n0, pct, has, fmt, getJSON, form } from './common.js';

const V = 'v21.0', G = `https://graph.facebook.com/${V}`;
const app = () => ({ id: process.env.META_ADS_OAUTH_CLIENT_ID || '', secret: process.env.META_ADS_OAUTH_CLIENT_SECRET || '', config: process.env.META_ADS_CONFIG_ID || '1268904131849800' });
const get = (path, token, params = {}) => getJSON(`${G}/${path}?${form({ ...params, access_token: token })}`, {}, `meta ${path.split('/').pop()}`);
const all = async (path, token, params, max = 10) => { const out = []; let after; for (let i = 0; i < max; i++) { const j = await get(path, token, { ...params, ...(after ? { after } : {}) }); out.push(...(j.data || [])); after = j.paging?.cursors?.after; if (!after || !j.paging?.next) break; } return out; };
const pick = (xs, types) => { for (const t of types) { const x = (xs || []).find((y) => y.action_type === t); if (x) return +x.value; } return null; };
const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];

export default {
  id: 'meta', name: 'Meta Ads', modes: ['oauth'], picks: true,
  ready: () => !!(app().id && app().secret),
  authorize({ state, redirect }) { const a = app(); return `https://www.facebook.com/${V}/dialog/oauth?${form({ client_id: a.id, redirect_uri: redirect, state, config_id: a.config, response_type: 'code', override_default_response_type: 'true' })}`; },
  async exchange({ query, redirect }) {
    const a = app(), code = query.get('code'); if (!code) throw new Error(`meta: ${query.get('error_description') || query.get('error') || 'no code'}`);
    const t = await getJSON(`${G}/oauth/access_token?${form({ client_id: a.id, client_secret: a.secret, redirect_uri: redirect, code })}`, {}, 'meta token');
    // swap for the long-lived token (about 60 days); a business system-user token is already long-lived
    const long = await getJSON(`${G}/oauth/access_token?${form({ grant_type: 'fb_exchange_token', client_id: a.id, client_secret: a.secret, fb_exchange_token: t.access_token })}`, {}, 'meta long token').catch(() => null);
    const tk = long?.access_token || t.access_token, exp = (long?.expires_in || t.expires_in) ? Date.now() + (long?.expires_in || t.expires_in) * 1e3 : null;
    return { token: tk, exp };
  },
  async options(c) {
    const xs = await all('me/adaccounts', c.token, { fields: 'account_id,name,currency,account_status,amount_spent', limit: 100 });
    return xs.filter((x) => x.account_status !== 2).map((x) => ({ id: x.account_id, name: x.name || `Ad account ${x.account_id}`, sub: `${x.currency} · act_${x.account_id}` }));
  },
  select(c, choice) { return { ...c, account: String(choice.account || '').replace(/^act_/, ''), accountName: choice.name || null }; },
  async owns(c, ctx) {
    if (!c.account) return { ok: false, why: 'Pick an ad account first' };
    const pages = await get(`act_${c.account}/promote_pages`, c.token, { fields: 'id,name,website,link', limit: 100 }).then((j) => j.data || []).catch(() => []);
    const hit = pages.find((p) => (ctx.pageId && String(p.id) === String(ctx.pageId)) || String(p.website || '').split(/\s+/).some((w) => exactSite(w, ctx.host)));
    const acc = await get(`act_${c.account}`, c.token, { fields: 'name,currency,timezone_name' }).catch(() => ({}));
    /* a page's website is free text: it shows the account is the brand's, never strong enough to own the brand (strong: false) */
    return { ok: !!hit, strong: false, account: { id: `act_${c.account}`, name: acc.name || c.accountName || `act_${c.account}`, currency: acc.currency }, why: hit ? `The ad account promotes ${hit.name}` : `None of this ad account’s pages is ${ctx.host}’s page` };
  },
  async sync(c, ctx) {
    const m = {}, notes = [], A = `act_${c.account}`;
    const acc = await get(A, c.token, { fields: 'name,currency' });
    /* money in the ad account's own currency (an INR account is never shown in the site's dollars) */
    const F = fmt({ ...ctx.profile, currency: acc.currency || ctx.profile?.currency, ...(acc.currency === 'INR' ? { country: 'IN', locale: 'en-IN' } : acc.currency && ctx.profile?.country === 'IN' ? { country: 'XX', locale: 'en-US' } : {}) });
    const ins = (params) => all(`${A}/insights`, c.token, { ...params, limit: 200 }, 5);
    /* an agency or group ad account runs ads for several Pages: count only the ads that promote this brand's Page */
    const pages = await get(`${A}/promote_pages`, c.token, { fields: 'id,name,website', limit: 100 }).then((j) => j.data || []).catch(() => []);
    const own = pages.find((p) => (ctx.pageId && String(p.id) === String(ctx.pageId)) || String(p.website || '').split(/\s+/).some((w) => exactSite(w, ctx.host)));
    const ads = await all(`${A}/ads`, c.token, { fields: 'id,campaign_id,effective_status,creative{effective_object_story_id,object_story_spec}', limit: 200 }, 10).catch(() => null);
    const pageOf = (a) => String(a.creative?.object_story_spec?.page_id || String(a.creative?.effective_object_story_id || '').split('_')[0] || '');
    const adPages = new Set((ads || []).map(pageOf).filter(Boolean));
    const shared = !!(own && ads && [...adPages].some((pid) => pid !== String(own.id)));
    const mine = shared ? new Set(ads.filter((a) => pageOf(a) === String(own.id)).map((a) => a.id)) : null;
    if (shared) notes.push(`This ad account also runs ads for other Pages. Brew counts only the ads for ${own.name}.`);
    if (!shared) {
      const [tot] = await ins({ date_preset: 'last_30d', fields: 'spend,impressions,clicks,reach,frequency,actions,action_values' });
      if (tot) { m.spend = +tot.spend || 0; const buys = pick(tot.actions, PURCHASE), value = pick(tot.action_values, PURCHASE);
        if (buys) { m.purchases = buys; m.cpa = m.spend / buys; } if (value != null && m.spend) m.roas = value / m.spend; m.reach = +tot.reach || null; }
    } else {
      const rows = await ins({ date_preset: 'last_30d', level: 'ad', fields: 'ad_id,spend,actions,action_values' });
      let spend = 0, buys = 0, value = 0, valued = false;
      for (const x of rows.filter((r) => mine.has(String(r.ad_id)))) { spend += +x.spend || 0; buys += pick(x.actions, PURCHASE) || 0; const v = pick(x.action_values, PURCHASE); if (v != null) { value += v; valued = true; } }
      m.spend = spend; if (buys) { m.purchases = buys; m.cpa = spend / buys; } if (valued && spend) m.roas = value / spend;
    }
    const keep = (x) => !shared || mine.has(String(x.ad_id));
    const adWeek = await ins({ date_preset: 'last_7d', level: 'ad', fields: 'ad_id,ad_name,campaign_id,campaign_name,frequency,spend,ctr,actions,action_values' }).catch((e) => (notes.push(`Campaigns: ${e.message.slice(0, 100)}`), []));
    const byCamp = new Map();
    for (const x of adWeek.filter(keep)) { const k2 = x.campaign_id || x.campaign_name, c2 = byCamp.get(k2) || { name: x.campaign_name, s: 0, v: 0, valued: false, fw: 0 };
      const s = +x.spend || 0, v = pick(x.action_values, PURCHASE); c2.s += s; if (v != null) { c2.v += v; c2.valued = true; } c2.fw += s * (+x.frequency || 0); byCamp.set(k2, c2); }
    /* a campaign's frequency here is its ads' frequency weighted by spend: close to Meta's own, and the same for a shared account */
    m.camp = [...byCamp.values()].map((c2) => ({ name: c2.name, spendDay: c2.s / 7, freq: c2.s ? c2.fw / c2.s : 0, roas: c2.valued && c2.s ? c2.v / c2.s : null })).filter((x) => x.spendDay > 0).sort((a, b) => b.spendDay - a.spendDay).slice(0, 6);
    m.live = ads ? ads.filter((a) => a.effective_status === 'ACTIVE' && (!shared || mine.has(a.id))).length : null;
    m.tired = adWeek.filter(keep).filter((x) => +x.frequency >= 3.5 && +x.spend > 0).map((x) => ({ name: x.ad_name, freq: +x.frequency }));

    const k = 'meta', name = 'Meta Ads', lane = ctx.lane, src = `Meta Ads · ${acc.name || A}${shared ? ` · ${own.name} ads only` : ''}`, out = [];
    const hot = m.camp.filter((x) => x.freq >= 3.5).sort((a, b) => b.freq - a.freq)[0];
    if (hot) out.push(card(k, name, lane, 'freq', { agent: 'performance', sector: 'ads', type: 'decision', roles: ['growth', 'founder', 'brand'], badge: [`Frequency ${hot.freq.toFixed(1)}`, 'warn'], cta: 'Rotate creative',
      title: `${hot.name} showed the same people its ads ${hot.freq.toFixed(1)} times this week`, sub: `${m.tired.length ? `${n0(m.tired.length)} ad${m.tired.length === 1 ? ' is' : 's are'} past 3.5 a week. ` : ''}Above that, clicks fall and cost per order climbs. Fresh versions of the best ads reset it fastest.`,
      rows: [['Campaign', hot.name], ['Frequency, 7 days', hot.freq.toFixed(1)], ['Spend a day', F.money(hot.spendDay)], ['Tired ads', n0(m.tired.length)]], detail: { why: ['Above 3.5 a week, clicks fall and cost rises.'], how: ['Pick the 3 best ads by cost per order', 'Make 2 new versions of each', 'Pause the tired ones as the new ones go live'] } }));
    const ranked = m.camp.filter((x) => x.roas != null && x.spendDay > 0);
    if (ranked.length >= 2) { const best = [...ranked].filter((x) => x.freq < 3.5).sort((a, b) => b.roas - a.roas)[0], worst = [...ranked].sort((a, b) => a.roas - b.roas)[0];
      if (best && best !== worst && best.roas > worst.roas * 1.3) out.push(card(k, name, lane, 'shift', { agent: 'performance', sector: 'ads', type: 'decision', roles: ['growth', 'founder'], badge: [`${best.roas.toFixed(1)}x`, 'ok'], cta: 'Shift budget',
        title: `Move ${F.money(worst.spendDay * 0.2)} a day to ${best.name}`, sub: `This week ${best.name} returned ${best.roas.toFixed(1)}x and ${worst.name} ${worst.roas.toFixed(1)}x. Moving a fifth of the weaker budget in one step keeps learning intact.`,
        rows: [['From', `${worst.name} · ${worst.roas.toFixed(1)}x`], ['To', `${best.name} · ${best.roas.toFixed(1)}x`], ['Move a day', F.money(worst.spendDay * 0.2)], ['Cost per purchase, 30 days', has(m.cpa) ? F.money(m.cpa) : null]], detail: { why: ['Returns differ by campaign, so the budget should too.', 'One step of 20% keeps the learning phase.'], how: ['Move the budget tomorrow morning', 'Read it after 7 days', 'Move it back if cost per purchase rises 15%'] } })); }
    const stats = [has(m.spend) && ['Spend, last 30 days', F.big(m.spend)], has(m.roas) && ['Return on ad spend', `${m.roas.toFixed(1)}x`], has(m.cpa) && ['Cost per purchase', F.money(m.cpa)], has(m.live) && ['Live ads', n0(m.live)]].filter(Boolean);
    const changed = [has(m.cpa) && `Ad cards show your live cost per purchase (${F.money(m.cpa)})`, m.tired.length && `${n0(m.tired.length)} tired ads flagged for fresh versions`, m.camp.length && `Budget moves between your ${m.camp.length} active campaigns`].filter(Boolean);
    const ledger = [has(m.spend) && L('meta.spend.30d', 'Meta spend, last 30 days', F.big(m.spend), m.spend, src), has(m.roas) && L('meta.roas', 'Meta return on ad spend, 30 days', `${m.roas.toFixed(1)}x`, m.roas, src), has(m.cpa) && L('meta.cpa', 'Meta cost per purchase, 30 days', F.money(m.cpa), m.cpa, src),
      has(m.live) && L('meta.ads.live', 'Live Meta ads', n0(m.live), m.live, src), hot && L('meta.frequency.max', 'Highest campaign frequency, 7 days', hot.freq.toFixed(1), hot.freq, src)].filter(Boolean);
    return { metrics: m, stats, changed, cards: out, ledger, notes };
  }
};
