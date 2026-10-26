// Onboarding and retention loops (2026-10-17): Brew's emails reach the whole team, every button lands in the product
// (?go=feed), the wait on "Check what we read" is honest and survives a restart, a late check rewrites the brief and the first
// moves, and the weekly digest is built from saved files only. Generic: no brand names in the rules. No network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.REFRESH_AUTO = '0'; process.env.BUILD_RESUME_OFF = '1'; process.env.DEMO_MODE = '';
const { createBuilder, confirmDueAt, briefSig, sigChanged } = await import('../build.js');
const { createPacks } = await import('../brand-pack.js');
const { teamRecipients, digestDue, localNow, jamsFor, createDigest } = await import('../digest.js');

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const tmpPacks = () => createPacks({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'brew-loops-')), PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await sleep(25); } return false; };
const withEnv = async (o, fn) => { const was = Object.fromEntries(Object.keys(o).map((k) => [k, process.env[k]])); for (const [k, v] of Object.entries(o)) if (v == null) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { for (const [k, v] of Object.entries(was)) if (v == null) delete process.env[k]; else process.env[k] = v; } };
/* every Resend call the code makes, captured (nothing leaves the machine) */
const withResend = async (fn) => { const sent = [], orig = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (String(u).includes('api.resend.com')) { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, text: async () => '' }; } return orig(u, o); };
  try { await withEnv({ RESEND_API_KEY: 'test-key', PUBLIC_URL: 'https://brew.test' }, () => fn(sent)); } finally { globalThis.fetch = orig; } };

/* a brand with its read on file, and stand-ins for the brief writer and the moves engine */
async function brand(P, slug, { status = {}, moves = null, brief = null, onRun = null } = {}) {
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [] });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.in', slug, url: 'https://acme.in', catalog: { products: [] }, reviews: {}, rivals: [], meta: { readAt: '2026-10-16T08:00:00Z' } });
  await P.put(slug, 'ledger.json', []); await P.put(slug, 'findings.json', { steps: [], cards: [] });
  await P.put(slug, 'status.json', { slug, host: 'acme.in', url: 'https://acme.in', name: 'Acme', stages: { read: { state: 'done' } }, ...status });
  if (moves) await P.put(slug, 'moves.json', moves);
  const calls = { brief: 0, runAll: 0, charge: null };
  const modules = { reader: { createReader: () => ({ read: async () => { throw new Error('not called'); } }) },
    brief: { createBrief: () => ({ write: async (p) => { calls.brief++; return brief ? brief(p) : { json: { name: p.name }, md: `# ${p.name} brief` }; } }) },
    moves: { SPECS: [], createMovesEngine: () => ({ runAll: async (ctx, o) => { calls.runAll++; return onRun ? onRun(ctx, o, calls) : { moves: {}, errors: [], applicable: [] }; } }) }, pdf: null };
  const ai = { onCharge(f) { calls.charge = f; }, call: async () => { throw Object.assign(new Error('AI is off (mock)'), { mock: true }); } };
  const b = createBuilder({ ROOT: path.dirname(P.dirOf(slug)), packs: P, ai, treg: { onCharge() {} }, log: quiet, modules, caps: { build: 0.5 } });
  return { b, calls };
}
const team = async (P, slug) => {
  await P.put(slug, 'notify.json', { emails: [{ email: 'Opt@Acme.in', at: 1 }], sent: {} });
  await P.put(slug, 'private/created.json', { by: 'Ana@acme.in', at: 1 });
  await P.put(slug, 'private/members.json', { host: 'acme.in', owner: 'raj@acme.in', members: [{ email: 'raj@acme.in', role: 'owner' }, { email: 'sam@acme.in', role: 'member', seats: 'all' }, { email: 'quiet@acme.in', role: 'member' }, { email: 'x@demo.brew', role: 'member' }] });
  await P.put(slug, 'private/mail-prefs.json', { 'quiet@acme.in': { mail: 'off', muted: [] }, 'sam@acme.in': { mail: 'tags', muted: [] } });
};

