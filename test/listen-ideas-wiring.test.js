// node --test test/  — listening + ideas wiring (social-feed.js), free: no AI, no network, no treg.
// Card injection shape, dedupe and the daily rotation cap, the jam package an idea opens as, and the background
// scheduler's gates (kill switches, mock = no spend, the last-open window, once a day, the daily USD cap).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ideaCards, pickIdeas, heardCards, socialize, heardView, dueFor, socialConfig, createSocialScheduler, SOCIAL_DEFAULTS, isCommunityCard } from '../social-feed.js';
import { createPacks } from '../brand-pack.js';
import { recipeOfCard } from '../remix.js';
import { ideaAction, ideaPkg, familyOf, fieldsFor, missing } from '../studio.js';

const H = 3600e3, DAY = 24 * H, NOW = Date.parse('2026-10-14T12:00:00Z');
const quiet = { warn: () => {}, info: () => {}, log: () => {}, error: () => {} };
const SEED = { brand: { name: 'Acme' }, lanes: { core: { name: 'Core' } }, posts: [{ id: 'm01-a', agent: 'creative', sector: 'creatives', type: 'idea', kind: 'rows', roles: ['founder'], title: 'A move card', sub: 'x', rows: [['a', 'b']], src: 'Move 01', time: '2 hr', cta: { label: 'Open report' } }] };
const idea = (k, o = {}) => ({ id: `idea-${k}`, platform: 'instagram', platformLabel: 'Instagram', format: 'carousel', title: `Idea ${k}`, hook: `Hook ${k}`, copy: `Copy for idea ${k}, ready to post.`, cta: 'Save it', hashtags: ['#acme'],
  media: { kind: 'carousel', prompt: 'the product on a table', slides: [{ text: 'Slide one', prompt: 'p1' }, { text: 'Slide two', prompt: 'p2' }], script: [], product: { title: 'Thing', url: 'https://acme.com/products/thing', images: ['https://cdn.acme.com/thing-1.jpg', 'https://cdn.acme.com/thing-2.jpg'] } },
  where: [{ name: '@acme (own Instagram)', url: 'https://instagram.com/acme', kind: 'own', why: 'own', rule: '' }], why: 'Because.', evidence: [{ label: 'Review', value: 'Love it', source: 'https://acme.com' }], moves: ['Move 21'], measure: { metric: 'Saves', how: 'Insights after 7 days' }, postAt: 'Thursday 7 PM', at: new Date(NOW - k * H).toISOString(), ...o });
const REDDIT = idea(90, { platform: 'reddit', platformLabel: 'Reddit', format: 'reply', title: 'Reply on the sizing thread', copy: 'It runs half a size big.\n\nDisclosure: I work at Acme.', hashtags: [], media: { kind: 'none', prompt: '', slides: [], script: [] },
  where: [{ name: 'r/AcmeFans: Does Acme run big?', url: 'https://www.reddit.com/r/AcmeFans/comments/abc123/does_acme_run_big/', kind: 'thread', why: 'They asked', rule: 'No links', comments: 14, at: '2026-10-13' }] });
