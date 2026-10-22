// Stage 7b · named: which brands each saved AI answer names, read from its own text (plus ChatGPT's brand entities) by the
// shared AI client on the fast model (Gemini Flash while we build; never the deep one, never treg). One call per read.
// Each answer gets brandsNamed: [names]; profile.ai.named stamps the pass { v, at } or { v, at, error }. A name the model
// gives that isn't in the answer's text or entities is dropped (nothing guessed). A failed pass is an error, never "none".
import { withTimeout } from '../util.js';

export const NAMED_V = 1;
const reName = (n) => new RegExp(`(^|[^\\p{L}\\p{N}])${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}($|[^\\p{L}\\p{N}])`, 'iu');
/* a brand is written with a capital somewhere (Bare Anatomy, mCaffeine, boAt) and in a few words; "curl styling cream" is a product type */
const brandLike = (n) => n.length <= 40 && /\p{Lu}/u.test(n) && n.split(/\s+/).length <= 5;
export const nameKey = (n) => String(n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/* the pass is missing, from an older version, or failed over an hour ago (heal tries a failed one hourly) */
export function namedStale(p = {}) {
  const ok = (p.ai?.answers || []).filter((a) => a && !a.error && a.text);
  if (!ok.length) return false;
  const nd = p.ai.named;
  if (!nd || nd.v !== NAMED_V) return true;
  if (nd.error) return Date.now() - Date.parse(nd.at || 0) >= 36e5;
  return ok.some((a) => !Array.isArray(a.brandsNamed)); /* answers asked again since the pass */
}

export async function named(ctx) {
  const { profile } = ctx, ai = profile.ai || {};
  const ok = (ai.answers || []).filter((a) => a && !a.error && a.text);
  if (!ok.length) return null;
  const at = new Date().toISOString();
  if (!ctx.aiOn) { ai.named = { v: NAMED_V, at, error: 'AI off for this read' }; return null; }
  const owns = new Set([profile.name, profile.brandName].filter(Boolean).map(nameKey)); /* "PUMA India" and "PUMA" are both us */
  try {
    const list = ok.map((a, i) => `#${i}\n${String(a.text).slice(0, 1500)}${(a.entities || []).length ? `\n(brands the tool tagged: ${a.entities.join(', ')})` : ''}`).join('\n\n');
    const r = await withTimeout(ctx.ai({ tag: 'reader-named', model: 'sonnet', max: 4000,
      schema: { type: 'object', properties: { answers: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, brands: { type: 'array', items: { type: 'string' } } } } } } },
      system: 'You read AI shopping answers and list the product brands each one names. Reply only with the JSON asked for.',
      prompt: `Below are ${ok.length} answers an AI tool gave shoppers, each after #<number>. For each answer, list every brand of products it names (the company or brand a shopper would buy, e.g. "L'Oréal", not "L'Oréal Paris Elvive Total Repair 5"). Leave out shops and marketplaces (Amazon, Nykaa, Flipkart, Walmart), websites, magazines, doctors, ingredients and generic product types. Write each brand as it appears in the answer. An answer that names no brand gets an empty list. Return one entry per answer, with its number as i.\n\n${list}` }), 90e3, 'named');
    const by = new Map((r?.json?.answers || []).map((x) => [x.i, x.brands || []]));
    if (!by.size) throw new Error('no answers came back from the brand pass');
    ok.forEach((a, i) => {
      const said = `${a.text} ${(a.entities || []).join(' | ')}`, seen = new Set();
      a.brandsNamed = [...(by.get(i) || []), ...(a.entities || [])].map((n) => String(n || '').trim()).filter((n) => {
        const k = nameKey(n); if (!k || owns.has(k) || seen.has(k) || !brandLike(n) || !reName(n).test(said)) return false; seen.add(k); return true; }).slice(0, 15);
    });
    ai.named = { v: NAMED_V, at };
    return ai.named;
  } catch (e) {
    ai.named = { v: NAMED_V, at, error: String(e.message || e).slice(0, 160) };
    throw e;
  }
}
