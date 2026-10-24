// Team jams: a brand's jams belong to the brand's team, not to one browser's workspace.
// Every team member's workspace sees the same jams: t.work and t.changes are getters that, for a member (or a guest of a jam),
// read the brand's shared list (brands/<slug>/private/jams.json). A visitor who is not on the team keeps their own jams in
// their workspace (t.ownWork / t.ownChanges), as before. When someone joins the team, their own jams move into the team's.
// The demo site keeps per-visitor jams (every visitor is a sandbox of their own).
// Each instance holds the list in memory and the store follows it. On Postgres several instances hold it at once: each writes
// only the parts it changed (one per jam, change and version list) and takes the others' parts when they write (shared-doc.js).
// The versions of the team's changes and jams (vg) live here too, beside the changes (learn.js vgOf reads t.teamVg), so a
// teammate's studio shows the same versions and head as yours.
import { mergeVersions } from './learn.js';
import { createDocSync } from './shared-doc.js'; // Postgres: each instance writes only the jams it changed, and takes the others'
import { createPresence } from './presence.js'; // who has a jam open, across instances
const FILE = 'private/jams.json';
const OPEN = (w) => !w.archived && !w.discarded && !['out', 'measuring', 'result'].includes(w.stage); // the same as feed-service workFor: a shared brief reopens its jam
const lc = (e) => (e ? String(e).toLowerCase() : null);

/* Needs you is personal: the newest line where a teammate tagged you, unless you have written in the jam since.
   The jam's stage stays shared; the Work board reads this per viewer. `more` is the studio chat (the change's thread),
   where a reply usually lands, so a reply there answers the tag too */
export const askOf = (w, email, more = []) => { const me = lc(email); if (!me) return null;
  const lines = [...(w.thread || []), ...(more || [])].filter(Boolean).map((m, i) => ({ m, i, at: +m.at || 0 })).sort((a, b) => a.at - b.at || a.i - b.i);
  for (let k = lines.length - 1; k >= 0; k--) { const m = lines[k].m, by = lc(m.by?.email); if (by === me) return null;
    if (m.from !== 'system' && by && (m.to || []).some((x) => lc(x) === me)) return { id: m.id, who: m.by.name || by.replace(/@.*/, ''), email: by, pic: m.by.pic || null, body: String(m.body || m.text || '').slice(0, 300), at: m.at }; }
  return null; };

/* does this jam wait on this person? A tag they have not answered, or an OK asked of them. An OK asked of someone else
   waits on them, not on whoever asked (they see it With teammate) */
export const waitsOn = (w, email, more = []) => { if (askOf(w, email, more)) return true; if (w.stage !== 'needs_you') return false;
  const to = lc(w.assignee?.email); return !to || !lc(email) || to === lc(email); };

