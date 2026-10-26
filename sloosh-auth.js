// Brew's own Sloosh workspace (sloosh.ai, ShopOS's creative studio): one connection for every brand, made once by Brew
// staff. Sloosh has no API keys: its MCP server (https://mcp.sloosh.ai/mcp) takes an OAuth 2.1 bearer token from Clerk
// (the authorization server Sloosh names in its protected-resource metadata: clerk.sloosh.ai since 21 Oct, clerk.app.shopos.ai before), with PKCE and dynamic client registration. The client id is registered once per redirect
// URI and kept in brands/_brew/private/sloosh-client.json; the tokens live encrypted in the _brew vault (vault.js), so a
// flush (tools/flush-live.sh keeps _brew) and a deploy keep the connection. Tokens never reach a brand or a log.
import crypto from 'node:crypto';
import { PRODUCT_NAME } from './product-name.js';

export const SCOPES = 'spacelab:read spacelab:author spacelab:execute user:org:read offline_access';
export const AUTH_URL = () => (process.env.SLOOSH_AUTH_URL || 'https://clerk.sloosh.ai').replace(/\/$/, '');
export const MCP_URL = () => process.env.SLOOSH_MCP_URL || 'https://mcp.sloosh.ai/mcp';
/* RFC 8707: the token is minted for the MCP server, so every authorize and token call names it (else Sloosh answers 401 invalid_token) */
export const RESOURCE = () => process.env.SLOOSH_RESOURCE || MCP_URL();
/* the sign-in server Sloosh trusts today, read from its own metadata (RFC 9728), kept an hour: on 21 Oct Sloosh moved from
   clerk.app.shopos.ai to clerk.sloosh.ai and every token from the old one was refused (401 invalid_token). SLOOSH_AUTH_URL pins it */
let serverMemo = null;
export async function authServer(fetchImpl = fetch) {
  if (process.env.SLOOSH_AUTH_URL) return AUTH_URL();
  if (serverMemo && Date.now() - serverMemo.at < 3600e3) return serverMemo.url;
  try { const m = new URL(MCP_URL()); const r = await fetchImpl(`${m.origin}/.well-known/oauth-protected-resource${m.pathname.replace(/\/$/, '')}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10e3) });
    const url = String((await r.json())?.authorization_servers?.[0] || '').replace(/\/$/, ''); if (r.ok && /^https:\/\//.test(url)) { serverMemo = { url, at: Date.now() }; return url; } } catch {}
  return AUTH_URL();
}
const BREW = '_brew', CLIENT_FILE = 'private/sloosh-client.json', VAULT_ID = 'sloosh';
const b64u = (b) => Buffer.from(b).toString('base64url');
export const pkce = () => { const verifier = b64u(crypto.randomBytes(32)); return { verifier, challenge: b64u(crypto.createHash('sha256').update(verifier).digest()) }; };

/* one registered client per redirect URI (RFC 7591); the probe tool registers one with no redirect for the device flow */
export async function register({ redirect, fetchImpl = fetch, grants = ['authorization_code', 'refresh_token'], base = null } = {}) {
  const body = { client_name: PRODUCT_NAME, client_uri: process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', redirect_uris: redirect ? [redirect] : [], grant_types: grants, response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPES };
  const r = await fetchImpl(`${base || await authServer(fetchImpl)}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20e3) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.client_id) throw new Error(`Sloosh client registration failed (${r.status}): ${JSON.stringify(j).slice(0, 300)}`);
  return { client_id: j.client_id, client_secret: j.client_secret || null, at: Date.now() };
}

