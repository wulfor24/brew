// The PDF cover names the move once ("Play 05", "Weekly play 4", "Timely play"), never "PLAY 05 · PLAY 05 OF 50" (QA 20 Oct)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../pdf/template.js', import.meta.url), 'utf8');
const { moveLabel } = await import('../move-label.js');
const body = src.slice(src.indexOf('const coverKicker = '), src.indexOf('function cover('));
const up = (s) => String(s ?? '').toUpperCase();
const coverKicker = new Function('moveLabel', 'up', `${body}; return coverKicker;`)(moveLabel, up);
test('cover line', () => {
  assert.equal(coverKicker({ n: 5, kicker: 'MARKETING COUNCIL · PLAY 05' }), 'MARKETING COUNCIL · PLAY 05');
  assert.equal(coverKicker({ n: 1004, kicker: 'LISTENING · WEEK OF 16 OCT · PLAY 1004' }), 'LISTENING · WEEK OF 16 OCT · WEEKLY PLAY 4');
  assert.equal(coverKicker({ n: 0, kicker: 'THE PLAYBOOK · INDEX' }, true), 'THE PLAYBOOK · INDEX');
  assert.doesNotMatch(src, / OF \$\{move\.of \|\| 50\}/);
});
