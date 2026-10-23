// Market pulse: the numbers around a brand that move week to week, read through treg and kept as ledger lines
// {key, label, value, unit, source, url, at, family, signal}. Each signal has a cadence (daily, weekly, monthly,
// quarterly) and runs only when due (or with fresh). Pack files: pulse/latest.json (every line, newest per key),
// pulse/history/<date>.json + pulse/history/index.json, pulse/state.json (last run per signal), pulse/questions.json
// (20 fixed buyer questions, written once), pulse/catalog/<host>.json (rival catalogue, for launches and price moves).
// Every treg call is tagged pulse-<slug> (the spend ledger books it to the brand).
import fs from 'node:fs';
import path from 'node:path';
import { createShelf, PLATFORMS } from './shelf.js';

const DAY = 864e5;
const EVERY = { daily: 0.8 * DAY, weekly: 6.5 * DAY, monthly: 29 * DAY, quarterly: 89 * DAY };
const LOC = { IN: 2356, US: 2840, GB: 2826, CA: 2124, AU: 2036, AE: 2784, SA: 2682, SG: 2702, DE: 2276, FR: 2250, NZ: 2554, JP: 2392, IE: 2372, ZA: 2710 };
const SPYFU = new Set(['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IN', 'BR', 'ES', 'IT', 'NL', 'MX', 'IE', 'NZ', 'SG', 'JP', 'ZA', 'AE']);
const TT_SHOP = new Set(['US', 'GB', 'SG', 'MY', 'PH', 'TH', 'VN', 'ID']);
const CITIES = { IN: [['Mumbai', 19.08, 72.88], ['Delhi', 28.61, 77.21], ['Bengaluru', 12.97, 77.59]], US: [['New York', 40.71, -74.01], ['Los Angeles', 34.05, -118.24], ['Chicago', 41.88, -87.63]],
  GB: [['London', 51.51, -0.13], ['Manchester', 53.48, -2.24]], CA: [['Toronto', 43.65, -79.38], ['Vancouver', 49.28, -123.12]], AU: [['Sydney', -33.87, 151.21], ['Melbourne', -37.81, 144.96]],
  AE: [['Dubai', 25.2, 55.27], ['Abu Dhabi', 24.45, 54.38]], SA: [['Riyadh', 24.71, 46.68], ['Jeddah', 21.49, 39.19]], SG: [['Singapore', 1.35, 103.82]], DE: [['Berlin', 52.52, 13.4], ['Munich', 48.14, 11.58]],
  FR: [['Paris', 48.86, 2.35], ['Lyon', 45.76, 4.84]], JP: [['Tokyo', 35.68, 139.69], ['Osaka', 34.69, 135.5]] };
const ENGINE = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity' };

const kslug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const reName = (n) => new RegExp(`\\b${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\b`, 'i');
const num = (v) => { const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
const median = (xs) => { const a = xs.filter((x) => x != null && isFinite(x)).sort((p, q) => p - q); return a.length ? (a.length % 2 ? a[a.length >> 1] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
const strip = (md) => String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_#>`|]/g, '').replace(/\s+/g, ' ');
// the first array of objects anywhere in a provider reply (shapes vary by provider)
const firstArr = (j, d = 0) => { if (!j || typeof j !== 'object' || d > 5) return null; if (Array.isArray(j)) return j.length && typeof j[0] === 'object' ? j : null; for (const v of Object.values(j)) { const r = firstArr(v, d + 1); if (r) return r; } return null; };
const deepKey = (j, k, d = 0) => { if (!j || typeof j !== 'object' || d > 6) return undefined; if (k in j && !Array.isArray(j)) return j[k]; for (const v of Object.values(j)) { const r = deepKey(v, k, d + 1); if (r !== undefined) return r; } return undefined; };
async function pool(xs, n, f) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k], k); } })); return out; }

