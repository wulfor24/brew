// node --test test/  — "fetch everything relevant": indirect searches (problems, buyer questions), the wider search mix,
// partial results on a timeout, Reddit's 429 back-off, the review apps on the brand's own site, light reads between full
// reads, direct vs indirect reach, and the 8-hour cadence. Free: fakes for treg, the AI and fetch; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createListenWatch, reviewAppOf, looxReviews, MIX, LITE_MIX, LITE_SKIP } from '../listen-watch.js';
import { heardView, dueFor, socialConfig, createSocialScheduler } from '../social-feed.js';

const H = 3600e3, DAY = 24 * H, NOW = Date.parse('2026-10-14T12:00:00Z'), T = Math.floor(NOW / 1e3) - 3 * 86400;
const quiet = { warn: () => {}, info: () => {}, log: () => {}, error: () => {} };
const hh = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
const memPacks = (brands = ['acme-com']) => { const files = new Map(); return { files, list: async () => brands.map((slug) => ({ slug, status: { name: slug, ready: true } })), getJSON: async (s, n, d = null) => (files.has(`${s}/${n}`) ? JSON.parse(files.get(`${s}/${n}`)) : d), put: async (s, n, x) => { files.set(`${s}/${n}`, JSON.stringify(x)); } }; };
const PROFILE = { name: 'Acme', host: 'acme.com', country: 'US', category: 'sneakers', about: 'Wool sneakers for all-day comfort', rivals: [{ name: 'Rival', host: 'rival.com' }, { name: 'Other Co', host: 'other.com' }] };
const brandPacks = async (profile = PROFILE) => { const p = memPacks(); await p.put('acme-com', 'profile.json', profile); await p.put('acme-com', 'config.json', { rivals: ['Rival', 'Other Co'], terms: [['wool sneakers'], ['comfortable sneakers']] }); return p; };
// a fake treg: every call is $0.002; fixtures answer by endpoint id
const FIX = {
  'serper.google.serp.autocomplete': ({ body }) => ({ suggestions: [{ value: `${body.q} good for wide feet` }, { value: body.q }] }),
  'tikhub.tiktok.search.videos': ({ query }) => ({ data: { search_item_list: [{ aweme_info: { aweme_id: `7${hh(query.keyword)}`, desc: `${query.keyword} after a month of daily wear, my feet ache less`, create_time: T, author: { nickname: 'Jo Ann', unique_id: 'joann' }, statistics: { digg_count: 5, comment_count: 0 } } }] } }),
  'anyapi.x.search.posts': ({ body }) => ({ output: { data: { items: [{ id: hh(body.query), text: `${body.query.replace(/"|-filter:links/g, '')} talk: my sneakers keep my feet comfy all day`, createdUtc: T, authorName: 'Ana B', url: `https://x.com/a/status/${hh(body.query)}` }] } } }),
  'crawl4ai.amazon.search.products': ({ body }) => ({ rows: /^Acme/.test(body.keywords) ? [{ asin: 'B0ACME1', title: 'Acme Wool Runner sneakers', reviews: 900 }] : /^Rival/.test(body.keywords) ? [{ asin: 'B0RIV1', title: 'Rival Knit sneakers', reviews: 500 }] : /^Other/.test(body.keywords) ? [{ asin: 'B0OTH1', title: 'Other Co Trail sneakers', reviews: 300 }] : [{ asin: 'B0CAT1', title: 'Generic comfortable sneakers for men', reviews: 4000 }, { asin: 'B0ACME2', title: 'Acme Tree sneakers', reviews: 10 }] }),
  'crawl4ai.amazon.product.reviews': ({ body }) => ({ rows: [{ review_id: `r${hh(body.product)}`, rating: 4, title: 'Good', text: `Comfortable sneakers for long days on my feet (${body.product.split('/').pop()})`, date: '2026-10-01', author: 'Pat' }] }),
  'tinyfish.web.search.news': ({ query }) => ({ results: [{ title: `${query.query.replace(/"/g, '')} sneakers news`, snippet: `${query.query.replace(/"/g, '')}: sneakers brands race to make shoes for standing all day comfortable`, url: `https://news.example.com/${hh(query.query)}`, publisher: 'Example News', date: 'Oct 1, 2026' }] }),
  'treg.web.search': ({ body }) => ({ output: { results: [{ title: `${body.q} - Quora`, snippet: `I asked this too: which sneakers help when your feet hurt from standing all day ${hh(body.q)}`, url: `https://www.quora.com/q-${hh(body.q)}` }] } })
};
const fakeTreg = (fix = FIX, price = 0.002) => { const t = { live: true, calls: [], meter: { usd: 0 } }; t.call = async (id, o) => { t.calls.push([id, o]); t.meter.usd += price; if (!fix[id]) throw new Error(`treg ${id} 404: not in fixtures`); return fix[id](o); }; return t; };
// a fake Claude: the config filter, the indirect searches; tagging is off (no tag tag) so the filter decides
const fakeAI = (calls = []) => ({ live: true, call: async (o) => { calls.push(o.tag); if (/listen-config/.test(o.tag)) return { usd: 0.004, json: { strong: ['acme sneakers'], weak: ['acme'], must: ['sneakers', 'shoes', 'feet', 'comfortable', 'wool'], junk: ['coupon'], brandQueries: ['"Acme" sneakers'], categoryQueries: ['comfortable sneakers'], noun: 'sneakers' } };
  if (/listen-indirect/.test(o.tag)) return { usd: 0.002, json: { problems: ['foot pain all day sneakers', 'shoes for standing all day'], questions: ['are wool sneakers good for summer'], needs: ['foot pain', 'standing all day'] } };
  if (/listen-tag/.test(o.tag)) return { usd: 0.001, json: { items: [] } };
  throw new Error(`unexpected ai ${o.tag}`); } });
