// node --test test/  — listening beyond the brand, for any brand: communities (gated and found), rival and category cards,
// and what moves this week (trends, news, rival ads, market pulse) in the ideas writer's evidence. Free: no AI, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { usableCommunity, topicStems, typeaheadCommunities, visitors, dealsBoard } from '../community-gate.js';
import { rivalCards, categoryCards, heardCards, ideaUsable } from '../social-feed.js';
import { createPacks } from '../brand-pack.js';
import { createIdeas } from '../ideas.js';

const DAY = 864e5, NOW = Date.parse('2026-10-20T12:00:00Z');
const IN = { country: 'IN', markets: ['IN'] }, US = { country: 'US', markets: ['US'] };
const quiet = { warn() {}, info() {}, log() {} };

test('communities: about the category, in the market, not deals, swaps, replicas, general chat or a city’s own sub', () => {
  const st = topicStems({ noun: 'sneakers', terms: ['indian sneaker brands', 'handcrafted sneakers india'] });
  assert.ok(st.includes('sneaker')); assert.ok(!st.includes('india') && !st.includes('brand'));
  const ok = (name, o = {}, prof = IN) => usableCommunity({ name: `r/${name}`, weekly: 50000, ...o }, { profile: prof, stems: st }).ok;
  assert.ok(ok('SneakersIndia')); assert.ok(ok('Sneakers'));
  for (const n of ['SneakersOfferIndia', 'DesiFashionExchange', 'RepsneakersDogs', 'AwesomeReps', 'kolkata', 'bulgaria', 'AmItheAsshole', 'TwentiesIndia']) assert.equal(ok(n), false, n);
  assert.equal(ok('SneakersIndia', {}, US), false, 'another country’s community');
  assert.equal(ok('Sneakers', { weekly: 300 }), false, 'too small');
  assert.ok(ok('malefashionadvice', { brand: 3, rival: 2, threads: 4 }), 'not named for it, but it talks about the brand');
  assert.equal(ok('malefashionadvice', { brand: 0, rival: 1, threads: 1 }), false);
  assert.ok(usableCommunity({ name: 'r/whatever', weekly: 5000 }, { profile: IN }).ok, 'a saved idea at load: the topic is not checked');
  assert.ok(dealsBoard('SneakersOfferIndia') && dealsBoard('r/BuySellIndia') && !dealsBoard('IndianHaircare'));
});

test('Reddit’s search box: communities and their weekly visitors, read from the real answer shape', () => {
  const j = { data: { search: { dynamic: { components: { main: [{ __typename: 'SearchTypeaheadList', children: [{ __typename: 'QueryAutocomplete', behaviors: { default: { query: 'x' } } }] },
    { __typename: 'SearchTypeaheadList', children: [{ __typename: 'TypeaheadSuggestion', behaviors: { default: { __typename: 'SearchCommunityNavigationBehavior', name: 'SneakersIndia', telemetry: { trackingContext: { subreddit: { isNsfw: false } } } } }, presentation: { description: '121K weekly visitors', name: 'r/SneakersIndia' } },
      { __typename: 'TypeaheadSuggestion', behaviors: { default: { __typename: 'SearchCommunityNavigationBehavior', name: 'SneakerIndia' } }, presentation: { description: '23 weekly visitors' } }] }] } } } } };
  assert.deepEqual(typeaheadCommunities(j).map((x) => [x.name, x.weekly]), [['r/SneakersIndia', 121000], ['r/SneakerIndia', 23]]);
  assert.equal(visitors('1.2M weekly visitors'), 1200000); assert.equal(visitors('nothing'), null);
});

const item = (o) => ({ id: Math.random().toString(36).slice(2), platform: 'reddit', kind: 'comment', postedAt: NOW - 5 * DAY, link: `https://www.reddit.com/r/x/comments/${o.thread || 't'}/y/`, sub: 'r/Sneakers', ...o });
const comet = (n, neg, themes, thread) => Array.from({ length: n }, (_, i) => item({ about: 'rival', text: `My Comet sneakers ${i < neg ? 'fell apart, the sole came off after a month of daily wear' : 'look fine for the price, comfortable enough'}`, sentiment: i < neg ? 'neg' : 'pos', themes: i < neg ? themes : ['style'], thread: `${thread}${i % 4}` }));

