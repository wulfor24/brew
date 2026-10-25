// Phase 6: a partner moved to production. On staging (MOVED_TO_PROD) its own people are sent to production, staff stay, and
// no background loop spends on it or emails its people from here; production itself ignores the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { movedList, movedAway, stayHere, prodUrl, guardMovedSends } from '../moved.js';

const withEnv = (env, fn) => { const was = {}; for (const k of Object.keys(env)) { was[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  let out; try { out = fn(); } catch (e) { restore(); throw e; } if (out?.then) return out.finally(restore); restore(); return out;
  function restore() { for (const k of Object.keys(was)) { if (was[k] == null) delete process.env[k]; else process.env[k] = was[k]; } } };
const src = (f) => fs.readFileSync(f, 'utf8');
const guardMovedSendsFresh = () => { const f = globalThis.fetch; const fake = async () => new Response(''); globalThis.fetch = fake; try { return guardMovedSends({ isStaff: () => true }); } finally { globalThis.fetch = f; } };

test('the moved list: staging reads it, production never does', () => {
  withEnv({ ENV: null, MOVED_TO_PROD: 'scrubroom-in, Nutrova-com' }, () => {
    assert.deepEqual(movedList(), ['scrubroom-in', 'nutrova-com']);
    assert.ok(movedAway('nutrova-com')); assert.ok(!movedAway('cozysnugglet-shop')); assert.ok(!movedAway(''));
    assert.deepEqual(stayHere([{ slug: 'scrubroom-in' }, { slug: 'cozysnugglet-shop' }]).map((b) => b.slug), ['cozysnugglet-shop']);
  });
  withEnv({ ENV: 'production', MOVED_TO_PROD: 'scrubroom-in', STAGING_HOME: null }, () => { assert.deepEqual(movedList(), []); assert.ok(!movedAway('scrubroom-in')); });
  /* 26 Oct: partners onboarded on staging first; production leaves them alone and sends their people to staging */
  withEnv({ ENV: 'production', MOVED_TO_PROD: 'scrubroom-in', STAGING_HOME: 'arata-in,nutrova-com', STAGING_URL: null }, () => {
    assert.deepEqual(movedList(), ['arata-in', 'nutrova-com']); assert.ok(movedAway('arata-in')); assert.ok(!movedAway('scrubroom-in'));
    assert.deepEqual(stayHere([{ slug: 'arata-in' }, { slug: 'scrubroom-in' }]).map((b) => b.slug), ['scrubroom-in']);
    assert.equal(prodUrl(), 'https://brew.joinsquareup.com');
  });
  withEnv({ ENV: null, MOVED_TO_PROD: 'scrubroom-in', STAGING_HOME: 'arata-in' }, () => { assert.ok(!movedAway('arata-in')); assert.ok(movedAway('scrubroom-in')); });
  withEnv({ MOVED_TO_PROD: null }, () => { const xs = [{ slug: 'a' }]; assert.equal(stayHere(xs), xs); });
  withEnv({ PROD_URL: 'https://feed.joinsquareup.com/' }, () => assert.equal(prodUrl(), 'https://feed.joinsquareup.com'));
});

test('staging sends a moved brand\'s own people to production (page, files, Brand Book, API) before anything answers; staff stay', () => {
  const s = src('server.js'), i = s.indexOf('if (movedList().length) { const ms = slugIn(req, u)'), j = s.indexOf('if (await closedGate.gate(req, res, u)) return;'), k = s.indexOf('if (await auth.handle(req, res, u)) return;'), l = s.indexOf('if (await slooshHandle(req, res, u)) return;');
  assert.ok(k > 0 && k < j && j < i && i < l, 'after sign-in (so /auth works) and the closed-store gate, before every brand route');
  const g = s.slice(i, i + 900);
  assert.match(g, /movedAway\(ms\) && !isFullAccess\(auth\.user\(req\)\?\.email\)/);
  assert.match(g, /writeHead\(409[\s\S]*moved: `\$\{prodUrl\(\)\}\/\$\{ms\}`/);
  assert.match(g, /writeHead\(302, \{ location: `\$\{prodUrl\(\)\}\$\{u\.pathname\}\$\{u\.search\}`/);
  assert.match(g, /\\\/brand\(\?:\[\.\/\]\|\$\)/, 'the Brand Book paths too');
});

test('staging send guard: email about a moved brand reaches staff only, its Slack hears nothing, everything else passes', async () => {
  const sent = [], real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { sent.push({ url: String(url), body: opts.body }); return new Response('{"ok":true}', { status: 200 }); };
  try {
    await withEnv({ ENV: null, MOVED_TO_PROD: 'arata-in' }, async () => {
      const { guardMovedSends: guard } = await import('../moved.js?guard'); let cur = null;
      assert.ok(guard({ isStaff: (e) => /@(shopos\.ai|joinsquareup\.com)$/.test(e), current: () => cur, log: { warn() {} } }));
      const mail = (to, html) => fetch('https://api.resend.com/emails', { method: 'POST', body: JSON.stringify({ to, subject: 'Your plays', html }) });
      await mail(['founder@arata.in', 'Param <param@joinsquareup.com>'], '<a href="https://brew.joinsquareup.com/arata-in#moves">Open</a>');
      assert.deepEqual(JSON.parse(sent.at(-1).body).to, ['Param <param@joinsquareup.com>']);
      const n = sent.length; const r = await mail('founder@arata.in', 'see /arata-in/brand'); assert.equal(sent.length, n, 'nobody left: not sent'); assert.equal((await r.json()).id, 'muted-moved');
      await mail('ops@cozysnugglet.shop', '<a href="https://brew.joinsquareup.com/cozysnugglet-shop">Open</a>'); assert.equal(JSON.parse(sent.at(-1).body).to, 'ops@cozysnugglet.shop', 'another brand is untouched');
      await mail('a@x.com', '<a href="/arata-inx">Open</a>'); assert.equal(JSON.parse(sent.at(-1).body).to, 'a@x.com', 'a longer slug is not the moved one');
      cur = 'arata-in'; const m = sent.length; const s1 = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', body: JSON.stringify({ channel: 'C1', text: 'hi' }) });
      assert.equal(sent.length, m); assert.equal((await s1.json()).muted, 'moved');
      cur = 'cozysnugglet-shop'; await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', body: '{"text":"hi"}' }); assert.equal(sent.length, m + 1);
      await fetch('https://slack.com/api/conversations.list', { method: 'POST', body: '' }); assert.equal(sent.length, m + 2, 'reads pass');
    });
  } finally { globalThis.fetch = real; }
  withEnv({ ENV: 'production', MOVED_TO_PROD: 'arata-in' }, () => assert.equal(guardMovedSendsFresh(), false, 'production never guards'));
});

test('every background loop that spends or writes to people skips moved brands', () => {
  for (const [f, re] of [['build.js', /for \(const b of stayHere\(await packs\.list\(\)/], ['build.js', /for \(const x of stayHere\(await packs\.list\(\)\)\)/], ['confirm-remind.js', /stayHere\(await packs\.list/],
    ['digest.js', /stayHere\(await packs\.list/], ['facts-desk.js', /stayHere\(await packs\.list/], ['drafts-bg.js', /stayHere\(list \|\| await packs\.list/], ['moves-cadence.js', /stayHere\(await packs\.list/],
    ['social-feed.js', /stayHere\(await packs\.list/], ['server.js', /stayHere\(await builder\.list\(\)\)\.filter/], ['server.js', /stayHere\(await builder\.list\(\)\.catch/],
    ['research.js', /if \(!isLeader\(\) \|\| movedAway\(brand\.slug\)\) return/], ['live-watch.js', /if \(!isLeader\(\) \|\| movedAway\(brand\?\.slug\)\) return/]]) assert.match(src(f), re, f);
  assert.match(src('research.js'), /const need = \(k\) => \{ if \(!isLeader\(\) \|\| movedAway\(brand\.slug\)/, 'no on-demand paid re-read either');
  assert.match(src('feed-service.js'), /if \(isLeader\(\) && !movedAway\(b\.slug\)\) runIn\?\.\(b, \(\) => prereadRivals\(b\)\)/);
  assert.match(src('feed-service.js'), /if \(done\.includes\('ads'\) && !movedAway\(b\.slug\)\)/);
  /* the connector reads keep going on both sites (Arata stays connected on staging too); only a rotating sign-in's renewal and the
     expiry emails are production's */
  const c = src('connectors/index.js');
  assert.match(c, /async function tick\(\) \{\n    if \(DEMO\) return;\n    for \(const \{ slug \} of await packs\.list\(\)/);
  assert.match(c, /if \(C\.fresh && !\(movedAway\(slug\) && creds\?\.refresh\)\)/);
  assert.match(c, /async function expiryCheck\(slug, id, now = Date\.now\(\)\) \{\n    if \(movedAway\(slug\)\) return null;/);
});

test('production relays the Slack of a brand whose home is staging, and its sign-ins are renewed by staging only', () => {
  assert.match(src('slack-routes.js'), /const mine = async \(team\) => \{[^\n]*!movedAway\(slug\)/);
  assert.match(src('connectors/index.js'), /C\.fresh && !\(movedAway\(slug\) && creds\?\.refresh\)/);
  assert.match(src('tools/prod-env.sh'), /ENV=production\|[^"]*STAGING_HOME=\$\{STAGING_HOME-\}/, 'every partner lives on production (Param, 25 Oct); the list is there for a partner tried on staging first');
  assert.match(src('deploy.sh'), /MOVED_TO_PROD=\$\{MOVED_TO_PROD-[^}]*arata-in/, 'staging sends Arata to production');
});
