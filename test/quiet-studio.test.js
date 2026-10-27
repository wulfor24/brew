// FEED-NOT-04: the v1 studio's first view is quiet: two chips, then More (the rest of the chips, once asked for), the mic that
// says "Talk instead of typing", and the box; the case's plan folds under one line. Read from app.js as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('two chips and More, the mic named, the plan folded', () => {
  assert.match(src, /const all = \[\.\.\.asks, \.\.\.rest\], first = all\.slice\(0, 3\), more = all\.slice\(3\)/);
  assert.match(src, /data-chips-more/); assert.match(src, /\[data-chips-more\]'\) && RX\.ch\) \{ RX\.moreChips = RX\.ch\.id; paintStudio\(\)/);
  assert.match(src, /\{brief \? '' : v1Chips\(ch\)\}/, 'the chips sit in Brew\'s section, under its line (26 Oct, the prototype)');
  assert.match(src, /class="jm-mic" data-cmp-talk aria-label="Talk instead of typing"\$\{tipA\('mic'\)\}/); /* its words show as a tooltip (tips.js) */
  assert.match(src, /<details class="case-s case-plan" data-keep="plan">/);
});
