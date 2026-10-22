// Stage 5 · ads: the brand's own live Meta ads and up to 5 rivals' (Meta Ad Library via treg ScrapeCreators).
// Rivals come from Claude web search (named with a source) cross-checked with Google SERP overlap on 2–3
// category queries (treg crawl4ai SERP); each rival homepage + 1–2 product pages are read for prices,
// claims, offers and guarantee. Ad posters are downloaded because Ad Library URLs expire.
import { marketLine } from '../../market.js';
import { CLOSED_WHY } from '../closed.js';
import { adLibrary, adCall } from '../adlib.js';
import { numbersOf, adsStepLine } from '../../pack-numbers.js';
import { meta, titleOf, jsonLd, typeIs, clean, stripTags, pathOf, hostOf, money, pool, registrable, today, links } from '../util.js';
import { findProductUrls, productFromPage, sitemapUrls } from '../products.js';

const NOT_BRANDS = /(^|\.)(amazon|flipkart|nykaa|myntra|ajio|meesho|tatacliq|jiomart|bigbasket|blinkit|zepto|swiggy|purplle|1mg|netmeds|pharmeasy|apollopharmacy|healthkart|walmart|target|ulta|sephora|cvs|walgreens|costco|ebay|etsy|aliexpress|temu|shein|boots|superdrug|lookfantastic|feelunique|cultbeauty|youtube|facebook|instagram|reddit|quora|wikipedia|pinterest|tiktok|twitter|x|linkedin|medium|healthline|webmd|mayoclinic|clevelandclinic|byrdie|allure|vogue|elle|cosmopolitan|refinery29|nytimes|wirecutter|forbes|buzzfeed|economictimes|indiatimes|timesofindia|ndtv|hindustantimes|livemint|news18|thehindu|indianexpress|vogue|femina|nykaa|google|bing|gov|nih|ncbi|sciencedirect|researchgate|practo|lybrate|justdial|indiamart|glamour|goodhousekeeping|harpersbazaar|womenshealthmag|menshealth|gq|businessinsider|cnn|bbc|theguardian|telegraph|dailymail|independent|which|trustpilot|sitejabber|bestproducts|thestrategist|nymag|verywellhealth|everydayhealth|medicalnewstoday|drugs|rxlist|skinkraft|stylecraze|bebeautiful|missmalini|popxo|pinkvilla|scoopwhoop|thebetterindia|yourstory|inc42|entrackr|vccircle|crunchbase|tracxn)\./i;

// Ad Library through treg (reader cache), falling back to the free page reader when treg fails or is off
const adq = (ctx, id, query, cacheKey) => adCall(ctx.tregOn ? { call: (i, o) => ctx.treg(i, o, cacheKey) } : null, id, { query });

// bump when the ads stage starts reading differently: saved reads with an older version are healed once
export const ADS_V = 4; // 3: link-preview page titles are not hooks; 4: the ledger says how ads and rivals were really found

// every rival in the ledger, saying how it was really found
function noteRivals(ctx) {
  const { profile, ledger } = ctx;
  profile.rivals.forEach((r) => ledger.add({ key: `rival.${r.host.replace(/\./g, '-')}.found`, label: `Rival: ${r.name}`, v: r.host, url: r.source || `https://${r.host}`, method: /suggested by AI/.test(r.how) ? 'claude:memory' : /Ad Library/i.test(r.how) ? 'adlib:category-search' : /web search/.test(r.how) ? 'claude:web_search' : 'treg:crawl4ai.google.serp.organic', /* how it was really found */ layer: 'inferred', conf: r.how.includes('+') ? 'high' : 'medium', note: `${r.how}. ${r.why || ''}`.trim() }));
}

/* the onboarding's rival taps, sent however the search ended: the rivals found (the check page's fields: build.js checkData), or
   { error } when the search didn't go through; never [] for a failure. Both tries of a failed search report (index.js adds the
   final error when the stage timed out and could no longer emit) */
