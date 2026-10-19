// node --test test/  — the community gate (community-gate.js): which threads and questions any brand may be pointed at.
// Free: no AI, no network (fetch and treg are stubbed). The cases are the weak picks seen live on 19 Oct 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placesOf, marketsOf, inMarket, looksEnglish, freshThread, usableThread, matchesThread, isQuoraQuestion, redditStats, withStats, repliesText, REPLY_DAYS } from '../community-gate.js';
import { ideaUsable, pickIdeas, heardCards } from '../social-feed.js';

const DAY = 864e5, NOW = Date.parse('2026-10-20T12:00:00Z');
const IN = { country: 'IN', markets: ['IN', 'US'] }, GB = { country: 'GB', markets: ['GB', 'AU'] }, US = { country: 'US', markets: ['US'] };

test('a community named for another country is outside the market; home and global communities are in', () => {
  assert.deepEqual(placesOf('r/Nepal_Skincare'), ['NP']); assert.deepEqual(placesOf('WomenRO'), ['RO']); assert.deepEqual(placesOf('AskUK'), ['GB']);
  assert.deepEqual(placesOf('ukpersonalfinance'), ['GB']); assert.deepEqual(placesOf('IndianSkincareAddicts'), ['IN']); /* home ground for an Indian brand, another country's for a US one */
  assert.deepEqual(placesOf('SneakersIndia'), ['IN']); assert.deepEqual(placesOf('bangalore'), ['IN']);
  assert.deepEqual(placesOf('frenchbulldogs'), []); assert.deepEqual(placesOf('AsianBeauty'), []); assert.deepEqual(placesOf('audiophile'), []);
  assert.equal(inMarket({ sub: 'Nepal_Skincare', title: 'good hydrating lightweight moisturiser?' }, IN).ok, false);
  assert.equal(inMarket({ sub: 'SneakersIndia', title: 'light coloured sneaker?' }, IN).ok, true);
  assert.equal(inMarket({ sub: 'SkincareAddiction', title: 'which moisturiser for dry skin?' }, IN).ok, true, 'a global community is fine');
  assert.equal(inMarket({ sub: 'AskUK', title: 'x' }, US).ok, false); assert.equal(inMarket({ sub: 'IndianSkincareAddicts', title: 'x' }, US).ok, false); assert.equal(inMarket({ sub: 'AskUK', title: 'x' }, GB).ok, true);
  assert.equal(inMarket({ sub: 'australia', title: 'x' }, GB).ok, true, 'a second market counts');
  assert.equal(inMarket({ sub: 'WomenRO', title: 'x' }, {}).ok, true, 'an unknown market is never filtered');
  assert.deepEqual(marketsOf(null), []); assert.deepEqual(marketsOf({ market: { primary: 'in', others: ['ae'] } }), ['IN', 'AE']);
});

test('in an English-speaking market a thread outside a home community is in English', () => {
  assert.equal(looksEnglish('Eu port 41-42 (26 - 26,5) si cred ca intru la categoria barbati la marimi, ce marca recomandati'), false);
  assert.equal(looksEnglish('Can anyone suggest an Indian sneaker brand that is worth the money for daily wear?'), true);
  assert.equal(looksEnglish('बालों का झड़ना कैसे रोकें कोई अच्छा तेल बताओ'), false);
  assert.equal(inMarket({ sub: 'Sneakers', title: 'Eu port 41-42 si cred ca intru la categoria barbati la marimi ce marca recomandati' }, IN).ok, false);
  assert.equal(inMarket({ sub: 'Sneakers', title: 'Eu port 41-42 si cred ca intru la categoria barbati la marimi ce marca recomandati' }, { country: 'RO' }).ok, true, 'a non-English market is not language-filtered');
});

