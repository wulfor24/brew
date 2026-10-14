// Team access by view: invites by email, each person's views, changing the admin, and the per-request seats a workspace sees.
// Offline: an in-memory brand store, no mail key (mail() returns false).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
const { createAuth, cleanSeats } = await import('../auth.js');
const { createMemberCtx } = await import('../member-ctx.js');

const memPacks = () => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), put: async (s, n, o) => { D.set(k(s, n), JSON.stringify(o)); }, list: async () => [] }; };
const HOSTS = { cozy: 'cozysnugglet.shop' };
const mkAuth = (packs) => createAuth({ packs, hostOf: async (s) => HOSTS[s] || null, seatNames: async () => ({ founder: 'Founder / CEO', growth: 'Growth / Performance', brand: 'Brand / Creative' }), log: { warn() {}, log() {} } });
const reqOf = (method, { cookie = '', body = '' } = {}) => Object.assign(Readable.from(body ? [body] : []), { method, headers: { cookie, host: 'x.test' } });
const resOf = () => ({ code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; }, getHeader(n) { return this.headers[n]; }, setHeader(n, v) { this.headers[n] = v; } });
const cookieFor = (auth, email) => `fs_s=${encodeURIComponent(auth.sign({ email }, 3600, 'session'))}`;
const team = async (auth, as, body) => { const res = resOf(); await auth.handle(reqOf('POST', { cookie: cookieFor(auth, as), body: JSON.stringify(body) }), res, new URL('http://x.test/api/brands/cozy/team')); return JSON.parse(res.body); };
const join = async (auth, as, tok) => { const res = resOf(); await auth.handle(reqOf('GET', { cookie: as ? cookieFor(auth, as) : '' }), res, new URL(`http://x.test/join?t=${encodeURIComponent(tok)}`)); return res; };
const owned = async () => { const packs = memPacks(), auth = mkAuth(packs); await auth.claim('cozy', { email: 'ana@cozysnugglet.shop' }); return { packs, auth }; };
const tokFor = (auth, email) => auth.sign({ slug: 'cozy', email }, 3600, 'invite');

test('cleanSeats keeps only seat-shaped keys, once each', () => {
  assert.deepEqual(cleanSeats(['growth', 'Growth', 'x', '../a', 'brand']), ['growth', 'brand']);
  assert.equal(cleanSeats('all'), 'all');
  assert.deepEqual(cleanSeats(null), []);
});

test('an invite joins only the invited Google account, with its views', async () => {
  const { auth } = await owned();
  const r = await team(auth, 'ana@cozysnugglet.shop', { action: 'invite', email: 'raj@gmail.com', seats: ['growth'] });
  assert.equal(r.error, undefined); assert.equal(r.invites.length, 1); assert.deepEqual(r.invites[0].seats, ['growth']);
  const tok = tokFor(auth, 'raj@gmail.com');
  // signed out: off to Google sign-in, coming back to the same link
  let res = await join(auth, null, tok); assert.equal(res.code, 302); assert.match(res.headers.location, /^\/auth\/google\?next=%2Fjoin%3Ft%3D/);
  // the wrong account: told, not let in
  res = await join(auth, 'mallory@gmail.com', tok); assert.equal(res.code, 200); assert.match(res.body, /This invite is for raj@gmail.com/);
  assert.equal(await auth.isMember('cozy', { email: 'mallory@gmail.com' }), false);
  // the right account: in, with Growth only
  res = await join(auth, 'raj@gmail.com', tok); assert.equal(res.code, 302); assert.equal(res.headers.location, '/cozy?joined=1');
  assert.deepEqual(await auth.seatsOf('cozy', { email: 'raj@gmail.com' }), ['growth']);
  assert.equal((await auth.getMembers('cozy')).invites.length, 0, 'the invite is used up');
});

test('a cancelled invite no longer works, and a bad token says expired', async () => {
  const { auth } = await owned();
  await team(auth, 'ana@cozysnugglet.shop', { action: 'invite', email: 'raj@gmail.com', seats: ['brand'] });
  await team(auth, 'ana@cozysnugglet.shop', { action: 'revoke', email: 'raj@gmail.com' });
  let res = await join(auth, 'raj@gmail.com', tokFor(auth, 'raj@gmail.com')); assert.match(res.body, /no longer valid/);
  res = await join(auth, 'raj@gmail.com', 'nope.nope'); assert.match(res.body, /expired/);
  res = await join(auth, 'raj@gmail.com', auth.sign({ slug: 'cozy', email: 'raj@gmail.com' }, 3600, 'approve')); assert.match(res.body, /expired/, 'an approve token is not an invite');
  assert.equal(await auth.isMember('cozy', { email: 'raj@gmail.com' }), false);
});

