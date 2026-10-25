// Phase 6: a partner moved to production. On staging (MOVED_TO_PROD) its own people are sent to production, staff stay, and
// no background loop spends on it or emails its people from here; production itself ignores the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { movedList, movedAway, stayHere, prodUrl } from '../moved.js';

const withEnv = (env, fn) => { const was = {}; for (const k of Object.keys(env)) { was[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  try { return fn(); } finally { for (const k of Object.keys(was)) { if (was[k] == null) delete process.env[k]; else process.env[k] = was[k]; } } };
const src = (f) => fs.readFileSync(f, 'utf8');

test('the moved list: staging reads it, production never does', () => {
  withEnv({ ENV: null, MOVED_TO_PROD: 'scrubroom-in, Nutrova-com' }, () => {
    assert.deepEqual(movedList(), ['scrubroom-in', 'nutrova-com']);
    assert.ok(movedAway('nutrova-com')); assert.ok(!movedAway('cozysnugglet-shop')); assert.ok(!movedAway(''));
    assert.deepEqual(stayHere([{ slug: 'scrubroom-in' }, { slug: 'cozysnugglet-shop' }]).map((b) => b.slug), ['cozysnugglet-shop']);
  });
  withEnv({ ENV: 'production', MOVED_TO_PROD: 'scrubroom-in' }, () => { assert.deepEqual(movedList(), []); assert.ok(!movedAway('scrubroom-in')); });
  withEnv({ MOVED_TO_PROD: null }, () => { const xs = [{ slug: 'a' }]; assert.equal(stayHere(xs), xs); });
  withEnv({ PROD_URL: 'https://feed.joinsquareup.com/' }, () => assert.equal(prodUrl(), 'https://feed.joinsquareup.com'));
});

test('staging sends a moved brand\'s own people to production before the page is built; staff stay', () => {
  const s = src('server.js'), i = s.indexOf("movedAway(pg.slug) && !isFullAccess(auth.user(req)?.email)"), j = s.indexOf("const html = pg.kind === 'landing' ? await pageFor('')");
  assert.ok(i > 0 && i < j, 'the redirect comes before the page');
  assert.match(s.slice(i, i + 300), /302, \{ location: `\$\{prodUrl\(\)\}\/\$\{pg\.slug\}\$\{u\.search\}`/);
});

test('every background loop that spends or writes to people skips moved brands', () => {
  for (const [f, re] of [['build.js', /for \(const b of stayHere\(await packs\.list\(\)/], ['build.js', /for \(const x of stayHere\(await packs\.list\(\)\)\)/], ['confirm-remind.js', /stayHere\(await packs\.list/],
    ['digest.js', /stayHere\(await packs\.list/], ['facts-desk.js', /stayHere\(await packs\.list/], ['drafts-bg.js', /stayHere\(list \|\| await packs\.list/], ['moves-cadence.js', /stayHere\(await packs\.list/],
    ['social-feed.js', /stayHere\(await packs\.list/], ['server.js', /stayHere\(await builder\.list\(\)\)\.filter/], ['server.js', /stayHere\(await builder\.list\(\)\.catch/],
    ['research.js', /if \(!isLeader\(\) \|\| movedAway\(brand\.slug\)\) return/], ['live-watch.js', /if \(!isLeader\(\) \|\| movedAway\(brand\?\.slug\)\) return/]]) assert.match(src(f), re, f);
  /* the connector reads keep going on both sites (Arata stays connected on staging too) */
  assert.doesNotMatch(src('connectors/index.js'), /stayHere|movedAway/);
});
