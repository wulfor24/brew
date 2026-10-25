// Phase 6: a partner copied from staging's database to production's (db/partner-copy.js). Two real databases on one local
// Postgres: what is copied reads back the same, sign-ins move to production's key, testing stays behind, and a second run (the
// final delta) copies only what staging changed and never what production changed itself.
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
let src, dst, copyBrand, copyGlobal, mediaRefs;
const dbUrl = (name) => url.replace(/\/postgres\?/, `/${name}?`);
const STUB = 'application/x-parted';
const put = (pool, key, body, type = 'application/json') => pool.query(`INSERT INTO objects (key, body, content_type) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, version = nextval('objects_version'), src = NULL`, [key, Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), type]);
const putParted = async (pool, key, doc) => { await pool.query(`INSERT INTO objects (key, body, content_type) VALUES ($1, '\\x', '${STUB}') ON CONFLICT (key) DO UPDATE SET content_type = '${STUB}', src = NULL, version = nextval('objects_version')`, [key]);
  await pool.query('DELETE FROM doc_parts WHERE key = $1', [key]);
  let i = 0; for (const [p, b] of splitDoc(doc, { always: /jams/.test(key) })) await pool.query('INSERT INTO doc_parts (key, part, ord, body) VALUES ($1, $2, $3, $4)', [key, p, i++, Buffer.from(b)]); };
