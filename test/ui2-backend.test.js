// The UI2 makeover's backend (2026-10-16): Send brief + its status, Ask Brew, Your feed (tuning), Drop anything, and the guest
// hole on a studio change's discard. Free: no AI, no network, in-memory packs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startStatus, moveStatus, withTeam, briefParts, mdToEmailHtml, STATUSES } from '../brief-status.js';
import { createJamMail } from '../jam-mail.js';
import { createJamBrief } from '../jam-brief.js';
import { answerAsk, createAskBrew, cleanSeed, ctxOf, search } from '../ask-brew.js';
import { cleanTuning, tuneScore, learnedSignals, withoutIgnored, createTuning, AGENTS } from '../member-tuning.js';
import { parseDrop } from '../drop.js';
import { guestAllows, GUEST_DO } from '../feed-service.js';
import { esc, p as para } from '../mail-layout.js';

const memPacks = () => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), JSON.stringify(o)); } }; };
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/* ---------- 1. Send brief: the status machine ---------- */
test('a sent brief moves sent → received → in progress → delivered, needs info needs a note, and keeps its history', () => {
  const jb = startStatus({}, { by: { email: 'ana@acme.com', name: 'Ana' }, at: 1 });
  assert.equal(jb.status, 'sent'); assert.equal(jb.sender.email, 'ana@acme.com'); assert.equal(jb.history.length, 1);
  assert.match(moveStatus(jb, 'needs_info', { at: 2 }).error, /what you need/);
  assert.ok(moveStatus(jb, 'received', { by: { email: 'sam@shopos.ai' }, at: 3 }).line);
  assert.ok(moveStatus(jb, 'needs_info', { note: 'Which SKU?', at: 4 }).line);
  assert.ok(moveStatus(jb, 'in_progress', { at: 5 }).line);
  assert.match(moveStatus(jb, 'received', { at: 6 }).error, /can’t go to received/);
  assert.match(moveStatus(jb, 'shipped', { at: 6 }).error, /Status is one of/);
  assert.ok(moveStatus(jb, 'delivered', { at: 7 }).line);
  assert.deepEqual(jb.history.map((h) => h.s), ['delivered', 'in_progress', 'needs_info', 'received', 'sent']);
  assert.equal(jb.history[2].note, 'Which SKU?'); assert.equal(jb.history[3].by, 'sam@shopos.ai');
  assert.match(moveStatus({}, 'received').error, /not sent/, 'a brief copied for the team has no status');
  assert.deepEqual(STATUSES, ['sent', 'received', 'in_progress', 'needs_info', 'delivered']);
});
test('"N with the team" counts sent briefs that are not delivered, discarded or archived', () => {
  const w = (id, status, x = {}) => ({ id, title: id, jamBrief: status ? { status, statusAt: +id.slice(1) } : null, ...x });
  const r = withTeam([w('w1', 'sent'), w('w2', 'needs_info'), w('w3', 'delivered'), w('w4', null), w('w5', 'in_progress', { discarded: 1 }), w('w6', 'received')]);
  assert.equal(r.n, 3); assert.equal(r.needsInfo, 1); assert.deepEqual(r.items.map((x) => x.wid), ['w6', 'w2', 'w1']);
});
test('the full brief email has deliverables, assets, rules, done-when and where, and escapes the brief', () => {
  const x = { pkg: { action: 'New Meta ad', target: 'Meta Ads', version: 2, fields: [{ pub: true, label: 'Headline', value: 'Warm paws all winter' }], assets: [{ kind: 'image', label: 'Ad 4:5', url: 'https://b.test/gen/a.jpg' }, { kind: 'link', label: 'Landing page', url: 'https://acme.com/p' }], checks: [{ text: 'Price matches the site', done: false }] },
    card: { images: ['https://b.test/gen/a.jpg'], watch: 'No before/after claims' }, measure: { metric: 'Purchases', target: 40, unit: '', window: 14 }, versions: [] };
  const P = briefParts(x, { missing: ['Budget'] }, { banned: ['cure'] });
  assert.deepEqual(P.deliverables, ['New Meta ad on Meta Ads (v2)', 'Headline: Warm paws all winter']);
  assert.equal(P.assets.length, 2, 'the same image once'); assert.equal(P.where, 'Meta Ads');
  assert.ok(P.rules.includes('No before/after claims')); assert.ok(P.rules.some((r) => /cure/.test(r))); assert.ok(P.rules.some((r) => /Price matches/.test(r)));
  assert.equal(P.doneWhen[0], 'Purchases: target 40, read after 14 days'); assert.match(P.doneWhen.at(-1), /budget/);
  const h = mdToEmailHtml('# Title\n## The plan\n- **Who:** <b>women</b> 25-34\nPlain line', { esc, p: para });
  assert.doesNotMatch(h, /<b>women<\/b>/); assert.match(h, /&lt;b&gt;women/); assert.match(h, /<b>Who:<\/b>/); assert.doesNotMatch(h, /Title/, 'the title is the email’s own');
});
test('Send brief emails the WHOLE brief to SHOPOS_EMAIL every send (no hourly throttle), once per send; status emails the sender', async () => {
  const sent = []; process.env.SHOPOS_EMAIL = 'team@shopos.test';
  const M = createJamMail({ mail: async (to, subject, html, text) => (sent.push({ to, subject, html, text }), true), packs: memPacks(), sign: (x) => JSON.stringify(x), verify: () => null, everyMs: 0, brandName: () => 'Acme' });
  const w = { id: 'wk_1', title: 'Diwali reel' }, parts = { deliverables: ['A 15s reel'], assets: [{ label: 'Hero', url: 'https://b.test/gen/h.jpg', image: true }, { label: 'Page', url: 'https://acme.com/p', image: false }], rules: ['No discounts'], doneWhen: ['Orders: target 40'], where: 'Instagram Reels' };
  assert.equal(await M.briefSent('acme', w, { by: { email: 'ana@acme.com', name: 'Ana' }, md: '# Diwali reel\n## The plan\n- Shoot at home', parts, ticket: 'BR-1042', key: '1' }), true);
  assert.equal(await M.briefSent('acme', w, { by: { email: 'ana@acme.com' }, md: 'x', parts, key: '1' }), false, 'the same send is not emailed twice');
  assert.equal(await M.briefSent('acme', w, { by: { email: 'ana@acme.com' }, md: 'again', parts, key: '2' }), true, 'a second send minutes later goes too');
  assert.equal(sent.length, 2); assert.equal(sent[0].to, 'team@shopos.test'); assert.match(sent[0].subject, /BR-1042/);
  for (const re of [/A 15s reel/, /Shoot at home/, /<img src="https:\/\/b.test\/gen\/h.jpg"/, /acme.com\/p/, /No discounts/, /Orders: target 40/, /Instagram Reels/, /ana@acme.com/]) assert.match(sent[0].html, re);
  assert.match(sent[0].text, /Done when:\n- Orders: target 40/);
  assert.equal(await M.briefStatus('acme', w, { to: 'ana@acme.com', by: { name: 'Sam' }, status: 'needs_info', label: 'Needs info from you', note: 'Which SKU?' }), true);
  assert.equal(sent[2].to, 'ana@acme.com'); assert.match(sent[2].subject, /needs something/); assert.match(sent[2].html, /Which SKU\?/);
  delete process.env.SHOPOS_EMAIL;
});