const LISTEN = {
  status: { at: NOW - 2 * H, items: 120, sources: { reddit: { name: 'Reddit', state: 'ok' } } }, total: 100,
  threads: [
    { id: 'reddit:abc123', url: 'https://www.reddit.com/r/AcmeFans/comments/abc123/does_acme_run_big/', platform: 'reddit', where: 'r/AcmeFans', title: 'Does Acme run big?', lastActive: NOW - DAY, replies: 14, repliesLive: true, heard: 3, about: 'brand', intent: 'question', sentiment: 'neutral', quote: 'Does Acme run big? I am a 9.', score: 9 },
    { id: 'reddit:zzz', url: 'https://www.reddit.com/r/BangaloreMarketplace/comments/zzz/wts_acme/', platform: 'reddit', where: 'r/BangaloreMarketplace', title: 'WTS Acme pair', lastActive: NOW - DAY, replies: 2, about: 'brand', intent: 'question', score: 20 },
    { id: 'reddit:old', url: 'https://www.reddit.com/r/AcmeFans/comments/old/', platform: 'reddit', where: 'r/AcmeFans', title: 'Old question', lastActive: NOW - 400 * DAY, replies: 50, about: 'brand', intent: 'question', score: 30 },
    { id: 'reddit:q2', url: 'https://www.reddit.com/r/Shoes/comments/q2/', platform: 'reddit', where: 'r/Shoes', title: 'Acme or Rival?', lastActive: NOW - 3 * DAY, replies: 5, about: 'rival', intent: 'question', score: 5 }],
  themes: [
    { name: 'sizing', n: 40, pos: 10, neg: 25, neutral: 5, brand: 30, wow: { week: 4, lastWeek: 2 }, quoteIds: ['rd:t1', 'rd:t2'], quote: 'Runs big', quoteLink: 'https://www.reddit.com/r/AcmeFans/comments/abc123/x/t1/' },
    { name: 'comfort', n: 30, pos: 25, neg: 2, neutral: 3, brand: 20, quoteIds: ['rd:t3'], quote: 'So comfy', quoteLink: 'https://www.reddit.com/r/AcmeFans/comments/c/' }],
  communities: [{ name: 'r/AcmeFans', url: 'https://www.reddit.com/r/AcmeFans/', platform: 'reddit', posts: 60, threads: 40, brand: 50, questions: 12, why: '50 about Acme', lastActive: NOW - DAY }],
  items: [{ id: 'rd:t1', platform: 'reddit', sub: 'r/AcmeFans', text: 'They run a full size big, size down for sure', link: 'https://www.reddit.com/r/AcmeFans/comments/abc123/x/t1/' }, { id: 'rd:t2', platform: 'reddit', sub: 'r/Shoes', title: 'Acme sizing', text: 'half a size big in my experience', link: 'https://www.reddit.com/r/Shoes/comments/t2/' }, { id: 'rd:t3', platform: 'reddit', sub: 'r/AcmeFans', text: 'So comfy I wear them every day', link: 'https://www.reddit.com/r/AcmeFans/comments/c/' }]
};
const FEED_SHAPE = (c) => {
  for (const k of ['id', 'agent', 'sector', 'type', 'kind', 'title', 'sub', 'src', 'time']) assert.ok(c[k], `${c.id} has ${k}`);
  assert.ok(Array.isArray(c.roles) && c.roles.length, 'roles');
  assert.ok(c.cta?.label, 'cta label'); assert.ok(Array.isArray(c.detail?.why) && Array.isArray(c.detail?.how), 'detail');
  assert.ok(/^\d+\s*(min|hr|days?)$/.test(c.time), `time reads as an age: ${c.time}`);
  if (c.kind === 'media') assert.ok(c.images?.length, 'media cards carry images'); else assert.ok(Array.isArray(c.rows) && c.rows.every((r) => r.length === 2), 'rows');
  if (c.link) assert.match(c.link.url, /^https:\/\//);
  assert.doesNotThrow(() => JSON.stringify(c));
};

test('idea cards fit the feed card shape; media ideas are visual, community ideas are text with the thread', () => {
  const cs = ideaCards([idea(1), REDDIT], SEED, { now: NOW });
  cs.forEach(FEED_SHAPE);
  const ig = cs.find((c) => c.id === 'idea-1'), rd = cs.find((c) => c.id === 'idea-90');
  assert.equal(ig.kind, 'media'); assert.deepEqual(ig.images, ['https://cdn.acme.com/thing-1.jpg', 'https://cdn.acme.com/thing-2.jpg']);
  assert.equal(rd.kind, 'rows'); assert.equal(rd.link.url, REDDIT.where[0].url);
  assert.match(rd.src, /Heard r\/AcmeFans · 14 replies/); assert.equal(rd.cta.label, 'Reply in r/AcmeFans');
  assert.equal(ig.stream, 'ideas'); assert.equal(ig.post.id, 'idea-1');
  assert.equal(ideaCards([{ id: 'x', title: '', copy: '' }], SEED).length, 0, 'an empty idea never becomes a card');
});

test('listening cards: real question threads (no buy/sell boards, nothing stale) and theme cards with counts and two linked quotes', () => {
  const cs = heardCards(LISTEN, SEED, { now: NOW });
  cs.forEach(FEED_SHAPE);
  const qs = cs.filter((c) => c.heard.kind === 'thread'), ts = cs.filter((c) => c.heard.kind === 'theme');
  assert.equal(qs.length, 2);
  assert.ok(!qs.some((c) => /Marketplace|old/.test(c.link.url)), 'no marketplace or year-old threads');
  assert.equal(qs[0].link.url, LISTEN.threads[0].url); assert.equal(qs[0].src, 'Heard · r/AcmeFans · 14 replies'); assert.equal(qs[0].cta.label, 'Reply as the brand');
  const sizing = ts.find((c) => c.heard.name === 'sizing');
  assert.match(sizing.title, /40 mentions, 63% negative/);
  assert.deepEqual(sizing.rows.find((r) => r[0] === 'Mood'), ['Mood', '10 positive · 25 negative · 5 neutral']);
  assert.equal(sizing.heard.quotes.length, 2); assert.ok(sizing.heard.quotes.every((q) => /^https:\/\/www\.reddit\.com\//.test(q.url)));
  assert.match(ts.find((c) => c.heard.name === 'comfort').title, /83% positive/);
  assert.deepEqual(heardCards({}, SEED), [], 'no listening data, no cards');
});

test('community cards (a heard thread, a Reddit or Quora idea) are told apart from posts and theme cards, for the feed seat', () => {
  const ids = ideaCards([idea(1), REDDIT, idea(2, { platform: 'quora', platformLabel: 'Quora', format: 'answer', media: { kind: 'none', slides: [], script: [] } })], SEED, { now: NOW });
  assert.deepEqual(ids.map(isCommunityCard), [false, true, true]);
  const hs = heardCards(LISTEN, SEED, { now: NOW });
  assert.ok(hs.filter((c) => c.heard.kind === 'thread').every(isCommunityCard)); assert.ok(!hs.filter((c) => c.heard.kind === 'theme').some(isCommunityCard));
  assert.equal(isCommunityCard(null), false); assert.equal(isCommunityCard({ id: 'm01-a' }), false);
});

test('socialize adds both streams to the seed once, keeps every existing card, and is a no-op without data', () => {
  const s1 = socialize(SEED, { ideas: [idea(1), idea(1), REDDIT], listen: LISTEN }, { now: NOW });
  assert.equal(s1.posts[0].id, 'm01-a');
  const ids = s1.posts.map((p) => p.id); assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  assert.ok(ids.includes('idea-1') && ids.includes('idea-90') && ids.some((x) => x.startsWith('heard-q-')) && ids.some((x) => x.startsWith('heard-t-')));
  assert.equal(socialize(SEED, null), SEED); assert.equal(socialize(SEED, { ideas: [], listen: {} }), SEED);
  assert.equal(socialize(SEED, { ideas: [{ id: 'bad', title: 't', copy: 'c', media: 5, where: 'nope' }], listen: { themes: 'nope' } }), SEED, 'a bad file never breaks the feed');
});

test('pickIdeas: dedupe by id and title, newest first, at most 12, rotated by day (same all day, different tomorrow)', () => {
  const items = [...Array.from({ length: 30 }, (_, k) => idea(k)), idea(3), idea(40, { title: 'Idea 2' })];
  const a = pickIdeas(items, { now: NOW });
  assert.equal(a.length, 12); assert.equal(new Set(a.map((i) => i.id)).size, 12);
  assert.deepEqual(a.slice(0, 6).map((i) => i.id), ['idea-0', 'idea-1', 'idea-2', 'idea-3', 'idea-4', 'idea-5'], 'the newest six always lead');
  assert.ok(!a.some((i) => i.id === 'idea-40'), 'same platform + same title counts once');
  assert.deepEqual(pickIdeas(items, { now: NOW + 3 * H }).map((i) => i.id), a.map((i) => i.id), 'stable within a day');
  const b = pickIdeas(items, { now: NOW + DAY });
  assert.notDeepEqual(b.slice(6).map((i) => i.id), a.slice(6).map((i) => i.id), 'the rest rotates the next day');
  assert.equal(pickIdeas(items.slice(0, 5), { now: NOW }).length, 5);
});

test('the jam: an idea opens as its own post with its copy and where to post; Instagram keeps the creative path', () => {
  const [ig, rd] = ideaCards([idea(1), REDDIT], SEED, { now: NOW });
  const rr = recipeOfCard(rd); assert.equal(rr.primary, 'creative.reddit_post'); assert.equal(rr.actionKeys[0], 'creative.reddit_post');
  const p = ideaPkg(rd.post, 'reddit_post', rd); assert.equal(familyOf('reddit_post'), 'post');
  assert.match(p.copy, /Disclosure: I work at Acme/); assert.equal(p.where[0].url, REDDIT.where[0].url); assert.deepEqual(missing('post', 'reddit_post', p), []);
  assert.equal(recipeOfCard(ig).primary, 'creative.ig_carousel'); assert.equal(familyOf('ig_carousel'), 'social');
  const ip = ideaPkg(ig.post, 'ig_carousel'); assert.equal(ip.slides.length, 2); assert.match(ip.caption, /Copy for idea 1/); assert.deepEqual(missing('social', 'ig_carousel', { ...ip, format: '4:5' }), []);
  assert.equal(ideaAction({ platform: 'x' }), 'creative.x_post'); assert.equal(ideaAction({ platform: 'linkedin' }), 'creative.linkedin_post'); assert.equal(ideaAction({ platform: 'youtube' }), 'creative.short_video');
  assert.ok(fieldsFor('post', 'short_video').some((f) => f.k === 'script'));
  const q = heardCards(LISTEN, SEED, { now: NOW }).find((c) => c.heard.kind === 'thread');
  assert.equal(recipeOfCard(q).primary, 'creative.reddit_post'); assert.equal(ideaPkg(q.post, 'reddit_post', q).where[0].url, LISTEN.threads[0].url);
  assert.equal(recipeOfCard(heardCards(LISTEN, SEED, { now: NOW }).find((c) => c.heard.name === 'sizing')).primary, 'storefront.pdp_block');
});

test('What Brew learned → Heard: themes with counts and linked quotes, questions, communities; nothing for a brand without listening', () => {
  const v = heardView(LISTEN, { name: 'Acme' });
  assert.equal(v.themes[0].name, 'sizing'); assert.equal(v.themes[0].quotes.length, 2); assert.equal(v.themes[0].quotes[0].url, LISTEN.items[0].link);
  assert.ok(v.questions.every((q) => !/Marketplace/.test(q.url))); assert.equal(v.communities[0].name, 'r/AcmeFans'); assert.deepEqual(v.sources, [{ id: 'reddit', name: 'Reddit', n: 3 }]); assert.deepEqual(v.okSources, ['Reddit']);
  assert.equal(heardView({}), null); assert.equal(heardView(null), null);
});

test('a pack load injects the streams for any brand with the files, and changes nothing for a brand without them', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-social-'));
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const seed = { ...SEED, roles: { founder: { title: 'Founder', line: 'x', sector: {}, type: {} } } };
  for (const slug of ['with-social', 'plain-brand']) { await P.put(slug, 'seed.json', seed); await P.put(slug, 'status.json', { name: 'Acme', ready: true }); await P.put(slug, 'config.json', { currency: 'USD' }); }
  await P.put('with-social', 'ideas/ideas.json', { items: [idea(1), REDDIT] });
  for (const n of ['threads', 'themes', 'communities', 'status', 'items']) await P.put('with-social', `listen/${n}.json`, n === 'status' ? LISTEN.status : { [n]: LISTEN[n], ...(n === 'themes' ? { total: 100 } : {}) });
  const a = await P.load('with-social'), b = await P.load('plain-brand');
  assert.ok(a.seed.posts.some((p) => p.stream === 'ideas') && a.seed.posts.some((p) => p.stream === 'heard'));
  assert.deepEqual(b.seed.posts.map((p) => p.id), ['m01-a']);
  process.env.SOCIAL_CARDS = '0'; P.drop('with-social'); const c = await P.load('with-social'); delete process.env.SOCIAL_CARDS;
  assert.ok(!c.seed.posts.some((p) => p.stream), 'SOCIAL_CARDS=0 turns the cards off');
  fs.rmSync(ROOT, { recursive: true, force: true });
});

/* ---------- the scheduler ---------- */
const LIVE_ENV = { SOCIAL_BG: '1' };
test('gates: kill switches, mock, local servers, the last-open window, once a day, and the daily cap', () => {
  const cfg = socialConfig(LIVE_ENV), opened = { lastOpen: NOW - DAY };
  assert.deepEqual([cfg.dayCapUsd, cfg.ideasN, cfg.openDays, cfg.listenEveryH], [3, 6, 3, 8]);
  let d = dueFor(opened, cfg, { now: NOW }); assert.ok(d.listen && d.ideas);
  d = dueFor({}, cfg, { now: NOW }); assert.ok(d.listen && !d.ideas, 'never opened: listen yes, ideas no'); assert.match(d.why.join(), /nobody opened/);
  d = dueFor({ lastOpen: NOW - 4 * DAY }, cfg, { now: NOW }); assert.ok(!d.ideas, 'opened 4 days ago: no ideas');
  d = dueFor({ ...opened, lastListen: NOW - 2 * H, lastIdeas: NOW - 2 * H }, cfg, { now: NOW }); assert.ok(!d.listen && !d.ideas, 'both ran today');
  d = dueFor({ ...opened, lastIdeas: NOW - 25 * H }, cfg, { now: NOW }); assert.ok(d.ideas);
  assert.ok(!dueFor(opened, socialConfig({ ...LIVE_ENV, IDEAS_OFF: '1' }), { now: NOW }).ideas); assert.ok(dueFor(opened, socialConfig({ ...LIVE_ENV, IDEAS_OFF: '1' }), { now: NOW }).listen);
  assert.ok(!dueFor(opened, socialConfig({ ...LIVE_ENV, LISTEN_OFF: '1' }), { now: NOW }).listen);
  for (const env of [{ ...LIVE_ENV, AI_MOCK: '1' }, { RESEARCH_OFF: '1' }, { LIVE_OFF: '1' }, { SOCIAL_BG: '0' }]) { const x = dueFor(opened, socialConfig(env), { now: NOW }); assert.ok(!x.listen && !x.ideas, JSON.stringify(env)); }
  assert.ok(!dueFor(opened, cfg, { now: NOW, aiLive: false }).ideas, 'AI off: nothing runs');
  assert.ok(!dueFor(opened, cfg, { now: NOW, ready: false }).listen, 'not built: nothing runs');
  const day = new Date(NOW).toISOString().slice(0, 10);
  d = dueFor({ ...opened, spend: { day, usd: 2.5 } }, cfg, { now: NOW }); assert.ok(d.listen && !d.ideas, '$2.50 spent: listening fits, ideas do not'); assert.match(d.why.join(), /cap/);
  d = dueFor({ ...opened, spend: { day, usd: 2.9 } }, cfg, { now: NOW }); assert.ok(!d.listen && !d.ideas);
  d = dueFor({ ...opened, spend: { day: '2026-10-13', usd: 9 } }, cfg, { now: NOW }); assert.ok(d.listen && d.ideas, "yesterday's spend does not count");
  assert.equal(socialConfig({ ...LIVE_ENV, SOCIAL_DAY_CAP_USD: '5' }).dayCapUsd, 5);
});

const memPacks = (brands) => { const files = new Map(); return { files, list: async () => brands.map((slug) => ({ slug, status: { name: slug, ready: true } })), getJSON: async (s, n, d = null) => (files.has(`${s}/${n}`) ? JSON.parse(files.get(`${s}/${n}`)) : d), put: async (s, n, x) => { files.set(`${s}/${n}`, JSON.stringify(x)); } }; };
const stubs = (calls, usd = { listen: 0.05, ideas: 0.9 }) => ({ listen: (slug) => ({ run: async (o) => { calls.push(['listen', slug, o]); return { status: { usd: { total: usd.listen }, items: 10, sources: {} }, themes: [], communities: [] }; } }),
  ideas: (slug) => ({ spend: { ai: 0, treg: 0 }, next: async (o) => { calls.push(['ideas', slug, o]); return { ideas: [{}, {}], usd: { ai: usd.ideas, treg: 0 } }; } }) });

test('the scheduler on a mock server runs nothing and spends nothing', async () => {
  const calls = [], packs = memPacks(['a-com']), fresh = [];
  const S = createSocialScheduler({ packs, ai: { live: false }, treg: null, log: quiet, env: { AI_MOCK: '1', SOCIAL_BG: '1' }, now: () => NOW, make: stubs(calls), onFresh: async (s) => fresh.push(s) });
  assert.equal(S.start(), false); await S.opened('a-com'); await S.tick();
  assert.deepEqual(calls, []); assert.deepEqual(fresh, []);
  const S2 = createSocialScheduler({ packs, ai: { live: true }, treg: null, log: quiet, env: { RESEARCH_OFF: '1' }, now: () => NOW, make: stubs(calls) });
  assert.equal(S2.start(), false, 'a local server (RESEARCH_OFF) stays quiet'); await S2.tick(); assert.deepEqual(calls, []);
});

test('the scheduler: listen for every built brand, ideas (n=6) only for brands opened lately, once a day, under the cap', async () => {
  let t = NOW; const calls = [], fresh = [], packs = memPacks(['open-com', 'idle-com']);
  const S = createSocialScheduler({ packs, ai: { live: true }, treg: null, log: quiet, env: LIVE_ENV, now: () => t, make: stubs(calls), onFresh: async (s) => fresh.push(s) });
  await S.opened('open-com');
  await S.tick();
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['listen', 'open-com'], ['ideas', 'open-com'], ['listen', 'idle-com']]);
  assert.equal(calls[1][2].n, 6); assert.equal(calls[0][2].paid, true, 'every source runs by default'); assert.equal(calls[0][2].capUsd, 0.6, 'under the per-run cap');
  assert.equal(socialConfig({ ...LIVE_ENV, LISTEN_PAID: '0' }).paid, false, 'LISTEN_PAID=0 turns paid sources off'); assert.equal(socialConfig({ ...LIVE_ENV, LISTEN_RUN_CAP_USD: '0.3' }).listenRunCapUsd, 0.3);
  assert.deepEqual(fresh, ['open-com', 'idle-com'], 'the feed reloads after each run');
  const st = await S.stateOf('open-com'); assert.equal(st.spend.usd, 0.95); assert.equal(st.ideas.made, 2);
  assert.ok(JSON.parse(packs.files.get('open-com/social/state.json')).lastIdeas, 'state is kept in the pack');
  calls.length = 0; t = NOW + 2 * H; await S.tick(); assert.deepEqual(calls, [], 'nothing again the same day');
  // the next day: a run that costs more than the cap stops the ideas after listening
  t = NOW + 25 * H; await S.opened('open-com'); calls.length = 0;
  const S2 = createSocialScheduler({ packs: memPacks(['big-com']), ai: { live: true }, treg: null, log: quiet, env: { ...LIVE_ENV, SOCIAL_DAY_CAP_USD: '1.4' }, now: () => t, make: stubs(calls, { listen: 0.2, ideas: 1.3 }) });
  await S2.opened('big-com'); await S2.tick();
  assert.deepEqual(calls.map((c) => c[0]), ['listen', 'ideas'], 'both fit the estimate at the start');
  { const c3 = []; const S3 = createSocialScheduler({ packs: memPacks(['tight-com']), ai: { live: true }, treg: null, log: quiet, env: { ...LIVE_ENV, SOCIAL_DAY_CAP_USD: '1.4' }, now: () => t, make: stubs(c3, { listen: 0.5, ideas: 0.9 }) });
    await S3.opened('tight-com'); await S3.tick(); assert.deepEqual(c3.map((c) => c[0]), ['listen'], 'what listening really spent leaves too little for ideas: they wait'); }
  const due = await S2.due('big-com'); assert.ok(!due.listen && !due.ideas);
  const st2 = await S2.stateOf('big-com'); st2.lastListen = 0; st2.lastIdeas = 0; assert.ok(st2.spend.usd >= 1.4);
  const d2 = await S2.due('big-com'); assert.ok(!d2.listen && !d2.ideas, 'over the daily cap: nothing more today'); assert.match(d2.why.join(), /cap/);
});