/* ---------- 1. who hears ---------- */
test('notify recipients: the opted-in, the creator (on the brand’s own email) and every member, once each; muted and demo addresses skipped', async () => {
  const P = tmpPacks(), slug = 'acme-in'; await team(P, slug);
  assert.deepEqual(await teamRecipients(P, slug, { extra: ['opt@acme.in', 'RAJ@acme.in'] }), ['opt@acme.in', 'raj@acme.in', 'ana@acme.in', 'sam@acme.in']);
  assert.deepEqual(await teamRecipients(P, slug, { membersOnly: true }), ['raj@acme.in', 'sam@acme.in'], 'a team-only rewrite: members only');
  assert.deepEqual(await teamRecipients(P, 'nobody-here'), []);
  /* a starter on Gmail is not the team: it hears nothing about the brand (Param, 23 Oct) */
  await P.put(slug, 'private/created.json', { by: 'ana@gmail.com', at: 1 });
  assert.deepEqual(await teamRecipients(P, slug), ['raj@acme.in', 'sam@acme.in']);
});

test('the build’s "all moves ready" email goes to the whole team with a ?go=feed button; one per person', async () => {
  const P = tmpPacks(), slug = 'acme-in'; await team(P, slug);
  const { b } = await brand(P, slug, { status: { confirmedAt: 1, stages: { read: { state: 'done' }, confirm: { state: 'done' } } },
    onRun: async (ctx) => { await ctx.onTotal(2, [1, 2]); await ctx.save(1, { n: 1, title: 'Own the gift moment', meta: {} }); await ctx.save(2, { n: 2, title: 'Price ladder', meta: {} }); return { moves: {}, errors: [], applicable: [1, 2] }; } });
  await withResend(async (sent) => {
    await b.resume(slug);
    assert.equal((await b.status(slug)).done, true);
    assert.deepEqual(sent.map((x) => x.to[0]).sort(), ['ana@acme.in', 'opt@acme.in', 'raj@acme.in', 'sam@acme.in']);
    assert.equal(sent[0].subject, 'All of Acme’s plays are ready');
    assert.match(sent[0].html, /href="https:\/\/brew\.test\/acme-in\?go=feed"/); assert.match(sent[0].text, /Open the feed: https:\/\/brew\.test\/acme-in\?go=feed/);
    await b.addEmail(slug, 'opt@acme.in'); assert.equal(sent.length, 4, 'never twice');
  });
});

test('a capped build sends the honest count once it stops, not "finished all"', async () => {
  const P = tmpPacks(), slug = 'capped-example-com'; await team(P, slug);
  const { b } = await brand(P, slug, { status: { confirmedAt: 1, stages: { read: { state: 'done' }, confirm: { state: 'done' } } },
    onRun: async (ctx, o, calls) => { await ctx.onTotal(3, [1, 2, 3]); await ctx.save(1, { n: 1, title: 'One', meta: {} }); calls.charge?.('moves', 1); return { moves: {}, errors: [], applicable: [1, 2, 3] }; } });
  await withResend(async (sent) => {
    await b.resume(slug);
    const s = await b.status(slug); assert.equal(s.capped, true); assert.notEqual(s.done, true);
    assert.ok(sent.length >= 1, 'the team hears when a capped build stops');
    assert.equal(sent[0].subject, '1 of 3 plays for Acme are ready');
    assert.match(sent[0].text, /written 1 of 3 plays/); assert.match(sent[0].text, /spending cap/); assert.doesNotMatch(sent[0].text, /finished all/);
  });
});

/* ---------- 2. the honest wait ---------- */
test('the wait is worked out from saved timestamps: a check-page open pushes it out, a restart never starts it over', () => {
  const W = 15 * 60e3;
  assert.equal(confirmDueAt({ waitingSince: 1000 }, W), 1000 + W);
  assert.equal(confirmDueAt({ waitingSince: 1000, checkOpenAt: 5000 }, W), 5000 + W);
  assert.equal(confirmDueAt({ waitingSince: 9000, checkOpenAt: 5000 }, W), 9000 + W);
  /* only fields that change the brief count as a late correction */
  const p = { name: 'Acme', rivals: [{ host: 'a.com' }], catalog: { hero: ['x'] } };
  assert.deepEqual(sigChanged(briefSig(p), briefSig({ ...p, socials: { instagram: 'y' } })), []);
  assert.deepEqual(sigChanged(briefSig(p), briefSig({ ...p, name: 'Acme Labs', rivals: [{ host: 'b.com' }] })), ['name', 'rivals']);
});

