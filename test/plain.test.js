// the plain-words pass keeps the ad platform's level words: a campaign never becomes an ad set (Arata's fatigue card, 23 Oct)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepLevels, prompt, createPlain, plainKey } from '../plain.js';

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

test('a saved rewrite that says "ad set" is served as "campaign" when the card names its level only in a row', async () => {
  const card = { id: 'live-meta-freq', liveOnly: true, title: 'TOF_Mito-Preorder_Nitin-Joshi showed the same people its ads 4.1 times this week', sub: 'Above 3.5 a week, clicks fall.',
    rows: [['Campaign', 'TOF_Mito-Preorder_Nitin-Joshi'], ['Frequency, 7 days', '4.1']], detail: { why: ['Above 3.5 a week, clicks fall.'], how: ['Make new versions'] } };
  const saved = { [plainKey(card)]: { title: 'One preorder ad set showed the same people ads 4.1 times', sub: 'This ad set shows ads too often.', why: [], how: [] } };
  const P = createPlain({ ai: null, store: { getJSON: async () => saved, put: async () => {} } });
  await P.load('acme', true);
  const out = P.apply('acme', card);
  assert.equal(out.title, 'One preorder campaign showed the same people ads 4.1 times'); assert.equal(out.sub, 'This campaign shows ads too often.');
});
