// Meta Ads: Facebook Login for Business on SquareUp's Meta app (config_id grants ads_read + business_management),
// then the Marketing API, read only (Graph calls lifted from SquareUp's tej/ads/meta-client.ts).
// The brand picks one or more ad accounts (accounts: [{ id, name, currency }]). Each proves itself the brand's own when it
// can promote the brand's Facebook page (the page the Ad Library read found) or a page whose website is the brand's site.
// sync() reads every picked account and sums them; each account's own numbers ride on `accounts` for the connection row.
import { card, L, n0, has, fmt, getJSON, form, roasX } from './common.js';
import { siteMatch } from './google.js';

/* the Graph version (v26.0 is the newest Meta answered on 22 Oct 2026; v21.0 is near its end): bump META_GRAPH_VERSION when
   Meta's changelog says a newer one is out, the same way GOOGLE_ADS_API_VERSION works */
const V = process.env.META_GRAPH_VERSION || 'v26.0', G = `https://graph.facebook.com/${V}`;
const app = () => ({ id: process.env.META_ADS_OAUTH_CLIENT_ID || '', secret: process.env.META_ADS_OAUTH_CLIENT_SECRET || '', config: process.env.META_ADS_CONFIG_ID || '1268904131849800' });
const get = (path, token, params = {}) => getJSON(`${G}/${path}?${form({ ...params, access_token: token })}`, {}, `meta ${path.split('/').pop()}`);
/* every page up to `max`; out.capped says the read stopped at the cap, so the caller can say its numbers are partial */
const all = async (path, token, params, max = 10) => { const out = []; let after; out.capped = false; for (let i = 0; i < max; i++) { const j = await get(path, token, { ...params, ...(after ? { after } : {}) }); out.push(...(j.data || [])); after = j.paging?.cursors?.after; if (!after || !j.paging?.next) return out; } out.capped = true; return out; };
/* Meta answers a big ad list with code 1 "reduce the amount of data": the same read again with smaller pages */
const allSmaller = async (path, token, params, rows = 3000) => { let err; for (const limit of [100, 50, 25]) { try { return await all(path, token, { ...params, limit }, Math.ceil(rows / limit)); } catch (e) { err = e; if (![1, 2].includes(+e.code) && !/reduce the amount of data/i.test(e.message)) throw e; } } throw err; };
export { roasX };
const plural = (n, one, many = `${one}s`) => `${n0(n)} ${n === 1 ? one : many}`;
const pick = (xs, types) => { for (const t of types) { const x = (xs || []).find((y) => y.action_type === t); if (x) return +x.value; } return null; };
const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];

/* a Meta sign-in lasts about 60 days and has no refresh token. Before it runs out (REFRESH_DAYS) Brew asks Meta for a new
   long-lived token with the one it holds, where Meta allows it; a token whose end Brew doesn't know is looked up once
   (debug_token). Either way exp is kept, and connectors/index.js warns the brand's admins a week ahead */
const DAY = 864e5, REFRESH_DAYS = 10;
export async function freshMeta(c, { now = Date.now(), getJSONImpl = getJSON } = {}) {
  if (!c?.token) return c;
  const a = app(); let out = c;
  if (!out.exp && !out.expChecked && a.id && a.secret && !(out.expTriedAt && now - out.expTriedAt < DAY)) {
    const d = await getJSONImpl(`${G}/debug_token?${form({ input_token: out.token, access_token: `${a.id}|${a.secret}` })}`, {}, 'meta debug_token').catch(() => null);
    /* a lookup that didn't answer is tried again the next day, never left unknown for good */
    /* the sign-in's end, or Meta's 90-day data-access end, whichever comes first: a token that "never" expires still loses data
       access at 90 days, and the admins should hear a week ahead, not from a failed read */
    const ex = +d?.data?.expires_at, da = +d?.data?.data_access_expires_at, at = [ex, da].filter((x) => x > 0).length ? Math.min(...[ex, da].filter((x) => x > 0)) : ex;
    out = d ? { ...out, expChecked: now, ...(at > 0 ? { exp: at * 1e3, ...(da > 0 && da === at ? { expWhy: 'data-access' } : {}) } : at === 0 ? { exp: null, never: true } : {}) } : { ...out, expTriedAt: now };
  }
  if (out.exp && out.exp > now && out.exp - now < REFRESH_DAYS * DAY && a.id && a.secret && !(out.refreshTriedAt && now - out.refreshTriedAt < DAY)) {
    const long = await getJSONImpl(`${G}/oauth/access_token?${form({ grant_type: 'fb_exchange_token', client_id: a.id, client_secret: a.secret, fb_exchange_token: out.token })}`, {}, 'meta refresh').catch(() => null);
    const exp = long?.expires_in ? now + long.expires_in * 1e3 : null;
    out = long?.access_token && exp && exp > out.exp ? { ...out, token: long.access_token, exp, refreshedAt: now, refreshTriedAt: now } : { ...out, refreshTriedAt: now };
  }
  return out;
}

