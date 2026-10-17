// Sloosh over MCP without the network: a fake Clerk (register, token, refresh) and a fake MCP server (initialize, tools/list,
// tools/call as JSON and as SSE, a 401 once) on a local port. Nothing here reaches sloosh.ai.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { register, tokenRequest, createSlooshAuth, pkce } from '../sloosh-auth.js';
import { createSloosh, argsFor, parseReply, unwrap, flat, PREFLIGHT_CASES, preflightOf } from '../sloosh-mcp.js';
import fs from 'node:fs';

/* the real tools, as tools/list gave them on 2026-10-16 (tools/sloosh-probe.mjs) */
const REAL = JSON.parse(fs.readFileSync(new URL('../data/sloosh-tools.json', import.meta.url), 'utf8')).tools;
const real = (n) => { const t = REAL.find((x) => x.name === n); if (!t) throw new Error(`data/sloosh-tools.json has no ${n}`); return t; };
const TOOLS = ['get_connection', 'get_account', 'list_models', 'quote_generation', 'generate', 'get_generation', 'get_asset', 'import_asset', 'list_assets', 'reconcile_generation'].map(real);

function fakeServers() {
  const log = { tokens: 0, refreshes: 0, calls: [], unauthOnce: false, sse: false };
  const read = (rq) => new Promise((r) => { let b = ''; rq.on('data', (c) => b += c); rq.on('end', () => r(b ? JSON.parse(b) : {})); });
  const srv = http.createServer(async (rq, rs) => {
    const u = new URL(rq.url, 'http://x'); const json = (code, o, h = {}) => { rs.writeHead(code, { 'content-type': 'application/json', ...h }); rs.end(JSON.stringify(o)); };
    if (u.pathname === '/oauth/register') { const b = await read(rq); return json(201, { client_id: 'cid_' + (b.redirect_uris?.[0] ? 'web' : 'device'), token_endpoint_auth_method: 'none' }); }
    if (u.pathname === '/oauth/token') { let b = ''; for await (const c of rq) b += c; const p = new URLSearchParams(b);
      if (p.get('grant_type') === 'authorization_code') { log.tokens++; return p.get('code') === 'good' && p.get('code_verifier') ? json(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: 'spacelab:read' }) : json(400, { error: 'invalid_grant' }); }
      if (p.get('grant_type') === 'refresh_token') { log.refreshes++; return p.get('refresh_token') === 'rt1' ? json(200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 }) : json(400, { error: 'invalid_grant' }); }
      return json(400, { error: 'unsupported_grant_type' }); }
    if (u.pathname === '/mcp') {
      const tok = (rq.headers.authorization || '').replace('Bearer ', '');
      if (log.unauthOnce) { log.unauthOnce = false; return json(401, { error: 'expired' }, { 'www-authenticate': 'Bearer' }); }
      if (!['at1', 'at2'].includes(tok)) return json(401, { error: 'no token' });
      const m = await read(rq); const sid = rq.headers['mcp-session-id'];
      if (m.method === 'initialize') return json(200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'spacelab-mcp' }, capabilities: { tools: {} } } }, { 'mcp-session-id': 'sess1' });
      if (m.method === 'notifications/initialized') { rs.writeHead(202); return rs.end(); }
      if (sid !== 'sess1') return json(404, { error: 'no session' });
      if (m.method === 'tools/list') return json(200, { jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
      if (m.method === 'tools/call') { log.calls.push(m.params); const { name, arguments: a } = m.params;
        const result = name === 'get_connection' ? { structuredContent: { connection: { workspaceId: 'org_1', product: 'sloosh', scopes: ['spacelab:read'] }, budget: { configured: true, unit: 'millicredits', dailyLimitUnits: 50000, remainingUnits: 50000 }, spendingEnabled: true, settingsUrl: 'https://sloosh.ai/settings/mcp' } }
          : name === 'list_models' ? { content: [{ type: 'text', text: JSON.stringify({ models: { image: { defaultModel: 'gemini-nano-banana-2.1', models: [{ id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' }] }, video: { defaultModel: 'seedance-2.5', models: [] } }, mode: a.mode }) }] }
          : name === 'quote_generation' ? { structuredContent: { quoteId: 'q1', credits: 2.5, expiresAt: new Date(Date.now() + 300e3).toISOString(), input: a } }
          : name === 'generate' ? { structuredContent: { operationId: 'op1', state: 'admitted', reservedUnits: 2500, settledUnits: null, reconciliationRequired: false, cancellationRequested: false, owner: null } }
          : name === 'get_generation' ? { structuredContent: log.calls.filter((c) => c.name === 'get_generation').length > 1 ? { operationId: 'op1', state: 'settled', owner: { phase: 'settled', outputs: [{ generationId: 'gen1', status: 'completed', url: 'https://cdn/gen1.png' }], chargedCredits: 2.5, errorCode: null } } : { operationId: 'op1', state: 'submitted', owner: { phase: 'running', outputs: [] } } }
          : { isError: true, content: [{ type: 'text', text: 'unknown tool' }] };
        const msg = { jsonrpc: '2.0', id: m.id, result };
        if (log.sse) { rs.writeHead(200, { 'content-type': 'text/event-stream' }); return rs.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\nevent: message\ndata: ${JSON.stringify(msg)}\n\n`); }
        return json(200, msg); }
      return json(200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no such method' } });
    }
    json(404, { error: 'nope' });
  });
  return { srv, log, async start() { await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`; process.env.SLOOSH_AUTH_URL = base; process.env.SLOOSH_MCP_URL = `${base}/mcp`; return base; }, stop() { srv.close(); delete process.env.SLOOSH_AUTH_URL; delete process.env.SLOOSH_MCP_URL; } };
}

/* a packs + vault + auth stand-in: files in memory, tokens signed with a fixed secret */
function rig() {
  const files = new Map();
  const packs = { getJSON: async (slug, n, d) => files.get(`${slug}/${n}`) ?? d, put: async (slug, n, data) => { files.set(`${slug}/${n}`, typeof data === 'string' ? JSON.parse(data) : data); } };
  const vault = { save: async (s, id, v) => files.set(`vault/${s}/${id}`, v), load: async (s, id) => files.get(`vault/${s}/${id}`) || null, drop: async (s, id) => files.delete(`vault/${s}/${id}`) };
  const cookies = {}; const auth = { baseOf: () => 'http://brew.test', user: () => ({ email: 'ops@joinsquareup.com' }), isAdmin: () => true,
    sign: (o, ttl, typ) => Buffer.from(JSON.stringify({ ...o, typ })).toString('base64url'), verify: (t, typ) => { try { const o = JSON.parse(Buffer.from(t, 'base64url')); return o.typ === typ ? o : null; } catch { return null; } },
    setCookie: (res, k, v) => { cookies[k] = v; }, cookies: () => cookies };
  return { packs, vault, auth, files, cookies };
}

test('argsFor maps Brew words onto the real schemas, nests modelConfig, drops what a closed schema has no key for, names a missing required key', () => {
  const q = real('quote_generation'); const ref = { kind: 'workspace', id: '2c1f0a2e-6a2b-4b1e-9c3d-1a2b3c4d5e6f', url: 'https://cdn/x.png', type: 'image', role: 'reference' };
  const a = argsFor(q, { mode: 'image_gen', prompt: 'p', model: 'gemini-3-pro-image-preview', references: [ref], ratio: '4:5', resolution: '2K', count: 2, seconds: undefined });
  assert.deepEqual(a, { mode: 'image_gen', prompt: 'p', modelConfig: { modelName: 'gemini-3-pro-image-preview', aspectRatio: '4:5', resolution: '2K' }, uploadedAssets: [ref], generationCount: 2 });
  assert.throws(() => argsFor(q, { prompt: 'p' }), /needs modelConfig/);
  const warned = []; assert.deepEqual(argsFor(real('generate'), { quote: 'q1', runKey: 'k1', confirmed: true, nothing: 1 }, { warn: (m) => warned.push(m) }), { quoteId: 'q1', idempotencyKey: 'k1', confirmed: true }); assert.match(warned[0], /no schema key for nothing \(left out\)/);
  assert.deepEqual(argsFor(real('get_generation'), { id: 'op1' }), { operationId: 'op1' });
  assert.deepEqual(argsFor(real('get_asset'), { kind: 'generated', id: 'g1' }), { kind: 'generated', id: 'g1' }); /* a top-level oneOf, flattened */
  assert.deepEqual(flat(real('get_asset').inputSchema).required, ['kind', 'id']);
});

test('every required key of the tools finals.js calls is filled from Brew’s own words (data/sloosh-tools.json), and the live preflight reads the same', () => {
  const tools = Object.keys(PREFLIGHT_CASES).map(real);
  for (const [name, intent] of Object.entries(PREFLIGHT_CASES)) { const t = real(name); const warned = []; const a = argsFor(t, intent, { warn: (m) => warned.push(m) });
    for (const r of flat(t.inputSchema).required || []) assert.notEqual(a[r], undefined, `${name} needs ${r}`);
    assert.deepEqual(warned, [], `${name}: ${warned.join('; ')}`); }
  assert.equal(preflightOf(tools).ok, true);
  const drift = preflightOf(tools.filter((t) => t.name !== 'generate').map((t) => (t.name === 'get_asset' ? { ...t, inputSchema: { type: 'object', properties: { assetRef: { type: 'string' } }, required: ['assetRef'], additionalProperties: false } } : t)));
  assert.equal(drift.ok, false); assert.match(drift.tools.generate, /no tool/); assert.match(drift.tools.get_asset, /needs assetRef/);
});

test('parseReply reads JSON and SSE bodies; unwrap prefers structuredContent, then JSON text', () => {
  assert.equal(parseReply('{"jsonrpc":"2.0","id":3,"result":{"ok":1}}', 3).result.ok, 1);
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":4,"result":{"ok":2}}\n\n';
  assert.equal(parseReply(sse, 4).result.ok, 2);
  assert.deepEqual(unwrap({ structuredContent: { a: 1 } }), { a: 1 });
  assert.deepEqual(unwrap({ content: [{ type: 'text', text: '{"b":2}' }] }), { b: 2 });
  assert.deepEqual(unwrap({ content: [{ type: 'text', text: 'plain' }] }), { text: 'plain' });
});

test('register, the staff sign-in, a refreshed token and the MCP session end to end', async () => {
  const F = fakeServers(); const base = await F.start();
  try {
    const c = await register({ redirect: 'http://brew.test/cb' }); assert.equal(c.client_id, 'cid_web');
    const { verifier } = pkce(); const t = await tokenRequest({ grant_type: 'authorization_code', code: 'good', code_verifier: verifier, client_id: c.client_id, redirect_uri: 'x' }); assert.equal(t.token, 'at1');
    const R = rig(); const A = createSlooshAuth({ ...R, log: { warn() {}, info() {} } });
    await assert.rejects(A.tokenFor(), (e) => e.off === true);
    const res = {}; const url = new URL(await A.connectUrl({ headers: {} }, res)); assert.equal(url.pathname, '/oauth/authorize'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const state = url.searchParams.get('state');
    await assert.rejects(A.callback({ headers: {} }, new URL(`http://brew.test/cb?code=good&state=bad`)), /stale/);
    const conn = await A.callback({ headers: {} }, new URL(`http://brew.test/cb?code=good&state=${state}`)); assert.equal(conn.token, 'at1'); assert.equal(conn.connectedBy, 'ops@joinsquareup.com');
    assert.ok(R.files.get('_brew/private/sloosh-client.json')['http://brew.test/api/ops/sloosh/callback']);
    const S = createSloosh({ tokenFor: A.tokenFor, log: { warn() {} } });
    const cx = await S.getConnection(); assert.equal(cx.budget.remainingUnits, 50000);
    const models = await S.listModels('image_gen'); assert.equal(models.mode, 'image_gen'); assert.equal(models.models.image.models[0].id, 'gemini-3-pro-image-preview');
    F.log.sse = true; const q = await S.quoteGeneration({ mode: 'image_gen', prompt: 'p', model: 'm', ratio: '4:5' }); assert.equal(q.credits, 2.5); assert.equal(q.quoteId, 'q1'); F.log.sse = false;
    assert.deepEqual(F.log.calls.at(-1).arguments, { mode: 'image_gen', prompt: 'p', modelConfig: { modelName: 'm', aspectRatio: '4:5' } });
    /* the token runs out between calls: one refresh, same call again */
    F.log.unauthOnce = true; const g = await S.generate({ quote: 'q1', runKey: 'k1', confirmed: true }); assert.equal(g.operationId, 'op1'); assert.equal(F.log.refreshes, 1); assert.equal((await A.status()).connected, true);
    assert.deepEqual(F.log.calls.at(-1).arguments, { quoteId: 'q1', idempotencyKey: 'k1', confirmed: true });
    const done = await S.wait(() => S.getGeneration('op1'), { every: 5 }); assert.equal(S.stateOf(done), 'settled'); assert.equal(done.owner.outputs[0].url, 'https://cdn/gen1.png');
    assert.deepEqual(F.log.calls.at(-1).arguments, { operationId: 'op1' });
    assert.equal(S.stateOf({ state: 'settled', owner: { phase: 'rejected' } }), 'rejected'); assert.equal(S.stateOf({ state: 'settled', owner: { phase: 'settled', errorCode: 'content_filter', outputs: [{ url: null }] } }), 'failed');
    assert.equal(S.stateOf({ state: 'settled', owner: { terminalStatus: 'completed' } }), 'completed'); assert.equal(S.pendingCheckpoint({ owner: { checkpoints: [{ nodeId: 'n', decisionPending: true }] } }).nodeId, 'n');
    await assert.rejects(S.call('no_such_tool', {}), /no tool called/);
    await A.disconnect(); await assert.rejects(A.tokenFor(), (e) => e.off === true);
  } finally { F.stop(); }
});

test('wait retries a failing poll (5xx, timeout, network) three times with backoff, then leaves the run open; a terminal state and the wait limit are flagged', async () => {
  const S = createSloosh({ tokenFor: async () => 't', log: { warn() {} } }); const naps = []; const sleep = async (ms) => { naps.push(ms); };
  let n = 0; const flaky = async () => { n++; if (n === 1) throw Object.assign(new Error('Sloosh MCP 503: upstream'), { status: 503 }); if (n === 2) throw new TypeError('fetch failed'); return { state: 'settled', owner: { phase: 'settled', outputs: [{ url: 'u' }] } }; };
  const done = await S.wait(flaky, { every: 1, sleep }); assert.equal(S.stateOf(done), 'settled'); assert.equal(n, 3); assert.deepEqual(naps.slice(0, 2), [2000, 4000]); /* 2 s, 4 s, then the third try (the last of three) went through */
  let m = 0; const slow = async () => { m++; if (m < 3) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); return { state: 'settled', owner: { phase: 'settled', outputs: [{ url: 'u' }] } }; }; await S.wait(slow, { every: 1, sleep }); assert.equal(m, 3);
  const dead = async () => { throw Object.assign(new Error('Sloosh MCP 502'), { status: 502 }); }; await assert.rejects(S.wait(dead, { every: 1, sleep }), (e) => e.pollError === true && e.terminal !== true && /may still be going/.test(e.message));
  const expired = async () => { throw Object.assign(new Error('Sloosh needs Brew staff to reconnect'), { expired: true }); }; await assert.rejects(S.wait(expired, { every: 1, sleep }), (e) => e.pollError === true && e.expired === true); /* not retried, still open */
  await assert.rejects(S.wait(async () => ({ state: 'settled', owner: { phase: 'rejected' } }), { every: 1, sleep }), (e) => e.terminal === true);
  await assert.rejects(S.wait(async () => ({ state: 'submitted', owner: { phase: 'running' } }), { every: 1, maxMs: -1, sleep }), (e) => e.timeout === true && !e.terminal);
  const bad = async () => { throw new Error('Sloosh get_generation: no such operation'); }; const before = naps.length; await assert.rejects(S.wait(bad, { every: 1, sleep }), (e) => e.pollError === true); assert.equal(naps.length, before); /* a plain tool error is not retried */
});

test('several calls that need a refresh at once share one in-flight refresh', async () => {
  const R = rig(); let refreshes = 0; const fetchImpl = async (u, o) => { if (String(u).endsWith('/oauth/token')) { refreshes++; await new Promise((r) => setTimeout(r, 5)); return new Response(JSON.stringify({ access_token: 'at' + refreshes, refresh_token: 'rt' + refreshes, expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }); } throw new Error('unexpected ' + u); };
  await R.vault.save('_brew', 'sloosh', { token: 'old', refresh: 'rt0', client_id: 'cid', exp: Date.now() + 60e3, refreshedAt: null });
  const A = createSlooshAuth({ ...R, fetchImpl, log: { warn() {}, info() {} } });
  const got = await Promise.all([A.tokenFor(), A.tokenFor({ force: true }), A.tokenFor()]); assert.deepEqual(got, ['at1', 'at1', 'at1']); assert.equal(refreshes, 1);
  assert.equal(await A.tokenFor({ force: true }), 'at1'); assert.equal(refreshes, 1); /* a 401 right after a refresh: the refresh just landed, the token stands */
});
