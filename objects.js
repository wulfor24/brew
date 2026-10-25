// One place for the app's stored objects, by their bucket name (tenants/<id>.json, brands/<slug>/<file>, _cache/…).
// STORAGE=pg (production, staging): structured objects (JSON, text, markdown) are rows in Postgres `objects`, read fresh
// by every instance, written with a version, and every write NOTIFYs the other instances; pictures, video, PDFs and zips
// stay in the bucket. Otherwise (demo, local, tests) everything is the bucket, as before.
// get → Buffer or null (not there); a storage error throws, so a caller never mistakes "unreachable" for "empty".
import crypto from 'node:crypto';
import { enabled as pgOn, q, tx, listen } from './db/index.js';
import { isRetired } from './retire.js';

const ROW = /\.(json|jsonl|md|txt|csv|js|html|svg)$/i;
/* documents stored in parts (see 004_doc_parts.sql): moves.json (public and private) and every workspace */
export const PARTED = /(^brands\/[^/]+\/(private\/)?(moves|jams|jams-v2)\.json$)|(^tenants\/t_[a-f0-9]+\.json$)/;
/* the shared jams are always kept one part per jam / change / version list, so two instances each write only their own */
const ALWAYS = /(^|\/)private\/jams(-v2)?\.json$/;
const STUB = 'application/x-parted', SEP = '\u0001', BIG = 32 * 1024, MANY = 20;
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
/* a document → [part, body] in order: one part per top-level key; a big map (store.js tags a Map as { __m: [[k, v]] }) or
   a big object of many entries gets a header part and one part per entry. Values JSON drops (undefined, functions) are
   left out, as JSON.stringify of the whole document would */
export function splitDoc(doc, { always = false } = {}) {
  const out = [], big = always ? -1 : BIG, many = always ? 0 : MANY;
  for (const [k, v] of Object.entries(doc)) {
    const whole = JSON.stringify(v); if (whole === undefined) continue;
    const byId = always && Array.isArray(v) && v.every((x) => x && typeof x === 'object' && x.id != null) && new Set(v.map((x) => String(x.id))).size === v.length;
    if (byId) { out.push([k, '{"__split":"a"}']); for (const x of v) out.push([`${k}${SEP}a${SEP}${x.id}`, JSON.stringify(x)]); continue; }
    const isMap = v && typeof v === 'object' && Array.isArray(v.__m) && Object.keys(v).length === 1, isObj = v && typeof v === 'object' && !Array.isArray(v) && !isMap;
    if (whole.length > big && isMap && v.__m.length >= many) { out.push([k, '{"__split":"m"}']); v.__m.forEach((e) => out.push([`${k}${SEP}m${SEP}${JSON.stringify(e[0])}`, JSON.stringify(e)])); } /* named by the entry's key, so adding one in front renames nothing */
    else if (whole.length > big && isObj && Object.keys(v).length >= many) { out.push([k, '{"__split":"o"}']); for (const [ek, ev] of Object.entries(v)) { const j = JSON.stringify(ev); if (j !== undefined) out.push([`${k}${SEP}o${SEP}${ek}`, j]); } }
    else out.push([k, whole]);
  }
  return out;
}
/* a key set as plain data (a key named __proto__ stays a key, never the object's prototype) */
const setKey = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
/* parts in their order → the document. A collection's header never empties entries already read (order ties, parts written
   by another instance), whatever order the rows come in */
export function joinDoc(rows) {
  const doc = {}, box = (top, kind) => { if (!Object.prototype.hasOwnProperty.call(doc, top) || doc[top] === null || typeof doc[top] !== 'object') setKey(doc, top, kind === 'm' ? { __m: [] } : kind === 'a' ? [] : {}); return doc[top]; };
  for (const { part, body } of rows) {
    const i = part.indexOf(SEP), b = body.toString('utf8');
    if (i < 0) { const v = JSON.parse(b); if (v && typeof v === 'object' && !Array.isArray(v) && v.__split && Object.keys(v).length === 1) box(part, v.__split); else setKey(doc, part, v); continue; }
    const top = part.slice(0, i), rest = part.slice(i + 1), kind = rest[0], c = box(top, kind), v = JSON.parse(b);
    if (kind === 'm') c.__m.push(v); else if (kind === 'a') c.push(v); else setKey(c, rest.slice(2), v);
  }
  return doc;
}
/* text the app reads whole; everything else is a binary file */
export const isRow = (key) => ROW.test(String(key || ''));
const typeOf = (key, t) => t || (/\.json$/i.test(key) ? 'application/json' : /\.md$/i.test(key) ? 'text/markdown' : 'text/plain');

