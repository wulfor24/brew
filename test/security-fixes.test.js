// The auth and connector safety rules: who may act, typed tokens, claiming a brand only with an official email.
// Connectors are simulated (connectors/index.js, DUMMY): connecting still follows who may connect.
// Offline: an in-memory brand store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
process.env.BUILD_RESUME_OFF = '1';
const { createAuth, exactSite, ownDomain } = await import('../auth.js');
const { createMemberCtx } = await import('../member-ctx.js');
const { createConnectors, CONNECTORS } = await import('../connectors/index.js');

const memPacks = () => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), JSON.stringify(o)); }, list: async () => [] }; };
const HOSTS = { cozy: 'cozysnugglet.shop' };
const mkAuth = (packs) => createAuth({ packs, hostOf: async (s) => HOSTS[s] || null, log: { warn() {}, log() {} } });
const reqOf = (method, { cookie = '', body = '' } = {}) => Object.assign(Readable.from(body ? [body] : []), { method, headers: { cookie, host: 'x.test' } });
const resOf = () => ({ code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; }, getHeader(n) { return this.headers[n]; }, setHeader(n, v) { this.headers[n] = v; } });
const cookieFor = (auth, email) => `fs_s=${encodeURIComponent(auth.sign({ email }, 3600, 'session'))}`;

/* ---------- 4. tokens say what they are: only a session token is a session ---------- */
test('a connect state or an approve link never works as a session cookie', () => {
  const auth = mkAuth(memPacks());
  assert.equal(auth.user(reqOf('GET', { cookie: cookieFor(auth, 'ana@cozysnugglet.shop') }))?.email, 'ana@cozysnugglet.shop');
  for (const typ of ['connect', 'approve', 'gstate', 'slack']) {
    const tok = auth.sign({ slug: 'cozy', id: 'meta', email: 'ana@cozysnugglet.shop', act: 'yes' }, 900, typ);
    assert.equal(auth.user(reqOf('GET', { cookie: `fs_s=${encodeURIComponent(tok)}` })), null, `${typ} token refused as a session`);
    assert.equal(auth.verify(tok, 'session'), null); assert.ok(auth.verify(tok, typ));
  }
  assert.throws(() => auth.sign({ email: 'x@y.z' }, 60), /token type/);
  assert.equal(auth.verify(auth.sign({ a: 1 }, 60, 'connect')), null, 'verify needs the type it expects');
});

/* ---------- 11. asking for access is gone: an old approve link adds no one, by GET or POST ---------- */
test('an old approve link adds no one: joining is by invite only', async () => {
  const packs = memPacks(), auth = mkAuth(packs);
  await packs.put('cozy', 'private/members.json', { owner: 'ana@cozysnugglet.shop', members: [{ email: 'ana@cozysnugglet.shop', role: 'owner' }], requests: [{ email: 'bo@gmail.com', at: 1 }] });
  const t = auth.sign({ slug: 'cozy', email: 'bo@gmail.com', act: 'yes' }, 3600, 'approve');
  let res = resOf(); await auth.handle(reqOf('GET'), res, new URL(`http://x.test/auth/approve?t=${encodeURIComponent(t)}`));
  assert.match(res.body, /by invite/); assert.doesNotMatch(res.body, /<form/);
  res = resOf(); await auth.handle(reqOf('POST', { body: `t=${encodeURIComponent(t)}` }), res, new URL(`http://x.test/auth/approve?t=${encodeURIComponent(t)}`));
  assert.equal((await auth.getMembers('cozy')).members.length, 1, 'nobody added');
  res = resOf(); assert.equal(await auth.handle(reqOf('POST', { cookie: cookieFor(auth, 'bo@gmail.com'), body: '{}' }), res, new URL('http://x.test/api/brands/cozy/request')), false, 'there is no asking route at all');
  assert.equal((await auth.getMembers('cozy')).members.length, 1);
});

/* ---------- 3. owning a brand needs strong proof ---------- */
test('domains: an exact site, or a work email at the brand; never a parent or shared platform domain', () => {
  assert.ok(exactSite('https://www.cozysnugglet.shop/x', 'cozysnugglet.shop'));
  assert.ok(!exactSite('shop.cozysnugglet.shop', 'cozysnugglet.shop')); assert.ok(!exactSite('myshopify.com', 'cozy.myshopify.com'));
  assert.ok(ownDomain('cozysnugglet.shop', 'cozysnugglet.shop')); assert.ok(ownDomain('brand.com', 'shop.brand.com')); assert.ok(ownDomain('eu.brand.com', 'brand.com'));
  assert.ok(!ownDomain('myshopify.com', 'cozy.myshopify.com')); assert.ok(!ownDomain('vercel.app', 'cozy.vercel.app'));
  assert.ok(!ownDomain('gmail.com', 'gmail.com')); assert.ok(!ownDomain('com', 'brand.com')); assert.ok(!ownDomain('evil.com', 'brand.com'));
});

