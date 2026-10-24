// Jam close-out, 25 Oct: the last five items of the audit stay fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_GUARD } from '../studio.js';
import { readyOf } from '../publish-ready.js';
import { buildPack } from '../publish-pack.js';

test('an X thread: every post fits 280; a long single post is caught whole', () => {
  assert.match(ACTION_GUARD.x_post({ copy: 'word '.repeat(70) }), /280/);
  assert.equal(ACTION_GUARD.x_post({ copy: '1/ Short hook\n\n2/ Second post' }), null);
  assert.match(ACTION_GUARD.x_post({ copy: `1/ ok\n\n2/ ${'x'.repeat(300)}` }), /^Post 2/);
});

test('a collection ad’s cover is square everywhere: the places and the pack', async () => {
  const r = readyOf({ family: 'meta_ad', action: 'creative.collection_ad', pkg: { image: 'gen/c.jpg', headline: 'H', primaryText: 'P', cta: 'Shop now' }, brand: 'A', host: 'a.com' });
  assert.deepEqual(r.places.map((x) => x.shape), ['1:1']);
  const made = await buildPack({ ch: { action: 'creative.collection_ad' }, family: 'meta_ad', pkg: { image: 'gen/c.jpg', format: '1:1', headline: 'H' }, brand: { name: 'A' }, read: async () => null });
  assert.ok(!made.entries.some((e) => /creative-4x5|creative-9x16/.test(e.name)), 'no 4:5 or 9:16 cut of a collection cover');
});

test('search ads meet Google’s minimums before they count as complete', () => {
  assert.match(ACTION_GUARD.search_ad({ headlines: ['A', 'B'], descriptions: ['D1', 'D2'] }), /3 headlines/);
  assert.match(ACTION_GUARD.search_ad({ headlines: ['A', 'B', 'C'], descriptions: ['D1'] }), /2 descriptions/);
  assert.equal(ACTION_GUARD.search_ad({ headlines: ['A', 'B', 'C'], descriptions: ['D1', 'D2'] }), null);
});
