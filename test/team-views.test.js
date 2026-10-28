// node --test test/  — the team-only versions of the weekly moves, the scorecard, ideas and static ads: when a brand has real
// connected accounts (private/connected-ledger.json), members get a version written from them and visitors keep the public one.
// Every surface is checked both ways: the member sees the account numbers, a visitor (or a non-member) never does. Free: no AI
// (a fake ai echoes its evidence), no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.BUILD_RESUME_OFF = '1';
const { auditScorecard, automationContext, liveOf, createMovesScheduler } = await import('../moves-cadence.js');
const { createPacks } = await import('../brand-pack.js');
const { createConnectors } = await import('../connectors/index.js');

const quiet = { warn: () => {}, info: () => {}, log: () => {}, error: () => {} };
const H = 3600e3, DAY = 24 * H, NOW = Date.parse('2026-10-14T12:00:00Z');
const PROFILE = { name: 'Acme', host: 'acme.com', country: 'US', currency: 'USD', meta: { readAt: '2026-10-13T10:00:00Z' },
  catalog: { count: 2, products: [{ title: 'Runner', handle: 'runner', price: 98, inStock: true, images: ['a', 'b'] }, { title: 'Sock', handle: 'sock', price: 12, inStock: false, images: ['a'] }] },
  site: { tech: { klaviyo: true, metaPixel: true } }, ads: { own: { live: 3, pageId: '42', items: [{ days: 5, format: 'video' }, { days: 90, format: 'image' }] } },
  reviews: { total: 240, app: 'Judge.me' } };
const LEDGER = [{ key: 'reviews.total', label: 'Reviews on the site', v: '240', n: 240, src: 'Judge.me', at: '2026-10-13' }];
const at = '2026-10-14T00:00:00.000Z', row = (key, label, v, n, src) => ({ key, label, v, ...(n != null ? { n } : {}), layer: 'observed', src, method: `account:${key.split('.')[0]}`, at });
/* the team's real account rows; the secret numbers below must never reach a visitor */
const ROWS = [row('meta.roas', 'Meta return on ad spend, 30 days', '2.73x', 2.73, 'Meta Ads'), row('meta.cpa', 'Meta cost per purchase, 30 days', '$317', 317, 'Meta Ads'),
  row('meta.frequency.max', 'Highest campaign frequency, 7 days', '4.47', 4.47, 'Meta Ads'), row('shopify.aov', 'Average order value, 30 days', '$623', 623, 'Shopify'),
  row('klaviyo.flows.live', 'Key email flows live (of 5)', '3 of 5', 3, 'Klaviyo'), row('klaviyo.flows.off', 'Key email flows not live', 'Win-back, Browse abandonment', null, 'Klaviyo')];
const SECRET = /2\.73x|\$317\b|4\.47\b|\$623\b|Browse abandonment flow|Klaviyo \(connected\)/;

/* a fake ai that writes each move from its evidence: the title quotes the last evidence line, so a move written from the team's
   accounts carries their numbers and one written from the read does not */
const echoAI = () => { const calls = []; return { live: true, calls, call: async (q) => { calls.push(q.tag);
  const ev = [...q.prompt.matchAll(/\[(e\d+)\] ([^\n]*)/g)].map((m) => ({ id: m[1], text: m[2] }));
  const acct = ev.filter((e) => /connected account|Klaviyo \(connected\)|connected\)/.test(e.text)), pick = (acct.length ? acct : ev).slice(-1)[0] || { id: 'e1', text: 'x' };
  const mv = (i) => ({ area: q.tag === 'moves-listen' ? 'listen' : 'auto', skill: 'emails', title: `Plan ${i}: ${pick.text.slice(0, 60)}`, stat: '', statLabel: '', gives: 'g', live: 'l', why: pick.text,
    found: [{ text: pick.text, ev: [pick.id] }], plan: [{ step: 'Do it', detail: 'd' }], measure: [{ metric: 'm', baseline: 'To be instrumented', target: 't', rule: 'r' }], toConfirm: [] });
  return { usd: 0.1, json: { moves: [mv(0), mv(1), mv(2)] } }; } }; };
