// Gemini on our own Vertex account, behind the same shape as the Anthropic client, so every caller (ai.js, the jam,
// research, live watch, the image check) runs on either one without changing. AI_PROVIDER picks it: 'gemini' (the default
// while we build: Google credits pay for it) or 'anthropic'. Claude model names map to Gemini ones: Opus jobs to
// GEMINI_DEEP_MODEL, everything else to GEMINI_FAST_MODEL. Both are Flash while we build; set the deep one to Pro for clients.
import Anthropic from '@anthropic-ai/sdk';
import { gToken } from './vertex-media.js';
import { noteVertex } from './alerts.js'; // billing and quota failures reach the ops alerts

export const providerNow = () => ((process.env.AI_PROVIDER || 'gemini').toLowerCase() === 'anthropic' ? 'anthropic' : 'gemini');
export const PROVIDER = providerNow();
export const GEMINI = { fast: process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash', deep: process.env.GEMINI_DEEP_MODEL || 'gemini-3.5-flash' };
export const geminiModel = (m = '') => (/^gemini/.test(m) ? m : /opus/.test(m) ? GEMINI.deep : GEMINI.fast);
/* $ per MTok in / out (list price, before credits), and $ per grounded search query */
export const GEMINI_PRICE = { 'gemini-3.5-flash': [0.5, 3], 'gemini-3-flash-preview': [0.5, 3], 'gemini-2.5-flash': [0.3, 2.5], 'gemini-3.1-pro-preview': [2, 12] };
export const GEMINI_SEARCH_PRICE = 0.014;

/* the AI client for this server: Anthropic with its key, or the Gemini shim (needs only Google sign-in, always on) */
export function makeLLM({ apiKey = process.env.ANTHROPIC_API_KEY, anthropicOpts = {}, log = console } = {}) {
  if (PROVIDER === 'anthropic') return apiKey ? new Anthropic({ apiKey, ...anthropicOpts }) : null;
  return createGeminiClient({ log });
}

const PROJECT = () => process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617';
/* Claude's effort → Gemini's thinking level; 'high' (the Opus default) thinks at MEDIUM, which keeps Flash fast and on task */
const LEVEL = { low: 'LOW', medium: 'MEDIUM', high: 'MEDIUM', xhigh: 'HIGH', max: 'HIGH' };
const REFUSE = /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION|IMAGE_SAFETY/;

const partsOf = (content) => {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  return (content || []).flatMap((b) => {
    if (b.type === 'text') return b.text ? [{ text: b.text }] : [];
    if (b.type === 'image' && b.source?.type === 'base64') return [{ inlineData: { mimeType: b.source.media_type, data: b.source.data } }];
    if (b.type === 'image' && b.source?.type === 'url') return [{ fileData: { fileUri: b.source.url, mimeType: 'image/jpeg' } }];
    if (b.type === 'document' && b.source?.type === 'base64') return [{ inlineData: { mimeType: b.source.media_type, data: b.source.data } }];
    if (b.type === 'tool_use') return [{ functionCall: { name: b.name, args: b.input || {} }, ...(b.signature ? { thoughtSignature: b.signature } : {}) }];
    if (b.type === 'tool_result') return [{ functionResponse: { name: b.name || b.tool_use_id, response: { content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) } } }];
    return []; // server tool blocks from an earlier turn: Gemini searches again itself
  });
};

/** Anthropic Messages params → a Vertex generateContent body */
export function toGemini(p) {
  const contents = [];
  for (const m of p.messages || []) {
    const role = m.role === 'assistant' ? 'model' : 'user', parts = partsOf(m.content);
    if (!parts.length) continue;
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts); else contents.push({ role, parts });
  }
  let system = typeof p.system === 'string' ? p.system : (p.system || []).map((b) => b.text || '').join('\n\n');
  const tools = [], fns = [];
  for (const t of p.tools || []) {
    if (/^web_search/.test(t.type || '')) {
      tools.push({ googleSearch: {} });
      const loc = t.user_location; if (loc?.country) system += `\n\nSearch the web as someone in ${[loc.city, loc.country].filter(Boolean).join(', ')} would.`;
    } else if (t.name && t.input_schema) fns.push({ name: t.name, description: t.description || '', parametersJsonSchema: t.input_schema });
  }
  if (fns.length) { tools.length = 0; tools.push({ functionDeclarations: fns }); } // Vertex won't mix search with our own tools
  const effort = p.output_config?.effort, off = !p.thinking || p.thinking.type === 'disabled' || p.thinking.type === 'between_tools';
  const fmt = p.output_config?.format;
  return {
    contents,
    ...(system.trim() ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(tools.length ? { tools } : {}),
    generationConfig: {
      /* Gemini's thoughts count against this limit (Claude's budget is the answer), so a thinking job gets headroom */
      maxOutputTokens: Math.min((p.max_tokens || 8000) + (off ? 2000 : 16000), 65536),
      thinkingConfig: { thinkingLevel: off ? 'LOW' : LEVEL[effort] || 'HIGH' },
      ...(fmt?.type === 'json_schema' ? { responseMimeType: 'application/json', responseJsonSchema: fmt.schema } : {})
    }
  };
}

