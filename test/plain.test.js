// the plain-words pass keeps the ad platform's level words: a campaign never becomes an ad set (Arata's fatigue card, 23 Oct)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepLevels, prompt } from '../plain.js';

test('a level the original never says is put back to the one it does say; the original’s own word always stays', () => {
  const orig = 'TOF_Mito-Preorder_Nitin-Joshi campaign showed the same people its ads 4.1 times this week';
  assert.equal(keepLevels('One preorder ad set showed the same people ads 4.1 times', orig), 'One preorder campaign showed the same people ads 4.1 times');
  assert.equal(keepLevels('Ad sets are tired', 'Campaigns are tired'), 'Campaigns are tired');
  assert.equal(keepLevels('Two ad groups lost money', 'Two campaigns lost money'), 'Two campaigns lost money');
  assert.equal(keepLevels('This ad set is tired', 'Pause the tired ad set'), 'This ad set is tired');
  assert.equal(keepLevels('Pause the ad set', 'Pause the campaign or its ad set'), 'Pause the ad set', 'both in the original: nothing to put back');
  assert.equal(keepLevels('Show your star ratings', 'Add review markup'), 'Show your star ratings', 'no level in the original: untouched');
});

test('the rewrite prompt says the levels are different things', () => {
  assert.match(prompt('Arata', []), /campaign, an ad set .* and an ad are different things/);
});