const fakeCardsGen = () => ({ fromMove: async (move) => ({ cards: [{ id: `m${move.n}-1`, agent: 'brew', sector: 'signals', type: 'idea', kind: 'rows', rows: [['x', 'y']], roles: ['founder'], title: move.title, sub: move.gives, src: `Move ${move.n} · The plan`, time: '10 min', detail: { why: [], how: [] }, cta: { label: 'Open' } }], label: null }) });
const LISTEN = { themes: [{ name: 'sizing', n: 40, pos: 10, neg: 25, neutral: 5, brand: 30, quote: 'Runs big', quoteLink: 'https://www.reddit.com/r/A/comments/c/' }], threads: [], communities: [], status: { at: NOW - H, sources: {} } };

async function brand(P, slug, rows = ROWS) {
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.com' }, lanes: { core: { name: 'Core' } }, roles: { founder: { title: 'Founder', sector: {}, type: {} } }, posts: [] });
  await P.put(slug, 'status.json', { name: 'Acme', ready: true }); await P.put(slug, 'config.json', { currency: 'USD' }); await P.put(slug, 'facts.json', {});
  await P.put(slug, 'profile.json', PROFILE); await P.put(slug, 'ledger.json', LEDGER); await P.put(slug, 'moves.json', { 1: { n: 1, title: 'Build move', sections: [] } });
  await P.put(slug, 'listen/themes.json', { themes: LISTEN.themes, total: 40 }); await P.put(slug, 'listen/status.json', LISTEN.status);
  if (rows) await P.put(slug, 'private/connected-ledger.json', rows);
}
const mkPacks = (tag) => { const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), `brew-team-${tag}-`)); return { ROOT, P: createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet }) }; };
const publicFiles = (ROOT, slug) => { const dir = path.join(ROOT, '.brands', slug), out = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== 'private') walk(p); } else out.push(p); } };
  walk(dir); return out; };

/* ---------- 1. the weekly moves ---------- */
test('scorecard paid area: from the connected Meta account for the team, from the Ad Library for everyone else', () => {
  const pub = auditScorecard({ profile: PROFILE, slug: 'acme-com', now: NOW }), team = auditScorecard({ profile: PROFILE, slug: 'acme-com', now: NOW, live: liveOf(ROWS) });
  const pa = pub.areas.find((a) => a.k === 'ads'), ta = team.areas.find((a) => a.k === 'ads');
  assert.ok(pa.parts.some((p) => p.src === 'Meta Ad Library')); assert.equal(pub.private, undefined); assert.doesNotMatch(JSON.stringify(pub), SECRET);
  assert.equal(ta.from, 'account'); assert.ok(ta.parts.every((p) => p.src !== 'Meta Ad Library'), 'no Ad Library parts in the team view');
  assert.deepEqual(ta.parts.filter((p) => p.of > 0).map((p) => p.k), ['Return on ad spend', 'Ad fatigue', 'Cost per order']);
  /* Meta connected with nothing live (no return, cost or frequency yet): still the account, never the Ad Library */
  const idle = auditScorecard({ profile: PROFILE, now: NOW, live: liveOf([row('meta.ads.live', 'Live Meta ads', '0', 0, 'Meta Ads'), row('meta.spend.30d', 'Meta spend, last 30 days', '₹9,861', 9861, 'Meta Ads')]) }).areas.find((a) => a.k === 'ads');
  assert.equal(idle.from, 'account'); assert.equal(idle.score, 0); assert.match(idle.parts[0].note, /no ads are live in the connected Meta account \(spend over the last 30 days: ₹9,861\)/);
  assert.ok(!automationContext({ profile: PROFILE, live: liveOf([row('meta.ads.live', 'Live Meta ads', '0', 0, 'Meta Ads')]) }).routines.some((r) => r.k === 'creative-refresh'), 'no ads live: no creative refresh');
  assert.equal(ta.parts[0].pts, Math.round((2.73 / 4) * 40)); assert.equal(ta.parts[1].pts, Math.round(((5 - 4.47) / 2.5) * 30)); assert.equal(ta.parts[2].pts, Math.round(((1 - 317 / 623) / 0.75) * 30));
  assert.equal(team.private, true); assert.deepEqual(team.accounts.sort(), ['klaviyo', 'meta', 'shopify']);
  /* a simulated row is never evidence */
  const sim = auditScorecard({ profile: PROFILE, now: NOW, live: liveOf(ROWS.map((e) => ({ ...e, demo: true }))) });
  assert.ok(sim.areas.find((a) => a.k === 'ads').parts.some((p) => p.src === 'Meta Ad Library')); assert.equal(sim.private, undefined);
});