/* the ad accounts a Meta connection reads: `accounts: [{ id, name, currency }]` (one or many, 2026-10-17). A connection saved
   with one `account` (+ `accountName`) is healed into the list on read, so nothing old breaks */
export const accountsOf = (c) => { const xs = Array.isArray(c?.accounts) ? c.accounts : c?.account ? [{ id: String(c.account), name: c.accountName || null }] : [];
  const seen = new Set(); return xs.map((a) => ({ ...a, id: String(a?.id || '').replace(/^act_/, '') })).filter((a) => a.id && !seen.has(a.id) && seen.add(a.id)); };
const nameKey = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/* the Page in an ad account that is this brand's: the Page the read found, a Page whose website (or link) is one of the site's
   hosts, or (one match only) a Page named like the brand or like the Facebook Page the Ad Library read found */
const ownPage = (pages, ctx) => pages.find((p) => (ctx.pageId && String(p.id) === String(ctx.pageId)) || `${p.website || ''} ${p.link || ''}`.split(/[\s,;]+/).filter(Boolean).some((w) => siteMatch(w.replace(/\.$/, ''), ctx)))
  || (() => { for (const n of [ctx.profile?.ads?.own?.page, ctx.profile?.name]) { const k = nameKey(n); const xs = k.length >= 4 ? pages.filter((p) => nameKey(p.name) === k) : []; if (xs.length === 1) return xs[0]; } return null; })();
/* the Page an ad promotes (its creative's story belongs to that Page) */
const adPage = (x) => String(x.creative?.object_story_spec?.page_id || String(x.creative?.effective_object_story_id || '').split('_')[0] || '');
/* the brand's Page among the Pages its ads run from, when the Ad Library read found that Page: the login often can't list the
   account's Pages (promote_pages needs Page permissions Brew doesn't ask for), but every ad names its Page */
/* `min`: how many of the account's ads must run from the Page before it counts (the ownership check wants more than one stray ad) */
const ownFromAds = (counts, ctx, min = 1) => (ctx.pageId && (counts.get(String(ctx.pageId)) || 0) >= min ? { id: String(ctx.pageId), name: ctx.profile?.ads?.own?.page || ctx.profile?.name || 'your Page' } : null);
const countPages = (ads) => { const m = new Map(); for (const x of ads || []) { const p = adPage(x); if (p) m.set(p, (m.get(p) || 0) + 1); } return m; };
/* a Page that carries a real share of the account's ads is another brand's: creator and partnership Pages (a few ads each,
   run for the brand) are not, so an account that is the brand's own isn't split for them */
const OTHER_SHARE = 0.15, LEARN_DAYS = 14; /* a campaign younger than LEARN_DAYS is still in Meta's learning phase */
const otherBrands = (counts, ownId) => { const tot = [...counts.values()].reduce((s, n) => s + n, 0); return [...counts.entries()].filter(([p, n]) => p !== String(ownId) && n >= Math.max(5, tot * OTHER_SHARE)).map(([p]) => p); };
const sumLabel = (xs) => (xs.length === 1 ? xs[0].name || `act_${xs[0].id}` : `${xs.length} ad accounts`);