const watch = async (o = {}) => { const packs = o.packs || await brandPacks(), treg = o.treg || fakeTreg(), ai = o.ai || fakeAI();
  return { packs, treg, ai, W: createListenWatch({ slug: 'acme-com', packs, treg, ai, apify: null, log: quiet, now: () => o.t ?? NOW }) }; };
const withFetch = async (fn, body) => { const f0 = globalThis.fetch; globalThis.fetch = fn; try { return await body(); } finally { globalThis.fetch = f0; } };
const res = (status, body, as = 'json') => ({ ok: status < 400, status, json: async () => body, text: async () => (as === 'json' ? JSON.stringify(body) : body) });

test('config: a fresh build writes problems, questions (autocomplete first, then Claude) and need words', async () => {
  const { W, treg, packs } = await watch(), c = await W.config({ fresh: true });
  assert.deepEqual(c.terms.problems, ['foot pain all day sneakers', 'shoes for standing all day']);
  assert.ok(c.terms.questions.some((q) => /good for wide feet/.test(q)), 'real autocomplete suggestions lead'); assert.ok(c.terms.questions.includes('are wool sneakers good for summer'));
  assert.ok(c.terms.questions.length <= 5 && c.terms.questions.every((q) => !/^is acme$/i.test(q)), 'a bare prefix is never a question');
  assert.deepEqual(c.filter.needs, ['foot pain', 'standing all day']); assert.equal(c.terms.indirectBy, 'claude');
  assert.ok(treg.calls.some(([id]) => id === 'serper.google.serp.autocomplete'));
  assert.deepEqual(JSON.parse(packs.files.get('acme-com/listen/config.json')).terms.problems, c.terms.problems, 'cached with the config');
  // paid reads off: no autocomplete, Claude's questions only
  const t2 = fakeTreg(); const c2 = await (await watch({ treg: t2 })).W.config({ fresh: true, paid: false });
  assert.ok(!t2.calls.length); assert.deepEqual(c2.terms.questions, ['are wool sneakers good for summer']);
  // no AI: plain fallbacks, never empty
  const c3 = await (await watch({ ai: { live: false } })).W.config({ fresh: true, paid: false });
  assert.ok(c3.terms.problems.length && c3.terms.questions.length); assert.equal(c3.terms.indirectBy, 'fallback');
});

