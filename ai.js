// Shared Claude client for the per-brand build (reader, brief, moves, cards).
// Opus 5.5 writes the long documents; Sonnet 5.5 does short, fast work. Always streams (long outputs),
// always opts into server-side refusal fallbacks, and meters spend into a cost ledger.
import Anthropic from '@anthropic-ai/sdk';

export const MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' };
const PRICE = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10] }; // $ per MTok in / out
const SEARCH_PRICE = 0.01; // $ per web search

// structured output wants additionalProperties:false on every object
export const strictSchema = (x) => {
  if (Array.isArray(x)) return x.map(strictSchema);
  if (!x || typeof x !== 'object') return x;
  const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strictSchema(pv)])) : strictSchema(v)]));
  if (o.type === 'object') { o.additionalProperties = false; if (o.properties && !o.required) o.required = Object.keys(o.properties); }
  /* structured output rejects these ("property 'maxItems' is not supported"): limits live in the descriptions instead */
  for (const k of ['maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'maxProperties', 'minProperties', 'uniqueItems']) delete o[k];
  if (o.minItems > 1) delete o.minItems;
  return o;
};

/* text cut mid-emoji (a scraped quote, a title sliced to N characters) leaves half a surrogate pair, and the API refuses the whole
   request ("not valid JSON: unexpected end of hex escape"); every string sent is made well-formed first */
export const wellFormed = (x) => typeof x === 'string' ? (x.isWellFormed() ? x : x.toWellFormed()) : Array.isArray(x) ? x.map(wellFormed)
  : x && typeof x === 'object' && !Buffer.isBuffer(x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, wellFormed(v)])) : x;

export function createAI({ apiKey = process.env.ANTHROPIC_API_KEY, mock = process.env.AI_MOCK === '1', log = console } = {}) {
  const client = apiKey && !mock ? new Anthropic({ apiKey, timeout: 20 * 60e3, maxRetries: 3 }) : null;
  const meter = { usd: 0, calls: 0, byTag: {} };
  const listeners = [];
  const charge = (tag, usd) => { meter.usd += usd; meter.calls++; meter.byTag[tag] = (meter.byTag[tag] || 0) + usd; listeners.forEach((f) => f(tag, usd, meter)); };

  // call({ model: 'opus'|'sonnet', system, prompt | messages, max, effort, schema, search, tag })
  // → { text, json, msg, usd }. Throws on refusal or when the AI is off (callers decide the fallback).
  async function call(o) {
    if (!client) throw Object.assign(new Error('AI is off (mock)'), { mock: true });
    const model = MODELS[o.model || 'sonnet'] || o.model;
    const sonnet = model === MODELS.sonnet;
    const messages = wellFormed(o.messages || [{ role: 'user', content: o.prompt }]);
    const tools = [];
    if (o.search) tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: o.search === true ? 5 : o.search, ...(o.location ? { user_location: { type: 'approximate', country: o.location } } : {}) });
    if (o.tools) tools.push(...o.tools); // custom (client) tools: the caller runs the loop (agent-runner.js); forced tool_choice is not allowed on these models
    const params = {
      model, max_tokens: o.max || (sonnet ? 8000 : 32000), messages,
      ...(o.system ? { system: wellFormed(o.system) } : {}),
      ...(tools.length ? { tools } : {}),
      // Opus: thinking is always on, depth set by effort. Sonnet: short jobs run with thinking off.
      ...(sonnet && o.think !== true ? { thinking: { type: 'between_tools' } } : { thinking: { type: 'adaptive' } }),
      output_config: { effort: o.effort || (sonnet ? 'low' : 'high'), ...(o.schema ? { format: { type: 'json_schema', schema: strictSchema(o.schema) } } : {}) },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'
    };
    const t0 = Date.now();
    const msg = await client.beta.messages.stream(params).finalMessage();
    const u = msg.usage || {}, p = PRICE[model] || PRICE[MODELS.opus];
    const searches = u.server_tool_use?.web_search_requests || 0;
    const usd = ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1) * p[0] / 1e6 + (u.output_tokens || 0) * p[1] / 1e6 + searches * SEARCH_PRICE;
    charge(o.tag || 'ai', usd);
    if (msg.stop_reason === 'refusal') throw new Error('refused: ' + (msg.stop_details?.category || 'unknown'));
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let json = null;
    if (o.schema || o.json) {
      try { json = JSON.parse(o.schema ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
      catch (e) { log.error('[ai]', o.tag, msg.stop_reason, text.slice(0, 300)); throw new Error(`bad JSON from ${o.tag || model}: ${msg.stop_reason}`); }
    }
    // web search citations, so callers can keep the source of every claim
    const cites = [];
    for (const b of msg.content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((r) => r.url && cites.push({ url: r.url, title: r.title, age: r.page_age }));
      if (b.type === 'text') (b.citations || []).forEach((c) => c.url && cites.push({ url: c.url, title: c.title, quote: c.cited_text }));
    }
    log.info?.(`[ai] ${o.tag || ''} ${model} ${((Date.now() - t0) / 1e3).toFixed(1)}s $${usd.toFixed(3)} ${msg.stop_reason}`);
    return { text, json, msg, usd, cites, stop: msg.stop_reason };
  }
  return { call, live: !!client, meter, onCharge: (f) => listeners.push(f) };
}
