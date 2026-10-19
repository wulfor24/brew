// Brand Reader: given any brand URL, read the brand for real and stream what it finds to the onboarding screen.
//   createReader({ ai, treg, saveAsset, saveRaw, loadRaw, log }).read(url, { onEvent, signal, only, fresh, free })
//     → { slug, profile, ledger, findings: { steps, cards } }
// Stages: open → brand · catalog → reviews · site · ads (rivals) · answers (+ socials/films) · company.
// Accuracy first: every number goes into the ledger with its source, date and method. Nothing is filled with a
// sample; a stage that finds nothing says so. One failing stage never stops the read.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUrl, slugOf, createFetcher, createLedger, defaultStore, withTimeout, sha, extOf, today, pathOf } from './util.js';
import { open } from './stages/open.js';
import { brand, whoOf } from './stages/brand.js';
import { catalog } from './stages/catalog.js';
import { reviews } from './stages/reviews.js';
import { ads, findRivals, ADS_V } from './stages/ads.js';
import { site, SITE_V, speedOn } from './stages/site.js';
import { pageSpeed, keepSpeed } from '../health.js';
import { answers, inferCategory, writeLine } from './stages/answers.js';
import { socials } from './stages/socials.js';
import { named, namedStale } from './stages/named.js';
import { company } from './stages/company.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STEPS = [
  { k: 'open', t: 'Open the store' },
  { k: 'brand', t: 'Read the brand' },
  { k: 'catalog', t: 'Pull the catalog', agent: 'storefront' },
  { k: 'reviews', t: 'Read what customers say', agent: 'creative' },
  { k: 'ads', t: 'Find live ads, yours and rivals', agent: 'performance' },
  { k: 'site', t: 'Walk the path to checkout', agent: 'storefront' },
  { k: 'answers', t: 'Ask the AI tools', agent: 'visibility' }
];
// per-stage deadlines (ms)
const LIMIT = { open: 45e3, brand: 40e3, catalog: 60e3, reviews: 75e3, category: 40e3, rivals: 70e3, ads: 240e3, site: 200e3, answers: 170e3, named: 100e3, socials: 120e3, company: 150e3 };

