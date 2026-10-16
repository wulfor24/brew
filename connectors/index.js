// Connected accounts. On the live site they are real: connect (OAuth or a pasted key), check the account looks like the
// brand's, read it, and turn what came back into the stats, cards and evidence the feed and the moves already use.
// Everything an account returns is private to the brand's team: brands/<slug>/private/ (tokens encrypted in the vault, the
// read in live/<id>.json, the state in connections.json). The marketplace read is public data and is shown to all.
// DUMMY: the demo site (DEMO_MODE=1) simulates every account (connectors/sim.js, built from the brand's real read), and
// Slack is simulated everywhere (Brew sending was cut, SCOPE.md). Those rows are marked demo and are never evidence.
// Connecting is also the easiest way to claim a brand: the first work email at its domain to connect becomes its admin.
import crypto from 'node:crypto';
import shopify from './shopify.js';
import meta from './meta.js';
import google, { ga4 } from './google.js';
import klaviyo from './klaviyo.js';
import reviews from './reviews.js';
import market from './market.js';
import { createSim, SIM_IDS, NAME } from './sim.js';
import { createVault } from '../vault.js';
import { DEMO, sk } from '../demo-mode.js';
import { privId, realRows } from './common.js';

const REAL = { shopify, meta, ga4, google, klaviyo, reviews, marketplaces: market };
export const CONNECTORS = Object.fromEntries(SIM_IDS.map((id) => [id, { id, name: NAME[id] }]));
const PUBLIC = new Set(['marketplaces']); // a marketplace read is public data, shown to every viewer
// Marketplaces is switched off for now (2026-10-16): no connect, no daily read, and an earlier connection is ignored. The page shows
// the marketplaces as Coming soon (DUMMY.md row 7). Take it out of OFF to bring the connector back.
const OFF = new Set(['marketplaces']);
/* How often each live account re-reads on its own (the hourly tick below). Reads are free API calls, so the fast-moving
   accounts go every 6 hours; a connector can set its own `every` (hours) and a new one without it gets 12 hours. A failed
   read tries again after 3 hours, not every hour. */
const EVERY_H = { shopify: 6, meta: 6, google: 6, ga4: 12, klaviyo: 12, reviews: 12, marketplaces: 24 /* paid treg read */ };
const DEFAULT_H = 12, RETRY_H = 3;
export const everyOf = (id) => (REAL[id]?.every || EVERY_H[id] || DEFAULT_H) * 3600e3;
export const due = (id, s, now = Date.now()) => now - (s?.lastSync || 0) >= everyOf(id) - 5 * 60e3 /* an hourly tick may land a few minutes early */
  && !(s?.error && s?.errorAt && now - s.errorAt < RETRY_H * 3600e3);
// DUMMY: simulated on the demo site, and Slack (no real connector) everywhere
export const simOnly = (id) => DEMO || !REAL[id];

