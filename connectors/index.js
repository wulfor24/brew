// Connected accounts. On the live site they are real: connect (OAuth or a pasted key), check the account looks like the
// brand's, read it, and turn what came back into the stats, cards and evidence the feed and the moves already use.
// Everything an account returns is private to the brand's team: brands/<slug>/private/ (tokens encrypted in the vault, the
// read in live/<id>.json, the state in connections.json). The marketplace read is public data and is shown to all.
// DUMMY: the demo site (DEMO_MODE=1) simulates every account (connectors/sim.js, built from the brand's real read), and
// Slack is real on the live site too (2026-10-16): it posts what the team sends and brings thread replies back; it is never
// evidence (no cards, no ledger). Simulated rows are marked demo and are never evidence.
// Connecting is also the easiest way to claim a brand: the first work email at its domain to connect becomes its admin.
import { leaderOnly } from '../roles.js'; // timers run their work on the background lease holder only
import crypto from 'node:crypto';
import { safeFetch } from '../reader/util.js'; // a Meta winner's picture, saved once for the Brand Book
import shopify from './shopify.js';
import meta from './meta.js';
import google, { ga4 } from './google.js';
import klaviyo from './klaviyo.js';
import reviews from './reviews.js';
import market from './market.js';
import slack, { api as slackApi, why as slackWhy, join as slackJoin } from './slack.js';
import { createSim, SIM_IDS, NAME } from './sim.js';
import { createVault } from '../vault.js';
import { DEMO, sk } from '../demo-mode.js';
import { privId, realRows, backoff, connectedOk } from './common.js';
import { emailHtml, p as para } from '../mail-layout.js';
import { ideaCards, pickIdeas } from '../social-feed.js';
import { staticProduct } from '../statics.js'; // a team static names the product in its photo

const REAL = { shopify, meta, ga4, google, klaviyo, reviews, slack, marketplaces: market };
export const CONNECTORS = Object.fromEntries(SIM_IDS.map((id) => [id, { id, name: NAME[id] }]));
const PUBLIC = new Set(['marketplaces']); // a marketplace read is public data, shown to every viewer
// Marketplaces is switched off for now (2026-10-16): no connect, no daily read, and an earlier connection is ignored. The page shows
// the marketplaces as Coming soon (DUMMY.md row 7). Take it out of OFF to bring the connector back.
const OFF = new Set(['marketplaces']);
/* How often each live account re-reads on its own (the hourly tick below), by how fast its numbers move. Reads are free API
   calls: the store (orders, stock) and Meta (spend, live ads) move through the day, every 3 hours; Google Ads (its own data
   lags about 3 hours), GA4 and Judge.me (a low-star review waiting on a reply) every 6; Klaviyo's lists and flows every 12.
   A connector can set its own `every` (hours) and a new one without it gets 12 hours. A failed read backs off (failure). */
const EVERY_H = { shopify: 3, meta: 3, google: 6, ga4: 6, klaviyo: 12, reviews: 6, marketplaces: 24 /* paid treg read */ };
/* the relevant moment: when someone on the team opens the brand, an account last read longer ago than this re-reads in the
   background (their next screen has it), so what they look at is never older than this while its platform answers */
const OPEN_H = { shopify: 1, meta: 1, google: 2, ga4: 2, klaviyo: 6, reviews: 2, marketplaces: 24 };
export const openOf = (id) => (REAL[id]?.openEvery || OPEN_H[id] || Math.min(DEFAULT_H, 3)) * 3600e3;
const DEFAULT_H = 12, RETRY_H = 3, SYNC_GAP = 10 * 60e3; /* Sync now: one read per account every 10 minutes */
export const everyOf = (id) => (REAL[id]?.every || EVERY_H[id] || DEFAULT_H) * 3600e3;
/* a failed read waits until retryAt: the platform's Retry-After on a rate limit, else doubling from 15 minutes up to
   12 hours, with jitter (failure() below). A record saved before retryAt existed keeps the old 3-hour wait */
const waiting = (s, now) => (s?.retryAt ? now < s.retryAt : s?.error && s?.errorAt && now - s.errorAt < RETRY_H * 3600e3);
export const due = (id, s, now = Date.now()) => now - (s?.lastSync || 0) >= everyOf(id) - 5 * 60e3 /* an hourly tick may land a few minutes early */
  && !waiting(s, now);
/* due on a team member's visit: older than its open window, live, not waiting on a backoff, not already reading */
export const dueOnOpen = (id, s, now = Date.now()) => s?.state === 'live' && !!s.lastSync && !s.needsReconnect && now - s.lastSync >= openOf(id) && !waiting(s, now);
/* an account's last numbers stay the fact sheet's truth while it fails, but not forever: after STALE_FAILS failures in a
   row, or once its last good read is older than STALE_H hours, they are marked stale and stop being evidence */
export const STALE_FAILS = +process.env.CONNECT_STALE_FAILS || 3, STALE_H = +process.env.CONNECT_STALE_H || 72, WARN_DAYS = 7;
/* numbers stop being the truth once older than four of their reads, never sooner than a day (CONNECT_STALE_H overrides all) */
export const staleHOf = (id) => (process.env.CONNECT_STALE_H ? STALE_H : id ? Math.max(24, 4 * everyOf(id) / 3600e3) : STALE_H);
export function failure(s = {}, e = {}, now = Date.now(), rnd = Math.random, id = null) {
  const fails = (s.fails || 0) + 1, expired = !!e.expired;
  const wait = expired ? 12 * 3600e3 : backoff(fails, { base: e.rateLimited ? 10 * 60e3 : 15 * 60e3, cap: 12 * 3600e3, retryAfter: e.retryAfter, rnd });
  const old = s.lastSync && now - s.lastSync > staleHOf(id) * 3600e3;
  const stale = !!s.lastSync && (s.stale || expired || fails >= STALE_FAILS || old);
  const staleWhy = !stale ? null : s.staleWhy || (expired ? 'the sign-in expired' : old ? `no good read for ${Math.round((now - s.lastSync) / 3600e3)} hours` : `${fails} reads in a row failed`);
  return { fails, retryAt: now + wait, stale, staleWhy, ...(expired ? { needsReconnect: true } : {}), ...(e.rateLimited ? { rateLimited: true } : { rateLimited: false }) };
}
/* a sign-in that runs out (Meta): days left, null when it doesn't run out or Brew doesn't know */
export const daysLeft = (s, now = Date.now()) => (s?.expiresAt ? Math.floor((s.expiresAt - now) / 864e5) : null);
// DUMMY: simulated on the demo site (DEMO_MODE=1)
export const simOnly = (id) => DEMO || !REAL[id];

