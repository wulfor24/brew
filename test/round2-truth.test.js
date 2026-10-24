// Round 2 (23 Oct QA): the fact sheet is the one truth for a metric on every card, and the Brand Book shows the same numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countsOf, freshCounts } from '../card-nums.js';
import { bookNumbers } from '../facts-desk.js';

const truth = { f: { connected: 'meta', kind: 'connected', key: 'meta.frequency.max', label: 'Highest campaign frequency, 7 days', v: '2.4', names: ['frequency', 'ad frequency'] },
  r: { connected: 'shopify', kind: 'connected', key: 'shopify.repeat.90d', label: 'Customers in the last 90 days with 2+ orders', v: '18%', names: ['repeat rate'] } };

test('a card that names a connected measure with another number takes the account’s number (same metric, one value)', () => {
  const c = freshCounts({ id: 'm12-a', title: 'Ad frequency is 3.1, refresh now', sub: 'Your ad frequency is 3.1. Repeat rate is 31% today.', rows: [['Ad frequency', '3.1']] }, countsOf(truth, [], 'Arata'), { live: true });
  assert.match(c.title, /2\.4/); assert.match(c.sub, /frequency is 2\.4/); assert.match(c.sub, /Repeat rate is 18%/); assert.equal(c.rows[0][1], '2.4');
});
test('a plan with two numbers ("from 12% to 20%") is never touched, nor a visitor’s card, nor a connector’s own card', () => {
  const counts = countsOf(truth, [], 'Arata');
  const plan = freshCounts({ id: 'm1', title: 'Lift repeat rate', sub: 'Lift repeat rate from 12% to 20%.', rows: [] }, counts, { live: true });
  assert.match(plan.sub, /from 12% to 20%/);
  assert.match(freshCounts({ id: 'm2', title: 'x', sub: 'Repeat rate is 31%.', rows: [] }, counts, { live: false }).sub, /31%/);
  assert.match(freshCounts({ id: 'live-meta-freq', title: 'x', sub: 'One ad frequency 4.2 this week.', rows: [] }, counts, { live: true }).sub, /4\.2/);
});
test('the Brand Book numbers chapter is the fact sheet: connected first, no prices, source and day kept', () => {
  const rows = bookNumbers({ ...truth, p: { key: 'price.oil', label: 'Oil price', v: '₹499', src: 'site' }, n: { key: 'catalog.count', label: 'Products', v: '42', src: 'site', at: '2026-10-23' } });
  assert.equal(rows[0].connected, 'meta'); assert.ok(!rows.some((x) => /^price\./.test(x.key))); assert.ok(rows.some((x) => x.key === 'catalog.count' && x.at === '2026-10-23'));
});