const META = {
  id: 'meta', name: 'Meta Ads', modes: ['oauth'], picks: true, multi: true, /* several ad accounts at once */
  expires: true, /* no refresh token: the sign-in itself runs out, so the team is warned before it does */
  fresh: (c) => freshMeta(c),
  /* Graph error 190: the sign-in expired or was taken back. Only a new sign-in fixes it */
  expired: (e) => +e?.code === 190 || /error validating access token|session has expired|access token has expired/i.test(String(e?.message || '')),
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
  /* the ad accounts this login can read; with the brand in hand (ctx) each is checked for the brand's Page, so the picker can
     tick the brand's own ones first (own: true). A check that fails is left unknown (own: null), never "not the brand's" */
  async options(c, { ctx = null } = {}) {
    const xs = await all('me/adaccounts', c.token, { fields: 'account_id,name,currency,account_status,amount_spent', limit: 100 });
    const live = xs.filter((x) => x.account_status !== 2);
    const out = live.map((x) => ({ id: x.account_id, name: x.name || `Ad account ${x.account_id}`, sub: `${x.currency} · act_${x.account_id}`, currency: x.currency || null, own: null }));
    /* the first 25 accounts are checked (a big agency login lists hundreds); the rest stay unknown, never "not the brand's".
       Without Page permissions promote_pages comes back empty, so the first page of ads says whose Page they run from */
    if (ctx) for (const o of out.slice(0, 25)) { const pages = await all(`act_${o.id}/promote_pages`, c.token, { fields: 'id,name,website,link', limit: 100 }, 3).catch(() => null);
      let hit = pages ? ownPage(pages, ctx) : null;
      if (!hit && ctx.pageId) { const ads = await get(`act_${o.id}/ads`, c.token, { fields: 'id,creative{effective_object_story_id}', limit: 50 }).then((j) => j.data || []).catch(() => null);
        if (ads) hit = ownFromAds(countPages(ads), ctx, 2); if (!hit && !pages && !ads) continue; }
      o.own = !!hit; if (hit) o.pageIds = [String(hit.id)]; }
    return out;
  },
  /* the pick: { accounts: [{ id, name }] } (one or many), or the old { account, name } */
  select(c, choice) {
    const list = Array.isArray(choice?.accounts) ? choice.accounts : choice?.account ? [{ id: choice.account, name: choice.name || null }] : [];
    const accounts = accountsOf({ accounts: list.map((a) => ({ id: String(a?.id ?? a ?? ''), name: a?.name || null })) });
    const { account, accountName, ...rest } = c; return { ...rest, accounts, ...(accounts.length ? { account: accounts[0].id, accountName: accounts[0].name || null } : {}) }; /* account/accountName: for code that still reads one */
  },
  /* each ad account is checked on its own: the brand owns it when it can promote the brand's Page; the connection is "verified"
     when every picked account is, and the per-account verdicts ride on `accounts` for the sheet */
  async owns(c, ctx) {
    const xs = accountsOf(c); if (!xs.length) return { ok: false, why: 'Pick an ad account first' };
    const accounts = [];
    for (const a of xs) {
      const pages = await all(`act_${a.id}/promote_pages`, c.token, { fields: 'id,name,website,link', limit: 100 }, 5).catch(() => null);
      const acc = await get(`act_${a.id}`, c.token, { fields: 'name,currency,timezone_name' }).catch(() => ({}));
      const ads = !(pages && ownPage(pages, ctx)) && ctx.pageId ? await allSmaller(`act_${a.id}/ads`, c.token, { fields: 'id,creative{effective_object_story_id}' }, 500).catch(() => null) : null;
      const hit = (pages && ownPage(pages, ctx)) || (ads ? ownFromAds(countPages(ads), ctx, 2) : null);
      accounts.push({ id: a.id, name: acc.name || a.name || `act_${a.id}`, currency: acc.currency || a.currency || null, ...(hit ? { pageIds: [String(hit.id)] } : {}), ok: !!hit, ...(pages || ads ? {} : { error: true }),
        why: hit ? `The ad account runs ads for ${hit.name}` : pages || ads ? `None of this ad account’s pages is ${ctx.host}’s page` : 'Couldn’t read this ad account’s pages' });
    }
    const bad = accounts.filter((a) => !a.ok), ok = !bad.length;
    /* a page's website is free text: it shows the account is the brand's, never strong enough to own the brand (strong: false) */
    return { ok, strong: false, accounts, account: { id: accounts.map((a) => `act_${a.id}`).join(' '), name: sumLabel(accounts), currency: accounts[0].currency },
      why: ok ? accounts.map((a) => a.why).join('; ') : bad.map((a) => `${a.name}: ${a.why}`).join('; ') };
  },
  /* one ad account's last 30 days (and 7-day campaign rows); the account-level numbers go into m, the rest is summed by sync() */
  async syncOne(c, a, ctx) {
    const m = { id: a.id }, notes = [], A = `act_${a.id}`;
    const acc = await get(A, c.token, { fields: 'name,currency' });
    m.name = acc.name || a.name || A; m.currency = acc.currency || a.currency || null;
    /* ad-level rows come biggest spend first, so a read cut at the cap leaves out only the smallest ads */
    const ins = async (params) => { const r = await all(`${A}/insights`, c.token, { ...params, ...(params.level === 'ad' ? { sort: '["spend_descending"]' } : {}), limit: 200 }, 25); if (r.capped) notes.push(`${m.name}: Meta returned more than ${r.length} rows; the numbers cover the ${r.length} biggest.`); return r; };
    /* an agency or group ad account runs ads for several Pages: count only the ads that promote this brand's Page */
    const pages = await all(`${A}/promote_pages`, c.token, { fields: 'id,name,website', limit: 100 }, 5).catch(() => null);
    /* a failed ad list is said, never read as "no ads": the totals are then the whole account's, with a note */
    const ads = await allSmaller(`${A}/ads`, c.token, { fields: 'id,campaign_id,effective_status,creative{effective_object_story_id,object_story_spec{page_id}}' }).catch((e) => (notes.push(`${m.name}: the ad list couldn’t be read this time (${e.message.slice(0, 90)}), so live ads aren’t counted and the totals are the whole account’s. The next refresh tries again.`), null));
    if (ads?.capped) notes.push(`${m.name} has more than ${ads.length} ads; Brew read the first ${ads.length}.`);
    const counts = countPages(ads), own = (pages && ownPage(pages, ctx)) || ownFromAds(counts, ctx);
    const others = own ? otherBrands(counts, own.id) : [];
    const shared = !!(own && ads && others.length);
    const mine = shared ? new Set(ads.filter((x) => adPage(x) === String(own.id)).map((x) => x.id)) : null;
    if (shared) notes.push(`${m.name} also runs ads for other Pages. Brew counts only the ads for ${own.name}.`);
    /* ads for several brands' Pages and none of them known to be this brand's: the totals are the whole account's, and say so */
    const big = [...counts.entries()].filter(([, n]) => n >= Math.max(5, (ads?.length || 0) * OTHER_SHARE)).length;
    m.whole = !own && big > 1; m.shared = shared; m.ownName = own?.name || null; m.ownPageId = own ? String(own.id) : null;
    if (m.whole) notes.push(`${m.name} runs ads for several Pages and none is linked to this site, so its spend is the whole account’s. Add the site to your Facebook Page to count only yours.`);
    m.spend = 0; m.buys = 0; m.value = 0; m.valued = false; m.reach = null;
    if (!shared) {
      const [tot] = await ins({ date_preset: 'last_30d', fields: 'spend,impressions,clicks,reach,frequency,actions,action_values' });
      if (tot) { m.spend = +tot.spend || 0; m.buys = pick(tot.actions, PURCHASE) || 0; const value = pick(tot.action_values, PURCHASE); if (value != null) { m.value = value; m.valued = true; } m.reach = +tot.reach || null; }
    } else {
      const rows = await ins({ date_preset: 'last_30d', level: 'ad', fields: 'ad_id,spend,actions,action_values' });
      for (const x of rows.filter((r) => mine.has(String(r.ad_id)))) { m.spend += +x.spend || 0; m.buys += pick(x.actions, PURCHASE) || 0; const v = pick(x.action_values, PURCHASE); if (v != null) { m.value += v; m.valued = true; } }
    }
    const keep = (x) => !shared || mine.has(String(x.ad_id));
    const adWeek = await ins({ date_preset: 'last_7d', level: 'ad', fields: 'ad_id,ad_name,campaign_id,campaign_name,frequency,spend,ctr,actions,action_values' }).catch((e) => (notes.push(`Campaigns (${m.name}): ${e.message.slice(0, 100)}`), []));
    /* the brand's winning ads over 30 days, by real return (then purchases, then spend), among ads that spent 2% or more: the
       Brand Book's best references for any new ad (their pictures are saved by connectors/index.js; the numbers stay private) */
    const notes0 = [], log0 = console;
    try {
      /* Meta sometimes refuses the 30-day ad report ("Service temporarily unavailable"): once more, then 14 days, then the 7-day ad rows already read */
      const F = 'ad_id,ad_name,spend,ctr,actions,action_values', wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let rows = await ins({ date_preset: 'last_30d', level: 'ad', fields: F }).catch(async () => { await wait(4000); return ins({ date_preset: 'last_30d', level: 'ad', fields: F }); })
        .catch(() => ins({ date_preset: 'last_14d', level: 'ad', fields: F })).catch(() => (adWeek.length ? adWeek : null));
      if (!rows) throw new Error('Meta didn’t answer the ad report this time');
      rows = rows.filter(keep);
      const tot = rows.reduce((s, x) => s + (+x.spend || 0), 0), floor = Math.max(tot * 0.02, 1);
      const top = rows.map((x) => { const spend = +x.spend || 0, value = pick(x.action_values, PURCHASE), buys = pick(x.actions, PURCHASE); return { id: String(x.ad_id), name: x.ad_name || null, spend, ctr: x.ctr != null ? +(+x.ctr).toFixed(2) : null, buys, roas: value != null && spend ? +(value / spend).toFixed(2) : null }; })
        .filter((x) => x.spend >= floor).sort((p, q) => (q.roas ?? -1) - (p.roas ?? -1) || (q.buys || 0) - (p.buys || 0) || q.spend - p.spend).slice(0, 6);
      /* one read per winning ad (Graph v26 refused the ?ids= batch): its creative's picture and words */
      await Promise.all(top.map(async (x) => {
        const j = await get(x.id, c.token, { fields: 'creative{id,image_url,thumbnail_url,body,title,video_id,call_to_action_type}' }).catch((e) => (notes0.push(`ad ${x.id}: ${String(e.message).slice(0, 80)}`), null));
        const cr = j?.creative || {};
        /* the creative's own full-size picture: a video's poster or a link ad's picture (asked apart: a refused field must not lose the rest),
           else the creative's thumbnail asked at 1080px (its default is 64px, which reads as a blur) */
        const rich = cr.id ? await get(String(cr.id), c.token, { fields: 'object_story_spec{video_data{image_url},link_data{picture}}' }).catch(() => null) : null;
        let img = rich?.object_story_spec?.video_data?.image_url || cr.image_url || rich?.object_story_spec?.link_data?.picture || null;
        if (!img && cr.id) img = await get(String(cr.id), c.token, { fields: 'thumbnail_url', thumbnail_width: 1080, thumbnail_height: 1080 }).then((t) => t?.thumbnail_url || null).catch(() => null);
        Object.assign(x, { image: img || cr.thumbnail_url || null, body: cr.body || null, title: cr.title || null, video: !!cr.video_id, cta: cr.call_to_action_type || null }); }));
      if (notes0.length) log0?.warn?.('[meta] winners', notes0.slice(0, 3).join(' | '));
      m.winners = top.filter((x) => x.image).map((x) => ({ ...x, currency: m.currency, account: m.name }));
    } catch (e) { m.winnersError = String(e.message).slice(0, 120); }
    const byCamp = new Map();
    for (const x of adWeek.filter(keep)) { const k2 = x.campaign_id || x.campaign_name, c2 = byCamp.get(k2) || { name: x.campaign_name, s: 0, v: 0, valued: false, fw: 0 };
      const s = +x.spend || 0, v = pick(x.action_values, PURCHASE); c2.s += s; if (v != null) { c2.v += v; c2.valued = true; } c2.fw += s * (+x.frequency || 0); byCamp.set(k2, c2); }
    /* a campaign's frequency here is its ads' frequency weighted by spend: close to Meta's own, and the same for a shared account */
    m.adCamp = Object.fromEntries(adWeek.map((x) => [String(x.ad_id), String(x.campaign_id)])); /* each ad's campaign: a budget card shows the campaign's own ad (3.9) */
    m.camp = [...byCamp.entries()].map(([id, c2]) => ({ id: String(id), name: c2.name, spendDay: c2.s / 7, freq: c2.s ? c2.fw / c2.s : 0, roas: c2.valued && c2.s ? c2.v / c2.s : null, account: m.name, act: m.id })).filter((x) => x.spendDay > 0);
    /* a campaign's own frequency (impressions over its unique reach), not its ads' average: the same people see several ads of one
       campaign, so the average reads low. A shared account keeps the ads' average (only this brand's ads), and says so */
    if (!shared && m.camp.length) { const cf = await ins({ date_preset: 'last_7d', level: 'campaign', fields: 'campaign_id,frequency' }).catch(() => null);
      const fq = new Map((cf || []).map((x) => [String(x.campaign_id), +x.frequency])); for (const x of m.camp) if (fq.get(x.id) > 0) x.freq = fq.get(x.id); m.campFreq = !!cf; }
    /* each campaign's status and start: a campaign that is paused now (it spent earlier in the week) or started under LEARN_DAYS
       ago (still in Meta's learning phase) is never judged for a budget move. A lookup that fails leaves them judged, as before */
    const cids = m.camp.map((x) => x.id).filter((x) => /^\d+$/.test(x)).slice(0, 100);
    if (cids.length) { const st = await all(`${A}/campaigns`, c.token, { fields: 'id,effective_status,start_time,created_time', filtering: JSON.stringify([{ field: 'id', operator: 'IN', value: cids }]), limit: 100 }, 2).catch(() => null);
      /* a lookup that failed leaves every campaign's status unknown: no budget move is built on it (a paused one could be "To") */
      if (!st) { m.statusUnknown = true; notes.push(`${m.name}: campaign status couldn’t be read this time, so the budget card waits for the next read.`); }
      const by = new Map((st || []).map((x) => [String(x.id), x]));
      for (const x of m.camp) { const y = by.get(x.id); if (!y) continue; const t = Date.parse(y.start_time || y.created_time || ''); if (Number.isFinite(t)) x.start = t; x.status = y.effective_status || null; } }
    /* the windows Meta counts purchases over: "multiple" when campaigns differ, so their returns are a guide, not like for like */
    m.attr = await get(`${A}/insights`, c.token, { date_preset: 'last_30d', fields: 'attribution_setting' }).then((j) => j?.data?.[0]?.attribution_setting || null).catch(() => null);
    m.live = ads ? ads.filter((x) => x.effective_status === 'ACTIVE' && (!shared || mine.has(x.id))).length : null; m.adsFailed = !ads; m.adsCapped = !!ads?.capped;
    /* a tired ad is one still running: an ad paused since (it spent earlier in the week) needs no fresh version */
    const running = ads ? new Set(ads.filter((x) => x.effective_status === 'ACTIVE').map((x) => String(x.id))) : null;
    m.tired = adWeek.filter(keep).filter((x) => +x.frequency >= 3.5 && +x.spend > 0 && (!running || running.has(String(x.ad_id)))).map((x) => ({ name: x.ad_name, freq: +x.frequency }));
    return { m, notes };
  },
  /* every picked ad account is read; the numbers are the sum, with each account's own kept on `accounts` for the row */
  async sync(c, ctx) {
    const xs = accountsOf(c); if (!xs.length) throw new Error('No ad account picked: connect Meta Ads again and pick one.');
    const per = [], notes = [], failed = [];
    for (const a of xs) { try { const r = await META.syncOne(c, a, ctx); per.push(r.m); notes.push(...r.notes); } catch (e) { if (META.expired(e) || xs.length === 1) throw e; failed.push({ id: a.id, name: a.name || `act_${a.id}`, error: e.message.slice(0, 160) }); } }
    if (!per.length) throw new Error(`Couldn’t read the ad accounts: ${failed[0]?.error || 'no account read'}`);
    for (const f of failed) notes.push(`${f.name} couldn’t be read (${f.error}); its numbers are left out until the next refresh.`);
    /* money is summed per currency: the totals are in the currency most of the spend is in; another currency's accounts are listed on their own */
    const byCur = new Map(); for (const x of per) byCur.set(x.currency || '?', (byCur.get(x.currency || '?') || 0) + x.spend);
    const cur = [...byCur.entries()].sort((p, q) => q[1] - p[1])[0][0], inCur = per.filter((x) => (x.currency || '?') === cur), other = per.filter((x) => (x.currency || '?') !== cur);
    if (other.length) notes.push(`${other.map((x) => x.name).join(', ')} ${other.length === 1 ? 'is' : 'are'} in another currency, so ${other.length === 1 ? 'its' : 'their'} spend is shown per account, not in the total.`);
    const F = fmt({ ...ctx.profile, currency: cur !== '?' ? cur : ctx.profile?.currency, ...(cur === 'INR' ? { country: 'IN', locale: 'en-IN' } : cur !== '?' && ctx.profile?.country === 'IN' ? { country: 'XX', locale: 'en-US' } : {}) });
    const m = { spend: inCur.reduce((s, x) => s + x.spend, 0), purchases: null, cpa: null, roas: null, reach: null, live: null, camp: [], tired: [] };
    const buys = inCur.reduce((s, x) => s + x.buys, 0), value = inCur.reduce((s, x) => s + x.value, 0), valued = inCur.some((x) => x.valued);
    /* return on ad spend over the accounts that report purchase value: one that tracks purchases without value would only drag it down */
    const vSpend = inCur.filter((x) => x.valued).reduce((s, x) => s + x.spend, 0);
    if (buys) { m.purchases = buys; m.cpa = m.spend / buys; } if (valued && vSpend) m.roas = value / vSpend;
    if (per.some((x) => x.reach != null)) m.reach = per.reduce((s, x) => s + (x.reach || 0), 0);
    if (per.some((x) => x.live != null)) m.live = per.reduce((s, x) => s + (x.live || 0), 0);
    m.campAll = inCur.flatMap((x) => x.camp).sort((p, q) => q.spendDay - p.spendDay); m.tired = per.flatMap((x) => x.tired).sort((p, q) => q.freq - p.freq);
    /* the campaigns big enough to judge: 2% of the week's spend or more (a test of a few hundred a day isn't read yet) */
    const weekDay = m.campAll.reduce((s, x) => s + x.spendDay, 0); m.camp = m.campAll.filter((x) => x.spendDay >= weekDay * 0.02);
    const whole = per.length === inCur.length && per.every((x) => x.whole), many = per.length > 1;
    const accounts = per.map((x) => ({ id: x.id, name: x.name, currency: x.currency, spend: +x.spend.toFixed(2), purchases: x.buys || null, cpa: x.buys ? +(x.spend / x.buys).toFixed(2) : null, roas: x.valued && x.spend ? +(x.value / x.spend).toFixed(2) : null, live: x.live, whole: !!x.whole, shared: !!x.shared, ok: true }))
      .concat(failed.map((f) => ({ id: f.id, name: f.name, ok: false, error: f.error })));
    const account = { id: xs.map((a) => `act_${a.id}`).join(' '), name: sumLabel(accounts.filter((a) => a.ok).length ? accounts : xs), currency: cur !== '?' ? cur : null };

    const k = 'meta', name = 'Meta Ads', lane = ctx.lane, src = `Meta Ads · ${many ? `${per.length} ad accounts` : per[0].name}${!many && per[0].shared ? ` · ${per[0].ownName} ads only` : ''}`, out = [];
    const young = (x) => x.start && Date.now() - x.start < LEARN_DAYS * 864e5, off = (x) => x.status && x.status !== 'ACTIVE';
    /* fatigue is about campaigns still running: one paused since (it spent earlier in the week) gets no "rotate creative" card */
    const runningC = m.camp.filter((x) => !off(x)), hot = runningC.filter((x) => x.freq >= 3.5).sort((p, q) => q.freq - p.freq)[0], top = [...runningC].sort((p, q) => q.freq - p.freq)[0];
    /* fatigue: a campaign over 3.5 a week, or single ads over it (the ones the team would make fresh versions of) */
    if (hot || m.tired.length) { const t0 = m.tired[0];
      out.push(card(k, name, lane, 'freq', { agent: 'performance', sector: 'ads', type: 'decision', roles: ['growth', 'founder', 'brand'], badge: [`Frequency ${(hot || t0).freq.toFixed(1)}`, 'warn'], cta: 'Rotate creative',
        title: hot ? `Campaign ${hot.name} showed the same people its ads ${hot.freq.toFixed(1)} times this week` : m.tired.length === 1 ? `One ad showed the same people ${t0.freq.toFixed(1)} times this week` : `${plural(m.tired.length, 'ad')} showed the same people over 3.5 times this week`,
        sub: `${m.tired.length ? `${plural(m.tired.length, 'ad is', 'ads are')} past 3.5 a week. ` : ''}Above that, clicks fall and cost per order climbs. Fresh versions of the best ads reset it fastest.`,
        rows: [...(hot ? [['Campaign', hot.name], ...(many ? [['Ad account', hot.account]] : []), ['Frequency, 7 days', hot.freq.toFixed(1)], ['Spend a day', F.money(hot.spendDay)]] : []),
          ...m.tired.slice(0, 3).map((x, i) => [m.tired.length === 1 ? 'Tired ad' : `Tired ad ${i + 1}`, `${x.name} · ${x.freq.toFixed(1)} a week`]), ...(m.tired.length > 3 ? [['More tired ads', n0(m.tired.length - 3)]] : [])],
        detail: { why: ['Above 3.5 a week, clicks fall and cost rises.'], how: ['Pick the 3 best ads by cost per order', 'Make 2 new versions of each', 'Pause the tired ones as the new ones go live'] } })); }
    const learning = m.camp.filter((x) => x.roas != null && young(x) && !off(x)), stopped = m.camp.filter((x) => x.roas != null && off(x));
    const ranked = m.camp.filter((x) => x.roas != null && x.spendDay > 0 && !young(x) && !off(x)); let shiftRow = null;
    const mixed = per.some((x) => x.attr === 'multiple') || new Set(per.map((x) => x.attr).filter(Boolean)).size > 1;
    const caveats = [learning.length && `${learning.length === 1 ? `${learning[0].name} started` : `${learning.length} campaigns started`} under ${LEARN_DAYS} days ago and ${learning.length === 1 ? 'is' : 'are'} still learning, so ${learning.length === 1 ? 'it is' : 'they are'} left out.`,
      stopped.length && `${stopped.length === 1 ? '1 campaign that spent this week is' : `${stopped.length} campaigns that spent this week are`} paused now and left out.`,
      mixed && 'Your campaigns count purchases over different windows, so these returns are a guide, not like for like.'].filter(Boolean).join(' ');
    const campImg = (cp) => { for (const x of per) { const w = (x.winners || []).find((y) => x.adCamp?.[String(y.id)] === String(cp.id)); if (w?.image) return w.image; } return null; };
    if (ranked.length >= 2 && !per.some((x) => x.statusUnknown)) { const best = [...ranked].filter((x) => x.freq < 3.5).sort((p, q) => q.roas - p.roas)[0], worst = [...ranked].sort((p, q) => p.roas - q.roas)[0];
      if (best && best !== worst && best.roas > worst.roas * 1.3) shiftRow = { perDay: Math.round(worst.spendDay * 0.2) };
      if (shiftRow) out.push(card(k, name, lane, 'shift', { agent: 'performance', sector: 'ads', type: 'decision', roles: ['growth', 'founder'], badge: [roasX(best.roas), 'ok'], cta: 'Shift budget',
        title: `Move ${F.money(worst.spendDay * 0.2)} a day to ${best.name}`, sub: `This week ${best.name} returned ${roasX(best.roas)} and ${worst.name} ${roasX(worst.roas)}. Moving a fifth of the weaker budget in one step keeps learning intact.${caveats ? ` ${caveats}` : ''}`,
        /* the sum on the card itself (Arata 23 Oct: only a tooltip said where the amount came from): each campaign's spend a day now
           and after, and the amount as a fifth of the weaker one's */
        rows: [['From', `${worst.name} · ${roasX(worst.roas)}${many && worst.account !== best.account ? ` (${worst.account})` : ''}`], ['To', `${best.name} · ${roasX(best.roas)}${many && worst.account !== best.account ? ` (${best.account})` : ''}`],
          ['Move a day', `${F.money(worst.spendDay * 0.2)} (a fifth of ${F.money(worst.spendDay)})`], [`${String(worst.name).slice(0, 28)} a day`, `${F.money(worst.spendDay)} → ${F.money(worst.spendDay * 0.8)}`], [`${String(best.name).slice(0, 28)} a day`, `${F.money(best.spendDay)} → ${F.money(best.spendDay + worst.spendDay * 0.2)}`], ['Cost per purchase, 30 days', has(m.cpa) ? F.money(m.cpa) : null]],
        shift: { from: worst.name, to: best.name, fromRoas: +worst.roas.toFixed(2), toRoas: +best.roas.toFixed(2), perDay: Math.round(worst.spendDay * 0.2), fromDay: Math.round(worst.spendDay), toDay: Math.round(best.spendDay), fromId: worst.id || null, toId: best.id || null, fromAccount: worst.account || null, toAccount: best.account || null,
          fromAct: worst.act || null, toAct: best.act || null, fromImg: campImg(worst), toImg: campImg(best) }, /* the campaigns' ids and an ad picture each: the budget screen links to Ads Manager and shows the creative (3.9) */
        detail: { why: ['Returns differ by campaign, so the budget should too.', 'One step of 20% keeps the learning phase.'], how: ['Move the budget tomorrow morning', 'Read it after 7 days', 'Move it back if cost per purchase rises 15%'] } })); }
    /* an ad list that couldn't be read leaves the account unsplit: its totals are the whole account's, and the label says so */
    const unsplit = per.every((x) => x.adsFailed);
    const spendLabel = whole || unsplit ? 'Whole ad account spend, 30 days' : many ? `Spend across ${inCur.length} ad accounts, 30 days` : 'Spend, last 30 days';
    const stats = [has(m.spend) && [spendLabel, F.big(m.spend)], has(m.roas) && ['Return on ad spend', roasX(m.roas)], has(m.cpa) && ['Cost per purchase', F.money(m.cpa)], has(m.live) ? ['Live ads', n0(m.live)] : per.some((x) => x.adsFailed) && ['Live ads', 'Couldn’t read this time']].filter(Boolean);
    /* what the account changes in Brew, said only when it's true: each line names a card that is really in the feed */
    const has2 = (id) => out.some((x) => x.id === `live-meta-${id}`), nc = m.campAll.length;
    const changed = [has(m.cpa) && `Ad and creative cards measure against your cost per purchase (${F.money(m.cpa)})`,
      has2('freq') && (m.tired.length ? `${plural(m.tired.length, 'tired ad')} flagged for fresh versions` : `${hot.name} flagged for fresh creative`),
      nc && (has2('shift') ? `Budget card compares your ${plural(nc, 'campaign')} that spent this week${many ? ` across ${per.length} ad accounts` : ''}` : `Watching your ${plural(nc, 'campaign')} that spent this week${many ? ` across ${per.length} ad accounts` : ''}`)].filter(Boolean);
    const ledger = [has(m.spend) && L('meta.spend.30d', whole ? 'Meta spend, whole ad account (several Pages), last 30 days' : many ? `Meta spend, ${inCur.length} ad accounts, last 30 days` : 'Meta spend, last 30 days', F.big(m.spend), m.spend, src), has(m.roas) && L('meta.roas', `Meta return on ad spend, 30 days${mixed ? ' (campaigns count purchases over different windows)' : ''}`, roasX(m.roas), m.roas, src), has(m.cpa) && L('meta.cpa', `Meta cost per purchase, 30 days${mixed ? ' (campaigns count purchases over different windows)' : ''}`, F.money(m.cpa), m.cpa, src),
      has(m.live) && L('meta.ads.live', per.some((x) => x.adsCapped || x.adsFailed) ? 'Live Meta ads (at least: the ad list was cut short)' : 'Live Meta ads', n0(m.live), m.live, src), top && L('meta.frequency.max', per.every((x) => x.campFreq) ? 'Highest campaign frequency, 7 days' : 'Highest campaign frequency, 7 days (average of its ads’ frequency)', top.freq.toFixed(1), top.freq, src),
      /* every connected account named with its own spend and live ads (2.7: a count is the account's, never the whole Page's) */
      L('meta.accounts', many ? 'Meta ad accounts connected (spend 30 days, live ads)' : 'Meta ad account connected (spend 30 days, live ads)', accounts.filter((a) => a.ok).map((a) => `${a.name} (${!a.currency || a.currency === cur ? F.big(a.spend) : `${a.currency} ${Math.round(a.spend).toLocaleString('en-US')}`} spent${a.live != null ? `, ${n0(a.live)} live ads` : ''})`).join('; '), accounts.filter((a) => a.ok).length, src),
      top && m.camp.length && L('meta.frequency.def', 'How Brew counts frequency', 'Per campaign over 7 days: impressions over the people reached (the highest is the fact above)', null, src),
      /* the campaigns the budget and fatigue cards quote, so every name, return and daily figure on them traces to the account */
      m.camp.length && L('meta.campaigns.7d', 'Meta campaigns that spent this week (return, spend a day, frequency)', m.camp.map((x) => `${x.name}: ${roasX(x.roas) || 'no purchases tracked'}, ${F.money(x.spendDay)} a day, frequency ${x.freq.toFixed(1)}`).join('; '), m.campAll.length, src),
      shiftRow && L('meta.shift.day', 'A fifth of the weaker campaign’s daily spend', F.money(shiftRow.perDay), shiftRow.perDay, src)].filter(Boolean);
    for (const r of ledger) r.cur = cur !== '?' ? cur : null;
    const winners = per.flatMap((x) => x.winners || []).sort((p, q) => (q.roas ?? -1) - (p.roas ?? -1) || q.spend - p.spend).slice(0, 8);
    return { metrics: m, stats, changed, cards: out, ledger, notes, account, accounts, ownPageId: per.find((x) => x.ownPageId)?.ownPageId || null, winners, winnersError: per.find((x) => x.winnersError)?.winnersError || null };
  }
};
export default META;
