// node --test test/  — moves on a cadence (moves-cadence.js) and first drafts in the background (drafts-bg.js), free:
// no AI (a fake ai returns canned JSON), no network. Move shape, numbering after 50, sourcing and the number check;
// the scorecard; scheduler gating, caps and the team-only route; draft-job selection, caching and seeding the jam.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditScorecard, listenDigest, automationContext, evidenceFor, nextNumbers, shapeMove, writeFamily, movesDue, movesConfig, createMovesScheduler, tagCards, weekKey, FAMILIES } from '../moves-cadence.js';
import { pickTopCards, draftFormat, draftKind, draftKey, draftsDue, draftsConfig, createDraftsBg, seedDrafts, cardKey, cardBriefText } from '../drafts-bg.js';
import { createPacks } from '../brand-pack.js';

const H = 3600e3, DAY = 24 * H, NOW = Date.parse('2026-10-14T12:00:00Z');
const quiet = { warn: () => {}, info: () => {}, log: () => {}, error: () => {} };
const PROFILE = {
  name: 'Acme', host: 'acme.com', country: 'US', currency: 'USD', meta: { readAt: '2026-10-13T10:00:00Z' },
  catalog: { count: 4, products: [{ title: 'Runner', price: 98, inStock: true, images: ['a', 'b', 'c', 'd'], img: 'b/acme-com/a/runner.jpg' }, { title: 'Loafer', price: 120, inStock: false, images: ['a'] }, { title: 'Slide', price: 45, inStock: true, images: ['a', 'b'] }, { title: 'Sock', price: 12, inStock: true, images: [] }] },
  site: { pages: 300, sitemaps: [{ url: 'https://acme.com/sitemap_products_1.xml', pages: 4 }, { url: 'https://acme.com/sitemap_articles_1.xml', pages: 2 }], keyPages: ['https://acme.com/pages/faq', 'https://acme.com/pages/returns'],
    checkout: { walk: [{ step: 'Home', ok: true, url: 'https://acme.com/' }, { step: 'Cart', ok: true }, { step: 'Checkout entry', ok: false }], popups: [] }, tech: { klaviyo: false, chat: null, metaPixel: true } },
  search: { terms: ['best runners'], serp: [{ q: 'best runners', results: [{ domain: 'rival.com' }, { domain: 'acme.com' }] }, { q: 'cheap runners', results: [{ domain: 'rival.com' }] }] },
  ai: { score: { named: 5, of: 20, unbrandedNamed: 1, unbrandedOf: 14 }, answers: [{ tool: 'chatgpt', q: 'best everyday runner', branded: false, named: false, rivalsNamed: ['Rival'] }] },
  ads: { own: { live: 3, items: [{ days: 5, format: 'video' }, { days: 90, format: 'image' }] }, rivals: [{ name: 'Rival', live: 40 }] },
  socials: { instagram: { url: 'https://instagram.com/acme', handle: 'acme', posts: [{ at: '2026-10-10', likes: 100, comments: 4 }, { at: '2026-06-01', likes: 50, comments: 2 }] } },
  reviews: { total: 240, platforms: [{ name: 'judge.me', label: 'Judge.me', count: 240, rating: 4.6, url: 'https://acme.com/reviews' }], recent: [{ at: '2026-10-01', rating: 5 }, { at: '2026-07-01', rating: 2 }] }
};
const LEDGER = [{ key: 'reviews.total', label: 'Reviews on the site', v: '240', n: 240, src: 'Judge.me', url: 'https://acme.com/reviews', at: '2026-10-13' }, { key: 'catalog.count', label: 'Products', v: '4', n: 4, src: 'products.json', at: '2026-10-13' }];
const LISTEN = { status: { at: NOW - 2 * H, sources: { reddit: { name: 'Reddit', state: 'ok', kept: 80 } } }, total: 100,
  themes: [{ name: 'sizing', n: 40, pos: 10, neg: 25, neutral: 5, brand: 30, wow: { week: 4, lastWeek: 2 }, quoteIds: ['rd:t1'] }, { name: 'comfort', n: 30, pos: 25, neg: 2, neutral: 3, brand: 20, quote: 'So comfy', quoteLink: 'https://www.reddit.com/r/AcmeFans/comments/c/' }],
  threads: [{ url: 'https://www.reddit.com/r/AcmeFans/comments/abc/', where: 'r/AcmeFans', title: 'Does Acme run big?', intent: 'question', about: 'brand', replies: 14, lastActive: NOW - DAY, score: 9 }],
  communities: [{ name: 'r/AcmeFans', url: 'https://www.reddit.com/r/AcmeFans/', posts: 60, brand: 50, rival: 3, questions: 12, why: '50 about Acme' }],
  items: [{ id: 'rd:t1', platform: 'reddit', sub: 'r/AcmeFans', text: 'They run a full size big', link: 'https://www.reddit.com/r/AcmeFans/comments/abc/x/t1/' }] };

