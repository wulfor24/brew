// QA 19 Oct (FEED-QA-18): a failed PageSpeed check never drops the Storefront score's speed part; the last good reading stays
// with its date, every part says when it was checked, and a score that changed says what changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keepSpeed, healthFrom } from '../health.js';

const good = { score: 42, lcp: '5.1 s', at: '2026-10-12', url: 'https://x.com' }, fail = { error: 'pagespeed 500', at: '2026-10-19', url: 'https://x.com' };
const prof = (ps) => ({ name: 'X', host: 'x.com', meta: { readAt: '2026-10-12T10:00:00Z' }, site: { pagespeed: ps }, catalog: { products: [{ images: [1, 2] }, { images: [1] }] }, reviews: { total: 120, platforms: [] } });
const sf = (h) => h.rings.find((r) => r.k === 'Storefront');

test('a failed check keeps the last good score, its date and the failure beside it', () => {
  const k = keepSpeed(good, fail);
  assert.equal(k.score, 42); assert.equal(k.at, '2026-10-12'); assert.equal(k.error, 'pagespeed 500'); assert.equal(k.triedAt, '2026-10-19');
  assert.deepEqual(keepSpeed(null, fail), fail, 'no good reading yet: the failure stands (never a score)');
  const back = keepSpeed(k, { score: 60, at: '2026-10-20' });
  assert.equal(back.score, 60); assert.equal(back.error, undefined); assert.deepEqual(back.was, { score: 42, at: '2026-10-12' });
});

test('the Storefront score holds through a failed check, and each part says when it was checked', () => {
  const a = healthFrom(prof(good)), b = healthFrom(prof(keepSpeed(good, fail)), undefined, a);
  assert.equal(sf(a).v, sf(b).v, 'no 100 ↔ 80 jump');
  const speed = sf(b).parts.find((x) => x.k === 'Mobile speed');
  assert.equal(speed.at, '2026-10-12'); assert.match(speed.note, /last good one/);
  assert.ok(sf(b).parts.every((x) => x.at), 'every row has its date');
});

test('a score that changed says what changed', () => {
  const a = healthFrom(prof(good)), b = healthFrom(prof(keepSpeed(good, { score: 90, at: '2026-10-20' })), undefined, a);
  assert.equal(sf(b).was, sf(a).v); assert.match(sf(b).changed, /mobile speed \d+ → \d+/);
  assert.match(sf(b).parts.find((x) => x.k === 'Mobile speed').note, /was 42 on 12 Oct/);
});
