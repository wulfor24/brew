// Sloosh over MCP without the network: a fake Clerk (register, token, refresh) and a fake MCP server (initialize, tools/list,
// tools/call as JSON and as SSE, a 401 once) on a local port. Nothing here reaches sloosh.ai.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { register, tokenRequest, createSlooshAuth, pkce } from '../sloosh-auth.js';
import { createSloosh, argsFor, parseReply, unwrap } from '../sloosh-mcp.js';

const TOOLS = [
  { name: 'get_connection', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_models', inputSchema: { type: 'object', properties: { mode: { type: 'string' } } } },
  { name: 'quote_generation', inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, model: { type: 'string' }, reference_asset_ids: { type: 'array' }, settings: { type: 'object', properties: { aspect_ratio: { type: 'string' }, duration: { type: 'number' } } }, count: { type: 'number' } }, required: ['prompt', 'model'], additionalProperties: false } },
  { name: 'generate', inputSchema: { type: 'object', properties: { quote_id: { type: 'string' }, idempotency_key: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['quote_id', 'idempotency_key', 'confirmed'] } },
  { name: 'get_generation', inputSchema: { type: 'object', properties: { generation_id: { type: 'string' } }, required: ['generation_id'] } }
];

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
        const result = name === 'get_connection' ? { structuredContent: { workspace: { id: 'ws1', name: 'Brew' }, limit: { remaining: 100 } } }
          : name === 'list_models' ? { content: [{ type: 'text', text: JSON.stringify({ models: [{ id: 'nano-banana-pro', mode: a.mode }] }) }] }
          : name === 'quote_generation' ? { structuredContent: { quote_id: 'q1', credits: 2.5, expires_at: Date.now() + 300e3 } }
          : name === 'generate' ? { structuredContent: { generation_id: 'g1', status: 'running' } }
          : name === 'get_generation' ? { structuredContent: { generation_id: 'g1', status: log.calls.filter((c) => c.name === 'get_generation').length > 1 ? 'completed' : 'running', outputs: [{ asset_id: 'as1' }] } }
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

test('argsFor maps Brew words onto the tool schema, nests dotted keys and names a missing required key', () => {
  const q = TOOLS[2];
  const a = argsFor(q, { prompt: 'p', model: 'm', references: ['a1'], ratio: '4:5', seconds: 6, count: 2 });
  assert.deepEqual(a, { prompt: 'p', model: 'm', reference_asset_ids: ['a1'], settings: { aspect_ratio: '4:5', duration: 6 }, count: 2 });
  assert.throws(() => argsFor(q, { prompt: 'p' }), /needs model/);
  assert.deepEqual(argsFor(TOOLS[4], { id: 'g1' }), { generation_id: 'g1' });
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
    const cx = await S.getConnection(); assert.equal(cx.workspace.name, 'Brew');
    const models = await S.listModels('image_gen'); assert.equal(models.models[0].mode, 'image_gen');
    F.log.sse = true; const q = await S.quoteGeneration({ prompt: 'p', model: 'm', ratio: '4:5' }); assert.equal(q.credits, 2.5); F.log.sse = false;
    assert.deepEqual(F.log.calls.at(-1).arguments, { prompt: 'p', model: 'm', settings: { aspect_ratio: '4:5' } });
    /* the token runs out between calls: one refresh, same call again */
    F.log.unauthOnce = true; const g = await S.generate({ quote: 'q1', runKey: 'k1', confirmed: true }); assert.equal(g.generation_id, 'g1'); assert.equal(F.log.refreshes, 1); assert.equal((await A.status()).connected, true);
    const done = await S.wait(() => S.getGeneration('g1'), { every: 5 }); assert.equal(done.status, 'completed');
    await assert.rejects(S.call('no_such_tool', {}), /no tool called/);
    await A.disconnect(); await assert.rejects(A.tokenFor(), (e) => e.off === true);
  } finally { F.stop(); }
});