test('only the admin manages invites and views; an invite needs a view', async () => {
  const { auth } = await owned();
  let r = await team(auth, 'ana@cozysnugglet.shop', { action: 'invite', email: 'raj@gmail.com', seats: [] }); assert.match(r.error, /at least one view/);
  await auth.addMember('cozy', { email: 'raj@gmail.com' }, 'member', 'test', ['growth']);
  const res = resOf(); await auth.handle(reqOf('POST', { cookie: cookieFor(auth, 'raj@gmail.com'), body: JSON.stringify({ action: 'invite', email: 'x@gmail.com', seats: ['growth'] }) }), res, new URL('http://x.test/api/brands/cozy/team'));
  assert.equal(res.code, 403);
  r = await team(auth, 'ana@cozysnugglet.shop', { action: 'seats', email: 'raj@gmail.com', seats: ['growth', 'brand'] });
  assert.deepEqual(r.members.find((x) => x.email === 'raj@gmail.com').seats, ['growth', 'brand']);
  assert.deepEqual(await auth.seatsOf('cozy', { email: 'raj@gmail.com' }), ['growth', 'brand']);
});

test('owners, admins, legacy members and visitors keep every view; same-domain teammates wait with none', async () => {
  const { packs, auth } = await owned();
  assert.equal(await auth.seatsOf('cozy', { email: 'ana@cozysnugglet.shop' }), null, 'owner');
  assert.equal(await auth.seatsOf('cozy', { email: 'stranger@gmail.com' }), null, 'visitor (not limited; sees the demo)');
  const m = await auth.getMembers('cozy'); m.members.push({ email: 'old@gmail.com', role: 'member', via: 'before views' }); await packs.put('cozy', 'private/members.json', m);
  assert.equal(await auth.seatsOf('cozy', { email: 'old@gmail.com' }), null, 'a member from before views keeps everything');
  assert.deepEqual(await auth.seatsOf('cozy', { email: 'bo@cozysnugglet.shop' }), [], 'a same-domain teammate joins with no views');
  assert.equal(await auth.isMember('cozy', { email: 'bo@cozysnugglet.shop' }), true);
});

test('changing the admin: promote, transfer, and never zero admins', async () => {
  const { auth } = await owned();
  await auth.addMember('cozy', { email: 'raj@gmail.com' }, 'member', 'test', ['growth']);
  let r = await team(auth, 'ana@cozysnugglet.shop', { action: 'step_down', email: 'ana@cozysnugglet.shop', seats: ['founder'] });
  assert.match(r.error, /always has one/);
  r = await team(auth, 'ana@cozysnugglet.shop', { action: 'remove', email: 'ana@cozysnugglet.shop' }); assert.ok(r.error);
  // transfer = make_owner then step_down on yourself
  r = await team(auth, 'ana@cozysnugglet.shop', { action: 'make_owner', email: 'raj@gmail.com' }); assert.equal(r.error, undefined);
  assert.equal(await auth.seatsOf('cozy', { email: 'raj@gmail.com' }), null, 'an admin sees every view');
  r = await team(auth, 'ana@cozysnugglet.shop', { action: 'step_down', email: 'ana@cozysnugglet.shop', seats: ['founder', 'growth'] }); assert.equal(r.error, undefined);
  const m = await auth.getMembers('cozy');
  assert.equal(m.owner, 'raj@gmail.com', 'the owner label follows the remaining admin');
  assert.equal(await auth.roleOf('cozy', { email: 'ana@cozysnugglet.shop' }), 'member');
  assert.deepEqual(await auth.seatsOf('cozy', { email: 'ana@cozysnugglet.shop' }), ['founder', 'growth']);
  // the old owner can no longer manage the team
  const res = resOf(); await auth.handle(reqOf('POST', { cookie: cookieFor(auth, 'ana@cozysnugglet.shop'), body: JSON.stringify({ action: 'remove', email: 'raj@gmail.com' }) }), res, new URL('http://x.test/api/brands/cozy/team'));
  assert.equal(res.code, 403);
  // an admin can't be removed without stepping down first
  await auth.addMember('cozy', { email: 'li@gmail.com' }, 'member', 'test', ['brand']);
  await team(auth, 'raj@gmail.com', { action: 'make_owner', email: 'li@gmail.com' });
  r = await team(auth, 'raj@gmail.com', { action: 'remove', email: 'li@gmail.com' }); assert.match(r.error, /Step them down/);
});

