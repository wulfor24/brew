// Slack is real on the live site: one-click sign-in, posts what the team sends, and only signed requests from Slack reach a jam.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
process.env.BUILD_RESUME_OFF = '1';
const slack = (await import('../connectors/slack.js')).default;
const { verify, api } = await import('../connectors/slack.js');
const { createSlackRoutes, plain, isReply } = await import('../slack-routes.js');

const sign = (raw, secret = 'shh', ts = Math.floor(Date.now() / 1e3)) => ({ 'x-slack-request-timestamp': String(ts), 'x-slack-signature': `v0=${crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex')}` });
const reqOf = (raw, headers) => Object.assign(Readable.from([raw]), { method: 'POST', headers });
const resOf = () => ({ code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b || ''; } });
const tick = () => new Promise((r) => setTimeout(r, 10));

test('Slack: sign-in switches on with its client keys and asks for the channel on Slack’s own screen', () => {
  delete process.env.SLACK_CLIENT_ID; delete process.env.SLACK_CLIENT_SECRET;
  assert.equal(slack.oauthOn(), false);
  process.env.SLACK_CLIENT_ID = 'cid'; process.env.SLACK_CLIENT_SECRET = 'sec';
  try {
    assert.equal(slack.oauthOn(), true);
    const u = new URL(slack.authorize({ state: 's', redirect: 'https://x/connect/slack/callback' }));
    assert.equal(u.origin + u.pathname, 'https://slack.com/oauth/v2/authorize');
    assert.match(u.searchParams.get('scope'), /incoming-webhook/); assert.match(u.searchParams.get('scope'), /chat:write/);
  } finally { delete process.env.SLACK_CLIENT_ID; delete process.env.SLACK_CLIENT_SECRET; }
});

test('Slack: the token exchange keeps the workspace and the channel picked, and its read is never evidence', async () => {
  const f0 = globalThis.fetch;
  globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => (/oauth\.v2\.access/.test(u)
    ? { ok: true, access_token: 'xoxb-1', bot_user_id: 'B1', team: { id: 'T1', name: 'Cozy HQ' }, incoming_webhook: { channel: '#growth', channel_id: 'C1' } }
    : { ok: true, team: 'Cozy HQ' }) });
  try {
    const c = await slack.exchange({ query: new URLSearchParams('code=x'), redirect: 'https://x/cb' });
    assert.deepEqual([c.token, c.team, c.channel, c.channelName], ['xoxb-1', 'T1', 'C1', '#growth']);
    const d = await slack.sync(c); assert.deepEqual(d.ledger, []); assert.deepEqual(d.cards, []);
    assert.deepEqual(d.stats, [['Workspace', 'Cozy HQ'], ['Channel', '#growth']]);
  } finally { globalThis.fetch = f0; }
  await assert.rejects(() => slack.exchange({ query: new URLSearchParams('error=access_denied'), redirect: 'x' }), /didn’t let Brew in/);
});

test('Slack: an error from the Web API is an error, never an empty answer', async () => {
  const f0 = globalThis.fetch; globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'not_in_channel' }) });
  try { await assert.rejects(() => api('t', 'chat.postMessage', {}), (e) => e.slack === 'not_in_channel'); } finally { globalThis.fetch = f0; }
});

test('Slack: only a fresh request signed with the app’s secret is taken', () => {
  const raw = '{"a":1}';
  assert.equal(verify(raw, sign(raw), 'shh'), true);
  assert.equal(verify(raw, sign(raw, 'other'), 'shh'), false, 'wrong secret');
  assert.equal(verify(raw + ' ', sign(raw), 'shh'), false, 'body changed');
  assert.equal(verify(raw, sign(raw, 'shh', Math.floor(Date.now() / 1e3) - 600), 'shh'), false, 'too old');
  assert.equal(verify(raw, sign(raw), ''), false, 'no secret set');
});