test('after a restart the build goes on at the saved time (not 15 minutes from boot), and says when', async () => {
  const P = tmpPacks(), slug = 'restart-example-com';
  /* the instance that stamped the wait went 15 minutes ago, minus a moment */
  const since = Date.now() - 15 * 60e3 + 400;
  const { b, calls } = await brand(P, slug, { status: { waitingSince: since, stages: { read: { state: 'done' }, confirm: { state: 'waiting', at: since } } } });
  await P.put(slug, 'private/created.json', { by: 'ana@acme.in', at: 1 });
  const run = b.resume(slug);
  assert.ok(await until(async () => (await b.status(slug))?.writeAt), 'the brand says when Brew starts writing');
  assert.equal((await b.status(slug)).writeAt, since + 15 * 60e3);
  assert.equal(calls.brief, 0, 'still waiting');
  await run; /* well under a second: the clock was not started over */
  const s = await b.status(slug);
  assert.equal(s.stages.confirm.state, 'done'); assert.equal(calls.brief, 1); assert.ok(!s.confirmedAt, 'it went on with what it read, unconfirmed');
});

test('opening the check page gives the team the full wait from then; a confirm wakes the build at once', async () => {
  const P = tmpPacks(), slug = 'opened-example-com', since = Date.now() - 15 * 60e3 + 300;
  const { b, calls } = await brand(P, slug, { status: { waitingSince: since, stages: { read: { state: 'done' }, confirm: { state: 'waiting', at: since } } } });
  await P.put(slug, 'private/created.json', { by: 'ana@acme.in', at: 1 });
  const d = await b.checkData(slug, { heal: false, opened: true });
  const s0 = await b.status(slug); assert.ok(s0.checkOpenAt >= since); assert.equal(d.writeAt, s0.checkOpenAt + 15 * 60e3);
  const run = b.resume(slug);
  await sleep(800); assert.equal(calls.brief, 0, 'the open pushed the start out past the old time');
  await b.confirm(slug, []); await run;
  assert.equal(calls.brief, 1); assert.ok((await b.status(slug)).confirmedAt);
});

test('item 10: a resume after the check keeps its own state, never "Waiting for you to check"', async () => {
  const P = tmpPacks(), slug = 'resumed-example-com';
  const { b } = await brand(P, slug, { status: { confirmedAt: 1, state: 'Brew is restarting; the rest of the moves carry on in a moment.', stages: { read: { state: 'done' }, confirm: { state: 'done' } } } });
  const seen = []; b.subscribe(slug, (e) => { if (e.type === 'status') seen.push(e.status.state); });
  await b.resume(slug);
  assert.ok(!seen.includes('Waiting for you to check what we read'));
});

