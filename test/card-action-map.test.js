// The jam a card opens must be the job the card's own button names, for every brand and every card kind:
// "Pause what points there" on a sold-out card is a pause on Meta, never "Launch a test" (2026-10-14).
// The table is the contract: card button (+ sector, tool, case) → jam action, its title on the jam page, its widget family.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeOfCard, labelFor, verbAction, ACTIONS } from '../remix.js';
import { familyOf, FAMILY_OF, ACTION_SPEC, ACTION_CHIPS, chipsFor, chipRelates, chipCtx, suggestFor, FAMILY_NAME } from '../studio.js';
import { CTA } from '../seed-template.js';

const card = (label, o = {}) => ({ id: 'c1', agent: 'storefront', sector: 'storefront', type: 'decision', kind: 'rows', title: 'A card', sub: '', cta: { label }, ...o });
const ai = (tool) => ({ mf: { family: 'x', tool, by: 'ai' } });
const OOS = { sector: 'catalog', badge: ['Out of stock', 'warn'], liveSrc: { kind: 'catalog', id: 'e1' }, title: '2 products our cards sell are out of stock', rows: [['Blue Tee', 'Out of stock'], ['Red Tee', 'Out of stock']] };

// [what the card says, expected action, expected jam title (action label), expected widget family]
const TABLE = [
  [card('Pause what points there', { ...OOS, ...ai('meta') }), 'performance.pause_pointing', 'Pause ads on sold-out products', 'meta_ops'],
  [card('Pause what points there', OOS), 'performance.pause_pointing', 'Pause ads on sold-out products', 'meta_ops'],
  [card('Pause those ads', OOS), 'performance.pause_pointing', 'Pause ads on sold-out products', 'meta_ops'],
  [card('Pause those ads', { sector: 'ads', title: 'Three ad sets are over the stop line' }), 'performance.pause_losers', 'Pause the losers', 'meta_ops'],
  [card('Restart what was paused', { sector: 'catalog', title: '2 products are back in stock' }), 'performance.restart_paused', 'Restart the paused ads', 'meta_ops'],
  [card('Update the prices', { sector: 'catalog', ...ai('shopify'), rows: [['Blue Tee', '₹999 → ₹1,099']] }), 'performance.price_in_ads', 'Update the price in ads', 'meta_ops'],
  [card('Fix the links', { sector: 'catalog', ...ai('shopify'), title: '3 products were removed' }), 'storefront.fix_links', 'Fix the dead links', 'setup'],
  [card('Add photos', { sector: 'catalog' }), 'storefront.listing_content', 'Rewrite listing content', 'listing'],
  [card('Plan the launch', { sector: 'catalog' }), 'performance.new_test', 'Launch a test', 'meta_ad'],
  [card('Fix tracking', { sector: 'ads', ...ai('meta') }), 'performance.tracking_fix', 'Fix tracking', 'setup'],
  [card('Push the titles', { sector: 'catalog', ...ai('marketplaces') }), 'storefront.listing_titles', 'Rewrite marketplace titles', 'listing'],
  [card('Approve the offers', { ...ai('shopify') }), 'storefront.bundle_offer', 'Bundle or offer tile', 'store'],
  [card('Approve the flows', { sector: 'signals', ...ai('shopify') }), 'crm.flow_copy', 'Rewrite a flow message', 'crm'],
  [card('Turn on the journey', { sector: 'signals' }), 'crm.flow_copy', 'Rewrite a flow message', 'crm'],
  [card('Send the review ask', { sector: 'signals', ...ai('reviews') }), 'crm.review_ask', 'Ask for reviews', 'crm'],
  [card('Draft the page', { sector: 'visibility' }), 'visibility.faq_entry', 'Publish an FAQ answer', 'vis'],
  [card('Draft the listing', { sector: 'catalog' }), 'storefront.listing_content', 'Rewrite listing content', 'listing'],
  [card('Draft the listing', { sector: 'storefront', ...ai('shopify') }), 'storefront.page_copy', 'Change page copy', 'store'],
  [card('Draft the listing', { sector: 'visibility', ...ai('shopify') }), 'visibility.faq_entry', 'Publish an FAQ answer', 'vis'],
  [card('Update landing page', { ...ai('shopify') }), 'storefront.page_copy', 'Change page copy', 'store'],
  [card('Shift budget', { sector: 'ads', ...ai('meta') }), 'performance.shift_budget', 'Shift budget', 'meta_ops'],
  [card('Launch the ad group', { sector: 'ads', ...ai('google') }), 'performance.search_ad', 'Launch a Google Search ad group', 'search'],
  [card('Rotate creative', { sector: 'ads' }), 'creative.swap_creative', 'Swap a tired creative', 'meta_ad'],
  [card('Fix the markup', { sector: 'visibility' }), 'visibility.schema_fix', 'Fix product markup', 'vis'],
  [card('Publish the claims ledger', { sector: 'visibility' }), 'visibility.llms_txt', 'Update llms.txt and the claims list', 'vis'],
  [card('Brief the shoot', { sector: 'creatives' }), 'creative.film_brief', 'Brief a film', 'brief'],
  [card('Make the video', { sector: 'creatives', title: 'Post the size-worry Reel' }), 'creative.short_video', 'Make the short video', 'post'],
  /* a card that plans a video ad makes the video (17 Oct: it opened a words-only shoot brief and no video could be made) */
  [card('Make the video', { sector: 'creatives', make: { format: 'video ad' } }), 'creative.short_video', 'Make the short video', 'post'],
  [card('Make the carousel ad', { sector: 'creatives' }), 'creative.carousel_ad', 'Carousel ad', 'meta_ad'],
  [card('Draft the post', { sector: 'creatives' }), 'creative.ig_post', 'Instagram post', 'social'],
  [card('Draft the stories', { sector: 'creatives' }), 'creative.ig_story', 'Instagram Stories', 'social'],
  [card('Shortlist creators', { sector: 'creatives' }), 'creative.creative_brief', 'Brief the next creatives', 'brief'],
  [card('Draft the buyer deck'), 'storefront.buyer_deck', 'Draft a buyer deck', 'brief'],
  [card('Turn on guest checkout'), 'storefront.store_setting', 'Change a store setting', 'setup'],
  [card('Answer it on the product page', { sector: 'signals' }), 'storefront.pdp_block', 'Add a proof block', 'store'],
  // "go ahead" buttons: the planned format, then the tool the card names, then the area
  [card('Generate versions', { sector: 'creatives', make: { format: 'carousel ad' } }), 'creative.carousel_ad', 'Carousel ad', 'meta_ad'],
  [card('Agree with the call', { sector: 'signals', agent: 'brew', ...ai('none') }), 'brew.plan', 'Save it as the team plan', 'decision'],
  [card('Agree with the call', { sector: 'storefront', ...ai('shopify') }), 'storefront.page_copy', 'Change page copy', 'store'],
  [card('Start the tests', { sector: 'ads', title: 'Tag every purchase with a UTM before the test' }), 'performance.tracking_fix', 'Fix tracking', 'setup'],
  [card('Publish the page', { sector: 'visibility' }), 'visibility.faq_entry', 'Publish an FAQ answer', 'vis'],
  // a button the AI wrote that we have never seen: its verb names the job
  [card('Stop the ads on these', OOS), 'performance.pause_pointing', 'Pause ads on sold-out products', 'meta_ops'],
  [card('Redirect the old pages', { sector: 'storefront' }), 'storefront.fix_links', 'Fix the dead links', 'setup'],
  [card('Raise the price by ₹100'), 'storefront.price_change', 'Change a price', 'store'],
  [card('Send a win-back email', { sector: 'signals' }), 'crm.flow_copy', 'Rewrite a flow message', 'crm'],
  // posts from the stream open as themselves, on their own platform
  [card('Reply as the brand', { post: { platform: 'youtube', platformLabel: 'youtube', format: 'reply' } }), 'creative.comment_reply', 'Reply on YouTube', 'post'],
  [card('Make the video', { post: { platform: 'youtube', format: 'short video', media: { kind: 'video' } } }), 'creative.short_video', 'Make the short video', 'post'],
  [card('Post in r/Sneakers', { post: { platform: 'reddit', format: 'post' } }), 'creative.reddit_post', 'Post on Reddit', 'post'],
  [card('Reply in r/Sneakers', { post: { platform: 'reddit', format: 'reply' } }), 'creative.reddit_post', 'Reply on Reddit', 'post'],
  [card('Answer on Quora', { post: { platform: 'quora', format: 'answer' } }), 'creative.quora_answer', 'Answer on Quora', 'post'],
  [card('Make the reel', { post: { platform: 'instagram', format: 'reel', media: { kind: 'video' } } }), 'creative.short_video', 'Make the short video', 'post']
];

