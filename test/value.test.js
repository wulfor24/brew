import test from 'node:test';
import assert from 'node:assert/strict';
import { valueOf, cardValue, moveNo } from '../value.js';

const T = Date.parse('2026-10-14T12:00:00Z');

test('a big, well-evidenced, urgent move outranks a hygiene move', () => {
  const big = valueOf({ impact: 5, confidence: 0.9, effort: 2, urgency: 0.8, by: '2026-10-20', now: true }, T);
  const hyg = valueOf({ impact: 1, confidence: 0.9, effort: 1, urgency: 0, by: '', now: true }, T);
  assert.ok(big > 7 && hyg < 2.5, `${big} vs ${hyg}`);
});

test('urgency ends once the date has passed', () => {
  const g = { impact: 3, confidence: 0.7, effort: 2, urgency: 1, by: '2026-10-01', now: false };
  assert.ok(valueOf(g, T) < valueOf({ ...g, by: '2026-10-16' }, T));
});

test('effort lowers value', () => {
  const g = { impact: 4, confidence: 0.8, effort: 1, urgency: 0, by: '', now: false };
  assert.ok(valueOf(g, T) > valueOf({ ...g, effort: 4 }, T));
});

test('card values: move grade, second card a bit lower, exceptions high, unknown 3', () => {
  const grades = { 7: { impact: 4, confidence: 0.8, effort: 2, urgency: 0, by: '', now: true } };
  assert.equal(moveNo('m07-1'), 7);
  assert.ok(cardValue({ id: 'm07-1' }, grades, T) > cardValue({ id: 'm07-2' }, grades, T));
  assert.equal(cardValue({ id: 'lv-1', family: 'exception' }, grades, T), 7.5);
  assert.equal(cardValue({ id: 'x' }, grades, T), 3);
  assert.equal(cardValue({ id: 'm09-1' }, grades, T), 3, 'an ungraded move falls back');
});
