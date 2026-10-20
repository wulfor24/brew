// Jam checks that blocked correct copy (QA 20 Oct): quotes, acronyms the store writes, currency codes, brand words, Title Case,
// negations of a banned claim; and the right banned list per category
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFlags } from '../claims.js';
import { bannedFor } from '../derive.js';
test('Reads wrong only flags our own bad copy', () => {
  assert.deepEqual(copyFlags('On “Has anyone used Arata hair cream?”: I work at Arata.', { names: ['Arata'] }), []);
  assert.deepEqual(copyFlags('It blocks DHT at the root.', { source: 'Blocks DHT naturally' }), []);
  assert.deepEqual(copyFlags('Only INR 999 for the pack.'), []);
  assert.deepEqual(copyFlags('Simple 2-Step Onion Hair Routine for Hair Fall & Stronger Hair'), []);
  assert.equal(copyFlags('This is NOT okay at all for you.').length, 1);
  assert.equal(copyFlags('Onion Oil Onion Hair Oil is here.').length, 1);
});
test('banned list per category', () => {
  const pet = new RegExp(bannedFor({ category: 'Pet care' }), 'i');
  assert.equal(pet.test('Grain-free dog treats'), false);
  assert.equal(pet.test('It cures allergies'), true);
  assert.equal(new RegExp(bannedFor({ category: 'Food & Beverage', subcategory: 'Healthy Snacks' }), 'i').test('A tasty treat'), false);
});
test('the fix button fixes, never answers', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.match(src, /!knob && !quiet && !fix/);
});