test('every card button opens the jam of its own job: action, jam title and widget', () => {
  for (const [c, action, title, fam] of TABLE) {
    const r = recipeOfCard(c), why = `${c.cta.label} (${c.sector}${c.mf ? ', tool ' + c.mf.tool : ''})`;
    assert.equal(r.primary, action, `${why} → ${r.primary}`);
    assert.equal(r.actionKeys[0], action, `${why}: the first package is the card's job`);
    assert.equal(labelFor(action, c).label, title, `${why}: jam title`);
    assert.equal(familyOf(action), fam, `${why}: widget`);
  }
});

test('every action is complete: a widget family, a spec the AI follows, its own chips and a name', () => {
  for (const [agent, acts] of Object.entries(ACTIONS)) for (const [k, a] of Object.entries(acts)) {
    assert.ok(FAMILY_OF[k], `${agent}.${k} has no widget family`); assert.ok(FAMILY_NAME[familyOf(k)], `${k}: family name`);
    assert.ok(ACTION_SPEC[k], `${agent}.${k} has no spec`); assert.ok((ACTION_CHIPS[k] || []).length >= 3, `${agent}.${k} has no chips of its own`);
    assert.ok(a.label && a.target && a.rollback, `${agent}.${k}: label, target, rollback`);
  }
});

