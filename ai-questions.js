// The questions Brew asks the AI tools for a brand, each one earned by evidence that shoppers really ask it
// (Param, 19 Oct: "how do I know which questions were asked? were they the right ones? why should I trust you?").
// Before this, an AI imagined "questions a shopper would type", three times over (the read, the weekly check, the pulse),
// and the sets drifted apart: Arata's weekly check asked about curl creams for a hair-fall brand.
//
// One set per brand, kept in config.json (questions, questionsV, questionsMethod) and asked by the weekly check:
//   1. candidates from real demand: what Google suggests when people start typing about what the brand sells (free, with
//      treg's autocomplete as the fallback), how many people search each phrase a month (treg keyword volume), and the
//      questions people ask in threads Brew's listening found (with the thread's link and replies)
//   2. the brand's own best sellers, for the questions that name the brand
//   3. the fast model only picks and phrases: every question must point at the candidates it rests on, and its "why"
//      line is built from those candidates in code, never written by the model
// A question the team adds ("Add a question your customers ask") is kept through every re-source.
// Nothing here throws to the caller: a source that fails is named in questionsMethod.errors, never shown as "none".
import { askMarket } from './market.js';
import { brandBase } from './reader/util.js';
/* 2: asked from the brand's market and language (market.js askMarket), both of its names, enquiry-led brands phrased as buyers */
export const Q_V = 2;
const MAX_UNB = 5, MAX_BR = 3, MAX_TEAM = 3;
const CNAME = { IN: 'India', US: 'the US', GB: 'the UK', CA: 'Canada', AU: 'Australia', AE: 'the UAE', SG: 'Singapore', DE: 'Germany', FR: 'France' };
const LOC = { IN: 2356, US: 2840, GB: 2826, CA: 2124, AU: 2036, AE: 2784, SA: 2682, SG: 2702, DE: 2276, FR: 2250, NZ: 2554, JP: 2392, IE: 2372, ZA: 2710 };
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim();
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function pool(xs, n, f) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k], k).catch(() => null); } })); return out; }

/* the "why" line a person reads, built from the candidates a question rests on (never from the model's words) */
export function whyOf(refs, { country = 'IN' } = {}) {
  const where = CNAME[country] || country;
  const vol = refs.filter((r) => r.volume > 0).sort((a, b) => b.volume - a.volume)[0];
  if (vol) return { kind: 'search', label: `${fmt(vol.volume)} Google searches a month in ${where} for “${vol.text}”`, value: vol.volume, src: 'Google search volume', url: `https://www.google.com/search?q=${encodeURIComponent(vol.text)}` };
  const sug = refs.find((r) => r.kind === 'suggest');
  if (sug) return { kind: 'suggest', label: `Google suggests “${sug.text}” to people in ${where} who type “${sug.seed}”`, src: 'Google search suggestions', url: `https://www.google.com/search?q=${encodeURIComponent(sug.text)}` };
  const th = refs.find((r) => r.kind === 'thread');
  if (th) return { kind: 'thread', label: `Asked on ${th.platform || 'a forum'}${th.replies ? `, ${fmt(th.replies)} replies` : ''}: “${cut(th.text, 90)}”`, src: th.platform || 'Listening', url: th.url || null };
  const pr = refs.find((r) => r.kind === 'product');
  if (pr) return { kind: 'product', label: `${pr.text} is ${pr.rank === 1 ? 'your best seller' : 'one of your best sellers'}${pr.reviews ? ` (${fmt(pr.reviews)} reviews)` : ''}`, src: 'Your store', url: pr.url || null };
  return null;
}

