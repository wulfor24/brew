// Rules cards carry the rules button and no asset; a making button never stays on a card with nothing to make; counts follow today's facts
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCta, fillMake, inferMake } from '../cards-gen.js';
import { countsOf, freshCounts } from '../card-nums.js';

const alerts = { id: 'm64-1', type: 'decision', title: 'Avoid ad fatigue and stock outs with automated alerts', sub: 'Scaling budgets 3.6x dropped returns. These standing rules alert the team when fatigue or out of stock thresholds are crossed.', detail: { why: [], how: ['Stage copy variants when the fatigue trigger fires'] }, cta: { label: 'Make the ad' } };

test('a rules card gets the rules button and no asset, written new or saved', () => {
  const fresh = fitCta(fillMake({ ...alerts }));
  assert.equal(fresh.make, undefined); assert.equal(fresh.cta.label, 'Set up the rules');
  const dropped = fitCta(fillMake({ ...alerts, makeDropped: 'single image ad' }));
  assert.equal(dropped.make, undefined, 'a dropped asset never comes back from the button'); assert.equal(dropped.cta.label, 'Set up the rules');
  const savedCopy = fitCta({ ...alerts, make: { format: 'single image ad', pieces: '', inferred: true } });
  assert.equal(savedCopy.make, undefined, 'an asset inferred before the fix goes'); assert.equal(savedCopy.cta.label, 'Set up the rules');
  assert.equal(fitCta({ ...alerts, cta: { label: 'Agree with the call' } }).cta.label, 'Agree with the call', 'a call to agree with stays one');
});
test('a rules card keeps what its title names (a reminder flow)', () => {
  assert.equal(inferMake({ id: 'm64-2', type: 'idea', title: 'Automated WhatsApp reminder at day 28', cta: { label: 'Approve the flows' } })?.format, 'whatsapp message');
  const flow = fitCta({ id: 'm64-2', type: 'idea', title: 'Nudge serum buyers to restock at day 28', sub: 'Sending an automated refill nudge keeps buyers on routine.', cta: { label: 'Approve the flows' }, make: { format: 'whatsapp message', pieces: '1 message to serum buyers on day 28' } });
  assert.equal(flow.make.format, 'whatsapp message'); assert.equal(flow.cta.label, 'Approve the flows');
});
test('an ad button alone never invents an ad', () => {
  const ai = { id: 'm07-1', type: 'idea', sector: 'visibility', title: 'ChatGPT names two rivals but not you', sub: 'Asked for the best hair serum in India, it named Minimalist and Pilgrim.', cta: { label: 'Make the ad' } };
  assert.equal(inferMake(ai), null); assert.equal(fitCta(fillMake(ai)).cta.label, 'Agree with the call');
  assert.equal(inferMake({ id: 'm21-1', type: 'idea', title: 'Lead with the comfort hook', sub: 'One new creative for the winner.', cta: { label: 'Make the ad' } })?.format, 'single image ad', 'words that ask for creative keep the ad');
});
test('rows and words follow today\'s counts, only where the label names one count', () => {
  assert.equal(freshCounts({ title: 'x', sub: 'We have 1 live ad.', rows: [['Live Meta ads', '1']] }, countsOf({ b: { label: 'Acme: live Meta ads', v: '0', n: 0 } }, [], 'Acme')).rows[0][1], '1', 'never to or from none');
  const facts = { a: { label: 'Products out of stock', v: '12', n: 12, at: '2026-10-22' }, b: { label: 'Acme: live Meta ads in IN', v: '1,337', n: 1337, at: '2026-10-22' }, c: { label: 'Rival: live Meta ads in IN', v: '50', n: 50, at: '2026-10-22' }, p: { label: 'Serum price', v: '₹1,499', kind: 'price' } };
  const counts = countsOf(facts, [], 'Acme');
  const c = { id: 'm1-1', title: 'Pause ads on sold-out items', sub: 'Acme runs 1,577 live Meta ads and 10 products are out of stock. Keep a 10% holdout.', detail: { why: ['10 days of stock left on the serum'], how: [] }, rows: [['Out of stock products', '10'], ['Live Meta ads', '1,577'], ['Click rate', '0.68%'], ['Serum price', '₹1,499']] };
  const o = freshCounts(c, counts);
  assert.deepEqual(o.rows, [['Out of stock products', '12'], ['Live Meta ads', '1,337'], ['Click rate', '0.68%'], ['Serum price', '₹1,499']]);
  assert.equal(o.sub, 'Acme runs 1,337 live Meta ads and 12 products are out of stock. Keep a 10% holdout.');
  assert.equal(o.detail.why[0], '10 days of stock left on the serum', 'one passing word is not the count');
  assert.equal(c.rows[0][1], '10', 'the saved card is never changed');
  assert.equal(freshCounts({ rows: [['Live Meta ads', '1,337']] }, counts).rows[0][1], '1,337');
});
test('words that look like a format or a rule but are not', () => {
  const clip = { id: 'w-c_1', type: 'idea', origin: 'watcher', title: 'Get the Emma Ponytail Extension for $1,600', sub: 'This claw clip design gives volume in seconds.', cta: { label: 'Make the ad' } };
  assert.notEqual(fillMake(clip).make?.format, 'reel', 'a claw clip is not a video');
  assert.equal(inferMake({ id: 'm1-1', type: 'idea', title: 'Show the 30-day return rule on the product page', cta: { label: 'Update landing page' } })?.format, 'page section', 'a return rule is a policy, not an alert');
  assert.equal(fitCta(fillMake({ id: 'w-c_2', agent: 'creative', sector: 'creatives', type: 'idea', kind: 'media', title: 'Why we only show 1 popup on our site', sub: 'One calm page wins trust.', cta: { label: 'Make the ad' } })).cta.label, 'Make the ad', 'a creative idea keeps its ad');
});
