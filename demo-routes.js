// Demo Mode routes (DEMO_MODE=1): the brand picker, the presenter's controls, a session's own onboarding, and
// "Prepare for demo" (everything slow made ahead: moves, PDFs, first drafts, stories, listening, ideas).
// A session that starts "from onboarding" sees the real read replayed, "Check what we read", and the moves being
// written, without touching the brand's pack: confirming only marks the session, and the moves already exist.
import { demoSid } from './demo-mode.js';
import { SIM_IDS as ALL_SIM_IDS } from './connectors/sim.js';
// Marketplaces is Coming soon (connectors/index.js OFF): the demo doesn't connect it either
const SIM_IDS = ALL_SIM_IDS.filter((id) => id !== 'marketplaces');
import { slugOf } from './brand-pack.js';
import { numbersFor } from './pack-numbers.js'; // one number, one source: the picker shows what every other screen shows
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SES = 'private/demo/session.json';
const MOVE_EVERY_S = 1.8, BRIEF_S = 6; // the replayed build: about 100 seconds from "Looks right" to the last move

export function createDemoRoutes({ packs, builder, auth, connectors, readBody, send, loadBrand, social = null, draftsBg = null, log = console }) {
  const session = async (slug) => (await packs.getJSON(slug, SES, null)) || { flow: 'ready' };
  const setSession = (slug, s) => packs.put(slug, SES, { ...s, at: Date.now() });
  const isAdmin = (req) => { const u = auth.user(req); return !!u && !u.demo && auth.isAdmin(u); };
  const base = (req) => process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

  /* the build as this session sees it: done for a normal session; replayed from "Looks right" for one started from onboarding */
  function simStatus(st, s) {
    if (!st || s?.flow !== 'onboarding') return st;
    const N = +st.total || 50, c = s.confirmedAt, t = c ? (Date.now() - c) / 1000 : -1, n = c ? Math.max(0, Math.min(N, Math.floor((t - BRIEF_S) / MOVE_EVERY_S))) : 0;
    const pdfKeys = Object.keys(st.pdfs || {}).sort((a, b) => +a - +b).slice(0, n);
    return { ...st, stages: { ...st.stages, confirm: c ? { state: 'done', at: c } : { state: 'waiting' }, brief: t >= BRIEF_S ? { state: 'done', at: c + BRIEF_S * 1e3 } : { state: c ? 'running' : 'waiting' },
      moves: n >= N ? { state: 'done', at: Date.now() } : { state: c ? 'running' : 'waiting' } }, movesDone: n, pdfs: Object.fromEntries(pdfKeys.map((k) => [k, st.pdfs[k]])),
      done: n >= N, ready: n >= 10, state: n >= N ? 'Ready' : c ? `Writing the moves: ${n} of ${N}` : 'Read', zips: n >= N ? st.zips : [] };
  }

  /* how ready a brand is for a demo: everything slow is made ahead */
  async function readiness(slug) {
    const st = await packs.getJSON(slug, 'status.json', null); if (!st) return null;
    const [demo, drafts, research, ideas, listen] = await Promise.all([packs.getJSON(slug, 'demo.json', null), packs.getJSON(slug, 'drafts/cards.json', null), packs.getJSON(slug, 'research.json', null),
      packs.getJSON(slug, 'ideas/ideas.json', null), packs.getJSON(slug, 'listen/themes.json', null)]);
    const nDrafts = Object.keys(drafts || {}).length, pdfs = Object.keys(st.pdfs || {}).length;
    const [seed, profile] = await Promise.all([packs.getJSON(slug, 'seed.json', null), packs.getJSON(slug, 'profile.json', null)]);
    const num = await numbersFor(packs.getJSON, slug, { 'status.json': st, 'profile.json': profile, 'research.json': research });
    const N = num.moves.total; /* the playbook (status.total). PDFs are made on download, so they are not something to prepare */
    const checks = [['Read', st.stages?.read?.state === 'done'], [`${N} moves`, num.moves.written >= N], ['Demo accounts', !!demo?.accounts], ['First drafts', nDrafts >= 6], ['Stories', !!research], ['Listening and ideas', !!(ideas?.items?.length || listen)]];
    const prep = PREP.get(slug) || null;
    /* what the card shows: the brand's own colours, three real product photos, and its real size */
    const br = seed?.brand || {}, prods = (profile?.catalog?.products || []).filter((x) => x.images?.[0] && x.inStock !== false);
    const pick = [...new Set([...Object.values(seed?.laneImg || {}).filter((x) => !/logo|mark/i.test(x)), ...prods.slice(0, 8).map((x) => x.images[0])])].slice(0, 3);
    const look = { mark: br.mark || null, logo: br.logo || st.logo || null, colors: br.colors || [], wash: br.wash || [], images: pick,
      tagline: (() => { const t = String(profile?.descriptor || br.tagline || ''), n = String(st.name || ''); return (t.toLowerCase().startsWith(n.toLowerCase()) ? t.slice(n.length).replace(/^\s*[:|\-–]\s*/, '') : t).slice(0, 90); })(),
      category: profile?.category || null, country: profile?.country || null, currency: profile?.currency || null,
      products: num.products.n || null, reviews: +(profile?.reviews?.total || 0) || null,
      /* the brand's OWN live ads (never added to the rivals'), the same count as the read, the check page and the rings; else the pages it read */
      ads: num.ownAds.n || null,
      pages: +(String(((await packs.getJSON(slug, 'findings.json', null))?.steps || []).find((x) => x.k === 'open')?.done || '').replace(/,/g, '').match(/^(\d+) pages/)?.[1] || 0) || null };
    return { slug, name: st.name, host: st.host, logo: st.logo || null, look, moves: num.moves.written, pdfs, drafts: nDrafts, checks: checks.map(([t, ok]) => ({ t, ok })), ready: checks.every(([, ok]) => ok), loaded: num.moves.written >= N, building: !!st.stages && !st.done, prep };
  }

  /* ---------- Prepare for demo: run what is slow now, so nothing waits in the room ---------- */
  const PREP = new Map();
  async function prepare(slug) {
    if (PREP.get(slug)?.running) return PREP.get(slug);
    const P = { running: true, at: Date.now(), steps: [], usd: 0 }; PREP.set(slug, P);
    const step = async (t, f) => { const s = { t, state: 'running' }; P.steps.push(s); try { const r = await f(); s.state = 'done'; s.note = r?.note || null; if (r?.usd) P.usd += r.usd; } catch (e) { s.state = 'failed'; s.note = e.message.slice(0, 160); log.warn('[demo] prepare', slug, t, e.message); } };
    (async () => {
      await step('Load the brand and its demo accounts', async () => { await loadBrand(slug, { fresh: true }); return { note: 'demo.json ready' }; });
      if (draftsBg) await step('First drafts on the top cards', async () => { const r = await draftsBg.runOne(slug, { manual: true, n: 12 }); return { note: r.why || `${r.made?.length || 0} made`, usd: r.usd }; });
      if (social) await step('Listening and ideas', async () => { const d = await social.due(slug); const r = await social.runOne(slug, { ...d, listen: true, ideas: true, listenFull: true }); return { note: r?.why?.join?.(', ') || 'ran' }; });
      await step('Stories', async () => { const b = await loadBrand(slug); await b?.research?.refresh?.().catch(() => {}); return { note: b?.research ? 'refreshed' : 'starts when the brand is opened' }; });
      P.running = false; P.doneAt = Date.now();
    })().catch((e) => { P.running = false; P.error = e.message; });
    return P;
  }

  return async function demoRoutes(req, res, u) {
    const p = u.pathname;
    /* the demo site's front page: the brand picker */
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, PICKER, 'text/html; charset=utf-8'), true;
    /* a tour link from the Brew landing (/tour/<slug>?d=new): a fresh session that starts on the brand's first screen */
    const tm = p.match(/^\/tour\/([a-z0-9-]+)\/?$/);
    if (req.method === 'GET' && tm) { const slug = tm[1], r = await readiness(slug).catch(() => null);
      if (!r?.loaded) return res.writeHead(302, { location: '/' }), res.end(), true;
      await setSession(slug, { flow: 'onboarding', startedAt: Date.now() });
      return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Opening ${r.name.replace(/[<&"]/g, '')}…</title><script>try{Object.keys(localStorage).filter(function(k){return k.indexOf(${JSON.stringify(slug + '-')})===0}).forEach(function(k){localStorage.removeItem(k)})}catch(e){}var u=(location.search.match(/[?&](ui=\\d)/)||[])[1];location.replace(${JSON.stringify('/' + slug)}+(u?'?'+u:''))</script>`, 'text/html; charset=utf-8'), true; }
    if (req.method === 'GET' && p === '/api/demo/brands') {
      const all = await builder.list().catch(() => []), out = [];
      /* every visitor sees the brands that are fully generated (all their moves); admins also see the rest, to prepare them */
      const admin = isAdmin(req);
      for (const b of all) { const r = await readiness(b.slug).catch(() => null); if (r && (r.loaded || (admin && r.moves > 0))) out.push(r); }
      out.sort((a, b) => (b.loaded - a.loaded) || (b.ready - a.ready) || b.moves - a.moves);
      return send(res, 200, { brands: out, admin }), true;
    }
    const sm = p.match(/^\/api\/demo\/([a-z0-9-]+)\/(session|start|connect|prepare)$/);
    if (sm) { const [, slug, what] = sm; if (!(await packs.getJSON(slug, 'status.json', null))) return send(res, 404, { error: 'unknown brand' }), true;
      if (what === 'session') { const s = await session(slug), L = await connectors.liveOf(slug, true);
        return send(res, 200, { sid: demoSid(), flow: s.flow, share: `${base(req)}/${slug}?d=${demoSid()}`, connected: Object.keys(L.live).filter((k) => !L.live[k].gone), all: SIM_IDS, admin: isAdmin(req) }), true; }
      if (what === 'start' && req.method === 'POST') { const b = await readBody(req); await setSession(slug, { flow: b.from === 'onboarding' ? 'onboarding' : 'ready', startedAt: Date.now() });
        if (b.connect === 'all') await Promise.all(SIM_IDS.map((id) => connectors.finish(slug, id, connectors.sim.creds(id), auth.user(req), base(req)).catch((e) => log.warn('[demo] connect', id, e.message)))); /* all at once: the account file is written under a lock */
        return send(res, 200, { ok: true }), true; }
      if (what === 'connect' && req.method === 'POST') { const b = await readBody(req), ids = b.ids === 'all' || !b.ids ? SIM_IDS : [].concat(b.ids).filter((x) => SIM_IDS.includes(x)), me = auth.user(req), out = {};
        await Promise.all(ids.map(async (id) => { out[id] = b.on === false ? await connectors.disconnect(slug, id).then(() => 'off', (e) => e.message) : await connectors.finish(slug, id, connectors.sim.creds(id), me, base(req)).then((r) => (r.ok ? 'on' : r.error), (e) => e.message); }));
        return send(res, 200, { ok: true, out }), true; }
      if (what === 'prepare') { if (req.method === 'POST') { if (!isAdmin(req)) return send(res, 403, { error: 'Only Brew admins prepare brands.' }), true; await prepare(slug); }
        return send(res, 200, await readiness(slug)), true; }
    }
    /* a new brand on the demo site: Brew admins only (a full build is about $80); everyone else picks a prepared one */
    if (req.method === 'POST' && p === '/api/brands' && !isAdmin(req)) { const b = await readBody(req), slug = slugOf(String(b.url || ''));
      if (slug && await packs.getJSON(slug, 'status.json', null)) return send(res, 200, { slug, existing: true, status: await builder.status(slug) }), true;
      return send(res, 200, { error: 'Pick a brand from the list. New brands are prepared by the Brew team before a demo.' }), true; }
    /* the session's own build: replayed status, and confirming only marks the session (the brand's moves already exist) */
    const bm = p.match(/^\/api\/brands\/([a-z0-9-]+)\/(status|confirm|check|updates|retry)$/);
    if (bm) { const [, slug, what] = bm;
      if (what === 'status' && req.method === 'GET') { const st = await builder.status(slug); if (!st) return false; return send(res, 200, simStatus(st, await session(slug))), true; }
      if (what === 'confirm' && req.method === 'POST') { await readBody(req); const s = await session(slug); if (s.flow === 'onboarding' && !s.confirmedAt) await setSession(slug, { ...s, confirmedAt: Date.now() }); return send(res, 200, { ok: true }), true; }
      if (what === 'check' && req.method === 'POST') { await readBody(req); return send(res, 200, { ok: true, notes: ['In the demo, what you change here shows on the page but the read stays as it is.'] }), true; }
      if ((what === 'updates' || what === 'retry') && req.method === 'POST' && !isAdmin(req)) { await readBody(req); return send(res, 200, { error: 'Rewriting moves is off in the demo. Connected accounts already flag the moves that would change.' }), true; }
    }
    return false;
  };
}

/* the demo site's front page (public/demo-picker.html), read once */
const PICKER = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'demo-picker.html'), 'utf8');
