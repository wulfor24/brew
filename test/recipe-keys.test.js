// Every card opens a jam on a real job: for every agent × type × sector (and a told/brew card, a conflict), each action key exists.
// A brew card in the catalog sector made "brew.listing_titles", no job, and the jam crashed (QA J-01, 20 Oct).
import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeOfCard, ACTIONS } from '../remix.js';

const has = (k) => { const [a, x] = String(k).split('.'); return !!ACTIONS[a]?.[x]; };
test('every recipe action is a real job', () => {
  for (const agent of ['brew', 'creative', 'crm', 'storefront', 'performance', 'visibility', 'nope'])
    for (const type of ['idea', 'decision', 'report', 'competitor'])
      for (const sector of ['catalog', 'ads', 'creatives', 'storefront', 'visibility', 'signals', undefined])
        for (const kind of [undefined, 'conflict']) {
          const r = recipeOfCard({ id: 'told-1', agent, type, sector, kind, title: 'Sell an exclusive ninety-day pack', cta: { label: 'Work on this' } });
          assert.ok(r.actionKeys.length, `${agent}/${type}/${sector}/${kind}: no actions`);
          for (const k of r.actionKeys) assert.ok(has(k), `${agent}/${type}/${sector}/${kind}: ${k} is no job`);
        }
});

test('listening, navigation and sold-out cards open on the right job (QA J-06, J-14)', () => {
  assert.equal(recipeOfCard({ id: 'heard-r-1', agent: 'brew', sector: 'signals', type: 'report', title: 'What people dislike about The Oodie', cta: { label: 'Win their unhappy buyers' } }).primary, 'creative.add_variants');
  for (const c of [{ id: 'heard-c-1', agent: 'brew', sector: 'signals', type: 'report', title: 'What buyers complain about in sneakers', cta: { label: 'Show how we solve it' } }, { id: 'told-1', agent: 'brew', sector: 'signals', type: 'idea', title: 'Sell an exclusive pack', cta: { label: 'Work on this' } }])
    assert.ok(!recipeOfCard(c).actionKeys.slice(0, 1).some((k) => /^performance\./.test(k)), c.title);
  assert.equal(recipeOfCard({ id: 'm64-2', sector: 'ads', type: 'decision', title: 'Keep out-of-stock products out of your ads and sends', cta: { label: 'Open the moves' } }).primary, 'performance.pause_pointing');
});
