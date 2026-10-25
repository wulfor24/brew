// Production takes Slack's events (one address per Slack app): a workspace connected to a brand there is handled there; any
// other is passed to staging exactly as Slack sent it, so staging's own signature check passes. Staging never relays.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { createSlackRoutes } from '../slack-routes.js';

const SECRET = 'shh';
const signed = (body) => { const ts = String(Math.floor(Date.now() / 1000)); return { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=' + crypto.createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex') }; };
const req = (body, headers) => Object.assign(Readable.from([body]), { method: 'POST', headers });
const res = () => ({ code: 0, writeHead(c) { this.code = c; return this; }, end() {} });

test('an event for a workspace no brand here uses is relayed to staging byte for byte; one for a brand here is not', async () => {
  const sent = []; const fetchImpl = async (url, o) => { sent.push({ url, body: o.body, headers: o.headers }); return new Response('{}'); };
  const routes = createSlackRoutes({ connectors: { slackSlug: async (t) => (t === 'T_PROD' ? 'arata-in' : null), slackGone: async () => null }, feed: {}, log: { log() {}, warn() {} }, secret: () => SECRET, relayUrl: () => 'https://staging.example', fetchImpl });
  const other = JSON.stringify({ type: 'event_callback', event_id: 'E1', team_id: 'T_STAGE', event: { type: 'message', bot_id: 'B1' } });
  const h = signed(other); await routes(req(other, h), res(), new URL('https://x/slack/events'));
  assert.equal(sent.length, 1); assert.equal(sent[0].url, 'https://staging.example/slack/events'); assert.equal(sent[0].body, other); assert.equal(sent[0].headers['x-slack-signature'], h['x-slack-signature']);
  const here = JSON.stringify({ type: 'event_callback', event_id: 'E2', team_id: 'T_PROD', event: { type: 'message', bot_id: 'B1' } });
  await routes(req(here, signed(here)), res(), new URL('https://x/slack/events'));
  assert.equal(sent.length, 1, 'handled here, not relayed');
  const bad = JSON.stringify({ type: 'event_callback', event_id: 'E3', team_id: 'T_STAGE' }); const r = res();
  await routes(req(bad, { ...signed(bad), 'x-slack-signature': 'v0=forged' }), r, new URL('https://x/slack/events'));
  assert.equal(r.code, 401); assert.equal(sent.length, 1, 'a forged request is never relayed');
});

test('without SLACK_RELAY_URL (staging) nothing is ever relayed', async () => {
  let n = 0; const routes = createSlackRoutes({ connectors: { slackSlug: async () => null }, feed: {}, log: { log() {}, warn() {} }, secret: () => SECRET, relayUrl: () => '', fetchImpl: async () => { n++; return new Response('{}'); } });
  const b = JSON.stringify({ type: 'event_callback', event_id: 'E9', team_id: 'T_X', event: { type: 'message', bot_id: 'B' } });
  await routes(req(b, signed(b)), res(), new URL('https://x/slack/events')); assert.equal(n, 0);
});
