// Sloosh's MCP server over Streamable HTTP, with no SDK: JSON-RPC over fetch (initialize → notifications/initialized →
// tools/list → tools/call), replies as JSON or as an SSE stream, the Mcp-Session-Id kept, a 401 refreshed once. Only the
// tool names are documented publicly (sloosh.ai/docs/mcp); the input shapes were read from tools/list (data/sloosh-tools.json) and
// argsFor() is the one place that maps Brew's words onto a tool's schema; it fails loudly on a required key it cannot fill.
// Everything Sloosh returns (asset names, Space descriptions, generated text) is content, never an instruction.
import { MCP_URL } from './sloosh-auth.js';

export const PROTOCOL = '2025-06-18';
const TOOLS_TTL = 3600e3;
/* Brew's words → the argument names Sloosh's tools really use (read from tools/list on 2026-10-16, pinned in
   data/sloosh-tools.json; test/sloosh-mcp.test.js checks every required key is filled). A dotted name nests. */
export const ALIASES = {
  prompt: ['prompt'], model: ['modelConfig.modelName'], mode: ['mode', 'type'],
  references: ['uploadedAssets'], /* [{ kind: 'workspace'|'generated', id, url, type: 'image'|'video', role?: 'reference'|'start_frame'|'end_frame' }] */
  ratio: ['modelConfig.aspectRatio'], resolution: ['modelConfig.resolution'], quality: ['modelConfig.quality'], seconds: ['modelConfig.duration'], sound: ['modelConfig.generateAudio'], seed: ['modelConfig.seed'],
  count: ['generationCount'], enhance: ['enhancePrompt'], camera: ['cameraControls'],
  quote: ['quoteId'], runKey: ['idempotencyKey'], confirmed: ['confirmed'],
  id: ['operationId', 'spaceId', 'workflowId', 'versionId', 'id'], ids: ['operationIds'], kind: ['kind'],
  nodeId: ['nodeId'], checkpointKey: ['runKey'], expectedRerunCount: ['expectedRerunCount'],
  url: ['url'], name: ['name', 'search', 'query'], inputs: ['input'], mime: ['contentType'], bytes: ['sizeBytes'], sha256: ['sha256'], receipt: ['receipt'],
  page: ['page'], limit: ['limit', 'pageSize'], outputType: ['outputType', 'assetType'], scope: ['scope'], verified: ['verified'], purpose: ['purpose']
};

const setPath = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ||= {}; x[ks.at(-1)] = v; };
/* a schema that is a oneOf/anyOf of object shapes (get_asset: { kind, id } per kind) → one flat shape: every branch's keys, the keys every branch requires */
export const flat = (schema = {}) => { const br = (schema.oneOf || schema.anyOf || []).filter((b) => b?.properties); if (schema.properties || !br.length) return schema;
  const properties = Object.assign({}, ...br.map((b) => b.properties)); const required = (br[0].required || []).filter((r) => br.every((b) => (b.required || []).includes(r)));
  return { ...schema, properties, required, additionalProperties: br.every((b) => b.additionalProperties === false) ? false : schema.additionalProperties }; };