test('another domain joins only by invite: asking is refused, an invite lets them in with its views', async () => {
  const { auth } = await owned();
  const res = resOf(); await auth.handle(reqOf('POST', { cookie: cookieFor(auth, 'raj@gmail.com'), body: '{}' }), res, new URL('http://x.test/api/brands/cozy/request'));
  assert.match(JSON.parse(res.body).error, /invite/); assert.equal(await auth.roleOf('cozy', { email: 'raj@gmail.com' }), null);
  await team(auth, 'ana@cozysnugglet.shop', { action: 'invite', email: 'raj@gmail.com', seats: ['brand'] });
  assert.equal(await auth.roleOf('cozy', { email: 'raj@gmail.com' }), 'member');
  const a = await auth.accessOf('cozy', { email: 'raj@gmail.com' }); assert.equal(a.gen, true); assert.deepEqual(a.seats, ['brand']);
});

test('a workspace sees the request viewer’s seats, never another brand’s or the background clock’s', () => {
  const MC = createMemberCtx({ defaultBrand: 'cozy' }), t = MC.guard({ brandId: 'cozy' });
  assert.equal(t.seats, null, 'background clock: not limited');
  MC.run({ member: true, email: 'raj@gmail.com', slug: 'cozy', seats: ['growth'] }, t, () => assert.deepEqual(t.seats, ['growth']));
  MC.run({ member: true, email: 'raj@gmail.com', slug: 'other', seats: ['growth'] }, t, () => assert.equal(t.seats, null));
  MC.run({ member: false, email: null, slug: 'cozy', seats: ['growth'] }, t, () => assert.equal(t.seats, null, 'a visitor is not limited (demo)'));
  t.seats = ['brand']; assert.equal(t.seats, null, 'assigning does nothing');
});

test('a pending invite joins on sign-in even without the link, with its views', async () => {
  const { auth } = await owned();
  await team(auth, 'ana@cozysnugglet.shop', { action: 'invite', email: 'raj@gmail.com', seats: ['growth', 'founder'] });
  assert.equal(await auth.roleOf('cozy', { email: 'raj@gmail.com' }), 'member');
  assert.deepEqual(await auth.seatsOf('cozy', { email: 'raj@gmail.com' }), ['growth', 'founder']);
  assert.equal((await auth.getMembers('cozy')).invites.length, 0);
  assert.equal(await auth.roleOf('cozy', { email: 'other@gmail.com' }), null, 'nobody else');
});

test('Switch account comes back to the invite: logout keeps an encoded return address', async () => {
  const auth = mkAuth(memPacks()), tok = 'abc.def_-';
  const next = `/auth/google?next=${encodeURIComponent(`/join?t=${tok}`)}`;
  const res = resOf(); await auth.handle(reqOf('GET'), res, new URL(`http://x.test/auth/logout?next=${encodeURIComponent(next)}`));
  assert.equal(res.headers.location, next);
  for (const bad of ['//evil.com', '/%2F%2Fevil.com', 'https://evil.com', '/\\evil.com']) {
    const r = resOf(); await auth.handle(reqOf('GET'), r, new URL(`http://x.test/auth/logout?next=${encodeURIComponent(bad)}`)); assert.equal(r.headers.location, '/', bad);
  }
});

test('Brew’s own people make work on every brand, with every view, even where they were invited with fewer', async () => {
  const { auth } = await owned();
  const a = await auth.claimInfo('cozy', { email: 'hello@joinsquareup.com' });
  assert.equal(a.gen, true); assert.equal(a.full, true); assert.equal(a.role, 'admin');
  await team(auth, 'ana@cozysnugglet.shop', { action: 'invite', email: 'hello@joinsquareup.com', seats: ['growth'] });
  const b = await auth.claimInfo('cozy', { email: 'hello@joinsquareup.com' });
  assert.equal(b.gen, true); assert.equal(b.seats, null, 'a Brew admin is never limited to some views');
  const c = await auth.claimInfo('cozy', { email: 'raj@gmail.com' });
  assert.equal(c.gen, false, 'a stranger still sees the demo');
});
