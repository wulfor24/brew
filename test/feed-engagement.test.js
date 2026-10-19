// node --test test/feed-engagement.test.js — the feed reacts to what a person does, and forgets on time (2026-10-17 audit):
// H1 "Remind me tomorrow" lifts a card for one day only; H2 an opened card sinks a day after its jam goes quiet, and only a heart or
// a real jam message lets a second card of the same move into the first screen; H3 "seen" counts days, not page redraws; H6 the
// first screen holds one card per near topic, 3 per agent, 2 per format; H7 saves are kept on the server for the person and lift
// cards like them. Free: pure helpers, then one local server run on a saved brand (skipped when .brands/ is not here).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { boostNow, healBoosts, seenDays, seenFatigue, pruneShown, agentShown, jamActivity, actedDecay, engagedIds, firstScreen, nearTitle } from '../feed-service.js';
import { createTuning, learnedSignals, noteTopics, tuneScore, cleanTuning } from '../member-tuning.js';
import { cardValue } from '../value.js';

const H = 3600e3, D = 24 * H, T0 = Date.parse('2026-10-17T06:00:00Z');
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/* ---------- H1 ---------- */
test('H1: Remind me tomorrow lifts a card for one day, then it is ranked like any other; old forever-boosts heal once', () => {
  assert.equal(boostNow({ v: 8, until: T0 + D }, T0), 8);
  assert.equal(boostNow({ v: 8, until: T0 + D }, T0 + D + 1), 0, 'the day is over');
  assert.equal(boostNow(8, T0), 0, 'a bare number is never read as a lift');
  const b = { old: 8, live: { v: 8, until: T0 + H }, gone: { v: 8, until: T0 - 1 }, junk: null };
  healBoosts(b, T0);
  assert.deepEqual(b.old, { v: 8, until: T0 + D }, 'a lift saved before the fix gets one last day');
  assert.ok(b.live && !('gone' in b) && !('junk' in b), 'expired and broken lifts are pruned');
  healBoosts(b, T0 + 2 * D); assert.deepEqual(b, {}, 'two days on, nothing lifts');
});

/* ---------- H2 ---------- */
test('H2: an opened card stays up a day, then sinks by 6 unless its jam is moving', () => {
  assert.equal(actedDecay(T0, 0, T0 + 20 * H), 0, 'opened this morning: still up');
  assert.equal(actedDecay(T0, 0, T0 + 25 * H), -6, 'a day later, nothing happened in its jam');
  const work = [{ cardId: 'a', thread: [{ from: 'system', body: 'Pat joined', at: T0 + 20 * H }], versions: [{ n: 1, at: T0 }] },
    { cardId: 'b', thread: [{ from: 'me', body: 'Make it warmer', at: T0 + 20 * H }], versions: [{ n: 1, at: T0 }] },
    { cardId: 'c', thread: [], versions: [{ n: 1, at: T0 }, { n: 2, at: T0 + 22 * H }] }, { cardId: 'd', discarded: 1, thread: [{ from: 'me', at: T0 + 30 * H }] }];
  const last = jamActivity(work);
  assert.equal(last.get('a') || 0, 0, '"joined" is not activity'); assert.equal(last.get('b'), T0 + 20 * H); assert.equal(last.get('c'), T0 + 22 * H); assert.ok(!last.has('d'), 'a discarded jam is not activity');
  assert.equal(actedDecay(T0, last.get('b'), T0 + 30 * H), 0, 'a message 10 hours ago keeps it up');
  assert.equal(actedDecay(T0, last.get('a'), T0 + 30 * H), -6);
  // only a heart or a real message unlocks the second card of a group in the first screen
  const eng = engagedIds(new Map([['h', 1]]), work);
  assert.deepEqual([...eng].sort(), ['b', 'h'], 'a heart and a person’s message; opening (a, c) is not enough');
  const g = (c) => c.g, cards = [{ id: 'a', g: 'm1', agent: 'x' }, { id: 'a2', g: 'm1', agent: 'y' }, { id: 'h', g: 'm2', agent: 'z' }, { id: 'h2', g: 'm2', agent: 'w' }];
  const out = firstScreen(cards, { groupOf: g, engaged: (id) => eng.has(id), size: 3 }).map((c) => c.id);
  assert.deepEqual(out, ['a', 'h', 'h2', 'a2'], 'the hearted move’s second card comes in; the opened one’s waits after the first screen');
});

