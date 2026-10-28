// Claiming a business and demo mode: an official email (at the brand's own domain) claims; the first one to connect an
// account or tap Claim becomes admin; other domains see the demo and join only by invite; SquareUp's own domains
// (joinsquareup.com, shopos.ai) have full access everywhere but never take a brand. Offline, in-memory brand store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
process.env.BUILD_RESUME_OFF = '1';
delete process.env.FULL_ACCESS_DOMAINS; process.env.ADMIN_EMAILS = 'boss@gmail.com';
const { createAuth, isFullAccess, fullDomain } = await import('../auth.js');

const memPacks = () => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), JSON.stringify(o)); }, list: async () => [] }; };
const HOSTS = { cozy: 'cozysnugglet.shop', allbirds: 'allbirds.com' };
const mkAuth = () => createAuth({ packs: memPacks(), hostOf: async (s) => HOSTS[s] || null, log: { warn() {}, log() {} } });
const reqOf = (method, { cookie = '', body = '' } = {}) => Object.assign(Readable.from(body ? [body] : []), { method, headers: { cookie, host: 'x.test' } });
const resOf = () => ({ code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; }, getHeader(n) { return this.headers[n]; }, setHeader(n, v) { this.headers[n] = v; } });
const claimBtn = async (auth, slug, email) => { const res = resOf(); await auth.handle(reqOf('POST', { cookie: `fs_s=${encodeURIComponent(auth.sign({ email }, 3600, 'session'))}` }), res, new URL(`http://x.test/api/brands/${slug}/claim`)); return JSON.parse(res.body); };

test('full access: joinsquareup.com and shopos.ai (and their subdomains) plus ADMIN_EMAILS; nothing that only looks alike', () => {
  for (const e of ['param@joinsquareup.com', 'x@shopos.ai', 'a.b@sub.shopos.ai', 'boss@gmail.com', 'BOSS@gmail.com']) assert.ok(isFullAccess(e), e);
  for (const e of ['x@notjoinsquareup.com', 'x@joinsquareup.com.evil.io', 'x@gmail.com', 'x@shopos.ai.co', '']) assert.ok(!isFullAccess(e), e);
  assert.ok(fullDomain('x@joinsquareup.com')); assert.ok(!fullDomain('boss@gmail.com'));
});

test('SquareUp people: admin on every brand, may make new work, never take a brand that is not theirs', async () => {
  const auth = mkAuth(), sq = { email: 'param@joinsquareup.com' };
  const a = await auth.accessOf('cozy', sq); assert.equal(a.role, 'admin'); assert.equal(a.gen, true); assert.equal(a.full, true); assert.equal(a.canClaim, false);
  const r = await claimBtn(auth, 'cozy', sq.email); assert.ok(r.error); assert.equal(r.full, true);
  assert.equal((await auth.getMembers('cozy')).owner, null, 'still free for the brand’s own team');
  assert.equal((await claimBtn(auth, 'cozy', 'ana@cozysnugglet.shop')).ok, true);
  assert.equal((await auth.accessOf('cozy', sq)).role, 'admin', 'and still full access after the claim');
});

test('the Claim button: only an official email, first one wins; a Gmail or another company sees the demo', async () => {
  const auth = mkAuth();
  for (const e of ['ana@gmail.com', 'x@allbirds.com', 'x@myshopify.com']) {
    const a = await auth.accessOf('cozy', { email: e }); assert.equal(a.eligible, false, e); assert.equal(a.gen, false, e);
    const r = await claimBtn(auth, 'cozy', e); assert.match(r.error, /work email at cozysnugglet\.shop/, e);
  }
  const ana = await auth.accessOf('cozy', { email: 'ana@cozysnugglet.shop' }); assert.equal(ana.eligible, true); assert.equal(ana.gen, true); assert.equal(ana.canClaim, true);
  assert.equal((await claimBtn(auth, 'cozy', 'ana@cozysnugglet.shop')).ok, true);
  const m = await auth.getMembers('cozy'); assert.equal(m.owner, 'ana@cozysnugglet.shop'); assert.equal(m.domain, 'cozysnugglet.shop');
  /* a colleague arrives later: they join the team, they don't claim it again */
  const bo = await auth.accessOf('cozy', { email: 'bo@cozysnugglet.shop' }); assert.equal(bo.role, 'member'); assert.equal(bo.eligible, false); assert.equal(bo.gen, true);
  /* another domain on a claimed brand: demo until invited */
  const raj = await auth.accessOf('cozy', { email: 'raj@gmail.com' }); assert.equal(raj.gen, false); assert.equal(raj.claimed, true);
  assert.equal((await auth.accessOf('cozy', null)).gen, false, 'signed out: demo');
});

test('the demo site (DEMO_MODE=1) keeps its gate open: every visitor owns a throwaway copy', async () => {
  process.env.DEMO_MODE = '1';
  try { assert.equal((await mkAuth().accessOf('cozy', { email: 'raj@gmail.com' })).gen, true); } finally { delete process.env.DEMO_MODE; }
});

test('Brew’s own person who started the read is on the team as its admin; a Gmail starter still gets nothing; the brand’s domain still joins', async () => {
  const packs = memPacks(), a2 = createAuth({ packs, hostOf: async (s) => HOSTS[s] || null, log: { warn() {}, log() {} } });
  await packs.put('cozy', 'private/created.json', { by: 'Prashanth.B@shopos.ai', at: Date.now() });
  const v = await a2.accessOf('cozy', { email: 'param@joinsquareup.com' });
  assert.ok(v.members.some((x) => x.email === 'prashanth.b@shopos.ai' && x.role === 'owner'), 'listed on Team as admin (healed on open)');
  assert.equal((await a2.getMembers('cozy')).owner, 'prashanth.b@shopos.ai');
  assert.equal((await a2.accessOf('cozy', { email: 'prashanth.b@shopos.ai', name: 'Prashanth' })).role, 'owner');
  assert.equal((await a2.accessOf('cozy', { email: 'ana@cozysnugglet.shop' })).role, 'member', 'the brand’s own domain joins on its own');
  /* a Gmail starter: starting a read never opens a brand (23 Oct) */
  await packs.put('allbirds', 'private/created.json', { by: 'founder@gmail.com', at: Date.now() });
  assert.equal((await a2.accessOf('allbirds', { email: 'founder@gmail.com' })).role, null);
  assert.equal((await a2.getMembers('allbirds')).owner, null);
});