test('routines from Klaviyo: flows that run are skipped, flows that are off become routines to fix', () => {
  const pub = automationContext({ profile: PROFILE }), team = automationContext({ profile: PROFILE, live: liveOf(ROWS) });
  assert.ok(pub.routines.some((r) => r.k === 'review-ask') && pub.routines.some((r) => r.k === 'win-back')); assert.deepEqual(pub.skipped, []);
  assert.ok(!team.routines.some((r) => r.k === 'review-ask'), 'Post-purchase already runs: no review-ask routine');
  assert.ok(team.skipped.some((s) => /Post-purchase flow already runs/.test(s.why)));
  assert.match(team.routines.find((r) => r.k === 'win-back').why, /Win-back flow is not live in Klaviyo/);
  assert.ok(team.routines.some((r) => r.k === 'flow-browse-abandonment' && /Turn on the Browse abandonment flow/.test(r.name)));
  assert.ok(!team.routines.some((r) => /Welcome|Abandoned checkout/.test(r.name)), 'live flows are not proposed');
  assert.match(team.routines.find((r) => r.k === 'creative-refresh').why, /frequency over 7 days is 4\.47/);
  assert.equal(team.email, 'Klaviyo (connected)');
});

test('weekly run: the team gets a private run beside the public one, members see its cards, visitors never do; retiring takes both', async () => {
  const { ROOT, P } = mkPacks('cadence'), slug = 'acme-com'; await brand(P, slug);
  await P.put(slug, 'private/members.json', { owner: 'ana@acme.com', members: [{ email: 'ana@acme.com', role: 'owner' }] });
  let t = NOW; const ai = echoAI(), added = [], dropped = [];
  const S = createMovesScheduler({ packs: P, ai, cardsGen: fakeCardsGen, log: quiet, env: {}, now: () => t, onCards: (s, c, o) => added.push(...c.map((x) => ({ ...x, o }))), dropCards: (s, ids) => dropped.push(...ids) });
  const r = await S.runOne(slug, ['listen', 'auto']);
  assert.deepEqual(r.errors, []);
  assert.equal(ai.calls.filter((c) => c === 'moves-listen').length, 1, 'listening: the accounts add nothing to it, so no second paid run');
  assert.equal(ai.calls.filter((c) => c === 'moves-auto').length, 2, 'automation: one public run, one for the team');
  const pubAuto = r.written.filter((w) => w.family === 'auto').map((w) => w.n); assert.deepEqual(r.privWritten.map((w) => w.n), pubAuto, 'the team copy takes the numbers of the public run');
  const pub = await P.getJSON(slug, 'moves.json'), pm = await P.getJSON(slug, 'private/moves.json');
  for (const n of pubAuto) { assert.ok(pub[n] && pm[n]); assert.doesNotMatch(JSON.stringify(pub[n]), SECRET); assert.match(JSON.stringify(pm[n]), SECRET); assert.equal(pm[n].meta.private, true); }
  assert.ok(fs.existsSync(path.join(ROOT, '.brands', slug, `private/moves/${pubAuto[0]}.json`)));
  const ps = await P.getJSON(slug, 'private/audit/scorecard.json'); assert.equal(ps.private, true); assert.equal(ps.areas.find((a) => a.k === 'ads').from, 'account');
  assert.doesNotMatch(JSON.stringify(await P.getJSON(slug, 'audit/scorecard.json')), SECRET);
  const pc = await P.getJSON(slug, 'private/cards.json'); assert.deepEqual(pc.map((c) => c.id).sort(), pubAuto.map((n) => `m${n}-1-p`).sort());
  assert.ok(pc.every((c) => c.liveOnly === true && pubAuto.includes(c.privateOf)));
  assert.ok(added.filter((c) => /-p$/.test(c.id)).every((c) => c.o?.private), 'the team cards go to members only');
  /* nothing private in any public file of the brand */
  for (const f of publicFiles(ROOT, slug)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), SECRET, path.relative(ROOT, f));
  const st = await S.stateOf(slug); assert.deepEqual(st.privLive.auto, pubAuto); assert.deepEqual(st.privLive.listen, []);
  /* the feed: members get the team cards and the shared ones of the same moves step aside; a visitor gets neither */
  const auth = { claimInfo: async () => ({}), signinOn: () => true, isAdmin: () => false };
  const C = createConnectors({ packs: P, auth, builder: {}, treg: null, log: quiet });
  const mem = await C.forViewer(slug, true), vis = await C.forViewer(slug, false);
  assert.deepEqual(mem.cards.filter((c) => c.privateOf != null).map((c) => c.id).sort(), pubAuto.map((n) => `m${n}-1-p`).sort());
  assert.deepEqual(mem.privMoves.sort(), [...pubAuto].sort()); assert.match(JSON.stringify(mem.cards), SECRET);
  assert.deepEqual(vis.cards, []); assert.deepEqual(vis.privMoves, []); assert.doesNotMatch(JSON.stringify(vis), SECRET);
  /* a week later: the family's new run retires the public run and its team copy (history kept, cards dropped) */
  t = NOW + 8 * DAY; const r2 = await S.runOne(slug, ['auto']); assert.deepEqual(r2.errors, []);
  const pm2 = await P.getJSON(slug, 'private/moves.json'); assert.ok(pubAuto.every((n) => !pm2[n]), 'the old team copies are retired');
  assert.ok(fs.readdirSync(path.join(ROOT, '.brands', slug, 'private/moves/history')).some((f) => f.startsWith(`${pubAuto[0]}-`)));
  assert.ok(pubAuto.every((n) => dropped.includes(`m${n}-1-p`)), 'their cards leave the feed');
  const pc2 = await P.getJSON(slug, 'private/cards.json'); assert.ok(pc2.every((c) => !pubAuto.includes(c.privateOf)));
  /* the accounts disconnected: the next run writes no team copy and retires the last one */
  await P.put(slug, 'private/connected-ledger.json', []); t = NOW + 16 * DAY; const before = ai.calls.length;
  const r3 = await S.runOne(slug, ['auto']); assert.equal(ai.calls.length - before, 1, 'only the public run'); assert.deepEqual(r3.privWritten, []);
  assert.deepEqual(Object.keys(await P.getJSON(slug, 'private/moves.json')), [], 'no team copy left'); assert.deepEqual(await P.getJSON(slug, 'private/cards.json'), []);
});

