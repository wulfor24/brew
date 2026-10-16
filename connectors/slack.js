// Slack: one-click sign-in to the Brew Slack app (docs/slack-app-manifest.json). The brand picks a channel on Slack's own
// consent screen (the incoming-webhook scope); Brew then posts the cards and jams the team sends there, and the replies in
// Brew's own threads come back into the jam (server.js /slack/events, Approve through /slack/actions). Slack is never
// evidence for the moves: its read is the workspace and channel only, no cards, no ledger rows.
// The app needs no review: it installs in any workspace once its distribution is public. It switches on by itself when
// SLACK_CLIENT_ID / SLACK_CLIENT_SECRET are set; SLACK_SIGNING_SECRET checks every request Slack sends us.
import crypto from 'node:crypto';
import { form } from './common.js';

const app = () => ({ id: process.env.SLACK_CLIENT_ID || '', secret: process.env.SLACK_CLIENT_SECRET || '', signing: process.env.SLACK_SIGNING_SECRET || '' });
export const SCOPES = 'chat:write,chat:write.public,incoming-webhook,channels:read,groups:read,channels:history,groups:history,users:read,users:read.email,team:read';

/* every Slack Web API call: Slack answers 200 with ok:false on errors, so the error is read from the body */
export async function api(token, method, body = {}, { get = false } = {}) {
  const r = await fetch(`https://slack.com/api/${method}${get ? `?${form(body)}` : ''}`, { method: get ? 'GET' : 'POST', signal: AbortSignal.timeout(20e3),
    headers: { authorization: `Bearer ${token}`, ...(get ? {} : { 'content-type': 'application/json; charset=utf-8' }) }, ...(get ? {} : { body: JSON.stringify(body) }) });
  const j = await r.json().catch(() => ({ ok: false, error: `http_${r.status}` }));
  if (!j.ok) throw Object.assign(new Error(`Slack ${method}: ${j.error || 'failed'}`), { slack: j.error || 'failed' });
  return j;
}

/* a request from Slack: v0 HMAC of "v0:<timestamp>:<raw body>" with the app's signing secret, at most 5 minutes old */
export function verify(raw, headers, secret = app().signing, now = Date.now()) {
  const ts = +headers['x-slack-request-timestamp'], sig = String(headers['x-slack-signature'] || '');
  if (!secret || !ts || !sig || Math.abs(now / 1e3 - ts) > 300) return false;
  const want = `v0=${crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex')}`;
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

/* plain words for what Slack refused */
const WHY = { not_in_channel: 'Brew isn’t in that channel. Invite @Brew to it, or pick a public channel.', channel_not_found: 'That channel is gone or private. Invite @Brew to it first.',
  is_archived: 'That channel is archived.', invalid_auth: 'Slack signed Brew out. Connect Slack again.', token_revoked: 'Slack signed Brew out. Connect Slack again.', account_inactive: 'Slack signed Brew out. Connect Slack again.' };
export const why = (e) => WHY[e?.slack] || e?.message || 'Slack didn’t take that. Try again.';

export default {
  id: 'slack', name: 'Slack', modes: ['oauth'], every: 24,
  ready: () => true,
  oauthOn: () => !!(app().id && app().secret),
  authorize({ state, redirect }) { return `https://slack.com/oauth/v2/authorize?${form({ client_id: app().id, scope: SCOPES, redirect_uri: redirect, state })}`; },
  async exchange({ query, redirect }) {
    if (query.get('error')) throw Object.assign(new Error('Slack didn’t let Brew in. Try again and press Allow.'), { user: true });
    const r = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', signal: AbortSignal.timeout(20e3), headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: app().id, client_secret: app().secret, code: query.get('code'), redirect_uri: redirect }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok || !j.access_token) throw new Error(`Slack sign-in failed: ${j.error || r.status}`);
    const hook = j.incoming_webhook || {};
    return { token: j.access_token, bot: j.bot_user_id || null, app: j.app_id || null, team: j.team?.id || null, teamName: j.team?.name || null,
      channel: hook.channel_id || null, channelName: hook.channel ? (hook.channel.startsWith('#') ? hook.channel : `#${hook.channel}`) : null, by: j.authed_user?.id || null };
  },
  /* a workspace belongs to the team that connected it, not to a store: there is nothing to match */
  async owns(c) { return { ok: true, account: { id: c.team, name: `${c.teamName || 'Slack'} · ${c.channelName || 'Slack'}` } }; },
  async sync(c) {
    const t = await api(c.token, 'auth.test');
    return { account: { id: c.team, name: `${t.team || c.teamName} · ${c.channelName || 'Slack'}` },
      stats: [['Workspace', t.team || c.teamName], ['Channel', c.channelName || 'Not picked']],
      changed: [`Cards and jams you send post to ${c.channelName || 'your channel'}. Replies in the thread come back to the jam.`], cards: [], ledger: [], notes: [] };
  }
};
