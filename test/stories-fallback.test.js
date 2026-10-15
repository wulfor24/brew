// Stories keep coming without AI: trends, news and how-to are written from the data when the AI call fails,
// for any brand (lanes come from the brand's own seed), with noise and near-duplicates kept out and no paise.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createResearch, pool, noPaise } from '../research.js';

const today = new Date().toISOString().slice(0, 10);
const series = (a, b) => [...Array(30).fill(a), ...Array(30).fill(b)].map((v, i) => ({ date_from: `2026-0${1 + Math.floor(i / 28)}-01`, values: [v] }));
const trendsReply = (body) => {
  const kw = body[0].keywords[0];
  if (body[0].item_types) return { tasks: [{ result: [{ items: [{ type: 'google_trends_queries_list', data: { rising: [{ query: 'hair oil for men', value: 250 }, { query: 'onion oil', value: 120 }] } }] }] }] };
  const data = kw === 'tiny term' ? series(0, 7) : kw === 'hair serum' ? series(20, 34) : series(40, 41);
  return { tasks: [{ result: [{ items: [{ type: 'google_trends_graph', data, averages: [30] }] }] }] };
};
function make({ lanes = { scalp: {}, growth: {} } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-stories-'));
  const calls = [];
  const tregClient = { meter: { usd: 0 }, call: async (id, { body, query }) => { calls.push(id);
    if (/trends-explore/.test(id)) return trendsReply(body);
    if (id === 'tinyfish.web.search.news') return { results: [{ title: `${query.query} launches a new serum - Inc42`, snippet: 'It costs ₹499.00 and ships today.', url: `https://inc42.com/${encodeURIComponent(query.query)}`, date: today, publisher: 'Inc42' }] };
    throw new Error('treg 402: insufficient_balance'); } };
  const brand = { slug: 'test-brand', name: 'Testo', host: 'testo.in', kind: 'generated', seed: { lanes }, config: { country: 'IN', countryName: 'India', category: 'hair care', rivals: ['Rival One'], terms: [['hair serum'], ['tiny term'], ['flat term']], rising: ['hair oil'], festival: { name: 'Diwali', label: '20 Oct' } }, festivalAt: Date.now() + 10 * 864e5 };
  const r = createResearch({ ROOT: dir, PUB: dir, anthropic: { beta: { messages: { create: async () => { throw new Error('AI is down'); } } } }, claudeParams: (m, max) => ({ messages: m, max_tokens: max }), textOf: () => '',
    geminiImage: async () => { throw new Error('no images in tests'); }, gToken: async () => { throw new Error('no gcs in tests'); }, clean: (s) => String(s || ''), brand, tregClient, log: { log() {}, warn() {}, error() {} } });
  return { r, calls };
}

test('with the AI down, trends, news and how-to still make stories', async () => {
  const { r } = make();
  const done = await r.refresh(['trends', 'news', 'howto']);
  assert.deepEqual(done, ['trends', 'news', 'howto']);
  const s = r.get();
  assert.ok(s.trends.items.length >= 2, 'trend stories from the numbers');
  assert.ok(s.trends.items.every((x) => x.by === 'data'));
  assert.ok(s.trends.items.some((x) => /hair serum.*up 70%/.test(x.h)), 'the real mover, with its number');
  assert.ok(s.news.items.length >= 1 && s.news.items[0].by === 'search', 'news from the free search');
  assert.ok(s.howto.items.length >= 1, 'how-tos from the trend');
});

test('a term searched almost never (0 to 7) is never a story', async () => {
  const { r } = make();
  await r.refresh(['trends']);
  assert.ok(!r.get().trends.items.some((x) => /tiny term/.test(x.h + (x.terms || []).join())));
});

test('how-to lanes come from the brand, not one brand hard-coded', async () => {
  const { r } = make({ lanes: { scalp: {}, growth: {} } });
  await r.refresh(['trends', 'howto']);
  assert.ok(r.get().howto.items.every((x) => ['scalp', 'growth'].includes(x.lane)));
});

test('news story text has no paise', async () => {
  const { r } = make();
  await r.refresh(['news']);
  assert.ok(!/\.00/.test(r.get().news.items.map((x) => x.p).join(' ')));
  assert.equal(noPaise('now ₹1,299.00, was Rs. 1,599.50'), 'now ₹1,299, was Rs. 1,600');
  assert.equal(noPaise('$19.99'), '$19.99');
});

test('near-duplicate how-tos and trends merge into one story that keeps its first-seen time', () => {
  const T = Date.parse('2026-10-14T12:00:00Z');
  const a = pool(null, [{ id: 'ht-1', h: 'How to win hair-fall searches' }], 'howto', T);
  const b = pool({ ...a, fetchedAt: T }, [{ id: 'ht-2', h: 'How to win the hair fall search' }, { id: 'ht-3', h: 'How to test the doctor angle' }], 'howto', T + 3600e3);
  assert.equal(b.items.length, 2);
  assert.equal(b.items.find((x) => x.id === 'ht-2').firstSeen, T);
  const c = pool(null, [{ kind: 'term', terms: ['a', 'b'], h: 'x' }, { kind: 'term', terms: ['b', 'a'], h: 'y' }], 'trends', T);
  assert.equal(c.items.length, 1, 'the same terms in another order are one story');
});

test('the stories route waits for the saved snapshot', async () => {
  const { r } = make();
  assert.equal(r.ready(), null, 'nothing to wait for before start');
});

test('near-duplicates merge on what they are about, not on shared verbs', async () => {
  const { near } = await import('../research.js');
  const n = (a, b) => near({ h: a }, { h: b });
  assert.equal(n('Launch festive gifting ads for Diwali', 'How to build a Diwali gift combo ad'), true);
  assert.equal(n("How to test Traya's doctor angle", "How to test Traya's founder angle"), false);
  assert.equal(n('Target rising hair thickness searches', "Capture rising men's hair fall searches"), false);
});

test('rival ads already shown give way to ones not shown yet, so the ring does not empty while rivals advertise', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.concat([Buffer.from([0x89, 0x50]), Buffer.alloc(4000)]), { status: 200 });
  try {
    const ads = Array.from({ length: 12 }, (_, i) => ({ ad_archive_id: `a${i}`, page_name: 'Rival One', start_date: Date.now() / 1000 - 30 * 86400, collation_count: 1, snapshot: { title: `Idea ${i}`, body: { text: `Copy for idea ${i}` }, images: [{ original_image_url: `https://img/${i}.png` }] } }));
    const { r } = make();
    const orig = r.refresh;
    // the treg stub answers ads through the same client the research uses
    const tc = { meter: { usd: 0 }, call: async (id) => { if (/adlibrary/.test(id)) return { results: ads, searchResultsCount: 12 }; throw new Error('402'); } };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-ads-'));
    const brand = { slug: 'ads-brand', name: 'Testo', kind: 'generated', seed: {}, config: { country: 'IN', countryName: 'India', category: 'hair', rivals: ['Rival One'] } };
    const R = createResearch({ ROOT: dir, PUB: dir, anthropic: { beta: { messages: { create: async () => { throw new Error('AI is down'); } } } }, claudeParams: (m) => ({ messages: m }), textOf: () => '', geminiImage: async () => {}, gToken: async () => { throw new Error('no gcs'); }, clean: (s) => String(s || ''), brand, tregClient: tc, log: { log() {}, warn() {}, error() {} } });
    await R.refresh(['ads']);
    const day1 = R.get().ads.items.map((x) => x.id);
    assert.equal(day1.length, 4, 'up to 4 new ads a read');
    // a day and a half later: the same ads come back; the ones shown yesterday must not be the ring again
    const s = R.get().ads; s.items.forEach((x) => (x.firstSeen -= 36 * 3600e3)); Object.keys(s.firstSeenOf).forEach((k) => (s.firstSeenOf[k] -= 36 * 3600e3));
    await R.refresh(['ads']);
    const fresh = R.get().ads.items.filter((x) => Date.now() - x.firstSeen < 24 * 3600e3).map((x) => x.id);
    assert.equal(fresh.length, 4);
    assert.ok(fresh.every((id) => !day1.includes(id)), `new ads shown on day 2: ${fresh} vs ${day1}`);
    void orig;
  } finally { globalThis.fetch = realFetch; }
});