test('an ideas run that makes nothing keeps why each idea was dropped, so a thin stream explains itself', async () => {
  const packs = memPacks(['thin-com']);
  const make = { listen: () => ({ run: async () => ({ status: { usd: { total: 0 }, sources: {} }, themes: [] }) }),
    ideas: () => ({ spend: { ai: 0, treg: 0 }, next: async () => ({ ideas: [], dropped: [{ title: 'A reel', platform: 'instagram', why: ['unbacked numbers: 95%'] }, { title: 'A reply', platform: 'reddit', why: ['already made (title or replied thread)'] }], usd: { ai: 0.17, treg: 0.02 } }) }) };
  const S = createSocialScheduler({ packs, ai: { live: true }, treg: null, log: quiet, env: { ...LIVE_ENV, LISTEN_OFF: '1' }, now: () => NOW, make });
  await S.opened('thin-com'); await S.tick();
  const st = JSON.parse(packs.files.get('thin-com/social/state.json'));
  assert.equal(st.ideas.made, 0); assert.equal(st.ideas.empty, true);
  assert.deepEqual(st.ideas.dropped.map((d) => d.why[0]), ['unbacked numbers: 95%', 'already made (title or replied thread)']);
});

test('kill switches stop the scheduler from calling either job', async () => {
  const calls = [];
  const S = createSocialScheduler({ packs: memPacks(['a-com']), ai: { live: true }, treg: null, log: quiet, env: { ...LIVE_ENV, LISTEN_OFF: '1', IDEAS_OFF: '1' }, now: () => NOW, make: stubs(calls) });
  await S.opened('a-com'); await S.tick(); assert.deepEqual(calls, []);
  assert.equal(SOCIAL_DEFAULTS.dayCapUsd, 3);
});

