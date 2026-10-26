// A document several instances hold in memory and change at once (the team's jams): each instance writes only the parts it
// changed since it last synced, and when another instance writes, it takes the parts it hasn't changed itself (Postgres
// parts, objects.js). A part both changed: this instance's change wins when it writes next. Fields are arrays of objects
// with ids (one part per item) or objects (one part per key); anything else is one part.
import crypto from 'node:crypto';
import { splitDoc } from './objects.js';

const SEP = '\u0001';
/* one item both instances changed (a jam two people worked in at once): this instance's fields stand, and every list of items with
   ids, at any depth (the thread, versions, boards and their takes, drafts), takes the items that are new on the other side, in time
   order. was: this instance's copy at its last sync, so an item or field removed here stays removed, never brought back (QV 25 Oct) */
const byId = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => x && typeof x === 'object' && x.id != null);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
/* the stored item put into the object this instance already holds (its keys replaced), so anything holding it sees the new state */
const inPlace = (cur, next) => { if (!isObj(cur) || !isObj(next)) return next; for (const k of Object.keys(cur)) if (!(k in next)) delete cur[k]; return Object.assign(cur, next); };
export function mergeItem(mine, theirs, was = null) {
  if (!isObj(mine) || !isObj(theirs)) return mine;
  for (const [k, tv] of Object.entries(theirs)) {
    const mv = mine[k], wv = isObj(was) ? was[k] : undefined;
    if (byId(tv) && Array.isArray(mv) && (byId(mv) || !mv.length)) {
      const mid = new Map(mv.map((x) => [String(x.id), x])), wid = new Map((Array.isArray(wv) ? wv : []).filter((x) => x && x.id != null).map((x) => [String(x.id), x]));
      let added = false;
      for (const t of tv) { const id = String(t.id), m = mid.get(id);
        if (m) mergeItem(m, t, wid.get(id) || null); /* both have it: its own lists merge too */
        else if (!wid.has(id)) { mv.push(t); added = true; } } /* new over there (removed here: it was in this copy's last sync, so it stays gone) */
      if (added && mv.every((x) => Number.isFinite(+x.at))) mv.sort((a, b) => +a.at - +b.at);
    } else if (mv === undefined) { if (!isObj(was) || !(k in was)) mine[k] = tv; } /* only the other one set it (never a field removed here) */
    else if (isObj(mv) && isObj(tv)) mergeItem(mv, tv, isObj(wv) ? wv : null);
  }
  return mine;
}
const md5 = (s) => crypto.createHash('md5').update(Buffer.from(s)).digest('hex');
export function createDocSync({ packs, slug, name, fields, log = console }) {
  if (!packs?.patchParts) return null;
  let base = new Map(); // part → hash at the last sync
  let wasBody = new Map(); // item part → its body at the last sync (mergeItem's "was")
  const partsOf = (state) => splitDoc(Object.fromEntries(fields.map((f) => [f, state[f]])), { always: true });
  const hashes = (parts) => new Map(parts.map(([p, b]) => [p, md5(b)]));
  /* after a load: what this instance holds now is what is stored */
  const item = (p) => p.includes(`${SEP}a${SEP}`) || p.includes(`${SEP}o${SEP}`); /* one part per item (a list's or a map's): what a merge needs as "was" */
  const keepBodies = (parts) => { wasBody = new Map(parts.filter(([p]) => item(p)).map(([p, b]) => [p, b])); };
  const settle = (state) => { const parts = partsOf(state); base = hashes(parts); keepBodies(parts); };
  async function push(state) {
    const parts = partsOf(state), now = hashes(parts), set = [], del = [];
    parts.forEach(([p, b], ord) => { if (base.get(p) !== now.get(p)) set.push([p, b, ord]); });
    for (const p of base.keys()) if (!now.has(p)) del.push(p);
    if (!set.length && !del.length) return 0;
    await packs.patchParts(slug, name, set, del, { order: parts.map(([p]) => p) }); base = now; keepBodies(parts); return set.length + del.length;
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
          if (dirty(r.part)) { if (mine.has(id)) { const b = r.body.toString('utf8'); next.push(was.get(r.part) !== md5(b) && was.has(r.part) ? mergeItem(mine.get(id), JSON.parse(b), wasBody.has(r.part) ? JSON.parse(wasBody.get(r.part)) : null) : mine.get(id)); } continue; } /* changed or removed here: this instance's version stands, with what the other added (both changed it) */
          /* in place, like a map's items: a request holding this jam across an await (the team brief's AI write) writes into the live one,
             never a copy the pull has let go (26 Oct, QV P1-16: the brief was written again on every open, its last writing lost) */
          const body = r.body.toString('utf8'), it = JSON.parse(body); next.push(mine.has(id) ? inPlace(mine.get(id), it) : it); if (local.get(r.part) !== md5(body)) took++; }
        for (const x of v) { const id = String(x?.id), p = `${pre}a${SEP}${id}`; if (!seen.has(id) && (dirty(p) || !was.has(p))) next.push(x); else if (!seen.has(id)) took++; } /* new here: kept; gone there and unchanged here: gone */
        v.splice(0, v.length, ...next);
      } else if (v && typeof v === 'object') {
        const keys = new Set();
        for (const r of rows.filter((x) => x.part.startsWith(`${pre}o${SEP}`))) { const k = r.part.slice(pre.length + 2); keys.add(k);
          const b = r.body.toString('utf8');
          if (!dirty(r.part)) { if (local.get(r.part) !== md5(b)) { v[k] = inPlace(v[k], JSON.parse(b)); took++; } } /* in place: a job holding this jam keeps the live one */
          else if (was.has(r.part) && was.get(r.part) !== md5(b) && v[k]) { mergeItem(v[k], JSON.parse(b), wasBody.has(r.part) ? JSON.parse(wasBody.get(r.part)) : null); took++; } } /* both changed it: merged */
        for (const k of Object.keys(v)) { const p = `${pre}o${SEP}${k}`; if (!keys.has(k) && was.has(p) && !dirty(p)) { delete v[k]; took++; } }
      } else { const r = remote.get(f); if (r && !dirty(f)) state[f] = JSON.parse(r.body.toString('utf8')); }
    }
    base = new Map(rows.map((r) => [r.part, md5(r.body.toString('utf8'))])); /* what is stored now; this instance's own changes stay ahead of it */
    wasBody = new Map(rows.filter((r) => item(r.part)).map((r) => [r.part, r.body.toString('utf8')]));
    return took;
  }
  return { push, pull, settle };
}