export function createObjects({ bucket, gToken, log = console, pg = pgOn(), readThrough = process.env.OBJECTS_READTHROUGH === '1', mirror = process.env.OBJECTS_MIRROR === '1' } = {}) {
  const gcsOn = !!(bucket && gToken);
  const enc = encodeURIComponent;
  const gcsGet = async (key) => { const tk = await gToken(); const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${enc(key)}?alt=media`, { headers: { authorization: `Bearer ${tk}` }, signal: AbortSignal.timeout(30e3) }); if (r.status === 404) return null; if (!r.ok) throw new Error(`gcs get ${key} ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
  const gcsPut = async (key, buf, type) => { const tk = await gToken(); const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${enc(key)}`, { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'content-type': type || 'application/octet-stream' }, body: buf, signal: AbortSignal.timeout(60e3) }); if (!r.ok) throw new Error(`gcs put ${key} ${r.status}`); };
  const gcsDel = async (key) => { const tk = await gToken(); const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${enc(key)}`, { method: 'DELETE', headers: { authorization: `Bearer ${tk}` }, signal: AbortSignal.timeout(30e3) }); if (!r.ok && r.status !== 404) throw new Error(`gcs delete ${key} ${r.status}`); };
  const gcsList = async (prefix) => { const tk = await gToken(); const out = []; let pt = ''; do { const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${enc(prefix)}&fields=items(name,updated),nextPageToken${pt ? '&pageToken=' + pt : ''}`, { headers: { authorization: `Bearer ${tk}` }, signal: AbortSignal.timeout(30e3) }); if (!r.ok) throw new Error(`gcs list ${prefix} ${r.status}`); const j = await r.json(); out.push(...(j.items || [])); pt = j.nextPageToken || ''; } while (pt); return out; };
  const toBuf = (data) => (Buffer.isBuffer(data) ? data : data instanceof Uint8Array || data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)));
  const inRows = (key) => pg && isRow(key);
  const live = (key) => { if (isRetired()) throw new Error(`this instance is retired: ${key} not written`); };
  /* while the bucket is still the way back (OBJECTS_MIRROR=1), every row written is copied to the bucket too, so a revision
     that runs on the bucket again loses nothing */
  const chains = new Map(); /* one copy at a time per key, in write order, so the bucket never ends on an older version */
  const mirrorPut = (key, buf, type) => { if (!mirror || !gcsOn) return;
    const p = (chains.get(key) || Promise.resolve()).then(() => gcsPut(key, buf, type)).catch((e) => log.warn('[objects] mirror', key, e.message));
    chains.set(key, p); p.then(() => { if (chains.get(key) === p) chains.delete(key); }); };
  const mirrored = () => Promise.all([...chains.values()]); /* SIGTERM: wait for the copies still on their way */

  /* a parted document written in one transaction: only parts whose bytes changed are sent, parts gone are deleted, and the
     stub row's version moves on (its trigger tells the other instances) */
  /* the stub row first: it is the document's lock (every writer of the document takes it first, so two writers never wait
     on each other in opposite order) and its version is what the other instances hear */
  const stub = async (c, key) => +(await c.query(`INSERT INTO objects (key, body, content_type, src) VALUES ($1, '\\x', '${STUB}', NULL) ON CONFLICT (key) DO UPDATE SET body = '\\x', content_type = '${STUB}', src = NULL, version = nextval('objects_version'), updated_at = now() RETURNING version`, [key])).rows[0].version;
  const byPart = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  /* a parted document written whole in one transaction: only parts whose bytes changed are sent, parts gone are deleted, and
     every part's place follows the document's order */
  async function putParts(c, key, buf) {
    let doc; try { doc = JSON.parse(buf.toString('utf8')); } catch { doc = null; }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { /* not a document of fields: kept whole, as any object */
      await c.query(`INSERT INTO objects (key, body, content_type, src) VALUES ($1, $2, 'application/json', NULL) ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, src = NULL, version = nextval('objects_version'), updated_at = now()`, [key, buf]);
      await c.query('DELETE FROM doc_parts WHERE key = $1', [key]); return 0; }
    const version = await stub(c, key);
    const parts = splitDoc(doc, { always: ALWAYS.test(key) }), have = new Map((await c.query('SELECT part, ord, md5(body) AS h FROM doc_parts WHERE key = $1', [key])).rows.map((r) => [r.part, r]));
    const ch = [], mv = [];
    parts.forEach(([part, body], ord) => { const h = have.get(part); have.delete(part); const b = Buffer.from(body);
      if (h && h.h === md5(b)) { if (h.ord !== ord) mv.push([part, ord]); return; } /* same bytes: at most its place moves */
      ch.push([part, ord, b]); });
    ch.sort(byPart); mv.sort(byPart);
    if (mv.length) await c.query('UPDATE doc_parts d SET ord = x.o FROM unnest($2::text[], $3::int[]) AS x(p, o) WHERE d.key = $1 AND d.part = x.p', [key, mv.map((x) => x[0]), mv.map((x) => x[1])]);
    if (ch.length) await c.query(`INSERT INTO doc_parts (key, part, ord, body) SELECT $1, p, o, b FROM unnest($2::text[], $3::int[], $4::bytea[]) AS x(p, o, b)
      ON CONFLICT (key, part) DO UPDATE SET ord = EXCLUDED.ord, body = EXCLUDED.body`, [key, ch.map((x) => x[0]), ch.map((x) => x[1]), ch.map((x) => x[2])]);
    if (have.size) await c.query('DELETE FROM doc_parts WHERE key = $1 AND part = ANY($2)', [key, [...have.keys()].sort()]);
    return version;
  }
  /* the parts of a parted document as stored: [{ part, ord, body }] in order (a document still kept whole is split first) */
  async function getParts(key) {
    if (!inRows(key) || !PARTED.test(key)) return null;
    const row = (await q('SELECT body, content_type FROM objects WHERE key = $1', [key])).rows[0];
    if (row && row.content_type !== STUB && row.body?.length) await tx(async (c) => { const r = (await c.query('SELECT body, content_type FROM objects WHERE key = $1 FOR UPDATE', [key])).rows[0]; if (r && r.content_type !== STUB && r.body?.length) await putParts(c, key, r.body); });
    return (await q('SELECT part, ord, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [key])).rows;
  }
  /* change only these parts of a parted document (set: [[part, body, ord]], del: [part]); everything else stays as another
     instance left it. The stub's version moves on and the other instances hear of it */
  async function patchParts(key, set = [], del = [], { order = null } = {}) {
    live(key);
    if (!inRows(key) || !PARTED.test(key)) throw new Error(`not a parted document: ${key}`);
    await getParts(key); /* split first if it is still whole */
    const version = await tx(async (c) => {
      const v = await stub(c, key);
      const s2 = [...set].sort(byPart);
      if (s2.length) await c.query(`INSERT INTO doc_parts (key, part, ord, body) SELECT $1, p, o, b FROM unnest($2::text[], $3::int[], $4::bytea[]) AS x(p, o, b)
        ON CONFLICT (key, part) DO UPDATE SET ord = EXCLUDED.ord, body = EXCLUDED.body`, [key, s2.map((x) => x[0]), s2.map((x) => x[2]), s2.map((x) => Buffer.from(x[1]))]);
      if (del.length) await c.query('DELETE FROM doc_parts WHERE key = $1 AND part = ANY($2)', [key, [...del].sort()]);
      /* the writer's whole order (every part it holds): places follow it, so an unchanged part never keeps a stale place that
         ties with or overtakes a changed one; parts only another instance holds keep theirs, after these */
      if (order?.length) await c.query(`UPDATE doc_parts d SET ord = x.o - 1 FROM unnest($2::text[]) WITH ORDINALITY AS x(p, o) WHERE d.key = $1 AND d.part = x.p AND d.ord <> x.o - 1`, [key, order]);
      return v;
    });
    if (mirror && gcsOn) { const b = await get(key); if (b) mirrorPut(key, b, 'application/json'); }
    return version;
  }
  /* get(), but asking only for what changed: with the version a caller already holds, the body comes back only when the
     object moved on ({ version, same: true } otherwise). For callers that keep what they read (brand-pack's read cache) */
  async function getV(key, have = null) {
    if (!inRows(key)) return { version: null, body: await get(key) };
    const row = (await q('SELECT version, content_type, CASE WHEN version = $2 THEN NULL ELSE body END AS body FROM objects WHERE key = $1', [key, have == null ? -1 : have])).rows[0];
    if (!row) return { version: null, body: await get(key) }; /* not a row (yet): read-through and the rest as get() does */
    const version = +row.version; if (have != null && version === have) return { version, same: true };
    if (row.content_type === STUB) return { version, body: Buffer.from(JSON.stringify(joinDoc((await q('SELECT part, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [key])).rows))) };
    if (!row.body?.length && readThrough && gcsOn) return { version: null, body: await get(key) }; /* not imported yet: as get() */
    return { version, body: row.body?.length ? row.body : null };
  }
  async function get(key) {
    if (inRows(key)) { const row = (await q('SELECT body, content_type FROM objects WHERE key = $1', [key])).rows[0], b = row?.body;
      if (row?.content_type === STUB) return Buffer.from(JSON.stringify(joinDoc((await q('SELECT part, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [key])).rows))); /* parted */
      if (b?.length) return b; /* an empty body is a row just locked for its first write */
      /* the switch from the bucket (OBJECTS_READTHROUGH=1): an object not imported yet is read from the bucket once and kept */
      if (!readThrough || !gcsOn || b) return null;
      const g = await gcsGet(key); if (g) await q('INSERT INTO objects (key, body, content_type) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING', [key, g, typeOf(key)]);
      return g; }
    return gcsOn ? gcsGet(key) : null;
  }
  async function put(key, data, type) {
    live(key); const buf = toBuf(data);
    if (inRows(key) && PARTED.test(key)) { const v = await tx((c) => putParts(c, key, buf)); mirrorPut(key, buf, 'application/json'); return v || true; }
    if (inRows(key)) { const v = await q(`INSERT INTO objects (key, body, content_type) VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, src = NULL, version = nextval('objects_version'), updated_at = now() RETURNING version`, [key, buf, typeOf(key, type)]).then((r) => +r.rows[0].version); mirrorPut(key, buf, typeOf(key, type)); return v; } /* the version written (truthy), so the writer can tell its own notice */
    if (!gcsOn) return false;
    await gcsPut(key, buf, type); return true;
  }
  async function del(key) { live(key); if (inRows(key)) { await tx(async (c) => { await c.query('DELETE FROM objects WHERE key = $1', [key]); await c.query('DELETE FROM doc_parts WHERE key = $1', [key]); }); /* one transaction: nobody reads half a document */ if ((readThrough || mirror) && gcsOn) await gcsDel(key); /* or the bucket's copy would come back */ return; } if (gcsOn) await gcsDel(key); }
  /* every object under a prefix, rows and bucket files together: [{ name, updated }] (updated an ISO string, as GCS gives it) */
  async function list(prefix) {
    const rows = pg ? (await q(`SELECT key, updated_at FROM objects WHERE key LIKE $1 ORDER BY key`, [prefix.replace(/[\\%_]/g, '\\$&') + '%'])).rows.map((r) => ({ name: r.key, updated: r.updated_at.toISOString() })) : [];
    /* on pg only binary files are in the bucket; a prefix that can hold none (a JSON folder) skips the bucket */
    const files = gcsOn ? await gcsList(prefix).then((xs) => (pg ? xs.filter((x) => !isRow(x.name)) : xs)) : [];
    return [...rows, ...files];
  }
  /* read-modify-write that two instances can't interleave: fn(current or null) → next (undefined keeps it). On pg the row
     is locked for the change; on the bucket it is a plain read then write (one instance, as before) */
  async function update(key, fn, { parse = true, type } = {}) {
    live(key);
    const dec = (b) => (b == null ? null : parse ? JSON.parse(b.toString('utf8')) : b);
    if (inRows(key)) { let copy = null; /* the bucket copy goes out only after the commit */
      const out = await tx(async (c) => {
      await c.query(`INSERT INTO objects (key, body) VALUES ($1, '\\x') ON CONFLICT (key) DO NOTHING`, [key]); /* a row to lock, even for a new object */
      const locked = (await c.query('SELECT body, content_type FROM objects WHERE key = $1 FOR UPDATE', [key])).rows[0];
      if (locked?.content_type === STUB) { const prev = joinDoc((await c.query('SELECT part, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [key])).rows);
        const next = await fn(parse ? prev : Buffer.from(JSON.stringify(prev))); if (next === undefined) return prev;
        const buf = toBuf(next); await putParts(c, key, buf); copy = [buf, 'application/json']; return next; }
      const cur = locked?.body;
      const prev = cur && cur.length ? dec(cur) : readThrough && gcsOn ? dec(await gcsGet(key)) : null; /* not imported yet: the bucket's copy is the start */
      const next = await fn(prev);
      if (next === undefined) { if (!cur?.length) await c.query('DELETE FROM objects WHERE key = $1', [key]); return prev; }
      const buf = toBuf(next);
      if (PARTED.test(key)) { await putParts(c, key, buf); copy = [buf, 'application/json']; return next; }
      await c.query(`UPDATE objects SET body = $2, content_type = $3, src = NULL, version = nextval('objects_version'), updated_at = now() WHERE key = $1`, [key, buf, typeOf(key, type)]);
      copy = [buf, typeOf(key, type)];
      return next;
    });
      if (copy) mirrorPut(key, copy[0], copy[1]); return out; }
    const prev = dec(await get(key)); const next = await fn(prev);
    if (next !== undefined) await put(key, next, type);
    return next === undefined ? prev : next;
  }
  /* fn(key) for every object another instance (or this one) changes; pg only */
  /* fn(key, version) when any instance writes an object; fn('*') after the notice connection came back from a drop, when
     notices may have been missed: every cache that listens catches up */
  const onChange = (fn) => (pg ? listen('objects', (p) => { if (p === '*') return fn('*', null); const i = String(p).lastIndexOf('|'); return i < 0 ? fn(p, null) : fn(p.slice(0, i), +p.slice(i + 1)); }) : Promise.resolve(() => {}));
  return { get, getV, put, del, list, update, getParts, patchParts, onChange, mirrored, pg, remote: pg || gcsOn, isRow: inRows };
}
