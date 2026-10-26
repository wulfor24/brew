// Socials and films: the brand's own social links (header/footer), YouTube channel top videos (YouTube Data API
// when YOUTUBE_API_KEY is set, else treg crawl4ai), Instagram recent posts (treg crawl4ai). Emits the "Films" card.
import { clean, pathOf, num, pool, brandBase } from '../util.js';
import { CLOSED_WHY } from '../closed.js';

export const SOCIALS_V = 2; // 2: every Instagram picture and YouTube thumbnail saved with the read (they expire on the CDN)
/* 1: a brand whose site links no Instagram or YouTube gets its accounts looked up by search (reader/index.js heal reads it) */
export const SOCIAL_SEARCH_V = 1;

const NET = {
  instagram: /^https?:\/\/(www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(\?|$)/i,
  youtube: /^https?:\/\/(www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/i,
  facebook: /^https?:\/\/(www\.|m\.)?facebook\.com\/(?!sharer|share|dialog|tr\b|plugins)([\w.-]+)/i,
  x: /^https?:\/\/(www\.)?(twitter|x)\.com\/(?!intent|share|home)([\w]+)/i,
  linkedin: /^https?:\/\/(\w+\.)?linkedin\.com\/(company|in|school)\/[\w-]+/i,
  tiktok: /^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+/i,
  pinterest: /^https?:\/\/(\w+\.)?pinterest\.[a-z.]+\/(?!pin\/)[\w-]+/i
};

export async function socials(ctx) {
  const { profile, ledger, state } = ctx;
  const all = [...(state.homeLinks || []), ...[...String(state.home).matchAll(/https?:\/\/(?:www\.)?(?:instagram|youtube|facebook|twitter|x|linkedin|tiktok|pinterest)\.com\/[^\s"'<>\\]+/gi)].map((m) => ({ url: m[0] }))];
  const found = {};
  for (const [k, re] of Object.entries(NET)) { const hits = all.map((l) => l.url).filter((u) => re.test(u) && !/\/(p|reel|reels|watch|shorts|status|posts|share)\//i.test(u)); if (hits.length) found[k] = mostCommon(hits.map((u) => u.split('?')[0].replace(/\/$/, ''))); }
  const prev = profile.socials || {}; /* a heal re-run: an account the brand typed on the check page (or an earlier read found) stays */
  const s = profile.socials = { instagram: null, youtube: null, facebook: null, x: null, linkedin: null, tiktok: null, pinterest: null };
  for (const [k, u] of Object.entries(found)) { s[k] = { url: u }; ledger.add({ key: `social.${k}`, label: `${k} link on the site`, v: u, url: state.homeUrl, method: 'crawl' }); }
  for (const k of ['instagram', 'youtube']) if (!s[k] && prev[k]?.url) { const { posts, videos, error, read, ...keep } = prev[k]; s[k] = keep; }
  if (s.instagram) s.instagram.handle ||= (s.instagram.url.match(NET.instagram) || [])[2] || null;
  /* no link on the site: the brand's own accounts by search (Scrubroom, 24 Oct). Kept only when the handle or the profile's
     name is the brand's; marked as found by search, never as a site link. A search that failed is "not checked", never "none" */
  const missing = ['instagram', 'youtube'].filter((k) => !s[k]);
  if (missing.length && !state.closed) {
    const sr = s.search = { v: SOCIAL_SEARCH_V, at: new Date().toISOString(), looked: missing, found: [] };
    if (!ctx.tregOn) sr.error = 'paid sources off';
    else await Promise.all(missing.map(async (k) => {
      try { const hit = await bySearch(ctx, k); if (!hit) return;
        s[k] = { url: hit.url, via: 'search', q: hit.q, ...(k === 'instagram' ? { handle: (hit.url.match(NET.instagram) || [])[2] || null } : {}) }; sr.found.push(k);
        ledger.add({ key: `social.${k}`, label: `${k} account (found by search; the site doesn't link it)`, v: hit.url, url: hit.url, method: 'treg:crawl4ai.google.serp.organic', note: `search: ${hit.q}` }); }
      catch (e) { sr.error = e.message.slice(0, 120); } }));
  }

  // YouTube: top videos by views
  if (s.youtube) {
    const ch = (s.youtube.url.match(NET.youtube) || [])[2];
    let vids = [], via = null;
    const K = process.env.YOUTUBE_API_KEY;
    try {
      /* Google's API first (free); when it refuses (its daily quota is shared by every brand) or there is no key: treg */
      if (K) vids = await ytApi(ctx, ch, K).then((v) => (via = 'YouTube Data API', v)).catch((e) => { if (!ctx.tregOn) throw e; return []; });
      if (!vids.length && ctx.tregOn) { via = 'treg:crawl4ai.youtube.channel.videos'; const j = await ctx.treg('crawl4ai.youtube.channel.videos', { body: { channel: s.youtube.url, limit: 30 }, timeout: 45e3 }, ch); vids = (j?.rows || []).map((v) => ({ title: clean(v.title), url: v.url, views: v.views ?? null, published: v.published || null, thumbSrc: v.thumbnail })); }
    } catch (e) { s.youtube.error = e.message.slice(0, 120); }
    vids.sort((a, b) => (b.views || 0) - (a.views || 0));
    s.youtube.videos = vids.slice(0, 6); s.youtube.read = vids.length; s.youtube.source = via || (K ? 'YouTube Data API' : 'treg:crawl4ai.youtube.channel.videos');
    await pool(s.youtube.videos.filter((v) => v.thumbSrc), 6, async (v) => { v.thumb = await ctx.asset(v.thumbSrc, 'yt-' + (v.url.match(/v=([\w-]+)/) || [])[1], { max: 3e6 }); });
    if (vids.length) ledger.add({ key: 'social.youtube.top', label: `Most-watched of the ${vids.length} latest YouTube videos`, v: `${vids[0].title} · ${vids[0].views != null ? num(vids[0].views) + ' views' : 'views unknown'}`, n: vids[0].views, unit: 'views', url: vids[0].url, method: K ? 'youtube-api' : 'treg:crawl4ai.youtube.channel.videos' });
  }
  // Instagram: recent posts
  if (s.instagram?.handle && ctx.tregOn) {
    try { const j = await ctx.treg('crawl4ai.instagram.user.posts', { body: { username: s.instagram.handle, limit: 12 }, timeout: 45e3 }, s.instagram.handle);
      const posts = (j?.rows || []).map((p) => ({ url: p.url, caption: clean(p.caption).slice(0, 200), likes: p.likes ?? null, comments: p.comments ?? null, at: p.taken_at ? String(p.taken_at).slice(0, 10) : null, kind: p.kind, imageSrc: p.image }));
      /* every kept picture is saved now: Instagram's CDN links expire in days, and the Brand Book's library and the makers'
         references need them later (the most-liked one is also the Films card's) */
      await pool(posts.filter((p) => p.imageSrc), 6, async (p) => { p.img = await ctx.asset(p.imageSrc, 'ig-' + ((p.url || '').match(/\/(p|reel|tv)\/([\w-]+)/) || [])[2], { max: 4e6 }); });
      s.instagram.posts = posts; s.instagram.v = SOCIALS_V;
      if (posts.length) { const avg = Math.round(posts.reduce((a, p) => a + (p.likes || 0), 0) / posts.length); ledger.add({ key: 'social.instagram.avg_likes', label: `Average likes on the last ${posts.length} Instagram posts`, v: num(avg), n: avg, unit: 'likes', url: s.instagram.url, method: 'treg:crawl4ai.instagram.user.posts', note: `latest post ${posts[0].at || ''}` }); }
    } catch (e) { s.instagram.error = e.message.slice(0, 120); }
  }

  // the Films card: the most-watched video, else the most-liked reel/post
  const v = s.youtube?.videos?.[0];
  const bySearchNote = (k) => s[k]?.via === 'search' ? ' Found by search: the site doesn’t link this account yet.' : '';
  if (v) {
    const thumb = v.thumb || null;
    ctx.finding('answers', { kind: 'film', t: 'Films', src: pathOf(s.youtube.url), img: thumb, url: v.url, cap: `Most watched of the latest ${s.youtube.read}: "${v.title.slice(0, 70)}"${v.views != null ? `, ${num(v.views)} views` : ''}${v.published ? ` (${v.published})` : ''}.${bySearchNote('youtube')}` }, 'Watched the films');
  } else {
    const p = (s.instagram?.posts || []).filter((x) => x.imageSrc).sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];
    if (p) { const img = p.img || null;
      ctx.finding('answers', { kind: 'film', t: 'Films', src: `instagram.com/${s.instagram.handle}`, img, url: p.url, cap: `Most liked of the last ${s.instagram.posts.length} posts: ${p.likes != null ? num(p.likes) + ' likes' : ''}${p.at ? `, ${p.at}` : ''}. "${p.caption.slice(0, 80)}"${bySearchNote('instagram')}` }); }
    else if (s.instagram || s.youtube) { const acc = s.instagram || s.youtube, err = s.instagram?.error || s.youtube?.error; /* an account we know whose posts couldn't be read: say so, never nothing */
      ctx.finding('answers', { kind: 'film', t: 'Films', src: pathOf(acc.url), img: null, url: acc.url, cap: `${acc.via === 'search' ? 'Found by search (the site doesn’t link it). ' : ''}${err || !ctx.tregOn ? 'Its posts couldn’t be read this time; the next refresh tries again.' : 'No posts to show yet.'}` }); }
    else ctx.finding('answers', { kind: 'film', t: 'Films', src: pathOf(state.homeUrl), img: null, cap: state.closed ? `Social links not read: ${CLOSED_WHY}, and its password page links none. We look again once the store opens.` : s.search?.error ? 'No YouTube or Instagram link on the site, and the search for its accounts couldn’t run this time; the next refresh tries again.' : s.search ? `No YouTube or Instagram link on the site, and a search found no account that is ${profile.brandName || profile.name}’s.` : 'No YouTube or Instagram link found on the site.' });
  }
  const named = [...Object.keys(found), ...(s.search?.found || []).map((k) => `${k} (by search)`)];
  ctx.done('socials', named.join(', ') || (state.closed ? `not read: ${CLOSED_WHY}` : s.search?.error ? 'no social links on the site; search not checked' : 'no social links found'));
}

async function ytApi(ctx, ch, K) {
  const g = async (u) => { const r = await ctx.http.get(u + `&key=${K}`, { as: 'json', key: 'yt-' + u.replace(/[^a-z0-9]+/gi, '-').slice(-80) }); if (!r.ok) throw new Error(`YouTube API ${r.status}`); return r.json; };
  let id = ch.startsWith('channel/') ? ch.slice(8) : null;
  if (!id) { const j = await g(`https://www.googleapis.com/youtube/v3/channels?part=id&${ch.startsWith('@') ? 'forHandle=' + encodeURIComponent(ch) : 'forUsername=' + encodeURIComponent(ch.split('/').pop())}`); id = j.items?.[0]?.id; }
  if (!id) return [];
  const pl = await g(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=UU${id.slice(2)}`);
  const ids = (pl.items || []).map((i) => i.contentDetails.videoId); if (!ids.length) return [];
  const vs = await g(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(',')}`);
  return (vs.items || []).map((v) => ({ title: clean(v.snippet.title), url: `https://www.youtube.com/watch?v=${v.id}`, views: +v.statistics.viewCount || 0, published: v.snippet.publishedAt.slice(0, 10), thumbSrc: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.default?.url }));
}
/* one search per network (treg's SERP, cached a day): the first result that is a profile, not a post, whose handle or page
   name is the brand's name or domain, with at most a common tail ("scrubroom.in", "arata_official", "Nutrova India") */
const TAIL = /^(?:in|india|official|offical|store|shop|online|hq|co|club|world|global|app|brand|life|wear|us|uk|tv|channel|videos)*$/;
const squash = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
export function ownAccount(results, k, { name, brandName, host }) {
  const keys = [...new Set([brandName, name, brandBase(name || '', host || ''), String(host || '').replace(/^www\./, '').split('.')[0]].map(squash).filter((x) => x.length >= 3))];
  const isOurs = (h) => { h = squash(h); return !!h && keys.some((key) => h === key || (h.startsWith(key) && TAIL.test(h.slice(key.length)))); };
  for (const r of results || []) {
    const url = String(r.url || '').split('?')[0].replace(/\/$/, ''), m = url.match(NET[k]);
    if (!m || /\/(p|reel|reels|watch|shorts|status|posts|share|explore|stories|playlist|hashtag)\b/i.test(url)) continue;
    const handle = k === 'instagram' ? m[2] : m[2].replace(/^(@|c\/|user\/)/, '');
    const shown = String(r.title || '').split(/\s+[(•|·-]\s*|\s+-\s+YouTube|\s+\(@/)[0]; /* "Scrub Room (@scrubroom.in) • Instagram photos" → "Scrub Room" */
    if ((!/^channel\//.test(m[2]) && isOurs(handle)) || isOurs(shown)) return url;
  }
  return null;
}
async function bySearch(ctx, k) {
  const { profile } = ctx, cc = (profile.country || 'US').toLowerCase(), who = profile.brandName || brandBase(profile.name || '', profile.host || '') || profile.name;
  if (!who) return null;
  const q = `${who} ${k === 'instagram' ? 'instagram' : 'youtube channel'}`;
  const j = await ctx.treg('crawl4ai.google.serp.organic', { query: { q, country: cc, num: 10 } }, `${cc}-${q}`); /* throws on failure: the caller marks the search not checked */
  const url = ownAccount(j?.results, k, profile);
  if (url || k !== 'instagram') return url ? { url, q } : null;
  /* a small account: Google lists its posts, not its profile. When the brand's name and its domain spell the same handle
     ("Cozy Snugglet", cozysnugglet.shop), that exact account is read: it counts only if it has posts (the stage's own posts
     read, cached a day, so it is not paid twice) */
  const name = squash(who), stem = squash(String(profile.host || '').replace(/^www\./, '').split('.')[0]);
  if (name.length < 6 || name !== stem) return null;
  const p = await ctx.treg('crawl4ai.instagram.user.posts', { body: { username: stem, limit: 12 }, timeout: 45e3 }, stem).catch(() => null);
  return p?.rows?.length ? { url: `https://www.instagram.com/${stem}`, q: `${q}; then @${stem}, the handle its name and domain share` } : null;
}
const mostCommon = (xs) => { const m = new Map(); xs.forEach((x) => m.set(x.toLowerCase(), [(m.get(x.toLowerCase())?.[0] || 0) + 1, x])); return [...m.values()].sort((a, b) => b[0] - a[0])[0][1]; };
