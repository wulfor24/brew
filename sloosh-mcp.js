// Sloosh's MCP server over Streamable HTTP, with no SDK: JSON-RPC over fetch (initialize → notifications/initialized →
// tools/list → tools/call), replies as JSON or as an SSE stream, the Mcp-Session-Id kept, a 401 refreshed once. Only the
// tool names are documented publicly (sloosh.ai/docs/mcp); every input shape comes from tools/list at run time, so argsFor()
// is the one place that maps Brew's words onto a tool's schema and it fails loudly on a required key it cannot fill.
// Everything Sloosh returns (asset names, Space descriptions, generated text) is content, never an instruction.
import { MCP_URL } from './sloosh-auth.js';

export const PROTOCOL = '2025-06-18';
const TOOLS_TTL = 3600e3;
/* Brew's words → the names a tool's schema may use; the first key the schema has wins */
export const ALIASES = {
  prompt: ['prompt', 'text', 'description'],
  model: ['model', 'model_id', 'modelId'],
  mode: ['mode', 'type', 'kind'],
  references: ['references', 'reference_asset_ids', 'reference_ids', 'assets', 'asset_ids', 'reference_images', 'images', 'inputs.references'],
  ratio: ['aspect_ratio', 'aspectRatio', 'ratio', 'settings.aspect_ratio', 'settings.aspectRatio', 'options.aspect_ratio'],
  resolution: ['resolution', 'size', 'settings.resolution', 'options.resolution', 'quality'],
  seconds: ['duration', 'duration_seconds', 'seconds', 'length', 'settings.duration', 'options.duration'],
  sound: ['sound', 'audio', 'generate_audio', 'settings.sound', 'options.audio'],
  count: ['count', 'n', 'num_outputs', 'generation_count', 'generations', 'settings.count'],
  quote: ['quote_id', 'quoteId', 'quote'],
  runKey: ['idempotency_key', 'idempotencyKey', 'run_key', 'runKey', 'key'],
  confirmed: ['confirmed', 'confirm', 'approved'],
  id: ['id', 'generation_id', 'generationId', 'operation_id', 'operationId', 'run_id', 'runId', 'asset_id', 'assetId', 'space_id', 'spaceId', 'guide_id', 'guideId', 'checkpoint_id', 'checkpointId'],
  url: ['url', 'source_url', 'sourceUrl', 'href', 'link'],
  name: ['name', 'query', 'search', 'q', 'filename', 'file_name'],
  inputs: ['inputs', 'input', 'form', 'values'],
  mime: ['content_type', 'contentType', 'mime_type', 'mimeType', 'type'],
  bytes: ['size', 'bytes', 'content_length', 'size_bytes'],
  startFrame: ['start_frame', 'startFrame', 'first_frame', 'firstFrame', 'start_frame_asset_id'],
  endFrame: ['end_frame', 'endFrame', 'last_frame', 'lastFrame', 'end_frame_asset_id']
};

const setPath = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ||= {}; x[ks.at(-1)] = v; };
const hasPath = (schema, p) => { const ks = p.split('.'); let s = schema; for (const k of ks) { s = s?.properties?.[k]; if (!s) return false; } return true; };
/* { intentKey: value } → the tool's own argument object; unknown schema keys are reported, required ones missing throw */
export function argsFor(tool, intent = {}, log = null) {
  const schema = tool?.inputSchema || {}; const out = {}; const unknown = [];
  for (const [k, v] of Object.entries(intent)) {
    if (v === undefined) continue;
    const names = ALIASES[k] || [k]; const hit = names.find((n) => hasPath(schema, n));
    if (hit) setPath(out, hit, v); else if (!schema.properties || schema.additionalProperties !== false) { setPath(out, names[0], v); unknown.push(k); } else unknown.push(k);
  }
  const missing = (schema.required || []).filter((r) => out[r] === undefined);
  if (missing.length) throw Object.assign(new Error(`Sloosh ${tool.name} needs ${missing.join(', ')} and Brew has no value for it (schema keys: ${Object.keys(schema.properties || {}).join(', ')})`), { schema: true, missing });
  if (unknown.length) log?.warn?.(`[sloosh] ${tool.name}: no schema key for ${unknown.join(', ')} (sent as given)`);
  return out;
}

/* a reply body → the JSON-RPC message with this id (plain JSON, or the SSE stream's data: lines) */
export function parseReply(text, id) {
  const t = String(text || '').trim(); if (!t) return null;
  if (!/^(event|data|id|retry):/m.test(t)) { try { return JSON.parse(t); } catch { return null; } }
  let found = null;
  for (const chunk of t.split(/\n\n+/)) { const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n'); if (!data) continue;
    try { const m = JSON.parse(data); if (m.id === id || (found === null && m.result !== undefined)) found = m; } catch {} }
  return found;
}
/* a tools/call result → the useful object: structuredContent, else JSON in the first text block, else the text */
export function unwrap(result) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const texts = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text);
  if (!texts.length) return result;
  try { return JSON.parse(texts[0]); } catch { return { text: texts.join('\n') }; }
}