// a fake ai: answers each family with canned moves; counts calls and charges a fixed price
const fakeAI = (o = {}) => { const calls = []; return { live: true, calls, call: async (q) => { calls.push(q.tag); if (o.mock) throw Object.assign(new Error('AI is off (mock)'), { mock: true });
  const usd = o.usd ?? 0.2; if (q.tag === 'draft-bg') return { usd, json: { as: 'text', title: 'Ad: the runner', copy: 'Run further in the Runner.', visual: 'On a track at dawn', ratio: '4:5', note: 'Tries comfort first' } };
  const ev = [...q.prompt.matchAll(/\[(e\d+)\]/g)].map((m) => m[1]);
  const mv = (i) => ({ area: q.tag === 'moves-audit' ? 'seo' : q.tag === 'moves-listen' ? 'listen' : 'auto', skill: 'seo-audit', title: `Move ${q.tag} ${i}`, stat: i === 0 ? '240' : '999', statLabel: 'reviews', gives: 'More found.', live: 'Pages live.', why: 'Because 240 reviews say so.',
    found: [{ text: 'Rival is first for best runners', ev: [ev[0]] }, { text: 'Nothing backs this', ev: ['e999'] }], plan: [{ step: 'Write two guides', detail: 'One per search.' }], example: { title: 'Guide intro', label: 'page', body: 'Our Runner has 777 happy owners.' },
    measure: [{ metric: 'Searches ranked', baseline: '1 of 2', target: 'target 2 of 2', rule: 'keep if up' }], program: { name: 'Weekly sweep', trigger: 'Every Monday', repeat: 'weekly', steps: [{ title: 'List new questions', kind: 'check', day: 0, owner: 'brew', repeat: 'weekly' }] }, toConfirm: [] });
  return { usd, json: { moves: [mv(0), mv(1), mv(2), { ...mv(3), found: [{ text: 'cites nothing real', ev: ['e999'] }] }] } }; } }; };

test('the counted scorecard (evidence for automation moves): every read area scored from the pack, with sources; unread areas are not averaged', () => {
  const sc = auditScorecard({ profile: PROFILE, slug: 'acme-com', now: NOW });
  assert.equal(sc.areas.length, 7);
  for (const a of sc.areas.filter((x) => x.read)) { assert.ok(a.score >= 0 && a.score <= 100); assert.match(a.grade, /^[ABCD]$/); for (const p of a.parts) assert.ok(p.note && p.src, `${a.k}.${p.k} has a note and a source`); }
  const seo = sc.areas.find((a) => a.k === 'seo'); assert.ok(seo.parts.some((p) => /1 of 2 category searches/.test(p.note)));
  const ai = sc.areas.find((a) => a.k === 'ai'); assert.equal(ai.score, Math.round(100 * ((4 / 6) * 30 + (1 / 14) * 70) / 100));
  assert.equal(sc.weakest.length, 3); assert.ok(sc.areas.filter((a) => a.read).every((a) => sc.weakest.includes(a.k) || a.score >= Math.max(...sc.weakest.map((k) => sc.areas.find((x) => x.k === k).score))));
  const empty = auditScorecard({ profile: { name: 'X', host: 'x.com' }, now: NOW });
  assert.equal(empty.overall, null); assert.ok(empty.areas.every((a) => !a.read && a.grade === null));
});

