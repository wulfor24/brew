// The Brand Book as the read finds it: the brand's whole profile, built from its own public evidence before anyone uploads a thing.
// Chapters: cover, story, kit, voice, words, products, people, proof, the creative library (what the brand publishes, by
// deliverable, best first, with proof), format playbooks, channels, rivals and rules.
//   free, no AI:  products and price tiers, offers and guarantee, ratings, review lines, press and founders, channels, rivals,
//                 the library (ads, Instagram, YouTube, product photos: every picture saved with the read)
//   one AI call:  story, voice, words, claims, look, type use, naming, colour roles, playbooks and "what makes it theirs" for
//                 each reference shown to it. Gemini sees the numbered evidence plus the logo and the brand's own pictures.
// Nothing is invented: every AI line names the evidence it came from, and every quoted line (a voice sample, a word, a claim,
// a naming example) is checked against that evidence in code. No evidence → the field stays empty ("add it"), never a guess.
// Saved as brands/<slug>/brandbook-read.json. Only public evidence goes in, so the free brand kit can share it as it is;
// jam2/brandbook.js lays uploads and the team's edits over it. Built after the brief; healed when missing, from an older
// version, older than the read, or an error from more than an hour ago.
import { safeFetch, stripTags, links, hostOf, UA, sha as hash, clean } from './reader/util.js';
import { offersOf, guaranteeOf } from './reader/stages/ads.js';
import { PLATFORMS as SHELF_PLATFORMS } from './shelf.js';
const SHELF_KEYS = Object.keys(SHELF_PLATFORMS);

export const BOOK_V = 6; // 6: the whole catalogue (products.all) for the All products page, tiers carry lo/hi; 5: 5: ratings to one decimal, a summed marketplace never shown twice; 4: // 4: a cover tagline is never a search title, one creative listed once; 3: Instagram pictures from fresh lists (signed links expire); // 2: built with the week's enrichment (posts, reels with plays, TikToks, film words) and the signature that keeps it current
const FILE = 'brandbook-read.json';
const tidy = (s, n = 400) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const squash = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}']+/gu, ' ').trim();
const lum = (hex) => { const h = String(hex).replace('#', ''), f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6); const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/* a guide is a page or file the brand made about its own brand: never a product page */
export const GUIDE_RE = /brand[-_ ]?(book|guide|guidelines|assets|kit|identity|style)|style[-_ ]?guide|press[-_ ]?kit|media[-_ ]?kit|\/press\b|\/media\b|logo[-_ ]?(pack|download)/i;

