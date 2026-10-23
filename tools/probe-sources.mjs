// Probe the Apify actors Brew may use: one small run each against real brands, reporting rows, how many name the brand or a
// rival, required fields filled, time and what Apify actually charged. An actor passes when the brand or a rival shows up, at
// least 90% of the required fields are filled and the charge is within 2x of what we expect. Paid: every run is capped.
//   APIFY_TOKEN=… node tools/probe-sources.mjs [--only blinkit,zepto] [--cap 3]
const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) { console.error('needs APIFY_TOKEN'); process.exit(1); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = (arg('--only') || '').split(',').filter(Boolean), CAP = +(arg('--cap') || 3);

export const BRANDS = {
  arata: { name: 'Arata', host: 'arata.in', ig: 'arata.in', rivals: ['Fix My Curls', 'Moxie', 'Curl Up', 'WishCare', 'Pilgrim'], query: 'curly hair products India' },
  nutrova: { name: 'Nutrova', host: 'nutrova.com', ig: 'nutrova', rivals: ['OZiva', 'HealthyHey', 'Wellbeing Nutrition', 'Chicnutrix', 'Nyumi'], query: 'best marine collagen supplement India' },
  cozy: { name: 'Cozy Snugglet', host: 'cozysnugglet.shop', rivals: ['The Oodie', 'The Comfy', 'Snugible', 'Snuggie', 'UnHide'], rivalHosts: ['theoodie.com', 'thecomfy.com'], query: 'best wearable blanket' }
};

/* each probe: actor, input for a brand, the fields a row must carry, and the most it may charge */
const P = (id, signal, actor, brand, input, need, expect, minUsd = 0) => ({ id, signal, actor, brand, input, need, expect, minUsd }); /* minUsd: the least cap an actor accepts; its input still bounds the work */
const BLR = 'Koramangala, Bangalore';
export const PROBES = [
  P('blinkit', 'shelf', 'memo23/blinkit-scraper', 'arata', (b) => ({ searchQueries: [b.name], locations: [BLR], productsLimit: 8, maxItems: 8, includeEtaDetails: true }), ['name|productName|title', 'price|sellingPrice|selling_price'], 0.05),
  P('blinkit-2', 'shelf', 'krazee_kaushik/blinkit-product-results-scraper', 'nutrova', (b) => ({ searchQueries: [b.name], locations: [BLR], productsLimit: 8 }), ['name|productName|title', 'price|sellingPrice|selling_price'], 0.05),
  P('zepto', 'shelf', 'memo23/zepto-product-scraper', 'nutrova', (b) => ({ searchQueries: [b.name], locations: ['Koramangala, Bengaluru'], maxItemsPerQuery: 8, maxItems: 8 }), ['name|productName|title', 'price|sellingPrice|selling_price'], 0.03),
  P('zepto-2', 'shelf', 'shahidirfan/zepto-product-scraper', 'arata', (b) => ({ query: b.name, results_wanted: 8, max_pages: 1 }), ['name|productName|title', 'price|sellingPrice|selling_price'], 0.03),
  P('instamart', 'shelf', 'solidcode/swiggy-scraper', 'nutrova', (b) => ({ searchQueries: [b.name, 'collagen'], city: 'Bangalore', maxResults: 8 }), ['name|productName|title', 'price|sellingPrice|offerPrice'], 0.06),
  P('nykaa', 'marketplace', 'automation_craft/nykaa-scraper', 'arata', (b) => ({ searchTerms: [b.name], maxItemsPerSearch: 4, maxItems: 4, includeReviews: true }), ['name|title', 'price|mrp'], 0.1),
  P('flipkart', 'marketplace', 'scrapesage/flipkart-scraper', 'nutrova', (b) => ({ searchTerms: [b.name], maxProducts: 3, maxPagesPerSearch: 1, includeReviews: true, maxReviewsPerProduct: 5 }), ['title|name|reviewText|text', 'price|rating'], 0.06),
  P('flipkart-2', 'marketplace', 'shahidirfan/Flipkart-Product-Scraper', 'nutrova', (b) => ({ keyword: b.name, results_wanted: 5 }), ['title|name', 'price'], 0.03),
  P('myntra', 'marketplace', 'codingfrontend/myntra-product-search-scraper', 'nutrova', (b) => ({ search: b.name, brand: b.name, sortBy: 'popularity', maxProductsPerSearch: 3, maxPages: 1, scrapeReviews: true, maxReviewsPerProduct: 5 }), ['name|title|productName', 'price'], 0.12),
  P('trustpilot', 'reviews', 'memo23/trustpilot-scraper-ppe', 'cozy', (b) => ({ startUrls: b.rivalHosts.slice(0, 1), maxItems: 10 }), ['rating', 'text|reviewBody|content|body'], 0.08, 0.45),
  P('similarweb', 'traffic', 'tri_angle/similarweb-scraper', 'arata', (b) => ({ websites: [b.host, 'fixmycurls.com'] }), ['totalVisits|visits|engagements|traffic'], 0.04),
  P('similarweb-2', 'traffic', 'curious_coder/similarweb-scraper', 'nutrova', (b) => ({ domains: [b.host, 'oziva.in'] }), ['totalVisits|visits|engagements|traffic'], 0.02),
  P('quora', 'listening', 'fatihtahta/quora-scraper', 'nutrova', (b) => ({ queries: [b.query], maxItemsPerQuery: 10 }), ['title|question|text', 'url|link'], 0.02, 1),
  P('quora-2', 'listening', 'blackfalcondata/quora-scraper', 'nutrova', (b) => ({ searchQueries: [b.query], resultTypes: ['question'], maxItems: 10, includeAnswers: true, maxAnswersPerQuestion: 2, proxyConfiguration: { useApifyProxy: true } }), ['title|question|text', 'url|link'], 0.02),
  P('ig-tagged', 'listening', 'dami_studio/instagram-mentions-scraper', 'arata', (b) => ({ usernames: [b.ig], maxItems: 10, resultsPerUsername: 10 }), ['url|postUrl|link', 'caption|text'], 0.02)
];

const pick = (row, alts) => alts.split('|').some((k) => { const v = k.split('.').reduce((o, p) => o?.[p], row); return v !== undefined && v !== null && v !== ''; });
const api = async (path, init = {}) => { const r = await fetch('https://api.apify.com/v2' + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${r.status} ${j?.error?.message || ''}`.trim()); return j; };

export async function probe(p, { maxUsd = Math.max(0.05, p.expect * 3, p.minUsd || 0) } = {}) {
  const b = BRANDS[p.brand], t0 = Date.now(), out = { id: p.id, signal: p.signal, actor: p.actor, brand: p.brand };
  try {
    const run = (await api(`/acts/${p.actor.replace('/', '~')}/runs?waitForFinish=240&maxTotalChargeUsd=${maxUsd}&maxItems=40`, { method: 'POST', body: JSON.stringify(p.input(b)) })).data;
    let r = run; while (!/SUCCEEDED|FAILED|ABORTED|TIMED-OUT/.test(r.status) && Date.now() - t0 < 420e3) r = (await api(`/actor-runs/${run.id}?waitForFinish=60`)).data;
    const rows = r.defaultDatasetId ? await api(`/datasets/${r.defaultDatasetId}/items?clean=1&limit=40`) : [];
    const names = [b.name, ...b.rivals].map((s) => s.toLowerCase());
    const relevant = rows.filter((x) => { const s = JSON.stringify(x).toLowerCase(); return names.some((n) => s.includes(n)); }).length;
    const main = rows.filter((x) => !/review/i.test(x.type || x.rowType || x.recordType || '')), base = main.length ? main : rows; /* a product run with reviews mixed in: check the product rows */
    const filled = base.length ? base.filter((x) => p.need.every((alts) => pick(x, alts))).length / base.length : 0;
    Object.assign(out, { status: r.status, rows: rows.length, relevant, filled: +filled.toFixed(2), usd: +(r.usageTotalUsd || 0).toFixed(4), secs: Math.round((Date.now() - t0) / 1e3), fields: rows[0] ? Object.keys(rows[0]).slice(0, 18) : [] });
    out.pass = r.status === 'SUCCEEDED' && relevant > 0 && filled >= 0.9 && out.usd <= p.expect * 2;
    out.why = out.pass ? 'ok' : [r.status !== 'SUCCEEDED' && r.status, !relevant && 'no brand or rival in rows', filled < 0.9 && `fields ${Math.round(filled * 100)}%`, out.usd > p.expect * 2 && `cost $${out.usd} vs $${p.expect}`].filter(Boolean).join('; ');
  } catch (e) { Object.assign(out, { status: 'ERROR', pass: false, why: e.message.slice(0, 160), secs: Math.round((Date.now() - t0) / 1e3) }); }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = PROBES.filter((p) => !ONLY.length || ONLY.includes(p.id));
  const est = list.reduce((s, p) => s + Math.max(0.05, p.expect * 3), 0);
  if (est > CAP) console.error(`note: worst case $${est.toFixed(2)} is over --cap ${CAP}; runs are capped each`);
  const res = await Promise.all(list.map((p) => probe(p)));
  for (const r of res) console.log(JSON.stringify(r));
  console.log(`total $${res.reduce((s, r) => s + (r.usd || 0), 0).toFixed(3)} · ${res.filter((r) => r.pass).length}/${res.length} pass`);
}
