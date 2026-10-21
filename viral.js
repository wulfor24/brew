// Viral videos the brand's audience watches, to "make our version" of (research.js refreshViral uses it). For ANY brand.
// Sources (all live): TikTok search (tikhub), Instagram reels search (anyapi), YouTube Shorts (YouTube Data API with
// YOUTUBE_API_KEY, free quota). Each candidate is scored against its creator's usual views (viral-gate.js usualViews): the
// creator's recent posts, TikTok tikhub.tiktok.user.videos, Instagram anyapi.instagram.user.reels, YouTube channel totals.
// Every treg call goes through the caller's `call` (the shared client: 24-hour cache, one meter). A source that fails is an error
// on the result, never an empty list; an unknown count stays null (viral-gate). About $0.05 a brand a read.
import { preViral, usableViral, usualViews, scoreOf, pickViral } from './viral-gate.js';

const num = (x) => (x == null || x === '' || !Number.isFinite(+x) ? null : +x);
const sec = (t) => (t ? (+t > 1e12 ? +t : +t * 1e3) : 0);
const iso = (d) => { const m = String(d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null; };
/* the play counts in any provider's rows (they nest them differently) */
function playsIn(j, keys = ['play_count', 'playCount', 'views', 'video_view_count', 'play_count_v2']) {
  const out = []; (function walk(x, d) { if (!x || typeof x !== 'object' || d > 8) return; if (Array.isArray(x)) return x.forEach((y) => walk(y, d + 1));
    const k = keys.find((kk) => x[kk] != null && Number.isFinite(+x[kk])); if (k && (x.id || x.aweme_id || x.shortcode || x.code || x.video || x.desc != null || x.caption != null || x.stats)) { out.push(+x[k]); return; }
    if (x.stats && x.stats.playCount != null) { out.push(+x.stats.playCount); return; } Object.values(x).forEach((y) => walk(y, d + 1)); })(j, 0);
  return out;
}

export const NORMV = {
  tiktok: (a, q) => { const u = a.author || {}, s = a.statistics || {}, v = a.video || {};
    return { id: `tt:${a.aweme_id}`, platform: 'tiktok', url: `https://www.tiktok.com/@${u.unique_id || 'user'}/video/${a.aweme_id}`, author: u.nickname || u.unique_id || 'TikTok creator', handle: u.unique_id ? `@${u.unique_id}` : null, secUid: u.sec_uid || null,
      views: num(s.play_count), likes: num(s.digg_count), comments: num(s.comment_count), postedAt: sec(a.create_time), caption: String(a.desc || '').slice(0, 600), thumb: v.cover?.url_list?.[0] || v.origin_cover?.url_list?.[0] || null,
      durationS: num(v.duration) == null ? null : (+v.duration > 1000 ? Math.round(+v.duration / 1000) : +v.duration), paid: !!(a.is_ads || a.commerce_info?.is_ad || a.ad_aweme_source), q }; },
  instagram: (r, q) => ({ id: `ig:${r.shortcode || r.id}`, platform: 'instagram', url: r.url || `https://www.instagram.com/reel/${r.shortcode}/`, author: r.displayName || r.username || 'Instagram creator', handle: r.username ? `@${r.username}` : null,
    views: num(r.views), likes: num(r.likes), comments: num(r.comments), postedAt: sec(r.createdUtc), caption: String(r.caption || '').slice(0, 600), thumb: r.thumbnail || null, durationS: num(r.durationSeconds), paid: !!r.paidPartnership, q }),
  youtube: (v, q) => ({ id: `yt:${v.id}`, platform: 'youtube', url: `https://www.youtube.com/shorts/${v.id}`, author: v.snippet?.channelTitle || 'YouTube creator', handle: v.snippet?.channelTitle || null, channelId: v.snippet?.channelId || null,
    views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount), postedAt: Date.parse(v.snippet?.publishedAt) || 0, caption: `${v.snippet?.title || ''}\n${v.snippet?.description || ''}`.slice(0, 600),
    thumb: v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.default?.url || null, durationS: iso(v.contentDetails?.duration), paid: !!v.paidProductPlacementDetails?.hasPaidProductPlacement, q })
};