/* ---------------- the creative library: what the brand has put out, by deliverable ---------------- */
export const REF_FAMILIES = {
  'ad-winners': 'Your best ads', 'ad-image': 'Image ads', 'ad-video': 'Video ads', 'ad-carousel': 'Carousel ads',
  'ig-post': 'Instagram posts', 'ig-reel': 'Instagram reels', 'ig-carousel': 'Instagram carousels',
  'tiktok': 'TikTok', 'youtube': 'YouTube films', 'product-photo': 'Product photos', 'site-photo': 'On their site', 'email': 'Emails'
};
/* which families a deliverable (a jam2 recipe, a v1 asset kind) should look at, nearest first */
export function familiesFor(kind = '') {
  const k = String(kind).toLowerCase();
  if (/reel|video|ugc|founder|story|tiktok|short|film/.test(k)) return ['ad-video', 'ad-winners', 'ig-reel', 'tiktok', 'youtube', 'ad-image', 'ig-post'];
  if (/carousel|slides/.test(k)) return ['ad-carousel', 'ad-winners', 'ig-carousel', 'ad-image', 'ig-post'];
  if (/email|newsletter|klaviyo/.test(k)) return ['email', 'ad-image', 'product-photo', 'site-photo'];
  if (/listing|product|pdp|packshot|photo-set|catalog/.test(k)) return ['product-photo', 'site-photo', 'ad-image'];
  if (/post|social|instagram|static-post/.test(k)) return ['ig-post', 'ig-carousel', 'ad-winners', 'ad-image', 'product-photo'];
  return ['ad-winners', 'ad-image', 'ig-post', 'ad-carousel', 'product-photo', 'site-photo']; /* their own winners (Meta, members only) lead any ad */
}
const isAsset = (p) => /^\/b\/[^/]+\/a\//.test(String(p || ''));
export function libraryOf(profile = {}, { max = 6, enrich = null } = {}) {
  const fam = {}, push = (f, r) => { if (r.src) (fam[f] ||= []).push(r); };
  for (const a of profile.ads?.own?.items || []) {
    if (!isAsset(a.poster)) continue; /* an expired CDN link is no reference */
    const f = a.format === 'video' ? 'ad-video' : a.format === 'carousel' ? 'ad-carousel' : 'ad-image';
    push(f, { id: `ad:${a.id}`, src: a.poster, video: isAsset(a.video) ? a.video : null, words: tidy([a.hook, a.body].filter(Boolean).join(' — '), 220), cta: a.cta || null, url: a.url || null,
      score: (+a.days || 0) * (1 + Math.log2(+a.versions || 1)), proof: a.days ? `Running ${a.days} days${a.versions > 1 ? `, ${a.versions} versions` : ''}` : null, kind: 'Their ad' });
  }
  /* Instagram from this week's enrichment when there is one (fresh, with plays and saved reel videos), else the read's */
  for (const x of (enrich?.ig?.posts?.length ? enrich.ig.posts : profile.socials?.instagram?.posts) || []) {
    if (!isAsset(x.img)) continue;
    const f = /reel|video|clip|igtv/i.test(x.kind) ? 'ig-reel' : /carousel|album|sidecar/i.test(x.kind) ? 'ig-carousel' : 'ig-post';
    push(f, { id: `ig:${x.url}`, src: x.img, video: isAsset(x.video) ? x.video : null, words: tidy(x.caption, 220), url: x.url || null, score: (+x.views || 0) / 20 + (+x.likes || 0),
      proof: x.views != null ? `${(+x.views).toLocaleString('en-US')} plays` : x.likes != null ? `${(+x.likes).toLocaleString('en-US')} likes` : null, kind: 'Their Instagram' });
  }
  for (const v of profile.socials?.youtube?.videos || []) if (isAsset(v.thumb)) push('youtube', { id: `yt:${v.url}`, src: v.thumb, words: tidy(v.title, 160), url: v.url, score: +v.views || 0, proof: v.views != null ? `${(+v.views).toLocaleString('en-US')} views` : null, kind: 'Their film' });
  for (const t of enrich?.tiktok?.videos || profile.socials?.tiktok?.videos || []) if (isAsset(t.thumb)) push('tiktok', { id: `tt:${t.url}`, src: t.thumb, words: tidy(t.caption, 200), url: t.url, score: +t.views || 0, proof: t.views != null ? `${(+t.views).toLocaleString('en-US')} views` : null, kind: 'Their TikTok' });
  const prods = profile.catalog?.products || [], hero = new Set(profile.catalog?.hero || []);
  for (const p of [...prods.filter((x) => hero.has(x.handle)), ...prods.filter((x) => !hero.has(x.handle))]) if (isAsset(p.img)) push('product-photo', { id: `pr:${p.handle}`, src: p.img, words: p.title, url: p.url || null, score: hero.has(p.handle) ? 1 : 0, proof: hero.has(p.handle) ? 'Best seller' : null, kind: 'Their product photo' });
  /* one creative under several ad ids (Meta lists each placement or test cell) is one reference: the best-scoring copy stays */
  for (const f of Object.keys(fam)) { const seen = new Set(); fam[f] = fam[f].sort((a, b) => b.score - a.score).filter((r) => { const k = squash(r.words).slice(0, 120); if (k && seen.has(k)) return false; if (k) seen.add(k); return true; }).slice(0, max); }
  return fam;
}

/* ---------------- the free chapters: no AI, straight from the read ---------------- */
const money = (n, cur) => { try { return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n); } catch { return String(n); } };
export function tiersOf(products = [], cur) {
  const ps = products.filter((p) => +p.price > 0 && !p.pack).map((p) => ({ t: p.title, p: +p.price })).sort((a, b) => a.p - b.p);
  if (ps.length < 3) return ps.length ? [{ name: 'Range', from: money(ps[0].p, cur), to: money(ps.at(-1).p, cur), lo: ps[0].p, hi: ps.at(-1).p, n: ps.length }] : [];
  const q = (f) => ps[Math.min(ps.length - 1, Math.floor(f * ps.length))].p, a = q(0.34), b = q(0.67);
  const band = (name, lo, hi) => { const xs = ps.filter((x) => x.p >= lo && x.p <= hi); return xs.length ? { name, from: money(xs[0].p, cur), to: money(xs.at(-1).p, cur), lo: xs[0].p, hi: xs.at(-1).p, n: xs.length, eg: tidy(xs[Math.floor(xs.length / 2)].t, 60) } : null; };
  return [band('Entry', 0, a - 0.01), band('Core', a, b - 0.01), band('Premium', b, Infinity)].filter(Boolean);
}
/* a tagline the brand wrote, never a page title written for search ("Explore X's most trusted…", "Buy … online", "Home | X") */
export const taglineOk = (t) => { const x = String(t || '').trim(); return x.length >= 3 && x.length <= 70 && !/\||\b(buy|shop|explore|discover|order)\b.*\b(online|best|trusted|range|collection|products?|solutions?)\b|\bonline\b|official (site|store|website)|^home\b/i.test(x); };
/* a one-liner is the brand talking, not a search snippet: Shopify's short description is often written for Google ("Explore X's most
   trusted range of … online"), so those never reach the cover */
