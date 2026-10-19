// The jam is the team's room (2026-10-17): one version history per change for the whole team, a remake or a first draft that
// stopped with the server says so instead of spinning, a video final is a video job, and the brief that is sent follows the
// version on the stage, with its reel. Free: no AI, no network, in-memory packs.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createJams } from '../jams.js';
import { addV, versionsOf, mergeVersions } from '../learn.js';
import { createRemix } from '../remix.js';
import { createJamBrief } from '../jam-brief.js';
import { briefParts } from '../brief-status.js';
import { runIn } from '../brand-ctx.js';

const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', sym: '$', config: { product: { noun: 'balm' } }, seed: { brand: { name: 'Acme', host: 'acme.com' } } };
const memPacks = () => { const D = new Map(), k = (s, n) => `${s}/${n}`; return { D, getJSON: async (s, n, d) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), JSON.stringify(o)); } }; };
const ws = (id) => ({ id, brandId: 'acme', work: [], changes: {}, cards: new Map() });
const tick = () => new Promise((ok) => setTimeout(ok, 0));

/* ---------- 1. one version history per change, for the whole team ---------- */
test('two teammates see one version history for a shared change; each workspace’s own copy moves in, merged by time', async () => {
  let req = null; const packs = memPacks(); const J = createJams({ packs, reqOf: () => req, bgMember: () => false, everyMs: 0, enabled: () => true }); await J.load('acme');
  const a = J.guard(ws('t_a')), b = J.guard(ws('t_b')), A = { member: true, email: 'a@acme.com', slug: 'acme' }, Bm = { member: true, email: 'b@acme.com', slug: 'acme' };
  /* before team jams shared versions: each browser kept its own history of the same change */
  a.vg = { ch_1: [{ id: 'ver_a1', n: 1, at: 100, snapshot: { title: 'First' } }, { id: 'ver_a2', n: 2, at: 300, snapshot: { title: 'A edit' } }], card_1: [{ id: 'ver_c', n: 1, at: 1 }] };
  b.vg = { ch_1: [{ id: 'ver_b2', n: 2, at: 200, snapshot: { title: 'B edit' } }] };
  req = A; a.changes.ch_1 = { id: 'ch_1', cardId: 'c1' };
  assert.deepEqual(versionsOf(a, 'ch_1').map((v) => v.id), ['ver_a1', 'ver_a2'], 'A’s own history moved into the team’s');
  req = Bm; assert.deepEqual(versionsOf(b, 'ch_1').map((v) => [v.id, v.n]), [['ver_a1', 1], ['ver_b2', 2], ['ver_a2', 3]], 'B’s history merged in by time and numbered again');
  assert.equal(a.vg.ch_1, undefined); assert.equal(b.vg.ch_1, undefined); assert.ok(a.vg.card_1, 'a card’s versions stay in the workspace');
  const v = addV(b, 'change', 'ch_1', { title: 'B again' }, { author: 'you' });
  req = A; assert.equal(versionsOf(a, 'ch_1').at(-1).id, v.id, 'a version B makes is A’s head too'); assert.equal(v.n, 4);
  /* a visitor (not on the team) keeps their own versions */
  const vis = J.guard(ws('t_v')); req = { member: false }; vis.changes.ch_9 = { id: 'ch_9' }; addV(vis, 'change', 'ch_9', { title: 'mine' });
  assert.equal(vis.vg.ch_9.length, 1); req = A; assert.equal(versionsOf(a, 'ch_9').length, 0);
  /* saved with the team's jams and read back by a fresh instance */
  await J.flush(); const saved = JSON.parse(packs.D.get('acme/private/jams.json')); assert.equal(saved.vg.ch_1.length, 4);
  const J2 = createJams({ packs, reqOf: () => A, everyMs: 0, enabled: () => true }); await J2.load('acme'); const z = J2.guard(ws('t_z'));
  assert.deepEqual(versionsOf(z, 'ch_1').map((x) => x.n), [1, 2, 3, 4]);
  assert.deepEqual(mergeVersions([{ id: 'x', at: 5 }], [{ id: 'x', at: 5 }, { id: 'y', at: 1 }]).map((x) => [x.id, x.n]), [['y', 1], ['x', 2]], 'the same version is never counted twice');
});

