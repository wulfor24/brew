// Moves on a cadence: two move families written for ANY brand pack, every week, after the 51 build moves.
//   listen  2 to 4 moves from what listening heard (listen/*.json): counts, sentiment and trend, real quotes with links
//   auto    2 to 4 routines as plans: steps, owners and how it is measured. The team runs them from the shared brief;
//           Brew never runs them. The counted scorecard (auditScorecard: what the read found per area, every part with
//           its source) is evidence for these; there are no audit moves.
// Every move has the SAME shape as the build moves (moves-engine.js MOVE_SCHEMA), so the Moves tab, the move page,
// the PDF renderer and cards-gen read it as is. Numbers are checked against the evidence the move was written from
// (moves-engine scanNumbers); anything unbacked is marked "to confirm". Every "found" line cites the evidence it rests on.
// Numbering starts at 1001 (nextNumbers, CADENCE_BASE) and is never reused: a family's new run retires its last
// run (moves/history/, cards dropped from the feed), so the Moves tab always shows the current set.
// Pure helpers (scorecard, digests, numbering, shaping, gating) are exported so tests run them free.
// A brand with real connected accounts (private/connected-ledger.json) also gets a private run of each weekly family, for its
// team only: the same families written from the read plus the account numbers (the paid area scored from the Meta account,
// routines picked from the Klaviyo flows that are on or off). It goes to private/moves.json, private/moves/, private/cards.json
// (ids ending -p, privateOf the move number) and private/audit/scorecard.json; the public run and its files never change.
import { allowedFromLedger, scanNumbers } from './moves-engine.js';
import { realRows, privId } from './connectors/common.js';
import { mergeLedger } from './refresh.js';
import { withLive } from './on-connect.js';

const H = 3600e3, DAY = 24 * H;
const pad = (n) => String(n).padStart(2, '0');
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmt = (n) => Number(n).toLocaleString('en-US');

export const FAMILIES = {
  listen: { label: 'Listening', kicker: 'LISTENING', min: 2, max: 4, badge: 'Listening move' },
  auto: { label: 'Automation', kicker: 'AUTOMATION', min: 2, max: 4, badge: 'Automation move' },
  /* written when the team adds learnings in a jam (brand-learnings.js), never on the weekly clock */
  learn: { label: 'From what you told us', kicker: 'FROM YOUR TEAM', min: 1, max: 3, badge: 'From your team' }
};
export const FAMILY_ORDER = ['listen', 'auto']; // the weekly families
const ON_ASK = ['learn']; // families that run only when asked (manual, named in only)
const LEARN_KEEP = 6; // the learned moves kept live: older ones retire as new learnings land
// which build group a move's area reads like (cards-gen picks the card's sector and agent from it)
const AREA_GROUP = { site: 'convert', seo: 'found', ai: 'found', ads: 'reach', crm: 'keep', social: 'reach', reviews: 'keep', listen: 'reach', auto: 'keep', learn: 'know' };
const SKILLS = ['ai-seo', 'seo-audit', 'schema', 'cro', 'ads', 'ad-creative', 'emails', 'sms', 'social', 'community-marketing', 'customer-research', 'product-marketing', 'churn-prevention', 'referrals', 'analytics', 'content-strategy', 'pricing', 'offers'];