export const oneLineOk = (t) => { const x = String(t || '').trim(); return x.length >= 8 && x.length <= 180 && !/^(buy|shop|explore|discover|order|browse|get)\b|\|| online\b|official (site|store|website)|\b(best|trusted|top)\b.*\b(range|collection|products?|brand) (of|for|in)\b/i.test(x); };
/* where the brand sells, from the weekly shelf reads (shelf/<platform>.json, market-pulse.js): one entry per platform it's listed on */
export function shelfChannels(shelf = {}) {
  return Object.entries(shelf || {}).filter(([, f]) => f?.byName && !f.error).map(([key, f]) => { const own = Object.values(f.byName).flat().filter((x) => x.own);
    if (!own.length) return null; const prices = own.map((x) => x.price).filter(Boolean), rated = own.map((x) => x.rating).filter(Boolean);
    return { net: key, label: f.label || key, kind: f.kind || 'marketplace', url: own[0].url || null, listed: own.length, from: prices.length ? Math.min(...prices) : null,
      rating: rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length * 10) / 10 : null, city: f.city || null, at: String(f.at || '').slice(0, 10) || null }; }).filter(Boolean);
}
/* verified buyers' reviews from the marketplaces the brand is listed on: quotable word for word, like the site's own reviews */
export function shelfQuotes(shelf = {}, n = 6) {
  return Object.values(shelf || {}).filter((f) => f && !f.error).flatMap((f) => (f.reviews || []).filter((r) => r.text && r.text.length >= 25).map((r) => ({ text: tidy(r.text, 260), rating: r.rating || null, product: r.product || null, url: r.url || null, where: f.label || null, verified: !!r.verified, who: r.author || null })))
    .sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || (b.rating || 0) - (a.rating || 0)).slice(0, n);
}
export function freeChapters({ profile = {}, brief = {}, ledger = [], homeText = '', config = {}, shelf = {}, traffic = null } = {}) {
  const L = (k) => ledger.find((x) => x.key === k);
  const prods = profile.catalog?.products || [], hero = new Set(profile.catalog?.hero || []), cur = profile.currency;
  const id = profile.identity || {};
  const colors = (id.colors || []).map((hex) => ({ hex: String(hex).toLowerCase(), role: null, use: null, light: lum(hex) > 0.7 }));
  return {
    cover: { name: profile.brandName || profile.name || null, tagline: taglineOk(profile.tagline) ? profile.tagline : null, oneLine: profile.descriptor || brief.oneLine || null, logo: id.logo || null, mark: id.mark || null, url: profile.url || null, category: [profile.category, profile.subcategory].filter(Boolean).join(' · ') || null },
    story: { about: profile.about || null, aboutUrl: profile.aboutUrl || null, founders: (profile.company?.founders || []).map((f) => ({ name: f.name, url: f.url || null })), founded: profile.company?.founded || null, hq: profile.company?.hq || null,
      press: (profile.company?.press || []).map((p) => ({ name: tidy(p.title || p.name || p.outlet, 120), url: p.url || null, outlet: p.outlet || null })).filter((p) => p.name) },
    kit: { logo: id.logo || null, mark: id.mark || null, colors, fonts: { heading: id.fonts?.heading || null, body: id.fonts?.body || null } },
    products: {
      heroes: prods.filter((p) => hero.has(p.handle)).slice(0, 8).map((p) => ({ title: p.title, img: isAsset(p.img) ? p.img : null, price: p.price ? money(p.price, p.currency || cur) : p.priceText || null, mrp: p.mrp ? money(p.mrp, p.currency || cur) : null, url: p.url, about: tidy(p.about, 220) || null, claims: (p.claims || []).slice(0, 3) })),
      /* the whole catalogue for the book's "All products" page: heroes first, then by price; bundles kept and marked */
      all: [...prods].sort((x, y) => (hero.has(y.handle) - hero.has(x.handle)) || ((+x.price || 1e9) - (+y.price || 1e9))).slice(0, 400).map((p) => ({ title: p.title, img: p.img || p.images?.[0] || null,
        price: p.price ? money(p.price, p.currency || cur) : p.priceText || null, p: +p.price || null, mrp: p.mrp && +p.mrp > +p.price ? money(p.mrp, p.currency || cur) : null, url: p.url || null, hero: hero.has(p.handle) || undefined, pack: p.pack ? true : undefined })).filter((p) => p.title),
      count: profile.catalog?.total ?? prods.length ?? null, tiers: tiersOf(prods, cur), sells: profile.storeKind === 'enquiry' ? 'by enquiry' : 'online',
      offers: [...new Set([L('offer.free_shipping_banner')?.v, ...offersOf(homeText)].filter(Boolean).map((x) => tidy(x, 100)))].slice(0, 5),
      guarantee: guaranteeOf(homeText) || null, returns: L('policy.return_days')?.v || null, shipping: L('policy.free_shipping')?.v || null
    },
    people: { personas: (brief.personas || []).slice(0, 4).map((p) => ({ name: p.name, who: tidy(p.who, 140), job: tidy(p.job, 140), objection: tidy(p.objections, 140) || null, from: 'inferred' })),
      objections: (brief.objections || []).slice(0, 5).map((o) => ({ text: tidy(o.objection, 140), answer: tidy(o.answerFromEvidence, 200) || null })),
      praise: (brief.praise || []).slice(0, 5).map((x) => tidy(x.point || x.text || x, 140)), complaints: (brief.complaints || []).slice(0, 5).map((x) => tidy(x.point || x.text || x, 140)),
      words: (brief.language || []).slice(0, 12) },
    /* one tile per place, a rating to one decimal: a marketplace already summed across its listings never also shows its first listing */
    proof: { ratings: ((plats) => [...plats, ...(profile.marketplaces || []).filter((m) => !plats.some((p) => String(p.where).toLowerCase().includes(String(m.name).toLowerCase())))
        .flatMap((m) => (m.listings || []).slice(0, 1).filter((l) => l.reviews).map((l) => ({ where: m.name, count: l.reviews, rating: l.rating ? Math.round(l.rating * 10) / 10 : null, url: l.url || null })))].slice(0, 6))(
        (profile.reviews?.platforms || []).filter((p) => p.count).map((p) => ({ where: p.label || p.name, count: p.count, rating: p.rating ? Math.round(p.rating * 10) / 10 : null, url: p.url || null }))),
      quotes: [...(profile.reviews?.quotes || []).slice(0, 6).map((q) => ({ text: tidy(q.text, 260), rating: q.rating || null, product: q.product || null, url: q.url || null, where: q.src || null })), ...shelfQuotes(shelf, 4)].slice(0, 8) },
    channels: [...Object.entries(profile.socials || {}).filter(([, v]) => v?.url).map(([net, v]) => ({ net, url: v.url, handle: v.handle || null, posts: v.posts?.length || v.videos?.length || null, error: v.error || null })), ...shelfChannels(shelf)],
    markets: { primary: profile.market?.primary || profile.country || null, others: profile.market?.others || [], cities: [...new Set(Object.values(shelf || {}).map((f) => f?.city).filter(Boolean))], languages: [profile.locale, config.lang].filter(Boolean), currency: cur || null, festival: config.festival?.name || config.festival || null },
    /* each rival with what Brew read about it: live ads and the longest-running one (as words only, never its picture), visits a month */
    rivals: (profile.rivals || []).slice(0, 6).map((r) => { const a = (profile.ads?.rivals || []).find((x) => x.name === r.name || (r.host && x.host === r.host)) || {}, top = [...(a.items || [])].filter((x) => x.days).sort((p, q) => q.days - p.days)[0];
      const t = (traffic?.rows || []).find((x) => x.host === r.host);
      return { name: r.name, host: r.host || null, why: tidy(r.why, 160) || null, liveAds: a.error ? null : a.live ?? null, longestAd: top ? { days: top.days, hook: tidy(top.hook || top.body, 120) } : null, visits: t?.visits ?? null }; }),
    rules: { never: [], neverDefault: String(config.banned || '') || null }
  };
}

