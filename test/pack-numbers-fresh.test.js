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
