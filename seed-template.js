// The seed for a generated brand: the same shape as public/data/brew.js, built only from what the reader
// actually found (profile.json) and, later, the cards the moves engine writes. Nothing here invents a number:
// connector logs are number-free until a real account is connected, demo boards start empty.
const hexOk = (x) => /^#[0-9a-f]{6}$/i.test(String(x || ''));
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f)))); return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114) / 255; };
const titleCase = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const andList = (xs) => xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

// the button vocabulary the remix engine knows (remix.js CTA_ACTION); generated cards pick from these
export const CTA = {
  'Publish Campaign': ['Publishing', 'Campaign is live on Meta'], 'Shift budget': ['Moving budget', 'Budget moved to the winners'], 'Rotate creative': ['Swapping ads', 'Fresh versions are live'],
  'Update landing page': ['Updating pages', 'The pages are updated'], 'Publish the page': ['Publishing', 'The page is live'], 'Generate versions': ['Generating', 'Versions on the way'],
  'Draft the listing': ['Drafting', 'Listing drafted'], 'Fix tracking': ['Fixing tracking', 'Tracking fixes queued'], 'Turn on the journey': ['Turning it on', 'The journey is on'],
  'Approve the flows': ['Saving', 'Flows saved as drafts'], 'Send the review ask': ['Sending', 'Review ask is going out'], 'Make the video': ['Starting', 'The video is in production'],
  'Brief the shoot': ['Briefing', 'Shoot brief sent to the team'], 'Shortlist creators': ['Shortlisting', 'Creators shortlisted'], 'Start the tests': ['Starting tests', 'The tests are running'],
  'Fix the markup': ['Fixing', 'Markup fixed'], 'Publish the claims ledger': ['Publishing', 'Claims list and llms.txt are public'], 'Launch the ad group': ['Launching', 'The search ads are live'],
  'Turn on guest checkout': ['Turning it on', 'Guest checkout is on'], 'Agree with the call': ['Saving', 'Decision saved'], 'Open the scoreboard': ['Opening', 'Scoreboard is open'],
  'Draft the buyer deck': ['Drafting', 'Buyer deck drafted'], 'Make our version': ['Drafting', 'Our version is drafted'], 'Review draft': ['Opening', 'Draft is ready to review'],
  'Push the titles': ['Pushing', 'New titles pushed'], 'Open the moves': ['Opening', 'Moves page open'], 'Queue the ads': ['Queueing', 'The kept ads are queued as one test'], 'Approve the offers': ['Saving', 'Offers saved as drafts'],
  'Make the carousel ad': ['Making', 'The carousel is drafted'], 'Build the collection ad': ['Building', 'The collection ad is drafted'], 'Build the catalog ad': ['Building', 'The catalog ad is drafted'],
  'Draft the post': ['Drafting', 'The post is drafted'], 'Draft the carousel post': ['Drafting', 'The carousel post is drafted'], 'Draft the stories': ['Drafting', 'The stories are drafted']
};
export const SPENDS = ['Publish Campaign', 'Shift budget', 'Launch the ad group', 'Queue the ads'];
export const PERSON = ['Brief the shoot', 'Draft the buyer deck', 'Open the scoreboard', 'Review draft', 'Open report'];

const STEPS = [
  { k: 'open', t: 'Open the store', tick: ['/', '/robots.txt', '/sitemap.xml'] },
  { k: 'brand', t: 'Read the brand' },
  { k: 'catalog', t: 'Pull the catalog', agent: 'storefront' },
  { k: 'reviews', t: 'Read what customers say', agent: 'creative' },
  { k: 'ads', t: 'Find live ads, yours and rivals', agent: 'performance' },
  { k: 'site', t: 'Walk the path to checkout', agent: 'storefront' },
  { k: 'answers', t: 'Ask the AI tools', agent: 'visibility' }
];

// before the read: just the address
export function skeletonSeed({ slug, host }) {
  const name = titleCase(host.split('.')[0]);
  return baseSeed({ slug, host, name, tagline: '', colors: ['#171717', '#6B7280', '#E5E7EB'], logo: null, steps: STEPS.map((s) => ({ ...s, done: '' })) });
}

