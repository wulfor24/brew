import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/* 19 Oct: tools/reset-jams.sh wrote acted as {} and every Arata feed threw "t.acted is not iterable". A workspace loads with
   its Sets and Maps whatever shape the file holds, and the reset tool writes the tagged empty Set */
test('getTenant heals Set and Map fields that a script left in the wrong shape', () => {
  const src = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  const m = src.match(/for \(const k of \['acted', 'days', 'used'\]\)[^\n]+\n[^\n]+t\.cards[^\n]+/); assert.ok(m, 'the heal sits in getTenant');
  const heal = new Function('t', `${m[0]}; return t;`);
  const t = heal({ acted: {}, days: ['2026-10-18'], used: { __s: ['a'] }, cards: { __m: [['c1', { id: 'c1' }]] } });
  assert.ok(t.acted instanceof Set && t.acted.size === 0); assert.deepEqual([...t.days], ['2026-10-18']); assert.deepEqual([...t.used], ['a']);
  assert.ok(t.cards instanceof Map && t.cards.get('c1').id === 'c1');
  assert.ok(/t\['acted'\] = \{'__s': \[\]\}/.test(fs.readFileSync(new URL('../tools/reset-jams.sh', import.meta.url), 'utf8')), 'the reset tool writes a tagged empty Set');
});