/* ---------- H3 ---------- */
test('H3: seen counts distinct days in the last week (redraws count once), fades 1.5 a day after the first, at most 6', () => {
  const sameDay = [T0, T0 + 60e3, T0 + 2 * 60e3, T0 + H];
  assert.equal(seenDays(sameDay, T0 + 2 * H, dayOf), 1); assert.equal(seenFatigue(1), 0, 'one day seen: no fade');
  const week = [0, 1, 2, 3, 4, 5].map((d) => T0 - d * D);
  assert.equal(seenDays(week, T0 + H, dayOf), 6); assert.equal(seenFatigue(6), -6, 'capped at 6');
  assert.equal(seenFatigue(3), -3);
  assert.equal(seenDays([T0 - 8 * D, T0 - 9 * D], T0, dayOf), 0, 'older than a week does not count');
  const shown = { a: [T0 - 20 * D, T0 - H], b: [T0 - 15 * D] }; pruneShown(shown, T0);
  assert.deepEqual(shown, { a: [T0 - H] }, 'seen marks older than 14 days are dropped');
  const cards = new Map([['a', { agent: 'creative' }], ['b', { agent: 'creative' }], ['c', { agent: 'crm' }]]);
  assert.deepEqual(agentShown({ a: [T0 - H, T0 - 2 * D], b: [T0 - 2 * H], c: [T0 - 3 * D] }, cards, T0), { creative: 2 }, 'the agent count is the last 24 hours, once per rank');
});

/* ---------- H6 ---------- */
test('H6: the first screen has one card per near topic, at most 3 per agent and 2 per format; nothing is dropped', () => {
  const C = (id, title, agent, format) => ({ id, title, agent, ...(format ? { make: { format } } : {}) });
  const ranked = [C('1', 'Win hair fall searches with a hair fall page', 'visibility'), C('2', 'Hair fall searches: win them with a page', 'storefront'),
    C('3', 'Reel for the winter gift set', 'creative', 'reel'), C('4', 'Carousel of the bestsellers', 'creative', 'carousel ad'), C('5', 'Email the lapsed buyers', 'creative', 'email'),
    C('6', 'A fourth Creative card', 'creative'), C('7', 'Another reel on night routine', 'performance', 'reel'), C('8', 'A third reel for the launch week', 'crm', 'reel'), C('9', 'Price check on the store', 'storefront')];
  const out = firstScreen(ranked, { nearOf: (a, b) => nearTitle(a.title, b.title), size: 6 }).map((c) => c.id);
  assert.equal(out.length, ranked.length, 'every card is still in the feed');
  const head = out.slice(0, 6);
  assert.ok(!head.includes('2'), 'the same story told twice waits'); assert.ok(!head.includes('6'), 'a fourth Creative card waits'); assert.ok(!head.includes('8'), 'a third reel waits');
  assert.deepEqual(head, ['1', '3', '4', '5', '7', '9']);
  const seated = firstScreen(ranked, { nearOf: (a, b) => nearTitle(a.title, b.title), size: 6, seated: new Set([ranked[1]]) }).map((c) => c.id);
  assert.ok(seated.slice(0, 6).includes('2'), 'a seated card is never moved');
  assert.ok(nearTitle('Hair fall searches are rising', 'Rising hair fall searches') && !nearTitle('Hair fall searches are rising', 'Email the lapsed buyers'));
});

