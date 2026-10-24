// Phase 3 on Postgres, two instances at once: moves and workspaces stored in parts (a save writes only what changed), two
// instances' workspace and jam edits both kept, invites from two instances both land, a token refreshed once when two ask,
// a protected brand's live connection never dropped by accident, sessions that really end, and the bus between instances.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPg } from './pg-helper.js';

const url = startPg();
const skip = !url && 'no Postgres on this machine';
const quiet = { log() {}, warn() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let db, O, mkPacks, mkStore;
test.before(async () => {
  if (skip) return;
  process.env.STORAGE = 'pg'; process.env.DATABASE_URL = url; delete process.env.K_SERVICE;
  db = await import('../db/index.js'); await (await import('../db/migrate.js')).migrate({ log: quiet });
  O = await import('../objects.js');
  const { createPacks } = await import('../brand-pack.js'), { createStore } = await import('../store.js');
  mkPacks = () => createPacks({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'brew-p3-')), PUB: path.resolve('public'), objects: O.createObjects({ log: quiet }), log: quiet });
  mkStore = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'brew-p3t-')), objects: O.createObjects({ log: quiet }), log: quiet });
});
test.after(async () => { if (!skip) await db.close(); });
const parts = async (key) => (await db.q('SELECT part FROM doc_parts WHERE key = $1 ORDER BY ord', [key])).rows.map((r) => r.part);

test('moves.json in parts: one part per move, a save writes only the move that changed, and reads back whole', { skip }, async () => {
  const o = O.createObjects({ log: quiet }), key = 'brands/zz-p3/moves.json';
  const moves = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i + 1), { title: `Move ${i + 1}`, body: 'x'.repeat(2000) }]));
  await o.put(key, moves);
  assert.equal((await parts(key)).length, 30);
  await db.q("UPDATE doc_parts SET body = body WHERE key = $1", [key]); /* nothing */
  const before = (await db.q("SELECT part, xmin::text AS x FROM doc_parts WHERE key = $1", [key])).rows;
  moves['7'].title = 'Move seven, rewritten'; await o.put(key, moves);
  const after = (await db.q("SELECT part, xmin::text AS x FROM doc_parts WHERE key = $1", [key])).rows;
  const changed = after.filter((a) => before.find((b) => b.part === a.part)?.x !== a.x).map((a) => a.part);
  assert.deepEqual(changed, ['7'], 'only move 7 was written');
  assert.deepEqual(JSON.parse((await o.get(key)).toString()), moves);
});

test('a workspace in parts keeps its Map order; two instances each change a different field and both changes stay', { skip }, async () => {
  const A = mkStore(), Bs = mkStore();
  const t = { id: 't_aa11', brandId: 'zz-p3', cards: new Map(Array.from({ length: 40 }, (_, i) => [`c${i}`, { title: `Card ${i}`, sub: 'y'.repeat(1200) }])), seen: new Set(['a']), note: 'start', other: 1 };
  await A.write(t);
  const a = await A.readFresh('t_aa11'), b = await Bs.readFresh('t_aa11');
  assert.deepEqual([...a.cards.keys()], [...t.cards.keys()], 'card order kept');
  a.note = 'changed on A'; b.other = 2; b.cards.get('c5').title = 'Changed on B';
  await A.write(a); await Bs.write(b);
  const back = await mkStore().readFresh('t_aa11');
  assert.equal(back.note, 'changed on A'); assert.equal(back.other, 2); assert.equal(back.cards.get('c5').title, 'Changed on B');
});

test('jams: two instances add jams at once, both keep both; one closes a jam and the other sees it go', { skip }, async () => {
  const { createJams } = await import('../jams.js');
  const pA = mkPacks(), pB = mkPacks();
  const jA = createJams({ packs: pA, log: quiet, everyMs: 0 }), jB = createJams({ packs: pB, log: quiet, everyMs: 0 });
  const bA = await jA.load('zz-jams'), bB = await jB.load('zz-jams');
  bA.work.unshift({ id: 'w_a', title: 'From A', thread: [] }); bB.work.unshift({ id: 'w_b', title: 'From B', thread: [] }); bB.changes.ch1 = { by: 'B' };
  await Promise.all([jA.flush(), jB.flush()]);
  await sleep(500);
  assert.deepEqual(bA.work.map((w) => w.id).sort(), ['w_a', 'w_b']); assert.deepEqual(bB.work.map((w) => w.id).sort(), ['w_a', 'w_b']);
  assert.deepEqual(bA.changes.ch1, { by: 'B' });
  bA.work.splice(bA.work.findIndex((w) => w.id === 'w_b'), 1); await jA.flush(); await sleep(500);
  assert.deepEqual(bB.work.map((w) => w.id), ['w_a'], 'the jam A removed is gone on B');
  jA.beat('w_a', { email: 'ana@x.com', name: 'Ana' }); jB.here('w_a'); await sleep(2500);
  assert.ok(jB.here('w_a').some((p) => p.email === 'ana@x.com'), 'presence crosses instances');
});