test('listening digest keeps counts, sentiment, trend and real quotes with links; nothing heard → null', () => {
  const d = listenDigest(LISTEN, { now: NOW });
  assert.equal(d.themes[0].n, 40); assert.equal(d.themes[0].week, 4); assert.equal(d.themes[0].quotes[0].url, 'https://www.reddit.com/r/AcmeFans/comments/abc/x/t1/');
  assert.equal(d.themes[1].quotes[0].url, 'https://www.reddit.com/r/AcmeFans/comments/c/'); assert.equal(d.questions[0].replies, 14);
  assert.equal(listenDigest(null), null); assert.equal(listenDigest({ themes: [], threads: [] }), null);
  const ev = evidenceFor('listen', { listen: d, profile: PROFILE, ledger: LEDGER });
  assert.ok(ev.some((e) => /40 mentions/.test(e.text))); assert.ok(ev.filter((e) => /^Quote/.test(e.text)).every((e) => /^https:/.test(e.url)));
  const au = automationContext({ profile: PROFILE, listen: d }); assert.ok(au.routines.some((r) => r.k === 'reply-sweep')); assert.ok(au.routines.some((r) => r.k === 'review-ask' && /their email tool/.test(r.runs))); assert.ok(au.routines.every((r) => !/\bBrew (sends|runs|reads|lists)\b/.test(r.runs)), 'the team runs routines, never Brew'); assert.deepEqual(au.owners, ['you', 'team']);
});

test('numbering: cadence moves live at 1001 and up, after every cadence move, never reused', () => {
  const moves = Object.fromEntries([...Array(51).keys()].map((n) => [n, { n }]));
  assert.deepEqual(nextNumbers(moves, {}, 3), [1001, 1002, 1003], 'never a number the build specs (1-65) or dynamic specs (100-999) use');
  assert.deepEqual(nextNumbers({ 0: {}, 1: {}, 7: {} }, {}, 2), [1001, 1002], 'a partly built brand starts at 1001 too');
  assert.deepEqual(nextNumbers(moves, { nextN: 1008 }, 2), [1008, 1009], 'retired numbers are not handed out again');
  assert.deepEqual(nextNumbers({ ...moves, 1010: {} }, { nextN: 1005 }, 1), [1011]);
  assert.deepEqual(nextNumbers({ ...moves, 51: { meta: { cadence: true } }, 62: { meta: { cadence: true } } }, { nextN: 63 }, 2), [1001, 1002], 'a brand with old 51-62 cadence moves moves on to 1001');
});

test('a cadence move has the build-move shape, cites its evidence, and unbacked numbers become "to confirm"', () => {
  const ev = [{ id: 'e1', text: 'Reviews: 240 on Judge.me', src: 'Judge.me', url: 'https://acme.com/reviews', at: '2026-10-13' }, { id: 'e2', text: 'Search: in 1 of 2 category searches', src: 'Google', url: '' }];
  const raw = { area: 'seo', skill: 'seo-audit', title: 'Rank for runners', stat: '999', statLabel: 'things', gives: 'g', live: 'l', why: 'People found 777 reasons.', found: [{ text: 'In 1 of 2 searches', ev: ['e2'] }, { text: 'made up', ev: ['e9'] }], plan: [{ step: 'Write', detail: 'd' }], example: { title: 'Ex', label: '', body: 'b' }, measure: [{ metric: 'm', baseline: '1 of 2', target: 'target 2', rule: 'r' }], program: { name: '', steps: [] }, toConfirm: [] };
  const m = shapeMove({ ...raw, area: 'listen' }, { n: 53, family: 'listen', ev, ledger: LEDGER, at: '2026-10-14T00:00:00Z', run: 'listen-2026-10-14', usd: 0.1 });
  for (const k of ['n', 'group', 'kicker', 'title', 'stat', 'statLabel', 'gives', 'live', 'sections', 'sources', 'factsUsed', 'derived', 'newFacts', 'toConfirm', 'meta']) assert.ok(k in m, `has ${k}`);
  assert.equal(m.n, 53); assert.equal(m.family, 'listen'); assert.equal(m.group, 'listen');
  assert.deepEqual(m.sections.map((s) => s.kind), ['why', 'found', 'plan', 'examples', 'measure', 'sources']);
  for (const s of m.sections) for (const b of s.blocks) for (const f of ['t', 'text', 'items', 'ordered', 'head', 'rows', 'caption', 'title', 'label', 'body']) assert.ok(f in b, `block field ${f}`);
  assert.deepEqual(m.sections[1].blocks[0].items, ['In 1 of 2 searches'], 'a finding citing no real evidence is dropped');
  assert.deepEqual(m.factsUsed, ['e2']); assert.equal(m.sources.length, 1); assert.equal(m.meta.droppedFindings, 1);
  assert.match(m.sections[0].blocks[0].text, /777 \(to confirm\)/); assert.equal(m.stat, '', 'an unbacked cover stat is cleared'); assert.ok(m.toConfirm.length >= 2);
  assert.equal(m.meta.verified, false, 'not verified while a number is unbacked'); assert.equal(m.meta.cadence, true);
  assert.equal(shapeMove({ ...raw, found: [{ text: 'x', ev: ['e9'] }] }, { n: 54, family: 'listen', ev, ledger: LEDGER }), null, 'a move that cites nothing is not a move');
  const auto = shapeMove({ ...raw, area: 'auto', program: { name: 'Sweep', trigger: 'Every Monday', repeat: 'weekly', steps: [{ title: 'List', kind: 'check', day: 0, owner: 'brew', repeat: 'weekly' }] } }, { n: 55, family: 'auto', ev, ledger: LEDGER });
  assert.equal(auto.program, undefined, 'a routine is a plan, never a program Brew runs'); const rt = auto.sections.find((s) => s.h === 'The routine');
  assert.ok(rt); assert.match(rt.blocks[0].text, /The team runs it from the shared brief; Brew does not run it\./);
  const clean = shapeMove({ ...raw, stat: '240', why: 'Reviews say so.', example: null, found: [{ text: 'Reviews: 240 on Judge.me', ev: ['e1'] }] }, { n: 56, family: 'listen', ev, ledger: LEDGER });
  assert.equal(clean.meta.verified, true, 'verified when every number is in the evidence');
});

