// Moves audit 20 Oct (P2): what a saved move shows is tidied at load, for every brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyMove, tidyStats, onceDated } from '../move-tidy.js';
import { pdfName } from '../pdf/render.js';

test('one date stamp, no machine to-confirm lines, no empty blocks, rows as wide as the header, a mostly unpulled table in one line', () => {
  assert.equal(onceDated('1,577 live ads on 19 Oct in India on 19 Oct.'), '1,577 live ads on 19 Oct in India.');
  const m = tidyMove({ n: 3, stat: '27 days', statLabel: 'DAYS UNTIL LAUNCH', toConfirm: ['48%: 48%', 'Real line', 'real line', '1.13x: ┌──┐'], sections: [{ h: 'x', blocks: [
    { t: 'diagram', text: '' }, { t: 'diagram', text: 'a\\nb' }, { t: 'example', title: 'Guide', body: '' }, { t: 'table', head: ['a', 'b'], rows: [['1', '2', '3'], ['4']] },
    { t: 'table', head: ['Outlet', 'Coverage', 'Angle'], rows: [['A', 'To be pulled', 'To be pulled'], ['B', 'To be pulled', 'To be pulled'], ['C', 'To be pulled', 'x']] }] }] });
  assert.deepEqual(m.toConfirm, ['Real line']); assert.equal(m.statLabel, 'UNTIL LAUNCH');
  const b = m.sections[0].blocks; assert.equal(b.length, 3); assert.equal(b[0].text, 'a\nb'); assert.deepEqual(b[1].rows, [['1', '2'], ['4', '']]); assert.match(b[2].text, /^Still to pull before this table is filled in: A, B, C\.$/);
});
test('a zero cover number, or one an earlier move leads with, gives way to the summary', () => {
  const d = tidyStats({ 1: { n: 1, stat: '0 vs 177' }, 2: { n: 2, stat: '£23.95 vs £10.95' }, 3: { n: 3, stat: '£23.95 vs £10.95' }, 4: { n: 4, stat: '0' }, 5: { n: 5, stat: '12%' } });
  assert.equal(d[1].stat, '0 vs 177'); assert.equal(d[2].stat, '£23.95 vs £10.95'); assert.equal(d[3].stat, ''); assert.equal(d[4].stat, ''); assert.equal(d[5].stat, '12%');
});
test('PDF names say the move as a person reads it', () => {
  assert.equal(pdfName({ n: 5, title: 'Five dossiers' }), '05 Five dossiers.pdf'); assert.equal(pdfName({ n: 1004, title: 'Position it' }), 'Weekly move 4 Position it.pdf'); assert.equal(pdfName({ n: 655, title: 'A sprint' }), 'A sprint.pdf');
});