test('weekly run with only simulated accounts: no private run at all', async () => {
  const { P } = mkPacks('sim'), slug = 'acme-com'; await brand(P, slug, ROWS.map((e) => ({ ...e, demo: true })));
  const ai = echoAI(); const S = createMovesScheduler({ packs: P, ai, cardsGen: fakeCardsGen, log: quiet, env: {}, now: () => NOW });
  const r = await S.runOne(slug, ['auto']); assert.deepEqual(r.privWritten, []); assert.equal(ai.calls.filter((c) => c === 'moves-auto').length, 1);
  assert.equal(await P.getJSON(slug, 'private/audit/scorecard.json', null), null); assert.equal(await P.getJSON(slug, 'private/moves.json', null), null);
});

/* ---------- 2. the scorecard ---------- */
test('scorecard route: a member gets the team scorecard (healed from today’s rows when missing), a visitor and a non-member the public one', async () => {
  const { P } = mkPacks('score'), slug = 'acme-com'; await brand(P, slug);
  const S = createMovesScheduler({ packs: P, ai: echoAI(), cardsGen: fakeCardsGen, log: quiet, env: {}, now: () => NOW });
  await P.put(slug, 'audit/scorecard.json', auditScorecard({ profile: PROFILE, slug, now: NOW }));
  await P.put(slug, 'moves/cadence.json', { runs: [{ at: NOW, written: [1001], privWritten: [1001] }], privLive: { auto: [1001] } });
  const get = async (viewer) => { const out = {}; const h = S.routes({ viewerOf: async () => viewer, readBody: async () => ({}), send: (res, code, body) => Object.assign(out, { code, body }) });
    await h({ method: 'GET' }, {}, new URL(`http://x/api/brands/${slug}/moves/cadence`)); return out; };
  for (const viewer of [{ member: false, claimed: true }, { member: false, gen: true }, {}]) {
    const r = await get(viewer); assert.equal(r.code, 200); assert.equal(r.body.scorecard.private, undefined); assert.equal(r.body.scorecard.areas.find((a) => a.k === 'ads').from, undefined);
    assert.doesNotMatch(JSON.stringify(r.body), SECRET); assert.equal(r.body.state.privLive, undefined); assert.equal(r.body.state.runs[0].privWritten, undefined); }
  assert.equal(await P.getJSON(slug, 'private/audit/scorecard.json', null), null, 'nothing saved yet');
  const m = await get({ member: true, claimed: true });
  assert.equal(m.body.scorecard.private, true); assert.equal(m.body.scorecard.areas.find((a) => a.k === 'ads').from, 'account'); assert.match(JSON.stringify(m.body.scorecard), /2\.73x/);
  assert.deepEqual(m.body.state.privLive, { auto: [1001] });
  assert.ok((await P.getJSON(slug, 'private/audit/scorecard.json')).private, 'healed and kept');
  /* no real account (only simulated rows): members get the public one too */
  await P.put(slug, 'private/connected-ledger.json', ROWS.map((e) => ({ ...e, demo: true })));
  assert.equal((await get({ member: true })).body.scorecard.private, undefined);
});

