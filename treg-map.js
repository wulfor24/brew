// Every outside capability Brew uses, declared once: which endpoint, what it feeds (stage, move family), whose data
// (brand, rivals, category, owned), how often, where the result lands, and the plain name a brand sees.
// Providers: treg (https://treg.to/call/<endpoint>), apify (actor id), local (our own code / free public feeds),
// vertex (our own Google Cloud). Prices and success rates live in the catalog (catalog_get), not here.
// watchCatalog(treg) lists catalog endpoints added in the last 7 days that are not declared here (admin /health).

export const FAMILIES = ['listening', 'social-posts', 'research', 'rival-weakness', 'seo', 'ai-seo', 'creative', 'creators', 'price-offer', 'seasonal', 'weather', 'cro', 'automation', 'ads', 'email'];
export const STAGES = ['gather', 'moves', 'rank', 'jam', 'probe'];
export const LISTEN_PLATFORMS = ['tiktok', 'instagram', 'youtube', 'reddit', 'threads', 'linkedin', 'pinterest', 'x', 'telegram', 'facebook', 'amazon', 'walmart', 'trustpilot', 'google-maps', 'app-store', 'play-store', 'web', 'news', 'site', 'nykaa', 'flipkart', 'myntra'];

const C = (id, provider, endpoint, o = {}) => ({ id, provider, endpoint, fallbacks: [], stages: ['gather'], families: [], set: 'brand', cadence: 'daily', output: 'ledger', brandSees: true, label: id, ...o });
const H = (id, endpoint, o) => C(id, 'treg', endpoint, { output: 'heard', families: ['listening'], cadence: 'daily', ...o }); // a listening source
const Q = (id, endpoint, o) => C(id, 'treg', endpoint, { output: 'ledger', ...o }); // a number for the pulse
const J = (id, endpoint, o) => C(id, 'treg', endpoint, { output: 'asset', stages: ['jam'], cadence: 'on-demand', ...o }); // made in a jam

