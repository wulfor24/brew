import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../research.js';

const H = 3600e3, T = Date.parse('2026-10-14T12:00:00Z');

test('a story keeps the time it was first seen across re-reads', () => {
  const a = pool(null, [{ id: '1' }, { id: '2' }], 'ads', T);
  const b = pool({ ...a, fetchedAt: T }, [{ id: '2' }, { id: '3' }], 'ads', T + 4 * H);
  const by = Object.fromEntries(b.items.map((x) => [x.id, x.firstSeen]));
  assert.equal(by['2'], T); assert.equal(by['3'], T + 4 * H);
  assert.equal(by['1'], T, 'one that dropped out stays while under 24 h');
});

test('a story falls off 24 hours after it was first seen', () => {
  const a = pool(null, [{ id: '1' }], 'ads', T);
  const b = pool({ ...a, fetchedAt: T }, [{ id: '9' }], 'ads', T + 25 * H);
  assert.deepEqual(b.items.map((x) => x.id), ['9']);
});

test('one seen again within 3 days is not new again', () => {
  const a = pool(null, [{ id: '1' }], 'ads', T);
  const b = pool({ ...a, fetchedAt: T }, [], 'ads', T + 25 * H);
  const c = pool({ ...b, fetchedAt: T + 25 * H }, [{ id: '1' }], 'ads', T + 30 * H);
  assert.equal(c.items[0].firstSeen, T);
});

test('news is keyed by its link, so a re-found article is the same story', () => {
  const a = pool(null, [{ url: 'https://x.com/a?utm=1', h: 'A' }], 'news', T);
  const b = pool({ ...a, fetchedAt: T }, [{ url: 'https://x.com/a', h: 'A again' }], 'news', T + 3 * H);
  assert.equal(b.items.length, 1); assert.equal(b.items[0].firstSeen, T);
});

test('a story past 24 hours leaves the ring but stays in the archive for the feed', () => {
  const a = pool(null, [{ id: '1' }], 'ads', T);
  const b = pool({ ...a, fetchedAt: T }, [{ id: '9' }], 'ads', T + 25 * H);
  assert.deepEqual(b.archive.map((x) => x.id), ['1']);
  const c = pool({ ...b, fetchedAt: T + 25 * H }, [{ id: '1' }], 'ads', T + 26 * H);
  assert.equal(c.archive.length, 0, 'one back in the read is not also in the archive');
});
