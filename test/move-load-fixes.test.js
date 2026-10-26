// Moves audit 20 Oct: claims in table cells, captions and hero lines are marked as the team's call; a claim in the title or cover
// and a banned word go to "To confirm"; the index (Move 00) is rebuilt from the moves as they are now; counts leave weekly moves out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { markMoveClaims, bannedHits } from '../claims.js';
import { fitIndex } from '../move-index.js';

test('claims in tables, captions, gives and live are marked; a title or cover claim and banned words go to To confirm', () => {
  const m = { n: 8, title: 'Guaranteed stash offers to clear the cart', stat: '87%', gives: 'A money-back guarantee for all', live: 'Use code MIYA15 at checkout.',
    sections: [{ h: 'x', blocks: [{ t: 'table', head: ['a'], rows: [['Use code MIYA15 to save']], caption: 'Risk-free for 30 days' }, { t: 'p', text: 'We never promise hair regrowth. Our serum gives hair regrowth fast.' }] }] };
  const f = markMoveClaims(m, 'serum', { banned: /regrowth|miracle/i });
  assert.match(f.sections[0].blocks[0].rows[0][0], /^Proposed \(team decides\): Use code/);
  assert.match(f.sections[0].blocks[0].caption, /^Proposed/); assert.match(f.gives, /^Proposed/); assert.match(f.live, /^Proposed/);
  assert.equal(f.title, m.title, 'a title is never prefixed');
  assert.ok(f.toConfirm.some((l) => /title says “Guaranteed”/.test(l))); assert.ok(f.toConfirm.some((l) => /“regrowth”/.test(l)));
  assert.deepEqual(markMoveClaims(f, 'serum', { banned: /regrowth/i }).toConfirm, f.toConfirm, 'healing twice adds nothing');
});

test('a banned word never counts when quoted, denied, in an avoid list, the brand’s own word, or +100% maths', () => {
  const re = /miracle|treats?|100%/i;
  assert.deepEqual(bannedHits('It is not a miracle. Avoid words like miracle.', re), []);
  assert.deepEqual(bannedHits('A shopper asked “is it a miracle?”', re), []);
  assert.deepEqual(bannedHits('Dog treats for every walk', re, 'Chicken dog treats, 200g'), []);
  assert.deepEqual(bannedHits('Sales rose +100% in a week; a 100% more lift', re), []);
  assert.deepEqual(bannedHits('A miracle cream', re), ['miracle']);
});

test('the index lists the moves as they are now: no "Being written" rows, today’s titles, one count, whole-word box labels', () => {
  const moves = { 1: { n: 1, group: 'know', skill: 'customer-research', title: 'New title one', gives: 'g', stat: '5', statLabel: 'X' }, 2: { n: 2, group: 'found', skill: 'site-architecture', title: 'Two', gives: 'g2' },
    655: { n: 655, group: 'reach', skill: 'ads', title: 'Diwali plan', past: { event: 'Diwali' } }, 1004: { n: 1004, group: 'reach', title: 'Weekly' } };
  const idx = { n: 0, stat: '54', statLabel: 'MOVES WRITTEN BY 16 OCT', sections: [{ h: 'The end to end', blocks: [{ t: 'diagram', text: '┌─┐\n│ KNOW THE BRAN │\n└─┘' }] },
    { h: 'KNOW THE BRAND', blocks: [{ t: 'p', text: '**FOUNDATION · 9 MOVES**' }, { t: 'table', head: [], rows: [['01', 'Old title', 'g', ''], ['51', 'Customer research (in progress)', 'Being written.', '']] }] }] };
  const f = fitIndex(idx, moves);
  assert.equal(f.stat, '2'); assert.equal(f.sections[1].blocks[0].text, '**FOUNDATION · 1 PLAY**');
  assert.deepEqual(f.sections[1].blocks[1].rows, [['01', 'New title one', 'g', '5 · X']]);
  assert.match(f.sections[0].blocks[0].text, /CUSTOMER RESEARCH/); assert.match(f.sections[0].blocks[0].text, /SITE ARCHITECTURE/);
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'); assert.match(app, /const written = allW\.filter\(\(x\) => x\.n < 1000\)/);
});
