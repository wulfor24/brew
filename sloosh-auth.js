// Brew's own Sloosh workspace (sloosh.ai, ShopOS's creative studio): one connection for every brand, made once by Brew
// staff. Sloosh has no API keys: its MCP server (https://mcp.sloosh.ai/mcp) takes an OAuth 2.1 bearer token from Clerk
// (https://clerk.app.shopos.ai), with PKCE and dynamic client registration. The client id is registered once per redirect
// URI and kept in brands/_brew/private/sloosh-client.json; the tokens live encrypted in the _brew vault (vault.js), so a
// flush (tools/flush-live.sh keeps _brew) and a deploy keep the connection. Tokens never reach a brand or a log.
import crypto from 'node:crypto';

export const SCOPES = 'spacelab:read spacelab:author spacelab:execute user:org:read offline_access';
export const AUTH_URL = () => (process.env.SLOOSH_AUTH_URL || 'https://clerk.app.shopos.ai').replace(/\/$/, '');
export const MCP_URL = () => process.env.SLOOSH_MCP_URL || 'https://mcp.sloosh.ai/mcp';
/* RFC 8707: the token is minted for the MCP server, so every authorize and token call names it (else Sloosh answers 401 invalid_token) */
export const RESOURCE = () => process.env.SLOOSH_RESOURCE || MCP_URL();
const BREW = '_brew', CLIENT_FILE = 'private/sloosh-client.json', VAULT_ID = 'sloosh';
const b64u = (b) => Buffer.from(b).toString('base64url');
export const pkce = () => { const verifier = b64u(crypto.randomBytes(32)); return { verifier, challenge: b64u(crypto.createHash('sha256').update(verifier).digest()) }; };

/* one registered client per redirect URI (RFC 7591); the probe tool registers one with no redirect for the device flow */
export async function register({ redirect, fetchImpl = fetch, grants = ['authorization_code', 'refresh_token'] } = {}) {
  const body = { client_name: 'Brew', client_uri: 'https://brew.joinsquareup.com', redirect_uris: redirect ? [redirect] : [], grant_types: grants, response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPES };
  const r = await fetchImpl(`${AUTH_URL()}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20e3) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.client_id) throw new Error(`Sloosh client registration failed (${r.status}): ${JSON.stringify(j).slice(0, 300)}`);
  return { client_id: j.client_id, client_secret: j.client_secret || null, at: Date.now() };
}

/* a token call (code, refresh or device grant) → { token, refresh, exp, scope }; the resource is always named */
export async function tokenRequest(params, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${AUTH_URL()}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ resource: RESOURCE(), ...params }), signal: AbortSignal.timeout(20e3) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { const e = new Error(`Sloosh token ${r.status}: ${j.error_description || j.error || 'no access token'}`); e.oauth = j.error || null; e.status = r.status; throw e; }
  return { token: j.access_token, refresh: j.refresh_token || params.refresh_token || null, exp: Date.now() + Math.max(60, +j.expires_in || 3600) * 1e3, scope: j.scope || SCOPES };
}

export function createSlooshAuth({ packs, vault, auth, log = console, fetchImpl = fetch }) {
  const CB = '/api/ops/sloosh/callback';
  let memo = null; /* the decrypted connection, refreshed in place; one instance (max-instances=1) */

  const clients = async () => (await packs.getJSON(BREW, CLIENT_FILE, null)) || {};
  async function clientFor(redirect) {
    const all = await clients(); if (all[redirect]?.client_id) return all[redirect];
    const c = await register({ redirect, fetchImpl }); all[redirect] = c; await packs.put(BREW, CLIENT_FILE, all); log.info?.(`[sloosh] registered a client for ${redirect}`); return c;
  }
  const load = async () => memo || (memo = await vault.load(BREW, VAULT_ID));
  const save = async (c) => { memo = c; await vault.save(BREW, VAULT_ID, c); };

  /* ---------- staff sign-in: /api/ops/sloosh/connect → Clerk → /api/ops/sloosh/callback ---------- */
  async function connectUrl(req, res) {
    const redirect = `${auth.baseOf(req)}${CB}`, c = await clientFor(redirect), { verifier, challenge } = pkce();
    const state = auth.sign({ n: crypto.randomBytes(9).toString('base64url'), email: auth.user(req)?.email || '' }, 900, 'sloosh');
    auth.setCookie(res, 'sl_v', auth.sign({ v: verifier, s: state }, 900, 'sloosh-v'), 900); /* the PKCE verifier never travels through Clerk */
    const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: redirect, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE() });
    return `${AUTH_URL()}/oauth/authorize?${q}`;
  }
  async function callback(req, u) {
    const st = auth.verify(u.searchParams.get('state') || '', 'sloosh'), cv = auth.verify(auth.cookies(req).sl_v || '', 'sloosh-v'), me = auth.user(req);
    if (!st || !cv || cv.s !== u.searchParams.get('state') || (st.email || me) && st.email !== (me?.email || '')) throw new Error('The sign-in link is stale. Start again from the ops page.');
    const err = u.searchParams.get('error'); if (err) throw new Error(`Sloosh refused the sign-in: ${u.searchParams.get('error_description') || err}`);
    const redirect = `${auth.baseOf(req)}${CB}`, c = await clientFor(redirect);
    const t = await tokenRequest({ grant_type: 'authorization_code', code: u.searchParams.get('code') || '', redirect_uri: redirect, client_id: c.client_id, code_verifier: cv.v, ...(c.client_secret ? { client_secret: c.client_secret } : {}) }, { fetchImpl });
    await save({ ...t, client_id: c.client_id, client_secret: c.client_secret || null, redirect, workspace: null, connectedBy: me?.email || 'local', at: Date.now(), refreshedAt: null });
    return memo;
  }
  /* the MCP client calls this before every request; { force } after a 401 */
  async function tokenFor({ force = false } = {}) {
    const c = await load(); if (!c?.token) throw Object.assign(new Error('Brew is not connected to Sloosh yet. Brew staff connect it from the ops page.'), { off: true });
    if (!force && c.exp - Date.now() > 10 * 60e3) return c.token;
    if (!c.refresh) throw Object.assign(new Error('Sloosh needs Brew staff to reconnect: the sign-in ran out and there is no refresh token.'), { expired: true });
    try { const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}) }, { fetchImpl }); await save({ ...c, ...t, refreshedAt: Date.now() }); return memo.token; }
    catch (e) { log.warn('[sloosh] refresh failed', e.message); throw Object.assign(new Error('Sloosh needs Brew staff to reconnect: the refresh was refused.'), { expired: true, cause: e }); }
  }
  async function setWorkspace(ws) { const c = await load(); if (c) await save({ ...c, workspace: ws || c.workspace }); }
  async function status() { const c = await load(); return c?.token ? { connected: true, workspace: c.workspace || null, scope: c.scope, connectedBy: c.connectedBy, at: c.at, refreshedAt: c.refreshedAt, exp: c.exp } : { connected: false }; }
  async function disconnect() { memo = null; await vault.drop(BREW, VAULT_ID); }
  const forget = () => { memo = null; };
  return { connectUrl, callback, tokenFor, status, setWorkspace, disconnect, forget, clientFor, CB };
}
