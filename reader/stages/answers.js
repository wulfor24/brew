// Stage 7 · answers: 8 real shopper questions for the category and country (Sonnet; branded and unbranded),
// asked to ChatGPT, Gemini and Perplexity through treg (their consumer answers, from the brand's country) and to
// Claude with web search. Per answer: is the brand named, which rivals are, which sources are cited.
// Also: inferCategory (category, subcategory, category search terms) used by rivals, ads and company.
import { marketShort } from '../../market.js';
import { clean, hostOf, registrable, pool } from '../util.js';
import { providerNow } from '../../gemini-client.js';

// DataForSEO location codes
const LOC = { IN: 2356, US: 2840, GB: 2826, CA: 2124, AU: 2036, AE: 2784, SG: 2702, DE: 2276, FR: 2250, NZ: 2554, JP: 2392, IE: 2372, ZA: 2710 };
const strip = (md) => String(md || '').replace(/\\([\\`*_{}\[\]()#+\-.!|])/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_#>`|]/g, '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
const reName = (n) => new RegExp(`\\b${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i');

// "What you are, in one line": always written from the evidence. A page title is SEO ("Buy X Online"), a claim
// ("India's Best Sneaker Brand") or a badge ("As Featured on Shark Tank"), so it is only the fallback.
const LINE_RULES = 'what the brand is, in one plain line a founder would say (max 70 characters, e.g. "Protein snacks and powder for everyday India" or "Clean-label hair care for thinning hair"). Say what it sells and, if clear, for whom. Not the page title: no "Buy", "Online", "Shop", "Official", no brand name, no celebrity, no awards or "as featured on", no "best", no questions, no SEO keyword lists';
export function setLine(ctx, raw) {
  const { profile, ledger } = ctx;
  const line = String(raw || '').replace(/^["'\s]+|["'.\s]+$/g, '');
  if (!line || line.length > 90 || profile.descriptorBy === 'brand') return false;
  profile.descriptor = line; profile.descriptorBy = 'claude';
  ledger.add({ key: 'brand.descriptor', label: 'What the brand is, in one line', v: line, layer: 'inferred', url: ctx.state?.homeUrl || profile.url, method: 'claude:classify', conf: 'medium', note: 'written from the home page, meta description and catalog' });
  return true;
}
// the one-liner on its own, for a saved read that never got one
export async function writeLine(ctx) {
  const { profile } = ctx; const prods = profile.catalog?.products || [];
  const r = await ctx.ai({ tag: 'reader-line', model: 'sonnet', max: 300, schema: { type: 'object', properties: { line: { type: 'string' } } },
    prompt: `Brand: ${profile.name} (${profile.host}), ${marketShort(profile)}, category ${profile.category || 'unknown'}${profile.subcategory ? ' / ' + profile.subcategory : ''}\nPage title: ${profile.descriptor || ''}\nTagline: ${profile.tagline || ''}\nAbout: ${(profile.about || '').slice(0, 400)}\nTop products: ${prods.slice(0, 12).map((p) => p.title).join('; ')}\n\nReturn line: ${LINE_RULES}.` });
  return setLine(ctx, r.json?.line);
}

export async function inferCategory(ctx) {
  const { profile, ledger, state } = ctx;
  /* a brand read before keeps its category and its category searches (the same searches week to week compare, and are
     paid for once a week); only a first read asks Claude */
  const pv = ctx.prev;
  if (pv?.category && pv.search?.terms?.length) {
    profile.category = pv.category; profile.subcategory = pv.subcategory || null; state.categoryQueries = pv.search.terms.slice(0, 3);
    if (pv.descriptorBy === 'claude' || pv.descriptorBy === 'brand') { profile.descriptor = pv.descriptor; profile.descriptorBy = pv.descriptorBy; }
    ledger.add({ key: 'market.category', label: 'Category', v: `${profile.category}${profile.subcategory ? ' / ' + profile.subcategory : ''}`, layer: 'inferred', url: state.homeUrl, method: 'claude:classify', conf: 'medium', note: 'kept from the first read' });
    return;
  }
  const prods = profile.catalog?.products || [];
  const types = count(prods.filter((p) => !p.pack).map((p) => p.type).filter((t) => t && !/^(combo|kit|bundle|set|gift|regimen)s?$/i.test(t)));
  if (ctx.aiOn) {
    try {
      const r = await ctx.ai({ tag: 'reader-category', model: 'sonnet', max: 700, schema: { type: 'object', properties: { category: { type: 'string' }, subcategory: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, why: { type: 'string' }, line: { type: 'string' }, queries: { type: 'array', items: { type: 'string' } } } },
        prompt: `Classify this store. Use only the evidence below.\nBrand: ${profile.name} (${profile.host}), ${marketShort(profile)}\nTitle/descriptor: ${profile.descriptor || ''}\nTagline: ${profile.tagline || ''}\nMeta: ${(profile.about || '').slice(0, 300)}\nProduct types: ${types.slice(0, 10).map(([t, n]) => `${t} (${n})`).join(', ') || 'none'}\nTop products: ${prods.slice(0, 15).map((p) => p.title).join('; ')}\n\nReturn: category (broad, e.g. "Hair care", "Skin care", "Supplements", "Apparel"), subcategory (narrow, e.g. "Hair fall serums"), confidence, why (one line naming the evidence), line: ${LINE_RULES}. And queries: 3 short Google queries a shopper in ${profile.country || 'that country'} types when buying this kind of product without a brand in mind (lowercase, e.g. "best hair growth serum").` });
      const j = r.json || {};
      profile.category = j.category || null; profile.subcategory = j.subcategory || null;
      state.categoryQueries = (j.queries || []).slice(0, 3);
      setLine(ctx, j.line);
      if (profile.category) ledger.add({ key: 'market.category', label: 'Category', v: `${profile.category}${profile.subcategory ? ' / ' + profile.subcategory : ''}`, layer: 'inferred', url: state.homeUrl, method: 'claude:classify', conf: j.confidence || 'medium', note: j.why });
      return;
    } catch (e) { ctx.log.warn?.('[reader] category', e.message); }
  }
  // free: the most common product type is all we can say
  if (types.length) { profile.subcategory = types[0][0]; ledger.add({ key: 'market.category', label: 'Most common product type', v: types[0][0], layer: 'inferred', url: `${state.origin}/products.json`, method: 'products.json', conf: 'low', note: types.slice(0, 5).map(([t, n]) => `${t} ${n}`).join(', ') }); }
}

export async function answers(ctx) {
  const { profile, ledger } = ctx;
  if (!ctx.aiOn && !ctx.tregOn) { ctx.finding('answers', { kind: 'answer', t: 'Asked ChatGPT', src: 'not asked', q: '', a: 'AI answers were not checked in this read (paid sources off).', cap: '' }); return ctx.done('answers', 'not checked (paid sources off)', 'empty'); }
  const cc = profile.country || 'US'; const loc = LOC[cc] || 2840;
  /* the questions: a brand Brew has read before keeps its questions, so weeks compare and every answer already paid for
     this week (the read, the live watcher, the weekly check) is reused instead of asked again */
  let qs = (ctx.prev?.ai?.questions || []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 8)
    .map((q, i) => ({ q, branded: (ctx.prev.ai.answers || []).find((a) => a.q === q)?.branded ?? i >= 5 }));
  // template questions from a read whose AI failed are written properly once the AI is back
  if (qs.length < 6 || (ctx.prev?.ai?.questionsBy === 'template' && ctx.aiOn)) qs = [];
  let qErr = null, qBy = qs.length ? ctx.prev.ai.questionsBy || 'ai' : 'ai';
  if (!qs.length && ctx.aiOn) {
    try {
      const r = await ctx.ai({ tag: 'reader-questions', model: 'sonnet', max: 900, schema: { type: 'object', properties: { questions: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, branded: { type: 'boolean' } } } } } },
        prompt: `Write 8 real questions a shopper in ${cc} would type into ChatGPT before buying ${profile.subcategory || profile.category || 'this kind of product'} (the brand is ${profile.name}, ${profile.host}). 5 unbranded (best X for Y, which X works, X without Y, is ingredient Z safe, X for a specific person), 3 branded (is ${profile.name} good, ${profile.name} vs a well-known rival, a question about ${profile.name}'s best seller "${(profile.catalog?.products || []).find((p) => p.handle === profile.catalog?.hero?.[0])?.title || ''}"). Use the words shoppers in ${cc} use. Short, natural, no brand in the unbranded ones.` });
      qs = (r.json?.questions || []).filter((x) => x.q).slice(0, 8);
    } catch (e) { ctx.log.warn?.('[reader] questions', e.message); qErr = e.message; }
  }
  /* the AI could not write them: shopper questions from a template, so ChatGPT, Gemini and Perplexity (asked through
     treg, not Brew's AI) are still asked. The error stays on the read, so heal writes real ones next time. */
  if (!qs.length && ctx.tregOn) { qs = templateQuestions(profile); qBy = 'template'; if (qErr || !ctx.aiOn) profile.meta = { ...(profile.meta || {}), errors: { ...(profile.meta?.errors || {}), answers: qErr || 'AI off: shopper questions written from a template' } }; }
  if (!qs.length) { ctx.finding('answers', { kind: 'answer', t: 'Asked ChatGPT', src: 'not asked', q: '', a: ctx.aiOn ? "Could not write the shopper questions this time; the next refresh tries again." : 'Could not write the shopper questions (AI off).', cap: '' }); return ctx.done('answers', 'questions not written', 'empty'); }
  profile.ai = { questions: qs.map((x) => x.q), questionsBy: qBy, answers: [], score: null };
  if (qBy === 'ai' && profile.meta?.errors?.answers) delete profile.meta.errors.answers;
  const ask = {
    chatgpt: async (q) => { const r = await ctx.dfs('dataforseo.x.ai-optimization-chat-gpt-llm-scraper-live-advanced', [{ keyword: q, location_code: loc, language_code: 'en', force_web_search: true }], `${loc}-${q}`);
      return r && { text: r.markdown || '', sources: (r.sources || []).map((s) => s.url || s.domain).filter(Boolean), brands: (r.brand_entities || []).map((b) => b.title || b.name).filter(Boolean), model: r.model }; },
    gemini: async (q) => { const r = await ctx.dfs('dataforseo.x.ai-optimization-gemini-llm-scraper-live-advanced', [{ keyword: q, location_code: loc, language_code: 'en' }], `${loc}-${q}`);
      return r && { text: r.markdown || '', sources: (r.sources || []).map((s) => s.url || s.domain).filter(Boolean), model: r.model }; },
    perplexity: async (q) => { const r = await ctx.dfs('dataforseo.x.ai-optimization-perplexity-llm-responses-live', [{ user_prompt: q, model_name: 'sonar', web_search_country_iso_code: cc, max_output_tokens: 1200 }], `${cc}-${q}`);
      const sec = (r?.items || []).flatMap((i) => i.sections || []); return r && { text: sec.map((s) => s.text).join('\n'), sources: sec.flatMap((s) => (s.annotations || []).map((a) => a.url)).filter(Boolean), model: r.model_name }; },
    claude: async (q) => { const r = await ctx.ai({ tag: 'reader-answer', model: 'sonnet', search: 3, location: cc, max: 1800, system: `You are a helpful assistant. The user is in ${cc}.`, prompt: q });
      return { text: r.text, sources: [...new Set((r.cites || []).map((c) => c.url))], model: 'claude-sonnet' }; }
  };
  /* the claude ask runs on Brew's own AI: under Gemini (gemini-client.js) its answer would be Gemini's labelled Claude, so it sits out */
  const tools = Object.keys(ask).filter((k) => (k === 'claude' ? ctx.aiOn && providerNow() === 'anthropic' : ctx.tregOn));
  const jobs = qs.flatMap((q) => tools.map((t) => [q, t]));
  const own = reName(profile.name); const ownHost = registrable(profile.host);
  let shown = false;
  await pool(jobs, 16, async ([q, tool], i) => {
    if (i % 4 === 0) ctx.tick('answers', `${tool}: ${q.q.slice(0, 40)}`);
    let r; try { r = await ask[tool](q.q); } catch (e) { profile.ai.answers.push({ tool, q: q.q, error: e.message.slice(0, 120) }); return; }
    if (!r?.text) { profile.ai.answers.push({ tool, q: q.q, error: 'empty answer' }); return; }
    const plain = strip(r.text); const doms = [...new Set((r.sources || []).map((u) => registrable(hostOf(u) || u)).filter(Boolean))];
    const named = own.test(plain) || (r.brands || []).some((b) => own.test(b));
    const a = { tool, q: q.q, branded: !!q.branded, text: plain.slice(0, 1500), named, citesBrand: doms.includes(ownHost), rivalsNamed: [], entities: (r.brands || []).filter((b) => !own.test(b)).slice(0, 12), sources: doms.slice(0, 10), model: r.model || null, at: ctx.today, plain };
    profile.ai.answers.push(a);
    // show the first unbranded ChatGPT answer as soon as it lands
    if (!shown && tool === 'chatgpt' && !q.branded) { shown = true; ctx.finding('answers', answerCard(a, profile, cc), a.named ? `${profile.name} is named` : `${profile.name} is not named`); }
  });
  const ok = profile.ai.answers.filter((a) => !a.error);
  /* every AI tool errored: that is a failed check, not "0 of 0 answers"; the error stays on the read so the ring says
     "couldn't be read" and heal asks again (answersFailed in reader/index.js) */
  if (!ok.length && profile.ai.answers.length) { const first = profile.ai.answers.find((a) => a.error)?.error || 'no AI tool answered'; profile.meta = { ...(profile.meta || {}), errors: { ...(profile.meta?.errors || {}), answers: `AI tools: ${first}` } }; }
  const unb = ok.filter((a) => !a.branded);
  profile.ai.score = { named: ok.filter((a) => a.named).length, of: ok.length, unbrandedNamed: unb.filter((a) => a.named).length, unbrandedOf: unb.length, byTool: Object.fromEntries(tools.map((t) => [t, { named: ok.filter((a) => a.tool === t && a.named).length, of: ok.filter((a) => a.tool === t).length }])) };
  ledger.add({ key: 'ai.named.of', label: `AI answers that name ${profile.name}`, v: `${profile.ai.score.named} of ${ok.length}`, n: profile.ai.score.named, unit: 'answers', url: null, src: tools.join(', '), method: 'treg:dataforseo ai-optimization + claude:web_search', note: `asked from ${cc}; ${unb.length} unbranded answers, ${profile.ai.score.unbrandedNamed} name the brand` });
  ledger.add({ key: 'ai.named.unbranded', label: `Unbranded AI answers that name ${profile.name}`, v: `${profile.ai.score.unbrandedNamed} of ${unb.length}`, n: profile.ai.score.unbrandedNamed, unit: 'answers', src: tools.join(', '), method: 'treg:dataforseo ai-optimization + claude:web_search' });
  if (!shown) { const a = ok.find((x) => x.tool === 'chatgpt') || ok.find((x) => !x.branded) || ok[0]; if (a) ctx.finding('answers', answerCard(a, profile, cc)); }
  const usedTools = new Set(ok.map((a) => a.tool)).size;
  ctx.done('answers', ok.length ? `${qs.length} questions${qBy === 'template' ? ' (from a template)' : ''}, ${usedTools} AI tools` : 'no answers came back', ok.length ? 'done' : 'empty');
}

function answerCard(a, profile, cc) {
  const label = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude' }[a.tool];
  const s = a.plain || a.text; const cut = s.slice(0, 260); const end = cut.lastIndexOf('. ');
  return { kind: 'answer', t: `Asked ${label}`, src: `${label.toLowerCase()} · asked from ${cc} · ${a.at}`, q: a.q, a: (end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')) + '…', cap: `${profile.name} is ${a.named ? '' : 'not '}named` };
}
const count = (xs) => { const m = new Map(); xs.forEach((x) => m.set(x, (m.get(x) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };

const COUNTRY = { IN: 'India', US: 'the US', GB: 'the UK', UK: 'the UK', AE: 'the UAE', CA: 'Canada', AU: 'Australia', SG: 'Singapore', DE: 'Germany', FR: 'France' };
/** 8 shopper questions without an AI: 5 unbranded, 3 branded, from the category, best seller and first rival */
export function templateQuestions(profile) {
  const cat = String(profile.subcategory || profile.category || 'products').toLowerCase().replace(/\s+/g, ' ').trim();
  const where = COUNTRY[profile.country] || COUNTRY.US; const name = profile.name || profile.host;
  const best = (profile.catalog?.products || []).find((p) => p.handle === profile.catalog?.hero?.[0])?.title;
  const rival = (profile.rivals || []).map((r) => r.name).find(Boolean);
  return [
    { q: `best ${cat} in ${where}`, branded: false },
    { q: `which ${cat} actually works`, branded: false },
    { q: `best ${cat} for beginners`, branded: false },
    { q: `affordable ${cat} worth buying`, branded: false },
    { q: `what to look for when buying ${cat}`, branded: false },
    { q: `is ${name} good`, branded: true },
    { q: rival ? `${name} vs ${rival}` : `${name} reviews`, branded: true },
    { q: best ? `is ${name} ${String(best).replace(/\s+-\s+.*$/, '').slice(0, 60)} worth it` : `${name} best seller`, branded: true }
  ];
}
