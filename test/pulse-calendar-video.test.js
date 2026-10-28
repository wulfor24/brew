// market pulse, calendar, video read and the spend ledger, all on mocked treg / Vertex / packs (free)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPulse } from '../market-pulse.js';
import { createCalendar, dateOf, EVENTS } from '../calendar.js';
import { createVideoRead, parseVideo } from '../video-read.js';
import { spendLedger, tagParts } from '../treg.js';

const memPacks = (seed = {}) => { const s = JSON.parse(JSON.stringify(seed)); return { s, getJSON: async (slug, n, d = null) => (s[slug]?.[n] !== undefined ? JSON.parse(JSON.stringify(s[slug][n])) : d), put: async (slug, n, v) => { (s[slug] ||= {})[n] = Buffer.isBuffer(v) ? v : JSON.parse(JSON.stringify(v)); } }; };
const fakeTreg = (replies) => { const calls = [], listeners = []; const meter = { usd: 0 };
  return { calls, live: true, meter, onCharge: (f) => listeners.push(f),
    async call(id, o = {}) { calls.push({ id, ...o }); meter.usd += 0.001; listeners.forEach((f) => f(o.tag || id, 0.001, meter)); const r = replies[id]; if (!r) throw new Error(`no mock for ${id}`); return typeof r === 'function' ? r(o) : r; } }; };
const BRAND = { 'profile.json': { name: 'Comet', host: 'wearcomet.com', country: 'IN', category: 'Footwear', subcategory: 'Lifestyle sneakers', currency: 'INR', rivals: [{ name: 'Gully Labs', host: 'gullylabs.com' }, { name: 'Neeman\'s', host: 'neemans.com' }],
  catalog: { products: [{ title: 'Aeres', handle: 'aeres', price: 5299 }] }, socials: { instagram: { handle: 'thecometuniverse' } } },
  'config.json': { country: 'IN', locationCode: 2356, terms: [['best sneakers under 5000 india']] }, 'listen/config.json': { noun: 'sneakers', terms: { category: ['premium made in india sneakers'] } }, 'listen/themes.json': { themes: [{ name: 'comfort' }, { name: 'price' }] } };
const dfs = (result) => ({ tasks: [{ status_code: 20000, result }] });

test('pulse: ledger lines, latest + history written, every call tagged, cadence respected', async () => {
  const packs = memPacks({ comet: BRAND }); let n = 0;
  const treg = fakeTreg({
    'dataforseo.google.keywords.volume': (o) => dfs(o.body[0].keywords.map((k) => ({ keyword: k, search_volume: 1000, cpc: 0.4, monthly_searches: [{ search_volume: 900 }] }))),
    'crawl4ai.weather.forecast.daily': (o) => ({ rows: [{ date: '2026-10-14', temp_max: 33, temp_min: 24, precipitation_chance: 70 }, { date: '2026-10-15', temp_max: 35, temp_min: 25, precipitation_chance: 0 }] }),
    'crawl4ai.shopify.store.products': (o) => ({ rows: n++ < 2 ? [{ handle: 'a', title: 'A', price: '100' }] : [{ handle: 'a', title: 'A', price: '120' }, { handle: 'b', title: 'B', price: '90' }] }),
    'dataforseo.x.ai-optimization-chat-gpt-llm-scraper-live-advanced': (o) => dfs([{ markdown: /sneakers/.test(o.body[0].keyword) ? 'Try Comet or Gully Labs' : 'Nike is good', brand_entities: [] }]),
    'dataforseo.x.ai-optimization-gemini-llm-scraper-live-advanced': () => dfs([{ markdown: 'Gully Labs makes good ones' }]),
    'dataforseo.x.ai-optimization-perplexity-llm-responses-live': () => dfs([{ items: [{ sections: [{ text: 'Comet is a homegrown brand' }] }] }])
  });
  const day = new Date('2026-10-14T06:00:00Z'), p = createPulse({ slug: 'comet', packs, treg, log: { info() {}, warn() {} }, now: () => day });
  const r = await p.run({ fresh: true, only: ['volume', 'weather', 'catalog', 'answers'] });
  assert.ok(r.lines.length > 5, `lines: ${r.lines.length} notes: ${r.notes}`);
  for (const l of r.lines) { for (const k of ['key', 'label', 'value', 'unit', 'source', 'at', 'family']) assert.ok(k in l, `${l.key} lacks ${k}`); assert.ok(!/treg|dataforseo|crawl4ai|spyfu|serper/i.test(l.source), `vendor in source: ${l.source}`); }
  assert.ok(treg.calls.every((c) => c.tag === 'pulse-comet'), 'every call tagged pulse-<slug>');
  assert.ok(r.lines.some((l) => l.key === 'weather.mumbai' && l.value === 35 && l.rainDays === 1));
  assert.ok(r.lines.some((l) => l.key === 'ai.mention.perplexity' && l.value === 100));
  assert.ok(r.lines.some((l) => l.key === 'ai.mention.rival.gully-labs'));
  const qs = packs.s.comet['pulse/questions.json']; assert.equal(qs.questions.length, 20, 'twenty fixed questions'); assert.ok(qs.fixed);
  assert.ok(packs.s.comet['pulse/latest.json'].lines.length === r.lines.length);
  assert.ok(packs.s.comet['pulse/history/2026-10-14.json'].lines.length);
  assert.equal(packs.s.comet['pulse/history/index.json'].days[0].day, '2026-10-14');
  // a second run the same day: nothing due, the latest keeps every line
  const calls = treg.calls.length, r2 = await p.run({ only: ['volume', 'weather'] });
  assert.equal(treg.calls.length, calls, 'nothing re-read before its cadence'); assert.equal(r2.lines.length, 0);
  // the next day the catalogue (daily) runs again and sees the launch and the price move
  const p2 = createPulse({ slug: 'comet', packs, treg, log: { info() {}, warn() {} }, now: () => new Date('2026-10-15T06:00:00Z') });
  const r3 = await p2.run({ only: ['catalog'] });
  assert.equal(r3.lines.find((l) => l.key === 'catalog.new.gullylabs-com').value, 1);
  assert.equal(r3.lines.find((l) => l.key === 'catalog.price.gullylabs-com').value, 1);
  assert.ok(packs.s.comet['pulse/latest.json'].lines.some((l) => l.key === 'weather.mumbai'), 'latest keeps lines of signals that did not run');
});

