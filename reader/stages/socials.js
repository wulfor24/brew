// Socials and films: the brand's own social links (header/footer), YouTube channel top videos (YouTube Data API
// when YOUTUBE_API_KEY is set, else treg crawl4ai), Instagram recent posts (treg crawl4ai). Emits the "Films" card.
import { clean, pathOf, num, pool } from '../util.js';
import { CLOSED_WHY } from '../closed.js';

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
  const s = profile.socials = { instagram: null, youtube: null, facebook: null, x: null, linkedin: null, tiktok: null, pinterest: null };
  for (const [k, u] of Object.entries(found)) { s[k] = { url: u }; ledger.add({ key: `social.${k}`, label: `${k} link on the site`, v: u, url: state.homeUrl, method: 'crawl' }); }
  if (s.instagram) s.instagram.handle = (s.instagram.url.match(NET.instagram) || [])[2] || null;

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
    if (vids.length) ledger.add({ key: 'social.youtube.top', label: `Most-watched of the ${vids.length} latest YouTube videos`, v: `${vids[0].title} · ${vids[0].views != null ? num(vids[0].views) + ' views' : 'views unknown'}`, n: vids[0].views, unit: 'views', url: vids[0].url, method: K ? 'youtube-api' : 'treg:crawl4ai.youtube.channel.videos' });
  }
  // Instagram: recent posts
  if (s.instagram?.handle && ctx.tregOn) {
    try { const j = await ctx.treg('crawl4ai.instagram.user.posts', { body: { username: s.instagram.handle, limit: 12 }, timeout: 45e3 }, s.instagram.handle);
      const posts = (j?.rows || []).map((p) => ({ url: p.url, caption: clean(p.caption).slice(0, 200), likes: p.likes ?? null, comments: p.comments ?? null, at: p.taken_at ? String(p.taken_at).slice(0, 10) : null, kind: p.kind, imageSrc: p.image }));
      s.instagram.posts = posts;
      if (posts.length) { const avg = Math.round(posts.reduce((a, p) => a + (p.likes || 0), 0) / posts.length); ledger.add({ key: 'social.instagram.avg_likes', label: `Average likes on the last ${posts.length} Instagram posts`, v: num(avg), n: avg, unit: 'likes', url: s.instagram.url, method: 'treg:crawl4ai.instagram.user.posts', note: `latest post ${posts[0].at || ''}` }); }
    } catch (e) { s.instagram.error = e.message.slice(0, 120); }
  }

  // the Films card: the most-watched video, else the most-liked reel/post
  const v = s.youtube?.videos?.[0];
  if (v) {
    const thumb = v.thumbSrc ? await ctx.asset(v.thumbSrc, 'yt-' + (v.url.match(/v=([\w-]+)/) || [])[1], { max: 3e6 }) : null; v.thumb = thumb;
    ctx.finding('answers', { kind: 'film', t: 'Films', src: pathOf(s.youtube.url), img: thumb, url: v.url, cap: `Most watched of the latest ${s.youtube.read}: "${v.title.slice(0, 70)}"${v.views != null ? `, ${num(v.views)} views` : ''}${v.published ? ` (${v.published})` : ''}.` }, 'Watched the films');
  } else {
    const p = (s.instagram?.posts || []).filter((x) => x.imageSrc).sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];
    if (p) { const img = await ctx.asset(p.imageSrc, 'ig-' + (p.url.match(/\/(p|reel)\/([\w-]+)/) || [])[2], { max: 4e6 }); p.img = img;
      ctx.finding('answers', { kind: 'film', t: 'Films', src: `instagram.com/${s.instagram.handle}`, img, url: p.url, cap: `Most liked of the last ${s.instagram.posts.length} posts: ${p.likes != null ? num(p.likes) + ' likes' : ''}${p.at ? `, ${p.at}` : ''}. "${p.caption.slice(0, 80)}"` }); }
    else if (!s.youtube && !s.instagram) ctx.finding('answers', { kind: 'film', t: 'Films', src: pathOf(state.homeUrl), img: null, cap: state.closed ? `Social links not read: ${CLOSED_WHY}, and its password page links none. Brew looks again once the store opens.` : 'No YouTube or Instagram link found on the site.' });
  }
  ctx.done('socials', Object.keys(found).join(', ') || (state.closed ? `not read: ${CLOSED_WHY}` : 'no social links found'));
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
const mostCommon = (xs) => { const m = new Map(); xs.forEach((x) => m.set(x.toLowerCase(), [(m.get(x.toLowerCase())?.[0] || 0) + 1, x])); return [...m.values()].sort((a, b) => b[0] - a[0])[0][1]; };