test('config: a stored config from before the indirect searches is back-filled on the next run, not rebuilt', async () => {
  const packs = await brandPacks(), aiCalls = [];
  const OLD = { v: 1, at: NOW - 30 * DAY, slug: 'acme-com', name: 'Acme', host: 'acme.com', country: 'US', category: 'sneakers', noun: 'sneakers', products: [], rivals: ['Rival'], myshopify: null, reviewApp: null, amazon: ['us', 'amazon.com'], usd: 0.004,
    terms: { brand: ['"Acme" sneakers'], products: [], rivals: ['"Rival" sneakers'], category: ['comfortable sneakers'] }, filter: { strong: ['acme.com', 'acme sneakers'], weak: ['acme'], must: ['sneakers'], junk: ['kept-junk-word'], rivals: ['rival'], by: 'claude' } };
  await packs.put('acme-com', 'listen/config.json', OLD);
  const { W } = await watch({ packs, ai: fakeAI(aiCalls) });
  const r = await W.run({ only: ['news'] }), c = JSON.parse(packs.files.get('acme-com/listen/config.json'));
  assert.deepEqual(aiCalls.filter((t) => /listen-config/.test(t)), [], 'the filter is not rebuilt'); assert.ok(aiCalls.some((t) => /listen-indirect/.test(t)));
  assert.deepEqual(c.filter.junk, ['kept-junk-word']); assert.equal(c.at, OLD.at); assert.deepEqual(c.terms.problems, ['foot pain all day sneakers', 'shoes for standing all day']);
  assert.ok(r.status.usd.ai > 0, 'the back-fill call is counted in the run');
  aiCalls.length = 0; await W.run({ only: ['news'] }); assert.ok(!aiCalls.some((t) => /listen-indirect/.test(t)), 'only once');
});

test('wider search mix: paid sources search 2 brand, 2 rival, 2 category and 2 problem queries; brand-only sources now read rivals and the category', async () => {
  assert.deepEqual(MIX, { brand: 2, rival: 2, category: 2, problem: 2 });
  const { W, treg, packs } = await watch(), r = await W.run({ only: ['tiktok', 'x', 'amazon', 'news', 'web'] }), st = r.status.sources;
  for (const k of ['tiktok', 'x', 'amazon', 'news', 'web']) assert.equal(st[k].state, 'ok', `${k}: ${st[k].error || ''}`);
  const kw = treg.calls.filter(([id]) => id === 'tikhub.tiktok.search.videos').map(([, o]) => o.query.keyword);
  assert.equal(kw.length, 7, kw.join(' | ')); /* one brand search: the config has a single distinct brand query */ assert.ok(kw.includes('Rival sneakers') && kw.includes('Other Co sneakers') && kw.includes('foot pain all day sneakers') && kw.includes('comfortable sneakers'));
  const xq = treg.calls.filter(([id]) => id === 'anyapi.x.search.posts').map(([, o]) => o.body.query);
  assert.ok(xq.length >= 7 && xq.some((q) => /Rival/.test(q)) && xq.some((q) => /foot pain/.test(q)), xq.join(' | '));
  const amz = treg.calls.filter(([id]) => id === 'crawl4ai.amazon.product.reviews').map(([, o]) => o.body.product.split('/').pop()).sort();
  assert.deepEqual(amz, ['B0ACME1', 'B0CAT1', 'B0OTH1', 'B0RIV1'], "the brand's, both rivals' and the category's best seller (never the brand's own listing as the category)");
  const by = (p) => r.items.filter((x) => x.platform === p);
  assert.ok(by('amazon').some((x) => x.about === 'rival' && x.acct === 'rival') && by('amazon').some((x) => x.about === 'category') && by('amazon').some((x) => x.about === 'brand'));
  assert.ok(by('x').some((x) => x.q === 'problem' && x.about === 'category'), 'a problem search keeps posts that talk about the need');
  assert.ok(by('news').some((x) => x.q === 'rival') && by('web').some((x) => x.q === 'question'));
  // reach: direct for the brand, indirect for everything else; counted in status and history
  assert.ok(r.items.every((x) => x.reach === (x.about === 'brand' ? 'direct' : 'indirect')));
  assert.ok(r.status.byReach.direct > 0 && r.status.byReach.indirect > 0); assert.equal(r.status.byReach.direct + r.status.byReach.indirect, r.items.length);
  const h = JSON.parse(packs.files.get('acme-com/listen/history/2026-10-14.json')); assert.deepEqual(h.byReach, r.status.byReach);
  const v = await W.itemsView({ reach: 'indirect', limit: 500 }); assert.ok(v.items.length && v.items.every((x) => x.reach === 'indirect')); assert.equal(v.reach.direct + v.reach.indirect, r.items.length);
});