/* ---------- the audit scorecard: counted from the pack, every part with its source ---------- */
export const gradeOf = (s) => (s >= 80 ? 'A' : s >= 60 ? 'B' : s >= 40 ? 'C' : 'D');
const AREAS = [['site', 'Site and product pages'], ['seo', 'Search (SEO)'], ['ai', 'AI answers'], ['ads', 'Paid ads'], ['crm', 'Email and CRM'], ['social', 'Social'], ['reviews', 'Reviews']];
/* the team's connected rows by key (real rows only: a simulated account is never evidence) */
export const liveOf = (rows) => Object.fromEntries(realRows(rows).filter((e) => e.key && e.v != null).map((e) => [e.key, e]));
const nOf = (e) => (e?.n != null && Number.isFinite(+e.n) ? +e.n : null);
export function auditScorecard({ profile: p = {}, slug = '', now = Date.now(), live = null } = {}) {
  const host = p.host || slug, site = `https://${String(host).replace(/^https?:\/\//, '')}`, read = p.meta?.readAt ? dayOf(Date.parse(p.meta.readAt)) : dayOf(now);
  const out = [];
  const area = (k, parts, extra = {}) => {
    const got = parts.filter((x) => x.of > 0);
    const of = got.reduce((a, x) => a + x.of, 0), pts = got.reduce((a, x) => a + x.pts, 0);
    const label = AREAS.find((a) => a[0] === k)[1];
    const r = { k, label, read: of > 0, score: of ? clamp((100 * pts) / of) : null, parts: parts.map((x) => ({ ...x, pts: Math.round(x.pts) })), ...extra };
    r.grade = r.read ? gradeOf(r.score) : null; out.push(r);
  };
  const part = (k, pts, of, note, src, url, at = read) => ({ k, pts: Math.max(0, Math.min(of, pts)), of, note, src, url, at });
  /* site and product pages */
  const prods = p.catalog?.products || [], co = p.site?.checkout || {}, keyPages = p.site?.keyPages || [];
  { const parts = [];
    if (prods.length) {
      const avg = prods.reduce((a, x) => a + (x.images?.length || 0), 0) / prods.length, thin = prods.filter((x) => (x.images?.length || 0) <= 1).length;
      parts.push(part('Photos per product', (Math.min(avg, 4) / 4) * 20, 20, `${avg.toFixed(1)} photos per product on average across ${prods.length} products read; ${thin} have one photo or none`, `${host} products.json`, `${site}/products.json`));
      const inStock = prods.filter((x) => x.inStock !== false).length;
      parts.push(part('In stock', (inStock / prods.length) * 20, 20, `${inStock} of ${prods.length} products read are in stock (${pct(inStock, prods.length)}%)`, `${host} products.json`, `${site}/products.json`));
      const withRev = prods.filter((x) => (x.reviews?.count ?? x.reviews?.n ?? (typeof x.reviews === 'number' ? x.reviews : 0)) > 0).length;
      if (p.reviews?.app || withRev) parts.push(part('Reviews on product pages', p.reviews?.app ? 15 : (withRev / prods.length) * 15, 15, p.reviews?.app ? `review app on the site: ${p.reviews.app}` : `${withRev} of ${prods.length} products show reviews`, `${host} product pages`, site));
      else parts.push(part('Reviews on product pages', 0, 15, 'no review widget was found on the product pages read', `${host} product pages`, site));
    }
    const walk = co.walk || [];
    if (walk.length) { const ok = walk.filter((s) => s.ok).length; parts.push(part('Path to checkout', (ok / walk.length) * 25, 25, `${ok} of ${walk.length} steps of the walk to checkout worked (home, product, cart, checkout)${co.msToCheckout ? `, ${(co.msToCheckout / 1000).toFixed(1)} s to checkout` : ''}`, 'Brew checkout walk', walk[0]?.url || site)); }
    const want = [['faq|help', 'FAQ or help'], ['return', 'returns'], ['shipping', 'shipping'], ['contact', 'contact']];
    const have = want.filter(([re]) => keyPages.some((u) => new RegExp(re, 'i').test(u)));
    if (keyPages.length || p.site) parts.push(part('Help pages', (have.length / want.length) * 20, 20, `${have.length} of ${want.length} help pages found: ${have.map((x) => x[1]).join(', ') || 'none'}${have.length < want.length ? `; not found: ${want.filter((x) => !have.includes(x)).map((x) => x[1]).join(', ')}` : ''}`, `${host} key pages`, keyPages[0] || site));
    area('site', parts);
  }
  /* search */
  { const parts = [], sm = p.site?.sitemaps || [], terms = p.search?.terms || [], serp = p.search?.serp || [];
    const arts = sm.filter((s) => /articles|blogs/.test(s.url)).reduce((a, s) => a + (s.pages || 0), 0);
    if (sm.length) parts.push(part('Articles and guides', (Math.min(arts, 40) / 40) * 30, 30, `${arts} blog and article pages in the sitemap`, `${host} sitemap.xml`, sm.find((s) => /articles/.test(s.url))?.url || `${site}/sitemap.xml`));
    const prodPages = sm.filter((s) => /sitemap_products/.test(s.url)).reduce((a, s) => a + (s.pages || 0), 0);
    if (sm.length && p.catalog?.count) parts.push(part('Products in the sitemap', (Math.min(prodPages, p.catalog.count) / p.catalog.count) * 20, 20, `${prodPages} product pages in the sitemap for ${p.catalog.count} products in the catalog`, `${host} sitemap.xml`, `${site}/sitemap.xml`));
    if (serp.length) { const bare = String(host).replace(/^www\./, ''), hits = serp.filter((s) => (s.results || []).some((r) => String(r.domain || '').includes(bare)));
      const top = serp[0]?.results?.slice(0, 3).map((r) => r.domain).join(', ');
      parts.push(part('Ranks for category searches', (hits.length / serp.length) * 50, 50, `${host} is in the results read for ${hits.length} of ${serp.length} category searches${top ? `; "${serp[0].q}" shows ${top} first` : ''}`, 'Google results read by Brew', `https://www.google.com/search?q=${encodeURIComponent(serp[0].q)}`)); }
    else if (terms.length) parts.push(part('Ranks for category searches', 0, 0, `category searches were not read (${terms.slice(0, 2).join(', ')})`, 'Google results', ''));
    area('seo', parts);
  }
  /* AI answers */
  { const s = p.ai?.score, parts = [], ans = p.ai?.answers || [];
    if (s?.of) {
      const bOf = s.of - (s.unbrandedOf || 0);
      parts.push(part('Named when asked by name', (s.named - (s.unbrandedNamed || 0)) / Math.max(1, bOf) * 30, bOf > 0 ? 30 : 0,`named in ${s.named - (s.unbrandedNamed || 0)} of ${s.of - (s.unbrandedOf || 0)} answers that asked about ${p.name} by name`, 'ChatGPT, Gemini, Perplexity and Claude answers', ''));
      if (s.unbrandedOf) { const miss = ans.find((a) => !a.branded && !a.named && (a.rivalsNamed || []).length) || ans.find((a) => !a.branded && !a.named);
        parts.push(part('Named in category questions', (s.unbrandedNamed / s.unbrandedOf) * 70, 70, `named in ${s.unbrandedNamed} of ${s.unbrandedOf} category questions that did not name the brand${miss ? `; e.g. ${miss.tool} on "${cut(miss.q, 90)}"${(miss.rivalsNamed || []).length ? ` named ${miss.rivalsNamed.slice(0, 3).join(', ')}` : ''}` : ''}`, 'AI answers read by Brew', '')); }
    }
    area('ai', parts, s?.byTool ? { byTool: s.byTool } : {});
  }
  /* paid ads */
  { const own = p.ads?.own || {}, parts = [], items = own.items || [], lib = own.pageId ? `https://www.facebook.com/ads/library/?view_all_page_id=${own.pageId}` : 'https://www.facebook.com/ads/library/';
    const readAds = own.live != null && !own.error, lv = live || {};
    /* the team's view: the paid area is scored from the connected Meta account (return, frequency, cost per order), not the Ad Library */
    const roas = nOf(lv['meta.roas']), freq = nOf(lv['meta.frequency.max']), cpa = nOf(lv['meta.cpa']), aov = nOf(lv['shopify.aov']), liveN = nOf(lv['meta.ads.live']);
    const acct = roas != null || freq != null || cpa != null || liveN != null;
    if (acct) {
      const src = 'Meta Ads account (connected)', at = (k) => (lv[k]?.at ? dayOf(Date.parse(lv[k].at) || now) : read);
      if (liveN != null) parts.push(part('Live ads', (Math.min(liveN, 20) / 20) * 30, 30, `${liveN ? `${lv['meta.ads.live'].v} ads are live` : 'no ads are live'} in the connected Meta account${lv['meta.spend.30d'] ? ` (spend over the last 30 days: ${lv['meta.spend.30d'].v})` : ''}`, src, '', at('meta.ads.live')));
      if (roas != null) parts.push(part('Return on ad spend', (Math.min(roas, 4) / 4) * 40, 40, `Meta returned ${lv['meta.roas'].v} on ad spend over the last 30 days`, src, '', at('meta.roas')));
      if (freq != null) parts.push(part('Ad fatigue', freq <= 2.5 ? 30 : freq >= 5 ? 0 : ((5 - freq) / 2.5) * 30, 30, `the highest campaign frequency over 7 days is ${lv['meta.frequency.max'].v}${freq >= 3.5 ? ' (above 3.5, people tire of the same ads)' : ''}`, src, '', at('meta.frequency.max')));
      if (cpa != null && aov) { const r = cpa / aov; parts.push(part('Cost per order', r <= 0.25 ? 30 : r >= 1 ? 0 : ((1 - r) / 0.75) * 30, 30, `Meta cost per purchase is ${lv['meta.cpa'].v} against an average order of ${lv['shopify.aov'].v}`, src, '', at('meta.cpa'))); }
      else if (cpa != null) parts.push(part('Cost per order', 0, 0, `Meta cost per purchase is ${lv['meta.cpa'].v} (no order value is connected to compare it with)`, src, '', at('meta.cpa')));
    } else if (readAds) {
      const live = own.live || 0, fresh = items.filter((x) => (x.days ?? 999) <= 30).length, vid = items.some((x) => x.format === 'video' || x.video), img = items.some((x) => !(x.format === 'video' || x.video));
      parts.push(part('Live ads', Math.min(live, 20) / 20 * 40, 40, `${live} live ads in the Meta Ad Library${own.page ? ` (page ${own.page})` : ''}`, 'Meta Ad Library', lib));
      if (items.length) parts.push(part('Fresh creative', (fresh / items.length) * 30, 30, `${fresh} of ${items.length} ads read started in the last 30 days`, 'Meta Ad Library', lib));
      if (live) parts.push(part('Formats', vid && img ? 15 : 7, 15, vid && img ? 'video and image ads both live' : vid ? 'video ads only' : 'image ads only', 'Meta Ad Library', lib));
      const rv = (p.ads?.rivals || []).filter((r) => r.live > 0).sort((a, b) => b.live - a.live)[0];
      if (rv) parts.push(part('Against the busiest rival', Math.min(1, live / Math.max(1, rv.live)) * 15, 15, `${rv.name} has ${rv.live} live ads, ${p.name} has ${live}`, 'Meta Ad Library', 'https://www.facebook.com/ads/library/'));
    }
    const tech = p.site?.tech || {}; if (p.site?.tech) { const tags = ['metaPixel', 'ga4', 'gtm', 'googleAds', 'tiktokPixel'].filter((k) => tech[k]);
      parts.push(part('Tracking tags seen', tags.length ? 0 : 0, 0, tags.length ? `tags seen on the home page: ${tags.join(', ')}` : 'no Meta pixel, GA4 or Google Ads tag was detected on the home page read (to confirm: they may load later)', `${host} home page`, site)); }
    area('ads', parts, acct ? { from: 'account' } : {});
  }
  /* email and CRM */
  { const tech = p.site?.tech, parts = [];
    if (tech) {
      parts.push(part('Email tool', tech.klaviyo ? 40 : 0, 40, tech.klaviyo ? 'Klaviyo was detected on the site' : 'no email tool (Klaviyo) was detected on the pages read (to confirm: it may load later or run elsewhere)', `${host} home page`, site));
      parts.push(part('Chat or WhatsApp', tech.chat ? 25 : 0, 25, tech.chat ? `${tech.chat} chat on the site` : 'no chat or WhatsApp button was detected', `${host} home page`, site));
      parts.push(part('Subscriptions or loyalty', tech.subscriptionApp ? 15 : 0, 15, tech.subscriptionApp ? `subscription app: ${tech.subscriptionApp}` : 'no subscription or loyalty app was detected', `${host} home page`, site));
      const pop = (p.site?.checkout?.popups || []).length; parts.push(part('Sign-up capture', pop ? 20 : 0, 20, pop ? `${pop} sign-up popup${pop === 1 ? '' : 's'} seen on the walk` : 'no email or WhatsApp sign-up popup appeared on the walk to checkout', 'Brew checkout walk', site));
    }
    area('crm', parts);
  }
  /* social */
  { const so = p.socials || {}, parts = [], nets = ['instagram', 'youtube', 'tiktok', 'facebook', 'x', 'pinterest', 'linkedin'], on = nets.filter((k) => so[k]?.url);
    if (Object.keys(so).length) {
      parts.push(part('Channels', (Math.min(on.length, 5) / 5) * 25, 25, `${on.length} of ${nets.length} social channels linked from the site: ${on.join(', ') || 'none'}`, `${host} footer links`, site));
      const ig = so.instagram, posts = Array.isArray(ig?.posts) ? ig.posts : [];
      if (posts.length) {
        const last = posts.map((x) => Date.parse(x.at) || 0).sort((a, b) => b - a)[0], ageD = last ? Math.round((now - last) / DAY) : null;
        const in30 = posts.filter((x) => now - (Date.parse(x.at) || 0) <= 30 * DAY).length;
        const avgL = Math.round(posts.reduce((a, x) => a + (x.likes || 0), 0) / posts.length), avgC = Math.round(posts.reduce((a, x) => a + (x.comments || 0), 0) / posts.length);
        parts.push(part('Instagram cadence', (Math.min(in30, 12) / 12) * 40, 40, `${in30} of the last ${posts.length} Instagram posts went up in the last 30 days${ageD != null ? `; the newest is ${ageD} days old` : ''}`, `Instagram @${ig.handle}`, ig.url));
        parts.push(part('Instagram response', avgC >= 50 ? 20 : avgC >= 10 ? 12 : 5, 20, `${fmt(avgL)} likes and ${fmt(avgC)} comments per post on average over ${posts.length} posts`, `Instagram @${ig.handle}`, ig.url));
      }
      const yt = so.youtube, nv = Array.isArray(yt?.videos) ? yt.videos.length : +yt?.videos || 0;
      if (yt?.url) parts.push(part('Video', Math.min(nv, 10) / 10 * 15, 15, `${nv} YouTube videos read on the channel`, 'YouTube channel', yt.url));
      else parts.push(part('Video', 0, 15, 'no YouTube channel linked from the site', `${host} footer links`, site));
    }
    area('social', parts);
  }
  /* reviews */
  { const rv = p.reviews || {}, parts = [], plat = rv.platforms || [];
    if (rv.total != null || plat.length) {
      const total = rv.total || 0; parts.push(part('Review volume', Math.min(total, 1000) / 1000 * 40, 40, `${fmt(total)} reviews found${plat.length ? ` (${plat.map((x) => `${x.label || x.name}: ${fmt(x.count)}`).join('; ')})` : ''}`, plat[0]?.label || 'reviews read', plat[0]?.url || site));
      const rated = plat.find((x) => x.rating); if (rated) parts.push(part('Rating', Math.max(0, (rated.rating - 3.5) / 1.3) * 30, 30, `${rated.rating.toFixed(1)} average on ${rated.label || rated.name}`, rated.label || rated.name, rated.url));
      const recent = rv.recent || []; if (recent.length) { const in30 = recent.filter((x) => now - (Date.parse(x.at) || 0) <= 30 * DAY).length, low = recent.filter((x) => (x.rating || 5) <= 3).length;
        parts.push(part('Recent reviews', (in30 / recent.length) * 30, 30, `${in30} of the ${recent.length} newest reviews read are from the last 30 days; ${low} rated 3 stars or less`, plat[0]?.label || 'reviews read', plat[0]?.url || site)); }
    }
    area('reviews', parts);
  }
  const done = out.filter((a) => a.read);
  return { at: new Date(now).toISOString(), readAt: p.meta?.readAt || null, brand: p.name || slug, host, overall: done.length ? clamp(done.reduce((a, x) => a + x.score, 0) / done.length) : null,
    areas: out, weakest: [...done].sort((a, b) => a.score - b.score).slice(0, 3).map((a) => a.k), ...(live && Object.keys(live).length ? { private: true, accounts: [...new Set(Object.keys(live).map((k) => k.split('.')[0]))] } : {}) };
}

