// A replaced instance (retire.js) never writes to Postgres: its in-memory state is older than the live instance's, and
// the fetch block that once protected the bucket doesn't cover database writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startPg } from './pg-helper.js';

const url = startPg();
test('after retiring, every database write is refused; reads still work', { skip: !url && 'no Postgres' }, async () => {
  process.env.STORAGE = 'pg'; process.env.DATABASE_URL = url;
  const db = await import('../db/index.js'); await (await import('../db/migrate.js')).migrate({ log: { log() {} } });
  const { createObjects } = await import('../objects.js'), { markRetired } = await import('../retire.js');
  const O = createObjects({ log: { warn() {} } });
  await O.put('brands/zz-ret/status.json', { v: 1 });
  markRetired();
  await assert.rejects(O.put('brands/zz-ret/status.json', { v: 2 }), /retired/);
  await assert.rejects(O.update('brands/zz-ret/status.json', () => ({ v: 3 })), /retired/);
  await assert.rejects(O.patchParts('tenants/t_ab12.json', [['x', '1', 0]], []), /retired/);
  await assert.rejects(O.del('brands/zz-ret/status.json'), /retired/);
  assert.deepEqual(JSON.parse((await O.get('brands/zz-ret/status.json')).toString()), { v: 1 });
  await db.close();
});