test('every button the product writes resolves to a job or is a plain link', () => {
  const NAV = new Set(['Open the moves', 'Open report']);
  for (const label of Object.keys(CTA)) { if (NAV.has(label)) continue; const r = recipeOfCard(card(label));
    assert.ok(r.primary, `"${label}" opens no job of its own`); }
});

test('the composer chips follow the action and the case, not the widget', () => {
  const c = card('Pause what points there', OOS), ch = chipsFor(recipeOfCard(c).primary, c);
  assert.ok(ch.includes('Only the sold-out products'), ch.join(' | '));
  assert.ok(!ch.some((x) => suggestFor('meta_ops').includes(x) && /Run it every Monday|Add a stop rule/.test(x)));
  assert.ok(chipsFor('performance.price_in_ads', card('Update the prices', { rows: [['A', '₹1 → ₹2'], ['B', '₹3 → ₹4'], ['C', '₹5 → ₹6']] })).includes('Update all 3 prices'));
  assert.ok(!chipsFor('performance.price_in_ads', card('Update the prices', { rows: [] })).some((x) => /\{n\}|all  /.test(x)), 'an unfillable chip is dropped');
  assert.notDeepEqual(chipsFor('storefront.page_copy', card('x')), chipsFor('storefront.pdp_block', card('x')), 'two store actions, two sets of chips');
  const ctx = chipCtx('performance.pause_pointing', 'Pause ads on sold-out products', c);
  assert.ok(chipRelates('Keep the in-stock ads running', ctx)); assert.ok(!chipRelates('Warmer photo, morning light', ctx));
});

test('a button we have never seen still reads by its verb; one with no verb stays unknown', () => {
  assert.equal(verbAction('Switch them back on', {}), 'performance.restart_paused');
  assert.equal(verbAction('Move budget to Reels', {}), 'performance.shift_budget');
  assert.equal(verbAction('Hmm', {}), null);
});