test('writeFamily numbers the surviving moves in order and skips listening when nothing was heard', async () => {
  const ai = fakeAI(); let k0 = 51;
  const r = await writeFamily('auto', { ai, slug: 'acme-com', pack: { profile: PROFILE, ledger: LEDGER }, log: quiet, now: NOW, numbers: (k) => Array.from({ length: k }, (_, i) => k0 + i) });
  assert.deepEqual(r.moves.map((m) => m.n), [51, 52, 53], 'the move that cited nothing is dropped and its number is not used');
  assert.ok(r.moves.every((m) => m.family === 'auto' && m.sources.length && !m.program));
  assert.equal(r.moves[0].stat, '240'); assert.equal(r.moves[1].stat, '');
  const none = await writeFamily('listen', { ai, slug: 'acme-com', pack: { profile: PROFILE, ledger: LEDGER, listen: null }, log: quiet, now: NOW, numbers: () => [] });
  assert.equal(none.moves.length, 0); assert.equal(ai.calls.filter((c) => c === 'moves-listen').length, 0, 'no AI call when nothing was heard');
});

test('gating: kill switch, mock, local servers, weekly cadence, a fresh read, and the weekly cap', () => {
  const cfg = movesConfig({}), st = { last: { listen: NOW - 2 * DAY, auto: NOW - 8 * DAY } };
  assert.deepEqual(movesDue({}, movesConfig({ MOVES_REFRESH_OFF: '1' }), { now: NOW, hasListen: true }).families, []);
  assert.deepEqual(movesDue({}, movesConfig({ AI_MOCK: '1' }), { now: NOW, hasListen: true, manual: true }).families, []);
  assert.deepEqual(movesDue({}, movesConfig({ RESEARCH_OFF: '1' }), { now: NOW, hasListen: true }).families, [], 'local: no background run');
  assert.deepEqual(movesDue({}, movesConfig({ RESEARCH_OFF: '1' }), { now: NOW, hasListen: true, manual: true }).families, ['listen', 'auto'], 'local: the manual route still works');
  assert.deepEqual(movesDue({}, movesConfig({ RESEARCH_OFF: '1', MOVES_BG: '1' }), { now: NOW, hasListen: true }).families, ['listen', 'auto']);
  assert.deepEqual(movesDue({}, cfg, { now: NOW, ready: false }).families, []);
  assert.deepEqual(movesDue(st, cfg, { now: NOW, hasListen: true }).families, ['auto'], 'listening written 2 days ago waits');
  assert.deepEqual(movesDue({ last: {} }, cfg, { now: NOW, hasListen: false }).families, ['auto'], 'no listening data, no listening moves');
  assert.ok(!movesDue({}, cfg, { now: NOW, hasListen: true }).families.includes('audit'), 'no audit moves');
  const spent = { ...st, spend: { week: weekKey(NOW), usd: 2.6 } };
  assert.deepEqual(movesDue(spent, cfg, { now: NOW, hasListen: true }).families, [], 'not enough of the $3 week left');
  assert.deepEqual(movesDue({ spend: { week: '2020-W01', usd: 99 } }, cfg, { now: NOW, hasListen: true }).families, ['listen', 'auto'], 'last week’s spend does not count');
  assert.equal(movesConfig({ MOVES_WEEK_CAP_USD: '5' }).weekCapUsd, 5);
});

