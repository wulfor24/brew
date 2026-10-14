// retire.js: the live revision claims control/live.json; older or pre-stop instances retire; wipe hides brands
import { test } from 'node:test';
import assert from 'node:assert/strict';

let stored = null; const exits = [];
globalThis.fetch = async (url, o = {}) => {
  if (String(url).includes('uploadType=media')) { stored = JSON.parse(o.body); return new Response('{}'); }
  return stored ? new Response(JSON.stringify(stored)) : new Response('', { status: 404 });
};
process.env.K_SERVICE = 'shopos-feed'; process.env.K_REVISION = 'shopos-feed-00120-abc';
const realExit = process.exit; process.exit = (c) => exits.push(c);
const { createRetire, wiping } = await import('../retire.js');
const quiet = { warn() {} };
const mk = (rev) => { process.env.K_REVISION = rev; return createRetire({ bucket: 'b', gToken: async () => 't', log: quiet, everyMs: 1e9, graceMs: 1 }); };

test('the first live request claims the revision', async () => {
  const r = mk('shopos-feed-00120-abc'); await r.init(); await r.claim();
  assert.deepEqual([stored.rev, stored.n], ['shopos-feed-00120-abc', 120]); assert.equal(r.retired(), false);
});

test('an older revision retires on its next check and never claims', async () => {
  const old = mk('shopos-feed-00119-xyz'); await old.init(); await old.claim();
  assert.equal(old.retired(), true); assert.equal(stored.n, 120);
});

test('a stop retires instances that booted before it and hides the wiped brands', async () => {
  const live = mk('shopos-feed-00120-abc');
  await new Promise((r) => setTimeout(r, 5));
  stored = { rev: 'stop', n: 120, at: Date.now(), wipe: ['everaw-in'] };
  await live.init();
  assert.equal(live.retired(), true); assert.equal(wiping('everaw-in'), true); assert.equal(wiping('allbirds-com'), false);
  // the fresh instance after the stop stays, claims, and keeps the wipe list
  await new Promise((r) => setTimeout(r, 5));
  const fresh = mk('shopos-feed-00120-abc'); await fresh.init(); await fresh.claim();
  assert.equal(fresh.retired(), false); assert.equal(stored.rev, 'shopos-feed-00120-abc'); assert.deepEqual(stored.wipe, ['everaw-in']);
  // the reset lifts the wipe; the next check shows the brand again
  stored = { ...stored, wipe: [] }; await fresh.init(); assert.equal(wiping('everaw-in'), false);
  await new Promise((r) => setTimeout(r, 10)); assert.ok(exits.length >= 2); process.exit = realExit;
});