export const CAPS = [
  /* ---------- listening (what people say) ---------- */
  H('tiktok.search', 'tikhub.tiktok.search.videos', { platform: 'tiktok', set: 'category', label: 'TikTok videos', fallbacks: ['scrapecreators.tiktok.search.videos'] }),
  H('tiktok.comments', 'tikhub.tiktok.video.comments', { platform: 'tiktok', label: 'TikTok comments' }),
  H('tiktok.comment-keywords', 'tikhub.x.tiktok-analytics-fetch-comment-keywords', { platform: 'tiktok', label: 'TikTok comment keywords', cadence: 'weekly' }),
  H('tiktok.download', 'anyapi.tiktok.video_download', { platform: 'tiktok', output: 'asset', stages: ['gather', 'jam'], families: ['listening', 'creative'], cadence: 'on-demand', label: 'TikTok video file', brandSees: false }),
  H('tiktok.captions', 'anyapi.tiktok.video.captions', { platform: 'tiktok', families: ['listening', 'creative'], cadence: 'on-demand', label: 'TikTok captions', fallbacks: ['scrapecreators.x.v1-tiktok-video-transcript'] }),
  H('instagram.reels', 'anyapi.instagram.search.reels', { platform: 'instagram', set: 'category', label: 'Instagram reels', fallbacks: ['scrapecreators.x.v2-instagram-reels-search'] }),
  H('instagram.comments', 'anyapi.instagram.post.comments', { platform: 'instagram', label: 'Instagram comments' }),
  H('instagram.hashtags', 'tikhub.x.instagram-v1-fetch-hashtag-posts', { platform: 'instagram', set: 'category', label: 'Instagram hashtags', fallbacks: ['crawl4ai.instagram.hashtag.posts'] }),
  H('instagram.own-comments', 'instagram.instagram.post.comments', { platform: 'instagram', set: 'owned', label: 'Comments on your Instagram' }),
  H('instagram.post', 'anyapi.instagram.post.detail', { platform: 'instagram', output: 'asset', families: ['listening', 'creative'], cadence: 'on-demand', label: 'Instagram reel file', brandSees: false, fallbacks: ['tikhub.x.instagram-v1-fetch-post-by-url'] }),
  H('instagram.transcript', 'scrapecreators.x.v2-instagram-media-transcript', { platform: 'instagram', families: ['listening', 'creative'], cadence: 'on-demand', label: 'Instagram reel transcript' }),
  H('youtube.comments', 'crawl4ai.youtube.video.comments', { platform: 'youtube', label: 'YouTube comments' }),
  H('youtube.transcript', 'scrapecreators.x.v1-youtube-video-transcript', { platform: 'youtube', families: ['listening', 'creative'], cadence: 'on-demand', label: 'YouTube transcript', fallbacks: ['crawl4ai.youtube.video.captions'] }),
  H('youtube.streams', 'tikhub.x.youtube-web-v2-get-video-streams', { platform: 'youtube', output: 'asset', families: ['creative'], cadence: 'on-demand', label: 'YouTube video file', brandSees: false }),
  C('youtube.search', 'local', 'youtube-data-api-v3', { platform: 'youtube', output: 'heard', families: ['listening'], label: 'YouTube search (YouTube Data API)' }),
  H('reddit.search', 'tikhub.x.reddit-app-fetch-dynamic-search', { platform: 'reddit', set: 'category', label: 'Reddit', fallbacks: ['scrapecreators.reddit.search.posts'] }),
  C('reddit.feed', 'local', 'reddit.com/search.rss + api.pullpush.io', { platform: 'reddit', output: 'heard', families: ['listening'], label: 'Reddit (public feed)' }),
  H('threads.search', 'scrapecreators.x.v1-threads-search', { platform: 'threads', set: 'category', label: 'Threads' }),
  H('linkedin.posts', 'anyapi.linkedin.search.posts', { platform: 'linkedin', set: 'category', label: 'LinkedIn posts' }),
  H('pinterest.search', 'scrapecreators.x.v1-pinterest-search', { platform: 'pinterest', set: 'category', families: ['listening', 'creative'], label: 'Pinterest' }),
  H('x.search', 'anyapi.x.search.posts', { platform: 'x', label: 'X (Twitter)' }),
  H('telegram.channels', 'tikhub.x.telegram-web-fetch-channel-search', { platform: 'telegram', set: 'category', cadence: 'weekly', label: 'Telegram channels' }),
  H('facebook.comments', 'scrapecreators.x.v1-facebook-post-comments', { platform: 'facebook', label: 'Facebook comments' }), // not treg.facebook.post.comments (26% success)
  H('facebook.transcript', 'scrapecreators.x.v1-facebook-post-transcript', { platform: 'facebook', families: ['listening', 'creative'], cadence: 'on-demand', label: 'Facebook video transcript', fallbacks: ['anyapi.facebook.post_transcript'] }),
  H('amazon.reviews', 'crawl4ai.amazon.product.reviews', { platform: 'amazon', families: ['listening', 'rival-weakness'], set: 'rivals', label: 'Amazon reviews' }),
  H('walmart.reviews', 'brightdata.x.walmart-reviews', { platform: 'walmart', families: ['listening', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Walmart reviews' }),
  H('trustpilot.reviews', 'crawl4ai.trustpilot.business.reviews', { platform: 'trustpilot', families: ['listening', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Trustpilot reviews' }),
  H('maps.reviews', 'crawl4ai.google.maps.reviews', { platform: 'google-maps', cadence: 'weekly', label: 'Google Maps reviews' }),
  H('appstore.reviews', 'litescrape.app_store.reviews', { platform: 'app-store', cadence: 'weekly', label: 'App Store reviews' }),
  H('play.reviews', 'litescrape.google_play.reviews', { platform: 'play-store', cadence: 'weekly', label: 'Google Play reviews' }),
  H('web.search', 'tinyfish.web.search', { platform: 'web', families: ['listening', 'research'], set: 'category', label: 'Web search', fallbacks: ['treg.web.search'] }),
  H('news.search', 'tinyfish.web.search.news', { platform: 'news', families: ['listening', 'research'], set: 'category', label: 'News' }),
  H('image.reverse', 'serper.google.serp.lens', { platform: 'web', cadence: 'on-demand', label: 'Reverse image search' }),
  C('site.reviews', 'local', 'judge.me public reviews', { platform: 'site', output: 'heard', families: ['listening', 'cro'], set: 'owned', label: 'Reviews on your site' }),
  C('nykaa.reviews', 'apify', 'stealth_mode/nykaa-reviews-scraper', { platform: 'nykaa', output: 'heard', families: ['listening', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Nykaa reviews' }),
  C('flipkart.reviews', 'apify', 'shahidirfan/flipkart-reviews-scraper', { platform: 'flipkart', output: 'heard', families: ['listening', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Flipkart reviews' }),
  C('nykaa.listing', 'apify', 'automation_craft/nykaa-scraper', { platform: 'nykaa', output: 'heard', families: ['listening', 'price-offer'], set: 'rivals', cadence: 'weekly', label: 'Nykaa listings and reviews' }),
  C('flipkart.listing', 'apify', 'scrapesage/flipkart-scraper', { platform: 'flipkart', output: 'heard', families: ['listening', 'price-offer'], set: 'rivals', cadence: 'weekly', label: 'Flipkart listings and reviews', fallbacks: ['shahidirfan/Flipkart-Product-Scraper'] }),
  C('shelf.blinkit', 'apify', 'memo23/blinkit-scraper', { platform: 'blinkit', output: 'ledger', families: ['price-offer', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Blinkit prices and stock', fallbacks: ['krazee_kaushik/blinkit-product-results-scraper'] }),
  C('shelf.zepto', 'apify', 'memo23/zepto-product-scraper', { platform: 'zepto', output: 'ledger', families: ['price-offer', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Zepto prices and stock', fallbacks: ['shahidirfan/zepto-product-scraper'] }),
  C('shelf.instamart', 'apify', 'solidcode/swiggy-scraper', { platform: 'instamart', output: 'ledger', families: ['price-offer', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Instamart prices and stock' }),
  C('traffic.similarweb', 'apify', 'curious_coder/similarweb-scraper', { output: 'ledger', families: ['research', 'rival-weakness'], set: 'rivals', cadence: 'monthly', label: 'Website visits (Similarweb estimate)', fallbacks: ['tri_angle/similarweb-scraper'] }),
  C('trustpilot.apify', 'apify', 'memo23/trustpilot-scraper-ppe', { platform: 'trustpilot', output: 'heard', families: ['listening', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Trustpilot reviews (backup read)' }),
  C('instagram.tagged', 'apify', 'dami_studio/instagram-mentions-scraper', { platform: 'instagram', output: 'heard', families: ['listening', 'creators', 'social-posts'], set: 'brand', cadence: 'daily', label: 'Instagram posts that tag you' }),
  C('myntra.search', 'apify', 'codingfrontend/myntra-product-search-scraper', { platform: 'myntra', output: 'heard', families: ['listening', 'price-offer'], set: 'category', cadence: 'weekly', label: 'Myntra listings' }),

  /* ---------- the pulse (numbers that move) ---------- */
  Q('keywords.volume', 'dataforseo.google.keywords.volume', { families: ['seo', 'ads', 'research'], set: 'category', cadence: 'weekly', label: 'Google search volume and cost per click', fallbacks: ['google-ads.google.keywords.ideas'] }),
  Q('trends.explore', 'dataforseo.x.keywords-data-dataforseo-trends-explore-live', { families: ['seo', 'seasonal', 'research'], set: 'category', cadence: 'weekly', label: 'Google Trends', fallbacks: ['serpapi.x.google-trends'] }),
  Q('serp.autocomplete', 'serper.google.serp.autocomplete', { families: ['seo', 'ai-seo', 'research'], set: 'category', cadence: 'weekly', label: 'Questions people type into Google' }),
  Q('domain.overview', 'spyfu.google.domain.overview', { families: ['seo', 'ads', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Search traffic estimate' }),
  Q('domain.competitors', 'serpstat.google.domain.competitors', { families: ['seo', 'research'], set: 'rivals', cadence: 'monthly', label: 'Who competes with you on Google' }),
  Q('domain.ppc-competitors', 'spyfu.google.domain.ppc_competitors', { families: ['ads', 'research'], set: 'rivals', cadence: 'monthly', label: 'Who bids against you on Google' }),
  Q('domain.keyword-gap', 'dataforseo.x.dataforseo-labs-google-domain-intersection-live', { families: ['seo', 'rival-weakness'], set: 'rivals', cadence: 'monthly', label: 'Searches a rival ranks for and you do not' }),
  Q('domain.refdomains', 'serpstat.web.backlinks.summary', { families: ['seo', 'ai-seo'], set: 'rivals', cadence: 'monthly', label: 'How many sites link to you' }),
  Q('domain.linking', 'seranking.web.linking_domains.list', { families: ['seo', 'ai-seo'], set: 'rivals', cadence: 'monthly', label: 'Sites linking to you and rivals' }),
  Q('ai.chatgpt', 'dataforseo.x.ai-optimization-chat-gpt-llm-scraper-live-advanced', { families: ['ai-seo'], set: 'category', cadence: 'weekly', label: 'ChatGPT answers', stages: ['gather', 'probe'] }), // not crawl4ai.ai-search.chatgpt.scrape (3%)
  Q('ai.gemini', 'dataforseo.x.ai-optimization-gemini-llm-scraper-live-advanced', { families: ['ai-seo'], set: 'category', cadence: 'weekly', label: 'Gemini answers', stages: ['gather', 'probe'] }),
  Q('ai.perplexity', 'dataforseo.x.ai-optimization-perplexity-llm-responses-live', { families: ['ai-seo'], set: 'category', cadence: 'weekly', label: 'Perplexity answers', stages: ['gather', 'probe'] }),
  Q('ai.mentions', 'dataforseo.x.ai-optimization-llm-mentions-target-metrics-lite-live', { families: ['ai-seo'], set: 'rivals', cadence: 'monthly', label: 'How often AI names you' }),
  C('ads.meta', 'treg', 'scrapecreators.x.v1-facebook-adlibrary-company-ads', { families: ['ads', 'creative', 'rival-weakness'], set: 'rivals', label: 'Meta Ad Library' }),
  Q('ads.tiktok', 'tikhub.x.tiktok-ads-search-ads', { families: ['ads', 'creative'], set: 'rivals', cadence: 'weekly', label: 'TikTok ads', fallbacks: ['scrapecreators.x.v1-tiktok-ad-library-search'] }), // not anyapi.tiktok.ad_library_search (25%)
  Q('ads.google', 'adyntel.google.ads.transparency', { families: ['ads'], set: 'rivals', cadence: 'weekly', label: 'Google Ads Transparency', fallbacks: ['scrapecreators.x.v1-google-company-ads'] }),
  Q('ads.linkedin', 'harvestapi.linkedin.ads.search', { families: ['ads'], set: 'rivals', cadence: 'monthly', label: 'LinkedIn ads' }),
  Q('price.shopping', 'serper.google.serp.shopping', { families: ['price-offer'], set: 'category', cadence: 'weekly', label: 'Google Shopping prices', fallbacks: ['crawl4ai.google.serp.shopping'] }),
  Q('price.amazon', 'crawl4ai.amazon.product.detail', { families: ['price-offer', 'rival-weakness'], set: 'rivals', cadence: 'weekly', label: 'Amazon listing' }),
  Q('amazon.search', 'crawl4ai.amazon.search.products', { families: ['price-offer', 'listening'], set: 'brand', cadence: 'weekly', label: 'Amazon search' }),
  Q('bestsellers.amazon', 'brightdata.x.amazon-best-sellers', { families: ['price-offer', 'research'], set: 'category', cadence: 'weekly', label: 'Amazon best sellers' }),
  Q('bestsellers.tiktok-shop', 'tikhub.x.tiktok-shop-web-fetch-hot-selling-products-list', { families: ['price-offer', 'research', 'creative'], set: 'category', cadence: 'weekly', label: 'TikTok Shop best sellers' }),
  Q('rival.catalog', 'crawl4ai.shopify.store.products', { families: ['price-offer', 'rival-weakness', 'research'], set: 'rivals', cadence: 'daily', label: 'Rival store catalogue' }),
  Q('rival.techstack', 'tomba.companies.tech_stack', { families: ['research', 'automation', 'cro'], set: 'rivals', cadence: 'monthly', label: 'Tools a store runs on', note: 'quarterly in the pulse' }),
  Q('rival.funding', 'aviato.companies.funding_rounds', { families: ['research'], set: 'rivals', cadence: 'monthly', label: 'Funding rounds' }),
  Q('social.profile', 'crawl4ai.instagram.user.profile', { families: ['social-posts', 'creators', 'research'], set: 'rivals', cadence: 'weekly', label: 'Instagram followers and posts', fallbacks: ['treg.instagram.user.profile'] }),
  Q('page.audit', 'dataforseo.web.page.audit', { families: ['cro', 'seo'], set: 'owned', cadence: 'weekly', label: 'Page speed and health' }),
  Q('weather.daily', 'crawl4ai.weather.forecast.daily', { families: ['weather', 'seasonal'], set: 'category', cadence: 'daily', label: 'Weather forecast' }),
  C('calendar.holidays', 'local', 'npm date-holidays + data/commerce-events.json', { families: ['seasonal'], set: 'category', cadence: 'monthly', stages: ['gather', 'moves'], label: 'Holidays and shopping days' }),
  C('video.understand', 'vertex', 'gemini generateContent (video)', { families: ['creative', 'listening'], set: 'category', cadence: 'on-demand', stages: ['gather', 'jam'], output: 'heard', label: 'What makes a video work' }),

  /* ---------- connected (the brand's own accounts, free) ---------- */
  Q('owned.ga4', 'google-analytics.report', { families: ['cro', 'ads', 'email', 'seasonal'], set: 'owned', cadence: 'daily', label: 'Google Analytics', stages: ['gather', 'rank', 'probe'] }),
  Q('owned.search-console', 'google-search-console.performance', { families: ['seo', 'ai-seo'], set: 'owned', cadence: 'daily', label: 'Google Search Console', stages: ['gather', 'rank', 'probe'] }),
  Q('owned.instagram', 'instagram.instagram.account.insights', { families: ['social-posts'], set: 'owned', cadence: 'daily', label: 'Your Instagram', stages: ['gather', 'rank', 'probe'] }),
  Q('owned.instagram-media', 'instagram.instagram.media.insights', { families: ['social-posts', 'creative'], set: 'owned', cadence: 'daily', label: 'Your Instagram posts', stages: ['gather', 'probe'] }),
  Q('owned.google-ads', 'google-ads.x.gaql-campaign', { families: ['ads'], set: 'owned', cadence: 'daily', label: 'Google Ads', stages: ['gather', 'rank', 'probe'] }),
  Q('google-ads.keyword-ideas', 'google-ads.google.keywords.ideas', { families: ['seo', 'ads'], set: 'owned', cadence: 'weekly', label: 'Google Ads keyword data', brandSees: false }),

  /* ---------- jam (making things) ---------- */
  J('creators.search', 'influencersclub.creators.search', { families: ['creators'], set: 'category', label: 'Find creators' }),
  J('creators.profile', 'influencersclub.creators.enrich.profile', { families: ['creators'], set: 'category', label: 'Creator profile and email' }),
  J('creators.email-verify', 'treg.people.email.verify', { families: ['creators', 'email'], set: 'category', label: 'Check an email address' }),
  J('image.gemini', 'reapi.image-gen.gemini-3-pro-image', { families: ['creative', 'social-posts', 'ads'], label: 'Image (Gemini)', fallbacks: ['reapi.image-gen.gpt-image-2'] }),
  J('image.gpt', 'reapi.image-gen.gpt-image-2', { families: ['creative', 'social-posts', 'ads'], label: 'Image (GPT Image)' }),
  J('video.seedance', 'openrouter.video-gen.seedance-2-5', { families: ['creative', 'ads', 'social-posts'], label: 'Video (Seedance)', fallbacks: ['replicate.video-gen.seedance-1-lite'] }),
  J('video.veo', 'openrouter.x.google-veo-3-1-lite', { families: ['creative', 'ads', 'social-posts'], label: 'Video (Veo)', fallbacks: ['replicate.video-gen.veo-3.1-fast'] }),
  J('video.avatar', 'openrouter.x.heygen-avatar-iv', { families: ['creative', 'ads'], label: 'Talking presenter video' }),
  J('voice.tts', 'minimax.voice-gen.speech-2-8-hd', { families: ['creative', 'ads'], label: 'Voice-over', fallbacks: ['google-ai.voice-gen.gemini-3-8-flash-tts'] })
];

export const byId = (id) => CAPS.find((c) => c.id === id) || null;
export const byFamily = (f) => CAPS.filter((c) => c.families.includes(f));
export const byStage = (s) => CAPS.filter((c) => c.stages.includes(s));
export const byPlatform = (p) => CAPS.filter((c) => c.platform === p);
// the cheapest proof that a move of this family landed: connected sources first, then the pulse numbers
export const probeFor = (family) => { const xs = byFamily(family).filter((c) => c.output === 'ledger');
  return [...xs.filter((c) => c.set === 'owned'), ...xs.filter((c) => c.set !== 'owned' && c.cadence !== 'on-demand')]; };
export const endpoints = () => [...new Set(CAPS.filter((c) => c.provider === 'treg').flatMap((c) => [c.endpoint, ...c.fallbacks]))];

/* ---------- catalog watcher: endpoints treg added this week that Brew does not use yet ---------- */
// GET https://treg.to/catalog/search?q=&limit= is open and free; each row carries `added` (YYYY-MM-DD).
// The search has no date filter, so a fixed set of Brew-shaped queries is swept and filtered by `added`.
export const WATCH_QUERIES = ['tiktok', 'instagram', 'youtube', 'reddit', 'threads', 'pinterest', 'linkedin', 'facebook', 'x twitter', 'reviews', 'amazon', 'shopify', 'tiktok shop', 'keyword volume', 'google trends', 'serp', 'backlinks', 'domain traffic', 'ai answers llm', 'ads library', 'creators influencers', 'email verify', 'image generation', 'video generation', 'voice text to speech', 'video transcript', 'video download', 'weather', 'holidays calendar', 'news', 'tech stack', 'price', 'marketplace', 'flipkart nykaa myntra'];
export async function watchCatalog(treg, { days = 7, queries = WATCH_QUERIES, base = 'https://treg.to', fetchFn = fetch, log = console } = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), known = new Set(endpoints()), found = new Map();
  for (const q of queries) {
    try { const r = await fetchFn(`${base}/catalog/search?q=${encodeURIComponent(q)}&limit=100`, { headers: { 'X-Treg-Client': 'shopos-feed' }, signal: AbortSignal.timeout(20e3) });
      if (!r.ok) throw new Error(`catalog search ${r.status}`); const j = await r.json();
      for (const x of j.results || []) { const kids = x.kind === 'routed' ? [x, ...(x.routed_children || [])] : [x];
        for (const e of kids) if (e?.id && e.added && e.added >= since && !known.has(e.id) && !found.has(e.id))
          found.set(e.id, { id: e.id, added: e.added, provider: e.provider_display || e.provider, platform: e.platform, capability: e.capability || null, summary: String(e.summary || e.name || '').slice(0, 160), usd: e.cost?.usd ?? null, query: q }); }
    } catch (e) { log.warn?.('[treg-map] watch', q, e.message); }
  }
  return { since, at: new Date().toISOString(), known: known.size, added: [...found.values()].sort((a, b) => b.added.localeCompare(a.added)) };
}

/* ---------- the router: one capability, its endpoint and fallbacks, healthiest first ----------
   runCap('shelf.blinkit', ctx, { inputOf }) walks [endpoint, ...fallbacks] in order of measured health (source-health.js),
   skips one failing most of its week (one try a day still), and calls each through its provider's client (treg or Apify).
   inputOf(endpoint) builds that endpoint's own input, since providers take different parameters; an endpoint it returns null
   for is skipped. The first non-empty answer wins; every failure is kept in the thrown error. */
import { byHealth, unhealthy } from './source-health.js';
export async function runCap(capId, { treg = null, apify = null, tag } = {}, { inputOf, apifyOpts = {} } = {}) {
  const c = byId(capId); if (!c) throw new Error(`unknown capability ${capId}`);
  const ids = byHealth([c.endpoint, ...c.fallbacks]), errs = [];
  for (const id of ids) {
    if (ids.length > 1 && id !== ids.at(-1) && unhealthy(id)) { errs.push(`${id}: skipped, failing this week`); continue; }
    const input = inputOf ? inputOf(id) : {}; if (input == null) continue;
    try {
      const out = c.provider === 'apify' ? await apify.run(id, input, { tag, ...apifyOpts }) : await treg.call(id, { ...input, tag });
      if (Array.isArray(out) ? out.length : out != null) return { endpoint: id, data: out };
      errs.push(`${id}: empty`);
    } catch (e) { errs.push(`${id}: ${String(e.message).slice(0, 120)}`); }
  }
  throw new Error(errs.join(' · ') || `${capId}: nothing ran`);
}