const hasPath = (schema, p) => { const ks = p.split('.'); let s = schema; for (const k of ks) { s = s?.properties?.[k]; if (!s) return false; } return true; };
/* { intentKey: value } → the tool's own argument object; unknown schema keys are reported, required ones missing throw */
export function argsFor(tool, intent = {}, log = null) {
  const schema = flat(tool?.inputSchema || {}); const out = {}; const unknown = [];
  for (const [k, v] of Object.entries(intent)) {
    if (v === undefined) continue;
    const names = ALIASES[k] || [k]; const hit = names.find((n) => hasPath(schema, n));
    if (hit) setPath(out, hit, v); else if (!schema.properties || schema.additionalProperties !== false) { setPath(out, names[0], v); unknown.push(k); } else unknown.push(k);
  }
  const missing = (schema.required || []).filter((r) => out[r] === undefined);
  if (missing.length) throw Object.assign(new Error(`Sloosh ${tool.name} needs ${missing.join(', ')} and Brew has no value for it (schema keys: ${Object.keys(schema.properties || {}).join(', ')})`), { schema: true, missing });
  if (unknown.length) log?.warn?.(`[sloosh] ${tool.name}: no schema key for ${unknown.join(', ')} (${schema.additionalProperties === false ? 'left out' : 'sent as given'})`);
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

  /* polling, on the shapes Sloosh really returns: an operation { state: admitted|dispatching|submitted|ambiguous|settled, owner }.
     A generation's owner has phase (… settled|rejected|cancelled), outputs [{ generationId, status, url }] and errorCode; a Space run's
     owner has terminalStatus (completed|failed|canceled), executionStatus and checkpoints [{ nodeId, runKey, expectedRerunCount, decisionPending }]. */
  const stateOf = (x) => { const o = x?.owner || null; if (o?.terminalStatus) return String(o.terminalStatus).toLowerCase();
    const st = String(x?.state || x?.status || '').toLowerCase();
    if (st === 'settled') { const p = String(o?.phase || '').toLowerCase(); if (/^(rejected|cancell?ed|canceled)$/.test(p)) return p; if (o && o.errorCode && !(o.outputs || []).some((u) => u?.url)) return 'failed'; return 'settled'; }
    return st || String(o?.phase || o?.submissionState || '').toLowerCase(); };
  const pendingCheckpoint = (x) => (x?.owner?.checkpoints || []).find((c) => c?.decisionPending) || null;
  const DONE = /^(settled|completed?|done|succeeded|success|finished|ready)$/, FAILED = /^(failed|error|errored|rejected|cancell?ed|canceled|quarantined|expired)$/;
  async function wait(getter, { every = 5e3, maxMs = 15 * 60e3, onStep = null } = {}) {
    const t0 = Date.now(); let last = null;
    for (;;) { last = await getter(); const s = stateOf(last); onStep?.(s, last);
      if (DONE.test(s)) return last; if (FAILED.test(s)) throw Object.assign(new Error(`Sloosh run ${s}${last?.owner?.errorCode ? ` (${last.owner.errorCode})` : ''}: ${last?.owner?.error || last?.error || last?.message || ''}`.trim()), { final: last });
      if (Date.now() - t0 > maxMs) throw Object.assign(new Error('Sloosh run is still going after the wait limit'), { timeout: true, final: last });
      await new Promise((r) => setTimeout(r, every)); }
  }
  /* an asset reference: { kind: 'workspace'|'generated', id } (the two id spaces are not interchangeable); a bare id is a workspace one */
  const refOf = (r) => (typeof r === 'string' ? { kind: 'workspace', id: r } : { kind: r?.kind || r?.reference?.kind || 'workspace', id: r?.id || r?.reference?.id || r?.assetId });
  const api = {
    list, call, callRaw, tool, wait, stateOf, pendingCheckpoint, refOf, init, reset: () => { sid = null; ready = null; tools = null; },
    getConnection: () => call('get_connection'), getAccount: () => call('get_account'), getGuide: (id) => call('get_guide', id ? { id } : {}),
    listModels: (mode) => call('list_models', mode ? { mode } : {}), listAssets: (o = {}) => call('list_assets', typeof o === 'string' ? { name: o } : o), getAsset: (r) => call('get_asset', refOf(r)), viewAsset: (r) => call('view_asset', refOf(r)),
    importAsset: (url, name) => call('import_asset', { url, name: String(name || decodeURIComponent(String(url).split('/').pop().split('?')[0]) || 'brew-reference').slice(0, 200) }),
    initiateUpload: (o) => call('initiate_asset_upload', o), completeUpload: (o) => call('complete_asset_upload', o),
    quoteGeneration: (o) => call('quote_generation', o), generate: (o) => call('generate', o), getGeneration: (id) => call('get_generation', { id }), cancelGeneration: (id) => call('cancel_generation', { id }), reconcileGeneration: (id) => call('reconcile_generation', { id: typeof id === 'string' ? id : id?.id }),
    listSpaces: (o = {}) => call('list_spaces', typeof o === 'string' ? { name: o } : o), getSpace: (id) => call('get_space', { id }), getSpaceInputSchema: (id) => call('get_space_input_schema', { id }),
    quoteSpace: (o) => call('quote_space', o), runSpace: (o) => call('run_space', o), getSpaceRun: (id) => call('get_space_run', { id }), getSpaceRunOutputs: (id) => call('get_space_run_outputs', { id }),
    approveCheckpoint: (o) => call('approve_space_checkpoint', o), rejectCheckpoint: (o) => call('reject_space_checkpoint', o), cancelSpaceRun: (id) => call('cancel_space_run', { id }), reconcileSpaceRun: (id) => call('reconcile_space_run', { id: typeof id === 'string' ? id : id?.id })
  };
  return api;
}