async function brand(P, slug, { claimed = false } = {}) {
  const seed = { brand: { name: 'Acme', host: 'acme.com' }, lanes: { core: { name: 'Core' } }, laneImg: { core: 'b/acme-com/a/runner.jpg' }, roles: { founder: { title: 'Founder', sector: {}, type: {} } },
    posts: [{ id: 'm01-1', agent: 'brew', sector: 'signals', type: 'report', kind: 'rows', rows: [['a', 'b']], roles: ['founder'], title: 'Build card', sub: 'x', src: 'Move 01', time: '2 hr', cta: { label: 'Open' } }] };
  await P.put(slug, 'seed.json', seed); await P.put(slug, 'status.json', { name: 'Acme', ready: true }); await P.put(slug, 'config.json', { currency: 'USD' }); await P.put(slug, 'facts.json', {});
  await P.put(slug, 'profile.json', PROFILE); await P.put(slug, 'ledger.json', LEDGER); await P.put(slug, 'moves.json', Object.fromEntries([...Array(51).keys()].map((n) => [n, { n, title: `Build move ${n}`, sections: [] }])));
  for (const n of ['threads', 'themes', 'communities', 'items']) await P.put(slug, `listen/${n}.json`, { [n]: LISTEN[n], ...(n === 'themes' ? { total: 100 } : {}) });
  await P.put(slug, 'listen/status.json', LISTEN.status);
}
const fakeCardsGen = ({ ai }) => ({ fromMove: async (move) => { await ai.call({ tag: 'cards', prompt: '' }).catch(() => {}); return { cards: [{ id: `m${move.n}-1`, agent: 'brew', sector: 'signals', type: 'idea', kind: 'rows', rows: [['x', 'y']], roles: ['founder'], title: move.title, sub: 's', src: `Move ${move.n} · The plan`, time: '10 min', detail: { why: [], how: [] }, cta: { label: 'Open' } }], label: { short: 'short', line: 'line', heads: {} } }; } });

test('the scheduler writes moves into the pack, turns them into family-tagged cards, retires the last run and keeps the week’s spend', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-cadence-')); const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  await brand(P, 'acme-com');
  let t = NOW; const ai = fakeAI({ usd: 0.1 }), dropped = [], added = [];
  const S = createMovesScheduler({ packs: P, ai, cardsGen: fakeCardsGen, log: quiet, env: {}, now: () => t, onCards: (s, c) => added.push(...c), dropCards: (s, ids) => dropped.push(...ids) });
  const r = await S.runOne('acme-com', ['listen', 'auto']);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  const nums = r.written.map((w) => w.n); assert.deepEqual(nums, [1001, 1002, 1003, 1004, 1005, 1006]);
  const moves = await P.getJSON('acme-com', 'moves.json'); assert.ok(nums.every((n) => moves[n]?.family)); assert.ok(moves[50], 'build moves untouched');
  assert.ok(fs.existsSync(path.join(ROOT, '.brands/acme-com/moves/1001.json')));
  const seed = await P.getJSON('acme-com', 'seed.json'); const c1001 = seed.posts.find((c) => c.id === 'm1001-1');
  assert.equal(c1001.moveFamily, 'listen'); assert.match(c1001.src, /^Move 1001 · Listening · The plan$/); assert.deepEqual(c1001.badge, ['Listening move', 'info']); assert.equal(c1001.origin, 'cadence');
  assert.equal(added.length, 6);
  const st = await S.stateOf('acme-com'); assert.deepEqual(st.live.listen, [1001, 1002, 1003]); assert.equal(st.nextN, 1007); assert.ok(st.spend.usd > 0); assert.equal(st.runningAt, null, 'the run lock is released');
  assert.ok(await P.getJSON('acme-com', 'audit/scorecard.json'));
  // a week later: the listening family is rewritten, its old run retired (history kept, cards dropped), numbers go on from 1007
  t = NOW + 8 * DAY; const r2 = await S.runOne('acme-com', ['listen']);
  assert.deepEqual(r2.written.map((w) => w.n), [1007, 1008, 1009]);
  const m2 = await P.getJSON('acme-com', 'moves.json'); assert.ok(!m2[1001] && !m2[1002] && !m2[1003] && m2[1004] && m2[1007]);
  assert.ok(fs.readdirSync(path.join(ROOT, '.brands/acme-com/moves/history')).some((f) => f.startsWith('1001-')));
  const seed2 = await P.getJSON('acme-com', 'seed.json'); assert.ok(!seed2.posts.some((c) => c.id === 'm1001-1') && seed2.posts.some((c) => c.id === 'm1007-1'));
  assert.deepEqual(dropped.sort(), ['m1001-1', 'm1002-1', 'm1003-1']);
  // mock: nothing is written, nothing spent
  const S2 = createMovesScheduler({ packs: P, ai: fakeAI({ mock: true }), cardsGen: fakeCardsGen, log: quiet, env: {}, now: () => t });
  const r3 = await S2.runOne('acme-com', ['auto']); assert.equal(r3.written.length, 0); assert.equal(r3.usd, 0);
});

