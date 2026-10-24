// STORAGE=pg: the app's structured objects as Postgres rows (objects.js), behind the same brand-pack and workspace stores
// the app already uses. Two writers never lose each other's change, another instance's write reaches this one's cache,
// and binaries never land in the database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPg } from './pg-helper.js';

const url = startPg();
const skip = !url && 'no Postgres on this machine';
let db, objects, packs, store, OBJ;
test.before(async () => {
  if (skip) return;
  process.env.STORAGE = 'pg'; process.env.DATABASE_URL = url; delete process.env.K_SERVICE;
  db = await import('../db/index.js'); await (await import('../db/migrate.js')).migrate({ log: { log() {} } });
  objects = await import('../objects.js'); OBJ = objects.createObjects({ log: { warn() {} } });
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-objpg-'));
  packs = (await import('../brand-pack.js')).createPacks({ ROOT, PUB: path.resolve('public'), objects: OBJ, log: { warn() {}, log() {} } });
  store = (await import('../store.js')).createStore({ dir: path.join(ROOT, '.tenants'), objects: OBJ, log: { warn() {} } });
});
test.after(async () => { if (!skip) await db.close(); });

test('migrations run once, and again is a no-op', { skip }, async () => {
  const again = await (await import('../db/migrate.js')).migrate({ log: { log() {} } });
  assert.deepEqual(again, []);
  assert.equal((await db.q("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n >= 1, true);
});

test('rows: put, get, list by prefix, delete; JSON and text in Postgres, binaries never', { skip }, async () => {
  await OBJ.put('brands/zz-test/seed.json', { a: 1 }); await OBJ.put('brands/zz-test/brief.md', '# hi'); await OBJ.put('brands/zz-test/moves/01.json', { n: 1 });
  assert.deepEqual(JSON.parse((await OBJ.get('brands/zz-test/seed.json')).toString()), { a: 1 });
  assert.equal((await OBJ.get('brands/zz-test/brief.md')).toString(), '# hi');
  assert.equal(await OBJ.get('brands/zz-test/nothing.json'), null);
  assert.deepEqual((await OBJ.list('brands/zz-test/')).map((x) => x.name).sort(), ['brands/zz-test/brief.md', 'brands/zz-test/moves/01.json', 'brands/zz-test/seed.json']);
  assert.equal((await OBJ.list('brands/zz_test/')).length, 0, 'an underscore in a prefix is literal, not a wildcard');
  assert.equal(await OBJ.put('brands/zz-test/assets/a.jpg', Buffer.from([1, 2, 3])), false, 'no bucket here, and a picture never goes into a row');
  assert.equal((await db.q("SELECT count(*)::int AS n FROM objects WHERE key LIKE '%.jpg'")).rows[0].n, 0);
  await OBJ.del('brands/zz-test/brief.md'); assert.equal(await OBJ.get('brands/zz-test/brief.md'), null);
});

test('update(): 40 writers at once, from two stores, lose nothing', { skip }, async () => {
  const other = objects.createObjects({ log: { warn() {} } }); /* a second instance's store */
  await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? OBJ : other).update('brands/zz-test/private/members.json', (m) => ({ members: [...(m?.members || []), `u${i}@x.com`] }))));
  const got = JSON.parse((await OBJ.get('brands/zz-test/private/members.json')).toString());
  assert.equal(new Set(got.members).size, 40);
});

test('another instance writes: this one hears it within a second', { skip }, async () => {
  const heard = new Promise((resolve) => { OBJ.onChange((k) => { if (k === 'brands/zz-test/heard.json') resolve(Date.now()); }); });
  await new Promise((r) => setTimeout(r, 200)); const t0 = Date.now();
  await db.q("INSERT INTO objects (key, body) VALUES ('brands/zz-test/heard.json', '\\x7b7d')");
  const at = await Promise.race([heard, new Promise((r) => setTimeout(() => r(0), 2000))]);
  assert.ok(at && at - t0 < 1000, 'NOTIFY reached the listener');
});