/* ---------- H7 ---------- */
const memPacks = () => { const m = new Map(); return { getJSON: async (s, f, d) => (m.has(`${s}/${f}`) ? JSON.parse(m.get(`${s}/${f}`)) : d), put: async (s, f, v) => { m.set(`${s}/${f}`, JSON.stringify(v)); } }; };
test('H7: a save is kept for the person (every device), never set by a client’s tuning, and counts like a heart', async () => {
  const packs = memPacks(), T = createTuning({ packs, now: () => T0 });
  await T.setSaved('acme', 'mb_1', 'm03-1', true); await T.setSaved('acme', 'mb_1', 'm07-1', true); await T.setSaved('acme', 'mb_1', 'm03-1', false);
  const T2 = createTuning({ packs }); /* another instance, another device: the same list */
  assert.deepEqual((await T2.get('acme', 'mb_1')).saved, ['m07-1']);
  await T2.put('acme', 'mb_1', { saved: ['hack'], topics: ['reels'] });
  assert.deepEqual((await T2.get('acme', 'mb_1')).saved, ['m07-1'], 'a client’s tuning write cannot set saves');
  assert.deepEqual(cleanTuning({}).saved, []);
  const cards = new Map([['a', { agent: 'creative', campaign: 'Gifting' }], ['b', { agent: 'creative', campaign: 'Gifting' }]]);
  const sig = learnedSignals({ feedback: [{ kind: 'heart', cardId: 'a' }], cards, saved: ['b'] });
  assert.ok(sig.some((x) => x.id === 'like:agent:creative' && x.n === 2), 'a heart and a save make a like signal');
  const viaFeedback = learnedSignals({ feedback: [{ kind: 'save', cardId: 'a' }, { kind: 'save', cardId: 'b' }, { kind: 'unsave', cardId: 'b' }], cards });
  assert.ok(!viaFeedback.some((x) => x.id === 'like:agent:creative'), 'an unsave takes it back');
  const fs0 = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.match(fs0, /savedOf\(t\)\.forEach\(\(id\) => liked\.set\(id, \(liked\.get\(id\) \|\| 0\) \+ 1\.5\)\)/, 'the ranker counts a save as 1.5 hearts');
});

test('H5 and M7: a Creative idea is worth 5, and the words of a person’s notes lift cards (down-voted notes never lift)', () => {
  assert.equal(cardValue({ id: 'w-c_1', campaign: 'New from your agents' }), 5);
  const nt = noteTopics(['We sell most gifting bundles in winter', 'Gifting works for us'], ['No discount cards please']);
  assert.ok(nt.up.includes('gifting') && !nt.up.includes('discount') && nt.down.includes('discount'));
  assert.ok(tuneScore(null, { title: 'A winter gifting reel' }, nt) > 0 && tuneScore(null, { title: 'A discount for the sale' }, nt) < 0);
  assert.equal(noteTopics([], []), null);
});