test('the weekly cap stops a run part way and the next family waits', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-cadence-cap-')); const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  await brand(P, 'acme-com');
  const S = createMovesScheduler({ packs: P, ai: fakeAI({ usd: 2.5 }), cardsGen: fakeCardsGen, log: quiet, env: { MOVES_WEEK_CAP_USD: '3' }, now: () => NOW });
  const r = await S.runOne('acme-com', ['listen', 'auto']);
  assert.ok(r.written.every((w) => w.family === 'listen')); assert.ok(r.errors.some((e) => /cap/.test(e.error)));
  const d = await S.due('acme-com'); assert.deepEqual(d.families, [], 'over the cap for this week');
});

test('POST /moves/refresh: only those who may make new work (gen), and it answers why when nothing runs', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-cadence-route-')); const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  await brand(P, 'acme-com');
  const run = async (viewer, env = {}) => { const S = createMovesScheduler({ packs: P, ai: fakeAI(), cardsGen: fakeCardsGen, log: quiet, env, now: () => NOW });
    const out = {}; const h = S.routes({ viewerOf: async () => viewer, readBody: async () => ({ families: ['listen'] }), send: (res, code, body) => Object.assign(out, { code, body }) });
    const handled = await h({ method: 'POST' }, {}, new URL('http://x/api/brands/acme-com/moves/refresh')); return { handled, ...out, S }; };
  const v = await run({ claimed: true, member: false, gen: false }); assert.equal(v.handled, true); assert.equal(v.code, 403); assert.equal(v.body.demo, true);
  const u = await run({ claimed: false, member: false, gen: false }); assert.equal(u.code, 403, 'an unclaimed brand is demo for another domain too');
  const m = await run({ claimed: true, member: true, gen: true }); assert.equal(m.code, 200); assert.equal(m.body.started, true); assert.deepEqual(m.body.families, ['listen']);
  const k = await run({ claimed: false, gen: true }, { MOVES_REFRESH_OFF: '1' }); assert.equal(k.body.started, false); assert.deepEqual(k.body.why, ['MOVES_REFRESH_OFF']);
  const mk = await run({ claimed: false, gen: true }, { AI_MOCK: '1' }); assert.equal(mk.body.started, false);
  await new Promise((r) => setTimeout(r, 50));
});

test('tagCards keeps the move number first and names the family', () => {
  const [c] = tagCards([{ id: 'm70-1', src: 'Move 70 · The routine', title: 't' }], { n: 70, family: 'auto' });
  assert.equal(c.src, 'Move 70 · Automation · The routine'); assert.deepEqual(c.badge, ['Automation move', 'info']); assert.equal(FAMILIES.auto.max, 4);
});