test('a check after the brief was written rewrites the brief and queues the first moves written before it', async () => {
  const P = tmpPacks(), slug = 'late-example-com', old = '2026-10-10T08:00:00.000Z';
  const moves = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20].map((n) => [n, { n, title: `Move ${n}`, meta: { at: old } }]));
  const { b, calls } = await brand(P, slug, { moves, status: { done: true, ready: true, state: 'Ready', confirmedAt: null, briefFromAt: Date.parse(old), stages: { read: { state: 'done' }, confirm: { state: 'done' }, brief: { state: 'done', at: Date.parse(old) }, moves: { state: 'done' } } },
    onRun: async (ctx, o) => { for (const n of (o.only || []).filter((k) => k)) await ctx.save(n, { n, title: `Move ${n} again`, meta: { at: new Date().toISOString() } }); return { moves: {}, errors: [], applicable: o.only || [] }; } });
  await P.put(slug, 'brief.json', { name: 'Acme' }); await P.put(slug, 'brief.md', '# Acme brief');
  const r = await b.confirm(slug, [{ key: 'name', v: 'Acme Labs' }]);
  assert.deepEqual(r.recheck?.what, ['name']); assert.match(r.recheck.words, /brand name/);
  assert.ok(await until(async () => calls.brief === 1), 'the brief is written again from the corrected read');
  assert.match(String(await P.get(slug, 'brief.md')), /Acme Labs brief/);
  assert.ok(await until(async () => (await P.getJSON(slug, 'moves.json', {}))[1]?.meta?.rewrittenAt), 'the first wave is rewritten');
  const after = await P.getJSON(slug, 'moves.json', {});
  assert.match(after[1].meta.because, /You corrected the brand name/);
  assert.equal(after[20].meta.rewrittenAt, undefined, 'only the first wave');
  const s = await b.status(slug); assert.equal(s.recheck, null); assert.equal(s.recheckDone.moves, 10);
  /* nothing changed: no rewrite */
  const r2 = await b.confirm(slug, [{ key: 'name', v: 'Acme Labs' }]); assert.equal(r2.recheck, undefined);
});

/* ---------- 3. the weekly digest ---------- */
const MON_10_IST = Date.UTC(2026, 9, 19, 4, 30); /* Monday 19 Oct 2026, 10:00 in India */
test('digest schedule: Monday 09:00 or later in the brand’s time, seven calendar days after the last one (or after Ready)', () => {
  const cfg = { timezone: 'Asia/Kolkata' }, H = 36e5;
  assert.deepEqual(localNow(MON_10_IST, cfg), { ymd: '2026-10-19', day: 1, hour: 10, minute: 0 });
  assert.deepEqual(localNow(MON_10_IST, {}), localNow(MON_10_IST, cfg), 'no zone: India');
  assert.equal(localNow(MON_10_IST, { tzOffsetH: -5 }).day, 0, 'an offset alone works too (still Sunday in New York)');
  assert.equal(digestDue({ now: MON_10_IST, lastAt: MON_10_IST - 7 * 864e5 + 2 * H, cfg }), true, 'a send last Monday at noon: due this Monday at ten (no drift)');
  assert.equal(digestDue({ now: MON_10_IST - 2 * H, lastAt: MON_10_IST - 7 * 864e5, cfg }), false, 'before 09:00');
  assert.equal(digestDue({ now: MON_10_IST + 864e5, lastAt: MON_10_IST - 7 * 864e5, cfg }), false, 'Tuesday');
  assert.equal(digestDue({ now: MON_10_IST, readyAt: MON_10_IST - 3 * 864e5, cfg }), false, 'Ready on Friday: not this Monday');
  assert.equal(digestDue({ now: MON_10_IST, readyAt: MON_10_IST - 10 * 864e5, cfg }), true);
  assert.equal(digestDue({ now: MON_10_IST, cfg }), false, 'never Ready, never due');
});

/* a packs store in memory with a brand's saved files (the fixture) */
const mem = (files = {}) => { const F = structuredClone(files);
  return { F, getJSON: async (slug, f, d = null) => (F[`${slug}/${f}`] !== undefined ? structuredClone(F[`${slug}/${f}`]) : d), put: async (slug, f, v) => { F[`${slug}/${f}`] = typeof v === 'string' ? JSON.parse(v) : v; },
    list: async () => Object.entries(F).filter(([k]) => k.endsWith('/status.json')).map(([k, v]) => ({ slug: k.split('/')[0], status: v })) }; };
