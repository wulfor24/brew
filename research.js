// Real research behind the story rings and the Trends / Popular ads watchers.
// Sources (all live, nothing invented):
//   Popular ads  · Meta Ad Library via treg (ScrapeCreators company ads, India, sorted by impressions)
//   Trends       · Google Trends via treg (DataForSEO series, SerpApi rising queries), India, 90 days
//   What is new  · Claude with web search: category, rival and ad-platform news from the last 3 weeks
//   How to       · Claude playbooks written from this week's ads and trends, with a generated cover
// One shared snapshot for every tenant. Like Instagram stories, each item lives 24 hours from when Brew first saw it, and the
// sources are re-read through the day (EVERY below) so new items keep arriving; feed-service ranks them and drops weak ones. Media is
// downloaded because Ad Library URLs expire. Snapshot + media persist to GCS so a restart or a deploy
// refetches nothing; the last good data stays up if a refresh fails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { adCall } from './reader/adlib.js';
import { providerNow, GEMINI, GEMINI_PRICE } from './gemini-client.js';

const D = 24 * 3600e3, H = 3600e3;
// how often each story source is re-read (hours); STORY_EVERY_<KEY> overrides one
const EVERY = { ads: 6, own: 12, trends: 6, news: 4, howto: 12 };
const every = (k) => (+process.env[`STORY_EVERY_${k.toUpperCase()}`] || EVERY[k] || 24) * H;
// a story's key across re-reads, so one seen again keeps the time it was first seen
const KEY = { ads: (x) => `ad:${x.id}`, trends: (x) => `tr:${x.kind}:${[...(x.terms || [])].sort().join('|') || (x.kind === 'rising' && x.risingOf) || String(x.h).toLowerCase()}`, news: (x) => `nw:${String(x.url).replace(/[?#].*$/, '').replace(/\/$/, '')}`, howto: (x) => `ht:${String(x.h).toLowerCase()}` };
/* merge a fresh read into the last one: items seen before keep firstSeen; items not in this read stay while they are under
   24 hours old (a story posted today stays up today); older ones fall off */
/* two trend or how-to stories that say nearly the same thing (most of their words shared) are one story: the ids differ by
   day or wording, so the exact key alone let "How to win hair-fall searches" and "How to win the hair fall search" both show */
