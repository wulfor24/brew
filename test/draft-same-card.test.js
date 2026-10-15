import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFor, draftKey, needsDraft } from '../drafts-bg.js';

test('a rewritten move reusing a card id never shows the old card\'s draft', () => {
  const old = { id: 'm10-1', src: 'Move 10 · The plan', title: 'Ask every buyer where they first heard of Arata', make: { format: 'page section' } };
  const d = { k: 2, key: draftKey(old), cardTitle: old.title, title: 'Order page section' };
  const fresh = { ...old, title: 'Run the Google cut as a state test, not on GA4' };
  assert.equal(draftFor(old, { 'm10-1': d }), d);
  assert.equal(draftFor(fresh, { 'm10-1': d }), null);
  assert.equal(needsDraft(fresh, { 'm10-1': d }), true);
  const reworded = { ...old, title: 'Ask every buyer where they first heard about Arata' };
  assert.equal(draftFor(reworded, { 'm10-1': d }), d);
});