/* stages heal() can run again from a saved profile plus the home page (a failed or timed-out one is recorded in meta.errors) */
const RERUN = { reviews, socials, company };
export function createReader({ ai = null, treg = null, saveAsset, saveRaw, loadRaw, log = console, root = ROOT } = {}) {
  const store = defaultStore(root);
  saveAsset ||= store.saveAsset; saveRaw ||= store.saveRaw; loadRaw ||= (saveRaw === store.saveRaw ? store.loadRaw : null);

  // the paid and downloaded services a stage uses (treg, Claude, rendered pages, assets), cached per brand per day
  function services({ slug, http, tregOn, aiOn, fresh }) {
    const svc = {
      // treg with a same-day cache: a rerun reuses the paid answer unless fresh
      async treg(id, o = {}, cacheKey) {
        if (!tregOn) throw Object.assign(new Error('treg is off for this read'), { off: true });
        const key = `treg/${id}-${cacheKey || sha(JSON.stringify(o))}.json`;
        if (!fresh && loadRaw) { const hit = await loadRaw(slug, key).catch(() => null); if (hit && hit.__ok) return hit.data; }
        const data = await treg.call(id, { ...o, tag: 'reader:' + id });
        await saveRaw(slug, key, { __ok: true, id, params: o, at: new Date().toISOString(), data }).catch(() => {});
        return data;
      },
      async dfs(id, body, cacheKey) { const j = await svc.treg(id, { body }, cacheKey); const task = j?.tasks?.[0]; if (task && task.status_code !== 20000) throw new Error(`treg ${id}: ${task.status_message}`); return task?.result?.[0] ?? null; },
      // Claude with the same cache (keyed by the whole request)
      async ai(o) {
        if (!aiOn) throw Object.assign(new Error('AI is off for this read'), { mock: true });
        const key = `ai/${o.tag || 'ai'}-${sha(JSON.stringify([o.model, o.system, o.prompt, o.messages, o.schema, o.search, o.location]))}.json`;
        if (!fresh && loadRaw) { const hit = await loadRaw(slug, key).catch(() => null); if (hit && hit.__ok) return hit.data; }
        const r = await ai.call(o); const data = { text: r.text, json: r.json, cites: r.cites, usd: r.usd, stop: r.stop };
        await saveRaw(slug, key, { __ok: true, at: new Date().toISOString(), tag: o.tag, prompt: o.prompt, data }).catch(() => {});
        return data;
      },
      // a browser-rendered page through treg, for JS-only or bot-blocked pages
      async render(u, key) {
        if (!tregOn) return null;
        try { const j = await svc.treg('litescrape.web.fetch.post', { query: { timeout: 60 }, body: { url: u, respond_with: 'html', engine: 'browser', respond_timing: 'network-idle', remove_overlay: true }, timeout: 75e3 }, key);
          const html = j?.content || j?.html || j?.text; return html ? { html: String(html), url: j.url || u } : null; }
        catch (e) { log.warn?.('[reader] render', u, e.message); return null; }
      },
      // download a file (posters, packshots, logos) and save it as a brand asset; null on failure
      async asset(u, name, { max = 10e6 } = {}) {
        if (!u) return null; const src = String(u).replace(/^\/\//, 'https://');
        try { const r = await http.get(src, { as: 'buf', ms: 25e3 }); if (!r.ok || !r.buf?.length || r.buf.length > max) return null;
          if (/text\/html/.test(r.type)) return null;
          return await saveAsset(slug, name.replace(/[^a-zA-Z0-9._-]+/g, '-') + extOf(r.type, src), r.buf, r.type || 'application/octet-stream'); }
        catch (e) { return null; }
      }
    };
    return svc;
  }

  async function read(input, { onEvent = () => {}, signal, only = null, fresh = false, free = false, prev = null } = {}) { // prev: the brand's last profile (a re-read keeps its rivals, searches and questions)
    const url = normalizeUrl(input); const slug = slugOf(url.href);
    const want = (k) => !only || only.includes(k);
    const ledger = createLedger();
    const profile = blankProfile(url, slug);
    const steps = STEPS.map((s) => ({ ...s, done: null, tick: [], state: 'queued' }));
    const cards = []; const meter = { treg0: treg?.meter?.usd || 0, ai0: ai?.meter?.usd || 0 };
    const picks = {}; /* the onboarding's taps (products, rivals, who you are): saved with the findings, emitted as the stages learn them */
    const t0 = Date.now();
    const emit = (ev) => { try { onEvent({ ...ev, ms: Date.now() - t0 }); } catch (e) { log.warn?.('[reader] onEvent', e.message); } };
    const stepOf = (k) => steps.find((s) => s.k === k);
    const http = createFetcher({ slug, saveRaw, loadRaw, fresh, signal, log });
    const tregOn = !free && !!treg && treg.live !== false;
    const aiOn = !free && !!ai && ai.live !== false;

    const ctx = {
      url, slug, http, ledger, profile, state: {}, log, signal, free, tregOn, aiOn, saveAsset, saveRaw, today: today(), prev,
      tick(k, t) { const s = stepOf(k); if (!s) return emit({ type: 'sub', k, tick: t }); if (!s.tick.includes(t) && s.tick.length < 12) s.tick.push(t); if (s.state === 'queued') s.state = 'reading'; emit({ type: 'step', k, i: steps.indexOf(s), state: 'reading', tick: t }); },
      finding(k, f, say) { cards.push({ ...f, k }); emit({ type: 'finding', k, i: steps.findIndex((s) => s.k === k), finding: f, ...(say ? { say } : {}) }); },
      /* partial: the step found something but part of it couldn't be checked (a live tour then keeps the saved read's step) */
      done(k, text, state = 'done', { partial = false } = {}) { const s = stepOf(k); if (!s) return emit({ type: 'sub', k, state, done: text }); s.done = text; s.state = state; if (partial) s.partial = true; else delete s.partial; emit({ type: 'step', k, i: steps.indexOf(s), state, done: text, ...(partial ? { partial: true } : {}) }); },
      /* a tap list for the onboarding (k: catalog, rivals, who): an array of items, or { error } when the check didn't go through, never [] for a failure */
      picks(k, items) { picks[k] = items; emit({ type: 'picks', k, items }); },
      ...services({ slug, http, tregOn, aiOn, fresh }),
    };
    /* who you are, again whenever the category or Claude's line lands (the brand stage sends the first one) */
    const who = () => { const w = whoOf(profile); if (JSON.stringify(w) !== JSON.stringify(picks.who)) ctx.picks('who', w); };

    // run one stage with a deadline; a stage that fails or times out gets one more try (paid calls that already
    // answered come back from the same-day cache), then the step says so plainly and the read goes on
    const run = async (k, fn, { step = true } = {}) => {
      if (signal?.aborted) throw signal.reason || new Error('aborted');
      if (!want(k)) return null;
      const s0 = Date.now(); const tries = k === 'open' ? 1 : 2;
      if (step && stepOf(k)) ctx.tick(k, stepOf(k).tick[0] || '…');
      for (let n = 1; ; n++) {
        // a stage that overran its deadline keeps running in the background but can no longer emit
        let dead = false; const guard = (f) => (...a) => (dead ? undefined : f(...a));
        const mine = []; /* this try's cards, dropped if it fails so a retry doesn't save them twice */
        const sctx = { ...ctx, tick: guard(ctx.tick), finding: guard((...a) => { ctx.finding(...a); mine.push(cards[cards.length - 1]); }), done: guard(ctx.done), picks: guard(ctx.picks) };
        try { const r = await withTimeout(fn(sctx), LIMIT[k] || 90e3, k).catch((e) => { dead = true; throw e; }); delete errors[k]; const s = stepOf(k); if (step && s && s.state !== 'done' && s.state !== 'empty') ctx.done(k, s.done || 'nothing found', 'empty'); timings[k] = Date.now() - s0; return r; }
        catch (e) {
          if (signal?.aborted) throw e;
          log.warn?.(`[reader] ${k} failed (try ${n} of ${tries}):`, e.message); errors[k] = e.message; timings[k] = Date.now() - s0;
          const s = stepOf(k);
          if (n < tries) { for (const c of mine) { const i = cards.indexOf(c); if (i >= 0) cards.splice(i, 1); } if (step && s) { s.state = 'reading'; ctx.tick(k, 'trying again'); } continue; }
          if (step && s && s.state !== 'done') ctx.done(k, k === 'open' ? 'could not open the store' : `could not finish (${short(e.message)})`, 'empty');
          return null;
        }
      }
    };
    const errors = {}, timings = {};

    await run('open', open);
    if (!ctx.state.home) {
      // nothing else can run without the home page
      for (const s of steps) if (s.state === 'queued') ctx.done(s.k, 'skipped: the store did not open', 'empty');
      return finish();
    }
    const pBrand = run('brand', brand);
    const pCatalog = run('catalog', catalog);
    const pSocials = run('socials', socials, { step: false });
    const pCategory = pCatalog.then(() => (want('ads') || want('answers') || want('company') ? run('category', inferCategory, { step: false }) : null)).then((r) => { who(); return r; });
    const pReviews = pCatalog.then(() => run('reviews', reviews));
    const pSite = pCatalog.then(() => run('site', site));
    const pRivals = pCategory.then(() => (want('ads') || want('answers') ? run('rivals', findRivals, { step: false }) : null));
    const pAds = pRivals.then(() => { if (errors.rivals) { ctx.state.rivalsNotChecked = errors.rivals; /* "0 rivals" from a failed search is not "no rivals" */ if (!picks.rivals || (Array.isArray(picks.rivals) && !picks.rivals.length)) ctx.picks('rivals', { error: short(errors.rivals) }); } return run('ads', ads); });
    const pAnswers = pCategory.then(() => run('answers', answers)); /* the AI questions need only the category; socials (Films) runs beside it */
    const pCompany = pCategory.then(() => run('company', company, { step: false }));
    await Promise.all([pBrand, pCatalog, pSocials, pReviews, pSite, pAds, pAnswers, pCompany]);
    who();
    // which rivals each AI answer named, now that the rival list is final
    if (profile.ai?.answers?.length) relabelRivals(profile);
    // which brands each answer names, the known rivals or not (one fast-model pass over the saved text)
    if (profile.ai?.answers?.length) await run('named', named, { step: false });
    return finish();

    function finish() {
      for (const s of steps) if (s.state === 'queued' && !want(s.k)) s.state = 'skipped';
      profile.meta = { readAt: new Date().toISOString(), ms: Date.now() - t0, free, only, errors, timings, http: http.stats,
        usd: { treg: +((treg?.meter?.usd || 0) - meter.treg0).toFixed(4), ai: +((ai?.meter?.usd || 0) - meter.ai0).toFixed(4) } };
      const findings = { steps: steps.map(({ k, t, done, tick, agent, state }) => ({ k, t, done, tick, ...(agent ? { agent } : {}), state })), cards, picks };
      emit({ type: 'ready', slug, ms: Date.now() - t0 });
      return { slug, profile, ledger: ledger.list(), findings, opened: !!ctx.state.home }; /* opened false: the store's home page never loaded */
    }
  }
  /** Mend a saved read without reading the brand again: re-run the ads stage when any Ad Library lookup failed or
   *  our own page was never found, and write the one-liner when Claude never did. Returns what changed, or null. */
  async function heal(saved, { findings = null, ledger: L = [], log: lg = log } = {}) {
    const profile = JSON.parse(JSON.stringify(saved)); const slug = profile.slug;
    const ownAds = profile.ads?.own || {};
    const adsBroken = !!profile.host && (!profile.ads || profile.ads.v !== ADS_V || !!ownAds.error || !ownAds.page || (profile.ads.rivals || []).some((r) => r.error) || (profile.rivals || []).length > (profile.ads.rivals || []).length);
    const lineMissing = profile.descriptorBy !== 'claude' && profile.descriptorBy !== 'brand';
    const answersBroken = answersFailed(profile, findings);
    const siteBroken = siteFailed(profile);
    const namedBroken = namedStale(profile); /* the brands each answer names: missing, older, or failed over an hour ago */
    /* a stage the read recorded as failed or timed out (meta.errors: reviews, socials, company) is run again from the saved
       profile and the home page, once a day per stage (meta.healTried), so "No reviews found" never stands for a failed check */
    const tried = profile.meta?.healTried || {};
    const failedStages = Object.keys(profile.meta?.errors || {}).filter((k) => RERUN[k] && !!profile.host && (!tried[k] || Date.now() - Date.parse(tried[k]) >= 864e5));
    /* a read from before the health card's speed part gets PageSpeed; a failed one is kept and tried again a day later */
    const ps = profile.site?.pagespeed, speedMissing = !!profile.host && !siteBroken && speedOn() && (!ps || (!!ps.error && Date.now() - Date.parse(ps.triedAt || ps.at || 0) >= 864e5)); /* triedAt: a kept reading's last failed try */
    if (!adsBroken && !lineMissing && !answersBroken && !namedBroken && !siteBroken && !speedMissing && !failedStages.length) return null;
    const added = [], cards = [], stepsDone = {}, healPicks = {};
    const http = createFetcher({ slug, saveRaw, loadRaw, fresh: false, log: lg });
    const tregOn = !!treg && treg.live !== false, aiOn = !!ai && ai.live !== false;
    const ctx = { url: new URL(profile.url), slug, http, profile, state: { homeUrl: profile.url }, log: lg, tregOn, aiOn, saveAsset, saveRaw, today: today(),
      ledger: { add: (e) => added.push({ layer: 'observed', at: today(), ...e }) },
      tick() {}, finding: (k, f) => { cards.push({ ...f, k }); }, done: (k, text, state = 'done', { partial = false } = {}) => { stepsDone[k] = { done: text, state, ...(partial ? { partial: true } : {}) }; }, picks: (k, items) => { healPicks[k] = items; },
      ...services({ slug, http, tregOn, aiOn, fresh: false }) };
    const changed = [];
    if (adsBroken) { try { await withTimeout(ads(ctx), LIMIT.ads, 'ads'); changed.push('ads'); } catch (e) { lg.warn?.('[reader] heal ads', slug, e.message); } }
    if (lineMissing && aiOn) { try { if (await writeLine(ctx)) changed.push('line'); } catch (e) { lg.warn?.('[reader] heal line', slug, e.message); } }
    // the AI tools step that timed out or failed in the read is asked again (it needs only the saved profile)
    if (answersBroken && (aiOn || tregOn)) {
      try { await withTimeout(answers(ctx), LIMIT.answers, 'answers'); if (profile.rivals?.length && profile.ai?.answers?.length) relabelRivals(profile);
        if (profile.ai?.answers?.length) { changed.push('answers'); if (profile.meta?.errors && profile.ai.questionsBy !== 'template') delete profile.meta.errors.answers; } }
      catch (e) { lg.warn?.('[reader] heal answers', slug, e.message); if (profile.meta) profile.meta.errors = { ...(profile.meta.errors || {}), answers: e.message }; }
    }
    // the brands each answer names, again whenever the answers were asked again (a failure is kept on profile.ai.named)
    if ((namedBroken || changed.includes('answers')) && aiOn && profile.ai?.answers?.length) {
      try { await withTimeout(named(ctx), LIMIT.named, 'named'); changed.push('named'); } catch (e) { lg.warn?.('[reader] heal named', slug, e.message); changed.push('named:failed'); }
    }
    // the checkout walk from an older walker, or one that never reached checkout, is walked again
    if (siteBroken) { try { await withTimeout(site(ctx), LIMIT.site, 'site'); changed.push('site'); } catch (e) { lg.warn?.('[reader] heal site', slug, e.message); } }
    if (speedMissing) { profile.site = { ...(profile.site || {}), pagespeed: keepSpeed(profile.site?.pagespeed, await pageSpeed(profile.url, { log: lg })) }; changed.push('pagespeed'); }
    if (failedStages.length) {
      /* the stages read the home page (review widget, social links): fetched once here, as the open stage did */
      try { const r = await http.get(profile.url, { key: 'heal-home' }); if (r.ok) { ctx.state.home = r.text; ctx.state.homeUrl = r.url || profile.url; ctx.state.origin = new URL(ctx.state.homeUrl).origin; } } catch (e) { lg.warn?.('[reader] heal home', slug, e.message); }
      ctx.state.origin ||= new URL(profile.url).origin; ctx.state.home ||= '';
      for (const k of failedStages) {
        profile.meta = { ...(profile.meta || {}), healTried: { ...(profile.meta?.healTried || {}), [k]: new Date().toISOString() } };
        try { await withTimeout(RERUN[k](ctx), LIMIT[k] || 90e3, k); delete profile.meta.errors[k]; changed.push(k); }
        catch (e) { lg.warn?.(`[reader] heal ${k}`, slug, e.message); profile.meta.errors = { ...(profile.meta.errors || {}), [k]: e.message }; changed.push(`${k}:failed`); /* the stamp is saved, so the stage waits a day */ }
      }
    }
    if (!changed.length) return null;
    const keys = new Set(added.map((e) => e.key));
    const ledger = [...L.filter((e) => !keys.has(e.key)), ...added];
    // new cards replace the old cards of the same step and kind; other cards stay where they were
    const fresh = new Set(cards.map((c) => c.k + '|' + c.kind));
    const f2 = findings ? { ...findings, steps: (findings.steps || []).map((x) => (stepsDone[x.k] ? (({ partial, ...y }) => ({ ...y, ...stepsDone[x.k] }))(x) : x)),
      cards: cards.length ? [...(findings.cards || []).filter((c) => !fresh.has(c.k + '|' + c.kind)), ...cards] : findings.cards, picks: { ...(findings.picks || {}), ...healPicks } } : findings;
    profile.meta = { ...(profile.meta || {}), healedAt: new Date().toISOString(), healed: changed };
    return { profile, ledger, findings: f2, changed };
  }

  return { read, heal, STEPS };
}

/** the checkout walk is from an older walker, or it has products to walk with and never reached checkout */
export function siteFailed(profile) {
  if (!profile.host || !profile.catalog?.products?.length) return false;
  const co = profile.site?.checkout;
  if (!co || co.v !== SITE_V) return true;
  return !(co.walk || []).some((s) => s.step === 'Checkout entry' && s.ok);
}

/** the read's AI tools step failed or timed out and no answers were saved */
export function answersFailed(profile, findings) {
  if (profile.ai?.questionsBy === 'template') return true; // the AI could not write the questions: write them now
  if (profile.ai?.answers?.length) return false;
  if (profile.meta?.errors?.answers) return true;
  const st = (findings?.steps || []).find((x) => x.k === 'answers');
  return !!st && (st.state === 'queued' || st.state === 'reading' || /could not finish|timed out/.test(st.done || ''));
}
const short = (m) => String(m).replace(/\s+/g, ' ').slice(0, 70);

function relabelRivals(profile) {
  const names = (profile.rivals || []).map((r) => r.name).filter(Boolean);
  for (const a of profile.ai.answers) {
    const t = a.plain || a.text || '';
    const found = names.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i').test(t));
    a.rivalsNamed = [...new Set([...(a.rivalsNamed || []), ...found])];
    delete a.plain;
  }
}

export function blankProfile(url, slug) {
  return { url: url.href, host: url.hostname.replace(/^www\./, ''), slug, name: null, tagline: null, descriptor: null, about: null, aboutUrl: null,
    category: null, subcategory: null, country: null, currency: null, locale: null, platform: null,
    identity: { logo: null, mark: null, colors: [], fonts: { heading: null, body: null, mono: null }, typeName: null },
    catalog: { count: null, collections: [], products: [], hero: [] },
    reviews: { platforms: [], total: null, quotes: [] },
    socials: { instagram: null, youtube: null, facebook: null, x: null, linkedin: null, tiktok: null, pinterest: null },
    ads: { own: null, rivals: [] }, rivals: [],
    site: { pages: null, sitemaps: [], keyPages: [], checkout: null, tech: null, policies: { shipping: null, returns: null } },
    ai: { questions: [], answers: [], score: null },
    search: { terms: [], serp: [], trends: null, domain: null },
    company: { founders: [], founded: null, hq: null, funding: [], revenue: [], press: [] } };
}
export { slugOf } from './util.js';
