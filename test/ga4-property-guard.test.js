// GA4 by property ID (Brew's shared service account), closed 2026-10-16 for every brand: a property another brand has is
// refused, the property's stream must point to the brand's site (or Brew's staff override it on purpose), and pasting IDs
// is rate-limited per person.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
process.env.BUILD_RESUME_OFF = '1';
const { createAuth } = await import('../auth.js');
const { createConnectors } = await import('../connectors/index.js');

const memPacks = (brands = []) => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), JSON.stringify(o)); }, list: async () => brands.map((slug) => ({ slug })) }; };
const HOSTS = { cozy: 'cozysnugglet.shop', other: 'otherbrand.com' };
const mkAuth = (packs) => createAuth({ packs, hostOf: async (s) => HOSTS[s] || null, log: { warn() {}, log() {} } });

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
  /* the brand's own email is its admin by signing in (Param, 28 Oct), whatever the connect does; a refused connect saves nothing */
  await packs.put('other', 'private/members.json', { owner: null, members: [] });
  const claim = await run(ga4Fetch('https://somebodyelse.com'), () => C.finish('other', 'ga4', SA('112'), { email: 'mo@otherbrand.com' }));
  assert.equal(claim.ok, false); assert.equal(await packs.getJSON('other', 'private/connections.json', null), null, 'nothing saved');
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