/* ---------- 3. ideas ---------- */
const { createIdeas } = await import('../ideas.js');
const { connectedFacts } = await import('../facts-desk.js');
/* a fake writer that always tries to quote the team's order value: the public stream must lose it, the team's may keep it */
const ideasAI = () => { const calls = [], prompts = []; return { live: true, calls, prompts, call: async (q) => { calls.push(q.tag); prompts.push(q.prompt);
  const slots = [...q.prompt.matchAll(/^slot (\d+):/gm)].map((m) => +m[1]);
  const acct = (q.prompt.match(/\[?(E\d+)\]?[^\n]*Average order value[^\n]*/) || [])[1];
  if (q.tag === 'ideas:slate') return { usd: 0.01, json: { items: [...new Set(slots)].map((slot) => ({ slot, angle: 'Our order value story', evidence: acct ? [acct] : ['E1'], where: [], moves: [], product: '', query: '' })) } };
  if (q.tag === 'ideas:write') return { usd: 0.01, json: { ideas: [...new Set(slots)].map((slot) => ({ slot, title: `Why people keep coming back ${'abcdefgh'[slot] || 'z'}`, hook: 'Comfort that lasts all day long.',
    copy: `${/\$623/.test(q.prompt) ? 'Our average order is $623 this month. ' : ''}People buy the Runner for comfort that lasts all day long and they tell their friends about it.`, cta: 'Shop the Runner', hashtags: ['#acme'], media: { kind: 'none' }, where: [], evidence: acct ? [acct] : [] })) } };
  return { usd: 0.01, json: { checks: [] } }; } }; };

