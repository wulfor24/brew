// The pack's numbers come from research.json, live-watch.json and facts-daily.json (pack-numbers.js numbersFor), so a write to any
// of them rebuilds the pack: the feed never quotes an older count than the brand's own files hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (f) => fs.readFileSync(f, 'utf8');
const builtFrom = () => { const m = /const BUILT_FROM = (\/.*\/);/.exec(src('brand-pack.js')); return eval(m[1]); };

test('every file the numbers are read from rebuilds the pack', () => {
  const re = builtFrom(), reads = /g\('([a-z-]+\.json)'/g, files = [...src('pack-numbers.js').matchAll(reads)].map((m) => m[1]);
  assert.deepEqual(files.sort(), ['facts-daily.json', 'live-watch.json', 'moves.json', 'profile.json', 'research.json', 'status.json']);
  for (const f of files) assert.ok(re.test(f), f);
  for (const f of ['notes.json', 'move-value.json', 'private/connections.json', 'drafts/state.json', 'research/history/2026-10-25.json']) assert.ok(!re.test(f), `${f} never rebuilds it`);
});

test('a background refresh of the numbers never makes a page wait on the rebuild: it gets the pack in hand while the new one builds', () => {
  const s = src('brand-pack.js');
  assert.match(s, /const SOFT = \/\^\(research\|live-watch\|facts-daily\)\\\.json\$\//);
  assert.match(s, /bump = \(slug, name = null\) => \{ const v = ver\(slug\) \+ 1; vers\.set\(slug, v\); if \(!\(name && SOFT\.test\(name\)\)\) hard\.set\(slug, v\);/);
  assert.match(s, /if \(share && f0 && f0\.done && \(f0\.v === v0 \|\| \(hard\.get\(slug\) \|\| 0\) <= f0\.v\)\)/, 'soft changes since the built pack: served at once, rebuilt behind');
  assert.match(s, /bump\(m\[1\], m\[2\]\)/, 'another instance\'s notice says which file changed');
});
