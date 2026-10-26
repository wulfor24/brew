// db/reset-brand.mjs and db/delete-brand.mjs (db/brand-wipe.js) on a throwaway Postgres: a dry run removes nothing, the five
// partners are refused, a reset never touches connections or tokens, a deletion leaves only its audit row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startPg } from './pg-helper.js';

const url = startPg(), skip = !url && 'no Postgres';
const quiet = { log() {}, warn() {}, error() {} };
let db, W, O;
const fakeBucket = () => { const m = new Map(); return { m, async list(p) { return [...m.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })); }, async exists(k) { return m.has(k); }, async get(k) { return m.get(k) ?? null; }, async copy(a, b) { m.set(b, m.get(a)); }, async del(k) { m.delete(k); } }; };
const opts = (o) => ({ settleMs: 0, waitMs: 0, retireOn: false, ...o });
const env = (bucket = null) => ({ q: db.q, tx: db.tx, bucket, log: quiet, sleep: async () => {} });
const keys = async (pre) => (await db.q('SELECT key FROM objects WHERE starts_with(key, $1) ORDER BY key', [pre])).rows.map((r) => r.key);
const count = async (sql, p) => (await db.q(sql, p)).rows[0].n;

async function seed(slug) {
  await O.put(`brands/${slug}/status.json`, { done: true });
  await O.put(`brands/${slug}/moves.json`, { a: 1, list: [1, 2], pic: `see gen/${slug}-only.png and gen/shared-1.png` });
  await O.put(`brands/${slug}/private/members.json`, { 'a@zz.com': { role: 'admin' } });
  await O.put(`brands/${slug}/private/connections.json`, { meta: { state: 'live' }, shopify: { state: 'live' } });
  await O.put(`brands/${slug}/private/vault/meta.json`, { c: 'cipher-meta' });
  await O.put(`brands/${slug}/private/vault/shopify.json`, { c: 'cipher-shop' });
  await O.put(`brands/${slug}/private/live/meta.json`, { spend: 10 });
  const tid = 't_' + Buffer.from(slug).toString('hex').slice(0, 12);
  await O.put(`tenants/${tid}.json`, { id: tid, brandId: slug, acted: { __s: [] } });
  await O.put(`_deleted/jams-20261025T000000Z/${slug}/jams.json`, { work: [] });
  await db.q(`INSERT INTO jobs (name, data, key) VALUES ('builder', $1, $2)`, [JSON.stringify({ m: 'build', args: [slug] }), `build:${slug}`]);
  await db.q(`INSERT INTO bus (topic, payload, by) VALUES ('cards', $1, 'x')`, [JSON.stringify({ slug })]);
  await db.q(`INSERT INTO build_events (slug, ev) VALUES ($1, '{}')`, [slug]);
  await db.q(`INSERT INTO counters (day, scope, key, n) VALUES (current_date, 'brand', $1, 3)`, [slug]);
  await db.q(`INSERT INTO access_log (slug, email, access) VALUES ($1, 'a@zz.com', 'team')`, [slug]);
  return tid;
}

test.before(async () => {
  if (skip) return;
  process.env.STORAGE = 'pg'; process.env.DATABASE_URL = url; process.env.PROTECTED_CONNECTIONS = 'arata-in';
  db = await import('../db/index.js'); await (await import('../db/migrate.js')).migrate({ log: quiet });
  W = await import('../db/brand-wipe.js'); O = (await import('../objects.js')).createObjects({ log: quiet });
  await O.put('brands/zz-other/moves.json', { pic: 'gen/shared-1.png' }); /* another brand points at the shared picture */
});
test.after(async () => { if (!skip) await db.close(); });

test('a dry run lists everything and removes nothing', { skip }, async () => {
  await seed('zz-dry'); const b = fakeBucket(); b.m.set('brands/zz-dry/pdf/a.pdf', 'x'); b.m.set('gen/zz-dry-only.png', 'x');
  const before = await keys('brands/zz-dry/'), lines = [];
  for (const mode of ['reset', 'delete']) {
    const r = await W.run(opts({ mode, slug: 'zz-dry' }), { ...env(b), log: { log: (s) => lines.push(s) } });
    assert.equal(r.dry, true); assert.ok(r.plan.rows.length > 0);
  }
  assert.deepEqual(await keys('brands/zz-dry/'), before);
  assert.equal(await count(`SELECT count(*)::int AS n FROM jobs WHERE key = 'build:zz-dry'`), 1);
  assert.equal(await count(`SELECT count(*)::int AS n FROM access_log WHERE slug = 'zz-dry'`), 1);
  assert.ok(b.m.has('brands/zz-dry/pdf/a.pdf'));
  assert.ok(lines.some((l) => l.includes('brands/zz-dry/private/members.json')), 'every key is printed');
  assert.ok(lines.some((l) => /DRY RUN: nothing was removed/.test(l)));
});