test('ideas: the team’s stream may use the connected facts as evidence; the public stream never reads them', async () => {
  const { ROOT, P } = mkPacks('ideas'), slug = 'acme-com'; await brand(P, slug);
  await P.put(slug, 'private/facts.json', { at: NOW, facts: connectedFacts(ROWS, {}) });
  const pai = ideasAI(), pub = createIdeas({ slug, packs: P, ai: pai, treg: null, log: quiet, now: () => NOW });
  const team = createIdeas({ slug, packs: P, ai: ideasAI(), treg: null, log: quiet, now: () => NOW, member: true });
  const cp = await pub.load(), ct = await team.load();
  assert.equal(cp.ev.filter((e) => e.kind === 'account').length, 0, 'public evidence has no account facts'); assert.ok(!cp.allowNums.has('623'));
  assert.ok(ct.ev.some((e) => e.kind === 'account' && /Average order value/.test(e.label) && e.value === '$623')); assert.ok(ct.allowNums.has('623'));
  const rp = await pub.next({ n: 2 }), rt = await team.next({ n: 2 });
  assert.ok(rp.ideas.length && rt.ideas.length, JSON.stringify([rp.dropped, rt.dropped]).slice(0, 600));
  assert.ok(pai.prompts.length && pai.prompts.every((x) => !SECRET.test(x)), 'the public writer is never shown the team’s numbers'); assert.ok(rp.ideas.every((i) => !/623/.test(i.copy))); assert.ok(rt.ideas.some((i) => /\$623/.test(i.copy) && i.member));
  assert.doesNotMatch(JSON.stringify(await P.getJSON(slug, 'ideas/ideas.json')), SECRET);
  assert.match(JSON.stringify(await P.getJSON(slug, 'private/ideas/ideas.json')), /\$623/);
  for (const f of publicFiles(ROOT, slug)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), SECRET, path.relative(ROOT, f));
  /* the feed: members get the team's idea cards (members only), visitors none of them */
  const C = createConnectors({ packs: P, auth: { claimInfo: async () => ({}), signinOn: () => true, isAdmin: () => false }, builder: {}, treg: null, log: quiet });
  const mem = await C.forViewer(slug, true), vis = await C.forViewer(slug, false);
  const mi = mem.cards.filter((c) => c.memberIdea); assert.ok(mi.length); assert.ok(mi.every((c) => /-p$/.test(c.id) && c.liveOnly && c.stream === 'ideas'));
  assert.match(JSON.stringify(mi), /\$623/); assert.deepEqual(mem.privMoves, [], 'an idea is not a move');
  assert.deepEqual(vis.cards, []); assert.doesNotMatch(JSON.stringify(vis), SECRET);
});