test('rival cards: only real complaints (most of a theme negative, several conversations), quotes in the market’s language', () => {
  const L = { config: { rivals: ['Comet', 'CHNKS'], noun: 'sneakers' }, items: [...comet(12, 6, ['sole durability'], 'a'), ...comet(10, 1, ['product review'], 'b').map((x) => ({ ...x, text: x.text.replace('Comet', 'CHNKS') }))] };
  const cs = rivalCards(L, { now: NOW, name: 'Acme', profile: IN });
  assert.equal(cs.length, 1, 'CHNKS: one negative of ten is no complaint');
  assert.equal(cs[0].title, 'What people dislike about Comet: sole durability'); assert.equal(cs[0].heard.kind, 'rival'); assert.equal(cs[0].heard.neg, 6);
  assert.ok(cs[0].heard.quotes.length && cs[0].heard.quotes.every((q) => /fell apart/.test(q.text) && /^https:/.test(q.url)));
  assert.match(cs[0].detail.how.join(' '), /never knock Comet/);
  const topicOnly = { config: { rivals: ['Comet'] }, items: comet(12, 6, ['product review'], 'c') };
  assert.deepEqual(rivalCards(topicOnly, { now: NOW, profile: IN }), [], '"product review" is a topic, not a complaint');
  const oneThread = { config: { rivals: ['Comet'] }, items: comet(12, 6, ['sole durability'], 'd').map((x) => ({ ...x, thread: 'same', link: 'https://www.reddit.com/r/x/comments/same/y/' })) };
  assert.deepEqual(rivalCards(oneThread, { now: NOW, profile: IN }), [], 'one angry thread is not a pattern');
  const old = { config: { rivals: ['Comet'] }, items: comet(12, 6, ['sole durability'], 'e').map((x) => ({ ...x, postedAt: NOW - 200 * DAY })) };
  assert.deepEqual(rivalCards(old, { now: NOW, profile: IN }), [], 'last 90 days only');
  const german = { config: { rivals: ['Comet'] }, items: comet(12, 6, ['sole durability'], 'f').map((x, i) => i < 6 ? { ...x, text: 'Comet Bestellung kann nicht zugeordnet werden, ich habe am achten bestellt und warte immer noch auf die Lieferung der Schuhe' } : x) };
  assert.ok(rivalCards(german, { now: NOW, profile: US }).every((c) => c.heard.quotes.every((q) => !/Bestellung/.test(q.text))), 'no German quotes for a US brand');
});

test('category cards: what buyers keep asking, in their own words, across several conversations; no meta themes', () => {
  const q = (i, o = {}) => item({ about: 'category', intent: 'question', themes: ['sizing'], text: `What sizing should I pick for these sneakers, I am a 9 in most brands? (${i})`, thread: `s${i}`, ...o });
  const L = { config: { noun: 'sneakers' }, items: [...Array.from({ length: 6 }, (_, i) => q(i)), ...Array.from({ length: 6 }, (_, i) => q(i, { themes: ['product review'], text: `Review of the new pair, thoughts? (${i})` }))] };
  const cs = categoryCards(L, { now: NOW, name: 'Acme', profile: IN, max: 2 });
  assert.equal(cs.length, 1); assert.match(cs[0].title, /Buyers keep asking about sizing: 6 posts, none of them about Acme yet/); assert.equal(cs[0].cta.label, 'Answer it in a post');
  assert.deepEqual(categoryCards({ ...L, items: L.items.map((x) => ({ ...x, thread: 'one', link: 'https://www.reddit.com/r/x/comments/one/y/' })) }, { now: NOW, profile: IN }), [], 'one conversation');
  assert.deepEqual(categoryCards(L, { now: NOW, profile: IN, skip: new Set(['sizing']) }), [], 'a theme a brand card already shows');
});

test('heard cards carry the rival and category cards next to the brand ones, for a brand nobody names yet', () => {
  const L = { config: { rivals: ['Comet'], noun: 'sneakers' }, threads: [], themes: [{ name: 'style', n: 10, pos: 8, neg: 1, neutral: 1, brand: 0 }],
    items: [...comet(12, 6, ['sole durability'], 'g'), ...Array.from({ length: 6 }, (_, i) => item({ about: 'category', intent: 'question', themes: ['sizing'], text: `What sizing should I pick for these sneakers, I am a 9? (${i})`, thread: `h${i}` }))] };
  const kinds = heardCards(L, {}, { now: NOW, profile: IN, name: 'Acme' }).map((c) => c.heard.kind);
  assert.deepEqual(kinds, ['rival', 'category'], 'no brand theme (nobody names Acme), but rival and category cards');
});

