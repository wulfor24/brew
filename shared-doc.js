// A document several instances hold in memory and change at once (the team's jams): each instance writes only the parts it
// changed since it last synced, and when another instance writes, it takes the parts it hasn't changed itself (Postgres
// parts, objects.js). A part both changed: this instance's change wins when it writes next. Fields are arrays of objects
// with ids (one part per item) or objects (one part per key); anything else is one part.
import crypto from 'node:crypto';
import { splitDoc } from './objects.js';

const SEP = '\u0001';
const md5 = (s) => crypto.createHash('md5').update(Buffer.from(s)).digest('hex');
export function createDocSync({ packs, slug, name, fields, log = console }) {
  if (!packs?.patchParts) return null;
  let base = new Map(); // part → hash at the last sync
  const partsOf = (state) => splitDoc(Object.fromEntries(fields.map((f) => [f, state[f]])), { always: true });
  const hashes = (parts) => new Map(parts.map(([p, b]) => [p, md5(b)]));
  /* after a load: what this instance holds now is what is stored */
  const settle = (state) => { base = hashes(partsOf(state)); };
  async function push(state) {
    const parts = partsOf(state), now = hashes(parts), set = [], del = [];
    parts.forEach(([p, b], ord) => { if (base.get(p) !== now.get(p)) set.push([p, b, ord]); });
    for (const p of base.keys()) if (!now.has(p)) del.push(p);
    if (!set.length && !del.length) return 0;
    await packs.patchParts(slug, name, set, del); base = now; return set.length + del.length;
  }
  /* another instance wrote: take every part this one hasn't changed since its last sync, in place (the arrays and objects
     the workspaces hold stay the same objects) */
  async function pull(state) {
    const rows = await packs.getParts(slug, name); if (!rows) return 0;
    const local = hashes(partsOf(state)), remote = new Map(rows.map((r) => [r.part, r])), was = base, dirty = (p) => local.get(p) !== was.get(p);
    let took = 0;
    for (const f of fields) {
      const v = state[f], pre = `${f}${SEP}`;
      if (Array.isArray(v)) {
        const mine = new Map(v.map((x) => [String(x?.id), x])), next = [], seen = new Set();
        for (const r of rows.filter((x) => x.part.startsWith(`${pre}a${SEP}`))) { const id = r.part.slice(pre.length + 2); seen.add(id);
          if (dirty(r.part) && mine.has(id)) next.push(mine.get(id)); else { next.push(JSON.parse(r.body.toString('utf8'))); if (local.get(r.part) !== md5(r.body.toString('utf8'))) took++; } }
        for (const x of v) { const id = String(x?.id), p = `${pre}a${SEP}${id}`; if (!seen.has(id) && (dirty(p) || !was.has(p))) next.push(x); else if (!seen.has(id)) took++; } /* new here: kept; gone there and unchanged here: gone */
        v.splice(0, v.length, ...next);
      } else if (v && typeof v === 'object') {
        const keys = new Set();
        for (const r of rows.filter((x) => x.part.startsWith(`${pre}o${SEP}`))) { const k = r.part.slice(pre.length + 2); keys.add(k);
          if (!dirty(r.part) && local.get(r.part) !== md5(r.body.toString('utf8'))) { v[k] = JSON.parse(r.body.toString('utf8')); took++; } }
        for (const k of Object.keys(v)) { const p = `${pre}o${SEP}${k}`; if (!keys.has(k) && was.has(p) && !dirty(p)) { delete v[k]; took++; } }
      } else { const r = remote.get(f); if (r && !dirty(f)) state[f] = JSON.parse(r.body.toString('utf8')); }
    }
    base = new Map(rows.map((r) => [r.part, md5(r.body.toString('utf8'))])); /* what is stored now; this instance's own changes stay ahead of it */
    return took;
  }
  return { push, pull, settle };
}
