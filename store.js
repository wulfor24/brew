// Tenant persistence: version history wiped on restart defeats the point.
// Each tenant is one JSON file on local disk (.tenants/<id>.json) and, on Cloud Run, a copy in GCS (tenants/<id>.json),
// written a moment after any change. Maps and Sets round-trip through tagged objects.
import fs from 'node:fs';
import path from 'node:path';
import { wiping, retireReady } from './retire.js'; // a workspace on a brand being reset is neither saved nor loaded
import { brewText, onceEscaped } from './brew-name.js'; // workspaces saved before the rename say ShopOS
import crypto from 'node:crypto';
import { createObjects, splitDoc } from './objects.js';

const enc = (k, v) => (v instanceof Map ? { __m: [...v.entries()] } : v instanceof Set ? { __s: [...v] } : v);
const dec = (k, v) => (v && typeof v === 'object' && v.__m ? new Map(v.__m) : v && typeof v === 'object' && v.__s ? new Set(v.__s) : v);

export function createStore({ dir, bucket, gToken, objects = null, log = console }) {
  fs.mkdirSync(dir, { recursive: true });
  /* behind this disk: Postgres rows (STORAGE=pg) or the bucket (Cloud Run) */
  const obj = objects || (process.env.K_SERVICE && bucket && gToken ? createObjects({ bucket, gToken, log }) : null);
  const remote = !!obj?.remote;
  const timers = new Map();
  const file = (id) => path.join(dir, String(id).replace(/[^a-z0-9_]/gi, '') + '.json');
  /* Postgres keeps a workspace in parts (objects.js PARTED): this instance writes only the parts it changed since it last read
     or wrote them, so a copy another instance holds never writes its older parts over newer ones. On the bucket (STORAGE
     unset) a workspace is one file, as before */
  const parted = !!obj?.pg;
  const base = new Map(); // id → Map(part → md5) as this instance last read or wrote it
  const mine = new Map(); // id → the version of this instance's last write (a notice with another version is another instance)
  const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
  const partsMap = (str) => { try { return new Map(splitDoc(JSON.parse(str)).map(([p, b]) => [p, md5(b)])); } catch { return null; } };
  const gcs = async (method, id, body) => {
    const name = `tenants/${String(id).replace(/[^a-z0-9_]/gi, '')}.json`;
    if (method === 'PUT' && parted) { const prev = puts.get(id) || Promise.resolve(); const run = prev.catch(() => {}).then(() => putNow(name, id, body)); puts.set(id, run); run.finally(() => { if (puts.get(id) === run) puts.delete(id); }).catch(() => {}); return run; }
    if (method === 'PUT') return obj.put(name, body, 'application/json');
    return getNow(name, id);
  };
  const puts = new Map(); /* one write at a time per workspace, in order */
  const putNow = async (name, id, body) => {
    if (!base.has(id)) { await obj.put(name, body, 'application/json'); base.set(id, partsMap(body) || new Map()); return true; } /* a workspace made here: written whole once */
    const parts = splitDoc(JSON.parse(body)), was = base.get(id), now = new Map(), set = [], del = [];
    parts.forEach(([p, b], ord) => { const h = md5(b); now.set(p, h); if (was.get(p) !== h) set.push([p, b, ord]); });
    for (const p of was.keys()) if (!now.has(p)) del.push(p);
    if (set.length || del.length) { const v = await obj.patchParts(name, set, del, { order: parts.map(([p]) => p) }); if (v) mine.set(id, v); }
    base.set(id, now); return true;
  };
  const getNow = async (name, id) => {
    const b = await obj.get(name); if (b == null) throw new Error(`gcs GET ${name} 404`); /* load0 reads a 404 as "no such workspace" */
    const str = b.toString('utf8'); if (parted) { const m = partsMap(str); if (m) base.set(id, m); } return str;
  };
  /* fn(id) when another instance wrote this workspace (or '*' after missed notices): the holder decides whether to load it
     again (feed-service drops an idle copy, so the next request reads the newer one) */
  const remoteFns = [];
  if (parted) obj.onChange((key, version) => { if (key === '*') { for (const f of remoteFns) f('*'); return; }
    const m = /^tenants\/(t_[a-f0-9]+)\.json$/.exec(key || ''); if (!m || (version && mine.get(m[1]) === version)) return; for (const f of remoteFns) f(m[1]); }).catch((e) => log.warn('[store] listen', e.message));
  const onRemote = (fn) => { remoteFns.push(fn); };
  /* drop what this instance knows of a workspace (it reads it fresh from the database next time) */
  const forget = (id) => { base.delete(id); mine.delete(id); fromGcs.delete(id); };

  const write = (t) => {
    if (wiping(t?.brandId)) return; fromGcs.add(t.id);
    let s; try { s = JSON.stringify(t, enc); } catch (e) { log.warn('[store] serialise', e.message); return; }
    try { fs.writeFileSync(file(t.id), s); } catch (e) { log.warn('[store] disk', e.message); }
    return remote ? gcs('PUT', t.id, s).catch((e) => log.warn('[store] gcs', e.message)) : Promise.resolve();
  };
  // debounced: many requests in a burst become one write
  const pending = new Map(); // id -> workspace still waiting for its debounced write
  const save = (t, ms = 1500) => { if (!t?.id) return; clearTimeout(timers.get(t.id)); pending.set(t.id, t); timers.set(t.id, setTimeout(() => { timers.delete(t.id); pending.delete(t.id); write(t); }, ms)); };
  const load = async (id) => { await retireReady(); const t = await load0(id); return t && wiping(t.brandId) ? null : t; };
  /* the first load of each workspace after boot reads the bucket, not this disk: for the ~20 s two instances overlap on a
     deploy the disk copy may be the old one. After that the disk copy (kept in step by write()) serves, as before */
  const fromGcs = new Set();
  /* a workspace saved before the fix heals as it loads: line breaks written as the two characters \ n read as real ones, and ₹ the
     model wrote as ‹ reads as ₹ (QA-02, QA-08) */
  const healSaved = (s) => { let x = String(s); if (x.includes('\\\\n')) x = x.replace(/\\\\n/g, '\\n'); if (x.includes('\u2039')) x = x.replace(/\u2039(?=\s?\d)/g, '₹'); return x; };
  const parse = (s) => JSON.parse(healSaved(brewText(onceEscaped(s))), dec);
  const load0 = async (id) => {
    if (!id || !/^t_[a-f0-9]+$/.test(id)) return null;
    if (remote && !fromGcs.has(id)) { try { const s = await gcs('GET', id); fromGcs.add(id); fs.writeFileSync(file(id), s); return parse(s); } catch (e) { if (/404/.test(e.message)) { fromGcs.add(id); return null; } log.warn('[store] gcs first read', e.message); } } /* the bucket unreachable: the disk copy below */
    try { if (fs.existsSync(file(id))) return parse(fs.readFileSync(file(id), 'utf8')); } catch (e) { log.warn('[store] read', e.message); }
    if (remote) { try { const s = await gcs('GET', id); fromGcs.add(id); fs.writeFileSync(file(id), s); return parse(s); } catch (e) { if (!/404/.test(e.message)) log.warn('[store] gcs read', e.message); } }
    return null;
  };
  /* every workspace file and when it last changed (the bucket's on Cloud Run, this disk locally), and one read fresh from it:
     the weekly history (history.js) reads each brand's workspaces, whichever instance saved them */
  const scan = async () => { if (!remote) return fs.readdirSync(dir).filter((f) => /^t_[a-f0-9]+\.json$/.test(f)).map((f) => ({ id: f.slice(0, -5), updated: fs.statSync(path.join(dir, f)).mtimeMs }));
    return (await obj.list('tenants/')).map((x) => { const m = /^tenants\/(t_[a-f0-9]+)\.json$/.exec(x.name); return m ? { id: m[1], updated: x.updated } : null; }).filter(Boolean); };
  const readFresh = async (id) => { if (!remote) return load0(id); if (!/^t_[a-f0-9]+$/.test(id || '')) return null; return parse(await gcs('GET', id)); };
  // drops pending writes (tests, resets); flushPending writes them now and waits for GCS (SIGTERM on Cloud Run)
  const flush = () => { for (const [id, tm] of timers) clearTimeout(tm); timers.clear(); pending.clear(); };
  const flushPending = () => { const ts = [...pending.values()]; flush(); return Promise.all(ts.map(write)); };
  return { save, load, write, flush, flushPending, scan, readFresh, onRemote, forget, pending: (id) => pending.has(id) || puts.has(id) };
}
