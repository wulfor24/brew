// viral gate + finder on fixtures (free): unknown counts stay null, outliers only, fresh, organic, on-topic, platforms take turns
import test from 'node:test';
import assert from 'node:assert/strict';
import { usualViews, scoreOf, scoreText, preViral, usableViral, pickViral, minViewsFor, viralStems } from '../viral-gate.js';
import { createViralFinder, NORMV } from '../viral.js';

const now = Date.parse('2026-10-20T00:00:00Z'), D = 864e5;
const v = (o = {}) => ({ id: 'tt:1', platform: 'tiktok', views: 900e3, postedAt: now - 10 * D, caption: 'my morning coffee routine', handle: '@maker', score: 30, ...o });

test('usual views: median without the video itself, unknown under 3 posts', () => {
  assert.equal(usualViews([10, 20, 30, 900], 900), 20);
  assert.equal(usualViews([10, 20]), null);
  assert.equal(usualViews([10, null, 'x', 30, 50]), 30);
  assert.equal(scoreOf(900, null), null);
  assert.equal(scoreOf(1000, 20), 50);
  assert.equal(scoreText(null), '');
  assert.equal(scoreText(47.3), '47×');
});

test('gate: fresh, organic, short, on-topic, own account, known score', () => {
  const o = { now, country: 'US', stems: ['coffee'], own: ['Maker Co'] };
  assert.ok(usableViral(v(), o).ok);
  assert.deepEqual(usableViral(v({ views: null }), o).why.includes('views unknown'), true);
  assert.ok(usableViral(v({ postedAt: now - 120 * D }), o).why.some((w) => /older/.test(w)));
  assert.ok(usableViral(v({ paid: true }), o).why.includes('a paid post'));
  assert.ok(usableViral(v({ durationS: 300 }), o).why.some((w) => /longer/.test(w)));
  assert.ok(usableViral(v({ caption: 'cat jumps over fence' }), o).why.includes('off-topic'));
  assert.ok(usableViral(v({ handle: '@makerco' }), o).why.includes("the brand's own account"));
  assert.ok(usableViral(v({ score: null }), o).why.includes("creator's usual views unknown"));
  assert.ok(usableViral(v({ score: 4 }), o).why.some((w) => /only 4×/.test(w)));
  assert.ok(usableViral(v({ views: 30e3 }), { ...o, country: 'NL' }).ok); /* small market, lower floor */
  assert.equal(minViewsFor('IN'), 50e3);
  assert.ok(preViral(v({ score: null }), o).ok);
});

test('pick: platforms take turns', () => {
  const xs = ['a', 'b', 'c', 'd'].map((id, i) => v({ id, score: [90, 80, 70, 12][i], platform: id === 'd' ? 'instagram' : 'tiktok', caption: `coffee video number ${id} with its own words` }));
  assert.deepEqual(pickViral(xs, 3).map((x) => x.id), ['a', 'd', 'b']);
});

test('stems from the brand profile', () => {
  const s = viralStems({ config: { category: 'Cold brew coffee', product: { noun: 'coffee bag' } } });
  assert.ok(s.includes('coffee'));
});

test('finder: searches, scores against the creator, keeps errors, never scores an unknown', async () => {
  const aweme = (id, plays, sec) => ({ aweme_id: id, desc: 'coffee hack you need', create_time: (now - 5 * D) / 1e3, statistics: { play_count: plays, digg_count: 10 }, author: { unique_id: 'u' + id, sec_uid: sec }, video: { duration: 20 } });
  const calls = [];
  const call = async (id, o) => { calls.push(id);
    if (id === 'tikhub.tiktok.search.videos') return { data: { search_item_list: [{ aweme_info: aweme('1', 2e6, 'S1') }, { aweme_info: aweme('2', 3e6, null) }] } };
    if (id === 'tikhub.tiktok.user.videos') return { data: { itemList: [1, 2, 3, 4].map((i) => ({ id: String(i), stats: { playCount: 20e3 } })) } };
    if (id === 'anyapi.instagram.search.reels') throw new Error('treg anyapi 402');
    throw new Error('unexpected ' + id); };
  const f = createViralFinder({ call, ytKey: '', log: { warn() {} } });
  const r = await f.find({ terms: ['coffee'], country: 'US', stems: ['coffee'], now });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, 'tt:1');
  assert.equal(r.items[0].score, 100);
  assert.match(r.errors.instagram, /402/);
  assert.match(r.errors.youtube, /no YouTube key/);
});