test(`a reply goes to a thread active in the last ${REPLY_DAYS} days, open, not a deals board, close enough to the brand`, () => {
  const t = (o) => ({ url: 'https://www.reddit.com/r/SneakersIndia/comments/abc/x/', sub: 'SneakersIndia', title: 'Which sneaker for daily wear?', ...o });
  assert.equal(freshThread(t({ at: '2026-08-30' }), NOW), false, 'seven weeks old');
  assert.equal(freshThread(t({ lastActive: NOW - 3 * DAY }), NOW), true); assert.equal(freshThread(t({}), NOW), false, 'an unknown date is not fresh');
  assert.equal(usableThread(t({ at: '2026-08-30' }), { now: NOW, profile: IN }).ok, false);
  assert.equal(usableThread(t({ lastActive: NOW - DAY }), { now: NOW, profile: IN }).ok, true);
  assert.equal(usableThread(t({ lastActive: NOW - DAY, locked: true }), { now: NOW, profile: IN }).ok, false);
  assert.equal(usableThread(t({ lastActive: NOW - DAY, title: 'WTS Gully Labs pair size 9' }), { now: NOW, profile: IN }).ok, false);
  assert.equal(usableThread(t({ lastActive: NOW - DAY }), { now: NOW, profile: IN, rel: 2, minRel: 3 }).ok, false, 'the higher bar');
  assert.match(usableThread(t({ at: '2026-08-30' }), { now: NOW, profile: IN }).why.join(), /last active 52 days ago/);
});

test('a reply idea is about what its thread asked', () => {
  const thread = { title: 'Bro can you please share the on feet photo of gully labs baaz?', text: 'want to see how they look on feet before buying' };
  assert.equal(matchesThread({ title: 'Reply to daily wear comfort question', copy: 'They are comfy for 10 hours of walking. Disclosure: I work at Gully Labs.' }, thread), false);
  assert.equal(matchesThread({ title: 'Share on-feet photos of the Baaz', copy: 'Here is how the Baaz looks on feet in daylight. Disclosure: I work at Gully Labs.' }, thread), true);
  assert.equal(matchesThread({ title: 'x', copy: 'y' }, {}), true, 'nothing to compare with');
});

test('Quora: a question page only, never a profile, a space or a search', () => {
  assert.ok(isQuoraQuestion('https://www.quora.com/Which-anti-hair-fall-kit-is-better-Mamaearth-or-Arata'));
  for (const u of ['https://www.quora.com/profile/Arata-34', 'https://priyankadholeysspace.quora.com/https-clnk-in-sPUx-1', 'https://www.quora.com/search?q=arata', 'https://www.quora.com/topic/Hair-Care', 'https://www.quora.com/What-is-it/answer/Someone'])
    assert.equal(isQuoraQuestion(u), false, u);
});

test('reply counts are Reddit’s own: the live count wins, an archive count is a floor, an unread count is unknown (never 0)', async () => {
  const pp = { data: [{ id: 'aaa', num_comments: 0, created_utc: NOW / 1e3 - DAY / 1e3 }, { id: 'bbb', num_comments: 4, created_utc: NOW / 1e3, locked: true }] };
  const fetchImpl = async () => ({ ok: true, json: async () => pp });
  const treg = { live: true, call: async (id, o) => { assert.equal(id, 'tikhub.x.reddit-app-fetch-post-details'); if (o.query.post_id === 't3_aaa') return { data: { postsInfoByIds: [{ subreddit: { name: 'x' }, commentCount: 12, isLocked: false, isArchived: false, removedByCategory: null, createdAt: '2026-10-17T18:15:16+0000', languageCode: 'ro' }] } }; /* tikhub's real shape */ throw new Error('402 insufficient balance'); } };
  const urls = ['aaa', 'bbb', 'ccc'].map((x) => ({ url: `https://www.reddit.com/r/x/comments/${x}/t/` }));
  const m = await redditStats(urls, { treg, fetchImpl, log: { warn: () => {} } });
  assert.equal(m.get('aaa').comments, 12); assert.equal(m.get('aaa').floor, false);
  assert.equal(m.get('bbb').comments, 4); assert.equal(m.get('bbb').floor, true); assert.equal(m.get('bbb').locked, true);
  assert.equal(m.get('ccc').comments, null); assert.match(m.get('ccc').statsError, /unknown/);
  const down = await redditStats(urls, { treg: null, fetchImpl: async () => ({ ok: false, status: 503 }), log: { warn: () => {} } });
  assert.ok([...down.values()].every((s) => s.comments === null), 'both routes down: unknown, never 0');
  assert.equal(repliesText(null), ''); assert.equal(repliesText(0, true), ''); assert.equal(repliesText(4, true), '4+ replies'); assert.equal(repliesText(1), '1 reply'); assert.equal(repliesText(0), '0 replies');
  assert.equal(withStats({ url: 'u' }, m.get('ccc')).comments, null);
  assert.equal(m.get('aaa').lang, 'ro'); assert.equal(inMarket(withStats({ sub: 'Sneakers', title: 'Which sneaker should I buy for office wear?' }, m.get('aaa')), IN).ok, false, 'Reddit says Romanian');
});