/* ---------- on a local server: snooze, open, seen and save end to end (AI mock, nothing spent) ---------- */
const SLUG = ['cozysnugglet-shop', 'gullylabs-com', 'arata-in'].find((s) => fs.existsSync(path.join('.brands', s, 'seed.json')));
test('on the server: a snooze lifts for a day, an opened card sinks after a quiet day, seen counts days, saves come back', { skip: !SLUG && 'no .brands/ here', timeout: 120e3 }, async () => {
  /* the brand's files are shared with anyone running Brew here: the test never opens a team jam (a heart marks a card acted too),
     and it takes back its one save before it stops */
  const PORT = 4560 + Math.floor(Math.random() * 30), TUNING = path.join('.brands', SLUG, 'private', 'tuning.json'), hadTuning = fs.existsSync(TUNING);
  const env = { ...process.env, PORT: String(PORT), AI_MOCK: '1', BUILD_RESUME_OFF: '1', HEAL_OFF: '1', RESEARCH_OFF: '1', LIVE_OFF: '1', TREG_OFF: '1', DRAFTS_BG_OFF: '1', FEED_SIGNIN: '0', DEV_MEMBER: '1' };
  let TID = '';
  delete env.K_SERVICE;
  const srv = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((ok, no) => { const tm = setTimeout(() => no(new Error('server did not start')), 40e3); srv.stdout.on('data', (d) => { if (/Brew Feed on/.test(String(d))) { clearTimeout(tm); ok(); } }); });
    const j = async (m, p, b) => (await fetch(`http://localhost:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', 'x-brand': SLUG, 'x-tenant': TID }, body: b ? JSON.stringify(b) : undefined })).json();
    TID = (await j('POST', `/api/tenants?brand=${SLUG}`, { snapshot: { onboarded: true } })).id;
    const f0 = await j('GET', `/api/tenants/${TID}/feed`); assert.ok(f0.order.length >= 4, `a feed: ${f0.order.length}`);
    assert.deepEqual(f0.saved, []); assert.ok(Array.isArray(f0.newIds));
    /* beyond the feed's own cards, only the ones the feed keeps on purpose (allCards): a jam that is open (the team's jams on this
       brand's shared files count), a pin, a save; never every card ever made */
    const jams = (() => { try { return JSON.parse(fs.readFileSync(path.join('.brands', SLUG, 'private', 'jams.json'), 'utf8')).work || []; } catch { return []; } })();
    const kept = new Set([...f0.order, ...(f0.pinned || []), ...(f0.saved || []), ...jams.map((w) => w.cardId).filter(Boolean)]);
    const extra = Object.keys(f0.cards).filter((id) => !kept.has(id));
    assert.deepEqual(extra, [], 'the payload holds the feed’s cards, not every card ever made');
    const sc = async () => (await j('GET', `/api/tenants/${TID}/feed`)).scores;
    const [snz, opened, seen] = f0.order.filter((id) => !f0.pinned.includes(id)).slice(-3);
    // H7: save on one workspace, the person's other workspace (another device) gets it back
    assert.deepEqual((await j('POST', `/api/cards/${encodeURIComponent(seen)}/feedback`, { kind: 'save' })).saved, [seen]);
    assert.deepEqual((await j('GET', `/api/tenants/${TID}/feed`)).saved, [seen]);
    // H3: three reports on one day count once; a report the next day counts a second day
    for (let i = 0; i < 3; i++) await j('POST', `/api/tenants/${TID}/events`, { shown: [seen, seen] });
    assert.equal((await sc())[seen]?.seen, 1, 'redraws on one day are one day');
    // H1 + H2: snooze one, act on another (a heart marks it acted, like opening its jam), then move a day on
    await j('POST', `/api/cards/${encodeURIComponent(snz)}/feedback`, { kind: 'snooze' });
    await j('POST', `/api/cards/${encodeURIComponent(opened)}/feedback`, { kind: 'heart' });
    await j('POST', `/api/tenants/${TID}/clock`, { days: 1 }); await j('POST', `/api/tenants/${TID}/events`, { shown: [seen] });
    let s = await sc();
    assert.equal(s[snz]?.boost, 8, 'the day after: back on top'); assert.equal(s[seen]?.seen, 2); assert.ok(s[seen].fatigue <= -1.5, `seen two days: ${s[seen].fatigue}`);
    await j('POST', `/api/tenants/${TID}/clock`, { days: 1 }); s = await sc();
    assert.equal(s[snz]?.boost || 0, 0, 'two days on, the lift is gone');
    assert.ok(s[opened]?.quiet && s[opened].fatigue <= -6, `acted on two days ago, nothing since: ${JSON.stringify(s[opened])}`);
    assert.deepEqual((await j('POST', `/api/cards/${encodeURIComponent(seen)}/feedback`, { kind: 'unsave' })).saved, [], 'the save is taken back');
  } finally { await new Promise((r) => { srv.once('exit', r); srv.kill(); setTimeout(r, 8000).unref?.(); }); /* it flushes on the way out: then leave the local brand and workspace files as they were */
    if (TID) fs.rmSync(path.join('.tenants', `${TID}.json`), { force: true });
    if (!hadTuning && fs.existsSync(TUNING)) { const all = JSON.parse(fs.readFileSync(TUNING, 'utf8')); if (Object.values(all).every((x) => !x.saved?.length && !x.topics?.length && !x.notes?.length && !x.ignored?.length && Object.values(x.weights || {}).every((w) => w === 'normal'))) fs.rmSync(TUNING, { force: true }); } }
});
