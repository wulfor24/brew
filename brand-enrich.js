// What the brand publishes, read fresh for the Brand Book (paid, capped, and saved once): its latest Instagram posts and reels
// (with plays), its TikToks and the words spoken in its top YouTube films. Every call goes through the shared treg client
// (treg.js: 24-hour cache, one bill), the whole run stops at CAP_USD, and anything permanent (a picture, a video, a transcript)
// is saved once and never fetched again; only the lists and counts refresh, once a week, with the rest of the brand's checks.
// A source that fails keeps its error (the page says it couldn't be read), never an empty "none". Same for every brand.
// Saved as brands/<slug>/enrich.json; brand-book-read.js reads it into the library and the evidence.
import { safeFetch, UA, sha as hash } from './reader/util.js';

export const ENRICH_V = 1, CAP_USD = 0.5, EVERY_MS = 7 * 864e5;
const FILE = 'enrich.json';
const tidy = (s, n = 500) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const handleOf = (u, re) => (String(u || '').match(re) || [])[1] || null;
async function download(u, max) {
  const r = await safeFetch(String(u).replace(/^\/\//, 'https://'), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30e3) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer()); if (!b.length || b.length > max) throw new Error('empty or too big'); return { buf: b, type: r.headers.get('content-type') || '' };
}

export function createEnricher({ packs, treg, log = console, now = () => Date.now(), fetchFile = download }) {
  /* a file saved once by its name; a second run finds it and fetches nothing */
  const keep = async (slug, name, src, max, type) => {
    if (!src) return null; const path = 'assets/' + name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    if ((await packs.get(slug, path).catch(() => null))?.length) return `/b/${slug}/a/${path.slice(7)}`;
    try { const f = await fetchFile(src, max); await packs.put(slug, path, f.buf, f.type || type); return `/b/${slug}/a/${path.slice(7)}`; }
    catch (e) { log.info?.('[enrich] file', name, e.message); return null; }
  };
  async function run(slug, { force = false } = {}) {
    const [profile, prev] = await Promise.all([packs.getJSON(slug, 'profile.json', null).catch(() => null), packs.getJSON(slug, FILE, null).catch(() => null)]);
    if (!profile?.host || profile.closed) return prev;
    if (!force && prev?.v === ENRICH_V && now() - Date.parse(prev.at || 0) < EVERY_MS) return prev;
    if (!treg?.live || !treg.call) return prev || null; /* treg off (local, tests): the book uses what the read saved */
    const u0 = treg.meter?.usd || 0, spent = () => (treg.meter?.usd || 0) - u0, over = () => spent() >= CAP_USD;
    const out = { v: ENRICH_V, at: new Date(now()).toISOString(), ig: null, tiktok: null, yt: { ...(prev?.yt || {}) }, errors: {} };
    const call = (id, body) => treg.call(id, { body, tag: `brandbook:${slug}` });
    /* Instagram: the latest posts (pictures saved), plays on the reels, the top two reels' videos saved */
    const ig = profile.socials?.instagram?.handle || handleOf(profile.socials?.instagram?.url, /instagram\.com\/([A-Za-z0-9._]+)/);
    if (ig && !over()) {
      try {
        const j = await call('crawl4ai.instagram.user.posts', { username: ig, limit: 12 });
        const posts = (j?.rows || []).map((p) => ({ url: p.url, code: p.code || handleOf(p.url, /\/(?:p|reel|tv)\/([\w-]+)/), caption: tidy(p.caption), likes: p.likes ?? null, comments: p.comments ?? null, at: p.taken_at ? String(p.taken_at).slice(0, 10) : null, kind: p.kind || 'post', imageSrc: p.image || null, videoSrc: p.video_url || null }));
        if (!over()) { try { const r = await call('anyapi.instagram.user.reels', { handle: ig }); const plays = new Map((r?.output?.data?.reels || []).map((x) => [x.shortcode, x.views]));
          for (const p of posts) if (plays.has(p.code)) p.views = plays.get(p.code); } catch (e) { out.errors.reels = tidy(e.message, 120); } }
        for (const p of posts) p.img = await keep(slug, `ig-${p.code || hash(p.url)}.jpg`, p.imageSrc, 4e6, 'image/jpeg');
        for (const p of posts.filter((x) => x.videoSrc && /reel|video|clip/i.test(x.kind)).sort((a, b) => (b.views || b.likes || 0) - (a.views || a.likes || 0)).slice(0, 2)) p.video = await keep(slug, `ig-${p.code}-video.mp4`, p.videoSrc, 30e6, 'video/mp4');
        out.ig = { handle: ig, posts: posts.map(({ imageSrc, videoSrc, ...p }) => p) };
      } catch (e) { out.errors.instagram = tidy(e.message, 120); out.ig = prev?.ig || null; }
    }
    /* TikTok: the latest videos with plays, covers saved */
    const tt = handleOf(profile.socials?.tiktok?.url, /tiktok\.com\/@([\w.-]+)/);
    if (tt && !over()) {
      try { const j = await call('crawl4ai.tiktok.user.videos', { account: tt, limit: 12 });
        const vids = (j?.rows || []).map((v) => ({ url: v.url, id: v.post_id, caption: tidy(v.description), views: v.stats?.plays ?? null, likes: v.stats?.likes ?? null, at: v.created_at ? String(v.created_at).slice(0, 10) : null, coverSrc: v.cover || null }));
        for (const v of vids) v.thumb = await keep(slug, `tt-${v.id || hash(v.url)}.jpg`, v.coverSrc, 3e6, 'image/jpeg');
        out.tiktok = { handle: tt, videos: vids.map(({ coverSrc, ...v }) => v) };
      } catch (e) { out.errors.tiktok = tidy(e.message, 120); out.tiktok = prev?.tiktok || null; }
    }
    /* YouTube: what is said in the top three films (how the brand speaks), read once per film */
    for (const v of (profile.socials?.youtube?.videos || []).slice(0, 3)) {
      const id = handleOf(v.url, /[?&]v=([\w-]{11})/) || handleOf(v.url, /youtu\.be\/([\w-]{11})/); if (!id || out.yt[id] || over()) continue;
      try { const j = await call('crawl4ai.youtube.video.captions', { video: id, language: 'any' }); const row = (j?.rows || [])[0];
        out.yt[id] = row?.text ? { title: tidy(v.title, 160), url: v.url, text: tidy(row.text, 6000), auto: !!row.is_auto_generated } : { title: tidy(v.title, 160), url: v.url, none: true }; }
      catch (e) { out.errors[`yt:${id}`] = tidy(e.message, 120); }
    }
    out.usd = +spent().toFixed(4); if (over()) out.capped = true;
    await packs.put(slug, FILE, out); log.info?.(`[enrich] ${slug}: ig ${out.ig?.posts?.length ?? '-'}, tiktok ${out.tiktok?.videos?.length ?? '-'}, films ${Object.keys(out.yt).length}, $${out.usd}`);
    return out;
  }
  return { run, get: (slug) => packs.getJSON(slug, FILE, null).catch(() => null), FILE };
}
