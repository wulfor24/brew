// Round 3 UI audit: every version gets a short name (2-4 words), never the raw chat message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { versionLabel } from '../text-fit.js';

test('version labels: a chat ask becomes a short name, not the message', () => {
  assert.equal(versionLabel('can we post 2, 3, 4,5, and 6 as replies'), 'As a thread');
  assert.equal(versionLabel('make it shorter please'), 'Shorter');
  assert.equal(versionLabel('lead with the price'), 'Price up front');
  assert.equal(versionLabel('add an honest downside'), 'Honest downside');
  const free = versionLabel('Swap the second product for Aeres NOIR right away please');
  assert.ok(free.split(/\s+/).length <= 4, free);
});

test('version labels: system reasons map to plain names', () => {
  assert.equal(versionLabel('Remix: three options'), 'First draft');
  assert.equal(versionLabel('anything', { first: true }), 'First draft');
  assert.equal(versionLabel('Hook: Question'), 'Hook: Question');
  assert.equal(versionLabel('Variation B: price-led angle'), 'Price-led angle');
  assert.equal(versionLabel('Variation A: a different cut'), 'Variation A');
  assert.equal(versionLabel('Undo: pause the ad set'), 'Undone');
  assert.equal(versionLabel('New creative: brighter'), 'New photo');
});

test('version labels: an offline save is never named after the ask', () => {
  assert.equal(versionLabel('can we post 2 as replies (AI offline)'), 'Not rewritten');
  assert.equal(versionLabel('Language: Hindi (AI offline)'), 'Language: Hindi');
});

test('list items keep the number they start with; only the list marker goes', async () => {
  const { LIST_MARK, fromKV } = await import('../studio.js');
  assert.equal('12,709 ratings across 47 listings'.replace(LIST_MARK, ''), '12,709 ratings across 47 listings');
  assert.equal('1. Build the page'.replace(LIST_MARK, ''), 'Build the page');
  assert.equal('- Reviewers praise comfort'.replace(LIST_MARK, ''), 'Reviewers praise comfort');
  const out = fromKV('store', 'storefront.pdp_block', [{ k: 'bullets', v: '12,709 ratings across 47 Amazon listings\n2) Size up if between sizes' }]);
  if (out.bullets) assert.deepEqual(out.bullets, ['12,709 ratings across 47 Amazon listings', 'Size up if between sizes']);
});