test('the five design partners are refused without --partner-override and the slug again; PROTECTED_CONNECTIONS never deleted', { skip }, async () => {
  assert.deepEqual([...W.PARTNERS].sort(), ['arata-in', 'in-puma-com', 'manaprojects-com', 'nutrova-com', 'scrubroom-in']);
  for (const slug of W.PARTNERS) for (const mode of ['reset', 'delete']) {
    await assert.rejects(W.run(opts({ mode, slug, yes: true }), env()), /design partner|PROTECTED_CONNECTIONS/);
    await assert.rejects(W.run(opts({ mode, slug, yes: true, partnerOverride: true }), env()), /design partner|PROTECTED_CONNECTIONS/);
    await assert.rejects(W.run(opts({ mode, slug, yes: true, confirmSlug: slug }), env()), /design partner|PROTECTED_CONNECTIONS/);
    await assert.rejects(W.run(opts({ mode, slug, yes: true, partnerOverride: true, confirmSlug: 'zz-x' }), env()), /design partner|PROTECTED_CONNECTIONS/);
  }
  await assert.rejects(W.run(opts({ mode: 'delete', slug: 'arata-in', yes: true, partnerOverride: true, confirmSlug: 'arata-in' }), env()), /PROTECTED_CONNECTIONS/);
  for (const slug of ['_brew', 'brew-sample', 'Bad Slug', '../x', '']) await assert.rejects(W.run(opts({ mode: 'reset', slug, yes: true }), env()), W.Refused);
  assert.throws(() => W.parseArgs(['--slug', 'a', '--slug', 'b']), /one brand per run/);
  /* the tool itself: refused before anything is read, exit 2 */
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../db/reset-brand.mjs', import.meta.url)), '--slug', 'nutrova-com', '--yes', '--no-bucket'], { env: { ...process.env, STORAGE: 'pg', DATABASE_URL: url }, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr); assert.match(r.stderr, /REFUSED: nutrova-com is a design partner/);
  const d = spawnSync(process.execPath, [fileURLToPath(new URL('../db/delete-brand.mjs', import.meta.url)), '--slug', 'zz-cli', '--no-bucket'], { env: { ...process.env, STORAGE: 'pg', DATABASE_URL: url }, encoding: 'utf8' });
  assert.equal(d.status, 0, d.stderr); assert.match(d.stdout, /DRY RUN/);
});