/* ---------- listening everywhere: sources, modes, asked threads, history, facets (fakes for treg and Apify: free) ---------- */
import { createListenWatch, NORM, SOURCES, sourceName, platformOf } from '../listen-watch.js';
import { createApify } from '../apify.js';
const VENDOR = /tikhub|anyapi|crawl4ai|scrapecreators|apify|tinyfish|brightdata|litescrape|treg/i;
const hh = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
const T = Math.floor(NOW / 1e3) - 3 * 86400;
const FIX = {
  'tikhub.tiktok.search.videos': ({ query }) => ({ data: { search_item_list: [{ aweme_info: { aweme_id: `7${hh(query.keyword)}`, desc: `${query.keyword} review after a month of daily wear`, create_time: T, author: { nickname: 'Jo Ann', unique_id: 'joann' }, statistics: { digg_count: 50, comment_count: 12 } } }] } }),
  'tikhub.tiktok.video.comments': ({ query }) => ({ data: { comments: [{ cid: `c${query.aweme_id}`, text: `Do these run true to size for wide feet ${query.aweme_id}?`, create_time: T, digg_count: 3, reply_comment_total: 1, user: { nickname: 'Sam Lee' } }] } }),
  'anyapi.instagram.search.reels': ({ body }) => ({ output: { data: { reels: [{ shortcode: `R${hh(body.query)}`, caption: `Trying ${body.query} for a week, honest thoughts`, createdUtc: T, likes: 9, comments: 4, username: 'kel', url: `https://www.instagram.com/reel/R${hh(body.query)}/` }] } } }),
  'tikhub.x.instagram-v1-fetch-hashtag-posts': () => ({ data: { attempts: '0' } }),
  'anyapi.instagram.post.comments': ({ body }) => ({ output: { data: { comments: [{ id: `ic${hh(body.url)}`, author: 'mrx', createdUtc: T, likes: 1, text: `Love the colour but the sole wore out fast ${hh(body.url)}` }] } } }),
  'crawl4ai.youtube.search.videos': ({ body }) => ({ rows: [{ video_id: `V${hh(body.query)}`, title: `${body.query} honest review`, description: '', channel: 'Chan', views: 100 }] }),
  'crawl4ai.youtube.video.comments': ({ body }) => ({ rows: [{ comment_id: `yc${body.video}`, text: `Mine fell apart after two months of daily walking ${body.video}`, published: '2 weeks ago', likes: 5, replies: 1, author: { name: '@walker' }, url: `https://www.youtube.com/watch?v=${body.video}&lc=x` }] }),
  'crawl4ai.trustpilot.business.reviews': ({ body }) => ({ rows: [{ review_id: `tp${body.domain}`, author: 'Isabelle Parker', date: '2026-09-24T18:31:10.000Z', rating: 2, title: 'Refund slow', text: `The refund took weeks to process at ${body.domain}`, url: 'https://www.trustpilot.com/reviews/x' }] }),
  'tinyfish.web.search.news': ({ query }) => ({ results: [{ title: `${query.query.replace(/"/g, '')} raises prices on sneakers`, snippet: 'The brand said its sneakers will cost more next year as wool prices rise', url: `https://news.example.com/${hh(query.query)}`, publisher: 'Example News', date: 'Oct 1, 2026' }] }),
  'treg.web.search': ({ body }) => ({ output: { results: /site:walmart/.test(body.q) ? [{ url: 'https://www.walmart.com/ip/Acme-Wool-Runner/12345' }] : /site:nykaa/.test(body.q) ? [{ url: 'https://www.nykaa.com/acme-wool-runner/p/555' }] : /site:flipkart/.test(body.q) ? [{ url: 'https://www.flipkart.com/acme-wool-runner/p/itm123abc' }] : /site:myntra/.test(body.q) ? [] :
    [{ title: 'Is Acme worth it? - Quora', snippet: `I have worn Acme sneakers daily for a year and they hold up well ${hh(body.q)}`, url: `https://www.quora.com/Is-Acme-worth-it-${hh(body.q)}` }, { title: 'Acme', snippet: 'Shop Acme sneakers online today', url: 'https://acme.com/' }] } }),
  'crawl4ai.walmart.product.detail': () => ({ rows: [{ title: 'Acme Wool Runner', reviews: [{ id: 'w1', author: 'Liz', date: '2026-09-01', rating: 4, text: 'Comfortable shoes for long walks' }] }] }),
  'scrapecreators.x.v1-facebook-adlibrary-search-ads': () => ({ searchResults: [{ snapshot: { page_name: 'Shopify1Percent', page_profile_uri: 'https://www.facebook.com/61584503423121/' } }, { snapshot: { page_name: 'Rival', page_profile_uri: 'https://www.facebook.com/rival/' } }] }),
  'crawl4ai.facebook.user.posts': ({ body }) => ({ rows: [{ id: `fp${hh(body.page)}`, page_name: /rival/.test(body.page) ? 'Rival' : 'Acme', text: 'Fall drop is here', url: `https://www.facebook.com/x/posts/${hh(body.page)}`, comments: 3, reactions: 10, posted: '2026-10-01T00:00:00Z' }] }),
  'scrapecreators.x.v1-facebook-post-comments': ({ query }) => ({ comments: [{ id: `fc${hh(query.url)}`, text: `Will these come back in the wide size soon ${hh(query.url)}?`, created_at: '2026-10-02T00:00:00Z', reply_count: 0, reaction_count: 2, author: { name: 'Elizabeth Marie' } }] }),
  'crawl4ai.google.serp.maps': () => ({ rows: [{ name: 'Some Cafe', place_id: 'P1', website: 'https://cafe.com' }] }),
  'treg.web.extract.structured': ({ body }) => ({ output: { data: { title: 'Acme Wool Runner', reviews: [{ author: 'Priya', rating: 5, text: `Really comfortable for daily wear ${hh(body.url)}`, date: '13/08/2026' }] } } }),
  'anyapi.x.search.posts': ({ body }) => ({ output: { data: { items: /conversation_id/.test(body.query) ? [{ id: '800', text: 'my question', createdUtc: T }, { id: '900', text: 'I switched to wool sneakers and my feet sweat much less now', createdUtc: T + 3600, authorName: 'Ana B', conversationId: '800', isReply: true, url: 'https://x.com/a/status/900' }] : [] } } })
};
const fakeTreg = (fix = FIX, price = 0.002) => { const t = { live: true, calls: [], meter: { usd: 0 } }; t.call = async (id, o) => { t.calls.push(id); t.meter.usd += price; if (!fix[id]) throw new Error(`treg ${id} 404: not in fixtures`); return fix[id](o); }; return t; };
const PROFILE = { name: 'Acme', host: 'acme.com', country: 'US', category: 'sneakers', rivals: [{ name: 'Rival', host: 'rival.com' }],
  socials: { instagram: { handle: 'acme', posts: [{ url: 'https://www.instagram.com/p/OWN1/', caption: 'New Acme sneakers drop', comments: 5 }] }, facebook: { url: 'https://www.facebook.com/acme' } } };