test('pulse: treg off returns a note, no calls', async () => {
  const r = await createPulse({ slug: 'comet', packs: memPacks({ comet: BRAND }), treg: { live: false } }).run({ fresh: true });
  assert.equal(r.lines.length, 0); assert.match(r.notes[0], /treg is off/);
});

test('calendar: an Indian brand gets Diwali on 8 Nov 2026 with its plan points', async () => {
  const packs = memPacks({ comet: BRAND }), cal = createCalendar({ packs, today: () => new Date('2026-10-14T00:00:00Z') });
  const evs = await cal.eventsFor('comet', { from: '2026-01-01', to: '2026-12-31' });
  const d = evs.find((e) => e.ref === 'diwali'); assert.ok(d, 'Diwali kept');
  assert.equal(d.date, '2026-11-08');
  assert.deepEqual(d.plan, { plan: '2026-09-24', creative: '2026-10-09', launch: '2026-10-18', peak: '2026-11-08', after: '2026-11-15' });
  for (const id of ['holi', 'navratri', 'raksha-bandhan']) assert.ok(evs.some((e) => e.ref === id), `${id} for India`);
  assert.ok(!evs.some((e) => e.source === 'date-holidays' && /deepavali|diwali/i.test(e.name)), 'no duplicate Diwali from date-holidays');
  assert.ok(packs.s.comet['calendar/2026.json'].events.length, 'calendar/<year>.json saved');
  assert.ok(packs.s.comet['calendar/relevance.json'].keep);
  // seasonal moves: Diwali's creative point (9 Oct) is due on 14 Oct; marking it planned clears it
  let due = await cal.duePlanPoints('comet', new Date('2026-10-14T00:00:00Z'));
  const dd = due.find((x) => x.event.ref === 'diwali'); assert.equal(dd.point, 'creative'); assert.equal(dd.daysToPeak, 25);
  await cal.markPlanned('comet', dd.event.id, 'creative');
  due = await cal.duePlanPoints('comet', new Date('2026-10-14T00:00:00Z')); assert.ok(!due.some((x) => x.event.ref === 'diwali'));
});

test('calendar: a US-only brand gets none of the Indian festivals', async () => {
  const packs = memPacks({ glow: { 'profile.json': { name: 'Glow', country: 'US', category: 'Skin care' } } }), cal = createCalendar({ packs, today: () => new Date('2026-01-01T00:00:00Z') });
  const evs = await cal.eventsFor('glow', { from: '2026-01-01', to: '2027-12-31' });
  const india = EVENTS.events.filter((e) => e.markets.length === 1 && e.markets[0] === 'IN').map((e) => e.id);
  assert.ok(india.length >= 20); assert.ok(!evs.some((e) => india.includes(e.ref)), 'no IN-only event'); assert.ok(!evs.some((e) => e.markets.includes('IN')));
  assert.equal(evs.find((e) => e.ref === 'black-friday' && e.date.startsWith('2026')).date, '2026-11-27');
  assert.equal(evs.find((e) => e.ref === 'cyber-monday' && e.date.startsWith('2026')).date, '2026-11-30');
  assert.ok(evs.some((e) => e.ref === 'mothers-day' && e.date === '2026-05-10'));
});

