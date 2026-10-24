// The showcase never presents simulated or invented content as real (handover P0, 2026-10-15):
// no canned sign-offs, simulated teammates change nothing and leak nowhere, simulated account numbers are never evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { simulated, realRows } from '../connectors/common.js';
import { createHandoff } from '../handoff.js';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('no canned sign-offs: nothing claims a check, approval or consent that nobody gave', () => {
  const s = src('remix.js') + src('feed-service.js');
  for (const re of [/Verified this morning/, /Cleared\. Every claim/, /used with consent/, /Approving ✅/, /approved v\$\{w\.current\}\. Ready to ship/, /const ANSWERS = \{/])
    assert.doesNotMatch(s, re, `found ${re}`);
  /* "Posted to" only after Slack really took it (the server's r.posted, from chat.postMessage) */
  const jr = src('public/jam-room.js'), posted = [...jr.matchAll(/Posted to \$\{/g)];
  for (const m of posted) assert.match(jr.slice(Math.max(0, m.index - 120), m.index), /if \(r\.posted\)/, 'no toast says something was posted unless it was');
});

test('a simulated teammate reply changes no stage and is tagged', () => {
  const s = src('feed-service.js'); const i = s.indexOf('const colleagueReply'); const body = s.slice(i, s.indexOf('const answerOnly', i));
  assert.match(body, /say\(t, w, \{ from: 'colleague', who, body: r\.reply, dummy: true \}\)/);
  assert.doesNotMatch(body, /move\(t, w, '(ready|needs_you)'/);
});

test('simulated account rows: flagged ones and old unflagged connector rows never count; real rows do', () => {
  const sim = { key: 'shopify.revenue.30d', v: '₹1 Cr', method: 'connected account', demo: true };
  const old = { key: 'meta.roas', v: '3.1x', method: 'connected account' }; // saved before the flag was kept
  const real = { key: 'meta.ads.live', v: '42', method: 'account:meta' };
  assert.ok(simulated(sim) && simulated(old) && !simulated(real));
  assert.deepEqual(realRows([sim, old, real]), [real]);
  assert.deepEqual(realRows({ a: sim, b: real }), [real]);
});

test('the shared brief leaves out simulated chat and simulated answers', async () => {
  const HO = createHandoff({ RMX: null, pageOf: async () => null, fillCard: (c) => c, SEED: { brand: { name: 'Acme' } } });
  const w = { id: 'wk_1', cardId: 'c1', title: 'A card', agent: 'creative', stage: 'drafting', versions: [], current: 1,
    thread: [{ id: 'm1', from: 'me', body: 'Can we ship Friday?' }, { id: 'm2', from: 'colleague', who: 'Brand manager', body: 'Approved.', dummy: true },
      { id: 'm3', from: 'brew', who: 'Deploy lead', body: 'The ShopOS team has it.' }, { id: 'm4', from: 'ai', body: 'Suggested: Friday works.' }],
    plan: { questions: [{ q: 'Are the claims cleared?', answer: 'Cleared.', by: 'teammate:Brand manager' }, { q: 'Sizes?', answer: 'Suggested: 1:1 and 4:5.', by: 'ai:creative' }, { q: 'Owner?', answer: 'Me', by: 'you' }] } };
  const t = { id: 't_1', cards: new Map(), viewer: {} };
  const x = await HO.build(t, w);
  assert.deepEqual(x.jam.map((m) => m.text), ['Can we ship Friday?', 'Suggested: Friday works.']);
  assert.deepEqual(x.questions.map((q) => q.a), [null, 'Suggested: 1:1 and 4:5.', 'Me']);
});

test('the festival is always the next one: it rolls to next year once the day has passed', async () => {
  const { nextFestival } = await import('../calendar.js');
  assert.equal(nextFestival('IN', new Date('2026-10-15')).date.slice(0, 10), '2026-11-08');
  assert.equal(nextFestival('IN', new Date('2026-11-09')).date.slice(0, 10), '2027-10-29');
  const us = nextFestival('US', new Date('2026-11-28')); assert.equal(us.name, 'Black Friday'); assert.equal(us.date.slice(0, 10), '2027-11-26');
  assert.match(us.label, /2027$/, 'a date next year says the year');
});

test('saved moves and seeds read honestly: no "OF N" kicker, no watching promise, no cut-feature welcome', async () => {
  const { brewFile } = await import('../brew-name.js');
  const saved = JSON.stringify({ kicker: 'PRICING · MOVE 65 OF 64', body: 'What Brew will watch: listen.x. | WEEK | BREW SHIPS |', h: 'Fifty-one moves, turned into cards.', w: 'Heart it, jam on it, do it.' });
  const out = brewFile('moves.json', Buffer.from(saved)).toString();
  assert.match(out, /PRICING · MOVE 65"/); assert.match(out, /What to watch:/); assert.match(out, /BREW DRAFTS/);
  assert.match(out, /Your moves, turned into cards\./); assert.match(out, /share the brief/); assert.doesNotMatch(out, /OF 64|Brew will watch|do it\./);
});

test('PDFs are drawn on download: once per move version (a failed render is tried again), a rule change forgets old ones, retired moves leave the list', async () => {
  const os = await import('node:os'); const path = await import('node:path');
  const { createPacks } = await import('../brand-pack.js'); const { createBuilder } = await import('../build.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-pdf-')); const quiet = { log() {}, warn() {}, error() {} };
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = 'acme-com';
  await P.put(slug, 'status.json', { slug, done: true, pdfV: 1, pdfs: { 1: '1 One.pdf', 1001: '1001 Retired.pdf' } });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.com' });
  await P.put(slug, 'moves.json', { 1: { n: 1, title: 'One', kicker: 'X · MOVE 01', meta: { at: 'a' } }, 2: { n: 2, title: 'Two', kicker: 'X · MOVE 02', meta: { at: 'b' } } });
  let tries = 0; const drawn = [];
  const pdf = { pdfName: (m) => `${m.n} ${m.title}.pdf`, zipBuffer: () => Buffer.from('zip'),
    renderMove: async (m, brand, out) => { if (m.n === 2 && !tries++) throw new Error('chrome hiccup'); drawn.push(m.n); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, 'pdf'); } };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {} }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves: null, pdf } });
  await b.healPdfs(slug);
  let st = await P.getJSON(slug, 'status.json');
  assert.deepEqual(st.pdfs, {}, 'a rule change forgets the saved PDFs instead of drawing them all'); assert.equal(st.pdfV, 10); assert.deepEqual(drawn, []);
  const r = await b.pdfOn(slug, 2); assert.equal(r.name, '2 Two.pdf'); assert.ok(r.buf?.length);
  assert.deepEqual(drawn, [2], 'drawn on its first download, after one retry');
  await b.pdfOn(slug, 2); assert.deepEqual(drawn, [2], 'the second download is served from the pack');
  await P.put(slug, 'moves.json', { 1: { n: 1, title: 'One', meta: { at: 'a' } }, 2: { n: 2, title: 'Two', meta: { at: 'c' } } });
  await b.pdfOn(slug, 2); assert.deepEqual(drawn, [2, 2], 'a rewritten move is drawn again');
  assert.equal(await b.pdfOn(slug, 9), null, 'no such move, no PDF');
  st = await P.getJSON(slug, 'status.json'); assert.deepEqual(Object.keys(st.pdfs), ['2']);
});

