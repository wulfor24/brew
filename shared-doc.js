// A document several instances hold in memory and change at once (the team's jams): each instance writes only the parts it
// changed since it last synced, and when another instance writes, it takes the parts it hasn't changed itself (Postgres
// parts, objects.js). A part both changed: this instance's change wins when it writes next. Fields are arrays of objects
// with ids (one part per item) or objects (one part per key); anything else is one part.
import crypto from 'node:crypto';
import { splitDoc } from './objects.js';

const SEP = '\u0001';
/* one item both instances changed (a jam two people replied in at once): this instance's fields stand, and every list of items with
   ids (the thread, versions, people, drafts) takes the other's new items too, in time order, so neither reply is lost (QV 25 Oct) */
const byId = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => x && typeof x === 'object' && x.id != null);
export function mergeItem(mine, theirs) {
  if (!mine || !theirs || typeof mine !== 'object' || typeof theirs !== 'object') return mine;
  for (const [k, tv] of Object.entries(theirs)) {
    const mv = mine[k];
    if (byId(tv) && (byId(mv) || (Array.isArray(mv) && !mv.length))) { const have = new Set(mv.map((x) => String(x.id))), add = tv.filter((x) => !have.has(String(x.id)));
      if (add.length) { mv.push(...add); if (mv.every((x) => Number.isFinite(+x.at))) mv.sort((a, b) => +a.at - +b.at); } }
    else if (mv === undefined) mine[k] = tv; /* a field only the other one set */
  }
  return mine;
}
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
    await packs.patchParts(slug, name, set, del, { order: parts.map(([p]) => p) }); base = now; return set.length + del.length;
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
        /* stored whole (an item without an id): taken as a whole when this instance hasn't changed it */
        const whole = remote.get(f), wv = whole ? JSON.parse(whole.body.toString('utf8')) : null;
        if (Array.isArray(wv)) { if (!dirty(f) && local.get(f) !== md5(whole.body.toString('utf8'))) { v.splice(0, v.length, ...wv); took++; } continue; }
        const mine = new Map(v.map((x) => [String(x?.id), x])), next = [], seen = new Set();
        for (const r of rows.filter((x) => x.part.startsWith(`${pre}a${SEP}`))) { const id = r.part.slice(pre.length + 2); seen.add(id);
          if (dirty(r.part)) { if (mine.has(id)) { const b = r.body.toString('utf8'); next.push(was.get(r.part) !== md5(b) && was.has(r.part) ? mergeItem(mine.get(id), JSON.parse(b)) : mine.get(id)); } continue; } /* changed or removed here: this instance's version stands, with what the other added (both changed it) */
          next.push(JSON.parse(r.body.toString('utf8'))); if (local.get(r.part) !== md5(r.body.toString('utf8'))) took++; }
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