test('saved ideas heal at load: stale, out-of-market, search-only and profile-Quora ideas never reach the feed', () => {
  const reply = (where) => ({ id: 'r', platform: 'reddit', format: 'reply', title: 'Reply', copy: 'c', where: [where] });
  assert.equal(ideaUsable(reply({ kind: 'thread', name: 'r/SneakersIndia: light coloured sneaker', url: 'https://www.reddit.com/r/SneakersIndia/comments/a1/x/', at: '2026-08-30' }), { now: NOW, profile: IN }), false);
  assert.equal(ideaUsable(reply({ kind: 'thread', name: 'r/Nepal_Skincare: hydrating', url: 'https://www.reddit.com/r/Nepal_Skincare/comments/a2/x/', at: '2026-10-18' }), { now: NOW, profile: IN }), false);
  assert.equal(ideaUsable(reply({ kind: 'thread', name: 'r/IndianHaircare: thinning', url: 'https://www.reddit.com/r/IndianHaircare/comments/a3/x/', at: '2026-10-18' }), { now: NOW, profile: IN }), true);
  assert.equal(ideaUsable({ platform: 'quora', format: 'answer', title: 'q', copy: 'c', where: [{ kind: 'search', name: 'Quora search: live questions', url: 'https://www.quora.com/search?q=x' }] }, { now: NOW }), false);
  assert.equal(ideaUsable({ platform: 'quora', format: 'answer', title: 'q', copy: 'c', where: [{ kind: 'question', url: 'https://www.quora.com/How-is-Mamaearths-Onion-shampoo' }] }, { now: NOW }), true);
  assert.equal(ideaUsable({ platform: 'instagram', format: 'reel', title: 'x', copy: 'c', where: [] }), true, 'own-channel ideas are untouched');
  const items = [reply({ kind: 'thread', name: 'r/x: y', url: 'https://www.reddit.com/r/x/comments/old/y/', at: '2026-08-01' }), { id: 'ig', platform: 'instagram', format: 'reel', title: 'Reel', copy: 'c', where: [], at: '2026-10-19T00:00:00Z' }];
  assert.deepEqual(pickIdeas(items, { now: NOW, profile: IN }).map((i) => i.id), ['ig']);
});

test('heard question cards: only fresh, in-market threads, and a reply count is shown only when it is known', () => {
  const T = (o) => ({ url: `https://www.reddit.com/r/${o.where.slice(2)}/comments/${o.id}/x/`, platform: 'reddit', title: 'Does Acme run big?', about: 'brand', intent: 'question', score: 5, ...o });
  const L = { threads: [T({ id: 'f1', where: 'r/AcmeFans', lastActive: NOW - DAY, replies: 6, repliesFloor: true }), T({ id: 'o1', where: 'r/AcmeFans', lastActive: NOW - 40 * DAY, replies: 50, score: 9 }), T({ id: 'n1', where: 'r/Nepal_Skincare', lastActive: NOW - DAY, score: 8 }), T({ id: 'u1', where: 'r/Shoes', lastActive: NOW - 2 * DAY, replies: null })] };
  const cs = heardCards(L, {}, { now: NOW, profile: IN }).filter((c) => c.heard.kind === 'thread');
  assert.deepEqual(cs.map((c) => c.heard.url.split('/comments/')[1].split('/')[0]).sort(), ['f1', 'u1']);
  const f = cs.find((c) => c.heard.url.includes('f1')), u = cs.find((c) => c.heard.url.includes('u1'));
  assert.equal(f.src, 'Heard · r/AcmeFans · 6+ replies'); assert.equal(u.src, 'Heard · r/Shoes', 'unknown count: none shown');
  assert.ok(!u.rows.some((r) => r[0] === 'Replies')); assert.match(u.sub, /^Replies not counted/);
});