/* ---------- a studio on a bare workspace ---------- */
const studio = (extra = {}) => {
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, claudeTool: null, geminiImage: null, PUB: os.tmpdir(), LANE_PHOTO: {}, FACTS: {}, SEED: { connectors: {}, colleagues: [] }, AGENT: { creative: 'Creative' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => true, spend: () => true, uid: (p) => `${p}_${++n}`, now: () => Date.now(), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `$${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: { warn() {}, log() {} }, ...extra });
  const call = (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p));
  return { R, RMX, call };
};
const tenant = () => ({ id: 't_1', brandId: 'acme', cards: new Map([['c1', { id: 'c1', title: 'Warm paws all winter', sub: 'Lead with cold hands', agent: 'creative', sector: 'creatives' }]]), changes: {}, work: [], conn: {}, acted: new Set() });
const change = (id, x = {}) => ({ id, cardId: 'c1', agent: 'creative', action: 'creative.add_variants', actionLabel: 'Add to the live test', family: 'meta_ad', target: { conn: 'meta', name: 'Meta Ads', object: 'Test ad' }, scope: [{ n: 1, label: 'One ad' }], before: { title: 'Warm paws' }, after: { title: 'Warm paws' }, state: 'draft', thread: [], pkg: { headline: 'Warm paws', primaryText: 'Cold hands, sorted.', knobs: {} }, createdAt: 1, ...x });

/* ---------- 3. a remake (and a first draft) that stopped with the server ---------- */
test('after a restart a remake stops saying “being made” on every version that copied it, and the chat offers Make it again; a lost first draft says it is a starting point', async () => {
  const t = tenant(), draft = { as: 'video', rid: 'rk_1', remade: true, pending: true, script: [{ line: 'Cold hands?' }] };
  t.changes.ch_1 = change('ch_1', { remakePending: { as: 'video', at: 1, step: 'Animating it' }, pkg: { headline: 'Warm paws', knobs: {}, draft }, copyPending: Date.now() });
  t.vg = { ch_1: [{ id: 'v1', n: 1, at: 1, snapshot: { headline: 'Warm paws' } }, { id: 'v2', n: 2, at: 2, snapshot: { headline: 'Warm paws', draft } }, { id: 'v3', n: 3, at: 3, snapshot: { headline: 'Shorter', draft } }] };
  const { call } = studio(); /* a fresh instance: nothing is being made in this process */
  const r = await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  assert.equal(r.change.remakePending, null); assert.equal(r.change.pkg.draft.pending, false);
  assert.ok(versionsOf(t, 'ch_1').every((v) => !v.snapshot.draft?.pending), 'no version keeps spinning');
  const m = t.changes.ch_1.thread.find((x) => x.remakeAgain); assert.equal(m.remakeAgain, 'video'); assert.match(m.text, /reel stopped before it finished.*Make it again/);
  assert.equal(r.change.copyPending, false); assert.ok(t.changes.ch_1.thread.length >= 1);
  const t2 = tenant(); t2.changes.ch_2 = change('ch_2', { copyPending: Date.now() }); t2.vg = { ch_2: [{ id: 'w1', n: 1, at: 1, snapshot: {} }] };
  const r2 = await call('GET /api/changes/:chid', {}, t2, { chid: 'ch_2' });
  assert.equal(r2.change.copyPending, false); assert.ok(t2.changes.ch_2.thread.some((x) => x.rewrite && /starting point/.test(x.text)), 'the template never passes for the AI’s draft');
  const again = await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' });
  assert.equal(t.changes.ch_1.thread.filter((x) => x.remakeAgain).length, 1, 'said once'); assert.ok(again.change);
});

test('“three cuts of this ad” makes one new take (one, always); a community post is never remade with AI media', async () => {
  const t = tenant(); t.changes.ch_1 = change('ch_1'); const { call } = studio();
  await call('GET /api/changes/:chid', {}, t, { chid: 'ch_1' }); const before = versionsOf(t, 'ch_1').length;
  const r = await call('POST /api/changes/:chid/iterate', { message: 'Three cuts of this ad' }, t, { chid: 'ch_1' });
  assert.equal(versionsOf(t, 'ch_1').length, before + 1); assert.match(r.change.thread.at(-1).text, /^Redid it/);
  t.changes.ch_r = change('ch_r', { family: 'post', action: 'creative.reddit_post', pkg: { platform: 'Reddit', copy: 'Honest answer', knobs: {} } });
  const rr = await call('POST /api/changes/:chid/remake', { as: 'carousel' }, t, { chid: 'ch_r' });
  assert.match(rr.error, /real photos only/); assert.equal(rr.change.realOnly, true, 'the chips hide on it');
});

/* ---------- 4. a studio video final is a video job ---------- */
test('a video final in the studio is held in the video jobs: a read while it is made never calls it stopped, and an old error clears', async () => {
  let finish; const finals = { quote: async () => ({ credits: 0, provider: 'gemini', label: 'Gemini' }), run: () => new Promise((ok) => { finish = ok; }), status: async () => ({ ok: true }) };
  const t = tenant(); t.changes.ch_v = change('ch_v', { family: 'post', action: 'creative.short_video', pkg: { platform: 'Instagram', copy: 'Cold hands?', script: [{ beat: 'Hook', shot: 'Hands', line: 'Cold hands?' }], image: 'gen/frame.png', knobs: {} }, videoError: 'The video stopped before it finished. Make it again.' });
  const { call } = studio({ finals, sloosh: { listSpaces: async () => [] }, brandOfT: () => BRAND, slugOfT: () => 'acme' });
  await call('POST /api/changes/:chid/final/quote', {}, t, { chid: 'ch_v' });
  await call('POST /api/changes/:chid/final/run', {}, t, { chid: 'ch_v' });
  const mid = await call('GET /api/changes/:chid', {}, t, { chid: 'ch_v' });
  assert.ok(mid.change.videoPending, 'still being made (it used to be called stopped within seconds)'); assert.equal(mid.change.videoError, null);
  finish({ state: 'done', file: 'gen/final.mp4', provider: 'gemini' }); await tick(); await tick();
  const done = await call('GET /api/changes/:chid', {}, t, { chid: 'ch_v' });
  assert.equal(done.change.videoPending, null); assert.equal(done.change.pkg.video, 'gen/final.mp4'); assert.ok(done.change.versions.at(-1).final);
});

/* ---------- 5. the brief that is sent is the version on the stage, with its reel ---------- */
test('Send brief first brings the brief up to a changed head, and the assets carry the video and the slides', async () => {
  const t = tenant(), { RMX } = studio();
  const ch = change('ch_1', { headVersionId: 'v2', pkg: { headline: 'Cold hands, warm paws', primaryText: 'Ten minutes to warm.', image: 'gen/a.png', video: 'gen/clip.mp4', poster: 'gen/a.png', knobs: {},
    draft: { as: 'carousel', remade: true, rid: 'rk_1', images: ['gen/s1.png', 'gen/s2.png'], slides: [{ text: 'Cold hands?' }, { text: 'Warm paws' }] } } });
  t.changes.ch_1 = ch; t.vg = { ch_1: [{ id: 'v1', n: 1, at: 1, snapshot: {} }, { id: 'v2', n: 2, at: 2, snapshot: {} }] };
  const w = { id: 'wk_1', title: 'Warm paws', cardId: 'c1', changeId: 'ch_1', thread: [], versions: [{ n: 1, title: 'Warm paws' }], current: 1, stage: 'drafting', doc: null };
  t.work.push(w);
  const prompts = [];
  const JB = createJamBrief({ claudeTool: async (p, sc, mx, tag) => { prompts.push([tag, p]); return { reply: 'Matched v2', doc: '# Warm paws\n\n## The copy\n- **Headline:** Cold hands, warm paws\n\n## How we measure it\n- Orders, read on day 14\n\n## Who owns it\n- Owner: Ana\n\n## When\n- Goes live next week', next: [], plan: {}, measure: null }; },
    cardBrief: () => '', seatLine: () => '', isMock: () => false, spend: () => true, now: () => 1000, AGENT: {}, log: { warn() {} }, cardOf: (t0, id) => t0.cards.get(id), changeOf: (t0, w0) => t0.changes[w0.changeId], meOf: () => ({ email: 'ana@acme.com', name: 'Ana' }), onBriefSent: async () => true });
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn);
  JB.routes({ on, W: (t0, id) => t0.work.find((x) => x.id === id), say: (t0, w0, m) => w0.thread.push(m), move: (t0, w0, s) => (w0.stage = s), notify: () => {}, nextTicket: async () => 'BR-7',
    handoff: { build: async (t0, w0) => ({ links: { page: 'https://b.test/h/x' }, pkg: RMX.packageOf(t0, t0.changes[w0.changeId]), versions: [] }), text: () => 'text' } });
  await runIn(BRAND, () => R['POST /api/work/:wid/doc/sync']({ lazy: true, said: 'Shorter headline' }, t, { wid: 'wk_1' }));
  assert.equal(prompts.length, 0, 'an edit only notes what was asked: no AI');
  const r = await runIn(BRAND, () => R['POST /api/work/:wid/doc/ship']({ to: 'shopos', force: true }, t, { wid: 'wk_1' }));
  assert.equal(prompts.filter(([tag]) => tag === 'jam_doc').length, 1, 'one sync before it froze');
  assert.match(prompts[0][1], /is now v2 \(asked: “Shorter headline”\)/); assert.match(prompts[0][1], /Headline: Cold hands, warm paws/);
  assert.equal(w.doc.syncedHead, 'v2'); assert.match(w.jamBrief.md, /Cold hands, warm paws/); assert.equal(r.status, 'sent');
  const assets = w.jamBrief.context.pkg.assets;
  assert.ok(assets.some((a) => a.kind === 'video' && a.url === 'gen/clip.mp4'), 'the video is in the brief');
  assert.ok(assets.some((a) => /Carousel slide 2/.test(a.label) && a.url === 'gen/s2.png'), 'and every slide');
  const P = briefParts(w.jamBrief.context, w.jamBrief); assert.ok(P.assets.some((a) => a.url === 'gen/clip.mp4' && !a.image), 'the email links the video');
  await runIn(BRAND, () => R['POST /api/work/:wid/doc/ship']({ to: 'shopos', force: true }, t, { wid: 'wk_1' }));
  assert.equal(prompts.filter(([tag]) => tag === 'jam_doc').length, 1, 'the same head is never synced twice');
});

test('an image final with its words set in the picture is marked so nothing lays the same words over it; a new photo shows them again', async () => {
  const finals = { quote: async () => ({ credits: 2.01, provider: 'sloosh', label: 'Nano Banana Pro', model: 'gemini-3-pro-image-preview' }), run: async () => ({ state: 'done', file: 'gen/fin-1.jpg', provider: 'sloosh', charged: 2.01, words: true, kind: 'image', runKey: 'rk1' }), status: async () => ({ ok: true }) };
  const t = tenant(); t.changes.ch_w = change('ch_w', { pkg: { headline: 'Warm paws', primaryText: 'Cold hands?', overlay: 'Warm hands at work', image: 'gen/draft.png', knobs: {} } });
  const { call } = studio({ finals, sloosh: { listSpaces: async () => [] }, brandOfT: () => BRAND, slugOfT: () => 'acme' });
  await call('POST /api/changes/:chid/final/quote', { text: ['Warm hands at work'] }, t, { chid: 'ch_w' });
  await call('POST /api/changes/:chid/final/run', {}, t, { chid: 'ch_w' }); await tick(); await tick();
  const ch = t.changes.ch_w; assert.equal(ch.pkg.image, 'gen/fin-1.jpg'); assert.equal(ch.pkg.wordsIn, 'gen/fin-1.jpg');
  /* a final saved before the mark heals from its file */
  t.changes.ch_old = change('ch_old', { pkg: { overlay: 'Hi', image: 'gen/fin-2.jpg', knobs: {} }, lastFinal: { versionId: 'v2' } });
  await call('GET /api/changes/:chid', {}, t, { chid: 'ch_old' }); assert.equal(t.changes.ch_old.pkg.wordsIn, 'gen/fin-2.jpg');
});
