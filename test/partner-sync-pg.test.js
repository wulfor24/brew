// Go-live swap (docs/go-live-swap.md section 4): the partner copy's three words on two real databases (one local Postgres).
// jams brings the jams and their finals; sync makes staging win for brand content while connections are never written over,
// members are unioned, parts only production has are kept, the replaced rows are exported first and a row production changes
// during the run is reported, not clobbered; workspaces copies a partner's workspaces production doesn't have. Arata's
// connection rows are never written, in any mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { startPg } from './pg-helper.js';
import { splitDoc, joinDoc } from '../objects.js';
import { encryptWith, decryptWith } from '../vault.js';

const url = startPg();
const skip = !url && 'no Postgres on this machine';
const K1 = crypto.randomBytes(32).toString('hex'), K2 = crypto.randomBytes(32).toString('hex');
const keys = { src: K1, dst: K2 };
const quiet = { log() {}, warn() {} };
const ARATA = new Set(['arata-in']);
let src, dst, copyBrand, copyWorkspaces;
const dbUrl = (name) => url.replace(/\/postgres\?/, `/${name}?`);
const STUB = 'application/x-parted';
const put = (pool, key, body, type = 'application/json', s = null) => pool.query(`INSERT INTO objects (key, body, content_type, src) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, version = nextval('objects_version'), src = EXCLUDED.src, updated_at = now()`, [key, Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), type, s]);
const putParted = async (pool, key, doc, s = null) => { await pool.query(`INSERT INTO objects (key, body, content_type, src) VALUES ($1, '\\x', '${STUB}', $2) ON CONFLICT (key) DO UPDATE SET content_type = '${STUB}', src = EXCLUDED.src, version = nextval('objects_version'), updated_at = now()`, [key, s]);
  await pool.query('DELETE FROM doc_parts WHERE key = $1', [key]);
  let i = 0; for (const [p, b] of splitDoc(doc, { always: /jams/.test(key) })) await pool.query('INSERT INTO doc_parts (key, part, ord, body) VALUES ($1, $2, $3, $4)', [key, p, i++, Buffer.from(b)]); };
