// Ops, auth and connectors before the first real client (2026-10-17): the person who started a read is never locked out of it,
// Meta Ads reads several ad accounts at once (an old single-account connection heals into the list), one failed write never
// blocks the connections file, pasted keys are counted per connector, one brand's reads never overlap, GA4 signs in through
// the Google callback the OAuth client knows, and a GA4 stream read that fails is said as such. Free: fetch is stubbed.
process.env.BUILD_RESUME_OFF = '1'; process.env.DEMO_MODE = '';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
const { createAuth } = await import('../auth.js');
const { createConnectors } = await import('../connectors/index.js');
const { default: meta, accountsOf } = await import('../connectors/meta.js');
const { ga4 } = await import('../connectors/google.js');
const { createVault } = await import('../vault.js');

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const memPacks = (brands = []) => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, failPut: null, getJSON: async (s, n, d = null) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d),
    async put(s, n, o) { if (this.failPut === n) { this.failPut = null; throw new Error('bucket hiccup'); } D.set(k(s, n), typeof o === 'string' ? o : JSON.stringify(o)); },
    list: async () => brands.map((slug) => ({ slug })) }; };
const res200 = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const resErr = (status, body) => ({ ok: false, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const withFetch = async (f, run) => { const f0 = globalThis.fetch; globalThis.fetch = f; try { return await run(); } finally { globalThis.fetch = f0; } };
const fakeRes = () => ({ code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; }, setHeader() {}, getHeader() {} });
const fakeReq = (method, cookie, body) => Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method, headers: { cookie, host: 'x.test', 'content-type': 'application/json' } });

/* ---------- 1. the person who started the read ---------- */
test('starting a read opens nothing: only the brand’s own email (or an invite, or SquareUp) opens or claims it', async () => {
  const packs = memPacks(['acme-in']), auth = createAuth({ packs, hostOf: async () => 'acme.in', log: quiet }); auth.mail = async () => true;
  await packs.put('acme-in', 'private/created.json', { by: 'founder@gmail.com', at: Date.now() });
  const founder = { email: 'founder@gmail.com' }, work = { email: 'ana@acme.in' };
  const a = await auth.claimInfo('acme-in', founder);
  assert.equal(a.gen, false, 'a Gmail that started the read is not let in (Param, 23 Oct)'); assert.equal(a.eligible, false); assert.equal(a.starter, false);
  assert.match((await auth.claim('acme-in', founder, 'Confirmed the read')).error, /work email at acme\.in/, 'nor may it claim the brand');
  assert.equal((await auth.claimInfo('acme-in', { email: 'x@otherco.com' })).gen, false, 'another company is not let in');
  assert.equal((await auth.claimInfo('acme-in', work)).gen, true, 'the brand’s own email is');
  const c = await auth.claim('acme-in', work, 'Confirmed the read'); assert.equal(c.role, 'owner');
  assert.equal((await auth.getMembers('acme-in')).owner, 'ana@acme.in');
  assert.equal((await auth.claimInfo('acme-in', { email: 'param@joinsquareup.com' })).gen, true, 'SquareUp sees every brand');
  assert.equal((await auth.claimInfo('acme-in', { email: 'x@shopos.ai' })).gen, true);
});