/* a token call (code, refresh or device grant) → { token, refresh, exp, scope }; the resource is always named */
export async function tokenRequest(params, { fetchImpl = fetch, base = null } = {}) {
  const r = await fetchImpl(`${base || await authServer(fetchImpl)}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ resource: RESOURCE(), ...params }), signal: AbortSignal.timeout(20e3) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { const e = new Error(`Sloosh token ${r.status}: ${j.error_description || j.error || 'no access token'}`); e.oauth = j.error || null; e.status = r.status; throw e; }
  return { token: j.access_token, refresh: j.refresh_token || params.refresh_token || null, exp: Date.now() + Math.max(60, +j.expires_in || 3600) * 1e3, scope: j.scope || SCOPES };
}

export function createSlooshAuth({ packs, vault, auth, log = console, fetchImpl = fetch }) {
  const CB = '/api/ops/sloosh/callback';
  let memo = null; /* the decrypted connection, refreshed in place; one instance (max-instances=1) */

  const clients = async () => (await packs.getJSON(BREW, CLIENT_FILE, null)) || {};
  /* a client is registered with one sign-in server: a move to a new server registers again (the key names both) */
  async function clientFor(redirect) {
    const base = await authServer(fetchImpl), key = base === 'https://clerk.app.shopos.ai' ? redirect : `${base}|${redirect}`; /* the old server's entries keep their old key */
    const all = await clients(); if (all[key]?.client_id) return { ...all[key], base };
    const c = await register({ redirect, fetchImpl, base }); all[key] = c; await packs.put(BREW, CLIENT_FILE, all); log.info?.(`[sloosh] registered a client for ${redirect} at ${base}`); return { ...c, base };
  }
  const load = async () => memo || (memo = await vault.load(BREW, VAULT_ID));
  const save = async (c) => { memo = c; await vault.save(BREW, VAULT_ID, c); };

  /* ---------- staff sign-in: /api/ops/sloosh/connect → Clerk → /api/ops/sloosh/callback ---------- */
  async function connectUrl(req, res) {
    const redirect = `${auth.baseOf(req)}${CB}`, c = await clientFor(redirect), { verifier, challenge } = pkce();
    const state = auth.sign({ n: crypto.randomBytes(9).toString('base64url'), email: auth.user(req)?.email || '' }, 900, 'sloosh');
    auth.setCookie(res, 'sl_v', auth.sign({ v: verifier, s: state }, 900, 'sloosh-v'), 900); /* the PKCE verifier never travels through Clerk */
    const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: redirect, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE() });
    return `${c.base}/oauth/authorize?${q}`;
  }
  async function callback(req, u) {
    const st = auth.verify(u.searchParams.get('state') || '', 'sloosh'), cv = auth.verify(auth.cookies(req).sl_v || '', 'sloosh-v'), me = auth.user(req);
    if (!st || !cv || cv.s !== u.searchParams.get('state') || (st.email || me) && st.email !== (me?.email || '')) throw new Error('The sign-in link is stale. Start again from the ops page.');
    const err = u.searchParams.get('error'); if (err) throw new Error(`Sloosh refused the sign-in: ${u.searchParams.get('error_description') || err}`);
    const redirect = `${auth.baseOf(req)}${CB}`, c = await clientFor(redirect);
    const t = await tokenRequest({ grant_type: 'authorization_code', code: u.searchParams.get('code') || '', redirect_uri: redirect, client_id: c.client_id, code_verifier: cv.v, ...(c.client_secret ? { client_secret: c.client_secret } : {}) }, { fetchImpl, base: c.base });
    await save({ ...t, client_id: c.client_id, client_secret: c.client_secret || null, redirect, authServer: c.base, workspace: null, connectedBy: me?.email || 'local', at: Date.now(), refreshedAt: null });
    return memo;
  }
  /* the MCP client calls this before every request; { force } after a 401. One refresh at a time: several calls that find the
     token short-lived (or that all got a 401 at once) share the same in-flight refresh, so a refresh token is never spent twice. */
  let refreshing = null;
  async function tokenFor({ force = false } = {}) {
    const c = await load(); if (!c?.token) throw Object.assign(new Error('Sloosh isn’t connected yet. Our team connects it from the ops page.'), { off: true });
    if (!force && c.exp - Date.now() > 10 * 60e3) return c.token;
    if (refreshing) return refreshing;
    if (force && c.refreshedAt && Date.now() - c.refreshedAt < 5e3) return c.token; /* a refresh just landed: the 401 was on the old token */
    if (!c.refresh) throw Object.assign(new Error('Sloosh needs our team to reconnect: the sign-in ran out and there is no refresh token.'), { expired: true });
    refreshing = (async () => {
      try { const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}) }, { fetchImpl, base: c.authServer || 'https://clerk.app.shopos.ai' }); await save({ ...c, ...t, refreshedAt: Date.now() }); /* a token refreshes where it was issued */ return memo.token; }
      catch (e) { log.warn('[sloosh] refresh failed', e.message); throw Object.assign(new Error('Sloosh needs our team to reconnect: the refresh was refused.'), { expired: true, cause: e }); }
      finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function setWorkspace(ws) { const c = await load(); if (c) await save({ ...c, workspace: ws || c.workspace }); }
  async function status() { const c = await load(); return c?.token ? { connected: true, workspace: c.workspace || null, scope: c.scope, connectedBy: c.connectedBy, at: c.at, refreshedAt: c.refreshedAt, exp: c.exp } : { connected: false }; }
  async function disconnect() { memo = null; await vault.drop(BREW, VAULT_ID); }
  const forget = () => { memo = null; };
  return { connectUrl, callback, tokenFor, status, setWorkspace, disconnect, forget, clientFor, CB };
}