test('Slack: a thread reply is a person writing in a thread; Slack’s markup becomes plain words', () => {
  assert.equal(isReply({ type: 'message', user: 'U1', ts: '2', thread_ts: '1', text: 'yes' }), true);
  assert.equal(isReply({ type: 'message', user: 'U1', ts: '1', thread_ts: '1' }), false, 'the thread’s own post');
  assert.equal(isReply({ type: 'message', user: 'U1', ts: '2' }), false, 'not in a thread');
  assert.equal(isReply({ type: 'message', bot_id: 'B1', user: 'U1', ts: '2', thread_ts: '1' }), false, 'a bot, or Brew’s own mirror');
  assert.equal(isReply({ type: 'message', subtype: 'message_changed', ts: '2', thread_ts: '1' }), false, 'an edit');
  assert.equal(plain('<@U1> ok, see <https://a.b|the page> &amp; <#C1|growth>'), '@someone ok, see the page (https://a.b) & #growth');
});

test('Slack routes: bad signatures are refused; a reply reaches its jam; a bot never does; the URL check is answered', async () => {
  const calls = [];
  const connectors = { slackSlug: async (t) => (t === 'T1' ? 'cozy' : null), slackUser: async (_s, u) => (u === 'UB' ? { name: 'Bot', bot: true } : { name: 'Ana', email: 'ana@cozy.shop' }), slackGone: async (t) => calls.push(['gone', t]) };
  const feed = { slackIn: async (x) => { calls.push(['in', x]); return { w: { id: 'wk1' } }; } };
  const h = createSlackRoutes({ connectors, feed: () => feed, log: { log() {}, warn() {} }, secret: () => 'shh' });
  const go = async (path, raw, headers = sign(raw)) => { const res = resOf(); await h(reqOf(raw, headers), res, new URL(`https://x${path}`)); return res; };

  assert.equal((await go('/slack/events', '{}', sign('{}', 'nope'))).code, 401);
  const ch = await go('/slack/events', JSON.stringify({ type: 'url_verification', challenge: 'abc' })); assert.equal(JSON.parse(ch.body).challenge, 'abc');

  const ev = (id, user) => JSON.stringify({ type: 'event_callback', event_id: id, team_id: 'T1', event: { type: 'message', user, ts: '2.0', thread_ts: '1.0', text: 'Ship it <@U9>' } });
  assert.equal((await go('/slack/events', ev('E1', 'U1'))).code, 200); await tick();
  assert.equal((await go('/slack/events', ev('E1', 'U1'))).code, 200, 'a retry is answered'); await tick();
  await go('/slack/events', ev('E2', 'UB')); await tick();
  const ins = calls.filter((c) => c[0] === 'in');
  assert.equal(ins.length, 1, 'once, and never for a bot');
  assert.deepEqual({ ...ins[0][1], user: ins[0][1].user.name }, { slug: 'cozy', kind: 'reply', thread: '1.0', ts: '2.0', user: 'Ana', mention: false, text: 'Ship it @someone' });

  await go('/slack/events', JSON.stringify({ type: 'event_callback', event_id: 'E3', team_id: 'T1', event: { type: 'app_uninstalled' } })); await tick();
  assert.deepEqual(calls.find((c) => c[0] === 'gone'), ['gone', 'T1']);
  assert.equal(await h(reqOf('', {}), resOf(), new URL('https://x/slack/other')), false);
});