test('members: people added from two instances at once all land', { skip }, async () => {
  const { createAuth } = await import('../auth.js');
  const a1 = createAuth({ packs: mkPacks(), hostOf: async () => 'zz.com', log: quiet }), a2 = createAuth({ packs: mkPacks(), hostOf: async () => 'zz.com', log: quiet });
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a1 : a2).addMember('zz-team', { email: `p${i}@zz.com` }, 'member', 'test')));
  const m = await mkPacks().getJSON('zz-team', 'private/members.json', {});
  assert.equal(new Set(m.members.map((x) => x.email)).size, 20);
});

test('token refresh: two instances asking at once make one provider call; the other gets the new token', { skip }, async () => {
  const { createVault } = await import('../vault.js');
  const pA = mkPacks(), pB = mkPacks(), vA = createVault(pA), vB = createVault(pB);
  await vA.save('zz-vault', 'shopify', { token: 'old', exp: 0, refresh: 'r1' });
  let calls = 0; const fresh = async (c) => { if (c.exp > Date.now()) return c; calls++; await sleep(150); return { ...c, token: 'new', exp: Date.now() + 3600e3, refresh: 'r2' }; };
  const [x, y] = await Promise.all([vA.refresh('zz-vault', 'shopify', fresh), vB.refresh('zz-vault', 'shopify', fresh)]);
  assert.equal(calls, 1); assert.equal(x.token, 'new'); assert.equal(y.token, 'new');
  /* a refresh the provider refuses keeps the old token */
  await assert.rejects(vA.refresh('zz-vault', 'shopify', async () => { throw new Error('invalid_grant'); }).then(() => vA.refresh('zz-vault', 'shopify', async (c) => { if (c) throw new Error('invalid_grant'); })));
  assert.equal((await vB.load('zz-vault', 'shopify')).token, 'new');
});

test('a protected brand (arata-in) keeps its live connection: disconnect is refused, the vault untouched', { skip }, async () => {
  process.env.PROTECTED_CONNECTIONS = 'arata-in';
  const { createConnectors, isProtected } = await import('../connectors/index.js');
  assert.ok(isProtected('arata-in')); assert.ok(!isProtected('cozysnugglet-shop'));
  const packs = mkPacks(), { createVault } = await import('../vault.js');
  await createVault(packs).save('arata-in', 'meta', { token: 'keep-me' }); await packs.put('arata-in', 'private/connections.json', { meta: { state: 'live' } });
  const C = createConnectors({ packs, auth: { user: () => null, isAdmin: () => false, baseOf: () => 'http://x' }, builder: {}, log: quiet });
  const r = await C.disconnect('arata-in', 'meta');
  assert.ok(r.protected);
  assert.equal((await createVault(packs).load('arata-in', 'meta')).token, 'keep-me');
  assert.equal((await packs.getJSON('arata-in', 'private/connections.json')).meta.state, 'live');
});

test('sessions: one that is signed out stops working on every instance; sign out everywhere ends them all', { skip }, async () => {
  const { createSessions } = await import('../sessions.js');
  const A = createSessions({ log: quiet }), Bx = createSessions({ log: quiet }); await A.start(); await Bx.start();
  const s1 = { email: 'a@zz.com', ...A.open('a@zz.com', { ttlSec: 3600 }) }, s2 = { email: 'a@zz.com', ...A.open('a@zz.com', { ttlSec: 3600 }) };
  await sleep(100); assert.ok(Bx.live(s1));
  await A.end(s1.sid); await sleep(400);
  assert.equal(Bx.live(s1), false); assert.ok(Bx.live(s2));
  await A.endAll('a@zz.com'); await sleep(400); assert.equal(Bx.live(s2), false);
  assert.ok(Bx.live({ email: 'a@zz.com', sid: 'later', iat: Date.now() + 1000 }), 'a sign-in after it is fine');
  A.stop(); Bx.stop();
});

test('bus: a message from one instance reaches the others, never itself', { skip }, async () => {
  const { createBus } = await import('../bus.js');
  const a = createBus({ log: quiet }); const got = []; a.on('t', (p) => got.push(p)); await sleep(200);
  await a.publish('t', { n: 1 }); await sleep(300); assert.deepEqual(got, [], 'not to itself');
  await db.q(`INSERT INTO bus (topic, payload, by) VALUES ('t', '{"n":2}', 'another')`); await sleep(300);
  assert.deepEqual(got, [{ n: 2 }]);
});