test('a ring with nothing fresh reads its source again, at most once every 2 hours', async () => {
  const { r } = make();
  assert.equal(r.need('trends'), true, 'reads again now');
  assert.equal(r.need('trends'), false, 'not again while it runs or within 2 hours');
  assert.equal(r.need('nope'), false);
});

test('a story may only quote numbers that are in its data; a bare rise reads as a percent', async () => {
  const { honest, pct } = await import('../research.js');
  assert.equal(honest(['Thickness searches up 190%'], 'change 110%'), false);
  assert.equal(honest(['Up 110%: make a 9:16 static and run it for 14 days'], 'change 110%'), true);
  assert.equal(honest(['Serum at ₹1,299 has 474 reviews'], 'price ₹1299, 474 reviews'), true);
  assert.equal(pct('bare anatomy up 70'), 'bare anatomy up 70%');
  assert.equal(pct('up 70%'), 'up 70%');
  assert.equal(pct('up 3 days in a row'), 'up 3 days in a row');
});

test('AI trend stories that fail the numbers check are topped up from the data, and breakout values are never quoted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-topup-'));
  let prompt = '';
  const reply = JSON.stringify({ items: [{ kind: 'term', terms: ['hair serum'], h: 'Hair serum searches up 190%', p: 'Made up.', card: 'x' }, { kind: 'term', terms: ['hair serum'], h: 'Hair serum up 70%', p: 'Searches rose 70% in 30 days.', card: 'Hair serum up 70%' }] });
  const anthropic = { beta: { messages: { create: async (p) => { prompt = JSON.stringify(p); return { stop_reason: 'end_turn', content: [{ type: 'text', text: reply }], usage: {} }; } } } };
  const tc = { meter: { usd: 0 }, call: async (id, { body }) => { if (/trends-explore/.test(id)) { if (body[0].item_types) return { tasks: [{ result: [{ items: [{ type: 'google_trends_queries_list', data: { rising: [{ query: 'asics', value: 841400 }] } }] }] }] }; return trendsReply(body); } throw new Error('402'); } };
  const brand = { slug: 'tb', name: 'Testo', kind: 'generated', seed: {}, config: { country: 'IN', countryName: 'India', category: 'hair', rivals: [], terms: [['hair serum'], ['flat term']], rising: ['shoes'], festival: { name: 'Diwali', label: '8 Nov' } }, festivalAt: Date.now() + 20 * 864e5 };
  const R = createResearch({ ROOT: dir, PUB: dir, anthropic, claudeParams: (m) => ({ messages: m }), textOf: (m) => m.content[0].text, geminiImage: async () => {}, gToken: async () => { throw new Error('no gcs'); }, clean: (s) => String(s || ''), brand, tregClient: tc, log: { log() {}, warn() {}, error() {} } });
  await R.refresh(['trends']);
  const hs = R.get().trends.items.map((x) => x.h);
  assert.ok(!hs.some((h) => /190/.test(h)), 'the made-up number is dropped');
  assert.ok(hs.some((h) => /70%/.test(h)), 'the honest one stays');
  assert.ok(hs.length >= 3, `topped up to 3: ${hs}`);
  assert.ok(!/841400/.test(prompt) && /breakout/.test(prompt), 'a breakout is a label in the prompt, not a number');
});

