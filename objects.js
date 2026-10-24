// One place for the app's stored objects, by their bucket name (tenants/<id>.json, brands/<slug>/<file>, _cache/…).
// STORAGE=pg (production, staging): structured objects (JSON, text, markdown) are rows in Postgres `objects`, read fresh
// by every instance, written with a version, and every write NOTIFYs the other instances; pictures, video, PDFs and zips
// stay in the bucket. Otherwise (demo, local, tests) everything is the bucket, as before.
// get → Buffer or null (not there); a storage error throws, so a caller never mistakes "unreachable" for "empty".
import { enabled as pgOn, q, tx, listen } from './db/index.js';

const ROW = /\.(json|jsonl|md|txt|csv|js|html|svg)$/i; /* text the app reads whole; everything else is a binary file */
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
  /* while the bucket is still the way back (OBJECTS_MIRROR=1), every row written is copied to the bucket too, so a revision
     that runs on the bucket again loses nothing */
  const chains = new Map(); /* one copy at a time per key, in write order, so the bucket never ends on an older version */
  const mirrorPut = (key, buf, type) => { if (!mirror || !gcsOn) return;
    const p = (chains.get(key) || Promise.resolve()).then(() => gcsPut(key, buf, type)).catch((e) => log.warn('[objects] mirror', key, e.message));
    chains.set(key, p); p.then(() => { if (chains.get(key) === p) chains.delete(key); }); };
  const mirrored = () => Promise.all([...chains.values()]); /* SIGTERM: wait for the copies still on their way */

  async function get(key) {
    if (inRows(key)) { const b = (await q('SELECT body FROM objects WHERE key = $1', [key])).rows[0]?.body; if (b?.length) return b; /* an empty body is a row just locked for its first write */
      /* the switch from the bucket (OBJECTS_READTHROUGH=1): an object not imported yet is read from the bucket once and kept */
      if (!readThrough || !gcsOn || b) return null;
      const g = await gcsGet(key); if (g) await q('INSERT INTO objects (key, body, content_type) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING', [key, g, typeOf(key)]);
      return g; }
    return gcsOn ? gcsGet(key) : null;
  }
  async function put(key, data, type) {
    const buf = toBuf(data);
    if (inRows(key)) { await q(`INSERT INTO objects (key, body, content_type) VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, version = objects.version + 1, updated_at = now()`, [key, buf, typeOf(key, type)]); mirrorPut(key, buf, typeOf(key, type)); return true; }
    if (!gcsOn) return false;
    await gcsPut(key, buf, type); return true;
  }
  async function del(key) { if (inRows(key)) { await q('DELETE FROM objects WHERE key = $1', [key]); if ((readThrough || mirror) && gcsOn) await gcsDel(key); /* or the bucket's copy would come back */ return; } if (gcsOn) await gcsDel(key); }
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
    const dec = (b) => (b == null ? null : parse ? JSON.parse(b.toString('utf8')) : b);
    if (inRows(key)) return tx(async (c) => {
      await c.query(`INSERT INTO objects (key, body) VALUES ($1, '\\x') ON CONFLICT (key) DO NOTHING`, [key]); /* a row to lock, even for a new object */
      const cur = (await c.query('SELECT body FROM objects WHERE key = $1 FOR UPDATE', [key])).rows[0]?.body;
      const prev = cur && cur.length ? dec(cur) : readThrough && gcsOn ? dec(await gcsGet(key)) : null; /* not imported yet: the bucket's copy is the start */
      const next = await fn(prev);
      if (next === undefined) { if (!cur?.length) await c.query('DELETE FROM objects WHERE key = $1', [key]); return prev; }
      const buf = toBuf(next);
      await c.query('UPDATE objects SET body = $2, content_type = $3, version = version + 1, updated_at = now() WHERE key = $1', [key, buf, typeOf(key, type)]);
      mirrorPut(key, buf, typeOf(key, type));
      return next;
    });
    const prev = dec(await get(key)); const next = await fn(prev);
    if (next !== undefined) await put(key, next, type);
    return next === undefined ? prev : next;
  }
  /* fn(key) for every object another instance (or this one) changes; pg only */
  const onChange = (fn) => (pg ? listen('objects', fn) : Promise.resolve(() => {}));
  return { get, put, del, list, update, onChange, mirrored, pg, remote: pg || gcsOn, isRow: inRows };
}
