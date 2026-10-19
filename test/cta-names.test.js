// FEED-QA-20: every card button says what it does and opens that job. The out-of-stock card's button pauses what points
// there (it said "List what points there", which no map knew); a topic button ("Fix tracking", "Fix the markup", "Launch the
// ad group"…) stays only on a card about that topic; "Publish Campaign" is sentence case, and a video-ad card's button makes
// the video. Saved cards, live cards and jams heal as they are read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fitCta, fillMake, topicOk } from '../cards-gen.js';
import { recipeOfCard } from '../remix.js';
import { CTA, ctaName, SPENDS } from '../seed-template.js';

const card = (label, o = {}) => ({ id: 'c1', agent: 'creative', sector: 'creatives', type: 'decision', kind: 'rows', title: 'A card', sub: '', cta: { label }, ...o });

test('the out-of-stock card pauses what points there, and that button maps to the pause brief', () => {
  const src = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.ok(!/label: 'List what points there'/.test(src), 'the unmapped label is gone'); assert.ok(!/label: 'Plan the restart'/.test(src));
  const oos = card('List what points there', { sector: 'catalog', title: '2 products are out of stock on x.com', rows: [['Blue Tee', 'Out of stock']] });
  assert.equal(fitCta({ ...oos }).cta.label, 'Pause what points there', 'a saved card heals to the new name');
  assert.equal(recipeOfCard(oos).primary, 'performance.pause_pointing', 'even unhealed, the old label opens the pause');
  assert.equal(recipeOfCard(card('Plan the restart', { sector: 'catalog', title: '2 products are back in stock' })).primary, 'performance.restart_paused');
});

test('a topic button stays only on a card about that topic; otherwise the making button, else Agree with the call', () => {
  assert.equal(fitCta(card('Fix tracking', { sector: 'ads', title: 'Enable standard tracking tags to scale budget' })).cta.label, 'Fix tracking');
  assert.equal(fitCta(card('Fix tracking', { sector: 'ads', title: 'Promote bundled sets to raise order values', sub: 'Bundles lift the basket.' })).cta.label, 'Agree with the call');
  assert.equal(fitCta(card('Fix tracking', { title: 'Run a carousel ad of the bundles', make: { format: 'carousel ad' } })).cta.label, 'Make the carousel ad');
  assert.equal(fitCta(card('Launch the ad group', { title: 'Launch Meta ads for office workers' })).cta.label, 'Make the ad', 'a Google button on a Meta ad card');
  assert.equal(fitCta(card('Launch the ad group', { title: 'Bid on the “heated slippers” Google keyword' })).cta.label, 'Launch the ad group');
  assert.equal(fitCta(card('Fix the markup', { title: 'Add FAQ schema to the product page' })).cta.label, 'Fix the markup');
  assert.equal(topicOk(card('Make the ad')), true, 'a button with no topic is never touched');
});

test('Publish Campaign is sentence case everywhere; a card that makes something gets its making button (video → Make the video)', () => {
  assert.ok(CTA['Publish the campaign'] && !CTA['Publish Campaign'], 'the writer picks the sentence-case name'); assert.ok(SPENDS.includes('Publish the campaign'));
  assert.equal(ctaName('Publish Campaign'), 'Publish the campaign');
  assert.equal(fitCta(card('Publish Campaign', { title: 'Launch the brand film', make: { format: 'video ad' } })).cta.label, 'Make the video');
  const vid = fillMake(card('Publish Campaign', { title: 'Launch a video ad for cold office workers' }));
  const fitted = fitCta(vid); assert.equal(fitted.cta.label, 'Make the video'); assert.equal(recipeOfCard(fitted).primary, 'creative.short_video', 'the video-ad card’s button makes the video');
  assert.equal(fitCta(card('Publish Campaign', { sector: 'ads', title: 'Shift spend to the winners' })).cta.label, 'Publish the campaign', 'nothing to make: the renamed button stays');
  assert.equal(recipeOfCard(card('Publish Campaign', { sector: 'ads', title: 'Shift spend to the winners' })).primary, recipeOfCard(card('Publish the campaign', { sector: 'ads', title: 'Shift spend to the winners' })).primary, 'old and new names open the same job');
});