const iso = (ms) => new Date(ms).toISOString(), DAYMS = 864e5, LAST = MON_10_IST - 7 * DAYMS;
const fixture = (o = {}) => mem({
  'g/status.json': { name: 'Gully', done: true, doneAt: LAST - 30 * DAYMS },
  'g/config.json': { timezone: 'Asia/Kolkata', statics: ['s1', 's2'] },
  'g/private/digest.json': { lastAt: LAST },
  'g/private/created.json': { by: 'ana@gully.com' },
  'g/private/members.json': { owner: 'ana@gully.com', members: [{ email: 'ana@gully.com', role: 'owner' }, { email: 'raj@gully.com', role: 'member' }, { email: 'off@gully.com', role: 'member' }] },
  'g/private/mail-prefs.json': { 'off@gully.com': { mail: 'off' } },
  'g/moves.json': { 4: { n: 4, title: 'Bundle the bestsellers', meta: { at: iso(LAST - 9 * DAYMS), rewrittenAt: iso(LAST + DAYMS), because: 'A rival cut its price.' } }, 6: { n: 6, title: 'Win the gift search', meta: { at: iso(LAST - 9 * DAYMS) } },
    9: { n: 9, title: 'Old', meta: { at: iso(LAST - 9 * DAYMS), rewrittenAt: iso(LAST - DAYMS) } }, 1001: { n: 1001, title: 'Answer the sizing question on Reddit', meta: { at: iso(LAST + 2 * DAYMS), cadence: true } } },
  'g/private/moves.json': { 6: { n: 6, title: 'Win the gift search: AOV ₹1,240 → ₹1,500', meta: { rewrittenAt: iso(LAST + DAYMS), because: 'Shopify moved: AOV ₹1,240.' } }, 33: { n: 33, title: 'Private only ₹9,999', meta: { rewrittenAt: iso(LAST + DAYMS) } } },
  'g/listen/status.json': { at: LAST + DAYMS },
  'g/listen/themes.json': { themes: [{ name: 'sizing runs small', n: 14 }, { name: 'delivery', n: 5 }, { name: 'one-off', n: 1 }] },
  'g/listen/threads.json': { threads: [{ title: 'Are Gully shoes true to size?', url: 'https://reddit.com/r/x/1', where: 'r/sneakers', intent: 'question', score: 9 }, { title: 'deals!!', url: 'https://reddit.com/r/deals/2', where: 'r/deals', intent: 'question', score: 99 }] },
  'g/research.json': { ads: { items: [{ id: 'a1', brand: 'Rival Co', title: 'Free socks with every pair', firstSeen: LAST + DAYMS, rank: 2 }, { id: 'a0', brand: 'Old Rival', title: 'old', firstSeen: LAST - DAYMS }] } },
  'g/calendar/2026.json': { events: [{ name: 'Diwali', date: '2026-11-08', end: '2026-11-08' }, { name: 'Past', date: '2026-10-01', end: '2026-10-01' }] },
  'g/private/jams.json': { work: [{ id: 'wk1', title: 'Gift box reel', stage: 'needs_you', updatedAt: 3 }, { id: 'wk2', title: 'Raj’s carousel', stage: 'drafting', assignee: { email: 'raj@gully.com', ask: 'do' }, updatedAt: 2 }, { id: 'wk3', title: 'Done one', stage: 'needs_you', archived: true }] },
  'g/drafts/cards.json': { c1: { at: LAST + DAYMS, image: 'gen/abc.png' } },
  ...o });

