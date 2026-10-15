// listening, market pulse, video reads and the calendar reach the move documents as ledger lines; new specs and dynamic
// (seasonal, research) specs write under AI_MOCK with their measuring family's check timings. Free: no AI, no network.
process.env.AI_MOCK = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovesEngine, signalLedger, dynamicSpecs, allowedFromLedger, SPECS, capsOf, CAPS } from '../moves-engine.js';
import { createAI } from '../ai.js';
import { timingLine } from '../measure-families.js';

const DAY = 864e5, NOW = Date.parse('2026-10-14T00:00:00Z');
const items = [
  { id: 'a1', platform: 'reddit', kind: 'comment', sub: 'r/SneakersIndia', author: 'Asha K.', link: 'https://www.reddit.com/r/SneakersIndia/comments/x1/a1/', postedAt: NOW - 2 * DAY, text: 'Do these run small? I am a 9 in Nike and not sure which size to pick', themes: ['sizing'], sentiment: 'neutral', intent: 'question', about: 'brand' },
  { id: 'a2', platform: 'youtube', kind: 'comment', author: 'Ravi', link: 'https://www.youtube.com/watch?v=v1&lc=a2', postedAt: NOW - 4 * DAY, text: 'Ordered my usual size and they were half a size too tight', themes: ['sizing'], sentiment: 'neg', intent: 'complaint', about: 'brand' },
  { id: 'a3', platform: 'reddit', kind: 'post', sub: 'r/IndianFashionAddicts', author: 'Neel', link: 'https://www.reddit.com/r/IndianFashionAddicts/comments/x3/', postedAt: NOW - 9 * DAY, title: 'Which size for wide feet?', text: 'Anyone with wide feet tried them, which size did you go for', themes: ['sizing'], sentiment: 'neutral', intent: 'question', about: 'brand' },
  { id: 'a4', platform: 'reddit', kind: 'comment', sub: 'r/SneakersIndia', author: 'Kabir', link: 'https://www.reddit.com/r/SneakersIndia/comments/x4/a4/', postedAt: NOW - 3 * DAY, text: 'Bought the rival pair and the sole came apart in two months', themes: ['durability'], sentiment: 'neg', intent: 'complaint', about: 'rival' },
  { id: 'a5', platform: 'reddit', kind: 'comment', sub: 'r/SneakersIndia', author: 'Ira', link: 'https://www.reddit.com/r/SneakersIndia/comments/x5/a5/', postedAt: NOW - 1 * DAY, text: 'Which size should I get if I am between 8 and 9 in most brands', themes: ['sizing'], sentiment: 'neutral', intent: 'question', about: 'brand' }];
const themes = { at: NOW, themes: [{ name: 'sizing', n: 37, pos: 4, neg: 11, neutral: 22, brand: 30, wow: { week: 9, lastWeek: 6, change: 0.5 }, quoteIds: ['a1', 'a2', 'a3'], quote: 'Do these run small?', quoteLink: items[0].link },
  { name: 'durability', n: 12, pos: 2, neg: 8, neutral: 2, brand: 3, wow: { week: 1, lastWeek: 2, change: -0.5 }, quoteIds: ['a4'] }] };
const history = [{ date: '2026-09-30', themes: [{ name: 'sizing', n: 21 }] }, { date: '2026-10-07', themes: [{ name: 'sizing', n: 28 }] }, { date: '2026-10-14', themes: [{ name: 'sizing', n: 37 }] }];
const pulse = { at: NOW, lines: [{ key: 'weather.delhi.min', label: 'Delhi lowest forecast, next 7 days', value: 11, unit: '°C', source: 'crawl4ai', url: 'https://example.com/forecast', at: '2026-10-13', family: 'weather' },
  { key: 'shopping.hero.rank', label: 'Hero sneaker price rank on Google Shopping', value: 4, unit: 'of 12', source: 'Google Shopping', url: 'https://example.com/shop', at: '2026-10-13', family: 'price-offer' }] };
const videos = [{ id: 'v9', platform: 'tiktok', url: 'https://www.tiktok.com/@x/video/9', title: 'Sneaker unboxing', owner: 'rival', hook: 'Stop buying white sneakers until you see this', scenes: [{}, {}, {}], duration: 21, views: 480000 }];
const calendar = [{ name: 'Diwali', date: '2026-11-08', countries: ['IN'], plan: [{ what: 'creative ready', at: '2026-10-15' }] }, { name: 'Thanksgiving', date: '2026-11-26', countries: ['US'] }];
const asked = { questions: [{ id: 'q1', question: 'What makes you pick a size online?', where: 'r/SneakersIndia', threshold: 2, theme: 'fit' }] };
const askedItems = [{ id: 'r1', mode: 'asked', askId: 'q1', platform: 'reddit', sub: 'r/SneakersIndia', author: 'Mo', link: 'https://www.reddit.com/r/SneakersIndia/comments/q1/r1/', postedAt: NOW, text: 'A size chart in centimetres, every time' },
  { id: 'r2', mode: 'asked', askId: 'q1', platform: 'reddit', sub: 'r/SneakersIndia', author: 'Lu', link: 'https://www.reddit.com/r/SneakersIndia/comments/q1/r2/', postedAt: NOW, text: 'Reviews from people with the same foot width' }];