/* ---------------- the evidence the writer reads, numbered so every line can say where it came from ---------------- */
export function evidenceOf({ profile = {}, brief = {}, pages = [], enrich = null } = {}) {
  const E = []; const add = (kind, text, src) => { const t = tidy(text, kind === 'page' ? 6000 : 600); if (t.length > 12) E.push({ id: `E${E.length + 1}`, kind, text: t, src: src || null }); };
  if (profile.tagline) add('tagline', profile.tagline, profile.url);
  if (profile.descriptor) add('descriptor', profile.descriptor, profile.url);
  if (profile.about) add('about', profile.about, profile.aboutUrl || profile.url);
  for (const p of pages) add(p.guide ? 'brand-guide' : 'page', p.text, p.url);
  for (const pr of (profile.catalog?.products || []).slice(0, 12)) add('product', [pr.title, pr.type, pr.about, ...(pr.claims || []).slice(0, 3)].filter(Boolean).join(' · '), pr.url);
  const ig = [...((enrich?.ig?.posts?.length ? enrich.ig.posts : profile.socials?.instagram?.posts) || [])].filter((x) => x.caption).sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 8);
  for (const x of ig) add('instagram', x.caption, x.url);
  for (const a of (profile.ads?.own?.items || []).slice(0, 8)) add('ad', [a.hook, a.body, a.cta && `CTA: ${a.cta}`].filter(Boolean).join(' — '), a.url);
  for (const v of (profile.socials?.youtube?.videos || []).slice(0, 4)) add('youtube', v.title, v.url);
  for (const t of (enrich?.tiktok?.videos || []).filter((x) => x.caption).sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5)) add('tiktok', t.caption, t.url);
  /* what the brand says out loud in its own films: the spoken voice, for scripts and voiceovers */
  for (const f of Object.values(enrich?.yt || {}).filter((x) => x.text)) E.push({ id: `E${E.length + 1}`, kind: 'film-words', text: tidy(f.text, 2500), src: f.url || null });
  for (const q of (profile.reviews?.quotes || []).slice(0, 8)) add('review', q.text, q.url || null);
  if (brief?.language?.length) add('customer-words', brief.language.join(', '), null);
  for (const c of (brief?.claims || []).slice(0, 8)) add('claim', `${c.claim}${c.basis ? ` (${c.basis})` : ''}`, null);
  return E;
}