test('digest content from saved files: titles and reasons, never private numbers; one person’s jams; a specific subject', async () => {
  const P = fixture(), D = createDigest({ packs: P, mail: async () => true, log: quiet, base: 'https://brew.test', now: () => MON_10_IST });
  const r = await D.digestFor('g', { dryRun: true });
  assert.equal(r.since, LAST);
  assert.deepEqual(r.to, ['ana@gully.com', 'raj@gully.com'], 'members and the starter, never someone whose mail is off');
  const c = r.content;
  assert.deepEqual(c.rewritten.map((m) => [m.n, m.title, m.because]), [[4, 'Bundle the bestsellers', 'A rival cut its price.'], [6, 'Win the gift search', null]], 'a team-only rewrite goes by its shared title, without its reason');
  assert.equal(c.teamOnly.rewritten, 1, 'a private-only move is counted, never named');
  assert.deepEqual(c.weekly.map((m) => m.n), [1001]);
  assert.deepEqual(c.theme, { name: 'sizing runs small', n: 14 }); assert.equal(c.question.url, 'https://reddit.com/r/x/1');
  assert.deepEqual(c.rivalAds.map((a) => a.brand), ['Rival Co']);
  assert.deepEqual(c.event, { name: 'Diwali', date: '2026-11-08', days: 20 });
  assert.deepEqual(c.images, ['https://brew.test/gen/abc.png', 'https://brew.test/b/g/statics/s1.jpg', 'https://brew.test/b/g/statics/s2.jpg']);
  assert.deepEqual(jamsFor(c.jams, 'raj@gully.com').map((j) => j.id), ['wk1', 'wk2']); assert.deepEqual(jamsFor(c.jams, 'ana@gully.com').map((j) => j.id), ['wk1']);
  const ana = r.mails.find((m) => m.to === 'ana@gully.com'), raj = r.mails.find((m) => m.to === 'raj@gully.com');
  assert.equal(ana.subject, '1 new play and 3 updated plays for Gully this week');
  assert.match(raj.text, /Waiting on you\n- “Gift box reel” needs your OK\n- “Raj’s carousel” is yours/);
  for (const m of r.mails) { assert.doesNotMatch(m.html + m.text, /₹|Private only|AOV/, 'no private number or title'); assert.match(m.html, /href="https:\/\/brew\.test\/g\?go=feed"/); }
  assert.match(r.slack, /This week in Brew for Gully/); assert.match(r.slack, /1 jam waiting for an OK/); assert.doesNotMatch(r.slack, /₹|Raj’s carousel/);
});

test('digest: nothing new is no email; it sends once, records the week and posts to a connected Slack', async () => {
  const quietWeek = fixture({ 'g/moves.json': {}, 'g/private/moves.json': {}, 'g/listen/status.json': { at: LAST - DAYMS }, 'g/research.json': null, 'g/calendar/2026.json': null, 'g/private/jams.json': null });
  const sent = [], D0 = createDigest({ packs: quietWeek, mail: async (...a) => sent.push(a) && true, log: quiet, now: () => MON_10_IST });
  assert.deepEqual(await D0.digestFor('g'), { skipped: 'empty', to: ['ana@gully.com', 'raj@gully.com'] }); assert.equal(sent.length, 0);
  assert.deepEqual(await D0.digestFor('g'), { skipped: 'nothing new today' }, 'not worked out again every hour');
  const P = fixture(), posts = [], slack = { slackOf: async () => ({ token: 'x' }), slackPost: async (slug, o) => { posts.push(o.text); return { ts: '1' }; } };
  const D = createDigest({ packs: P, mail: async (...a) => sent.push(a) && true, slack: () => slack, prefLink: (slug, e) => `https://brew.test/mail/pref?t=${e}`, log: quiet, now: () => MON_10_IST });
  const r = await D.digestFor('g');
  assert.equal(r.ok, true); assert.equal(sent.length, 2); assert.equal(posts.length, 1);
  assert.match(sent[0][2], /No more emails like this/);
  assert.equal(P.F['g/private/digest.json'].lastAt, MON_10_IST);
  assert.deepEqual(await D.digestFor('g'), { skipped: 'not due' }, 'once a week');
  await withEnv({ DEMO_MODE: '1' }, async () => assert.deepEqual(await D.digestFor('g', { force: true }), { skipped: 'demo' }));
});

test('wiring: the digest starts beside the reminders on the live site only, and every Brew email button lands in the product', () => {
  const s = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8'), b = fs.readFileSync(path.join(REPO, 'build.js'), 'utf8'), a = fs.readFileSync(path.join(REPO, 'auth.js'), 'utf8');
  assert.match(s, /if \(!DEMO && process\.env\.DIGEST_OFF !== '1' && \(process\.env\.K_SERVICE \|\| process\.env\.DIGEST === '1'\)\) import\('\.\/digest\.js'\)/);
  assert.match(b, /const href = `\$\{base\}\/\$\{slug\}\?go=feed`/);
  assert.match(a, /'Same company email', 'all'\)/, 'a same-domain teammate joins with every view');
  assert.doesNotMatch(b + a, /href: `\$\{base\}\/\$\{slug\}`/, 'no email button to the bare brand page (the read replay)');
});