test('only Reddit threads that ask something or name the brand; no replica boards; a count saved before the fix is not shown', () => {
  const base = { sub: 'Sneakers', lastActive: NOW - DAY };
  assert.equal(usableThread({ ...base, url: 'https://www.tiktok.com/@theoodie/video/1', title: 'An Oodie for every season?' }, { now: NOW, profile: US }).ok, false, 'a rival’s own post');
  assert.equal(usableThread({ ...base, url: 'https://www.youtube.com/watch?v=x', title: 'Minoxidil se better?' }, { now: NOW, profile: IN }).ok, false, 'a creator’s video');
  const r = (o) => ({ ...base, url: 'https://www.reddit.com/r/Sneakers/comments/z1/x/', ...o });
  assert.equal(usableThread(r({ title: 'KYLIE JENNER PT. 10047 FOOTWEAR NEWS' }), { now: NOW, profile: US, brand: 'Footshop' }).ok, false, 'asks nothing, no brand');
  assert.equal(usableThread(r({ title: 'My review of gully labs baaz' }), { now: NOW, profile: IN, brand: 'Gully Labs' }).ok, true, 'names the brand');
  assert.equal(usableThread(r({ title: 'Which white sneaker for office?' }), { now: NOW, profile: IN, brand: 'Gully Labs' }).ok, true, 'asks');
  assert.equal(usableThread(r({ title: 'Which matching set?', url: 'https://www.reddit.com/r/AwesomeReps/comments/z2/x/', sub: 'AwesomeReps' }), { now: NOW, profile: US }).ok, false, 'a replica board');
  const L = { threads: [{ url: 'https://www.reddit.com/r/newborns/comments/n0/x/', platform: 'reddit', where: 'r/newborns', title: 'Are these patches safe for babies?', about: 'brand', intent: 'question', lastActive: NOW - DAY, replies: 0, score: 3 },
    { url: 'https://www.youtube.com/watch?v=abc', platform: 'youtube', where: 'Rw Reviews', title: 'Better than minoxidil?', about: 'brand', intent: 'question', lastActive: NOW - DAY, replies: 0, repliesLive: true, score: 9 }] };
  const cs = heardCards(L, {}, { now: NOW, profile: IN }).filter((c) => c.heard.kind === 'thread');
  assert.equal(cs.length, 1); assert.equal(cs[0].src, 'Heard · r/newborns', 'a 0 saved before 20 Oct is not shown as a count');
});

