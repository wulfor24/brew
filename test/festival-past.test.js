// A festival plan after its festival is marked past and its cards leave the feed; a countdown counts from today (QA 20 Oct)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventOf, pastOf, liveStat } from '../festival-past.js';
import { followMoveCards } from '../feed-service.js';

test('event dates from the calendar', () => {
  const dp = { dynamic: 'season:durga-puja-2026' };
  assert.deepEqual(eventOf(dp), { id: 'durga-puja', name: 'Durga Puja', start: '2026-10-17', end: '2026-10-21' });
  assert.equal(pastOf(dp, '2026-10-21'), null, 'its last day is not past');
  assert.deepEqual(pastOf(dp, '2026-10-22'), { name: 'Durga Puja', end: '2026-10-21' });
  assert.equal(pastOf({ dynamic: 'season:dussehra-2026' }, '2026-10-21')?.name, 'Dussehra');
  assert.equal(pastOf({ n: 5 }, '2030-01-01'), null, 'not a festival move');
});

test('countdowns count from today', () => {
  const kc = { dynamic: 'season:karva-chauth-2026', stat: '12 days', statLabel: 'UNTIL KARVA CHAUTH' };
  assert.equal(liveStat(kc, '2026-10-21'), '8 days');
  assert.equal(liveStat(kc, '2026-10-28'), '1 day');
  assert.equal(liveStat({ ...kc, stat: '₹798' }, '2026-10-21'), null, 'not a countdown');
});

test('a card of a past festival move leaves the feed', () => {
  const cards = new Map([['m655-1', { state: 'ready' }], ['m05-1', { state: 'ready' }]]); const gone = [];
  followMoveCards(cards, { docs: { 655: { n: 655, past: { name: 'Durga Puja', end: '2026-10-21' } }, 5: { n: 5 } }, expire: (c) => gone.push(c) });
  assert.equal(gone.length, 1);
});