const brandPacks = async (profile = PROFILE) => { const p = memPacks(['acme-com']); await p.put('acme-com', 'profile.json', profile); await p.put('acme-com', 'config.json', { rivals: ['Rival'], terms: [['wool sneakers']] }); return p; };
const ALL = ['tiktok', 'instagram', 'youtube', 'trustpilot', 'news', 'web', 'facebook', 'walmart', 'google', 'nykaa', 'threads', 'telegram'];

test('normalizers: each source row becomes one item with display fields and no vendor names', () => {
  const v = NORM.tiktokVideo({ aweme_id: '7695', desc: 'Holiday sets from @Glossier. Best ones yet', create_time: 1791857681, author: { nickname: 'Hannah Fosbenner', unique_id: 'glow' }, statistics: { digg_count: 1374, comment_count: 15 } }, 'brand');
  assert.deepEqual([v.id, v.platform, v.kind, v.link, v.author, v.replies, v.sub, v.q, v.postedAt], ['tt:7695', 'tiktok', 'post', 'https://www.tiktok.com/@glow/video/7695', 'Hannah F.', 15, '@glow', 'brand', 1791857681000]);
  const c = NORM.tiktokComment({ cid: '9', text: 'Them ignoring Reve is annoying', create_time: 1791875458, digg_count: 33, user: { nickname: 'coco' } }, v);
  assert.equal(c.thread, v.thread); assert.equal(c.threadUrl, v.link); assert.equal(c.kind, 'comment');
  const yt = NORM.ytComment({ comment_id: 'Ugx', text: 'Glossier missed the mark', published: '3 years ago', likes: 579, replies: 9, author: { name: '@SI-ps9ii' } }, { id: 'JWg', title: 'watch this', channel: 'Jamie' }, NOW);
  assert.ok(Math.abs(yt.postedAt - (NOW - 3 * 365 * DAY)) < DAY, 'relative dates become times'); assert.equal(yt.link, 'https://www.youtube.com/watch?v=JWg&lc=Ugx');
  const rd = NORM.redditApp({ id: 't3_1x2', createdAt: '2026-10-10T10:00:53.751000+0000', postTitle: 'what keeps you coming back?', permalink: '/r/glossier/comments/1x2/what/', content: { markdown: 'nostalgia' }, score: 62, commentCount: 88, authorInfo: { name: 'Mission_Land' }, subreddit: { prefixedName: 'r/glossier' } }, 'brand');
  assert.deepEqual([rd.id, rd.sub, rd.replies, rd.thread, rd.link], ['rd:t3_1x2', 'r/glossier', 88, '1x2', 'https://www.reddit.com/r/glossier/comments/1x2/what/']);
  const li = NORM.linkedinPost({ id: '75', authorName: 'Pierrick Nonnis', text: 'Glossier built a brand', createdUtc: 1791530161, reactionCount: 66, commentCount: 14, url: 'https://www.linkedin.com/posts/x' }, 'brand');
  assert.equal(li.author, 'Pierrick N.'); assert.equal(li.replies, 14);
  const th = NORM.threadsPost({ pk: '400', caption: { text: 'Glossier You body butter' }, taken_at: 1791940776, like_count: 319, user: { username: 'nerd', full_name: 'Carlee Ann' }, url: 'https://www.threads.com/@nerd/post/D' }, 'brand');
  assert.equal(th.platform, 'threads'); assert.equal(th.text, 'Glossier You body butter');
  const tp = NORM.trustpilot({ review_id: '6ab', author: 'Isabelle Parker', date: '2026-09-24T18:31:10.000Z', rating: 3, title: 'Slow refund', text: 'The refund took weeks', url: 'https://www.trustpilot.com/reviews/6ab' }, { domain: 'glossier.com', q: 'brand' });
  assert.deepEqual([tp.kind, tp.rating, tp.author], ['review', 3, 'Isabelle P.']);
  const gm = NORM.gmaps({ review_id: 'Ci9', rating: 5, user: { name: 'Sarah Yoon' }, iso_date: '2026-03-11T06:51:54Z', snippet: 'Marissa was so kind' }, { name: 'Glossier Las Vegas', url: 'https://maps/x' });
  assert.equal(gm.platform, 'google'); assert.equal(gm.sub, 'Glossier Las Vegas');
  const nw = NORM.news({ title: 'Can the OG Glossier Playbook Still Work?', snippet: 'Glossier was the blueprint', url: 'https://www.thecut.com/article/g.html', publisher: 'The Cut', date: 'Jul 29, 2026' }, 'brand');
  assert.deepEqual([nw.platform, nw.sub, nw.kind], ['news', 'The Cut', 'article']); assert.ok(nw.postedAt > 0);
  const wb = NORM.web({ title: 'Is Glossier worth the hype?', snippet: 'Yes', url: 'https://www.quora.com/Is-Glossier-worth-the-hype?srsltid=abc' }, 'brand');
  assert.equal(wb.sub, 'quora.com'); assert.equal(wb.link, 'https://www.quora.com/Is-Glossier-worth-the-hype');
  const ny = NORM.review({ review_id: 'n1', name: 'Priya S', rating: '5', description: 'Reduced my hair fall', created_on: 'x', date: '24/10/2023' }, { platform: 'nykaa', url: 'https://www.nykaa.com/x/reviews/1', title: 'Super Shampoo', now: NOW });
  assert.deepEqual([ny.id, ny.platform, ny.rating, ny.text, ny.postedAt], ['nykaa:n1', 'nykaa', 5, 'Reduced my hair fall', Date.UTC(2023, 9, 24)]);
  const fb = NORM.fbComment({ id: 'Y29', text: 'Ooooh I would like the boy brow', created_at: '2026-06-15T05:07:01.000Z', reply_count: 0, reaction_count: 1, author: { name: 'Elizabeth Marie Swaggerty' } }, { threadUrl: 'https://www.facebook.com/glossier/posts/p', thread: 'fb-1', sub: 'Glossier', q: 'owned', acct: 'own' });
  assert.equal(fb.author, 'Elizabeth M.'); assert.equal(fb.acct, 'own');
  for (const x of [v, c, yt, rd, li, th, tp, gm, nw, wb, ny, fb]) assert.ok(!VENDOR.test(JSON.stringify(x)), `no vendor names in ${x.id}`);
  for (const [id, s] of Object.entries(SOURCES)) { assert.ok(s.name && !VENDOR.test(`${s.name} ${s.how}`), id); assert.equal(sourceName(id), s.name); }
  assert.deepEqual(['TikTok', 'Instagram comments', 'Nykaa reviews', 'Web & forums', 'Google reviews'], ['tiktok', 'instagram', 'nykaa', 'web', 'google'].map(sourceName));
  assert.deepEqual(['https://www.reddit.com/r/a/comments/b/', 'https://x.com/a/status/1', 'https://www.tiktok.com/@a/video/1', 'https://youtu.be/abcdefg', 'https://example.com'].map(platformOf), ['reddit', 'x', 'tiktok', 'youtube', 'web']);
});