test('normalizers: unknown views stay null', () => {
  assert.equal(NORMV.instagram({ shortcode: 'x', caption: 'a' }, 'q').views, null);
  assert.equal(NORMV.youtube({ id: 'abc', snippet: {}, statistics: {}, contentDetails: { duration: 'PT45S' } }, 'q').durationS, 45);
});

test('pick: one video cross-posted on two platforms is one pick', () => {
  const cap = 'Some cleaner coffee options to look for - organic and tested';
  const xs = [v({ id: 'a', score: 800, caption: cap }), v({ id: 'b', platform: 'instagram', score: 380, caption: cap + ' #coffee' }), v({ id: 'c', platform: 'instagram', score: 50, caption: 'my french press method for coffee mornings' })];
  assert.deepEqual(pickViral(xs, 3).map((x) => x.id), ['a', 'c']);
});

test('gate: a video found by an audience interest passes on its own caption, never on the search words alone', () => {
  const o = { now, country: 'US', stems: ['coffee'], interests: ['morning routine'] };
  assert.equal(preViral(v({ q: 'morning routine', caption: 'my 5am morning routine that changed everything' }), o).ok, true, 'about the interest');
  assert.equal(preViral(v({ q: 'morning routine', caption: 'coffee first, always' }), o).ok, true, 'about the brand topic');
  assert.deepEqual(preViral(v({ q: 'morning routine', caption: 'wait for the end lol' }), o).why, ['off-topic'], 'the search words alone are not enough');
});

test('finder: same number of searches with audience interests; an interest find gets a lookup and a seat', async () => {
  const aweme = (id, plays, desc) => ({ aweme_id: id, desc, create_time: (now - 5 * D) / 1e3, statistics: { play_count: plays }, author: { unique_id: 'u' + id, sec_uid: 'S' + id }, video: { duration: 20 } });
  const qs = [];
  const call = async (id, o) => {
    if (id === 'tikhub.tiktok.search.videos') { const q = o.query.keyword; qs.push(q);
      if (q === 'morning routine') return { data: { search_item_list: [{ aweme_info: aweme('9', 600e3, 'my morning routine as a nurse') }] } };
      return { data: { search_item_list: [1, 2, 3, 4].map((i) => ({ aweme_info: aweme(q.length + '' + i, 5e6 - i, `best ${q} ever`) })) } }; }
    if (id === 'tikhub.tiktok.user.videos') return { data: { itemList: [1, 2, 3, 4].map((i) => ({ id: String(i), stats: { playCount: 20e3 } })) } };
    throw new Error('treg 402'); };
  const f = createViralFinder({ call, ytKey: '', log: { warn() {} } });
  const r = await f.find({ terms: ['coffee', 'espresso', 'cold brew', 'latte'], interests: ['morning routine', 'desk setup'], country: 'US', stems: ['coffee', 'espresso', 'brew', 'latte'], now, platforms: ['tiktok'], lookups: 3 });
  assert.deepEqual(qs, ['coffee', 'espresso', 'morning routine', 'desk setup'], 'four searches: two category, two interests');
  assert.ok(r.items.some((x) => ['morning routine', 'desk setup'].includes(x.interest)), 'an interest video gets a lookup and a seat');
  assert.ok(r.items.filter((x) => !x.interest).length >= 1, 'category videos still lead');
  assert.equal(r.items.length, 3);
});