const read = async (pool, key) => { const r = (await pool.query('SELECT body, content_type, src FROM objects WHERE key = $1', [key])).rows[0]; if (!r) return null;
  if (r.content_type === STUB) return { doc: joinDoc((await pool.query('SELECT part, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [key])).rows), src: r.src };
  return { doc: JSON.parse(r.body.toString('utf8')), src: r.src }; };
/* two buckets in memory: { name → { md5, body } } */
function fakeStore() {
  const b = { stg: new Map(), prd: new Map() }; const md5 = (x) => crypto.createHash('md5').update(x).digest('base64');
  return { b, src: 'stg', dst: 'prd', add: (bk, name, body) => b[bk].set(name, { md5: md5(body), body }), copies: [],
    async list(bk, prefix) { return [...b[bk]].filter(([n]) => n.startsWith(prefix)).map(([name, x]) => ({ name, md5: x.md5, size: x.body.length })); },
    async exists(bk, name) { return b[bk].has(name); },
    async copy(fb, from, tb, to) { this.copies.push(`${from}→${to}`); b[tb].set(to, { ...b[fb].get(from) }); } };
}
const moves = { 1: { title: 'Ship the serum bundle', img: 'research/0123456789abcdef0123.jpg' }, 2: { title: 'Fix COD', hero: '/gen/hero-1.png' } };
async function seedArata() {
  await put(src, 'brands/arata-in/status.json', { name: 'Arata', state: 'Ready', done: true });
  await put(src, 'brands/arata-in/profile.json', { name: 'Arata', pic: 'gen/missing-1.png' });
  await putParted(src, 'brands/arata-in/moves.json', { moves });
  await put(src, 'brands/arata-in/private/members.json', { owner: 'marketing@shopos.ai', members: [] });
  await put(src, 'brands/arata-in/private/vault/shopify.json', { c: encryptWith(K1, JSON.stringify({ token: 'shpat_x', shop: 'arata.myshopify.com', app: 'own-oauth', refresh: null })), at: 1792675693861 });
  await put(src, 'brands/arata-in/private/vault/meta-pending-abc.json', { c: encryptWith(K1, '{"t":1}'), at: 1 });
  await put(src, 'brands/arata-in/private/vault/old.json', { c: null, at: 1 });
  await putParted(src, 'brands/arata-in/private/jams.json', { jams: [{ id: 'j1', title: 'test jam' }] });
  await put(src, 'brands/arata-in/raw/2026-10-24/meta.json', { paid: 1 });
  await put(src, 'brands/arata-in/private/backup-2026-10-22/moves.json', { old: 1 });
  await put(src, 'brands/arata-in/start-lock.json', { at: 1 });
  await put(src, 'brands/arata-in/private/sloosh-assets.json', { a: { url: 'https://brew.joinsquareup.com/gen/x.png' } });
  await put(src, 'brands/arata-in/brief.md', '# Arata\n', 'text/markdown');
  await put(src, 'brands/cozysnugglet-shop/status.json', { name: 'Cozy' });
  await put(src, 'brands/_brew/calendar/confirmed.json', { diwali: '2026-11-08' });
  await put(src, 'brands/_brew/private/visitors.json', { 'param@joinsquareup.com': 1 });
  await put(src, 'brands/_brew/video/instagram-abc.json', { read: 'a clip' });
}
test.before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  for (const d of ['stg', 'prd']) { await admin.query(`DROP DATABASE IF EXISTS ${d}`); await admin.query(`CREATE DATABASE ${d}`); }
  await admin.end();
  src = new pg.Pool({ connectionString: dbUrl('stg') }); dst = new pg.Pool({ connectionString: dbUrl('prd') });
  const dir = path.resolve('db/migrations'), files = fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  for (const pool of [src, dst]) for (const f of files) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  ({ copyBrand, copyGlobal, mediaRefs } = await import('../db/partner-copy.js'));
  await seedArata();
});
test.after(async () => { if (!skip) await Promise.all([src.end(), dst.end()]); });

const files = () => { const s = fakeStore(); s.add('stg', 'brands/arata-in/assets/pack.png', 'png1'); s.add('stg', 'brands/arata-in/private/pdf/move-01.pdf', 'pdf1');
  s.add('stg', 'brands/arata-in/raw/2026-10-24/shot.png', 'raw'); s.add('stg', 'media/0123456789abcdef0123.jpg', 'old-research'); s.add('stg', 'gen/hero-1.png', 'hero'); return s; };

test('a dry run plans the copy and writes nothing', { skip }, async () => {
  const s = files(), r = await copyBrand({ src, dst, slug: 'arata-in', keys, store: s, log: quiet });
  assert.equal((await dst.query('SELECT count(*)::int AS n FROM objects')).rows[0].n, 0);
  assert.equal(s.copies.length, 0);
  assert.equal(r.rows, 6); /* status, profile, moves, members, the one live sign-in, brief */
  assert.equal(r.copied, 6);
  assert.deepEqual(r.vault.map((v) => v.file), ['shopify.json']);
  assert.match(r.vault[0].kinds, /token,shop,app,refresh/);
  assert.ok(!JSON.stringify(r).includes('shpat_x'), 'a secret never reaches the report');
  for (const why of ['jams made while testing', 'raw paid answers (only the same day is read back)', 'a staging backup', "staging's build lock", 'Sloosh uploads of staging links', 'a sign-in never finished', 'an empty sign-in']) assert.ok(r.skipped[why], why);
  assert.equal(r.files, 2); assert.equal(r.filesCopied, 2);
  assert.equal(r.media, 3); assert.equal(r.mediaCopied, 2); assert.deepEqual(r.mediaMissing, ['gen/missing-1.png']);
});

test('the copy reads back the same on production, with sign-ins on production\'s key', { skip }, async () => {
  const s = files(); const r = await copyBrand({ src, dst, slug: 'arata-in', keys, store: s, apply: true, log: quiet });
  assert.equal(r.copied, 6);
  for (const k of ['status.json', 'profile.json', 'moves.json', 'private/members.json']) assert.deepEqual((await read(dst, `brands/arata-in/${k}`)).doc, (await read(src, `brands/arata-in/${k}`)).doc, k);
  assert.equal((await dst.query(`SELECT content_type FROM objects WHERE key = 'brands/arata-in/moves.json'`)).rows[0].content_type, STUB, 'moves stay in parts');
  assert.equal((await dst.query(`SELECT body FROM objects WHERE key = 'brands/arata-in/brief.md'`)).rows[0].body.toString(), '# Arata\n');
  const v = (await read(dst, 'brands/arata-in/private/vault/shopify.json')).doc;
  assert.equal(JSON.parse(decryptWith(K2, v.c)).token, 'shpat_x');
  assert.equal(v.at, 1792675693861, 'the saved time stays');
  assert.throws(() => decryptWith(K1, v.c), 'staging\'s key does not open production\'s copy');
  for (const k of ['private/jams.json', 'raw/2026-10-24/meta.json', 'start-lock.json', 'private/sloosh-assets.json', 'private/vault/meta-pending-abc.json', 'private/backup-2026-10-22/moves.json']) assert.equal(await read(dst, `brands/arata-in/${k}`), null, k);
  assert.equal(await read(dst, 'brands/cozysnugglet-shop/status.json'), null);
  assert.ok(s.b.prd.has('brands/arata-in/assets/pack.png') && s.b.prd.has('brands/arata-in/private/pdf/move-01.pdf'));
  assert.ok(!s.b.prd.has('brands/arata-in/raw/2026-10-24/shot.png'));
  assert.equal(s.b.prd.get('research-media/0123456789abcdef0123.jpg').body, 'old-research', 'research media from the older media/ folder lands where production reads it');
  assert.ok(s.b.prd.has('gen/hero-1.png'));
  assert.equal((await read(src, 'brands/arata-in/private/vault/shopify.json')).src, null, 'staging is untouched');
});

test('again: nothing is copied twice', { skip }, async () => {
  const s = files(); for (const [n, x] of (await (async () => { const t = files(); await copyBrand({ src, dst, slug: 'arata-in', keys, store: t, apply: true, log: quiet }); return t.b.prd; })())) s.b.prd.set(n, x);
  const r = await copyBrand({ src, dst, slug: 'arata-in', keys, store: s, apply: true, log: quiet });
  assert.equal(r.copied, 0); assert.equal(r.same, 6); assert.equal(r.filesCopied, 0); assert.equal(r.mediaCopied, 0); assert.equal(s.copies.length, 0);
});

test('the final delta takes staging\'s new changes and never overwrites what production changed', { skip }, async () => {
  await put(src, 'brands/arata-in/profile.json', { name: 'Arata', pic: 'gen/missing-1.png', tagline: 'new on staging' });
  await putParted(src, 'brands/arata-in/moves.json', { moves: { ...moves, 3: { title: 'A third move' } } });
  await put(dst, 'brands/arata-in/private/members.json', { owner: 'marketing@shopos.ai', members: [{ email: 'founder@arata.in' }] }); /* production's own change */
  await putParted(dst, 'brands/arata-in/status.json', { name: 'Arata', state: 'Ready', done: true, seenAt: 5 }); /* production rewrote it, in parts */
  const r = await copyBrand({ src, dst, slug: 'arata-in', keys, store: files(), apply: true, log: quiet });
  assert.equal(r.copied, 2); assert.equal(r.keptProd, 2);
  assert.equal((await read(dst, 'brands/arata-in/profile.json')).doc.tagline, 'new on staging');
  assert.equal((await read(dst, 'brands/arata-in/moves.json')).doc.moves[3].title, 'A third move');
  assert.equal((await read(dst, 'brands/arata-in/private/members.json')).doc.members[0].email, 'founder@arata.in');
  assert.equal((await read(dst, 'brands/arata-in/status.json')).doc.seenAt, 5, 'production\'s parts are left whole');
});

test('test brands, unbuilt brands and a wrong staging key are refused before anything is written', { skip }, async () => {
  await assert.rejects(copyBrand({ src, dst, slug: 'cozysnugglet-shop', keys, store: files(), apply: true, log: quiet }), /test brand/);
  await assert.rejects(copyBrand({ src, dst, slug: 'nobody-com', keys, store: files(), apply: true, log: quiet }), /no status\.json/);
  await put(src, 'brands/nutrova-com/status.json', { name: 'Nutrova', done: true });
  await put(src, 'brands/nutrova-com/private/vault/meta.json', { c: encryptWith(K2, '{"token":"x"}'), at: 1 }); /* not staging's key */
  await assert.rejects(copyBrand({ src, dst, slug: 'nutrova-com', keys, store: files(), apply: true, log: quiet }));
  assert.equal(await read(dst, 'brands/nutrova-com/status.json'), null);
});

test('shared rows: only confirmed holidays and video reads, never staging\'s visitors', { skip }, async () => {
  const r = await copyGlobal({ src, dst, apply: true, log: quiet });
  assert.equal(r.copied, 2);
  assert.ok(await read(dst, 'brands/_brew/calendar/confirmed.json'));
  assert.ok(await read(dst, 'brands/_brew/video/instagram-abc.json'));
  assert.equal(await read(dst, 'brands/_brew/private/visitors.json'), null);
});

test('media references: research hashes and generated names, wherever they sit in the text', () => {
  const r = mediaRefs('{"a":"research/0123456789abcdef0123.mp4","b":"/gen/fin-b4d8.jpg","c":"https://x/gen/y.png","d":"myresearch/0123456789abcdef0123.jpg","e":"oxygen/z.png"}');
  assert.deepEqual([...r.research], ['0123456789abcdef0123.mp4']);
  assert.deepEqual([...r.gen].sort(), ['fin-b4d8.jpg', 'y.png']);
});