test('a run reads every source by default, tags mode=heard, counts own and rival accounts, writes history, and stays under the cap', async () => {
  delete process.env.YOUTUBE_API_KEY;
  const packs = await brandPacks(), treg = fakeTreg(), W = createListenWatch({ slug: 'acme-com', packs, treg, ai: { live: false }, apify: null, log: quiet, now: () => NOW });
  const r = await W.run({ only: ALL });
  const st = r.status.sources;
  for (const k of ['tiktok', 'instagram', 'youtube', 'trustpilot', 'news', 'web', 'facebook', 'walmart', 'threads']) assert.equal(st[k].state, 'ok', `${k}: ${st[k].error || ''}`);
  assert.equal(st.google.state, 'needs'); assert.match(st.google.error, /no Google Maps places/);
  assert.equal(st.nykaa.state, 'needs'); assert.match(st.nykaa.error, /not sold in India/);
  assert.equal(st.telegram.state, 'needs'); assert.equal(st.threads.kept, 0, 'fixture has no threads: nothing kept'); assert.equal(st.reddit.state, 'off');
  assert.ok(Object.values(st).every((s) => !VENDOR.test(`${s.name}`)));
  assert.ok(r.items.length >= 15, `items ${r.items.length}`); assert.ok(r.items.every((x) => x.mode === 'heard'));
  const by = (p) => r.items.filter((x) => x.platform === p);
  assert.ok(by('tiktok').some((x) => x.kind === 'comment' && x.about === 'brand'), 'TikTok comments on brand videos');
  assert.ok(by('tiktok').some((x) => x.q === 'rival' && x.about === 'rival') && by('tiktok').some((x) => x.q === 'category'));
  const own = by('instagram').find((x) => x.acct === 'own'); assert.ok(own && own.about === 'brand' && own.q === 'owned', 'comments on the brand\'s own post');
  assert.ok(by('facebook').some((x) => x.acct === 'rival' && x.about === 'rival' && x.sub === 'Rival'), 'rival page from the ad library, not an unrelated page');
  assert.ok(!by('facebook').some((x) => /Shopify1Percent/.test(x.sub)));
  assert.deepEqual(by('trustpilot').map((x) => x.about).sort(), ['brand', 'rival']);
  assert.ok(by('web').every((x) => x.sub === 'quora.com'), "the brand's own site is not a forum");
  assert.equal(by('walmart')[0].rating, 4); assert.ok(by('youtube').length >= 1 && by('news').length >= 1);
  assert.ok(r.status.usd.treg > 0 && r.status.usd.treg <= 0.6); assert.equal(r.status.capUsd, 0.6);
  assert.ok(!treg.calls.some((id) => /^scrapecreators\.reddit/.test(id)), 'no old reddit endpoint');
  const h = JSON.parse(packs.files.get('acme-com/listen/history/2026-10-14.json'));
  assert.equal(h.total, r.items.length); assert.equal(h.byMode.heard, r.items.length); assert.equal(h.byMode.asked, 0); assert.ok(h.bySource.tiktok >= 2);
  assert.deepEqual(JSON.parse(packs.files.get('acme-com/listen/history/index.json')).dates, ['2026-10-14']);
  // a tiny cap stops paid reads early and says so
  const t2 = fakeTreg(), W2 = createListenWatch({ slug: 'acme-com', packs: await brandPacks(), treg: t2, ai: { live: false }, apify: null, log: quiet, now: () => NOW });
  const r2 = await W2.run({ only: ['tiktok', 'instagram'], capUsd: 0.003 });
  assert.ok(t2.calls.length < treg.calls.length); assert.ok(Object.values(r2.status.sources).some((s) => s.notes.some((n) => /cap/.test(n)) || /cap/.test(s.error || '')));
  // paid off: only free sources run
  const r3 = await createListenWatch({ slug: 'acme-com', packs: await brandPacks(), treg: fakeTreg(), ai: { live: false }, apify: null, log: quiet, now: () => NOW }).run({ only: ['tiktok', 'news'], paid: false });
  assert.equal(r3.status.sources.tiktok.state, 'off'); assert.match(r3.status.sources.tiktok.error, /LISTEN_PAID=0/); assert.equal(r3.status.sources.news.state, 'ok');
});