test('brand packs on Postgres: a file written elsewhere is read fresh, not from this disk', { skip }, async () => {
  await packs.put('zz-pack', 'status.json', { name: 'ZZ', ready: true });
  assert.deepEqual(await packs.getJSON('zz-pack', 'status.json'), { name: 'ZZ', ready: true });
  await OBJ.put('brands/zz-pack/status.json', { name: 'ZZ', ready: false }); /* another instance */
  assert.deepEqual(await packs.getJSON('zz-pack', 'status.json'), { name: 'ZZ', ready: false });
  assert.ok((await packs.list()).some((b) => b.slug === 'zz-pack'));
  const v0 = packs.version('zz-pack'); await OBJ.put('brands/zz-pack/seed.json', { posts: [] }); await new Promise((r) => setTimeout(r, 300));
  assert.ok(packs.version('zz-pack') > v0, 'the pack cache drops on another instance’s write');
  const out = await Promise.all(Array.from({ length: 20 }, (_, i) => packs.update('zz-pack', 'learned.json', (x) => ({ n: (x?.n || 0) + 1, i }))));
  assert.equal(Math.max(...out.map((x) => x.n)), 20);
});

test('workspaces on Postgres: Maps and Sets round-trip; scan lists them', { skip }, async () => {
  const t = { id: 't_00ff00ff', brandId: 'zz-pack', cards: new Map([['c1', { a: 1 }]]), seen: new Set(['x']) };
  await store.write(t);
  const back = await store.readFresh('t_00ff00ff');
  assert.ok(back.cards instanceof Map && back.cards.get('c1').a === 1); assert.ok(back.seen instanceof Set && back.seen.has('x'));
  assert.ok((await store.scan()).some((x) => x.id === 't_00ff00ff'));
});

test('the switch from the bucket: read-through fills rows, locked edits start from the bucket copy, every write is mirrored back', { skip }, async () => {
  const B = new Map([['brands/zz-old/seed.json', '{"from":"bucket"}'], ['brands/zz-old/private/members.json', '{"members":["a@x.com"]}']]);
  const real = globalThis.fetch;
  globalThis.fetch = async (u, o = {}) => { const s = String(u);
    if (!s.startsWith('https://storage.googleapis.com/')) return real(u, o);
    const name = decodeURIComponent((/[?&]name=([^&]+)/.exec(s) || /\/o\/([^?]+)/.exec(s))[1]);
    if (o.method === 'POST') { await new Promise((r) => setTimeout(r, Math.random() * 20)); B.set(name, Buffer.from(o.body).toString()); return new Response('{}'); }
    if (o.method === 'DELETE') { B.delete(name); return new Response(null, { status: 204 }); }
    return B.has(name) ? new Response(B.get(name)) : new Response('nf', { status: 404 }); };
  try {
    const O = objects.createObjects({ bucket: 'b', gToken: async () => 't', readThrough: true, mirror: true, log: { warn() {} } });
    assert.deepEqual(JSON.parse((await O.get('brands/zz-old/seed.json')).toString()), { from: 'bucket' });
    assert.equal((await db.q("SELECT count(*)::int AS n FROM objects WHERE key = 'brands/zz-old/seed.json'")).rows[0].n, 1, 'kept as a row');
    await O.update('brands/zz-old/private/members.json', (m) => ({ members: [...m.members, 'b@x.com'] }));
    assert.deepEqual(JSON.parse((await O.get('brands/zz-old/private/members.json')).toString()).members, ['a@x.com', 'b@x.com']);
    for (let i = 0; i < 10; i++) await O.put('brands/zz-old/status.json', { i });
    await O.mirrored();
    assert.deepEqual(JSON.parse(B.get('brands/zz-old/status.json')), { i: 9 }, 'the bucket ends on the newest write');
    assert.deepEqual(JSON.parse(B.get('brands/zz-old/private/members.json')).members, ['a@x.com', 'b@x.com']);
    await O.del('brands/zz-old/seed.json'); assert.equal(B.has('brands/zz-old/seed.json'), false); assert.equal(await O.get('brands/zz-old/seed.json'), null, 'a delete never comes back from the bucket');
  } finally { globalThis.fetch = real; }
});