function baseSeed({ slug, host, name, tagline, colors, logo, mark, face, typeName, steps, lanes, laneImg, rivals = [], marketplaces = [], reviewApp, art = [], stack = {} }) {
  const c = colors.filter(hexOk); while (c.length < 3) c.push(['#171717', '#6B7280', '#E5E7EB'][c.length]);
  const dark = lum(c[0]) < .35 ? c[0] : shade(c[0], .3);
  const L = lanes && Object.keys(lanes).length ? lanes : { core: { name: 'Best sellers', line: 'The products most people buy' } };
  const mkName = marketplaces.length ? andList(marketplaces.slice(0, 3)) : 'Marketplaces';
  const rv = reviewApp || 'Reviews';
  return {
    id: slug, slug, generated: true,
    brand: { host, name, tagline: tagline || '', products: '', colors: c.slice(0, 3), face: `${face ? `"${face}", ` : ''}Inter, -apple-system, Helvetica, Arial, sans-serif`, typeName: typeName || '', fonts: [],
      mark: mark || logo || 'assets/brew-mark.svg', logo: logo || mark || 'assets/brew-mark.svg', wash: [dark, c[1], c[2]] },
    vocab: { item: 'product', items: 'products', pages: 'product pages', buyer: 'shopper', buyers: 'shoppers' },
    roles: {
      founder: { name: 'Founder', title: 'Founder / CEO', face: 'brew', line: 'The growth plan, big calls and rivals', greet: 'the growth plan', sector: { signals: 3, ads: 2, creatives: 2, storefront: 2, catalog: 2, visibility: 2 }, type: { decision: 3, report: 3, competitor: 3, idea: 1 }, deckFirst: 'signals', connectors: ['shopify', 'meta', 'marketplaces'], stories: ['brand', 'trends', 'ads', 'news', 'howto'], health: 'Storefront' },
      growth: { name: 'Growth lead', title: 'Growth / Performance', face: 'performance', line: 'Ads: stop, scale, budgets and tired ads', greet: 'cost per first order', sector: { ads: 4, catalog: 2, storefront: 2, creatives: 1, signals: 1, visibility: 1 }, type: { decision: 3, report: 2, competitor: 2, idea: 1 }, deckFirst: 'ads', connectors: ['meta', 'google', 'shopify'], stories: ['brand', 'ads', 'trends', 'news', 'howto'], health: 'Creative' },
      brand: { name: 'Brand manager', title: 'Brand / Creative', face: 'creative', line: 'Hooks, ads, films, founder posts and creators', greet: 'the next ads', sector: { creatives: 4, visibility: 2, ads: 1, storefront: 1, catalog: 1, signals: 1 }, type: { idea: 4, decision: 1, report: 1, competitor: 2 }, deckFirst: 'creatives', connectors: ['meta', 'reviews', 'slack'], stories: ['brand', 'ads', 'trends', 'howto', 'news'], health: 'Creative' },
      ecom: { name: 'E-commerce lead', title: 'E-commerce / Storefront', face: 'storefront', line: 'Product pages, checkout, tests and marketplaces', greet: 'turning visits into orders', sector: { storefront: 4, catalog: 3, visibility: 2, ads: 1, creatives: 1, signals: 1 }, type: { decision: 3, report: 2, idea: 1, competitor: 1 }, deckFirst: 'storefront', connectors: ['shopify', 'marketplaces', 'google'], stories: ['brand', 'trends', 'news', 'ads', 'howto'], health: 'Storefront' },
      crm: { name: 'Retention lead', title: 'Retention / CRM', face: 'crm', line: 'Reorders, messages, reviews and loyalty', greet: 'the second order', sector: { signals: 4, storefront: 2, creatives: 1, ads: 1, catalog: 1, visibility: 1 }, type: { decision: 3, report: 2, idea: 2, competitor: 1 }, deckFirst: 'signals', connectors: ['shopify', 'whatsapp', 'klaviyo'], stories: ['brand', 'news', 'trends', 'howto', 'ads'], health: 'Storefront' }
    },
    wants: {
      idea: { name: 'Ideas to make', line: 'Ads, films and pages to make next' },
      decision: { name: 'Decisions to approve', line: 'One tap does the job' },
      report: { name: 'What works and what doesn’t', line: 'Scores, gaps and the number behind each' },
      competitor: { name: 'Watch the rivals', line: rivals.length ? andList(rivals.slice(0, 5)) : 'The brands next to you on the shelf' }
    },
    lanes: L, laneImg: laneImg || {},
    intro: [
      { c: dark, img: art[0] || logo, h: 'Your moves, turned into cards.' },
      { c: dark, img: art[1] || art[0] || logo, h: 'Each one moves a number.' },
      { c: dark, img: art[2] || art[0] || logo, h: 'Heart it, jam on it, share the brief.' }
    ],
    startArt: art.slice(0, 3),
    health: { score: 0, delta: 0, rings: [{ k: 'Creative', v: 0, what: 'How much of the work has a number' }, { k: 'Storefront', v: 0, what: 'How often a visit becomes a first order' }, { k: 'AI answers', v: 0, what: 'How often AI tools name you' }], moves: [] },
    geo: { score: 0, band: 'Not read yet' },
    connectors: {
      shopify: { name: stack.platform === 'shopify' || !stack.platform ? 'Shopify' : titleCase(stack.platform), color: '#5E8E3E', glyph: 'S', account: host, kind: 'Orders, customers, carts and pages', perms: ['Read orders and customers', 'Read abandoned checkouts'], log: ['Reading 12 months of orders', 'Reading abandoned checkouts', 'Matching opt-ins'], changed: ['Cards show your real orders', 'Checkout cards show your real drop-off'], health: {} },
      meta: { name: 'Meta Ads', color: '#0866FF', glyph: 'f', account: `${name} ad account`, kind: 'Campaigns, spend, reach and the pixel', perms: ['Read campaigns, ad sets and ads', 'Read the last 90 days of results'], log: ['Reading campaigns and live ads', 'Reading 14 days of results', 'Checking frequency and match quality'], changed: ['Ad cards show live cost per order', 'Ad cards show which ads are winning'], health: {} },
      ga4: { name: 'Google Analytics', color: '#E37400', glyph: 'A', account: `${name} · GA4`, kind: 'Visits, funnel and site events (GA4)', perms: ['Read GA4 reports'], log: ['Reading 30 days of sessions', 'Checking the funnel'], changed: ['Storefront cards show your real funnel', 'Tracking card shows the live gap'], health: {} },
      google: { name: 'Google Ads', color: '#4285F4', glyph: 'G', account: `${name} · Google Ads`, kind: 'Search and Shopping campaigns', perms: ['Read campaigns and searches'], log: ['Reading campaigns and searches'], changed: ['Search cards show real searches', 'Ad cards show search spend and return'], health: {} },
      marketplaces: { name: mkName, color: '#FF9900', glyph: 'a', account: `${marketplaces.length || ''} seller accounts`.trim(), kind: 'Listings, ranks, stock and reviews', perms: ['Read listings, titles and images', 'Read ranks, stock and ratings'], log: ['Reading listings', 'Reading ranks and stock'], changed: ['Listing cards show live rank and stock'], health: {} },
      reviews: { name: /judge\.?me/i.test(rv) ? 'Judge.me' : /loox/i.test(rv) ? 'Loox' : /\.[a-z]{2,}$/i.test(rv) && !/^reviews on /i.test(rv) ? `Reviews on ${rv}` : rv, color: '#111111', glyph: rv[0] || 'R', account: `${host} · reviews`, kind: 'Reviews, photos and ratings', perms: ['Read reviews and ratings'], log: ['Reading reviews', 'Grouping by product and concern'], changed: ['Ad ideas from reviews are on the creative cards'], health: {} },
      klaviyo: { name: 'Klaviyo', color: '#232426', glyph: 'K', account: `${name} · Klaviyo`, kind: 'Email consent and flows', optional: true, perms: ['Read lists and flows', 'Read campaign results'], log: ['Reading profiles', 'Reading live flows'], changed: ['Email cards show live results'], health: {} },
      slack: { name: 'Slack', color: '#4A154B', glyph: '#', account: `${name} workspace`, kind: 'Talk with your team, approve in a thread', perms: ['Post cards to channels you pick', 'Read replies in those threads'], log: ['Finding channels', 'Found #growth, #brand, #d2c-ops', 'Adding Brew to #growth'], changed: ['Share to Slack is on every card'], health: {} }
    },
    colleagues: [
      { id: 'growth', role: 'Growth lead', name: 'Growth lead', ini: 'GL', color: '#3fa9f0' },
      { id: 'brandm', role: 'Brand manager', name: 'Brand manager', ini: 'BM', color: '#e66aa8' },
      { id: 'perf', role: 'Performance lead', name: 'Performance lead', ini: 'PL', color: '#8c6cf0' },
      { id: 'ops', role: 'D2C ops', name: 'D2C ops', ini: 'OP', color: '#ef8b33' }
    ],
    pod: [{ role: 'Deploy lead', ini: 'DL' }, { role: 'Creative director', ini: 'CD' }, { role: 'Workflow engineer', ini: 'WE' }, { role: 'Performance lead', ini: 'PL' }],
    posts: [], stories: { trends: [], ads: [] }, batches: [], pastJams: [], saved: [],
    upsell: [
      ['deck', 'The deck', 'Every agent gets a column, posting all day.', art[0] || logo],
      ['signals', 'Signals', 'Who is due to reorder, with the message ready.', art[1] || art[0] || logo],
      ['agents', 'Custom agents', 'Bring your own agent. Give it a column.', art[2] || art[0] || logo]
    ],
    ctaBusy: Object.fromEntries(Object.entries(CTA).map(([k, v]) => [k, v[0]])), ctaDone: Object.fromEntries(Object.entries(CTA).map(([k, v]) => [k, v[1]])),
    spends: SPENDS, needsPerson: PERSON,
    steps, scrape: [],
    segments: [{ name: 'Main subject', hint: 'The product, the pack or the hand' }, { name: 'Background', hint: 'Surface, room or plain colour' }, { name: 'The number', hint: 'Where the price or result sits' }, { name: 'Hands and props', hint: 'Hands, props and setting' }]
  };
}