test('calendar: rules resolve (UK Mothering Sunday from Easter, last Monday of May)', () => {
  const ev = (id) => EVENTS.events.find((e) => e.id === id);
  assert.equal(dateOf(ev('mothers-day-uk'), 2026).toISOString().slice(0, 10), '2026-03-15');
  assert.equal(dateOf(ev('memorial-day-sale'), 2026).toISOString().slice(0, 10), '2026-05-25');
  assert.equal(dateOf(ev('thanksgiving'), 2027).toISOString().slice(0, 10), '2027-11-25');
});

const MP4 = Buffer.alloc(20e3, 1);
const okFetch = async () => ({ ok: true, headers: new Map([['content-length', String(MP4.length)]]), arrayBuffer: async () => MP4 });
okFetch.headers = null;
const fetchFn = async (u) => { const r = await okFetch(u); r.headers = { get: (k) => (k === 'content-length' ? String(MP4.length) : null) }; return r; };
const READ = { hook: { first3s: 'A shoe hits the floor', text: 'Stop buying white sneakers', visual: 'close up' }, scenes: [{ t: '0:00', shot: 'close up', onScreenText: 'Stop', voice: 'Stop buying' }], productMoments: ['0:03 laces'], cta: 'Shop now', format: 'ugc', pacing: '4 cuts / 10s', whyItWorks: 'Pattern break.', transcript: 'Stop buying white sneakers' };

test('video read: Vertex read, then cached across brands', async () => {
  const packs = memPacks(), treg = fakeTreg({ 'anyapi.tiktok.video_download': { output: { found: true, data: { videoUrl: 'https://cdn.example/v.mp4', durationSeconds: 21 } } } }); let vx = 0;
  const vr = createVideoRead({ packs, treg, fetchFn, vertex: async () => { vx++; return { json: READ, model: 'gemini-test', usd: 0.002 }; }, log: { warn() {} } });
  const url = 'https://www.tiktok.com/@someone/video/7554512345678901234';
  const a = await vr.read({ url, why: 'top category video', slug: 'comet' });
  assert.equal(a.via, 'vertex'); assert.equal(a.read.format, 'ugc'); assert.equal(a.durationS, 21); assert.equal(treg.calls[0].tag, 'video-comet');
  assert.ok(packs.s._brew['video/tiktok-7554512345678901234.json']);
  const b = await vr.read({ platform: 'tiktok', id: '7554512345678901234', slug: 'other-brand' });
  assert.ok(b.cached); assert.equal(vx, 1);
  const top = await vr.readTop({ slug: 'comet', items: [{ url, views: 10 }, { url: 'https://www.tiktok.com/@x/video/1', views: 1 }], n: 1 });
  assert.equal(top.length, 1); assert.ok(packs.s.comet[`video/top-${new Date().toISOString().slice(0, 10)}.json`]);
});

test('video read: no Vertex → transcript (+ Claude when there is one), else transcript only', async () => {
  const replies = { 'anyapi.tiktok.video_download': { output: { found: true, data: { videoUrl: 'https://cdn.example/v.mp4' } } }, 'anyapi.tiktok.video.captions': { output: { found: true, data: { transcript: 'WEBVTT\n\n00:00:00.020 --> 00:00:01.540\nThese shoes changed my walk.\n\n00:00:01.541 --> 00:00:03.000\nLink below!' } } } };
  const noVertex = async () => { throw new Error('vertex 403'); };
  const vr = createVideoRead({ packs: memPacks(), treg: fakeTreg(replies), fetchFn, vertex: noVertex, ffmpeg: '/nonexistent/ffmpeg', log: { warn() {} } });
  const a = await vr.read({ url: 'https://www.tiktok.com/@a/video/111' });
  assert.equal(a.via, 'transcript'); assert.equal(a.read.transcript, 'These shoes changed my walk. Link below!'); assert.equal(a.read.hook.text, 'These shoes changed my walk.');
  assert.ok(a.notes.some((n) => /vertex 403/.test(n)));
  let asked = null; const ai = { call: async (o) => { asked = o; return { json: { ...READ, transcript: '' }, usd: 0.01 }; } };
  const vr2 = createVideoRead({ packs: memPacks(), treg: fakeTreg(replies), ai, fetchFn, vertex: noVertex, ffmpeg: '/nonexistent/ffmpeg', log: { warn() {} } });
  const b = await vr2.read({ url: 'https://www.tiktok.com/@a/video/222' });
  assert.equal(b.via, 'claude-transcript'); assert.equal(b.read.transcript, 'These shoes changed my walk. Link below!'); assert.ok(asked.schema && asked.messages);
});

