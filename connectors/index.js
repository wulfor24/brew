// DUMMY: connected accounts. Every connector is simulated (connectors/sim.js): connecting is one tap, nothing signs in to a
// real platform and nothing is read from or written to a real account. The numbers, stats and cards come from the brand's
// real read (demo-data.js demoFor), so they look like that brand's own accounts.
// The real build needs, per platform: OAuth (or an API key), a token vault, a proof that the account is the brand's, a
// daily sync and the platform approvals (Meta Marketing API, Shopify app review, Google verification). See DUMMY.md.
// What stays real: who may connect (the brand's team, or the first official email on an unclaimed brand, who claims it),
// and the shape everything downstream reads (live cards, stats, ledger entries for the moves, the connected-facts sheet).
import { createSim, SIM_IDS, NAME } from './sim.js';
import { sk } from '../demo-mode.js';

export const CONNECTORS = Object.fromEntries(SIM_IDS.map((id) => [id, { id, name: NAME[id] }]));
const PUBLIC = new Set(['marketplaces']); // a marketplace read is public data, shown to every viewer

export function createConnectors({ packs, auth, builder, log = console, onLive = () => {} }) {
  const SIM = createSim({ packs, log });
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); };
  const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });

  /* ---------- per-brand state: brands/<slug>/private/connections.json, the read in [private/]live/<id>.json ---------- */
  const CF = 'private/connections.json';
  let lock = Promise.resolve();
  const conns = async (slug) => (await packs.getJSON(slug, CF, {})) || {};
  const editC = (slug, f) => (lock = lock.then(async () => { const c = await conns(slug); await f(c); await packs.put(slug, CF, c); return c; }));
  const liveName = (id) => (PUBLIC.has(id) ? `live/${id}.json` : `private/live/${id}.json`);
  const cache = new Map(); // slug → { at, live: { id: data }, conns }
  async function liveOf(slug, fresh = false) {
    const c = cache.get(sk(slug)); if (c && !fresh && Date.now() - c.at < 60e3) return c;
    const cs = await conns(slug), live = {};
    for (const [id, s] of Object.entries(cs)) if (s?.state === 'live') { const d = await packs.getJSON(slug, liveName(id), null); if (d) live[id] = d; }
    const x = { at: Date.now(), live, conns: cs }; cache.set(sk(slug), x); return x;
  }

  /* ---------- connect (simulated), sync, disconnect ---------- */
  // DUMMY: the account is "in" the moment it is asked for; the real build proves it belongs to the brand first
  async function finish(slug, id, _creds, me) {
    const info = await auth.claimInfo(slug, me);
    let use = !!info.role, claimed = false;
    if (!use && info.eligible) { const r = await auth.claim(slug, me, `Connected ${NAME[id]}`); use = claimed = !!r.ok; }
    if (!use) return { ok: false, state: 'needs_work_email', error: noGen(info, info.host) };
    await editC(slug, (c) => { c[id] = { state: 'syncing', at: Date.now(), by: me.email, account: null, verified: true, sim: true }; });
    cache.delete(sk(slug));
    return { ...(await sync(slug, id)), claimed };
  }
  const noGen = (a, host) => (a.claimed ? 'This brand is claimed. Ask its team to invite you.' : `Connect with your work email at ${host}. The first person from ${host} to connect becomes the brand’s admin.`);
  async function sync(slug, id) {
    await editC(slug, (c) => { c[id] = { ...(c[id] || {}), state: 'syncing', syncAt: Date.now() }; });
    try {
      const d = await SIM.sync(slug, id);
      const data = { at: Date.now(), account: d.account, stats: d.stats, changed: d.changed, cards: d.cards, ledger: d.ledger, notes: d.notes || [], sim: true };
      await packs.put(slug, liveName(id), data);
      await editC(slug, (c) => { c[id] = { ...(c[id] || {}), state: 'live', lastSync: data.at, error: null, account: data.account, notes: data.notes }; });
      cache.delete(sk(slug));
      await builder.liveConnected?.(slug, id, data.ledger, true, { public: PUBLIC.has(id) }).catch((e) => log.warn('[connect] moves', e.message));
      onLive(slug);
      return { ok: true, state: 'live', stats: data.stats, changed: data.changed, cards: data.cards.length, notes: data.notes, account: data.account, dummy: true };
    } catch (e) {
      log.warn('[connect] sync', slug, id, e.message);
      await editC(slug, (c) => { c[id] = { ...(c[id] || {}), state: 'error', error: e.message.slice(0, 200) }; });
      cache.delete(sk(slug));
      return { ok: false, error: e.message.slice(0, 200) };
    }
  }
  async function disconnect(slug, id) {
    await editC(slug, (c) => { delete c[id]; });
    await packs.put(slug, liveName(id), { at: Date.now(), gone: true, stats: [], changed: [], cards: [], ledger: [] });
    cache.delete(sk(slug));
    await builder.liveConnected?.(slug, id, [], false, { public: PUBLIC.has(id) }).catch(() => {});
    onLive(slug); return { ok: true };
  }

  /* ---------- what the page needs ---------- */
  const avail = () => Object.fromEntries(SIM_IDS.map((id) => [id, { demo: true, dummy: true, modes: ['demo'], ready: true, oauth: false, fields: [], picks: false, proof: false }]));
  async function liveView(slug, me) {
    const access = await auth.claimInfo(slug, me), member = !!access.role, L = await liveOf(slug), out = {};
    for (const [id, s] of Object.entries(L.conns)) {
      if (!member && !PUBLIC.has(id)) continue;
      const d = L.live[id];
      out[id] = { state: s.state, at: s.at, lastSync: s.lastSync || null, by: member ? s.by : undefined, account: s.account?.name || null, error: s.error || null, notes: s.notes || [], dummy: true,
        ...(d && !d.gone ? { stats: d.stats, changed: d.changed, cards: d.cards.length } : {}) };
    }
    return { me, signin: auth.signinOn(), access, full: auth.isAdmin(me), conns: out, avail: avail(), dummy: true };
  }
  // for feed-service: the connector cards and connected ids a viewer of this brand gets (team only, except marketplaces)
  async function forViewer(slug, member) {
    const L = await liveOf(slug), cards = [], on = {};
    for (const [id, d] of Object.entries(L.live)) { if (d.gone) continue; if (!member && !PUBLIC.has(id)) continue; on[id] = true; cards.push(...(d.cards || []).map((c) => ({ ...c, dummy: true, ...(PUBLIC.has(id) ? { liveOnly: false, publicLive: true } : {}) }))); }
    const ledger = {}; if (member) for (const d of Object.values(L.live)) if (!d.gone) for (const e of d.ledger || []) ledger[e.key] = { v: e.v, n: e.n, at: d.at, label: e.label };
    return { cards, on, privMoves: [], ledger };
  }

  /* ---------- routes ---------- */
  async function handle(req, res, u) {
    const p = u.pathname;
    // the connect button's link: connects the simulated account and returns to the Connectors view
    const sm = p.match(/^\/connect\/([a-z]+)\/start$/);
    if (sm && req.method === 'GET') {
      const id = sm[1], slug = String(u.searchParams.get('brand') || '').replace(/[^a-z0-9-]/g, ''), me = auth.user(req);
      if (!CONNECTORS[id]) return json(res, 404, { error: 'unknown connector' }), true;
      if (!me) return redirect(res, `/auth/google?next=${encodeURIComponent(`/${slug}#v=connectors&cx=${id}`)}`), true;
      const r = await finish(slug, id, null, me);
      return redirect(res, `/${slug}#v=connectors&cx=${id}&${r.ok ? 'done=1' : `cxerr=${encodeURIComponent(r.error || 'Could not connect')}`}`), true;
    }
    const lm = p.match(/^\/api\/brands\/([a-z0-9-]+)\/live$/);
    if (lm && req.method === 'GET') return json(res, 200, await liveView(lm[1], auth.user(req))), true;
    const cm = p.match(/^\/api\/brands\/([a-z0-9-]+)\/connect\/([a-z]+)$/);
    if (cm && req.method === 'POST') {
      const [, slug, id] = cm, me = auth.user(req);
      if (!CONNECTORS[id]) return json(res, 404, { error: 'unknown connector' }), true;
      if (!me) return json(res, 401, { error: 'Sign in with Google first.', signin: true }), true;
      const access = await auth.claimInfo(slug, me); if (!access.host) return json(res, 404, { error: 'unknown brand' }), true;
      if (!access.gen) return json(res, 403, { error: noGen(access, access.host), demo: true, host: access.host }), true;
      const b = await body(req), member = !!access.role;
      if (['demo', 'key', 'select', 'connect'].includes(b.action)) return json(res, 200, await finish(slug, id, null, me)), true;
      if (b.action === 'sync') { if (!member && !PUBLIC.has(id)) return json(res, 403, { error: 'Only the brand’s team can sync it.' }), true; return json(res, 200, await sync(slug, id)), true; }
      if (b.action === 'disconnect') { if (!member) return json(res, 403, { error: 'Only the brand’s team can disconnect it.' }), true; return json(res, 200, await disconnect(slug, id)), true; }
      return json(res, 400, { error: 'unknown action' }), true;
    }
    return false;
  }

  return { handle, sim: SIM, liveOf, forViewer, drop: (slug) => cache.delete(sk(slug)), liveView, sync, disconnect, finish, CONNECTORS };
}