test('ideas scheduler: the team’s stream runs only with real accounts connected, under the same daily cap', async () => {
  const { social } = { social: await import('../social-feed.js') }, { P } = mkPacks('ideas-sched'), slug = 'acme-com'; await brand(P, slug);
  const runs = []; const make = { listen: () => ({ run: async () => ({}) }), ideas: (s, o = {}) => ({ spend: {}, next: async () => { runs.push(!!o.member); return { ideas: [{}], usd: { ai: 0.4, treg: 0 } }; } }) };
  const S = social.createSocialScheduler({ packs: P, ai: { live: true }, treg: null, log: quiet, env: {}, now: () => NOW, make });
  await S.runOne(slug, { ideas: true, listen: false, left: 3 }); assert.deepEqual(runs, [false], 'no connected facts: public only');
  await P.put(slug, 'private/facts.json', { at: NOW, facts: connectedFacts(ROWS.map((e) => ({ ...e, demo: true })), {}) });
  runs.length = 0; await S.runOne(slug, { ideas: true, listen: false, left: 3 }); assert.deepEqual(runs, [false], 'simulated accounts: public only');
  await P.put(slug, 'private/facts.json', { at: NOW, facts: connectedFacts(ROWS, {}) });
  runs.length = 0; await S.runOne(slug, { ideas: true, listen: false, left: 3 }); assert.deepEqual(runs, [false, true], 'real accounts: the team’s stream too');
  const st = await S.stateOf(slug); assert.equal(st.memberIdeas.made, 1);
  /* the cap: spent up already, the team's run waits */
  st.spend = { day: new Date(NOW).toISOString().slice(0, 10), usd: 1.7 }; runs.length = 0; await S.runOne(slug, { ideas: true, listen: false, left: 1.3 });
  assert.deepEqual(runs, [false]); assert.match((await S.stateOf(slug)).memberIdeas.skipped, /cap/);
});

test('the feed knows a weekly move’s card by its number, so the shared one steps aside for the team’s copy', async () => {
  const { moveOfId } = await import('../feed-service.js');
  assert.equal(moveOfId('m04-1'), 4); assert.equal(moveOfId('m1004-1'), 1004); assert.equal(moveOfId('m1004-2-p'), 1004);
  assert.equal(moveOfId('statics-batch'), -1); assert.equal(moveOfId('idea-abc-p'), -1);
});

/* ---------- 4. static ads ---------- */
const { createStatics, teamStaticCards, teamStatic, teamStaticUrl } = await import('../statics.js');
const fakeBrowser = async () => ({ close: async () => {}, newPage: async () => ({ setViewport: async () => {}, setContent: async () => {}, close: async () => {},
  screenshot: async () => Buffer.from('JPEGBYTES'), $: async () => ({ screenshot: async () => Buffer.from('JPEGBYTES') }) }) });
const staticsAI = { call: async () => ({ json: { ads: [{ id: 'aov', product: 'runner', scene: 'a track at dawn', headline: 'Orders average $623', small: 'Comfort all day' }, { id: 'comfy', product: 'runner', scene: 'a porch', headline: 'Comfort all day', small: '' }] } }) };
const resOf = () => ({ code: 0, headers: {}, body: null, writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b; } });