test('Slack routes: Approve only counts from the workspace that brand connected', async () => {
  const seen = [];
  const connectors = { slackSlug: async (t) => (t === 'T1' ? 'cozy' : null), slackUser: async () => ({ name: 'Ana' }), slackPost: async (s, o) => seen.push(['post', o]) };
  const feed = { slackIn: async (x) => { seen.push(['in', x]); return { w: { id: 'wk1', current: 3, slack: {} } }; } };
  const h = createSlackRoutes({ connectors, feed: () => feed, log: { log() {}, warn() {} }, secret: () => 'shh' });
  const f0 = globalThis.fetch; globalThis.fetch = async () => ({ ok: true });
  try {
    const press = async (team) => { const raw = new URLSearchParams({ payload: JSON.stringify({ type: 'block_actions', team: { id: team }, user: { id: 'U1' }, channel: { id: 'C1' }, message: { ts: '1.0', text: 'x', blocks: [{ type: 'section' }, { type: 'actions' }] }, actions: [{ action_id: 'approve', value: 'cozy|wk1|3' }], response_url: 'https://hooks.slack.com/x' }) }).toString();
      const res = resOf(); await h(reqOf(raw, sign(raw)), res, new URL('https://x/slack/actions')); await tick(); return res; };
    await press('T2'); assert.equal(seen.length, 0, 'another workspace changes nothing');
    assert.equal((await press('T1')).code, 200);
    assert.deepEqual(seen[0][1], { slug: 'cozy', kind: 'approve', thread: '1.0', user: { name: 'Ana' }, n: 3 });
    assert.equal(seen[1][1].update, '1.0');
    seen.length = 0; const raw = new URLSearchParams({ payload: JSON.stringify({ type: 'block_actions', team: { id: 'T1' }, user: { id: 'U1' }, channel: { id: 'C1' }, message: { ts: '2.0', thread_ts: '1.0', text: 'x', blocks: [] }, actions: [{ action_id: 'approve', value: 'cozy|wk1|3' }] }) }).toString();
    await h(reqOf(raw, sign(raw)), resOf(), new URL('https://x/slack/actions')); await tick();
    assert.equal(seen[0][1].thread, '1.0', 'Approve on an asset in the thread finds the jam by its thread'); assert.ok(!seen[1][1].blocks.some((b) => b.type === 'actions'), 'the button gives way to who approved');
  } finally { globalThis.fetch = f0; }
});

test('Slack routes: Make it / Not now reach the jam once, with the proposal id; @Brew is noticed', async () => {
  const seen = [];
  const connectors = { slackSlug: async (t) => (t === 'T1' ? 'cozy' : null), slackUser: async () => ({ name: 'Ana' }), slackOf: async () => ({ bot: 'UBREW' }) };
  const feed = { slackIn: async (x) => { seen.push(x); return { w: { id: 'wk1' }, ok: true }; } };
  const h = createSlackRoutes({ connectors, feed: () => feed, log: { log() {}, warn() {} }, secret: () => 'shh' });
  const f0 = globalThis.fetch; globalThis.fetch = async () => ({ ok: true });
  try {
    for (const id of ['apply', 'dismiss']) {
      const raw = new URLSearchParams({ payload: JSON.stringify({ type: 'block_actions', team: { id: 'T1' }, user: { id: 'U1' }, message: { ts: '3.0', thread_ts: '1.0' }, actions: [{ action_id: id, value: 'cozy|wk1|pd_1' }] }) }).toString();
      await h(reqOf(raw, sign(raw)), resOf(), new URL('https://x/slack/actions')); await tick();
    }
    assert.deepEqual(seen.map((x) => [x.kind, x.thread, x.pid]), [['apply', '1.0', 'pd_1'], ['dismiss', '1.0', 'pd_1']]);
    seen.length = 0;
    const ev = JSON.stringify({ type: 'event_callback', event_id: 'E9', team_id: 'T1', event: { type: 'message', user: 'U1', ts: '2.0', thread_ts: '1.0', text: '<@UBREW> make it a reel' } });
    await h(reqOf(ev, sign(ev)), resOf(), new URL('https://x/slack/events')); await tick();
    assert.equal(seen[0].mention, true); assert.equal(seen[0].text, '@Brew make it a reel');
  } finally { globalThis.fetch = f0; }
});

test('jam asks: a paid image or video is proposed first, chatter never spends (feed-service source)', async () => {
  const fs = await import('node:fs'); const s = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  const act = s.slice(s.indexOf('const slackAct'), s.indexOf('const toSlack'));
  assert.match(act, /kind === 'make'\) return propose\(/, 'a make ask is always a proposal');
  assert.doesNotMatch(act.slice(act.indexOf('/* chat:')), /iterate|remake|DR\.start|photoFromJam/, 'chat runs nothing');
  const ap = s.slice(s.indexOf('const applyPending'), s.indexOf('const slackAct'));
  assert.match(ap, /if \(!p \|\| p\.id !== pid\) return \{ gone: true \};\s*w\.pending = null;/, 'a proposal runs once');
});