test('the live site’s gate never says “Demo mode”, and sign-in can’t be off on Cloud Run by accident', () => {
  const s = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const gate = s.split('\n').find((l) => l.includes("if (!v.gen && req.method === 'POST' && what !== 'notify') return send(res, 403"));
  assert.ok(gate && !/Demo mode/.test(gate)); assert.match(gate, /ask the owner for an invite/); assert.ok(!/you used to start this read/.test(s), 'starting a read is never a way in');
  assert.match(s, /const demoErr = \(host\) => \(\{ error: DEMO \?/);
  /* outsiders spend nothing and hear nothing (23 Oct): a new brand is read only for its own email; the moves emails only for the team */
  assert.match(s, /!officialFor\(me\.email, host\) && !\(await packs\.getJSON\(sl, 'status\.json', null\)/);
  assert.match(s, /if \(me && !v\.gen\) return send\(res, 403, \{ error: 'The moves emails are for the brand’s team/);
  assert.match(s, /const visSeen = [^\n]*!a\?\.host/);
  assert.match(s, /process\.env\.K_SERVICE && !auth\.signinOn\(\) && process\.env\.OPEN_SITE !== '1'\) throw/);
  assert.match(s, /budget\.flush\(\), tregLedger\.flush\(\), visFlush\(\), jamMail\.drain\(\), closed/, 'SIGTERM flushes everything');
});

/* ---------- 2. Meta Ads: several ad accounts ---------- */
const PAGES = { 1: [{ id: 'p1', name: 'Acme', website: 'https://acme.in' }], 2: [{ id: 'p1', name: 'Acme', website: 'https://www.acme.in/' }], 3: [{ id: 'p9', name: 'Agency client', website: 'https://other.com' }] };
const NAME = { 1: 'Acme US', 2: 'Acme EU', 3: 'Agency' }, SPEND = { 1: ['100', '4', '400'], 2: ['50', '1', '100'], 3: ['999', '9', '9'] };
const graph = (calls = []) => async (url) => { const u = new URL(url), p = u.pathname.replace(/^\/v[\d.]+\//, ''); calls.push(p);
  if (p === 'me/adaccounts') return res200({ data: [1, 2, 3].map((n) => ({ account_id: String(n), name: NAME[n], currency: 'USD', account_status: 1 })) });
  const m = p.match(/^act_(\d)(?:\/(\w+))?$/); if (!m) return resErr(404, { error: { message: 'no' } }); const [, n, what] = m;
  if (!what) return res200({ name: NAME[n], currency: 'USD' });
  if (what === 'promote_pages') return res200({ data: PAGES[n] });
  if (what === 'ads') return res200({ data: [{ id: `a${n}`, effective_status: 'ACTIVE', creative: { object_story_spec: { page_id: PAGES[n][0].id } } }] });
  if (what === 'insights') { const [s, b, v] = SPEND[n];
    return res200({ data: u.searchParams.get('level') === 'ad' ? [{ ad_id: `a${n}`, ad_name: `Ad ${n}`, campaign_id: `c${n}`, campaign_name: `Camp ${n}`, frequency: '2', spend: '14', action_values: [{ action_type: 'purchase', value: '28' }] }]
      : [{ spend: s, reach: '1000', actions: [{ action_type: 'purchase', value: b }], action_values: [{ action_type: 'purchase', value: v }] }] }); }
  return resErr(404, { error: { message: 'no' } }); };
const CTX = { slug: 'acme-in', host: 'acme.in', profile: { name: 'Acme', host: 'acme.in', currency: 'USD', country: 'US' }, lane: 'core', pageId: null };

test('Meta: an old single-account connection heals into accounts, and the pick takes one or many', () => {
  assert.deepEqual(accountsOf({ account: '1', accountName: 'Old' }), [{ id: '1', name: 'Old' }]);
  assert.deepEqual(accountsOf({ accounts: [{ id: 'act_1' }, { id: '1' }, { id: '2', name: 'B' }] }), [{ id: '1' }, { id: '2', name: 'B' }], 'act_ prefix and duplicates go');
  assert.deepEqual(meta.select({ token: 't' }, { account: 'act_7', name: 'Seven' }).accounts, [{ id: '7', name: 'Seven' }], 'the old pick still works');
  const two = meta.select({ token: 't', account: '9' }, { accounts: [{ id: '1', name: 'A' }, { id: 'act_2', name: 'B' }] });
  assert.deepEqual(two.accounts.map((a) => a.id), ['1', '2']); assert.equal(two.account, '1'); assert.equal(two.token, 't');
});

test('Meta: every picked ad account is read, the numbers are the sum, each account keeps its own on the row', async () => {
  const r = await withFetch(graph(), () => meta.sync({ token: 'tok', accounts: [{ id: '1' }, { id: '2' }] }, CTX));
  const L = Object.fromEntries(r.ledger.map((e) => [e.key, e]));
  assert.equal(L['meta.spend.30d'].n, 150); assert.equal(L['meta.cpa'].n, 30); assert.equal(L['meta.roas'].n, 3.33); assert.equal(L['meta.ads.live'].n, 2);
  assert.match(L['meta.spend.30d'].label, /2 ad accounts/); assert.match(r.stats[0][0], /Spend across 2 ad accounts/);
  assert.deepEqual(r.accounts.map((a) => [a.id, a.name, a.spend, a.purchases]), [['1', 'Acme US', 100, 4], ['2', 'Acme EU', 50, 1]]);
  assert.equal(r.account.name, '2 ad accounts'); assert.equal(r.account.id, 'act_1 act_2');
  /* one account is the same as before */
  const one = await withFetch(graph(), () => meta.sync({ token: 'tok', account: '1' }, CTX));
  assert.equal(one.ledger.find((e) => e.key === 'meta.spend.30d').n, 100); assert.equal(one.account.name, 'Acme US');
});

test('Meta: ownership is checked per account, and the picker ticks the brand’s own', async () => {
  const p = await withFetch(graph(), () => meta.owns({ token: 'tok', accounts: [{ id: '1' }, { id: '3' }] }, CTX));
  assert.equal(p.ok, false); assert.deepEqual(p.accounts.map((a) => a.ok), [true, false]); assert.match(p.why, /Agency: None of this ad account’s pages is acme\.in’s page/);
  assert.equal((await withFetch(graph(), () => meta.owns({ token: 'tok', accounts: [{ id: '1' }, { id: '2' }] }, CTX))).ok, true);
  const os = await withFetch(graph(), () => meta.options({ token: 'tok' }, { ctx: CTX }));
  assert.deepEqual(os.map((o) => [o.id, o.own]), [['1', true], ['2', true], ['3', false]]);
});

/* ---------- the connectors module: heal on read, one read per brand, a failed write never blocks the file ---------- */
const rig = async ({ conn, creds } = {}) => {
  const P = memPacks(['acme-in']), runs = { cur: 0, max: 0 };
  await P.put('acme-in', 'profile.json', CTX.profile);
  await P.put('acme-in', 'private/connections.json', { meta: { state: 'live', lastSync: Date.now() - 7 * 3600e3, verified: true, account: { id: 'act_1', name: 'Acme US' }, ...conn } });
  const auth = { claimInfo: async () => ({ host: 'acme.in', role: 'owner', gen: true }), signinOn: () => true, isAdmin: () => false, getMembers: async () => ({ members: [] }), mail: async () => true };
  const builder = { liveConnected: async () => { runs.cur++; runs.max = Math.max(runs.max, runs.cur); await new Promise((r) => setTimeout(r, 25)); runs.cur--; }, staleConnected: async () => {} };
  const C = createConnectors({ packs: P, auth, builder, log: quiet });
  await createVault(P).save('acme-in', 'meta', creds || { token: 'tok', account: '1', exp: null, expChecked: 1 });
  return { P, C, runs, conn: async () => (await P.getJSON('acme-in', 'private/connections.json')).meta };
};

test('an existing single-account Meta connection keeps working and shows as a list; several show as “N ad accounts”', async () => {
  const { C } = await rig();
  const v0 = await C.liveView('acme-in', { email: 'ana@acme.in' });
  assert.deepEqual(v0.conns.meta.accounts, [{ id: 'act_1', name: 'Acme US' }], 'healed on read'); assert.equal(v0.conns.meta.account, 'Acme US');
  const calls = []; const r = await withFetch(graph(calls), () => C.sync('acme-in', 'meta'));
  assert.equal(r.ok, true); assert.ok(!calls.some((p) => p.startsWith('act_2')), 'only the account it had');
  const { C: C2, conn } = await rig({ creds: { token: 'tok', accounts: [{ id: '1' }, { id: '2' }], expChecked: 1 } });
  const r2 = await withFetch(graph(), () => C2.sync('acme-in', 'meta')); assert.equal(r2.ok, true);
  const s = await conn(); assert.deepEqual(s.accounts.map((a) => [a.id, a.spend]), [['1', 100], ['2', 50]], 'the per-account breakdown is on the row');
  assert.equal((await C2.liveView('acme-in', { email: 'ana@acme.in' })).conns.meta.account, '2 ad accounts');
  assert.match(fs.readFileSync(new URL('../public/live.js', import.meta.url), 'utf8'), /Use these \$\{n\} accounts/);
});

test('a manual Sync and the hourly tick never read the same brand at once', async () => {
  const { C, runs } = await rig();
  const [a, b] = await withFetch(graph(), () => Promise.all([C.sync('acme-in', 'meta'), C.sync('acme-in', 'meta')]));
  assert.equal(a.ok && b.ok, true); assert.equal(runs.max, 1, 'one after the other');
});

test('one failed write to the connections file never blocks the next one', async () => {
  const { P, C, conn } = await rig({ conn: { lastSync: Date.now() - 80 * 3600e3 } });
  P.failPut = 'private/connections.json';
  await assert.rejects(C.ageCheck('acme-in', 'meta'), /bucket hiccup/);
  assert.equal(await C.ageCheck('acme-in', 'meta'), true, 'the lock chain carries on'); assert.equal((await conn()).stale, true);
});

/* ---------- 6. pasted keys, per connector ---------- */
test('pasted keys are limited per person and per connector: a typo-heavy Klaviyo doesn’t block Judge.me', async () => {
  const packs = memPacks(['acme-in']), auth = createAuth({ packs, hostOf: async () => 'acme.in', log: quiet }); auth.mail = async () => true;
  await packs.put('acme-in', 'private/members.json', { owner: 'ana@acme.in', members: [{ email: 'ana@acme.in', role: 'owner' }] });
  const C = createConnectors({ packs, auth, builder: {}, log: quiet }), cookie = `fs_s=${encodeURIComponent(auth.sign({ email: 'ana@acme.in' }, 3600, 'session'))}`;
  const post = async (id, fields) => { const res = fakeRes(); await C.handle(fakeReq('POST', cookie, { action: 'key', fields }), res, new URL(`http://x.test/api/brands/acme-in/connect/${id}`)); return res.code; };
  const k = []; for (let i = 0; i < 7; i++) k.push(await post('klaviyo', { key: 'nope' }));
  assert.deepEqual(k, [200, 200, 200, 200, 200, 200, 429]);
  assert.equal(await post('reviews', { shop: 'acme.myshopify.com', token: 'short' }), 200, 'another connector has its own count');
});

/* ---------- 14. GA4 sign-in comes back on the Google callback ---------- */
test('GA4 sign-in uses /connect/google/callback, and that callback finishes a GA4 sign-in', async () => {
  const env = { GOOGLE_OAUTH: process.env.GOOGLE_OAUTH, GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET, PUBLIC_URL: process.env.PUBLIC_URL };
  Object.assign(process.env, { GOOGLE_OAUTH: '1', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec', PUBLIC_URL: 'https://brew.test' });
  try {
    const packs = memPacks(['acme-in']), auth = createAuth({ packs, hostOf: async () => 'acme.in', log: quiet }); auth.mail = async () => true;
    await packs.put('acme-in', 'private/members.json', { owner: 'ana@acme.in', members: [{ email: 'ana@acme.in', role: 'owner' }] });
    const C = createConnectors({ packs, auth, builder: {}, log: quiet }), cookie = `fs_s=${encodeURIComponent(auth.sign({ email: 'ana@acme.in' }, 3600, 'session'))}`;
    const start = fakeRes(); await C.handle(fakeReq('GET', cookie), start, new URL('http://x.test/connect/ga4/start?brand=acme-in'));
    const loc = new URL(start.headers.location); assert.equal(loc.searchParams.get('redirect_uri'), 'https://brew.test/connect/google/callback');
    const state = loc.searchParams.get('state'), tokenBodies = [];
    const cb = fakeRes();
    await withFetch(async (u, o) => { tokenBodies.push(String(o?.body || '')); return res200({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'https://www.googleapis.com/auth/analytics.readonly' }); },
      () => C.handle(fakeReq('GET', cookie), cb, new URL(`http://x.test/connect/google/callback?state=${encodeURIComponent(state)}&code=abc`)));
    assert.match(cb.headers.location, /^\/acme-in#v=connectors&cx=ga4&pick=1$/, 'the GA4 picker opens, not Google Ads');
    assert.match(decodeURIComponent(tokenBodies[0]), /redirect_uri=https:\/\/brew\.test\/connect\/google\/callback/, 'the code is traded with the same URL');
    /* a state for one connector never works on another's callback */
    const bad = fakeRes(); await C.handle(fakeReq('GET', cookie), bad, new URL(`http://x.test/connect/meta/callback?state=${encodeURIComponent(state)}&code=abc`));
    assert.equal(bad.headers.location, '/?signin=failed');
  } finally { for (const [k, v] of Object.entries(env)) if (v == null) delete process.env[k]; else process.env[k] = v; }
});

/* ---------- 15. a GA4 stream read that fails is not a fact ---------- */
test('GA4 by property ID: a stream read that fails says the check didn’t go through; a working read matches www, the store and lists the streams', async () => {
  const c = { sa: true, property: 'properties/557182412', token: 'sa', exp: Date.now() + 3600e3 }, ctx = { host: 'cozysnugglet.shop', shopifyShop: 'cozy-9.myshopify.com', hosts: ['cozysnugglet.com'] };
  const err = await withFetch(async () => resErr(403, { error: { message: 'The caller does not have permission' } }), () => ga4.owns(c, ctx));
  assert.equal(err.ok, false); assert.equal(err.error, true); assert.match(err.why, /Couldn’t read the property’s web streams: ga4 streams 403: The caller does not have permission/);
  const streams = (uri) => async () => res200({ dataStreams: [{ displayName: 'Web', webStreamData: { defaultUri: uri } }] });
  for (const uri of ['https://www.cozysnugglet.shop/', 'https://cozy-9.myshopify.com', 'http://cozysnugglet.com']) assert.equal((await withFetch(streams(uri), () => ga4.owns(c, ctx))).ok, true, uri);
  const miss = await withFetch(streams('https://elsewhere.com/x'), () => ga4.owns(c, ctx)); assert.equal(miss.ok, false); assert.ok(!miss.error); assert.match(miss.why, /streams: elsewhere\.com/);
  /* the store's other myshopify address counts when Shopify redirects it to the brand's site, never when it goes elsewhere */
  const alias = (to) => async (u, o) => (o?.method === 'HEAD' ? { status: 301, headers: { get: (k) => (k === 'location' ? to : null) } } : streams('https://cozysnugglet.myshopify.com')());
  assert.equal((await withFetch(alias('https://cozysnugglet.shop/'), () => ga4.owns(c, ctx))).ok, true);
  assert.equal((await withFetch(alias('https://elsewhere.com/'), () => ga4.owns(c, ctx))).ok, false);
  /* through the connect: refused, worded as a check that didn't go through, nothing kept */
  const packs = memPacks(['cozy']), auth = createAuth({ packs, hostOf: async () => 'cozysnugglet.shop', log: quiet }); auth.mail = async () => true;
  await packs.put('cozy', 'profile.json', { name: 'Cozy', host: 'cozysnugglet.shop' });
  await packs.put('cozy', 'private/members.json', { owner: 'ana@cozysnugglet.shop', members: [{ email: 'ana@cozysnugglet.shop', role: 'owner' }] });
  const C = createConnectors({ packs, auth, builder: {}, log: quiet });
  const r = await withFetch(async () => resErr(500, { error: { message: 'backend error' } }), () => C.finish('cozy', 'ga4', c, { email: 'ana@cozysnugglet.shop' }));
  assert.equal(r.ok, false); assert.match(r.error, /The check on that GA4 property didn’t go through/); assert.doesNotMatch(r.error, /couldn’t match/); assert.equal(r.proof.error, true);
  assert.equal(await packs.getJSON('cozy', 'private/connections.json', null), null);
  const st = await withFetch(async () => resErr(500, { error: { message: 'backend error' } }), () => C.finish('cozy', 'ga4', c, { email: 'param@joinsquareup.com' }));
  assert.equal(st.override, true, 'Brew staff are still offered the override');
});