/* the pages worth reading that the read didn't keep: home, about, and a brand/press/media-kit page they link to */
async function fetchPages(profile, { fetchText, log = console } = {}) {
  const want = [...new Set([profile.url, profile.aboutUrl].filter(Boolean))], pages = [], guides = [], errors = [];
  for (const u of want) {
    const r = await fetchText(u).catch((e) => ({ error: e.message }));
    if (r?.error || !r?.html) { errors.push({ url: u, error: r?.error || 'empty page' }); log.info?.('[book] page', u, r?.error || 'empty'); continue; }
    pages.push({ url: u, text: stripTags(r.html), home: u === profile.url });
    for (const l of links(r.html, u)) { const href = l?.url || l; if (href && GUIDE_RE.test(href) && hostOf(href) === hostOf(u) && !guides.includes(href)) guides.push(href); }
  }
  for (const g of guides.filter((x) => !/\.pdf(\?|$)/i.test(x)).slice(0, 2)) {
    const r = await fetchText(g).catch(() => null); if (r?.html) pages.push({ url: g, text: stripTags(r.html), guide: true });
  }
  return { pages, guides: guides.slice(0, 6), errors };
}
async function plainFetch(u) {
  const r = await safeFetch(u, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(15e3) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { html: (await r.text()).slice(0, 600000) };
}
/* a bot wall (403/429, a challenge page) gets one rendered fetch through the shared treg client (24-hour cache) */
export const fetcherWith = (treg) => async (u) => {
  try { const r = await plainFetch(u); if (!/cf-chl|captcha|Just a moment|Access Denied/i.test(r.html.slice(0, 4000))) return r; throw new Error('bot wall'); }
  catch (e) {
    if (!treg?.call) throw e;
    const j = await treg.call('litescrape.web.fetch.post', { query: { timeout: 60 }, body: { url: u, respond_with: 'html', engine: 'browser', respond_timing: 'network-idle', remove_overlay: true }, tag: 'brandbook', timeout: 75e3 });
    const html = j?.content || j?.html || j?.text; if (!html) throw e; return { html: String(html).slice(0, 600000) };
  }
};

const S = { type: 'string' }, IDS = { type: 'array', items: S, description: 'evidence ids (E1, E2…) this comes from' };
const obj = (properties) => ({ type: 'object', properties });
export const SCHEMA = obj({
  story: obj({ positioning: { type: 'string', description: 'one line: what they are and for whom' }, mission: S, values: { type: 'array', items: S }, founderStory: { type: 'string', description: 'only if the evidence tells it' }, e: IDS }),
  voice: obj({
    summary: { type: 'string', description: 'one sentence: how the brand sounds' },
    traits: { type: 'array', description: '3 to 5', items: obj({ trait: S, why: S, sounds: { type: 'string', description: 'a line copied word for word from the evidence that shows it' }, e: IDS }) },
    never: { type: 'array', description: 'how it never sounds, 2 to 4: the opposite of what the evidence shows', items: obj({ text: S, why: S }) },
    reading: { type: 'string', description: 'reading level and sentence length, a few words' },
    language: { type: 'string', description: 'languages and mixes it writes in, e.g. English, Hinglish' },
    cta: obj({ style: S, examples: { type: 'array', items: { type: 'string', description: 'copied word for word' } } }),
    pairs: { type: 'array', description: '2 to 4 do/don’t pairs; the do is copied word for word from the evidence, the don’t is how a generic brand would say it', items: obj({ do: S, dont: S }) } }),
  pillars: { type: 'array', description: '2 to 4 messaging pillars', items: obj({ pillar: S, proof: S, e: IDS }) },
  words: obj({ use: { type: 'array', items: S, description: 'words and phrases the brand itself uses, copied from the evidence' }, avoid: { type: 'array', items: S, description: 'words a category rival would use that this brand clearly avoids, only when the evidence shows it' } }),
  claims: { type: 'array', description: 'claims the brand makes on its own site or ads, copied word for word', items: obj({ text: S, e: IDS }) },
  look: obj({ notes: { type: 'string', description: 'two sentences an art director can shoot from' }, light: S, setting: S, people: { type: 'string', description: 'who appears on camera, if anyone' }, props: S, framing: S, colourUse: S, wordsOnImage: { type: 'string', description: 'how much text sits on their pictures and where' }, logoUse: { type: 'string', description: 'where and how the logo appears on their creatives' }, packaging: S }),
  typeUse: obj({ heading: S, body: S }),
  naming: obj({ pattern: S, examples: { type: 'array', items: S } }),
  colors: { type: 'array', items: obj({ hex: S, role: { type: 'string', enum: ['primary', 'accent', 'ink', 'background', 'support'] }, use: S, share: { type: 'string', description: 'rough share of a layout, e.g. 60%' } }) },
  playbooks: { type: 'array', description: 'one per family of their own pictures you were shown', items: obj({ family: S, layout: S, headline: { type: 'string', description: 'headline length and style' }, wordsOnImage: S, logo: S, cta: S, avoid: S }) },
  refs: { type: 'array', description: 'for each picture shown (by its number): what makes it theirs, one line', items: obj({ n: { type: 'number' }, why: S }) }
});

/* what the writer may say: only what an evidence line shows. Quotes are checked here, so a made-up line never survives */
export function verify(out = {}, E = [], kit = {}) {
  const ids = new Set(E.map((x) => x.id)), all = squash(E.map((x) => x.text).join(' \n '));
  const cite = (e) => (e || []).filter((x) => ids.has(x));
  const quoted = (s) => { const q = squash(s); return q.length >= 3 && all.includes(q); };
  const srcOf = (e) => cite(e).map((id) => E.find((x) => x.id === id)).filter(Boolean).map((x) => ({ id: x.id, kind: x.kind, url: x.src }));
  const st = out.story || {}, sCite = cite(st.e), v = out.voice || {};
  const traits = (v.traits || []).filter((t) => t.trait && cite(t.e).length).slice(0, 5).map((t) => ({ trait: tidy(t.trait, 40), why: tidy(t.why, 160) || null, sounds: quoted(t.sounds) ? tidy(t.sounds, 220) : null, from: srcOf(t.e) }));
  const hexes = new Set((kit.colors || []).map((c) => String(c.hex || c).toLowerCase()));
  const look = out.look || {}, lk = (k, n = 140) => tidy(look[k], n) || null;
  return {
    story: sCite.length ? { positioning: tidy(st.positioning, 200) || null, mission: tidy(st.mission, 240) || null, values: (st.values || []).map((x) => tidy(x, 40)).filter(Boolean).slice(0, 5), founderStory: tidy(st.founderStory, 400) || null, from: srcOf(st.e) } : null,
    voice: traits.length ? { summary: tidy(v.summary, 200) || null, traits, never: (v.never || []).slice(0, 4).map((n) => ({ text: tidy(n.text, 80), why: tidy(n.why, 140) || null })).filter((n) => n.text),
      reading: tidy(v.reading, 80) || null, language: tidy(v.language, 60) || null,
      cta: v.cta?.style || v.cta?.examples?.length ? { style: tidy(v.cta.style, 120) || null, examples: (v.cta.examples || []).filter(quoted).slice(0, 4).map((x) => tidy(x, 40)) } : null,
      pairs: (v.pairs || []).filter((p) => p.do && p.dont && quoted(p.do)).slice(0, 4).map((p) => ({ do: tidy(p.do, 160), dont: tidy(p.dont, 160) })) } : null,
    pillars: (out.pillars || []).filter((p) => p.pillar && cite(p.e).length).slice(0, 4).map((p) => ({ pillar: tidy(p.pillar, 60), proof: tidy(p.proof, 200) || null, from: srcOf(p.e) })),
    words: { use: [...new Set((out.words?.use || []).filter(quoted).map((w) => tidy(w, 40)))].slice(0, 16), avoid: [...new Set((out.words?.avoid || []).map((w) => tidy(w, 30)).filter(Boolean))].slice(0, 10) },
    claims: (out.claims || []).filter((c) => c.text && quoted(c.text) && cite(c.e).length).slice(0, 10).map((c) => ({ text: tidy(c.text, 160), from: srcOf(c.e) })),
    look: look.notes ? { notes: tidy(look.notes, 360), light: lk('light'), setting: lk('setting'), people: lk('people'), props: lk('props'), framing: lk('framing'), colourUse: lk('colourUse'), wordsOnImage: lk('wordsOnImage'), logoUse: lk('logoUse'), packaging: lk('packaging') } : null,
    typeUse: out.typeUse?.heading || out.typeUse?.body ? { heading: tidy(out.typeUse.heading, 120) || null, body: tidy(out.typeUse.body, 120) || null } : null,
    naming: out.naming?.pattern ? { pattern: tidy(out.naming.pattern, 160), examples: (out.naming.examples || []).filter(quoted).slice(0, 4).map((x) => tidy(x, 80)) } : null,
    /* roles only for colours the read really found on the site */
    colors: (out.colors || []).filter((c) => hexes.has(String(c.hex || '').toLowerCase())).slice(0, 8).map((c) => ({ hex: String(c.hex).toLowerCase(), role: c.role || 'support', use: tidy(c.use, 100) || null, share: tidy(c.share, 12) || null })),
    playbooks: (out.playbooks || []).filter((p) => REF_FAMILIES[p.family]).slice(0, 6).map((p) => ({ family: p.family, layout: tidy(p.layout, 160) || null, headline: tidy(p.headline, 120) || null, wordsOnImage: tidy(p.wordsOnImage, 120) || null, logo: tidy(p.logo, 100) || null, cta: tidy(p.cta, 100) || null, avoid: tidy(p.avoid, 140) || null })),
    refs: (out.refs || []).filter((r) => Number.isInteger(+r.n) && r.why).map((r) => ({ n: +r.n, why: tidy(r.why, 140) }))
  };
}

/* the pictures the writer looks at: the logo, then the best two of each family the brand publishes most, then a product photo */
async function pictures(slug, profile, library, { packs }) {
  const out = [], file = (p) => (String(p || '').match(/^\/b\/[^/]+\/a\/([^?#]+)$/) || [])[1];
  const own = async (p, label, ref = null) => { const f = file(p); if (!f || /\.(svg|mp4|webm|mov)$/i.test(f)) return; const buf = await packs.get(slug, 'assets/' + f).catch(() => null);
    if (buf?.length && buf.length < 4e6) out.push({ label, ref, mime: /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg', data: buf.toString('base64') }); };
  await own(profile.identity?.logo, 'their logo');
  for (const f of ['ad-image', 'ad-video', 'ad-carousel', 'ig-post', 'ig-reel', 'ig-carousel', 'tiktok', 'youtube']) for (const r of (library[f] || []).slice(0, 2)) if (out.length < 10) await own(r.src, `${REF_FAMILIES[f]} (${f})`, r.id);
  for (const r of (library['product-photo'] || []).slice(0, 2)) if (out.length < 12) await own(r.src, 'a product photo from their store (product-photo)', r.id);
  return out;
}

/* what the book is made from, as one short hash: when it changes, the book is written again */
export function bookSig(profile = {}, brief = {}, enrich = null, shelf = null) {
  const id = profile.identity || {};
  return hash(JSON.stringify([profile.tagline, profile.descriptor, profile.about, id.logo, id.colors, id.fonts,
    (profile.ads?.own?.items || []).map((a) => [a.id, a.poster, a.video]), (profile.socials?.instagram?.posts || []).map((x) => [x.url, x.img]),
    (profile.socials?.youtube?.videos || []).map((v) => v.url), (profile.socials?.tiktok?.videos || []).map((v) => v.url),
    profile.catalog?.hero, (profile.catalog?.products || []).length, (profile.reviews?.quotes || []).map((q) => q.text?.slice(0, 40)), brief?.at, (brief?.claims || []).length, enrich?.at || null, ...(shelf ? Object.values(shelf).map((f) => f?.at || null) : [])]));
}

export function createBookReader({ packs, ai, treg = null, enricher = null, log = console, fetchText = null, now = () => Date.now() }) {
  const running = new Map(), fetch1 = fetchText || fetcherWith(treg);
  async function build(slug, { why = 'read' } = {}) {
    const P = (n, d) => packs.getJSON(slug, n, d).catch(() => d);
    const [profile, brief, ledger, config, traffic, ...sh] = await Promise.all([P('profile.json', null), P('brief.json', null), P('ledger.json', []), P('config.json', {}), P('shelf/traffic.json', null), ...SHELF_KEYS.map((k) => P(`shelf/${k}.json`, null))]);
    const shelf = Object.fromEntries(SHELF_KEYS.map((k, i) => [k, sh[i]]).filter(([, f]) => f));
    if (!profile?.host) return { error: 'The store hasn’t been read yet.', skip: true };
    if (profile.closed) return { error: 'This store isn’t open yet, so there is nothing to build a brand book from.', skip: true };
    /* this week's fresh posts, reels, TikToks and film words (paid, capped, saved once); else what was saved last time */
    const enrich = enricher ? await enricher.run(slug).catch((e) => (log.warn?.('[book] enrich', slug, e.message), null)) : await P('enrich.json', null);
    const { pages, guides, errors } = await fetchPages(profile, { fetchText: fetch1, log });
    const home = pages.find((p) => p.home)?.text || '';
    const free = freeChapters({ profile, brief: brief || {}, ledger: Array.isArray(ledger) ? ledger : [], homeText: home, config: config || {}, shelf, traffic });
    const library = libraryOf(profile, { enrich });
    const E = evidenceOf({ profile, brief: brief || {}, pages, enrich });
    const base = { v: BOOK_V, sig: bookSig(profile, brief, enrich, shelf), enrichErrors: enrich?.errors && Object.keys(enrich.errors).length ? enrich.errors : null, at: new Date(now()).toISOString(), readAt: profile.meta?.readAt || null, why, guides, pageErrors: errors, ...free, library,
      evidence: E.map(({ id, kind, src, text }) => ({ id, kind, url: src, text: tidy(text, 240) })) };
    if (!ai?.call) return { ...base, error: 'The AI is off on this server, so the voice, story and look weren’t written.' };
    const pics = await pictures(slug, profile, library, { packs });
    const kit = free.kit;
    const ask = [
      `Write the brand book for ${free.cover.name || profile.host} (${free.cover.category || 'a brand'}${profile.storeKind === 'enquiry' ? ', sells by enquiry' : ''}), from its own evidence only.`,
      'Rules: every item names the evidence ids it comes from. A voice "sounds" line, a do in a do/don’t pair, a CTA example, a word in words.use, a claim and a naming example are copied word for word from the evidence. If the evidence doesn’t show something, leave it empty: never guess, never describe a typical brand in this category.',
      kit.colors.length ? `Colours found on their site: ${kit.colors.map((c) => c.hex).join(', ')}. Give each a role, say how they use it, and its rough share of a layout.` : 'No colours were found: leave colors empty.',
      kit.fonts.heading || kit.fonts.body ? `Fonts on their site: heading ${kit.fonts.heading || 'unknown'}, body ${kit.fonts.body || 'unknown'}. Say how each is used.` : '',
      pics.length ? `The pictures, in order: ${pics.map((p, i) => `${i + 1}. ${p.label}`).join('; ')}. Describe their look (photo style, who is on camera, words on the image, logo use, packaging) from their own pictures only; write one playbook per family shown (use the family code in brackets), and for each picture after the logo say in one line what makes it theirs.` : 'There are no pictures: leave look, playbooks and refs empty.',
      'Evidence:', ...E.map((x) => `${x.id} [${x.kind}${x.src ? ` · ${x.src}` : ''}] ${x.text}`)
    ].filter(Boolean).join('\n');
    try {
      const r = await ai.call({ model: 'sonnet', tag: 'brandbook-read', max: 9000, effort: 'low', schema: SCHEMA,
        messages: [{ role: 'user', content: [...pics.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } })), { type: 'text', text: ask }] }] });
      const w = verify(r.json || {}, E, kit);
      /* "what makes it theirs" goes onto the picture it was said about */
      for (const x of w.refs) { const id = pics[x.n - 1]?.ref; if (!id) continue; for (const f of Object.values(library)) for (const ref of f) if (ref.id === id) ref.why = x.why; }
      const roles = new Map(w.colors.map((c) => [c.hex, c]));
      const colors = kit.colors.map((c) => ({ ...c, ...(roles.get(c.hex) || {}) }));
      const cover = { ...base.cover, tagline: base.cover.tagline || (taglineOk(w.story?.tagline) ? w.story.tagline : null) };
      return { ...base, cover, kit: { ...kit, colors, typeUse: w.typeUse }, story: { ...base.story, ...(w.story || {}) }, voice: w.voice, pillars: w.pillars,
        words: { ...w.words, customers: base.people.words }, proof: { ...base.proof, claims: w.claims }, look: w.look, naming: w.naming, playbooks: w.playbooks, library, usd: +(+r.usd || 0).toFixed(4) };
    } catch (e) { log.warn?.('[book] write', slug, e.message); return { ...base, error: e.billing ? 'The AI is paused, so the voice, story and look will be written once it’s back.' : 'The voice, story and look couldn’t be written this time; Brew tries again on the next open.' }; }
  }
  /* built once per read: missing, an older version, older than the read, or an error from more than an hour ago */
  /* kept up to date by itself: rebuilt when anything it is made from changes (a re-read, healed ads, new posts or films, new
     products, a new brief, a new kit), at most every 6 hours for those, and at least every week (with fresh posts, reels, TikToks and films). A re-read or a new version
     rebuilds at once; an error retries after an hour. Team edits and uploads never wait: they sit on top and show at once */
  async function stale(slug) {
    const [b, p, br, en] = await Promise.all([packs.getJSON(slug, FILE, null).catch(() => null), packs.getJSON(slug, 'profile.json', null).catch(() => null), packs.getJSON(slug, 'brief.json', null).catch(() => null), packs.getJSON(slug, 'enrich.json', null).catch(() => null)]);
    if (!p?.host || p.closed) return false;
    if (!b || b.v !== BOOK_V) return true;
    if (p.meta?.readAt && b.readAt !== p.meta.readAt) return true;
    const age = now() - Date.parse(b.at || 0);
    if (b.error) return age > 36e5;
    const sh = Object.fromEntries((await Promise.all(SHELF_KEYS.map((k) => packs.getJSON(slug, `shelf/${k}.json`, null).catch(() => null)))).map((f, i) => [SHELF_KEYS[i], f]).filter(([, f]) => f));
    return (b.sig !== bookSig(p, br, en, sh) && age > 6 * 36e5) || age > 7 * 864e5; /* weekly at least: the enrichment refreshes on the same beat */
  }
  async function ensure(slug, opts = {}) {
    if (running.has(slug)) return running.get(slug);
    const job = (async () => {
      if (!opts.force && !(await stale(slug))) return packs.getJSON(slug, FILE, null);
      const book = await build(slug, opts);
      if (book && !book.skip) await packs.put(slug, FILE, book);
      return book;
    })().catch((e) => (log.warn?.('[book] ensure', slug, e.message), null)).finally(() => running.delete(slug));
    running.set(slug, job); return job;
  }
  const get = (slug) => packs.getJSON(slug, FILE, null).catch(() => null);
  return { build, ensure, stale, get, running: (slug) => running.has(slug), FILE };
}
