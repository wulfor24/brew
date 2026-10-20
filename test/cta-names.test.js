// FEED-QA-20: every card button says what it does and opens that job. The out-of-stock card's button pauses what points
// there (it said "List what points there", which no map knew); a topic button ("Fix tracking", "Add the search info", "Launch the
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
  assert.equal(fitCta({ ...oos }).cta.label, 'Pause the ads for these', 'a saved card heals to the new name');
  assert.equal(recipeOfCard(oos).primary, 'performance.pause_pointing', 'even unhealed, the old label opens the pause');
  assert.equal(recipeOfCard(card('Plan the restart', { sector: 'catalog', title: '2 products are back in stock' })).primary, 'performance.restart_paused');
});

test('a topic button stays only on a card about that topic; otherwise the making button, else Agree with the call', () => {
  assert.equal(fitCta(card('Fix tracking', { sector: 'ads', title: 'Enable standard tracking tags to scale budget' })).cta.label, 'Fix tracking');
  assert.equal(fitCta(card('Fix tracking', { sector: 'ads', title: 'Promote bundled sets to raise order values', sub: 'Bundles lift the basket.' })).cta.label, 'Agree with the call');
  assert.equal(fitCta(card('Fix tracking', { title: 'Run a carousel ad of the bundles', make: { format: 'carousel ad' } })).cta.label, 'Make the carousel ad');
  assert.equal(fitCta(card('Launch the ad group', { title: 'Launch Meta ads for office workers' })).cta.label, 'Make the ad', 'a Google button on a Meta ad card');
  assert.equal(fitCta(card('Launch the ad group', { title: 'Bid on the “heated slippers” Google keyword' })).cta.label, 'Launch the ad group');
  assert.equal(fitCta(card('Add the search info', { title: 'Add FAQ schema to the product page' })).cta.label, 'Add the search info');
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

/* final QA pass 19 Oct (live Mamaearth): "Shift budget" on a crawl-budget card, a review strip on a tracking fix */
test('a fix card keeps no asset its words never mention, and Shift budget is only about ad money', () => {
  const track = fitCta(card('Fix tracking', { title: 'Fix broken checkout tracking to trace Meta sales', sub: 'Gokwik checkouts bypass standard Shopify browser tracking.', make: { format: 'page section', pieces: 'Review strip under add to cart on Ubtan Natural Glow Face Wash' } }));
  assert.equal(track.cta.label, 'Fix tracking'); assert.equal(track.make, undefined); assert.equal(track.makeDropped, 'page section');
  const crawl = fitCta(card('Shift budget', { title: 'Stop Google from wasting crawl budget on sold-out products', sub: 'Archiving long-term out-of-stock items cleans up our sitemaps.', make: { format: 'page section', pieces: 'Collection banner: Onion Hair Oil with Onion Oil' } }));
  assert.equal(crawl.cta.label, 'Agree with the call'); assert.equal(crawl.make, undefined);
  assert.equal(fitCta(card('Shift budget', { title: 'Move budget to the campaign with the best cost per order', sub: 'Campaign A wins.' })).cta.label, 'Shift budget');
  const strip = fitCta(card('Fix tracking', { title: 'Track clicks on the new review strip', sub: 'Add a review strip under add to cart and count its clicks.', make: { format: 'page section', pieces: 'Review strip under add to cart on Ubtan Face Wash' } }));
  assert.equal(strip.make?.format, 'page section', 'an asset the card talks about stays');
  assert.equal(fitCta(card('Fix the markup', { title: 'Show your star ratings in Google', make: { format: 'page section', pieces: 'Homepage: search-friendly product info' } })).cta.label, 'Add the search info', 'renamed, and a plain-worded card keeps it');
});

test('one-off emails and messages draft; flows approve; buttons of another format or topic give way (QA 20 Oct)', async () => {
  const { fitCta } = await import('../cards-gen.js');
  assert.equal(fitCta({ title: 'Pitch a founder op-ed', sub: 'Email ten editors.', make: { format: 'email', pieces: '1 pitch email' }, cta: { label: 'Approve the flows' } }).cta.label, 'Draft the email');
  assert.equal(fitCta({ title: 'Send a day 25 reorder nudge', sub: 'An automatic email 25 days after purchase.', make: { format: 'email', pieces: 'Reorder email' }, cta: { label: 'Draft the email' } }).cta.label, 'Approve the flows');
  assert.equal(fitCta({ title: 'Set up a Day 30 review request', sub: 'Ask for a review 30 days after delivery.', make: { format: 'email', pieces: 'Review email' }, cta: { label: 'Publish the page' } }).cta.label, 'Approve the flows');
  assert.equal(fitCta({ title: 'Message salons a free sample', sub: 'One WhatsApp to each salon.', make: { format: 'whatsapp message', pieces: '1 message' }, cta: { label: 'Draft the listing' } }).cta.label, 'Draft the message');
  assert.equal(fitCta({ title: 'Invite customers to your Sole Circle', sub: 'A members group on WhatsApp.', cta: { label: 'Approve the offers' } }).cta.label, 'Agree with the call');
  assert.equal(fitCta({ title: 'Send a day 25 reorder nudge', sub: 'Before the bottle ends.', detail: { how: ['Ask for a review later'] }, cta: { label: 'Send the review ask' } }).cta.label !== 'Send the review ask', true);
});
