// Live data behind the Catalog and AI visibility watchers. Nothing here is scripted:
//   Catalog        · the brand's public catalog (products.json), every 3 hours, free. Each pass is compared with
//                    the last one and with the prices the cards quote (the fact sheet), and every real change is an event.
//   AI visibility  · a fixed set of shopper questions asked weekly, from India, to the real ChatGPT, Gemini and
//                    Perplexity (their consumer answers, via treg) and to Claude with web search. We read whether
//                    the brand is named, which rivals are, and which sites the answers cite, and compare with last week.
// One shared snapshot for every tenant, kept on disk and in GCS so a deploy refetches nothing.
// Watchers turn events into cards; a tenant sees each event once.
import { isLeader } from './roles.js'; // only the background lease holder reads; other instances serve the snapshot
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { productFromPage, offeringFromPage } from './reader/products.js';
import { UA as BROWSER_UA, brandRe } from './reader/util.js';
import { askMarket, DFS_LOC } from './market.js';
import { movedAway } from './moved.js'; // staging: a brand moved to production is not refreshed here in the background

const H = 3600e3, D = 24 * H;
const BUCKET = process.env.RESEARCH_BUCKET || 'brew-prototype';
export const CADENCE = { catalog: 3 * H, visibility: 7 * D };
/* a failed read waits before the next try, so a broken source (a 402, a dead store) does not pay again every 15-minute tick:
   the free catalog read retries after an hour, the AI visibility read (about $0.50 a run in Claude and treg) after six */
export const RETRY = { catalog: H, visibility: 6 * H };

// what shoppers in India ask an AI before buying a hair-fall product. Unbranded first: that's where new buyers come from.
export const ENGINES = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude' };