test('a source that runs out of time keeps what it read, says so in its notes, and stops spending', async () => {
  let hang = 0; const fix = { ...FIX, 'tikhub.tiktok.search.videos': (o) => (/Rival|foot|shoes|comfortable|wool/.test(o.query.keyword) ? new Promise(() => { hang++; }) : FIX['tikhub.tiktok.search.videos'](o)) };
  const { W, treg } = await watch({ treg: fakeTreg(fix) }), r = await W.run({ only: ['tiktok'], timeouts: { tiktok: 300 } }), st = r.status.sources.tiktok;
  assert.equal(st.state, 'ok'); assert.equal(st.partial, true); assert.ok(st.got >= 1); assert.match(st.notes[0], /kept \d+ read before: tiktok timed out/);
  assert.ok(r.items.some((x) => x.platform === 'tiktok'), 'the partial read reaches the wall');
  const n = treg.calls.length; await new Promise((ok) => setTimeout(ok, 50)); assert.equal(treg.calls.length, n, 'nothing more is called after the timeout');
  // a source with nothing read still reports the error
  const fix2 = { ...FIX, 'tikhub.tiktok.search.videos': () => new Promise(() => {}) };
  const r2 = await (await watch({ treg: fakeTreg(fix2) })).W.run({ only: ['tiktok'], timeouts: { tiktok: 100 } });
  assert.equal(r2.status.sources.tiktok.state, 'error'); assert.match(r2.status.sources.tiktok.error, /timed out/);
});

test('Reddit: PullPush 429s back off and hand over to the paid search; the feed is skipped after two refusals; partial results survive', async () => {
  const fix = { ...FIX, 'tikhub.x.reddit-app-fetch-dynamic-search': ({ query }) => ({ data: { children: [{ post: { id: `t3_${hh(query.query)}`, createdAt: '2026-10-10T10:00:00+0000', postTitle: `${query.query} help`, permalink: `/r/Sneakers/comments/${hh(query.query)}/x/`, content: { markdown: `My feet hurt after standing all day in my old sneakers, what helps? (${query.query})` }, score: 3, commentCount: 4, authorInfo: { name: 'Sole' }, subreddit: { prefixedName: 'r/Sneakers' } } }] } }) };
  const urls = []; const { W, treg } = await watch({ treg: fakeTreg(fix) });
  const r = await withFetch(async (u) => { urls.push(String(u)); return res(429, {}); }, () => W.run({ only: ['reddit'], pace: 0.001 }));
  const st = r.status.sources.reddit, d = st.detail;
  assert.equal(st.state, 'ok'); assert.equal(d.pullpushOff, true); assert.ok(d.feedRefused <= 2, 'the feed is asked twice at most');
  assert.ok(urls.filter((u) => /pullpush/.test(u)).length <= 6 * 2, 'PullPush stops after three refusals (each tried twice)');
  assert.equal(d.paidFallbacks, d.queries, 'the paid search answers every search (under its 12-call cap)'); assert.equal(treg.calls.filter(([id]) => id === 'tikhub.x.reddit-app-fetch-dynamic-search').length, d.queries);
  assert.ok(st.notes.some((n) => /pullpush kept refusing/.test(n))); assert.ok(r.items.some((x) => x.platform === 'reddit' && x.q === 'problem'), 'indirect searches reach Reddit too');
  // paid off: nothing paid, and the error says both refused
  const r2 = await withFetch(async () => res(429, {}), async () => (await watch()).W.run({ only: ['reddit'], paid: false, pace: 0.001 }));
  assert.equal(r2.status.sources.reddit.state, 'error'); assert.match(r2.status.sources.reddit.error, /refused every search/);
});