export function createJams({ packs, reqOf, bgMember, log = console, enabled = () => process.env.DEMO_MODE !== '1', everyMs = 4000 }) {
  const BR = new Map(); // slug → { work, changes, ready, last }
  const box = (slug) => {
    let b = BR.get(slug); if (b) return b;
    b = { slug, work: [], changes: {}, vg: {}, last: null, loaded: false };
    /* a read that fails (bucket down, broken file) never counts as "no jams": the brand stays unloaded, so the flush can't write an
       empty list over the saved one; the next load tries again */
    const read = packs?.readJSON ? packs.readJSON(slug, FILE).then((r) => { if (!r.ok) throw new Error(r.error || 'read failed'); return r.data; }) : (packs?.getJSON ? packs.getJSON(slug, FILE, null) : Promise.resolve(null));
    b.ready = read.then((j) => {
      if (j) { const have = new Set(b.work.map((w) => w.id)); b.work.push(...(j.work || []).filter((w) => !have.has(w.id))); b.changes = { ...(j.changes || {}), ...b.changes };
        for (const [id, list] of Object.entries(j.vg || {})) b.vg[id] = b.vg[id] ? mergeVersions(list, b.vg[id]) : list; }
      b.loaded = true; b.last = JSON.stringify({ work: b.work, changes: b.changes, vg: b.vg });
      b.sync = createDocSync({ packs, slug, name: FILE, fields: ['work', 'changes', 'vg'], log }); b.sync?.settle(b); b.chain = Promise.resolve();
    }).catch((e) => { log.warn?.('[jams] load', slug, e.message); b.failed = true; });
    BR.set(slug, b); return b;
  };
  const load = async (slug) => { let b = box(slug); await b.ready; if (b.failed && !b.loaded) { BR.delete(slug); const kept = b; b = box(slug); await b.ready;
    if (b.loaded) { const have = new Set(b.work.map((w) => w.id)); b.work.push(...kept.work.filter((w) => !have.has(w.id))); b.changes = { ...kept.changes, ...b.changes }; } else BR.set(slug, b); } return b; };
  /* any change to a brand's jams, from a request or a background timer, is written within a few seconds */
  const flush = async (only) => {
    for (const b of BR.values()) {
      if (!b.loaded || (only && b.slug !== only)) continue;
      let s; try { s = JSON.stringify({ work: b.work, changes: b.changes, vg: b.vg }); } catch (e) { log.warn?.('[jams] serialise', e.message); continue; }
      if (s === b.last) continue; b.last = s;
      if (b.sync) { await (b.chain = b.chain.then(() => b.sync.push(b)).catch((e) => { b.last = null; log.warn?.('[jams] save', b.slug, e.message); })); continue; }
      await (packs.putStrict || packs.put)(b.slug, FILE, { at: Date.now(), work: b.work, changes: b.changes, vg: b.vg }).catch((e) => { b.last = null; log.warn?.('[jams] save', b.slug, e.message); });
    }
  };
  const timer = packs?.put && everyMs ? setInterval(() => flush().catch(() => {}), packs.patchParts ? Math.min(everyMs, 1500) : everyMs) : null; timer?.unref?.();
  /* another instance wrote the team's jams: this one takes what it hasn't changed itself, in place */
  packs?.onChange?.((slug, name) => { const b = BR.get(slug); if (name !== FILE || !b?.sync) return;
    b.chain = b.chain.then(async () => { const n = await b.sync.pull(b); if (n) b.last = JSON.stringify({ work: b.work, changes: b.changes, vg: b.vg }); }).catch((e) => log.warn?.('[jams] pull', slug, e.message)); });

  const slugOf = (t) => t.brandId || null;
  /* does this workspace read the team's jams right now: the request's viewer is on the team or a guest of one of its jams,
     or (no request: the background clock) the workspace's last team member is still on the team */
  const shared = (t) => {
    if (!enabled() || !slugOf(t)) return false;
    const r = reqOf?.(t); if (r) return !!(r.member || r.guest);
    return !!bgMember?.(t);
  };
  const guard = (t) => {
    if (!t || typeof t !== 'object' || Object.getOwnPropertyDescriptor(t, 'work')?.get) return t;
    const w0 = Array.isArray(t.work) ? t.work : [], c0 = t.changes && typeof t.changes === 'object' ? t.changes : {};
    delete t.work; delete t.changes;
    if (!Array.isArray(t.ownWork)) t.ownWork = w0; else if (w0.length) t.ownWork.push(...w0.filter((w) => !t.ownWork.some((x) => x.id === w.id)));
    if (!t.ownChanges || typeof t.ownChanges !== 'object') t.ownChanges = c0; else Object.assign(t.ownChanges, c0);
    Object.defineProperty(t, 'work', { configurable: true, enumerable: false, get() { return shared(t) ? box(slugOf(t)).work : t.ownWork; }, set(v) { if (!Array.isArray(v)) return; if (shared(t)) { const b = box(slugOf(t)); b.work.splice(0, b.work.length, ...v); } else t.ownWork = v; } });
    Object.defineProperty(t, 'changes', { configurable: true, enumerable: false, get() { return shared(t) ? box(slugOf(t)).changes : t.ownChanges; }, set(v) { if (!v || typeof v !== 'object') return; if (shared(t)) box(slugOf(t)).changes = v; else t.ownChanges = v; } });
    /* the team's version history (learn.js vgOf): null for a visitor, whose versions stay in their workspace (t.vg) */
    Object.defineProperty(t, 'teamVg', { configurable: true, enumerable: false, get() { return shared(t) ? box(slugOf(t)).vg : null; } });
    return t;
  };

  /* a person on a jam: who started it, was tagged, asked, assigned, replied, joined or came in as a guest */
  const person = (u) => (u?.email ? { email: lc(u.email), name: u.name || null, pic: u.pic || null, ...(u.staff ? { staff: true } : {}) } : null);
  const join = (w, u, how) => {
    const p = person(u); if (!p) return null; w.people ||= [];
    let x = w.people.find((y) => y.email === p.email);
    if (!x) { x = { ...p, how, at: Date.now(), ...(how === 'guest' ? { guest: true } : {}) }; w.people.push(x); }
    else { if (p.name) x.name = p.name; if (p.pic) x.pic = p.pic; if (how === 'guest') x.guest = true; if (how === 'started') x.how = how; } /* a guest who replies is still a guest */
    return x;
  };
  const isIn = (w, email) => !!email && (w.people || []).some((p) => p.email === lc(email));
  const guestWids = (slug, email) => { const e = lc(email); if (!e || !enabled()) return []; return (box(slug).work || []).filter((w) => (w.people || []).some((p) => p.email === e && (p.guest || p.how === 'guest'))).map((w) => w.id); };

  /* fold one jam into another (the same card jammed in two places): messages by time, versions after, people together */
  const fold = (keep, w) => {
    const seen = new Set((keep.thread || []).map((m) => m.id));
    keep.thread = [...(keep.thread || []), ...(w.thread || []).filter((m) => !seen.has(m.id))].sort((a, b) => (a.at || 0) - (b.at || 0));
    const base = (keep.versions || []).length;
    for (const v of (w.versions || []).slice(1)) keep.versions.push({ ...v, n: keep.versions.length + 1, note: v.note || `From a second jam (v${v.n})` });
    if ((keep.versions || []).length > base) keep.thread.push({ id: `m_fold_${w.id}`, at: Date.now(), from: 'system', body: `Two jams on this card were joined: v${base + 1}${keep.versions.length > base + 1 ? `–v${keep.versions.length}` : ''} came from the other one.` });
    for (const p of w.people || []) if (!isIn(keep, p.email)) (keep.people ||= []).push(p);
    keep.drafts = [...(keep.drafts || []), ...(w.drafts || []).filter((d) => !(keep.drafts || []).some((x) => x.id === d.id))];
    if (!keep.doc && w.doc) keep.doc = w.doc;
    keep.updatedAt = Math.max(keep.updatedAt || 0, w.updatedAt || 0);
  };
  const weight = (w) => (w.thread || []).length * 10 + (w.doc?.rev || 0) + (w.stage === 'drafting' ? 0 : 100) + (w.versions || []).length;
  /* a member's own jams join the team's (once): a jam on a card the team already jams on folds into that one */
  const adopt = (t, u) => {
    if (!shared(t) || !t.ownWork?.length) return 0;
    const b = box(slugOf(t)); let n = 0;
    for (const w of t.ownWork.splice(0)) {
      if (b.work.some((x) => x.id === w.id)) continue;
      if (!w.people?.length && (u || t.teamEmail)) join(w, u?.email ? u : { email: t.teamEmail }, 'started');
      const same = OPEN(w) && w.cardId ? b.work.find((x) => x.cardId === w.cardId && OPEN(x)) : null;
      if (same) { const [keep, other] = weight(same) >= weight(w) ? [same, w] : [w, same]; fold(keep, other); if (keep === w) { b.work.splice(b.work.indexOf(same), 1, w); } }
      else b.work.unshift(w);
      n++;
    }
    for (const [id, ch] of Object.entries(t.ownChanges || {})) { if (!b.changes[id]) b.changes[id] = ch; if (t.vg?.[id]?.length) { b.vg[id] = mergeVersions(b.vg[id], t.vg[id]); delete t.vg[id]; } } /* their versions come with them */
    t.ownChanges = {};
    if (n) log.log?.(`[jams] ${slugOf(t)}: ${n} jam(s) from ${t.id} joined the team's`);
    return n;
  };
  /* the card a jam was opened on: a teammate's workspace may not have it (an idea or story card made in another workspace) */
  const hydrate = (t) => { if (!shared(t) || !t.cards?.set) return; for (const w of t.work) if (w.cardId && w.cardSnap && !t.cards.has(w.cardId)) t.cards.set(w.cardId, JSON.parse(JSON.stringify(w.cardSnap))); };
  /* the one open jam on a card, the brand's team over (never a second one) */
  const openFor = (t, cardId) => t.work.find((w) => w.cardId === cardId && OPEN(w));

  /* presence: who has a jam open right now (the open jam's poll is the heartbeat) */
  const P = createPresence({ log });
  const beat = (wid, u, typing = false) => { const p = person(u); if (!p || !wid) return; P.beat(wid, p, typing); };
  const here = (wid, ms = 30e3) => P.here(wid, ms);
  const watching = (wid, email, ms = 120e3) => P.watching(wid, lc(email), ms);

  return { load, flush, guard, shared, join, isIn, guestWids, adopt, hydrate, openFor, fold, beat, here, watching, peek: (slug) => BR.get(slug) || null, OPEN, stop: () => timer && clearInterval(timer) };
}
