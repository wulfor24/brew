// Round 2 (23 Oct QA, 1.5): every way of writing a health claim is caught, a measured result needs the store to say where it was
// measured, the Brand Book's approved claims count, and every surface's words go through the same check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimFlags, checkCopy, checkCopyIn, approvedText, sourceText } from '../claims.js';
import { groundCheck } from '../jam-answer.js';

const site = 'Arata Hair Growth Serum. In a clinical study with 40 participants, 95% saw visible hair growth in 84 days.';
test('short forms of health claims are flagged unless the store says them', () => {
  for (const t of ['Dermat-approved and gentle.', 'Derma tested formula.', 'Doctor recommended.', 'Clinically tested.', 'This cures dandruff.', 'Lab-tested and safe.'])
    assert.ok(claimFlags(t, site).length, t);
  assert.equal(claimFlags('Our dog treats are tasty.', '').length, 0);
});
test('a measured result passes only where the store says it was measured, or the team approved it', () => {
  assert.equal(claimFlags('95% hair growth in 84 days.', site).length, 0);
  assert.ok(claimFlags('Up to 60% less hair fall.', site).length);
  assert.ok(claimFlags('Up to 60% less hair fall.', 'Up to 60% less hair fall on our page.').length, 'on the page with no study is not enough');
  assert.equal(claimFlags('Up to 60% less hair fall.', approvedText(['Up to 60% less hair fall'])).length, 0);
  assert.equal(claimFlags('Get 20% off today.', '').length, 0, 'a discount is not a result');
});
test('checkCopy drops only the sentences that carry a claim; checkCopyIn walks a whole brief', () => {
  assert.equal(checkCopy('Shop the serum. Dermat-approved for all. Free shipping.', site).text, 'Shop the serum. Free shipping.');
  const brief = { title: 'Reel', body: 'Show the bottle. It cures hair fall.', id: 'cures-1' };
  assert.equal(checkCopyIn(brief, site).length, 1); assert.equal(brief.body, 'Show the bottle.'); assert.equal(brief.id, 'cures-1');
});
test('an answer that makes a claim the evidence doesn’t carry fails the grounded check', () => {
  assert.equal(groundCheck('It is clinically proven to work.', 'The card: refresh the serum ad.').ok, false);
  assert.equal(groundCheck('Refresh the serum ad this week.', 'The card: refresh the serum ad.').ok, true);
});

test('a health endorsement needs its proof on the store, not just the words (QA audit 24 Oct)', () => {
  assert.ok(claimFlags('Dermat-approved haircare', 'Our shampoo is dermat-approved and gentle.').length, 'the words alone');
  assert.equal(claimFlags('Dermat-approved haircare', 'Dermat-approved: tested by an independent lab in a clinical study of 40 volunteers.').length, 0);
  assert.equal(claimFlags('Dermat-approved haircare', approvedText(['Dermat-approved'])).length, 0, 'the team approved it');
  assert.equal(claimFlags('100% natural', 'We are 100% natural.').length, 0, 'not a health endorsement');
});

test('a test named in another fact never proves a health endorsement (QA audit 24 Oct: Arata’s tagline)', () => {
  const src = sourceText(['Tagline', 'Explore our most trusted & dermat-approved haircare'], ['Serum', 'In a clinical study of 40 volunteers, 87% saw growth']);
  assert.ok(claimFlags('Dermat-approved haircare', src).length); assert.equal(claimFlags('87% saw growth', src).length, 0);
});

test('an approved list backs only what is on it, not the same words elsewhere in the brand’s copy (QA audit 24 Oct)', () => {
  const src = sourceText(['Tagline', 'Explore trusted & dermat-approved haircare'], approvedText(['7.4X Hair Fall Reduction']));
  assert.ok(claimFlags('Dermat-approved care', src).length);
});