const read = async (pool, key) => { const r = (await pool.query('SELECT body, content_type, src, version FROM objects WHERE key = $1', [key])).rows[0]; if (!r) return null;
  if (r.content_type === STUB) return { doc: joinDoc((await pool.query('SELECT part, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [key])).rows), src: r.src, version: r.version };
  return { doc: JSON.parse(r.body.toString('utf8')), src: r.src, version: r.version, raw: r.body }; };
/* every row and part of a database, to prove nothing was written */
const snapshot = async (pool) => JSON.stringify([(await pool.query('SELECT key, version, src, md5(body) AS h FROM objects ORDER BY key')).rows, (await pool.query('SELECT key, part, ord, md5(body) AS h FROM doc_parts ORDER BY key, part')).rows]);
function fakeStore() {
  const b = { stg: new Map(), prd: new Map() }; const md5 = (x) => crypto.createHash('md5').update(x).digest('base64');
  return { b, src: 'stg', dst: 'prd', add: (bk, name, body) => b[bk].set(name, { md5: md5(body), body }), copies: [],
    async list(bk, prefix) { return [...b[bk]].filter(([n]) => n.startsWith(prefix)).map(([name, x]) => ({ name, md5: x.md5, size: x.body.length })); },
    async exists(bk, name) { return b[bk].has(name); },
    async copy(fb, from, tb, to) { this.copies.push(`${from}→${to}`); b[tb].set(to, { ...b[fb].get(from) }); } };
}
const files = () => { const s = fakeStore(); s.add('stg', 'gen/final-1.mp4', 'final'); s.add('stg', 'brands/nutrova-com/private/finals/f1/cut.mp4', 'cut'); return s; };
const vaultRow = (k, tok, at) => ({ c: encryptWith(k, JSON.stringify({ token: tok })), at });
const jamsDoc = (jams) => ({ jams });

async function seed() {
  /* staging: what Param sees */
  const A = 'brands/arata-in/';
  await put(src, `${A}status.json`, { name: 'Arata', done: true });
  await put(src, `${A}profile.json`, { name: 'Arata', tagline: 'staging' });
  await putParted(src, `${A}moves.json`, { moves: { 1: { title: 'staging move 1' }, 2: { title: 'staging move 2' } } });
  await put(src, `${A}private/members.json`, { owner: 'marketing@shopos.ai', members: [
    { email: 'marketing@shopos.ai', role: 'owner', at: 100 }, { email: 'sai@joinsquareup.com', role: 'member', at: 100 }, { email: 'arvind@joinsquareup.com', role: 'member', at: 100 }], invites: [] });
  await put(src, `${A}private/vault/shopify.json`, vaultRow(K1, 'shpat_staging', 1));
  await put(src, `${A}private/vault/meta.json`, vaultRow(K1, 'meta_staging', 1));
  await put(src, `${A}private/connections.json`, { meta: { state: 'live' }, shopify: { state: 'live' } });
  await put(src, `${A}private/connected-ledger.json`, { rows: [{ k: 'orders', v: 1 }] });
  await put(src, `${A}private/live/meta.json`, { spend: 1 });
  await putParted(src, `${A}private/jams.json`, jamsDoc([{ id: 'j1', title: 'staging jam', final: 'gen/final-1.mp4' }]));
  /* production: the 25 Oct copy, then production's own writes (src NULL) */
  await put(dst, `${A}status.json`, { name: 'Arata', done: true }, 'application/json', 'migrate');
  await put(dst, `${A}profile.json`, { name: 'Arata', tagline: 'production rewrote it' });
  await putParted(dst, `${A}moves.json`, { moves: { 1: { title: 'production rewrote move 1' }, 2: { title: 'staging move 2' } } });
  await put(dst, `${A}private/members.json`, { owner: 'marketing@shopos.ai', members: [
    { email: 'marketing@shopos.ai', role: 'owner', at: 100 }, { email: 'sai@joinsquareup.com', role: 'owner', at: 50 } /* older: staging's role */,
    { email: 'arvind@joinsquareup.com', role: 'owner', at: 300 } /* newer: production's */, { email: 'founder@arata.in', role: 'member', at: 200 } /* only on production */], invites: [] });
  await put(dst, `${A}private/vault/shopify.json`, vaultRow(K2, 'shpat_prod', 2));
  await put(dst, `${A}private/vault/meta.json`, vaultRow(K2, 'meta_prod', 2), 'application/json', 'migrate'); /* even the copy's own row */
  await put(dst, `${A}private/connections.json`, { meta: { state: 'live', account: 'act_1' }, shopify: { state: 'live' } });
  await put(dst, `${A}private/connected-ledger.json`, { rows: [{ k: 'orders', v: 2 }] });
  await put(dst, `${A}private/live/meta.json`, { spend: 2 });
  await putParted(dst, `${A}private/jams.json`, jamsDoc([{ id: 'j1', title: 'old jam' }, { id: 'j9', title: 'a jam the partner started on production' }]));
  /* a partner production has never seen, with jams and finals */
  const N = 'brands/nutrova-com/';
  await put(src, `${N}status.json`, { name: 'Nutrova', done: true });
  await putParted(src, `${N}private/jams.json`, jamsDoc([{ id: 'n1', title: 'nutrova jam' }]));
  await putParted(src, `${N}jams-v2.json`, { jams: { a: { title: 'v2' } } });
  await put(src, `${N}private/finals/f1.json`, { video: 'gen/final-1.mp4' });
  await put(src, `${N}private/vault/klaviyo.json`, vaultRow(K1, 'pk_x', 1));
  await put(src, `${N}raw/2026-10-26/a.json`, { paid: 1 });
  await put(src, `${N}spend/2026-10.json`, { usd: 1 });
  await put(src, `${N}private/sloosh-assets.json`, { a: 1 });
  await put(src, `${N}start-lock.json`, { at: 1 });
  await put(src, `${N}private/backup-1/moves.json`, { old: 1 });
  await put(src, `${N}demo/x.json`, { demo: 1 });
  await put(src, `${N}private/vault/meta-pending-1.json`, vaultRow(K1, 'p', 1));
  /* a third partner, for the mid-run change */
  await put(src, 'brands/manaprojects-com/status.json', { name: 'Mana', done: true });
  await put(src, 'brands/manaprojects-com/profile.json', { tagline: 'staging' });
  await put(dst, 'brands/manaprojects-com/profile.json', { tagline: 'production' });
  await put(src, 'brands/manaprojects-com/brief.md', '# staging\n', 'text/markdown');
  await put(dst, 'brands/manaprojects-com/brief.md', '# production\n', 'text/markdown');
  /* test brands */
  await put(src, 'brands/cozysnugglet-shop/status.json', { name: 'Cozy', done: true });
  /* workspaces: one per kind */
  await putParted(src, 'tenants/t_a1.json', { id: 't_a1', brandId: 'arata-in', acted: { x: 1 }, hero: 'gen/final-1.mp4' });
  await put(src, 'tenants/t_a2.json', { id: 't_a2', brandId: 'nutrova-com' });
  await put(src, 'tenants/t_a3.json', { id: 't_a3', brandId: 'arata-in', from: 'staging' });
  await put(dst, 'tenants/t_a3.json', { id: 't_a3', brandId: 'arata-in', from: 'production' });
  await put(src, 'tenants/t_c1.json', { id: 't_c1', brandId: 'cozysnugglet-shop' });
  await putParted(src, 'tenants/t_c2.json', { id: 't_c2', brandId: 'zenant-club' });
  await put(src, 'tenants/t_d1.json', { id: 't_d1', brandId: 'some-other-brand' });
}
test.before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  for (const d of ['sstg', 'sprd']) { await admin.query(`DROP DATABASE IF EXISTS ${d}`); await admin.query(`CREATE DATABASE ${d}`); }
  await admin.end();
  src = new pg.Pool({ connectionString: dbUrl('sstg') }); dst = new pg.Pool({ connectionString: dbUrl('sprd') });
  const dir = path.resolve('db/migrations'), list = fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  for (const pool of [src, dst]) for (const f of list) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  ({ copyBrand, copyWorkspaces } = await import('../db/partner-copy.js'));
  await seed();
});
test.after(async () => { if (!skip) await Promise.all([src.end(), dst.end()]); });

test('jams and their finals come only with the jams word; staging\'s own rows never do', { skip }, async () => {
  const without = await copyBrand({ src, dst, slug: 'nutrova-com', keys, store: files(), log: quiet });
  assert.equal(without.skipped['jams made while testing'], 2); assert.equal(without.skipped['finals of those jams'], 1);
  const s = files(), r = await copyBrand({ src, dst, slug: 'nutrova-com', keys, store: s, jams: true, sync: true, apply: true, exportRows: async () => assert.fail('nothing on production to replace'), log: quiet });
  assert.equal(r.rows, without.rows + 3);
  assert.equal(r.skipped['jams made while testing'], undefined); assert.equal(r.skipped['finals of those jams'], undefined);
  for (const why of ['raw paid answers (only the same day is read back)', "staging's spend", 'Sloosh uploads of staging links', "staging's build lock", 'a staging backup', 'a demo sandbox', 'a sign-in never finished']) assert.ok(r.skipped[why], why);
  assert.equal((await read(dst, 'brands/nutrova-com/private/jams.json')).doc.jams[0].title, 'nutrova jam');
  assert.equal((await read(dst, 'brands/nutrova-com/jams-v2.json')).doc.jams.a.title, 'v2');
  assert.ok(await read(dst, 'brands/nutrova-com/private/finals/f1.json'));
  assert.ok(s.b.prd.has('gen/final-1.mp4'), 'a final\'s video comes with it');
  assert.ok(s.b.prd.has('brands/nutrova-com/private/finals/f1/cut.mp4'));
  for (const k of ['raw/2026-10-26/a.json', 'spend/2026-10.json', 'private/sloosh-assets.json', 'start-lock.json', 'private/backup-1/moves.json', 'demo/x.json', 'private/vault/meta-pending-1.json']) assert.equal(await read(dst, `brands/nutrova-com/${k}`), null, k);
  /* a non-protected brand's sign-in is copied when production has none, and never written over after that */
  assert.equal(JSON.parse(decryptWith(K2, (await read(dst, 'brands/nutrova-com/private/vault/klaviyo.json')).doc.c)).token, 'pk_x');
  await put(src, 'brands/nutrova-com/private/vault/klaviyo.json', vaultRow(K1, 'pk_rotated_on_staging', 5));
  const again = await copyBrand({ src, dst, slug: 'nutrova-com', keys, store: files(), jams: true, sync: true, apply: true, exportRows: async () => {}, log: quiet });
  assert.equal(again.copied, 0); assert.deepEqual(again.kept, ['brands/nutrova-com/private/vault/klaviyo.json']);
  assert.equal(JSON.parse(decryptWith(K2, (await read(dst, 'brands/nutrova-com/private/vault/klaviyo.json')).doc.c)).token, 'pk_x');
});

test('the sync dry run lists every row production wrote that it would replace, with both times, and writes nothing', { skip }, async () => {
  const before = await snapshot(dst), s = files();
  const r = await copyBrand({ src, dst, slug: 'arata-in', keys, store: s, jams: true, sync: true, protect: ARATA, exportRows: async () => assert.fail('a dry run exports nothing'), log: quiet });
  assert.equal(await snapshot(dst), before); assert.equal(s.copies.length, 0);
  const by = Object.fromEntries(r.replaced.map((o) => [o.key.replace('brands/arata-in/', ''), o]));
  assert.deepEqual(Object.keys(by).sort(), ['moves.json', 'private/jams.json', 'private/members.json', 'profile.json']);
  assert.equal(by['profile.json'].action, 'overwrite'); assert.equal(by['profile.json'].by, 'production');
  assert.equal(by['moves.json'].action, 'merge-parts'); assert.equal(by['private/members.json'].action, 'merge-members');
  for (const o of r.replaced) { assert.match(o.staging, /^\d{4}-\d\d-\d\dT/); assert.match(o.production, /^\d{4}-\d\d-\d\dT/); }
  assert.deepEqual(by['private/jams.json'].prodOnlyParts, ['jams\u0001a\u0001j9']);
  assert.deepEqual(by['private/members.json'].prodOnlyMembers, ['founder@arata.in']);
  assert.equal(r.keptProd, 5, 'two sign-ins, connections, ledger, live');
});

test('Arata: a connection row missing on production stops the copy before anything is written', { skip }, async () => {
  await put(src, 'brands/arata-in/private/vault/ga4.json', vaultRow(K1, 'ya29', 1));
  const before = await snapshot(dst), seen = [];
  for (const sync of [false, true]) await assert.rejects(copyBrand({ src, dst, slug: 'arata-in', keys, store: files(), jams: true, sync, apply: true, protect: ARATA, exportRows: async () => seen.push(1), log: quiet }), /STOP: arata-in is protected .*private\/vault\/ga4\.json/);
  assert.equal(await snapshot(dst), before); assert.equal(seen.length, 0, 'not even the export');
  await src.query(`DELETE FROM objects WHERE key = 'brands/arata-in/private/vault/ga4.json'`);
});

test('a refused export (IAM) stops the brand with nothing written', { skip }, async () => {
  const before = await snapshot(dst), s = files();
  await assert.rejects(copyBrand({ src, dst, slug: 'arata-in', keys, store: s, jams: true, sync: true, apply: true, protect: ARATA, exportRows: async () => { throw new Error('write gs://brew-prod-backups/presync/x/arata-in.jsonl 403 (refused: IAM)'); }, log: quiet }), /403/);
  assert.equal(await snapshot(dst), before); assert.equal(s.copies.length, 0);
});

test('sync: production\'s rows are exported first, then staging wins; Arata\'s connections, production\'s members and parts stay', { skip }, async () => {
  const before = await snapshot(dst), vaultBefore = (await dst.query(`SELECT key, body, version, src FROM objects WHERE key ~ '^brands/arata-in/(private/vault/|private/connections|private/connected-ledger|private/live)' ORDER BY key`)).rows;
  let exported = null;
  const r = await copyBrand({ src, dst, slug: 'arata-in', keys, store: files(), jams: true, sync: true, apply: true, protect: ARATA, log: quiet,
    exportRows: async (name, text) => { assert.equal(await snapshot(dst), before, 'the export runs before any write'); exported = { name, lines: text.trim().split('\n').map((l) => JSON.parse(l)) }; } });
  assert.equal(exported.name, 'arata-in.jsonl');
  const objs = exported.lines.filter((l) => l.t === 'object').map((l) => l.key.replace('brands/arata-in/', '')).sort();
  assert.deepEqual(objs, ['moves.json', 'private/jams.json', 'private/members.json', 'profile.json']);
  assert.equal(JSON.parse(Buffer.from(exported.lines.find((l) => l.key.endsWith('profile.json')).body, 'base64')).tagline, 'production rewrote it', 'production\'s row as it was');
  assert.ok(exported.lines.some((l) => l.t === 'part' && l.part === 'jams\u0001a\u0001j9'), 'parts are exported with their documents');
  assert.ok(!exported.lines.some((l) => /vault|connections|ledger|live/.test(l.key)), 'connection rows are not replaced, so not exported');
  /* Arata's connection rows: byte for byte, same version, same src */
  assert.deepEqual((await dst.query(`SELECT key, body, version, src FROM objects WHERE key ~ '^brands/arata-in/(private/vault/|private/connections|private/connected-ledger|private/live)' ORDER BY key`)).rows, vaultBefore);
  assert.equal(JSON.parse(decryptWith(K2, (await read(dst, 'brands/arata-in/private/vault/shopify.json')).doc.c)).token, 'shpat_prod');
  assert.deepEqual(r.kept.sort(), ['private/connected-ledger.json', 'private/connections.json', 'private/live/meta.json', 'private/vault/meta.json', 'private/vault/shopify.json'].map((k) => `brands/arata-in/${k}`));
  /* staging wins */
  assert.equal((await read(dst, 'brands/arata-in/profile.json')).doc.tagline, 'staging');
  assert.equal((await read(dst, 'brands/arata-in/moves.json')).doc.moves[1].title, 'staging move 1');
  for (const k of ['profile.json', 'moves.json', 'private/members.json', 'private/jams.json']) assert.equal((await read(dst, `brands/arata-in/${k}`)).src, 'migrate', k);
  /* members: unioned by email */
  const m = (await read(dst, 'brands/arata-in/private/members.json')).doc, role = (e) => m.members.find((x) => x.email === e)?.role;
  assert.deepEqual(m.members.map((x) => x.email).sort(), ['arvind@joinsquareup.com', 'founder@arata.in', 'marketing@shopos.ai', 'sai@joinsquareup.com']);
  assert.equal(role('sai@joinsquareup.com'), 'member', 'same email: staging\'s role');
  assert.equal(role('arvind@joinsquareup.com'), 'owner', 'unless production\'s entry is newer');
  assert.equal(m.owner, 'marketing@shopos.ai');
  /* jams: staging's jam replaces production's of the same id, the jam only production has stays */
  const jams = (await read(dst, 'brands/arata-in/private/jams.json')).doc.jams;
  assert.deepEqual(jams.map((j) => [j.id, j.title]), [['j1', 'staging jam'], ['j9', 'a jam the partner started on production']]);
  /* the proof run: nothing left to copy, the kept rows listed again */
  const proof = await copyBrand({ src, dst, slug: 'arata-in', keys, store: files(), jams: true, sync: true, protect: ARATA, log: quiet });
  assert.equal(proof.copied, 0); assert.equal(proof.replaced.length, 0); assert.equal(proof.keptProd, 5);
});

test('a row production changes during the run is reported and not clobbered', { skip }, async () => {
  const r = await copyBrand({ src, dst, slug: 'manaprojects-com', keys, store: files(), sync: true, apply: true, log: quiet,
    exportRows: async () => { await put(dst, 'brands/manaprojects-com/profile.json', { tagline: 'the worker wrote this meanwhile' }); } });
  assert.deepEqual(r.conflicts, ['brands/manaprojects-com/profile.json']);
  assert.equal((await read(dst, 'brands/manaprojects-com/profile.json')).doc.tagline, 'the worker wrote this meanwhile');
  assert.equal((await read(dst, 'brands/manaprojects-com/profile.json')).src, null);
  assert.equal((await dst.query(`SELECT body FROM objects WHERE key = 'brands/manaprojects-com/brief.md'`)).rows[0].body.toString(), '# staging\n', 'the other rows still go');
});

test('test brands are refused, their workspaces never go', { skip }, async () => {
  for (const slug of ['cozysnugglet-shop', 'zenant-club']) await assert.rejects(copyBrand({ src, dst, slug, keys, store: files(), jams: true, sync: true, apply: true, exportRows: async () => {}, log: quiet }), /test brand/);
  await assert.rejects(copyWorkspaces({ src, dst, slugs: ['arata-in', 'cozysnugglet-shop'], apply: true, log: quiet }), /test brand/);
  const before = await snapshot(dst);
  const dry = await copyWorkspaces({ src, dst, slugs: ['arata-in', 'nutrova-com', 'manaprojects-com', 'in-puma-com', 'scrubroom-in'], log: quiet });
  assert.equal(await snapshot(dst), before, 'a dry run writes nothing');
  assert.deepEqual(dry.keys, ['tenants/t_a1.json', 'tenants/t_a2.json']); assert.equal(dry.testBrand, 2); assert.equal(dry.exists, 1); assert.equal(dry.otherBrand, 1);
});

test('workspaces: a partner\'s workspaces production has no row for, with their parts and media; never one production has', { skip }, async () => {
  const s = files(), five = ['arata-in', 'nutrova-com', 'manaprojects-com', 'in-puma-com', 'scrubroom-in'];
  const r = await copyWorkspaces({ src, dst, slugs: five, store: s, apply: true, log: quiet });
  assert.equal(r.copied, 2);
  assert.deepEqual((await read(dst, 'tenants/t_a1.json')).doc, (await read(src, 'tenants/t_a1.json')).doc);
  assert.equal((await dst.query(`SELECT content_type FROM objects WHERE key = 'tenants/t_a1.json'`)).rows[0].content_type, STUB);
  assert.equal((await read(dst, 'tenants/t_a3.json')).doc.from, 'production');
  for (const k of ['tenants/t_c1.json', 'tenants/t_c2.json', 'tenants/t_d1.json']) assert.equal(await read(dst, k), null, k);
  const again = await copyWorkspaces({ src, dst, slugs: five, store: s, apply: true, log: quiet });
  assert.equal(again.copied, 0); assert.equal(again.exists, 3);
  const only = await copyWorkspaces({ src, dst, slugs: ['scrubroom-in'], log: quiet });
  assert.equal(only.rows, 0, 'only the brands named in the run');
});