export function createAiQuestions({ packs, treg = null, ai = null, fetchFn = fetch, log = console }) {
  const aiCall = ai ? (typeof ai === 'function' ? ai : ai.call?.bind(ai)) : null;

  /* Google's own suggestions, free; treg's autocomplete when Google refuses (each call says which answered) */
  const suggest = async (q, gl, errors, hl = 'en', slug = '_brew') => {
    try { const r = await fetchFn(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' } });
      if (r.ok) { const j = JSON.parse(await r.text()); if (Array.isArray(j?.[1])) return j[1].filter((x) => typeof x === 'string'); } throw new Error(`google ${r.status}`); }
    catch (e) {
      if (!treg?.call) { errors.add(`Google suggestions: ${e.message}`); return []; }
      try { const j = await treg.call('serper.google.serp.autocomplete', { body: { q, gl, hl }, tag: `aiq-${slug}` }); return (j?.suggestions || []).map((s) => s.value || s).filter((s) => typeof s === 'string'); }
      catch (e2) { errors.add(`Google suggestions: ${e2.message}`); return []; }
    }
  };
  /* monthly Google searches for each phrase, one treg call for all of them */
  const volumes = async (phrases, loc, errors, lang = 'en', slug = '_brew') => {
    const kws = [...new Set(phrases.map(norm).filter((k) => k && k.split(' ').length <= 10))].slice(0, 300); if (!kws.length || !treg?.call) return {};
    try { const j = await treg.call('dataforseo.google.keywords.volume', { body: [{ keywords: kws, location_code: loc, language_code: lang }], tag: `aiq-${slug}` });
      const t = j?.tasks?.[0]; if (t && t.status_code !== 20000) throw new Error(t.status_message);
      return Object.fromEntries((t?.result || []).filter((r) => r?.keyword).map((r) => [norm(r.keyword), r.search_volume || 0])); }
    catch (e) { errors.add(`Search volumes: ${e.message}`); return {}; }
  };

  async function brandOf(slug) {
    const [p, c, lc, th] = await Promise.all(['profile.json', 'config.json', 'listen/config.json', 'listen/threads.json'].map((n) => packs.getJSON(slug, n, {}).catch(() => ({}))));
    /* the market to ask from (market.js askMarket): never a silent India or US default for a brand whose market is to confirm */
    const profile = p || {}, config = c || {}, am = askMarket(profile, config), country = am.cc;
    const products = (profile.catalog?.products || []).filter((x) => x?.title && !x.pack && x.inStock !== false);
    const heroIds = profile.catalog?.hero || [], heroes = [...products.filter((x) => heroIds.includes(x.handle)), ...products.filter((x) => !heroIds.includes(x.handle))].slice(0, 4);
    const rivals = [...new Set((profile.rivals || []).map((r) => r?.name).filter(Boolean))].slice(0, 6);
    const threads = (th?.threads || []).filter((t) => /\?/.test(t.title || t.quote || '') || t.intent === 'question').sort((a, b) => (b.replies || 0) - (a.replies || 0)).slice(0, 12);
    return { slug, name: profile.name || config.name || slug, base: profile.brandName || brandBase(profile.name || config.name || slug, profile.host), host: profile.host || '', platform: profile.platform || null, enquiry: profile.storeKind === 'enquiry', lang: am.lang, guessed: am.guessed, country, loc: am.loc, noun: lc?.noun || profile.subcategory || profile.category || 'products',
      category: [profile.category, profile.subcategory].filter(Boolean).join(', '), heroes, rivals, threads, config };
  }

  /* what the brand sells, as the short phrases shoppers start a search with ("hair growth serum"): the model reads the best
     sellers once; without it, the category noun */
  async function seedsOf(b) {
    let seeds = [];
    if (aiCall) try {
      const r = await aiCall({ tag: 'ai-questions-seeds', model: 'sonnet', max: 600, schema: { type: 'object', properties: { seeds: { type: 'array', items: { type: 'string' } } }, required: ['seeds'] },
        prompt: `${b.name} (${b.host}) sells: ${b.heroes.map((h) => h.title).join('; ') || b.noun}. Category: ${b.category || b.noun}.\nWrite 5 short generic product phrases (2 to 4 words, no brand names) a shopper in ${CNAME[b.country] || b.country} would start a Google search with when looking for these products, the most important first. Example: "hair growth serum", "anti dandruff shampoo".` });
      seeds = (r?.json?.seeds || []).map(norm).filter((s) => s && ![b.name, b.base].some((n) => n && new RegExp(`\\b${escRe(norm(n))}\\b`).test(s)));
    } catch (e) { log.warn?.('[ai-questions] seeds', b.slug, e.message); }
    return [...new Set([...seeds, norm(b.noun)].filter(Boolean))].slice(0, 5);
  }

  async function candidatesOf(b, errors) {
    const gl = b.country.toLowerCase(), seeds = await seedsOf(b), brand = norm(b.base || b.name), names = [...new Set([norm(b.name), brand])]; /* "PUMA India" is searched as "puma" */
    const starts = seeds.flatMap((s) => [`best ${s}`, `which ${s}`, `${s} for`, `is ${s}`]);
    const bStarts = [`${brand}`, `is ${brand}`, `${brand} vs`, ...b.heroes.slice(0, 2).map((h) => `${brand} ${norm(h.title).split(' ').slice(0, 3).join(' ')}`)];
    const got = await pool([...starts, ...bStarts], 6, async (q) => ({ q, out: await suggest(q, gl, errors, b.lang, b.slug) }));
    const cands = [], seen = new Set();
    const add = (c) => { const k = norm(c.text); if (!k || seen.has(k)) return; seen.add(k); cands.push({ id: `c${cands.length + 1}`, ...c }); };
    for (const g of got.filter(Boolean)) for (const s of g.out.slice(0, 8)) add({ kind: 'suggest', text: s, seed: g.q, branded: names.some((n) => new RegExp(`\\b${escRe(n)}\\b`).test(norm(s))) });
    const vol = await volumes([...cands.map((c) => c.text), ...seeds.map((s) => `best ${s}`)], b.loc, errors, b.lang, b.slug);
    for (const c of cands) c.volume = vol[norm(c.text)] || 0;
    for (const s of seeds) { const k = `best ${s}`; if (!seen.has(k) && vol[k]) add({ kind: 'search', text: k, volume: vol[k], branded: false }); }
    for (const t of b.threads) add({ kind: 'thread', text: cut(t.title || t.quote, 160), platform: t.platform, url: t.url, replies: t.replies || 0, branded: names.some((n) => new RegExp(`\\b${escRe(n)}\\b`).test(norm(t.title || t.quote))) });
    b.heroes.forEach((h, i) => add({ kind: 'product', text: h.title, rank: i + 1, reviews: h.reviews?.count || h.reviews || 0, url: h.url || (b.host && h.handle && (!b.platform || b.platform === 'shopify') ? `https://${b.host}/products/${h.handle}` : null), branded: true }));
    return { seeds, cands };
  }

  /* the model picks and phrases; every pick names its candidates, and a pick that names none is dropped */
  async function pick(b, cands, errors) {
    const list = cands.map((c) => `${c.id} [${c.kind}${c.volume ? `, ${c.volume}/mo` : ''}${c.replies ? `, ${c.replies} replies` : ''}${c.branded ? ', names the brand' : ''}] ${c.text}`).join('\n');
    if (aiCall) try {
      const r = await aiCall({ tag: 'ai-questions-pick', model: 'sonnet', max: 1500, schema: { type: 'object', properties: { questions: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, branded: { type: 'boolean' }, refs: { type: 'array', items: { type: 'string' } } }, required: ['q', 'branded', 'refs'] } } }, required: ['questions'] },
        prompt: `Brew asks ChatGPT, Gemini and Perplexity the questions ${b.enquiry ? 'buyers' : 'shoppers'} in ${CNAME[b.country] || b.country} really ask before ${b.enquiry ? 'choosing' : 'buying'} what ${b.base || b.name} ${b.enquiry ? 'offers (it sells by enquiry, not online)' : 'sells'} (${b.heroes.map((h) => h.title).join('; ') || b.noun}), to see which brands the answers name.\n\nEvidence that shoppers ask these (Google suggestions, monthly Google searches, forum threads, the brand's best sellers):\n${list}\n\nPick ${MAX_UNB} questions that do NOT name ${b.name} or any brand, and ${MAX_BR} that name ${b.name} (one about whether it is good, one comparing it with a rival${b.rivals.length ? ` (its rivals: ${b.rivals.join(', ')})` : ''}, one about its best seller). Rules:\n- Only questions about the products ${b.name} actually sells. Skip anything about products it doesn't sell.\n- Prefer the most searched and the most asked. Cover different products and needs; no two questions alike.\n- Write each one the way a shopper types it into ChatGPT: short, natural, in their words.\n- refs: the ids of the evidence lines the question rests on (at least one, only ids from the list). A question with no evidence is not allowed.` });
      const byId = new Map(cands.map((c) => [c.id, c]));
      const out = (r?.json?.questions || []).map((x) => ({ q: cut(x.q, 160), branded: !!x.branded, refs: (x.refs || []).map((id) => byId.get(id)).filter(Boolean) })).filter((x) => x.q && x.refs.length);
      const re = new RegExp(`\\b(${[...new Set([norm(b.name), norm(b.base || b.name)])].map(escRe).join('|')})\\b`);
      return out.map((x) => ({ ...x, branded: re.test(norm(x.q)) })); /* branded means it names the brand, whatever the model said */
    } catch (e) { errors.add(`Choosing the questions: ${e.message}`); }
    /* no model: the most searched suggestions as they are, and the plain branded ones from the best seller */
    const un = cands.filter((c) => !c.branded && (c.kind === 'suggest' || c.kind === 'search')).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, MAX_UNB).map((c) => ({ q: c.text, branded: false, refs: [c] }));
    const hero = cands.find((c) => c.kind === 'product'), bs = cands.filter((c) => c.branded && c.kind === 'suggest').slice(0, MAX_BR - (hero ? 1 : 0)).map((c) => ({ q: c.text, branded: true, refs: [c] }));
    return [...un, ...bs, ...(hero ? [{ q: b.enquiry ? `is ${b.base || b.name} ${hero.text} a good choice?` : `does ${b.base || b.name} ${hero.text} really work?`, branded: true, refs: [hero] }] : [])];
  }

  /* the whole set for a brand: sourced, with the team's own questions kept */
  async function source(slug) {
    const b = await brandOf(slug), errors = new Set();
    const { seeds, cands } = await candidatesOf(b, errors);
    const picks = cands.length ? await pick(b, cands, errors) : [];
    const un = picks.filter((x) => !x.branded).slice(0, MAX_UNB), br = picks.filter((x) => x.branded).slice(0, MAX_BR);
    const team = (b.config.questions || []).filter((q) => q?.why?.kind === 'team').slice(0, MAX_TEAM);
    const qs = [...un, ...br].map((x, i) => ({ id: `q${i + 1}`, q: x.q, branded: x.branded, why: whyOf(x.refs, b) || { kind: 'none', label: 'No search data found for this one' } }));
    return { questions: [...qs, ...team], rivals: b.rivals, method: { v: Q_V, at: new Date().toISOString(), country: b.country, seeds, candidates: cands.length,
      sources: [...new Set(cands.map((c) => c.kind))], errors: [...errors].slice(0, 4), askedFrom: { cc: b.country, lang: b.lang, guessed: b.guessed } }, ok: qs.length >= 4 && qs.filter((x) => !x.branded).length >= 3 }; /* the test is the unbranded answers: never a mostly-branded set */
  }
  return { source, brandOf, candidatesOf, pick };
}