export function createViralFinder({ call, ytKey = process.env.YOUTUBE_API_KEY, fetchFn = fetch, log = console } = {}) {
  const yt = async (p, q) => { const r = await fetchFn(`https://www.googleapis.com/youtube/v3/${p}?${new URLSearchParams({ ...q, key: ytKey })}`, { signal: AbortSignal.timeout(20e3) }); if (!r.ok) throw new Error(`youtube ${p} ${r.status}`); return r.json(); };
  const SEARCH = {
    async tiktok(q, c) { const j = await call('tikhub.tiktok.search.videos', { query: { keyword: q, count: 20, region: c.country || 'US', sort_type: 0, publish_time: 90 } });
      return (j?.data?.search_item_list || j?.data?.aweme_list || []).map((it) => it.aweme_info || it).filter((a) => a?.aweme_id).map((a) => NORMV.tiktok(a, q)); },
    async instagram(q) { const j = await call('anyapi.instagram.search.reels', { body: { query: q } }); return (j?.output?.data?.reels || []).filter((r) => r.shortcode || r.id).map((r) => NORMV.instagram(r, q)); },
    async youtube(q, c) { if (!ytKey) throw new Error('no YouTube key');
      const s = await yt('search', { part: 'snippet', type: 'video', videoDuration: 'short', order: 'viewCount', maxResults: '15', regionCode: c.country || 'US', publishedAfter: new Date(Date.now() - 90 * 864e5).toISOString(), q });
      const ids = (s.items || []).map((x) => x.id?.videoId).filter(Boolean); if (!ids.length) return [];
      const v = await yt('videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') }); return (v.items || []).map((x) => NORMV.youtube(x, q)); }
  };
  /* the creator's usual views (null when it can't be read: the video is then left out, never scored on a guess) */
  const USUAL = {
    async tiktok(v) { if (!v.secUid) return null; const j = await call('tikhub.tiktok.user.videos', { query: { secUid: v.secUid, count: 15 } }); return usualViews(playsIn(j), v.views); },
    async instagram(v) { if (!v.handle) return null; const j = await call('anyapi.instagram.user.reels', { body: { handle: v.handle.replace(/^@/, '') } }); return usualViews((j?.output?.data?.reels || []).map((r) => r.views), v.views); },
    /* YouTube: the channel's own totals (views ÷ videos), free; a channel hiding its counts is unknown */
    async youtube(v) { if (!v.channelId) return null; const j = await yt('channels', { part: 'statistics', id: v.channelId }); const s = j.items?.[0]?.statistics || {};
      const n = num(s.videoCount), t = num(s.viewCount); return n && n >= 3 && t != null ? Math.max(1, Math.round((t - (v.views || 0)) / Math.max(1, n - 1))) : null; }
  };
  /* terms: the brand's category words; interests: what the brand's buyers also watch (research.js audienceInterests), searched
     in place of category words so the spend stays the same: 2 category + 2 interest searches on TikTok and Instagram, YouTube's
     one search on the category; country: the selling market; stems/own from viral-gate */
  async function find({ terms = [], interests = [], country = 'US', stems = [], own = [], platforms = ['tiktok', 'instagram', 'youtube'], n = 3, lookups = 8, now = Date.now() } = {}) {
    const qs = (p) => p === 'youtube' ? terms.slice(0, 1) : interests.length ? [...terms.slice(0, Math.max(2, 4 - Math.min(2, interests.length))), ...interests.slice(0, 2)].slice(0, 4) : terms.slice(0, 4), gate = { now, country, stems, own, interests };
    const errors = {}, found = new Map(), checked = {};
    await Promise.all(platforms.map(async (p) => { let ok = 0; checked[p] = 0;
      for (const q of qs(p)) { /* a YouTube search is 100 of the key's 10,000 daily units (listening shares them): one term a read */ try { for (const x of await SEARCH[p](q, { country })) if (!found.has(x.id)) found.set(x.id, x); ok++; checked[p]++; } catch (e) { errors[p] = e.message.slice(0, 160); log.warn?.('[viral] search', p, q, e.message.slice(0, 160)); } }
      if (ok) delete errors[p]; }));
    const all = [...found.values()], pre = all.filter((x) => preViral(x, gate).ok).sort((a, b) => b.views - a.views);
    /* usual views only for the best few per platform (each lookup is a paid call) */
    const isAdj = (x) => interests.some((i) => i.toLowerCase() === String(x.q || '').toLowerCase());
    const look = []; for (const p of platforms) { const k = Math.ceil(lookups / platforms.length), mine = pre.filter((x) => x.platform === p), a = mine.find(isAdj); /* one of the platform's lookups goes to its best audience-interest find */
      look.push(...(a && !mine.slice(0, k).includes(a) ? [...mine.filter((x) => x !== a).slice(0, k - 1), a] : mine.slice(0, k))); }
    await Promise.all(look.map(async (x) => { try { x.usual = await USUAL[x.platform](x); } catch (e) { x.usual = null; x.usualError = e.message.slice(0, 120); } x.score = scoreOf(x.views, x.usual); }));
    const ok = look.filter((x) => usableViral(x, gate).ok); ok.forEach((x) => { x.interest = interests.find((i) => i.toLowerCase() === String(x.q || '').toLowerCase()) || null; });
    /* the best videos win; when none of them came from an audience interest and one passed, it takes the last seat */
    const items = pickViral(ok, n), adj = !items.some((x) => x.interest) && pickViral(ok.filter((x) => x.interest), 1)[0];
    if (adj && items.length >= n) items[items.length - 1] = adj; else if (adj) items.push(adj);
    return { items, seen: all.length, passed: pre.length, scored: look.filter((x) => x.score != null).length, errors, checked };
  }
  return { find };
}