// after the read: identity, lanes, rivals, steps and findings are real
export function seedFromProfile(slug, profile, findings, extra = {}) {
  const p = profile || {}, id = p.identity || {}, cat = p.catalog || {};
  const prods = cat.products || [];
  // up to three lanes: the biggest collections that are real product groups, else product types
  const skip = /^(all|frontpage|home|best ?sellers?|new|sale|shop|everything|products?)$/i;
  // not product lines: policy, promo and housekeeping collections ("Hassle free returns", "3 Year Sale", "Bulk orders")
  const notLine = /return|exchange|shipping|deliver|refund|\bsale\b|discount|\bdisc\b|offer|deal|coupon|\bcod\b|bulk|test|gift|back in stock|restock|best ?seller|trending|new arrival|just in|under \d|below \d|members?|club|vault|archive|hidden|clearance|outlet|\bdo not|\bcred\b|few left|limited|last chance/i;
  const total = prods.length || 1;
  let groups = (cat.collections || []).filter((x) => x.count >= 2 && !skip.test(x.title || '') && !skip.test(x.handle || '') && !notLine.test(x.title || '') && !notLine.test(x.handle || '') && x.count < Math.max(4, total * 0.7))
    .filter((x, i, a) => a.findIndex((y) => String(y.title).toLowerCase() === String(x.title).toLowerCase()) === i).sort((a, b) => b.count - a.count).slice(0, 3).map((x) => ({ key: x.handle, name: x.title }));
  // product types are the surest product lines (every product says which it is): used first when there are two or more
  const byType = {}; prods.filter((x) => !/gift ?wrap|gift ?card/i.test(x.title || '')).forEach((x) => { if (x.type && !notLine.test(x.type)) byType[x.type] = (byType[x.type] || 0) + 1; });
  const types = Object.entries(byType).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => ({ key: t.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: t }));
  if (types.length >= 2 || groups.length < 2) groups = types.length ? types : groups;
  if (!groups.length) groups = [{ key: 'core', name: 'Best sellers' }];
  const lanes = {}, laneImg = {};
  groups.forEach((g, i) => {
    const inLane = prods.filter((x) => (x.collections || []).includes(g.key) || (x.type && x.type.toLowerCase().replace(/[^a-z0-9]+/g, '-') === g.key));
    const top = (inLane.length ? inLane : prods.slice(i * 2)).slice(0, 2);
    lanes[g.key] = { name: g.name, line: top.map((x) => `${x.title}${x.priceLabel ? `, ${x.priceLabel}` : ''}`).join(' · ') || g.name };
    laneImg[g.key] = top.find((x) => x.img)?.img || prods.find((x) => x.img)?.img || id.logo || null;
  });
  const art = [...new Set(prods.filter((x) => x.img).map((x) => x.img))].slice(0, 6);
  const steps = STEPS.map((s) => ({ ...s, done: findings?.steps?.find((x) => x.k === s.k)?.done || '' }));
  const seed = baseSeed({
    slug, host: p.host, name: p.name || titleCase(p.host?.split('.')[0]), tagline: p.descriptor || p.tagline,
    colors: id.colors || [], logo: id.logo, mark: id.mark, face: id.fonts?.heading || id.fonts?.body, typeName: id.typeName,
    steps, lanes, laneImg, rivals: (p.rivals || []).map((r) => r.name), marketplaces: extra.marketplaces || [], reviewApp: p.reviews?.platforms?.[0]?.name, art, stack: { platform: p.platform }
  });
  seed.scrape = findings?.cards || [];
  seed.brand.products = String(cat.count || prods.length || '');
  seed.rivalLogos = (p.rivals || []).filter((r) => r.logo).map((r) => [r.name, r.logo]);
  if (extra.marketLogos) seed.marketLogos = extra.marketLogos;
  // honest health: only what the read measured (AI answers from the real questions); the rest waits for a connector
  const named = p.ai?.score?.named, of = p.ai?.score?.of;
  if (of) { const v = Math.round(100 * named / of); seed.health.rings[2].v = v; seed.geo = { score: v, band: v >= 60 ? 'Good' : v >= 35 ? 'Fair' : 'Low' }; seed.health.score = v; }
  return seed;
}