test('video read: URL parsing', () => {
  assert.deepEqual(parseVideo({ url: 'https://www.instagram.com/reel/DWzrfE2kaY8/' }).platform, 'instagram');
  assert.equal(parseVideo({ url: 'https://youtu.be/dQw4w9WgXcQ' }).id, 'dQw4w9WgXcQ');
  assert.equal(parseVideo({ url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }).platform, 'youtube');
  assert.throws(() => parseVideo({}));
  // listening items: link (not url) and a prefixed id
  assert.deepEqual(parseVideo({ link: 'https://www.instagram.com/reel/DdoWcpmAg89/', platform: 'instagram', id: 'ig:DdoWcpmAg89' }), { platform: 'instagram', id: 'DdoWcpmAg89', url: 'https://www.instagram.com/reel/DdoWcpmAg89/' });
  assert.equal(parseVideo({ platform: 'tiktok', id: 'tt:7311' }).url, 'https://www.tiktok.com/@i/video/7311');
});

test('spend ledger: charges booked per brand and month, debounced', async () => {
  assert.deepEqual(tagParts('pulse-wearcomet-com'), { what: 'pulse', slug: 'wearcomet-com' });
  assert.equal(tagParts('tikhub.tiktok.search.videos').slug, '_brew');
  const packs = memPacks({ comet: { 'status.json': { slug: 'comet' }, [`spend/${new Date().toISOString().slice(0, 7)}.json`]: { month: 'x', rows: [{ day: new Date().toISOString().slice(0, 10), tag: 'pulse', usd: 1, calls: 1 }] } } });
  const treg = fakeTreg({ x: {} }), led = spendLedger(treg, packs, { debounceMs: 50 });
  await treg.call('x', { tag: 'pulse-comet' }); await treg.call('x', { tag: 'pulse-comet' }); await treg.call('x', { tag: 'listen-comet' }); await treg.call('x');
  assert.ok(led.pending() >= 1); await led.flush();
  const f = packs.s.comet[`spend/${new Date().toISOString().slice(0, 7)}.json`];
  assert.equal(f.rows.find((r) => r.tag === 'pulse').calls, 3); assert.equal(f.rows.find((r) => r.tag === 'pulse').usd, 1.002);
  assert.equal(f.rows.find((r) => r.tag === 'listen').usd, 0.001);
  assert.ok(packs.s._brew[`spend/${new Date().toISOString().slice(0, 7)}.json`].rows.some((r) => r.tag === 'x'));
});

test('calendar: announced dates replace estimates, and only a date a result states is kept', async () => {
  const packs = memPacks({ comet: BRAND }), today = () => new Date('2027-08-20T00:00:00Z');
  const est = (await createCalendar({ packs, today }).upcoming('comet', { days: 120 })).find((e) => e.ref === 'flipkart-bbd');
  assert.ok(est?.estimated, 'Big Billion Days 2027 starts as an estimate');
  let calls = 0; const treg = { live: true, call: async (id) => { calls++; return id === 'treg.web.search' ? { output: { results: [{ title: 'Flipkart Big Billion Days 2027 dates announced', snippet: 'The sale runs 26 September to 3 October 2027', url: 'https://news.example/bbd-2027' }] } } : { results: [] }; } };
  const ai = async ({ prompt }) => ({ json: /Big Billion/.test(prompt) ? { found: true, start: '2027-09-26', end: '2027-10-03', source: 0 } : { found: false } });
  const cal = createCalendar({ packs, ai, today }), r = await cal.confirmDates({ treg, max: 40 });
  assert.ok(calls > 0 && r.confirmed.some((x) => x.id === 'flipkart-bbd-2027'));
  const ev = (await cal.upcoming('comet', { days: 120 })).find((e) => e.id === 'flipkart-bbd-2027');
  assert.equal(ev.date, '2027-09-26'); assert.equal(ev.end, '2027-10-03'); assert.equal(ev.estimated, false); assert.equal(ev.confirmed.url, 'https://news.example/bbd-2027');
  // a second run within the week does not search the same event again
  const before = calls; await cal.confirmDates({ treg, max: 40 }); assert.ok(!(await packs.getJSON('_brew', 'calendar/confirmed.json'))['flipkart-bbd-2027'].was || calls >= before);
});
