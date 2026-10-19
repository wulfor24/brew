// FEED-NOT-04: the v1 studio's first view is quiet: two chips, then More (the rest of the chips, once asked for), the mic that
// says "Talk instead of typing", and the box; the case's plan folds under one line. Read from app.js as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('two chips and More, the mic named, the plan folded', () => {
  assert.match(src, /const all = \[\.\.\.asks, \.\.\.rest\], first = all\.slice\(0, 2\), more = all\.slice\(2\)/);
  assert.match(src, /data-chips-more/); assert.match(src, /\[data-chips-more\]'\) && RX\.ch\) \{ RX\.moreChips = RX\.ch\.id; paintStudio\(\)/);
  assert.match(src, /UI2 \? chips2\(ch\) : v1Chips\(ch\)\}/, 'the v1 studio uses the quiet row (UI2 keeps its own)');
  assert.match(src, /class="jm-mic" data-cmp-talk aria-label="Talk instead of typing" title="Talk instead of typing"/);
  assert.match(src, /<details class="case-s case-plan" data-keep="plan">/);
});