const sandbox = () => { const packs = memPacks(), auth = mkAuth(packs); const sent = [];
  auth.mail = async (...a) => { sent.push(a); return true; };
  const C = createConnectors({ packs, auth, builder: {}, treg: null, ai: null, log: { warn() {}, log() {} } }); return { packs, auth, C, sent }; };

test('another domain never connects or owns a brand, even a simulated account', async () => {
  const { packs, auth, C } = sandbox();
  for (const id of ['klaviyo', 'shopify', 'meta']) {
    const r = await C.finish('cozy', id, null, { email: 'mallory@gmail.com' });
    assert.equal(r.ok, false); assert.equal(r.state, 'needs_work_email'); assert.match(r.error, /work email at cozysnugglet\.shop/);
    const m = await auth.getMembers('cozy'); assert.equal(m.owner, null, 'no owner'); assert.deepEqual(m.requests, [], 'no claim request either');
    assert.equal(await packs.getJSON('cozy', 'private/connections.json', null), null, 'the brand’s connections are untouched');
  }
});
test('the first official email to connect any account becomes the admin; the account is simulated and marked dummy', async () => {
  const { packs, auth, C } = sandbox();
  await packs.put('cozy', 'profile.json', { name: 'Cozy', host: 'cozysnugglet.shop', slug: 'cozy', catalog: { products: [{ title: 'Paw Warmer', price: 39 }] }, reviews: { total: 120 } });
  await packs.put('cozy', 'seed.json', { brand: { name: 'Cozy' }, lanes: { core: {} } });
  const r = await C.finish('cozy', 'meta', null, { email: 'ana@cozysnugglet.shop' });
  assert.equal(r.claimed, true); assert.equal(r.dummy, true); const m = await auth.getMembers('cozy'); assert.equal(m.owner, 'ana@cozysnugglet.shop');
  assert.match(m.via, /^Connected /); assert.equal(m.domain, 'cozysnugglet.shop');
  assert.equal((await packs.getJSON('cozy', 'private/connections.json')).meta.sim, true);
  assert.ok(![...packs.D.keys()].some((k) => k.includes('vault/')), 'no token vault');
  assert.equal(await auth.roleOf('cozy', { email: 'bo@cozysnugglet.shop' }), 'member');
});
test('a non-member cannot overwrite a claimed brand’s connection', async () => {
  const { packs, C } = sandbox();
  await packs.put('cozy', 'private/members.json', { owner: 'ana@cozysnugglet.shop', members: [{ email: 'ana@cozysnugglet.shop', role: 'owner' }], requests: [] });
  await packs.put('cozy', 'private/connections.json', { meta: { state: 'live', by: 'ana@cozysnugglet.shop' } });
  const r = await C.finish('cozy', 'meta', null, { email: 'mallory@gmail.com' });
  assert.equal(r.ok, false); assert.equal((await packs.getJSON('cozy', 'private/connections.json')).meta.by, 'ana@cozysnugglet.shop');
});

test('t.member is per request: a link holder never acts as the team, even while a member is mid-request', async () => {
  const team = new Set(['ana@cozysnugglet.shop']), MC = createMemberCtx({ isMemberEmail: async (s, e) => s === 'cozy' && team.has(e), defaultBrand: 'arata-in' });
  const t = MC.guard({ id: 't_1', brandId: 'cozy' });
  t.member = true; assert.equal(t.member, false, 'assigning grants nothing');
  const ana = { member: true, email: 'ana@cozysnugglet.shop', slug: 'cozy' }, link = { member: false, email: null, slug: 'cozy' };
  let seen = null; const pAna = MC.run(ana, t, async () => { await new Promise((r) => setTimeout(r, 20)); return [t.member, t.memberEmail]; });
  await MC.run(link, t, async () => { await new Promise((r) => setTimeout(r, 5)); seen = [t.member, t.memberEmail]; });
  assert.deepEqual(seen, [false, null], 'the link holder is not a member while ana’s request is in flight');
  assert.deepEqual(await pAna, [true, 'ana@cozysnugglet.shop']);
  assert.equal(MC.run({ member: true, email: 'x@other.com', slug: 'other' }, t, () => t.member), false, 'a member of another brand is not one here');
  assert.ok(!('member' in JSON.parse(JSON.stringify(t))), 'never saved with the workspace');
  /* the background clock: the last member who opened it, re-checked; removed from the team, it stops acting */
  assert.equal(t.teamEmail, 'ana@cozysnugglet.shop'); assert.equal(await MC.bgCheck(t), true); assert.equal(t.member, true); assert.equal(t.memberEmail, 'ana@cozysnugglet.shop');
  team.delete('ana@cozysnugglet.shop'); MC.forget(); assert.equal(await MC.bgCheck(t), false); assert.equal(t.member, false);
  const t2 = MC.guard({ id: 't_2', brandId: 'cozy' }); await MC.run(link, t2, () => {}); assert.equal(await MC.bgCheck(t2), false, 'a visitor never makes a workspace act on its own');
});
