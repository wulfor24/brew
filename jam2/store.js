// Jam v2 (?v=2): its own jams, beside v1's and never mixed with them. A brand's team shares one list
// (brands/<slug>/private/jams-v2.json); a visitor who is not on the team keeps theirs under their workspace id in the same file.
// Each instance holds the list in memory and the store follows within a few seconds, and on SIGTERM (flush). On Postgres several
// instances hold it at once: each writes only the jams it changed and takes the others' (shared-doc.js). Nothing here reads or writes v1's jams.json.
import { createDocSync } from '../shared-doc.js'; // Postgres: each instance writes only the jams it changed, and takes the others'
const FILE = 'private/jams-v2.json';

export function createJam2Store({ packs, log = console, everyMs = 4000, enabled = () => true }) {
  const BR = new Map(); // slug → { jams: { [id]: jam }, loaded, ready, last }
  const box = (slug) => {
    let b = BR.get(slug); if (b) return b;
    b = { slug, jams: {}, loaded: false, last: null };
    /* a read that fails leaves the list unloaded: nothing is written over the file until a read goes through (the next request tries again) */
    const read = packs?.readJSON ? packs.readJSON(slug, FILE) : (packs?.getJSON ? packs.getJSON(slug, FILE, null) : Promise.resolve(null)).then((data) => ({ ok: true, data }));
    b.ready = read.then((r) => {
      if (!r.ok) { b.failed = r.error || 'read failed'; return; }
      if (r.data?.jams) for (const [id, x] of Object.entries(r.data.jams)) if (!b.jams[id]) b.jams[id] = x;
      b.loaded = true; b.failed = null; b.last = JSON.stringify(b.jams);
      b.sync = createDocSync({ packs, slug, name: FILE, fields: ['jams'], log }); b.sync?.settle(b); b.chain = Promise.resolve(); if (b.missed && b.sync) { b.missed = false; pullBox(b); } /* a change heard while this load ran is taken now */
    }).catch((e) => { log.warn?.('[jam2] load', slug, e.message); b.failed = e.message; });
    BR.set(slug, b); return b;
  };
  /* one retry per brand at a time: requests that arrive together share it, so nothing is written into a box nobody saves */
  const load = async (slug) => { let b = box(slug); await b.ready; if (b.loaded) return b;
    b.retry ||= (async () => { BR.delete(slug); const nb = box(slug); await nb.ready; if (nb.loaded) Object.assign(nb.jams, b.jams, nb.jams); else BR.set(slug, nb); return nb; })();
    const nb = await b.retry; if (!nb.loaded) { b.retry = null; throw Object.assign(new Error('Your jams couldn’t be loaded just now. Try again in a moment; nothing was lost.'), { status: 503 }); } return nb; };
  /* saves run one after another, so an older copy can never land after a newer one */
  let chain = Promise.resolve(); const flush = (only) => (chain = chain.then(() => flushNow(only)).catch(() => {}));
  const flushNow = async (only) => {
    for (const b of BR.values()) {
      if (!b.loaded || (only && b.slug !== only)) continue;
      let s; try { s = JSON.stringify(b.jams); } catch (e) { log.warn?.('[jam2] serialise', e.message); continue; }
      if (b.sync) { await (b.chain = b.chain.then(() => b.sync.push(b)).catch((e) => log.warn?.('[jam2] save', b.slug, e.message))); continue; } /* push writes only what changed since the last sync, so it always runs */
      if (s === b.last) continue; b.last = s;
      await (packs.putStrict || packs.put)(b.slug, FILE, { at: Date.now(), jams: b.jams }).catch((e) => { b.last = null; log.warn?.('[jam2] save', b.slug, e.message); }); /* failed: stays dirty, the next flush writes it again */
    }
  };
  const timer = packs?.put && everyMs && enabled() ? setInterval(() => flush().catch(() => {}), packs.patchParts ? Math.min(everyMs, 1500) : everyMs) : null; timer?.unref?.();
  const pullBox = (b) => { b.chain = b.chain.then(() => b.sync.pull(b)).catch((e) => log.warn?.('[jam2] pull', b.slug, e.message)); };
  packs?.onChange?.((slug, name) => { if (slug === '*') { for (const b of BR.values()) if (b.sync) pullBox(b); return; } /* notices missed: catch up */
    const b = BR.get(slug); if (name !== FILE || !b) return; if (b.sync) pullBox(b); else b.missed = true; }); /* still loading: pulled once it has */

  /* the jams a request may see: the team's (owner 'team'), or this workspace's own */
  const ownerOf = (who) => (who?.member || who?.staff ? 'team' : `ws_${who?.tid || 'anon'}`);
  const list = async (slug, who) => { const b = await load(slug), o = ownerOf(who); return Object.values(b.jams).filter((j) => j.owner === o && !j.archived); };
  const get = async (slug, id, who) => { const b = await load(slug), j = b.jams[id]; if (!j) return null; if (who && j.owner !== ownerOf(who) && !(who.staff)) return null; return j; };
  const getAny = async (slug, id) => (await load(slug)).jams[id] || null; /* a signed link (ready-to-post, brief) */
  const put = async (slug, j) => { const b = await load(slug); b.jams[j.id] = j; return j; };
  const byCard = async (slug, cardId, who, cta = null) => (await list(slug, who)).filter((j) => j.cardId === cardId && (!cta || !j.cta || j.cta === cta)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
  return { load, list, get, getAny, put, byCard, flush, ownerOf, stop: () => timer && clearInterval(timer) };
}
