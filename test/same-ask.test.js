import test from 'node:test';
import assert from 'node:assert/strict';
import { askOf, sameAsk, askLeaders, oneAsk, noiseOf } from '../same-ask.js';
import { cardValue, moveNo } from '../value.js';

const card = (id, title, sub = '', cta = 'Agree with the call') => ({ id, title, sub, cta: { label: cta } });
/* Arata after its 2026-10-20 reload: one ask ("fix the pack prices") written by several moves, next to other moves' cards */
const PACK = [
  card('m07-1', 'Fix the six packs that cost more than their parts', 'Six packs cost more than a cheaper route, like the Intensive Serum Pack of 3 at ₹1,947 against three singles at ₹642.32.'),
  card('m04-2', 'Fix the pack prices before any stock-up message', 'Three bottles cost ₹649 each, ₹6.68 more than one at ₹642.32, and the Pack of 3 at ₹1,947.'),
  card('m06-1', 'Fix the pack ladder: 9 of 15 packs save nothing', 'Of 15 packs, 9 save nothing; the Intensive serum Pack of 3 at ₹1,947 costs ₹20.04 more than ₹642.32 singles.'),
  card('m13-1', 'Fix pack prices before markup tells Google', 'The Pack of 3 costs ₹649 a bottle, dearer than the ₹642.32 single.'),
  card('m62-2', 'Settle the pack ladder before showing per-bottle prices', 'The Pack of 3 at ₹1,947 costs ₹6.68 more per bottle than one bottle.'),
  card('m47-2', 'The Pack of 3 costs more than three singles', 'The Pack of 3 is ₹1,947, which is ₹20.04 above three singles at ₹642.32.', 'Fix the markup'),
];
const OTHER = [
  card('m17-1', 'Publish the Arata vs The Derma Co serum page', 'The Intensive serum is ₹642.32 for 30 ml, ₹56.68 below the rival.'),
  card('m18-2', "Publish Arata's own honest serum roundup", 'None of the 8 roundups name Arata; the serum is ₹642.32.'),
  card('m12-1', 'Seventeen serum pages hide one path to cart', 'A shopper meets 17 doors, and the Pack of 3 at ₹1,947 costs ₹20.04 more than three singles at ₹642.32.', 'Publish the hub'),
  card('m65-1', 'Reorder email leads with the Pack of 2, not the Pack of 3', 'The Pack of 3 at ₹1,947 costs ₹20.04 more than three singles.'),
  card('m05-1', 'Run two keyed ad lanes before MitoActive keeps every ad', 'All 664 ads link to MitoActive at ₹1,499.'),
];
const grades = { 7: { impact: 4, confidence: 0.9, effort: 1, urgency: 0.5, now: true }, 4: { impact: 3, confidence: 0.7, effort: 2, urgency: 0 }, 6: { impact: 3, confidence: 0.8, effort: 2, urgency: 0 },
  13: { impact: 2, confidence: 0.6, effort: 2, urgency: 0 }, 62: { impact: 2, confidence: 0.6, effort: 2, urgency: 0 }, 47: { impact: 3, confidence: 0.9, effort: 1, urgency: 0 },
  17: { impact: 3, confidence: 0.8, effort: 2, urgency: 0 }, 18: { impact: 2, confidence: 0.7, effort: 2, urgency: 0 }, 12: { impact: 3, confidence: 0.7, effort: 2, urgency: 0 },
  65: { impact: 2, confidence: 0.7, effort: 1, urgency: 0 }, 5: { impact: 4, confidence: 0.6, effort: 2, urgency: 0 } };
const opts = { moveOf: (c) => moveNo(c.id), value: (c) => cardValue(c, grades), noise: noiseOf('Arata', 'arata.in') };

test('cards that ask for the same thing in other words are one ask', () => {
  const a = askOf(PACK[1]);
  assert.equal(a.verb, 'fix');
  assert.ok(sameAsk(PACK[1], PACK[3]), '"fix pack prices" twice');
  assert.ok(sameAsk(PACK[0], PACK[2]), 'one shared word plus the same two figures');
  assert.ok(sameAsk(PACK[2], PACK[4]), '"settle" is "fix"');
  assert.ok(sameAsk(PACK[5], PACK[2]), 'a finding title takes its button\'s action');
});