const STOPW = new Set('the a an and or for with your you our its to of in on at by from this that what how why is are was be up down more most than into new now week this today ad ads test make build launch target capture win run use get try add put search rising rise trend angle idea surge growing grow'.split(' '));
const stem = (w) => w.replace(/(ing|es|s)$/, '');
const words = (x) => new Set(String([x.h, ...(x.terms || []), x.risingOf || ''].join(' ')).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPW.has(w)).map(stem).filter((w) => !STOPW.has(w)));
export const near = (a, b) => { const A = words(a), B = words(b); if (A.size < 2 || B.size < 2) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n >= 2 && n / Math.min(A.size, B.size) >= 0.6; };
const NEAR = new Set(['trends', 'howto']);
export function pool(prev, items, k, now = Date.now()) {
  const key = KEY[k] || ((x) => x.id), oldItems = prev?.items || [], seen = new Set();
  /* a fresh story near an older one takes the older one's key, so it keeps its first-seen time and replaces it, never sits beside it */
  const twin = (x) => (NEAR.has(k) ? oldItems.find((o) => key(o) !== key(x) && near(o, x)) : null);
  const old = new Map(oldItems.map((x) => [key(x), x]));
  items = items.filter((x, i) => items.findIndex((y) => key(y) === key(x)) === i && !(NEAR.has(k) && items.slice(0, i).some((y) => near(x, y))));
  const fresh = items.map((x) => { const o = old.get(key(x)) || twin(x); seen.add(key(x)); if (o) seen.add(key(o)); return { ...x, firstSeen: o?.firstSeen || prev?.firstSeenOf?.[key(x)] || now }; });
  const kept = [...old.entries()].filter(([kk, x]) => !seen.has(kk) && now - (x.firstSeen || prev?.fetchedAt || 0) < D).map(([, x]) => x);
  /* remember when everything was first seen for 3 days, so an item that drops out and comes back is not new again */
  const firstSeenOf = Object.fromEntries([...Object.entries(prev?.firstSeenOf || {}), ...[...fresh, ...kept].map((x) => [key(x), x.firstSeen])].filter(([, at]) => now - at < 3 * D));
  /* a story that leaves the ring is not thrown away: it goes to the archive (30 days, newest 80), where the feed can still pick it
     up as a card later if it ranks (feed-service fromResearch); expiry only ends its life as a story */
  const live = new Set([...fresh, ...kept].map(key)), gone = [...old.entries()].filter(([kk]) => !seen.has(kk) && !kept.some((x) => key(x) === kk)).map(([, x]) => x);
  const archive = [...gone, ...(prev?.archive || [])].filter((x, i, a) => !live.has(key(x)) && a.findIndex((y) => key(y) === key(x)) === i && now - (x.firstSeen || 0) < 30 * D).slice(0, 80);
  return { items: [...fresh, ...kept], firstSeenOf, archive };
}
export const noPaise = (s) => String(s ?? '').replace(/((?:₹|\bRs\.?|\bINR)\s?)(\d[\d,]*)\.(\d{1,2})\b/g, (m, c, n, p) => c + Math.round(+n.replace(/,/g, '') + +p.padEnd(2, '0') / 100).toLocaleString('en-IN'));
const BUCKET = process.env.RESEARCH_BUCKET || 'brew-prototype';
// One research instance per brand (server.js makes it when the brand pack loads). Its snapshot lives at
// brands/<slug>/research.json; downloaded media is shared by hash at research-media/<file> (served as /research/<file>).
export function createResearch({ ROOT, PUB, anthropic, claudeParams, textOf, geminiImage, gToken, clean, factBrief = () => '', brand, photoFile = (rel) => path.join(PUB, rel), tregClient = null, log = console }) {
  const B = () => brand, BN = () => brand.name, BH = () => brand.host, CTRY = () => brand.config.countryName || 'your market', FESTN = () => brand.config.festival?.name || 'the next sale', FESTD = () => brand.config.festival?.label || 'soon';
  const cfg = brand.config, GEO = cfg.country || 'IN', LOC = cfg.locationCode || 2356;
  /* story text never shows paise: "₹499.00" reads "₹499" (rupee prices are whole; a scraped ".00" is noise) */
  const tidy = clean; clean = (s) => noPaise(tidy(s));
  const RIVAL_PAGES = (cfg.rivals || []).map((name) => ({ name, match: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }));
  const TERMS = cfg.terms || [], RISING = cfg.rising || [], DIWALI = brand.festivalAt || 0, LANE_PHOTO = brand.lanePhoto || {};
  /* the product photo a cover is made from: the lane photo, else the seed's lane image (most generated brands only have these);
     none means no cover (the playbook shows its steps), never a picture made without the real product */
  const refPhoto = (lane) => { const li = brand.seed?.laneImg || {}; return LANE_PHOTO[lane] || Object.values(LANE_PHOTO)[0] || li[lane] || Object.values(li)[0] || null; };
  const SNAP = `brands/${brand.slug}/research.json`;
  const MEDIA = path.join(PUB, 'research');
  const LOCAL = path.join(ROOT, '.research', brand.slug);
  fs.mkdirSync(MEDIA, { recursive: true }); fs.mkdirSync(LOCAL, { recursive: true });
  let snap = { ads: null, own: null, trends: null, news: null, howto: null };
  const listeners = [];
  const running = new Set();
  const spent = { treg: 0, claude: 0, images: 0 };

  /* ---------- treg ---------- */
  const tregAuth = () => {
    if (process.env.TREG_TOKEN) return { token: process.env.TREG_TOKEN, org: process.env.TREG_ORG || 'squareup' };
    try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.treg', 'config.json'), 'utf8')); return { token: c.token, org: c.active_org || 'squareup' }; } catch { return null; }
  };
  // every call goes through the shared client when there is one (its 24-hour cache, one balance and meter); the
  // Ad Library falls back to the free page reader when treg fails, so research never loses ads to a 402
  async function treg(id, o = {}) {
    if (/facebook-adlibrary/.test(id)) return adCall({ call: tregRaw }, id, o);
    return tregRaw(id, o);
  }
  async function tregRaw(id, { query, body, timeout = 150e3 } = {}) {
    if (tregClient) { const u0 = tregClient.meter.usd; try { return await tregClient.call(id, { query, body, timeout, tag: `research-${brand.slug}` }); } finally { spent.treg += tregClient.meter.usd - u0; } }
    const a = tregAuth(); if (!a?.token) throw new Error('no TREG_TOKEN');
    const u = new URL(`https://treg.to/call/${id}`);
    Object.entries(query || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await fetch(u, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(timeout),
        headers: { 'X-Treg-Token': a.token, 'X-Treg-Org': a.org, 'X-Treg-Client': 'shopos-feed', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      spent.treg += +(r.headers.get('x-treg-cost-micro') || 0) / 1e6;
      if (r.ok) return r.json();
      const t = (await r.text()).slice(0, 200);
      if (attempt === 2 || r.status < 500) throw new Error(`treg ${id} ${r.status}: ${t}`);
    }
  }

  /* ---------- storage: local disk + GCS ---------- */
  const gcs = async (method, name, buf, type) => {
    const tk = await gToken();
    const url = method === 'PUT'
      ? `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`
      : `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media`;
    const r = await fetch(url, { method: method === 'PUT' ? 'POST' : 'GET', headers: { authorization: `Bearer ${tk}`, ...(buf ? { 'content-type': type || 'application/octet-stream' } : {}) }, body: buf, signal: AbortSignal.timeout(60e3) });
    if (!r.ok) throw new Error(`gcs ${method} ${name} ${r.status}`);
    return method === 'PUT' ? true : Buffer.from(await r.arrayBuffer());
  };
  const uploaded = new Set();
  const typeOf = (n) => (n.endsWith('.mp4') ? 'video/mp4' : n.endsWith('.png') ? 'image/png' : 'image/jpeg');
  const upload = (name) => { if (uploaded.has(name)) return; uploaded.add(name); const f = path.join(MEDIA, name); if (fs.existsSync(f)) gcs('PUT', 'research-media/' + name, fs.readFileSync(f), typeOf(name)).catch((e) => { uploaded.delete(name); log.warn('[research] gcs media', e.message); }); };
  const saveMedia = async (buf, ext) => {
    const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) + ext;
    const f = path.join(MEDIA, name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
    upload(name);
    return 'research/' + name;
  };
  // the static server calls this for /research/<file> that is not on this instance's disk yet
  const mediaFile = async (name) => {
    if (!/^[a-f0-9]{20}\.(jpg|png|mp4)$/.test(name)) return null;
    const f = path.join(MEDIA, name); if (fs.existsSync(f)) return f;
    try { fs.writeFileSync(f, await gcs('GET', 'research-media/' + name).catch(() => gcs('GET', 'media/' + name))); return f; } catch { return null; }
  };
  const persist = () => {
    const buf = Buffer.from(JSON.stringify(snap));
    // every file the snapshot points at must be in the bucket, or another instance can't serve it
    (buf.toString().match(/research\/[a-f0-9]{20}\.(?:jpg|png|mp4)/g) || []).forEach((p) => upload(p.slice(9)));
    fs.writeFileSync(path.join(LOCAL, 'snapshot.json'), buf);
    gcs('PUT', SNAP, buf, 'application/json').catch((e) => log.warn('[research] gcs snapshot', e.message));
  };
  const load = async () => {
    let s = null;
    try { s = JSON.parse((await gcs('GET', SNAP)).toString()); } catch (e) { log.warn('[research] no gcs snapshot:', e.message); }
    if (!s) try { s = JSON.parse(fs.readFileSync(path.join(LOCAL, 'snapshot.json'), 'utf8')); } catch {}
    if (s) snap = { ...snap, ...s };
    log.log(`[research] ${brand.slug} loaded: ${Object.entries(snap).map(([k, v]) => `${k} ${v?.fetchedAt ? new Date(v.fetchedAt).toISOString().slice(0, 16) : 'none'}`).join(', ')}`);
  };

  const fetchBuf = async (url, max = 20e6) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(45e3), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36' } });
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    const len = +(r.headers.get('content-length') || 0); if (len > max) throw new Error('too big');
    const b = Buffer.from(await r.arrayBuffer()); if (b.length > max) throw new Error('too big'); return b;
  };
  const imgExt = (b) => (b[0] === 0x89 && b[1] === 0x50 ? '.png' : '.jpg');
  const mime = (b) => (imgExt(b) === '.png' ? 'image/png' : 'image/jpeg');

  /* ---------- Claude ---------- */
  const parseJSON = (t) => { const a = t.indexOf('{'), b = t.lastIndexOf('}'); return JSON.parse(t.slice(a, b + 1)); };
  async function claude(content, { max = 4000, tools } = {}) {
    if (!anthropic) throw new Error('no Claude key');
    const messages = [{ role: 'user', content }];
    for (let turn = 0; turn < 4; turn++) {
      const p = claudeParams(messages, max); if (tools) p.tools = tools;
      const msg = await anthropic.beta.messages.create(p);
      const [pin, pout] = providerNow() === 'anthropic' ? [3, 15] : GEMINI_PRICE[GEMINI.fast] || [0.5, 3]; /* the meter prices the model that ran */
      spent.claude += ((msg.usage?.input_tokens || 0) * pin + (msg.usage?.output_tokens || 0) * pout) / 1e6;
      if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue; }
      if (msg.stop_reason === 'refusal') throw new Error('refused');
      return { msg, text: textOf(msg) };
    }
    throw new Error('too many turns');
  }

  /* ---------- Popular ads ---------- */
  const strip = (s) => String(s || '').replace(/\{\{[^}]+\}\}/g, '').replace(/\s+\n/g, '\n').trim();
  const adCopy = (a) => { const s = a.snapshot || {}; const c = (s.cards || [])[0] || {}; return { body: noPaise(strip(s.body?.text || c.body)), title: noPaise(strip(s.title || c.title)), cta: s.cta_text || c.cta_text || '', link: s.link_url || c.link_url || '', caption: s.caption || '' }; };
  const adMedia = (a) => {
    const s = a.snapshot || {}; const cards = s.cards || [];
    const v = (s.videos || [])[0] || cards.find((x) => x.video_sd_url || x.video_hd_url);
    const im = (s.images || [])[0]; const ci = cards.find((x) => x.original_image_url || x.resized_image_url);
    return { video: v?.video_sd_url || v?.video_hd_url || null, poster: v?.video_preview_image_url || im?.original_image_url || im?.resized_image_url || ci?.original_image_url || ci?.resized_image_url || null };
  };
  async function refreshAds() {
    const now = Date.now(); const brands = [];
    const res = await Promise.allSettled(RIVAL_PAGES.map((b) => treg('scrapecreators.x.v1-facebook-adlibrary-company-ads', { query: { companyName: b.name, country: GEO, status: 'ACTIVE' } }).then((j) => ({ b, j }))));
    let groups = [];
    for (const r of res) {
      if (r.status !== 'fulfilled') { log.warn('[research] ads', r.reason?.message); continue; }
      const { b, j } = r.value; const rows = (j.results || []).filter((a) => b.match.test(a.page_name || a.snapshot?.page_name || ''));
      if (!rows.length) continue;
      brands.push({ name: b.name, live: j.searchResultsCount || rows.length, page: rows[0].page_name, pageId: rows[0].page_id, avatar: rows[0].snapshot?.page_profile_picture_url || null });
      // Meta's order is by impressions; group DCO variants that share copy into one creative idea
      const g = new Map();
      rows.forEach((a, rank) => {
        const cp = adCopy(a); const key = (cp.title + '|' + cp.body.slice(0, 90)).toLowerCase();
        const m = adMedia(a); if (!m.poster) return;
        if (!g.has(key)) g.set(key, { brand: b.name, rank, ad: a, copy: cp, media: m, versions: 0, start: Infinity, ids: [] });
        const x = g.get(key); x.versions += Math.max(1, a.collation_count || 1); x.start = Math.min(x.start, (a.start_date || now / 1000) * 1000); x.ids.push(a.ad_archive_id);
      });
      groups.push(...[...g.values()].map((x) => ({ ...x, days: Math.max(1, Math.round((now - x.start) / D)), score: (30 - x.rank) / 3 + Math.log2(1 + x.versions) * 4 + Math.min(x.days || 0, 120) / 10 })));
    }
    groups.forEach((x) => (x.score = (30 - x.rank) / 3 + Math.log2(1 + x.versions) * 4 + Math.min(x.days, 120) / 10));
    if (!groups.length) throw new Error('no ads came back');
    // top 8, at most 2 per brand, interleaved so the ring is not one advertiser
    groups.sort((a, b) => b.score - a.score);
    const per = {}; const pick = [];
    for (const x of groups) { if ((per[x.brand] || 0) >= 2) continue; per[x.brand] = (per[x.brand] || 0) + 1; pick.push(x); if (pick.length >= 8) break; }
    // media: poster always, video when it is a video ad
    await Promise.all(pick.map(async (x) => {
      try { const b = await fetchBuf(x.media.poster, 6e6); x.posterBuf = b; x.poster = await saveMedia(b, imgExt(b)); } catch (e) { log.warn('[research] poster', e.message); }
      if (x.media.video) try { x.videoFile = await saveMedia(await fetchBuf(x.media.video, 25e6), '.mp4'); } catch (e) { log.warn('[research] video', e.message); }
    }));
    const ok = pick.filter((x) => x.poster);
    // Claude reads each creative and says why it works and what the brand should take from it
    const content = [{ type: 'text', text: `${factBrief()}\n\nYou are the Performance marketer agent for ${BN()} (${B().config.category}). Below are ${ok.length} ads live right now in ${CTRY()} on Meta, from rivals, in Meta's own impressions order. For each: the image (a video ad shows its first frame), the copy, how long it has run and how many versions run.\nFor each ad return:\n- "title": a story headline under 46 chars that names the brand and the idea, e.g. Traya: the hair-fall stage test\n- "hook": the opening line or on-image text, quoted, under 12 words\n- "angle": 1 to 3 words (test-first, doctor proof, ingredient, offer, review, founder)\n- "why": one sentence under 24 words on why it is likely working, using the evidence (days live, versions, copy)\n- "take": one sentence under 22 words on what ${BN()} should do, using only ${BN()}'s facts listed above, with their exact numbers. Never copy the rival's words.\nJSON: {"ads":[{"i":0,"title":"","hook":"","angle":"","why":"","take":""}]}` }];
    ok.forEach((x, i) => {
      if (x.posterBuf) content.push({ type: 'image', source: { type: 'base64', media_type: mime(x.posterBuf), data: x.posterBuf.toString('base64') } });
      content.push({ type: 'text', text: `Ad ${i} · ${x.brand} · ${x.media.video ? 'video' : 'image'} · live ${x.days} days · ${x.versions} versions · Meta rank ${x.rank + 1}\nHeadline: ${x.copy.title}\nCopy: ${x.copy.body.slice(0, 600)}\nButton: ${x.copy.cta} → ${x.copy.caption || x.copy.link}` });
    });
    let notes = [];
    try { notes = parseJSON((await claude(content, { max: 5000 })).text).ads || []; } catch (e) { log.warn('[research] ads claude', e.message); }
    const items = ok.map((x, i) => {
      const n = notes.find((y) => +y.i === i) || {};
      return { id: x.ad.ad_archive_id, brand: x.brand, page: x.ad.page_name, days: x.days, versions: x.versions, rank: x.rank + 1, since: new Date(x.start).toISOString().slice(0, 10),
        poster: x.poster, video: x.videoFile || null, format: x.media.video ? 'video' : 'image', headline: x.copy.title, body: x.copy.body.slice(0, 400), cta: x.copy.cta, landing: x.copy.caption || x.copy.link,
        url: `https://www.facebook.com/ads/library/?id=${x.ad.ad_archive_id}`,
        title: clean(n.title || `${x.brand}: ${x.copy.title}`.slice(0, 60)), hook: clean(n.hook || x.copy.title), angle: clean(n.angle || ''), why: clean(n.why || ''), take: clean(n.take || '') };
    });
    snap.ads = { fetchedAt: now, ...pool(snap.ads, items, 'ads', now), brands: [...brands, ...(snap.ads?.brands || []).filter((b) => !brands.some((x) => x.name === b.name))], source: `Meta Ad Library · ${CTRY()} · live ads` };
  }

  /* ---------- Trends ---------- */
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  async function refreshTrends() {
    const now = Date.now();
    const series = {};
    for (const set of TERMS) {
      try {
        const j = await treg('dataforseo.x.keywords-data-google-trends-explore-live', { body: [{ keywords: set, location_code: LOC, time_range: 'past_90_days' }] });
        const g = (j.tasks?.[0]?.result?.[0]?.items || []).find((x) => x.type === 'google_trends_graph'); if (!g) continue;
        const pts = (g.data || []).filter((d) => !d.missing_data); if (!pts.length) continue;
        set.forEach((term, k) => {
          const v = pts.map((d) => d.values[k] ?? 0);
          const last = avg(v.slice(-30)), prev = avg(v.slice(-60, -30));
          const peakAt = pts[v.indexOf(Math.max(...v))]?.date_from;
          series[term] = { term, set: TERMS.indexOf(set), values: v, dates: [pts[0]?.date_from, pts[pts.length - 1]?.date_from], last: Math.round(last), prev: Math.round(prev), change: prev ? Math.round(((last - prev) / prev) * 100) : null, avg: g.averages?.[k] ?? Math.round(avg(v)), peakAt };
        });
      } catch (e) { log.warn('[research] trends', e.message); }
    }
    const rising = {};
    await Promise.all(RISING.map(async (q) => {
      /* rising searches come from the same DataForSEO trends read (its queries list), about 12x cheaper than SerpApi; SerpApi
         is the fallback when that list comes back empty */
      try {
        const j = await treg('dataforseo.x.keywords-data-google-trends-explore-live', { body: [{ keywords: [q], location_code: LOC, time_range: 'past_90_days', item_types: ['google_trends_queries_list'] }] });
        const ql = (j.tasks?.[0]?.result?.[0]?.items || []).find((x) => x.type === 'google_trends_queries_list');
        const xs = (ql?.data?.rising || []).slice(0, 10).map((x) => ({ q: x.query, v: x.value }));
        if (xs.length) { rising[q] = xs; return; }
      } catch (e) { log.warn('[research] rising (dataforseo)', e.message); }
      try {
        const j = await treg('serpapi.x.google-trends', { query: { engine: 'google_trends', q, data_type: 'RELATED_QUERIES', geo: GEO, date: 'today 3-m' } });
        rising[q] = (j.related_queries?.rising || []).slice(0, 10).map((x) => ({ q: x.query, v: x.value }));
      } catch (e) { log.warn('[research] rising', e.message); }
    }));
    if (!Object.keys(series).length) throw new Error('no trend data came back');
    const days = DIWALI ? Math.ceil((DIWALI - now) / D) : null;
    /* a term searched almost never is noise: "0 to 7" is a 700% jump nobody should act on, so only terms with a real base become stories */
    const solid = (s) => s.prev >= 5 && s.last >= 10;
    const data = Object.values(series).filter(solid).map((s) => `- "${s.term}" (group ${s.set + 1}): last 30 days avg ${s.last}, prior 30 ${s.prev}, change ${s.change ?? 'n/a'}%, peak ${s.peakAt}`).join('\n');
    const ris = Object.entries(rising).map(([q, l]) => `Rising searches related to "${q}": ${l.map((x) => `${x.q} (${x.v})`).join('; ')}`).join('\n');
    let out = { items: [] };
    try {
      out = parseJSON((await claude(`${factBrief()}\n\nYou are the Trends agent for ${BN()} (${B().config.category}). Real Google Trends data for ${CTRY()}, last 90 days (index 0-100, comparable only within a group):\n${data}\n${ris}\nCalendar: ${FESTN()} is ${FESTD()}, ${days} days away.\nPick the 5 findings that matter most to ${BN()} this week. Every finding must quote a real number from the data above. Any ${BN()} price or claim must come from the facts list, exactly. Plain, simple words. Do not invent anything.\nJSON: {"items":[{"kind":"term|rising|calendar","terms":["exact term(s) from the data, for a chart; [] for rising or calendar"],"rising":"the related query list key if kind is rising, else null","h":"headline under 52 chars with the number","p":"two sentences, 25 to 35 words: what we saw with the number, then the move and what it gets ${BN()}; no fonts, design notes or file names","card":"a card title under 70 chars that names a number"}]}`, { max: 3000 })).text);
    } catch (e) { log.warn('[research] trends claude', e.message); }
    /* no AI (down, out of credit, or it picked nothing): the stories are written from the numbers themselves, so the ring
       still gets today's real movers; nothing is invented, every line is a number from the read above */
    if (!(out.items || []).some((x) => x.h)) out = { items: trendsFromData(series, rising, days, solid) };
    const seenKey = new Set();
    const items = (out.items || []).slice(0, 6).map((x) => { const risingOf = x.kind === 'rising' ? (rising[x.rising] ? x.rising : Object.keys(rising)[0] || null) : null;
      return { kind: x.kind, h: clean(x.h), p: clean(x.p), card: clean(x.card || x.h), terms: (x.terms || []).filter((t) => series[t]).slice(0, 3), risingOf, rising: risingOf ? (rising[risingOf] || []).slice(0, 6) : null, ...(x.by ? { by: x.by } : {}) }; })
      // one story per rising list and per chart: two stories over the same data would be two cards with one widget
      .filter((x) => { const k = KEY.trends(x); if (seenKey.has(k)) return false; seenKey.add(k); return true; })
      // the id comes from what the story is about, so a later read the same day never reuses another story's id
      .map((x) => ({ id: 'tr-' + crypto.createHash('sha1').update(KEY.trends(x)).digest('hex').slice(0, 10), ...x }));
    snap.trends = { fetchedAt: now, ...pool(snap.trends, items.filter((x) => x.h), 'trends', now), series: { ...(snap.trends?.series || {}), ...series }, rising, source: `Google Trends · ${CTRY()} · last 90 days` };
  }

  function trendsFromData(series, rising, days, solid) {
    const movers = Object.values(series).filter((s) => solid(s) && s.change != null && Math.abs(s.change) >= 10).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3);
    const items = movers.map((s) => { const up = s.change > 0;
      return { kind: 'term', terms: [s.term], h: `"${s.term}" searches ${up ? 'up' : 'down'} ${Math.abs(s.change)}%`.slice(0, 60),
        p: `Searches for "${s.term}" in ${CTRY()} ${up ? 'rose' : 'fell'} ${Math.abs(s.change)}% over the last 30 days against the 30 before. ${up ? `More people are looking: a good week to put ${BN()} in front of them.` : `Interest is cooling: spend where searches still grow.`}`,
        card: `"${s.term}" searches ${up ? 'up' : 'down'} ${Math.abs(s.change)}% in 30 days` }; });
    const [rq, list] = Object.entries(rising).find(([, l]) => l?.length) || [];
    if (rq) items.push({ kind: 'rising', terms: [], rising: rq, h: `Rising searches around "${rq}"`.slice(0, 60),
      p: `People searching "${rq}" in ${CTRY()} now also search ${list.slice(0, 3).map((x) => `"${x.q}"`).join(', ')}. Each is a hook ${BN()} can answer in an ad or a page.`,
      card: `${list.length} rising searches around "${rq}"` });
    if (days != null && days >= 0 && days <= 45) items.push({ kind: 'calendar', terms: [], h: `${FESTN()} is ${days} days away`, p: `${FESTN()} falls on ${FESTD()}, ${days} days from today. Searches climb in the weeks before, so creative and offers for ${BN()} should be live before then.`, card: `${FESTN()} in ${days} days: get creative live first` });
    return items.map((x) => ({ ...x, by: 'data' }));
  }

  /* ---------- What is new ---------- */
  const ogImage = async (url) => {
    try {
      const html = (await fetchBuf(url, 3e6)).toString('utf8');
      const m = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
      if (!m) return null; const b = await fetchBuf(new URL(m[1].replace(/&amp;/g, '&'), url).href, 5e6);
      return b.length > 3000 ? saveMedia(b, imgExt(b)) : null;
    } catch { return null; }
  };
  async function refreshNews() {
    const now = Date.now(); const today = new Date(now).toISOString().slice(0, 10);
    const ask = `Today is ${today}. You are the news scout for ${BN()}, ${cfg.about || 'a D2C brand (' + cfg.category + ')'}. Search the web for 5 to 6 real, dated news items from the last 21 days that ${BN()}'s marketing team should know. Cover a mix of: rival moves in ${CTRY()} (${(cfg.newsRivals || cfg.rivals || []).join(', ')}: launches, funding, pricing, campaigns), ${cfg.marketLine || 'the ' + CTRY() + ' market for ' + cfg.category}, and Meta or Google ad platform changes that affect advertisers in ${CTRY()}. Only include items you found a real article for, with its URL and publish date. Prefer the newest.\nWhen done, reply with only JSON: {"items":[{"h":"headline under 60 chars, plain words","p":"two sentences, 25 to 35 words: what happened, with the number, then why it matters to ${BN()}","source":"publication name","url":"https://...","date":"YYYY-MM-DD"}]}`;
    const fresh = (xs) => xs.filter((x) => /^https?:\/\//.test(x.url || '') && x.h && !(Date.parse(x.date) < now - 21 * D)).slice(0, 6); /* the same 21 days the scout is asked for; the ring ranks the newest first */
    let items = [], aiErr = null;
    try {
      const { text } = await claude([{ type: 'text', text: ask }], { max: 6000, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: GEO, ...(cfg.city ? { city: cfg.city } : {}), timezone: cfg.timezone || 'UTC' } }] });
      items = fresh(parseJSON(text).items || []);
    } catch (e) { aiErr = e; log.warn('[research] news claude', e.message); }
    /* no AI or it found nothing: the free news search (through the shared treg client, cached a day) reads the same rivals and
       market; the article's own title and summary are the story, so nothing is written for it */
    if (!items.length) items = fresh(await newsFromSearch(now).catch((e) => { throw new Error(`news: ${aiErr ? 'AI ' + aiErr.message + '; ' : ''}search ${e.message}`); }));
    if (!items.length) throw new Error('no news items');
    await Promise.all(items.map(async (x) => { x.img = await ogImage(x.url); x.domain = new URL(x.url).hostname.replace(/^www\./, ''); x.h = clean(x.h); x.p = clean(x.p); }));
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    snap.news = { fetchedAt: now, ...pool(snap.news, items, 'news', now), source: 'Web search' };
  }

  async function newsFromSearch(now) {
    const qs = [...(cfg.newsRivals || cfg.rivals || []).slice(0, 3), `${cfg.category || BN()} ${CTRY()}`].filter(Boolean);
    const rows = [], errs = [];
    for (const q of qs) { try { const j = await treg('tinyfish.web.search.news', { query: { domain_type: 'news', query: q } }); rows.push(...(j?.results || j?.output?.results || [])); } catch (e) { errs.push(e.message); } }
    if (!rows.length && errs.length) throw new Error(errs[0]);
    const seen = new Set();
    return rows.filter((r) => r?.url && r.title && !seen.has(r.url) && seen.add(r.url)).map((r) => { const d = Date.parse(r.date || r.published_at || r.publishedAt || '');
      return { h: String(r.title).replace(/\s+[-|–]\s+[^-|–]{2,40}$/, '').slice(0, 90), p: String(r.snippet || r.description || '').slice(0, 260), source: r.publisher || r.site_name || r.source || new URL(r.url).hostname.replace(/^www\./, ''), url: r.url, date: isNaN(d) ? null : new Date(d).toISOString().slice(0, 10), by: 'search' }; })
      .filter((x) => x.date && Date.parse(x.date) <= now).sort((a, b) => b.date.localeCompare(a.date));
  }

  /* ---------- How to ---------- */
  async function refreshHowTo() {
    const now = Date.now();
    const ads = (snap.ads?.items || []).map((a) => `- ${a.brand}, live ${a.days} days, ${a.versions} versions: ${a.title}. Why: ${a.why}`).join('\n');
    const tr = (snap.trends?.items || []).map((t) => `- ${t.h}: ${t.p}`).join('\n');
    const LANES = Object.keys(brand.seed?.lanes || {}), lane0 = LANES[0] || 'core';
    let out = { items: [] };
    try { out = parseJSON((await claude(`${factBrief()}\n\nYou are Brew, writing this week's "How to" stories for ${BN()}'s marketing team. They are short playbooks a person can act on today, built from this week's real research:\nPopular rival ads in ${CTRY()}:\n${ads || '(none yet)'}\nSearch trends in ${CTRY()}:\n${tr || '(none yet)'}\nWrite 3 playbooks. Each one turns one finding into a concrete thing ${BN()} can make or change this week, using only ${BN()}'s facts listed above, with their exact numbers. Plain, simple words. Point first.\nJSON: {"items":[{"h":"How to ... (under 48 chars)","p":"one sentence under 22 words: the finding it comes from","steps":["3 or 4 steps, each under 14 words"],"card":"a card title under 70 chars naming a number","lane":"${Object.keys(brand.seed?.lanes || {}).join('|') || 'core'}","scene":"one sentence: a product photo to illustrate it, no text, no people"}]}`, { max: 3000 })).text); } catch (e) { log.warn('[research] howto claude', e.message); }
    /* no AI: playbooks built from the week's top rival ad and top trend, in fixed steps, so the ring keeps its how-tos */
    if (!(out.items || []).some((x) => x.h)) out = { items: howtoFromData() };
    if (!out.items.length) throw new Error('no ads or trends to write how-tos from yet');
    const items = out.items.slice(0, 3).map((x, i) => ({ id: `ht-${new Date(now).toISOString().slice(0, 10)}-${i}`, h: clean(x.h), p: clean(x.p), steps: (x.steps || []).map(clean).slice(0, 4), card: clean(x.card || x.h), lane: LANES.includes(x.lane) ? x.lane : lane0, scene: x.scene, img: null, ...(x.by ? { by: x.by } : {}) }));
    await Promise.all(items.map(async (x) => {
      const ref = refPhoto(x.lane); if (!ref) return;
      try {
        const buf = await geminiImage({ srcFile: photoFile(ref), prompt: `Create a new vertical product photograph: ${x.scene || 'the product on a clean bathroom shelf, soft morning daylight'}. ${`Keep the ${BN()} ${B().config.product?.noun || 'product'} and its label exactly as in the reference`}. ${B().config.product?.avoid || 'No text, no people.'} ${B().config.product?.editorial || B().config.product?.style || 'Premium D2C editorial product photography'}, calm, lots of empty space at the bottom.`, ratio: '9:16', model: process.env.WATCHER_IMAGE_MODEL || 'gemini-2.5-flash-image' });
        spent.images += 0.04; x.img = await saveMedia(buf, imgExt(buf));
      } catch (e) { log.warn('[research] howto image', e.message); }
    }));
    snap.howto = { fetchedAt: now, ...pool(snap.howto, items.filter((x) => x.h), 'howto', now), source: 'Written from this week’s research' };
  }

  function howtoFromData() {
    const ads = (snap.ads?.items || []).slice().sort((a, b) => (a.rank || 99) - (b.rank || 99)), tr = (snap.trends?.items || []).filter((t) => t.h);
    const out = [];
    for (const a of ads.slice(0, 2)) if (a.hook) out.push({ h: `How to test ${a.brand}'s ${a.angle || 'top'} angle`.slice(0, 48), p: `${a.brand}'s ad "${a.hook}" has run ${a.days} days in ${a.versions} versions.`,
      steps: [`Write one ${BN()} hook on the same idea, in your words`, 'Make it a 9:16 static and a 4:5 static', 'Run both against your current best ad for 5 days', 'Keep the one with the lower cost per order'], card: `${a.brand}'s ad has run ${a.days} days: test the idea for ${BN()}` });
    const t = tr[0];
    if (t) out.push({ h: 'How to meet this week\'s search trend', p: t.h,
      steps: [`Add the phrase from "${t.h}" to one ad headline`, 'Put the same phrase on your top product page', 'Check searches and clicks again next week'], card: t.card || t.h });
    return out.slice(0, 3).map((x) => ({ ...x, by: 'data' }));
  }

  /* ---------- Your own ads: the brand's live ads in the public Meta Ad Library, tracked day by day ---------- */
  // Real without any login: how many ads run, how long each has run, versions, formats, what is new since the
  // last read. Spend, cost per order and frequency need the brand's own Meta account (the Meta connector).
  async function refreshOwn() {
    const now = Date.now(), name = cfg.ownPage || brand.name;
    const j = await treg('scrapecreators.x.v1-facebook-adlibrary-company-ads', { query: { companyName: name, country: GEO, status: 'ACTIVE' } });
    const want = new RegExp(String(cfg.ownPage || brand.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const rows = (j.results || []).filter((a) => want.test(a.page_name || a.snapshot?.page_name || ''));
    const g = new Map();
    rows.forEach((a, rank) => { const cp = adCopy(a), m = adMedia(a); const key = (cp.title + '|' + cp.body.slice(0, 90)).toLowerCase();
      if (!g.has(key)) g.set(key, { rank, copy: cp, media: m, versions: 0, start: Infinity, ids: [] });
      const x = g.get(key); x.versions += Math.max(1, a.collation_count || 1); x.start = Math.min(x.start, (a.start_date || now / 1000) * 1000); x.ids.push(String(a.ad_archive_id)); });
    const items = [...g.values()].map((x) => ({ id: x.ids[0], ids: x.ids, hook: (x.copy.title || x.copy.body.split(/[.!?\n]/)[0] || '').slice(0, 90), body: x.copy.body.slice(0, 280), days: Math.max(1, Math.round((now - x.start) / D)), versions: x.versions, video: !!x.media.video, posterUrl: x.media.poster, url: `https://www.facebook.com/ads/library/?id=${x.ids[0]}` }));
    // posters for the few we show (Ad Library URLs expire)
    for (const x of items.sort((a, b) => b.days - a.days).slice(0, 6)) { if (!x.posterUrl) continue; try { const b = await fetchBuf(x.posterUrl, 6e6); x.poster = await saveMedia(b, imgExt(b)); } catch (e) { log.warn('[research] own poster', e.message); } }
    items.forEach((x) => delete x.posterUrl);
    const prev = snap.own, seen = new Set((prev?.items || []).flatMap((x) => x.ids || [x.id]));
    const live = j.searchResultsCount && rows.length === (j.results || []).length ? j.searchResultsCount : rows.length;
    const fresh = prev ? items.filter((x) => !x.ids.some((id) => seen.has(id))) : items.filter((x) => x.days <= 7);
    const long = items.filter((x) => x.days >= 60).sort((a, b) => b.days - a.days);
    const day = new Date(now).toISOString().slice(0, 10), ev = [];
    if (long.length) ev.push({ id: `own-long-${day}`, kind: 'long', items: long.slice(0, 5), n: long.length, at: now });
    if (fresh.length) ev.push({ id: `own-new-${day}`, kind: 'new', items: fresh.slice(0, 5), n: fresh.length, at: now });
    if (prev && Math.abs(live - prev.live) >= Math.max(3, prev.live * 0.2)) ev.push({ id: `own-count-${day}`, kind: 'count', was: prev.live, now: live, at: now });
    if (!items.length) ev.push({ id: `own-none-${day}`, kind: 'none', at: now });
    snap.own = { fetchedAt: now, page: rows[0]?.page_name || null, live, items: items.slice(0, 40), formats: { video: items.filter((x) => x.video).length, image: items.filter((x) => !x.video).length },
      history: [...(prev?.history || []), { day, live }].slice(-60), events: [...ev, ...(prev?.events || [])].slice(0, 40), source: `Meta Ad Library · ${CTRY()} · your live ads` };
  }

  /* ---------- schedule ---------- */
  const JOBS = { ads: refreshAds, own: refreshOwn, trends: refreshTrends, news: refreshNews, howto: refreshHowTo };
  async function refresh(which = ['ads', 'trends', 'news', 'howto']) {
    const done = [];
    for (const k of which) {
      if (running.has(k)) continue; running.add(k);
      const t0 = Date.now(); const before = { ...spent };
      try { await JOBS[k](); done.push(k); delete failed[k]; if (snap[k]) delete snap[k].lastError; persist(); log.log(`[research] ${brand.slug} ${k} ok in ${Math.round((Date.now() - t0) / 1000)}s · treg $${(spent.treg - before.treg).toFixed(4)} · claude ~$${(spent.claude - before.claude).toFixed(3)}`); }
      catch (e) { log.warn(`[research] ${brand.slug} ${k} failed, keeping the last good data:`, e.message); failed[k] = Date.now();
        /* the failure is saved with the snapshot, so a restart (or a deploy) waits out the hour too instead of paying again at boot */
        if (snap[k]) { snap[k].lastError = { at: failed[k], msg: e.message }; persist(); } }
      finally { running.delete(k); }
    }
    if (done.length) { listeners.forEach((f) => f(done)); rollup(done).catch((e) => log.warn('[research] rollup', e.message)); }
    return done;
  }
  // a dated rollup (counts only) next to the brand pack: brands/<slug>/research/history/<date>.json, one per day, last refresh wins
  async function rollup(done) {
    const day = new Date().toISOString().slice(0, 10), n = (k) => snap[k]?.items?.length ?? null;
    const r = { day, at: Date.now(), refreshed: done, ads: n('ads'), adsVideo: (snap.ads?.items || []).filter((x) => x.video).length, ownLive: snap.own?.live ?? null, ownNew: (snap.own?.events || []).filter((e) => e.kind === 'new' && e.id.endsWith(day)).reduce((a, e) => a + (e.n || 0), 0),
      trends: n('trends'), news: n('news'), howto: n('howto'), spentTreg: +spent.treg.toFixed(4), spentClaude: +spent.claude.toFixed(4) };
    const rel = `research/history/${day}.json`, f = path.join(ROOT, '.brands', brand.slug, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(r));
    if (process.env.K_SERVICE) await gcs('PUT', `brands/${brand.slug}/${rel}`, Buffer.from(JSON.stringify(r)), 'application/json');
    return r;
  }
  /* a failed read waits an hour before trying again, so a broken source does not spend every 30 minutes; that holds for a
     source that never worked yet too (no snapshot to carry lastError, so it is kept here) */
  const failed = {};
  const failedAt = (k) => Math.max(failed[k] || 0, snap[k]?.lastError?.at || 0);
  const due = () => Object.keys(JOBS).filter((k) => (!snap[k] || Date.now() - snap[k].fetchedAt > every(k)) && !(Date.now() - failedAt(k) < H));
  /* the first GET after attach waits for the saved snapshot (ready), instead of answering with an all-empty one */
  let loaded = null;
  const start = async () => {
    await (loaded = load());
    const tick = () => { const d = due().filter((k) => k !== 'own' || brand.kind === 'generated'); if (d.length && !process.env.RESEARCH_OFF) refresh(d.includes('howto') ? [...d.filter((k) => k !== 'howto'), 'howto'] : d); };
    stopped = false; clearTimeout(timers.t); clearInterval(timers.i);
    timers.t = setTimeout(() => { if (!stopped) tick(); }, 5000); timers.i = setInterval(() => { if (!stopped) tick(); }, 30 * 60e3); timers.i.unref?.();
  };
  /* a replaced instance stops its timers */
  let stopped = false; const timers = {};
  const stop = () => { stopped = true; clearTimeout(timers.t); clearInterval(timers.i); };

  return { start, ready: () => loaded, stop, refresh, rollup, mediaFile, due, get: () => snap, onRefresh: (f) => listeners.push(f), running: () => [...running], spent: () => ({ ...spent }) };
}
