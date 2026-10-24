// A move's cover number means what its label says (design-partner audit, 24 Oct): an "entry price" is the catalog's lowest for
// what the label names, a figure "cited in reviews" is in a review, and a cover the build couldn't back reads "to confirm"
import test from 'node:test';
import assert from 'node:assert/strict';
import { statProblem, markStat, reviewTexts } from '../stat-check.js';

const sets = [{ title: 'Scrub Set - Cotton V Neck', type: 'ScrubSuit', price: 1899 }, { title: 'Performance Scrub Set', type: 'ScrubSuit', price: 2625 }, { title: 'Scrub Cap', type: 'Scrub Caps', price: 499 }, { title: 'Classic III Stethoscope', type: 'Stethoscope', price: 9800 }];

test('an entry price is the lowest price of what the label names, never just a price the catalog has', () => {
  assert.match(statProblem({ stat: '₹2,625', statLabel: 'ENTRY SET PRICE VS ₹1,250 RIVALS' }, { products: sets }), /lowest set price.*₹1,899/);
  assert.equal(statProblem({ stat: '₹1,899', statLabel: 'ENTRY SET PRICE VS ₹1,250 RIVALS' }, { products: sets }), null);
  assert.match(statProblem({ stat: '₹499', statLabel: 'HIGHEST PRICE IN THE STORE' }, { products: sets }), /highest.*₹9,800/);
  /* comparisons, the brand's own name, words that name no product, targets and worked-out numbers get no verdict */
  assert.equal(statProblem({ stat: '₹6,080 vs ₹2,625', statLabel: 'IMPORTED FACE VS COTTON ENTRY' }, { products: sets }), null);
  assert.equal(statProblem({ stat: '₹1.45 Cr', statLabel: 'STARTING PRICE FOR A MANA VISTA HOME' }, { products: [{ title: 'Mana Vista', price: 1.45e7 }, { title: 'Mana Dale', price: 1.4e7 }], brand: 'Mana Projects' }), null);
  assert.equal(statProblem({ stat: '₹999', statLabel: 'STARTING PRICE FOR THE BUNDLE' }, { products: sets }), null);
  assert.equal(statProblem({ stat: '₹2,000', statLabel: 'TARGET ENTRY PRICE' }, { products: sets }), null);
});

test('a figure cited in reviews is in a review; shares and counts worked out from reviews are not looked up', () => {
  const reviews = ['I got the money after 2.5 months, more than 60 working days.', 'The booking refund doesn’t get paid within or after 45 days.'];
  assert.equal(statProblem({ stat: '60 days', statLabel: 'REFUND DELAY CITED IN REVIEWS' }, { reviews }), null);
  assert.match(statProblem({ stat: '90 days', statLabel: 'REFUND DELAY CITED IN REVIEWS' }, { reviews }), /no review the read kept says 90/);
  assert.equal(statProblem({ stat: '12 of 41', statLabel: 'PROJECT REVIEW MENTIONS ARE QUESTIONS' }, { reviews }), null);
  assert.equal(statProblem({ stat: '38%', statLabel: 'OF BUYERS SAY IT RUNS SMALL' }, { reviews }), null);
  assert.equal(statProblem({ stat: '98,299', statLabel: 'AMAZON REVIEWS TO GROUND THE MESSAGING' }, { reviews }), null);
  assert.deepEqual(reviewTexts({ reviews: { quotes: [{ text: 'Loved the engraving on it' }], platforms: [{ recent: [{ body: 'Took more than 60 days' }] }] } }), ['Loved the engraving on it', 'Took more than 60 days']);
});

test('a doubtful cover reads "to confirm" with the reason, once; a backed or worked-out one is left alone', () => {
  const m = markStat({ stat: '₹2,625', statLabel: 'ENTRY SET PRICE', toConfirm: [] }, { products: sets });
  assert.equal(m.statLabel, 'ENTRY SET PRICE (to confirm)'); assert.equal(m.toConfirm.length, 1); assert.match(m.toConfirm[0], /₹1,899/);
  assert.deepEqual(markStat(m, { products: sets }), m, 'idempotent');
  const unbacked = markStat({ stat: '3.06x', statLabel: 'ROAS ON CATALOG ADS', meta: { verify: { statUnbacked: true } } }, {});
  assert.match(unbacked.statLabel, /\(to confirm\)$/);
  const derived = { stat: '~48% vs 4% (derived)', statLabel: 'PACK-OF-3 SAVING', meta: { verify: { statUnbacked: true } } };
  assert.equal(markStat(derived, {}), derived);
  const ok = { stat: '₹1,899', statLabel: 'ENTRY SET PRICE' }; assert.equal(markStat(ok, { products: sets }), ok);
});