test('rival ads: loose page names, round-robin over rivals, deeper pages when the unseen run low', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.concat([Buffer.from([0x89, 0x50]), Buffer.alloc(4000)]), { status: 200 });
  try {
    const ad = (page, i) => ({ ad_archive_id: `${page}-${i}`, page_name: page, start_date: Date.now() / 1000 - 40 * 86400, collation_count: 1, snapshot: { title: `${page} idea ${i}`, body: { text: `copy ${i}` }, images: [{ original_image_url: `https://img/${page}/${i}.png` }] } });
    const calls = [];
    const tc = { meter: { usd: 0 }, call: async (id, { query }) => { calls.push(query); if (!/adlibrary/.test(id)) throw new Error('402');
      if (/Sheth/.test(query.companyName)) return query.cursor ? { results: [5, 6, 7].map((i) => ad("Dr. Sheth's", i)) } : { results: [0, 1].map((i) => ad("Dr. Sheth's", i)), cursor: 'next', searchResultsCount: 8 };
      return { results: Array.from({ length: 10 }, (_, i) => ad('Traya Health', i)), searchResultsCount: 300 }; } };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-rr-'));
    const brand = { slug: 'rr', name: 'Testo', kind: 'generated', seed: {}, config: { country: 'IN', countryName: 'India', category: 'hair', rivals: ["Dr Sheth's", 'Traya'] } };
    const R = createResearch({ ROOT: dir, PUB: dir, anthropic: { beta: { messages: { create: async () => { throw new Error('AI is down'); } } } }, claudeParams: (m) => ({ messages: m }), textOf: () => '', geminiImage: async () => {}, gToken: async () => { throw new Error('no gcs'); }, clean: (s) => String(s || ''), brand, tregClient: tc, log: { log() {}, warn() {}, error() {} } });
    await R.refresh(['ads']);
    const a = R.get().ads;
    assert.deepEqual(a.brands.map((b) => b.name).sort(), ["Dr Sheth's", 'Traya'], 'both rivals read, though their pages spell the names differently');
    assert.equal(a.items.length, 4);
    assert.deepEqual([...new Set(a.items.map((x) => x.brand))].sort(), ["Dr Sheth's", 'Traya'], 'the read features both rivals');
    assert.ok(calls.some((q) => q.cursor === 'next'), "Dr Sheth's had too few unseen ads, so its next page was read");
    assert.ok(calls.some((q) => q.sort_by === 'relevancy_monthly_grouped'), 'newest launches are read too');
    await R.refresh(['ads']);
    const ids = R.get().ads.items.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 8, 'the next read adds 4 ads never shown, and keeps the first 4 for their 24 hours');
  } finally { globalThis.fetch = realFetch; }
});