test('Indian marketplaces: Apify when there is a token, a page read when the actor gives nothing; spend is metered', async () => {
  const packs = await brandPacks({ ...PROFILE, country: 'IN', socials: {} }), runs = [];
  const apify = { live: true, meter: { usd: 0 }, run: async (actor, input) => { runs.push(actor); apify.meter.usd += 0.05;
    if (actor === 'stealth_mode/nykaa-reviews-scraper') return [{ review_id: 'n1', name: 'Priya S', rating: 5, title: 'Great', description: `Reduced my hair fall in a month (${input.product_id})`, date: '24/10/2025' }];
    if (actor === 'codingfrontend/myntra-product-search-scraper') return [{ productId: 'm9', productName: 'Acme Wool Runner', landingPageUrl: 'acme/9/buy', reviews: [{ id: 'mr1', userName: 'Rohan', rating: 4, review: 'Good fit and comfortable all day' }] }];
    return []; } };
  const W = createListenWatch({ slug: 'acme-com', packs, treg: fakeTreg(), ai: { live: false }, apify, log: quiet, now: () => NOW });
  const r = await W.run({ only: ['nykaa', 'flipkart', 'myntra', 'walmart'] }), st = r.status.sources;
  assert.equal(st.nykaa.state, 'ok'); assert.equal(st.nykaa.detail.via, 'apify'); assert.equal(st.flipkart.detail.via, 'page'); assert.equal(st.myntra.detail.via, 'apify');
  assert.equal(st.walmart.state, 'needs', 'Walmart is for US brands');
  const ny = r.items.find((x) => x.platform === 'nykaa'); assert.equal(ny.author, 'Priya S.'); assert.equal(ny.about, 'brand'); assert.match(ny.link, /nykaa\.com\/.+\/reviews\/555/);
  assert.ok(r.items.some((x) => x.platform === 'flipkart' && x.rating === 5)); assert.ok(r.items.some((x) => x.platform === 'myntra' && x.author === 'Rohan'));
  assert.ok(r.status.usd.treg >= 0.15, 'Apify spend counts toward the run'); assert.deepEqual(runs.sort(), ['codingfrontend/myntra-product-search-scraper', 'shahidirfan/flipkart-reviews-scraper', 'stealth_mode/nykaa-reviews-scraper']);
  // no token: every Apify run says so; the marketplace falls back to the page read
  const none = createApify({ token: null }); await assert.rejects(none.run('a/b', {}), /needs APIFY_TOKEN/); assert.equal(none.live, false);
  const r2 = await createListenWatch({ slug: 'acme-com', packs: await brandPacks({ ...PROFILE, country: 'IN' }), treg: fakeTreg(), ai: { live: false }, apify: none, log: quiet, now: () => NOW }).run({ only: ['nykaa'] });
  assert.equal(r2.status.sources.nykaa.detail.via, 'page'); assert.ok(r2.items.some((x) => x.platform === 'nykaa'));
});

test('apify client: one sync call per run, token in a header, estimated spend metered and capped', async () => {
  const seen = []; const A = createApify({ token: 'tok', fetchImpl: async (u, o) => { seen.push([u, o]); return { ok: true, status: 200, text: async () => JSON.stringify([{ a: 1 }, { a: 2 }]) }; } });
  const charged = []; A.onCharge((tag, usd) => charged.push([tag, usd]));
  const xs = await A.run('stealth_mode/nykaa-reviews-scraper', { product_id: '1' }, { startUsd: 0.005, perItemUsd: 0.01, maxUsd: 0.2, tag: 'listen-x' });
  assert.equal(xs.length, 2); assert.match(seen[0][0], /acts\/stealth_mode~nykaa-reviews-scraper\/run-sync-get-dataset-items\?.*maxTotalChargeUsd=0\.2/); assert.ok(!/tok/.test(seen[0][0]), 'token never in the URL');
  assert.equal(seen[0][1].headers.authorization, 'Bearer tok'); assert.equal(A.meter.usd, 0.025); assert.deepEqual(charged, [['listen-x', 0.025]]);
  const B = createApify({ token: 'tok', fetchImpl: async () => ({ ok: false, status: 402, text: async () => '{"error":{"message":"no credit"}}' }) }); await assert.rejects(B.run('a/b'), /402: no credit/);
});

test('asked threads: registered once, re-read 1, 3, 7 and 14 days after posting, replies tagged mode=asked with the move, then done', async () => {
  let t = NOW; const packs = await brandPacks(), treg = fakeTreg();
  const W = createListenWatch({ slug: 'acme-com', packs, treg, ai: { live: false }, apify: null, log: quiet, now: () => t });
  assert.match((await W.addAsked({ moveId: 'm07', url: 'nope' })).error, /needed/);
  const a = await W.addAsked({ moveId: 'm07', url: 'https://www.reddit.com/r/Sneakers/comments/abc123/which_wool_sneaker/' });
  assert.equal(a.asked.platform, 'reddit'); assert.equal((await W.addAsked({ moveId: 'm07', url: a.asked.url })).already, true);
  await W.addAsked({ moveId: 'm07', url: 'https://x.com/acme/status/800' }); await W.addAsked({ moveId: 'm09', url: 'https://www.pinterest.com/pin/1/', platform: 'pinterest' });
  let r = await W.askedRun(); assert.equal(r.read, 0, 'nothing is due on the day it was posted');
  const fetch0 = globalThis.fetch, got = [];
  globalThis.fetch = async (u) => { got.push(String(u)); return { ok: true, status: 200, json: async () => [{ data: { children: [{ data: { id: 'abc123', title: 'Which wool sneaker for summer?', subreddit: 'Sneakers' } }] } },
    { data: { children: [{ kind: 't1', data: { id: 'k1', body: 'Acme breathes better than anything else I own', author: 'sole_mate', created_utc: T, score: 4, subreddit: 'Sneakers', permalink: '/r/Sneakers/comments/abc123/x/k1/', replies: { data: { children: [{ kind: 't1', data: { id: 'k2', body: 'Agreed, but the Rival pair lasted longer for me', author: 'b', created_utc: T, score: 1, subreddit: 'Sneakers', permalink: '/r/Sneakers/comments/abc123/x/k2/' } }] } } } }, { kind: 't1', data: { id: 'k3', body: '[removed]' } }] } }] }; };
  try { t = NOW + 1.2 * DAY; r = await W.askedRun(); } finally { globalThis.fetch = fetch0; }
  assert.equal(r.read, 3); assert.match(got[0], /which_wool_sneaker\.json\?limit=500/);
  const m7 = r.moves.find((m) => m.moveId === 'm07'); assert.equal(m7.replies, 3, 'two Reddit replies (nested too) and one X reply'); assert.equal(m7.done, false);
  const asked = JSON.parse(packs.files.get('acme-com/listen/asked.json'));
  assert.ok(asked.find((x) => x.platform === 'pinterest').done, 'a platform we cannot read yet stops quietly'); assert.match(asked.find((x) => x.platform === 'pinterest').error, /not read yet/);
  const items = JSON.parse(packs.files.get('acme-com/listen/items.json')).items;
  assert.equal(items.length, 3); assert.ok(items.every((x) => x.mode === 'asked' && x.askedFor === 'm07'));
  assert.ok(items.some((x) => x.id === 'x:900') && items.some((x) => x.id === 'rd:t1_k2'));
  assert.ok(!W.askedDue(asked[0], NOW + 2 * DAY), 'read on day 1: next read on day 3'); assert.ok(W.askedDue(asked[0], NOW + 3.1 * DAY));
  // a heard run later keeps the asked replies (never dropped by the filter) and the history counts them apart
  t = NOW + 2 * DAY; const run = await W.run({ only: ['news'] });
  assert.equal(run.items.filter((x) => x.mode === 'asked').length, 3); assert.ok(run.items.some((x) => x.mode === 'heard'));
  const h = JSON.parse(packs.files.get(`acme-com/listen/history/${new Date(t).toISOString().slice(0, 10)}.json`)); assert.equal(h.byMode.asked, 3);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [{ data: { children: [{ data: { id: 'abc123' } }] } }, { data: { children: [] } }] });
  try { t = NOW + 15 * DAY; await W.askedRun(); } finally { globalThis.fetch = fetch0; }
  assert.ok(JSON.parse(packs.files.get('acme-com/listen/asked.json')).filter((x) => x.moveId === 'm07').every((x) => x.done), 'after the 14-day read the thread is done');
  t = NOW + 30 * DAY; assert.equal((await W.askedRun()).read, 0);
});