export function createConnectors({ packs, auth, builder, treg = null, log = console, onLive = () => {} }) {
  const SIM = createSim({ packs, log }), vault = createVault(packs), deps = { treg };
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); };
  const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
  const base = (req) => process.env.PUBLIC_URL || auth.baseOf(req);
  const cbUrl = (req, id) => `${base(req)}/connect/${id}/callback`;

  /* ---------- per-brand state: brands/<slug>/private/connections.json, the read in [private/]live/<id>.json ---------- */
  const CF = 'private/connections.json';
  let lock = Promise.resolve();
  const conns = async (slug) => (await packs.getJSON(slug, CF, {})) || {};
  const editC = (slug, f) => (lock = lock.then(async () => { const c = await conns(slug); await f(c); await packs.put(slug, CF, c); return c; }));
  const liveName = (id) => (PUBLIC.has(id) ? `live/${id}.json` : `private/live/${id}.json`);
  const cache = new Map(); // slug → { at, live: { id: data }, conns }
  /* Google Analytics became its own connector (2026-10-16): a "google" account that only reads GA4 moves to "ga4", once */
  async function splitGoogle(slug) {
    if (DEMO) return; const cs = await conns(slug); if (!cs.google || cs.ga4) return;
    const cr = await vault.load(slug, 'google'); if (!cr || cr.customer || !cr.property) return;
    await vault.save(slug, 'ga4', cr); await vault.drop(slug, 'google');
    const d = await packs.getJSON(slug, liveName('google'), null);
    if (d) { await packs.put(slug, liveName('ga4'), { ...d, cards: (d.cards || []).map((x) => ({ ...x, id: String(x.id).replace(/^live-google-/, 'live-ga4-'), onlyWhen: 'ga4', src: 'Google Analytics · live' })) });
      await packs.put(slug, liveName('google'), { at: Date.now(), gone: true, stats: [], changed: [], cards: [], ledger: [] }); }
    await editC(slug, (c) => { if (c.google && !c.ga4) { c.ga4 = c.google; delete c.google; } });
    log.log?.(`[connect] ${slug}: Google Analytics moved to its own connector`);
  }
  async function liveOf(slug, fresh = false) {
    const c = cache.get(sk(slug)); if (c && !fresh && Date.now() - c.at < 60e3) return c;
    await splitGoogle(slug).catch((e) => log.warn('[connect] split google', slug, e.message));
    const cs = {}, live = {};
    /* a simulated account saved before the real connectors came back (2026-10-16) counts as not connected on the live site */
    for (const [id, s] of Object.entries(await conns(slug))) if (!OFF.has(id) && !(s?.sim && !simOnly(id))) cs[id] = s;
    for (const [id, s] of Object.entries(cs)) if (s?.state === 'live') { const d = await packs.getJSON(slug, liveName(id), null); if (d && !(d.sim && !simOnly(id))) live[id] = d; }
    const x = { at: Date.now(), live, conns: cs }; cache.set(sk(slug), x); return x;
  }
  // the brand, as the real connectors need it: its site, the Shopify store and Facebook page the read found, its first lane
  async function ctxOf(slug) {
    const profile = (await packs.getJSON(slug, 'profile.json', {})) || {}, ledger = (await packs.getJSON(slug, 'ledger.json', [])) || [], seed = (await packs.getJSON(slug, 'seed.json', {})) || {};
    const plat = (Array.isArray(ledger) ? ledger : []).find((e) => e.key === 'site.platform'), shop = (String(plat?.note || '').match(/([a-z0-9-]+\.myshopify\.com)/) || [])[1] || null;
    return { slug, host: profile.host || (await packs.getJSON(slug, 'status.json', {}))?.host, profile, shopifyShop: shop, pageId: profile.ads?.own?.pageId || null, lane: Object.keys(seed.lanes || { core: 1 })[0] };
  }

  /* ---------- connect, check, read ---------- */
  // who may connect: the brand's team, or the first official email on an unclaimed brand, who claims it by connecting
  async function mayUse(slug, id, me) {
    const info = await auth.claimInfo(slug, me);
    if (info.role) return { ok: true, claimed: false };
    if (info.eligible) { const r = await auth.claim(slug, me, `Connected ${NAME[id]}`); if (r.ok) return { ok: true, claimed: true }; }
    return { ok: false, info };
  }
  async function finish(slug, id, creds, me) {
    const may = await mayUse(slug, id, me);
    /* nothing is kept for someone who may not use it: no token in the vault, no change to the brand's connections */
    if (!may.ok) return { ok: false, state: 'needs_work_email', error: noGen(may.info, may.info.host) };
    if (simOnly(id)) {
      await editC(slug, (c) => { c[id] = { state: 'syncing', at: Date.now(), by: me.email, account: null, verified: true, sim: true }; });
      cache.delete(sk(slug));
      return { ...(await sync(slug, id)), claimed: may.claimed };
    }
    const C = REAL[id], ctx = await ctxOf(slug);
    let proof = { ok: false, why: '' };
    try { proof = C.owns ? await C.owns(creds, ctx) : { ok: true }; } catch (e) { proof = { ok: false, why: e.message.slice(0, 160) }; }
    /* proof is a sanity check, shown to the team, never ownership: ownership is the team (or the claim) above */
    if (!PUBLIC.has(id)) await vault.save(slug, id, creds);
    await editC(slug, (c) => { c[id] = { state: 'syncing', at: Date.now(), by: me.email, account: proof.account || c[id]?.account || null, verified: !!proof.ok, why: proof.why || '' }; });
    cache.delete(sk(slug));
    return { ...(await sync(slug, id)), claimed: may.claimed, verified: !!proof.ok, why: proof.ok ? null : proof.why || null };
  }
  const noGen = (a, host) => (a.claimed ? 'This brand is claimed. Ask its team to invite you.' : `Connect with your work email at ${host}. The first person from ${host} to connect becomes the brand’s admin.`);
  /* an OAuth sign-in waiting for its account to be picked: one per person (the key carries their email), 30 minutes */
  const PENDING_MS = 30 * 60e3;
  const pendKey = (id, email) => `${id}-pending-${crypto.createHash('sha256').update(String(email || '').toLowerCase()).digest('hex').slice(0, 20)}`;
  const savePending = (slug, id, email, creds) => vault.save(slug, pendKey(id, email), { creds, email: String(email).toLowerCase(), at: Date.now() });
  const loadPending = async (slug, id, email) => { const x = await vault.load(slug, pendKey(id, email)); return x?.creds && x.email === String(email).toLowerCase() && Date.now() - (+x.at || 0) < PENDING_MS ? x.creds : null; };

  async function read(slug, id) {
    if (simOnly(id)) return { ...(await SIM.sync(slug, id)), sim: true };
    const C = REAL[id]; let creds = PUBLIC.has(id) ? {} : await vault.load(slug, id);
    if (!creds) throw new Error('Not connected: connect it again.');
    if (C.fresh) { const f = await C.fresh(creds); if (f !== creds) { creds = f; await vault.save(slug, id, creds); } }
    const ctx = await ctxOf(slug);
    /* an account not yet matched to the brand is checked again on each read: the brand may have fixed its links since */
    if (C.owns && (await conns(slug))[id]?.verified === false) { const p = await C.owns(creds, ctx).catch(() => null);
      if (p) await editC(slug, (c) => { if (c[id]) c[id] = { ...c[id], verified: !!p.ok, why: p.why || '' }; }); }
    return C.sync(creds, ctx, deps);
  }
  async function sync(slug, id) {
    await editC(slug, (c) => { c[id] = { ...(c[id] || {}), state: 'syncing', syncAt: Date.now() }; });
    try {
      const d = await read(slug, id);
      const data = { at: Date.now(), account: d.account || (await conns(slug))[id]?.account || null, stats: d.stats || [], changed: d.changed || [], cards: d.cards || [], ledger: d.ledger || [], notes: d.notes || [], ...(d.sim ? { sim: true } : {}) };
      await packs.put(slug, liveName(id), data);
      await editC(slug, (c) => { c[id] = { ...(c[id] || {}), state: 'live', lastSync: data.at, error: null, account: data.account || c[id]?.account, notes: data.notes }; });
      cache.delete(sk(slug));
      await builder.liveConnected?.(slug, id, data.ledger, true, { public: PUBLIC.has(id) }).catch((e) => log.warn('[connect] moves', e.message));
      onLive(slug);
      log.log?.(`[connect] ${slug} ${id}: ${data.cards.length} cards, ${data.ledger.length} facts${d.sim ? ' (simulated)' : ''}`);
      return { ok: true, state: 'live', stats: data.stats, changed: data.changed, cards: data.cards.length, notes: data.notes, account: data.account, dummy: simOnly(id) };
    } catch (e) {
      log.warn('[connect] sync', slug, id, e.message);
      /* an account that read before keeps its last read and says what went wrong; a new one shows the error */
      await editC(slug, (c) => { c[id] = { ...(c[id] || {}), state: c[id]?.lastSync ? 'live' : 'error', error: e.message.slice(0, 200), errorAt: Date.now() }; });
      cache.delete(sk(slug));
      return { ok: false, error: e.message.slice(0, 200) };
    }
  }
  async function disconnect(slug, id) {
    if (!simOnly(id) && !PUBLIC.has(id)) await vault.drop(slug, id);
    await editC(slug, (c) => { delete c[id]; });
    await packs.put(slug, liveName(id), { at: Date.now(), gone: true, stats: [], changed: [], cards: [], ledger: [] });
    cache.delete(sk(slug));
    await builder.liveConnected?.(slug, id, [], false, { public: PUBLIC.has(id) }).catch(() => {});
    onLive(slug); return { ok: true };
  }

  /* ---------- what the page needs ---------- */
  const SIM_AVAIL = { demo: true, dummy: true, modes: ['demo'], ready: true, oauth: false, fields: [], picks: false, proof: false };
  const avail = () => Object.fromEntries(SIM_IDS.filter((id) => !OFF.has(id)).map((id) => {
    if (simOnly(id)) return [id, SIM_AVAIL];
    const C = REAL[id];
    return [id, { modes: C.modes, ready: !!C.ready(deps), oauth: C.modes.includes('oauth') && !!C.ready(deps) && (C.oauthOn ? !!C.oauthOn() : true), picks: !!C.picks, proof: C.proof !== false, every: everyOf(id) / 3600e3, help: C.help?.() || null, email: C.helpEmail?.() || null,
      fields: (C.keyFields || []).map(({ k, label, hint, secret, optional }) => ({ k, label, hint, secret: !!secret, optional: !!optional })) }];
  }));
  async function liveView(slug, me) {
    const access = await auth.claimInfo(slug, me), member = !!access.role, L = await liveOf(slug), out = {};
    for (const [id, s] of Object.entries(L.conns)) {
      if (!member && !PUBLIC.has(id)) continue;
      const d = L.live[id];
      out[id] = { state: s.state, at: s.at, lastSync: s.lastSync || null, by: member ? s.by : undefined, account: s.account?.name || null, error: s.error || null, why: member && !s.verified ? s.why || null : null, notes: s.notes || [], dummy: simOnly(id) || !!d?.sim,
        ...(d && !d.gone ? { stats: d.stats, changed: d.changed, cards: (d.cards || []).length } : {}) };
    }
    const ctx = await ctxOf(slug);
    return { me, signin: auth.signinOn(), access, full: auth.isAdmin(me), conns: out, avail: avail(), shop: member ? ctx.shopifyShop : null, dummy: DEMO };
  }
  // for feed-service: the connector cards and connected ids a viewer of this brand gets (team only, except marketplaces)
  async function forViewer(slug, member) {
    const L = await liveOf(slug), cards = [], on = {};
    for (const [id, d] of Object.entries(L.live)) { if (d.gone) continue; if (!member && !PUBLIC.has(id)) continue; on[id] = true;
      cards.push(...(d.cards || []).map((c) => ({ ...c, ...(simOnly(id) || d.sim ? { dummy: true } : {}), ...(PUBLIC.has(id) ? { liveOnly: false, publicLive: true } : {}) }))); }
    /* DUMMY: a simulated account's rows never reach the team's numbers (they lose their demo flag once copied, so they stay out here) */
    const ledger = {}; if (member) for (const [id, d] of Object.entries(L.live)) if (!d.gone && !d.sim && !simOnly(id)) for (const e of realRows(d.ledger)) ledger[e.key] = { v: e.v, n: e.n, at: d.at, label: e.label };
    /* the moves rewritten from the team's accounts (private/cards.json): members get those cards, and the shared cards of the
       same moves step aside (privMoves). Cards saved before they had their own id get it here */
    let privMoves = [];
    if (member) { const pc = await packs.getJSON(slug, 'private/cards.json', []).catch(() => []);
      for (const c of Array.isArray(pc) ? pc : []) if (c?.id && c.privateOf != null) cards.push({ ...c, id: privId(c.id), liveOnly: true });
      privMoves = [...new Set(cards.filter((c) => c.privateOf != null).map((c) => +c.privateOf))]; }
    return { cards, on, privMoves, ledger };
  }

  /* ---------- routes ---------- */
  const ADMIN_ONLY = 'Only the brand’s admins connect or disconnect accounts. You can sync the ones that are connected.';
  const canConnect = (access) => !access.role || access.role === 'owner' || access.role === 'admin';
  const slugOf = (x) => String(x || '').replace(/[^a-z0-9-]/g, '');
  async function handle(req, res, u) {
    const p = u.pathname;
    const sm = p.match(/^\/connect\/([a-z0-9]+)\/(start|callback)$/);
    if (sm && req.method === 'GET') {
      const [, id, step] = sm, me = auth.user(req);
      if (!CONNECTORS[id] || OFF.has(id)) return json(res, 404, { error: 'unknown connector' }), true;
      if (step === 'start') {
        const slug = slugOf(u.searchParams.get('brand'));
        if (!me) return redirect(res, `/auth/google?next=${encodeURIComponent(`/${slug}#v=connectors&cx=${id}`)}`), true;
        if (simOnly(id)) { const r = await finish(slug, id, null, me); return redirect(res, `/${slug}#v=connectors&cx=${id}&${r.ok ? 'done=1' : `cxerr=${encodeURIComponent(r.error || 'Could not connect')}`}`), true; }
        const C = REAL[id]; if (!C.modes.includes('oauth')) return json(res, 404, { error: 'This one connects with a key.' }), true;
        const access = await auth.claimInfo(slug, me); if (!access.host) return json(res, 404, { error: 'unknown brand' }), true;
        if (!access.gen) return redirect(res, `/${slug}#v=connectors&cxerr=${encodeURIComponent(noGen(access, access.host))}`), true;
        if (!canConnect(access)) return redirect(res, `/${slug}#v=connectors&cxerr=${encodeURIComponent(ADMIN_ONLY)}`), true;
        if (!C.ready(deps) || (C.oauthOn && !C.oauthOn())) return redirect(res, `/${slug}#v=connectors&cx=${id}&cxerr=${encodeURIComponent(`Signing in to ${C.name} is not switched on yet. Use the key option instead.`)}`), true;
        const state = auth.sign({ slug, id, email: me.email, n: crypto.randomBytes(9).toString('base64url') }, 900, 'connect');
        try { return redirect(res, C.authorize({ state, redirect: cbUrl(req, id), shop: u.searchParams.get('shop') || (await ctxOf(slug)).shopifyShop })), true; }
        catch (e) { return redirect(res, `/${slug}#v=connectors&cx=${id}&cxerr=${encodeURIComponent(e.message)}`), true; }
      }
      if (simOnly(id)) return json(res, 404, { error: 'unknown connector' }), true;
      const C = REAL[id], st = auth.verify(u.searchParams.get('state'), 'connect');
      if (!st || !me || st.email !== me.email || st.id !== id) return redirect(res, '/?signin=failed'), true;
      const back = (q) => redirect(res, `/${st.slug}#v=connectors&cx=${id}&${q}`);
      /* the brand may have been claimed since this sign-in started: only its team goes on */
      const access = await auth.claimInfo(st.slug, me); if (!access.gen) return back(`cxerr=${encodeURIComponent(noGen(access, access.host))}`), true;
      try {
        const creds = await C.exchange({ query: u.searchParams, redirect: cbUrl(req, id) });
        if (C.picks) { await savePending(st.slug, id, me.email, creds); return back('pick=1'), true; }
        const r = await finish(st.slug, id, creds, me);
        return back(r.ok ? 'done=1' : `cxerr=${encodeURIComponent(r.error || 'Could not connect')}`), true;
      } catch (e) { log.warn('[connect] callback', id, e.message); return back(`cxerr=${encodeURIComponent(e.message.slice(0, 160))}`), true; }
    }
    const lm = p.match(/^\/api\/brands\/([a-z0-9-]+)\/live$/);
    if (lm && req.method === 'GET') return json(res, 200, await liveView(lm[1], auth.user(req))), true;
    const cm = p.match(/^\/api\/brands\/([a-z0-9-]+)\/connect\/([a-z0-9]+)(\/options)?$/);
    if (cm) {
      const [, slug, id, opt] = cm, me = auth.user(req);
      if (OFF.has(id)) return json(res, 404, { error: 'Marketplaces are coming soon.' }), true;
      if (!CONNECTORS[id]) return json(res, 404, { error: 'unknown connector' }), true;
      if (!me) return json(res, 401, { error: 'Sign in with Google first.', signin: true }), true;
      const access = await auth.claimInfo(slug, me); if (!access.host) return json(res, 404, { error: 'unknown brand' }), true;
      if (!access.gen) return json(res, 403, { error: noGen(access, access.host), demo: true, host: access.host }), true;
      const member = !!access.role, C = simOnly(id) ? null : REAL[id];
      /* connecting, picking the account and disconnecting are for the brand's admins (and the first person claiming it); the team can sync */
      if (opt && !canConnect(access)) return json(res, 403, { error: ADMIN_ONLY, adminOnly: true }), true;
      if (opt && req.method === 'GET') { if (!C?.options) return json(res, 404, { error: 'unknown connector' }), true;
        const pend = await loadPending(slug, id, me.email); if (!pend) return json(res, 200, { options: [], error: 'Connect again: the sign-in expired.' }), true;
        try { const os = await C.options(pend); return json(res, 200, { options: os, ...(os.adsNote ? { adsNote: os.adsNote } : {}) }), true; } catch (e) { return json(res, 200, { options: [], error: e.message.slice(0, 160) }), true; } }
      if (req.method !== 'POST') return false;
      const b = await body(req);
      if (b.action !== 'sync' && !canConnect(access)) return json(res, 403, { error: ADMIN_ONLY, adminOnly: true }), true;
      if (b.action === 'sync') {
        if (PUBLIC.has(id)) { const s = (await liveOf(slug, true)).conns[id];
          if (s?.lastSync && s.state === 'live' && Date.now() - s.lastSync < 10 * 60e3) return json(res, 200, { ok: true, state: 'live', note: 'Read a few minutes ago' }), true;
          if (C && !C.ready(deps)) return json(res, 200, { ok: false, error: 'The marketplace read is off on this server.' }), true;
          if (!s) return json(res, 200, await finish(slug, id, {}, me)), true;
          return json(res, 200, await sync(slug, id)), true; }
        if (!member) return json(res, 403, { error: 'Only the brand’s team can sync it.' }), true; return json(res, 200, await sync(slug, id)), true; }
      if (b.action === 'disconnect') { if (!member) return json(res, 403, { error: 'Only the brand’s team can disconnect it.' }), true; return json(res, 200, await disconnect(slug, id)), true; }
      if (!C) { if (['demo', 'key', 'select', 'connect'].includes(b.action)) return json(res, 200, await finish(slug, id, null, me)), true; return json(res, 400, { error: 'unknown action' }), true; }
      if (b.action === 'key') { if (!C.fromKey) return json(res, 400, { error: 'This one connects by signing in.' }), true;
        try { return json(res, 200, await finish(slug, id, await C.fromKey(b.fields || {}), me)), true; } catch (e) { return json(res, 200, { ok: false, error: e.user ? e.message : `Could not connect: ${e.message.slice(0, 140)}` }), true; } }
      if (b.action === 'select') { if (!C.select) return json(res, 400, { error: 'unknown action' }), true;
        const pend = await loadPending(slug, id, me.email); if (!pend) return json(res, 200, { ok: false, error: 'Connect again: the sign-in expired.' }), true;
        await vault.drop(slug, pendKey(id, me.email));
        /* one Google sign-in for Google Ads can also connect the Google Analytics property picked with it */
        const more = C.also ? C.also(pend, b.choice || {}) : [], r0 = (C.select(pend, b.choice || {}).customer === null && more.length) ? null : await finish(slug, id, C.select(pend, b.choice || {}), me);
        const also = {}; for (const x of more) also[x.id] = await finish(slug, x.id, x.creds, me).catch((e) => ({ ok: false, error: e.message.slice(0, 160) }));
        return json(res, 200, r0 ? { ...r0, also } : { ...(also[more[0].id] || { ok: false }), also, moved: more[0].id }), true; }
      if (b.action === 'connect' && PUBLIC.has(id)) return json(res, 200, await finish(slug, id, {}, me)), true;
      return json(res, 400, { error: 'unknown action' }), true;
    }
    return false;
  }

  /* ---------- keep the real ones fresh: every connected account, on its own cadence (EVERY_H) ---------- */
  async function tick() {
    if (DEMO) return;
    for (const { slug } of await packs.list().catch(() => [])) {
      const cs = await conns(slug).catch(() => ({}));
      for (const [id, s] of Object.entries(cs)) {
        const stuck = s?.state === 'syncing' && Date.now() - (s.syncAt || 0) > 30 * 60e3; /* a read cut off by a restart */
        if ((s?.state !== 'live' && !stuck) || simOnly(id) || s.sim || OFF.has(id)) continue;
        if (due(id, s)) await sync(slug, id).catch(() => {});
      }
    }
  }
  if (!DEMO && !process.env.BUILD_RESUME_OFF) { const t = setInterval(() => tick().catch((e) => log.warn('[connect] tick', e.message)), 3600e3); t.unref?.(); setTimeout(() => tick().catch(() => {}), 90e3).unref?.(); }

  return { handle, sim: SIM, liveOf, forViewer, drop: (slug) => cache.delete(sk(slug)), liveView, sync, disconnect, finish, tick, CONNECTORS };
}
