// The post-deploy UI audit's server fixes (docs/ui-audit-postdeploy.md, "Server fixes"): each rule, generic for any brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { followRead } from '../feed-service.js';
import { knobsFor, suggestFor, fitChip, KNOBS, SUGGEST } from '../studio.js';
import { sentenceCase, shipLine } from '../text-fit.js';
import { fitCta } from '../cards-gen.js';
import { withDemo } from '../demo-data.js';

/* 1. the setup stream: a cached read replays its steps, then ready */
const fakeBuilder = (events, status) => { const ls = new Set();
  return { events: () => events, status: async () => status, subscribe: (_s, f) => { events.forEach(f); ls.add(f); return () => ls.delete(f); }, emit: (e) => { events.push(e); ls.forEach((f) => f(e)); } }; };
const seed = { steps: [{ done: 'Opened 12 pages' }, { done: 'Read the brand' }], scrape: [{ k: 'open', t: 'Found the story' }, { k: 'brand', t: 'Found the palette' }] };
const run = (b) => new Promise((res) => { const out = []; followRead({ builder: b, slug: 'x', loadSeed: async () => seed, replayMs: 0, send: (e) => { out.push(e); if (e.type === 'ready') res(out); } }); });

test('a cached read (only a status event in memory) replays every step before ready', async () => {
  const out = await run(fakeBuilder([{ type: 'status', status: { stages: { read: { state: 'done' } } } }], { stages: { read: { state: 'done' } } }));
  const ready = out.findIndex((e) => e.type === 'ready');
  assert.equal(ready, out.length - 1, 'ready comes last');
  assert.deepEqual(out.filter((e) => e.type === 'step' && e.state === 'done').map((e) => e.done), ['Opened 12 pages', 'Read the brand']);
  assert.equal(out.filter((e) => e.type === 'finding').length, 2);
  assert.equal(out.filter((e) => e.type === 'ready').length, 1);
});
test('a live read in memory streams its own steps once (no double replay), then ready', async () => {
  const ev = [{ type: 'reader', ev: { type: 'step', k: 'open', state: 'reading' } }, { type: 'reader', ev: { type: 'step', k: 'open', state: 'done', done: 'Opened' } }, { type: 'read-done' }];
  const out = await run(fakeBuilder(ev, { stages: { read: { state: 'done' } } }));
  assert.equal(out.filter((e) => e.type === 'step' && e.state === 'done').length, 1);
  assert.equal(out.at(-1).type, 'ready');
});

/* 2. studio knobs and chips come from the brand, not Arata's haircare */
const comet = { slug: 'wearcomet-com', config: { country: 'IN', lang: 'en' }, personas: [{ name: 'The comfort-first daily wearer' }, { name: 'The drop chaser' }] };
const allbirds = { slug: 'allbirds-com', config: { country: 'US', lang: 'en' }, personas: [{ name: 'The all-day stander' }, { name: 'The eco-minded switcher' }] };
const HAIRCARE_ONLY = /post-pregnancy|women 30\+|bathroom shelf|lab blue|dermatologist|clinical|study number|routine/i;
test('every brand gets knobs and chips from its own pack', () => {
  for (const b of [comet, allbirds]) for (const fam of Object.keys(KNOBS)) {
    const ks = knobsFor(fam, b); for (const k of ks) { assert.ok(k.opts.length > 1, `${b.slug} ${fam}.${k.k} has one option`); for (const x of k.opts) assert.ok(!HAIRCARE_ONLY.test(x), `${b.slug} ${fam}.${k.k}: ${x}`); }
    for (const x of suggestFor(fam, b)) assert.ok(!HAIRCARE_ONLY.test(x), `${b.slug} ${fam} chip: ${x}`);
  }
  assert.deepEqual(knobsFor('meta_ad', comet).find((k) => k.k === 'audience').opts, ['Comfort-first daily wearer', 'Drop chaser']);
  assert.ok(knobsFor('meta_ad', comet).find((k) => k.k === 'lang').opts.includes('Hindi'));
  assert.equal(knobsFor('meta_ad', allbirds).find((k) => k.k === 'lang'), undefined, 'a US English brand has no language knob');
  assert.ok(!suggestFor('meta_ad', allbirds).some((x) => /hindi|hinglish/i.test(x)));
  assert.equal(fitChip('Hindi version', allbirds), null);
});
/* 4. the weekly limit: never a silent 0 */
/* 7. sentence case */
test('Title Cased titles become sentence case; names, acronyms and cased-on-purpose titles stay', () => {
  assert.equal(sentenceCase('Signup And Account Creation'), 'Signup and account creation');
  assert.equal(sentenceCase('Conversion Rate Optimisation (in progress)'), 'Conversion rate optimisation (in progress)');
  assert.equal(sentenceCase('Wool Runner Fit Guide For Summer', ['Wool Runner']), 'Wool Runner fit guide for summer');
  assert.equal(sentenceCase('Comet vs Gully Labs'), 'Comet vs Gully Labs');
  assert.equal(sentenceCase('Run Meta Ads For The UNO Drop On Instagram'), 'Run Meta ads for the UNO drop on Instagram');
  assert.equal(sentenceCase('Answer comments on drop posts within a day'), 'Answer comments on drop posts within a day');
});

/* 8. the button follows what the card makes; a comparison pairs the same product only */
test('a card that makes a page section never says "Draft the post"', () => {
  assert.equal(fitCta({ make: { format: 'page section' }, cta: { label: 'Draft the post' } }).cta.label, 'Update landing page');
  assert.equal(fitCta({ make: { format: 'reel' }, cta: { label: 'Draft the post' } }).cta.label, 'Make the video');
  assert.equal(fitCta({ make: { format: 'page section' }, cta: { label: 'Publish the page' } }).cta.label, 'Publish the page', 'a non-making button stays');
  assert.equal(fitCta({ cta: { label: 'Draft the post' } }).cta.label, 'Draft the post', 'no planned format: unchanged');
});
/* 9. estimated numbers are never shown as read from the store */
test('connectors keep number-free lines; a demo account’s numbers are marked as estimates', () => {
  const s = withDemo({ connectors: { shopify: { name: 'Shopify', changed: ['Cards show your real orders'] } }, posts: [] },
    { accounts: { shopify: { stats: [] } }, changed: { shopify: ['Cards read your 3,920 orders a month'] }, cards: [] });
  assert.deepEqual(s.connectors.shopify.changed, ['Cards show your real orders']);
  assert.deepEqual(s.connectors.shopify.changedDemo, ['Cards read your 3,920 orders a month (estimate)']);
});