test('the told lift needs learnings, and only moves written after them count', async () => {
  const { cardUsesLearned, learnedMoveNs } = await import('../brand-learnings.js');
  assert.equal(cardUsesLearned('The team says the serum sells best', []), false, 'no learnings, no lift');
  assert.equal(cardUsesLearned('The team says the serum sells best', [['micro', 'drama', 'buckets']]), true);
  const L = { at: '2026-10-14T10:00:00Z', goals: [{ text: 'Plan a micro-drama concept document across three age buckets' }] };
  const moves = { 3: { title: 'Old', meta: { at: '2026-10-01T00:00:00Z' }, sections: ['the team says'] }, 4: { title: 'New', meta: { at: '2026-10-15T00:00:00Z' }, sections: ['the team says'] } };
  assert.deepEqual([...learnedMoveNs(moves, L)], [4]);
});

test('card pages and the studio get passages from generated moves (blocks, not paras)', async () => {
  const { runIn } = await import('../brand-ctx.js'); const { createMoves } = await import('../moves.js');
  const moveDocs = { 7: { n: 7, title: 'Price the pack', gives: 'g', sections: [{ h: 'What we found', kind: 'found', blocks: [{ t: 'p', text: 'The pack of three serum costs more than three single serum bottles bought one by one, so buyers who compare pack prices and single bottle prices leave.' }, { t: 'list', items: ['Fix the pack price before any serum ad names it'] }] }, { h: 'Why', kind: 'why', blocks: [{ t: 'p', text: 'Why it matters.' }] }] } };
  const MV = createMoves('.');
  const out = runIn({ moveDocs, labels: {} }, () => MV.passages({ src: 'Move 07', title: 'Fix the serum pack price', sub: 'Pack prices and single bottle prices' }));
  assert.ok(out.length >= 1 && /pack/.test(out[0].text));
  assert.equal(runIn({ moveDocs, labels: {} }, () => MV.summary(7)).why, 'Why it matters.');
});

