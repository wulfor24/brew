// Two holes closed on 2026-10-16, for every brand:
// 1. Slack: only the brand's team in Brew (matched by the email Slack shares) approves, makes, says yes or changes a jam from
//    Slack. Anyone else in the workspace, a jam's guests included, gets an ephemeral "only the team" and changes nothing.
// 2. GA4 by property ID (Brew's shared service account): a property another brand has is refused, the property's stream must
//    point to the brand's site (or Brew's staff override it on purpose), and pasting IDs is rate-limited per person.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import fs from 'node:fs';
process.env.BUILD_RESUME_OFF = '1';
const { createSlackRoutes } = await import('../slack-routes.js');
const { createAuth } = await import('../auth.js');
const { createConnectors } = await import('../connectors/index.js');

/* ---------- Slack ---------- */
const sign = (raw, secret = 'shh', ts = Math.floor(Date.now() / 1e3)) => ({ 'x-slack-request-timestamp': String(ts), 'x-slack-signature': `v0=${crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex')}` });
const sreq = (raw) => Object.assign(Readable.from([raw]), { method: 'POST', headers: sign(raw) });
const sres = () => ({ code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b || ''; } });
const tick = () => new Promise((r) => setTimeout(r, 15));
const PEOPLE = { UA: { name: 'Ana', email: 'Ana@cozysnugglet.shop' }, UM: { name: 'Mallory', email: 'mallory@gmail.com' }, UG: { name: 'Gus', email: 'gus@guest.com' }, UN: { name: 'No email', email: null } };
const TEAM = new Set(['ana@cozysnugglet.shop']);

const slackRig = () => {
  const ins = [], told = [], eph = [];
  const connectors = { slackSlug: async (t) => (t === 'T1' ? 'cozy' : null), slackUser: async (_s, u) => ({ ...PEOPLE[u] }), slackOf: async () => ({ bot: 'UBREW' }),
    slackPost: async () => ({ ok: true }), slackEphemeral: async (s, o) => { eph.push([s, o]); return { ok: true }; } };
  const feed = { slackIn: async (x) => { ins.push(x); return { w: { id: 'wk1', current: 2, slack: {} }, ok: true }; } };
  const h = createSlackRoutes({ connectors, feed: () => feed, member: async (slug, email) => (slug === 'cozy' && TEAM.has(email) ? 'member' : null), brandName: async () => 'Cozy Snugglet', log: { log() {}, warn() {} }, secret: () => 'shh' });
  const press = async (user, action_id, value) => { const raw = new URLSearchParams({ payload: JSON.stringify({ type: 'block_actions', team: { id: 'T1' }, user: { id: user }, channel: { id: 'C1' }, message: { ts: '1.0', text: 'x', blocks: [{ type: 'actions' }] }, actions: [{ action_id, value }], response_url: 'https://hooks.slack.com/r' }) }).toString();
    await h(sreq(raw), sres(), new URL('https://x/slack/actions')); await tick(); };
  let n = 0; const say = async (user, text) => { const raw = JSON.stringify({ type: 'event_callback', event_id: `E${++n}`, team_id: 'T1', event: { type: 'message', channel: 'C1', user, ts: `2.${n}`, thread_ts: '1.0', text } });
    await h(sreq(raw), sres(), new URL('https://x/slack/events')); await tick(); };
  return { ins, told, eph, press, say };
};
const withFetch = async (told, f) => { const f0 = globalThis.fetch; globalThis.fetch = async (u, o) => { told.push(JSON.parse(o.body)); return { ok: true }; }; try { await f(); } finally { globalThis.fetch = f0; } };

test('Slack: someone outside the brand’s team can’t approve, press Make it / Not now, say yes or ask @Brew for a change', async () => {
  const R = slackRig();
  await withFetch(R.told, async () => {
    for (const u of ['UM', 'UG', 'UN']) {
      await R.press(u, 'approve', 'cozy|wk1|2');
      await R.press(u, 'apply', 'cozy|wk1|pd_1'); /* Make it: a paid image or video */
      await R.press(u, 'dismiss', 'cozy|wk1|pd_1');
      await R.say(u, 'yes'); await R.say(u, '<@UBREW> change the headline to FREE TODAY'); await R.say(u, 'looks good to me');
    }
  });
  assert.deepEqual(R.ins, [], 'nothing reached the jam');
  assert.equal(R.told.length, 9, 'every press was answered');
  assert.ok(R.told.every((b) => b.response_type === 'ephemeral' && b.replace_original === false && /Only Cozy Snugglet’s team in Brew can approve or make things here/.test(b.text)));
  assert.equal(R.eph.length, 3, 'a reply is answered once per person per thread, not every time');
  assert.ok(R.eph.every(([s, o]) => s === 'cozy' && o.channel === 'C1' && o.thread_ts === '1.0' && /Only Cozy Snugglet’s team/.test(o.text)));
});