test('a reset brings the brand back to a first run and leaves every connection and token as it was', { skip }, async () => {
  const tid = await seed('zz-reset'); const b = fakeBucket();
  b.m.set('brands/zz-reset/pdf/a.pdf', 'x'); b.m.set('brands/zz-reset/private/vault/meta.json', 'copy'); b.m.set(`tenants/${tid}.json`, '{}');
  const conn = async () => (await db.q(`SELECT key, md5(body) AS h FROM objects WHERE key ~ '^brands/zz-reset/(private/connections\\.json|private/vault/|private/live/)' ORDER BY key`)).rows;
  const before = await conn(); assert.equal(before.length, 4);
  const r = await W.run(opts({ mode: 'reset', slug: 'zz-reset', yes: true, archive: '_deleted/brand-zz-reset-t' }), env(b));
  assert.equal(r.left, 0);
  assert.deepEqual(await conn(), before, 'connections, vault and connected numbers untouched');
  assert.deepEqual(await keys('brands/zz-reset/'), before.map((x) => x.key));
  assert.equal(await count(`SELECT count(*)::int AS n FROM objects WHERE key = $1`, [`tenants/${tid}.json`]), 0, 'workspace gone');
  assert.equal(await count(`SELECT count(*)::int AS n FROM doc_parts WHERE key = $1`, [`tenants/${tid}.json`]), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM jobs WHERE key = 'build:zz-reset'`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM build_events WHERE slug = 'zz-reset'`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM access_log WHERE slug = 'zz-reset'`), 1, 'a reset keeps the access log');
  assert.ok(!b.m.has('brands/zz-reset/pdf/a.pdf')); assert.ok(b.m.has('brands/zz-reset/private/vault/meta.json'), 'bucket copy of a token kept');
  assert.equal(JSON.parse((await O.get('_deleted/brand-zz-reset-t/brands/zz-reset/moves.json')).toString()).a, 1, 'archived, parts and all');
  /* a reset of a partner, when it asked: the same, and its connections stay */
  await seed('arata-in'); const ar = await db.q(`SELECT key, md5(body) AS h FROM objects WHERE starts_with(key, 'brands/arata-in/private/') AND key !~ 'members' ORDER BY key`);
  await W.run(opts({ mode: 'reset', slug: 'arata-in', yes: true, partnerOverride: true, confirmSlug: 'arata-in' }), env());
  assert.deepEqual((await db.q(`SELECT key, md5(body) AS h FROM objects WHERE starts_with(key, 'brands/arata-in/') ORDER BY key`)).rows, ar.rows);
  /* the guard inside apply refuses a connection even in a hand-made plan */
  const plan = await W.collect({ q: db.q, slug: 'arata-in', mode: 'reset' }); plan.rows.push('brands/arata-in/private/vault/meta.json');
  await assert.rejects(W.apply({ tx: db.tx, plan, log: quiet }), /a connection/);
});

test('the stop marker hides the brand while it goes, then lifts', { skip }, async () => {
  await seed('zz-stop'); const seen = [];
  await W.run(opts({ mode: 'reset', slug: 'zz-stop', yes: true, retireOn: true, revN: '706' }), { ...env(), poke: async () => seen.push(JSON.parse((await O.get('control/live.json')).toString())) });
  assert.deepEqual(seen.map((m) => [m.rev, m.n, m.wipe]), [['stop', 706, ['zz-stop']], ['stop', 706, []]]);
  await seed('zz-stop2');
  await assert.rejects(W.run(opts({ mode: 'reset', slug: 'zz-stop2', yes: true, retireOn: true }), env()), /--rev-n/);
  assert.ok((await keys('brands/zz-stop2/')).length > 4, 'refused before removing anything');
});

test('a deletion removes all of the brand, revokes nothing, and writes the audit row', { skip }, async () => {
  const tid = await seed('zz-del'); const b = fakeBucket();
  for (const k of ['brands/zz-del/pdf/a.pdf', 'brands/zz-del/private/vault/meta.json', `tenants/${tid}.json`, 'gen/zz-del-only.png', 'gen/shared-1.png', '_deleted/20261016T000000Z/brands/zz-del/status.json']) b.m.set(k, '{}');
  b.m.set('_deleted/20261016T000000Z/tenants/t_99.json', JSON.stringify({ brandId: 'zz-del' })); b.m.set('_deleted/20261016T000000Z/tenants/t_98.json', JSON.stringify({ brandId: 'zz-keep' }));
  const fetched = []; const f0 = globalThis.fetch; globalThis.fetch = async (u, ...a) => { fetched.push(String(u)); return f0(u, ...a); };
  let r; try { r = await W.run(opts({ mode: 'delete', slug: 'zz-del', yes: true, request: 'hello@ 26 Oct', operator: 'test' }), { ...env(b), log: quiet }); } finally { globalThis.fetch = f0; }
  assert.deepEqual(fetched, [], 'no platform is called: nothing revoked or disconnected');
  assert.equal(r.left, 0);
  assert.deepEqual(await keys('brands/zz-del/'), []);
  assert.deepEqual(await keys('_deleted/jams-20261025T000000Z/zz-del/'), []);
  assert.equal(await count(`SELECT count(*)::int AS n FROM objects WHERE key = $1`, [`tenants/${tid}.json`]), 0);
  for (const t of ['jobs WHERE key = \'build:zz-del\'', 'build_events WHERE slug = \'zz-del\'', 'counters WHERE key = \'zz-del\'', 'access_log WHERE slug = \'zz-del\'', `bus WHERE payload->>'slug' = 'zz-del'`]) assert.equal(await count(`SELECT count(*)::int AS n FROM ${t}`), 0, t);
  assert.deepEqual([...b.m.keys()].sort(), ['_deleted/20261016T000000Z/tenants/t_98.json', 'gen/shared-1.png'], 'bucket: brand files, archives and its own media gone; shared media and other brands kept');
  assert.ok((await keys('brands/zz-other/')).length, 'other brands untouched');
  const a = (await db.q(`SELECT * FROM data_deletions WHERE slug = 'zz-del'`)).rows;
  assert.equal(a.length, 1); assert.ok(a[0].done_at); assert.equal(a[0].request, 'hello@ 26 Oct'); assert.equal(a[0].left_after, 0);
  assert.ok(a[0].removed.rows >= 7 && a[0].removed.workspaces === 1 && a[0].removed.media === 1);
  assert.deepEqual(a[0].grants.map((g) => g.id), ['meta', 'shopify']); assert.match(a[0].grants[0].revoke, /Meta Business Settings/);
  assert.ok(!JSON.stringify(a[0]).includes('a@zz.com'), 'the audit row keeps no member address');
  assert.ok(a[0].residual.some((x) => /backups/.test(x)));
});

test('a deletion refuses to start while a job for the brand runs', { skip }, async () => {
  await seed('zz-busy'); await db.q(`UPDATE jobs SET state = 'running' WHERE key = 'build:zz-busy'`);
  await assert.rejects(W.run(opts({ mode: 'delete', slug: 'zz-busy', yes: true }), env()), /running/);
  assert.ok((await keys('brands/zz-busy/')).length > 4);
  assert.equal(await count(`SELECT count(*)::int AS n FROM data_deletions WHERE slug = 'zz-busy'`), 0);
});

test('the bucket-era scripts refuse on Postgres', async () => {
  for (const f of ['reset-brand.sh', 'flush-live.sh']) {
    const r = spawnSync('bash', [fileURLToPath(new URL(`../tools/${f}`, import.meta.url)), 'zz-x'], { env: { ...process.env, STORAGE: 'pg' }, encoding: 'utf8' });
    assert.equal(r.status, 3, f); assert.match(r.stderr, /bucket-era.*\n.*db\/reset-brand\.mjs/);
  }
});
