#!/usr/bin/env node
// Sign in to Sloosh from this computer (a registered client whose redirect is this script on 127.0.0.1:8765; Clerk gives a
// dynamically registered client no device-code grant) and dump what the MCP server really exposes: every tool's input
// schema, the models per mode, the guides and the published Spaces. Writes data/sloosh-tools.json (schemas only, no tokens)
// and the rest to $OUT (default: the scratchpad). The token stays in memory; the live site signs in through
// /api/ops/sloosh/connect and keeps its own tokens in the _brew vault.
//   node tools/sloosh-probe.mjs     then open the printed link, pick the Brew workspace, come back
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { register, tokenRequest, pkce, AUTH_URL, SCOPES } from '../sloosh-auth.js';
import { createSloosh } from '../sloosh-mcp.js';

const PORT = +process.env.PORT || 8765, OUT = process.env.OUT || process.env.TMPDIR || '.', REDIRECT = `http://127.0.0.1:${PORT}/cb`;
const CLIENTS = path.join(OUT, 'sloosh-probe-client.json');
let c = null; try { c = JSON.parse(fs.readFileSync(CLIENTS, 'utf8'))[REDIRECT] || null; } catch {}
if (!c) { c = await register({ redirect: REDIRECT }); fs.writeFileSync(CLIENTS, JSON.stringify({ [REDIRECT]: c })); }
const { verifier, challenge } = pkce(); const state = Math.random().toString(36).slice(2);
const url = `${AUTH_URL()}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' })}`;
const code = await new Promise((resolve, reject) => {
  const srv = http.createServer((rq, rs) => { const u = new URL(rq.url, 'http://x'); if (u.pathname !== '/cb') { rs.writeHead(404); return rs.end(); }
    const ok = u.searchParams.get('state') === state && u.searchParams.get('code'); rs.writeHead(200, { 'content-type': 'text/html' }); rs.end(ok ? '<p>Signed in. You can close this tab.</p>' : `<p>Failed: ${u.searchParams.get('error_description') || u.searchParams.get('error') || 'no code'}</p>`);
    srv.close(); ok ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error_description') || 'sign-in failed')); });
  srv.listen(PORT, '127.0.0.1', () => console.log(`\nOpen this link, sign in to Sloosh and pick the Brew workspace:\n\n${url}\n`));
});
const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: c.client_id, code_verifier: verifier });
console.log('signed in; scope:', t.scope, '; refresh token:', !!t.refresh);
const S = createSloosh({ tokenFor: async () => t.token });
const tools = await S.list();
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'sloosh-tools.json'), JSON.stringify({ at: new Date().toISOString(), tools: tools.map((x) => ({ name: x.name, description: x.description, inputSchema: x.inputSchema, outputSchema: x.outputSchema || undefined })) }, null, 1));
console.log(`${tools.length} tools → data/sloosh-tools.json`);
const dump = async (name, fn) => { try { const v = await fn(); fs.writeFileSync(path.join(OUT, `sloosh-${name}.json`), JSON.stringify(v, null, 1)); console.log(`${name} → ${path.join(OUT, `sloosh-${name}.json`)}`); } catch (e) { console.warn(`${name}: ${e.message}`); } };
await dump('connection', () => S.getConnection());
await dump('account', () => S.getAccount());
await dump('guides', () => S.getGuide());
await dump('models', async () => ({ image_gen: await S.listModels('image_gen').catch((e) => e.message), video_gen: await S.listModels('video_gen').catch((e) => e.message), video_edit: await S.listModels('video_edit').catch((e) => e.message), all: await S.listModels().catch((e) => e.message) }));
await dump('spaces', () => S.listSpaces());