test('history: one file a day, read back by window; heard facets by source, mode, theme with offset paging; the wall view', async () => {
  let t = NOW; const packs = await brandPacks(), W = createListenWatch({ slug: 'acme-com', packs, treg: fakeTreg(), ai: { live: false }, apify: null, log: quiet, now: () => t });
  await W.run({ only: ['tiktok', 'news'] }); t = NOW + DAY; await W.run({ only: ['tiktok', 'news', 'web'] });
  let h = await W.history({ days: 90 }); assert.equal(h.days.length, 2); assert.ok(h.days[1].total >= h.days[0].total); assert.equal(h.days[0].day, '2026-10-14');
  t = NOW + 60 * DAY; h = await W.history({ days: 30 }); assert.equal(h.days.length, 0, 'outside the window');
  // give a few items themes and an asked reply, then slice
  const st = JSON.parse(packs.files.get('acme-com/listen/items.json')); st.items.forEach((x, i) => { x.themes = [i % 2 ? 'sizing' : 'price']; x.intent = i % 3 ? 'other' : 'question'; });
  st.items[0].mode = 'asked'; st.items[0].askedFor = 'm07'; await packs.put('acme-com', 'listen/items.json', st);
  const N = st.items.length, all = await W.heard({ limit: 2 });
  assert.equal(all.n, N); assert.equal(all.total, N); assert.equal(all.items.length, 2);
  const page2 = await W.heard({ limit: 2, offset: 2 }); assert.notEqual(page2.items[0].id, all.items[0].id);
  assert.ok(all.facets.source.every((s) => s.name === sourceName(s.id))); assert.deepEqual(all.facets.mode.map((m) => m.k).sort(), ['asked', 'heard']);
  const tk = await W.heard({ src: 'tiktok' }); assert.ok(tk.items.every((x) => x.platform === 'tiktok')); assert.ok(tk.facets.source.length > 1, 'the source facet ignores its own filter');
  const ask = await W.heard({ mode: 'asked' }); assert.equal(ask.n, 1); assert.equal(ask.items[0].askedFor, 'm07');
  assert.equal((await W.heard({ mode: 'heard' })).n, N - 1);
  const v = await W.itemsView({ theme: 'sizing', limit: 3 });
  assert.equal(v.total, st.items.filter((x) => x.themes.includes('sizing')).length); assert.ok(v.items.length <= 3);
  for (const it of v.items) { for (const k of ['id', 'source', 'sourceName', 'author', 'quote', 'link', 'mode']) assert.ok(it[k] != null, k); assert.ok(!VENDOR.test(JSON.stringify(it))); }
  assert.ok(v.sources.every((s) => s.id && s.name && s.n > 0)); assert.deepEqual(Object.keys(v.modes).sort(), ['asked', 'heard']); assert.ok(v.themes.some((x) => x.name === 'sizing'));
});

test('What we heard counts: sources by display name sorted by count, total and how it was heard', () => {
  const items = [...LISTEN.items, { id: 'tt:1', platform: 'tiktok', text: 'a b c d' }, { id: 'tt:2', platform: 'tiktok', text: 'a b c d', mode: 'asked', askedFor: 'm1' }, { id: 'tt:3', platform: 'tiktok', text: 'e f g h' }, { id: 'ny:1', platform: 'nykaa', text: 'ok' }];
  const v = heardView({ ...LISTEN, items }, { name: 'Acme' });
  assert.deepEqual(v.sources, [{ id: 'reddit', name: 'Reddit', n: 3 }, { id: 'tiktok', name: 'TikTok', n: 3 }, { id: 'nykaa', name: 'Nykaa reviews', n: 1 }].sort((a, b) => b.n - a.n));
  assert.equal(v.total, 7); assert.deepEqual(v.byMode, { heard: 6, asked: 1 }); assert.equal(v.items, 120, 'the existing count stays');
  assert.ok(v.themes.length && v.questions.length && v.communities.length);
});

test('asked Reddit thread: when Reddit refuses the free read, the paid comments read answers', async () => {
  const fix = { ...FIX, 'tikhub.x.reddit-app-fetch-post-comments': ({ query }) => ({ data: { postInfoById: { postTitle: 'Which wool sneaker?', subreddit: { prefixedName: 'r/Sneakers' }, commentForest: { trees: [
    { depth: 0, node: { id: 't1_pe1', createdAt: '2026-10-05T17:18:37.024000+0000', permalink: `/r/Sneakers/comments/${query.post_id.slice(3)}/x/pe1/`, score: 2, authorInfo: { name: 'Poppi' }, content: { markdown: 'I ordered in July and finally asked for a refund in September' } } },
    { depth: 0, childCount: 22, more: { count: 22 } }] } } } }) };
  const packs = await brandPacks(), treg = fakeTreg(fix), W = createListenWatch({ slug: 'acme-com', packs, treg, ai: { live: false }, apify: null, log: quiet, now: () => NOW + 2 * DAY });
  await W.addAsked({ moveId: 'm1', url: 'https://www.reddit.com/r/Sneakers/comments/abc123/which/', postedAt: NOW });
  const fetch0 = globalThis.fetch; globalThis.fetch = async () => ({ ok: false, status: 403 });
  let r; try { r = await W.askedRun(); } finally { globalThis.fetch = fetch0; }
  assert.equal(r.moves[0].replies, 1); assert.ok(treg.calls.includes('tikhub.x.reddit-app-fetch-post-comments'));
  const it = JSON.parse(packs.files.get('acme-com/listen/items.json')).items[0];
  assert.deepEqual([it.id, it.sub, it.mode, it.askedFor, it.author], ['rd:t1_pe1', 'r/Sneakers', 'asked', 'm1', 'Poppi']);
});
