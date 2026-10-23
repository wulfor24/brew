// Listen watch: what people say in public about one brand, its rivals, its category and on its own accounts, for ANY brand pack.
// Two modes: "heard" (said without being asked; every source below) and "asked" (replies to questions the brand posted for a
// research move: addAsked() registers the thread, askedRun() re-reads it 1, 3, 7 and 14 days after it was posted).
//   reddit   → Reddit's search feed + PullPush (free); when Reddit or PullPush keep refusing, a paid Reddit search answers (capped)
//   youtube  → comments on videos that name the brand, a rival, the category or a problem, and on its own videos (YouTube Data API with YOUTUBE_API_KEY, else treg)
//   site     → the brand's own reviews (the public feed of Judge.me, Yotpo, Okendo, Stamped or Loox, found in the site's HTML)
//   tiktok, instagram, threads, linkedin, pinterest, telegram, facebook, x → posts and comments (treg)
//   amazon, walmart, trustpilot, google → reviews (treg); nykaa, flipkart, myntra → reviews for brands sold in India (Apify, else a page read)
//   news, web → news articles and Quora / forum / listicle pages (treg, free)
// Every paid source runs by default under a per-run cap (LISTEN_RUN_CAP_USD, $0.60) and the scheduler's daily cap; run({ paid: false }) reads free sources only.
// Searches are direct (the brand and its products) and indirect (rivals, the category, problems buyers have, questions they ask);
// every kept item says which: reach 'direct' (about the brand) or 'indirect'. run({ lite: true }) is the cheap read between full ones:
// free sources plus the fast social sources with one search each, newest first; slow review sources wait for the daily full read.
// Claude builds the relevance filter once per brand (cached in listen/config.json) and tags every item
// (themes, sentiment, intent, about). Nothing is generated: threads and communities are only what the sources returned.
// Files in the pack: listen/config.json, items.json, status.json, threads.json, themes.json, communities.json, asked.json,
// history/<YYYY-MM-DD>.json (+ history/index.json). Brands never see vendor names: display names come from SOURCES.
import { marketShort } from './market.js';
import { createApify } from './apify.js';
import { adCall } from './reader/adlib.js';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const DAY = 864e5, CAP = 3000, CFG_V = 1, FLOOR = 150;
/* what a failed call leaves in a source's notes (an empty treg balance, a quota, a blocked page) */
const FAILED = /\b(402|403|429|5\d\d)\b|insufficient|balance|quota|rate.?limit|failed|error|timed? ?out|refused/i;
// how many searches of each kind a paid source runs: a full read, and the light read between full ones
export const MIX = { brand: 2, rival: 2, category: 2, problem: 2 }, LITE_MIX = { brand: 1, rival: 1, category: 0, problem: 1 };
// a light read leaves these to the daily full read (reviews move slowly, comment reads cost the most)
export const LITE_SKIP = new Set(['amazon', 'walmart', 'trustpilot', 'google', 'nykaa', 'flipkart', 'myntra', 'facebook', 'linkedin', 'pinterest', 'telegram']);
// search kinds that are not about the brand by name
const INDIRECT_Q = new Set(['category', 'problem', 'question']);
const AMAZON = { IN: ['in', 'amazon.in'], US: ['us', 'amazon.com'], GB: ['uk', 'amazon.co.uk'], CA: ['ca', 'amazon.ca'], AU: ['au', 'amazon.com.au'], DE: ['de', 'amazon.de'], FR: ['fr', 'amazon.fr'], AE: ['ae', 'amazon.ae'], JP: ['jp', 'amazon.co.jp'] };
export const SOURCES = {
  reddit: { name: 'Reddit', how: 'Posts and comments that mention the brand, its rivals or the category', paid: false },
  youtube: { name: 'YouTube comments', how: "Comments on videos that name the brand, and on the brand's own videos", paid: true },
  site: { name: 'Site reviews', how: "The brand's own review app feed (Judge.me, Yotpo, Okendo, Stamped or Loox)", paid: false },
  x: { name: 'X posts', how: 'Posts that name the brand or a rival, or talk about the category and its problems', paid: true },
  amazon: { name: 'Amazon reviews', how: "Reviews on the brand's Amazon listings, its rivals' and the category's best sellers", paid: true },
  tiktok: { name: 'TikTok', how: 'Videos about the brand, its rivals and the category, and their comments', paid: true },
  instagram: { name: 'Instagram comments', how: "Reels that name the brand, the brand hashtag, and comments on reels and the brand's own posts", paid: true },
  threads: { name: 'Threads', how: 'Threads posts that name the brand or a rival', paid: true },
  linkedin: { name: 'LinkedIn', how: 'LinkedIn posts that name the brand or a rival', paid: true },
  pinterest: { name: 'Pinterest', how: 'Pins about the brand and the category', paid: true },
  telegram: { name: 'Telegram', how: "Messages in the brand's known Telegram channels", paid: true },
  facebook: { name: 'Facebook comments', how: "Comments on the brand's and rivals' Facebook posts", paid: true },
  igtag: { name: 'Instagram posts that tag you', how: 'Public Instagram posts and reels by customers and creators that tag or @mention the brand', paid: true },
  trustpilot: { name: 'Trustpilot reviews', how: 'Trustpilot reviews of the brand and its rivals', paid: true },
  google: { name: 'Google reviews', how: "Google Maps reviews of the brand's stores", paid: true },
  walmart: { name: 'Walmart reviews', how: "Reviews on the brand's Walmart listings (US)", paid: true },
  nykaa: { name: 'Nykaa reviews', how: "Reviews on the brand's Nykaa listings (India)", paid: true },
  flipkart: { name: 'Flipkart reviews', how: "Reviews on the brand's Flipkart listings (India)", paid: true },
  myntra: { name: 'Myntra reviews', how: "Reviews on the brand's Myntra listings (India)", paid: true },
  news: { name: 'News', how: 'News articles that name the brand or a rival, or cover the category', paid: false },
  web: { name: 'Web & forums', how: 'Quora answers, forums, blogs and best-of lists, and the questions buyers ask', paid: false }
};
export const sourceName = (id) => SOURCES[id]?.name || String(id || '');
// reviews belong to the listing they are on, not to the words they use
const REVIEW = new Set(['site', 'amazon', 'walmart', 'trustpilot', 'google', 'nykaa', 'flipkart', 'myntra']);
const ASK_DAYS = [1, 3, 7, 14];
const SENT = ['pos', 'neg', 'neutral'], INTENT = ['question', 'complaint', 'praise', 'compare', 'other'], ABOUT = ['brand', 'rival', 'category', 'none'];
// deal bots and coupon feeds are never people talking
const DEAL_SUB = /deal|discount|coupon|offer|loot|sale|promo|freebie/i;
const DEAL_TXT = /^\s*\[link\]\(|\b\d{1,2}\s?%\s?off\b|\bpromo code\b|\bcoupon code\b/i;
// near-spam: self-promotion, bots and bare reactions are never people talking about the brand
const SPAM_TXT = /\b(dm me|dm for|check (out )?my (bio|profile|page|channel)|link in (my )?bio|follow (me|back)|sub(scribe)? to my|giveaway|crypto|forex|bitcoin|earn \$?\d+|work from home|whats ?app (me|\+?\d)|telegram @|onlyfans|promo(tion)? (for|on) my)\b/i;
const BARE = (t) => { const w = String(t || '').replace(/https?:\/\/\S+|@\w+|#\w+/g, ' ').match(/[\p{L}\p{N}']+/gu) || []; return w.length < 3 || new Set(w.map((x) => x.toLowerCase())).size < 3; };

const unesc = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/\s+/g, ' ').trim();
// a first name and an initial ("Amey S."); a handle stays one word
const short = (name) => { const p = String(name || '').trim().replace(/^@|^\/?u\//, '').split(/\s+/).filter(Boolean); return p.length ? `${p[0]}${p[1] ? ` ${p[1][0]}.` : ''}` : 'Someone'; };
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsRe = (list) => { const xs = [...new Set((list || []).map((x) => String(x).trim().toLowerCase()).filter((x) => x.length >= 2))]; return xs.length ? new RegExp(`(^|[^a-z0-9])(${xs.map((x) => escRe(x).replace(/\\? /g, '[\\s-]?')).join('|')})(?=$|[^a-z0-9])`, 'i') : /(?!)/; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* the day Google's YouTube quota ran out (shared by every brand on this instance) */
const YT_OUT = { day: null };
const get = async (url, as = 'json', ms = 20e3) => { const r = await fetch(url, { headers: { 'user-agent': UA, accept: as === 'json' ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw Object.assign(new Error(`${r.status} ${url.split('?')[0]}`), { status: r.status }); return as === 'json' ? r.json() : r.text(); };
// Reddit and PullPush answer 429 to bursts: wait once, then try again (a second 429 is thrown with its status)
const getRetry = async (url, as, ms, wait = 3e3) => { try { return await get(url, as, ms); } catch (e) { if (e.status !== 429) throw e; await sleep(wait); return get(url, as, ms); } };
const timed = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} timed out after ${ms / 1e3}s`)), ms).unref?.())]);
// what a post says once its links are gone (a bare product link is not a voice)
const words = (t) => String(t || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ').split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
const enough = (x) => words(`${x.title || ''} ${x.text || ''}`) >= (x.kind === 'review' ? 2 : 4);
const threadOf = (link) => (String(link).match(/\/comments\/([a-z0-9]+)/i) || [])[1] || null;
// a time as ms: unix seconds, ms, ISO, dd/mm/yyyy or "3 weeks ago"
const UNIT = { minute: 6e4, hour: 36e5, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };
const ms = (v, now = Date.now()) => { if (v == null || v === '') return 0; if (typeof v === 'number' || /^\d+$/.test(v)) { const n = +v; return n < 1e12 ? n * 1e3 : n; }
  const s = String(v), rel = s.match(/(\d+|an?)\s+(minute|hour|day|week|month|year)s?\s+ago/i); if (rel) return now - (/^\d/.test(rel[1]) ? +rel[1] : 1) * UNIT[rel[2].toLowerCase()];
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]); return Date.parse(s) || 0; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const capHit = (e) => /cap .*reached|per-run/.test(e?.message || '');
const clip = (t, n = 800) => unesc(t).slice(0, n);
const firstLine = (t, n = 90) => clip(t, 400).split(/(?<=[.!?])\s|\n/)[0].slice(0, n);
// which platform a thread link belongs to (asked threads)
export const platformOf = (url) => { const h = hostOf(url); return /reddit\.com$/.test(h) ? 'reddit' : /(^|\.)x\.com$|twitter\.com$/.test(h) ? 'x' : /instagram\.com$/.test(h) ? 'instagram' : /tiktok\.com$/.test(h) ? 'tiktok' : /youtube\.com$|youtu\.be$/.test(h) ? 'youtube' : /facebook\.com$/.test(h) ? 'facebook' : /threads\.(net|com)$/.test(h) ? 'threads' : /linkedin\.com$/.test(h) ? 'linkedin' : 'web'; };
// which review app a store's HTML loads, with the public key its widget feed needs (null when none is readable)
export const reviewAppOf = (html, fallbackShop = null) => { const h = String(html || ''), m = (...res) => { for (const re of res) { const x = h.match(re); if (x) return x[1]; } return null; };
  const shop = m(/([\w-]+\.myshopify\.com)/) || fallbackShop;
  if (/judge\.me|jdgm-|judgeme/i.test(h)) return { app: 'judge.me', shop };
  if (/loox\.io|loox-rating/i.test(h)) return { app: 'loox', key: m(/loox\.io\/widget\/([\w-]+)\//i, /loox[^"']{0,40}clientId["']?\s*[:=]\s*["']([\w-]+)/i) };
  if (/yotpo/i.test(h)) return { app: 'yotpo', key: m(/staticw2\.yotpo\.com\/([A-Za-z0-9]{20,})\//, /cdn-widgetsrepository\.yotpo\.com\/v1\/loader\/([A-Za-z0-9]{20,})/, /(?:yotpo_?app_?key|yotpoStoreId|appKey)\\?["']?\s*[:=]\s*\\?["']([A-Za-z0-9]{20,})/i) };
  if (/okendo\.io|data-oke-/i.test(h)) return { app: 'okendo', key: m(/subscriberId\\?["']?\s*[:=]\s*\\?["']([0-9a-f-]{36})/i, /okendo[^"']*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) };
  if (/stamped\.io|stamped-main-(badge|widget)|stamped-reviews/i.test(h)) return { app: 'stamped', key: m(/data-api-key=["']([\w-]+)["']/, /stamped[^"']*apiKey["']?\s*[:=]\s*["']([\w-]+)/i), store: m(/data-store-url=["']([\w.-]+)["']/) || shop };
  return null; };

/* ---------- normalizers: one raw row from a source → one item (pure, so tests run them on fixtures) ---------- */
// ctx: { q: 'brand'|'rival'|'category'|'owned', acct: 'own'|'rival'|undefined, thread fields for comments }
export const NORM = {
  tiktokVideo: (a, q) => { const u = a.author || {}, s = a.statistics || {}, link = `https://www.tiktok.com/@${u.unique_id || 'user'}/video/${a.aweme_id}`;
    return { id: `tt:${a.aweme_id}`, platform: 'tiktok', kind: 'post', link, postedAt: ms(a.create_time), author: short(u.nickname || u.unique_id), text: clip(a.desc), likes: s.digg_count || 0, replies: s.comment_count ?? null,
      sub: u.unique_id ? `@${u.unique_id}` : 'TikTok', subUrl: u.unique_id ? `https://www.tiktok.com/@${u.unique_id}` : null, thread: `tt-${a.aweme_id}`, threadTitle: firstLine(a.desc), threadUrl: link, q }; },
  tiktokComment: (cm, v) => ({ id: `tt:c${cm.cid}`, platform: 'tiktok', kind: 'comment', link: v.threadUrl, postedAt: ms(cm.create_time), author: short(cm.user?.nickname || cm.user?.unique_id), text: clip(cm.text), likes: cm.digg_count || 0, replies: cm.reply_comment_total ?? null,
    sub: v.sub, subUrl: v.subUrl, thread: v.thread, threadTitle: v.threadTitle, threadUrl: v.threadUrl, q: v.q, acct: v.acct }),
  igReel: (r, q) => ({ id: `ig:${r.shortcode || r.id}`, platform: 'instagram', kind: 'post', link: r.url || `https://www.instagram.com/reel/${r.shortcode}/`, postedAt: ms(r.createdUtc), author: short(r.displayName || r.username), text: clip(r.caption), likes: r.likes || 0, replies: r.comments ?? null,
    sub: r.username ? `@${r.username}` : 'Instagram', subUrl: r.username ? `https://www.instagram.com/${r.username}/` : null, thread: `ig-${r.shortcode || r.id}`, threadTitle: firstLine(r.caption), threadUrl: r.url || `https://www.instagram.com/reel/${r.shortcode}/`, q }),
  igHashtag: (n, q) => { const cap = n.edge_media_to_caption?.edges?.[0]?.node?.text || n.caption || '', url = `https://www.instagram.com/p/${n.shortcode}/`;
    return { id: `ig:${n.shortcode || n.id}`, platform: 'instagram', kind: 'post', link: url, postedAt: ms(n.taken_at_timestamp || n.taken_at), author: short(n.owner?.username || 'Instagram user'), text: clip(cap), likes: n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0, replies: n.edge_media_to_comment?.count ?? null,
      sub: n.owner?.username ? `@${n.owner.username}` : 'Instagram', thread: `ig-${n.shortcode || n.id}`, threadTitle: firstLine(cap), threadUrl: url, q }; },
  igComment: (cm, v) => ({ id: `ig:c${cm.id}`, platform: 'instagram', kind: 'comment', link: v.threadUrl, postedAt: ms(cm.createdUtc), author: short(cm.author), text: clip(cm.text), likes: cm.likes || 0,
    sub: v.sub, subUrl: v.subUrl, thread: v.thread, threadTitle: v.threadTitle, threadUrl: v.threadUrl, q: v.q, acct: v.acct }),
  ytComment: (cm, v, now) => ({ id: `yt:${cm.comment_id}`, platform: 'youtube', kind: 'comment', link: cm.url || `https://www.youtube.com/watch?v=${v.id}&lc=${cm.comment_id}`, postedAt: ms(cm.published_date || cm.published, now), author: short(cm.author?.name || cm.author), text: clip(cm.text), likes: cm.likes || 0, replies: cm.replies ?? null,
    sub: v.channel, subUrl: v.channelUrl || null, thread: `yt-${v.id}`, threadTitle: v.title, threadUrl: `https://www.youtube.com/watch?v=${v.id}`, q: v.q, acct: v.acct }),
  redditApp: (p, q) => { const id = String(p.id || '').replace(/^t3_/, ''), sub = p.subreddit?.prefixedName || (p.subreddit?.name ? `r/${p.subreddit.name}` : '');
    return { id: `rd:t3_${id}`, platform: 'reddit', kind: 'post', link: p.permalink ? `https://www.reddit.com${p.permalink}` : p.url, postedAt: ms(p.createdAt), author: short(p.authorInfo?.name), title: unesc(p.postTitle), text: clip(p.content?.markdown), sub, likes: p.score || 0, replies: p.commentCount ?? null, floor: false, thread: id, threadTitle: unesc(p.postTitle), q }; },
  redditAppComment: (n, v) => ({ id: `rd:t1_${String(n.id).replace(/^t1_/, '')}`, platform: 'reddit', kind: 'comment', link: n.permalink ? `https://www.reddit.com${n.permalink}` : v.threadUrl, postedAt: ms(n.createdAt), author: short(n.authorInfo?.name), text: clip(n.content?.markdown || n.content?.preview), sub: v.sub, likes: n.score || 0, replies: null, thread: v.thread, threadTitle: v.threadTitle, threadUrl: v.threadUrl, q: v.q }),
  redditComment: (d, v) => ({ id: `rd:t1_${d.id}`, platform: 'reddit', kind: 'comment', link: `https://www.reddit.com${d.permalink || ''}`, postedAt: ms(d.created_utc), author: short(d.author), text: clip(d.body), sub: `r/${d.subreddit}`, likes: d.score || 0, replies: null, thread: v.thread, threadTitle: v.threadTitle, threadUrl: v.threadUrl, q: v.q }),
  threadsPost: (p, q) => ({ id: `th:${p.pk || p.id}`, platform: 'threads', kind: 'post', link: p.url || `https://www.threads.com/@${p.user?.username}/post/${p.code}`, postedAt: ms(p.taken_at), author: short(p.user?.full_name || p.user?.username), text: clip(p.caption?.text ?? p.caption), likes: p.like_count || 0,
    replies: p.text_post_app_info?.direct_reply_count ?? null, sub: p.user?.username ? `@${p.user.username}` : 'Threads', thread: `th-${p.pk || p.id}`, threadUrl: p.url, q }),
  linkedinPost: (p, q) => ({ id: `li:${p.id}`, platform: 'linkedin', kind: 'post', link: p.url, postedAt: ms(p.createdUtc), author: short(p.authorName), text: clip(p.text), likes: p.reactionCount || 0, replies: p.commentCount ?? null, sub: 'LinkedIn', thread: `li-${p.id}`, threadUrl: p.url, q }),
  pin: (p, q) => ({ id: `pin:${p.id}`, platform: 'pinterest', kind: 'post', link: p.url || `https://www.pinterest.com/pin/${p.id}/`, postedAt: ms(p.created_at), author: short(p.pinner?.full_name || p.pinner?.username), title: unesc(p.title || p.grid_title || ''), text: clip(p.description || p.auto_alt_text), likes: p.reaction_counts?.['1'] || 0, sub: p.board?.name || 'Pinterest', q }),
  telegram: (m, ch, q) => ({ id: `tg:${ch}:${m.id ?? m.message_id}`, platform: 'telegram', kind: 'post', link: m.url || m.link || `https://t.me/${ch}/${m.id ?? m.message_id}`, postedAt: ms(m.date || m.datetime || m.time), author: short(m.author || ch), text: clip(m.text || m.message || m.content), likes: m.views || 0, sub: `t.me/${ch}`, subUrl: `https://t.me/${ch}`, q }),
  fbPost: (p, v) => ({ id: `fb:${p.id}`, platform: 'facebook', kind: 'post', link: p.url, postedAt: ms(p.posted), author: short(p.page_name), text: clip(p.text), likes: p.reactions || 0, replies: p.comments ?? null, sub: p.page_name || v.page, subUrl: v.pageUrl, thread: `fb-${p.id}`, threadTitle: `${p.page_name || v.page}: ${firstLine(p.text, 70)}`, threadUrl: p.url, q: v.q, acct: v.acct }),
  fbComment: (cm, v) => ({ id: `fb:c${cm.id}`, platform: 'facebook', kind: 'comment', link: v.threadUrl, postedAt: ms(cm.created_at), author: short(cm.author?.name), text: clip(cm.text), likes: cm.reaction_count || 0, replies: cm.reply_count ?? null, sub: v.sub, subUrl: v.subUrl, thread: v.thread, threadTitle: v.threadTitle, threadUrl: v.threadUrl, q: v.q, acct: v.acct }),
  xPost: (p, q) => ({ id: `x:${p.id}`, platform: 'x', kind: p.isReply ? 'comment' : 'post', link: p.url, postedAt: ms(p.createdUtc), author: short(p.authorName || p.authorUsername), text: unesc(p.text).replace(/https?:\/\/t\.co\/\w+/g, '').trim().slice(0, 800), likes: p.likeCount || 0, replies: p.replyCount ?? null, thread: `x-${p.conversationId || p.id}`, threadUrl: p.url, q }),
  trustpilot: (r, v) => ({ id: `tp:${r.review_id}`, platform: 'trustpilot', kind: 'review', link: r.url || `https://www.trustpilot.com/review/${v.domain}`, postedAt: ms(r.date), author: short(r.author), rating: +r.rating || null, title: unesc(r.title), text: clip(r.text), likes: r.likes || 0, product: v.domain, sub: v.domain, q: v.q, acct: v.acct }),
  gmaps: (r, v) => ({ id: `gm:${r.review_id}`, platform: 'google', kind: 'review', link: r.link || v.url, postedAt: ms(r.iso_date || r.date), author: short(r.user?.name || r.author), rating: +r.rating || null, text: clip(r.snippet || r.text || r.extracted_snippet?.original), likes: r.likes || 0, product: v.name, sub: v.name, q: 'brand' }),
  walmart: (r, v) => ({ id: `wm:${r.id || `${v.id}:${String(r.text).slice(0, 30)}`}`, platform: 'walmart', kind: 'review', link: `${v.url}#item-reviews`, postedAt: ms(r.date), author: short(r.author || 'Walmart customer'), rating: +r.rating || null, title: unesc(r.title || ''), text: clip(r.text), product: v.title, q: 'brand' }),
  news: (r, q) => ({ id: `nw:${hostOf(r.url)}:${String(r.url).replace(/^https?:\/\/[^/]+/, '').slice(0, 120)}`, platform: 'news', kind: 'article', link: r.url, postedAt: ms(r.date), author: short(r.publisher || r.site_name || hostOf(r.url)), title: unesc(r.title), text: clip(r.snippet), sub: r.publisher || r.site_name || hostOf(r.url), subUrl: r.url ? `https://${hostOf(r.url)}` : null, q }),
  web: (r, q) => ({ id: `web:${hostOf(r.url)}:${String(r.url).replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0].slice(0, 120)}`, platform: 'web', kind: 'page', link: String(r.url).split('?srsltid')[0], postedAt: ms(r.date), author: short(hostOf(r.url)), title: unesc(r.title), text: clip(r.snippet || r.description), sub: hostOf(r.url), subUrl: r.url ? `https://${hostOf(r.url)}` : null, q }),
  // a public post that tags or @mentions the brand (Apify dami_studio/instagram-mentions-scraper): the customer's own words and picture
  igTagged: (r, v) => ({ id: `ig:${r.shortCode || r.postId}`, platform: 'instagram', kind: 'post', link: r.url, postedAt: ms(r.timestamp), author: short(r.ownerUsername ? `@${r.ownerUsername}` : 'Instagram user'), text: clip(r.caption || ''),
    likes: r.likesCount || 0, replies: r.commentsCount ?? null, sub: r.ownerUsername ? `@${r.ownerUsername}` : 'Instagram', subUrl: r.ownerUsername ? `https://www.instagram.com/${r.ownerUsername}/` : null, thread: `ig-${r.shortCode || r.postId}`,
    threadTitle: firstLine(r.caption || ''), threadUrl: r.url, image: r.displayUrl || null, tagged: r.mentionType || 'tagged', q: 'brand', acct: v.acct }),
  // marketplace reviews from Apify actors or a page read: the field names differ by actor, so read the usual ones
  review: (r, v) => { const text = r.text || r.review || r.reviewText || r.review_text || r.description || r.body || r.comment || r.content || '';
    const id = r.id || r.review_id || r.reviewId || `${v.pid || ''}:${String(text).slice(0, 40)}`;
    return { id: `${v.platform}:${id}`, platform: v.platform, kind: 'review', link: r.url || r.reviewUrl || v.url, postedAt: ms(r.date || r.createdAt || r.created_at || r.reviewDate || r.review_date || r.time, v.now), author: short(r.author || r.name || r.userName || r.user_name || r.reviewerName || r.customer || `${sourceName(v.platform).split(' ')[0]} customer`),
      rating: +(r.rating || r.stars || r.star || r.ratingValue) || null, title: unesc(r.title || r.reviewTitle || r.heading || ''), text: clip(text), product: v.title || null, q: v.q || 'brand', acct: v.acct }; },
  // the brand's own review apps (the site source): Yotpo, Okendo and Stamped feeds
  yotpo: (r, v) => ({ id: `site:yotpo:${r.id}`, platform: 'site', kind: 'review', link: v.url, postedAt: ms(r.created_at), author: short(r.user?.display_name || 'Customer'), rating: +r.score || null, title: unesc(r.title || ''), text: clip(r.content), product: v.title || null, q: 'brand' }),
  okendo: (r, v) => ({ id: `site:oke:${r.reviewId}`, platform: 'site', kind: 'review', link: r.productUrl ? `https:${String(r.productUrl).replace(/^https?:/, '')}` : v.url, postedAt: ms(r.dateCreated), author: short(r.reviewer?.displayName || 'Customer'), rating: +r.rating || null, title: unesc(r.title || ''), text: clip(r.body), product: unesc(r.productName || '') || null, q: 'brand' }),
  stamped: (r, v) => ({ id: `site:stamped:${r.id}`, platform: 'site', kind: 'review', link: r.productUrl || v.url, postedAt: ms(r.reviewDate || r.dateCreated), author: short(r.author || 'Customer'), rating: +r.reviewRating || null, title: unesc(r.reviewTitle || ''), text: clip(r.reviewMessage), product: unesc(r.productName || '') || null, q: 'brand' })
};
// Loox draws reviews as HTML: one block per review (data-id), the words in .main-text / .pre-wrap, the name in .title, stars as icons
export const looxReviews = (html, v) => String(html || '').split(/(?=<div[^>]*\bdata-id=["'])/).map((b) => { const g = (re) => unesc((b.match(re) || [])[1] || '');
  const id = (b.match(/data-id=["']([\w-]+)["']/) || [])[1], text = g(/class=["'][^"']*\b(?:main-text|pre-wrap)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/), stars = (b.match(/loox-icon--star\b(?!-)/g) || []).length;
  return id && text ? { id: `site:loox:${id}`, platform: 'site', kind: 'review', link: v.url, postedAt: ms(g(/class=["'][^"']*\btime\b[^"']*["'][^>]*>([\s\S]*?)<\//), v.now), author: short(g(/class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\//) || 'Customer'), rating: +(b.match(/data-rating=["'](\d)/) || [])[1] || (stars >= 1 && stars <= 5 ? stars : null), title: '', text: text.slice(0, 800), product: v.title || null, q: 'brand' } : null; }).filter(Boolean);
export function createListenWatch({ slug, packs, treg, ai, apify = undefined, log = console, now = Date.now }) {
  const P = (name) => `listen/${name}.json`;
  const S = { busy: false };
  if (apify === undefined) apify = createApify({ log });

  /* ---------- the brand's own accounts and rivals' pages, read fresh from the pack each run (no Claude call) ---------- */
  async function extrasOf(c) {
    const profile = await packs.getJSON(slug, 'profile.json', {}) || {}, so = profile.socials || {};
    const igPosts = (so.instagram?.posts || []).filter((p) => p?.url).sort((a, b) => (b.comments || 0) - (a.comments || 0)).map((p) => ({ url: p.url, caption: p.caption || '', comments: p.comments ?? null }));
    const ytVids = (so.youtube?.videos || []).map((v) => ({ id: (String(v.url || '').match(/[?&]v=([\w-]{6,})/) || [])[1] || v.id, title: unesc(v.title || ''), url: v.url })).filter((v) => v.id);
    const tg = [so.telegram?.handle, (String(so.telegram?.url || '').match(/t\.me\/([\w]+)/) || [])[1], ...(profile.telegram || [])].filter(Boolean);
    const rivalHosts = [...new Set((profile.rivals || []).map((r) => r?.host).filter(Boolean))].slice(0, 5);
    const rivalPages = (profile.ads?.rivals || []).filter((r) => r?.name).map((r) => ({ name: r.name, page: r.page || r.name, pageUrl: r.pageUrl || null }));
    const mk = JSON.stringify(profile.marketplaces || []) + JSON.stringify(profile.reviews || {});
    return { igPosts, ytVids, ytChannel: so.youtube?.url || null, fbUrl: so.facebook?.url || null, tiktok: (String(so.tiktok?.url || '').match(/@([\w.]+)/) || [])[1] || null, telegram: [...new Set(tg)], rivalHosts, rivalPages,
      india: c.country === 'IN' || /nykaa|flipkart|myntra/i.test(mk), us: c.country === 'US' || /walmart/i.test(mk) };
  }

  /* ---------- config: who we listen for, built from the pack once ---------- */
  // indirect searches: the problems and needs that lead buyers to the category, and the questions they ask before buying.
  // Questions come first from Google's autocomplete (real searches, $0.001 a call, only when paid reads are on), then from Claude.
  async function indirect(c, profile, o = {}) {
    let f = null;
    if (ai && ai.live !== false) { try {
      const r = await ai.call({ model: 'sonnet', max: 1200, tag: `listen-indirect-${slug}`,
        system: 'You set up social listening for a consumer brand. Be literal: these searches find real people describing a need, not ads.',
        prompt: `Brand: ${c.name} (${c.host}), ${marketShort({ country: c.country, registeredCountry: profile?.registeredCountry })}. Category: ${c.category || 'unknown'}. Product noun: ${c.noun}. About: ${String(profile?.about || profile?.tagline || '').slice(0, 300)}\nBest sellers: ${(c.products || []).join('; ') || 'unknown'}\n\nReturn:\n- problems: 3-5 short unbranded searches a person with the problem or need this category solves would type, in their words (e.g. "foot pain all day sneakers", "shoes for standing all day"). No brand names.\n- questions: 3-5 unbranded questions buyers in ${c.country} ask before buying in this category (e.g. "are wool sneakers good for summer").\n- needs: 5-12 lowercase words or short phrases that show a post talks about one of those problems or needs (e.g. "foot pain", "standing all day", "plantar fasciitis").`,
        schema: { type: 'object', properties: { problems: { type: 'array', items: { type: 'string' } }, questions: { type: 'array', items: { type: 'string' } }, needs: { type: 'array', items: { type: 'string' } } } } });
      f = r.json; runCost.cfgAi += r.usd || 0;
    } catch (e) { log.warn?.('[listen] indirect terms', slug, e.message); } }
    const auto = [];
    if (o.paid !== false && treg?.live) await each([`is ${c.name}`, `does ${c.name}`, `which ${c.noun}`, `are ${c.noun}`], async (q) => { const j = await tcall('serper.google.serp.autocomplete', { body: { q, gl: c.country.toLowerCase(), hl: 'en' } }, o.capUsd ?? RUN_CAP());
      for (const sg of (j?.suggestions || []).slice(0, 3)) { const v = String(sg?.value || '').trim(); if (v.split(/\s+/).length >= 3 && v.toLowerCase() !== q.toLowerCase()) auto.push(v); } }, { notes: [] }, 2);
    const clean = (xs) => [...new Set((xs || []).map((x) => String(x).replace(/"/g, '').trim()).filter((x) => x.length >= 6 && x.split(/\s+/).length <= 8))];
    const problems = clean(f?.problems).slice(0, 5), questions = clean([...auto.slice(0, 3), ...(f?.questions || [])]).slice(0, 5);
    return { problems: problems.length ? problems : [`best ${c.noun} for everyday`, `${c.noun} recommendations`], questions: questions.length ? questions : [`which ${c.noun} should I buy`, `are ${c.name} ${c.noun} worth it`],
      needs: [...new Set((f?.needs || []).map((x) => String(x).toLowerCase().trim()).filter((x) => x.length >= 4))].slice(0, 12), by: f ? 'claude' : 'fallback', auto: auto.length };
  }
  const hasIndirect = (c) => Array.isArray(c?.terms?.problems) && Array.isArray(c?.terms?.questions) && (c.terms.indirectBy === 'claude' || !ai || ai.live === false);
  const withIndirect = (c, ind) => ({ ...c, terms: { ...c.terms, problems: ind.problems, questions: ind.questions, indirectBy: ind.by, indirectAt: now() }, filter: { ...c.filter, needs: ind.needs } });
  async function config({ fresh = false, paid = true, capUsd } = {}) {
    const old = await packs.getJSON(slug, P('config'), null);
    /* what the config was built from (the market, the name, the rivals, the category): a brand corrected later (a US default
       fixed to India, rivals edited on the check page) gets a new config, never the stale one for good */
    const pr0 = await packs.getJSON(slug, 'profile.json', {}) || {}, pc0 = await packs.getJSON(slug, 'config.json', {}) || {};
    const basis = JSON.stringify([String(pr0.country || pc0.country || '').toUpperCase(), pr0.name || '', (pr0.rivals || []).map((r) => r?.name || r).slice(0, 8), pc0.category || pr0.subcategory || pr0.category || '']);
    if (old && old.v === CFG_V && !fresh && old.basis && old.basis !== basis) fresh = true;
    if (old && old.v === CFG_V && !fresh && (old.filter?.by === 'claude' || !ai?.live)) {
      if (!old.basis) { old.basis = basis; await packs.put(slug, P('config'), old); } /* a config from before this check: its basis is today's */
      if (hasIndirect(old)) return old;
      // a config from before the indirect searches gets them on its next run (no rebuild)
      const c = withIndirect(old, await indirect(old, await packs.getJSON(slug, 'profile.json', {}) || {}, { paid, capUsd }));
      await packs.put(slug, P('config'), c); return c;
    }
    const profile = await packs.getJSON(slug, 'profile.json', {}) || {}, pc = await packs.getJSON(slug, 'config.json', {}) || {}, seed = await packs.getJSON(slug, 'seed.json', {}) || {};
    const name = profile.name || seed.brand?.name || slug, host = profile.host || seed.brand?.host || slug.replace(/-/g, '.');
    const country = String(profile.country || pc.country || 'US').toUpperCase();
    const category = [pc.category, profile.subcategory, profile.category, profile.descriptor].find((x) => x && String(x).trim()) || '';
    const prods = profile.catalog?.products || [], byHandle = new Map(prods.map((p) => [p.handle, p]));
    const real = (p) => p?.title && !/gift ?(wrap|card)|shipping|insurance|sample|demo/i.test(p.title) && +p.price !== 0;
    const products = [...new Set([...[profile.catalog?.hero, profile.catalog?.order].filter(Array.isArray).flat().map((h) => byHandle.get(h?.handle || h)), ...prods].filter(real).map((p) => p.title))].slice(0, 3);
    const rivals = [...new Set([...(pc.rivals || []), ...(profile.rivals || []).map((r) => r?.name || r)].filter((x) => typeof x === 'string' && x.trim()))].slice(0, 5);
    const catTerms = [...new Set([...(pc.rising || []), ...(pc.terms || []).flat(), pc.listingTerm].filter(Boolean))];
    const myshopify = (JSON.stringify(profile.reviews || {}).match(/([\w-]+\.myshopify\.com)/) || JSON.stringify(profile).match(/([\w-]+\.myshopify\.com)/) || [])[1] || null;
    const ig = profile.socials?.instagram?.handle || null, xh = (profile.socials?.x?.url?.match(/(?:twitter|x)\.com\/(\w+)/i) || [])[1] || null;
    // the filter and the search words: one cheap Claude call, cached with the config
    let f = null, usd = 0;
    if (ai?.live !== false) { try {
      const r = await ai.call({ model: 'sonnet', max: 2000, tag: `listen-config-${slug}`,
        system: 'You set up social listening for a consumer brand. Be literal and conservative: these words decide which public posts count.',
        prompt: `Brand: ${name} (${host}), ${profile.country || pc.country ? `country ${country}` : 'selling market not confirmed yet'}. Category: ${category || 'unknown'}. About: ${String(profile.about || profile.tagline || '').slice(0, 300)}\nBest sellers: ${products.join('; ') || 'unknown'}\nRivals: ${rivals.join(', ') || 'none known'}\nCategory searches people use: ${catTerms.slice(0, 5).join('; ') || 'none known'}\n\nReturn:\n- strong: 1-4 ways people write the brand that can only mean this brand (e.g. the domain, "<brand> <product noun>").\n- weak: 0-3 short names that also mean other things (e.g. "${name}" if it is a common word), lowercase.\n- must: 8-15 lowercase words that show a post is about this category (product nouns, uses, problems), so a weak name only counts next to one of them.\n- junk: 5-12 lowercase words that show the other meanings of the name or sales spam (other products, places, people, deals).\n- brandQueries: 2-4 Reddit search queries that find people talking about the brand (short, quote multi-word names).\n- categoryQueries: 1-2 unbranded searches real buyers in ${country} type when choosing in this category.\n- noun: the one plain product noun (e.g. "sneakers", "serum").`,
        schema: { type: 'object', properties: { strong: { type: 'array', items: { type: 'string' } }, weak: { type: 'array', items: { type: 'string' } }, must: { type: 'array', items: { type: 'string' } }, junk: { type: 'array', items: { type: 'string' } }, brandQueries: { type: 'array', items: { type: 'string' } }, categoryQueries: { type: 'array', items: { type: 'string' } }, noun: { type: 'string' } } } });
      f = r.json; usd = r.usd || 0;
    } catch (e) { log.warn?.('[listen] config filter', slug, e.message); } }
    const noun = f?.noun || String(category).split(/[,/]/).pop().trim().toLowerCase() || 'products';
    const lc = (xs) => (xs || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
    const strong = [...new Set([host.toLowerCase(), host.split('.')[0].toLowerCase(), ...lc(f?.strong).map((x) => x.replace(/"/g, ''))])].filter((x) => x.length >= 4);
    const weak = [...new Set([name.toLowerCase(), ...lc(f?.weak)])];
    const must = [...new Set([...lc(f?.must), ...lc(String(category).split(/[,/&]| and /)), noun])].filter((x) => x.length >= 3);
    const terms = {
      brand: [...new Set([...(f?.brandQueries || []), `"${name}" ${noun}`, host])].slice(0, 5),
      products: products.map((t) => t.replace(new RegExp(`^\\W*${escRe(name)}\\s*`, 'i'), '').trim()).filter(Boolean).map((t) => `"${name}" ${t.split(/\s+/).slice(0, t.split(/\s+/)[0].length < 4 ? 2 : 1).join(' ')}`).filter((q, i, a) => a.indexOf(q) === i).slice(0, 2),
      rivals: rivals.slice(0, 3).map((r) => `"${r}" ${noun}`),
      category: [...new Set([...(f?.categoryQueries || []), ...catTerms])].slice(0, 2)
    };
    runCost.cfgAi += usd;
    const base = { v: CFG_V, at: now(), basis, slug, name, host, country, category, noun, products, rivals, terms, myshopify, reviewApp: profile.reviews?.app || null, instagram: ig, xHandle: xh,
      amazon: AMAZON[country] || AMAZON.US, filter: { strong, weak, must, junk: lc(f?.junk), rivals: lc(rivals), by: f ? 'claude' : 'fallback' }, usd };
    const c = withIndirect(base, await indirect(base, profile, { paid, capUsd }));
    await packs.put(slug, P('config'), c);
    return c;
  }

  /* ---------- relevance: deterministic, from the cached filter (Claude's tag pass is the second gate) ---------- */
  /* a brand's bare one-word name ("arata", "comet") is also a person, a show or a word: alone it is weak and needs a category
     word nearby. Only a phrase ("arata serum") or the domain ("arata.in") is strong. Applies to every saved filter on load */
  /* the brand's own product words count as context too ("arata mitoactive journey"), never its name or a unit */
  const productWords = (c) => { const nm = new Set(String(c.name || '').toLowerCase().split(/[^a-z0-9]+/)); return [...new Set((c.products || []).flatMap((p) => String(p).toLowerCase().replace(/[™®]/g, '').split(/[^a-z]+/)).filter((w) => w.length >= 4 && !nm.has(w) && !/^(with|from|pack|size|combo|free|new|best)$/.test(w)))]; };
  const oneWord = (x) => !/[\s.]/.test(String(x).replace(/"/g, '').trim());
  const filterOf = (c) => ({ strong: wordsRe((c.filter.strong || []).filter((x) => !oneWord(x))), weak: wordsRe([...(c.filter.weak || []), ...(c.filter.strong || []).filter(oneWord)]), must: wordsRe([...(c.filter.must || []), ...productWords(c)]), junk: wordsRe(c.filter.junk), rivals: wordsRe(c.filter.rivals), needs: wordsRe(c.filter.needs) });
  // an item saved as "about the brand" that today's filter would not keep (a namesake, an anime) leaves on read
  const onTopic = (F, x) => !F || x.about !== 'brand' || guess(F, x) === 'brand';
  // does a search hit fit what it was searched for: the brand by name, a rival, or the category and its problems
  const fits = (F, kind, t) => (kind === 'rival' ? F.rivals.test(t) : kind === 'brand' ? F.strong.test(t) || (F.weak.test(t) && F.must.test(t)) : F.must.test(t) || F.needs.test(t));
  const guess = (F, x) => {
    if (x.mode === 'asked') return x.about || 'category';
    if (SPAM_TXT.test(x.text || '') || (x.kind === 'comment' && BARE(x.text))) return null;
    // what people say on the brand's own posts is about the brand; on a rival's posts, about the rival
    if (x.acct === 'own' || x.q === 'owned') return 'brand';
    if (x.acct === 'rival') return 'rival';
    if (REVIEW.has(x.platform)) return x.q === 'rival' ? 'rival' : INDIRECT_Q.has(x.q) ? 'category' : 'brand';
    const t = `${x.title || ''} ${x.text || ''} ${x.threadTitle || ''}`;
    if (DEAL_SUB.test(x.sub || '') || DEAL_TXT.test(x.text || '')) return null;
    if (F.junk.test(t) && !F.strong.test(t)) return null;
    const ctx = F.must.test(t);
    if (F.strong.test(t) || (F.weak.test(t) && ctx)) return 'brand';
    // a comment under a video or post a brand search found, whose own title names the brand, is about the brand
    if (x.kind === 'comment' && x.q === 'brand' && (F.strong.test(x.threadTitle || '') || F.weak.test(x.threadTitle || ''))) return 'brand';
    if (F.rivals.test(t) && ctx) return 'rival';
    if (INDIRECT_Q.has(x.q) && (ctx || F.needs.test(t))) return 'category';
    return null;
  };

  /* ---------- sources ---------- */
  const queries = (c) => [...c.terms.brand.map((q) => [q, 'brand']), ...c.terms.products.map((q) => [q, 'brand']), ...c.terms.rivals.map((q) => [q, 'rival']), ...c.terms.category.map((q) => [q, 'category']),
    ...onCat(c, c.terms.problems).map((q) => [q, 'problem']), ...onCat(c, c.terms.questions).map((q) => [q, 'question'])];
  /* a problem or question search names the category or a need ("does arata die in my happy marriage" names neither) */
  const onCat = (c, qs) => { if (!c.filter) return qs || []; const F = filterOf(c); return (qs || []).filter((q) => F.must.test(q) || F.needs.test(q) || F.rivals.test(q)); };
  // a bounded slice of the query set for paid sources: the first n brand (and product), rival, category and problem searches
  const pick = (c, n = MIX) => { const k = {}; return queries(c).filter(([q, kind]) => !/^[\w-]+(\.[a-z]{2,})+$/i.test(q) && (k[kind] = (k[kind] || 0) + 1) <= (n[kind] ?? 0)); };
  const bare = (q) => String(q).replace(/"/g, '').trim();
  const runCost = { start: 0, apify: 0, cfgAi: 0 };
  const spent = () => (treg?.meter?.usd || 0) - runCost.start + (apify?.meter?.usd || 0) - runCost.apify;
  const tcall = async (id, o, cap) => { if (!treg?.live) throw new Error('needs treg (TREG_TOKEN)'); if (spent() >= cap) throw new Error(`skipped: per-run cap $${cap} reached`); return treg.call(id, { ...o, tag: `listen-${slug}` }); };
  const acall = async (actor, input, o, cap) => { if (!apify?.live) throw Object.assign(new Error('needs APIFY_TOKEN'), { needs: true }); if (spent() >= cap) throw new Error(`skipped: per-run cap $${cap} reached`); return apify.run(actor, input, { ...o, tag: `listen-${slug}` }); };
  // run fn over xs, n at a time; one failure is a note, a cap stops the rest (and so does a source that ran out of time: st.stop)
  const each = async (xs, fn, st, n = 3) => { const q = [...xs]; let stop = false;
    await Promise.all(Array.from({ length: n }, async () => { while (q.length && !stop && !st.stop) { const x = q.shift(); try { await fn(x); } catch (e) { st.notes.push(e.message.slice(0, 160)); if (capHit(e)) stop = true; } } })); };

  async function reddit(c, o, st) {
    const out = (st.partial = []), qs = queries(c).filter(([, kind]) => !o.lite || kind !== 'question');
    let rssOk = 0, rssFail = 0, ppOk = 0, paidN = 0, pp429 = 0, ppOff = false; const pace = o.pace ?? 1, nap = (t) => sleep(t * pace);
    // the paid Reddit search ($0.001 a call, capped): stands in when the feed or PullPush keep refusing
    const paid = async (q, kind) => { if (o.paid === false || paidN >= (o.fallbackCalls ?? 12)) return; paidN++;
      try { const j = await tcall('tikhub.x.reddit-app-fetch-dynamic-search', { query: { query: bare(q), search_type: 'post', sort: 'RELEVANCE', time_range: o.lite ? 'month' : 'year', safe_search: 'unset', allow_nsfw: '0', need_format: 'true' } }, o.capUsd);
        for (const ch of j?.data?.children || []) if (ch?.post?.id) out.push(NORM.redditApp(ch.post, kind)); }
      catch (e) { st.notes.push(`reddit paid search: ${e.message.slice(0, 120)}`); if (capHit(e)) paidN = Infinity; } };
    for (const [q, kind] of qs) { if (st.stop) break; const paidBefore = paidN;
      // Reddit's own search feed: the newest posts, for the brand's own searches only (it rate-limits hard).
      // After two refusals the feed is not asked again this run: the paid search answers at once.
      if (kind === 'brand') { if (rssFail >= 2) await paid(q, kind);
        else try { const rss = await getRetry(`https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}&sort=new&limit=100&t=year`, 'text', 20e3, 3e3 * pace);
          for (const e of rss.split('<entry>').slice(1)) { const g = (t) => (e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '';
            const link = (e.match(/<link href="([^"]+)"/) || [])[1] || '', title = unesc(g('title')), body = unesc(unesc(g('content'))).replace(/submitted by .*$/i, '').replace(/\[link\]\s*\[comments\]\s*$/i, '').trim();
            const tid = threadOf(link); if (!tid) continue;
            out.push({ id: `rd:t3_${tid}`, platform: 'reddit', kind: 'post', link, postedAt: Date.parse(g('updated')) || Date.parse(g('published')) || 0, author: short(unesc(g('name'))), title, text: body.slice(0, 800), sub: `r/${(e.match(/<category term="([^"]+)"/) || [])[1] || ''}`, thread: tid, threadTitle: title, q: kind }); }
          rssOk++; }
        catch (e) { rssFail++; st.notes.push(`reddit feed "${q}": ${e.message}`); await paid(q, kind); } }
      // PullPush: posts with their reply counts, and comments. A 429 waits 3s once; three 429s in a row and the paid search takes over
      if (!ppOff) for (const what of ['submission', 'comment']) {
        try { const j = await getRetry(`https://api.pullpush.io/reddit/search/${what}/?q=${encodeURIComponent(q)}&size=100&sort=desc&sort_type=created_utc`, 'json', 25e3, 3e3 * pace); ppOk++; pp429 = 0;
          for (const x of j.data || []) { if (what === 'submission') { if (x.removed_by_category || x.selftext === '[removed]') continue;
              out.push({ id: `rd:t3_${x.id}`, platform: 'reddit', kind: 'post', link: `https://www.reddit.com${x.permalink}`, postedAt: (x.created_utc || 0) * 1e3, author: short(x.author), title: unesc(x.title), text: unesc(x.selftext).slice(0, 800), sub: `r/${x.subreddit}`, likes: x.score || 0, replies: x.num_comments ?? null, floor: true, thread: x.id, threadTitle: unesc(x.title), q: kind }); } /* PullPush counts the replies when it archived the post (often minutes after it went up): a floor */
            else { if (!x.body || x.body === '[removed]' || x.body === '[deleted]') continue; const tid = String(x.link_id || '').replace(/^t3_/, '') || threadOf(x.permalink);
              out.push({ id: `rd:t1_${x.id}`, platform: 'reddit', kind: 'comment', link: `https://www.reddit.com${x.permalink || ''}`, postedAt: (x.created_utc || 0) * 1e3, author: short(x.author), text: unesc(x.body).slice(0, 800), sub: `r/${x.subreddit}`, likes: x.score || 0, thread: tid, q: kind }); } } }
        catch (e) { st.notes.push(`pullpush ${what} "${q}": ${e.message}`); if (e.status === 429 && ++pp429 >= 3) { ppOff = true; st.notes.push('pullpush kept refusing (429): the paid search reads the rest'); break; } }
        await nap(1200); }
      // PullPush is off: every search gets the paid read (once: not again when the feed's refusal already asked it)
      if (ppOff && paidN === paidBefore) await paid(q, kind);
      await nap(kind === 'brand' ? 2500 : 500); }
    st.detail = { queries: qs.length, feedOk: rssOk, feedRefused: rssFail, pullpushOk: ppOk, pullpushOff: ppOff, paidFallbacks: Number.isFinite(paidN) ? paidN : 'capped' };
    if (!rssOk && !ppOk && !out.length) throw new Error('Reddit and PullPush both refused every search');
    return out;
  }

  /* Google's YouTube API key has a daily quota shared by every brand: once it answers 403/429 the rest of the day goes
     through treg (search and comments), never "YouTube: error" for every brand until midnight Pacific */
  async function youtube(c, o, st, have, ex) {
    const day = new Date(now() - 8 * 36e5).toISOString().slice(0, 10); /* the quota resets at midnight Pacific */
    if (!process.env.YOUTUBE_API_KEY || YT_OUT.day === day) { if (YT_OUT.day === day) st.notes.push('YouTube API quota used up today: read through treg'); return youtubeTreg(c, o, st, ex); }
    const out = await youtubeApi(c, o, st, have, ex);
    if (!out.length && st.notes.some((n) => /\b(403|429)\b|quota/i.test(n))) { YT_OUT.day = day; st.notes = st.notes.filter((n) => !/\b(403|429)\b|quota/i.test(n)); st.notes.push('YouTube API quota used up: read through treg'); st.partial = []; return youtubeTreg(c, o, st, ex); }
    return out;
  }
  async function youtubeApi(c, o, st, have, ex) {
    const K = process.env.YOUTUBE_API_KEY;
    const F = filterOf(c), vids = new Map(), out = (st.partial = []);
    // the brand's searches, then rivals, the category and problems (each video must fit what it was searched for); a light read wants this month's videos
    const after = o.lite ? `&publishedAfter=${new Date(now() - 30 * DAY).toISOString()}` : '';
    await each([...pick(c, o.mix).filter(([, k]) => k === 'brand'), [`${c.name} review`, 'brand'], ...pick(c, o.mix).filter(([, k]) => k !== 'brand')], async ([q, kind]) => { const j = await get(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&order=${o.lite ? 'date' : 'relevance'}&regionCode=${c.country}&q=${encodeURIComponent(bare(q))}${after}&key=${K}`);
      for (const i of j.items || []) { const t = unesc(`${i.snippet.title} ${i.snippet.description}`); if (!vids.has(i.id.videoId) && fits(F, kind, t)) vids.set(i.id.videoId, { id: i.id.videoId, title: unesc(i.snippet.title), channel: unesc(i.snippet.channelTitle), channelId: i.snippet.channelId, q: kind }); } }, st, 2);
    const top = [...vids.values()].sort((a, b) => (b.q === 'brand') - (a.q === 'brand')).slice(0, o.lite ? 4 : 16);
    await each(top, async (v) => { const j = await get(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&order=time&maxResults=${v.q === 'brand' ? 60 : 30}&textFormat=plainText&videoId=${v.id}&key=${K}`);
      for (const t of j.items || []) { const s = t.snippet.topLevelComment.snippet;
        out.push({ id: `yt:${t.id}`, platform: 'youtube', kind: 'comment', link: `https://www.youtube.com/watch?v=${v.id}&lc=${t.id}`, postedAt: Date.parse(s.publishedAt) || 0, author: short(s.authorDisplayName), text: unesc(s.textDisplay).slice(0, 800), likes: s.likeCount || 0, replies: t.snippet.totalReplyCount || 0,
          sub: v.channel, subUrl: `https://www.youtube.com/channel/${v.channelId}`, thread: `yt-${v.id}`, threadTitle: v.title, threadUrl: `https://www.youtube.com/watch?v=${v.id}`, q: v.q }); } }, st, 4);
    st.detail = { videos: vids.size, read: top.length }; return out;
  }
  // no YouTube key: search and comments through treg, on videos that name the brand or a rival, plus the brand's own videos
  async function youtubeTreg(c, o, st, ex) {
    const F = filterOf(c), vids = new Map(), out = (st.partial = []);
    await each([...pick(c, o.mix), [`${c.name} review`, 'brand']], async ([q, kind]) => { const j = await tcall('crawl4ai.youtube.search.videos', { body: { query: bare(q), limit: 10 } }, o.capUsd);
      for (const v of j?.rows || []) { const t = unesc(`${v.title} ${v.description || ''}`); if (!v.video_id || vids.has(v.video_id)) continue; if (!fits(F, kind, t)) continue;
        vids.set(v.video_id, { id: v.video_id, title: unesc(v.title), channel: v.channel, views: v.views || 0, q: kind }); } }, st);
    const own = (ex?.ytVids || []).slice(0, 2).map((v) => ({ id: v.id, title: v.title, channel: c.name, channelUrl: ex.ytChannel, q: 'owned', acct: 'own' }));
    const top = [...own, ...[...vids.values()].sort((a, b) => (b.q === 'brand') - (a.q === 'brand') || b.views - a.views)].slice(0, o.ytVideos ?? 5);
    await each(top, async (v) => { const j = await tcall('crawl4ai.youtube.video.comments', { body: { video: v.id, limit: o.lite ? 20 : 40 } }, o.capUsd); for (const cm of j?.rows || []) if (cm.comment_id && cm.text) out.push(NORM.ytComment(cm, v, now())); }, st);
    st.detail = { videos: vids.size, read: top.length, own: own.length }; return out;
  }

  async function tiktok(c, o, st) {
    const out = (st.partial = []), vids = [];
    await each(pick(c, o.mix), async ([q, kind]) => { const j = await tcall('tikhub.tiktok.search.videos', { query: { keyword: bare(q), count: 12, region: c.country } }, o.capUsd);
      for (const it of j?.data?.search_item_list || j?.data?.aweme_list || []) { const a = it.aweme_info || it; if (!a?.aweme_id) continue; const x = NORM.tiktokVideo(a, kind); out.push(x); vids.push(x); } }, st);
    // comments on the most-discussed videos about the brand (then rivals), a few per run
    const F = filterOf(c), seen = new Set(), top = vids.filter((v) => !seen.has(v.id) && seen.add(v.id) && (v.replies || 0) > 0 && (v.q !== 'brand' || F.strong.test(v.text) || F.weak.test(v.text)))
      .sort((a, b) => (b.q === 'brand') - (a.q === 'brand') || (b.replies || 0) - (a.replies || 0)).slice(0, o.tiktokVideos ?? 4);
    await each(top, async (v) => { const j = await tcall('tikhub.tiktok.video.comments', { query: { aweme_id: v.id.slice(3), count: 30 } }, o.capUsd); for (const cm of j?.data?.comments || []) if (cm.cid && cm.text) out.push(NORM.tiktokComment(cm, v)); }, st);
    st.detail = { videos: vids.length, commentsRead: top.length }; return out;
  }

  async function instagram(c, o, st, have, ex) {
    const out = (st.partial = []), reels = [];
    await each(pick(c, o.mix), async ([q, kind]) => { const j = await tcall('anyapi.instagram.search.reels', { body: { query: bare(q) } }, o.capUsd);
      for (const r of j?.output?.data?.reels || []) { if (!r.shortcode && !r.id) continue; const x = NORM.igReel(r, kind); out.push(x); reels.push(x); } }, st);
    // the brand hashtag (one word)
    const tag = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (tag.length >= 3) try { const j = await tcall('tikhub.x.instagram-v1-fetch-hashtag-posts', { query: { hashtag: tag } }, o.capUsd); const h = j?.data?.data?.hashtag || {};
      for (const e of [...(h.edge_hashtag_to_top_posts?.edges || []), ...(h.edge_hashtag_to_media?.edges || [])]) if (e?.node?.shortcode) out.push(NORM.igHashtag(e.node, 'brand')); } catch (e) { st.notes.push(`hashtag: ${e.message.slice(0, 120)}`); }
    // comments: the brand's own posts first, then the most-discussed reels that name the brand or a rival
    const F = filterOf(c), seen = new Set();
    const own = (ex?.igPosts || []).slice(0, 2).map((p) => ({ thread: `ig-${(p.url.match(/\/(?:p|reel)\/([\w-]+)/) || [])[1] || p.url}`, threadUrl: p.url, threadTitle: firstLine(p.caption), sub: c.instagram ? `@${c.instagram}` : c.name, subUrl: c.instagram ? `https://www.instagram.com/${c.instagram}/` : null, q: 'owned', acct: 'own' }));
    const top = reels.filter((r) => !seen.has(r.id) && seen.add(r.id) && (r.replies || 0) > 0 && (r.q === 'rival' ? F.rivals.test(r.text) : F.strong.test(r.text) || F.weak.test(r.text)))
      .sort((a, b) => (b.q === 'brand') - (a.q === 'brand') || (b.replies || 0) - (a.replies || 0)).slice(0, o.igPosts ?? 3);
    await each([...own, ...top], async (v) => { const j = await tcall('anyapi.instagram.post.comments', { body: { url: v.threadUrl } }, o.capUsd); for (const cm of j?.output?.data?.comments || []) if (cm.id && cm.text) out.push(NORM.igComment(cm, v)); }, st);
    st.detail = { reels: reels.length, commentsRead: own.length + top.length }; return out;
  }

  async function threads(c, o, st) {
    const out = (st.partial = []); await each(pick(c, o.mix), async ([q, kind]) => { const j = await tcall('scrapecreators.x.v1-threads-search', { query: { query: bare(q), trim: true } }, o.capUsd); for (const p of j?.posts || []) if (p?.pk || p?.id) out.push(NORM.threadsPost(p, kind)); }, st); return out;
  }
  async function linkedin(c, o, st) {
    const out = (st.partial = []); await each(pick(c, o.mix), async ([q, kind]) => { const j = await tcall('anyapi.linkedin.search.posts', { body: { query: bare(q), datePosted: 'last-month' } }, o.capUsd); for (const p of j?.output?.data?.posts || []) if (p?.id) out.push(NORM.linkedinPost(p, kind)); }, st); return out;
  }
  async function pinterest(c, o, st) {
    const out = (st.partial = []); await each(pick(c, { ...o.mix, rival: 0 }), async ([q, kind]) => { const j = await tcall('scrapecreators.x.v1-pinterest-search', { query: { query: bare(q), trim: true } }, o.capUsd); for (const p of j?.pins || []) if (p?.id) out.push(NORM.pin(p, kind)); }, st); return out;
  }
  async function telegram(c, o, st, have, ex) {
    if (!ex?.telegram?.length) throw Object.assign(new Error('skipped: no Telegram channel known for the brand'), { needs: true });
    const out = (st.partial = []); await each(ex.telegram.slice(0, 2), async (ch) => { const j = await tcall('tikhub.x.telegram-web-fetch-channel-search', { query: { channel: ch, query: c.name, limit: 30 } }, o.capUsd);
      for (const m of j?.data?.messages || []) if (m && typeof m === 'object') out.push(NORM.telegram(m, ch, 'owned')); }, st); return out;
  }

  // Facebook: comments on the brand's own page posts and on rivals' page posts (rival pages come from the Meta ad library)
  async function facebook(c, o, st, have, ex) {
    const pages = [], out = (st.partial = []);
    if (ex?.fbUrl) pages.push({ page: c.name, pageUrl: ex.fbUrl, q: 'owned', acct: 'own' });
    const F = filterOf(c), rivals = (ex?.rivalPages?.length ? ex.rivalPages : c.rivals.map((r) => ({ name: r, page: r }))).slice(0, o.fbRivals ?? 2);
    await each(rivals, async (r) => { if (r.pageUrl) return void pages.push({ page: r.page, pageUrl: r.pageUrl, q: 'rival', acct: 'rival' });
      const j = await adCall(treg?.live ? { call: (i, x) => tcall(i, x, o.capUsd) } : null, 'scrapecreators.x.v1-facebook-adlibrary-search-ads', { query: { query: r.name, country: c.country, trim: true } });
      const re = wordsRe([r.name, r.page]), hit = (j?.searchResults || []).map((a) => a.snapshot || a).find((s) => s?.page_profile_uri && /facebook\.com/.test(s.page_profile_uri) && re.test(s.page_name || ''));
      if (hit) pages.push({ page: hit.page_name, pageUrl: hit.page_profile_uri, q: 'rival', acct: 'rival' }); }, st);
    const posts = [];
    await each(pages, async (pg) => { const j = await tcall('crawl4ai.facebook.user.posts', { body: { page: pg.pageUrl, limit: 6 } }, o.capUsd);
      for (const p of j?.rows || []) if (p?.id && p.url) { const x = NORM.fbPost(p, pg); out.push(x); posts.push(x); } }, st);
    const top = posts.filter((p) => (p.replies || 0) > 0).sort((a, b) => (b.acct === 'own') - (a.acct === 'own') || (b.replies || 0) - (a.replies || 0)).slice(0, o.fbPosts ?? 4);
    await each(top, async (v) => { const j = await tcall('scrapecreators.x.v1-facebook-post-comments', { query: { url: v.threadUrl } }, o.capUsd); for (const cm of j?.comments || []) if (cm?.id && cm.text) out.push(NORM.fbComment(cm, v)); }, st);
    if (!pages.length) throw Object.assign(new Error('skipped: no Facebook page for the brand or its rivals'), { needs: true });
    st.detail = { pages: pages.map((p) => p.page), commentsRead: top.length }; return out;
  }

  async function trustpilot(c, o, st, have, ex) {
    const doms = [[c.host, 'brand', undefined], ...(ex?.rivalHosts || []).slice(0, o.tpRivals ?? 2).map((h) => [h, 'rival', 'rival'])], out = (st.partial = []);
    await each(doms, async ([domain, q, acct]) => { let n = 0;
      try { const j = await tcall('crawl4ai.trustpilot.business.reviews', { body: { domain, limit: 20 } }, o.capUsd); for (const r of j?.rows || []) if (r.review_id && r.text) { out.push(NORM.trustpilot(r, { domain, q, acct })); n++; } }
      catch (e) { if (capHit(e) || !apify?.live) throw e; st.notes.push(`trustpilot ${domain}: ${e.message.slice(0, 100)}`); }
      /* treg's Trustpilot read succeeds about two times in three: Apify's actor (probed 23 Oct) reads the same page when it came back empty */
      if (!n && apify?.live) { const rs = await acall('memo23/trustpilot-scraper-ppe', { startUrls: [domain], maxItems: 20 }, { startUsd: 0.05, perItemUsd: 0.00075, maxUsd: 0.45, maxItems: 20 }, o.capUsd);
        for (const r of rs) if (r.id && r.text) out.push(NORM.trustpilot({ review_id: r.id, text: r.text, title: r.title, rating: r.rating, date: r.publishedDate, author: r.reviewerName, url: `https://www.trustpilot.com/reviews/${r.id}` }, { domain, q, acct })); } }, st);
    return out;
  }

  // Google Maps reviews of the brand's own stores (a brand with no store has none)
  async function google(c, o, st) {
    const j = await tcall('crawl4ai.google.serp.maps', { body: { query: c.name, limit: 10 } }, o.capUsd), F = filterOf(c);
    const places = (j?.rows || []).filter((p) => p.place_id && (hostOf(p.website) === c.host.replace(/^www\./, '') || F.strong.test(p.name || ''))).sort((a, b) => (b.review_count || 0) - (a.review_count || 0)).slice(0, o.places ?? 2);
    if (!places.length) throw Object.assign(new Error('skipped: no Google Maps places for the brand'), { needs: true });
    const out = (st.partial = []);
    await each(places, async (p) => { const v = { name: p.name, url: p.url || `https://www.google.com/maps/place/?q=place_id:${p.place_id}` };
      let rows = []; try { rows = (await tcall('litescrape.google.maps.reviews', { query: { place_id: p.place_id, num: 20, sort_by: 'newestFirst' } }, o.capUsd))?.reviews || []; } catch (e) { if (capHit(e)) throw e; st.notes.push(`maps ${p.name}: ${e.message.slice(0, 100)}`); }
      if (!rows.length) rows = (await tcall('crawl4ai.google.maps.reviews', { body: { place: p.place_id, limit: 20, sort: 'newest' } }, o.capUsd))?.rows || [];
      for (const r of rows) if ((r.review_id || r.id) && (r.snippet || r.text)) out.push(NORM.gmaps({ ...r, review_id: r.review_id || r.id }, v)); }, st);
    st.detail = { places: places.map((p) => p.name) }; return out;
  }

  // a marketplace's listings for the brand, found by a site search (free)
  const listings = async (c, o, site, re, n = 2) => { const j = await tcall('treg.web.search', { body: { q: `site:${site} ${c.name}`, limit: 10 } }, o.capUsd); const nameRe = new RegExp(escRe(c.name.toLowerCase()).replace(/\s+/g, '[-\\s]?'), 'i');
    return [...new Set((j?.output?.results || []).map((r) => String(r.url || '').split(/[?#]/)[0]).filter((u) => re.test(u) && nameRe.test(u)))].slice(0, n); };
  async function walmart(c, o, st, have, ex) {
    if (!ex?.us) throw Object.assign(new Error('skipped: Walmart is read for US brands'), { needs: true });
    const urls = await listings(c, o, 'walmart.com', /walmart\.com\/ip\/.+\/\d+$/, o.walmartListings ?? 2);
    if (!urls.length) throw Object.assign(new Error('skipped: no Walmart listings found'), { needs: true });
    const out = (st.partial = []);
    await each(urls, async (url) => { const id = url.match(/\/(\d+)$/)[1], j = await tcall('crawl4ai.walmart.product.detail', { body: { product: id } }, o.capUsd), p = j?.rows?.[0] || {};
      for (const r of p.reviews || []) if (r?.text) out.push(NORM.walmart(r, { id, url, title: String(p.title || '').slice(0, 80) })); }, st);
    st.detail = { listings: urls.length }; return out;
  }

  // Indian marketplaces: Apify actors when there is a token, else a structured read of the review page (treg)
  const RSCHEMA = { type: 'object', properties: { title: { type: 'string' }, reviews: { type: 'array', items: { type: 'object', properties: { author: { type: 'string' }, rating: { type: 'number' }, title: { type: 'string' }, text: { type: 'string' }, date: { type: 'string' } } } } } };
  const pageRead = async (c, o, url, platform) => { const j = await tcall('treg.web.extract.structured', { body: { url, schema: RSCHEMA, instruction: `Every customer review shown on this ${sourceName(platform).split(' ')[0]} page: author, star rating, title, review text, date. Only what the page shows; never invent.` } }, o.capUsd);
    const d = j?.output?.data ?? j?.output ?? {}, rows = Array.isArray(d) ? d : d.reviews || []; return rows.filter((r) => r?.text).map((r) => NORM.review(r, { platform, url, title: d.title || null, now: now() })); };
  const india = (ex) => { if (!ex?.india) throw Object.assign(new Error('skipped: not sold in India'), { needs: true }); };
  async function nykaa(c, o, st, have, ex) {
    india(ex); const out = (st.partial = []);
    /* one Apify run finds the brand's Nykaa listings and their verified reviews (probed 23 Oct); the older two-step path is the fallback */
    if (apify?.live) try { const rs = await acall('automation_craft/nykaa-scraper', { searchTerms: [c.name], maxItemsPerSearch: 4, maxItems: 4, includeReviews: true }, { startUsd: 0.006, perItemUsd: 0.0027, maxUsd: 0.2, maxItems: 80 }, o.capUsd), nre = new RegExp(escRe(c.name), 'i');
      for (const r of rs) if (r.type === 'review' && r.text && nre.test(r.productName || '')) out.push(NORM.review({ ...r, author: r.reviewerName, date: r.reviewedAt, id: r.reviewId }, { platform: 'nykaa', url: r.productUrl, pid: r.productId, title: r.productName, now: now() }));
      if (out.length) { st.detail = { listings: new Set(out.map((x) => x.link)).size, via: 'apify' }; return out; } } catch (e) { if (capHit(e)) throw e; st.notes.push(`nykaa: ${e.message.slice(0, 120)}`); }
    const urls = await listings(c, o, 'nykaa.com', /nykaa\.com\/.+\/(p|reviews)\/\d+$/, o.mkListings ?? 2);
    if (!urls.length && apify?.live) { try { const ps = await acall('thirdwatch/nykaa-scraper', { queries: [c.name], maxResults: 5 }, { startUsd: 0.1, perItemUsd: 0.008, maxUsd: 0.15 }, o.capUsd);
      for (const p of ps) { const u = p.url || p.productUrl; if (u && /\/p\/\d+/.test(u) && new RegExp(escRe(c.name), 'i').test(`${p.brand || ''} ${p.name || p.title || ''}`)) urls.push(String(u).split('?')[0]); } } catch (e) { st.notes.push(`nykaa search: ${e.message.slice(0, 120)}`); } }
    if (!urls.length) throw Object.assign(new Error('skipped: no Nykaa listings found'), { needs: true });
    await each(urls.slice(0, 2), async (url) => { const pid = url.match(/\/(\d+)$/)[1], title = (url.match(/nykaa\.com\/([^/]+)\//) || [])[1]?.replace(/-/g, ' ') || null;
      if (apify?.live) try { const rs = await acall('stealth_mode/nykaa-reviews-scraper', { product_id: pid, sort_by: 'MOST_RECENT', max_items_per_url: 25, ignore_url_failures: true }, { startUsd: 0.005, perItemUsd: 0.01, maxUsd: 0.3 }, o.capUsd);
        if (rs.length) { rs.forEach((r) => out.push(NORM.review(r, { platform: 'nykaa', url: `https://www.nykaa.com/${title?.replace(/ /g, '-') || 'p'}/reviews/${pid}`, pid, title, now: now() }))); return; } } catch (e) { if (capHit(e)) throw e; st.notes.push(`nykaa reviews: ${e.message.slice(0, 120)}`); }
      (await pageRead(c, o, url.replace(/\/p\/(\d+)$/, '/reviews/$1'), 'nykaa')).forEach((x) => out.push(x)); }, st, 2);
    st.detail = { listings: urls.length, via: apify?.live ? 'apify' : 'page' }; return out;
  }
  async function flipkart(c, o, st, have, ex) {
    india(ex); const out = (st.partial = []);
    /* one Apify run searches Flipkart for the brand and reads each listing's reviews (probed 23 Oct); a site search is the fallback */
    if (apify?.live) try { const rs = await acall('scrapesage/flipkart-scraper', { searchTerms: [c.name], maxProducts: 4, maxPagesPerSearch: 1, includeReviews: true, maxReviewsPerProduct: 10 }, { startUsd: 0.005, perItemUsd: 0.002, maxUsd: 0.15, maxItems: 60 }, o.capUsd), nre = new RegExp(escRe(c.name), 'i');
      for (const r of rs) if (r.type === 'review' && r.text && nre.test(r.productTitle || '')) out.push(NORM.review({ ...r, date: r.dateISO || r.date, id: r.reviewId }, { platform: 'flipkart', url: r.reviewUrl || r.productUrl, pid: r.productId, title: r.productTitle, now: now() }));
      if (out.length) { st.detail = { listings: new Set(out.map((x) => x.product)).size, via: 'apify' }; return out; } } catch (e) { if (capHit(e)) throw e; st.notes.push(`flipkart: ${e.message.slice(0, 120)}`); }
    const urls = await listings(c, o, 'flipkart.com', /flipkart\.com\/[^/]+\/(p|product-reviews)\/itm\w+$/, o.mkListings ?? 2);
    if (!urls.length) throw Object.assign(new Error('skipped: no Flipkart listings found'), { needs: true });
    const rev = urls.map((u) => u.replace('/p/', '/product-reviews/'));
    if (apify?.live) try { const rs = await acall('shahidirfan/flipkart-reviews-scraper', { startUrls: rev.map((url) => ({ url })), results_wanted: 20, max_pages: 3 }, { startUsd: 0.0005, perItemUsd: 0.002, maxUsd: 0.15 }, o.capUsd);
      if (rs.length) { rs.forEach((r) => out.push(NORM.review(r, { platform: 'flipkart', url: r.productUrl || rev[0], title: r.productName || r.product_title || null, now: now() }))); st.detail = { listings: urls.length, via: 'apify' }; return out; } } catch (e) { if (capHit(e)) throw e; st.notes.push(`flipkart reviews: ${e.message.slice(0, 120)}`); }
    await each(rev, async (url) => (await pageRead(c, o, url, 'flipkart')).forEach((x) => out.push(x)), st, 2);
    st.detail = { listings: urls.length, via: 'page' }; return out;
  }
  async function myntra(c, o, st, have, ex) {
    india(ex); const out = (st.partial = []);
    if (apify?.live) try { const ps = await acall('codingfrontend/myntra-product-search-scraper', { search: c.name, brand: c.name, sortBy: 'popularity', maxProductsPerSearch: 3, maxPages: 1, scrapeReviews: true, maxReviewsPerProduct: 15 }, { startUsd: 0.0001, perItemUsd: 0.02, maxUsd: 0.1 }, o.capUsd);
      for (const p of ps) { const url = p.url || p.productUrl || (p.landingPageUrl ? `https://www.myntra.com/${p.landingPageUrl}` : null), title = p.productName || p.name || p.title || null;
        for (const r of p.reviews || []) out.push(NORM.review(r, { platform: 'myntra', url, title, pid: p.productId || p.id, now: now() })); }
      if (out.length) { st.detail = { products: ps.length, via: 'apify' }; return out; } } catch (e) { if (capHit(e)) throw e; st.notes.push(`myntra: ${e.message.slice(0, 120)}`); }
    const urls = await listings(c, o, 'myntra.com', /myntra\.com\/.+\/\d+\/buy$/, o.mkListings ?? 2);
    if (!urls.length) throw Object.assign(new Error('skipped: no Myntra listings found'), { needs: true });
    await each(urls, async (url) => (await pageRead(c, o, url, 'myntra')).forEach((x) => out.push(x)), st, 2);
    // Myntra draws its reviews in the browser: a page read rarely sees them
    if (!out.length && !apify?.live) throw Object.assign(new Error('needs APIFY_TOKEN: Myntra reviews are only read through Apify'), { needs: true });
    st.detail = { listings: urls.length, via: 'page' }; return out;
  }

  // news and the open web (free): articles, Quora answers, forum threads, best-of lists, and the questions and problems buyers write about
  async function news(c, o, st) {
    const qs = [[`"${c.name}"`, 'brand'], ...c.rivals.slice(0, o.lite ? 1 : 2).map((r) => [`"${r}"`, 'rival']), ...(o.lite ? [] : [...c.terms.category.slice(0, 1).map((q) => [bare(q), 'category']), ...(c.terms.problems || []).slice(0, 1).map((q) => [bare(q), 'problem'])])], out = (st.partial = []);
    await each(qs, async ([q, kind]) => { const j = await tcall('tinyfish.web.search.news', { query: { domain_type: 'news', query: q } }, o.capUsd); for (const r of j?.results || []) if (r?.url) out.push(NORM.news(r, kind)); }, st);
    return out;
  }
  async function web(c, o, st) {
    const n = o.lite ? 1 : 3, qs = [[`site:quora.com ${c.name}`, 'brand'], [`"${c.name}" review forum`, 'brand'], ...(c.rivals[0] ? [[`${c.name} vs ${c.rivals[0]}`, 'brand']] : []), ...c.terms.category.slice(0, 1).map((q) => [`best ${bare(q)}`, 'category']),
      ...(c.terms.questions || []).slice(0, n).map((q) => [bare(q), 'question']), ...(c.terms.problems || []).slice(0, o.lite ? 1 : 2).map((q) => [`${bare(q)} forum`, 'problem'])], out = (st.partial = []);
    await each(qs, async ([q, kind]) => { const j = await tcall('treg.web.search', { body: { q, limit: 10 } }, o.capUsd);
      for (const r of j?.output?.results || []) { const h = hostOf(r.url); if (!h || h === c.host.replace(/^www\./, '') || /reddit\.com|youtube\.com|instagram\.com|tiktok\.com|facebook\.com|amazon\.|walmart\.com|trustpilot\.com|wikipedia\.org/.test(h) || /\/topic\//.test(r.url)) continue; out.push(NORM.web(r, kind)); } }, st);
    return out;
  }

  // the brand's own reviews: the review app is found in the pack or in the site's HTML (home page and one product page), then its public widget feed is read (free)
  const shopProducts = async (c) => { try { return ((await get(`https://${c.host}/products.json?limit=5`, 'json', 15e3))?.products || []).filter((p) => p?.id && p.handle).slice(0, 4).map((p) => ({ id: p.id, handle: p.handle, title: unesc(p.title || ''), url: `https://${c.host}/products/${p.handle}` })); } catch { return []; } };
  async function site(c, o, st, have) {
    const out = (st.partial = []), first = !have.some((x) => x.platform === 'site');
    let found = c.reviewApp === 'judge.me' && c.myshopify ? { app: 'judge.me', shop: c.myshopify } : null, prods = null;
    if (!found) { let html = ''; try { html = await get(`https://${c.host}/`, 'text', 20e3); } catch (e) { st.notes.push(`home page: ${e.message.slice(0, 100)}`); }
      found = reviewAppOf(html, c.myshopify);
      // apps that load only on product pages (Yotpo often does): read one product page too
      if (!found?.key && found?.app !== 'judge.me') { prods = await shopProducts(c); if (prods[0]) try { const pp = await get(prods[0].url, 'text', 20e3); found = reviewAppOf(`${html}\n${pp}`, c.myshopify) || found; } catch (e) { st.notes.push(`product page: ${e.message.slice(0, 100)}`); } } }
    const app = found?.app || c.reviewApp;
    st.detail = { app: app || null };
    if (!app) throw Object.assign(new Error('skipped: no review app found on the site'), { needs: true });
    if (!['judge.me', 'yotpo', 'okendo', 'stamped', 'loox'].includes(app)) throw Object.assign(new Error(`skipped: review app is ${app} (Judge.me, Yotpo, Okendo, Stamped and Loox are read here)`), { needs: true });
    if (app !== 'judge.me' && !found?.key) throw Object.assign(new Error(`skipped: ${app} is on the site but its public key is not in the page`), { needs: true });
    const pages = first ? 10 : 3;
    if (app === 'judge.me') { const shop = found?.shop || c.myshopify; if (!shop) throw Object.assign(new Error('skipped: Judge.me is on the site but no myshopify domain was found'), { needs: true });
      for (let n = 1; n <= pages && !st.stop; n++) { let j; try { j = await get(`https://judge.me/reviews/all_reviews_js_based?shop_domain=${shop}&platform=shopify&per_page=10&review_type=product-reviews&sort_by=created_at&sort_dir=desc&page=${n}`); } catch (e) { if (n === 1) throw new Error(`judge.me feed: ${e.message}`); st.notes.push(`judge.me page ${n}: ${e.message}`); break; }
        if (n === 1) st.total = +j.number_of_product_reviews || null;
        const before = out.length;
        for (const m of String(j.html || '').matchAll(/<div class='jdgm-rev [^']*'[^>]*data-review-id='([^']+)'([\s\S]*?)<div class='jdgm-rev__reply'>/g)) { const b = m[2], g = (re) => (b.match(re) || [])[1] || '';
          const handle = g(/href='\/products\/([^'?#]+)'/), text = unesc(g(/<div class='jdgm-rev__body'>([\s\S]*?)<\/div>/));
          if (!text) continue;
          out.push({ id: `site:${m[1]}`, platform: 'site', kind: 'review', link: handle ? `https://${c.host}/products/${handle}#judgeme_product_reviews` : `https://${c.host}`, postedAt: Date.parse(g(/data-content='([^']+)'/).replace(' UTC', 'Z').replace(' ', 'T')) || 0, author: short(unesc(g(/class='jdgm-rev__author'>([^<]*)</))), rating: +g(/data-score='(\d)'/) || null, title: unesc(g(/<b class='jdgm-rev__title'>([\s\S]*?)<\/b>/)), text: text.slice(0, 800), product: unesc(g(/class='jdgm-rev__prod-link'>([\s\S]*?)<\/a>/)) || handle || null, q: 'brand' }); }
        if (out.length === before) break; await sleep(250); }
      return out; }
    const home = { url: `https://${c.host}/`, title: null, now: now() };
    if (app === 'okendo') { for (let n = 0; n < (first ? 4 : 1) && !st.stop; n++) { const j = await get(`https://api.okendo.io/v1/stores/${found.key}/reviews?limit=25&orderBy=date%20desc${n ? `&offset=${n * 25}` : ''}`); const rs = j?.reviews || [];
        rs.filter((r) => r?.reviewId && r.body).forEach((r) => out.push(NORM.okendo(r, home))); if (rs.length < 25) break; } return out; }
    if (app === 'stamped') { for (let n = 1; n <= (first ? 3 : 1) && !st.stop; n++) { const j = await get(`https://stamped.io/api/widget/reviews?storeUrl=${encodeURIComponent(found.store || c.myshopify || c.host)}&apiKey=${found.key}&take=50&page=${n}&sort=recent`); const rs = j?.data || [];
        if (n === 1) st.total = +j?.total || null; rs.filter((r) => r?.id && r.reviewMessage).forEach((r) => out.push(NORM.stamped(r, home))); if (rs.length < 50) break; } return out; }
    // Yotpo and Loox are read per product (Shopify product ids from the store's public product list); Yotpo also has store reviews
    prods ||= await shopProducts(c);
    if (app === 'yotpo') { const per = first ? 50 : 20;
      await each([{ id: 'yotpo_site_reviews', url: home.url, title: null }, ...prods], async (p) => { const j = await get(`https://api-cdn.yotpo.com/v1/widget/${found.key}/products/${p.id}/reviews.json?per_page=${per}&page=1&sort=date`);
        for (const r of j?.response?.reviews || []) if (r?.id && r.content) out.push(NORM.yotpo(r, p)); }, st, 2);
      return out; }
    if (!prods.length) throw Object.assign(new Error('skipped: Loox is on the site but no products were listed'), { needs: true });
    await each(prods, async (p) => { const h = await get(`https://loox.io/widget/${found.key}/reviews/${p.id}?limit=${first ? 40 : 20}`, 'text'); looxReviews(h, { ...p, now: now() }).forEach((x) => out.push(x)); }, st, 2);
    if (!out.length) throw Object.assign(new Error('skipped: Loox reviews could not be read from its widget'), { needs: true });
    return out;
  }

  // X: posts that name the brand (one OR search), then posts about rivals, the category and problems
  async function x(c, o, st) {
    const ors = [...new Set([...c.filter.strong.filter((s) => !s.includes('.')).map((s) => (s.includes(' ') ? `"${s}"` : s)), c.xHandle && `@${c.xHandle}`, `"${c.name} ${c.noun}"`].filter(Boolean))].slice(0, 5).join(' OR ');
    const out = (st.partial = []), qs = [[ors, 'brand'], ...pick(c, o.mix).filter(([, k]) => k !== 'brand').map(([q, k]) => [`${q} -filter:links`, k])];
    await each(qs, async ([q, kind]) => { const j = await tcall('anyapi.x.search.posts', { body: { query: q, limit: kind === 'brand' ? 40 : 20, queryType: 'Latest' } }, o.capUsd);
      for (const p of j?.output?.data?.items || []) if (p?.id) out.push(NORM.xPost(p, kind)); }, st);
    return out;
  }

  // Amazon: reviews on the brand's listings, then on rivals' top listing and the category's best seller (newest reviews read first)
  async function amazon(c, o, st) {
    const [country, domain] = c.amazon, F = filterOf(c), out = (st.partial = []), rows = new Map();
    const starts = (n) => new RegExp(`^\\W*${escRe(n).replace(/\s+/g, '\\s*')}\\b`, 'i');
    const searches = [[`${c.name} ${c.noun}`, 'brand', o.amazonListings ?? 3, c.name], ...(o.lite ? [] : [...c.rivals.slice(0, o.mix?.rival ?? 2).map((r) => [`${r} ${c.noun}`, 'rival', 1, r]), ...c.terms.category.slice(0, 1).map((q) => [bare(q), 'category', 1, null])])];
    await each(searches, async ([kw, kind, n, who]) => { const j = await tcall('crawl4ai.amazon.search.products', { body: { keywords: kw, country, limit: 40 } }, o.capUsd);
      const ok = (r) => { const t = String(r.title || '').slice(0, 80); return who ? starts(who).test(t) : F.must.test(t) && !starts(c.name).test(t); };
      [...new Map((j?.rows || []).filter((r) => r.asin && ok(r)).map((r) => [r.asin, r])).values()].sort((a, b) => (+b.reviews || 0) - (+a.reviews || 0)).slice(0, n).forEach((r) => { if (!rows.has(r.asin)) rows.set(r.asin, { ...r, q: kind }); }); }, st);
    st.detail = { listings: rows.size, brand: [...rows.values()].filter((r) => r.q === 'brand').length, domain };
    await each([...rows.values()], async (r) => { const k = await tcall('crawl4ai.amazon.product.reviews', { body: { product: `https://www.${domain}/dp/${r.asin}`, limit: r.q === 'brand' ? 30 : 15 } }, o.capUsd);
      for (const v of k?.rows || []) { if (!v.text) continue; out.push({ id: `amz:${v.review_id || `${r.asin}:${String(v.text).slice(0, 30)}`}`, platform: 'amazon', kind: 'review', link: `https://www.${domain}/dp/${r.asin}#customerReviews`, postedAt: Date.parse(v.date) || 0, author: short(v.author === '[redacted]' ? 'Amazon customer' : v.author), rating: +v.rating || null, title: unesc(v.title), text: unesc(v.text).slice(0, 800), product: String(r.title).slice(0, 80), q: r.q, ...(r.q === 'rival' ? { acct: 'rival' } : {}) }); } }, st);
    return out;
  }
  // posts that tag or @mention the brand's Instagram (the people who already show it off); needs the brand's handle
  async function igtag(c, o, st, have, ex) {
    const h = String(c.instagram || ex?.instagram || '').replace(/^@/, ''); if (!h) throw Object.assign(new Error('skipped: no Instagram handle for the brand'), { needs: true });
    const rs = await acall('dami_studio/instagram-mentions-scraper', { usernames: [h], maxItems: 30, resultsPerUsername: 30 }, { startUsd: 0.0005, perItemUsd: 0.00044, maxUsd: 0.05, maxItems: 30 }, o.capUsd);
    const out = rs.filter((r) => r.url && r.ok !== false && String(r.ownerUsername || '').toLowerCase() !== h.toLowerCase()).map((r) => NORM.igTagged(r, { acct: 'own' }));
    st.detail = { handle: h, posts: out.length }; return out;
  }
  const RUN = { reddit, youtube, site, x, amazon, tiktok, instagram, igtag, threads, linkedin, pinterest, telegram, facebook, trustpilot, google, walmart, nykaa, flipkart, myntra, news, web };
  const SLOW = { reddit: 300e3, amazon: 360e3, nykaa: 420e3, flipkart: 420e3, myntra: 420e3, facebook: 240e3, google: 240e3 };

  /* ---------- tag: one cheap Claude pass, ~40 items a call ---------- */
  async function tag(c, xs, known = []) {
    let usd = 0, done = 0; const vocab = new Set(known);
    const batchOf = async (batch) => {
      const r = await ai.call({ model: 'sonnet', max: 6000, tag: `listen-tag-${slug}`,
        system: 'You tag real public posts, comments and reviews for a brand team. Use only what each one says. Never guess beyond the text.',
        prompt: `Brand: ${c.name} (${c.host}), ${c.category || c.noun}, ${c.country}. Rivals: ${c.rivals.join(', ') || 'none'}.\nFor each item return:\n- themes: 1-2 short lowercase labels (2-3 words) for what it is about, e.g. "sizing", "sole comfort", "delivery delay", "price". Reuse these labels when they fit: ${[...vocab].slice(0, 60).join(', ') || '(none yet)'}\n- sentiment: pos, neg or neutral (toward the thing it is about)\n- intent: question, complaint, praise, compare (weighs options/brands) or other\n- about: brand (talks about ${c.name}), rival (about a rival, not ${c.name}), category (the ${c.noun} category in general), none (not about any of these: another meaning of the name, spam, deals, unrelated)\n\n${batch.map((x, k) => `${k}: [${x.platform}${x.sub ? ' ' + x.sub : ''}] ${x.title ? x.title + '. ' : ''}${x.kind === 'comment' && x.threadTitle ? `(reply in "${x.threadTitle.slice(0, 80)}") ` : ''}${String(x.text).slice(0, 360)}`).join('\n')}`,
        schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, themes: { type: 'array', items: { type: 'string' } }, sentiment: { type: 'string', enum: SENT }, intent: { type: 'string', enum: INTENT }, about: { type: 'string', enum: ABOUT } } } } } } });
      usd += r.usd || 0;
      for (const t of r.json?.items || []) { const it = batch[t.i]; if (!it) continue;
        it.themes = (t.themes || []).slice(0, 2).map((s) => String(s).toLowerCase().trim()).filter(Boolean); it.themes.forEach((s) => vocab.add(s));
        it.sentiment = SENT.includes(t.sentiment) ? t.sentiment : 'neutral'; it.intent = INTENT.includes(t.intent) ? t.intent : 'other'; it.about = ABOUT.includes(t.about) ? t.about : it.about; it.tagged = now(); done++; } };
    const batches = []; for (let i = 0; i < xs.length; i += 40) batches.push(xs.slice(i, i + 40));
    // the first batch alone seeds the theme words; the rest run 4 at a time
    if (batches.length) await batchOf(batches.shift()).catch((e) => log.warn?.('[listen tag]', e.message));
    await Promise.all(Array.from({ length: 4 }, async () => { while (batches.length) await batchOf(batches.shift()).catch((e) => log.warn?.('[listen tag]', e.message)); }));
    return { usd, done };
  }

  /* ---------- the derived views ---------- */
  const quoteOf = (x) => { const t = String(x.title || '').replace(/[.!?…\s]+$/, ''); return (t && !String(x.text).toLowerCase().startsWith(t.toLowerCase()) ? `${t}. ${x.text}` : x.text).slice(0, 260); };
  /* a thread's reply count: the platform's live count, else a floor (an archive's count or the comments Brew heard, whichever is
     more, flagged repliesFloor), else unknown (null). Never the number of comments Brew happened to keep, shown as the total */
  const repliesOf = (post, xs) => { const heardC = xs.filter((y) => y.kind === 'comment').length, n = post?.replies;
    if (n != null && post.floor === false) return { replies: Math.max(n, heardC), repliesLive: true };
    if (n != null && !post.floor && post.platform !== 'reddit') return { replies: Math.max(n, heardC), repliesLive: true }; /* TikTok, Instagram, YouTube, X and LinkedIn give live counts */
    const f = Math.max(n ?? 0, heardC); return f ? { replies: f, repliesFloor: true } : { replies: null }; };
  function threadsOf(items) {
    const by = new Map();
    for (const x of items) { if (!x.thread || REVIEW.has(x.platform)) continue; const k = `${x.platform}:${x.thread}`; (by.get(k) || by.set(k, []).get(k)).push(x); }
    const out = [];
    for (const [k, xs] of by) { const post = xs.find((y) => y.kind === 'post'), lead = post || xs[0];
      const url = post?.link || lead.threadUrl || (lead.platform === 'reddit' ? lead.link.replace(/\/comments\/([a-z0-9]+)\/.*$/i, '/comments/$1/') : lead.link);
      // a comment whose post we never saw keeps its thread, titled by its own words
      const title = post?.title || lead.threadTitle || null;
      const cnt = (f) => { const m = {}; xs.forEach((y) => { const v = f(y); if (v) m[v] = (m[v] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
      const best = [...xs].sort((a, b) => (b.about === 'brand') - (a.about === 'brand') || String(b.text).length - String(a.text).length)[0];
      out.push({ id: k, url, platform: lead.platform, where: lead.sub || lead.platform, title: title || quoteOf(lead).slice(0, 90), lastActive: Math.max(...xs.map((y) => y.postedAt || 0)), ...repliesOf(post, xs),
        heard: xs.length, about: post?.about || cnt((y) => y.about), intent: post?.intent || cnt((y) => y.intent), sentiment: cnt((y) => y.sentiment), quote: quoteOf(best), quoteId: best.id }); }
    // rank: about the brand first, then live conversations (recent, with replies)
    const score = (t) => (t.about === 'brand' ? 3 : t.about === 'rival' ? 1.5 : 1) * (1 + Math.log1p(t.replies || 0) + Math.log1p(t.heard)) * Math.exp(-(now() - t.lastActive) / (60 * DAY));
    return out.map((t) => ({ ...t, score: +score(t).toFixed(3) })).sort((a, b) => b.score - a.score).slice(0, 200);
  }
  function themesOf(items, prev) {
    const tagged = items.filter((x) => x.themes?.length), N = tagged.length || 1, wk = now() - 7 * DAY, wk2 = now() - 14 * DAY, c = {};
    for (const x of tagged) for (const th of x.themes) { const t = (c[th] ||= { name: th, n: 0, pos: 0, neg: 0, neutral: 0, brand: 0, week: 0, lastWeek: 0, ids: [] });
      t.n++; t[x.sentiment || 'neutral']++; if (x.about === 'brand') t.brand++; if (x.postedAt >= wk) t.week++; else if (x.postedAt >= wk2) t.lastWeek++; t.ids.push(x); }
    const pv = new Map((prev?.themes || []).map((t) => [t.name, t]));
    return Object.values(c).sort((a, b) => b.n - a.n).slice(0, 60).map(({ ids, ...t }) => { const share = +(t.n / N).toFixed(4), p = pv.get(t.name);
      const qs = [...ids].sort((a, b) => (b.about === 'brand') - (a.about === 'brand') || (b.likes || 0) - (a.likes || 0) || String(b.text).length - String(a.text).length).filter((y) => String(y.text).split(/\s+/).length >= 6).slice(0, 3);
      return { ...t, share, wow: { week: t.week, lastWeek: t.lastWeek, change: t.lastWeek ? +((t.week - t.lastWeek) / t.lastWeek).toFixed(2) : null }, sinceLastRun: p ? { n: t.n - p.n, share: +(share - p.share).toFixed(4) } : null,
        quoteIds: qs.map((y) => y.id), quote: qs[0] ? quoteOf(qs[0]) : null, quoteLink: qs[0]?.link || null }; });
  }
  function communitiesOf(items, c) {
    const by = new Map();
    for (const x of items) { if (!x.sub || REVIEW.has(x.platform) || x.platform === 'news' || /^r\/(u[_/]|$)/i.test(x.sub)) continue; const k = `${x.platform}:${x.sub.toLowerCase()}`; (by.get(k) || by.set(k, []).get(k)).push(x); }
    const out = [];
    for (const [, xs] of by) { const x0 = xs[0], th = {}; xs.forEach((y) => (y.themes || []).forEach((t) => { th[t] = (th[t] || 0) + 1; }));
      const brand = xs.filter((y) => y.about === 'brand').length, rival = xs.filter((y) => y.about === 'rival').length, cat = xs.filter((y) => y.about === 'category').length, qn = xs.filter((y) => y.intent === 'question').length;
      const top = Object.entries(th).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
      const why = [brand && `${brand} about ${c.name}`, rival && `${rival} about rivals`, cat && `${cat} about ${c.noun} in general`].filter(Boolean).join(', ') + (qn ? `; ${qn} are questions` : '') + (top.length ? `; talk is about ${top.join(', ')}` : '');
      out.push({ name: x0.sub, platform: x0.platform, url: x0.platform === 'reddit' ? `https://www.reddit.com/${x0.sub}/` : x0.subUrl || null, why, posts: xs.length, threads: new Set(xs.map((y) => y.thread)).size, brand, rival, category: cat, questions: qn,
        lastActive: Math.max(...xs.map((y) => y.postedAt || 0)), themes: top, rules: null /* Reddit's rules API refuses plain requests; read them before posting */ }); }
    const score = (m) => (m.brand * 3 + m.rival * 1.5 + m.category + m.questions) * Math.exp(-(now() - m.lastActive) / (90 * DAY));
    return out.map((m) => ({ ...m, score: +score(m).toFixed(3) })).sort((a, b) => b.score - a.score).slice(0, 60);
  }

  /* ---------- run ---------- */
  const RUN_CAP = () => (Number.isFinite(+process.env.LISTEN_RUN_CAP_USD) && process.env.LISTEN_RUN_CAP_USD !== '' ? +process.env.LISTEN_RUN_CAP_USD : 0.6);
  // merge fresh reads into the store: de-dupe by id (a newer read refreshes counts), keep earlier tags
  const mergeInto = (map, x, about) => { const old = map.get(x.id), it = { ...(old || {}), ...x, replies: Math.max(old?.replies ?? -1, x.replies ?? -1, -1) < 0 ? null : Math.max(old?.replies ?? 0, x.replies ?? 0), about: old?.tagged ? old.about : about, mode: x.mode || old?.mode || 'heard', capturedAt: old?.capturedAt || now(), seenAt: now() };
    if (old?.tagged) Object.assign(it, { themes: old.themes, sentiment: old.sentiment, intent: old.intent, tagged: old.tagged });
    if (!old?.tagged) Object.assign(it, { themes: [], sentiment: null, intent: null });
    if (old?.askedFor && !x.askedFor) Object.assign(it, { mode: 'asked', askedFor: old.askedFor });
    map.set(x.id, it); };
  // the newest CAP items, but every source keeps at least its newest FLOOR (a loud source never pushes a quiet one off the wall)
  const dedupe = (xs) => { const seenTxt = new Set(), all = xs.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0)).filter(enough).filter((x) => { const k = `${x.platform}:${String(x.text).toLowerCase().replace(/\W+/g, '').slice(0, 120)}`; if (seenTxt.has(k)) return false; seenTxt.add(k); return true; });
    if (all.length <= CAP) return all; const per = {}, keep = new Set(all.filter((x) => (per[x.platform] = (per[x.platform] || 0) + 1) <= FLOOR));
    for (const x of all) { if (keep.size >= CAP) break; keep.add(x); } return all.filter((x) => keep.has(x)); };
  // direct: said about the brand; indirect: about a rival, the category or a problem it solves
  const reachOf = (x) => (x.about === 'brand' ? 'direct' : 'indirect');
  // lite: the cheap read between daily full reads (free sources, fast social sources with one search of each kind, small limits)
  // timeouts (per source, ms) and pace (a multiplier on Reddit's waits) let tests run fast
  async function run({ paid = true, capUsd = RUN_CAP(), only = null, tagMax = 800, fallbackCalls = 12, fresh = false, lite = false, timeouts = SLOW, pace = 1 } = {}) {
    if (S.busy) return { busy: true };
    S.busy = true; runCost.start = treg?.meter?.usd || 0; runCost.apify = apify?.meter?.usd || 0; runCost.cfgAi = 0; const t0 = now();
    try {
      const c = await config({ fresh, paid, capUsd }), F = filterOf(c), ex = await extrasOf(c);
      const prevItems = (await packs.getJSON(slug, P('items'), null))?.items || [];
      const prevThemes = await packs.getJSON(slug, P('themes'), null), prevStatus = await packs.getJSON(slug, P('status'), null);
      const status = { at: t0, paid, lite, capUsd, sources: {}, usd: { ai: 0, treg: 0 } };
      const o = lite ? { capUsd, fallbackCalls: Math.min(fallbackCalls, 3), paid, lite, pace, mix: LITE_MIX, amazonListings: 1, tiktokVideos: 1, igPosts: 1, ytVideos: 2, fbPosts: 1 } : { capUsd, fallbackCalls, paid, lite, pace, mix: MIX, amazonListings: 3 };
      const skipped = (k) => (only && !only.includes(k)) || (lite && LITE_SKIP.has(k));
      const want = Object.keys(RUN).filter((k) => !skipped(k) && (paid || !SOURCES[k].paid || (k === 'youtube' && process.env.YOUTUBE_API_KEY)));
      const got = {};
      await Promise.all(Object.keys(RUN).map(async (k) => { const st = (status.sources[k] = { name: SOURCES[k].name, state: 'idle', got: 0, kept: 0, notes: [], ms: 0 });
        // a source this run leaves out keeps what its last read said (an "only" run or a light read never hides a source)
        const prev = prevStatus?.sources?.[k];
        if (skipped(k) && prev && prev.state !== 'off') { status.sources[k] = { ...prev, state: prev.state === 'ok' ? 'carried' : prev.state, got: 0, kept: 0, notes: [], carried: prev.carried || prevStatus.at || null }; return; } /* carried, never shown as read this run */
        if (!want.includes(k)) { st.state = 'off'; st.error = only && !only.includes(k) ? 'not asked' : lite && LITE_SKIP.has(k) ? 'read once a day (this was a light read)' : 'paid sources are off (LISTEN_PAID=0)'; return; }
        const s0 = now(); st.state = 'fetching';
        try { const xs = await timed(RUN[k](c, o, st, prevItems, ex), timeouts[k] || 150e3, k); got[k] = xs; st.got = xs.length; st.state = 'ok';
          /* a source whose calls failed inside (a 402 from an empty treg balance, a 429 quota) comes back with nothing and the
             reason in its notes: that is an error, never "ok, 0 found" */
          const why = !xs.length && st.notes.find((n) => FAILED.test(n)); if (why) { st.state = 'error'; st.error = String(why).slice(0, 200); }
          /* some calls failed but others answered: what came back is real, and the source says it is incomplete */
          else if (xs.length && st.notes.some((n) => FAILED.test(n))) { st.partial = true; st.warn = String(st.notes.find((n) => FAILED.test(n))).slice(0, 200); } }
        catch (e) {
          // what a source read before it ran out of time (or failed part way) is kept; the error goes in its notes
          if (st.partial?.length) { st.stop = true; got[k] = [...st.partial]; st.got = got[k].length; st.state = 'ok'; st.partial = true; st.notes.unshift(`kept ${got[k].length} read before: ${e.message.slice(0, 140)}`); log.warn?.(`[listen ${k}] partial`, e.message); }
          else { st.stop = true; st.state = e.needs || /^needs|^skipped/.test(e.message) ? 'needs' : 'error'; st.error = e.message.slice(0, 200); log.warn?.(`[listen ${k}]`, e.message); } }
        if (st.partial !== true) delete st.partial; delete st.stop;
        st.ms = now() - s0; st.notes = st.notes.slice(0, 8); }));
      // drop what the filter says isn't about us
      const map = new Map(prevItems.filter((x) => onTopic(F, x)).map((x) => [x.id, x]));
      for (const [k, xs] of Object.entries(got)) { let kept = 0;
        for (const x of xs) { if (!x.text) x.text = x.title || ''; if (!enough(x)) continue; const about = guess(F, x); if (!about) continue; mergeInto(map, { ...x, mode: x.mode || 'heard' }, about); kept++; }
        status.sources[k].kept = kept; }
      // the same words twice (a cross-post, a re-read) count once
      let items = dedupe([...map.values()]);
      // tag what's new, newest first
      const todo = items.filter((x) => !x.tagged).slice(0, tagMax);
      if (todo.length && ai && ai.live !== false) { try { const r = await tag(c, todo, (prevThemes?.themes || []).map((t) => t.name)); status.usd.ai += r.usd; status.tagged = r.done; } catch (e) { status.tagError = e.message; } }
      // Claude's "none" is the second gate: not about the brand, a rival or the category (replies to the brand's own question always stay)
      const dropped = items.filter((x) => x.about === 'none' && x.mode !== 'asked').length; items = items.filter((x) => (x.about !== 'none' || x.mode === 'asked') && !(x.mode !== 'asked' && (SPAM_TXT.test(x.text || '') || (x.kind === 'comment' && BARE(x.text)))));
      items.forEach((x) => { x.reach = reachOf(x); });
      for (const k of Object.keys(status.sources)) status.sources[k].total = items.filter((x) => x.platform === k).length;
      const threads = threadsOf(items), themes = themesOf(items, prevThemes), communities = communitiesOf(items, c);
      status.usd.ai += runCost.cfgAi; status.usd.treg = +spent().toFixed(4); status.usd.ai = +status.usd.ai.toFixed(4); status.usd.total = +(status.usd.ai + status.usd.treg).toFixed(4);
      Object.assign(status, { ms: now() - t0, items: items.length, byReach: { direct: items.filter((x) => x.reach === 'direct').length, indirect: items.filter((x) => x.reach === 'indirect').length }, droppedByTag: dropped, untagged: items.filter((x) => !x.tagged).length, threads: threads.length, communities: communities.length, themes: themes.length });
      await packs.put(slug, P('items'), { at: now(), items });
      await packs.put(slug, P('threads'), { at: now(), threads });
      await packs.put(slug, P('themes'), { at: now(), total: items.filter((x) => x.themes?.length).length, themes });
      await packs.put(slug, P('communities'), { at: now(), communities });
      await packs.put(slug, P('status'), status);
      await writeHistory(items, themes).catch((e) => log.warn?.('[listen history]', e.message));
      return { items, threads, themes, communities, status };
    } finally { S.busy = false; }
  }

  /* ---------- history: one small file a day, so trends survive the 3000-item store ---------- */
  const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
  const countBy = (xs, f) => { const m = {}; xs.forEach((x) => { const v = f(x); if (v) m[v] = (m[v] || 0) + 1; }); return m; };
  async function writeHistory(items, themes) {
    const d = dayOf(now()), byMode = { heard: 0, asked: 0, ...countBy(items, (x) => x.mode || 'heard') }, byReach = { direct: 0, indirect: 0, ...countBy(items, (x) => x.reach || reachOf(x)) };
    const h = { at: now(), day: d, total: items.length, bySource: countBy(items, (x) => x.platform), byMode, byReach, questions: items.filter((x) => x.intent === 'question').length,
      themes: themes.slice(0, 30).map((t) => ({ name: t.name, n: t.n, pos: t.pos, neg: t.neg, neutral: t.neutral, quoteIds: (t.quoteIds || []).slice(0, 2) })) };
    await packs.put(slug, `listen/history/${d}.json`, h);
    const idx = (await packs.getJSON(slug, 'listen/history/index.json', null)) || { dates: [] };
    if (!idx.dates.includes(d)) idx.dates = [...idx.dates, d].sort().slice(-400);
    await packs.put(slug, 'listen/history/index.json', idx);
    return h;
  }
  async function history({ days = 90 } = {}) {
    const from = dayOf(now() - Math.max(1, +days || 90) * DAY), idx = (await packs.getJSON(slug, 'listen/history/index.json', null)) || { dates: [] };
    const ds = idx.dates.filter((d) => d > from);
    const xs = (await Promise.all(ds.map((d) => packs.getJSON(slug, `listen/history/${d}.json`, null).catch(() => null)))).filter(Boolean);
    return { days: xs, n: xs.length };
  }

  /* ---------- asked: replies to questions the brand posted for research moves ---------- */
  // listen/asked.json = [{ moveId, url, platform, postedAt, reportedAt, lastRead, replies, done, themes }]
  async function addAsked({ moveId, url, platform, postedAt } = {}) {
    if (!moveId || !/^https?:\/\//.test(String(url || ''))) return { error: 'moveId and the thread url are needed' };
    const all = (await packs.getJSON(slug, P('asked'), null)) || [], u = String(url).trim(), old = all.find((a) => a.moveId === String(moveId) && a.url === u);
    if (old) return { ok: true, asked: old, already: true };
    const a = { moveId: String(moveId), url: u, platform: platform || platformOf(u), postedAt: ms(postedAt) || now(), reportedAt: now(), lastRead: null, replies: 0, done: false };
    await packs.put(slug, P('asked'), [...all, a]);
    return { ok: true, asked: a };
  }
  // the next read is due once a checkpoint (1, 3, 7, 14 days after the post) has passed since the last read
  const askedDue = (a, t = now()) => !a.done && ASK_DAYS.some((d) => t >= a.postedAt + d * DAY && (a.lastRead || 0) < a.postedAt + d * DAY);
  async function readThread(a, o) {
    const v = { thread: null, threadUrl: a.url, threadTitle: null, q: 'category', sub: null };
    if (a.platform === 'reddit') { let j; try { j = await getRetry(`${a.url.split('?')[0].replace(/\/$/, '')}.json?limit=500&raw_json=1`, 'json', 25e3); }
      // Reddit refuses the free read from some networks: the paid comments read (newest first) takes its place
      catch (e) { const id = threadOf(a.url); if (!id) throw e; const k = await tcall('tikhub.x.reddit-app-fetch-post-comments', { query: { post_id: `t3_${id}`, need_format: 'true', sort_type: 'NEW' } }, o.capUsd), p = k?.data?.postInfoById || {};
        Object.assign(v, { thread: id, threadTitle: unesc(p.postTitle || ''), sub: p.subreddit?.prefixedName || null });
        return (p.commentForest?.trees || []).map((t) => t.node).filter((n) => n?.id && !n.isRemoved && (n.content?.markdown || n.content?.preview)).map((n) => NORM.redditAppComment(n, v)); }
      const post = j?.[0]?.data?.children?.[0]?.data || {}; Object.assign(v, { thread: post.id || threadOf(a.url), threadTitle: unesc(post.title || ''), sub: post.subreddit ? `r/${post.subreddit}` : null });
      const out = [], walk = (xs) => (xs || []).forEach((ch) => { if (ch.kind !== 't1' || !ch.data?.body || /^\[(removed|deleted)\]$/.test(ch.data.body)) return; out.push(NORM.redditComment(ch.data, v)); walk(ch.data.replies?.data?.children); });
      walk(j?.[1]?.data?.children); return out; }
    if (a.platform === 'x') { const id = (a.url.match(/status\/(\d+)/) || [])[1]; if (!id) throw new Error('no post id in the X link');
      const j = await tcall('anyapi.x.search.posts', { body: { query: `conversation_id:${id}`, limit: 60, queryType: 'Latest' } }, o.capUsd); return (j?.output?.data?.items || []).filter((p) => String(p.id) !== id).map((p) => NORM.xPost(p, 'category')); }
    if (a.platform === 'instagram') { const j = await tcall('anyapi.instagram.post.comments', { body: { url: a.url } }, o.capUsd); Object.assign(v, { thread: `ig-${(a.url.match(/\/(?:p|reel)\/([\w-]+)/) || [])[1]}`, sub: 'Instagram' }); return (j?.output?.data?.comments || []).filter((cm) => cm.id && cm.text).map((cm) => NORM.igComment(cm, v)); }
    if (a.platform === 'tiktok') { const id = (a.url.match(/video\/(\d+)/) || [])[1]; if (!id) throw new Error('no video id in the TikTok link'); Object.assign(v, { thread: `tt-${id}`, sub: 'TikTok' });
      const j = await tcall('tikhub.tiktok.video.comments', { query: { aweme_id: id, count: 50 } }, o.capUsd); return (j?.data?.comments || []).filter((cm) => cm.cid && cm.text).map((cm) => NORM.tiktokComment(cm, v)); }
    if (a.platform === 'youtube') { const id = (a.url.match(/(?:[?&]v=|youtu\.be\/|shorts\/)([\w-]{6,})/) || [])[1]; if (!id) throw new Error('no video id in the YouTube link');
      const j = await tcall('crawl4ai.youtube.video.comments', { body: { video: id, limit: 100 } }, o.capUsd); return (j?.rows || []).filter((cm) => cm.comment_id && cm.text).map((cm) => NORM.ytComment(cm, { id, title: null, channel: 'YouTube', q: 'category' }, now())); }
    if (a.platform === 'facebook') { Object.assign(v, { thread: `fb-${a.url.split('/').filter(Boolean).pop()}`, sub: 'Facebook' }); const j = await tcall('scrapecreators.x.v1-facebook-post-comments', { query: { url: a.url } }, o.capUsd); return (j?.comments || []).filter((cm) => cm?.id && cm.text).map((cm) => NORM.fbComment(cm, v)); }
    throw Object.assign(new Error(`replies on ${sourceName(a.platform) || a.platform} are not read yet`), { needs: true });
  }
  const themesFor = (xs) => Object.entries(countBy(xs.flatMap((x) => (x.themes || []).map((t) => ({ t }))), (y) => y.t)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n }));
  async function askedRun({ force = false, capUsd = 0.1 } = {}) {
    const all = (await packs.getJSON(slug, P('asked'), null)) || [];
    const due = all.filter((a) => force ? !a.done : askedDue(a));
    if (due.length) {
      if (S.busy) return { busy: true };
      S.busy = true; runCost.start = treg?.meter?.usd || 0; runCost.apify = apify?.meter?.usd || 0;
      try {
        const c = await config(), store = (await packs.getJSON(slug, P('items'), null)) || { items: [] }, map = new Map((store.items || []).map((x) => [x.id, x])), fresh = [];
        await each(due, async (a) => { let xs = [];
          try { xs = await readThread(a, { capUsd }); a.error = null; } catch (e) { a.error = e.message.slice(0, 160); if (e.needs) a.done = true; throw e; }
          finally { a.lastRead = now(); if (now() >= a.postedAt + ASK_DAYS[ASK_DAYS.length - 1] * DAY) a.done = true; }
          a.replies = Math.max(a.replies || 0, xs.length);
          for (const x of xs) { if (!x.text || !enough(x)) continue; mergeInto(map, { ...x, mode: 'asked', askedFor: a.moveId, threadUrl: x.threadUrl || a.url }, map.get(x.id)?.about || 'category'); fresh.push(map.get(x.id)); } }, { notes: [] }, 2);
        const todo = fresh.filter((x) => !x.tagged);
        if (todo.length && ai && ai.live !== false) await tag(c, todo, ((await packs.getJSON(slug, P('themes'), null))?.themes || []).map((t) => t.name)).catch((e) => log.warn?.('[listen asked tag]', e.message));
        const items = dedupe([...map.values()]);
        for (const a of due) a.themes = themesFor(items.filter((x) => x.askedFor === a.moveId));
        await packs.put(slug, P('items'), { ...store, at: now(), items });
        await packs.put(slug, P('asked'), all);
      } finally { S.busy = false; }
    }
    // per move: replies heard so far and what they talk about
    const by = {};
    for (const a of all) { const m = (by[a.moveId] ||= { moveId: a.moveId, threads: 0, replies: 0, themes: [], lastRead: null, done: true }); m.threads++; m.replies += a.replies || 0; m.lastRead = Math.max(m.lastRead || 0, a.lastRead || 0) || null; m.done = m.done && !!a.done;
      for (const t of a.themes || []) { const o = m.themes.find((y) => y.name === t.name); if (o) o.n += t.n; else m.themes.push({ ...t }); } }
    Object.values(by).forEach((m) => m.themes.sort((a, b) => b.n - a.n));
    return { read: due.length, moves: Object.values(by), usd: +spent().toFixed(4) };
  }

  async function read() {
    const [i, t, th, cm, st, cf] = await Promise.all(['items', 'threads', 'themes', 'communities', 'status', 'config'].map((n) => packs.getJSON(slug, P(n), null)));
    const F = cf?.filter ? filterOf(cf) : null;
    return { items: (i?.items || []).filter((x) => onTopic(F, x)), threads: t?.threads || [], themes: th?.themes || [], communities: cm?.communities || [], status: st || null, at: i?.at || null };
  }

  // a faceted slice: text search, source (platform), theme, intent, mode (plus about and sentiment), newest first, paged by offset.
  // Each facet counts the items that match every other filter, so a filter list shows what picking it would give.
  async function heard({ q, platform, src, theme, intent, about, sentiment, mode, reach, limit = 50, offset = 0 } = {}) {
    const { items, at } = await read(), re = q ? new RegExp(escRe(String(q).trim()), 'i') : null, as = (v) => (v == null || v === '' ? null : [].concat(v));
    const f = { platform: as(src ?? platform), theme: as(theme), intent: as(intent), about: as(about), sentiment: as(sentiment), mode: as(mode), reach: as(reach) };
    const ok = { q: (x) => !re || re.test(`${x.title || ''} ${x.text} ${x.product || ''} ${x.sub || ''} ${x.author || ''}`), platform: (x) => !f.platform || f.platform.includes(x.platform), theme: (x) => !f.theme || x.themes?.some((t) => f.theme.includes(t)),
      intent: (x) => !f.intent || f.intent.includes(x.intent), about: (x) => !f.about || f.about.includes(x.about), sentiment: (x) => !f.sentiment || f.sentiment.includes(x.sentiment), mode: (x) => !f.mode || f.mode.includes(x.mode || 'heard'), reach: (x) => !f.reach || f.reach.includes(x.reach || reachOf(x)) };
    const but = (skip) => items.filter((x) => Object.entries(ok).every(([k, g]) => k === skip || g(x)));
    const xs = but(null);
    const facet = (dim, fn, n = 30) => { const m = {}; but(dim).forEach((x) => [].concat(fn(x) || []).forEach((v) => { m[v] = (m[v] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, n2]) => ({ k, n: n2 })); };
    const off = Math.max(0, +offset || 0), lim = Math.max(1, Math.min(500, +limit || 50));
    return { n: xs.length, total: items.length, at, offset: off, items: xs.slice(off, off + lim),
      facets: { platform: facet('platform', (x) => x.platform), source: facet('platform', (x) => x.platform).map((s) => ({ ...s, id: s.k, name: sourceName(s.k) })), theme: facet('theme', (x) => x.themes, 60), intent: facet('intent', (x) => x.intent), about: facet('about', (x) => x.about), sentiment: facet('sentiment', (x) => x.sentiment), mode: facet('mode', (x) => x.mode || 'heard'), reach: facet('reach', (x) => x.reach || reachOf(x)) } };
  }
  // what the "What we heard" wall shows: quotes with their source's display name, never a vendor's
  async function itemsView({ src, mode, reach, theme, intent, q, offset = 0, limit = 60 } = {}) {
    const h = await heard({ src, mode, reach, theme, intent, q, offset, limit }), md = Object.fromEntries(h.facets.mode.map((m) => [m.k, m.n])), rc = Object.fromEntries(h.facets.reach.map((m) => [m.k, m.n]));
    return { total: h.n, all: h.total, at: h.at, offset: h.offset,
      items: h.items.map((x) => ({ id: x.id, source: x.platform, platform: x.platform, sourceName: sourceName(x.platform), author: x.author, quote: quoteOf(x), link: x.link, where: x.sub || null, postedAt: x.postedAt || null, rating: x.rating || null,
        themes: x.themes || [], theme: x.themes?.[0] || null, sentiment: x.sentiment || null, intent: x.intent || null, about: x.about || null, mode: x.mode || 'heard', reach: x.reach || reachOf(x), ...(x.askedFor ? { askedFor: x.askedFor } : {}) })),
      sources: h.facets.source.map((s) => ({ id: s.id, name: s.name, n: s.n })), themes: h.facets.theme.map((t) => ({ name: t.k, n: t.n })), modes: { heard: md.heard || 0, asked: md.asked || 0 }, reach: { direct: rc.direct || 0, indirect: rc.indirect || 0 } };
  }

  return { config, run, read, heard, itemsView, tag, history, addAsked, askedRun, askedDue, get busy() { return S.busy; } };
}
