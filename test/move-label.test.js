// QA 19 Oct (FEED-QA-12, FEED-QA-24): weekly moves read "Weekly move 11" everywhere a person reads them, never "Move 1011";
// the numbers on file stay; counts are plural ("913 products", never "913 product").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { moveLabel, moveNum, moveSay } from '../move-label.js';
import { dejargon } from '../plain.js';

test('one label: core moves keep two digits, weekly ones count from 1', () => {
  assert.equal(moveLabel(7), 'Move 07'); assert.equal(moveLabel(1011), 'Weekly move 11'); assert.equal(moveNum(1011), '11'); assert.equal(moveNum(4), '04');
  assert.equal(moveSay('Move 1011 · Run the sweep'), 'Weekly move 11 · Run the sweep');
  assert.equal(moveSay('From Moves 1011 and 1012'), 'From weekly moves 11 and 12');
  assert.equal(moveSay('Move 05 · Price ladder, 1999 rupees'), 'Move 05 · Price ladder, 1999 rupees', 'other numbers are left alone');
  assert.equal(dejargon('Run the sweep (Move 1010)'), 'Run the sweep (Weekly move 10)');
});

test('every place a move number is shown uses the label; the card src on file keeps its number', () => {
  const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  for (const f of ['moves.js', 'jam-brief.js', 'handoff.js', 'digest.js', 'brand-learnings.js', 'build.js', 'public/jam-room.js', 'public/app.js'])
    assert.doesNotMatch(read(f).split('\n').filter((l) => !/const mvLabel = /.test(l)).join('\n'), /Move \$\{String\([\w.]+\)\.padStart\(2, '0'\)\}|`Move \$\{pad2?\([\w.]+\)\}/, `${f} says moves through the label helper`);
  assert.match(read('feed-service.js'), /rest\.src = moveSay\(rest\.src\)/);
  assert.match(read('moves-cadence.js'), /const pre = `Move \$\{pad\(move\.n\)\}`/, 'src on file is unchanged (numsOf reads it)');
});

test('counts are plural: SKUs and PDPs become products and product pages', () => {
  assert.equal(dejargon('913 SKUs are live'), '913 products are live');
  assert.equal(dejargon('1 SKU is out'), '1 product is out');
  assert.equal(dejargon('12 PDPs need photos'), '12 product pages need photos');
});