/* ---------- first drafts in the background ---------- */
const POSTS = [
  { id: 'build-moves', title: 'Writing your moves', kind: 'rows', type: 'report', time: '1 min' },
  { id: 'm51-1', origin: 'cadence', title: 'Fix the runner page', sub: 's', type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], src: 'Move 51 · Audit', time: '5 min', agent: 'creative', make: { format: 'single image ad', pieces: '1 ad' } },
  { id: 'm21-1', title: 'Make the reel', type: 'idea', kind: 'media', images: ['b/acme-com/a/runner.jpg'], src: 'Move 21', time: '1 hr', agent: 'creative', make: { format: 'reel' } },
  { id: 'm40-1', title: 'Win-back email', type: 'idea', kind: 'rows', rows: [['a', 'b']], src: 'Move 40', time: '2 hr', agent: 'crm', make: { format: 'email' } },
  { id: 'm05-1', title: 'Price report', type: 'report', kind: 'rows', rows: [['a', 'b']], src: 'Move 05', time: '3 hr', agent: 'brew' },
  { id: 'idea-1', title: 'Reddit reply', type: 'idea', kind: 'rows', stream: 'ideas', src: 'Ideas · Reddit reply', time: '2 hr', agent: 'visibility', post: { copy: 'It runs big.', media: { kind: 'none' } } },
  { id: 'heard-t-x', origin: 'listen', heard: { kind: 'theme' }, title: 'People talk about sizing', type: 'report', kind: 'rows', time: '1 hr' },
  { id: 'live-1', liveOnly: true, title: 'Live card', type: 'report', kind: 'rows', time: '1 min' },
  { id: 'm30-1', title: 'Page copy', type: 'idea', kind: 'media', images: ['x.jpg'], src: 'Move 30', time: '4 hr', agent: 'storefront' }];

test('draft job picks the top cards that have no draft, never progress, live or theme cards', () => {
  const top = pickTopCards(POSTS, { n: 6 });
  assert.equal(top.length, 6); assert.equal(top[0].id, 'm51-1', 'a fresh cadence move that asks for an asset leads');
  assert.ok(!top.some((c) => ['build-moves', 'heard-t-x', 'live-1'].includes(c.id)));
  const have = { 'm51-1': { k: 2, key: draftKey(POSTS[1]) } }; assert.ok(!pickTopCards(POSTS, { n: 6, have }).some((c) => c.id === 'm51-1'), 'a cached draft is not made again');
  const stale = { 'm51-1': { key: 'old' } }; assert.ok(pickTopCards(POSTS, { n: 6, have: stale }).some((c) => c.id === 'm51-1'), 'a draft for another move or format is made again');
  assert.equal(draftKind(POSTS[1]), 'image'); assert.equal(draftKind(POSTS[2]), 'video', 'a reel is drafted as a clip');
  assert.equal(draftKind(POSTS[3]), 'email'); assert.equal(draftKind(POSTS[4]), 'text'); assert.equal(draftKind(POSTS[5]), 'text');
  assert.equal(draftFormat(POSTS[2]), 'image', 'the cheapest form, for cards with no format, is unchanged');
  assert.match(cardBriefText(POSTS[1], { moveDocs: { 51: { title: 'Audit move', gives: 'g', sections: [{ kind: 'plan', blocks: [{ t: 'p', text: 'Write the guide' }] }] } } }), /From Move 51: Audit move[\s\S]*Write the guide/);
});

test('draft gating: kill switch, mock, local, the 3-day open window and the daily cap', () => {
  const cfg = draftsConfig({}), open = NOW - DAY;
  assert.equal(draftsDue({}, draftsConfig({ DRAFTS_BG_OFF: '1' }), { now: NOW, lastOpen: open }).ok, false);
  assert.equal(draftsDue({}, draftsConfig({ AI_MOCK: '1' }), { now: NOW, lastOpen: open }).ok, false);
  assert.equal(draftsDue({}, draftsConfig({ LIVE_OFF: '1' }), { now: NOW, lastOpen: open }).ok, false);
  assert.equal(draftsDue({}, draftsConfig({ LIVE_OFF: '1', DRAFTS_BG: '1' }), { now: NOW, lastOpen: open }).ok, true);
  assert.equal(draftsDue({}, cfg, { now: NOW, lastOpen: NOW - 4 * DAY }).ok, false);
  assert.equal(draftsDue({}, cfg, { now: NOW, lastOpen: 0 }).ok, false);
  assert.equal(draftsDue({ spend: { day: '2026-10-14', usd: 3.99 } }, cfg, { now: NOW, lastOpen: open }).ok, false, 'the $4 day is spent');
  assert.equal(draftsDue({ spend: { day: '2026-10-13', usd: 9 } }, cfg, { now: NOW, lastOpen: open }).ok, true);
  assert.equal(cfg.dayCapUsd, 4);
});

