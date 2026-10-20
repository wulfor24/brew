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
