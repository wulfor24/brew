// QA 19 Oct (FEED-ARV-09): every AI-answers gap card says its own fix (the question, the rival, the page), benefit first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gapFix, gapKind } from '../ai-gap.js';

test('the fix follows the question: comparison, proof, ingredients, price, best-of, how-to', () => {
  assert.equal(gapKind('Minimalist vs Arata serum'), 'compare');
  assert.equal(gapKind('which hair serum actually works for regrowth?'), 'proof');
  assert.equal(gapKind('shampoo without sulphates for itchy scalp'), 'safe');
  assert.equal(gapKind('best sneakers under $100'), 'price');
  assert.equal(gapKind('What is the best hair growth serum?'), 'best');
  assert.equal(gapKind('how to stop hair fall'), 'howto');
});

test('it names the rival and the brand page that fits, and leads with what the brand gets', () => {
  const g = gapFix({ q: 'Glossier vs Fenty highlighter?', rivals: ['Fenty Beauty'], product: { t: 'Haloscope', url: 'https://glossier.com/products/haloscope' }, brand: 'Glossier', host: 'glossier.com' });
  assert.match(g.fix, /comparison section on the Haloscope page: Glossier and Fenty Beauty, side by side/);
  assert.match(g.title, /^Get Glossier named when shoppers ask “Glossier vs Fenty highlighter”$/);
  assert.equal(g.url, 'https://glossier.com/products/haloscope');
  const n = gapFix({ q: 'best running shoes for flat feet', rivals: ['Hoka'], product: null, brand: 'Allbirds', host: 'allbirds.com' });
  assert.match(n.fix, /buyer’s guide page on allbirds\.com/); assert.equal(n.page, 'A new guide page');
  const two = [gapFix({ q: 'a vs b', rivals: ['X'] }).fix, gapFix({ q: 'is it safe in pregnancy', rivals: ['X'] }).fix];
  assert.notEqual(two[0], two[1], 'never one template for every gap');
  const fsvc = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fsvc, /A page on \$\{BH\(\)\} that answers this directly/);
});
