import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJams } from '../jams.js';

const fakePacks = () => { const files = new Map(); return { files, getJSON: async (slug, name, d) => (files.has(`${slug}/${name}`) ? JSON.parse(files.get(`${slug}/${name}`)) : d), put: async (slug, name, data) => { files.set(`${slug}/${name}`, JSON.stringify(data)); } }; };
const setup = () => { let req = null; const packs = fakePacks(); const J = createJams({ packs, reqOf: () => req, bgMember: () => false, everyMs: 0, enabled: () => true }); return { J, packs, as: (r) => (req = r) }; };
const ws = (id) => ({ id, brandId: 'acme', work: [], changes: {}, cards: new Map() });

test('two members of a brand see the same jams; a visitor keeps their own', async () => {
  const { J, as } = setup(); await J.load('acme');
  const a = J.guard(ws('t_a')), b = J.guard(ws('t_b')), v = J.guard(ws('t_v'));
  as({ member: true, email: 'a@acme.com', slug: 'acme' }); a.work.unshift({ id: 'wk_1', cardId: 'c1', stage: 'drafting', thread: [] });
  as({ member: true, email: 'b@acme.com', slug: 'acme' }); assert.deepEqual(b.work.map((w) => w.id), ['wk_1']);
  as({ member: false, email: null }); assert.equal(v.work.length, 0); v.work.unshift({ id: 'wk_v' });
  as({ member: true, email: 'a@acme.com', slug: 'acme' }); assert.ok(!a.work.some((w) => w.id === 'wk_v'));
});

test('a guest reads the team list but only their jam is theirs', async () => {
  const { J, as } = setup(); await J.load('acme');
  const a = J.guard(ws('t_a'));
  as({ member: true, email: 'a@acme.com', slug: 'acme' }); a.work.unshift({ id: 'wk_1', cardId: 'c1', stage: 'drafting' }, { id: 'wk_2', cardId: 'c2', stage: 'drafting' });
  J.join(a.work[0], { email: 'G@out.com', name: 'G' }, 'guest');
  assert.deepEqual(J.guestWids('acme', 'g@out.com'), ['wk_1']);
  assert.deepEqual(J.guestWids('acme', 'nobody@out.com'), []);
  J.join(a.work[0], { email: 'g@out.com' }, 'replied'); assert.deepEqual(J.guestWids('acme', 'g@out.com'), ['wk_1'], 'a guest who replies is still a guest');
});

test('joining the team brings your own jams in; the same card folds into the open jam', async () => {
  const { J, as } = setup(); await J.load('acme');
  const a = J.guard(ws('t_a')), b = J.guard(ws('t_b'));
  as({ member: true, email: 'a@acme.com', slug: 'acme' }); a.work.unshift({ id: 'wk_a', cardId: 'c1', stage: 'team', thread: [{ id: 'm1', at: 1, from: 'me', body: 'hi' }], versions: [{ n: 1 }] });
  as({ member: false }); b.work.unshift({ id: 'wk_b', cardId: 'c1', stage: 'drafting', thread: [{ id: 'm2', at: 2, from: 'me', body: 'yo' }], versions: [{ n: 1 }, { n: 2, title: 'B take' }] }, { id: 'wk_c', cardId: 'c9', stage: 'drafting', versions: [{ n: 1 }] });
  as({ member: true, email: 'b@acme.com', slug: 'acme' }); J.adopt(b, { email: 'b@acme.com', name: 'B' });
  const ids = b.work.map((w) => w.id).sort(); assert.deepEqual(ids, ['wk_a', 'wk_c']);
  const kept = b.work.find((w) => w.id === 'wk_a');
  assert.deepEqual(kept.thread.filter((m) => m.from === 'me').map((m) => m.body), ['hi', 'yo']);
  assert.equal(kept.versions.length, 2); assert.ok(J.isIn(kept, 'b@acme.com'));
  assert.equal(b.ownWork.length, 0);
});

test('jams are written to the brand file and read back', async () => {
  const { J, packs, as } = setup(); await J.load('acme');
  const a = J.guard(ws('t_a')); as({ member: true, email: 'a@acme.com', slug: 'acme' });
  a.work.unshift({ id: 'wk_1', cardId: 'c1', stage: 'drafting' }); await J.flush();
  const saved = JSON.parse(packs.files.get('acme/private/jams.json')); assert.equal(saved.work[0].id, 'wk_1');
  const J2 = createJams({ packs, reqOf: () => ({ member: true, slug: 'acme' }), everyMs: 0, enabled: () => true }); await J2.load('acme');
  assert.equal(J2.guard(ws('t_z')).work[0].id, 'wk_1');
});

test('the workspace file never carries the team jams', async () => {
  const { J, as } = setup(); await J.load('acme');
  const a = J.guard(ws('t_a')); as({ member: true, email: 'a@acme.com', slug: 'acme' }); a.work.unshift({ id: 'wk_1' });
  const json = JSON.parse(JSON.stringify(a)); assert.equal(json.work, undefined); assert.deepEqual(json.ownWork, []);
});

test('presence: who has the jam open, and for how long it counts', () => {
  const { J } = setup(); J.beat('wk_1', { email: 'A@acme.com', name: 'A' }, true);
  assert.equal(J.here('wk_1')[0].email, 'a@acme.com'); assert.equal(J.here('wk_1')[0].typing, true);
  assert.ok(J.watching('wk_1', 'a@acme.com')); assert.ok(!J.watching('wk_1', 'b@acme.com'));
});