/* ---------- end to end: the ideas writer only ships replies about their thread, and Quora answers to real questions ---------- */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createPacks } from '../brand-pack.js';
import { createIdeas } from '../ideas.js';
test('ideas: a reply that drifts from its thread is dropped, a Quora answer needs a real question, every place passes the gate', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-gate-')), P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: { warn() {}, info() {}, log() {} } }), slug = 'acme-com';
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.com', country: 'IN', markets: ['IN'], category: 'Footwear', subcategory: 'Sneakers' });
  await P.put(slug, 'config.json', { currency: 'INR', rivals: ['Comet'] }); await P.put(slug, 'seed.json', { brand: { name: 'Acme' }, posts: [] });
  const th = (id, sub, title, quote, daysAgo) => ({ id: `reddit:${id}`, url: `https://www.reddit.com/r/${sub}/comments/${id}/x/`, platform: 'reddit', where: `r/${sub}`, title, quote, lastActive: NOW - daysAgo * DAY, replies: 4, repliesLive: true, about: 'brand', intent: 'question' });
  await P.put(slug, 'listen/threads.json', { threads: [th('aa1', 'SneakersIndia', 'Acme sneakers on feet photos?', 'Can someone share on feet photos of Acme sneakers before I buy?', 2),
    th('aa2', 'SneakersIndia', 'Acme sneakers sizing help?', 'Do Acme sneakers run big or small?', 3), th('old', 'SneakersIndia', 'Acme sneakers worth it?', 'Old question about Acme sneakers', 60), th('np1', 'Nepal_Shoes', 'Acme sneakers in Nepal?', 'Where to buy Acme sneakers?', 1)] });
  await P.put(slug, 'listen/items.json', { items: [{ id: 'w1', platform: 'web', kind: 'page', title: 'Are Acme sneakers good for daily wear?', link: 'https://www.quora.com/Are-Acme-sneakers-good-for-daily-wear' }, { id: 'w2', platform: 'web', kind: 'page', title: 'Acme', link: 'https://www.quora.com/profile/Acme-1' }] });
  let slatePrompt = '';
  const ai = { live: true, call: async (q) => {
    if (q.tag === 'ideas:slate') { slatePrompt = q.prompt; const slots = [...q.prompt.matchAll(/^slot (\d+): (\w[\w ]*?) (reply|post|answer|reel|carousel|single image|short video|thread|founder post|brand post|pin|group post)$/gm)].map((m) => ({ slot: +m[1], p: m[2], f: m[3] }));
      return { usd: 0, json: { items: slots.map((s) => ({ slot: s.slot, angle: s.p, evidence: ['E1'], where: s.p === 'Reddit' ? [s.slot === 3 ? 'T2' : 'T1'] : s.p === 'Quora' ? ['Q1'] : [], moves: [], product: '', query: '' })) } }; }
    if (q.tag === 'ideas:write') { const slots = [...q.prompt.matchAll(/^slot (\d+): (\w[\w ]*?) (\w[\w ]*)\n  angle/gm)].map((m) => ({ slot: +m[1], p: m[2] }));
      return { usd: 0, json: { ideas: slots.map((s) => s.p === 'Reddit' && s.slot !== 3 ? { slot: s.slot, title: 'Share on-feet photos of Acme sneakers', copy: 'Here are on feet photos of the Acme sneakers in daylight, hope it helps before you buy.', where: [{ ref: 'T1', why: 'asked', rule: 'ok' }] }
        : s.p === 'Reddit' ? { slot: s.slot, title: 'Our founder story in ten lines', copy: 'We started in a garage with a dream and a sewing machine and we never looked back.', where: [{ ref: 'T2', why: 'asked', rule: 'ok' }] }
        : s.p === 'Quora' ? { slot: s.slot, title: 'Are Acme sneakers good for daily wear', copy: 'Acme sneakers are good for daily wear if you walk a lot, the sole is soft and they breathe well.', where: [{ ref: 'Q1', why: 'asked', rule: 'ok' }] }
        : { slot: s.slot, title: `Post ${s.slot}`, copy: 'A post about Acme sneakers for daily wear and long walks.', where: [] }) } }; }
    return { usd: 0, json: { checks: [] } }; } };
  const I = createIdeas({ slug, packs: P, ai, treg: null, log: { warn() {}, info() {}, log() {} }, now: () => NOW });
  const r = await I.generate({ n: 8, platforms: ["reddit", "quora"] });
  assert.match(slatePrompt, /T1 r\/SneakersIndia/); assert.doesNotMatch(slatePrompt, /Old question|Nepal_Shoes/, 'stale and out-of-market threads never reach the writer');
  assert.match(slatePrompt, /Q1 "Are Acme sneakers good for daily wear\?"/); assert.doesNotMatch(slatePrompt, /profile\/Acme/);
  const replies = r.ideas.filter((i) => i.platform === 'reddit'), quora = r.ideas.filter((i) => i.platform === 'quora');
  assert.ok(replies.length && replies.every((i) => /on-feet/.test(i.title)), JSON.stringify(r.dropped));
  assert.ok(r.dropped.some((d) => /not about what the thread asked/.test(d.why.join())), 'the founder-story reply to a sizing question is dropped');
  assert.ok(quora.length && quora.every((i) => i.where[0].kind === 'question' && /quora\.com\/Are-Acme/.test(i.where[0].url)));
  fs.rmSync(ROOT, { recursive: true, force: true });
});