test('static ads: the team’s set is made under private/ only, its cards point at the team route, and only members load the images', async () => {
  const { ROOT, P } = mkPacks('statics'), slug = 'acme-com'; await brand(P, slug);
  await P.put(slug, 'profile.json', { ...PROFILE, catalog: { ...PROFILE.catalog, products: [{ ...PROFILE.catalog.products[0], img: `b/${slug}/a/runner.jpg` }] } });
  await P.put(slug, 'assets/runner.jpg', Buffer.from('PHOTO'), 'image/jpeg');
  const S = createStatics({ ai: staticsAI, image: async () => Buffer.from('SCENE'), packs: P, launchBrowser: fakeBrowser, log: quiet });
  const move = { n: 21, sections: [{ blocks: [{ t: 'example', title: 'Ad', body: 'Headline: orders average $623' }] }] };
  const facts = { ...(await P.getJSON(slug, 'facts.json', {})), ...connectedFacts(ROWS, {}) };
  const r = await S.make(slug, { move, profile: await P.getJSON(slug, 'profile.json'), facts, priv: true });
  assert.deepEqual(r.ids, ['aov-1', 'comfy-2']);
  assert.ok(fs.existsSync(path.join(ROOT, '.brands', slug, 'private/statics/aov-1.jpg'))); assert.ok(fs.existsSync(path.join(ROOT, '.brands', slug, 'private/statics.json')));
  assert.ok(!fs.existsSync(path.join(ROOT, '.brands', slug, 'statics')), 'nothing under the public statics/ folder'); assert.equal(await P.getJSON(slug, 'statics.json', null), null);
  for (const f of publicFiles(ROOT, slug)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), SECRET, path.relative(ROOT, f));
  /* the cards: members only, belonging to the team's Move 21, images on the team route */
  const cards = teamStaticCards(slug, r.ids, r.text, { name: 'Acme' });
  assert.deepEqual(cards.map((c) => c.id), ['statics-batch-p', 'static-aov-1-p', 'static-comfy-2-p']);
  assert.ok(cards.every((c) => c.liveOnly && c.privateOf === 21 && c.images.every((u) => u.startsWith(`b/${slug}/team/statics/`) && !u.includes(`b/${slug}/statics/`))));
  await P.put(slug, 'private/cards.json', cards);
  const C = createConnectors({ packs: P, auth: { claimInfo: async () => ({}), signinOn: () => true, isAdmin: () => false }, builder: {}, treg: null, log: quiet });
  const mem = await C.forViewer(slug, true), vis = await C.forViewer(slug, false);
  assert.equal(mem.privStatics, true); assert.ok(mem.cards.some((c) => c.id === 'static-aov-1-p' && /\$623/.test(c.headline) && /^Run this ad for/.test(c.title)));
  assert.equal(vis.privStatics, false); assert.deepEqual(vis.cards, []);
  const { isStaticCard } = await import('../feed-service.js'); assert.ok(isStaticCard('statics-batch') && isStaticCard('static-x-1') && !isStaticCard('statics-batch-p'.replace(/^/, 'm')));
  /* the team route: a member gets the bytes; a signed-out visitor 401, a signed-in non-member 403; never a path */
  const send = (res, code, body) => { res.code = code; res.body = body; };
  const get = async (viewer, signed, name = 'aov-1.jpg') => { const res = resOf(); await teamStatic({}, res, slug, name, { viewerOf: async () => viewer, signedIn: () => signed, packs: P, send }); return res; };
  const ok = await get({ member: true }, true); assert.equal(ok.code, 200); assert.equal(String(ok.body), 'JPEGBYTES'); assert.match(ok.headers['cache-control'], /private, no-store/);
  assert.equal((await get({ member: false }, false)).code, 401); assert.equal((await get({ member: false, gen: true }, true)).code, 403);
  assert.equal((await get({ member: true }, true, '../statics.json')).code, 404); assert.equal((await get({ member: true }, true, 'nope.jpg')).code, 404);
  assert.equal(teamStaticUrl(slug, 'x'), `b/${slug}/team/statics/x.jpg`);
});

test('static ads: the public set still goes to statics/ for everyone', async () => {
  const { ROOT, P } = mkPacks('statics-pub'), slug = 'acme-com'; await brand(P, slug);
  await P.put(slug, 'profile.json', { ...PROFILE, catalog: { ...PROFILE.catalog, products: [{ ...PROFILE.catalog.products[0], img: `b/${slug}/a/runner.jpg` }] } });
  await P.put(slug, 'assets/runner.jpg', Buffer.from('PHOTO'), 'image/jpeg');
  const S = createStatics({ ai: staticsAI, image: async () => Buffer.from('SCENE'), packs: P, launchBrowser: fakeBrowser, log: quiet });
  const r = await S.make(slug, { move: { n: 21, sections: [] }, profile: await P.getJSON(slug, 'profile.json'), facts: {} });
  assert.deepEqual(r.ids, ['comfy-1'], 'the public set never carries a number only the team has');
  assert.ok(fs.existsSync(path.join(ROOT, '.brands', slug, 'statics/comfy-1.jpg'))); assert.ok(!fs.existsSync(path.join(ROOT, '.brands', slug, 'private/statics')));
});