export function createPulse({ slug, packs, treg, ai, apify = null, log = console, now = () => new Date() }) {
  const shelf = apify ? createShelf({ slug, packs, apify, log, now }) : null;
  const tag = `pulse-${slug}`;
  const aiCall = ai ? (typeof ai === 'function' ? ai : ai.call?.bind(ai)) : null;
  const call = (id, o) => treg.call(id, { ...o, tag });
  const dfsRows = async (id, task) => { const j = await call(id, { body: [task] }); const t = j?.tasks?.[0]; if (t && t.status_code !== 20000) throw new Error(`${id}: ${t.status_message}`); return t?.result || []; };

  /* ---------- who the brand is (from the pack) ---------- */
  async function brandInfo() {
    const [profile, config, lc, themes] = await Promise.all(['profile.json', 'config.json', 'listen/config.json', 'listen/themes.json'].map((n) => packs.getJSON(slug, n, {}).catch(() => ({}))));
    const p = profile || {}, c = config || {}, l = lc || {};
    /* market: the confirmed selling market, or '' while it is "to confirm" (QA 19 Oct). Text says "your market" then and the
       market-only reads (city weather, TikTok Shop) are skipped; the search calls need one location, so they keep the neutral default */
    const market = String(p.country || c.country || '').toUpperCase(), country = market || String(l.country || 'US').toUpperCase();
    const rivals = (Array.isArray(p.rivals) && p.rivals.length ? p.rivals : (c.rivals || []).map((name) => ({ name })))
      .map((r) => (typeof r === 'string' ? (r.includes('.') ? { name: r.split('.')[0], host: r } : { name: r }) : r)).filter((r) => r?.name || r?.host).slice(0, 5)
      .map((r) => ({ name: r.name || r.host, host: r.host ? String(r.host).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') : null, instagram: r.instagram || r.socials?.instagram?.handle || null }));
    const noun = l.noun || p.subcategory || p.category || 'products';
    const terms = [...new Set([...(l.terms?.category || []), ...(c.terms || []).flat(), ...(c.rising || [])].map((t) => String(t).replace(/"/g, '').trim().toLowerCase()).filter(Boolean))].slice(0, 12);
    const themeNames = (themes?.themes || []).slice(0, 10).map((t) => t.name).filter(Boolean);
    const products = (p.catalog?.products || []).filter((x) => !x.pack);
    return { name: p.name || l.name || c.name || slug, brandName: p.brandName || null, host: (p.host || l.host || '').replace(/^www\./, ''), country, market, loc: c.locationCode || LOC[country] || 2840, currency: p.currency || c.currency || '',
      category: [p.category, p.subcategory].filter(Boolean).join(' / ') || l.category || noun, noun, terms, themes: themeNames, rivals, products, heroes: products.slice(0, 3),
      instagram: p.socials?.instagram?.handle || l.instagram || null, cities: market ? c.cities || CITIES[market] || [] : [], questions: [...(c.questions || []).map((q) => q.q || q), ...(p.ai?.questions || [])], sourced: (c.questions || []).filter((q) => q?.why && q.q), asins: c.asins || p.asins || [], bestSellersUrl: c.amazonBestSellersUrl || null };
  }

  /* ---------- the 20 fixed buyer questions (written once, then never changed so weeks compare) ---------- */
  async function questions(b) {
    /* the brand's one set, sourced from real searches and threads (ai-questions.js), when it has one: the same questions as the
       weekly AI check and the AI answers card, not a second set of guesses */
    if ((b.sourced || []).length >= 4) return b.sourced.map((q) => ({ q: q.q, kind: q.branded ? 'branded' : 'unbranded' }));
    const have = await packs.getJSON(slug, 'pulse/questions.json', null); if (have?.questions?.length && (have.by !== 'template' || !aiCall)) return have.questions; // a template set is rewritten once when the AI is on
    let qs = [], by = 'template';
    if (aiCall) try { const r = await aiCall({ tag: `pulse-questions-${slug}`, model: 'sonnet', max: 2000, schema: { type: 'object', properties: { questions: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, kind: { type: 'string', enum: ['unbranded', 'compare', 'branded'] } } } } } },
      prompt: `Write exactly 20 real questions a shopper${b.market ? ` in ${b.market}` : ''} types into ChatGPT before buying ${b.noun} (category: ${b.category}). The brand is ${b.name} (${b.host}); rivals: ${b.rivals.map((r) => r.name).join(', ') || 'none known'}.\n12 unbranded (best X for Y, X under a price, which X for a person or a problem, is X worth it), 5 compare (brand vs a rival, or "alternatives to <rival>"), 3 branded (is ${b.name} good, ${b.name} sizing/quality/returns). Use what shoppers talk about: ${b.themes.slice(0, 8).join(', ')}. Search terms people use: ${b.terms.slice(0, 6).join('; ')}. Plain words, no numbering.` });
      qs = (r.json?.questions || []).filter((x) => x.q).slice(0, 20); if (qs.length >= 15) by = 'ai'; } catch (e) { log.warn?.('[pulse] questions', e.message); }
    if (qs.length < 20) { const seen = new Set(qs.map((x) => x.q.toLowerCase())); const add = (q, kind) => { if (qs.length < 20 && !seen.has(q.toLowerCase())) { seen.add(q.toLowerCase()); qs.push({ q, kind }); } };
      b.questions.forEach((q) => add(String(q), 'unbranded')); b.terms.forEach((t) => add(/^(best|which|how|is|what)\b/i.test(t) ? t : `best ${t}`, 'unbranded'));
      b.themes.forEach((t) => add(`best ${b.noun} for ${t}`, 'unbranded')); b.rivals.forEach((r) => add(`${b.name} vs ${r.name}`, 'compare')); b.rivals.forEach((r) => add(`alternatives to ${r.name} ${b.noun}`, 'compare'));
      [`is ${b.name} a good brand`, `${b.name} ${b.noun} review`, `where to buy ${b.name}`].forEach((q) => add(q, 'branded'));
      [`best ${b.noun} brands worth buying`, `how to choose ${b.noun}`, `are expensive ${b.noun} worth it`, `best ${b.noun} for men`, `best ${b.noun} for women`, `best ${b.noun} as a gift`, `where to buy ${b.noun} online`, `most popular ${b.noun} right now`, `best value ${b.noun}`, `${b.noun} that last long`].forEach((q) => add(q, 'unbranded'));
      qs.sort((x, y) => ['unbranded', 'compare', 'branded'].indexOf(x.kind) - ['unbranded', 'compare', 'branded'].indexOf(y.kind)); }
    await packs.put(slug, 'pulse/questions.json', { at: now().toISOString(), fixed: true, by, questions: qs });
    return qs;
  }

  /* ---------- the signals ---------- */
  const S = {};
  // search volume + cost per click: the category terms, what shoppers talk about, the brand and rival names (one call, up to 1000)
  S.volume = { cadence: 'weekly', family: 'seo', async run(b, L) {
    const kws = [...new Set([b.name, `${b.name} ${b.noun}`, ...b.rivals.map((r) => r.name), ...b.terms, ...b.themes.slice(0, 8).map((t) => `${t} ${b.noun}`)].map((k) => String(k).toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim()).filter((k) => k && k.split(' ').length <= 10))].slice(0, 1000);
    const rows = await dfsRows('dataforseo.google.keywords.volume', { keywords: kws, location_code: b.loc, language_code: 'en' });
    for (const r of rows) if (r?.keyword) L({ key: `search.volume.${kslug(r.keyword)}`, label: `Monthly Google searches for "${r.keyword}"`, value: r.search_volume ?? 0, unit: 'searches/mo', cpc: r.cpc ?? null, competition: r.competition ?? null, source: 'Google search volumes', family: 'seo',
      trend: (r.monthly_searches || []).slice(0, 12).map((m) => m.search_volume) });
    const cat = rows.filter((r) => b.terms.includes(r.keyword) && r.cpc != null);
    if (cat.length) L({ key: 'search.cpc.category', label: 'Average cost per click on the category searches', value: +(cat.reduce((a, r) => a + r.cpc, 0) / cat.length).toFixed(2), unit: 'USD', source: 'Google search volumes', family: 'ads' });
  } };
  // trend slope: the last 4 weeks against the 4 before, brand + category terms (one call, 5 terms)
  S.trends = { cadence: 'weekly', family: 'seasonal', async run(b, L) {
    const kws = [b.name.toLowerCase(), ...b.terms.slice(0, 4)];
    const r = (await dfsRows('dataforseo.x.keywords-data-dataforseo-trends-explore-live', { keywords: kws, location_code: b.loc, type: 'web', time_range: 'past_12_months' }))[0];
    const g = (r?.items || []).find((i) => i.type === 'dataforseo_trends_graph'); const d = g?.data || [];
    kws.forEach((k, i) => { const v = d.map((x) => x.values?.[i]).filter((x) => x != null); if (v.length < 8 || !v.some((x) => x > 0)) return; // no Google interest at all: no line
      const last = v.slice(-4).reduce((a, x) => a + x, 0) / 4, prev = v.slice(-8, -4).reduce((a, x) => a + x, 0) / 4;
      L({ key: `trends.slope.${kslug(k)}`, label: `Google interest in "${k}", last 4 weeks vs the 4 before`, value: prev ? Math.round((last - prev) / prev * 100) : null, unit: '%', level: Math.round(last), peak: Math.max(...v), source: 'Google Trends', family: 'seasonal', url: `https://trends.google.com/trends/explore?geo=${b.country}&q=${encodeURIComponent(k)}` }); });
  } };
  // what people type: Google suggestions for question starts about the category
  S.autocomplete = { cadence: 'weekly', family: 'ai-seo', async run(b, L) {
    const seeds = [`best ${b.noun}`, `${b.noun} for`, `is ${b.name}`, `${b.name} vs`].map((s) => s.toLowerCase());
    await pool(seeds, 4, async (q) => { const j = await call('serper.google.serp.autocomplete', { body: { q, gl: b.country.toLowerCase(), hl: 'en' } });
      const sug = (j?.suggestions || []).map((s) => s.value || s).filter((s) => typeof s === 'string');
      L({ key: `search.suggest.${kslug(q)}`, label: `Google suggestions for "${q}"`, value: sug.length, unit: 'suggestions', items: sug.slice(0, 10), source: 'Google search suggestions', family: 'ai-seo' }); });
  } };
  // search traffic estimate, brand and rivals
  S.overview = { cadence: 'weekly', family: 'seo', async run(b, L, note) {
    const cc = SPYFU.has(b.country) ? b.country : 'US'; if (cc !== b.country) note(`search traffic estimates are for the US (${b.country} is not covered)`);
    await pool([{ name: b.name, host: b.host, own: true }, ...b.rivals.filter((r) => r.host)], 3, async (d) => { if (!d.host) return;
      const j = await call('spyfu.google.domain.overview', { query: { domain: d.host, countryCode: cc, pastNMonths: 1 } }); const r = j?.results?.[0]; if (!r) return;
      L({ key: `search.organic.clicks.${kslug(d.host)}`, label: `${d.name}: estimated monthly clicks from Google (unpaid)`, value: r.monthlyOrganicClicks ?? null, unit: 'clicks/mo', subject: d.host, own: !!d.own, source: 'Search traffic estimates', family: 'seo' });
      L({ key: `search.paid.budget.${kslug(d.host)}`, label: `${d.name}: estimated monthly Google Ads budget`, value: r.monthlyBudget ?? null, unit: 'USD/mo', subject: d.host, own: !!d.own, source: 'Search traffic estimates', family: 'ads' });
      L({ key: `search.organic.keywords.${kslug(d.host)}`, label: `${d.name}: searches it ranks for on Google`, value: r.totalOrganicResults ?? null, unit: 'keywords', subject: d.host, own: !!d.own, source: 'Search traffic estimates', family: 'seo' }); });
  } };
  // who competes on Google, unpaid and paid
  S.competitors = { cadence: 'monthly', family: 'research', async run(b, L) {
    if (!b.host) return;
    const se = `g_${b.country === 'GB' ? 'uk' : b.country.toLowerCase()}`;
    const [org, ppc] = await Promise.allSettled([call('serpstat.google.domain.competitors', { body: { id: '1', method: 'SerpstatDomainProcedure.getOrganicCompetitorsPage', params: { domain: b.host, se, size: 10 } } }),
      call('spyfu.google.domain.ppc_competitors', { query: { domain: b.host, countryCode: SPYFU.has(b.country) ? b.country : 'US' } })]);
    if (org.status === 'fulfilled') { const rows = firstArr(org.value?.result) || []; if (org.value?.error) throw new Error(org.value.error.message);
      L({ key: 'search.competitors.organic', label: 'Sites competing with you for the same Google searches', value: rows.length, unit: 'sites', items: rows.slice(0, 10).map((r) => r.domain).filter(Boolean), source: 'Google search overlap', family: 'research' }); }
    if (ppc.status === 'fulfilled') { const rows = (ppc.value?.results || []).filter((r) => !r.domain?.includes(b.host.split('.')[0]) || r.domain === b.host);
      L({ key: 'search.competitors.paid', label: 'Advertisers bidding on your Google searches', value: ppc.value?.totalMatchingResults ?? rows.length, unit: 'advertisers', items: (ppc.value?.results || []).slice(0, 10).map((r) => r.domain), source: 'Google search overlap', family: 'ads' }); }
  } };
  // keyword gap: searches a rival ranks for and the brand does not (top 2 rivals)
  S.gap = { cadence: 'monthly', family: 'rival-weakness', async run(b, L) {
    if (!b.host) return;
    await pool(b.rivals.filter((r) => r.host).slice(0, 2), 2, async (r) => {
      const res = (await dfsRows('dataforseo.x.dataforseo-labs-google-domain-intersection-live', { target1: r.host, target2: b.host, location_code: b.loc, language_code: 'en', intersections: false, limit: 20, order_by: ['first_domain_serp_element.etv,desc'] }))[0];
      const items = (res?.items || []).map((i) => i.keyword_data?.keyword).filter(Boolean);
      L({ key: `search.gap.${kslug(r.host)}`, label: `Google searches ${r.name} ranks for and ${b.name} does not`, value: res?.total_count ?? items.length, unit: 'keywords', items: items.slice(0, 20), subject: r.host, source: 'Google rankings', family: 'seo' }); });
  } };
  // links: total referring sites, and new ones this week (brand + 2 rivals)
  S.links = { cadence: 'monthly', family: 'seo', async run(b, L) {
    const ds = [{ name: b.name, host: b.host, own: true }, ...b.rivals.filter((r) => r.host).slice(0, 2)].filter((d) => d.host); const since = new Date(now() - 7 * DAY).toISOString().slice(0, 10);
    await pool(ds, 3, async (d) => {
      const [sum, list] = await Promise.allSettled([call('serpstat.web.backlinks.summary', { body: { method: 'SerpstatBacklinksProcedure.getSummaryV2', id: '1', params: { query: d.host } } }), call('seranking.web.linking_domains.list', { query: { target: d.host, mode: 'domain', limit: 25 } })]);
      const rd = sum.status === 'fulfilled' ? num(sum.value?.result?.data?.referring_domains ?? deepKey(sum.value, 'referring_domains')) : null;
      if (rd != null) L({ key: `links.refdomains.${kslug(d.host)}`, label: `${d.name}: sites linking to it`, value: rd, unit: 'sites', subject: d.host, own: !!d.own, source: 'Backlink index', family: 'seo' });
      if (list.status === 'fulfilled') { const fresh = (list.value?.refdomains || []).filter((x) => x.first_seen >= since);
        L({ key: `links.new.${kslug(d.host)}`, label: `${d.name}: new linking sites this week`, value: fresh.length, unit: 'sites', items: fresh.slice(0, 10).map((x) => x.refdomain), subject: d.host, own: !!d.own, source: 'Backlink index', family: 'seo' }); }
    });
  } };
  // AI answers on the fixed 20 questions × ChatGPT, Gemini, Perplexity: mention rate per engine, brand vs rivals
  S.answers = { cadence: 'weekly', family: 'ai-seo', async run(b, L, note) {
    const qs = await questions(b), own = reName(b.name), rivals = b.rivals.map((r) => ({ ...r, re: reName(r.name) }));
    const ask = {
      chatgpt: async (q) => { const r = (await dfsRows('dataforseo.x.ai-optimization-chat-gpt-llm-scraper-live-advanced', { keyword: q, location_code: b.loc, language_code: 'en', force_web_search: true }))[0]; return r && { text: strip(r.markdown), brands: (r.brand_entities || []).map((x) => x.title || x.name) }; },
      gemini: async (q) => { const r = (await dfsRows('dataforseo.x.ai-optimization-gemini-llm-scraper-live-advanced', { keyword: q, location_code: b.loc, language_code: 'en' }))[0]; return r && { text: strip(r.markdown), brands: [] }; },
      perplexity: async (q) => { const r = (await dfsRows('dataforseo.x.ai-optimization-perplexity-llm-responses-live', { user_prompt: q, model_name: 'sonar', web_search_country_iso_code: b.country, max_output_tokens: 1200 }))[0];
        return r && { text: (r.items || []).flatMap((i) => i.sections || []).map((s) => s.text).join('\n'), brands: [] }; } };
    const jobs = qs.flatMap((q) => Object.keys(ask).map((e) => [q, e])), res = [];
    await pool(jobs, 12, async ([q, e]) => { try { const a = await ask[e](q.q); if (!a?.text) return; const t = `${a.text} ${a.brands.join(' ')}`; res.push({ e, q: q.q, kind: q.kind, own: own.test(t), rivals: rivals.filter((r) => r.re.test(t)).map((r) => r.name) }); } catch (err) { res.push({ e, q: q.q, error: err.message.slice(0, 100) }); } });
    const ok = res.filter((r) => !r.error); if (!ok.length) throw new Error(`no AI answers came back (${res[0]?.error || 'none'})`);
    if (ok.length < jobs.length) note(`${jobs.length - ok.length} of ${jobs.length} AI answers failed`);
    const rate = (xs, f) => (xs.length ? Math.round(xs.filter(f).length / xs.length * 100) : null);
    for (const e of Object.keys(ask)) { const xs = ok.filter((r) => r.e === e); if (!xs.length) continue;
      L({ key: `ai.mention.${e}`, label: `${ENGINE[e]} answers that name ${b.name} (${xs.length} buyer questions)`, value: rate(xs, (r) => r.own), unit: '%', of: xs.length, unbranded: rate(xs.filter((r) => r.kind === 'unbranded'), (r) => r.own), source: ENGINE[e], family: 'ai-seo' }); }
    L({ key: 'ai.mention.all', label: `AI answers that name ${b.name}, all engines`, value: rate(ok, (r) => r.own), unit: '%', of: ok.length, source: 'ChatGPT, Gemini and Perplexity', family: 'ai-seo' });
    for (const r of rivals) L({ key: `ai.mention.rival.${kslug(r.name)}`, label: `AI answers that name ${r.name}`, value: rate(ok, (x) => x.rivals.includes(r.name)), unit: '%', of: ok.length, subject: r.host || r.name, source: 'ChatGPT, Gemini and Perplexity', family: 'ai-seo' });
    await packs.put(slug, `pulse/answers/${now().toISOString().slice(0, 10)}.json`, { at: now().toISOString(), answers: res });
  } };
  // AI mention metrics (monthly, about $0.10): how often AI answers name the brand, and the AI search volume behind them
  S.mentions = { cadence: 'monthly', family: 'ai-seo', async run(b, L) {
    const r = (await dfsRows('dataforseo.x.ai-optimization-llm-mentions-target-metrics-lite-live', { target: [{ keyword: b.name, search_scope: ['answer'] }], location_code: b.loc, language_code: 'en', platform: 'google' }))[0];
    const m = r?.items?.[0]?.metrics || {};
    L({ key: 'ai.mentions.google', label: `Google AI answers that mention ${b.name}`, value: m.mentions ?? 0, unit: 'answers', aiSearchVolume: m.ai_search_volume ?? null, source: 'AI answer index', family: 'ai-seo' });
  } };
  // rival ads: Meta (from the research snapshot), TikTok, Google, LinkedIn (monthly inside)
  S.ads = { cadence: 'weekly', family: 'ads', async run(b, L, note, st) {
    let snap = await packs.getJSON(slug, 'research.json', null); // research.js keeps it at brands/<slug>/research.json (GCS) and .research/<slug>/snapshot.json (disk)
    if (!snap && packs.dirOf) try { snap = JSON.parse(fs.readFileSync(path.join(packs.dirOf(slug), '..', '..', '.research', slug, 'snapshot.json'), 'utf8')); } catch {}
    if (snap?.ads?.items) { const by = new Map(); snap.ads.items.forEach((a) => by.set(a.brand, (by.get(a.brand) || 0) + 1));
      for (const [name, n] of by) L({ key: `ads.meta.${kslug(name)}`, label: `${name}: popular ads in the Meta Ad Library`, value: n, unit: 'ads', subject: name, source: 'Meta Ad Library', family: 'ads' }); }
    if (snap?.own?.live != null) L({ key: 'ads.meta.own', label: `${b.name}: live ads in the Meta Ad Library`, value: snap.own.live, unit: 'ads', own: true, source: 'Meta Ad Library', family: 'ads' });
    if (b.country === 'IN') note('TikTok does not run in India: no TikTok ads read');
    const li = !st.last['ads.linkedin'] || now() - Date.parse(st.last['ads.linkedin']) > EVERY.monthly;
    await pool([{ name: b.name, host: b.host, own: true }, ...b.rivals], 3, async (r) => {
      const [tt, g, ln] = await Promise.allSettled([b.country === 'IN' ? Promise.reject(new Error('no TikTok in India')) : call('tikhub.x.tiktok-ads-search-ads', { body: { keyword: r.name, country_code: b.country, period: 30, page: 1, limit: 20, order_by: 'for_you' } }),
        r.host ? call('adyntel.google.ads.transparency', { body: { company_domain: r.host } }) : Promise.reject(new Error('no host')),
        li ? call('harvestapi.linkedin.ads.search', { query: { accountOwner: r.name, countries: b.country } }) : Promise.reject(new Error('not due'))]);
      if (tt.status === 'fulfilled') { const ms = (tt.value?.data?.materials || []).filter((m) => reName(r.name).test(m.brand_name || '') || reName(r.name).test(m.ad_title || ''));
        L({ key: `ads.tiktok.${kslug(r.name)}`, label: `${r.name}: top TikTok ads in the last 30 days`, value: ms.length, unit: 'ads', subject: r.name, own: !!r.own, source: 'TikTok Ads Library', family: 'ads' }); }
      if (g.status === 'fulfilled') L({ key: `ads.google.${kslug(r.host)}`, label: `${r.name}: ads in Google's Ads Transparency Center`, value: g.value?.total_ad_count ?? (g.value?.ads || []).length, unit: 'ads', subject: r.host, own: !!r.own, source: 'Google Ads Transparency Center', family: 'ads', url: `https://adstransparency.google.com/?domain=${r.host}` });
      if (ln.status === 'fulfilled') L({ key: `ads.linkedin.${kslug(r.name)}`, label: `${r.name}: ads in the LinkedIn Ad Library`, value: ln.value?.pagination?.totalElements ?? (ln.value?.elements || []).length, unit: 'ads', subject: r.name, own: !!r.own, source: 'LinkedIn Ad Library', family: 'ads' });
    });
    if (li) st.last['ads.linkedin'] = now().toISOString();
  } };
  // price position: Google Shopping for the hero searches, the brand's hero price against the median; Amazon listings when the pack names ASINs
  S.price = { cadence: 'weekly', family: 'price-offer', async run(b, L) {
    const qs = (b.terms.length ? b.terms : [b.noun]).slice(0, 2), hero = median(b.heroes.map((p) => num(p.price)));
    await pool(qs, 2, async (q) => { const j = await call('serper.google.serp.shopping', { body: { q, gl: b.country.toLowerCase(), hl: 'en', num: 40 } });
      const rows = (j?.shopping || []).map((s) => ({ t: s.title, src: s.source, p: num(s.price) })).filter((s) => s.p); const med = median(rows.map((r) => r.p));
      L({ key: `price.median.${kslug(q)}`, label: `Median Google Shopping price for "${q}"`, value: med, unit: b.currency, n: rows.length, items: rows.slice(0, 8).map((r) => `${r.src}: ${r.p}`), source: 'Google Shopping', family: 'price-offer' });
      if (hero && med) L({ key: `price.position.${kslug(q)}`, label: `${b.name}'s hero price against that median`, value: Math.round((hero - med) / med * 100), unit: '%', hero, source: 'Google Shopping', family: 'price-offer' }); });
    await pool(b.asins.slice(0, 5), 2, async (asin) => { const r = (await call('crawl4ai.amazon.product.detail', { body: { product: asin, country: b.country.toLowerCase() } }))?.rows?.[0]; if (!r) return;
      L({ key: `price.amazon.${asin}`, label: `Amazon price: ${String(r.title || asin).slice(0, 60)}`, value: num(r.price), unit: b.currency, rating: r.rating ?? null, reviews: r.reviews ?? r.review_count ?? null, source: 'Amazon', family: 'price-offer' }); });
  } };
  // best sellers: TikTok Shop hot list (where TikTok Shop runs) filtered to the category, Amazon best sellers when the pack has the category page
  S.bestsellers = { cadence: 'weekly', family: 'price-offer', async run(b, L, note) {
    const words = new Set(`${b.noun} ${b.category}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3));
    if (b.market && TT_SHOP.has(b.market)) { const j = await call('tikhub.x.tiktok-shop-web-fetch-hot-selling-products-list', { query: { region: b.country, count: 100 } });
      const rows = (firstArr(j?.data) || []).map((x) => x.title || x.product_name || x.name || x.product_title).filter(Boolean); const hit = rows.filter((t) => [...words].some((w) => t.toLowerCase().includes(w)));
      L({ key: 'bestsellers.tiktok-shop', label: `TikTok Shop best sellers in your category (${b.country})`, value: hit.length, unit: 'products', items: hit.slice(0, 10), of: rows.length, source: 'TikTok Shop best sellers', family: 'price-offer' }); }
    else note(b.market ? `TikTok Shop does not run in ${b.market}` : 'TikTok Shop not read: your selling market is not confirmed yet');
    if (b.bestSellersUrl) { const j = await call('brightdata.x.amazon-best-sellers', { query: { dataset_id: 'gd_l1vijixj9g2vp7563' }, body: { input: [{ url: b.bestSellersUrl }] } }); const rows = firstArr(j) || [];
      L({ key: 'bestsellers.amazon', label: 'Amazon best sellers in your category', value: rows.length, unit: 'products', items: rows.slice(0, 10).map((r) => r.title || r.name).filter(Boolean), source: 'Amazon best sellers', family: 'price-offer', url: b.bestSellersUrl }); }
  } };
  // rival Shopify catalogues: products, new launches, price changes since the last read
  S.catalog = { cadence: 'daily', family: 'rival-weakness', async run(b, L, note) {
    await pool(b.rivals.filter((r) => r.host), 3, async (r) => {
      let rows = []; for (let page = 1; page <= 4; page++) { const j = await call('crawl4ai.shopify.store.products', { body: { store: r.host, limit: 250, page } }); const x = j?.rows || []; rows.push(...x); if (x.length < 250) break; }
      if (!rows.length) { note(`${r.host}: no public Shopify catalogue`); return; }
      const cur = Object.fromEntries(rows.filter((x) => x.handle).map((x) => [x.handle, { t: x.title, p: num(x.price) }])), file = `pulse/catalog/${r.host}.json`, prev = await packs.getJSON(slug, file, null);
      const fresh = prev ? Object.keys(cur).filter((h) => !prev.items[h]) : [], moved = prev ? Object.keys(cur).filter((h) => prev.items[h] && prev.items[h].p && cur[h].p && prev.items[h].p !== cur[h].p) : [];
      await packs.put(slug, file, { at: now().toISOString(), items: cur });
      L({ key: `catalog.products.${kslug(r.host)}`, label: `${r.name}: products in its store`, value: Object.keys(cur).length, unit: 'products', subject: r.host, source: `${r.host} store`, family: 'research', url: `https://${r.host}/collections/all` });
      if (prev) { L({ key: `catalog.new.${kslug(r.host)}`, label: `${r.name}: new products since the last read`, value: fresh.length, unit: 'products', items: fresh.slice(0, 10).map((h) => cur[h].t), subject: r.host, source: `${r.host} store`, family: 'rival-weakness' });
        L({ key: `catalog.price.${kslug(r.host)}`, label: `${r.name}: price changes since the last read`, value: moved.length, unit: 'products', items: moved.slice(0, 10).map((h) => `${cur[h].t}: ${prev.items[h].p} → ${cur[h].p}`), subject: r.host, source: `${r.host} store`, family: 'price-offer' }); }
    });
  } };
  // tech stack (quarterly): what the brand and rivals run on (email, reviews, subscriptions, analytics)
  S.tech = { cadence: 'quarterly', family: 'automation', async run(b, L) {
    await pool([{ name: b.name, host: b.host, own: true }, ...b.rivals.filter((r) => r.host)].filter((d) => d.host), 3, async (d) => { const j = await call('tomba.companies.tech_stack', { query: { domain: d.host } }); const xs = Array.isArray(j?.data) ? j.data : firstArr(j) || [];
      L({ key: `tech.count.${kslug(d.host)}`, label: `${d.name}: tools detected on its site`, value: xs.length, unit: 'tools', items: xs.map((x) => `${x.name}${x.categories?.[0]?.name ? ` (${x.categories[0].name})` : ''}`).slice(0, 30), subject: d.host, own: !!d.own, source: 'Site technology scan', family: 'automation' }); });
  } };
  // Instagram profiles, brand and rivals (a guessed rival handle counts only when the profile's name matches)
  S.social = { cadence: 'weekly', family: 'social-posts', async run(b, L, note) {
    const who = [{ name: b.name, ig: b.instagram, own: true }, ...b.rivals.map((r) => ({ name: r.name, ig: r.instagram, guess: !r.instagram && r.host ? r.host.split('.')[0] : null }))].filter((x) => x.ig || x.guess);
    await pool(who, 3, async (x) => { const r = (await call('crawl4ai.instagram.user.profile', { body: { username: x.ig || x.guess } }))?.rows?.[0]; if (!r?.followers) return;
      const flat = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''); if (!x.ig && !(flat(r.full_name) && (flat(r.full_name).includes(flat(x.name)) || flat(x.name).includes(flat(r.full_name)) && flat(r.full_name).length >= 4))) { note(`@${x.guess} does not look like ${x.name} on Instagram`); return; }
      L({ key: `social.ig.followers.${kslug(x.ig || x.guess)}`, label: `${x.name}: Instagram followers`, value: r.followers, unit: 'followers', posts: r.posts ?? null, subject: `@${x.ig || x.guess}`, own: !!x.own, source: 'Instagram', family: 'social-posts', url: `https://www.instagram.com/${x.ig || x.guess}/` }); });
  } };
  // page health: the home page and the two hero product pages
  S.pages = { cadence: 'weekly', family: 'cro', async run(b, L) {
    if (!b.host) return; const urls = [`https://${b.host}/`, ...b.heroes.map((p) => p.url || (p.handle && (!b.platform || b.platform === 'shopify') ? `https://${b.host}/products/${p.handle}` : null)).filter(Boolean).slice(0, 2)]; /* the product's own page, never a guessed /products/ path that 404s off Shopify */
    await pool(urls, 1, async (u) => { const r = (await dfsRows('dataforseo.web.page.audit', { url: u, enable_javascript: true }))[0]?.items?.[0]; if (!r) return; const t = r.page_timing || {};
      L({ key: `page.score.${kslug(u.replace(/^https:\/\//, ''))}`, label: `Page health score: ${u.replace(/^https:\/\//, '')}`, value: r.onpage_score != null ? Math.round(r.onpage_score) : null, unit: 'of 100', loadMs: t.duration_time ?? t.dom_complete ?? null, interactiveMs: t.time_to_interactive ?? null, status: r.status_code, source: 'Page health check', family: 'cro', url: u }); });
  } };
  // weather for the brand's top cities, next 7 days
  S.weather = { cadence: 'daily', family: 'weather', async run(b, L) {
    await pool(b.cities.slice(0, 3), 3, async ([place, lat, lon]) => { const rows = (await call('crawl4ai.weather.forecast.daily', { body: { days: 7, latitude: String(lat), longitude: String(lon), place } }))?.rows || []; if (!rows.length) return;
      L({ key: `weather.${kslug(place)}`, label: `${place}: hottest day in the next 7`, value: Math.max(...rows.map((r) => r.temp_max ?? -99)), unit: '°C', low: Math.min(...rows.map((r) => r.temp_min ?? 99)), rainDays: rows.filter((r) => (r.precipitation_chance ?? 0) >= 50 || (r.precipitation_mm ?? 0) >= 2).length,
        days: rows.map((r) => ({ d: r.date, hi: r.temp_max, lo: r.temp_min, rain: r.precipitation_chance, w: r.weather })), source: 'Weather forecast (Open-Meteo)', family: 'weather' }); });
  } };

  // where the brand sells (Apify, shelf.js): quick-commerce shelves by city and marketplaces, for the brand and its rivals. Each
  // platform's result is kept in shelf/<platform>.json (the last two reads), so a new out-of-stock or a 10%+ price move shows as a change.
  // A platform that could not be read keeps its error and its last good read; "not listed" is said only when the read worked.
  const SHELF_AREA = { Bengaluru: 'Koramangala, Bengaluru', Mumbai: 'Bandra West, Mumbai', Delhi: 'Connaught Place, New Delhi' };
  const whoOf = (b) => [{ name: b.brandName || b.name, own: true }, ...b.rivals.map((r) => ({ name: r.name }))].filter((w) => w.name);
  async function readPlatform(key, b, L, note, city) {
    const P = PLATFORMS[key], file = `shelf/${key}.json`, prev = await packs.getJSON(slug, file, null).catch(() => null);
    let r; try { r = await shelf.platform(key, whoOf(b), { city }); }
    catch (e) { await packs.put(slug, file, { ...(prev || {}), platform: key, label: P.label, kind: P.kind, error: String(e.message).slice(0, 240), errorAt: now().toISOString() }); note(`${P.label}: ${String(e.message).slice(0, 160)}`); return; }
    const last = prev?.byName ? { at: prev.at, byName: prev.byName } : prev?.last || null, changes = [];
    const key2 = (x) => String(x.id || x.url || x.name);
    for (const [who, xs] of Object.entries(r.byName)) { const before = new Map((last?.byName?.[who] || []).map((x) => [key2(x), x]));
      for (const x of xs) { const o = before.get(key2(x)); if (!o) continue;
        if (o.inStock !== false && x.inStock === false) changes.push({ kind: 'stock', who, own: x.own, name: x.name, url: x.url, platform: key });
        if (o.price && x.price && Math.abs(x.price - o.price) / o.price >= 0.1) changes.push({ kind: 'price', who, own: x.own, name: x.name, url: x.url, from: o.price, to: x.price, platform: key }); } }
    await packs.put(slug, file, { ...r, last, changes, error: null });
    const label = P.label + (r.city ? ` (${r.city})` : '');
    for (const [who, xs] of Object.entries(r.byName)) { const own = who === whoOf(b)[0].name;
      L({ key: `shelf.${key}.${kslug(who)}`, label: `${who} on ${label}: products listed`, value: xs.length, unit: 'products', inStock: xs.filter((x) => x.inStock !== false).length, minPrice: Math.min(...xs.map((x) => x.price).filter(Boolean)) || null,
        rating: xs.length ? +(xs.map((x) => x.rating).filter(Boolean).reduce((a, v, _, a2) => a + v / a2.length, 0)).toFixed(1) || null : null, items: xs.slice(0, 6).map((x) => `${x.name}: ${x.price ?? '?'}${x.inStock === false ? ' (out of stock)' : ''}`),
        subject: who, own, source: label, url: xs[0]?.url || P.home, family: P.kind === 'shelf' ? 'price-offer' : 'listening' }); }
    if (changes.length) L({ key: `shelf.${key}.changes`, label: `${label}: changes since the last read`, value: changes.length, unit: 'changes', items: changes.slice(0, 8).map((c) => c.kind === 'stock' ? `${c.who}: ${c.name} went out of stock` : `${c.who}: ${c.name} ${c.from} → ${c.to}`), changes, source: label, url: P.home, family: 'price-offer' });
  }
  S.shelf = { cadence: 'weekly', family: 'price-offer', async run(b, L, note) {
    if (!shelf) return note('Quick-commerce shelves not read: no Apify client');
    if (b.market !== 'IN') return note(b.market ? `Quick-commerce shelves are read for India; ${b.market} is not covered yet` : 'Quick-commerce shelves not read: your selling market is not confirmed yet');
    const city = (b.cities || []).map(([n]) => n).find((n) => SHELF_AREA[n]) || 'Bengaluru';
    for (const key of ['blinkit', 'zepto', 'instamart']) await readPlatform(key, b, L, note, { name: city, area: SHELF_AREA[city] });
  } };
  S.marketplace = { cadence: 'weekly', family: 'listening', async run(b, L, note) {
    if (!shelf) return note('Marketplaces not read: no Apify client');
    if (b.market !== 'IN') return note(b.market ? `Nykaa, Flipkart and Myntra are Indian marketplaces; Amazon is read for ${b.market}` : 'Marketplaces not read: your selling market is not confirmed yet');
    for (const key of ['nykaa', 'flipkart', 'myntra']) await readPlatform(key, b, L, note, null);
  } };
  // web traffic (Similarweb estimates), the brand and its rivals, monthly
  S.traffic = { cadence: 'monthly', family: 'research', async run(b, L, note) {
    if (!shelf) return note('Web traffic not read: no Apify client');
    const hosts = [b.host, ...b.rivals.map((r) => r.host)].filter(Boolean).slice(0, 6); if (!hosts.length) return note('Web traffic: no sites to read');
    const r = await shelf.traffic(hosts); await packs.put(slug, 'shelf/traffic.json', r);
    for (const x of r.rows) { const own = x.host === b.host, who = own ? b.name : (b.rivals.find((v) => v.host === x.host)?.name || x.host);
      if (x.visits == null) { note(`${x.host}: Similarweb has no estimate`); continue; }
      L({ key: `traffic.visits.${kslug(x.host)}`, label: `${who}: visits a month (Similarweb estimate)`, value: x.visits, unit: 'visits', months: x.months, sources: x.sources, subject: x.host, own, source: 'Similarweb', url: `https://www.similarweb.com/website/${x.host}/`, family: 'research' }); }
  } };

  /* ---------- run ---------- */
  async function run({ only, fresh = false, capUsd = +process.env.PULSE_CAP_USD || 3 } = {}) {
    const t0 = now(), at = t0.toISOString(), day = at.slice(0, 10), notes = [], lines = [], usd0 = treg?.meter?.usd || 0;
    if (!treg?.live) return { lines, notes: ['treg is off (no TREG_TOKEN)'], usd: 0 };
    const st = await packs.getJSON(slug, 'pulse/state.json', null) || { last: {} }; st.last ||= {};
    const b = await brandInfo();
    const pick = only ? [].concat(only).filter(Boolean) : []; const want = Object.keys(S).filter((k) => (!pick.length || pick.includes(k)) && (fresh || !st.last[k] || t0 - Date.parse(st.last[k]) >= EVERY[S[k].cadence]));
    const ran = [];
    for (const k of want) {
      if ((treg.meter.usd - usd0) >= capUsd) { notes.push(`${k}: skipped, run cap $${capUsd} reached`); continue; }
      const mine = []; const L = (x) => mine.push({ url: null, ...x, at, signal: k, family: x.family || S[k].family }); const note = (m) => notes.push(`${k}: ${m}`);
      try { await S[k].run(b, L, note, st); st.last[k] = at; ran.push(k); lines.push(...mine); }
      catch (e) { notes.push(`${k}: ${e.message.slice(0, 200)}`); lines.push(...mine); log.warn?.(`[pulse] ${slug} ${k}`, e.message); }
    }
    const usd = +((treg.meter.usd - usd0)).toFixed(4);
    // latest: every line, newest per key (a signal that did not run keeps its last lines)
    const prev = await packs.getJSON(slug, 'pulse/latest.json', null), keep = (prev?.lines || []).filter((x) => !lines.some((y) => y.key === x.key));
    const latest = { at, slug, lines: [...keep, ...lines].sort((p, q) => p.key.localeCompare(q.key)), notes, ran };
    await packs.put(slug, 'pulse/latest.json', latest);
    if (lines.length) { const hf = `pulse/history/${day}.json`, h = await packs.getJSON(slug, hf, null), hl = [...(h?.lines || []).filter((x) => !lines.some((y) => y.key === x.key)), ...lines];
      await packs.put(slug, hf, { day, at, lines: hl, usd: +(((h?.usd) || 0) + usd).toFixed(4) });
      const idx = await packs.getJSON(slug, 'pulse/history/index.json', null) || { days: [] }; idx.days = [...idx.days.filter((d) => d.day !== day), { day, lines: hl.length, usd: +(((h?.usd) || 0) + usd).toFixed(4), ran: [...new Set([...(idx.days.find((d) => d.day === day)?.ran || []), ...ran])] }].sort((p, q) => p.day.localeCompare(q.day));
      await packs.put(slug, 'pulse/history/index.json', idx); }
    st.usd = +(((st.usd) || 0) + usd).toFixed(4); st.at = at; await packs.put(slug, 'pulse/state.json', st);
    log.info?.(`[pulse] ${slug}: ${ran.length} signals, ${lines.length} lines, $${usd}`);
    return { lines, notes, usd, ran };
  }
  const due = async () => { const st = await packs.getJSON(slug, 'pulse/state.json', null) || { last: {} }; const t = now(); return Object.keys(S).filter((k) => !st.last?.[k] || t - Date.parse(st.last[k]) >= EVERY[S[k].cadence]); };
  return { run, due, latest: () => packs.getJSON(slug, 'pulse/latest.json', null), signals: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, { cadence: v.cadence, family: v.family }])), brandInfo, questions: async () => questions(await brandInfo()) };
}