export async function findRivals(ctx) {
  let err = null;
  try { await rivalSearch(ctx); } catch (e) { err = e; throw e; } finally { pickRivals(ctx, err); }
}
function pickRivals(ctx, err) {
  if (!ctx.picks) return;
  const rivals = (ctx.profile.rivals || []).filter((r) => r?.name && r?.host);
  const why = err?.message || ctx.state?.rivalsNotChecked;
  if (!rivals.length && why) return ctx.picks('rivals', { error: String(why).replace(/\s+/g, ' ').slice(0, 120) });
  ctx.picks('rivals', rivals.map((r) => ({ host: r.host, name: r.name, logo: r.logo || `https://www.google.com/s2/favicons?domain=${r.host}&sz=64`, how: r.how || r.why || '' })));
}
async function rivalSearch(ctx) {
  const { profile, ledger } = ctx;
  if (!ctx.tregOn && !ctx.aiOn) { profile.rivals = []; if (ctx.state) ctx.state.rivalsNotChecked = 'paid sources off'; return; }
  const cc = (profile.country || 'US').toLowerCase();
  const queries = (ctx.state.categoryQueries || []).slice(0, 3);
  const serp = []; let serpOk = 0, aiErr = null; /* which rival sources went through: a list that stays empty because both failed is "not checked", never "no rivals" */
  // SERP overlap: which store domains rank for the category's buying queries
  if (ctx.tregOn && queries.length) {
    await pool(queries, 3, async (q) => {
      try { const j = await ctx.treg('crawl4ai.google.serp.organic', { query: { q, country: cc, num: 20 } }, `${cc}-${q}`);
        const results = (j?.results || []).map((r) => ({ pos: r.position, domain: registrable(r.domain || hostOf(r.url)), title: clean(r.title), url: r.url }));
        serp.push({ q, results }); serpOk++; }
      catch (e) { ctx.log.warn?.('[reader] serp', q, e.message); }
    });
  }
  profile.search = { ...(profile.search || {}), terms: queries, serp };
  const own = registrable(profile.host);
  const freq = new Map();
  for (const s of serp) for (const r of s.results) { if (!r.domain || r.domain === own || NOT_BRANDS.test(r.domain + '.')) continue; const f = freq.get(r.domain) || { domain: r.domain, n: 0, best: 99, qs: [] }; f.n++; f.best = Math.min(f.best, r.pos || 99); f.qs.push(s.q); freq.set(r.domain, f); }
  const ownRank = serp.map((s) => ({ q: s.q, pos: s.results.find((r) => r.domain === own)?.pos || null }));
  /* a closed store can't rank: Google never sees a store behind Shopify's password page. The category searches still find
     rivals (and are the moves' stored evidence); the store's own rank says plainly it wasn't checked */
  if (ctx.state?.closed) { profile.search.closed = true; ledger.add({ key: 'search.rank', label: `Google rank for the category searches (${cc.toUpperCase()})`, v: `not checked: ${CLOSED_WHY}`, url: profile.url, method: 'shopify-admin', note: 'Google can’t list a store behind the password page; Brew checks once it opens' }); }
  else ownRank.forEach((o) => ledger.add({ key: `search.rank.${o.q.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label: `Google rank for "${o.q}" (${cc.toUpperCase()})`, v: o.pos ? `#${o.pos}` : 'not in top 20', ...(o.pos ? { n: o.pos } : {}), url: `https://www.google.com/search?q=${encodeURIComponent(o.q)}&gl=${cc}`, method: 'treg:crawl4ai.google.serp.organic' }));
  /* a re-read of a brand Brew already knows (the weekly check): its rivals stay the brand's list, so there is no paid search
     for new ones; each known rival's store is read again for today's prices, claims and offers */
  const known = (ctx.prev?.rivals || []).filter((r) => r?.host && r?.name).slice(0, 5);
  if (known.length) {
    const picked = known.map((r) => ({ name: r.name, host: r.host, why: r.why || '', source: r.source || null, how: r.how || 'kept from the first read' }));
    await pool(picked, 5, (r) => crawlRival(ctx, r));
    profile.rivals = picked.filter((r) => r.name); noteRivals(ctx); return;
  }

  // Claude web search: named competitors with a source
  let named = [];
  if (ctx.aiOn) {
    try {
      const ask = (tag) => ctx.ai({ tag, model: 'sonnet', search: 4, location: profile.country || undefined, max: 2500,
        system: 'You research D2C competitors. Only name companies that a source you found calls a competitor or alternative, or that clearly sell the same kind of product to the same shoppers in the same country. Never invent a website. Never state a rival\'s motive.',
        prompt: `Brand: ${profile.name} (${profile.host}). Category: ${profile.category || 'unknown'}${profile.subcategory ? ` / ${profile.subcategory}` : ''}. ${marketLine(profile)}\nFind the main direct competitors of ${profile.name} in ${profile.country || 'its market'}: D2C or consumer brands selling the same kind of product to the same shoppers. Up to 6.\nReturn JSON only: {"rivals":[{"name":"","host":"brand's own store domain, e.g. example.com","why":"one short factual line","source":"URL that supports it"}]}`, json: true });
      // web search can fail for a moment (it did on a live read): one retry before we give up on named rivals
      let r = await ask('reader-rivals');
      if (!(r.json?.rivals || []).length) { await new Promise((ok) => setTimeout(ok, 4000)); r = await ask('reader-rivals-retry'); }
      const cites = new Set((r.cites || []).map((c) => c.url));
      named = (r.json?.rivals || []).filter((x) => x.name && x.host).map((x) => ({ ...x, host: registrable(String(x.host).replace(/^https?:\/\//, '').split('/')[0]), sourced: !!x.source && (cites.has(x.source) || [...cites].some((c) => hostOf(c) === hostOf(x.source))) }));
    } catch (e) { ctx.log.warn?.('[reader] rivals ai', e.message); aiErr = e.message; }
  }
  // merge: web-search rivals first (boosted when they also rank), then strong SERP-only store domains
  const out = [];
  for (const x of named) { if (x.host === own || NOT_BRANDS.test(x.host + '.')) continue; const f = freq.get(x.host); out.push({ name: clean(x.name), host: x.host, why: clean(x.why), source: x.source || null, how: [x.sourced ? 'web search (cited)' : 'web search', f ? `ranks on ${f.n} category search${f.n > 1 ? 'es' : ''}` : null].filter(Boolean).join(' + '), score: (x.sourced ? 3 : 2) + (f ? f.n : 0) }); }
  for (const f of [...freq.values()].sort((a, b) => b.n - a.n || a.best - b.best)) { if (out.some((o) => o.host === f.domain) || f.n < 2) continue; out.push({ name: null, host: f.domain, why: `ranks on ${f.n} of ${serp.length} category searches`, how: 'SERP overlap', score: f.n }); }
  const picked = out.sort((a, b) => b.score - a.score).slice(0, 5);
  // mini-crawl each rival: name, prices, claims, offers, guarantee
  await pool(picked, 5, (r) => crawlRival(ctx, r));
  // a SERP-only domain counts as a rival only when it is a store (we could read product prices on it)
  profile.rivals = picked.filter((r) => r.name && (r.how !== 'SERP overlap' || r.prices?.length)).map(({ score, ...r }) => r);
  // the rivals agent: a brand always gets rivals. When the first pass finds fewer than 3, try more sources in turn,
  // and keep a candidate only once its own store has been read (name, prices); every rival says how it was found.
  const have = () => new Set([own, ...profile.rivals.map((r) => r.host)]);
  const tryAdd = async (cands, how) => {
    for (const c of cands) {
      if (profile.rivals.length >= 5) return; const host = registrable(String(c.host || '').replace(/^https?:\/\//, '').split('/')[0]);
      if (!host || have().has(host) || NOT_BRANDS.test(host + '.')) continue;
      const r = { name: c.name ? clean(c.name) : null, host, why: clean(c.why || how), source: c.source || null, how };
      try { await crawlRival(ctx, r); } catch (e) { ctx.log.warn?.('[reader] rival crawl', host, e.message); continue; }
      if (!r.url || (!r.prices?.length && !r.claims?.length)) continue; // not a readable store: skip it
      r.name ||= host; profile.rivals.push(r);
      ledger.add({ key: `rival.${host.replace(/\./g, '-')}.found`, label: `Rival: ${r.name}`, v: host, url: r.source || r.url, method: how });
    }
  };
  const ask2 = (tag, prompt, search = 4) => ctx.ai({ tag, model: 'sonnet', search, location: profile.country || undefined, max: 2000, json: true,
    system: 'You list direct competitors of a consumer brand: brands that sell the same kind of product to the same shoppers in the same country. Give each brand\'s own store domain. Never invent a website.',
    prompt: `${prompt}\nReturn JSON only: {"rivals":[{"name":"","host":"their own store domain","why":"one short factual line","source":"a URL if you have one, else empty"}]}` }).then((r) => r.json?.rivals || []).catch(() => []);
  if (profile.rivals.length < 3 && ctx.aiOn) await tryAdd(await ask2('reader-rivals-alt', `Brand: ${profile.name} (${profile.host}), ${profile.category || ''} in ${profile.country || ''}. Search for "alternatives to ${profile.name}", "brands like ${profile.name}" and "best ${profile.subcategory || profile.category || 'brands'} in ${profile.country || ''}". Up to 8.`), 'web search (alternatives)');
  if (profile.rivals.length < 3 && queries[0]) {
    // who advertises on the category's buying searches in the Ad Library: their ads link to their stores
    try { const j = await adq(ctx, 'scrapecreators.x.v1-facebook-adlibrary-search-ads', { query: queries[0], country: (profile.country || 'ALL'), status: 'ACTIVE', trim: true }, `${cc}-adsearch-${queries[0]}`);
      const by = new Map(); for (const a of j?.searchResults || []) { const h = registrable(hostOf(a.snapshot?.link_url || '')); if (!h || h === own) continue; const x = by.get(h) || { host: h, name: a.page_name, n: 0 }; x.n++; by.set(h, x); }
      await tryAdd([...by.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((x) => ({ ...x, why: `runs ${x.n} live ad${x.n === 1 ? '' : 's'} for "${queries[0]}"` })), 'Ad Library (category search)'); } catch (e) { ctx.log.warn?.('[reader] rivals ad search', e.message); }
  }
  if (profile.rivals.length < 3 && ctx.aiOn) await tryAdd(await ask2('reader-rivals-known', `Which D2C brands compete most directly with ${profile.name} (${profile.host}, ${profile.category || ''}) for the same shoppers in ${profile.country || 'its market'}? Up to 8, the closest first.`, 0), 'suggested by AI, store read live');
  /* nothing found because the AI search threw (or was off) and no category search answered: the check didn't go through */
  if (!profile.rivals.length && (aiErr || !ctx.aiOn) && !serpOk && ctx.state) ctx.state.rivalsNotChecked = aiErr ? `rival search failed: ${String(aiErr).slice(0, 80)}` : 'rival search unavailable (AI off, no category search answered)';
  noteRivals(ctx);
}

async function crawlRival(ctx, r) {
  const { http, ledger } = ctx; const key = r.host.replace(/\./g, '-');
  const cc = ctx.profile.country;
  // read the rival in our market (Shopify stores price by the visitor's country)
  const home = await http.get(`https://${r.host}/${cc ? `?country=${cc}` : ''}`, { key: `rival-${key}-home` });
  let html = home.ok ? home.text : null;
  if (!html || html.length < 3000) { const rr = await ctx.render(`https://${r.host}/`, `rival-${key}-home-rendered`); if (rr) html = rr.html; }
  if (!html) return;
  const base = (home.url || `https://${r.host}/`).replace(/\?country=[A-Z]{2}$/, '');
  r.name ||= meta(html, 'og:site_name') || (titleOf(html) || '').split(/\s+[|–—-]\s+/)[0] || r.host;
  r.name = clean(r.name).slice(0, 40);
  r.url = base;
  const txt = stripTags(html);
  r.claims = [meta(html, 'description'), ...[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(stripTags(m[1])))].filter((x) => x && x.length > 8 && x.length < 200).slice(0, 3);
  r.offers = [...new Set((txt.match(/[^\n.]{0,60}(\d{1,2}\s?% off|flat \d+|buy \d+ get \d+|bogo|free (shipping|delivery|gift)[^\n.]{0,40}|use code [A-Z0-9]+)[^\n.]{0,40}/gi) || []).map(clean))].slice(0, 4);
  r.guarantee = clean((txt.match(/[^\n.]{0,80}(money[- ]back|satisfaction guarantee|\d+[- ]day (?:return|refund|guarantee)|full refund)[^\n.]{0,80}/i) || [])[0] || '') || null;
  r.prices = [];
  // Shopify rivals: their own catalog; others: JSON-LD on 1–2 product pages linked from the home page
  const pj = await http.get(`${new URL(base).origin}/products.json?limit=250${cc ? `&country=${cc}` : ''}`, { as: 'json', key: `rival-${key}-products` });
  const cur = (html.match(/Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/) || [])[1] || (html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/) || [])[1] || ctx.profile.currency;
  if (pj.ok && pj.json?.products?.length) {
    const ps = pj.json.products.filter((p) => p.variants?.some((v) => v.available) && !/gift card|sample/i.test(p.title));
    r.productCount = pj.json.products.length;
    // the rival's products closest to ours: share a word with our hero products' titles/types (serum, shampoo…)
    const ours = new Set((ctx.profile.catalog?.hero || []).map((h) => (ctx.profile.catalog.products.find((x) => x.handle === h) || {})).flatMap((x) => `${x.title || ''} ${x.type || ''}`.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !/^(with|pack|free|combo|from|that|this|your|ml|for)$/.test(w)));
    const rel = (p) => (p.title.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => ours.has(w)).length;
    ps.sort((a, b) => rel(b) - rel(a));
    for (const p of ps.filter((p) => !/🎁|\bfree\b|gift|bag|pouch|merch|mist by/i.test(p.title)).slice(0, 6)) { const v = p.variants.find((x) => x.available) || p.variants[0]; const price = +v.price; if (!price) continue; r.prices.push({ title: clean(p.title).slice(0, 70), price, mrp: +v.compare_at_price > price ? +v.compare_at_price : null, currency: cur, url: `${new URL(base).origin}/products/${p.handle}` }); }
    r.platform = 'shopify';
  } else {
    /* any other platform: learn the rival's product links from its home page (reader/products.js), then read a few */
    const page = async (u, k) => { const pr = await http.get(u, { key: `rival-${key}-${k}` }).catch(() => null); return pr?.ok ? pr.text : null; };
    const ro = new URL(base).origin;
    let found = await findProductUrls({ urls: [], homeLinks: links(html, base), origin: ro, fetchPage: page, max: 6 }).catch(() => ({ urls: [] }));
    // a home page drawn by script, or blocked: the rival's own sitemap (product files first)
    if (!found.urls.length) { const sm = await sitemapUrls((u) => http.get(u, { key: `rival-${key}-sm-${u.split('/').pop().slice(0, 40)}` }), ro).catch(() => []);
      if (sm.length) found = await findProductUrls({ urls: sm, origin: ro, fetchPage: page, max: 6, market: ctx.profile.country }).catch(() => found); }
    let renders = 0; /* a product page drawn by script or blocked: rendered through treg, at most 3 per rival */
    for (const [i, u] of found.urls.slice(0, 5).entries()) { if (r.prices.length >= 4) break;
      let h = await page(u, 'pp-' + i); let it = h && productFromPage(h, u);
      if (!(it?.price > 0) && renders < 3) { renders++; const rr = await ctx.render(u, `rival-${key}-pp-${i}-rendered`); it = rr?.html ? productFromPage(rr.html, u) : it; }
      if (it?.title && it.price > 0) r.prices.push({ title: clean(it.title).slice(0, 70), price: it.price, mrp: it.mrp || null, currency: it.currency || cur, url: u }); }
    r.platform = r.platform || 'other';
    if (!r.prices.length) r.pricesError = found.urls.length ? "product pages found, but their prices couldn't be read" : "no product pages found on the home page";
  }
  r.prices.forEach((p, i) => ledger.add({ key: `rival.${key}.price.${i + 1}`, label: `${r.name}: ${p.title}`, v: money(p.price, p.currency), n: p.price, unit: p.currency, url: p.url, method: r.platform === 'shopify' ? 'products.json' : 'jsonld (product page)' }));
  if (r.guarantee) ledger.add({ key: `rival.${key}.guarantee`, label: `${r.name} guarantee line`, v: r.guarantee.slice(0, 160), url: base, method: 'crawl' });
}

export async function ads(ctx) {
  const { profile, ledger } = ctx;
  const country = profile.country || 'ALL';
  ctx.tick('ads', 'facebook.com/ads/library');
  const pull = async (name, matchRe, cc = country) => {
    const j = await adq(ctx, 'scrapecreators.x.v1-facebook-adlibrary-company-ads', { companyName: name, country: cc, status: 'ACTIVE' }, `${cc}-${name}`);
    let rows = (j?.results || []).filter((a) => matchRe.test(a.page_name || a.snapshot?.page_name || ''));
    // the page reader sees one page of keyword results: read the matched page itself for its full live count
    if (j?.source === 'adlib' && rows.length && rows[0].page_id) { try { const k = await adLibrary({ pageId: rows[0].page_id, country: cc }); const own = k.results.filter((a) => String(a.page_id) === String(rows[0].page_id)); if (own.length) return { rows: own, live: +k.searchResultsCount || own.length, reported: k.searchResultsCount, page: String(own[0].page_name || '').trim(), pageId: own[0].page_id, via: 'adlib' }; } catch (e) { ctx.log.warn?.('[reader] adlib page', rows[0].page_id, e.message); } }
    // every ad returned is from this page: the query's own total is the page's live count; else count what matched
    const all = (j?.results || []).length; const live = rows.length && rows.length === all && j?.searchResultsCount > all ? +j.searchResultsCount : rows.length;
    return { rows, live, reported: j?.searchResultsCount ?? null, page: rows[0]?.page_name || null, pageId: rows[0]?.page_id || null, via: j?.source === 'adlib' ? 'adlib' : 'treg' };
  };
  // page name starts with the brand name, ignoring spaces/punctuation and a short tail ("Yoga Bar" → "Yogabars", "SuperYou India")
  const squash = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const reOf = (n) => { const want = squash(n); return { test: (page) => { const got = squash(page); if (!want || !got.startsWith(want)) return false; const tail = got.length - want.length; return tail <= 2 || new RegExp(`^\\s*${String(n).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\b`, 'i').test(page); } }; };
  const toAd = (a, brandName) => { const s = a.snapshot || {}; const c = (s.cards || [])[0] || {}; const strip = (x) => clean(String(x || '').replace(/\{\{[^}]+\}\}/g, ''));
    const v = (s.videos || [])[0] || (s.cards || []).find((x) => x.video_sd_url || x.video_hd_url); const im = (s.images || [])[0] || (s.cards || []).find((x) => x.original_image_url || x.resized_image_url);
    const start = a.start_date ? a.start_date * 1000 : null;
    // the hook: the ad's title, unless it is only the brand's or page's name; then the body's first sentence
    const sq = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const ttl = strip(s.title || c.title); const named = [brandName, a.page_name].some((n) => sq(n) && sq(ttl) === sq(n));
    // a link preview's page title ("Brand (@handle) • Instagram photos and videos", "Page | Facebook") is not ad copy
    const preview = (x) => /•\s*Instagram photos and videos|\bon Instagram:|[|\-–]\s*(Facebook|Instagram|YouTube)\s*$|\(@[\w.]+\)/i.test(x || '');
    const real = (x) => /[\p{L}\p{N}]{2,}/u.test(x || '') && !preview(x) ? x : '';
    const hook = real(!named && ttl) || real(strip(s.body?.text || c.body).split(/(?<=[.!?])\s|\n/)[0].slice(0, 120)) || real(ttl);
    return { id: a.ad_archive_id, brand: brandName, page: String(a.page_name || '').trim(), hook, body: strip(s.body?.text || c.body).slice(0, 500), cta: s.cta_text || c.cta_text || null, link: s.link_url || c.link_url || null,
      posterSrc: v?.video_preview_image_url || im?.original_image_url || im?.resized_image_url || null, videoSrc: v?.video_sd_url || v?.video_hd_url || null, format: v ? 'video' : 'image',
      days: start ? Math.max(1, Math.round((Date.now() - start) / 864e5)) : null, since: start ? new Date(start).toISOString().slice(0, 10) : null, versions: Math.max(1, a.collation_count || 1), url: `https://www.facebook.com/ads/library/?id=${a.ad_archive_id}` };
  };
  const targets = [{ name: profile.name, own: true }, ...(profile.rivals || []).map((r) => ({ name: r.name, own: false, host: r.host }))];
  // a Facebook page is often named differently from the brand ("thecometuniverse" for Comet): when the name finds
  // no ads, search the Ad Library for ads that link to the brand's own domain and read that page by its id
  const byDomain = async (host) => {
    if (!host) return null;
    const j = await adq(ctx, 'scrapecreators.x.v1-facebook-adlibrary-search-ads', { query: host, country, status: 'ACTIVE', trim: true }, `${country}-domain-${host}`);
    const hits = (j?.searchResults || []).filter((a) => String(a.snapshot?.link_url || '').includes(host.replace(/^www\./, '')));
    if (!hits.length) return null;
    const by = new Map(); hits.forEach((a) => by.set(a.page_id, (by.get(a.page_id) || 0) + 1));
    const pageId = [...by.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const k = await adq(ctx, 'scrapecreators.x.v1-facebook-adlibrary-company-ads', { pageId, country, status: 'ACTIVE' }, `${country}-page-${pageId}`);
    const rows = (k?.results || []).filter((a) => String(a.page_id) === String(pageId));
    return { rows, live: k?.searchResultsCount && rows.length === (k?.results || []).length ? +k.searchResultsCount : rows.length, reported: k?.searchResultsCount ?? null, page: rows[0]?.page_name || hits[0].page_name || null, pageId, via: 'domain' };
  };
  const results = await pool(targets, 6, async (t) => {
    try { let x = await pull(t.name, reOf(t.name)); const host = t.own ? profile.host : t.host;
      if (!x.rows.length && host) { const d = await byDomain(host).catch((e) => { ctx.log.warn?.('[reader] ads by domain', host, e.message); return null; }); if (d?.rows.length) x = d; }
      // our own page: also try the Facebook handle the site links to, and the bare domain name ("superyou")
      if (!x.rows.length && t.own) for (const alt of [profile.socials?.facebook?.handle, registrable(profile.host || '').split('.')[0]].filter((a) => a && a.toLowerCase() !== String(t.name).toLowerCase())) {
        const y = await pull(alt, reOf(alt)).catch(() => null); if (y?.rows.length) { x = y; break; } }
      // no live ads in our market: still name the page (found by its ads elsewhere), with 0 live here
      if (!x.rows.length && t.own && country !== 'ALL') { const y = await pull(t.name, reOf(t.name), 'ALL').catch(() => null); if (y?.rows.length) { const sq = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); const best = y.rows.find((a) => sq(a.page_name) === sq(t.name)) || y.rows[0]; x = { rows: [], live: 0, reported: 0, page: String(best.page_name || '').trim(), pageId: best.page_id, elsewhere: y.live }; } }
      return { ...t, ...x }; } catch (e) { return { ...t, error: e.message }; } });
  const day = today();
  for (const r of results) {
    if (!r || r.error) continue;
    r.items = r.rows.slice(0, 8).map((a) => toAd(a, r.name));
    const key = r.own ? 'ads.own.live' : `rival.${(r.host || r.name).replace(/\./g, '-')}.ads.live`;
    ledger.add({ key, label: `${r.name}: live Meta ads in ${country}`, v: String(r.live), n: r.live, unit: 'ads', url: `https://www.facebook.com/ads/library/?active_status=active&country=${country}&q=${encodeURIComponent(r.name)}`, method: r.via === 'adlib' ? 'adlib:page-reader' : 'treg:scrapecreators.x.v1-facebook-adlibrary-company-ads', note: r.page ? `page "${r.page}"; ${r.live === r.rows.length ? 'ads matched on the first result page' : `Ad Library total for the query (${r.rows.length} read)`}` : 'no ads from a page with this name' });
  }
  // download posters: own top 3, each rival's top 2
  const posters = [];
  for (const r of results.filter((x) => x && x.items)) for (const a of r.items.slice(0, r.own ? 3 : 2)) posters.push(a);
  await pool(posters, 6, async (a) => { if (a.posterSrc) a.poster = await ctx.asset(a.posterSrc, `ad-${a.id}`, { max: 8e6 }); });
  const own = results.find((r) => r && r.own);
  profile.ads = { own: own && !own.error ? { page: own.page, pageId: own.pageId, live: own.live, items: own.items.map(cleanAd) } : { page: null, live: null, items: [], error: own?.error || null },
    rivals: results.filter((r) => r && !r.own).map((r) => ({ name: r.name, host: r.host, live: r.error ? null : r.live, page: r.page || null, items: (r.items || []).map(cleanAd), ...(r.error ? { error: r.error } : {}) })), country, at: day, v: ADS_V };

  const rivalAds = profile.ads.rivals.filter((r) => r.items.length);
  const lead = rivalAds.flatMap((r) => r.items.filter((a) => a.poster).slice(0, 1))[0] || profile.ads.own.items.find((a) => a.poster);
  const copy = rivalAds.map((r) => ({ r, a: r.items.find((a) => a.hook) })).filter((x) => x.a).slice(0, 3).map(({ r, a }) => `${r.name}: "${trim(a.hook, 70)}"`).join(' ');
  const priced = (profile.rivals || []).find((r) => r.prices?.length);
  const foot = priced ? `${priced.name}: ${trim(priced.prices[0].title, 40)} at ${money(priced.prices[0].price, priced.prices[0].currency)} on ${priced.host}, ${fmt(day)}.` : '';
  const N = numbersOf({ profile }); /* the same numbers, and words, every other screen uses (pack-numbers.js) */
  const ownLine = N.ownAds.n != null ? `${profile.name}: ${N.ownAds.n.toLocaleString('en-IN')} live ads.` : '';
  const names = (profile.rivals || []).map((r) => r.name).filter(Boolean);
  const failed = profile.ads.rivals.filter((r) => r.error).length;
  const notChecked = !names.length && ctx.state?.rivalsNotChecked;
  /* three ways, never "none" for a check that didn't go through: rivals not identified (why), their ads not read, truly none */
  const rivalsWhy = notChecked ? `Rivals couldn't be identified this time (${String(notChecked).slice(0, 60)}); the next refresh tries again.`
    : !names.length ? 'No rivals could be identified.'
    : failed === profile.ads.rivals.length ? `Rivals found: ${names.slice(0, 4).join(', ')}. Their ads couldn't be read this time; the next refresh tries again.`
    : `Rivals found: ${names.slice(0, 4).join(', ')}. None of them is running Meta ads in ${country} right now.`;
  if (copy) ctx.finding('ads', { kind: 'ad', t: 'What rivals run', src: `Meta Ad Library · ${country} · live`, img: lead?.poster || null, copy, foot: [ownLine, foot].filter(Boolean).join(' ') }, 'Pulled live ads');
  else ctx.finding('ads', { kind: 'ad', t: 'What rivals run', src: `Meta Ad Library · ${country}`, img: lead?.poster || null, copy: rivalsWhy, foot: ownLine });
  /* the step: yours and the rivals' apart, never one sum; a rival list that couldn't be made or read is a partial step */
  const partial = !!notChecked || (names.length > 0 && failed === profile.ads.rivals.length) || !!profile.ads.own.error;
  ctx.done('ads', adsStepLine(N, profile.name), N.ownAds.n || N.rivalAds.n ? 'done' : 'empty', { partial });
}
const cleanAd = ({ posterSrc, videoSrc, ...a }) => ({ ...a, poster: a.poster || null, video: null, posterSrc });
const trim = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : String(s || ''));
const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
