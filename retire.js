// One live instance at a time, and a clean way to start a brand over.
// Cloud Run keeps instances of replaced (even deleted) revisions alive while they hold a request, and their watchers,
// builds and notes go on writing stale state into the bucket. gs://<bucket>/control/live.json says which revision is live:
//   { rev, n, at, wipe: [slug] }
// - the newest revision claims it on its first real request (traffic has moved to it);
// - an instance of an older revision, or one that booted before a "stop" (tools/reset-brand.sh), blocks every outbound
//   call and exits; Cloud Run starts a fresh instance of the live revision if one is needed;
// - slugs in `wipe` are being reset: hidden from every list, never read, never written, never built.
// Off locally (no K_SERVICE) and with RETIRE_OFF=1.
const f0 = globalThis.fetch;
const wipe = new Set();
export const wiping = (slug) => !!slug && wipe.has(String(slug));
// the stores wait for the first check, so a fresh instance never loads a brand that is mid-reset
let ready = Promise.resolve(), done = () => {};
export const retireReady = () => ready;

export function createRetire({ bucket, gToken, objects = null, log = console, everyMs = 15e3, graceMs = 5e3 }) {
  const rev = process.env.K_REVISION || '', n = +((rev.match(/-0*(\d+)-[a-z0-9]+$/) || [])[1] || 0), boot = Date.now();
  const on = !!(process.env.K_SERVICE && bucket && n && process.env.RETIRE_OFF !== '1');
  const obj = 'control/live.json';
  let claimed = false, retired = false, timer = null;
  const read = async () => {
    if (objects?.pg) { const b = await objects.get(obj); return b ? JSON.parse(b.toString('utf8')) : null; } /* STORAGE=pg: a row */
    const tk = await gToken();
    const r = await f0(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(obj)}?alt=media`, { headers: { authorization: `Bearer ${tk}` }, signal: AbortSignal.timeout(15e3) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`live.json ${r.status}`);
    return r.json();
  };
  const write = async (m) => {
    if (objects?.pg) return objects.put(obj, JSON.stringify(m), 'application/json');
    const tk = await gToken();
    const r = await f0(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(obj)}`, { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(m), signal: AbortSignal.timeout(15e3) });
    if (!r.ok) throw new Error(`live.json put ${r.status}`);
  };
  const stale = (m) => !!m && (m.n > n || (m.rev === 'stop' && m.n >= n && m.at > boot));
  const apply = (m) => { wipe.clear(); for (const s of m?.wipe || []) wipe.add(String(s)); };
  const retire = (m) => {
    if (retired) return; retired = true; clearInterval(timer);
    log.warn(`[retire] ${rev} is replaced (${m.rev} #${m.n}): no more outbound calls, exiting in ${graceMs / 1000}s`);
    globalThis.fetch = async (u, ...a) => { if (String(u?.url || u).startsWith('http://metadata.google.internal')) return f0(u, ...a); throw new Error('this instance is retired'); };
    setTimeout(() => process.exit(0), graceMs);
  };
  const check = async () => { if (retired) return; try { const m = await read(); apply(m); if (stale(m)) retire(m); } catch (e) { log.warn('[retire] check', e.message); } };
  if (on) ready = new Promise((r) => { done = r; setTimeout(r, 20e3).unref?.(); });
  return {
    rev, n,
    retired: () => retired,
    // at boot, before anything resumes: learn which brands are being reset
    async init() { if (!on) return; await check(); done(); timer = setInterval(check, everyMs); timer.unref?.(); },
    // on a real request: traffic reaches this revision, so it is the live one (a stop's wipe list is kept)
    async claim() {
      if (!on || claimed || retired) return; claimed = true;
      try { const m = await read(); if (stale(m)) return retire(m); if (m?.rev === rev) return; if (!m || n > m.n || (m.rev === 'stop' && n === m.n)) await write({ rev, n, at: Date.now(), wipe: m?.wipe || [] }); }
      catch (e) { claimed = false; log.warn('[retire] claim', e.message); }
    }
  };
}