test('the draft job caches each draft per card, respects the cap, and the jam opens with it', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-drafts-')); const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  await brand(P, 'acme-com'); const seed = await P.getJSON('acme-com', 'seed.json'); seed.posts = POSTS; await P.put('acme-com', 'seed.json', seed);
  const imgs = [], saved = [];
  const mk = (env) => createDraftsBg({ packs: P, ai: fakeAI({ usd: 0.03 }), geminiImage: async (o) => { imgs.push(o); return Buffer.from('png'); }, saveGen: (name, buf) => saved.push(name), photoAsync: async () => { const f = path.join(ROOT, 'product.jpg'); fs.writeFileSync(f, 'jpg'); return f; },
    loadPack: (slug) => P.load(slug, { fresh: true }), lastOpenOf: async () => NOW - DAY, log: quiet, env, now: () => NOW });
  const J = mk({ DRAFTS_DAY_CAP_USD: '0.3' });
  const r = await J.runOne('acme-com');
  assert.ok(r.made.length >= 2, JSON.stringify(r)); assert.ok(r.usd <= 0.3 + 1e-9, `under the cap: ${r.usd}`);
  const cache = await J.cacheOf('acme-com'); assert.equal(cache['m51-1'].as, 'image'); assert.match(cache['m51-1'].image, /^gen\/[a-f0-9]{16}\.png$/); assert.equal(cache['m51-1'].key, draftKey(POSTS[1])); assert.equal(cache['m51-1'].key, 'm51-1|51|image');
  assert.ok(!Object.values(cache).some((d) => d.video), 'no clip without treg');
  assert.ok(imgs.length >= 1 && imgs.length === saved.length);
  const again = await J.runOne('acme-com'); assert.ok(!again.made?.some((m) => cache[m.cardId]), 'cached cards are not redone');
  // the pack carries the drafts; the jam made for the card starts with it
  P.drop('acme-com'); const p = await P.load('acme-com'); assert.ok(p.firstDrafts['m51-1']);
  const w = { id: 'wk1', cardId: 'm51-1' }; assert.equal(seedDrafts(w, POSTS[1], p.firstDrafts, { uid: () => 'dr1', at: NOW }), true);
  assert.equal(w.drafts[0].state, 'ready'); assert.equal(w.drafts[0].seeded, true); assert.equal(w.drafts[0].image, cache['m51-1'].image); assert.ok(!('key' in w.drafts[0]));
  const w2 = { id: 'wk2' }; assert.equal(seedDrafts(w2, { ...POSTS[1], title: 'A new title' }, p.firstDrafts), true, 'a card rewritten in the same format keeps its draft');
  const w4 = { id: 'wk4' }; assert.equal(seedDrafts(w4, { ...POSTS[1], make: { format: 'email' } }, p.firstDrafts), false, 'a card whose format changed does not get the old draft');
  const w3 = { id: 'wk3', drafts: [{ id: 'x' }] }; assert.equal(seedDrafts(w3, POSTS[1], p.firstDrafts), false, 'a jam with drafts keeps its own');
  // no product photo anywhere: words only, never an invented product
  { const imgs0 = []; const R2 = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-drafts-')); const P2 = createPacks({ ROOT: R2, PUB: path.join(R2, 'public'), bucket: null, gToken: null, log: quiet }); await brand(P2, 'nophoto-com'); const s2 = await P2.getJSON('nophoto-com', 'seed.json'); s2.posts = POSTS; await P2.put('nophoto-com', 'seed.json', s2);
    const J2 = createDraftsBg({ packs: P2, ai: fakeAI({ usd: 0.03 }), geminiImage: async (o) => { imgs0.push(o); return Buffer.from('png'); }, saveGen: () => {}, photoAsync: async () => null, loadPack: (slug) => P2.load(slug, { fresh: true }), lastOpenOf: async () => NOW - DAY, log: quiet, env: { DRAFTS_DAY_CAP_USD: '0.3' }, now: () => NOW });
    await J2.runOne('nophoto-com'); assert.equal(imgs0.filter((o) => !o.srcFile).length, 0, 'no image without a real product photo'); }
  // under mock and with the kill switch nothing runs
  assert.equal((await mk({ AI_MOCK: '1' }).runOne('acme-com', { manual: true })).made.length, 0);
  assert.equal((await mk({ DRAFTS_BG_OFF: '1' }).runOne('acme-com')).why, 'DRAFTS_BG_OFF');
});