const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
const strip = (md) => String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_#>`|]/g, '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// One instance per brand (server.js makes it with the brand pack). Snapshot: brands/<slug>/live-watch.json.
export function createLiveWatch({ ROOT, anthropic, claudeParams, textOf, gToken, brand, tregClient = null, namePass = null, objects = null, log = console }) {
  /* asked from the brand's market in its language (market.js askMarket), one rule for every tool: a brand whose market is
     still to confirm is asked from its best candidate, never India by default */
  const cfg = brand.config, AM = askMarket({ country: cfg.country, locale: cfg.locale, market: cfg.market }, cfg), FACTS = brand.facts || {}, HOST = brand.host, IN = DFS_LOC[AM.cc] || cfg.locationCode || 2840, GEO = AM.cc, LANG = AM.lang;
  const QUESTIONS = cfg.questions || [], RIVALS = cfg.rivalsAI || cfg.rivals || [];
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRe = brandRe(brand.name, [cfg.brandName].filter(Boolean), HOST) /* "PUMA India" or "PUMA" */, hostRe = new RegExp(`(^|\\.)${esc(HOST)}$`);
  const named = (s) => nameRe.test(s);
  const inr = (n) => brand.money(n);
  const OBJECT = `brands/${brand.slug}/live-watch.json`;
  const LOCAL = path.join(ROOT, '.research', brand.slug); fs.mkdirSync(LOCAL, { recursive: true });
  let snap = { catalog: null, visibility: null };
  const listeners = [], running = new Set(), spent = { treg: 0, claude: 0 };

  /* ---------- storage ---------- */
  const gcs = async (method, buf) => {
    if (objects) { if (method === 'PUT') return objects.put(OBJECT, buf, 'application/json'); const b = await objects.get(OBJECT); if (b == null) throw new Error('gcs GET 404'); return b; } /* STORAGE=pg: a row */
    const tk = await gToken();
    const url = method === 'PUT' ? `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(OBJECT)}` : `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(OBJECT)}?alt=media`;
    const r = await fetch(url, { method: method === 'PUT' ? 'POST' : 'GET', headers: { authorization: `Bearer ${tk}`, ...(buf ? { 'content-type': 'application/json' } : {}) }, body: buf, signal: AbortSignal.timeout(60e3) });
    if (!r.ok) throw new Error(`gcs ${method} ${r.status}`);
    return method === 'PUT' ? true : Buffer.from(await r.arrayBuffer());
  };
  const persist = () => { const buf = Buffer.from(JSON.stringify(snap)); fs.writeFileSync(path.join(LOCAL, 'live-watch.json'), buf); gcs('PUT', buf).catch((e) => log.warn('[live] gcs save', e.message)); };
  /* another instance (the background leader) saved a newer snapshot: this one serves it (Postgres NOTIFY) */
  let unwatch = null; objects?.onChange?.((k) => { if ((k === OBJECT || k === '*') && !isLeader() && !stopped) load().catch(() => {}); })?.then?.((u) => { unwatch = u; })?.catch?.(() => {});
  const load = async () => {
    let s = null;
    try { s = JSON.parse((await gcs('GET')).toString()); } catch (e) { log.warn('[live] no gcs snapshot:', e.message); }
    if (!s) try { s = JSON.parse(fs.readFileSync(path.join(LOCAL, 'live-watch.json'), 'utf8')); } catch {}
    if (s) snap = { ...snap, ...s };
    log.log(`[live] ${brand.slug} loaded: ${Object.entries(snap).map(([k, v]) => `${k} ${v?.fetchedAt ? new Date(v.fetchedAt).toISOString().slice(0, 16) : 'none'}`).join(', ')}`);
  };

  /* ---------- treg ---------- */
  const tregAuth = () => {
    if (process.env.TREG_TOKEN) return { token: process.env.TREG_TOKEN, org: process.env.TREG_ORG || 'squareup' };
    try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.treg', 'config.json'), 'utf8')); return { token: c.token, org: c.active_org || 'squareup' }; } catch { return null; }
  };
  async function treg(id, body, timeout = 150e3) {
    // the shared client when there is one: its 24-hour cache and one meter
    if (tregClient) { const u0 = tregClient.meter.usd; try { return await tregClient.dfs(id, body, { timeout, tag: `live-${brand.slug}` }); } finally { spent.treg += tregClient.meter.usd - u0; } }
    const a = tregAuth(); if (!a?.token) throw new Error('no TREG_TOKEN');
    const r = await fetch(`https://treg.to/call/${id}`, { method: 'POST', signal: AbortSignal.timeout(timeout),
      headers: { 'X-Treg-Token': a.token, 'X-Treg-Org': a.org, 'X-Treg-Client': 'shopos-feed', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    spent.treg += +(r.headers.get('x-treg-cost-micro') || 0) / 1e6;
    if (!r.ok) throw new Error(`treg ${id} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json(); const task = j.tasks?.[0];
    if (task && task.status_code !== 20000) throw new Error(`treg ${id}: ${task.status_message}`);
    return task?.result?.[0] || null;
  }

  /* ---------- Catalog: the brand's store ---------- */
  // fact keys the cards quote, by store handle (src: <host>/products/<handle>)
  /* off Shopify a fact's source is the product page itself (host + path): matched to the watched pages (cfg.catalogPages) */
  const pagePath = new Map((cfg.catalogPages || []).map((x) => { try { const u = new URL(x.url); return [u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''), x.handle]; } catch { return [null, null]; } }).filter(([k]) => k));
  const quoted = Object.entries(FACTS).filter(([k, f]) => f.kind === 'price' && !k.endsWith('_mrp') && ((f.src || '').startsWith(HOST + '/products/') || pagePath.has(String(f.src || '').replace(/^www\./, '').replace(/\/$/, '')))).map(([k, f]) => ({ key: k, handle: pagePath.get(String(f.src || '').replace(/^www\./, '').replace(/\/$/, '')) || f.src.split('/').pop(), n: f.n }));
  /* the watched product pages, opened again with a browser's user agent (stores refuse bots): a page that 404s is gone,
     one that fails to open is not news */
  async function pageItems() {
    const out = [], gone = new Set(), list = cfg.catalogPages || [];
    for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(async (x) => { try {
      const r = await fetch(x.url, { headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en' }, signal: AbortSignal.timeout(25e3) }); if (r.status === 404 || r.status === 410) { gone.add(x.handle); return; } if (!r.ok) return;
      const html = await r.text(); const it = x.kind === 'offering' ? offeringFromPage(html, x.url) : productFromPage(html, x.url); if (!it) return;
      out.push({ handle: x.handle, title: it.title, type: it.type || '', price: it.price || 0, mrp: Math.max(it.mrp || 0, it.price || 0), inStock: it.inStock !== false, variants: it.variants || 1, images: (it.images || []).length, img: it.images?.[0] || null, published: null, url: x.url }); } catch {} }));
    return { items: out, gone };
  }
  async function refreshCatalog() {
    if (!cfg.catalogUrl && !(cfg.catalogPages || []).length) return 0; // nothing to watch: the build's catalog read stands
    const now = Date.now(), products = [];
    let items, partial = null;
    if (!cfg.catalogUrl) { partial = await pageItems(); if (!partial.items.length && !partial.gone.size) throw new Error(`${HOST}: none of the ${cfg.catalogPages.length} product pages opened`); items = partial.items; }
    else {
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`${cfg.catalogUrl}?limit=250&page=${page}`, { headers: { 'user-agent': 'Brew-catalog-watch/1' }, signal: AbortSignal.timeout(30e3) });
      if (!r.ok) throw new Error(`${HOST} products.json ${r.status}`);
      const { products: ps = [] } = await r.json(); products.push(...ps); if (ps.length < 250) break;
    }
    if (!products.length) throw new Error(`${HOST} returned no products`);
    items = products.map((p) => { const vs = p.variants || [], v = vs[0] || {}; const price = +v.price || 0;
      return { handle: p.handle, title: String(p.title || '').replace(/\s+/g, ' ').trim(), type: p.product_type || '', price, mrp: Math.max(+v.compare_at_price || 0, price), inStock: vs.some((x) => x.available), variants: vs.length, images: (p.images || []).length, img: p.images?.[0]?.src || null, published: p.published_at, url: `https://${HOST}/products/${p.handle}` }; });
    }
    const prev = snap.catalog, before = new Map((prev?.items || []).map((x) => [x.handle, x])), by = new Map(items.map((x) => [x.handle, x]));
    const ev = [], day = new Date(now).toISOString().slice(0, 10), add = (e) => ev.push({ ...e, at: now });
    // cards quote these prices: a live price that differs means every card that says the old one is now wrong
    const drift = quoted.map((q) => ({ ...q, p: by.get(q.handle) })).filter((q) => q.p && Math.round(q.p.price * 100) !== Math.round(q.n * 100) && inr(q.n) !== inr(q.p.price)); // paise count: ₹1,850.40 is not a change from ₹1,850
    if (drift.length) add({ id: 'cat-drift-' + sha(drift.map((q) => q.handle + q.p.price).join()), kind: 'drift', items: drift.map((q) => ({ title: q.p.title, url: q.p.url, was: inr(q.n), now: inr(q.p.price) })) });
    const gone = quoted.map((q) => ({ ...q, p: by.get(q.handle) })).filter((q) => !q.p && (!partial || partial.gone.has(q.handle)));
    if (gone.length) add({ id: 'cat-gone-quoted-' + sha(gone.map((q) => q.handle).join()), kind: 'gone', quoted: true, items: gone.map((q) => ({ title: q.key, url: `https://${HOST}/products/${q.handle}` })) });
    // stock: ONE reading of everything sold out, naming the products our cards and ads point to (urgent when there are any). Two
    // readings (ours, and a roll-up that held them again) showed as two cards, 74 and 373 (QA FEED-11, 19 Oct)
    const oos = items.filter((x) => !x.inStock), oosQuoted = oos.filter((x) => quoted.some((q) => q.handle === x.handle));
    if (oos.length) add({ id: 'cat-oos-' + sha(oos.map((x) => x.handle).join()), kind: 'oos', ...(oosQuoted.length ? { urgent: true } : {}), quoted: oosQuoted.map((x) => x.handle), items: oos });
    if (prev) {
      const back = items.filter((x) => x.inStock && before.get(x.handle) && !before.get(x.handle).inStock);
      if (back.length) add({ id: 'cat-back-' + day + sha(back.map((x) => x.handle).join()), kind: 'back', items: back });
      const moved = items.filter((x) => before.get(x.handle) && Math.round(before.get(x.handle).price) !== Math.round(x.price)).map((x) => ({ ...x, was: before.get(x.handle).price }));
      if (moved.length) add({ id: 'cat-price-' + sha(moved.map((x) => x.handle + x.price).join()), kind: 'price', items: moved });
      const removed = [...before.values()].filter((x) => !by.has(x.handle) && (!partial || partial.gone.has(x.handle)));
      if (removed.length) add({ id: 'cat-removed-' + sha(removed.map((x) => x.handle).join()), kind: 'removed', items: removed });
    }
    // launched in the last 14 days (or since the last pass)
    const fresh = items.filter((x) => (prev && !partial && !before.has(x.handle)) || (x.published && now - Date.parse(x.published) < 14 * D));
    if (fresh.length) add({ id: 'cat-new-' + sha(fresh.map((x) => x.handle).join()), kind: 'new', items: fresh });
    // listings catalog ads can't show well: one photo or none
    const thin = items.filter((x) => x.inStock && x.images <= 1);
    if (thin.length) add({ id: 'cat-thin-' + sha(thin.map((x) => x.handle).join()), kind: 'thin', items: thin });
    const known = new Set((prev?.events || []).map((e) => e.id));
    const events = [...ev.filter((e) => !known.has(e.id)), ...(prev?.events || [])].slice(0, 40);
    /* a page-by-page watch keeps what it couldn't open from the last pass, so nothing flips to "new" or "removed" on a failed fetch */
    if (partial && prev) for (const x of prev.items || []) if (!by.has(x.handle) && !partial.gone.has(x.handle)) items.push(x);
    snap.catalog = { fetchedAt: now, count: items.length, items, events, source: `${HOST} catalog${partial ? ' (product pages)' : ''}` };
    return ev.filter((e) => !known.has(e.id)).length;
  }

  /* ---------- AI visibility ---------- */
  const ask = {
    chatgpt: async (q) => { const r = await treg('dataforseo.x.ai-optimization-chat-gpt-llm-scraper-live-advanced', [{ keyword: q, location_code: IN, language_code: LANG, force_web_search: true }]);
      return r && { text: r.markdown || '', sources: (r.sources || []).map((s) => s.url || s.domain).filter(Boolean), brands: (r.brand_entities || []).map((b) => b.title || b.name).filter(Boolean), model: r.model }; },
    gemini: async (q) => { const r = await treg('dataforseo.x.ai-optimization-gemini-llm-scraper-live-advanced', [{ keyword: q, location_code: IN, language_code: LANG }]);
      return r && { text: r.markdown || '', sources: (r.sources || []).map((s) => s.url || s.domain).filter(Boolean), model: r.model }; },
    perplexity: async (q) => { const r = await treg('dataforseo.x.ai-optimization-perplexity-llm-responses-live', [{ user_prompt: q, model_name: 'sonar', web_search_country_iso_code: GEO, max_output_tokens: 1200 }]);
      const sec = (r?.items || []).flatMap((i) => i.sections || []); return r && { text: sec.map((s) => s.text).join('\n'), sources: sec.flatMap((s) => (s.annotations || []).map((a) => a.url)).filter(Boolean), model: r.model_name }; },
    claude: async (q) => {
      if (!anthropic) throw new Error('no Claude key');
      if (anthropic.provider === 'gemini') throw new Error('Claude is not asked while Brew runs on Gemini'); // its answer would be Gemini's, labelled Claude
      const messages = [{ role: 'user', content: q }]; let text = '', sources = [];
      for (let turn = 0; turn < 3; turn++) {
        const p = claudeParams(messages, 2500); p.system = `You are a helpful assistant. The user is in ${cfg.countryName || 'their country'}.`; p.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: GEO, timezone: cfg.timezone || 'UTC' } }];
        const msg = await anthropic.beta.messages.create(p);
        spent.claude += ((msg.usage?.input_tokens || 0) * 3 + (msg.usage?.output_tokens || 0) * 15) / 1e6;
        text += textOf(msg); (msg.content || []).forEach((b) => { if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((x) => x.url && sources.push(x.url)); (b.citations || []).forEach((c) => c.url && sources.push(c.url)); });
        if (msg.stop_reason !== 'pause_turn') break; messages.push({ role: 'assistant', content: msg.content });
      }
      return { text, sources: [...new Set(sources)], model: 'claude' };
    }
  };
  const read = (q, engine, r) => {
    const plain = strip(r.text), doms = [...new Set((r.sources || []).map(domainOf).filter(Boolean))];
    const rivals = RIVALS.filter((b) => new RegExp(`\\b${b.replace(/ /g, '\\s+')}\\b`, 'i').test(plain) || (r.brands || []).some((x) => new RegExp(b, 'i').test(x)));
    const at = plain.search(nameRe), sentence = at >= 0 ? plain.slice(Math.max(0, plain.lastIndexOf('.', at) + 1), (plain.indexOf('.', at) + 1) || at + 200).trim() : '';
    /* the whole answer is kept (up to 3,000 characters) with the brands it names and its sources: the proof sheet shows them */
    return { q: q.id, engine, named: named(plain), citesBrand: doms.some((d) => hostRe.test(d)), rivals, domains: doms.slice(0, 8), said: sentence.slice(0, 240), excerpt: plain.slice(0, 280), text: plain.slice(0, 3000), brands: (r.brands || []).slice(0, 20), sources: [...new Set(r.sources || [])].slice(0, 8), model: r.model || '' };
  };
  /* the question set a run asked: a run whose set differs from the brand's now is out of date and runs again (team questions
     added one by one are asked on their own, askOne, and never re-run the rest) */
  const qKey = (qs) => JSON.stringify((qs || []).filter((q) => q?.why?.kind !== 'team').map((q) => [q.id, q.q]));
  const qsOf = (qs) => (qs || []).map(({ id, q, branded, why }) => ({ id, q, ...(branded != null ? { branded } : {}), ...(why ? { why } : {}) }));
  const engines = () => Object.keys(ENGINES).filter((e) => e !== 'claude' || anthropic?.provider !== 'gemini'); // no Claude ask on Gemini
  async function refreshVisibility() {
    const now = Date.now(), answers = [], failed = [];
    const jobs = QUESTIONS.flatMap((q) => engines().map((e) => [q, e]));
    for (let i = 0; i < jobs.length; i += 6) {
      await Promise.all(jobs.slice(i, i + 6).map(async ([q, e]) => {
        try { const r = await ask[e](q.q); if (r?.text) answers.push(read(q, e, r)); else failed.push(`${e}: ${q.id} (empty)`); }
        catch (err) { failed.push(`${e}: ${q.id} (${err.message.slice(0, 80)})`); }
      }));
    }
    if (answers.length < jobs.length / 2) throw new Error(`only ${answers.length} of ${jobs.length} answers: ${failed.slice(0, 3).join('; ')}`);
    const prev = snap.visibility?.runs?.[0] || null;
    const run = { at: now, answers, failed, named: answers.filter((a) => a.named).length, total: answers.length, qs: qsOf(QUESTIONS), qKey: qKey(QUESTIONS) };
    run.brandsPass = await brandsOf(answers); /* which brands each answer names (reader/stages/named.js): the AI answers card compares against them */
    const ev = [], day = new Date(now).toISOString().slice(0, 10), add = (e) => ev.push({ ...e, at: now, run: now });
    add({ id: 'vis-score-' + day, kind: 'score', named: run.named, total: run.total, was: prev ? { named: prev.named, total: prev.total } : null,
      byEngine: Object.keys(ENGINES).map((e) => ({ engine: e, named: answers.filter((a) => a.engine === e && a.named).length, total: answers.filter((a) => a.engine === e).length })) });
    for (const q of QUESTIONS) {
      const as = answers.filter((a) => a.q === q.id); if (!as.length) continue;
      const rivals = [...new Set(as.flatMap((a) => a.rivals))], doms = [...new Set(as.flatMap((a) => a.domains))].filter((d) => !hostRe.test(d)).slice(0, 4);
      const yes = as.filter((a) => a.named).map((a) => a.engine);
      const was = prev ? prev.answers.filter((a) => a.q === q.id && a.named).map((a) => a.engine) : null;
      const won = was ? yes.filter((e) => !was.includes(e)) : [], lost = was ? was.filter((e) => !yes.includes(e)) : [];
      if (won.length) add({ id: `vis-win-${q.id}-${day}`, kind: 'win', q: q.q, engines: won, yes, of: as.length, said: as.find((a) => a.engine === won[0])?.said });
      if (lost.length) add({ id: `vis-loss-${q.id}-${day}`, kind: 'loss', q: q.q, engines: lost, yes, of: as.length, rivals });
      if (!yes.length && rivals.length) add({ id: `vis-gap-${q.id}-${day}`, kind: 'gap', q: q.q, of: as.length, rivals: rivals.slice(0, 4), domains: doms, excerpt: as.find((a) => a.rivals.length)?.excerpt });
    }
    snap.visibility = { fetchedAt: now, runs: [run, ...(snap.visibility?.runs || [])].slice(0, 8), events: [...ev, ...(snap.visibility?.events || [])].slice(0, 60), source: `${[...new Set(answers.map((a) => ENGINES[a.engine] || a.engine))].join(', ')}, asked from ${cfg.countryName || 'your market'}` }; /* only the tools that answered */
    return ev.length;
  }

  /* ---------- schedule ---------- */
  const JOBS = { catalog: refreshCatalog, visibility: refreshVisibility };
  async function refresh(which = Object.keys(JOBS)) {
    const done = [];
    for (const k of which) {
      if (running.has(k)) continue; running.add(k); const t0 = Date.now(), b = { ...spent };
      try { const n = await JOBS[k](); done.push(k); delete failed[k]; if (snap[k]) delete snap[k].lastError; persist(); log.log(`[live] ${brand.slug} ${k} ok in ${Math.round((Date.now() - t0) / 1000)}s · ${n} new events · treg $${(spent.treg - b.treg).toFixed(3)} · claude ~$${(spent.claude - b.claude).toFixed(3)}`); }
      catch (e) { log.warn(`[live] ${brand.slug} ${k} failed, keeping the last good data:`, e.message); failed[k] = Date.now();
        /* saved with the snapshot, so a restart or deploy waits out the retry too */
        if (snap[k]) { snap[k].lastError = { at: failed[k], msg: e.message }; persist(); } }
      finally { running.delete(k); }
    }
    if (done.length) listeners.forEach((f) => f(done));
    return done;
  }
  const failed = {};
  const failedAt = (k) => Math.max(failed[k] || 0, snap[k]?.lastError?.at || 0);
  /* the brand's questions were sourced again (ai-questions.js, each with its why): the next tick asks the new set. A set from before
     sourcing never triggers this, so a deploy re-asks nothing on its own */
  const stale = (k) => k === 'visibility' && QUESTIONS.some((q) => q?.why) && snap.visibility?.runs?.[0] && snap.visibility.runs[0].qKey !== qKey(QUESTIONS);
  const due = () => Object.keys(JOBS).filter((k) => (!snap[k] || Date.now() - snap[k].fetchedAt > CADENCE[k] || stale(k)) && !(Date.now() - failedAt(k) < RETRY[k]));
  /* the brands each answer names, read from its own text on the fast model (namePass, server.js): { v, at } or { v, at, error }. A failed
     pass is an error, never "names nobody" */
  const brandsOf = async (as) => { if (!namePass || !as.length) return null; const at = new Date().toISOString();
    try { await namePass(as); return { v: 1, at }; } catch (e) { log.warn(`[live] ${brand.slug} brands named`, e.message); return { v: 1, at, error: String(e.message || e).slice(0, 160) }; } };
  /* one question the team added: asked now on every tool and added to the latest run, so its answers show at once (about $0.02) */
  async function askOne(q) {
    const run = snap.visibility?.runs?.[0]; if (!run) throw new Error('The AI answers haven’t been read yet; it is asked in the first check.');
    const out = [], fails = [];
    await Promise.all(engines().map(async (e) => { try { const r = await ask[e](q.q); if (r?.text) out.push(read(q, e, r)); else fails.push(`${e} (empty)`); } catch (err) { fails.push(`${e} (${String(err.message).slice(0, 60)})`); } }));
    if (out.length) await brandsOf(out);
    run.answers = [...run.answers.filter((a) => a.q !== q.id), ...out]; run.qs = [...(run.qs || []).filter((x) => x.id !== q.id), ...qsOf([q])];
    run.named = run.answers.filter((a) => a.named).length; run.total = run.answers.length; persist(); listeners.forEach((f) => f(['visibility']));
    return { asked: out.length, failed: fails };
  }
  const start = async () => {
    await load();
    /* a run from before the brands pass gets it once (one fast-model call), so the AI answers card compares against who it names */
    const r0 = snap.visibility?.runs?.[0]; if (r0?.answers?.length && !r0.brandsPass && namePass && !process.env.LIVE_OFF) brandsOf(r0.answers).then((x) => { if (x) { r0.brandsPass = x; persist(); listeners.forEach((f) => f(['visibility'])); } });
    const tick = () => { if (!isLeader() || movedAway(brand?.slug)) return; const d = due(); if (d.length && !process.env.LIVE_OFF) refresh(d); };
    stopped = false; clearTimeout(timers.t); clearInterval(timers.i);
    timers.t = setTimeout(() => { if (!stopped) tick(); }, 8000); timers.i = setInterval(() => { if (!stopped) tick(); }, 15 * 60e3); timers.i.unref?.();
  };
  /* a replaced watcher (the brand's rivals, terms or catalog changed) stops: no second timer, no stale listeners */
  let stopped = false; const timers = {};
  const stop = () => { stopped = true; clearTimeout(timers.t); clearInterval(timers.i); listeners.length = 0; unwatch?.(); };
  return { start, stop, refresh, due, askOne, get: () => snap, onRefresh: (f) => listeners.push(f), running: () => [...running], spent: () => ({ ...spent }) };
}