/* grounding links are Google redirects: follow each to the page it names, so a cited source is the real URL */
const realUrl = async (u) => { try { const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(6e3) }); return r.headers.get('location') || u; } catch { return u; } };

/** a Vertex reply → an Anthropic-shaped message (content blocks, stop_reason, usage) */
export async function fromGemini(j, model) {
  const c = j.candidates?.[0] || {}, parts = c.content?.parts || [], u = j.usageMetadata || {};
  const content = [];
  const g = c.groundingMetadata, chunks = (g?.groundingChunks || []).filter((x) => x.web?.uri).slice(0, 20);
  if (chunks.length) {
    const urls = await Promise.all(chunks.map((x) => realUrl(x.web.uri)));
    content.push({ type: 'web_search_tool_result', content: chunks.map((x, i) => ({ type: 'web_search_result', url: urls[i], title: x.web.title || x.web.domain || '' })) });
  }
  const text = parts.filter((x) => x.text && !x.thought).map((x) => x.text).join('');
  if (text) content.push({ type: 'text', text, citations: [] });
  const calls = parts.filter((x) => x.functionCall);
  calls.forEach((x, i) => content.push({ type: 'tool_use', id: `call_${Date.now().toString(36)}_${i}`, name: x.functionCall.name, input: x.functionCall.args || {}, ...(x.thoughtSignature ? { signature: x.thoughtSignature } : {}) }));
  const why = j.promptFeedback?.blockReason || c.finishReason || '';
  const stop_reason = REFUSE.test(why) || (!j.candidates?.length && j.promptFeedback) ? 'refusal' : why === 'MAX_TOKENS' ? 'max_tokens' : calls.length ? 'tool_use' : 'end_turn';
  const cached = u.cachedContentTokenCount || 0;
  return {
    id: j.responseId || '', type: 'message', role: 'assistant', model: j.modelVersion || model, content, stop_reason,
    ...(stop_reason === 'refusal' ? { stop_details: { category: why.toLowerCase() || 'blocked' } } : {}),
    usage: { input_tokens: (u.promptTokenCount || 0) - cached, cache_read_input_tokens: cached, output_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
      server_tool_use: { web_search_requests: g?.webSearchQueries?.length || 0 } }
  };
}

export function createGeminiClient({ log = console } = {}) {
  async function create(p) {
    const model = geminiModel(p.model), body = JSON.stringify(toGemini(p));
    const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT()}/locations/global/publishers/google/models/${model}:generateContent`;
    for (let a = 0; ; a++) {
      const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${await gToken()}`, 'x-goog-user-project': PROJECT(), 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(15 * 60e3) });
      if (r.ok) return fromGemini(await r.json(), model);
      const t = await r.text(); noteVertex(r.status, t); /* billing and quota trouble reaches the ops alerts (alerts.js) */
      if (a < 3 && [429, 500, 502, 503, 504].includes(r.status)) { log.warn?.(`[gemini] ${model} ${r.status}, retrying`); await new Promise((s) => setTimeout(s, 2 ** a * 4e3)); continue; }
      let msg = t; try { msg = JSON.parse(t).error?.message || t; } catch {}
      throw Object.assign(new Error(`Gemini ${model} ${r.status}: ${String(msg).slice(0, 300)}`), { status: r.status });
    }
  }
  const messages = { create, stream: (p) => ({ finalMessage: () => create(p) }) };
  return { messages, beta: { messages }, provider: 'gemini' };
}