test('the same facts or the brand name alone are not the same ask', () => {
  const n = opts.noise;
  assert.ok(!sameAsk(askOf(OTHER[0], n), askOf(OTHER[1], n)), 'two Publish cards about the serum: page and roundup');
  assert.ok(!sameAsk(askOf(OTHER[3], n), askOf(PACK[0], n)), 'reordering emails is not fixing prices, though the figures match');
  assert.ok(!sameAsk(askOf(OTHER[2], n), askOf(OTHER[0], n)), 'a finding with a borrowed verb needs shared figures');
  assert.ok(!sameAsk(card('m1-1', 'Publish the comparative landing page'), card('m2-1', 'Publish the safety landing page')), 'a format word is not the ask');
  assert.ok(!sameAsk(card('m1-1', 'Deploy post-purchase review email'), card('m2-1', 'Deploy the post-purchase attribution survey')), 'post-purchase is one word');
  assert.ok(!sameAsk(card('m1-1', 'Post a serum carousel that tells people to give it time'), card('m2-1', "Post 'which serum first' as a carousel")), 'a channel word is not the ask');
  assert.ok(!sameAsk(card('m1-1', 'Tell past MitoActive buyers about the 90-day pack first'), card('m2-1', 'Tell buyers when to step up to MitoActive')), 'an audience word is not the ask');
  assert.ok(!sameAsk(card('m1-1', 'Ask buyers how they heard of us'), card('m2-1', 'Ask buyers what they expect at day 30')), 'pronouns are not the ask');
  assert.ok(sameAsk(card('m1-1', 'Ask for the second serum bottle at day 21'), card('m2-1', 'Ask for the second serum bottle on WhatsApp')), 'one ask on two channels is still one ask');
});

test('a ranked feed shows one card per ask, the best-graded, where the first of them ranked; the rest wait at the end', () => {
  const ranked = [OTHER[4], PACK[1], OTHER[0], PACK[3], PACK[0], OTHER[1], PACK[2], OTHER[2], PACK[4], OTHER[3], PACK[5]];
  const { list, sunk } = oneAsk(ranked, opts);
  assert.equal(list.length, ranked.length, 'nothing is dropped');
  assert.deepEqual(new Set(list.map((c) => c.id)), new Set(ranked.map((c) => c.id)));
  const head = list.slice(0, list.length - sunk.size);
  assert.deepEqual(head.filter((c) => PACK.includes(c)).map((c) => c.id), ['m07-1'], 'one pack-price card before the tail: the best-graded');
  assert.equal(head.indexOf(PACK[0]), 1, 'it takes the place of the first pack-price card to rank');
  assert.deepEqual([...sunk], ['m04-2', 'm13-1', 'm06-1', 'm62-2', 'm47-2']);
  assert.deepEqual(head.filter((c) => OTHER.includes(c)).map((c) => c.id), ['m05-1', 'm17-1', 'm18-2', 'm12-1', 'm65-1'], 'other asks keep their order');
});

test('a card someone engaged with stays in place; one move\'s own cards are never one ask; non-move cards are left alone', () => {
  const ranked = [PACK[1], PACK[0], PACK[2]];
  const { list, sunk } = oneAsk(ranked, { ...opts, keep: (c) => c.id === 'm04-2' });
  assert.deepEqual(list.map((c) => c.id), ['m04-2', 'm07-1', 'm06-1']);
  assert.deepEqual([...sunk], ['m06-1']);
  const twin = [card('m07-1', 'Fix pack prices now', '₹1,947 ₹642.32'), card('m07-2', 'Fix pack prices on Amazon', '₹1,947 ₹642.32')];
  assert.equal(oneAsk(twin, opts).sunk.size, 0, 'a move\'s second card is the move ranker\'s business (groupOf)');
  const live = [{ id: 'lv-1', title: 'Fix pack prices', sub: '₹1,947 ₹642.32' }, { id: 'lv-2', title: 'Fix pack prices', sub: '₹1,947 ₹642.32' }];
  assert.equal(askLeaders(live, opts).size, 0);
});

test('the same ask worded another way groups: run/launch, set up/turn on, local/localized, post-purchase/post delivery (feed audit 20 Oct)', () => {
  const s = (a, b) => sameAsk(askOf({ title: a }), askOf({ title: b }));
  assert.ok(s('Launch localized trust-first Meta ads in Bulgaria', 'Launch local trust ads in Bulgaria to answer replica worries'));
  assert.ok(s('Run localized ads to end our digital silence', 'Launch localized trust ads to break our Bulgarian ad silence'));
  assert.ok(s('Set up post delivery review flows on email and WhatsApp', 'Turn on Klaviyo post-purchase flow for reviews'));
  assert.ok(s('Fix two odd pack prices before Google reads them', 'Settle three odd prices before pages print them'));
  assert.ok(!s('Fix the pack prices before ads restart', 'Launch localized trust ads in Bulgaria'));
  assert.ok(!s('Set up the post-purchase review flow', 'Turn on cart recovery emails'));
});