import { movedAway } from '../moved.js'; // staging: a moved brand's sign-ins are renewed, and its admins emailed, by production only
import { PROTECTED, isProtected } from './protected.js'; // brands whose live connections are never dropped or replaced by accident
export { PROTECTED, isProtected };
const PROTECTED_WHY = 'This brand’s connections are protected while it is live with a client. Ask a Brew admin if it really has to change.';
export function createConnectors({ packs, auth, builder, treg = null, log = console, onLive = () => {} }) {
  const SIM = createSim({ packs, log }), vault = createVault(packs), deps = { treg };
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); };
  const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
  const base = (req) => process.env.PUBLIC_URL || auth.baseOf(req);
  /* a connector may share another's registered callback (google.js ga4 cbAs: 'google'): the OAuth client knows one URL */
  const cbUrl = (req, id) => `${base(req)}/connect/${REAL[id]?.cbAs || id}/callback`;

  /* ---------- per-brand state: brands/<slug>/private/connections.json, the read in [private/]live/<id>.json ---------- */
  const CF = 'private/connections.json';
  let lock = Promise.resolve();
  const conns = async (slug) => (await packs.getJSON(slug, CF, {})) || {};
  /* on Postgres the change is made under a row lock (packs.update), so two instances never lose each other's edit */
  const editC = (slug, f) => { const run = lock.then(async () => { if (packs.update) return packs.update(slug, CF, async (c0) => { const c = c0 || {}; await f(c); return c; });
    const c = await conns(slug); await f(c); await packs.put(slug, CF, c); return c; }); lock = run.catch(() => {}); return run; };
  /* one read per brand at a time: a manual Sync and the hourly tick never run the same brand's read, ledger write and move
     rewrite (builder.liveConnected) on top of each other. A failure never blocks the next (same shape as editC) */
  const brandRuns = new Map();
  const perBrand = (slug, f) => { const k = sk(slug), prev = brandRuns.get(k) || Promise.resolve(), run = prev.then(f); brandRuns.set(k, run.catch(() => {})); run.finally(() => { if (brandRuns.get(k) === run) brandRuns.delete(k); }).catch(() => {}); return run; };
  /* a Meta connection saved with one `account` reads as `accounts: [account]` (2026-10-17: several ad accounts at once) */
  const healAccounts = (s) => (!s ? s : Array.isArray(s.accounts) && s.accounts.length ? s : s.account ? { ...s, accounts: [s.account] } : s);
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
    const st = (await packs.getJSON(slug, 'status.json', {})) || {}, hostOf = (u) => { try { return new URL(String(u)).host; } catch { return null; } };
    /* every host the read found for the site: the profile's, the status', the site URL's, the redirect's (profile shape read as-is) */
    const hosts = [...new Set([profile.host, st.host, hostOf(st.url), hostOf(profile.url), hostOf(profile.site?.url), profile.site?.host, profile.redirectHost, hostOf(profile.redirect), ...(Array.isArray(profile.site?.hosts) ? profile.site.hosts : []), ...(Array.isArray(profile.hosts) ? profile.hosts : [])].filter(Boolean).map(String))];
    return { slug, host: profile.host || st.host, hosts, profile, shopifyShop: shop, pageId: profile.ads?.own?.pageId || null, lane: Object.keys(seed.lanes || { core: 1 })[0] };
  }

  /* ---------- connect, check, read ---------- */
  // who may connect: the brand's team, or the first official email on an unclaimed brand, who claims it by connecting
  async function mayUse(slug, id, me) {
    const info = await auth.claimInfo(slug, me);
    if (info.role) return { ok: true, claimed: false };
    if (info.eligible) { const r = await auth.claim(slug, me, `Connected ${NAME[id]}`); if (r.ok) return { ok: true, claimed: true }; }
    return { ok: false, info };
  }
  /* a GA4 property read through Brew's shared service account (pasted ID): Brew's account can see every property anyone added it
     to, so the ID alone proves nothing. It is refused when another brand already has that property, and needs the property's
     stream to point to the brand's site (owns), unless Brew's own staff override it on purpose */
  async function propertyElsewhere(slug, property) {
    if (!property) return null;
    for (const { slug: s } of await packs.list().catch(() => [])) { if (s === slug) continue;
      const c = await conns(s).catch(() => ({})); for (const k of ['ga4', 'google']) if (c?.[k] && !c[k].sim && String(c[k].account?.id || '').split(' ').includes(property)) return s; }
    return null;
  }
  /* a protected brand's connection that exists (live, syncing, stale or needing a reconnect) is never replaced by a new
     sign-in, key or account pick unless a Brew admin forces it; checked here, where every path that connects ends */
  const rootAdmin = (me) => !!(auth.isRootAdmin ? auth.isRootAdmin(me) : auth.isAdmin?.(me)); /* only Brew's named admins may force a protected brand */
  const exists = (c) => !!c && (c.state === 'live' || c.state === 'syncing' || !!c.lastSync || !!c.account);
  const replaceRefused = async (slug, id, me, force) => isProtected(slug) && !(force && rootAdmin(me)) && exists((await conns(slug))[id]);
  async function finish(slug, id, creds, me, { override = false, force = false } = {}) {
    if (await replaceRefused(slug, id, me, force)) { log.warn(`[connect] ${slug} ${id}: protected connection kept (a new connect was refused for ${me?.email || 'someone'})`); return { ok: false, state: 'protected', protected: true, error: PROTECTED_WHY }; }
    /* a property through Brew's service account is checked before anything is kept, or the brand claimed by this connect */
    let sa = null;
    if (creds?.sa && !simOnly(id)) {
      const pre = await auth.claimInfo(slug, me); if (!pre.role && !pre.eligible) return { ok: false, state: 'needs_work_email', error: noGen(pre, pre.host) };
      if (await propertyElsewhere(slug, creds.property)) { log.warn('[connect] ga4 property on another brand', slug, creds.property, me.email);
        return { ok: false, state: 'refused', error: 'That GA4 property is already connected to another brand in Brew. Paste your own property’s ID, or sign in with Google instead.' }; }
      const ctx = await ctxOf(slug); let proof;
      try { proof = await REAL[id].owns(creds, ctx); } catch (e) { proof = { ok: false, why: e.message.slice(0, 160) }; }
      const staff = !!auth.isAdmin?.(me);
      if (!proof.ok && !(override && staff)) { log.warn('[connect] ga4 property not the brand’s', slug, creds.property, me.email, proof.why);
        /* a check that didn't go through is said as such, never as a fact about the property (the staff override still stands) */
        const error = proof.error ? `The check on that GA4 property didn’t go through: ${proof.why || 'Google didn’t answer'}. Try again in a minute, or sign in with Google instead.`
          : `Brew couldn’t match that GA4 property to ${ctx.host || 'this brand’s site'}: ${proof.why || 'its web stream points elsewhere'}. Check the property ID, or sign in with Google instead.`;
        return { ok: false, state: 'refused', error, proof: { ok: false, error: !!proof.error, why: proof.why || null }, ...(staff ? { override: true } : {}) }; }
      if (!proof.ok) log.warn('[connect] ga4 staff override', slug, creds.property, me.email);
      sa = { proof };
    }
    const may = await mayUse(slug, id, me);
    /* nothing is kept for someone who may not use it: no token in the vault, no change to the brand's connections */
    if (!may.ok) return { ok: false, state: 'needs_work_email', error: noGen(may.info, may.info.host) };
    if (simOnly(id)) {
      await editC(slug, (c) => { c[id] = { state: 'syncing', at: Date.now(), by: me.email, account: null, verified: true, sim: true }; });
      cache.delete(sk(slug));
      return { ...(await sync(slug, id)), claimed: may.claimed };
    }
    const C = REAL[id], ctx = await ctxOf(slug);
    let proof = sa ? sa.proof : { ok: false, why: '' };
    if (!sa) try { proof = C.owns ? await C.owns(creds, ctx) : { ok: true }; } catch (e) { proof = { ok: false, why: e.message.slice(0, 160) }; }
    /* otherwise proof is a sanity check, shown to the team, never ownership: ownership is the team (or the claim) above */
    if (!PUBLIC.has(id)) await vault.save(slug, id, creds, { force: force && rootAdmin(me) }); /* finish already refused a replacement unless an admin forced it */
    if (id === 'slack') teams.clear(); /* the workspace may have moved to this brand */
    /* a team account connected for the first time: the moves' rewrite waits for its first read (build.js connectPending) */
    if (!PUBLIC.has(id) && id !== 'slack' && !(await conns(slug))[id]?.lastSync) await builder.connectPending?.(slug, id).catch(() => {});
    /* connecting the same account again keeps when it was last read, so a first read that fails shows the last numbers, not an error */
    await editC(slug, (c) => { const was = c[id], same = was?.lastSync && (!proof.account?.id || was.account?.id === proof.account.id);
      c[id] = { state: 'syncing', at: Date.now(), by: me.email, account: proof.account || was?.account || null, ...(proof.accounts ? { accounts: proof.accounts } : {}), verified: !!proof.ok, why: proof.why || '', ...(same ? { lastSync: was.lastSync } : {}) }; });
    cache.delete(sk(slug));
    /* proof: what the ownership check found, for the sheet to show plainly (advisory for every connector but GA4 by ID) */
    return { ...(await sync(slug, id)), claimed: may.claimed, verified: !!proof.ok, why: proof.ok ? null : proof.why || null, proof: { ok: !!proof.ok, error: !!proof.error, why: proof.why || null, ...(proof.accounts ? { accounts: proof.accounts.map(({ id: aid, name, ok, why }) => ({ id: aid, name, ok, why })) } : {}) } };
  }
  const KEY_TRIES = 6, KEY_WINDOW = 15 * 60e3, keyTries = new Map(); // per person and connector: 6 pasted keys every 15 minutes (an onboarding pastes Shopify, Klaviyo, Judge.me and GA4 in a row)
  const keyTry = (email, id, now = Date.now()) => { const k = `${String(email || '').toLowerCase()}|${id}`, xs = (keyTries.get(k) || []).filter((at) => now - at < KEY_WINDOW);
    if (keyTries.size > 5000) keyTries.clear(); if (xs.length >= KEY_TRIES) { keyTries.set(k, xs); return false; } xs.push(now); keyTries.set(k, xs); return true; };
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
    const dead = (e) => { if (C.expired?.(e)) { e.expired = true; e.message = `${C.name || id} sign-in expired: connect it again. (${e.message.slice(0, 120)})`; } throw e; };
    /* a refresh that Google or Shopify refuses (invalid_grant, 401) is a dead sign-in: the admins are told to connect it again */
    /* refresh under the vault row's lock (Postgres): the second instance waits, reads the token the first one just got, and
       asks the provider nothing; a refused refresh keeps the old token (the connection goes stale, never disconnected) */
    /* staging, a brand moved to production (moved.js): a sign-in that rotates (a refresh token) is renewed by production only, or
       the first site to refresh would retire the other's copy and that site would say "connect again"; staging reads with what it has */
    if (C.fresh && !(movedAway(slug) && creds?.refresh)) { try { creds = vault.refresh ? await vault.refresh(slug, id, (c) => C.fresh(c)) : await (async () => { const f = await C.fresh(creds); if (f !== creds) await vault.save(slug, id, f, { refresh: true }); return f; })(); } catch (e) { dead(e); }
      if (!creds) throw new Error('Not connected: connect it again.'); } /* removed on another instance while this read ran */
    const exp = C.expires ? { expiresAt: +creds.exp || null, refreshedAt: creds.refreshedAt || null } : null; /* when the sign-in runs out (Meta) */
    const ctx = await ctxOf(slug);
    /* an account not yet matched to the brand is checked again on each read: the brand may have fixed its links since */
    if (C.owns && (await conns(slug))[id]?.verified === false) { const p = await C.owns(creds, ctx).catch(() => null);
      if (p) await editC(slug, (c) => { if (c[id]) c[id] = { ...c[id], verified: !!p.ok, why: p.why || '', ...(p.accounts ? { accounts: p.accounts } : {}) }; }); }
    try { const d = await C.sync(creds, ctx, deps); return exp ? { ...d, exp } : d; } catch (e) { dead(e); }
  }
  /* what a connected account adds to the Brand Book, kept private (members only): Shopify's own brand settings, and Meta's
     winning ads with their returns. A winner's picture is saved once under its content name in refs/ (Meta's links expire) */
  async function brandExtras(slug, id, d) {
    if (id === 'shopify' && d.brand) await packs.put(slug, 'private/shop-brand.json', { at: Date.now(), ...d.brand });
    if (id === 'meta' && (d.winners || d.winnersError)) {
      const prev = await packs.getJSON(slug, 'private/meta-winners.json', null).catch(() => null), had = new Map(prev?.v === 4 ? (prev.ads || []).map((x) => [x.id, x.src]) : []); /* v4 (full-size posters): video winners use the video's large frame, so older (tiny) pictures are fetched again once */
      const ads = [];
      for (const x of d.winners || []) {
        let src = had.get(x.id) || null;
        if (!src && x.image) { try { const r = await safeFetch(x.image, { signal: AbortSignal.timeout(20e3) }); const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
          if (buf?.length && buf.length < 8e6) { const f = `refs/${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.jpg`; await packs.put(slug, f, buf, 'image/jpeg'); src = `/b/${slug}/${f}`; } } catch (e) { log.info?.('[connect] winner picture', x.id, e.message); } }
        if (src && !ads.some((y) => y.src === src)) { const { image, ...rest } = x; ads.push({ ...rest, src }); } /* one creative under several ad ids: its best-returning copy */
      }
      await packs.put(slug, 'private/meta-winners.json', { v: ads.length ? 4 : prev?.v, at: Date.now(), ads: ads.length ? ads : prev?.ads || [], error: d.winnersError || null });
    }
  }
  const sync = (slug, id) => perBrand(slug, () => sync0(slug, id));
  async function sync0(slug, id) {
    await editC(slug, (c) => { if (!c[id] && !simOnly(id)) return; c[id] = { ...(c[id] || {}), state: 'syncing', syncAt: Date.now() }; }); /* a connection removed meanwhile is never brought back by a read */
    try {
      const d = await read(slug, id);
      const data = { at: Date.now(), account: d.account || (await conns(slug))[id]?.account || null, ...(Array.isArray(d.accounts) ? { accounts: d.accounts } : {}), stats: d.stats || [], changed: d.changed || [], cards: d.cards || [], ledger: d.ledger || [], notes: d.notes || [], ...(d.ownPageId ? { ownPageId: d.ownPageId } : {}), ...(d.sim ? { sim: true } : {}) };
      await packs.put(slug, liveName(id), data);
      if (!d.sim && !simOnly(id)) await brandExtras(slug, id, d).catch((e) => log.warn('[connect] brand book', slug, id, e.message)); /* the Brand Book's Shopify settings and Meta winners */
      /* an account's `ok` and `why` are the ownership check's verdict (owns); the read's own per-account result never overwrites them */
      const merged = (x) => data.accounts.map((a) => { const prev = (x.accounts || []).find((y) => String(y.id) === String(a.id)) || {}, { ok: readOk, error: readErr, ...rest } = a;
        return { ...prev, ...rest, ...(readOk === false ? { readError: readErr || 'not read' } : { readError: null }) }; });
      await editC(slug, (c) => { if (!c[id] && !simOnly(id)) return; const x = c[id] || {}; c[id] = { ...x, state: 'live', lastSync: data.at, error: null, account: data.account || x.account, ...(data.accounts ? { accounts: merged(x) } : {}), notes: data.notes,
        fails: 0, retryAt: null, rateLimited: false, stale: false, staleWhy: null, needsReconnect: false, ...(d.exp ? { expiresAt: d.exp.expiresAt, refreshedAt: d.exp.refreshedAt || x.refreshedAt || null, ...(d.exp.expiresAt !== x.expiresAt ? { expiryWarned: null } : {}) } : {}) }; });
      cache.delete(sk(slug));
      await builder.liveConnected?.(slug, id, data.ledger, true, { public: PUBLIC.has(id) }).catch((e) => log.warn('[connect] moves', e.message));
      onLive(slug);
      log.log?.(`[connect] ${slug} ${id}: ${data.cards.length} cards, ${data.ledger.length} facts${d.sim ? ' (simulated)' : ''}`);
      return { ok: true, state: 'live', stats: data.stats, changed: data.changed, cards: data.cards.length, notes: data.notes, account: data.account, ...(data.accounts ? { accounts: data.accounts } : {}), dummy: simOnly(id) };
    } catch (e) {
      log.warn('[connect] sync', slug, id, e.message);
      /* an account that read before keeps its last read and says what went wrong; a new one shows the error */
      let wentStale = null, fx = {};
      await editC(slug, (c) => { if (!c[id] && !simOnly(id)) return; const x = c[id] || {}, f = failure(x, e, Date.now(), Math.random, id); fx = f; if (f.stale && !x.stale) wentStale = f.staleWhy;
        c[id] = { ...x, state: x.lastSync ? 'live' : 'error', error: e.message.slice(0, 200), errorAt: Date.now(), ...f }; });
      cache.delete(sk(slug));
      /* its numbers stay on the fact sheet, marked stale, and stop being evidence for the moves, cards and answers */
      if (wentStale) await builder.staleConnected?.(slug, id, wentStale, { public: PUBLIC.has(id) }).catch((er) => log.warn('[connect] stale', slug, id, er.message));
      /* a platform asking Brew to slow down is said in plain words; the read tries again on its own at retryAt */
      return { ok: false, error: e.message.slice(0, 200), rateLimited: !!fx.rateLimited, retryAt: fx.retryAt || null };
    }
  }
  /* a protected brand (PROTECTED_CONNECTIONS, default arata-in: a live client) never loses a live connection by accident:
     disconnect, re-select and connecting again over a live one are refused unless an admin forces it */
  const disconnect = (slug, id, { force = false } = {}) => (isProtected(slug) && !force ? Promise.resolve({ error: PROTECTED_WHY, protected: true }) : perBrand(slug, () => disconnect0(slug, id)));
  async function disconnect0(slug, id) {
    /* the sign-in goes, and every sign-in still waiting for its account to be picked (<id>-pending-*). The grant on the
       platform's side is left alone on purpose: one person's Meta sign-in may serve several brands, and taking it back
       (DELETE /me/permissions) would cut every one of them off */
    if (!simOnly(id) && !PUBLIC.has(id)) { await vault.drop(slug, id);
      for (const f of await packs.listFiles?.(slug, 'private/vault').catch(() => []) || []) { const k = String(f).replace(/\.json$/, ''); if (k.startsWith(`${id}-pending-`) || k.startsWith(`${id}-own-pending-`)) await vault.drop(slug, k).catch(() => {}); } }
    if (id === 'shopify') await packs.put(slug, 'private/shop-brand.json', { at: Date.now(), gone: true }).catch(() => {}); /* the Brand Book stops leading with the store's logo and colours */
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
    return [id, { ...(id === 'shopify' && installUrl() ? { install: true } : {}), modes: C.modes, ready: !!C.ready(deps), oauth: C.modes.includes('oauth') && !!C.ready(deps) && (C.oauthOn ? !!C.oauthOn() : true), picks: !!C.picks, multi: !!C.multi, proof: C.proof !== false, every: everyOf(id) / 3600e3, help: C.help?.() || null, email: C.helpEmail?.() || null,
      fields: (C.keyFields || []).map(({ k, label, hint, secret, optional }) => ({ k, label, hint, secret: !!secret, optional: !!optional })) }];
  }));
  async function liveView(slug, me) {
    const access = await auth.claimInfo(slug, me), member = !!access.role, L = await liveOf(slug), out = {};
    for (const [id, s0] of Object.entries(L.conns)) {
      if (!member && !PUBLIC.has(id)) continue;
      const d = L.live[id], s = healAccounts(s0), accts = member && Array.isArray(s.accounts) ? s.accounts : null;
      out[id] = { state: s.state, at: s.at, lastSync: s.lastSync || null, by: member ? s.by : undefined, account: accts && accts.length > 1 ? `${accts.length} ad accounts` : s.account?.name || null, ...(accts ? { accounts: accts } : {}), error: s.error || null, why: member && !s.verified ? s.why || null : null, verified: member ? !!s.verified : undefined, notes: s.notes || [], dummy: simOnly(id) || !!d?.sim,
        stale: !!s.stale, staleWhy: s.stale ? s.staleWhy || null : null, retryAt: s.error ? s.retryAt || null : null, rateLimited: !!s.rateLimited, needsReconnect: !!s.needsReconnect,
        ...(member && s.expiresAt ? { expiresAt: s.expiresAt, daysLeft: daysLeft(s) } : {}),
        ...(d && !d.gone ? { stats: d.stats, changed: d.changed, cards: (d.cards || []).length } : {}) };
    }
    const ctx = await ctxOf(slug), born = (await packs.getJSON(slug, 'status.json', null).catch(() => null))?.born || null;
    return { me, signin: auth.signinOn(), access, full: auth.isAdmin(me), conns: out, avail: avail(), shop: member ? ctx.shopifyShop : null, dummy: DEMO, born };
  }
  /* the accounts connected right now (read at least once, not disconnected): what a private move's connectedWith is checked against */
  async function connectedIds(slug) { const L = await liveOf(slug); return Object.keys(L.live).filter((id) => !L.live[id]?.gone); }
  /* a connector card says how long ago its account was read ("3 h"), not "just now" forever */
  const agoShort = (at) => { const m = Math.max(0, Math.round((Date.now() - (+at || Date.now())) / 60e3)); return m < 2 ? 'just now' : m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
  // for feed-service: the connector cards and connected ids a viewer of this brand gets (team only, except marketplaces)
  /* a team member opened the brand: each live account older than its open window re-reads in the background, at most one
     look per brand every few minutes, one read per account at a time (sync marks it syncing) */
  const OPENED = new Map();
  function freshen(slug, now = Date.now()) {
    if (DEMO || now - (OPENED.get(slug) || 0) < 5 * 60e3) return; OPENED.set(slug, now);
    conns(slug).then((cs) => { for (const [id, s] of Object.entries(cs || {})) if (!simOnly(id) && !s?.sim && !OFF.has(id) && dueOnOpen(id, s, now)) sync(slug, id).catch((e) => log.warn('[connect] open sync', slug, id, e.message)); }).catch(() => {});
  }
  async function forViewer(slug, member) {
    if (member) freshen(slug);
    const L = await liveOf(slug), cards = [], on = {};
    for (const [id, d] of Object.entries(L.live)) { if (d.gone) continue; if (!member && !PUBLIC.has(id)) continue; on[id] = true;
      /* an account that stopped reading (stale, or its sign-in ran out) keeps its cards out: "this week" would be weeks old. The
         connectors page and Signals say to connect it again */
      if (L.conns[id]?.stale || L.conns[id]?.needsReconnect) continue;
      cards.push(...(d.cards || []).map((c) => ({ ...c, time: agoShort(d.at), ...(simOnly(id) || d.sim ? { dummy: true } : {}), ...(PUBLIC.has(id) ? { liveOnly: false, publicLive: true } : {}) }))); }
    /* DUMMY: a simulated account's rows never reach the team's numbers (they lose their demo flag once copied, so they stay out here) */
    /* a stale account (connections.json stale) is never quoted: its numbers wait for a good read */
    const ledger = {}; if (member) for (const [id, d] of Object.entries(L.live)) if (!d.gone && !d.sim && !simOnly(id) && !L.conns[id]?.stale) for (const e of realRows(d.ledger)) ledger[e.key] = { v: e.v, n: e.n, at: d.at, label: e.label, ...(e.cur ? { cur: e.cur } : {}) };
    /* the moves rewritten from the team's accounts (private/cards.json): members get those cards, and the shared cards of the
       same moves step aside (privMoves). Cards saved before they had their own id get it here */
    let privMoves = [], privStatics = false;
    if (member) { const pc = await packs.getJSON(slug, 'private/cards.json', []).catch(() => []), pm = await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({})) || {}, ids = await connectedIds(slug);
      /* a team static saved before it named its product gets it back from the set's own record (private/statics.json) */
      const bare = (Array.isArray(pc) ? pc : []).filter((c) => c?.teamStatics && /^static-.+-p$/.test(c.id || '') && !c.product);
      if (bare.length) { const [st, prof] = await Promise.all([packs.getJSON(slug, 'private/statics.json', {}).catch(() => ({})), packs.getJSON(slug, 'profile.json', null).catch(() => null)]);
        for (const c of bare) { const h = st?.[c.id.replace(/^static-|-p$/g, '')]?.product, ti = h && (prof?.catalog?.products || []).find((x) => x?.handle === h)?.title; if (ti) Object.assign(c, staticProduct(ti)); } }
      for (const c of Array.isArray(pc) ? pc : []) if (c?.id && c.privateOf != null && connectedOk(pm[c.privateOf]?.meta, ids, c.privateOf)) cards.push({ ...c, id: privId(c.id), liveOnly: true });
      privMoves = [...new Set(cards.filter((c) => c.privateOf != null).map((c) => +c.privateOf))]; privStatics = cards.some((c) => c.teamStatics);
      /* the team's ideas (private/ideas/ideas.json, written with the connected facts): members only, next to the public ones */
      const mi = await packs.getJSON(slug, 'private/ideas/ideas.json', null).catch(() => null);
      if (mi?.items?.length) { const [seed, profile] = await Promise.all([packs.getJSON(slug, 'seed.json', {}).catch(() => ({})), packs.getJSON(slug, 'profile.json', null).catch(() => null)]);
        cards.push(...ideaCards(pickIdeas(mi.items, { profile: profile || {} }), seed || {}) /* the community gate heals saved team ideas too (community-gate.js) */.map((c) => ({ ...c, id: privId(c.id), liveOnly: true, memberIdea: true }))); } }
    return { cards, on, privMoves, privStatics, ledger };
  }

  /* ---------- routes ---------- */
  const installUrl = () => (/^https:\/\/(apps\.shopify\.com|admin\.shopify\.com)\//.test(process.env.SHOPIFY_INSTALL_URL || '') ? process.env.SHOPIFY_INSTALL_URL : null);
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
        /* the public app installs from Shopify (its listing or install link); the store then links to the brand by its domain (shopify-app.js) */
        if (id === 'shopify' && installUrl()) return redirect(res, installUrl()), true;
        const state = auth.sign({ slug, id, email: me.email, n: crypto.randomBytes(9).toString('base64url') }, 900, 'connect');
        try { return redirect(res, C.authorize({ state, redirect: cbUrl(req, id), shop: u.searchParams.get('shop') || (await ctxOf(slug)).shopifyShop })), true; }
        catch (e) { return redirect(res, `/${slug}#v=connectors&cx=${id}&cxerr=${encodeURIComponent(e.message)}`), true; }
      }
      if (simOnly(id)) return json(res, 404, { error: 'unknown connector' }), true;
      const st = auth.verify(u.searchParams.get('state'), 'connect');
      /* the callback may be another connector's (ga4 comes back on /connect/google/callback): the state says which one signed in */
      if (!st || !me || st.email !== me.email || (st.id !== id && REAL[st.id]?.cbAs !== id)) return redirect(res, '/?signin=failed'), true;
      const cid = st.id, C = REAL[cid];
      const back = (q) => redirect(res, `/${st.slug}#v=connectors&cx=${cid}&${q}`);
      /* the brand may have been claimed since this sign-in started: only its team goes on */
      const access = await auth.claimInfo(st.slug, me); if (!access.gen) return back(`cxerr=${encodeURIComponent(noGen(access, access.host))}`), true;
      try {
        const creds = await C.exchange({ query: u.searchParams, redirect: cbUrl(req, cid) }); /* the same shared URL the sign-in started with */
        if (C.picks) { await savePending(st.slug, cid, me.email, creds); return back('pick=1'), true; }
        const r = await finish(st.slug, cid, creds, me);
        return back(r.ok ? 'done=1' : `cxerr=${encodeURIComponent(r.error || 'Could not connect')}`), true;
      } catch (e) { log.warn('[connect] callback', cid, e.message); return back(`cxerr=${encodeURIComponent(e.message.slice(0, 160))}`), true; }
    }
    if (p === '/shopify/own/callback' && req.method === 'GET') { /* the store approved the brand's own app (ownAuthorize above) */
      const st = auth.verify(u.searchParams.get('state'), 'connect-own'), me = auth.user(req);
      if (!st || !me || st.email !== me.email) return redirect(res, '/?signin=failed'), true;
      const back = (q) => redirect(res, `/${st.slug}#v=connectors&cx=${st.id}&${q}`);
      const access = await auth.claimInfo(st.slug, me); if (!access.gen) return back(`cxerr=${encodeURIComponent(noGen(access, access.host))}`), true;
      if (!canConnect(access)) return back(`cxerr=${encodeURIComponent(ADMIN_ONLY)}`), true;
      const pend = await loadPending(st.slug, `${st.id}-own`, me.email); if (!pend) return back(`cxerr=${encodeURIComponent('That took too long. Paste the keys again.')}`), true;
      try { const creds = await REAL[st.id].ownExchange({ query: u.searchParams, pend }); await vault.drop(st.slug, pendKey(`${st.id}-own`, me.email));
        const r = await finish(st.slug, st.id, creds, me); return back(r.ok ? 'done=1' : `cxerr=${encodeURIComponent(r.error || 'Could not connect')}`), true; }
      catch (e) { log.warn('[connect] own callback', st.slug, e.message); return back(`cxerr=${encodeURIComponent(e.message.slice(0, 160))}`), true; }
    }
    if (p === '/shopify/own' && req.method === 'GET') return redirect(res, '/'), true; /* the own app's App URL: Brew lives outside the admin */
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
        try { const os = await C.options(pend, { ctx: await ctxOf(slug) }); return json(res, 200, { options: os, multi: !!C.multi, ...(os.adsNote ? { adsNote: os.adsNote } : {}) }), true; } catch (e) { return json(res, 200, { options: [], error: e.message.slice(0, 160) }), true; } }
      if (req.method !== 'POST') return false;
      const b = await body(req);
      if (b.action !== 'sync' && !canConnect(access)) return json(res, 403, { error: ADMIN_ONLY, adminOnly: true }), true;
      if (b.action === 'sync') {
        if (PUBLIC.has(id)) { const s = (await liveOf(slug, true)).conns[id];
          if (s?.lastSync && s.state === 'live' && Date.now() - s.lastSync < 10 * 60e3) return json(res, 200, { ok: true, state: 'live', note: 'Read a few minutes ago' }), true;
          if (C && !C.ready(deps)) return json(res, 200, { ok: false, error: 'The marketplace read is off on this server.' }), true;
          if (!s) return json(res, 200, await finish(slug, id, {}, me)), true;
          return json(res, 200, await sync(slug, id)), true; }
        if (!member) return json(res, 403, { error: 'Only the brand’s team can sync it.' }), true;
        /* one read per account every SYNC_GAP: a second click soon after says when it last read, it doesn't read again */
        const s = (await liveOf(slug, true)).conns[id];
        if (s?.state === 'syncing' && Date.now() - (s.syncAt || 0) < 10 * 60e3) return json(res, 200, { ok: true, state: 'syncing', busy: true, note: 'Already reading it. This takes a minute.' }), true;
        if (s?.state === 'live' && !s.error && s.lastSync && Date.now() - s.lastSync < SYNC_GAP) return json(res, 200, { ok: true, state: 'live', recent: true, lastSync: s.lastSync, note: `Read ${Math.max(1, Math.round((Date.now() - s.lastSync) / 60e3))} min ago. You can read it again in ${Math.max(1, Math.ceil((SYNC_GAP - (Date.now() - s.lastSync)) / 60e3))} min.` }), true;
        return json(res, 200, await sync(slug, id)), true; }
      if (isProtected(slug) && ['disconnect', 'select', 'key', 'connect'].includes(b.action) && (b.action === 'disconnect' || exists((await conns(slug))[id])) && !(b.force === true && rootAdmin(me)))
        return json(res, 409, { error: PROTECTED_WHY, protected: true }), true;
      if (b.action === 'disconnect') { if (!member) return json(res, 403, { error: 'Only the brand’s team can disconnect it.' }), true; return json(res, 200, await disconnect(slug, id, { force: b.force === true && rootAdmin(me) })), true; }
      if (!C) { if (['demo', 'key', 'select', 'connect'].includes(b.action)) return json(res, 200, await finish(slug, id, null, me)), true; return json(res, 400, { error: 'unknown action' }), true; }
      if (b.action === 'key') { if (!C.fromKey) return json(res, 400, { error: 'This one connects by signing in.' }), true;
        /* a pasted key or ID asks Google whether Brew can see it: a few tries per person, so nobody walks through IDs */
        if (!keyTry(me.email, id)) return json(res, 429, { ok: false, error: 'Too many tries. Wait a few minutes, then paste it again.' }), true;
        try { return json(res, 200, await finish(slug, id, await C.fromKey(b.fields || {}), me, { override: b.override === true, force: b.force === true })), true; } catch (e) {
          /* an app from another Shopify organization: keep the keys (pending, PENDING_MS) and send this person to the store's approve screen */
          if (e.approve && C.ownAuthorize) { await savePending(slug, `${id}-own`, me.email, e.approve);
            const state = auth.sign({ slug, id, email: me.email, n: crypto.randomBytes(9).toString('base64url') }, 900, 'connect-own');
            return json(res, 200, { ok: false, error: e.message, approve: C.ownAuthorize({ ...e.approve, state, redirect: `${base(req)}/shopify/own/callback` }) }), true; }
          return json(res, 200, { ok: false, error: e.user ? e.message : `Could not connect: ${e.message.slice(0, 140)}` }), true; } }
      if (b.action === 'select') { if (!C.select) return json(res, 400, { error: 'unknown action' }), true;
        const pend = await loadPending(slug, id, me.email); if (!pend) return json(res, 200, { ok: false, error: 'Connect again: the sign-in expired.' }), true;
        await vault.drop(slug, pendKey(id, me.email));
        /* one Google sign-in for Google Ads can also connect the Google Analytics property picked with it */
        const more = C.also ? C.also(pend, b.choice || {}) : [], r0 = (C.select(pend, b.choice || {}).customer === null && more.length) ? null : await finish(slug, id, C.select(pend, b.choice || {}), me, { force: b.force === true });
        const also = {}; for (const x of more) also[x.id] = await finish(slug, x.id, x.creds, me, { force: b.force === true }).catch((e) => ({ ok: false, error: e.message.slice(0, 160) }));
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
        /* a read cut off by a restart (a deploy mid-read): a read takes a few minutes, so 10 minutes on it is cut off. It reads again
           now, not at its next cadence: a day of deploys every few minutes otherwise left it "reading" for hours (Arata, 23 Oct) */
        const stuck = s?.state === 'syncing' && Date.now() - (s.syncAt || 0) > 10 * 60e3;
        /* a first read that failed (state error, never read) tries again once its backoff (retryAt) has passed */
        const retry = s?.state === 'error' && !s.lastSync && !s.needsReconnect && Date.now() >= (s.retryAt || 0);
        if ((s?.state !== 'live' && !stuck && !retry) || simOnly(id) || s.sim || OFF.has(id)) continue;
        if (stuck || due(id, s)) await sync(slug, id).catch(() => {});
        await ageCheck(slug, id).catch((e) => log.warn('[connect] age', slug, id, e.message));
        await expiryCheck(slug, id).catch((e) => log.warn('[connect] expiry', slug, id, e.message));
      }
    }
  }
  /* a last good read older than STALE_H hours goes stale even when no read failed (the tick was off, a platform hung) */
  async function ageCheck(slug, id, now = Date.now()) {
    const s = (await conns(slug))[id]; if (!s?.lastSync || s.stale || now - s.lastSync <= staleHOf(id) * 3600e3) return false;
    const why = `no good read for ${Math.round((now - s.lastSync) / 3600e3)} hours`;
    await editC(slug, (c) => { if (c[id]) c[id] = { ...c[id], stale: true, staleWhy: why }; }); cache.delete(sk(slug));
    await builder.staleConnected?.(slug, id, why, { public: PUBLIC.has(id) }); return true;
  }
  /* a sign-in that runs out (Meta, about 60 days): the brand's admins get one email a week ahead (and the page says so
     from then on), and one more when it has run out. Brew already tried to renew it on the read before (meta.js fresh) */
  async function expiryCheck(slug, id, now = Date.now()) {
    if (movedAway(slug)) return null; /* staging, a moved brand: production tells its admins, once */
    const s = (await conns(slug))[id], left = daysLeft(s, now); if (left == null || left > WARN_DAYS) return null;
    const stage = left < 0 ? 'expired' : 'soon', key = `${stage}:${s.expiresAt}`; if (s.expiryWarned === key) return null;
    const m = await auth.getMembers?.(slug).catch(() => null), to = [...new Set((m?.members || []).filter((x) => ['owner', 'admin'].includes(x.role)).map((x) => String(x.email || '').toLowerCase()).filter(Boolean))];
    const name = REAL[id]?.name || NAME[id] || id, brand = (await ctxOf(slug).catch(() => ({})))?.profile?.name || slug, base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com';
    const day = new Date(s.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const subject = stage === 'expired' ? `${brand}: the ${name} sign-in ran out` : `${brand}: the ${name} sign-in runs out on ${day}`;
    const line = stage === 'expired' ? `Brew can't read ${name} for ${brand} any more: the sign-in ran out on ${day}. Its last numbers are marked stale and no longer used. Connect it again to bring them back.`
      : `The ${name} sign-in Brew uses for ${brand} runs out on ${day} (${left} day${left === 1 ? '' : 's'}). ${name} doesn't let Brew renew it on its own, so please connect it again before then. It takes a minute.`;
    const href = `${base}/${slug}#connectors`;
    for (const e of to) await auth.mail?.(e, subject, emailHtml({ title: subject, eyebrow: brand, preheader: line.slice(0, 140), body: para(line), cta: { href, label: `Connect ${name} again` } }), `${subject}\n\n${line}\n\n${href}`).catch(() => false);
    await editC(slug, (c) => { if (c[id]) c[id] = { ...c[id], expiryWarned: key }; }); cache.delete(sk(slug));
    log.log?.(`[connect] ${slug} ${id}: sign-in ${stage} (${left} days), told ${to.length}`);
    return { stage, to };
  }
  if (!DEMO && !process.env.BUILD_RESUME_OFF) { const t = setInterval(() => leaderOnly(tick).catch((e) => log.warn('[connect] tick', e.message)), 3600e3); t.unref?.(); setTimeout(() => leaderOnly(tick).catch(() => {}), 90e3).unref?.(); }

  /* ---------- Slack: post what the team sends, find the brand a Slack event belongs to ---------- */
  /* the brand's Slack, when it is really connected (live, not simulated): its token and the channel picked on Slack's screen */
  async function slackOf(slug) {
    if (simOnly('slack')) return null; const s = (await conns(slug))?.slack; if (!s || s.sim || s.state === 'error') return null;
    const c = await vault.load(slug, 'slack'); return c?.token ? c : null;
  }
  /* post to the brand's channel (or another it picked, or a thread): { ts, channel, team } or { error } in plain words */
  const joined = new Set();
  async function slackPost(slug, { channel, text, blocks, thread_ts, update } = {}) {
    const c = await slackOf(slug); if (!c) return { error: 'Connect Slack first.', connect: true };
    const ch = channel || c.channel; if (!ch) return { error: 'Pick a Slack channel: connect Slack again and choose one.' };
    /* a top-level post goes to a channel Brew has joined, so the thread's replies come back (joined once per channel) */
    if (!thread_ts && !update && !joined.has(`${c.team}:${ch}`)) { await slackJoin(c.token, ch); joined.add(`${c.team}:${ch}`); }
    try { const r = await slackApi(c.token, update ? 'chat.update' : 'chat.postMessage', { channel: ch, text: String(text || '').slice(0, 39000), ...(blocks ? { blocks } : {}), ...(thread_ts ? { thread_ts } : {}), ...(update ? { ts: update } : {}), unfurl_links: false, unfurl_media: false });
      return { ts: r.ts, channel: r.channel || ch, team: c.team, channelName: ch === c.channel ? c.channelName : null };
    } catch (e) { log.warn('[slack] post', slug, e.message); if (['invalid_auth', 'token_revoked', 'account_inactive'].includes(e.slack)) await editC(slug, (x) => { if (x.slack) x.slack = { ...x.slack, state: 'error', error: slackWhy(e), errorAt: Date.now() }; }).then(() => cache.delete(sk(slug)));
      return { error: slackWhy(e) }; }
  }
  /* a link that opens a post (or its thread) in Slack */
  async function slackLink(slug, channel, ts) { const c = await slackOf(slug); if (!c) return null;
    try { return (await slackApi(c.token, 'chat.getPermalink', { channel, message_ts: ts }, { get: true })).permalink || null; } catch { return null; } }
  /* the channels Brew can post to: public ones (chat:write.public) and private ones it was invited to */
  async function slackChannels(slug) {
    const c = await slackOf(slug); if (!c) return { error: 'Connect Slack first.', connect: true };
    try { const out = []; let cursor = '';
      for (let i = 0; i < 5; i++) { const r = await slackApi(c.token, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 200, ...(cursor ? { cursor } : {}) }, { get: true });
        for (const x of r.channels || []) if (!x.is_private || x.is_member) out.push({ id: x.id, name: `#${x.name}`, member: !!x.is_member });
        cursor = r.response_metadata?.next_cursor; if (!cursor) break; }
      out.sort((a, b) => (b.id === c.channel) - (a.id === c.channel) || b.member - a.member || a.name.localeCompare(b.name));
      return { channels: out.slice(0, 300), channel: c.channel, channelName: c.channelName, team: c.teamName };
    } catch (e) { return { error: slackWhy(e) }; }
  }
  /* who wrote in Slack: their name, and their email when Slack shares it (so a teammate is the same person in Brew) */
  const people = new Map();
  async function slackUser(slug, user) {
    const k = `${slug}:${user}`; if (people.has(k)) return people.get(k);
    const c = await slackOf(slug); let u = { id: user, name: 'Someone in Slack', email: null };
    if (c) try { const r = await slackApi(c.token, 'users.info', { user }, { get: true }); u = { id: user, name: r.user?.profile?.real_name || r.user?.real_name || r.user?.name || u.name, email: r.user?.profile?.email || null, bot: !!r.user?.is_bot }; } catch {}
    people.set(k, u); return u;
  }
  /* a Slack workspace → the brand that connected it (one workspace may serve one brand; the latest connection wins) */
  const teams = new Map();
  async function slackSlug(team) {
    if (!team) return null; if (teams.has(team)) return teams.get(team);
    let found = null, at = 0;
    for (const { slug } of await packs.list().catch(() => [])) { const s = (await conns(slug).catch(() => ({})))?.slack; if (s?.account?.id === team && !s.sim && (s.at || 0) >= at) { found = slug; at = s.at || 0; } }
    if (found) teams.set(team, found); return found;
  }
  /* the brand a Shopify store is connected to (shopify-app.js: webhooks, the embedded app), newest connection wins */
  const shops = new Map();
  async function shopSlug(shop) {
    if (!shop) return null; const hit = shops.get(shop); if (hit && (await conns(hit).catch(() => ({})))?.shopify?.account?.id === shop) return hit;
    let found = null, at = 0;
    for (const { slug } of await packs.list().catch(() => [])) { const s = (await conns(slug).catch(() => ({})))?.shopify; if (s?.account?.id === shop && !s.sim && (s.at || 0) >= at) { found = slug; at = s.at || 0; } }
    if (found) shops.set(shop, found); else shops.delete(shop); return found;
  }
  /* how a brand's Shopify is connected: 'brew' (Brew's own app), 'own' / 'own-oauth' (the brand's app) or 'token'; null when not */
  const shopApp = async (slug) => (await vault.load(slug, 'shopify').catch(() => null))?.app || null;
  /* Slack says the app was removed or its token revoked: the brand's Slack is disconnected */
  async function slackGone(team) { const slug = await slackSlug(team); teams.delete(team); if (slug) { const r = await disconnect(slug, 'slack').catch(() => null); if (r?.protected) log.warn(`[slack] ${slug}: Slack says the app was removed; the brand is protected, so its connection is kept`); } return slug; }
  async function slackRoutes(req, res, u) {
    const m = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/slack\/(channels|post)$/); if (!m) return false;
    const [, slug, what] = m, me = auth.user(req); if (!me) return json(res, 401, { error: 'Sign in with Google first.', signin: true }), true;
    const access = await auth.claimInfo(slug, me); if (!access.role) return json(res, 403, { error: 'Only the brand’s team posts to its Slack.' }), true;
    if (what === 'channels' && req.method === 'GET') return json(res, 200, await slackChannels(slug)), true;
    if (what === 'post' && req.method === 'POST') { const b = await body(req);
      const title = String(b.title || '').slice(0, 300), sub = String(b.sub || '').slice(0, 1200), note = String(b.note || '').slice(0, 600), link = /^https:\/\//.test(String(b.url || '')) ? String(b.url) : null;
      if (!title) return json(res, 400, { error: 'Nothing to post.' }), true;
      const who = me.name || me.email, text = `${note ? `${note}\n` : ''}*${title}*${sub ? `\n${sub}` : ''}${link ? `\n<${link}|Open it in Brew>` : ''}`;
      const blocks = [...(note ? [{ type: 'section', text: { type: 'mrkdwn', text: note } }] : []), { type: 'section', text: { type: 'mrkdwn', text: `*${title}*${sub ? `\n${sub}` : ''}` } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `Shared from Brew by ${who}` }] }, ...(link ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in Brew' }, url: link, action_id: 'open' }] }] : [])];
      return json(res, 200, await slackPost(slug, { channel: b.channel, text, blocks })), true; }
    return false;
  }

  return { handle: async (req, res, u) => (await slackRoutes(req, res, u)) || handle(req, res, u), sim: SIM, slackOf, slackPost, slackLink, slackChannels, slackUser, slackSlug, slackGone, shopSlug, shopApp, liveOf, forViewer, connectedIds, drop: (slug) => cache.delete(sk(slug)), liveView, sync, disconnect, finish, tick, ageCheck, expiryCheck, CONNECTORS };
}