/* DUMMY: connected accounts are simulated (DUMMY.md). A pack written before the cut may still list a WhatsApp connector, or
   say a connector acts ("Spend actions run…", "only with your OK", "Approve in Slack…"): at load those go, for every brand */
const ACTS = /only with your OK|actions? run|can send|approve in slack|create (flows|ads|ad groups)|edit (pages|titles)|send (review asks|approved)/i;
/* Google Analytics and Google Ads are two accounts (2026-10-16): a pack made before lists one "Google Ads + GA4"; at load it becomes both */
const GA4_CONN = (account) => ({ name: 'Google Analytics', color: '#E37400', glyph: 'A', account, kind: 'Visits, funnel and site events (GA4)', perms: ['Read GA4 reports'], log: ['Reading 30 days of sessions', 'Checking the funnel'], changed: ['Storefront cards show your real funnel', 'Tracking card shows the live gap'], health: {} });
export function prototypeConnectors(conns = {}) {
  const out = {};
  for (const [id0, c0] of Object.entries(conns || {})) { if (id0 === 'whatsapp') continue;
    let [id, c] = [id0, c0];
    if (id === 'google' && !conns.ga4 && /GA4|Analytics/i.test(`${c.name} ${c.kind}`)) {
      out.ga4 = GA4_CONN(String(c.account || '').replace(/Google$/, 'GA4'));
      c = { ...c, name: 'Google Ads', account: String(c.account || '').replace(/Google$/, 'Google Ads'), kind: 'Search and Shopping campaigns', perms: (c.perms || []).filter((x) => !/GA4/i.test(x)), changed: (c.changed || []).filter((x) => !/tracking|GA4|product-page/i.test(x)) }; }
    out[id] = { ...c, perms: (c.perms || []).filter((x) => !ACTS.test(x)), changed: (c.changed || []).filter((x) => !ACTS.test(x)), ...(c.changedDemo ? { changedDemo: c.changedDemo.filter((x) => !ACTS.test(x)) } : {}) }; }
  return out;
}