const profileIN = { name: 'Comet', host: 'wearcomet.com', country: 'IN', currency: 'INR' }, profileUS = { name: 'Allbirds', host: 'allbirds.com', country: 'US', currency: 'USD' };
const signals = { themes, items: [...items, ...askedItems], history, pulse, videos, calendar, asked, profile: profileIN };

test('the ledger carries listening, trend, pulse, video and calendar lines in ledger shape', () => {
  const L = signalLedger({ ...signals, today: '2026-10-14' }), by = (k) => L.find((e) => e.key === k);
  for (const e of L) assert.ok(e.key && e.v != null && e.label && 'src' in e && e.signal, `ledger shape: ${e.key}`);
  assert.match(by('listen.theme.sizing').v, /37 mentions: 4 positive, 11 negative, 22 neutral.*9 this week vs 6 the week before \(\+50% week on week\)/);
  assert.equal(L.filter((e) => /^listen\.theme\.sizing\.q\d$/.test(e.key)).length, 2, 'two linked quotes per theme');
  assert.equal(by('listen.theme.sizing.q1').url, items[0].link); assert.match(by('listen.theme.sizing.q1').label, /Asha K\. on Reddit r\/SneakersIndia/);
  assert.equal(by('listen.theme.sizing.questions').n, 3);
  assert.match(by('listen.trend.sizing').v, /2026-09-30: 21 · 2026-10-07: 28 · 2026-10-14: 37/);
  assert.equal(by('listen.rival.durability').n, 1); assert.ok(by('listen.rival.durability.q1').url);
  assert.match(by('listen.asked.q1').v, /2 replies, threshold 2 \(met\)/); assert.ok(by('listen.asked.q1.q1'));
  assert.equal(by('pulse.weather.delhi.min').v, '11 °C'); assert.equal(by('pulse.weather.delhi.min').src, 'Brew market pulse', 'vendor names never reach the prompt');
  assert.match(by('video.v9').v, /Hook: "Stop buying white sneakers.*3 scenes · 21s · 480000 views/);
  assert.match(by('cal.diwali.2026').v, /Diwali on 2026-11-08, 25 days away; plan points: creative ready by 2026-10-15/);
  assert.ok(!L.some((e) => e.key.startsWith('cal.thanksgiving')), 'a US event stays out of an Indian brand');
  // verify() backs numbers from these lines
  const ok = allowedFromLedger(L); for (const v of [37, 11, 50, 480000, 25]) assert.ok(ok.has({ v, scaled: null }), `allowed ${v}`);
});

test('specs: every spec names capability ids and a timing; the new specs exist', () => {
  for (const s of SPECS.filter((x) => x.n)) { assert.ok(capsOf(s).length, `move ${s.n} has capability ids`); assert.ok(capsOf(s).every((c) => CAPS.includes(c))); assert.ok(s.timing, `move ${s.n} timing`); }
  const skills = SPECS.filter((s) => s.n > 50).map((s) => s.skill);
  for (const k of ['community-research', 'seasonal-planning', 'social', 'ai-seo', 'influencer-marketing', 'video', 'pricing', 'competitors']) assert.ok(skills.includes(k), k);
  assert.deepEqual(SPECS.map((s) => s.n), SPECS.map((_, i) => i), 'n stays the array index (build.js reads SPECS[n])');
});

test('the prompt sends the signal lines with the ledger, the timing and the real count', () => {
  const eng = createMovesEngine({ ai: createAI({}), log: { warn() {}, error() {} } });
  const L = signalLedger({ ...signals, today: '2026-10-14' });
  const p = eng.buildPrompt(51, { brand: { name: 'Comet' }, brief: { md: 'brief' }, profile: profileIN, ledger: [{ key: 'price.hero', v: '₹2,999', label: 'Hero price' }], signalLines: L, total: 58 });
  assert.match(p, /listen\.theme\.sizing \| 37 mentions/); assert.match(p, /listen\.theme\.sizing\.q1 \| Do these run small.*\| https:\/\/www\.reddit\.com/);
  assert.match(p, /price\.hero \| ₹2,999/); assert.match(p, /Write Move 51 of 58 /); assert.match(p, /Check timings: Checks every week/);
  assert.match(p, /Kicker \(fixed\): ANSWERS FROM LISTENING · MOVE 51\n/); assert.doesNotMatch(p.split("# Depth and format exemplar")[0] + p.split("</exemplar>")[1], /OF 50\b/);
});

test('new specs write under AI_MOCK with "How we measure" carrying the check timings', async () => {
  const eng = createMovesEngine({ ai: createAI({}), log: { warn() {}, error() {}, info() {} } });
  const saved = {}, news = SPECS.filter((s) => s.n > 50).map((s) => s.n);
  const r = await eng.runAll({ brand: { name: 'Comet' }, brief: { md: 'brief' }, profile: profileIN, ledger: [{ key: 'ai.q1', v: 'not named', label: 'AI answer' }, { key: 'search.term', v: '1,200', label: 'searches' }], signals, load: () => null, save: (n, m) => { saved[n] = m; } },
    { only: [...news, 0], verify: false, dynamic: false });
  assert.deepEqual(r.errors, []);
  for (const n of news) { const m = saved[n]; assert.ok(m, `move ${n} written`);
    const meas = m.sections.find((s) => s.kind === 'measure'), txt = meas.blocks.map((b) => b.text).join(' ');
    assert.ok(txt.includes(`Check timings:`) && txt.includes(timingLine(SPECS[n].timing).slice(0, 30)), `move ${n} timings: ${txt.slice(0, 160)}`);
    assert.match(txt, /What to watch:/); assert.match(m.kicker, new RegExp(`MOVE ${n}$`)); assert.doesNotMatch(m.kicker, / OF 50$/); }
  assert.match(saved[53].sections.find((s) => s.kind === 'measure').blocks[1].text, /Checks on day 1 and 3; decides on day 7/);
  assert.match(saved[0].title, /^[A-Z][a-z-]+ moves for Comet$/); assert.doesNotMatch(saved[0].title, /Fifty/);
  assert.equal(saved[0].stat, String(saved[0].meta.total));
});

test('specs wait for their evidence: no listening, no listening moves', async () => {
  const eng = createMovesEngine({ ai: createAI({}), log: { warn() {}, error() {} } });
  const saved = {};
  await eng.runAll({ brand: { name: 'X' }, brief: { md: 'b' }, profile: profileUS, ledger: [], load: () => null, save: (n, m) => { saved[n] = m; } }, { only: [51, 53, 55], verify: false });
  assert.ok(saved[51] && saved[53] && saved[55], 'asked by number, they are written');
  const p = await eng.prepare({ ledger: [], signals: { themes: null, items: [], pulse: null, calendar: [] } });
  assert.equal(SPECS.filter((s) => s.n > 50 && eng.needsMet(s, p)).length, 0);
});

test('dynamic specs: festivals at their plan point, only in the brand\'s markets; research gaps; replies over threshold', async () => {
  const cal = { duePlanPoints: async () => [{ event: { id: 'diwali', name: 'Diwali', date: '2026-11-08', end: '2026-11-12', countries: ['IN'] }, point: 'creative', due: '2026-10-14' },
    { event: { id: 'diwali', name: 'Diwali', date: '2026-11-08', end: '2026-11-12', countries: ['IN'] }, point: 'stock', due: '2026-10-14' }] };
  const IN = await dynamicSpecs({ slug: 'wearcomet-com', profile: profileIN, calendar: cal, signals: { themes: null, items: [], calendar: [] }, today: '2026-10-14' });
  const season = IN.filter((s) => s.skill === 'seasonal-planning');
  assert.equal(season.length, 1, 'one move per event'); assert.equal(season[0].timing, 'seasonal'); assert.match(season[0].adapt, /Diwali.*creative, stock/);
  assert.ok(season[0].n >= 100 && !SPECS.some((s) => s.n === season[0].n));
  const US = await dynamicSpecs({ slug: 'allbirds-com', profile: profileUS, calendar: cal, signals: { themes: null, items: [], calendar: [] }, today: '2026-10-14' });
  assert.equal(US.filter((s) => s.skill === 'seasonal-planning').length, 0, 'a US-only brand gets no Diwali move');
  const R = await dynamicSpecs({ profile: profileIN, signals: { ...signals, due: [] } });
  assert.ok(R.some((s) => s.id === 'research:sizing' && s.skill === 'community-research' && s.timing === 'community'));
  assert.ok(R.some((s) => s.id === 'answers:q1' && /2 replies came back/.test(s.adapt)));
  // a dynamic seasonal move writes under mock with seasonal timing
  const eng = createMovesEngine({ ai: createAI({}), log: { warn() {}, error() {} } }); const saved = {};
  await eng.runAll({ brand: { name: 'Comet' }, brief: { md: 'b' }, profile: profileIN, ledger: [], signals: { themes: null, items: [], calendar: [] }, calendar: cal, slug: 'wearcomet-com', load: () => null, save: (n, m) => { saved[n] = m; } }, { only: [season[0].n], verify: false });
  const m = saved[season[0].n]; assert.ok(m, 'seasonal move written'); assert.equal(m.dynamic, season[0].id);
  assert.match(m.sections.find((s) => s.kind === 'measure').blocks.map((b) => b.text).join(' '), /every day inside the event window; decides 7 days after the event ends/);
});