test('Slack: the brand’s team (matched by email, any case) still approves, makes and talks from Slack', async () => {
  const R = slackRig();
  await withFetch(R.told, async () => { await R.press('UA', 'approve', 'cozy|wk1|2'); await R.press('UA', 'apply', 'cozy|wk1|pd_1'); await R.say('UA', '<@UBREW> make it a reel'); });
  assert.deepEqual(R.ins.map((x) => [x.kind, x.user.team]), [['approve', true], ['apply', true], ['reply', true]]);
  assert.equal(R.ins[2].mention, true); assert.equal(R.eph.length, 0); assert.deepEqual(R.told, []);
});

test('Slack: with no team check wired, nobody acts (the safe default)', async () => {
  const ins = [], h = createSlackRoutes({ connectors: { slackSlug: async () => 'cozy', slackUser: async () => ({ name: 'Ana', email: 'ana@cozysnugglet.shop' }) }, feed: () => ({ slackIn: async (x) => { ins.push(x); return {}; } }), log: { log() {}, warn() {} }, secret: () => 'shh' });
  const raw = JSON.stringify({ type: 'event_callback', event_id: 'Z1', team_id: 'T1', event: { type: 'message', channel: 'C1', user: 'U1', ts: '2.0', thread_ts: '1.0', text: 'yes' } });
  await h(sreq(raw), sres(), new URL('https://x/slack/events')); await tick(); assert.deepEqual(ins, []);
});

test('Slack: feed-service slackIn refuses anyone the routes did not check against the team', () => {
  const s = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8'), body = s.slice(s.indexOf('const slackIn = async'), s.indexOf('const guestOk'));
  assert.match(body.split('\n')[1], /if \(user\.team !== true\) return \{ denied: true \};/, 'the first thing slackIn does');
  const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'); assert.ok(/createSlackRoutes\(\{ connectors, feed: \(\) => feedSvc, member: \(slug, email\) => auth\.teamRole\(slug, email\)/.test(srv), 'server wires the team check');
});

/* ---------- auth.teamRole: read only, no joining on the way ---------- */
const memPacks = (brands = []) => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), JSON.stringify(o)); }, list: async () => brands.map((slug) => ({ slug })) }; };
const HOSTS = { cozy: 'cozysnugglet.shop', other: 'otherbrand.com' };
const mkAuth = (packs) => createAuth({ packs, hostOf: async (s) => HOSTS[s] || null, log: { warn() {}, log() {} } });

test('auth.teamRole: members and Brew staff count; a jam guest, an invitee who never signed in, or a same-domain stranger don’t, and nobody joins', async () => {
  const packs = memPacks(), auth = mkAuth(packs);
  await packs.put('cozy', 'private/members.json', { owner: 'ana@cozysnugglet.shop', domain: 'cozysnugglet.shop', members: [{ email: 'ana@cozysnugglet.shop', role: 'owner' }, { email: 'bo@cozysnugglet.shop', role: 'member' }],
    invites: [{ email: 'cy@cozysnugglet.shop', at: Date.now() }], guests: [{ email: 'gus@guest.com' }] });
  assert.equal(await auth.teamRole('cozy', 'ANA@cozysnugglet.shop'), 'owner'); assert.equal(await auth.teamRole('cozy', 'bo@cozysnugglet.shop'), 'member');
  assert.equal(await auth.teamRole('cozy', 'param@joinsquareup.com'), 'admin', 'Brew’s own staff, as on the web');
  for (const e of ['gus@guest.com', 'cy@cozysnugglet.shop', 'dee@cozysnugglet.shop', 'mallory@gmail.com', '', null]) assert.equal(await auth.teamRole('cozy', e), null, String(e));
  assert.equal((await auth.getMembers('cozy')).members.length, 2, 'nobody was added by being looked up');
});

/* ---------- GA4 by property ID ---------- */
const brand = async (packs, slug) => { await packs.put(slug, 'profile.json', { name: slug, host: HOSTS[slug], slug }); await packs.put(slug, 'seed.json', { brand: { name: slug }, lanes: { core: {} } }); };
const ga4Fetch = (streamUri) => async (u) => { const j = /dataStreams/.test(u) ? { dataStreams: [{ displayName: 'Web', webStreamData: { defaultUri: streamUri } }] } : { rows: [] }; return { ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) }; };
const rig = async () => { const packs = memPacks(['cozy', 'other']), auth = mkAuth(packs); auth.mail = async () => true;
  for (const s of ['cozy', 'other']) await brand(packs, s);
  await packs.put('cozy', 'private/members.json', { owner: 'ana@cozysnugglet.shop', members: [{ email: 'ana@cozysnugglet.shop', role: 'owner' }] });
  await packs.put('other', 'private/members.json', { owner: 'mo@otherbrand.com', members: [{ email: 'mo@otherbrand.com', role: 'owner' }] });
  const C = createConnectors({ packs, auth, builder: {}, treg: null, log: { warn() {}, log() {} } }); return { packs, auth, C }; };