/* ---------- listening, as a digest the moves are written from (quant + qual) ---------- */
export function listenDigest(L, { now = Date.now() } = {}) {
  if (!L || (!L.themes?.length && !L.threads?.length)) return null;
  const items = new Map((L.items || []).map((x) => [x.id, x]));
  const themes = (L.themes || []).filter((t) => t?.name && t.n >= 3).slice(0, 6).map((t) => ({
    name: t.name, n: t.n, pos: t.pos || 0, neg: t.neg || 0, neutral: t.neutral || 0, brand: t.brand || 0, share: t.share ?? null, week: t.wow?.week ?? null, lastWeek: t.wow?.lastWeek ?? null,
    quotes: [...new Set(t.quoteIds || [])].map((id) => items.get(id)).filter((x) => x?.link).slice(0, 2).map((x) => ({ text: cut([x.title, x.text].filter(Boolean).join('. '), 220), url: x.link, where: x.sub || x.platform }))
      .concat(!(t.quoteIds || []).some((id) => items.get(id)?.link) && t.quote && t.quoteLink ? [{ text: cut(t.quote, 220), url: t.quoteLink, where: (String(t.quoteLink).match(/\/r\/[^/]+/) || ['public post'])[0].replace(/^\//, '') }] : []).slice(0, 2) }));
  const questions = (L.threads || []).filter((t) => t.url && t.intent === 'question' && now - (t.lastActive || 0) < 180 * DAY && !/marketplace|buysell|deals?\b/i.test(`${t.where} ${t.title}`))
    .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5).map((t) => ({ title: cut(t.title, 140), url: t.url, where: t.where, replies: t.replies || 0, about: t.about, lastActive: t.lastActive ? dayOf(t.lastActive) : null }));
  const threads = (L.threads || []).filter((t) => t.url && t.about === 'brand').sort((a, b) => (b.replies || 0) - (a.replies || 0)).slice(0, 4).map((t) => ({ title: cut(t.title, 140), url: t.url, where: t.where, replies: t.replies || 0, sentiment: t.sentiment, quote: cut(t.quote, 200) }));
  const communities = (L.communities || []).slice(0, 4).map((c) => ({ name: c.name, url: c.url, posts: c.posts, brand: c.brand, rival: c.rival, questions: c.questions, why: c.why }));
  const sources = Object.values(L.status?.sources || {}).filter((s) => s.state === 'ok').map((s) => `${s.name} (${s.kept ?? s.got ?? 0} kept)`);
  return { at: L.status?.at ? dayOf(L.status.at) : dayOf(now), total: L.total || (L.items || []).length, items: (L.items || []).length, sources, themes, questions, threads, communities };
}

/* ---------- automation: the routines Brew can run, from the stack it can see ---------- */
/* the five key Klaviyo flows the connector checks (connectors/klaviyo.js FLOWS), and the routine each one already covers */
export const KEY_FLOWS = ['Welcome', 'Abandoned checkout', 'Browse abandonment', 'Post-purchase', 'Win-back'];
const FLOW_OF = { 'review-ask': 'Post-purchase', 'win-back': 'Win-back' };
export function automationContext({ profile: p = {}, listen = null, scorecard = null, live = null } = {}) {
  /* routines the brand's team runs on its own tools from the shared brief; Brew never runs them */
  const tech = p.site?.tech || {}, own = p.ads?.own || {}, out = [], skipped = [], lv = live || {};
  /* the team's view: Klaviyo connected says which key flows run (skip those) and which are off (fix those) */
  const klav = !!(lv['klaviyo.flows.live'] || lv['klaviyo.flows.off']);
  const off = klav ? String(lv['klaviyo.flows.off']?.v ?? '').split(/,\s*/).map((x) => x.trim()).filter((x) => KEY_FLOWS.includes(x)) : null;
  const flowOn = (k) => klav && FLOW_OF[k] && !off.includes(FLOW_OF[k]);
  const email = klav ? 'Klaviyo (connected)' : tech.klaviyo ? 'Klaviyo (detected on the site)' : 'their email tool (none was detected on the site)';
  const chat = /whatsapp/i.test(tech.chat || '') ? 'WhatsApp (chat button on the site)' : 'WhatsApp, for customers who said yes';
  const mail = klav || tech.klaviyo ? 'Klaviyo' : 'their email tool';
  const offWhy = (k) => (klav && FLOW_OF[k] && off.includes(FLOW_OF[k]) ? `the ${FLOW_OF[k]} flow is not live in Klaviyo; ` : '');
  if (listen?.questions?.length) out.push({ k: 'reply-sweep', name: 'Weekly reply-to-questions sweep', why: `${listen.questions.length} open public questions were heard${listen.communities[0] ? `; the busiest community is ${listen.communities[0].name}` : ''}`, runs: 'Every Monday the team lists new public questions and posts an honest reply as the brand', tools: ['community replies'] });
  if (nOf(lv['meta.ads.live']) > 0 || lv['meta.frequency.max']) out.push({ k: 'creative-refresh', name: 'Weekly creative refresh', why: [lv['meta.ads.live'] && `${lv['meta.ads.live'].v} live Meta ads in the account`, lv['meta.frequency.max'] && `the highest campaign frequency over 7 days is ${lv['meta.frequency.max'].v}`, lv['meta.cpa'] && `cost per purchase ${lv['meta.cpa'].v}`].filter(Boolean).join('; '), runs: 'Every Monday the team reads the ads, pauses the ones that fell behind and makes two fresh versions of the winners', tools: ['Meta Ads'] });
  else if (own.live && !lv['meta.ads.live']) out.push({ k: 'creative-refresh', name: 'Weekly creative refresh', why: `${own.live} live Meta ads; fresh creative keeps cost per order down`, runs: 'Every Monday the team reads the ads, pauses the ones that fell behind and makes two fresh versions of the winners', tools: ['Meta Ads'] });
  for (const r of [{ k: 'review-ask', name: 'Review ask after delivery', why: `${fmt(p.reviews?.total || 0)} reviews so far${p.reviews?.app ? ` on ${p.reviews.app}` : ''}`, runs: `A message flow in ${mail} a set number of days after delivery, with a WhatsApp nudge`, tools: [mail, 'WhatsApp'] },
    { k: 'win-back', name: 'Win-back for lapsed buyers', why: 'repeat orders without new ad spend', runs: `A segment of buyers with no order in a set window, then a short series in ${mail} and WhatsApp, with a holdout`, tools: [mail, 'WhatsApp'] }]) {
    if (flowOn(r.k)) { skipped.push({ k: r.k, why: `the ${FLOW_OF[r.k]} flow already runs in Klaviyo` }); continue; }
    out.push({ ...r, why: `${offWhy(r.k)}${r.why}` });
  }
  /* the other key flows that are off: each one a routine to fix */
  if (klav) for (const f of off.filter((x) => !Object.values(FLOW_OF).includes(x))) out.push({ k: `flow-${f.toLowerCase().replace(/[^a-z]+/g, '-')}`, name: `Turn on the ${f} flow`, why: `the ${f} flow is not live in Klaviyo (${lv['klaviyo.flows.live']?.v ?? 'some'} key flows live)`, runs: `Build the ${f} flow in Klaviyo, send it to a slice of the list first, then turn it on for everyone`, tools: ['Klaviyo'] });
  if ((p.catalog?.products || []).some((x) => x.inStock === false)) out.push({ k: 'restock-alert', name: 'Back-in-stock alerts', why: `${p.catalog.products.filter((x) => x.inStock === false).length} of ${p.catalog.products.length} products read are out of stock`, runs: `A sign-up on sold-out pages, then a message in ${mail} the day the product is back`, tools: [mail, 'the store'] });
  if (scorecard?.areas?.find((a) => a.k === 'ai')?.read) out.push({ k: 'ai-answers-watch', name: 'Weekly AI answers check', why: `AI answers score ${scorecard.areas.find((a) => a.k === 'ai').score} of 100`, runs: 'The same category questions asked every week; a new gap becomes a page to publish', tools: ['the store'] });
  return { email, chat, tools: Object.entries(tech).filter(([, v]) => v).map(([k, v]) => (v === true ? k : `${k}: ${v}`)), routines: out, skipped, programKinds: ['action', 'task', 'message', 'check', 'wait'], owners: ['you', 'team'] };
}

/* ---------- evidence: numbered lines every move must cite ---------- */
export function evidenceFor(family, { scorecard, listen, auto, profile = {}, ledger = [], brief = null, live = null } = {}) {
  const ev = []; const add = (text, src, url = '', at = '') => { if (text) ev.push({ id: `e${ev.length + 1}`, text: cut(text, 400), src: cut(src, 120), url: url || '', at: at || '' }); };
  const host = profile.host ? `https://${profile.host}` : '';
  if (family === 'listen' && listen) {
    add(`Brew heard ${listen.total} tagged public posts, comments and reviews${listen.sources.length ? ` (${listen.sources.join(', ')})` : ''}`, 'Brew listening', '', listen.at);
    for (const t of listen.themes) {
      add(`Theme "${t.name}": ${t.n} mentions (${t.pos} positive, ${t.neg} negative, ${t.neutral} neutral)${t.brand ? `, ${t.brand} about the brand` : ''}${t.week != null ? `; ${t.week} this week vs ${t.lastWeek} the week before` : ''}`, 'Brew listening, themes', '', listen.at);
      for (const q of t.quotes) add(`Quote on "${t.name}" (${q.where}): "${q.text}"`, q.where, q.url, listen.at);
    }
    for (const q of listen.questions) add(`Open question in ${q.where}: "${q.title}" (${q.replies} replies, last active ${q.lastActive})`, q.where, q.url, q.lastActive);
    for (const t of listen.threads) add(`Thread about the brand in ${t.where}: "${t.title}" (${t.replies} replies, ${t.sentiment || 'mixed'})${t.quote ? `: "${t.quote}"` : ''}`, t.where, t.url, listen.at);
    for (const c of listen.communities) add(`Community ${c.name}: ${c.posts} posts heard, ${c.brand} about the brand, ${c.questions} questions (${c.why})`, c.name, c.url, listen.at);
  }
  if (family === 'auto' && auto) {
    add(`Tools seen on the site: ${auto.tools.join(', ') || 'none detected'}`, `${profile.host} home page`, host);
    for (const r of auto.routines) add(`Routine candidate "${r.name}": ${r.why}. How it runs: ${r.runs}. Uses: ${r.tools.join(', ')}`, 'Brew routine ideas', '');
    for (const s of auto.skipped || []) add(`Not a routine to propose: ${s.why}`, 'Klaviyo (connected)', '');
    /* the team's run: every number its connected accounts read, as evidence the plans may quote */
    for (const e of Object.values(live || {}).slice(0, 30)) add(`${e.label || e.key}: ${e.v}`, `${e.src || String(e.key).split('.')[0]} (connected account)`, '', String(e.at || '').slice(0, 10));
    if (listen?.questions?.length) for (const q of listen.questions.slice(0, 3)) add(`Open question in ${q.where}: "${q.title}" (${q.replies} replies)`, q.where, q.url, q.lastActive);
    if (scorecard) for (const a of scorecard.areas.filter((x) => x.read && ['crm', 'reviews', 'ads'].includes(x.k))) for (const x of a.parts) add(`${a.label} · ${x.k}: ${x.note}`, x.src, x.url, x.at);
  }
  /* what the team told Brew: every learning is a line with its own source (who added what, when) */
  if (family === 'learn' && brief?.learned) for (const [k, name] of [['tried', 'Already tried'], ['essence', 'Essence'], ['goals', 'Goal'], ['beliefs', 'Belief'], ['facts', 'Fact']])
    for (const x of (brief.learned[k] || []).slice(0, k === 'tried' ? 40 : 12)) add(`${name} (the team's words): ${x.text}${x.quote ? ` [said: "${cut(x.quote, 160)}"]` : ''}`, x.source || 'What the team told Brew', '', String(x.at || '').slice(0, 10));
  // a few ledger lines (prices, review totals) so plans can quote real numbers
  const keep = /^(reviews|catalog|social)\./;
  for (const e of ledger.filter((e) => keep.test(e.key)).slice(0, 18)) add(`${e.label}: ${e.v}`, e.src || 'ledger', e.url, e.at);
  if (brief) { if (brief.oneLine) add(brief.oneLine, 'Brand brief', host); for (const g of (brief.gaps || []).slice(0, 3)) add(`Gap in the brief: ${typeof g === 'string' ? g : g.gap || g.text || JSON.stringify(g)}`, 'Brand brief', host); }
  return ev;
}

/* ---------- numbering: after every move that exists or ever existed, never reused ---------- */
/* cadence moves live at 1001 and up: 1-65 are the build's specs (51-65 wait for listening) and 100-999 are its dynamic
   specs, so a cadence move never takes a number the build will write. Moves written at 51+ before this keep their
   numbers until their family's next run retires them (they carry meta.cadence, which the build and refresh skip). */
export const CADENCE_BASE = 1000;
export function nextNumbers(moves = {}, cadence = {}, k = 1) {
  const max = Math.max(CADENCE_BASE, ...Object.keys(moves || {}).map(Number).filter((n) => Number.isFinite(n) && n > CADENCE_BASE), (cadence.nextN > CADENCE_BASE ? cadence.nextN : CADENCE_BASE + 1) - 1);
  return Array.from({ length: k }, (_, i) => max + 1 + i);
}

/* ---------- the AI's answer → a move in the build shape ---------- */
const S = { type: 'string' };
export const FAMILY_SCHEMA = { type: 'object', properties: { moves: { type: 'array', items: { type: 'object', properties: {
  area: { type: 'string', enum: [...AREAS.map((a) => a[0]), 'listen', 'auto', 'learn'], description: 'audit: the scorecard area this move fixes; listening moves: listen; automation moves: auto; moves from what the team told us: learn' },
  skill: { type: 'string', enum: SKILLS },
  title: { type: 'string', description: 'Under 70 characters, specific to the brand, the point first' },
  stat: { type: 'string', description: 'One number from the evidence (a score, a count, a share), e.g. "12 of 32" or "D"' },
  statLabel: { type: 'string', description: 'Up to 6 words in capitals: what the stat is' },
  gives: { type: 'string', description: 'One sentence: what the brand gets' },
  live: { type: 'string', description: 'One sentence: what is live after 30 days' },
  why: { type: 'string', description: 'Two to four sentences: why this matters for the brand now, from the evidence' },
  found: { type: 'array', description: '2 to 5 findings, each citing the evidence ids it rests on', items: { type: 'object', properties: { text: S, ev: { type: 'array', items: S } } } },
  plan: { type: 'array', description: '3 to 5 steps', items: { type: 'object', properties: { step: { type: 'string', description: 'Under 8 words' }, detail: { type: 'string', description: 'One or two sentences' } } } },
  example: { type: 'object', description: 'One ready-to-use asset (a reply, a page section, an ad, a message, a routine step)', properties: { title: S, label: S, body: S } },
  measure: { type: 'array', description: '1 to 3 rows', items: { type: 'object', properties: { metric: S, baseline: { type: 'string', description: 'From the evidence, or "To be instrumented"' }, target: { type: 'string', description: 'A 90-day target, labelled as a target' }, rule: { type: 'string', description: 'The decision rule: keep, change or stop' } } } },
  program: { type: 'object', description: 'Automation moves only (others: empty name and no steps): the routine as a program', properties: { name: S, trigger: S, repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'] },
    steps: { type: 'array', items: { type: 'object', properties: { title: S, kind: { type: 'string', enum: ['action', 'task', 'message', 'check', 'wait'] }, day: { type: 'integer' }, owner: { type: 'string', enum: ['you', 'team'] }, repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'] } } } } } },
  toConfirm: { type: 'array', items: S }
} } } } };

const blk = (o) => ({ t: 'p', text: '', items: [], ordered: false, head: [], rows: [], caption: '', title: '', label: '', body: '', ...o });
export function shapeMove(raw, { n, family, ev = [], ledger = [], at = new Date().toISOString(), run = '', usd = 0, model = 'claude-sonnet-5-5' }) {
  const F = FAMILIES[family], byId = new Map(ev.map((e) => [e.id, e]));
  const found = (raw.found || []).map((f) => ({ text: String(f.text || '').trim(), ev: (f.ev || []).map((x) => String(x).trim().replace(/^\[|\]$/g, '')).filter((x) => byId.has(x)) })).filter((f) => f.text && f.ev.length);
  const dropped = (raw.found || []).length - found.length;
  if (!found.length || !raw.title) return null; // a move that cites nothing is not a move
  const cited = [...new Set(found.flatMap((f) => f.ev))].map((id) => byId.get(id));
  const plan = (raw.plan || []).filter((x) => x?.step).slice(0, 6), measure = (raw.measure || []).filter((x) => x?.metric).slice(0, 4);
  const prog = family === 'auto' && raw.program?.steps?.length ? { name: cut(raw.program.name || raw.title, 60), trigger: cut(raw.program.trigger || 'Every Monday', 80), repeat: raw.program.repeat && raw.program.repeat !== 'none' ? raw.program.repeat : null,
    steps: raw.program.steps.slice(0, 12).map((s) => ({ title: cut(s.title, 90), kind: s.kind, day: Math.max(0, Math.min(90, +s.day || 0)), owner: s.owner, ...(s.repeat && s.repeat !== 'none' ? { repeat: s.repeat } : {}) })) } : null;
  const sections = [
    { h: `Why this matters for ${raw.brand || 'the brand'}`.replace(' for the brand', ''), kind: 'why', blocks: [blk({ text: String(raw.why || raw.gives || '').trim() })] },
    { h: 'What we found', kind: 'found', blocks: [blk({ t: 'list', ordered: true, items: found.map((f) => f.text) })] },
    { h: 'The plan', kind: 'plan', blocks: plan.flatMap((x) => [blk({ t: 'h3', text: x.step }), blk({ text: x.detail || '' })]) },
    ...(prog ? [{ h: 'The routine', kind: 'plan', blocks: [blk({ text: `${prog.name}. Starts: ${prog.trigger}.${prog.repeat ? ` Repeats ${prog.repeat}.` : ''} The team runs it from the shared brief; Brew does not run it.` }),
      blk({ t: 'table', head: ['DAY', 'STEP', 'KIND', 'WHO', 'REPEATS'], rows: prog.steps.map((s) => [String(s.day), s.title, s.kind, s.owner, s.repeat || '']) })] }] : []),
    ...(raw.example?.body ? [{ h: 'Worked example', kind: 'examples', blocks: [blk({ t: 'example', title: cut(raw.example.title || 'Example', 90), label: raw.example.label || '', body: raw.example.body })] }] : []),
    { h: 'How we measure', kind: 'measure', blocks: [blk({ t: 'table', head: ['METRIC', 'BASELINE', '90-DAY TARGET', 'DECISION RULE'], rows: measure.map((m) => [m.metric, m.baseline || 'To be instrumented', m.target || '', m.rule || '']) })] },
    { h: 'Sources', kind: 'sources', blocks: [blk({ t: 'list', items: cited.map((e) => `${e.src}${e.at ? `, ${e.at}` : ''}${e.url ? `: ${e.url}` : ''}`) })] }];
  const move = { n, group: family, family, skill: SKILLS.includes(raw.skill) ? raw.skill : null, area: raw.area || family,
    kicker: `${F.kicker} · WEEK OF ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()}`, title: cut(raw.title, 90), stat: String(raw.stat || '').trim(), statLabel: String(raw.statLabel || '').trim().toUpperCase(),
    gives: String(raw.gives || '').trim(), live: String(raw.live || '').trim(), sections,
    sources: cited.map((e) => ({ label: `${e.src}: ${cut(e.text, 120)}`, url: e.url || '', at: e.at || '' })), factsUsed: cited.map((e) => e.id), derived: [], newFacts: [], toConfirm: (raw.toConfirm || []).filter(Boolean).slice(0, 8),
    meta: { model, at, usd: +(+usd || 0).toFixed(4), family, cadence: true, run, evidence: ev.length, cited: cited.length, droppedFindings: dropped } };
  // the number check the build moves get: every number in the evidence the move was written from, or "to confirm"
  const allowed = allowedFromLedger(ledger, ev.map((e) => e.text));
  const issues = scanNumbers(move, allowed);
  // stricter than the build check: a bare number in why / found / the example (or the cover stat) must be in the evidence too
  const bare = (text) => [...String(text || '').matchAll(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?![\d%])/g)].map((m) => ({ raw: m[1], v: +m[1].replace(/,/g, ''), at: m.index }))
    .filter((x) => x.v > 12 && !(x.v >= 1900 && x.v <= 2100 && !x.raw.includes(',')) && !allowed.has({ v: x.v, scaled: null }));
  const seen = new Set(issues.map((i) => `${i.at}|${i.raw}`));
  move.sections.forEach((s, si) => { if (!['why', 'found', 'examples'].includes(s.kind)) return; s.blocks.forEach((b, bj) => { for (const f of ['text', 'body', 'title', ...(b.items || []).map((_, k) => `items.${k}`)]) {
    const t = f.startsWith('items.') ? b.items[+f.slice(6)] : b[f]; for (const x of bare(t)) { const at = `s${si}.b${bj}`; if (seen.has(`${at}|${x.raw}`) || issues.some((i) => i.raw.includes(x.raw) && i.at === at)) continue; seen.add(`${at}|${x.raw}`);
      issues.push({ at, field: f, raw: x.raw, sentence: cut(t, 300), why: 'number not in the cited evidence' }); } } }); });
  if (!issues.some((i) => i.at === 'stat') && bare(move.stat).length) issues.push({ at: 'stat', field: 'stat', raw: bare(move.stat)[0].raw, sentence: `${move.stat} / ${move.statLabel}`, why: 'cover stat not backed' });
  const walkSet = (fn) => { for (const s of move.sections) for (const b of s.blocks) { for (const f of ['text', 'body', 'title']) if (b[f]) b[f] = fn(b[f], s.kind); b.items = (b.items || []).map((x) => fn(x, s.kind)); b.rows = (b.rows || []).map((r) => r.map((x) => fn(x, s.kind))); } };
  let unresolved = 0; const stat = issues.find((i) => i.at === 'stat');
  for (const i of issues.filter((i) => i.at !== 'stat')) { let hit = false; walkSet((t) => { if (!hit && typeof t === 'string' && t.includes(i.raw) && !t.includes(`${i.raw} (to confirm)`)) { hit = true; return t.replace(i.raw, `${i.raw} (to confirm)`); } return t; }); if (hit) { unresolved++; move.toConfirm.push(`${i.raw}: ${cut(i.sentence, 140)}`); } }
  if (stat) { move.toConfirm.push(`Cover stat ${move.stat} (${move.statLabel}) is not in the evidence`); move.stat = ''; move.statLabel = ''; }
  move.meta.verified = !issues.length; /* clean only when every number was in the evidence; otherwise the unbacked ones say (to confirm) */ move.meta.verify = { numbers: issues.length, unresolvedNumbers: unresolved, statUnbacked: !!stat, at, how: 'numbers checked against the cited evidence and the ledger' };
  move.meta.issues = issues.map((i) => `${i.at} ${i.raw}: ${i.why}`);
  return move;
}

/* ---------- the prompt for one family ---------- */
export function familyPrompt(family, { name, host, ev, scorecard, listen, auto, memory = '', brief = null, today = dayOf(Date.now()), k, hints = [], have = [] }) {
  const F = FAMILIES[family];
  const ctx = family === 'learn' ? `WHAT THE TEAM TOLD BREW (their essence, goals, beliefs and facts, each with who added it and when) is in the evidence. Write moves for what these learnings open that the current moves do not cover yet: a goal or launch to plan for, a belief to build creative or pages on, an audience or product to work on. Respect every belief: never propose what the team said to avoid.${hints.length ? `\nIdeas Brew saw while reading them (use the ones the evidence supports):\n${hints.map((h) => `- ${cut(h.title, 90)}: ${cut(h.why, 200)}`).join('\n')}` : ''}${have.length ? `\nThe brand's current moves (do not repeat these):\n${have.slice(0, 60).map((m) => `- ${m}`).join('\n')}` : ''}`
    : family === 'listen' ? `WHAT LISTENING HEARD (quant: counts, sentiment, trend; qual: real quotes with links) is in the evidence. Each move answers what people say: a worry to fix where buyers decide, words to use in creative, questions to answer in public, a community to show up in.`
    : `THE ROUTINES THAT FIT (each a plan: steps with a day, an owner (you or team), a kind (action, task, message, check, wait) and a repeat). The brand's team runs them on its own tools (${auto.email}, ${auto.chat}, Meta, Shopify, Klaviyo) from the brief Brew shares; Brew never runs them and never posts into communities. Pick the routines that fit this brand best and write each as a move with its plan and how it is measured (with a holdout or a before/after where it can).`;
  return `You write ${F.label.toLowerCase()} moves for ${name} (${host}), Brew's working documents for the brand's team. Today is ${today}.

${ctx}

EVIDENCE (cite these ids; every number you write must appear in a cited line, or be a plan target labelled as a target):
${ev.map((e) => `[${e.id}] ${e.text} (${e.src}${e.at ? `, ${e.at}` : ''})`).join('\n')}
${brief ? `\nBRAND BRIEF (context, not evidence): ${cut(JSON.stringify({ oneLine: brief.oneLine, goal: brief.goal, personas: brief.personas, objections: brief.objections, ...(brief.learned && family !== 'learn' ? { toldByTheTeam: Object.fromEntries(['essence', 'goals', 'beliefs', 'facts'].map((x) => [x, (brief.learned[x] || []).slice(0, 6).map((y) => y.text)])) } : {}) }), 3500)}` : ''}
${memory ? `\n${memory}\n` : ''}
Write ${k} moves (at least ${F.min}, at most ${F.max}). Rules:
- Each "found" line states one finding and lists the evidence ids it rests on in "ev". A finding with no id is dropped.
- Never invent a number, a quote, a customer, a result or a feature. A quote is only ever a quote from the evidence, with its place. If you need something that is not in the evidence, put it in toConfirm.
- Say a rival "was not observed" doing something, never that it lacks it. No motives for rivals.
- Plain words, no em dashes, no jargon. Specific to ${name}: name its products, places and numbers from the evidence.
- The example is ready to use (no placeholders), with no disclaimers or "illustrative" labels.
- Targets in the measure table are targets; the baseline comes from the evidence or says "To be instrumented".
- Follow the brand memory rules above when they apply.`;
}

/* ---------- writing one family for one brand ---------- */
export async function writeFamily(family, { ai, slug, pack, memory = null, log = console, now = Date.now(), numbers, hints = [], unless = null }) {
  const F = FAMILIES[family]; const { profile, ledger = [], brief, listen, live = null } = pack;
  if (family === 'learn' && !['essence', 'goals', 'beliefs', 'facts', 'tried'].some((k) => brief?.learned?.[k]?.length)) return { moves: [], usd: 0, skipped: 'nothing learned yet' };
  const scorecard = pack.scorecard || auditScorecard({ profile, slug, now, live });
  const ld = family === 'listen' || family === 'auto' ? listenDigest(listen, { now }) : null;
  if (family === 'listen' && !ld) return { moves: [], usd: 0, skipped: 'nothing heard yet' };
  const auto = family === 'auto' ? automationContext({ profile, listen: ld, scorecard, live }) : null;
  const ev = evidenceFor(family, { scorecard, listen: ld, auto, profile, ledger, brief, live });
  const evKey = ev.map((e) => e.text).join('\n');
  /* the team's run is written only when the accounts change what the moves rest on (the same evidence would buy the same moves) */
  if (unless != null && unless === evKey) return { moves: [], usd: 0, skipped: 'the connected accounts add nothing to this family', evKey };
  let mem = ''; try { mem = memory ? await memory.promptBlock(slug, { query: F.label, agent: family === 'auto' ? 'performance' : 'creative', name: profile?.name }) : ''; } catch {}
  const k = family === 'learn' ? Math.min(F.max, Math.max(F.min, hints.length || 2)) : F.max - 1;
  const have = family === 'learn' ? Object.entries(pack.moves || {}).filter(([n, m]) => +n > 0 && m?.title).map(([n, m]) => `${pad(n)} ${m.title}`) : [];
  const prompt = familyPrompt(family, { name: profile?.name || slug, host: profile?.host || slug, ev, scorecard, listen: ld, auto, memory: mem, brief, today: dayOf(now), k, hints, have });
  const r = await ai.call({ model: 'sonnet', effort: 'medium', max: 16000, schema: FAMILY_SCHEMA, prompt, tag: `moves-${family}`,
    system: 'You are the Brew deployment team writing short, exact strategy documents. Every claim rests on the evidence you are given.' });
  const raws = (r.json?.moves || []).slice(0, F.max), at = new Date(now).toISOString(), run = `${family}-${dayOf(now)}`;
  const nums = numbers(raws.length), moves = [];
  raws.forEach((raw, i) => { const m = shapeMove({ ...raw, brand: profile?.name }, { n: nums[i], family, ev, ledger, at, run, usd: (r.usd || 0) / Math.max(1, raws.length) }); if (m) moves.push(m); });
  // numbers a dropped move would have used are given back
  moves.forEach((m, i) => { m.n = nums[i]; });
  log.info?.(`[moves-cadence] ${slug} ${family}: ${moves.length} of ${raws.length} moves kept, $${(r.usd || 0).toFixed(3)}`);
  return { moves, usd: r.usd || 0, scorecard, evidence: ev.length, evKey };
}

/* ---------- the move's cards: cards-gen, then the family on the card ---------- */
export function tagCards(cards, move) {
  const F = FAMILIES[move.family]; const pre = `Move ${pad(move.n)}`;
  return cards.map((c) => ({ ...c, origin: 'cadence', moveFamily: move.family, badge: c.badge || [F.badge, 'info'],
    src: String(c.src || pre).startsWith(pre) ? `${pre} · ${F.label}${String(c.src).slice(pre.length)}` : `${pre} · ${F.label}` }));
}

/* ---------- gating: pure, so tests drive it ---------- */
export const MOVES_DEFAULTS = { tickMs: 60 * 60e3, firstMs: 6 * 60e3, everyDays: 7, weekCapUsd: 3, perTick: 2, estUsd: { listen: 0.5, auto: 0.5, learn: 0.6 } };
export function movesConfig(env = process.env) {
  const n = (k, d) => (env[k] != null && env[k] !== '' && Number.isFinite(+env[k]) ? +env[k] : d);
  return { ...MOVES_DEFAULTS, weekCapUsd: n('MOVES_WEEK_CAP_USD', MOVES_DEFAULTS.weekCapUsd), everyDays: n('MOVES_EVERY_DAYS', MOVES_DEFAULTS.everyDays),
    killed: env.MOVES_REFRESH_OFF === '1', mock: env.AI_MOCK === '1',
    // local servers set RESEARCH_OFF/LIVE_OFF: nothing runs in the background there unless MOVES_BG=1
    local: env.MOVES_BG !== '1' && (!!env.RESEARCH_OFF || !!env.LIVE_OFF) };
}
export const weekKey = (ms) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); const y = d.getUTCFullYear(), w1 = new Date(Date.UTC(y, 0, 4)); return `${y}-W${pad(1 + Math.round(((d - w1) / DAY - 3 + ((w1.getUTCDay() + 6) % 7)) / 7))}`; };
export const spentThisWeek = (st, now) => (st?.spend?.week === weekKey(now) ? st.spend.usd || 0 : 0);
// which families are due for one brand, and why not
export function movesDue(st = {}, cfg, { now = Date.now(), aiLive = true, ready = true, hasListen = false, readAt = null, manual = false, only = null } = {}) {
  const why = [], left = +(cfg.weekCapUsd - spentThisWeek(st, now)).toFixed(4);
  if (cfg.killed) return { families: [], left, why: ['MOVES_REFRESH_OFF'] };
  if (cfg.mock || !aiLive) return { families: [], left, why: ['AI is on mock: nothing runs, nothing is spent'] };
  if (!manual && cfg.local) return { families: [], left, why: ['background work is off here (MOVES_BG / RESEARCH_OFF / LIVE_OFF)'] };
  if (!ready) return { families: [], left, why: ['the brand is not built yet'] };
  const fams = []; let budget = left;
  for (const f of only?.length ? [...FAMILY_ORDER, ...ON_ASK].filter((x) => only.includes(x)) : FAMILY_ORDER) {
    if (f === 'listen' && !hasListen) { why.push('listen: nothing heard yet'); continue; }
    if (ON_ASK.includes(f) && !manual) { why.push(`${f}: runs only when the team adds learnings`); continue; }
    const last = st.last?.[f] || 0;
    if (!manual && !ON_ASK.includes(f) && now - last < cfg.everyDays * DAY) { why.push(`${f}: written ${Math.round((now - last) / DAY)} days ago`); continue; }
    if (budget < cfg.estUsd[f]) { why.push(`${f}: weekly cap $${cfg.weekCapUsd} (spent $${(cfg.weekCapUsd - left).toFixed(2)})`); continue; }
    budget -= cfg.estUsd[f]; fams.push(f);
  }
  return { families: fams, left, why };
}

/* ---------- the scheduler: weekly per built brand, plus the manual route ---------- */
const PRIVATE_FAMILIES = ['listen', 'auto']; // the weekly families that get a team-only run when real accounts are connected
export function createMovesScheduler({ packs, ai, memory = null, cardsGen = null, log = console, env = process.env, now = () => Date.now(), onCards = () => {}, onPack = async () => {}, dropCards = () => {}, pdfFor = null } = {}) {
  const cfg = movesConfig(env), P = 'moves/cadence.json', busy = new Set();
  const stateOf = async (slug) => (await packs.getJSON(slug, P, null).catch(() => null)) || {};
  const save = (slug, s) => packs.put(slug, P, s);
  // one meter per run: every Claude call this run makes (moves and their cards) is counted against the brand's week
  const metered = (box) => ({ ...ai, call: async (o) => { try { const r = await ai.call(o); box.usd += r.usd || 0; return r; } catch (e) { throw e; } } });
  async function packFor(slug) {
    const g = (n, d = null) => packs.getJSON(slug, n, d).catch(() => d);
    const [profile, ledger, brief, status, themes, threads, comms, lstatus, moves] = await Promise.all([g('profile.json'), g('ledger.json', []), g('brief.json'), g('status.json', {}), g('listen/themes.json'), g('listen/threads.json'), g('listen/communities.json'), g('listen/status.json'), g('moves.json', {})]);
    const listen = themes?.themes?.length || threads?.threads?.length ? { themes: themes?.themes || [], total: themes?.total || 0, threads: threads?.threads || [], communities: comms?.communities || [], status: lstatus, items: themes?.themes?.length ? (await g('listen/items.json'))?.items || [] : [] } : null;
    return { profile, ledger, brief, status, listen, moves };
  }
  /* the team's pack: the same read plus every real connected row (merged into the ledger), the team's brief and profile, and
     the rows by key (the scorecard's paid area, the Klaviyo flows). null when no real account is connected */
  async function privPackFor(slug, pack) {
    const g = (n, d = null) => packs.getJSON(slug, n, d).catch(() => d);
    const rows = realRows(await g('private/connected-ledger.json', [])); if (!rows.length) return null;
    const conn = [...realRows(await g('connected-ledger.json', [])), ...rows];
    return { ...pack, profile: withLive(pack.profile, await g('private/profile-live.json')), ledger: mergeLedger(pack.ledger || [], [], { connected: conn }).ledger,
      brief: (await g('private/brief.json')) || pack.brief, live: liveOf(rows) };
  }
  // retire a family's last run: history keeps the documents, the feed drops their cards
  async function retire(slug, ns, stamp, privNs = []) {
    await retirePrivate(slug, [...new Set([...(ns || []), ...(privNs || [])])], stamp);
    if (!ns?.length) return;
    const all = await packs.getJSON(slug, 'moves.json', {}), seed = await packs.getJSON(slug, 'seed.json', {}), labels = await packs.getJSON(slug, 'labels.json', {});
    const own = new RegExp(`^m(${ns.map(pad).join('|')})-`);
    for (const n of ns) { if (all[n]) await packs.put(slug, `moves/history/${pad(n)}-${stamp}.json`, all[n]).catch(() => {}); delete all[n]; delete labels[n]; }
    const gone = (seed.posts || []).filter((c) => own.test(c.id)).map((c) => c.id);
    seed.posts = (seed.posts || []).filter((c) => !own.test(c.id));
    await packs.put(slug, 'moves.json', all); await packs.put(slug, 'labels.json', labels); await packs.put(slug, 'seed.json', seed);
    if (gone.length) dropCards(slug, gone);
  }
  /* the team's copies of a retired run go with it: private history keeps the documents, their cards and PDFs leave */
  async function retirePrivate(slug, ns, stamp) {
    const pm = (await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({}))) || {}, hit = ns.filter((n) => pm[n]); if (!hit.length) return;
    for (const n of hit) { await packs.put(slug, `private/moves/history/${pad(n)}-${stamp}.json`, pm[n]).catch(() => {}); delete pm[n]; }
    await packs.put(slug, 'private/moves.json', pm);
    const own = new RegExp(`^m(${hit.map(pad).join('|')})-`), pc = (await packs.getJSON(slug, 'private/cards.json', []).catch(() => [])) || [];
    const gone = pc.filter((c) => own.test(c.id) || hit.includes(+c.privateOf)).map((c) => privId(c.id));
    await packs.put(slug, 'private/cards.json', pc.filter((c) => !(own.test(c.id) || hit.includes(+c.privateOf))));
    const pp = (await packs.getJSON(slug, 'private/pdfs.json', {}).catch(() => ({}))) || {}; if (hit.some((n) => n in pp)) { for (const n of hit) delete pp[n]; await packs.put(slug, 'private/pdfs.json', pp); }
    if (gone.length) dropCards(slug, gone);
  }
  async function cardsOf(slug, move, profile, gen, { priv = false } = {}) {
    const p = await packs.load(slug, { fresh: true }).catch(() => null); if (!p || !gen) return { cards: [], label: null };
    /* the team's cards check their numbers against the connected facts too (private/facts.json) */
    const facts = priv ? { ...p.facts, ...((await packs.getJSON(slug, 'private/facts.json', null).catch(() => null))?.facts || {}) } : p.facts;
    const { cards, label } = await gen.fromMove(move, { brand: { name: profile.name, host: profile.host }, facts, lanes: p.seed?.lanes, laneImg: p.seed?.laneImg, spec: { skill: move.skill, group: AREA_GROUP[move.area] || AREA_GROUP[move.family] || 'know' } });
    return { cards: tagCards(cards.filter((c) => !c.mock), move), label };
  }
  // run the families for one brand → { written: [{n, family, title}], usd, scorecard }
  async function runOne(slug, families, { manual = false, hints = [] } = {}) {
    if (busy.has(slug)) return { busy: true };
    busy.add(slug); const box = { usd: 0 }, t = now(), stamp = new Date(t).toISOString().replace(/[:.]/g, '-');
    let claimed = false;
    try {
      const pack = await packFor(slug); if (!pack.profile) return { error: 'This brand has not been read yet.' };
      /* one run per brand across instances: a run still going on another instance (a deploy overlaps old and new) holds
         the brand for 30 minutes; two runs at once wrote near-duplicate moves before */
      const st = await stateOf(slug); if (st.runningAt && t - st.runningAt < 30 * 60e3) return { busy: true, elsewhere: true };
      st.runningAt = t; await save(slug, st); claimed = true;
      const scorecard = auditScorecard({ profile: pack.profile, slug, now: t });
      await packs.put(slug, 'audit/scorecard.json', scorecard).catch(() => {});
      /* the team's scorecard and pack, from the read plus its real connected accounts (none connected: no private run) */
      const priv = await privPackFor(slug, pack), pscore = priv ? auditScorecard({ profile: priv.profile, slug, now: t, live: priv.live }) : null;
      if (pscore) await packs.put(slug, 'private/audit/scorecard.json', pscore).catch(() => {});
      st.scorecard = { at: scorecard.at, overall: scorecard.overall, areas: scorecard.areas.map((a) => ({ k: a.k, score: a.score, grade: a.grade })) };
      const A = metered(box), gen = cardsGen ? cardsGen({ ai: A, log }) : null, written = [], errors = [];
      for (const family of families) {
        if (box.usd >= cfg.weekCapUsd - spentThisWeek(st, t)) { errors.push({ family, error: 'weekly cap reached' }); break; }
        try {
          const have = await packs.getJSON(slug, 'moves.json', {});
          const r = await writeFamily(family, { ai: A, slug, pack: { ...pack, scorecard, moves: have }, memory, log, now: t, numbers: (k) => nextNumbers(have, st, k), hints: family === 'learn' ? hints : [] });
          if (!r.moves.length) { errors.push({ family, error: r.skipped || 'no move survived the checks' }); continue; }
          /* a family's new run retires its last run; learned moves pile up instead (each paste opens its own), the oldest past LEARN_KEEP retire */
          const prev = st.live?.[family] || [], out = family === 'learn' ? prev.slice(0, Math.max(0, prev.length + r.moves.length - LEARN_KEEP)) : prev;
          await retire(slug, out, stamp, family === 'learn' ? [] : st.privLive?.[family] || []);
          if (family !== 'learn' && st.privLive?.[family]) st.privLive[family] = [];
          const all = await packs.getJSON(slug, 'moves.json', {});
          for (const m of r.moves) { await packs.put(slug, `moves/${pad(m.n)}.json`, m); all[m.n] = m; }
          await packs.put(slug, 'moves.json', all);
          st.nextN = Math.max(st.nextN > CADENCE_BASE ? st.nextN : CADENCE_BASE + 1, ...r.moves.map((m) => m.n + 1));
          (st.live ||= {})[family] = [...(family === 'learn' ? prev.filter((n) => !out.includes(n)) : []), ...r.moves.map((m) => m.n)]; (st.last ||= {})[family] = t;
          written.push(...r.moves.map((m) => ({ n: m.n, family, title: m.title, sources: m.sources.length, toConfirm: m.toConfirm.length })));
          // cards: ranked with the rest once they are in the seed
          const seed = await packs.getJSON(slug, 'seed.json', {}), labels = await packs.getJSON(slug, 'labels.json', {}), add = [];
          for (const m of r.moves) { try { const { cards, label } = await cardsOf(slug, m, pack.profile, gen); if (label) labels[m.n] = label; add.push(...cards); } catch (e) { log.warn?.('[moves-cadence] cards', slug, m.n, e.message); } }
          const have2 = new Set((seed.posts || []).map((c) => c.id)); seed.posts = [...(seed.posts || []), ...add.filter((c) => !have2.has(c.id))];
          await packs.put(slug, 'seed.json', seed); await packs.put(slug, 'labels.json', labels);
          await onPack(slug); if (add.length) onCards(slug, add);
          if (pdfFor) for (const m of r.moves) await pdfFor(slug, m).catch((e) => log.warn?.('[moves-cadence] pdf', m.n, e.message));
          if (priv && PRIVATE_FAMILIES.includes(family)) await privateRun(slug, family, { A, gen, st, t, pack: { ...priv, scorecard: pscore }, pub: r, written }).catch((e) => { if (e.mock) throw e; errors.push({ family, private: true, error: e.message }); log.warn?.('[moves-cadence] private', slug, family, e.message); });
        } catch (e) { if (e.mock) { errors.push({ family, error: 'AI is on mock' }); break; } errors.push({ family, error: e.message }); log.warn?.('[moves-cadence]', slug, family, e.message); }
      }
      const wk = weekKey(t); if (st.spend?.week !== wk) st.spend = { week: wk, usd: 0 }; st.spend.usd = +((st.spend.usd || 0) + box.usd).toFixed(4);
      st.runs = [{ at: t, manual, families, written: written.filter((w) => !w.private).map((w) => w.n), privWritten: written.filter((w) => w.private).map((w) => w.n), usd: +box.usd.toFixed(4), errors }, ...(st.runs || [])].slice(0, 20);
      st.runningAt = null; claimed = false; await save(slug, st);
      return { written: written.filter((w) => !w.private), privWritten: written.filter((w) => w.private), usd: +box.usd.toFixed(4), errors, scorecard: st.scorecard };
    } finally { busy.delete(slug); if (claimed) { const s = await stateOf(slug).catch(() => null); if (s?.runningAt === t) { s.runningAt = null; await save(slug, s).catch(() => {}); } } }
  }
  /* the team's run of one family: written from the team's pack, numbered like the public run it sits beside (move 1004 for the
     team takes the place of the shared 1004; any extra move takes a new number), saved privately, cards for members only */
  async function privateRun(slug, family, { A, gen, st, t, pack, pub, written }) {
    const pubNs = pub.moves.map((m) => m.n), pm = (await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({}))) || {};
    const numbers = (k) => [...pubNs.slice(0, k), ...(k > pubNs.length ? nextNumbers({ ...(pack.moves || {}), ...pm, ...Object.fromEntries(pubNs.map((n) => [n, {}])) }, st, k - pubNs.length) : [])];
    const have = { ...(await packs.getJSON(slug, 'moves.json', {})), ...pm };
    const r = await writeFamily(family, { ai: A, slug, pack: { ...pack, moves: have }, memory, log, now: t, numbers, unless: pub.evKey });
    (st.privLive ||= {})[family] = [];
    if (!r.moves.length) return;
    for (const m of r.moves) { m.meta = { ...m.meta, private: true, accounts: pack.scorecard?.accounts || [] }; await packs.put(slug, `private/moves/${pad(m.n)}.json`, m); pm[m.n] = m; }
    await packs.put(slug, 'private/moves.json', pm);
    st.privLive[family] = r.moves.map((m) => m.n); st.nextN = Math.max(st.nextN || 0, ...r.moves.map((m) => m.n + 1));
    written.push(...r.moves.map((m) => ({ n: m.n, family, private: true, title: m.title, sources: m.sources.length, toConfirm: m.toConfirm.length })));
    const add = [];
    for (const m of r.moves) { try { const { cards } = await cardsOf(slug, m, pack.profile, gen, { priv: true }); add.push(...cards.map((c) => ({ ...c, id: privId(c.id), liveOnly: true, privateOf: m.n }))); } catch (e) { log.warn?.('[moves-cadence] private cards', slug, m.n, e.message); } }
    const own = new RegExp(`^m(${r.moves.map((m) => pad(m.n)).join('|')})-`), pc = (await packs.getJSON(slug, 'private/cards.json', []).catch(() => [])) || [];
    await packs.put(slug, 'private/cards.json', [...pc.filter((c) => !own.test(c.id)), ...add]);
    if (add.length) onCards(slug, add, { private: true });
  }
  /* the scorecard a viewer sees: members of a brand with real connected accounts get the team's (private/audit/scorecard.json),
     scored again from today's rows when it is missing or older than them (free: no AI, no read); everyone else the public one */
  async function scorecardFor(slug, member) {
    const pub = () => packs.getJSON(slug, 'audit/scorecard.json', null).catch(() => null);
    if (!member) return pub();
    const rows = realRows(await packs.getJSON(slug, 'private/connected-ledger.json', []).catch(() => [])); if (!rows.length) return pub();
    const saved = await packs.getJSON(slug, 'private/audit/scorecard.json', null).catch(() => null), newest = Math.max(0, ...rows.map((e) => Date.parse(e.at || 0) || 0));
    if (saved?.private && Date.parse(saved.at || 0) >= newest) return saved;
    const profile = await packs.getJSON(slug, 'profile.json', null).catch(() => null); if (!profile) return pub();
    const sc = auditScorecard({ profile, slug, now: now(), live: liveOf(rows) }); await packs.put(slug, 'private/audit/scorecard.json', sc).catch(() => {}); return sc;
  }
  const dueOf = async (slug, o = {}) => { const st = await stateOf(slug); const [s0, th, tr, pr] = await Promise.all([packs.getJSON(slug, 'status.json', {}), packs.getJSON(slug, 'listen/themes.json', null), packs.getJSON(slug, 'listen/threads.json', null), packs.getJSON(slug, 'profile.json', null)]).catch(() => [{}, null, null, null]);
    return movesDue(st, cfg, { now: now(), aiLive: ai?.live !== false, ready: !!s0?.ready, hasListen: !!(th?.themes?.length || tr?.threads?.length), readAt: pr?.meta?.readAt || null, ...o }); };
  let ticking = false;
  async function tick() {
    if (ticking) return { busy: true }; ticking = true; const ran = [];
    try { for (const b of (await packs.list().catch(() => [])).filter((x) => x.slug && x.status?.ready)) {
      if (ran.length >= cfg.perTick) break;
      const d = await dueOf(b.slug); if (!d.families.length) continue;
      ran.push(b.slug); await runOne(b.slug, d.families).catch((e) => log.warn?.('[moves-cadence] run', b.slug, e.message)); } }
    finally { ticking = false; }
    return { ran };
  }
  // POST /api/brands/:slug/moves/refresh { families? } (team-only on claimed brands) · GET /api/brands/:slug/moves/cadence
  const routes = ({ viewerOf, readBody, send, exists = async () => true }) => async (req, res, u) => {
    const m = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/moves\/(refresh|cadence)$/); if (!m) return false;
    const [, slug, what] = m;
    if (!(await exists(slug))) return send(res, 404, { error: 'unknown brand' }), true;
    if (what === 'cadence' && req.method === 'GET') { const st = await stateOf(slug), v = await viewerOf(req, slug).catch(() => ({}));
      return send(res, 200, { state: { last: st.last || {}, live: st.live || {}, spend: st.spend || null, runs: (st.runs || []).slice(0, 5).map(({ privWritten, ...r }) => (v.member ? { ...r, privWritten } : r)), nextN: st.nextN || null, ...(v.member ? { privLive: st.privLive || {} } : {}) },
        scorecard: await scorecardFor(slug, !!v.member), due: await dueOf(slug), running: busy.has(slug), cap: cfg.weekCapUsd }), true; }
    if (what !== 'refresh' || req.method !== 'POST') return send(res, 404, { error: 'not found' }), true;
    const v = await viewerOf(req, slug);
    if (!v.gen) return send(res, 403, { error: `Demo mode: only ${v.host || 'the brand'}’s team makes new moves. Sign in with your work email, or ask them to invite you.`, demo: true, host: v.host || null }), true;
    const b = await readBody(req).catch(() => ({})); const only = Array.isArray(b?.families) ? b.families.filter((f) => FAMILIES[f]) : null;
    const d = await dueOf(slug, { manual: true, only });
    if (!d.families.length) return send(res, 200, { ok: false, started: false, why: d.why, left: d.left }), true;
    if (busy.has(slug)) return send(res, 200, { ok: true, started: false, running: true }), true;
    runOne(slug, d.families, { manual: true }).catch((e) => log.warn?.('[moves-cadence] manual', slug, e.message));
    return send(res, 200, { ok: true, started: true, families: d.families, left: d.left }), true;
  };
  let timer = null;
  const start = () => { if (timer || cfg.killed || cfg.mock || cfg.local) { log.log?.(`[moves-cadence] weekly moves ${cfg.killed ? 'off (MOVES_REFRESH_OFF)' : cfg.mock ? 'off (AI mock)' : cfg.local ? 'off here (local)' : 'already on'}`); return false; }
    timer = setTimeout(function go() { tick().catch((e) => log.warn?.('[moves-cadence] tick', e.message)).finally(() => { timer = setTimeout(go, cfg.tickMs); timer.unref?.(); }); }, cfg.firstMs); timer.unref?.(); return true; };
  return { cfg, tick, start, runOne, stateOf, due: dueOf, routes, retire, scorecardFor, busy: () => busy.size };
}
