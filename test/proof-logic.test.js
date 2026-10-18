// The proof proves the claim (proof-logic.js): the cases Param found on 19 Oct, and the ones that must stay quiet
import test from 'node:test';
import assert from 'node:assert/strict';
import { refine } from '../proof-logic.js';

const review = { kind: 'review', title: 'Long Curls', text: 'I shifted to CGM recently. And I tried this as my first hair gel. And yes. It keeps the curls for long.', rating: 5, at: '2026-06-29', product: 'Arata Sleek Hair Styling Stick & Gel Combo', src: 'Judge.me', url: 'https://www.arata.in/products/combo#judgeme' };
const curls = { id: 'm24-2', brand: 'Arata', title: 'Publish the CGM styling Reel for the Gel Combo', sub: 'We saw CGM customers actively questioning if products ruin curls. This Reel shows the ₹601 combo.',
  make: { pieces: '9:16 reel: Arata Sleek Hair Styling Stick & Gel Combo', backedBy: 'The Judge.me review titled Long Curls from 2026-06-29' }, rows: [['Objection', 'Will it ruin curls?'], ['Price', '₹601'], ['Review', 'Keeps the curls long']] };
const ev = (items, because) => ({ why: { because }, items, moves: [{ n: 24, title: 'Atomising product proof' }], unbacked: [] });

test('a claim about what customers say is proven by the review the card points at, never by its price', () => {
  const e = refine(curls, ev([{ kind: 'row', label: 'Price', value: '₹601', src: 'What Brew counted' }], 'We saw CGM customers actively questioning if products ruin curls.'), { voice: [review] });
  assert.equal(e.items[0].kind, 'voice'); assert.match(e.items[0].value, /keeps the curls for long/); assert.equal(e.items[0].url, review.url);
  assert.ok(!e.items.some((x) => /price/i.test(x.label)), 'the price is not proof of what customers said');
  assert.match(e.claim.note, /people doubt this, but what Brew found is praise/);
});
test('a complaint claim shows the low-star review that complains, and then needs no warning', () => {
  const bad = { kind: 'review', text: 'The hardware started tarnishing after two weeks of wearing these sneakers', rating: 2, product: 'Megh White', src: 'Judge.me', url: 'https://x.test/r' };
  const c = { brand: 'Gully Labs', title: 'Answer the hardware complaints', sub: 'Reviews show some buyers complain about tarnishing hardware on their sneakers.' };
  const e = refine(c, ev([], c.sub), { voice: [bad, review] });
  assert.equal(e.items[0].rating, 2); assert.equal(e.claim.note, '');
});
test('a result only the brand’s accounts show asks for that connector', () => {
  const c = { title: 'Fix the MitoActive page', sub: 'We saw high bounce rates on the ₹1,499 MitoActive page as buyers balk at the price.' };
  const e = refine(c, ev([], c.sub), { connected: () => false, has: () => true });
  assert.deepEqual(e.claim.needs, ['ga4', 'shopify']); assert.match(e.claim.note, /Connect Google Analytics or Shopify/);
  assert.equal(refine(c, ev([{ kind: 'account', label: 'Bounce rate', value: '71%', src: 'Your Google Analytics account' }], c.sub), { connected: () => true }).claim.note, '');
});
test('what an idea expects to happen is not a claim about data', () => {
  for (const because of ['Brew suggests this because bringing your happiest customers together encourages repeat purchases.', 'Brew suggests this because pitching beauty editors gets the serum into articles that drive organic sales.',
    'We saw Cozy Snugglet has zero public B2B landing pages or bulk-order tiers.', 'Our audit shows zero sales collateral for B2B buyers.', 'We observed duplicate snippets competing in Google search results.'])
    assert.equal(refine({ title: 'x' }, ev([{ kind: 'fact', label: 'Store fact', value: '12', url: 'https://a.test' }], because), {}).claim.note, '', because);
});
test('a page Brew read stays only when it is about the card, and a price page only when the claim is about price', () => {
  const items = [{ kind: 'source', label: 'MitoActive Serum - 30 ml price: ₹1,499', value: '', url: 'https://a.test/1' }, { kind: 'source', label: 'Curl hold styling gel reviews on curly hair', value: '', url: 'https://a.test/2' }];
  const e = refine({ brand: 'Arata', title: 'Show curl hold styling proof', sub: '' }, ev(items, 'Curly hair buyers want proof the styling gel holds.'), {});
  assert.deepEqual(e.items.map((x) => x.url), ['https://a.test/2']);
  const p = refine({ brand: 'Arata', title: 'Explain the MitoActive serum price', sub: '' }, ev(items.slice(0, 1), 'The ₹1,499 MitoActive serum price needs a reason.'), {});
  assert.equal(p.items.length, 1);
});