const SA = (id) => ({ sa: true, property: `properties/${id}`, token: 'sa-tok', exp: Date.now() + 3600e3, accountName: `GA4 ${id}` });
const run = async (fetcher, f) => { const f0 = globalThis.fetch; globalThis.fetch = fetcher; try { return await f(); } finally { globalThis.fetch = f0; } };

test('GA4 by property ID: a property another brand already has is refused, and nothing is kept', async () => {
  const { packs, C } = await rig();
  await packs.put('cozy', 'private/connections.json', { ga4: { state: 'live', account: { id: 'properties/557182412', name: 'GA4 Cozy' }, verified: true } });
  const r = await run(ga4Fetch('https://otherbrand.com'), () => C.finish('other', 'ga4', SA('557182412'), { email: 'mo@otherbrand.com' }));
  assert.equal(r.ok, false); assert.equal(r.state, 'refused'); assert.match(r.error, /already connected to another brand/);
  assert.equal(await packs.getJSON('other', 'private/connections.json', null), null, 'no connection saved');
  assert.ok(![...packs.D.keys()].some((k) => k.startsWith('other/') && k.includes('vault')), 'no token in the vault');
  /* even Brew's staff can't take a property another brand has */
  const s = await run(ga4Fetch('https://otherbrand.com'), () => C.finish('other', 'ga4', SA('557182412'), { email: 'param@joinsquareup.com' }, { override: true }));
  assert.equal(s.ok, false); assert.match(s.error, /another brand/);
});

test('GA4 by property ID: a property whose stream isn’t the brand’s site is refused; the brand’s own goes through', async () => {
  const { packs, C, auth } = await rig();
  const bad = await run(ga4Fetch('https://somebodyelse.com'), () => C.finish('other', 'ga4', SA('111'), { email: 'mo@otherbrand.com' }));
  assert.equal(bad.ok, false); assert.equal(bad.state, 'refused'); assert.match(bad.error, /couldn’t match that GA4 property to otherbrand\.com/); assert.equal(bad.override, undefined, 'only staff are offered the override');
  assert.equal(await packs.getJSON('other', 'private/connections.json', null), null);
  /* an unclaimed brand isn't claimed by a refused connect */
  await packs.put('other', 'private/members.json', { owner: null, members: [] });
  const claim = await run(ga4Fetch('https://somebodyelse.com'), () => C.finish('other', 'ga4', SA('112'), { email: 'mo@otherbrand.com' }));
  assert.equal(claim.ok, false); assert.equal((await auth.getMembers('other')).owner, null, 'nobody claimed it');
  await packs.put('other', 'private/members.json', { owner: 'mo@otherbrand.com', members: [{ email: 'mo@otherbrand.com', role: 'owner' }] });
  const good = await run(ga4Fetch('https://www.otherbrand.com/'), () => C.finish('other', 'ga4', SA('222'), { email: 'mo@otherbrand.com' }));
  assert.equal(good.ok, true); assert.equal(good.verified, true);
  assert.equal((await packs.getJSON('other', 'private/connections.json')).ga4.account.id, 'properties/222');
});

test('GA4 by property ID: Brew’s staff may override a failed match on purpose; a member can’t', async () => {
  const { packs, C } = await rig();
  const mem = await run(ga4Fetch('https://elsewhere.com'), () => C.finish('other', 'ga4', SA('333'), { email: 'mo@otherbrand.com' }, { override: true }));
  assert.equal(mem.ok, false, 'override is staff only');
  const asked = await run(ga4Fetch('https://elsewhere.com'), () => C.finish('other', 'ga4', SA('333'), { email: 'param@joinsquareup.com' }));
  assert.equal(asked.ok, false); assert.equal(asked.override, true, 'staff are told they may override');
  const st = await run(ga4Fetch('https://elsewhere.com'), () => C.finish('other', 'ga4', SA('333'), { email: 'param@joinsquareup.com' }, { override: true }));
  assert.equal(st.ok, true); assert.equal(st.verified, false, 'still shown as not matched');
  assert.equal((await packs.getJSON('other', 'private/connections.json')).ga4.verified, false);
});

test('GA4 by property ID: pasting IDs is limited per person', async () => {
  const { auth, C } = await rig();
  const cookie = `fs_s=${encodeURIComponent(auth.sign({ email: 'mo@otherbrand.com' }, 3600, 'session'))}`;
  const post = async () => { const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; }, setHeader() {}, getHeader() {} };
    const req = Object.assign(Readable.from([JSON.stringify({ action: 'key', fields: { property: 'not-a-number' } })]), { method: 'POST', headers: { cookie, host: 'x.test', 'content-type': 'application/json' } });
    await C.handle(req, res, new URL('http://x.test/api/brands/other/connect/ga4')); return res; };
  const codes = []; for (let i = 0; i < 8; i++) codes.push((await post()).code);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 200, 429, 429]);
});