test('review apps: found in the HTML with their public key; Loox blocks parse; nothing found is a clean skip', () => {
  assert.deepEqual(reviewAppOf('<script src="https://cdn.judge.me/x.js"></script> Shopify.shop = "acme.myshopify.com"'), { app: 'judge.me', shop: 'acme.myshopify.com' });
  assert.deepEqual(reviewAppOf('<script src="https://cdn-widgetsrepository.yotpo.com/v1/loader/AbCdEfGhIjKlMnOpQrStUvWx"></script>'), { app: 'yotpo', key: 'AbCdEfGhIjKlMnOpQrStUvWx' });
  assert.equal(reviewAppOf('<script src="//staticw2.yotpo.com/ZZZZZZZZZZZZZZZZZZZZZZZZ/widget.js">').key, 'ZZZZZZZZZZZZZZZZZZZZZZZZ');
  assert.deepEqual(reviewAppOf('<div data-oke-widget></div><script>{"subscriberId":"0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"}</script>'), { app: 'okendo', key: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b' });
  assert.deepEqual(reviewAppOf('<div id="stamped-main-widget" data-api-key="pubkey-abc123" data-store-url="acme.myshopify.com"></div><script src="https://cdn1.stamped.io/x.js">'), { app: 'stamped', key: 'pubkey-abc123', store: 'acme.myshopify.com' });
  assert.deepEqual(reviewAppOf('<script src="https://loox.io/widget/NJx9-aBc/loox.js?shop=acme.myshopify.com"></script>'), { app: 'loox', key: 'NJx9-aBc' });
  assert.equal(reviewAppOf('<html>plain store</html>'), null); assert.equal(reviewAppOf('yotpo is here').key, null, 'an app without a readable key says so');
  const xs = looxReviews(`<div class="grid-item-wrap" data-id="r1"><div class="title">Maria Lopez</div><div class="time">2 weeks ago</div><span class="loox-icon loox-icon--star"></span><span class="loox-icon loox-icon--star"></span><span class="loox-icon loox-icon--star"></span><span class="loox-icon loox-icon--star"></span><div class="main-text">Warm and soft, my dog loves it</div></div>
    <div class="grid-item-wrap" data-id="r2"><div class="title">Sam</div><div class="pre-wrap">Arrived fast &amp; fits well</div></div><div data-id="r3"><div class="main-text"></div></div>`, { url: 'https://acme.com/products/p', title: 'Paw Warmer', now: NOW });
  assert.equal(xs.length, 2); assert.deepEqual([xs[0].id, xs[0].author, xs[0].rating, xs[0].text, xs[0].product], ['site:loox:r1', 'Maria L.', 4, 'Warm and soft, my dog loves it', 'Paw Warmer']);
  assert.ok(Math.abs(xs[0].postedAt - (NOW - 14 * DAY)) < DAY); assert.equal(xs[1].text, 'Arrived fast & fits well');
});

test('site reviews: Okendo, Stamped, Yotpo (key on a product page) and Loox feeds are read; no app or no key skips cleanly', async () => {
  const run = async (pages) => { const urls = []; const { W } = await watch(); const r = await withFetch(async (u) => { u = String(u); urls.push(u); for (const [re, v] of pages) if (re.test(u)) return typeof v === 'function' ? v(u) : v; return res(404, {}); }, () => W.run({ only: ['site'] })); return { r, st: r.status.sources.site, site: r.items.filter((x) => x.platform === 'site'), urls }; };
  const PRODUCTS = res(200, { products: [{ id: 111, handle: 'wool-runner', title: 'Wool Runner' }, { id: 222, handle: 'tree-dasher', title: 'Tree Dasher' }] });
  // Okendo: the subscriber id is on the home page
  let o = await run([[/^https:\/\/acme\.com\/$/, res(200, '<div data-oke-reviews></div><script>window.okeConfig={"subscriberId":"0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"}</script>', 'text')],
    [/api\.okendo\.io\/v1\/stores\/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b\/reviews/, res(200, { reviews: [{ reviewId: 'k1', rating: 5, title: 'Love', body: 'Best sneakers I have owned, so comfortable', dateCreated: '2026-10-01T00:00:00Z', reviewer: { displayName: 'Lee Park' }, productName: 'Wool Runner', productUrl: '//acme.com/products/wool-runner' }] })]]);
  assert.equal(o.st.state, 'ok', o.st.error); assert.equal(o.st.detail.app, 'okendo'); assert.deepEqual([o.site[0].id, o.site[0].author, o.site[0].rating, o.site[0].link, o.site[0].reach], ['site:oke:k1', 'Lee P.', 5, 'https://acme.com/products/wool-runner', 'direct']);
  // Stamped: key and store on the home page
  o = await run([[/^https:\/\/acme\.com\/$/, res(200, '<div id="stamped-main-widget" data-api-key="pubkey-abc" data-store-url="acme.myshopify.com"></div>', 'text')],
    [/stamped\.io\/api\/widget\/reviews\?storeUrl=acme\.myshopify\.com&apiKey=pubkey-abc/, res(200, { total: 1, data: [{ id: 9, author: 'Kim', reviewTitle: 'Nice', reviewMessage: 'Light, warm and easy to wash', reviewRating: 4, reviewDate: '2026-09-30', productName: 'Tree Dasher' }] })]]);
  assert.equal(o.st.detail.app, 'stamped'); assert.deepEqual([o.site[0].id, o.site[0].rating, o.site[0].product], ['site:stamped:9', 4, 'Tree Dasher']);
  // Yotpo: named on the home page, key only on a product page; store reviews and each product's reviews
  o = await run([[/^https:\/\/acme\.com\/$/, res(200, '<script>yotpoEnabled: false</script>', 'text')], [/products\.json/, PRODUCTS],
    [/acme\.com\/products\/wool-runner$/, res(200, '<script src="https://cdn-widgetsrepository.yotpo.com/v1/loader/KeyKeyKeyKeyKeyKeyKey12"></script>', 'text')],
    [/api-cdn\.yotpo\.com\/v1\/widget\/KeyKeyKeyKeyKeyKeyKey12\/products\/(\w+)\/reviews\.json/, (u) => res(200, { response: { reviews: [{ id: `y${u.match(/products\/(\w+)\//)[1]}`, score: 5, title: 'Great', content: `Wore them on a long trip, no blisters at all (${u.match(/products\/(\w+)\//)[1]})`, created_at: '2026-10-02T00:00:00Z', user: { display_name: 'Ana Ruiz' } }] } })]]);
  assert.equal(o.st.state, 'ok', o.st.error); assert.equal(o.st.detail.app, 'yotpo'); assert.deepEqual(o.site.map((x) => x.id).sort(), ['site:yotpo:y111', 'site:yotpo:y222', 'site:yotpo:yyotpo_site_reviews']);
  assert.equal(o.site.find((x) => x.id === 'site:yotpo:y111').product, 'Wool Runner');
  // Loox: per product widget HTML
  o = await run([[/^https:\/\/acme\.com\/$/, res(200, '<script src="https://loox.io/widget/NJx9/loox.js"></script>', 'text')], [/products\.json/, PRODUCTS],
    [/loox\.io\/widget\/NJx9\/reviews\/(\d+)/, (u) => res(200, `<div class="grid-item-wrap" data-id="l${u.match(/reviews\/(\d+)/)[1]}"><div class="title">Rae</div><div class="main-text">Soft, warm and true to size (${u.match(/reviews\/(\d+)/)[1]})</div></div>`, 'text')]]);
  assert.equal(o.st.detail.app, 'loox'); assert.equal(o.site.length, 2);
  // nothing to read: clean skips with the reason
  o = await run([[/^https:\/\/acme\.com\/$/, res(200, '<html>no widget</html>', 'text')], [/products\.json/, PRODUCTS], [/acme\.com\/products\//, res(200, '<html></html>', 'text')]]);
  assert.equal(o.st.state, 'needs'); assert.match(o.st.error, /no review app found/);
  o = await run([[/^https:\/\/acme\.com\/$/, res(200, 'yotpo', 'text')], [/products\.json/, res(200, { products: [] })]]);
  assert.equal(o.st.state, 'needs'); assert.match(o.st.error, /yotpo is on the site but its public key is not in the page/);
});

test('a light read: free sources plus fast social sources with one search per kind; slow sources keep their last full status', async () => {
  const { W, treg, packs } = await watch();
  const full = await W.run({ only: ['tiktok', 'amazon', 'news'] }); assert.equal(full.status.sources.amazon.state, 'ok');
  treg.calls.length = 0;
  const lite = await W.run({ lite: true, only: ['tiktok', 'amazon', 'news', 'x'], capUsd: 0.15 }), st = lite.status.sources;
  assert.equal(lite.status.lite, true); assert.ok(LITE_SKIP.has('amazon') && !LITE_SKIP.has('tiktok'));
  assert.equal(st.amazon.state, 'carried', 'carried from the full read, never shown as read now'); assert.ok(st.amazon.carried); assert.ok(!treg.calls.some(([id]) => /amazon/.test(id)), 'no Amazon spend on a light read');
  assert.ok(st.amazon.total >= 1, 'its items still count');
  const kw = treg.calls.filter(([id]) => id === 'tikhub.tiktok.search.videos').map(([, o]) => o.query.keyword);
  assert.equal(kw.length, LITE_MIX.brand + LITE_MIX.rival + LITE_MIX.problem, kw.join(' | '));
  // an "only" run never hides a source that was read before (one source asked, the rest went "off")
  const only = await W.run({ only: ['news'] }); assert.equal(only.status.sources.tiktok.state, 'carried', 'kept from its last read, shown as carried'); assert.equal(only.status.sources.reddit.state, 'off', 'never read: still off');
  assert.ok(JSON.parse(packs.files.get('acme-com/listen/status.json')).sources.amazon.carried);
});

test('the store keeps every source: a loud source never pushes a quiet one past the 3000-item cap', async () => {
  const packs = await brandPacks(), old = Array.from({ length: 3100 }, (_, i) => ({ id: `rd:t3_${i}`, platform: 'reddit', kind: 'post', text: `acme sneakers post number ${i} with enough words`, postedAt: NOW - i * 60e3, about: 'brand', q: 'brand', tagged: NOW, themes: [] }));
  old.push(...Array.from({ length: 5 }, (_, i) => ({ id: `site:${i}`, platform: 'site', kind: 'review', text: `Old but real review ${i} of the sneakers`, postedAt: NOW - 400 * DAY, about: 'brand', q: 'brand', tagged: NOW, themes: [] })));
  await packs.put('acme-com', 'listen/items.json', { items: old });
  const r = await (await watch({ packs })).W.run({ only: ['news'] });
  assert.ok(r.items.length <= 3000); assert.equal(r.items.filter((x) => x.platform === 'site').length, 5);
});

test('What we heard: direct vs indirect counts, and a source counted by the last run shows even without its items here', () => {
  const L = { themes: [{ name: 'fit', n: 4, pos: 1, neg: 2, neutral: 1 }], threads: [], communities: [],
    status: { at: NOW, items: 5, sources: { reddit: { name: 'Reddit', state: 'ok', total: 3 }, amazon: { name: 'Amazon reviews', state: 'ok', total: 2 }, x: { name: 'X posts', state: 'error', total: 0 } } },
    items: [{ id: 'a', platform: 'reddit', about: 'brand', reach: 'direct' }, { id: 'b', platform: 'reddit', about: 'rival', reach: 'indirect' }, { id: 'c', platform: 'reddit', about: 'category' }] };
  const v = heardView(L, { name: 'Acme' });
  assert.deepEqual(v.byReach, { direct: 1, indirect: 2 }); assert.deepEqual(v.sources.map((s) => [s.id, s.n]), [['reddit', 3], ['amazon', 2]]);
  assert.deepEqual(v.sources[1].name, 'Amazon reviews');
});

test('cadence: listening every 8 hours, the full paid sweep once a day, light reads between, daily cap $3', async () => {
  const cfg = socialConfig({ SOCIAL_BG: '1' });
  assert.deepEqual([cfg.listenEveryH, cfg.listenFullEveryH, cfg.dayCapUsd, cfg.listenRunCapUsd, cfg.listenLiteCapUsd], [8, 24, 3, 0.6, 0.15]);
  assert.equal(socialConfig({ SOCIAL_BG: '1', LISTEN_LITE_CAP_USD: '0.05', LISTEN_EVERY_H: '12' }).listenLiteCapUsd, 0.05);
  let d = dueFor({}, cfg, { now: NOW }); assert.ok(d.listen && d.listenFull);
  d = dueFor({ lastListen: NOW - 7 * H, lastFullListen: NOW - 7 * H, listen: { at: NOW - 7 * H } }, cfg, { now: NOW }); assert.ok(!d.listen); assert.match(d.why.join(), /last 8 hours/);
  d = dueFor({ lastListen: NOW - 9 * H, lastFullListen: NOW - 9 * H, listen: { at: NOW - 9 * H } }, cfg, { now: NOW }); assert.ok(d.listen && !d.listenFull, 'a light read');
  d = dueFor({ lastListen: NOW - 9 * H, lastFullListen: NOW - 25 * H, listen: { at: NOW - 9 * H } }, cfg, { now: NOW }); assert.ok(d.listen && d.listenFull);
  const day = new Date(NOW).toISOString().slice(0, 10);
  d = dueFor({ lastListen: NOW - 9 * H, lastFullListen: NOW - 9 * H, spend: { day, usd: 2.9 }, listen: { at: NOW - 9 * H } }, cfg, { now: NOW }); assert.ok(d.listen && !d.listenFull, 'a light read fits under what a full read would not');
  d = dueFor({ lastListen: NOW - 9 * H, lastFullListen: NOW - 25 * H, spend: { day, usd: 2.9 }, listen: { at: NOW - 9 * H } }, cfg, { now: NOW }); assert.ok(!d.listen);
  // the scheduler: full, then light at +8h and +16h, full again at +24h
  let t = NOW; const calls = [];
  const make = { listen: () => ({ run: async (o) => { calls.push(o); return { status: { usd: { total: o.lite ? 0.01 : 0.2 }, items: 3, sources: {} }, themes: [] }; } }), ideas: () => ({ spend: {}, next: async () => ({ ideas: [], usd: {} }) }) };
  const S = createSocialScheduler({ packs: memPacks(['acme-com']), ai: { live: true }, treg: null, log: quiet, env: { SOCIAL_BG: '1', IDEAS_OFF: '1' }, now: () => t, make });
  for (const h of [0, 2, 8, 16, 24]) { t = NOW + h * H; await S.tick(); }
  assert.deepEqual(calls.map((o) => [o.lite, o.capUsd]), [[false, 0.6], [true, 0.15], [true, 0.15], [false, 0.6]]);
  const st = await S.stateOf('acme-com'); assert.equal(st.listen.full, true); assert.equal(st.lastFullListen, NOW + 24 * H);
});