/* the jam brief's routes, on a bare workspace */
const jbRig = ({ staff = false, sendOk = true } = {}) => {
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn), calls = { sent: [], status: [], shopos: [] }, thread = [];
  const JB = createJamBrief({ claudeTool: null, cardBrief: () => '', seatLine: () => '', isMock: () => true, spend: () => false, now: () => 1000, AGENT: {}, log: { warn() {} },
    cardOf: () => ({ id: 'c1', title: 'Warm paws ad', sub: 'Lead with the cold-hands moment', agent: 'creative', sector: 'creatives' }),
    meOf: () => ({ email: 'ana@acme.com', name: 'Ana' }), staffOf: () => (staff ? { email: 'sam@shopos.ai', name: 'Sam', staff: true } : null),
    onBriefSent: async (t, w) => (calls.sent.push(w.id), sendOk), onBriefStatus: (t, w, x) => calls.status.push(x), onShopos: (t, w, x) => calls.shopos.push(x) });
  const w = { id: 'wk_1', title: 'Warm paws ad', cardId: 'c1', thread: [], versions: [{ n: 1, title: 'Warm paws ad' }], current: 1, stage: 'drafting', history: [] };
  const t = { work: [w], cards: new Map() };
  JB.routes({ on, W: (t0, id) => t0.work.find((x) => x.id === id), say: (t0, w0, m) => { thread.push(m); w0.thread.push(m); }, move: (t0, w0, s) => (w0.stage = s), notify: () => {}, nextTicket: async () => 'BR-1042', handoff: null });
  return { R, t, w, calls, thread };
};
test('Send brief (to=shopos) sends the brief and starts its status; Share with my team only copies it', async () => {
  const a = jbRig(); const r = await a.R['POST /api/work/:wid/doc/ship']({ to: 'shopos', force: true }, a.t, { wid: 'wk_1' });
  assert.equal(r.status, 'sent'); assert.equal(a.w.jamBrief.status, 'sent'); assert.equal(a.w.jamBrief.sender.email, 'ana@acme.com'); assert.deepEqual(a.calls.sent, ['wk_1']);
  assert.equal(a.calls.shopos.length, 0, 'not also the throttled tag email'); assert.match(a.thread.at(-1).body, /sent to the ShopOS team/); assert.equal(a.w.stage, 'shared');
  const b = jbRig(); const r2 = await b.R['POST /api/work/:wid/doc/ship']({ to: 'team', force: true }, b.t, { wid: 'wk_1' });
  assert.equal(r2.status, null); assert.equal(b.w.jamBrief.status, undefined); assert.deepEqual(b.calls.sent, []); assert.match(b.thread.at(-1).body, /copied for your team/);
  const c = jbRig({ sendOk: false }); await c.R['POST /api/work/:wid/doc/ship']({ to: 'shopos', force: true }, c.t, { wid: 'wk_1' });
  assert.match(c.thread.at(-1).body, /ready for the ShopOS team.*Paste it/, 'an email that did not go never says sent');
});
test('only staff move a brief on; each move writes a line in the jam and tells the sender; sending again keeps the history', async () => {
  const a = jbRig(); await a.R['POST /api/work/:wid/doc/ship']({ to: 'shopos', force: true }, a.t, { wid: 'wk_1' });
  const no = await a.R['POST /api/work/:wid/brief/status']({ status: 'received' }, a.t, { wid: 'wk_1' });
  assert.equal(no.status, 403); assert.equal(a.w.jamBrief.status, 'sent');
  const s = jbRig({ staff: true }); await s.R['POST /api/work/:wid/doc/ship']({ to: 'shopos', force: true }, s.t, { wid: 'wk_1' });
  const r = await s.R['POST /api/work/:wid/brief/status']({ status: 'needs_info', note: 'Which SKU?' }, s.t, { wid: 'wk_1' });
  assert.equal(r.status, 'needs_info'); assert.equal(s.calls.status[0].note, 'Which SKU?'); assert.equal(s.thread.at(-1).from, 'brew'); assert.equal(s.thread.at(-1).real, true);
  await s.R['POST /api/work/:wid/brief/status']({ status: 'in_progress' }, s.t, { wid: 'wk_1' }); assert.equal(s.thread.at(-1).real, false, 'a bare status never rewrites the brief');
  assert.match((await s.R['POST /api/work/:wid/brief/status']({ status: 'bogus' }, s.t, { wid: 'wk_1' })).error, /Status is one of/);
  await s.R['POST /api/work/:wid/doc/ship']({ to: 'shopos', force: true }, s.t, { wid: 'wk_1' });
  assert.equal(s.w.jamBrief.status, 'sent'); assert.deepEqual(s.w.jamBrief.history.map((h) => h.s), ['sent', 'in_progress', 'needs_info', 'sent']);
});
test('the feed service wires Send brief: full email, demo never sends, statuses in the work and feed payloads', () => {
  const s = src('feed-service.js');
  assert.match(s, /const briefSentMail = async \(t, w\) => \{ if \(!o\.jamMail\?\.briefSent \|\| process\.env\.DEMO_MODE === '1'\) return false;/);
  assert.match(s, /const briefStatusMail = \(t, w, x\) => \{ const to = w\.jamBrief\?\.sender\?\.email; if \(!to \|\| !o\.jamMail\?\.briefStatus \|\| process\.env\.DEMO_MODE === '1'\) return;/);
  assert.match(s, /staffOf: \(t\) => \{ const me0 = meOf\(t\); return me0\?\.staff \? me0 : null; \}/);
  assert.match(s, /withTeam: withTeam\(t\.work\.filter\(shown\)\)/); assert.match(s, /cards: allCards\(t\), withTeam: withTeam\(/);
  assert.match(src('server.js'), /isStaff: \(email\) => auth\.isAdmin\(\{ email \}\)/);
});

/* ---------- 2. Ask Brew ---------- */
const CARDS = [{ id: 'm03-1', title: 'Fix the slow product page', sub: 'Mobile LCP is 4.1s', agent: 'storefront' }, { id: 'm07-1', title: 'Winter gifting reel', sub: 'Lead with the cold hands moment', agent: 'creative' }];
const MOVES = [{ n: 3, title: 'Speed up the store', gives: 'Faster product pages convert better' }, { n: 7, title: 'Gifting season', gives: 'Winter gift bundles' }];
test('Ask Brew answers with AI and keeps only real card and move links', async () => {
  let prompt = '';
  const r = await answerAsk({ text: 'What should I fix on the product page?', seed: { cardId: 'm03-1' }, ctx: { brand: 'Acme', cards: CARDS, moves: MOVES, facts: '- LCP: 4.1s', seedText: 'the card' },
    ai: async (p) => { prompt = p; return { answer: 'Speed up the product page first.', cards: ['m03-1', 'made-up'], moves: [3, 99] }; }, route: async () => ({ route: 'ai', intent: 'answer' }) });
  assert.equal(r.by, 'ai'); assert.equal(r.body, 'Speed up the product page first.');
  assert.deepEqual(r.links.map((l) => l.kind === 'card' ? l.id : l.n), ['m03-1', 3]); assert.equal(r.action, null);
  for (const re of [/m03-1 · storefront · Fix the slow product page/, /3 · Speed up the store/, /- LCP: 4\.1s/, /They asked from here:\nthe card/]) assert.match(prompt, re);
});
test('Ask Brew with AI off never makes an answer up: it says so and links what mentions the question', async () => {
  const r = await answerAsk({ text: 'Anything about gifting this winter?', ctx: { cards: CARDS, moves: MOVES }, ai: null, route: async () => ({ route: 'ai', intent: 'answer' }) });
  assert.equal(r.by, 'search'); assert.match(r.body, /AI is offline/); assert.deepEqual(r.links.map((l) => l.id || l.n), ['m07-1', 7]);
  const none = await answerAsk({ text: 'What about podcasts?', ctx: { cards: CARDS, moves: MOVES } });
  assert.match(none.body, /can’t answer that\. Nothing in your feed or moves mentions it/); assert.deepEqual(none.links, []);
  const failing = await answerAsk({ text: 'gifting', ctx: { cards: CARDS, moves: MOVES }, ai: async () => { throw new Error('down'); } });
  assert.equal(failing.by, 'search', 'an AI failure falls back to the search, not a canned answer');
});
test('Ask Brew turns asks to make something into a jam and asks that need a person into a brief, with the old jam ctx', async () => {
  const make = await answerAsk({ text: 'Make three versions of this', seed: { cardId: 'm07-1' }, ctx: { cards: CARDS, moves: MOVES }, route: async () => ({ route: 'ai', intent: 'versions' }) });
  assert.deepEqual(make.action, { kind: 'jam', ctx: { post: 'm07-1' }, say: 'Open a jam to make it.' });
  const team = await answerAsk({ text: 'Book a shoot', seed: { bulk: ['m03-1', 'm07-1'] }, ctx: { cards: CARDS }, route: async () => ({ route: 'team', label: 'a shoot' }) });
  assert.equal(team.action.kind, 'brief'); assert.deepEqual(team.action.ctx, { bulk: [{ id: 'm03-1' }, { id: 'm07-1' }] }); assert.match(team.action.say, /a shoot/);
  assert.deepEqual(cleanSeed({ cardId: 'c1', move: '7', bulk: [{ id: 'a' }, 'b', 'a'], signal: 'x', moves: true, junk: 1 }), { cardId: 'c1', move: 7, bulk: ['a', 'b'], signal: 'x', moves: true });
  assert.equal(cleanSeed({}), null); assert.deepEqual(ctxOf({ signal: 'Rival dropped prices' }), { signal: 'Rival dropped prices' }); assert.deepEqual(ctxOf(null, 'hi'), { signal: 'hi' });
  assert.deepEqual(search('', { cards: CARDS }), { cards: [], moves: [] });
});
test('the ask thread persists per person, and a photo dropped "just this once" rides on the next ask only', async () => {
  const packs = memPacks(), A = createAskBrew({ packs, now: () => 5 });
  await A.append('acme', 'mb_1', { from: 'me', body: 'hi' }, { from: 'brew', body: 'hello', links: [] });
  assert.equal((await A.load('acme', 'mb_1')).msgs.length, 2); assert.equal((await A.load('acme', 'mb_2')).msgs.length, 0, 'another person’s thread is their own');
  await A.pend('acme', 'mb_1', { kind: 'image', url: 'gen/ref-1.jpg' });
  assert.deepEqual((await A.takePending('acme', 'mb_1')).map((f) => f.url), ['gen/ref-1.jpg']); assert.deepEqual(await A.takePending('acme', 'mb_1'), []);
  await A.clear('acme', 'mb_1'); assert.equal((await A.load('acme', 'mb_1')).msgs.length, 0);
  const s = src('feed-service.js');
  assert.match(s, /on\('GET', '\/api\/tenants\/:id\/ask'/); assert.match(s, /on\('POST', '\/api\/tenants\/:id\/ask'/);
  assert.match(s, /if \(reqOf\(t\)\?\.guest && !reqOf\(t\)\?\.member\) return \{ status: 403/);
  assert.match(s, /const ai = isMock\(\) \|\| !spend\('text'\) \? null :/, 'mock and demo visitors never spend');
});

/* ---------- 3. Your feed ---------- */
test('tuning: less / normal / more per agent and topics lift or sink a card; junk is dropped', () => {
  const tu = cleanTuning({ weights: { creative: 'more', crm: 'less', performance: 'loud', hacker: 'more' }, topics: ['Gifting', 'gifting', 'x', 'Winter sale'] });
  assert.equal(tu.weights.creative, 'more'); assert.equal(tu.weights.crm, 'less'); assert.equal(tu.weights.performance, 'normal'); assert.equal(tu.weights.hacker, undefined);
  assert.deepEqual(tu.topics, ['gifting', 'winter sale']); assert.deepEqual(Object.keys(tu.weights), AGENTS);
  assert.equal(tuneScore(tu, { agent: 'creative', title: 'Winter gifting reel', sub: 'Winter sale' }), 4 + 4);
  assert.equal(tuneScore(tu, { agent: 'crm', title: 'Win-back email' }), -4); assert.equal(tuneScore(null, { agent: 'crm' }), 0);
});
test('learned signals come from card feedback, and a deleted one stops counting in the ranker', () => {
  const cards = new Map([['a', { agent: 'creative', campaign: 'Diwali' }], ['b', { agent: 'creative', campaign: 'Diwali' }], ['c', { agent: 'crm', sector: 'signals' }]]);
  const feedback = [{ kind: 'heart', cardId: 'a' }, { kind: 'heart', cardId: 'b' }, { kind: 'not_interested', cardId: 'c' }, { kind: 'heart', cardId: 'zz' }];
  const sig = learnedSignals({ feedback, cards, fewer: { performance: 1 } });
  assert.deepEqual(sig.map((x) => x.id).sort(), ['fewer:performance', 'like:agent:creative', 'like:campaign:Diwali', 'skip:agent:crm']);
  assert.match(sig.find((x) => x.id === 'like:agent:creative').text, /You like Creative cards/);
  assert.equal(learnedSignals({ feedback, cards, ignored: ['like:agent:creative'] }).some((x) => x.id === 'like:agent:creative'), false);
  const { af, fewer } = withoutIgnored({ agent: { creative: 2 }, campaign: { Diwali: 2 }, no: { crm: 1 }, noSector: {} }, { performance: 1 }, ['like:agent:creative', 'fewer:performance', 'skip:agent:crm']);
  assert.deepEqual(af.agent, {}); assert.deepEqual(af.no, {}); assert.deepEqual(fewer, {}); assert.deepEqual(af.campaign, { Diwali: 2 });
});
test('tuning persists per person per brand; the ranker reads it', async () => {
  const packs = memPacks(), T = createTuning({ packs, now: () => 9 });
  await T.put('acme', 'mb_1', { weights: { performance: 'less' }, topics: ['reels'] }); await T.ignore('acme', 'mb_1', 'like:agent:creative'); await T.addNote('acme', 'mb_1', 'I prefer short copy');
  const T2 = createTuning({ packs }); const tu = await T2.get('acme', 'mb_1');
  assert.equal(tu.weights.performance, 'less'); assert.deepEqual(tu.topics, ['reels']); assert.deepEqual(tu.ignored, ['like:agent:creative']); assert.equal(tu.notes[0].text, 'I prefer short copy');
  assert.equal((await T2.get('acme', 'mb_2')).weights.performance, 'normal'); assert.equal(T2.peek('acme', 'mb_1').weights.performance, 'less');
  await T2.unignore('acme', 'mb_1', 'like:agent:creative'); assert.deepEqual((await T2.get('acme', 'mb_1')).ignored, []);
  const s = src('feed-service.js');
  assert.match(s, /const total = val \+ seat \+ aff \+ fresh \+ fatigue \+ fb \+ extra \+ behind \+ tune\b/);
  assert.match(s, /withoutIgnored\(affinityMap\(t\)\.a, t\.fewer, tu\?\.ignored\)/);
  assert.match(s, /on\('PUT', '\/api\/tenants\/:id\/tuning'/); assert.match(s, /on\('DELETE', '\/api\/tenants\/:id\/tuning\/signals\/:sid'/);
});

/* ---------- 4. Drop anything ---------- */
test('a drop takes text up to 4,000 characters or a PNG, JPG or WebP photo up to 8 MB', () => {
  assert.equal(parseDrop({ text: 'We never discount.' }).kind, 'text');
  const long = parseDrop({ text: 'x'.repeat(5000) }); assert.equal(long.text.length, 4000); assert.equal(long.cut, true);
  assert.match(parseDrop({ text: 'hi' }).error, /first/);
  const img = parseDrop({ data: `data:image/jpeg;base64,${Buffer.from('jpegbytes').toString('base64')}`, name: 'hero\nshot' });
  assert.equal(img.kind, 'image'); assert.equal(img.ext, 'jpg'); assert.match(img.file, /^ref-[0-9a-f]{16}\.jpg$/); assert.equal(img.name, 'hero shot');
  assert.match(parseDrop({ data: 'data:application/pdf;base64,AAAA' }).error, /PNG, JPG or WebP/);
  assert.match(parseDrop({ data: `data:image/png;base64,${Buffer.alloc(8e6 + 1).toString('base64')}` }).error, /over 8 MB/);
  const s = src('feed-service.js');
  assert.match(s, /on\('POST', '\/api\/brands\/:slug\/drop'/); assert.match(s, /brands\\\/\[a-z0-9-\]\+\\\/drop\$/);
  assert.match(s, /if \(!\(r\?\.member \|\| process\.env\.DEMO_MODE === '1'\)\) return \{ status: r\?\.email \? 403 : 401, error: 'Only this brand’s team can add to its memory\.'/);
  assert.match(s, /addReference\(t, w, rel, f\.name\)/, 'once on a jam is the jam’s reference photo');
});

/* ---------- 5. the guest hole ---------- */
test('a guest of a jam can work in it but never discard or restore its studio change, nor send or move its brief', () => {
  const ctx = { wids: ['wk_1'], changes: { ch_1: { workId: 'wk_1', cardId: 'c1' }, ch_2: { workId: 'wk_9', cardId: 'c9' } }, cards: new Set(['c1']) };
  assert.equal(guestAllows('/api/changes/ch_1/discard', ctx), false); assert.equal(guestAllows('/api/changes/ch_1/restore', ctx), false);
  assert.equal(guestAllows('/api/changes/ch_1/iterate', ctx), true); assert.equal(guestAllows('/api/changes/ch_1', ctx), true);
  assert.equal(guestAllows('/api/changes/ch_2/iterate', ctx), false, 'another jam’s change');
  for (const sub of ['discard', 'doc/ship', 'brief/status', 'approve', 'assign', 'decided']) assert.equal(guestAllows(`/api/work/wk_1/${sub}`, ctx), false, sub);
  for (const sub of ['message', 'doc/ask', 'reference']) assert.equal(guestAllows(`/api/work/wk_1/${sub}`, ctx), true, sub);
  assert.equal(guestAllows('/api/cards/c1/remix', ctx), true); assert.equal(guestAllows('/api/cards/c9/remix', ctx), false);
  assert.equal(guestAllows('/api/work/wk_1/message', { ...ctx, wids: [] }), false); assert.ok(GUEST_DO.test('doc/ask'));
});

test('a reply whose status is a word (Send brief: sent) is not used as the HTTP code', () => {
  const src = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /send\(res, out\?\.status \|\| 200/, 'a word status crashed the reply (Invalid status code: sent)');
  assert.match(src, /Number\.isInteger\(out\?\.status\)/);
});

test('a double-tapped Send emails once; a copy for your own team keeps the ShopOS status and history', async () => {
  const s = jbRig({ staff: true }); const ship = (b) => s.R['POST /api/work/:wid/doc/ship']({ force: true, ...b }, s.t, { wid: 'wk_1' });
  await ship({ to: 'shopos' }); const sent0 = s.calls.sent?.length ?? null;
  const again = await ship({ to: 'shopos' }); assert.equal(again.already, true, 'the same brief, seconds later, is not sent twice');
  if (sent0 != null) assert.equal(s.calls.sent.length, sent0);
  await s.R['POST /api/work/:wid/brief/status']({ status: 'received' }, s.t, { wid: 'wk_1' });
  await ship({ to: 'team' });
  assert.equal(s.w.jamBrief.status, 'received', 'sharing with your own team does not wipe the ShopOS status');
  assert.equal(s.w.jamBrief.to, 'shopos'); assert.ok(s.w.jamBrief.history.length >= 2); assert.ok(s.w.jamBrief.teamCopyAt);
});

test('a live card without rows or detail never breaks the feed (clone of undefined)', () => {
  const src = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  const m = /const clone = \(x\) => ([^;]+);/.exec(src); assert.ok(m, 'clone helper');
  const clone = eval(`(x) => ${m[1]}`); assert.equal(clone(undefined), undefined); assert.deepEqual(clone({ a: [1] }), { a: [1] });
  assert.match(src, /L\.cards = \(L\.cards \|\| \[\]\)\.filter\(\(c\) => c && c\.id\)/);
});

test('an edited brief sent again does go out, even after a copy for your own team; a team copy never replaces what ShopOS has', async () => {
  const s = jbRig({ staff: true }); const ship = (b) => s.R['POST /api/work/:wid/doc/ship']({ force: true, ...b }, s.t, { wid: 'wk_1' });
  await ship({ to: 'shopos' }); const n1 = s.calls.sent.length, md1 = s.w.jamBrief.md, ctx1 = s.w.jamBrief.context;
  s.w.doc.md = (s.w.doc.md || '') + '\n\nOne more line the team added.';
  await ship({ to: 'team' }); assert.equal(s.w.jamBrief.md, md1, 'the ShopOS brief stays as it was sent'); assert.equal(s.w.jamBrief.context, ctx1);
  const r = await ship({ to: 'shopos' }); assert.notEqual(r.already, true, 'a changed brief is a real send'); assert.equal(s.calls.sent.length, n1 + 1);
});

test('outside the team on live, Ask, Your feed and Drop take no writes; the demo allowance list stays as it was', () => {
  const src = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes("if (outside && req.method !== 'GET'")) || '';
  for (const w of ['ask|tuning', 'drop', '403', 'teamOnly']) assert.ok(line.includes(w), `no writes from outside the team (${w})`);
  const demo = /const DEMO_OK = (\/.*\/);/.exec(src)[1]; for (const w of ['|ask', 'tuning', 'brands\\/[^/]+\\/drop']) assert.ok(!demo.includes(w), `${w} is not opened to non-makers`);
});