test('outbound fetches reach only the public internet: private, loopback, metadata and file addresses are refused', async () => {
  const { privateIp, publicUrl } = await import('../reader/util.js');
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.ok(privateIp(ip), ip);
  for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) assert.ok(!privateIp(ip), ip);
  for (const u of ['http://169.254.169.254/computeMetadata/v1/', 'http://localhost:4200/', 'http://metadata.google.internal/', 'file:///etc/passwd', 'http://[::1]/', 'http://10.0.0.1/']) await assert.rejects(() => publicUrl(u), u);
});

test('old move text reads honestly: no Brew re-reads, watches, ships, or we pause/revert; the index title has no drifting count', async () => {
  const { brewText } = await import('../brew-name.js');
  const out = brewText('Sixty-four moves for Arata. Between checks, Brew re-reads listen.x. Brew watches the CPA. We pause it if CPA rises, then we revert. Brew ships it.');
  assert.doesNotMatch(out, /Brew re-reads|Brew watches|Brew ships|\bwe (pause|revert)\b|\bWe (pause|revert)\b|Sixty-four/);
  assert.match(out, /^The moves for Arata\./); assert.match(out, /The team ships it\.$/);
});

test('a failed or paused AI answer says so: never a canned yes, and the pause reaches the jam client and the UI', () => {
  assert.doesNotMatch(src('feed-service.js'), /Short answer: yes, it fits the plan/);
  const s = src('server.js');
  assert.match(s, /const claudeCreate = async/, 'the jam client shares the ai.js pause');
  assert.doesNotMatch(s.replace(/const claudeCreate[^\n]*\n/, ''), /anthropic\.beta\.messages\.create\(/, 'every jam call goes through claudeCreate');
  assert.match(s, /paused: !MOCK && aiPaused\(\)/, '/api/config reports the pause');
});

test('"email me when the moves are in" takes only the signed-in person’s own address', () => {
  assert.match(src('server.js'), /We can only email you, at \$\{me\.email\}/);
});

test('photo links are fetched through safeFetch (public internet only)', () => {
  for (const f of ['server.js', 'drafts.js', 'drafts-bg.js']) assert.doesNotMatch(src(f), /await fetch\((u|rel), \{ signal/, f);
});

test('outside the team on live, the onboarding stream and the brand status give away no findings or move titles', () => {
  assert.match(src('feed-service.js'), /\\\/onboarding\$\/\.test\(u\.pathname\)\) \{ res\.writeHead\(200/);
  assert.match(src('server.js'), /const \{ pdfs, zips, statics, usd, proBy, proAt, \.\.\.pub \} = s/);
});

test('a real connector row is evidence; a simulated one never is', async () => {
  const { L } = await import('../connectors/common.js');
  const real = L('shopify.orders.30d', 'Orders, last 30 days', '120', 120, 'Shopify · x.myshopify.com');
  assert.equal(real.method, 'account:shopify'); assert.equal(simulated(real), false); assert.equal(realRows([real]).length, 1);
  assert.equal(simulated({ ...real, demo: true }), true); assert.equal(simulated({ ...real, method: 'connected account' }), true);
});

test('Google Analytics and Google Ads are two connectors; an old pack heals into both', async () => {
  const { prototypeConnectors } = await import('../seed-template.js');
  const out = prototypeConnectors({ google: { name: 'Google Ads + GA4', account: 'Acme · Google', kind: 'Search, Shopping and site events', perms: ['Read campaigns and searches', 'Read GA4 events and sales'], changed: ['Tracking card shows the live gap', 'Search cards show real searches'] } });
  assert.equal(out.google.name, 'Google Ads'); assert.equal(out.ga4.name, 'Google Analytics');
  assert.ok(!out.google.perms.some((x) => /GA4/.test(x)));
  const { default: gads, ga4 } = await import('../connectors/google.js');
  assert.equal(gads.id, 'google'); assert.equal(ga4.id, 'ga4'); assert.deepEqual(gads.modes, ['oauth']); assert.ok(ga4.modes.includes('key'));
  const pend = { token: 't', scope: 'adwords analytics' }, ch = { ads: '123:999', adsName: 'Acme Ads', ga4: 'properties/5', ga4Name: 'Acme GA4' };
  const a = gads.select(pend, ch); assert.equal(a.customer, '123'); assert.equal(a.login, '999'); assert.equal(a.property, null);
  const [also] = gads.also(pend, ch); assert.equal(also.id, 'ga4'); assert.equal(also.creds.property, 'properties/5'); assert.equal(also.creds.customer, null);
});

test('connectors re-read on their own cadence, and new ones get the default', async () => {
  const { everyOf, due } = await import('../connectors/index.js');
  const H = 3600e3, now = Date.now();
  assert.equal(everyOf('shopify'), 3 * H); assert.equal(everyOf('meta'), 3 * H); assert.equal(everyOf('ga4'), 6 * H); assert.equal(everyOf('google'), 6 * H); assert.equal(everyOf('klaviyo'), 12 * H);
  assert.equal(everyOf('some-future-connector'), 12 * H);
  assert.equal(due('shopify', { lastSync: now - 7 * H }, now), true);
  assert.equal(due('shopify', { lastSync: now - 2 * H }, now), false);
  assert.equal(due('ga4', { lastSync: now - 5 * H }, now), false);
  assert.equal(due('klaviyo', { lastSync: now - 7 * H }, now), false);
  assert.equal(due('shopify', { lastSync: now - 7 * H, error: 'x', errorAt: now - H }, now), false, 'a failed read waits 3 hours');
  assert.equal(due('shopify', { lastSync: now - 7 * H, error: 'x', errorAt: now - 4 * H }, now), true);
});

test('a team visit re-reads what is older than its open window; stale follows each cadence', async () => {
  const { dueOnOpen, staleHOf, failure } = await import('../connectors/index.js');
  const H = 3600e3, now = Date.now(), live = (h, x = {}) => ({ state: 'live', lastSync: now - h * H, ...x });
  assert.equal(dueOnOpen('shopify', live(1.5), now), true); assert.equal(dueOnOpen('shopify', live(0.5), now), false);
  assert.equal(dueOnOpen('ga4', live(1.5), now), false); assert.equal(dueOnOpen('ga4', live(2.5), now), true);
  assert.equal(dueOnOpen('meta', live(3, { retryAt: now + H }), now), false, 'a backoff is respected');
  assert.equal(dueOnOpen('meta', live(3, { needsReconnect: true }), now), false);
  assert.equal(dueOnOpen('meta', { state: 'syncing', lastSync: now - 3 * H }, now), false, 'one read at a time');
  assert.equal(staleHOf('shopify'), 24); assert.equal(staleHOf('klaviyo'), 48); assert.equal(staleHOf(null), 72);
  assert.equal(failure({ lastSync: now - 30 * H }, {}, now, () => 0.5, 'shopify').stale, true, 'Shopify numbers a day and more old are not the truth');
  assert.equal(failure({ lastSync: now - 30 * H }, {}, now, () => 0.5, 'klaviyo').stale, false);
});

test('Google Ads: a failed account list says why, never "no account"', async () => {
  const g = (await import('../connectors/google.js')).default;
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN ||= 'dev'; const f0 = globalThis.fetch;
  globalThis.fetch = async (u) => ({ ok: !/googleads/.test(u), status: /googleads/.test(u) ? 404 : 200, text: async () => (/googleads/.test(u) ? 'Not Found' : '{}') });
  try {
    const os = await g.options({ scope: 'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly', access: 't' });
    assert.match(os.adsNote || '', /didn’t list the Ads accounts.*404/);
    const os2 = await g.options({ scope: 'https://www.googleapis.com/auth/analytics.readonly', access: 't' });
    assert.match(os2.adsNote || '', /wasn’t allowed/);
  } finally { globalThis.fetch = f0; }
});

test('Judge.me: one-click sign-in switches on with its client keys, and its token reads as Bearer without a store', async () => {
  const j = (await import('../connectors/reviews.js')).default;
  delete process.env.JUDGEME_CLIENT_ID; delete process.env.JUDGEME_CLIENT_SECRET;
  assert.equal(j.oauthOn(), false, 'off until Judge.me registers Brew');
  process.env.JUDGEME_CLIENT_ID = 'cid'; process.env.JUDGEME_CLIENT_SECRET = 'sec';
  try {
    assert.equal(j.oauthOn(), true);
    assert.match(j.authorize({ state: 's', redirect: 'https://x/connect/reviews/callback' }), /^https:\/\/app\.judge\.me\/oauth\/authorize\?client_id=cid&.*response_type=code/);
    const f0 = globalThis.fetch, seen = [];
    globalThis.fetch = async (u, o = {}) => { seen.push({ u: String(u), h: o.headers || {} });
      const body = /oauth\/token/.test(u) ? { access_token: 'tok', refresh_token: 'r', expires_in: 3600 } : { shop: { domain: 'cozy.myshopify.com' } };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) }; };
    try {
      const c = await j.exchange({ query: new URLSearchParams('code=abc'), redirect: 'https://x/cb' });
      assert.equal(c.shop, 'cozy.myshopify.com'); assert.equal(c.oauth, true); assert.equal(c.token, 'tok');
      const info = seen.find((x) => /shops\/info/.test(x.u)); assert.equal(info.h.authorization, 'Bearer tok'); assert.ok(!/shop_domain|api_token/.test(info.u));
    } finally { globalThis.fetch = f0; }
  } finally { delete process.env.JUDGEME_CLIENT_ID; delete process.env.JUDGEME_CLIENT_SECRET; }
});