test("a rival whose page has another name is found through the brand read's page, then read by its id", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.concat([Buffer.from([0x89, 0x50]), Buffer.alloc(4000)]), { status: 200 });
  try {
    const ad = (i) => ({ ad_archive_id: `m-${i}`, page_id: 'p1', page_name: 'Minimalistinc', start_date: Date.now() / 1000 - 9 * 86400, snapshot: { title: `Minimalist idea ${i}`, body: { text: `copy ${i}` }, images: [{ original_image_url: `https://img/m/${i}.png` }] } });
    const calls = [];
    const tc = { meter: { usd: 0 }, call: async (id, { query }) => { calls.push(query); if (!/adlibrary/.test(id)) throw new Error('402');
      if (query.pageId === 'p1') return { results: [0, 1, 2, 3, 4].map(ad), searchResultsCount: 188 };
      if (query.companyName === 'Minimalistinc') return { results: [ad(0)] };
      return { results: [], searchResultsCount: 0 }; } };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-page-'));
    const brand = { slug: 'pg', name: 'Testo', kind: 'generated', seed: {}, rivalPages: { Minimalist: { page: 'Minimalistinc', host: 'beminimalist.co' } }, config: { country: 'IN', countryName: 'India', category: 'skin', rivals: ['Minimalist'] } };
    const R = createResearch({ ROOT: dir, PUB: dir, anthropic: { beta: { messages: { create: async () => { throw new Error('AI is down'); } } } }, claudeParams: (m) => ({ messages: m }), textOf: () => '', geminiImage: async () => {}, gToken: async () => { throw new Error('no gcs'); }, clean: (s) => String(s || ''), brand, tregClient: tc, log: { log() {}, warn() {}, error() {} } });
    await R.refresh(['ads']);
    const a = R.get().ads;
    assert.equal(a.brands[0]?.live, 188, 'the page is read by its id, with its own full count');
    assert.equal(a.items.length, 4);
    assert.equal(a.pageIds.Minimalist, 'p1', 'the id is kept for the next read');
  } finally { globalThis.fetch = realFetch; }
});