test('saved Reddit post ideas: a community outside the market or a general-chat one heals away at load', () => {
  const post = (name) => ({ id: 'p', platform: 'reddit', format: 'post', title: 't', copy: 'c', where: [{ kind: 'community', name, url: `https://www.reddit.com/${name}/` }] });
  assert.equal(ideaUsable(post('r/Nepal_Skincare'), { now: NOW, profile: IN }), false);
  assert.equal(ideaUsable(post('r/AmItheAsshole'), { now: NOW, profile: IN }), false);
  assert.equal(ideaUsable(post('r/IndianHaircare'), { now: NOW, profile: IN }), true);
});

test('the ideas writer sees what moves this week: trends, rising searches on the category, news, rival ads, the market pulse', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-wider-')), P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet }), slug = 'acme-com';
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.com', country: 'IN', markets: ['IN'], category: 'Footwear', subcategory: 'Sneakers' });
  await P.put(slug, 'config.json', { currency: 'INR', rivals: ['Comet'] }); await P.put(slug, 'seed.json', { brand: { name: 'Acme' }, posts: [] });
  await P.put(slug, 'listen/config.json', { rivals: ['Comet'], noun: 'sneakers', terms: { category: ['indian sneaker brands'] } });
  await P.put(slug, 'research.json', { trends: { fetchedAt: NOW, items: [{ kind: 'calendar', h: 'Diwali is 20 days away', p: 'Festive gifting peaks now.' }], rising: { 'indian sneaker brands': [{ q: 'indian shoe brands', v: 157 }, { q: 'natural glp 1', v: 366950 }] } },
    news: { items: [{ h: 'Comet opens a store in Delhi', p: 'Its first offline store.', url: 'https://news.example/comet', source: 'ET', date: '2026-10-18' }] },
    ads: { items: [{ brand: 'Comet', headline: 'Exclusive prices till 8PM', body: 'Hurry', days: '120', versions: 4, url: 'https://www.facebook.com/ads/library/?id=1' }, { brand: 'Acme', headline: 'Our own ad', days: '200' }] } });
  await P.put(slug, 'pulse/latest.json', { lines: [{ family: 'seasonal', label: 'Google interest in "indian sneaker brands", last 4 weeks vs the 4 before', value: -20, unit: '%', source: 'Google Trends', url: 'https://trends.google.com/x', at: '2026-10-19' },
    { family: 'research', label: 'TikTok Shop best sellers in your category', value: 0, unit: 'products', source: 'TikTok Shop', at: '2026-10-19' }, { family: 'ads', label: 'Comet: ads in Google', value: 87, at: '2026-10-19' }] });
  await P.put(slug, 'listen/items.json', { items: [...comet(12, 6, ['sole durability'], 'k')] });
  const c = await createIdeas({ slug, packs: P, ai: null, treg: null, log: quiet, now: () => NOW }).load();
  const by = (k) => c.ev.filter((e) => e.kind === k);
  assert.match(by('trend').map((e) => e.value).join(), /Diwali is 20 days away/);
  const rising = by('trend').find((e) => /Rising Google searches/.test(e.label)); assert.match(rising.value, /indian shoe brands/); assert.doesNotMatch(rising.value, /glp/, 'off-category rising queries are noise');
  assert.equal(by('news')[0].source, 'https://news.example/comet');
  assert.deepEqual(by('rival-ad').map((e) => e.label), ['Rival ad: Comet, live 120 days, 4 versions (Meta Ad Library)'], 'the brand’s own ad is not a rival ad');
  assert.deepEqual(by('pulse').map((e) => e.value), ['-20 %'], 'zero counts and ad tallies left out');
  assert.ok(c.ev.some((e) => e.kind === 'listen' && /what people dislike about Comet/.test(e.label)));
  assert.ok(c.allowNums.has('120') && c.allowNums.has('20'), 'their numbers may be quoted');
  fs.rmSync(ROOT, { recursive: true, force: true });
});
