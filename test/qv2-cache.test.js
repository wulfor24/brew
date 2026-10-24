// QV round 2 (caches): a version is never reused, the pack read cache never serves a deleted file, and a page view's
// stamp never rebuilds a pack while a real status change does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPg } from './pg-helper.js';

const quiet = { log() {}, warn() {} };
const url = startPg();
test('Postgres group', { skip: !url && 'no Postgres' }, async (t) => {
  process.env.STORAGE = 'pg'; process.env.DATABASE_URL = url; delete process.env.K_SERVICE;
  const db = await import('../db/index.js'); await (await import('../db/migrate.js')).migrate({ log: quiet });
  const O = await import('../objects.js'), { createPacks } = await import('../brand-pack.js');
  const mk = () => createPacks({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'qv2c-')), PUB: path.resolve('public'), objects: O.createObjects({ log: quiet }), log: quiet });

  await t.test('delete then write again: a new version, and a reader holding the old one gets the new file', async () => {
    const o = O.createObjects({ log: quiet }), p = mk();
    await o.put('brands/zz-v/config.json', { v: 'old' }); assert.equal((await p.getJSON('zz-v', 'config.json')).v, 'old');
    const v1 = +(await db.q("SELECT version FROM objects WHERE key = 'brands/zz-v/config.json'")).rows[0].version;
    await o.del('brands/zz-v/config.json'); await o.put('brands/zz-v/config.json', { v: 'new' });
    const v2 = +(await db.q("SELECT version FROM objects WHERE key = 'brands/zz-v/config.json'")).rows[0].version;
    assert.ok(v2 > v1, 'never reused'); assert.equal((await p.getJSON('zz-v', 'config.json')).v, 'new');
  });

  await t.test('concurrent reads around a write keep the cache right', async () => {
    const o = O.createObjects({ log: quiet }), p = mk();
    await o.put('brands/zz-c/facts.json', { n: 0 });
    for (let i = 1; i <= 5; i++) { const reads = Promise.all(Array.from({ length: 6 }, () => p.getJSON('zz-c', 'facts.json'))); await o.put('brands/zz-c/facts.json', { n: i }); await reads; }
    assert.equal((await p.getJSON('zz-c', 'facts.json')).n, 5);
  });

  await t.test('a status write that only stamps seenAt/updatedAt keeps the built pack; a real change rebuilds it', async () => {
    const p = mk();
    await p.put('zz-s', 'status.json', { name: 'ZZ', ready: true, seenAt: 1, updatedAt: 1 }); await new Promise((r) => setTimeout(r, 300)); const v0 = p.version('zz-s');
    await p.put('zz-s', 'status.json', { name: 'ZZ', ready: true, seenAt: 2, updatedAt: 2 }); await new Promise((r) => setTimeout(r, 300)); assert.equal(p.version('zz-s'), v0, 'a stamp alone (its own notice included)');
    await p.put('zz-s', 'status.json', { name: 'ZZ', ready: false, seenAt: 3, updatedAt: 3 }); assert.ok(p.version('zz-s') > v0, 'a real change');
  });
  await db.close();
});