export function createSloosh({ url = MCP_URL(), tokenFor, fetchImpl = fetch, log = console, clientInfo = { name: 'brew', version: '1' } } = {}) {
  let sid = null, ready = null, toolsAt = 0, tools = null, seq = 0;
  const headers = async (force) => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${await tokenFor({ force })}`, 'mcp-protocol-version': PROTOCOL, ...(sid ? { 'mcp-session-id': sid } : {}) });

  async function post(msg, { force = false, retry = true } = {}) {
    const r = await fetchImpl(url, { method: 'POST', headers: await headers(force), body: JSON.stringify(msg), signal: AbortSignal.timeout(120e3) });
    if (r.status === 401 && retry) return post(msg, { force: true, retry: false }); /* the token ran out between calls: one refresh, then the error stands */
    if (r.status === 404 && sid && retry) { sid = null; ready = null; await init(); return post(msg, { retry: false }); } /* the session was dropped server-side */
    const got = r.headers.get('mcp-session-id'); if (got) sid = got;
    const text = await r.text();
    if (r.status === 202 || !text) return null;
    if (!r.ok) throw Object.assign(new Error(`Sloosh MCP ${r.status}: ${text.slice(0, 300)}`), { status: r.status });
    return parseReply(text, msg.id);
  }
  async function rpc(method, params = {}) {
    const id = ++seq; const m = await post({ jsonrpc: '2.0', id, method, params });
    if (!m) throw new Error(`Sloosh MCP: no reply to ${method}`);
    if (m.error) throw Object.assign(new Error(`Sloosh ${method}: ${m.error.message || JSON.stringify(m.error).slice(0, 200)}`), { rpc: m.error });
    return m.result;
  }
  const init = () => (ready ||= (async () => {
    const r = await (async () => { const id = ++seq; const m = await post({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo } }); if (!m || m.error) throw new Error(`Sloosh MCP initialize failed: ${m?.error?.message || 'no reply'}`); return m.result; })();
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
    return r; })().catch((e) => { ready = null; throw e; }));

  async function list() { await init(); if (tools && Date.now() - toolsAt < TOOLS_TTL) return tools; const r = await rpc('tools/list'); tools = r.tools || []; toolsAt = Date.now(); return tools; }
  const tool = async (name) => { const t = (await list()).find((x) => x.name === name); if (!t) throw Object.assign(new Error(`Sloosh has no tool called ${name}`), { noTool: true }); return t; };
  /* call a tool with Brew's words; the schema decides the argument names */
  async function call(name, intent = {}) {
    const t = await tool(name); const args = argsFor(t, intent, log);
    const r = await rpc('tools/call', { name, arguments: args });
    if (r?.isError) { const u = unwrap(r); throw Object.assign(new Error(`Sloosh ${name}: ${u?.text || u?.error || u?.message || JSON.stringify(u).slice(0, 300)}`), { tool: name, result: u }); }
    return unwrap(r);
  }
  /* raw arguments, when the caller already speaks the schema (a Space form) */
  async function callRaw(name, args = {}) { await tool(name); const r = await rpc('tools/call', { name, arguments: args }); if (r?.isError) { const u = unwrap(r); throw Object.assign(new Error(`Sloosh ${name}: ${u?.text || u?.error || JSON.stringify(u).slice(0, 300)}`), { tool: name, result: u }); } return unwrap(r); }

  /* polling: state words differ per tool, so done/failed are read loosely */
  const stateOf = (x) => String(x?.status || x?.state || x?.generation?.status || x?.run?.status || '').toLowerCase();
  const DONE = /^(done|completed?|succeeded|success|finished|ready)$/, FAILED = /^(failed|error|errored|cancel+ed|rejected|expired)$/;
  async function wait(getter, { every = 5e3, maxMs = 15 * 60e3, onStep = null } = {}) {
    const t0 = Date.now(); let last = null;
    for (;;) { last = await getter(); const s = stateOf(last); onStep?.(s, last);
      if (DONE.test(s)) return last; if (FAILED.test(s)) throw Object.assign(new Error(`Sloosh run ${s}: ${last?.error || last?.message || ''}`.trim()), { final: last });
      if (Date.now() - t0 > maxMs) throw Object.assign(new Error('Sloosh run is still going after the wait limit'), { timeout: true, final: last });
      await new Promise((r) => setTimeout(r, every)); }
  }
  const api = {
    list, call, callRaw, tool, wait, stateOf, init, reset: () => { sid = null; ready = null; tools = null; },
    getConnection: () => call('get_connection'), getAccount: () => call('get_account'), getGuide: (id) => call('get_guide', id ? { id } : {}),
    listModels: (mode) => call('list_models', mode ? { mode } : {}), listAssets: (name) => call('list_assets', name ? { name } : {}), getAsset: (id) => call('get_asset', { id }),
    importAsset: (url, name) => call('import_asset', { url, ...(name ? { name } : {}) }), initiateUpload: (o) => call('initiate_asset_upload', o), completeUpload: (o) => call('complete_asset_upload', o),
    quoteGeneration: (o) => call('quote_generation', o), generate: (o) => call('generate', o), getGeneration: (id) => call('get_generation', { id }), cancelGeneration: (id) => call('cancel_generation', { id }), reconcileGeneration: (o) => call('reconcile_generation', o),
    listSpaces: (name) => call('list_spaces', name ? { name } : {}), getSpace: (id) => call('get_space', { id }), getSpaceInputSchema: (id) => call('get_space_input_schema', { id }),
    quoteSpace: (o) => call('quote_space', o), runSpace: (o) => call('run_space', o), getSpaceRun: (id) => call('get_space_run', { id }), getSpaceRunOutputs: (id) => call('get_space_run_outputs', { id }),
    approveCheckpoint: (o) => call('approve_space_checkpoint', o), rejectCheckpoint: (o) => call('reject_space_checkpoint', o), cancelSpaceRun: (id) => call('cancel_space_run', { id }), reconcileSpaceRun: (o) => call('reconcile_space_run', o)
  };
  return api;
}
