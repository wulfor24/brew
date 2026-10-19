import { B, BN, BH, CTRY, FESTN, FESTD, live } from './brand-ctx.js';
// The studio: a card → versioned change packages (the thing being made: an ad, a page section, a message…) → the jam.
// A change says what it touches, before and after, whether it spends money, how to roll it back and which checks pass.
// Its verdict says what is left before the brief is ready: a fix, the team's own checks, or a plan in the jam.
// The jam is a versioned plan (goal, the changes, open questions with owners, readiness). It ends with Share the brief:
// nothing is run from Brew. Learning reads every step (learn.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { saveGen, genFile } from './gen-store.js';
import { createMakers } from './drafts.js';
import { cardProduct } from './product-match.js';
import { isRivalCard, isResearchImage, readRivalAd, rivalBlock, rivalPicture } from './rival-ad.js'; // "Make our version" of a rival's ad: read it, then remake it in its style
import { createStudioFinals } from './finals-routes.js';
import { buildDraft } from './sloosh-prompt.js'; // Make the final on a version: Sloosh, quote first, behind a button
import { versionLabel } from './text-fit.js';
import { withSteps } from './card-plan.js';
import { familyOf, FAMILY_NAME, fieldsFor, knobsFor, suggestFor, fitChip, GRADES, pkgSchema, fieldsBrief, kvSchema, allKeys, fromKV, toKV, cleanPkg, publicText, missing, afterFromPkg, mockPkg, RATIO, leaks, isMulti, ACTION_SPEC, ACTION_GUARD, productFor, ideaAction, ideaPkg, chipsFor, chipRelates, chipCtx } from './studio.js';
import { buildPack } from './publish-pack.js';
import { impactInputs, projectImpact } from './impact.js';
import { realRows } from './connectors/common.js';
import { isQuestion, photoAsk, answerGrounded } from './jam-answer.js'; // a question gets an answer, never a version; "keep the photo" never makes one
import { EVIDENCE_ASK, proofAnswer } from './evidence.js'; // "what's the evidence?" is answered from the card's own proof
import { moveNo } from './value.js';
import { budgetWhy } from './budget.js'; // v2 words/takes: a refused spend is said with its real reason, never a silent fallback
import { createFamilies } from './measure-families.js';
import { launchBrowser, zipBuffer, withBrowser } from './pdf/render.js';
import { addV, versionsOf, versionById, signal, answered, autoCheck, outcome, ruleChecks, promptBlock, orderIntents, pickScore, takeNew, trustOf, summary, L, DETECTORS } from './learn.js';

/* ---------- what each agent can change, live ---------- */
export const ACTIONS = {
  performance: {
    search_ad: { label: 'Launch a Google Search ad group', target: { conn: 'google', object: 'Search ad group' }, money: true, rollback: 'Pause the ad group', scope: [[1, 'One ad group']], preview: 'search' },
    tracking_fix: { label: 'Fix tracking', target: { conn: 'google', object: 'Conversion tracking' }, money: false, rollback: 'Switch the server events off', scope: [[1, 'Meta and Google']], preview: 'setup' },
    pause_losers: { label: 'Pause the losers', target: { conn: 'meta', object: 'Ad set' }, money: false, rollback: 'Turn the same ads back on', scope: [[1, 'This ad set'], [3, 'The 3 weakest ad sets'], [12, 'Every ad set over target']], preview: 'numbers', settings: [['Pause', 'Ad sets over the stop line'], ['Keep', 'Winners untouched'], ['Spend', 'Goes down, never up']] },
    stop_rule: { label: 'Set a stop-or-scale rule', target: { conn: 'meta', object: 'Automated rule' }, money: false, rollback: 'Switch the rule off', scope: [[1, 'This campaign'], [3, '3 campaigns'], [12, 'Every campaign']], preview: 'numbers', settings: [['Check', 'Every morning at 9'], ['Stop', 'Over the stop line for 48 hours'], ['Scale', 'Asks you first']] },
    swap_copy: { label: 'Swap the copy in a live ad', target: { conn: 'meta', object: 'Live ad' }, money: false, rollback: 'Restore the old copy', scope: [[1, 'This ad'], [12, '12 ads with the same hook'], [40, 'All 40 live ads']], preview: 'image', settings: [['Budget', 'Unchanged'], ['Learning', 'Copy only, learning keeps']] },
    scale_budget: { label: 'Scale the budget', target: { conn: 'meta', object: 'Campaign budget' }, money: true, rollback: 'Return to the old daily budget', scope: [[1, 'This campaign']], preview: 'numbers', settings: [['Step', '+20% a day'], ['Where', 'The winning ad set'], ['Stop if', 'Cost per order passes the stop line']] },
    shift_budget: { label: 'Shift budget', target: { conn: 'meta', object: 'Campaign budgets' }, money: true, rollback: 'Move the budget back', scope: [[1, 'Two campaigns']], preview: 'numbers', settings: [['From', 'The weakest campaign'], ['To', 'The best cost per order'], ['Total spend', 'Same, just moved']] },
    /* store events (stock, price, removed pages) acted on in the ad account: the rows are the products the card names */
    pause_pointing: { label: 'Pause ads on sold-out products', target: { conn: 'meta', object: 'Ads on sold-out products' }, money: false, rollback: 'Turn the same ads back on', scope: [[1, 'The ads on these products']], preview: 'numbers', settings: [['Pause', 'Every ad that sends people to a sold-out product'], ['Restart', 'When it is back in stock'], ['Spend', 'Goes down, never up']] },
    restart_paused: { label: 'Restart the paused ads', target: { conn: 'meta', object: 'Ads paused for stock' }, money: true, rollback: 'Pause them again', scope: [[1, 'The ads on these products']], preview: 'numbers', settings: [['Restart', 'Only ads paused because the product sold out'], ['Budget', 'As it was before the pause']] },
    price_in_ads: { label: 'Update the price in ads', target: { conn: 'meta', object: 'Ads that quote the price' }, money: false, rollback: 'Restore the old copy', scope: [[1, 'The ads that quote it']], preview: 'numbers', settings: [['Changes', 'The price the ad copy quotes'], ['Budget', 'Unchanged']] },
    new_test: { label: 'Launch a test', target: { conn: 'meta', object: 'New ad set' }, money: true, rollback: 'Pause the test ad set', scope: [[1, 'One ad set']], preview: 'image', settings: [['Budget', 'Test budget, 7 days'], ['Audience', 'Broad, your market'], ['Read after', '7 days']] }
  },
  creative: {
    add_variants: { label: 'Add to the live test', target: { conn: 'meta', object: 'Test ad' }, money: false, rollback: 'Pause the new ads', scope: [[1, 'One ad'], [3, '3 ads'], [12, '12 ads']], preview: 'image', settings: [['Ad set', 'META_Test_CBO'], ['Budget', 'The test budget you approved'], ['Read after', '7 days']] },
    swap_creative: { label: 'Swap a tired creative', target: { conn: 'meta', object: 'Live ad' }, money: false, rollback: 'Put the old creative back', scope: [[1, 'This ad'], [3, '3 tired ads'], [12, 'Every ad over frequency 3.5']], preview: 'image', settings: [['Replaces', 'The ad with the highest frequency'], ['Budget', 'Unchanged']] },
    whatsapp_ad: { label: 'WhatsApp chat ad', target: { conn: 'meta', object: 'Click-to-WhatsApp ad' }, money: false, rollback: 'Pause the ad', scope: [[1, 'One ad'], [3, '3 ads']], preview: 'chat', settings: [['Opens', 'A WhatsApp chat'], ['Budget', 'The test budget you approved']] },
    carousel_ad: { label: 'Carousel ad', target: { conn: 'meta', object: 'Carousel ad' }, money: false, rollback: 'Pause the ad', scope: [[1, 'One carousel'], [3, '3 carousels']], preview: 'image', settings: [['Cards', 'Swipe in order'], ['Budget', 'Inside the live test']] },
    collection_ad: { label: 'Collection ad', target: { conn: 'meta', object: 'Collection ad' }, money: false, rollback: 'Pause the ad', scope: [[1, 'One ad']], preview: 'image', settings: [['Shows', 'A cover and the catalog'], ['Opens', 'A full-screen page']] },
    catalog_ad: { label: 'Catalog ad', target: { conn: 'meta', object: 'Advantage+ catalog ad' }, money: true, rollback: 'Pause the catalog campaign', scope: [[1, 'One product set']], preview: 'image', settings: [['Shows', 'Each person the products they looked at'], ['Needs', 'The catalog connected to Meta']] },
    ig_post: { label: 'Instagram post', target: { conn: 'meta', object: 'Instagram post' }, money: false, irreversible: 'People may see it before it comes down', rollback: 'Archive the post', scope: [[1, 'One post'], [3, 'A week of posts']], preview: 'image' },
    ig_carousel: { label: 'Instagram carousel', target: { conn: 'meta', object: 'Instagram carousel' }, money: false, irreversible: 'People may see it before it comes down', rollback: 'Archive the post', scope: [[1, 'One carousel'], [3, 'A week of carousels']], preview: 'image' },
    ig_story: { label: 'Instagram Stories', target: { conn: 'meta', object: 'Story sequence' }, money: false, rollback: 'Delete the stories', scope: [[1, 'One sequence']], preview: 'image' },
    film_brief: { label: 'Brief a film', target: { conn: null, object: 'Shoot brief' }, money: false, jam: 'Needs a shoot', rollback: 'Nothing ships until the shoot', scope: [[1, 'One film']], preview: 'script' },
    creative_brief: { label: 'Brief the next creatives', target: { conn: null, object: 'Creative brief' }, money: false, jam: 'A brief needs a person to plan it', rollback: 'Nothing ships yet', scope: [[1, 'One brief']], preview: 'checklist' },
    /* posts on other platforms (the ideas stream): Brew writes them and opens the place; a person posts them (never auto-posted into communities) */
    x_post: { label: 'Post on X', target: { conn: null, object: 'X post', name: 'X' }, money: false, rollback: 'Delete the post', scope: [[1, 'One post']], preview: 'copy', manual: true },
    linkedin_post: { label: 'Post on LinkedIn', target: { conn: null, object: 'LinkedIn post', name: 'LinkedIn' }, money: false, rollback: 'Delete the post', scope: [[1, 'One post']], preview: 'copy', manual: true },
    reddit_post: { label: 'Reply on Reddit', target: { conn: null, object: 'Reddit reply', name: 'Reddit' }, money: false, rollback: 'Delete the reply', scope: [[1, 'One thread']], preview: 'copy', manual: true },
    quora_answer: { label: 'Answer on Quora', target: { conn: null, object: 'Quora answer', name: 'Quora' }, money: false, rollback: 'Delete the answer', scope: [[1, 'One answer']], preview: 'copy', manual: true },
    fb_group_post: { label: 'Post in a Facebook group', target: { conn: null, object: 'Group post', name: 'Facebook groups' }, money: false, rollback: 'Delete the post', scope: [[1, 'One group']], preview: 'copy', manual: true },
    pinterest_pin: { label: 'Pin on Pinterest', target: { conn: null, object: 'Pin', name: 'Pinterest' }, money: false, rollback: 'Delete the pin', scope: [[1, 'One pin']], preview: 'copy', manual: true },
    comment_reply: { label: 'Reply in the comments', target: { conn: null, object: 'Comment reply', name: 'YouTube' }, money: false, rollback: 'Delete the reply', scope: [[1, 'One comment']], preview: 'copy', manual: true },
    short_video: { label: 'Make the short video', target: { conn: null, object: 'Short video', name: 'Shorts and Reels' }, money: false, rollback: 'Take the video down', scope: [[1, 'One video']], preview: 'script', manual: true }
  },
  storefront: {
    fix_links: { label: 'Fix the dead links', target: { conn: 'shopify', object: 'URL redirects' }, money: false, rollback: 'Remove the redirects', scope: [[1, 'Every dead link']], preview: 'setup' },
    store_setting: { label: 'Change a store setting', target: { conn: 'shopify', object: 'Store setting' }, money: false, rollback: 'Switch the setting back', scope: [[1, 'The whole store']], preview: 'setup' },
    buyer_deck: { label: 'Draft a buyer deck', target: { conn: null, object: 'Buyer deck' }, money: false, jam: 'A deck goes to a buyer through a person', rollback: 'Nothing ships until it is sent', scope: [[1, 'One deck']], preview: 'checklist' },
    listing_titles: { label: 'Rewrite marketplace titles', target: { conn: 'marketplaces', object: 'Listing titles' }, money: false, rollback: 'Restore the old titles on each marketplace', scope: [[1, 'One listing to start'], [5, 'The top 5 listings'], [12, 'Every listing']], preview: 'listing' },
    listing_content: { label: 'Rewrite listing content', target: { conn: 'marketplaces', object: 'Bullets, description and images' }, money: false, rollback: 'Restore the old content', scope: [[1, 'One listing to start'], [5, 'The top 5 listings'], [12, 'Every listing']], preview: 'listing' },
    takedown: { label: 'Request a takedown', target: { conn: 'marketplaces', object: 'Seller listing' }, money: false, irreversible: 'A filed takedown can’t be pulled back', rollback: 'None once filed', scope: [[1, 'One listing']], preview: 'listing' },
    page_copy: { label: 'Change page copy', target: { conn: 'shopify', object: 'Product description' }, money: false, rollback: 'Take Brew’s section out in one click (your own edits stay)', scope: [[1, 'This product'], [4, '4 hero products'], [12, 'All 12 product pages']], preview: 'copy', settings: [['Where', 'Added to the product description, in your theme’s own style'], ['Before it runs', 'Shown on your live product page and checked against your theme']] },
    pdp_block: { label: 'Add a proof block', target: { conn: 'shopify', object: 'Product page' }, money: false, rollback: 'Hide the block', scope: [[1, 'This product'], [4, '4 hero products'], [12, 'All 12 product pages']], preview: 'copy', settings: [['Where', 'Under the add-to-cart button']] },
    new_section: { label: 'New page or layout', target: { conn: 'shopify', object: 'Theme layout' }, money: false, jam: 'A layout change needs design and mobile QA', rollback: 'Revert the theme', scope: [[1, 'One page']], preview: 'checklist' },
    price_change: { label: 'Change a price', target: { conn: 'shopify', object: 'Product price' }, money: true, irreversible: 'Orders placed at the new price stay at that price', rollback: 'Put the old price back', scope: [[1, 'One product']], preview: 'numbers', settings: [['Changes', 'The price customers pay'], ['Where', 'Store and checkout']] },
    bundle_offer: { label: 'Bundle or offer tile', target: { conn: 'shopify', object: 'Offer and price' }, money: true, rollback: 'Remove the offer', scope: [[1, 'One offer']], preview: 'numbers', settings: [['Changes', 'What a bundle costs'], ['Where', 'Product page and cart']] }
  },
  visibility: {
    blog_post: { label: 'Publish a blog post', target: { conn: 'shopify', object: 'Blog post' }, money: false, rollback: 'Unpublish the post', scope: [[1, 'One post']], preview: 'copy' },
    faq_entry: { label: 'Publish an FAQ answer', target: { conn: 'shopify', object: 'FAQ page' }, money: false, rollback: 'Unpublish the entry', scope: [[1, 'One question'], [5, '5 questions'], [20, 'All 20 tracked questions']], preview: 'answer', settings: [['Where', 'The site’s FAQ page, with the “as of” date'], ['Re-check', 'Next weekly AI read']] },
    llms_txt: { label: 'Update llms.txt and the claims list', target: { conn: 'shopify', object: 'llms.txt' }, money: false, rollback: 'Restore the previous file', scope: [[1, 'One file']], preview: 'checklist', settings: [['File', 'llms.txt on your site'], ['Re-check', 'Next weekly AI read']] },
    schema_fix: { label: 'Fix product markup', target: { conn: 'shopify', object: 'Product markup' }, money: false, rollback: 'Restore the old markup', scope: [[1, 'One product'], [12, 'All 12 products']], preview: 'checklist', settings: [['Adds', 'Price, rating and study facts'], ['Re-check', 'Next weekly AI read']] },
    new_claim: { label: 'Publish a new claim', target: { conn: 'shopify', object: 'Claims page' }, money: false, jam: 'A new claim needs a source and legal', rollback: 'Unpublish', scope: [[1, 'One page']], preview: 'copy' }
  },
  crm: {
    print_insert: { label: 'Print a box insert', target: { conn: null, object: 'Printed card in every box' }, money: true, irreversible: 'Printed cards can’t be changed once printed', rollback: 'Stop putting them in boxes', scope: [[1, 'One print run']], preview: 'print' },
    flow_copy: { label: 'Rewrite a flow message', target: { conn: 'klaviyo', object: 'Flow step' }, money: false, rollback: 'Restore the old message', scope: [[1, 'One step'], [3, 'All 3 steps']], preview: 'chat', settings: [['Audience', 'Same as today'], ['Holdout', '10% get nothing']] },
    flow_timing: { label: 'Change when it sends', target: { conn: 'klaviyo', object: 'Flow timing' }, money: false, rollback: 'Restore the old timing', scope: [[1, 'One flow'], [3, '3 flows']], preview: 'numbers', settings: [['Sends', 'On the reorder day'], ['At most', 'One message in 7 days']] },
    review_ask: { label: 'Ask for reviews', target: { conn: 'loox', object: 'Review request' }, money: false, irreversible: 'Messages to customers can’t be unsent', rollback: 'Stop the request', scope: [[1, 'One request']], preview: 'chat', settings: [['Sends', 'Day 21 after delivery'], ['To', 'Customers who reordered']] },
    new_segment: { label: 'New segment', target: { conn: 'klaviyo', object: 'Segment' }, money: false, jam: 'A new audience needs its size and exclusions checked', rollback: 'Delete the segment', scope: [[1, 'One segment']], preview: 'numbers' },
    paid_broadcast: { label: 'WhatsApp broadcast', target: { conn: 'whatsapp', object: 'Broadcast' }, money: true, irreversible: 'A broadcast can’t be unsent once it goes out', rollback: 'Cancel before it sends', scope: [[1, 'One send']], preview: 'chat', settings: [['Cost', 'Paid per message'], ['To', 'Opted-in customers']] },
    discount_offer: { label: 'Retention offer', target: { conn: 'shopify', object: 'Discount code' }, money: true, irreversible: 'Orders already placed with the code keep the discount', rollback: 'Expire the code', scope: [[1, 'One code']], preview: 'numbers', settings: [['Changes', 'What a returning customer pays'], ['Expires', 'In 7 days']] }
  },
  brew: {
    plan: { label: 'Save it as the team plan', target: { conn: null, object: 'Team plan', name: 'the Work board' }, money: false, rollback: 'Reopen the plan', scope: [[1, 'One plan']], preview: 'checklist' },
    resolution: { label: 'Settle it', target: { conn: null, object: 'Decision' }, money: false, jam: 'People disagree, so a person decides', rollback: 'Nothing ships until it is decided', scope: [[1, 'One decision']], preview: 'checklist' }
  }
};
// what the card's own button asks for, as a remix action
const CTA_ACTION = {
  'Push 5 titles': 'storefront.listing_titles', 'Draft the listing': 'storefront.listing_content', 'Request takedown': 'storefront.takedown', 'Generate the sets': 'storefront.listing_content', 'Apply 34 edits': 'storefront.listing_titles',
  'Approve the ladder': 'storefront.bundle_offer', 'Approve the 3 offers': 'storefront.bundle_offer', 'Update landing page': 'storefront.page_copy', 'Apply Update': 'storefront.page_copy', 'Publish the page': 'storefront.page_copy', 'Approve 6 popups': 'storefront.new_section', 'Start the tests': 'storefront.page_copy',
  'Shift budget': 'performance.shift_budget', 'Rotate creative': 'creative.swap_creative', 'Publish Campaign': 'performance.new_test', 'Run Monday decisions': 'performance.stop_rule', 'Apply the plan': 'performance.scale_budget', 'Pause those ads': 'performance.pause_losers', 'Draft the switcher ad': 'creative.add_variants', 'Lock the Diwali set': 'creative.add_variants',
  'Queue the 12': 'creative.add_variants', 'Make the carousel ad': 'creative.carousel_ad', 'Build the collection ad': 'creative.collection_ad', 'Build the catalog ad': 'creative.catalog_ad', 'Draft the post': 'creative.ig_post', 'Draft the carousel post': 'creative.ig_carousel', 'Draft the stories': 'creative.ig_story', 'Queue the ads': 'creative.add_variants', 'Generate versions': 'creative.add_variants', 'Make the video': 'creative.short_video', 'Brief the shoot': 'creative.film_brief', 'Plan the shoot': 'creative.film_brief', 'Shortlist creators': 'creative.creative_brief', 'Swap the images': 'creative.swap_creative',
  'Turn on the journey': 'crm.flow_copy', 'Approve the flows': 'crm.flow_copy', 'Send on WhatsApp': 'crm.paid_broadcast', 'Send the review ask': 'crm.review_ask', 'Approve the box insert': 'crm.print_insert', 'Open the club': 'crm.new_segment',
  'Fix tracking': 'performance.tracking_fix', 'Draft the buyer deck': 'storefront.buyer_deck', 'Build the score': 'storefront.new_section', 'Approve all': 'storefront.new_section', 'Open report': null, 'Agree with the call': 'brew.plan', 'Open the scoreboard': 'brew.plan', 'Ship the five': 'brew.plan',
  'Make our version': 'creative.add_variants', 'Turn into an idea': 'creative.add_variants', 'Start this': 'creative.add_variants', 'Turn on guest checkout': 'storefront.store_setting', 'Launch the ad group': 'performance.search_ad',
  'Reply as the brand': 'creative.reddit_post', 'Answer it on the product page': 'storefront.pdp_block', 'Use their words in a post': 'creative.ig_post',
  'Publish the claims ledger': 'visibility.llms_txt', 'Fix the markup': 'visibility.schema_fix', 'Review draft': 'visibility.faq_entry', 'Set the watch': 'visibility.faq_entry',
  // the buttons every brand's cards carry (seed-template CTA, live store events in feed-service liveCard)
  'Push the titles': 'storefront.listing_titles', 'Approve the offers': 'storefront.bundle_offer', 'Draft the page': 'visibility.faq_entry', 'Open the moves': null,
  'Pause what points there': 'performance.pause_pointing', 'Restart what was paused': 'performance.restart_paused', 'Update the prices': 'performance.price_in_ads', 'Fix the links': 'storefront.fix_links',
  'Plan the launch': 'performance.new_test', 'Add photos': 'storefront.listing_content'
};
/* buttons that say "go ahead" without naming a job: the card's planned format or the tool it names decides the package.
   Every other known button names its job, and that job wins over the tool (Param, 2026-10-14: "Pause what points there"
   opened as "Launch a test on Meta Ads" because the named tool beat the button) */
const GENERIC_CTA = new Set(['Agree with the call', 'Open the scoreboard', 'Ship the five', 'Apply the plan', 'Approve all', 'Start this', 'Turn into an idea', 'Make our version', 'Generate versions', 'Start the tests', 'Apply Update', 'Review draft', 'Set the watch', 'Open report', 'Publish Campaign', 'Publish the page']);
// the same button means different things in different places
const CTA_IN_SECTOR = {
  'creatives:Publish Campaign': 'creative.add_variants', 'storefront:Draft the listing': 'storefront.page_copy', 'signals:Draft the listing': 'storefront.page_copy', 'creatives:Draft the listing': 'storefront.page_copy', 'visibility:Draft the listing': 'visibility.faq_entry', 'ads:Draft the listing': 'storefront.page_copy', 'catalog:Swap the images': 'storefront.listing_content', 'visibility:Publish the page': 'visibility.faq_entry', 'visibility:Open report': 'visibility.faq_entry',
  // "make the next version" on a measured result repeats what worked, where it worked
  'creatives:Generate versions': 'creative.add_variants', 'ads:Generate versions': 'creative.add_variants', 'storefront:Generate versions': 'storefront.page_copy', 'signals:Generate versions': 'crm.flow_copy', 'visibility:Generate versions': 'visibility.faq_entry', 'catalog:Generate versions': 'storefront.listing_titles'
};
/* the tool the AI named for the card (measure-families): a "go ahead" button opens on that tool */
const TOOL_PRIMARY = { meta: 'performance.new_test', google: 'performance.search_ad', shopify: 'storefront.page_copy', marketplaces: 'storefront.listing_content', klaviyo: 'crm.flow_copy', whatsapp: 'crm.flow_copy', reviews: 'crm.review_ask' };
const toolOf = (key) => { const [a, k] = String(key || '').split('.'); return ACTIONS[a]?.[k]?.target?.conn ?? null; };
// the format a card asks to be made (cards-gen make.format) is the package
const MAKE_ACTION = { 'single image ad': 'creative.add_variants', 'carousel ad': 'creative.carousel_ad', 'collection ad': 'creative.collection_ad', 'catalog ad': 'creative.catalog_ad', 'video ad': 'creative.short_video', reel: 'creative.short_video', 'instagram post': 'creative.ig_post', 'instagram carousel': 'creative.ig_carousel', 'instagram stories': 'creative.ig_story', 'whatsapp message': 'crm.flow_copy', email: 'crm.flow_copy', 'page section': 'storefront.page_copy' };
const TRACKING = /\b(tracking|pixel|conversions? api|capi|ga4|utms?)\b/i;
const DECIDE_CTA = new Set(['Agree with the call', 'Open the scoreboard', 'Ship the five', 'Apply the plan']); // a decision stays a decision
const MAKING = new Set(['Generate versions', 'Make the carousel ad', 'Build the collection ad', 'Build the catalog ad', 'Make the video', 'Draft the post', 'Draft the carousel post', 'Draft the stories', 'Approve the flows', 'Update landing page']);
const STOCK = /\b(out of stock|sold[ -]?out|stock-?outs?|no stock)\b/i;
const stockCard = (c) => STOCK.test(`${c.title || ''} ${c.badge?.[0] || ''}`) || (c.liveSrc?.kind === 'catalog' && /stock/i.test(c.badge?.[0] || ''));
/* a button we have never seen (cards written by the AI): what its verb asks for, in order. Each rule names one job */
const VERB_RULES = [
  [/\b(restart|resume|unpause|turn (them |it )?back on|switch (them |it )?back on)\b/i, () => 'performance.restart_paused'],
  [/\b(pause|stop|switch off|turn off|kill)\b/i, (c) => (stockCard(c) ? 'performance.pause_pointing' : 'performance.pause_losers')],
  [/\b(fix|redirect|repair)\b.*\blinks?\b|\bredirects?\b/i, () => 'storefront.fix_links'],
  [/\b(update|fix|correct)\b.*\bprices?\b/i, () => 'performance.price_in_ads'],
  [/\b(change|raise|lower|cut)\b.*\bprices?\b|\breprice\b/i, () => 'storefront.price_change'],
  [/\b(tracking|pixel|conversions? api|capi)\b/i, () => 'performance.tracking_fix'],
  [/\b(shift|move)\b.*\bbudget\b/i, () => 'performance.shift_budget'],
  [/\bbudget\b|\bscale\b/i, () => 'performance.scale_budget'],
  [/\bstop[- ]rule\b|\brules?\b/i, () => 'performance.stop_rule'],
  [/\bsearch ads?\b|\bad group\b|\bkeywords?\b/i, () => 'performance.search_ad'],
  [/\btitles?\b/i, () => 'storefront.listing_titles'],
  [/\blistings?\b|\bphotos?\b|\bimages?\b/i, (c) => (c.sector === 'catalog' ? 'storefront.listing_content' : null)],
  [/\btakedown\b/i, () => 'storefront.takedown'],
  [/\bmarkup\b|\bschema\b/i, () => 'visibility.schema_fix'],
  [/\bllms\.txt\b|\bclaims (list|ledger)\b/i, () => 'visibility.llms_txt'],
  [/\bfaq\b|\banswer page\b/i, () => 'visibility.faq_entry'],
  [/\breviews?\b.*\b(ask|request)\b|\b(ask|request)\b.*\breviews?\b/i, () => 'crm.review_ask'],
  [/\bbroadcast\b/i, () => 'crm.paid_broadcast'],
  [/\bsegment\b/i, () => 'crm.new_segment'],
  [/\b(flows?|journey|emails?|whatsapp message|sms)\b/i, () => 'crm.flow_copy'],
  [/\b(discount|code)\b/i, () => 'crm.discount_offer'],
  [/\b(offers?|bundles?|ladder)\b/i, () => 'storefront.bundle_offer'],
  [/\bproof block\b|\bproduct page\b/i, () => 'storefront.pdp_block'],
  [/\b(landing page|page copy|page|section|banner)\b/i, () => 'storefront.page_copy'],
  [/\binsert\b|\bprint\b/i, () => 'crm.print_insert'],
  [/\bcarousel ad\b/i, () => 'creative.carousel_ad'],
  [/\bcollection ad\b/i, () => 'creative.collection_ad'],
  [/\bcatalog ad\b/i, () => 'creative.catalog_ad'],
  [/\bstor(y|ies)\b/i, () => 'creative.ig_story'],
  [/\bcarousel\b/i, () => 'creative.ig_carousel'],
  [/\b(shoot|film)\b/i, () => 'creative.film_brief'],
  [/\b(reel|short video|video)\b/i, () => 'creative.short_video'],
  [/\bcreators?\b|\bbrief\b/i, () => 'creative.creative_brief'],
  [/\b(post|instagram)\b/i, () => 'creative.ig_post'],
  [/\b(swap|rotate|refresh)\b/i, () => 'creative.swap_creative'],
  [/\b(test|launch)\b/i, () => 'performance.new_test'],
  [/\b(ads?|creatives?|hooks?)\b/i, () => 'creative.add_variants'],
  [/\b(decide|agree|settle|plan)\b/i, () => 'brew.plan']
];
export const verbAction = (label, c = {}) => { for (const [re, f] of VERB_RULES) if (re.test(label || '')) { const k = f(c); if (k) return k; } return null; };
/* the same job, sharpened by the card's case: pausing "the losers" on a sold-out card is pausing what points at it */
const refine = (k, c) => (k === 'performance.pause_losers' && stockCard(c) ? 'performance.pause_pointing' : k === 'creative.film_brief' && /\b(reels?|shorts?|tiktok)\b/i.test(c.title || '') ? 'creative.short_video' : k);
/* a card whose title names one ad channel opens on that channel: a button that makes ads somewhere else ("Launch the ad
   group" on "Launch Meta prospecting…") was written loosely, and the card's own words win. The format the card plans
   leads when it is on the named channel (a single image ad on Meta), else that channel's own launch */
const CHANNEL_WORDS = [['meta', /\b(meta|facebook|instagram|ig|reels?|advantage\+?)\b/i], ['google', /\b(google|search ads?|adwords|youtube|pmax|performance max)\b/i]];
export const namedChannel = (c = {}) => { const hits = CHANNEL_WORDS.filter(([, re]) => re.test(String(c.title || ''))).map(([k]) => k); return hits.length === 1 ? hits[0] : null; };
const AD_FAMILIES = new Set(['search', 'meta_ad']);
const onChannel = (k, c) => {
  const named = namedChannel(c), tool = toolOf(k); if (!k || !named || !tool || tool === named || !AD_FAMILIES.has(familyOf(k))) return k;
  const made = MAKE_ACTION[c.make?.format]; return made && toolOf(made) === named ? made : TOOL_PRIMARY[named] || k;
};
const primaryOf = (c) => {
  if (c.post?.platform) return ideaAction(c.post); // an idea from the stream opens as the post it is, on its own platform
  if (c.kind === 'chat') return 'creative.whatsapp_ad';
  const label = String(c.cta?.label || '').trim(), byLabel = CTA_IN_SECTOR[`${c.sector}:${label}`] ?? CTA_ACTION[label];
  if (label && !(label in CTA_ACTION) && !CTA_IN_SECTOR[`${c.sector}:${label}`]) { const v = verbAction(label, c); if (v) return onChannel(refine(v, c), c); } // a button we don't know: its verb
  if (MAKE_ACTION[c.make?.format] && MAKING.has(label)) return MAKE_ACTION[c.make.format]; // a making button follows the format the card plans (cards-gen keeps them in step)
  if (byLabel && !GENERIC_CTA.has(label)) return onChannel(refine(byLabel, c), c); // a button that names its job: that job, whatever tool the AI named
  if (byLabel === null && !GENERIC_CTA.has(label)) return null; // a button that only navigates (Open the moves)
  const made = MAKE_ACTION[c.make?.format]; if (made) return onChannel(made, c);
  const ai = c.mf?.by === 'ai' ? c.mf.tool : null;
  if (ai && TOOL_PRIMARY[ai] && toolOf(byLabel) !== ai) return TOOL_PRIMARY[ai];
  if (/lab notes|new post|blog/i.test(`${c.title} ${c.campaign || ''}`) && c.sector === 'visibility') return 'visibility.blog_post';
  if (!DECIDE_CTA.has(label) && TRACKING.test(c.title || '')) return 'performance.tracking_fix'; // "go ahead" on a tracking card is the tracking fix (titles are too loose for the other verbs)
  return byLabel ? onChannel(refine(byLabel, c), c) : null;
};
/* what a change is called on the jam page, from the card it came from: a Reddit thread of its own is a post, not a
   reply; a comment reply says where it goes */
export const labelFor = (key, c = {}) => { const [a, k] = String(key).split('.'); const act = ACTIONS[a]?.[k]; if (!act) return null;
  const PLN = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X', reddit: 'Reddit', linkedin: 'LinkedIn', facebook: 'Facebook' }, raw = String(c.post?.platform || '').toLowerCase();
  const pl = PLN[raw] || (/^[a-z]/.test(c.post?.platformLabel || '') ? '' : c.post?.platformLabel) || (raw ? raw[0].toUpperCase() + raw.slice(1) : '');
  if (k === 'reddit_post' && c.post && !/reply|comment/i.test(c.post.format || '')) return { label: 'Post on Reddit', target: { ...act.target, object: 'Reddit post' } };
  if (k === 'comment_reply' && pl) return { label: `Reply on ${pl}`, target: { ...act.target, name: pl } };
  return { label: act.label, target: act.target }; };
// the card's area decides which actions make sense, not which agent posted it
const SECTOR_AGENT = { catalog: 'storefront', ads: 'performance', creatives: 'creative', storefront: 'storefront', visibility: 'visibility', signals: 'crm' };
const SECTOR_ACTIONS = { catalog: ['listing_titles', 'listing_content', 'page_copy'] };
const CROSS = ['performance.pause_losers', 'performance.scale_budget', 'creative.add_variants', 'storefront.page_copy', 'storefront.pdp_block', 'visibility.faq_entry', 'crm.flow_timing', 'crm.flow_copy'];
// when a card names its action, every package is that action (different cuts of it), plus at most these
// close alternatives that reach the same goal. Nothing from another job (Param, 2026-10-12: "Push 5 titles"
// must never offer budget rules).
const SAME_GOAL = {
  listing_titles: ['storefront.listing_content'], listing_content: ['storefront.listing_titles'], takedown: [], buyer_deck: [],
  bundle_offer: [], price_change: ['storefront.bundle_offer'], page_copy: ['storefront.pdp_block'], pdp_block: ['storefront.page_copy'], new_section: ['storefront.pdp_block'], store_setting: [], blog_post: ['visibility.faq_entry'],
  shift_budget: ['performance.scale_budget'], scale_budget: ['performance.shift_budget'], pause_losers: ['performance.stop_rule'], stop_rule: ['performance.pause_losers'],
  pause_pointing: ['performance.price_in_ads'], restart_paused: [], price_in_ads: ['creative.swap_copy'], fix_links: ['performance.pause_pointing'], comment_reply: [],
  new_test: ['creative.add_variants'], swap_copy: ['creative.swap_creative'], search_ad: [], tracking_fix: [],
  add_variants: ['creative.swap_creative', 'creative.carousel_ad'], swap_creative: ['creative.add_variants'], whatsapp_ad: ['creative.add_variants'],
  carousel_ad: ['creative.add_variants', 'creative.ig_carousel'], collection_ad: ['creative.carousel_ad', 'creative.catalog_ad'], catalog_ad: ['creative.collection_ad'], ig_post: ['creative.ig_carousel'], ig_carousel: ['creative.carousel_ad', 'creative.ig_story'], ig_story: ['creative.ig_carousel'], film_brief: [], creative_brief: ['creative.film_brief'],
  faq_entry: ['visibility.llms_txt'], llms_txt: ['visibility.faq_entry'], schema_fix: [], new_claim: ['visibility.faq_entry'],
  flow_copy: ['crm.flow_timing'], flow_timing: ['crm.flow_copy'], review_ask: [], new_segment: ['crm.flow_copy'], paid_broadcast: ['crm.flow_copy'], print_insert: [], discount_offer: [],
  x_post: ['creative.linkedin_post'], linkedin_post: ['creative.x_post'], reddit_post: [], quora_answer: [], fb_group_post: [], pinterest_pin: [], short_video: ['creative.film_brief'],
  plan: [], resolution: []
};
// the chips under the card: ways to cut THIS action, not generic ones
const ACTION_INTENTS = {
  listing_titles: ['Start with one listing', 'Claim first, short'], listing_content: ['Same images everywhere', 'Bullets only'], takedown: ['Firm but polite', 'With evidence'], buyer_deck: ['Shorter deck', 'Lead with the numbers'],
  bundle_offer: ['Two tiles, not three', 'Lead with the routine'], price_change: ['Smaller step', 'Explain the why'], page_copy: ['Shorter', 'Number first'], pdp_block: ['Reviews first', 'Study first'], new_section: ['One moment to start', 'Mobile first'], store_setting: ['Test on one product'], blog_post: ['Shorter', 'More sources'],
  shift_budget: ['Smaller shift', 'Winners only'], scale_budget: ['+20% step', 'One ad set first'], pause_losers: ['Worst three only', 'Pause for 48 hours'], stop_rule: ['Stricter line', 'Looser line'],
  pause_pointing: ['Only the sold-out products', 'Restart when back in stock'], restart_paused: ['Only what was paused for stock', 'Lower budget first'], price_in_ads: ['Every ad that quotes it', 'New price first'], fix_links: ['Closest product', 'The collection page'], comment_reply: ['Answer in one line', 'Friendlier'],
  new_test: ['Smaller budget', 'New audience'], swap_copy: ['Shorter', 'Number first'], search_ad: ['Exact match only', 'Add negatives'], tracking_fix: ['Meta first', 'Google first'],
  add_variants: ['Three cuts', 'Hindi version'], carousel_ad: ['Five cards', 'One product per card'], collection_ad: ['Best sellers only', 'New arrivals'], catalog_ad: ['Price on the frame', 'Rating on the frame'], ig_post: ['Number first', 'Real review'], ig_carousel: ['Seven slides', 'Myth vs fact'], ig_story: ['Add a poll', 'Three stories'], swap_creative: ['New hook', 'New look'], whatsapp_ad: ['Shorter chat', 'Hinglish'], film_brief: ['Shorter film', 'Phone-shot version'], creative_brief: ['Five angles', 'From real reviews'],
  faq_entry: ['Tighter answer', 'Add the source'], llms_txt: ['Fewer lines', 'Add dates'], schema_fix: ['Price and rating only'], new_claim: ['Softer claim', 'With the study'],
  flow_copy: ['Softer tone', 'Hinglish'], flow_timing: ['Later send', 'Fewer messages'], review_ask: ['Ask for a photo', 'Shorter ask'], new_segment: ['Tighter segment', 'Leave out new buyers'], paid_broadcast: ['Smaller list first', 'Hinglish'], print_insert: ['Fewer words', 'Bigger QR'], discount_offer: ['Smaller offer', 'Shorter expiry'],
  x_post: ['Shorter', 'As a thread'], linkedin_post: ['Shorter', 'More personal'], reddit_post: ['Answer first', 'Add an honest downside'], quora_answer: ['Shorter', 'Add a comparison'], fb_group_post: ['Warmer', 'Ask the group'], pinterest_pin: ['More search words'], short_video: ['Shorter', 'Hook in 1 second'],
  plan: ['Owners and dates', 'First step only'], resolution: []
};
// every card type × agent: the intent chips and the actions a remix may produce
export const RECIPES = {
  performance: {
    decision: { intents: ['Go as planned', 'Smaller first step', 'Cut waste'], actions: ['pause_losers', 'stop_rule', 'scale_budget', 'shift_budget'] },
    idea: { intents: ['Launch as a test', 'Swap copy in a live ad', 'New audience'], actions: ['new_test', 'swap_copy', 'stop_rule'] },
    report: { intents: ['What moves this', 'Cut waste', 'Scale what works'], actions: ['pause_losers', 'scale_budget', 'stop_rule', 'swap_copy'], levers: true },
    competitor: { intents: ['Counter ad', 'Our proof point', 'Steal the format'], actions: ['swap_copy', 'new_test'] }
  },
  creative: {
    decision: { intents: ['Ship it', 'Three cuts', 'As a carousel'], actions: ['add_variants', 'swap_creative', 'carousel_ad'] },
    idea: { intents: ['New hook', 'New format', 'Carousel', 'Organic post'], actions: ['add_variants', 'carousel_ad', 'ig_carousel', 'swap_creative', 'whatsapp_ad', 'film_brief', 'collection_ad', 'ig_story', 'ig_post'] },
    report: { intents: ['Brief the next five', 'Refresh tired ads', 'What worked'], actions: ['creative_brief', 'swap_creative', 'add_variants'], levers: true },
    competitor: { intents: ['Our version', 'Counter-angle', 'Steal the format'], actions: ['add_variants', 'carousel_ad', 'swap_creative', 'ig_carousel'] }
  },
  storefront: {
    decision: { intents: ['Do it', 'Copy only', 'Smaller test'], actions: ['page_copy', 'pdp_block', 'bundle_offer', 'price_change', 'new_section'] },
    idea: { intents: ['Copy change', 'Proof block', 'New offer tile'], actions: ['page_copy', 'pdp_block', 'bundle_offer', 'new_section'] },
    report: { intents: ['Fix the biggest leak', 'What moves this', 'Quick wins'], actions: ['page_copy', 'pdp_block', 'bundle_offer'], levers: true },
    competitor: { intents: ['Proof block', 'Answer their claim', 'Our number first'], actions: ['pdp_block', 'page_copy', 'new_section'] }
  },
  visibility: {
    decision: { intents: ['Publish it', 'Tighter answer', 'Add the source'], actions: ['faq_entry', 'llms_txt', 'schema_fix'] },
    idea: { intents: ['FAQ answer', 'llms.txt line', 'Markup fix'], actions: ['faq_entry', 'llms_txt', 'schema_fix'] },
    report: { intents: ['Get us named', 'Fix the markup', 'What moves this'], actions: ['faq_entry', 'llms_txt', 'schema_fix'], levers: true },
    competitor: { intents: ['Counter with our numbers', 'Dated comparison', 'New claim'], actions: ['faq_entry', 'new_claim'] }
  },
  crm: {
    decision: { intents: ['Apply it', 'Softer tone', 'Better timing'], actions: ['flow_copy', 'flow_timing', 'review_ask', 'paid_broadcast'] },
    idea: { intents: ['New message', 'Review ask', 'WhatsApp version'], actions: ['flow_copy', 'review_ask', 'new_segment', 'paid_broadcast'] },
    report: { intents: ['Fix the drop-off', 'Better timing', 'Win back'], actions: ['flow_timing', 'flow_copy', 'discount_offer'], levers: true },
    competitor: { intents: ['Beat their lock-in', 'Loyalty message', 'Retention offer'], actions: ['flow_copy', 'discount_offer'] }
  },
  brew: {
    decision: { intents: ['Find a middle ground', 'Go with our pick', 'Smaller first step'], actions: ['resolution'], alwaysJam: true },
    idea: { intents: ['Plan it'], actions: ['resolution'], alwaysJam: true },
    report: { intents: ['What moves this', 'Biggest lever', 'Quick wins'], cross: true, levers: true },
    competitor: { intents: ['Turn it into an idea', 'Our angle', 'Page change'], cross: true }
  }
};
const PREVIEW_OF_KIND = { chat: 'chat', answer: 'answer', film: 'script', kit: 'checklist', howto: 'checklist', quotes: 'chat', trend: 'levers' };

/* ---------- jam templates: what has to be true before the brief is shared ---------- */
const JAM_TPL = {
  performance: [['budget_owner', 'Who owns this budget and has said yes?', 'perf'], ['tracking', 'Is purchase tracking verified for this campaign?', 'perf'], ['stop_rule', 'What stops it if cost per order climbs?', 'ai']],
  creative: [['claims', 'Does every claim match what we can prove, with its time window?', 'brandm'], ['rights', 'Do we have the rights to every face, review and photo?', 'brandm'], ['sizes', 'Are the 1:1, 4:5 and 9:16 sizes ready?', 'ai']],
  storefront: [['mobile_qa', 'Has it been checked on mobile?', 'ops'], ['stock', 'Is there stock for the traffic this sends?', 'ops'], ['legal', 'Are the page claims cleared?', 'brandm'], ['rollback', 'How do we roll it back if conversion drops?', 'ai']],
  visibility: [['source', 'Which claims-list row backs each line?', 'ai'], ['dated', 'Is the “as of” date in the first line?', 'brandm']],
  crm: [['segment', 'How big is the segment, and who is left out?', 'growth'], ['window', 'When does it send, and how often at most?', 'ai'], ['compliance', 'Are opt-out and the WhatsApp template approved?', 'growth']],
  brew: [['owner', 'Who makes the final call?', 'growth'], ['moves', 'Which moves change if we pick this?', 'ai']]
};
/* No canned answers: a readiness question is answered by the person who owns it (Brew copies the question for them)
   or drafted by AI as a suggestion. Brew never claims a check, an approval or a sign-off happened. */
const SECTOR_OF = { listing: 'catalog', performance: 'ads', creative: 'creatives', storefront: 'storefront', visibility: 'visibility', crm: 'signals' };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const actKey = (key) => { const [a, k] = String(key).split('.'); return ACTIONS[a]?.[k] ? { agent: a, key, ...ACTIONS[a][k] } : null; };
// which actions a card can become, with the card's own recommendation first. Pure, so every card can be audited.
/* a card whose label we don't know: order the general packages by what the card talks about, so a naming card
   never opens as an ads change (pause_losers used to come first for every such card) */
const CROSS_WORDS = {
  'performance.pause_losers': /\b(pause|losers?|cpa|cost per|wasted? spend|ad ?sets?|underperform)/g,
  'performance.scale_budget': /\b(scale|budget|winners?|roas|spend more|top ?up)/g,
  'creative.add_variants': /\b(ads?|creatives?|hooks?|videos?|reels?|statics?|carousels?|ugc|thumb-?stop)\b/g,
  'storefront.page_copy': /\b(page|homepage|site|copy|headline|landing|collection|section|banner)\b/g,
  'storefront.pdp_block': /\b(product page|pdp|size|fit|reviews? on|trust|shipping line|returns)\b/g,
  'storefront.listing_titles': /\b(titles?|names?|naming|catalog(ue)?|listings?|silhouettes?|untitled|seo titles?)\b/g,
  'visibility.faq_entry': /\b(ai answers?|chatgpt|gemini|perplexity|faq|search|seo|google|named)\b/g,
  'crm.flow_timing': /\b(timing|send time|wait|day \d|cadence|reminder)\b/g,
  'crm.flow_copy': /\b(email|whatsapp|sms|flow|win-?back|abandon|cart|customers|subscribers|repeat)\b/g,
};
const byText = (c, keys) => { const txt = `${c.title || ''} ${c.title || ''} ${c.sub || ''} ${c.src || ''} ${c.cta?.label || ''}`.toLowerCase();
  const sc = (k) => (txt.match(CROSS_WORDS[k] || /$^/g) || []).length; return keys.map((k, i) => [k, sc(k), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]); };
export const recipeOfCard = (c) => {
  const agent = c.kind === 'conflict' || c.agent === 'brew' ? 'brew' : SECTOR_AGENT[c.sector] || (RECIPES[c.agent] ? c.agent : 'creative');
  const type = RECIPES[agent][c.type] ? c.type : 'idea';
  let r = RECIPES[agent][type];
  if (c.kind === 'conflict') r = { ...RECIPES.brew.decision, conflict: true };
  else if (agent === 'brew' && (type === 'decision' || type === 'idea')) r = { ...RECIPES.brew.report };
  if (agent === 'creative' && c.kind === 'film') r = { ...r, actions: ['film_brief', 'add_variants'] };
  if (agent === 'creative' && c.kind === 'chat') r = { ...r, actions: ['whatsapp_ad', ...r.actions.filter((x) => x !== 'whatsapp_ad')] };
  if (SECTOR_ACTIONS[c.sector] && !r.conflict && !r.alwaysJam) r = { ...r, actions: SECTOR_ACTIONS[c.sector], cross: false };
  let actions = r.cross ? byText(c, [...CROSS, 'storefront.listing_titles'].filter((k) => actKey(k))) : r.actions.map((k) => `${agent}.${k}`);
  const pk = primaryOf(c); const primary = pk && actKey(pk) ? pk : null;
  const pkey = primary && primary.split('.').pop();
  if (primary && !r.conflict) actions = [primary, ...(SAME_GOAL[pkey] || []).filter((k) => actKey(k) && k !== primary)];
  const intents = primary && !r.conflict && c.cta?.label ? [`Do it: ${c.cta.label.toLowerCase()}`, ...(ACTION_INTENTS[pkey] || r.intents.filter((x) => !/^do it/i.test(x))).map((x) => fitChip(x, B())).filter(Boolean)].slice(0, 3) : r.intents;
  return { ...r, agent, type, key: `${agent}.${type}`, actionKeys: actions, primary, intents };
};

/* a week of the package's own daily budget, exactly: the README, the brief and the Ads Editor CSV say the same money
   (a floor of 1,000 once turned a $15/day ad group into "About $1,000 a week"). An ad with no budget set says so */
export const amountOf = (act, family, pkg = {}) => {
  if (!act.money) return 0;
  if (['meta_ad', 'search'].includes(family) && +pkg.dailyBudget > 0) return Math.round(+pkg.dailyBudget * 7);
  if (family === 'meta_ops' && pkg.spendChangeWeek > 0) return pkg.spendChangeWeek;
  return 0; // no budget in the package, or a one-off cost (print, price, codes, sends): the team confirms it
};
export function createRemix(o) {
  const { claudeTool, geminiImage, PUB, LANE_PHOTO, FACTS = {}, unbackedNums = () => [], MOVES = null, photoFile = (rel) => path.join(PUB, rel) } = o;
  const catalogOf = o.catalogOf || (() => null);
  /* the photo of the product the card's asset line (else its words) names, so the jam's pictures show what the card promises */
  const cardPhoto = (t, c) => { try { return cardProduct(c, catalogOf(t) || [], { brand: o.SEED?.brand?.name || '' })?.img || null; } catch { return null; } };
  /* "Make our version" of a rival's ad (rival-ad.js): the ad behind the card and how it is made, read once per ad */
  const fileOfRel = async (rel) => { const f = (o.photoAsync ? await o.photoAsync(rel).catch(() => null) : null) || photoFile(rel); try { return f && fs.statSync(f).isFile() ? f : null; } catch { return null; } };
  const rivalRead = async (t, c) => { const ad = isRivalCard(c) ? o.rivalAdOf?.(t, c) || null : null; if (!ad) return null;
    const style = isMock() ? null : await readRivalAd(ad, { call: claudeTool, fileOf: fileOfRel, store: o.rivalStoreOf?.(t) || null, log }).catch(() => null); return { ad, style }; };
  /* what a package keeps when its words are rewritten: the picture, the knobs and the look, and a first draft's own media
     (its video, its slides), so the draft the card showed stays v0 and every version made from it keeps it */
  const keepMedia = (p = {}, all = false) => { const d = p.draft && (all || !p.draft.text) ? p.draft : undefined; /* a text draft (an email or page shown as a picture) is only v0: new words replace it */
    return { image: p.image, knobs: p.knobs, grade: p.grade, ...(p.video ? { video: p.video, poster: p.poster || null, ...(p.videoHook ? { videoHook: p.videoHook } : {}) } : {}), draft: d, ...(d && p.cardImages ? { cardImages: p.cardImages } : {}) }; };
  /* photos on a post: community platforms (Reddit, Quora, Facebook groups) take real photos only, never an AI image */
  const realOnly = (ch) => ch.family === 'post' && /reddit|quora|facebook|fb_group|comment_reply/i.test(`${ch.action} ${ch.pkg?.platform || ''}`);
  /* a line in the studio chat from the person in this request: who said it travels with it, so a team jam shows whose ask it was */
  const youSaid = (t, text, extra = {}) => { const by = o.meOf?.(t) || null; return { from: 'you', text, at: now(t), ...(by ? { by } : {}), ...extra }; };
  /* the jam built on a change (the team's, when the jam is shared) */
  const jamOf = (t, ch) => (t.work || []).find((w) => w && !w.discarded && (w.changeId === ch.id || (ch.workId && w.id === ch.workId))) || null;
  /* the photos the team added in the jam (feed-service addReference: the jam's refImages, the card's copy): the product shot
     every picture of this change starts from, before the picked or the card's photos. Never a rival's ad (rival-ad.js) */
  const refsOf = (t, ch) => { const c = t.cards.get(ch.cardId) || {}, w = jamOf(t, ch); return [...(w?.refImages || []), ...(c.refImages || [])].filter((u) => typeof u === 'string' && u && !isResearchImage(u)); };
  /* a photo as a file on this instance: a made or uploaded one (gen/) from the gen store, anything else from the brand's photos */
  const readable = async (rel) => { if (/^\/?gen\//.test(rel)) return (await genFile(rel.replace(/^\/?gen\//, '')).catch(() => null)) || null;
    const f = (o.photoAsync ? await o.photoAsync(rel).catch(() => null) : null) || photoFile(rel); try { return f && fs.statSync(f).isFile() ? f : null; } catch { return null; } };
  /* why a photo can't be made right now, said in the chat instead of a silent nothing (genImage returned false) */
  const imageWhy = (ch) => (realOnly(ch) ? `${ch.pkg?.platform || 'This community'} wants real photos, not AI ones: pick one of your product photos or upload one.` : ch.remakePending ? 'A remake is still being made for this draft, so no new photo yet. Ask again once it lands.' : ch.imagePending ? 'A photo is already being made; it lands in a minute.' : isMock() ? 'Photos are off while AI is offline. The words changed; pick one of your product photos if you want a different one.' : !geminiImage ? 'This server can’t make photos. Pick one of your product photos instead.' : 'Today’s photo limit is used up, so the photo stays as it is. Pick one of your product photos, or ask again tomorrow.');
  /* "change the photo" makes a new one; "keep the same photo, change the words only" never does (jam-answer.js photoAsk) */
  const ANSWERED = new WeakSet(); /* changes whose last message was a question: answered, nothing changed, no brief sync */
  // what the card's own moves say, so packages follow the plan they came from
  const movePassages = (c, extra = '', k = 4) => (MOVES ? MOVES.passages(c, k, extra) : []);
  const moveTag = (x) => MOVES?.tag ? MOVES.tag(x.n, x.h) : `Move ${String(x.n).padStart(2, '0')} · ${x.h}`;
  const productLine = (c, extra = '') => { const P = productFor(c, FACTS, extra); return `THE PRODUCT: every public field is about ${P.name} (page ${P.page}${P.price ? `, ${P.price}` : ''}${P.claim ? `; claim: ${P.claim}` : ''}). Stay on this product unless the person asks for another one.`; };
  const pkgWords = (ch) => (ch?.pkg ? [ch.after?.title, ...publicText(ch.family, ch.action, ch.pkg)].filter(Boolean).join('. ') : '');
  const specOf = (key) => ACTION_SPEC[String(key).split('.').pop()] || '';
  const { SEED, AGENT, claudeJSON, cardBrief, seatLine, qaCheck, mechanicalFix, clean, BANNED, isMock, spend, uid, now, clone, inr, on: on0, newWork, addVersion, say, move, notify, later, setState, weekKey, curV, log = console } = o;
  const colName = (id) => SEED.colleagues.find((c) => c.id === id)?.name || 'A colleague';
  /* anything done to a change moves its jam's clock, so every teammate's open jam and studio (jamPoll) picks it up in seconds */
  const bump = (t, ch) => { try { const w = ch && jamOf(t, ch); if (w) w.updatedAt = now(t); } catch {} };
  const on = (m, pat, fn) => on0(m, pat, m === 'GET' || !/:chid/.test(pat) ? fn : async (b, t, p, q) => { try { return await fn(b, t, p, q); } finally { bump(t, changes(t)?.[p?.chid]); } });
  const changes = (t) => (t.changes ||= {});
  const actOf = (key) => { const [a, k] = key.split('.'); return ACTIONS[a]?.[k] ? { agent: a, key, ...ACTIONS[a][k] } : null; };
  const recipeFor = recipeOfCard;
  const cardSnap = (c) => ({ title: c.title, sub: c.sub, rows: c.rows || null, images: c.images || null, q: c.q || null, a: c.a || null, chat: c.chat || null, options: c.options ? c.options.map((x) => x.name) : null });
  const ensureCardVersion = (t, c) => { const vs = versionsOf(t, c.id); if (vs.length) return vs[vs.length - 1]; return addV(t, 'card', c.id, cardSnap(c), { author: `ai:${c.agent}`, reason: 'The original card', at: c.createdAt || now(t) }); };
  // how the after-state renders: the action decides first, then the card's own kind
  const previewOf = (c, act) => {
    if (['numbers', 'checklist', 'script', 'chat', 'answer'].includes(act.preview)) return act.preview === 'answer' || (c.kind === 'answer' && act.agent === 'visibility') ? 'answer' : act.preview;
    if (c.kind === 'answer' && act.agent === 'visibility') return 'answer';
    if (act.preview === 'image') return c.images ? 'image' : PREVIEW_OF_KIND[c.kind] === 'chat' ? 'chat' : 'copy';
    return PREVIEW_OF_KIND[c.kind] && PREVIEW_OF_KIND[c.kind] !== 'levers' ? PREVIEW_OF_KIND[c.kind] : act.preview;
  };

  /* ---------- checks + verdict ---------- */
  const evaluate = (t, ch) => {
    const card = t.cards.get(ch.cardId) || {}; const act = actOf(ch.action); const r = recipeFor(card);
    const pubT = ch.pkg ? publicText(ch.family, ch.action, ch.pkg) : [];
    const copy = { ...card, type: ch.family === 'post' ? 'post' : 'idea', research: null, title: ch.after.title, sub: ch.after.sub, rows: [], detail: { why: [...(ch.after.bullets || []), ...((ch.after.chat || []).map((x) => x[1])), ch.after.a || '', ...pubT].filter(Boolean) } };
    /* a number quoted from the card's own evidence (a real review, a thread's reply count) is backed, not invented */
    /* a connected-account card (live-*) was written from the account's own numbers: they are backed too */
    const evTxt = JSON.stringify([card.post?.evidence || [], card.post?.where || [], card.evidence || [], ...(card.liveOnly || /^live-/.test(card.id || '') ? [card.title, card.sub, card.rows, card.detail, card.liveNums] : [])]).replace(/,(?=\d{3})/g, '');
    const raw = [...new Set(unbackedNums([ch.after.title, ch.after.sub, ...pubT].join(' \n ')))], nums = raw.filter((n) => !evTxt.includes(String(n).replace(/[^\d.%]/g, '').replace(/^\./, '')));
    const qa = qaCheck(copy).filter((x) => x.k !== 'Short title, point first').map((x) => (x.k.startsWith('Every ₹') && nums.length ? { ...x, ok: false, k: `Numbers not in the fact sheet: ${nums.join(', ')} (use a number from the facts or drop it)` } : x.k.startsWith('Every ₹') && !x.ok && raw.length && !nums.length ? { ...x, ok: true, fix: false } : x));
    const checks = qa.map((x) => (x.k === 'Names a number' ? { ...x, soft: true } : { ...x, fix: true }));
    const trust = trustOf(t, act.agent);
    if (ch.pkg) {
      const miss = missing(ch.family, ch.action, ch.pkg); checks.unshift({ k: miss.length ? `Missing: ${miss.join(', ')}` : `${FAMILY_NAME[ch.family]} package complete`, ok: !miss.length, pkg: true, fix: true });
      const guard = ACTION_GUARD[String(ch.action).split('.').pop()]?.(ch.pkg); if (guard) checks.unshift({ k: guard, ok: false, fix: true });
      const lk = leaks(ch.family, ch.action, ch.pkg); checks.splice(1, 0, { k: lk.length ? `Reads like an internal note, not to customers (“${lk.slice(0, 3).join('”, “')}”)` : 'Written for customers, not the team', ok: !lk.length, fix: true, leak: true });
    }
    if (ch.imagePending) checks.push({ k: 'The new creative is still rendering', ok: false, soft: true });
    checks.push(act.irreversible ? { k: `Can’t be undone: ${act.irreversible}. Whoever ships it from the brief should know.`, ok: true, team: true } : { k: `Can be undone: ${act.rollback}`, ok: !!act.rollback && !/^nothing|^—/i.test(act.rollback), soft: true });
    if (act.target.conn) checks.push({ k: `${SEED.connectors[act.target.conn]?.name || act.target.conn} connected`, ok: !!t.conn[act.target.conn], soft: true, conn: act.target.conn });
    if (act.money) checks.push({ k: `${ch.amount > 0 ? `Spends about ${inr(ch.amount)} a week` : 'Costs money'}: the brief carries it, the team that runs it sets the budget`, ok: true, money: true });
    checks.push(...ruleChecks(t, act.agent, ch.after));
    L(t).autoChecks.filter((a) => a.on && (JAM_TPL[act.agent] || []).some(([k]) => k === a.k)).forEach((a) => checks.push({ k: `Learned check: ${a.q}`, ok: true, learned: true, auto: true }));
    const reasons = [];
    if (r.alwaysJam || r.conflict) reasons.push(act.jam || 'A person decides this');
    else if (act.jam) reasons.push(act.jam);
    checks.filter((x) => !x.ok && !x.soft && !x.fix).forEach((x) => reasons.push(x.learned ? `Breaks what you taught: ${x.k.replace(/^Learned: /, '')}` : x.k));
    // fixable package problems (missing fields, internal wording, claims) are fixed in the studio, not in a jam
    ch.fixes = checks.filter((x) => !x.ok && !x.soft && x.fix).map((x) => x.k);
    ch.checks = checks; ch.reasons = [...new Set(reasons)];
    // ships directly only when it can be undone and costs nothing; anything else goes to the ShopOS team with a brief
    ch.irreversible = act.irreversible || null; ch.teamWhy = act.money && act.irreversible ? `${act.irreversible}, and it spends money` : act.money ? 'It spends money' : act.irreversible || null;
    // your own checks: ticked by you, never by the AI
    (ch.myChecks || []).forEach((m) => checks.push({ k: m.text, ok: !!m.done, mine: true, soft: true, id: m.id }));
    ch.confirm = (ch.myChecks || []).filter((m) => !m.done).map((m) => m.text);
    ch.verdict = ch.reasons.length ? 'jam' : ch.fixes.length ? 'fix' : ch.confirm.length ? 'confirm' : ch.teamWhy ? 'deploy' : 'live';
    ch.score = pickScore(t, act.agent, ch);
    return ch;
  };

  /* ---------- making options ---------- */
  const applyRulesMock = (t, agent, a) => {
    // the mock path still honours what the team taught, so the next remix visibly respects it
    const on = new Set(ruleChecks(t, agent, a).filter((x) => x.learned && (!x.soft || x.taste)).map((x) => x.k.replace(/^Learned: /, '')));
    const has = (k) => on.has(DETECTORS.find((d) => d.k === k)?.text);
    const strip = (s) => String(s || '').replace(/(\d+\s*%\s*off|\bflat ₹\d+ off)/gi, '').replace(/\b(discount\w*|sale|cheaper)\b/gi, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
    const x = { ...a };
    if (has('no-discount')) { x.title = strip(x.title); x.sub = strip(x.sub); }
    if (has('no-exclaim')) { x.title = x.title.replace(/!/g, '.').replace(/\.$/, ''); x.sub = String(x.sub).replace(/!/g, '.'); }
    if (has('short-title') && x.title.length > 48) x.title = x.title.slice(0, 46).replace(/\s+\S*$/, '').replace(/[,:;]$/, '');
    if (has('number-first')) {
      // move the clause that carries the number to the front: "MitoActive needs 300 reviews in 90 days" → "300 reviews in 90 days: MitoActive needs them"
      const m = x.title.match(/(up to\s+)?₹?\d[\d,.]*/i);
      if (m && m.index > 3) { const tail = x.title.slice(m.index).replace(/[.]$/, ''), head = x.title.slice(0, m.index).trim().replace(/[,:;]$/, ''); if (tail.split(/\s+/).length >= 3) x.title = `${tail[0].toUpperCase()}${tail.slice(1)}: ${head}`.slice(0, 64); }
    }
    return x;
  };
  // the field each family leads with, so learned rules reshape the right words
  const TITLE_F = { meta_ad: 'headline', store: 'heading', meta_ops: 'summary', crm: 'subject', brief: 'title', decision: 'decision' };
  const SUB_F = { meta_ad: 'primaryText', store: 'body', crm: 'message', decision: 'why', meta_ops: 'rule' };
  const rulePkg = (t, agent, family, pkg) => {
    const tf = TITLE_F[family], sf = SUB_F[family]; if (!tf || !pkg[tf]) return pkg;
    const x = applyRulesMock(t, agent, { title: pkg[tf], sub: pkg[sf] || '' });
    return { ...pkg, [tf]: x.title, ...(sf && pkg[sf] ? { [sf]: x.sub } : {}) };
  };
  const mockOptions = (t, c, r, intent, n = 3, offset = 0) => {
    const why = c.detail?.why || [];
    const angles = [intent || r.intents[0], ...r.intents.filter((x) => x !== intent), 'Sharper', 'Smaller step'];
    const mv = movePassages(c, intent || '', n);
    return Array.from({ length: n }, (_, j) => {
      const i = j + offset; const key = r.actionKeys[i % r.actionKeys.length]; const fam = familyOf(key);
      return { action: key, angle: angles[i % angles.length], from: mv[j] ? moveTag(mv[j]) : null, why: why[i % Math.max(1, why.length)] || '', pkg: mockPkg(fam, key, c, i, angles[i % angles.length], FACTS), fromCard: i === 0 && !!r.primary && key === r.primary };
    });
  };
  const factsLine = `WHO READS WHAT: the card above is an internal note for the ${BN()} team (business numbers, goals, plans, moves). Never copy its wording or its numbers into the package. Fields marked public are read by shoppers and customers: write to them about what they're buying, the product, the result, the price, the offer, in ${BN()}'s voice. No revenue, crore, goals, tracks, funnels, repeat rate, ROAS, cost per order, "the team" or plans. Internal fields (ad sets, segments, rules, budgets) use real operational names, e.g. "Intensive Serum | Broad | 22-45 | Reels", never business metrics. Copy rules: plain words, only numbers from the facts above, "up to" and the day window on every result claim, never name a rival, no before/after scalp claims.`;
  const liveOptions = async (t, c, r, intent, prompt, n = 3, like = null) => {
    const fams = [...new Set(r.actionKeys.map(familyOf))];
    const acts = r.actionKeys.map((k) => { const a = actOf(k); return `- ${k}: ${a.label} on ${SEED.connectors[a.target.conn]?.name || 'a person'} (${a.target.object})${a.money ? ', spends money' : ''}${a.jam ? `, needs a person: ${a.jam}` : ''}. What it is: ${specOf(k)}\n  Package fields:\n${fieldsBrief(familyOf(k), k)}`; }).join('\n');
    const learned = promptBlock(t, c.agent === 'brew' ? 'creative' : c.agent);
    const mv = like ? [] : movePassages(c, [intent, prompt].join(' '));
    const rv = await rivalRead(t, c).catch(() => null), rivalLine = rv ? `\n${rivalBlock(rv.ad, rv.style, BN())}\n` : '';
    const moveBlock = mv.length ? `\nWHAT THE CARD'S MOVES SAY (the Brew plan this card came from). Build the packages from these, using their specifics (steps, wording, timing, examples), and set "from" to the passage each option follows:\n${mv.map((x) => `[${moveTag(x)}] ${x.text}`).join('\n')}\n` : '';
    const rec = `WHAT THE CARD RECOMMENDS: "${c.title}". ${c.sub || ''}${c.cta?.label ? ` The card's action: "${c.cta.label}".` : ''}${c.detail?.why?.length ? `\nWhy: ${c.detail.why.join(' ')}` : ''}${c.detail?.how?.length ? `\nHow: ${c.detail.how.join(' ')}` : ''}${o.planOf?.(t, c)?.draft ? '\nOption 1 starts from the first draft the card shows (above): keep its words and its product wherever they fit the fields.' : ''}`;
    const ask = like ? `Make ONE more option: a different cut of this package (action ${like.action}): ${JSON.stringify(toKV(like.family, like.action, like.pkg))}` : `${rec}\n\nRemix this card into ${n} complete packages that could be commissioned today. ${r.primary ? `Option 1 MUST be exactly what the card recommends, with action ${r.primary}, built from the card's own how-steps and numbers. Options 2 and 3 are different cuts of the same thing the card asks for (another angle, a smaller first step, a different scope), using the same action unless another listed action clearly does the same job. Never propose a different kind of job than the card's.` : 'Every option must serve the goal the card names; do not drift to unrelated levers.'}`;
    const schema = { type: 'object', required: ['line', 'options'], properties: { line: { type: 'string', description: 'Under 18 words: what you made' },
      options: { type: 'array', items: { type: 'object', required: ['action', 'angle', 'why', 'pkg'], properties: { action: { type: 'string', enum: r.actionKeys }, angle: { type: 'string', description: '2-3 words' }, from: { type: 'string', description: 'The move passage it follows, exactly as in the brackets, or empty' }, why: { type: 'string', description: 'Under 16 words: why this moves the number' }, next: { type: 'array', items: { type: 'string' }, description: 'Exactly 4 follow-up asks the person might tap to reshape THIS package, each 2 to 6 words, in their voice, about the card’s own action and case (the products, ads, pages or people it names), never a generic writing tip' }, pkg: kvSchema(allKeys(fams)) } } } } };
    const j = await claudeTool(`${cardBrief(c, seatLine(t.viewer))}\n\nYou are the ${AGENT[c.agent] || 'agent'} agent. ${ask}\n${moveBlock}${rivalLine}What the reader wants: "${[intent, prompt].filter(Boolean).join('. ') || r.intents[0]}".\nActions you may use, with the fields each package needs:\n${acts}\n${learned ? '\n' + learned + '\n' : ''}\n${productLine(c)}\nWrite every package exactly as it ships: real copy, real settings, nothing left as a placeholder. Each package must do what its action says it is, nothing else. ${factsLine}`, schema, 4000, 'remix_options');
    const ok = new Set(r.actionKeys);
    const opts = (j.options || []).slice(0, n).map((x, i) => { const action = ok.has(x.action) ? x.action : r.actionKeys[0]; const src = mv.find((m) => x.from && (x.from.includes(m.h) || moveTag(m) === x.from)); return { action, angle: clean(x.angle || 'Version'), why: clean(x.why || ''), next: Array.isArray(x.next) ? x.next.map((y) => clean(String(y)).replace(/[.]$/, '')).filter((y) => y && y.length <= 48) : null, from: src ? moveTag(src) : null, pkg: fromKV(familyOf(action), action, x.pkg), fromCard: !like && i === 0 && !!r.primary && action === r.primary }; })
      .filter((x) => !BANNED.test(publicText(familyOf(x.action), x.action, x.pkg).join(' ')));
    return { line: clean(j.line || ''), opts };
  };
  // package → the card-sized "after", the money, the checks
  const sync = (t, ch, c) => {
    const act = actOf(ch.action); c ||= t.cards.get(ch.cardId) || {};
    ch.after = afterFromPkg(ch.family, ch.pkg, { images: ['meta_ad', 'social'].includes(ch.family) && c.images && !isRivalCard(c) ? [ch.batchKey ? ch.pkg.image : c.images[0]] : null });
    ch.after.publicText = publicText(ch.family, ch.action, ch.pkg);
    ch.amount = act.money ? amountOf(act, ch.family, ch.pkg) : 0;
    if (act.money) healCost(ch); else ch.costLabel = 'No spend';
    return evaluate(t, ch);
  };
  const snapOf = (ch) => ({ ...ch.pkg, title: ch.after.title, sub: ch.after.sub, action: ch.action, amount: ch.amount });
  const headOf = (t, ch) => (ch.headVersionId && versionsOf(t, ch.id).find((v) => v.id === ch.headVersionId)) || versionsOf(t, ch.id).slice(-1)[0];
  /* the jam follows the studio: its current version, title and picture are the change's head, and its version list mirrors the
     change's (keyed by the change version), so the brief, the handoff, Approve and the board all speak of the version on screen */
  const mirror = (t, ch, v) => { const w = jamOf(t, ch); if (!w || !v) return; const sn = v.snapshot || {};
    const img = sn.image || (sn.draft?.remade ? sn.draft.images?.[0] || sn.draft.poster : null) || null;
    const row = { n: v.n, title: sn.title || w.title, sub: sn.sub || '', images: img ? [img] : null, by: v.author === 'you' ? 'you' : String(v.author || '').startsWith('ai:') ? 'ai' : 'agent', who: String(v.author || '').startsWith('ai:') ? AGENT[ch.agent] : v.author, note: v.reason, at: v.at, changeVersionId: v.id, fromChange: true };
    w.versions ||= []; const i = w.versions.findIndex((x) => x.changeVersionId === v.id), j = i < 0 ? w.versions.findIndex((x) => x.n === v.n && !x.changeVersionId) : -1;
    if (i >= 0) w.versions[i] = { ...w.versions[i], ...row }; else if (j >= 0) w.versions[j] = { ...w.versions[j], ...row }; else w.versions.push(row);
    if (headOf(t, ch)?.id === v.id) { w.current = v.n; if (sn.title) w.title = sn.title; if (img) w.img = img; } w.updatedAt = now(t); };
  const version = (t, ch, author, reason, label) => { const v = addV(t, 'change', ch.id, snapOf(ch), { author, reason, parent: headOf(t, ch)?.id }); v.label = cleanLabel(label) || versionLabel(reason, { first: v.n === 1 }); ch.headVersionId = v.id; try { mirror(t, ch, v); } catch (e) { log.warn('[studio] jam mirror', e.message); } return v; };
  // a version's name in the strip and History: the AI's 2-4 words when it gave them, else the rule-based name
  const cleanLabel = (x) => { const s = String(x || '').replace(/[."“”]/g, '').trim(); const n = s.split(/\s+/).length; return s && n <= 5 && s.length <= 32 ? s[0].toUpperCase() + s.slice(1) : ''; };
  const build = (t, c, cv, r, x, { intent, prompt }) => {
    const act = actOf(x.action); const family = familyOf(x.action);
    const lf = labelFor(x.action, c) || act; /* what this change is called follows the card it came from (a thread of its own, a video's comments) */
    const ch = { id: uid('ch'), fromCard: !!x.fromCard, cardId: c.id, cardVersionId: cv.id, agent: act.agent, cardAgent: c.agent, type: r.type, kind: c.kind, recipe: r.key, action: x.action, actionLabel: lf.label, family, angle: x.angle || 'Version', intent: intent || null, prompt: prompt || '',
      target: { conn: lf.target.conn, name: lf.target.name || (lf.target.conn ? SEED.connectors[lf.target.conn]?.name : 'A person'), object: lf.target.object }, preview: previewOf(c, act), money: !!act.money, rollback: act.rollback,
      scope: act.scope.map(([n, label]) => ({ n, label })), why: x.why || '', from: x.from || null, before: cardSnap(c), state: 'draft', thread: [], createdAt: now(t) };
    ch.pkg = rulePkg(t, act.agent, family, cleanPkg(family, x.action, x.pkg || mockPkg(family, x.action, c, 0, '', FACTS), clean));
    ch.pkg.knobs ||= {}; ch.chips = chipsFor(x.action, c, B()); /* the composer's chips, made once per change so they never flicker */
    { const ctx = chipCtx(x.action, ch.actionLabel, c), nx = (x.next || []).filter((y) => chipRelates(y, ctx)); if (nx.length >= 2) ch.next = nx.slice(0, 4); } /* the AI's chips for this case, when they talk about it */
    ch.myChecks = (L(t).myChecks?.[family] || []).map((m) => ({ id: uid('mc'), text: m.text, done: false, always: true, at: now(t) })); ch.notes = [];
    sync(t, ch, c);
    version(t, ch, `ai:${ch.agent}`, `Remix: ${intent || 'three options'}${prompt ? ` · “${prompt.slice(0, 60)}”` : ''}`);
    changes(t)[ch.id] = ch; return ch;
  };
  /* the card's first draft (drafts-bg.js) is v0 on the jam's stage: exactly the asset the feed card showed, never an
     unrelated picture. Its pictures, slides or clip become the package's own; a text draft (an email, a chat, a page) shows
     as its picture until new words replace it. Jams opened before this heal while they still hold only their first version */
  const TEXT_DRAFT = /^(email|whatsapp|page|text|catalog)$/;
  const seedV0 = (t, c, ch) => {
    if (!ch || !c || ch.batchKey || ch.v0 === 'draft') return false;
    /* the card's background draft may not be ready when the jam opens: 'none' is looked at again on every read while the jam
       still holds only its first version and nobody has said anything (it used to stay 'none' for good) */
    if (ch.v0 === 'none' && (versionsOf(t, ch.id).length > 1 || (ch.thread || []).length || ch.imagePending)) return false;
    ch.v0 = 'none';
    const pl = o.planOf?.(t, c); if (pl && !ch.plan) ch.plan = pl;
    const d = pl?.draft; if (!d || !(d.images?.length || d.video) || versionsOf(t, ch.id).length > 1) return false;
    const imgs = d.images || [], text = TEXT_DRAFT.test(d.as || '') && !d.video;
    ch.pkg = { ...ch.pkg, draft: { as: d.as, images: imgs, video: d.video || null, poster: d.poster || null, ratio: d.ratio || null, title: d.title || '', text } };
    if (!text) { if (imgs[0]) ch.pkg.image = imgs[0]; if (imgs.length > 1) ch.pkg.cardImages = imgs; if (d.video) { ch.pkg.video = d.video; ch.pkg.poster = d.poster || imgs[0] || null; } if (d.ratio && RATIO[d.ratio] && ['meta_ad', 'social'].includes(ch.family)) ch.pkg.format = d.ratio; }
    ch.v0 = 'draft'; sync(t, ch, c);
    const v0 = versionsOf(t, ch.id)[0]; if (v0) { v0.snapshot = snapOf(ch); v0.reason = 'The first draft on the card'; v0.label = 'First draft'; try { mirror(t, ch, v0); } catch {} }
    return true;
  };
  // old changes (made before packages) get one built from their copy
  /* the spend a saved change shows, made again from its package (changes saved before the budget floor came out heal on open) */
  const healCost = (ch) => { const act = actOf(ch.action); if (!act?.money) return; ch.amount = amountOf(act, ch.family, ch.pkg); ch.costLabel = ch.amount > 0 ? `About ${inr(ch.amount)} a week` : ['meta_ad', 'search', 'meta_ops'].includes(ch.family) ? 'A budget to confirm' : 'A one-off cost to confirm'; };
  const ensurePkg = (t, ch) => { if (ch.pkg) { healCost(ch); return ch; } const c = t.cards.get(ch.cardId) || {}; ch.family = familyOf(ch.action); ch.pkg = cleanPkg(ch.family, ch.action, mockPkg(ch.family, ch.action, c, 0, ch.angle, FACTS), clean); ch.pkg.knobs = {}; ch.thread ||= []; return sync(t, ch, c); };
  const pubChange = (t, ch) => {
    ensurePkg(t, ch); const tr = trustOf(t, ch.agent);
    if (ch.v0 !== 'draft' && !ch.batchKey && (ch.fromCard || (t.work || []).some((w) => w.changeId === ch.id))) seedV0(t, t.cards.get(ch.cardId), ch); /* 'none' tries again while the jam is untouched: the card's draft may land after the jam opened */
    const opts = optionsOf(t, ch); /* first: healing an old jam can move its stage */
    const { impact: _imp, packMeta: _pk, ...pub } = ch; /* projections can hold the brand's private account rows: they go out only through /impact, per caller */
    const card0 = t.cards.get(ch.cardId); /* our version of a rival's ad: what Brew read from it, shown in the studio */
    return { ...pub, ...(isRivalCard(card0) && o.rivalSummary ? { rival: o.rivalSummary(t, card0) } : {}), thinking: ch.thinking && Date.now() - ch.thinking.at < 300e3 ? ch.thinking : null, /* what the studio is doing right now, for the waiting person (think()) */ plan: ch.plan || o.planOf?.(t, t.cards.get(ch.cardId)) || null, copyPending: !!ch.copyPending && FILL_JOBS.has(ch.id) /* "Writing…" while the writer is really running, not a clock */, ctaPending: ch.ctaPending && CTA_JOBS.has(ch.id) ? ch.ctaPending : null /* the card's button is making it: the studio says what and keeps polling */, realOnly: realOnly(ch) /* community posts: real photos only, so no AI remakes */, trust: { level: tr.level, name: tr.name, objects: tr.objects, toNext: tr.toNext }, scope: ch.scope.map((s) => ({ ...s, locked: s.n > tr.objects })),
      familyName: FAMILY_NAME[ch.family], fields: fieldsFor(ch.family, ch.action).map(({ k, label, type, opts, cols, req, pub, hint }) => ({ k, label, type, opts, cols, req, pub, hint })),
      knobs: knobsFor(ch.family, B()), suggest: suggestOf(t, ch), gradeF: GRADES[ch.pkg.grade] || 'none', missing: missing(ch.family, ch.action, ch.pkg),
      options: opts /* the cuts as tabs: pick one (Param, 19 Oct) */, head: headOf(t, ch)?.id || null, versions: versionsOf(t, ch.id).map((v) => ({ id: v.id, n: v.n, author: v.author, reason: v.reason, label: v.label || versionLabel(v.reason, { first: v.n === 1 }), at: v.at, parent: v.parentVersionId, diff: v.diff, snapshot: v.snapshot, ...(v.final ? { final: v.final } : {}),
        ...(v.drawing ? { drawing: true } : {}), ...(v.drawError ? { drawError: v.drawError } : {}), ...(v.passed ? { passed: true } : {}), ...(v.asset ? { asset: v.asset } : {}) /* v2 takes: a picture still being made, why it wasn't, a version passed over, the asset that landed */ })), live: ch.liveVersionId || null };
  };

  /* ---------- the studio: iterate, knobs, variations, the creative ---------- */
  // the creative: one photo, or (carousels, slides) one per card. all=false makes the first only; the rest on request
  /* the reference a picture starts from: the photos added in the jam (refsOf), a product photo the team picked, then the card's,
     the lane's and the brand's lead product: the first one that can be read (a store URL that refuses, or a photo only in the
     bucket, no longer ends the picture with ENOENT). A rival's ad is never one (rival-ad.js) */
  const picSrc = async (t, ch, p = ch.pkg || {}) => { const c = t.cards.get(ch.cardId) || {};
    const cands = [...refsOf(t, ch), ...(p.photos || []).filter((u) => !/^gen\//.test(u) && !isResearchImage(u)), cardPhoto(t, c), ...(c.images || []).filter((u) => !/^gen\//.test(u) && !isResearchImage(u)), LANE_PHOTO[c.lane], ...Object.values(LANE_PHOTO || {}), o.catalogOf?.(t)?.[0]?.img].filter((x) => x && typeof x === 'string');
    for (const rel of [...new Set(cands)]) { const f = await readable(rel); if (f) return f; } return null; };
  /* the brief for one picture of package p (slot i of its cards or slides). pic: a rival ad remade (rival-ad.js): our product is
     the only picture the model gets; their ad arrives as its written composition and look, and our words go where theirs sit */
  const picPrompt = (ch, p, i, pic = null, extra = '') => { const rows = p.cards || p.slides || [], scene = p.knobs?.scene;
    const what = ch.family === 'social' ? 'an Instagram post' : ch.family === 'post' ? `a ${p.platform || 'social'} post` : 'a Meta ad';
    const brief = (rows.length ? rows[i]?.imageBrief : p.imageBrief) || p.imageBrief || 'The product on a clean surface, soft daylight.';
    return buildDraft({ kind: 'image', title: what, visual: `${brief}${pic?.visual ? ` ${pic.visual}` : ''}${scene ? ` Scene: ${scene}.` : ''}${p.knobs?.audience ? ` It should feel right for ${p.knobs.audience}.` : ''}${extra}`, ...(pic?.visual ? { refs: [{ ...pic.refs[0], label: `${BN()}'s ${B().config.product?.noun || 'product'}` }] } : {}), ...(pic?.text?.length && i === 0 ? { text: pic.text } : {}), index: rows.length > 1 ? i + 1 : undefined, count: rows.length > 1 ? rows.length : undefined, topSpace: !(pic?.text?.length && i === 0), hasSrc: true, ratio: RATIO[p.format] || '4:5', product: { name: `${BN()} ${B().config.product?.noun || 'product'}` }, brand: { name: BN(), ...(B().config.product || {}), ...(pic?.look ? { style: pic.look } : {}) } }).prompt; }; /* one brief for drafts and finals (sloosh-prompt.js); a remake takes the rival's look */
  const rivalPic = async (t, ch, p) => { const rv = await rivalRead(t, t.cards.get(ch.cardId) || {}).catch(() => null);
    return rv?.style ? rivalPicture(rv.ad, rv.style, { headline: p.overlay || p.headline || p.title || '', sub: String(p.primaryText || '').split(/(?<=[.!?])\s/)[0], button: p.cta }) : null; };
  /* one picture, made once per brief (the same brief again comes from the gen store, free). pay: asked before a new one is made;
     null back when it refuses (the budget) */
  const drawPic = async (src, prompt, format, pic, pay = null, maker = geminiImage) => { const key = crypto.createHash('sha1').update(prompt + (format || '4:5')).digest('hex').slice(0, 16);
    if (!(await genFile(`${key}.png`))) { if (pay && !pay()) return null; const buf = await maker({ srcFile: src, prompt, ratio: RATIO[format] || '4:5' });
      if (pic && buf?.guard?.genFailed) throw new Error('the remake did not keep your product as photographed; ask for it again'); /* a plain product photo is not our version of their ad */ saveGen(`${key}.png`, buf); }
    return `gen/${key}.png`; };
  /* never on top of a remake or another photo still being made; community posts take real photos only */
  const canPic = (ch) => ['meta_ad', 'social', 'post'].includes(ch.family) && !realOnly(ch) && !isMock() && !!geminiImage && !ch.remakePending && !ch.imagePending;
  /* target: the version the photo belongs to (the words version a chat ask just made, the first version while its copy is
     written). It lands on that version, never a second one; if the head moved on meanwhile it lands on the head as "Photo
     added", so nothing made is lost. No target: the photo is a new version, as before */
  const genImage = (t, ch, why, { all = false, target = null } = {}) => {
    if (!canPic(ch)) return false;
    const p = ch.pkg; const rows = p.cards || p.slides || [];
    const slots = rows.length ? rows.map((_, i) => i).filter((i) => (all ? !(p.cardImages || [])[i] : i === 0)).slice(0, 10) : [0];
    if (!slots.length) return false;
    if (!spend('image')) return false;
    ch.imagePending = true; ch.imageError = null; IMG_JOBS.add(ch.id);
    (async () => {
      try {
        const src = await picSrc(t, ch, p); if (!src) throw new Error('no product photo could be read for this picture');
        const pic = await rivalPic(t, ch, p);
        const one = (i) => drawPic(src, picPrompt(ch, p, i, pic), p.format, pic, i !== slots[0] ? () => spend('image') : null);
        const made = [];
        for (let k = 0; k < slots.length; k += 3) made.push(...(await Promise.all(slots.slice(k, k + 3).map((i) => one(i).catch((e) => { log.warn('[studio image]', e.message); return null; })))));
        const imgs = [...(ch.pkg.cardImages || [])]; slots.forEach((i, k) => { if (made[k]) imgs[i] = made[k]; });
        const first = rows.length ? imgs[0] : made[0];
        if (!first && !made.some(Boolean)) throw new Error('no image came back');
        const media = { ...(first ? { image: first } : {}), ...(rows.length ? { cardImages: imgs } : {}) };
        ch.pkg = { ...ch.pkg, ...media }; ch.imagePending = false; sync(t, ch);
        const tv = target ? versionsOf(t, ch.id).find((x) => x.id === target) : null; let v;
        if (tv) { tv.snapshot = { ...tv.snapshot, ...media }; v = tv; if (headOf(t, ch)?.id === tv.id) { try { mirror(t, ch, tv); } catch {} } else v = version(t, ch, `ai:${ch.agent}`, `Photo added: ${why}`, 'Photo added'); }
        else v = version(t, ch, `ai:${ch.agent}`, all && rows.length ? `Photos for ${made.filter(Boolean).length} ${ch.family === 'social' ? 'slides' : 'cards'}` : `New creative: ${why}`);
        try { o.onMedia?.(t, ch, { kind: 'image', images: (rows.length ? imgs : [first]).filter(Boolean), n: v.n, label: v.label }); } catch {} /* every new asset goes where the jam is (Slack) */
      } catch (e) { ch.imagePending = false; ch.imageError = String(e.message).slice(0, 160); log.warn('[studio image]', e.message); sync(t, ch); }
      finally { IMG_JOBS.delete(ch.id); bump(t, ch); o.save?.(t); }
    })();
    return true;
  };
  /* a marketplace listing's photo set (testing notes 18 Oct: "Add photos" returned a written shot list, no photos). One photo
     per shot in the listing's image plan (pkg.images: "1. Main packshot on white, 2. Serum close-up…"), up to 4, each made
     from the real product photo, square, the first on pure white as marketplaces ask. They land as one new version
     (pkg.photoSet: [{ shot, image }]); the shot list stays as the brief's words */
  const shotsOf = (p = {}) => { const raw = String(p.images || '').trim();
    const xs = raw ? raw.split(/\n+|(?:^|\s)\d+[.)]\s+|;\s*|\s*•\s*/).map((x) => clean(x).replace(/^[-–,.\s]+|[,.\s]+$/g, '')).filter((x) => x.length > 3) : [];
    return (xs.length >= 2 ? xs : ['Main packshot on a pure white background', 'Close-up of the product and its label', 'The product in use']).slice(0, 4); }; /* one line is a rule for the set, not a shot list */
  const shotRule = (p = {}) => { const raw = clean(String(p.images || '')).trim(); return raw && shotsOf(p).every((x) => !raw.includes(x)) ? raw.slice(0, 200) : ''; };
  const genListingPhotos = (t, ch, why) => {
    if (ch.family !== 'listing' || isMock() || !geminiImage || ch.imagePending) return false;
    if (!spend('image')) return false;
    const shots = shotsOf(ch.pkg), product = ch.pkg.product || ch.pkg.name || `${BN()} ${B().config.product?.noun || 'product'}`;
    ch.imagePending = true; ch.imageError = null; IMG_JOBS.add(ch.id); ch.pkg = { ...ch.pkg, photoShots: shots };
    (async () => {
      try {
        const src = await picSrc(t, ch); if (!src) throw new Error('no product photo could be read for the listing photos');
        const made = [];
        for (const [i, shot] of shots.entries()) {
          const prompt = `A marketplace listing photo (Amazon, Flipkart) of ${product} by ${BN()}. Shot: ${shot}. ${i === 0 ? 'Pure white background (RGB 255,255,255), the product centred and filling about 85% of the frame, soft even studio light, no props.' : 'Clean, bright, photographic, the product the hero of the frame.'} Keep the product, its pack and its label exactly as in the reference photo; never invent new words on the pack and add no other text, badges or logos. Square 1:1.${shotRule(ch.pkg) ? ` The team’s rule for the set: ${shotRule(ch.pkg)}.` : ''}`;
          const img = await drawPic(src, prompt, '1:1', null, i ? () => spend('image') : null).catch((e) => { log.warn('[listing photo]', e.message); return undefined; });
          if (img === null) break; if (img) made.push({ shot, image: img });
        }
        if (!made.length) throw new Error('no photo came back');
        ch.pkg = { ...ch.pkg, photoSet: made, image: made[0].image }; ch.imagePending = false; sync(t, ch);
        const v = version(t, ch, `ai:${ch.agent}`, `Listing photos: ${why}`, `${made.length} listing photos`);
        ch.thread.push({ from: 'ai', text: `Made ${made.length} listing photo${made.length > 1 ? 's' : ''}: ${made.map((x) => x.shot).join('; ')}.${made.length < shots.length ? ` ${shots.length - made.length} didn’t come through (today’s photo limit, or the picture failed); ask again for the rest.` : ''} They’re ready for the marketplaces.`, at: now(t), v: v.n });
        try { o.onMedia?.(t, ch, { kind: 'image', images: made.map((x) => x.image), n: v.n, label: v.label }); } catch {}
      } catch (e) { ch.imagePending = false; ch.imageError = String(e.message).slice(0, 160); log.warn('[listing photos]', e.message); ch.thread.push({ from: 'ai', text: `The listing photos didn’t come through (${ch.imageError}). Tap Make the photos to try again.`, at: now(t) }); sync(t, ch); }
      finally { IMG_JOBS.delete(ch.id); bump(t, ch); o.save?.(t); }
    })();
    return true;
  };
  /* each cut its own photo (More like this, "three cuts", the plan's make step): one picture per version from that cut's own
     brief and headline, within today's photo budget (it stops at the limit and says how many got one). The cut on the stage
     changes with it; the chat shows the cuts as a strip to tap */
  const cutPhotos = (t, ch, vs, one = false) => {
    if (!canPic(ch) || isVideoPost(ch) || vs.length < (one ? 1 : 2)) return 0;
    if (!spend('image')) return 0;
    ch.imagePending = true; ch.imageError = null; IMG_JOBS.add(ch.id);
    (async () => {
      let done = 0, stopped = false;
      try {
        const src = await picSrc(t, ch); if (!src) throw new Error('no product photo could be read for these photos');
        for (const [k, v] of vs.entries()) {
          const pv = pkgOfVersion(t, ch, v), pic = await rivalPic(t, ch, pv), head = pv.headline || pv.title || pv.heading || v.snapshot?.title || '';
          const img = await drawPic(src, picPrompt(ch, pv, 0, pic, head ? ` The photo goes with the headline “${String(head).slice(0, 120)}”.` : ''), pv.format, pic, k ? () => spend('image') : null).catch((e) => { log.warn('[cut photo]', e.message); return undefined; });
          if (img === null) { stopped = true; break; } if (!img) continue;
          const media = { image: img, ...((pv.cards || pv.slides || []).length ? { cardImages: [img, ...(pv.cardImages || []).slice(1)] } : {}) };
          landMedia(t, ch, v, media); sync(t, ch); done++; /* its own option; the stage only when it is that cut or grew from it */
        }
        if (!done) throw new Error('no photo came back for the cuts');
        ch.thread.push({ from: 'ai', text: `Each cut has its own photo now${done < vs.length ? ` (${done} of ${vs.length}: ${stopped ? 'today’s photo limit is used up' : 'the rest didn’t come through'})` : ''}. Tap one to put it on the stage.`, at: now(t), vs: vs.map((v) => v.id), cuts: true });
        try { o.onMedia?.(t, ch, { kind: 'image', images: vs.map((v) => v.snapshot?.image).filter(Boolean), n: headOf(t, ch)?.n, label: `${done} cuts` }); } catch {}
      } catch (e) { ch.imageError = String(e.message).slice(0, 160); log.warn('[cut photos]', e.message); }
      finally { ch.imagePending = false; IMG_JOBS.delete(ch.id); sync(t, ch); bump(t, ch); o.save?.(t); }
    })();
    return vs.length;
  };

  /* ---------- the short video itself: a first frame of the real product (Gemini, 9:16), animated for 6 seconds by Veo on our
     Vertex account, with the hook line read over it. The script alone is not a video: "Make the short video" makes one.
     It lands on the version it was made for (patched into that version, no new version), within DAILY_VIDEO_CAP. ---------- */
  const isVideoPost = (ch) => ch.family === 'post' && /short_video$/.test(String(ch.action || ''));
  const hookOf = (p = {}) => clean(String((p.script || [])[0]?.line || p.title || String(p.copy || '').split('\n')[0] || '')).split(/\s+/).slice(0, 14).join(' ');
  let MK = null; const makers = () => (MK ||= o.makers || createMakers({ geminiImage, log }));
  const VID_JOBS = new Set();
  const srcPhoto = async (t, ch, lead = null) => { const c = t.cards.get(ch.cardId) || {}, p = ch.pkg || {};
    const cands = [...refsOf(t, ch), ...(p.photos || []).filter((u) => !/^gen\//.test(u) && !isResearchImage(u)), lead, cardPhoto(t, c), ...(isRivalCard(c) ? [] : c.images || []).filter((u) => !/^gen\//.test(u) && !/statics\//.test(u) && !isResearchImage(u)), LANE_PHOTO[c.lane], ...Object.values(LANE_PHOTO || {}), o.catalogOf?.(t)?.[0]?.img].filter((x) => x && typeof x === 'string'); /* the jam's own photos first */
    for (const rel of [...new Set(cands)]) { const f = await readable(rel); if (f) return f; }
    return null; };
  const genVideo = (t, ch, why = 'the script') => {
    if (!isVideoPost(ch) || (isMock() && !o.mediaFake) || !geminiImage || ch.videoPending) return false;
    if (!spend('video')) return false;
    const target = headOf(t, ch)?.id || null, p = { ...ch.pkg }, sc = p.script || [], hook = hookOf(p);
    ch.videoPending = Date.now(); ch.videoError = null; ch.videoStep = 'Making the first frame'; VID_JOBS.add(ch.id);
    (async () => {
      try {
        const M = makers();
        /* the first frame: a photo already made for this post, else a new 9:16 one of the real product */
        let frame = /^gen\//.test(p.image || '') && (await genFile(p.image.slice(4))) ? p.image.slice(4) : null;
        if (!frame) {
          const src = await srcPhoto(t, ch); if (!src) throw new Error('no product photo could be read for the first frame');
          /* our version of a rival's video ad: its first frame's composition and look, in words, with our product */
          const rvV = await rivalRead(t, t.cards.get(ch.cardId) || {}).catch(() => null);
          const shot = sc[0]?.shot || p.imageBrief || String(p.media || '').replace(/https?:\/\/\S+/g, '').slice(0, 400) || 'The product on a clean surface, soft daylight.';
          const prompt = `Create the opening frame of a vertical 9:16 ${p.platform || 'short'} video for ${BN()}. ${shot} Keep the ${BN()} ${B().config.product?.noun || 'product'} and its label exactly as in the reference photo; do not invent new text on the pack. Nothing else carries writing: no signs, notes, screens or other packaging. No before/after. Photographic, natural light, the product clearly in frame.${rvV?.style ? ` ${rivalPicture(rvV.ad, rvV.style).visual}` : ''}`;
          const key = crypto.createHash('sha1').update(prompt + '9:16').digest('hex').slice(0, 16) + '.png';
          if (!(await genFile(key))) saveGen(key, await (o.videoImage || geminiImage)({ srcFile: src, prompt, ratio: '9:16' }));
          frame = key;
        }
        ch.videoStep = 'Animating it, about a minute';
        const motion = clean(sc.slice(0, 3).map((x) => x.shot).filter(Boolean).join(' Then ')).slice(0, 360) || 'The camera slowly pushes in on the product.';
        let name = await M.video(frame, `Over 6 seconds: ${motion}`, { ratio: '9:16', onStep: (s) => { ch.videoStep = s; } });
        let voiced = false;
        if (hook && spend('voice')) { ch.videoStep = 'Adding the voiceover';
          const au = await M.voice(hook, 'warm and natural, like a creator talking to camera', 'Kore').catch((e) => { log.warn('[short video voice]', e.message); return null; });
          const both = au ? await M.mux(name, au).catch((e) => { log.warn('[short video mux]', e.message); return null; }) : null; if (both) { name = both; voiced = true; } }
        const media = { video: 'gen/' + name, poster: 'gen/' + frame, image: 'gen/' + frame, videoHook: hook };
        const v = versionsOf(t, ch.id).find((x) => x.id === target); if (v) v.snapshot = { ...v.snapshot, ...media };
        /* the clip lands in the option it was made for (Param, 19 Oct: no more "Video added" versions): on the stage when the stage
           is that version or grew from it, else only in that option, which the tabs show; nothing is laid on another option's script */
        const vName = v ? optionName(t, ch, v) : '', place = landMedia(t, ch, v, media); ch.videoPending = null; ch.videoStep = null; sync(t, ch);
        try { o.onMedia?.(t, ch, { kind: 'video', video: media.video, images: [media.poster], n: (place.at || v)?.n, label: 'Short video' }); } catch {}
        ch.thread.push({ from: 'ai', text: `The video${vName ? ` for ${vName}` : ''} is ready: 6 seconds, vertical${voiced ? ', with the hook read over it' : ''}.${!place.onStage && vName ? ` Tap ${vName} above the phone to see it.` : ''}`, at: now(t) });
        o.save?.(t);
      } catch (e) { ch.videoPending = null; ch.videoStep = null; ch.videoError = `The video didn’t come through (${String(e.message).slice(0, 120)}). Make it again.`; log.warn('[short video]', why, e.message); sync(t, ch); o.save?.(t); }
      finally { VID_JOBS.delete(ch.id); bump(t, ch); }
    })();
    return true;
  };
  const videoWhy = (ch) => (!isVideoPost(ch) ? 'Only a short video post makes a clip.' : ch.videoPending ? 'The video is already being made.' : isMock() ? 'Videos are off while AI is offline.' : 'The video limit for today is used up.');

  // studio chips: the AI's next steps for this version, else the family's defaults minus what was already asked
  const suggestOf = (t, ch) => { const asked = new Set((ch.thread || []).filter((m) => m.from === 'you').map((m) => String(m.text).toLowerCase().trim()));
    ch.chips ||= chipsFor(ch.action, t.cards.get(ch.cardId) || {}, B()); /* older changes: worked out once from the action, then kept */
    const pool = [...(ch.next || []), ...ch.chips, ...(ch.chips.length >= 3 ? [] : suggestFor(ch.family, B()))]; return pool.filter((x, i) => !asked.has(x.toLowerCase()) && pool.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).slice(0, 4); };
  /* a question about the package: one small grounded answer (the card, the package, the moves, the facts, the connected
     numbers), no package rewrite and no version. The answer is checked: a number or a performance claim the evidence
     doesn't hold is cut, and it says what isn't known */
  const answerIn = async (t, ch, message, show) => {
    const c = t.cards.get(ch.cardId) || {};
    ch.thread.push(youSaid(t, show || message)); ANSWERED.add(ch);
    if (EVIDENCE_ASK.test(message) && o.evidenceOf) { const pa = proofAnswer(o.evidenceOf(t, c)); if (pa) { ch.thread.push({ from: 'ai', text: pa.text, proof: pa.proof, cardId: c.id, at: now(t), answer: true }); return ch; } }
    if (isMock() || !spend('text')) { ch.thread.push({ from: 'ai', text: 'AI is offline right now, so I can’t answer that. Nothing changed.', at: now(t), offline: true, answer: true }); return ch; }
    const pf = o.evidenceOf ? proofAnswer(o.evidenceOf(t, c)) : null; /* every answer can name where a number came from */
    const acct = realRows(t.liveLedger).filter((e) => e.label && e.v != null).slice(0, 24); // DUMMY: simulated accounts are never quoted
    const evidence = [cardBrief(c, seatLine(t.viewer)), `The package (${ch.actionLabel} on ${ch.target.name}):\n${toKV(ch.family, ch.action, ch.pkg).map((e) => `${e.k}: ${e.v}`).join('\n')}`,
      movePassages(c, message, 3).map((x) => `${moveTag(x)}: ${x.text || x.t || ''}`).join('\n'),
      pf ? `Where the card's numbers come from:\n${pf.text}` : '',
      acct.length ? `Connected accounts, read ${acct[0].at || 'today'}:\n${acct.map((e) => `- ${e.label}: ${e.v}`).join('\n')}` : 'Connected accounts: none with results for this yet.'].filter(Boolean).join('\n\n');
    try {
      const r = await answerGrounded({ ai: (p, sc, mx, tag) => claudeTool(p, sc, mx, tag), question: message, evidence, history: ch.thread.slice(-7, -1).map((m) => `${m.from === 'you' ? 'Person' : 'Brew'}: ${m.text}`), who: `the ${AGENT[ch.agent] || 'Brew'} agent` });
      ch.thread.push({ from: 'ai', text: clean(r.answer), at: now(t), answer: true, ...(r.known ? {} : { unknown: true }) });
    } catch (e) { log.warn('[studio answer]', e.message); ch.thread.push({ from: 'ai', text: 'That didn’t go through, so nothing changed. Ask again in a minute.', at: now(t), answer: true }); }
    return ch;
  };
  /* what the studio is doing while a reply takes its time (a minute on Flash): the waiting person sees the step and the clock
     (app.js polls the change while it waits), never a bare spinner */
  const think = (ch, step) => { ch.thinking = step ? { step, at: ch.thinking?.at || Date.now(), stepAt: Date.now() } : null; };
  const iterate = async (t, ch, message, { knob, quiet, show } = {}) => {
    const c = t.cards.get(ch.cardId) || {};
    ANSWERED.delete(ch);
    if (!knob && !quiet && (isQuestion(message) || EVIDENCE_ASK.test(message))) { think(ch, 'Looking it up in the facts, the moves and this version'); try { return await answerIn(t, ch, message, show); } finally { think(ch, null); } } /* a question never makes a version */
    const keepPhoto = photoAsk(message) === 'keep';
    if (!quiet) ch.thread.push(youSaid(t, show || message));
    let out = null, nv = null;
    if (!isMock() && spend('text')) {
      try {
        think(ch, quiet ? 'Fixing what the check flagged' : `Reading your note, the current version and the fact sheet, then writing v${versionsOf(t, ch.id).length + 1}`);
        const schema = { type: 'object', required: ['reply', 'pkg', 'newImage', 'next'], properties: { plan: { type: 'array', items: { type: 'string' }, description: 'Only when the person asks to change the plan itself (its steps): the whole updated list of steps, 3 to 6, each under 14 words, ending with the step that makes it ready to deploy or hand to the team; never a step called decided. Otherwise an empty list.' }, reply: { type: 'string', description: 'Under 30 words: what you changed, plainly' }, label: { type: 'string', description: 'A name for this new version in a version list: 2 to 4 words, sentence case, what is different about it (e.g. "As a thread", "Shorter hook", "Price up front"). Not the request repeated.' }, next: { type: 'array', items: { type: 'string' }, description: 'Exactly 4 follow-up requests the person might tap next, each 2 to 6 words, in their voice (e.g. "Shorter, for WhatsApp"). Each one a way to cut THIS change (the card’s own action, named in the prompt), using its words: never a generic writing tip that would fit any widget. Specific to this updated package and this conversation; never repeat something already asked or already true of the package.' }, pkg: kvSchema(allKeys([ch.family])), newImage: { type: 'boolean', description: 'True only if the photo itself should change (scene, mood, subject, ratio)' } } };
        const rvI = await rivalRead(t, c).catch(() => null); /* our version of a rival's ad keeps that ad as the reference through every edit */
        out = await claudeTool(`${cardBrief(c, seatLine(t.viewer))}${rvI ? `\n\n${rivalBlock(rvI.ad, rvI.style, BN())}\nKeep following that ad's angle, hook pattern and style unless the team asks to move away from it.` : ''}\n\nYou are the ${AGENT[ch.agent]} agent in the remix studio, iterating a ${FAMILY_NAME[ch.family]} (${ch.actionLabel} on ${ch.target.name}).${c.cta?.label ? ` The card's own action: "${c.cta.label}"; this package is that action and nothing else.` : ''}\n${promptBlock(t, ch.agent === 'brew' ? 'creative' : ch.agent)}\nIt must stay commission-ready and stay exactly this kind of change: ${specOf(ch.action)}\n${productLine(c)}\nFields:\n${fieldsBrief(ch.family, ch.action)}\nCurrent package (field: value):\n${toKV(ch.family, ch.action, ch.pkg).map((e) => `${e.k}: ${e.v}`).join('\n')}\nKnobs set: ${JSON.stringify(ch.pkg.knobs || {})}\nThe conversation so far:\n${ch.thread.slice(-7, -1).map((m) => `${m.from === 'you' ? 'Person' : 'You'}: ${m.text}`).join('\n') || '(none)'}\n${ch.agent === 'brew' ? promptBlock(t, ch.agent) : '' /* the agent's rules are already above; only the brew agent has a second set */}${(ch.notes || []).length ? `\nThe person's notes on this package (respect them):\n${ch.notes.map((n) => `- ${n.text}`).join('\n')}` : ''}\n\nThe person now asks: "${message}"\nReturn the WHOLE updated package (every field, changed or not). ${factsLine}`, schema, 3000, 'studio_iterate');
      } catch (e) { log.warn('[studio iterate]', e.message); }
    }
    think(ch, out ? 'Checking the words against the facts and the product' : null);
    const before = { ...ch.after };
    if (Array.isArray(out?.plan) && out.plan.length >= 3) { const pl = withSteps(ch.plan || o.planOf?.(t, c), out.plan.map((x) => clean(String(x)))); if (pl) { ch.plan = pl; const w = (t.work || []).find((x) => x.changeId === ch.id); if (w) w.cardPlan = { ...pl, made: w.cardPlan?.made || null }; } } /* the plan, refined in the chat */
    if (out?.pkg) {
      const snapIn = JSON.stringify(snapOf(ch));
      ch.pkg = { ...ch.pkg, ...cleanPkg(ch.family, ch.action, fromKV(ch.family, ch.action, out.pkg), clean), ...keepMedia(ch.pkg) };
      if (BANNED.test(publicText(ch.family, ch.action, ch.pkg).join(' '))) ch.pkg = rulePkg(t, ch.agent, ch.family, ch.pkg);
      sync(t, ch, c);
      /* a version only when the package really changed: the same words back (a question the router missed) is no new version */
      const same = JSON.stringify(snapOf(ch)) === snapIn;
      if (!same) { const v = version(t, ch, `ai:${ch.agent}`, message.slice(0, 90), out.label); nv = v; if (!quiet) try { o.onVersion?.(t, ch, v, message); } catch {} } /* e.g. the jam's Slack thread */
      else ANSWERED.add(ch);
      if (!quiet) ch.thread.push({ from: 'ai', text: clean(out.reply || (same ? 'Nothing needed changing.' : 'Updated.')), at: now(t), ...(same ? {} : { v: versionsOf(t, ch.id).length }) });
      // the chips follow the conversation: what to try next on this version
      if (Array.isArray(out.next)) { const ctx = chipCtx(ch.action, ch.actionLabel, c); const nx = out.next.map((x) => clean(String(x)).replace(/[.]$/, '')).filter((x) => x && x.length <= 48 && chipRelates(x, ctx)); if (nx.length >= 2) ch.next = nx.slice(0, 4); } /* only chips about this change's action */
      /* "keep the photo" never starts a paid one. The photo lands on the words version just made (target), never a second
         "New creative" version; when it can't start (the limit, a remake or a photo still being made) the chat says why,
         so the reply above never stands as a promise of a photo that isn't coming */
      if (!keepPhoto && (out.newImage || knob?.kind === 'image')) { const started = genImage(t, ch, message, nv ? { target: nv.id } : {}); if (!started && !quiet) ch.thread.push({ from: 'ai', text: imageWhy(ch), at: now(t), photoWhy: true }); }
    } else {
      // offline: apply what can be applied without AI, and say so
      /* a new version only when something really changed (a setting applied without AI); a failed rewrite adds no "Not rewritten" version */
      const snap0 = JSON.stringify(snapOf(ch));
      if (knob?.kind === 'image' && knob.k === 'format') ch.pkg.format = knob.v;
      sync(t, ch, c); const changed = JSON.stringify(snapOf(ch)) !== snap0; if (changed) version(t, ch, 'system', `${message} (AI offline)`);
      if (!quiet) ch.thread.push({ from: 'ai', text: changed ? 'AI is offline right now, so I saved your setting but could not rewrite the package. Edit the fields directly, or try again.' : 'AI is offline right now, so nothing changed. Edit the fields directly, or try again later.', at: now(t), offline: true });
    }
    signal(t, 'edit', { before, after: ch.after, agent: ch.agent, changeId: ch.id, by: 'ai-asked' }, now(t));
    return ch;
  };
  const learnedOut = (t) => takeNew(t);

  /* ---------- jam plan ---------- */
  const qOf = (t, k, q, owner) => { const ac = autoCheck(t, k); return { id: uid('q'), k, q, owner, answer: ac ? ac.answer : null, by: ac ? 'learned' : null, auto: !!ac, at: ac ? now(t) : null, asked: false }; };
  const makePlan = (t, c, ch) => {
    const agent = ch?.agent || (JAM_TPL[c.agent] ? c.agent : 'creative');
    const qs = [];
    (ch?.fixes || []).forEach((r) => qs.push(qOf(t, 'fix:' + slug(r), `Still to fix: ${r}. How do we want it?`, 'ai')));
    (ch?.reasons || []).forEach((r) => qs.push(qOf(t, 'why:' + slug(r), `${r}. What’s the plan?`, ch.verdict === 'jam' && /shoot|brief|person/i.test(r) ? 'brew' : 'growth')));
    if (ch?.money) qs.push(qOf(t, 'budget_ok', `${ch.amount > 0 ? `It spends about ${inr(ch.amount)} a week` : 'It costs money'}. Who signs off?`, 'growth'));
    (JAM_TPL[c.kind === 'conflict' ? 'brew' : agent] || []).forEach(([k, q, owner]) => qs.push(qOf(t, k, q, owner)));
    return { goal: ch ? `${ch.actionLabel}: ${ch.after.title}` : c.title, changeId: ch?.id || null, agent, questions: qs, createdAt: now(t) };
  };
  const planReady = (p) => p && p.questions.every((q) => q.answer);
  const planSnap = (p) => ({ goal: p.goal, questions: p.questions.map((q) => ({ q: q.q, answer: q.answer, by: q.by })) });
  // answers a simulated teammate or the old scripted "ShopOS team" gave are not answers: they reopen (saved jams heal here)
  const simulatedBy = (by) => /^teammate:/.test(by || '') || by === 'brew';
  const healPlan = (w) => { for (const q of w.plan?.questions || []) if (q.answer && simulatedBy(q.by)) { q.answer = null; q.by = null; q.asked = false; } };
  const ensurePlan = (t, w) => {
    if (w.plan) healPlan(w);
    if (w.plan || w.auto) return w.plan || null;
    const c = t.cards.get(w.cardId) || { title: w.title, agent: w.agent, kind: null };
    w.plan = makePlan(t, c, w.changeId ? changes(t)[w.changeId] : null);
    if (!['drafting', 'team', 'brew', 'needs_you'].includes(w.stage)) w.plan.questions.forEach((q) => { q.answer ||= 'Settled before this was tracked.'; q.by ||= 'earlier'; });
    addV(t, 'jam', w.id, planSnap(w.plan), { author: 'system', reason: 'Jam opened' });
    return w.plan;
  };
  const answerQ = (t, w, q, answer, by) => {
    q.answer = String(answer).slice(0, 400); q.by = by; q.at = now(t); q.asked = false;
    addV(t, 'jam', w.id, planSnap(w.plan), { author: by, reason: `Answered: ${q.q}` });
    const ac = answered(t, q, q.answer, by);
    if (planReady(w.plan)) notify(t, w, `Jam on “${w.title}” is ready to share. Every question has an answer.`, 'ready');
    return ac;
  };
  // jam answers are written live, grounded in the card, the package and the facts; the canned table is only for offline
  const jamContext = (t, w) => { const c = t.cards.get(w.cardId) || {}; const ch = w.changeId && changes(t)[w.changeId]; return { c, ch, brief: `${cardBrief({ ...c, ...curV(w), agent: w.agent }, seatLine(t.viewer))}${ch ? `\n\nThe package being planned (${ch.actionLabel} on ${ch.target.name}):\n${JSON.stringify({ ...ch.pkg, knobs: undefined })}` : ''}\nOther answers so far: ${(w.plan?.questions || []).filter((x) => x.answer).map((x) => `${x.q} → ${x.answer}`).join(' | ') || 'none'}` }; };
  const liveAnswer = async (t, w, q, persona) => {
    if (isMock() || !spend('text')) return null;
    try {
      const { brief } = jamContext(t, w);
      const j = await claudeTool(`${brief}\n\n${promptBlock(t, w.agent === 'brew' ? 'creative' : w.agent)}\nYou are ${persona} in a planning jam at ${BN()}. Suggest an answer to this open question, specific to this package (names, numbers from the facts, dates). It is a suggestion for the team to confirm: never say anything was checked, verified, approved, cleared or done, and name what someone has to confirm.\nQuestion: "${q.q}"`, { type: 'object', required: ['answer'], properties: { answer: { type: 'string', description: 'Under 40 words, lead with the suggestion' } } }, 600, 'jam_answer');
      return j.answer ? clean(j.answer) : null;
    } catch (e) { log.warn('[jam answer]', e.message); return null; }
  };
  const aiAnswer = async (t, w, q) => {
    const a = await liveAnswer(t, w, q, `the ${AGENT[w.agent] || 'AI'} agent`); if (a) return `Suggested: ${a}`;
    const c = t.cards.get(w.cardId) || {};
    if (q.k === 'moves' && c.affects?.length) return `It changes: ${c.affects.join(', ')}.`;
    return null; // no canned answer: the question stays open for the team
  };


  /* ---------- a change package becomes the jam's work item ---------- */
  const workFromChange = (t, ch, stage = 'drafting') => {
    const c = t.cards.get(ch.cardId); const w = newWork(t, c);
    w.changeId = ch.id; w.agent = ch.agent; w.cta = ch.actionLabel;
    const vs = versionsOf(t, ch.id), head = headOf(t, ch);
    w.versions = vs.map((v) => ({ n: v.n, title: v.snapshot?.title || ch.after.title, sub: v.snapshot?.sub || ch.after.sub, images: v.snapshot?.image ? [v.snapshot.image] : ch.after.images, by: v.author === 'you' ? 'you' : v.author?.startsWith('ai:') ? 'ai' : v.author === 'deploy-team' ? 'brew' : 'agent', who: v.author?.startsWith('ai:') ? AGENT[ch.agent] : v.author, note: v.reason, at: v.at, changeVersionId: v.id }));
    w.current = head?.n || w.versions.length; w.title = ch.after.title; if (ch.pkg?.image) w.img = ch.pkg.image;
    w.plan = null; ch.workId = w.id; w.chg = brief(ch);
    // measured where the change lands, not where the idea came from (a Meta change from a scoreboard is read on Meta)
    w.measureSector = (ch.family === 'listing' ? 'catalog' : SECTOR_OF[ch.agent]) || null; if (w.measureSector) w.sector = w.measureSector;
    if (stage !== 'drafting') move(t, w, stage, null);
    return w;
  };
  const brief = (ch) => ({ id: ch.id, team: !!(ch.money || ch.irreversible), teamWhy: ch.teamWhy || null, costLabel: ch.costLabel || null, actionLabel: ch.actionLabel, target: `${ch.target.name}${ch.target.conn ? ' · ' + ch.target.object : ''}`, money: ch.money, amount: ch.amount, scope: ch.scope.map((s) => ({ n: s.n, label: s.label })) });
  // the brief the ShopOS team works from: what, where, exactly what ships, what it costs, what can't be undone, who agreed
  // everything the team needs to act without asking: files, references, links, copy to paste, and what is still to be made
  const assetsFor = (t, ch) => {
    const c = t.cards.get(ch.cardId) || {}, p = ch.pkg || {}, out = [], d = p.draft?.remade ? p.draft : null;
    /* the version as it is on the stage: remade as a reel, a carousel or a picture, its own media leads; a clip the version
       carries (a short video, a first draft's clip) goes as the video it is, never left out of the brief */
    if (d) {
      if (d.video) out.push({ kind: 'video', label: `${d.as === 'video' ? 'Reel' : 'Video'}, ${d.ratio || '9:16'}`, url: d.video, poster: d.poster || d.images?.[0] || null });
      if (d.as === 'carousel') (d.images || []).forEach((u, i) => out.push({ kind: 'image', label: `Carousel slide ${i + 1}${(d.slides || [])[i]?.text ? `: ${String(d.slides[i].text).slice(0, 80)}` : ''}`, url: u }));
      else if (d.images?.[0] && !d.video) out.push({ kind: 'image', label: `Picture, ${d.ratio || p.format || '4:5'}`, url: d.images[0] });
      if (d.zip) out.push({ kind: 'link', label: 'All the slides (zip)', url: d.zip });
      if (!d.video && !(d.images || []).length) out.push({ kind: 'todo', label: `${d.as === 'video' ? 'Reel' : d.as === 'carousel' ? 'Carousel' : 'Picture'} still to be made`, text: [d.overlay, ...(d.script || []).map((x) => x.line), ...(d.slides || []).map((x) => x.text)].filter(Boolean).join(' / ').slice(0, 400) });
    }
    if (p.video && p.video !== d?.video) out.push({ kind: 'video', label: `Video${isVideoPost(ch) ? ', 9:16' : ''}`, url: p.video, poster: p.poster || p.image || null });
    if (p.image && !(d && (d.images || []).includes(p.image))) out.push({ kind: 'image', label: `${d ? 'Photo the version was made from' : 'Creative'}, ${p.format || '4:5'}${p.grade && p.grade !== 'Original' ? `, ${p.grade} grade` : ''}`, url: p.image });
    else if (!p.image && !d && (ch.family === 'meta_ad' || ch.family === 'social')) out.push({ kind: 'todo', label: `Creative still to be made (${p.format || '4:5'})`, text: p.imageBrief || 'See the image brief' });
    if (ch.family === 'meta_ad' && p.overlay) out.push({ kind: 'copy', label: p.wordsIn && p.wordsIn === p.image ? 'Words already set in the creative' : 'Text to set on the creative', text: p.overlay });
    if (LANE_PHOTO[c.lane]) out.push({ kind: 'image', label: 'Product photo (reference, keep the label exact)', url: LANE_PHOTO[c.lane] });
    (c.images || []).slice(0, 2).forEach((u, i) => out.push({ kind: 'image', label: isResearchImage(u) ? 'The rival ad this remakes (their look, not your product)' : i ? 'More from the card' : 'The card this came from', url: u }));
    const urls = [p.utm, p.pages, p.file].filter((x) => x && (String(x).includes(BH()) || /utm_/.test(x)));
    urls.forEach((u) => out.push({ kind: 'link', label: /utm_/.test(u) ? 'Landing page with tracking' : 'Page', url: (/^https?:/.test(u) ? u : 'https://' + u.replace(/^\/*/, '').replace(/\s.*$/, '')) }));
    if (ch.family === 'crm' && p.message) out.push({ kind: 'copy', label: `${p.channel || 'Message'} template, variables in {curly braces}`, text: [p.subject && `Subject: ${p.subject}`, p.message, (p.buttons || []).length && `Buttons: ${p.buttons.join(' | ')}`].filter(Boolean).join('\n\n') });
    const rows = p.cards || p.slides || [], unit = p.cards ? 'Card' : p.format === '9:16' ? 'Story' : 'Slide';
    rows.forEach((r, i) => { const img = (p.cardImages || [])[i]; if (i && img) out.push({ kind: 'image', label: `${unit} ${i + 1} photo`, url: img }); else if (i && !img) out.push({ kind: 'todo', label: `${unit} ${i + 1} photo still to be made`, text: r.imageBrief || '' }); });
    if (rows.length) out.push({ kind: 'copy', label: `${unit}s, in order`, text: rows.map((r, i) => `${i + 1}. ${[r.headline, r.text, r.onSlide].filter(Boolean).join(' — ')}${r.link ? `\n   Opens ${r.link}` : ''}`).join('\n') });
    if (p.products?.length) out.push({ kind: 'copy', label: 'Products in the grid', text: p.products.join('\n') + (p.instantPage ? `\nOpens to: ${p.instantPage}` : '') });
    if (p.productSet) out.push({ kind: 'copy', label: 'Catalog set and frame', text: `Product set: ${p.productSet}${p.frame ? `\nFrame on every photo: ${p.frame}` : ''}` });
    if (ch.family === 'social' && p.caption) out.push({ kind: 'copy', label: `Caption for ${p.account || 'Instagram'}`, text: [p.caption, (p.hashtags || []).join(' '), p.stickers && `Sticker: ${p.stickers}`].filter(Boolean).join('\n\n') });
    if (ch.family === 'meta_ad' && p.chat?.length) out.push({ kind: 'copy', label: 'WhatsApp chat flow', text: p.chat.map((m) => `${m.from === 'in' ? 'Customer' : `${BN()}`}: ${m.text}`).join('\n') });
    if (ch.family === 'vis') out.push({ kind: 'copy', label: `Text for ${p.file || 'the page'}`, text: (p.entries || []).map((e) => `Q: ${e.q}\nA: ${e.a}${e.source ? `\nSource: ${e.source}` : ''}`).join('\n\n') });
    if (ch.family === 'store') out.push({ kind: 'copy', label: `Section for ${p.section || 'the page'}`, text: [p.heading, p.body, ...(p.bullets || []).map((b) => `• ${b}`), p.button && `[${p.button}]`].filter(Boolean).join('\n') });
    if (ch.family === 'brief') { (p.deliverables || []).forEach((d) => out.push({ kind: 'todo', label: 'Deliverable', text: d })); out.push({ kind: 'copy', label: 'Shot list', text: (p.scenes || []).map((x, i) => `${i + 1}. ${x.shot}: ${x.line}`).join('\n') }); }
    if (ch.family === 'post') { if (p.copy) out.push({ kind: 'copy', label: `${p.platform || 'Post'}, ready to paste`, text: [p.title && `Title: ${p.title}`, p.copy, (p.hashtags || []).join(' ')].filter(Boolean).join('\n\n') });
      (p.script || []).length && out.push({ kind: 'copy', label: 'Script', text: p.script.map((x, i) => `${i + 1}. ${x.beat ? x.beat + ': ' : ''}${x.shot} · ${x.line}`).join('\n') });
      if (p.media) out.push({ kind: 'todo', label: 'Picture or video to make', text: p.media });
      (p.where || []).filter((w) => /^https?:/.test(w.url || '')).forEach((w) => out.push({ kind: 'link', label: `Post in ${w.name}${w.rule ? ` (rule: ${String(w.rule).slice(0, 80)})` : ''}`, url: w.url })); }
    if (ch.family === 'meta_ops') out.push({ kind: 'copy', label: 'Changes to make in Ads Manager', text: (p.items || []).map((r) => `${r.name}: ${r.now} → ${r.next}`).join('\n') + (p.rule ? `\nRule: ${p.rule}` : '') });
    return out;
  };
  // the whole package as the handoff carries it: every filled field, its assets, the studio chat and notes
  const packageOf = (t, ch) => { if (!ch) return null; ensurePkg(t, ch); const head = headOf(t, ch);
    const fields = fieldsFor(ch.family, ch.action).filter((f) => ch.pkg[f.k] != null && ch.pkg[f.k] !== '' && !(Array.isArray(ch.pkg[f.k]) && !ch.pkg[f.k].length)).map((f) => { const v = ch.pkg[f.k];
      return { label: f.label, pub: !!f.pub, value: f.type === 'rows' ? v.map((r) => f.cols.map((c) => r[c]).filter(Boolean).join(' · ')).join('\n') : Array.isArray(v) ? v.map((x) => typeof x === 'object' ? Object.values(x).filter(Boolean).join(' · ') : x).join('\n') : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(', ') : f.type === 'number' && /₹/.test(f.label) ? inr(v) : String(v) }; });
    return { id: ch.id, family: FAMILY_NAME[ch.family], action: ch.actionLabel, target: `${ch.target.name}${ch.target.object ? ' · ' + ch.target.object : ''}`, version: head?.n || 1, versions: versionsOf(t, ch.id).length,
      money: ch.money ? (ch.amount > 0 ? `About ${inr(ch.amount)} a week` : ch.costLabel || 'Costs money') : 'No spend', undo: ch.irreversible ? `Can’t be undone: ${ch.irreversible}` : `Rollback: ${ch.rollback}`, angle: ch.angle || '',
      fields, assets: assetsFor(t, ch), thread: (ch.thread || []).map((m) => ({ who: m.from === 'you' ? m.by?.name || m.by?.email || 'You' : `${AGENT[ch.agent] || 'AI'} (studio)`, text: m.text, at: m.at, v: m.v || null })),
      notes: (ch.notes || []).map((n) => n.text), checks: (ch.myChecks || []).map((m) => ({ text: m.text, done: !!m.done })), studio: `#remix=${ch.cardId}/${ch.id}` }; };

  /* hooks from the feed service */
  const onWorkVersion = (t, w, v) => {
    // jam edits of a change are versions of that change too, and your own edits are learning signals
    const ch = w.changeId && changes(t)[w.changeId]; if (!ch || v.fromChange) return; ensurePkg(t, ch);
    const before = { ...ch.after }; const tf = TITLE_F[ch.family], sf = SUB_F[ch.family];
    ch.pkg = { ...ch.pkg, ...(tf ? { [tf]: v.title } : {}), ...(sf ? { [sf]: v.sub } : {}), ...(v.images?.[0] && /^gen\//.test(v.images[0]) ? { image: v.images[0] } : {}) };
    sync(t, ch); version(t, ch, v.by === 'you' ? 'you' : v.by === 'brew' ? 'brew' : v.by === 'colleague' ? 'teammate' : `ai:${ch.agent}`, v.note || 'Jam version');
    if (v.by === 'you') signal(t, 'edit', { before, after: ch.after, agent: ch.agent, changeId: ch.id, by: 'you' }, now(t));
  };

  // move the head to a version: its package becomes the current one. No copy is made.
  const useVersion = (t, ch, v) => { const { action, amount, title, sub, state, ...pkg } = v.snapshot; ch.pkg = { ...cleanPkg(ch.family, ch.action, pkg, clean), ...keepMedia({ ...pkg, image: pkg.image || null, knobs: pkg.knobs || {} }, true) }; ch.headVersionId = v.id; sync(t, ch); try { mirror(t, ch, v); } catch {} }; /* the jam's current version follows */
  /* ---------- options (Param, 19 Oct: "3 options, pick one", for every move that makes options). The cuts a make step writes are
     the jam's options; every later version belongs to the option it grew from (its parent chain), so a chat edit, a photo, a clip
     or a final stays inside its option. The studio shows them as tabs named by their angle, never as v1–v5. Jams saved before
     this heal from their cut reasons ("Version A: …", "Variation B: …"), and an old "Video added" copy is folded away. ---------- */
  const CUT_RE = /^(?:Version|Variation) ([A-H]):\s*(.*)$/;
  const shortName = (s) => { const w = String(s || '').replace(/[“”"().!?]/g, '').replace(/^(?:an?|the)\s+/i, '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ').replace(/[,;:–-]+$/, ''); return w ? w[0].toUpperCase() + w.slice(1) : ''; };
  const cutNames = (ch, made) => (made.length > 1 ? made.map((v, i) => `${'ABCDEFGH'[i]} (${ch.options?.names?.[v.id] || shortName(CUT_RE.exec(v.reason || '')?.[2]) || 'a different cut'})`).join(', ') : made.map((v) => 'v' + v.n).join(', ')); /* chat names options by letter and angle, never v-numbers */
  const parentsOf = (t, ch) => { const vs = versionsOf(t, ch.id), by = new Map(vs.map((v) => [v.id, v])); return { vs, by }; };
  const descends = (t, ch, v, ancestorId) => { const { by } = parentsOf(t, ch); for (let x = v, k = 0; x && k < 400; x = by.get(x.parentVersionId), k++) if (x.id === ancestorId) return true; return false; };
  const optIdOf = (ids, by, v) => { for (let x = v, k = 0; x && k < 400; x = by.get(x.parentVersionId), k++) if (ids.includes(x.id)) return x.id; return null; };
  /* an old "Video added" version: a copy of the stage's script carrying another option's clip */
  const strayClip = (vs, by, ids, v) => v.label === 'Video added' && !!v.snapshot?.video && vs.some((x) => x !== v && x.snapshot?.video === v.snapshot.video && optIdOf(ids, by, x) !== optIdOf(ids, by, v));
  const optionsOf = (t, ch) => {
    const { vs, by } = parentsOf(t, ch); if (vs.length < 2) return null;
    if (!ch.options?.ids?.length) { /* heal: the newest run of cuts (planRun, else the last cut reasons that share a parent) */
      let ids = (ch.planRun?.versions || []).filter((id) => by.has(id));
      if (ids.length < 2) { const cuts = vs.filter((v) => CUT_RE.test(v.reason || '')), grp = []; for (let i = cuts.length - 1; i >= 0; i--) { const v = cuts[i]; if (grp.length && v.parentVersionId !== grp[0].parentVersionId) break; grp.unshift(v); if (CUT_RE.exec(v.reason)[1] === 'A') break; } ids = grp.map((v) => v.id); }
      if (ids.length < 2) return null; ch.options = { ids, names: {}, picked: null, at: now(t) }; }
    const { ids, names = {}, picked = null } = ch.options;
    /* an old "Video added" copy whose clip never reached the version it was made for: the chat line that announced it ("The video
       for v4 is ready", saved with the copy's number) names that version, and the clip goes back there (once per jam) */
    if (!ch.options.clipsHealed) { ch.options.clipsHealed = 1;
      for (const v of vs) if (v.label === 'Video added' && v.snapshot?.video) { const m = (ch.thread || []).find((x) => x.v === v.n && /The video for v\d+ is ready/.test(x.text || '')), n = m ? +/The video for v(\d+)/.exec(m.text)[1] : 0, src = n ? vs.find((x) => x.n === n) : null;
        if (src && src !== v && !src.snapshot?.video) { const { video, poster, image, videoHook } = v.snapshot; src.snapshot = { ...src.snapshot, video, ...(poster ? { poster } : {}), ...(/^gen\//.test(image || '') ? { image } : {}), ...(videoHook ? { videoHook } : {}) }; } } }
    const list = ids.filter((id) => by.has(id)).map((id, i) => { const v0 = by.get(id), letter = 'ABCDEFGH'[i];
      const mine = vs.filter((v) => optIdOf(ids, by, v) === id && !strayClip(vs, by, ids, v)), tip = mine.reduce((a, b) => (b.n > a.n ? b : a), v0), sn = tip.snapshot || {};
      const img = sn.image || sn.poster || sn.draft?.poster || sn.draft?.images?.[0] || null;
      return { id, letter, name: names[id] || shortName(CUT_RE.exec(v0.reason || '')?.[2]) || v0.label || `Option ${letter}`, tip: tip.id, has: tip.final ? 'final' : sn.video || sn.draft?.video ? 'video' : img ? 'photo' : 'words', image: img }; });
    if (list.length < 2) return null;
    const head = headOf(t, ch), on = head ? optIdOf(ids, by, head) : null;
    /* a stage left on an old "Video added" copy goes to the option whose clip it carries */
    if (head && strayClip(vs, by, ids, head) && !ch.liveVersionId) { const own = vs.find((x) => x !== head && x.snapshot?.video === head.snapshot.video && optIdOf(ids, by, x) !== on); const it = own && list.find((x) => x.id === optIdOf(ids, by, own)); if (it) { useVersion(t, ch, by.get(it.tip)); return optionsOf(t, ch); } }
    return { list, picked: list.some((x) => x.id === picked) ? picked : null, on }; };
  const optionName = (t, ch, v) => { const op = optionsOf(t, ch); if (!op || !v) return ''; const { by } = parentsOf(t, ch), id = optIdOf(op.list.map((x) => x.id), by, v), it = op.list.find((x) => x.id === id); return it ? it.name : ''; };
  /* media made for version v (a clip, a photo) lands in v; on the stage too when the stage is v or grew from it; and on the newest
     version of v's option when that grew from v. Never as a new version, never on another option */
  const landMedia = (t, ch, v, media) => { const head = headOf(t, ch);
    if (!v) { ch.pkg = { ...ch.pkg, ...media }; if (head) head.snapshot = { ...head.snapshot, ...media }; return { onStage: true, at: head }; }
    v.snapshot = { ...v.snapshot, ...media };
    const onStage = !!head && (head.id === v.id || descends(t, ch, head, v.id));
    if (onStage) { ch.pkg = { ...ch.pkg, ...media }; if (head.id !== v.id) head.snapshot = { ...head.snapshot, ...media }; try { mirror(t, ch, head); } catch {} return { onStage, at: head }; }
    const op = optionsOf(t, ch), it = op && op.list.find((x) => x.tip !== v.id && descends(t, ch, versionById(t, ch.id, x.tip), v.id)); const tip = it && versionById(t, ch.id, it.tip);
    if (tip) tip.snapshot = { ...tip.snapshot, ...media }; try { mirror(t, ch, tip || v); } catch {} return { onStage: false, at: tip || v }; };
  /* ---------- routes ---------- */
  /* a photo being made lives in this process; one saved as pending by a server that has since stopped (a deploy, a restart)
     will never land, so it clears and says to make it again instead of spinning for ever */
  const IMG_JOBS = new Set(), FILL_JOBS = new Set(), CTA_JOBS = new Set(); /* CTA_JOBS: a card's making button at work (runCtaMake) */
  /* a remake's draft says "the media is being made" (pending) on the head and on every version made while it waited; when the
     remake is gone (a restart), every one of them stops saying so */
  const unstick = (t, ch) => { let n = 0; const off = (d) => (d?.pending ? (n++, { ...d, pending: false }) : d);
    if (ch.pkg?.draft?.pending) ch.pkg = { ...ch.pkg, draft: off(ch.pkg.draft) };
    for (const v of versionsOf(t, ch.id)) if (v.snapshot?.draft?.pending) v.snapshot = { ...v.snapshot, draft: off(v.snapshot.draft) };
    return n; };
  const C = (t, id) => { const ch = changes(t)[id]; if (!ch) return ch;
    if (ch.pkg && ch.pkg.wordsIn === undefined && ch.lastFinal?.versionId && /^gen\/fin-/.test(ch.pkg.image || '') && ch.pkg.overlay) ch.pkg.wordsIn = ch.pkg.image; /* a final made before 18 Oct: its words are set in the picture */
    if (ch.imagePending && !IMG_JOBS.has(ch.id)) { ch.imagePending = false; ch.imageError = 'The photo stopped before it finished. Make it again.'; }
    if (ch.videoPending && !VID_JOBS.has(ch.id)) { ch.videoPending = null; ch.videoStep = null; ch.videoError = 'The video stopped before it finished. Make it again.'; }
    if (!REMAKE_JOBS.has(ch.id)) { const as = ch.remakePending?.as || ch.pkg?.draft?.as, was = !!ch.remakePending; ch.remakePending = null;
      if (unstick(t, ch) || was) { const what = as === 'video' ? 'reel' : as === 'carousel' ? 'carousel' : 'picture';
        ch.remakeError = `The ${what} stopped before it finished (Brew restarted). Tap Make it again.`; ch.thread.push({ from: 'ai', text: ch.remakeError, at: now(t), remakeAgain: as || null }); } }
    if (ch.copyPending && !FILL_JOBS.has(ch.id)) { ch.copyPending = false; if (!touchedCh(t, ch)) ch.thread.push(startingPoint(t)); } /* the writer stopped with the server */
    healTakesOf(t, ch); /* a v2 take left drawing by a server that stopped resolves to drawError, never hangs */
    return ch; };
  on('GET', '/api/cards/:cid/remix', async (b, t, p) => {
    const c = t.cards.get(p.cid); if (!c) return { error: 'not found' };
    const r = recipeFor(c); const cv = ensureCardVersion(t, c); const owner = c.agent === 'brew' && !r.conflict ? 'creative' : r.agent;
    const fits = new Set(r.actionKeys);
    const mine = Object.values(changes(t)).filter((x) => x.cardId === c.id && !x.discarded && !x.batchKey && (fits.has(x.action) || ['running', 'live', 'deploy_team', 'result'].includes(x.state))).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6).map((x) => pubChange(t, evaluate(t, x)));
    const seen = new Set(), moveIntents = movePassages(c, '', 8).filter((x) => !seen.has(x.n + x.h) && seen.add(x.n + x.h)).slice(0, 2).map((x) => `Follow ${moveTag(x)}`);
    return { recipe: { key: r.key, agent: r.agent, type: r.type, intents: [...orderIntents(t, owner, r.intents), ...moveIntents], levers: !!r.levers, actions: r.actionKeys.map((k) => ({ key: k, label: actOf(k).label, money: actOf(k).money, jam: actOf(k).jam || null })) },
      cardVersion: { id: cv.id, n: versionsOf(t, c.id).length }, learned: summaryShort(t, owner), changes: mine };
  });
  /* ---------- batch cards: a card that already holds N finished ads ("Queue the 12") ----------
     Each ad becomes its own change you can keep, drop or remix in the studio; the kept ones queue together. */
  const STATIC_TEXT = live((b) => b.staticText); // exact on-image text of the brand's statics
  const isBatch = (c) => (c?.images || []).length >= 3 && c.images.every((x) => /^(assets\/statics\/|\/?b\/[a-z0-9-]+\/statics\/)/.test(x));
  const batchItems = (t, c) => {
    const cv = ensureCardVersion(t, c), r = recipeFor(c), all = changes(t);
    return c.images.map((img, i) => {
      const key = path.basename(img, path.extname(img));
      let ch = Object.values(all).find((x) => x.cardId === c.id && x.batchKey === key);
      if (!ch) {
        const tx = STATIC_TEXT[key] || {};
        const base = mockPkg('meta_ad', 'creative.add_variants', c, 0, '', FACTS);
        ch = build(t, c, cv, r, { action: 'creative.add_variants', fromCard: true, angle: `Ad ${i + 1}`, why: tx.small || '', pkg: { ...base, headline: String(tx.headline || base.headline).slice(0, 240), primaryText: [tx.headline, tx.small].filter(Boolean).join('\n') || base.primaryText, overlay: '', format: '4:5' } }, { intent: '', prompt: '' });
        Object.assign(ch, { batchKey: key, batchIndex: i, pick: 'keep' });
        ch.pkg.image = img; sync(t, ch, c);
        const v0 = versionsOf(t, ch.id)[0]; if (v0) { v0.snapshot = snapOf(ch); v0.reason = 'The ad as the card made it'; }
      }
      // ads queued together share the lead ad's state
      const lead = ch.batchLead && all[ch.batchLead];
      return lead && lead.id !== ch.id ? { ...ch, state: lead.state } : ch;
    });
  };
  const pubBatch = (t, c) => { const items = batchItems(t, c).map((x) => { const ch = changes(t)[x.id]; evaluate(t, ch); return { ...pubChange(t, ch), state: x.state }; }); return { items, kept: items.filter((x) => x.pick !== 'drop').length }; };
  on('GET', '/api/cards/:cid/batch', async (b, t, p) => {
    const c = t.cards.get(p.cid); if (!c) return { error: 'not found' }; if (!isBatch(c)) return { batch: false };
    return { batch: true, ...pubBatch(t, c) };
  });
  on('POST', '/api/changes/:chid/pick', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch?.batchKey) return { error: 'not found' };
    ch.pick = b.pick === 'drop' ? 'drop' : 'keep';
    signal(t, 'pick', { agent: ch.agent, angle: ch.batchKey, action: ch.action, changeId: ch.id, dropped: ch.pick === 'drop' }, now(t));
    return { change: pubChange(t, evaluate(t, ch)) };
  });
  on('POST', '/api/cards/:cid/batch/queue', async (b, t, p) => {
    const c = t.cards.get(p.cid); if (!c || !isBatch(c)) return { error: 'not found' };
    const kept = batchItems(t, c).filter((x) => x.pick !== 'drop' && !['running', 'live', 'deploy_team', 'result'].includes(x.state)).map((x) => changes(t)[x.id]);
    if (!kept.length) return { error: 'Keep at least one ad first' };
    kept.forEach((x) => evaluate(t, x));
    const blocked = kept.filter((x) => x.verdict !== 'live');
    if (blocked.length) return { blocked: blocked.map((x) => ({ id: x.id, n: x.batchIndex + 1, why: (x.fixes || x.reasons || [])[0] || 'Needs a fix' })) };
    /* the kept ads become one jam: it ends with Share the brief (nothing is launched from Brew) */
    const lead = kept[0], w = workFromChange(t, lead); w.title = `${kept.length} ads for the Meta test`;
    kept.forEach((x) => { x.batchLead = lead.id; });
    lead.batchLead = lead.id;
    signal(t, 'pick', { agent: lead.agent, action: lead.action, changeId: lead.id }, now(t));
    t.acted.add(c.id);
    return { ...pubBatch(t, c), work: w, learned: learnedOut(t) };
  });
  const summaryShort = (t, agent) => { const s = summary(t); return { rules: s.rules.filter((r) => r.on && (!r.scope || r.scope === agent)).map((r) => r.text), autoChecks: s.autoChecks.filter((a) => a.on).map((a) => a.q), trust: s.trust[agent], exemplars: s.exemplars.filter((x) => x.agent === agent).length }; };
  /* the lead package's real copy, written after the jam opened: it replaces the starting package as version 1, unless
     someone already changed it (a new version or a message), in which case their work stands */
  /* "Writing the first draft…" shows while the writer really runs (FILL_JOBS, not a 90-second clock). A draft that didn't come
     (an error, nothing back, a restart: C() below) never leaves the template looking like the AI's words: the chat says it is a
     starting point and offers Rewrite it */
  const touchedCh = (t, ch) => versionsOf(t, ch.id).length > 1 || (ch.thread || []).length > 0;
  const startingPoint = (t) => ({ from: 'ai', text: 'This is a starting point: the first draft didn’t get written. Tap Rewrite it and I’ll write it now from the card.', at: now(t), rewrite: true });
  const fillLater = (t, c, ch, write, after = null) => {
    ch.copyPending = Date.now(); FILL_JOBS.add(ch.id);
    (async () => {
      let ok = false;
      try { const x = await write(); const touched = touchedCh(t, ch);
        if (touched) ok = true; /* someone already changed it: their work stands */
        else if (x && Object.keys(x.pkg || {}).length && ch.action === x.action) { ch.pkg = { ...rulePkg(t, ch.agent, ch.family, cleanPkg(ch.family, ch.action, x.pkg, clean)), ...keepMedia({ ...ch.pkg, knobs: ch.pkg.knobs || {} }, true) };
          if (x.angle) ch.angle = x.angle; if (x.why) ch.why = x.why; if (x.from) ch.from = x.from; sync(t, ch, c); const v0 = versionsOf(t, ch.id)[0]; if (v0) { v0.snapshot = snapOf(ch); try { mirror(t, ch, v0); } catch {} } ok = true; }
        else log.warn('[remix later] no usable draft', x ? `${x.action} for ${ch.action}` : 'nothing came back'); }
      catch (e) { log.warn('[remix later]', e.message); }
      ch.copyPending = false; FILL_JOBS.delete(ch.id);
      if (!ok && !touchedCh(t, ch)) ch.thread.push(startingPoint(t));
      try { after?.(); } catch (e) { log.warn('[remix later] after', e.message); }
      finally { if (ch.ctaQueued) { const lab = ch.ctaQueued; ch.ctaQueued = null; try { runCtaMake(t, ch, t.cards.get(ch.cardId) || c, lab); } catch (e) { log.warn('[cta make] queued', e.message); } } /* the card's button was pressed while the first words were written */ bump(t, ch); o.save?.(t); } /* the button's make runs after our version's first picture has started, so it waits for it */
    })();
  };
  /* ---------- v2 cards (the Make-it-yours sheet and Another take): never wait on an asset ----------
     POST /api/cards/:cid/remix takes two more bodies beside the studio's own (no flags, and `fast`, are unchanged):

     A. { words:true, prompt?, chip?, set?:{title, body} }   →  { ok:true, changeId, versionId, n, words:{ title, body } }
        Rewrites only the card's concept words: the one-line title/angle and the body/caption of the card's package (the same
        change the studio opens on: found, else built from the card as `fast` does). `why` (the card's signal and its source)
        is never touched. The fast text model writes them (claudeTool; under AI_MOCK a deterministic variant of the words,
        shaped by the chip); the chip is the prompt when the prompt is empty. `set` is words the person typed by hand: they are
        applied exactly as given, no model call and no spend, and `set` wins over a prompt or chip sent with it. The new words
        are the change's next version (its head) and the card's `take` mirror shows them, so a reload shows them. No asset is
        drawn. When text spend is refused the reply is { error } with the real reason (budgetWhy), never a silent fallback.

     B. { queue:true, take?:true, prompt?, chip? }  →  { queued:true, changeId, versionId, n, drawing, drawError?, words? }
        The next version is made at once with drawing:true and the current words (take:true rewrites them first, as in A,
        inside the same reply, and marks the previous head version passed:true, so ranking treats it like Not for me). The
        picture is then made in the background on the studio's own picture path (picSrc → picPrompt → drawPic: the card's
        product photo, the package's image brief, the rival look for "Make our version"), within spend('image') and never
        under isMock() (MEDIA_FAKE stand-ins excepted), capped at 3 minutes. When it lands: version.drawing=false,
        version.asset={kind:'image',url}, snapshot.image=url (the stage too when that version is the head), the card's `take`
        mirror is updated and GET /api/tenants/:id/pulse lists the card id in `updated` (v2.updatedSince). On failure the
        version keeps drawing:false and drawError:'<reason>' and is delivered the same way; a refusal known at once (AI
        offline, no photo budget, a community post that takes real photos only) comes back in the reply as drawError. A version
        left drawing by a server that stopped resolves to drawError on its next load, the next pulse or the next v2 call
        (healTakes), never hangs.

     The card mirror, spread by feed-service pub(): card.take = { changeId, versionId, n, title, body, image, drawing,
     drawError, passed:[versionIds], at }. Clients: poll GET /api/tenants/:id/pulse?since=<clock> and re-fetch each card in
     `updated` (GET /api/cards/:cid → card.take), or GET /api/changes/:chid and read versions[].drawing/drawError/asset. */
  const TAKE_CAP = 180e3, TAKE_JOBS = new Map(); /* versionId → { chId, run }: the draws in flight in this process (tests await `run`) */
  const V2_TITLE = { ...TITLE_F, post: 'title', social: null }, V2_BODY = { ...SUB_F, social: 'caption', post: 'copy' };
  const takeWords = (ch, v = null, t = null) => { const a = v && t ? afterFromPkg(ch.family, pkgOfVersion(t, ch, v)) : ch.after || {}; return { title: String(a.title || ''), body: String(a.sub || '') }; }; /* the head's words, or a version's */
  /* the words into the package, per family (afterFromPkg reads them back as title/sub); a family with no title field leads
     its body with the title line */
  const putWords = (t, ch, c, w) => {
    const f = ch.family, p = { ...ch.pkg }, tf = V2_TITLE[f], bf = V2_BODY[f];
    if (f === 'social') { if (p.slides?.length) { p.slides = p.slides.map((s, i) => (i ? s : { ...s, onSlide: w.title })); p.caption = w.body; } else p.caption = [w.title, w.body].filter(Boolean).join('\n'); }
    else if (f === 'vis') { const e = (p.entries || [])[0] || {}; p.entries = [{ ...e, q: w.title, a: w.body }, ...(p.entries || []).slice(1)]; }
    else if (f === 'search') { p.headlines = [w.title, ...(p.headlines || []).slice(1)]; p.descriptions = [w.body, ...(p.descriptions || []).slice(1)]; }
    else if (f === 'setup') { p.what = w.title; p.verify = w.body; }
    else if (f === 'print') { p.front = w.title; p.back = w.body; }
    else if (f === 'listing') { p.name = w.title; if (!(p.items || []).length) p.reason = w.body; }
    else if (f === 'brief') { p.title = w.title; }
    else { if (tf) p[tf] = w.title; if (bf) p[bf] = w.body; }
    ch.pkg = { ...ch.pkg, ...cleanPkg(f, ch.action, p, clean), ...keepMedia(ch.pkg) };
    if (BANNED.test(publicText(f, ch.action, ch.pkg).join(' '))) ch.pkg = rulePkg(t, ch.agent, f, ch.pkg);
    sync(t, ch, c);
  };
  /* AI_MOCK (and the demo site): a deterministic variant shaped by the chip, still honouring what the team taught */
  const mockWords = (t, ch, ask) => {
    const { title, body } = takeWords(ch), a = String(ask || ''), sents = body.split(/(?<=[.!?])\s+/).filter(Boolean); let m, out;
    if (/\bshorter\b/i.test(a)) out = { title: title.split(/\s+/).slice(0, 6).join(' ').replace(/[,:;]$/, ''), body: sents[0] || body, label: 'Shorter' };
    else if (/\bwarmer\b/i.test(a)) out = { title: title.replace(/[.!]$/, ''), body: `${body.trim()} Made with care, for the people who come back.`.trim(), label: 'Warmer' };
    else if ((m = /\blead with (.+)/i.exec(a))) out = { title: `${m[1].trim().replace(/[.]$/, '')}: ${title}`, body, label: `Leads with ${m[1].trim()}` };
    else if ((m = /\bmake it about (.+)/i.exec(a))) out = { title, body: `Where ${m[1].trim().replace(/[.]$/, '')} stops, this starts. ${body}`.trim(), label: `About ${m[1].trim()}` };
    else if ((m = /^\s*for (.+)/i.exec(a))) out = { title, body: `For the ${m[1].trim().replace(/[.]$/, '')}: ${body}`.trim(), label: `For ${m[1].trim()}` };
    else { const first = sents[0] && sents[0].replace(/[.]$/, '') !== title ? sents[0].replace(/[.]$/, '') : `${title}, said another way`; out = { title: first.slice(0, 90), body: [...sents.slice(1), title].filter(Boolean).join(' '), label: 'New words' }; }
    const x = applyRulesMock(t, ch.agent, { title: out.title, sub: out.body }); return { title: clean(x.title), body: clean(x.sub), label: out.label };
  };
  const WORDS_SCHEMA = { type: 'object', required: ['title', 'body', 'label'], properties: { title: { type: 'string', description: 'The one-line title or angle, under 12 words, point first' }, body: { type: 'string', description: 'The body or caption as it ships: 1 to 3 short lines to the shopper, plain words, only numbers from the facts' }, label: { type: 'string', description: 'A name for this version: 2 to 4 words, sentence case, what is different (e.g. "Shorter", "Leads with the serum")' } } };
  /* the words, rewritten by the fast text model (the same client the fast jam path uses); the card's why is not in the ask */
  const rewriteWords = async (t, c, ch, ask) => {
    if (isMock()) return mockWords(t, ch, ask);
    if (!spend('text')) throw Object.assign(new Error(budgetWhy('text', o.slugOfT?.(t), BN()) || 'Brew’s text budget for today is used up, so the words can’t be rewritten right now. Try again after midnight UTC.'), { refused: true });
    const { title, body } = takeWords(ch), rv = await rivalRead(t, c).catch(() => null);
    const j = await claudeTool(`${cardBrief(c, seatLine(t.viewer))}${rv ? `\n\n${rivalBlock(rv.ad, rv.style, BN())}` : ''}\n\nYou are the ${AGENT[ch.agent] || 'creative'} agent. Rewrite only the WORDS of this ${FAMILY_NAME[ch.family] || 'change'} (${ch.actionLabel} on ${ch.target.name}) the way the person asks. Same product, same action, same promise; the card's reason (its signal and source) is not yours to change, and no new claims.\n${promptBlock(t, ch.agent === 'brew' ? 'creative' : ch.agent)}\n${productLine(c, pkgWords(ch))}\nNow: title “${title}”\nbody: “${body}”\nThe person asks: “${ask || 'Rewrite the words'}”\nReturn the new title (one line) and body. ${factsLine}`, WORDS_SCHEMA, 700, 'v2_words');
    const w = { title: clean(String(j.title || '')).slice(0, 160), body: clean(String(j.body || '')).slice(0, 1200), label: j.label };
    if (!w.title && !w.body) throw new Error('The rewrite came back empty. Try another chip.');
    if (BANNED.test(`${w.title} ${w.body}`)) throw new Error('The rewrite used a claim this brand can’t make, so the words stay as they are. Try another chip.');
    const nums = unbackedNums(`${w.title} ${w.body}`); if (nums.length) throw new Error(`The rewrite used a number the facts don’t back (${nums.slice(0, 3).join(', ')}), so the words stay as they are. Try another chip.`);
    return w;
  };
  /* the card's own package for the sheet: the studio's latest fitting change (so Open the studio lands on it), else built now
     from the card as `fast` does, on the card's own first draft */
  const latestTake = (t, c, r) => { const fits = new Set(r.actionKeys);
    return Object.values(changes(t)).filter((x) => x.cardId === c.id && !x.discarded && !x.batchKey && fits.has(x.action) && !editable(x)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null; };
  const takeChange = (t, c, r, cv) => {
    const mine = latestTake(t, c, r);
    if (mine) { ensurePkg(t, mine); return mine; }
    const ch = build(t, c, cv, r, mockOptions(t, c, r, '', 1)[0], { intent: '', prompt: '' }); seedV0(t, c, ch); return ch;
  };
  /* the card carries its latest take (feed-service pub spreads it), and the pulse learns the card changed */
  const mirrorTake = (t, c, ch, v) => {
    const w = takeWords(ch, v, t);
    c.take = { changeId: ch.id, versionId: v.id, n: v.n, title: w.title, body: w.body, image: v.snapshot?.image || null, drawing: !!v.drawing, drawError: v.drawError || null, passed: versionsOf(t, ch.id).filter((x) => x.passed).map((x) => x.id), at: now(t) };
    const up = (t.cardUpdated ||= {}); up[c.id] = now(t); for (const [id, at] of Object.entries(up)) if (now(t) - at > 86400e3) delete up[id]; /* a day of history is plenty for a pulse */
  };
  const failTake = (t, c, ch, v, why) => { v.drawing = false; v.drawError = String(why || 'The picture didn’t come through.').slice(0, 200); if (c) mirrorTake(t, c, ch, v); };
  /* a take whose draw is not running in this process (a restart, a deploy): it is over, and says so */
  const healTakesOf = (t, ch) => { let n = 0; for (const v of versionsOf(t, ch.id)) if (v.drawing && !TAKE_JOBS.has(v.id)) { failTake(t, t.cards.get(ch.cardId) || null, ch, v, 'The picture stopped before it finished (Brew restarted). Ask for another take.'); n++; } return n; };
  const healTakes = (t) => { let n = 0; for (const ch of Object.values(changes(t))) n += healTakesOf(t, ch); return n; };
  const updatedSince = (t, since = 0) => Object.entries(t.cardUpdated || {}).filter(([id, at]) => at > since && t.cards.has(id)).map(([id]) => id);
  /* the picture for a take, in the background: the studio's own path (product photo, brief, rival look), one picture, capped */
  const drawTake = (t, c, ch, v, ask) => {
    if (!['meta_ad', 'social', 'post'].includes(ch.family)) return failTake(t, c, ch, v, 'This kind of change has no picture to draw; the words are on the version.');
    if (realOnly(ch)) return failTake(t, c, ch, v, `${ch.pkg?.platform || 'This community'} wants real photos, not AI ones: pick one of your product photos.`);
    const maker = o.mediaFake ? imgMaker() : geminiImage;
    if ((isMock() && !o.mediaFake) || !maker) return failTake(t, c, ch, v, isMock() ? 'Pictures are off while AI is offline; the words are on the version.' : 'This server can’t make pictures.');
    if (!spend('image')) return failTake(t, c, ch, v, budgetWhy('image', o.slugOfT?.(t), BN()) || 'Today’s picture limit is used up; the words are on the version.');
    ch.imagePending = true; ch.imageError = null; IMG_JOBS.add(ch.id);
    const p = { ...ch.pkg }, rows = p.cards || p.slides || [], head = takeWords(ch).title;
    const land = (url) => {
      if (!v.drawing) return; /* the cap already ended it */
      const media = { image: url, ...(rows.length ? { cardImages: [url, ...(p.cardImages || []).slice(1)] } : {}) };
      v.snapshot = { ...v.snapshot, ...media }; v.drawing = false; v.drawError = null; v.asset = { kind: 'image', url };
      if (headOf(t, ch)?.id === v.id) { ch.pkg = { ...ch.pkg, ...media }; sync(t, ch); try { mirror(t, ch, v); } catch {} }
      try { o.onMedia?.(t, ch, { kind: 'image', images: [url], n: v.n, label: v.label }); } catch {} /* every new asset goes where the jam is (Slack) */
      mirrorTake(t, c, ch, v);
    };
    const job = (async () => {
      try {
        const src = await picSrc(t, ch, p); if (!src) throw new Error('no product photo could be read for this picture');
        const pic = await rivalPic(t, ch, p);
        const extra = `${head ? ` The photo goes with the headline “${String(head).slice(0, 120)}”.` : ''}${ask ? ` The team asked: ${String(ask).slice(0, 200)}.` : ''} A fresh take, different from the last picture (take ${v.n}).`;
        const url = await drawPic(src, picPrompt(ch, p, 0, pic, extra), p.format, pic, null, maker); if (!url) throw new Error('no image came back');
        land(url);
      } catch (e) { log.warn('[take]', e.message); if (v.drawing) failTake(t, c, ch, v, `The picture didn’t come through (${String(e.message).slice(0, 120)}). Ask for another take.`); }
    })();
    let timer; const cap = new Promise((r) => { timer = setTimeout(() => r('cap'), TAKE_CAP); timer.unref?.(); });
    const run = Promise.race([job, cap]).then((x) => { clearTimeout(timer); if (x === 'cap' && v.drawing) { log.warn('[take] capped', v.id); failTake(t, c, ch, v, 'The picture took more than 3 minutes. Ask for another take.'); } })
      .finally(() => { TAKE_JOBS.delete(v.id); ch.imagePending = [...TAKE_JOBS.values()].some((j) => j.chId === ch.id); if (!ch.imagePending) IMG_JOBS.delete(ch.id); bump(t, ch); o.save?.(t); });
    TAKE_JOBS.set(v.id, { chId: ch.id, run });
    return true;
  };
  /* what the sheet opens on, read only (nothing built, saved or spent): the words and picture Save writes to, i.e. the card's
     latest take, else the package a first take would start from. Its picture is ours (a draft or a take), never a rival's poster */
  const v2Peek = (t, c) => {
    const r = recipeFor(c), mine = latestTake(t, c, r);
    if (mine) { ensurePkg(t, mine); const v = headOf(t, mine), img = v?.snapshot?.image || mine.pkg?.image || null;
      return { words: takeWords(mine), image: img && !isResearchImage(img) ? img : null, drawing: !!v?.drawing, changeId: mine.id }; }
    const x = mockOptions(t, c, r, '', 1)[0], f = familyOf(x.action), act = actOf(x.action);
    const a = afterFromPkg(f, rulePkg(t, act.agent, f, cleanPkg(f, x.action, x.pkg || mockPkg(f, x.action, c, 0, '', FACTS), clean)));
    return { words: { title: String(a.title || ''), body: String(a.sub || '') }, image: null };
  };
  const v2Remix = async (b, t, c) => {
    healTakes(t);
    const ask = clean(String(b.prompt || '').trim() || String(b.chip || '').trim()).slice(0, 300), take = !!b.take;
    const r = recipeFor(c), cv = ensureCardVersion(t, c), ch = takeChange(t, c, r, cv), before = { ...ch.after };
    let words = null;
    const set = b.set && typeof b.set === 'object' ? { title: clean(String(b.set.title ?? '')).trim().slice(0, 160), body: clean(String(b.set.body ?? '')).trim().slice(0, 1200) } : null; /* typed by hand: applied as is, nothing spent */
    if (set && !set.title && !set.body) return { error: 'Type a title or a body first.', changeId: ch.id };
    if (set) { const cur = takeWords(ch); words = { title: set.title || cur.title, body: set.body || cur.body, label: 'Your words' }; putWords(t, ch, c, words); }
    else if (b.words) { try { words = await rewriteWords(t, c, ch, ask); putWords(t, ch, c, words); } catch (e) { log.warn('[v2 words]', e.message); return { error: e.message, changeId: ch.id }; } }
    t.acted.add(c.id);
    if (b.words) {
      const v = version(t, ch, set ? 'you' : `ai:${ch.agent}`, set ? 'Your words' : `New words${ask ? `: ${ask.slice(0, 80)}` : ''}`, words.label || 'New words');
      signal(t, 'edit', { before, after: ch.after, agent: ch.agent, changeId: ch.id, by: set ? 'you' : 'ai-asked' }, now(t));
      mirrorTake(t, c, ch, v); o.save?.(t);
      return { ok: true, changeId: ch.id, versionId: v.id, n: v.n, words: takeWords(ch) };
    }
    const prev = headOf(t, ch); if (take && prev) prev.passed = true;
    const v = version(t, ch, `ai:${ch.agent}`, take ? `Another take${ask ? `: ${ask.slice(0, 80)}` : ''}` : `New picture${ask ? `: ${ask.slice(0, 80)}` : ''}`, words?.label || (take ? 'Another take' : 'New picture'));
    v.drawing = true; v.drawingAt = now(t); if (take) v.take = true;
    if (words) signal(t, 'edit', { before, after: ch.after, agent: ch.agent, changeId: ch.id, by: 'ai-asked' }, now(t));
    mirrorTake(t, c, ch, v);
    /* Another take answers at once: its new words are written in the background (the AI call took minutes on a slow day and the
       button sat still), then its picture is drawn with them. The take is held in TAKE_JOBS meanwhile, so healTakes leaves it be */
    if (take && !set) { const wj = (async () => {
        try { let tm; const w2 = await Promise.race([rewriteWords(t, c, ch, ask), new Promise((_, no) => { tm = setTimeout(() => no(new Error('the words took over 90 s; the take keeps the last words')), 90e3); tm.unref?.(); })]).finally(() => clearTimeout(tm)); if (v.drawing) { putWords(t, ch, c, w2); v.snapshot = { ...v.snapshot, ...snapOf(ch) }; v.label = cleanLabel(w2.label) || v.label;
          signal(t, 'edit', { before, after: ch.after, agent: ch.agent, changeId: ch.id, by: 'ai-asked' }, now(t)); try { mirror(t, ch, v); } catch {} mirrorTake(t, c, ch, v); } }
        catch (e) { log.warn('[take words]', e.message); }
        TAKE_JOBS.delete(v.id); if (v.drawing) drawTake(t, c, ch, v, ask); o.save?.(t); })();
      TAKE_JOBS.set(v.id, { chId: ch.id, run: wj }); o.save?.(t);
      return { queued: true, changeId: ch.id, versionId: v.id, n: v.n, drawing: true }; }
    drawTake(t, c, ch, v, ask); o.save?.(t);
    return { queued: true, changeId: ch.id, versionId: v.id, n: v.n, drawing: !!v.drawing, ...(v.drawError ? { drawError: v.drawError } : {}), ...(words ? { words: takeWords(ch) } : {}) };
  };
  on('POST', '/api/cards/:cid/remix', async (b, t, p) => {
    const c = t.cards.get(p.cid); if (!c) return { error: 'not found' };
    if (b.peek) return v2Peek(t, c); /* v2 sheet: what it opens on */
    if (b.words || b.queue) return v2Remix(b, t, c); /* v2: words first, the picture in the background (the block above) */
    const r = recipeFor(c); const cv = ensureCardVersion(t, c);
    const intent = String(b.intent || '').slice(0, 60), prompt = String(b.prompt || '').slice(0, 300);
    /* fast (opening a jam): the package is built at once from the card itself and the AI writes the lead option in the
       background (copyPending; the studio polls and shows "Writing the first draft…"), so a jam opens in well under a second */
    const fast = !!b.fast && !isMock();
    let opts = null, line = '', live = false, writeLater = null;
    /* an idea from the stream is already written (ideas.js): it opens as itself, with its copy and where to post. A heard
       thread has no reply yet: the writer drafts one when AI is on; offline it starts from a plain opener */
    if (c.post?.platform && r.primary) { const pkg = ideaPkg(c.post, r.primary.split('.').pop(), c);
      if (!c.post.copy && fast && spend('text')) writeLater = async () => { const x = await liveOptions(t, c, { ...r, actionKeys: [r.primary] }, intent, `${prompt} Write the reply for this thread: ${c.post.where?.[0]?.url || ''}. Answer what they asked using only facts you have; say you work at ${BN()}.`, 1); return x.opts[0] ? { ...x.opts[0], pkg: { ...pkg, ...x.opts[0].pkg, where: pkg.where } } : null; };
      else if (!c.post.copy && !isMock() && spend('text')) { try { const x = await liveOptions(t, c, { ...r, actionKeys: [r.primary] }, intent, `${prompt} Write the reply for this thread: ${c.post.where?.[0]?.url || ''}. Answer what they asked using only facts you have; say you work at ${BN()}.`, 1); if (x.opts[0]) { opts = [{ ...x.opts[0], pkg: { ...pkg, ...x.opts[0].pkg, where: pkg.where }, fromCard: true }]; line = x.line; live = true; } } catch (e) { log.warn('[remix idea]', e.message); } }
      opts ||= [{ action: r.primary, angle: 'As written', why: String(c.post.why || '').slice(0, 160), from: null, pkg, fromCard: true }]; line ||= c.post.copy ? 'The post, ready to go, and where it goes.' : 'A reply to start from, and the thread it goes in.'; }
    /* the writer may use only the lead package's own action, so what it writes always fits the package the jam opened on (it
       was offered every action, and a draft for another one was thrown away without a word) */
    if (!opts && fast && spend('text')) writeLater = async () => (await liveOptions(t, c, { ...r, actionKeys: [r.actionKeys[0]] }, intent, prompt, 1)).opts[0] || null;
    else if (!opts && !isMock() && spend('text')) { try { const x = await liveOptions(t, c, r, intent, prompt); if (x.opts.length) { opts = x.opts; line = x.line; live = true; } } catch (e) { log.warn('[remix]', e.message); } }
    if (!opts) { opts = mockOptions(t, c, r, intent, b.fast ? 1 : 3); /* opening a jam builds the one package it opens on, never two orphans beside it */ line = r.conflict ? 'Three ways to settle it. A person decides, so each one opens a jam.' : 'Three changes from this card. Each says where it goes and who ships it.'; }
    // the card's own suggestion always leads; the rest are ranked by what this team tends to pick
    const made = opts.map((x) => build(t, c, cv, r, x, { intent, prompt })).sort((a, b) => (b.fromCard - a.fromCard) || (b.score - a.score));
    if (intent) signal(t, 'pick', { agent: made[0]?.agent, intent }, now(t));
    t.acted.add(c.id);
    if (made[0]) seedV0(t, c, made[0]); /* the jam's package opens on the card's own first draft */
    /* "Make our version" of a rival's ad: the person asked for our ad, so its first picture (in the rival's style, our product)
       is made once the words are written; nothing else opens a paid picture by itself */
    const firstPic = isRivalCard(c) && made[0] && !/^gen\//.test(made[0].pkg?.image || '') ? () => (isVideoPost(made[0]) ? genVideo(t, made[0], 'our version of the rival video') : genImage(t, made[0], 'our version of the rival ad')) : null;
    /* the first photo starts with the copy, not after it: an ad or a post with no picture of its own (no first draft on the card)
       gets one of the card's own product now, on version 1, and the copy keeps it when it lands (fillLater keepMedia) */
    const lead = made[0];
    if (fast && lead && !firstPic && ['meta_ad', 'social'].includes(lead.family) && lead.v0 !== 'draft' && !/^gen\//.test(lead.pkg?.image || '')) genImage(t, lead, 'the first photo', { target: versionsOf(t, lead.id)[0]?.id || null });
    if (writeLater && made[0]) fillLater(t, c, made[0], writeLater, firstPic); else firstPic?.();
    return { line, live, changes: made.map((x) => pubChange(t, x)), learned: learnedOut(t) };
  });
  // the Library's "My remixes": every change you opened, edited, picked or sent; batches fold into one row per card
  on('POST', '/api/changes/:chid/open', async (b, t, p) => { const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ch.openedAt = now(t); return { ok: true }; });
  on('GET', '/api/tenants/:id/remixes', async (b, t) => {
    const touched = (ch) => ch.discarded || ch.state !== 'draft' || ch.openedAt || versionsOf(t, ch.id).length > 1 || (ch.thread || []).length || (ch.batchKey && ch.pick === 'drop');
    const atOf = (ch) => Math.max(ch.createdAt || 0, ch.openedAt || 0, ch.liveAt || 0, ...versionsOf(t, ch.id).map((v) => v.at || 0));
    const rows = [], batches = {};
    for (const ch of Object.values(changes(t))) {
      const c = t.cards.get(ch.cardId) || {};
      if (ch.batchKey) { (batches[ch.cardId] ||= { c, items: [] }).items.push(ch); continue; }
      if (!touched(ch)) continue;
      const vs = versionsOf(t, ch.id), head = headOf(t, ch);
      rows.push({ id: ch.id, cardId: ch.cardId, cardTitle: c.title || '', title: ch.after?.title || ch.actionLabel, action: ch.actionLabel, family: FAMILY_NAME[ch.family] || '', fam: ch.family, agent: ch.agent, state: ch.state,
        versions: vs.length, head: head?.n || vs.length, image: ch.pkg?.image || ch.after?.images?.[0] || c.images?.[0] || null, money: !!ch.money, at: atOf(ch), discarded: !!ch.discarded });
    }
    for (const [cardId, { c, items }] of Object.entries(batches)) {
      if (!items.some(touched)) continue;
      const kept = items.filter((x) => x.pick !== 'drop').length, live = items.find((x) => x.state !== 'draft');
      rows.push({ id: items[0].id, batch: true, cardId, cardTitle: c.title || '', title: c.title || 'Ad batch', action: `${items.length} ads · ${kept} kept`, family: FAMILY_NAME[items[0].family] || '', fam: items[0].family, agent: items[0].agent, state: live?.state || 'draft',
        versions: items.reduce((n, x) => n + versionsOf(t, x.id).length, 0), head: null, image: items[0].pkg?.image || c.images?.[0] || null, money: items.some((x) => x.money), at: Math.max(...items.map(atOf)), discarded: items.every((x) => x.discarded) });
    }
    return { remixes: rows.sort((a, b) => b.at - a.at) };
  });
  on('GET', '/api/changes/:chid', async (b, t, p) => { const ch = C(t, p.chid); return ch ? { change: pubChange(t, evaluate(t, ch)) } : { error: 'not found' }; });
  const editable = (ch) => (['running', 'live', 'deploy_team'].includes(ch.state) ? 'It is live. Undo it first, or open a jam for the next version.' : null);
  // another version: a different cut of the same package
  on('POST', '/api/changes/:chid/more', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); const c = t.cards.get(ch.cardId); const r = recipeFor(c);
    let x = null; if (!isMock() && spend('text')) { try { x = (await liveOptions(t, c, { ...r, actionKeys: [ch.action] }, ch.intent, b.prompt || '', 1, ch)).opts[0]; } catch (e) { log.warn('[more]', e.message); } }
    if (!x) { const i = (versionsOf(t, ch.id).length + 1) % 3; x = mockOptions(t, c, { ...r, actionKeys: [ch.action] }, ch.intent, 1, i)[0]; }
    ch.pkg = { ...rulePkg(t, ch.agent, ch.family, cleanPkg(ch.family, ch.action, x.pkg, clean)), ...keepMedia(ch.pkg) };
    sync(t, ch, c);
    /* with options on the stage, another one is one more option beside them (same parent as the others, its own tab) */
    const op = optionsOf(t, ch), first = op && versionById(t, ch.id, op.list[0].id);
    if (op && !op.picked && first) { const L = 'ABCDEFGH'[op.list.length] || 'X', v = addV(t, 'change', ch.id, snapOf(ch), { author: `ai:${ch.agent}`, reason: `Version ${L}: ${x.angle || 'a different cut'}`, parent: first.parentVersionId });
      ch.options.ids.push(v.id); const nm = shortName(x.angle); if (nm) ch.options.names = { ...(ch.options.names || {}), [v.id]: nm }; useVersion(t, ch, v); cutPhotos(t, ch, [v], true) /* its own photo */;
      ch.thread.push({ from: 'ai', text: `Made one more option: ${L} (${nm || 'a different cut'}). It’s on the stage now.`, at: now(t) }); }
    else version(t, ch, `ai:${ch.agent}`, `Another version${x.angle ? `: ${x.angle}` : ''}`);
    signal(t, 'pick', { agent: ch.agent, angle: ch.angle, action: ch.action, changeId: ch.id }, now(t));
    return { change: pubChange(t, ch), learned: learnedOut(t) };
  });
  // three variations at once: each one a version you can pick
  /* n finished cuts of this package, each a version you can pick (Make 3 variations, and the plan's make step) */
  const makeCuts = async (t, ch, n, prompt, reasonOf) => {
    const c = t.cards.get(ch.cardId) || {}; const r = recipeFor(c);
    let xs = null; if (!isMock() && spend('text')) { try { xs = (await liveOptions(t, c, { ...r, actionKeys: [ch.action] }, ch.intent, `${n > 1 ? `${n === 3 ? 'Three' : n} distinct cuts` : 'The finished version, ready to deploy'} of this exact package: ${toKV(ch.family, ch.action, ch.pkg).map((e) => `${e.k}: ${e.v}`).join(' · ')}${prompt ? '. ' + prompt : ''}`, n)).opts; } catch (e) { log.warn('[variants]', e.message); } }
    /* the plan promised n (Param, 19 Oct: "which 3 versions?" when 2 came back): the writer is asked again for the missing ones,
       each a different angle from the ones already written; only if it still can't, the rule-based cuts fill the gap */
    for (let k = 0; xs?.length && xs.length < n && k < 2 && !isMock() && spend('text'); k++) { try {
      const more = (await liveOptions(t, c, { ...r, actionKeys: [ch.action] }, ch.intent, `${n - xs.length} more distinct ${n - xs.length > 1 ? 'cuts' : 'cut'} of this exact package, each a different angle from these: ${xs.map((x) => x.angle).filter(Boolean).join('; ')}${prompt ? '. ' + prompt : ''}`, n - xs.length)).opts || [];
      xs = xs.concat(more.filter((x) => !xs.some((y) => String(y.angle || '').toLowerCase() === String(x.angle || '').toLowerCase()))); } catch (e) { log.warn('[variants] top-up', e.message); break; } }
    if (!xs?.length) xs = mockOptions(t, c, { ...r, actionKeys: [ch.action] }, ch.intent, n, 1);
    else if (xs.length < n) xs = xs.concat(mockOptions(t, c, { ...r, actionKeys: [ch.action] }, ch.intent, n, 1).filter((x) => !xs.some((y) => y.angle === x.angle)).slice(0, n - xs.length));
    const base = headOf(t, ch); const made = []; const keep = { ...ch.pkg };
    xs.slice(0, n).forEach((x, i) => {
      ch.pkg = { ...rulePkg(t, ch.agent, ch.family, cleanPkg(ch.family, ch.action, x.pkg, clean)), ...keepMedia(ch.pkg) }; sync(t, ch, c);
      made.push(addV(t, 'change', ch.id, snapOf(ch), { author: `ai:${ch.agent}`, reason: reasonOf(x, i), parent: base?.id }));
      ch.pkg = { ...keep }; // the cuts sit beside the version you are on; you pick one
    });
    for (const v of made) try { mirror(t, ch, v); } catch {} /* every cut is a version of the jam too */
    if (made.length > 1) ch.options = { ids: made.map((v) => v.id), names: Object.fromEntries(made.map((v, i) => [v.id, shortName(xs[i]?.angle)]).filter(([, n]) => n)), picked: null, at: now(t) }; /* the cuts are the jam's options: tabs, pick one */
    if (made.length) useVersion(t, ch, made[made.length - 1]); else sync(t, ch, c);
    made.photos = cutPhotos(t, ch, made); /* each cut its own photo, in the background, within today's limit */
    return made;
  };
  /* "three cuts of this ad", "2 versions", "five options": that many cuts, never one package (the chip used to go to iterate) */
  const CUTS_RE = /\b(two|three|four|five|[2-5])\s+(cuts|versions|variations|options)\b/i, NUMW = { two: 2, three: 3, four: 4, five: 5 };
  /* "make it a reel / a carousel" typed or tapped as a quick ask: the remake itself, as the chip above does */
  const REMAKE_RE = /^\s*(?:please\s+)?(?:make|turn|remake)\s+(?:it|this)\s+(?:into\s+)?(?:as\s+)?(?:a\s+|an\s+)?(reel|video|carousel)\b/i;
  // three variations at once: each one a version you can pick
  on('POST', '/api/changes/:chid/variants', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    const made = await makeCuts(t, ch, 3, b.prompt || '', (x, i) => `Variation ${'ABC'[i]}: ${x.angle || 'a different cut'}`);
    ch.thread.push({ from: 'ai', text: `Made ${made.length} options: ${cutNames(ch, made)}.${made.photos ? ' Each gets its own photo in a minute.' : ''} Tap them above the stage, then use the one you like.`, at: now(t), vs: made.map((v) => v.id), cuts: true });
    return { change: pubChange(t, ch), learned: learnedOut(t) };
  });
  /* the card's action, pressed in the jam: the plan's make step puts what the last step needs on the stage (card-plan.js).
     Nothing ships here: each version is iterated on the stage, then Share the brief */
  on('POST', '/api/changes/:chid/plan', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    const c = t.cards.get(ch.cardId) || {}; const pl = ch.plan || o.planOf?.(t, c) || null; if (pl) ch.plan = pl;
    if (pl?.batch || ch.batchKey) return { change: pubChange(t, ch) }; /* a batch card's ads are already made: keep or drop them */
    const n = Math.max(1, pl?.n || 1), steps = (pl?.steps || []).filter((x) => ['gather', 'write', 'make', 'step'].includes(x.k)).map((x) => x.t);
    const made = await makeCuts(t, ch, n, [steps.length ? `Follow the plan: ${steps.join('; ')}` : '', b.prompt].filter(Boolean).join('. '), (x, i) => (n > 1 ? `Version ${'ABCDEFGH'[i]}: ${x.angle || 'a different cut'}` : `${pl?.cta || 'Made'}: ready to review`));
    ch.planRun = { at: now(t), n: made.length, versions: made.map((v) => v.id) };
    const w = (t.work || []).find((x) => x.changeId === ch.id); if (w) w.cardPlan = { ...(w.cardPlan || pl || {}), ...(pl || {}), made: now(t) };
    /* a short video gets its clip, not just its script: the version on screen is filmed now, the others on a tap */
    const filming = isVideoPost(ch) && made.length ? genVideo(t, ch, 'the plan') : false;
    const vs = cutNames(ch, made), last = made[made.length - 1];
    ch.thread.push({ from: 'ai', text: isVideoPost(ch) ? `Wrote ${made.length > 1 ? `${made.length} scripts: ${vs}` : `the script: v${made[0]?.n}`}. ${filming ? `Making the video for ${made.length > 1 ? `${'ABCDEFGH'[made.length - 1]}` : 'it'} now, about two minutes.${made.length > 1 ? ' Tap the options above the phone to compare; each makes its own video.' : ''}` : `${videoWhy(ch)} Tap Make the video when you want the clip.`}` : made.length > 1 ? `Made ${made.length} options: ${vs}.${made.photos ? ' Each gets its own photo in a minute.' : ''} Tap them above the stage and use the one you like.` : `Made it: v${made[0]?.n}. Change anything here, then share the brief.`, at: now(t), vs: made.map((v) => v.id), ...(made.length > 1 ? { cuts: true } : {}) });
    return { change: pubChange(t, ch), learned: learnedOut(t) };
  });
  /* ---------- the card's own making button, pressed in the feed (Param, 19 Oct: "a CTA to generate creatives, but in reality it
     never generates, it simply changes the brief"). Before this, the feed button only opened the jam: the make step ran only if
     the same button was pressed again inside it, a short video never got its clip, and a carousel got one slide. Now the press
     makes what the button names, once per jam: "Generate versions" three versions, each with its own picture; a video button
     the clip; a post, Stories or carousel button its picture or every slide; a message or page button its written versions.
     Decisions, reports, budget moves and batches make nothing here (a batch's ads are already made). ---------- */
  const MAKES_ASSET = new Set([...MAKING, 'Rotate creative', 'Make our version', 'Turn into an idea', 'Start this', 'Send the review ask', 'Turn on the journey', 'Publish the page', 'Draft the listing', 'Review draft', 'Make the carousel', 'Make the reel', 'Post it', 'Add photos', 'Swap the images']);
  const VERSIONS_CTA = /^(generate versions|rotate creative)$/i;
  const VISUAL = new Set(['meta_ad', 'social', 'post']);
  const ctaMakes = (t, label, ch, c) => !!label && !ch.batchKey && !(ch.plan || o.planOf?.(t, c))?.batch && !['decision', 'meta_ops', 'setup', 'brief'].includes(ch.family) && (MAKES_ASSET.has(label) || /^(make|draft|generate|build|write|create)\b/i.test(label));
  const waitFor = async (test, ms = 180e3) => { const end = Date.now() + ms; while (test() && Date.now() < end) await new Promise((r) => setTimeout(r, 2000)); };
  const runCtaMake = (t, ch, c, label) => {
    if (CTA_JOBS.has(ch.id)) return false; CTA_JOBS.add(ch.id);
    const versions = VERSIONS_CTA.test(label), rows = () => ch.pkg?.cards || ch.pkg?.slides || [];
    ch.ctaPending = ch.family === 'listing' && /photo|image/i.test(label) ? 'Making the listing photos' : versions ? 'Making 3 versions' : isVideoPost(ch) ? 'Getting the video ready' : VISUAL.has(ch.family) ? (rows().length > 1 ? 'Making every slide' : 'Making the picture') : 'Writing it';
    (async () => {
      let say = null;
      try {
        await waitFor(() => ch.imagePending || ch.remakePending || FILL_JOBS.has(ch.id)); /* a picture already in flight (the first photo, our version) lands first */
        const pl = ch.plan || o.planOf?.(t, c) || null, steps = (pl?.steps || []).filter((x) => ['gather', 'write', 'make', 'step'].includes(x.k)).map((x) => x.t);
        const plan = steps.length ? `Follow the plan: ${steps.join('; ')}` : '';
        if (ch.family === 'listing' && /photo|image/i.test(label)) {
          const ok = genListingPhotos(t, ch, label); say = ok ? `Making ${shotsOf(ch.pkg).length} listing photos from your product photo: ${shotsOf(ch.pkg).join('; ')}. They land here in a minute or two.` : imageWhy(ch);
        } else if (versions || !VISUAL.has(ch.family)) {
          const n = versions ? 3 : Math.max(1, pl?.n || 1);
          think(ch, `Writing ${n > 1 ? `${n} versions` : 'it'}`);
          const made = await makeCuts(t, ch, n, plan, (x, i) => (n > 1 ? `Version ${'ABCDEFGH'[i]}: ${x.angle || 'a different cut'}` : `${label}: ready to review`));
          ch.planRun = { at: now(t), n: made.length, versions: made.map((v) => v.id), by: 'cta' };
          const vs = cutNames(ch, made);
          if (!made.length) say = 'That didn’t come through. Tap the button again in a minute.';
          else if (isVideoPost(ch)) { const ok = genVideo(t, ch, label); say = `Wrote ${made.length > 1 ? `${made.length} scripts (${vs})` : 'the script'}. ${ok ? 'Making the video now, about two minutes.' : videoWhy(ch)}`; }
          else if (VISUAL.has(ch.family)) { const ok = made.photos || (made.length === 1 && genImage(t, ch, label, { target: made[0].id }));
            say = `Made ${made.length} version${made.length > 1 ? 's' : ''}: ${vs}. ${ok ? `${made.length > 1 ? 'Each gets its own picture' : 'Its picture lands'} in a minute.` : imageWhy(ch)} Tap one to see it.`; }
          else say = `Wrote ${made.length > 1 ? `${made.length} versions: ${vs}` : `it: v${made[0].n}`}. Change anything here, then share the brief.`;
        } else if (isVideoPost(ch)) {
          const ok = genVideo(t, ch, label); say = ok ? 'Making the video now, about two minutes. It lands here on its own.' : videoWhy(ch);
        } else {
          const all = rows().length > 1; if (all && rows().every((_, i) => (ch.pkg.cardImages || [])[i])) ch.pkg = { ...ch.pkg, cardImages: [] }; /* every slide had a picture: the press makes a fresh set, the last set stays on its version */
          const ok = genImage(t, ch, label, { all }); /* a new version: the picture it had stays on the one before */
          say = ok ? `Making ${all ? `the pictures for all ${rows().length} slides` : 'the picture'} now. ${all ? 'They land' : 'It lands'} here in a minute.` : imageWhy(ch);
        }
      } catch (e) { log.warn('[cta make]', e.message); say = `That didn’t come through (${String(e.message).slice(0, 100)}). Tap the button again in a minute.`; }
      finally { think(ch, null); ch.ctaPending = null; CTA_JOBS.delete(ch.id); if (say) ch.thread.push({ from: 'ai', text: say, at: now(t) }); bump(t, ch); o.save?.(t); }
    })();
    return true;
  };
  on('POST', '/api/changes/:chid/cta-make', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch);
    const c = t.cards.get(ch.cardId) || {}, label = String(b.label || c.cta?.label || '').slice(0, 60);
    if (!ctaMakes(t, label, ch, c) || editable(ch) || isMock()) return { change: pubChange(t, ch), making: false };
    if (ch.ctaMade) return { change: pubChange(t, ch), making: false, already: true }; /* once per jam: the next press just opens it */
    ch.ctaMade = { label, at: now(t) };
    if (isRivalCard(c) && (ch.imagePending || ch.videoPending || ch.remakePending || FILL_JOBS.has(ch.id))) return { change: pubChange(t, ch), making: true }; /* our version is already being drawn */
    if (FILL_JOBS.has(ch.id)) ch.ctaQueued = label; /* the first words are still being written: it runs the moment they land (fillLater) */
    else runCtaMake(t, ch, c, label);
    return { change: pubChange(t, ch), making: true };
  });
  // your checks and notes: kept on the package, read by the AI, sent in the brief
  on('POST', '/api/changes/:chid/checks', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); ch.myChecks ||= [];
    if (b.id) { const m = ch.myChecks.find((x) => x.id === b.id); if (!m) return { error: 'no check' }; if (b.remove) ch.myChecks = ch.myChecks.filter((x) => x !== m); else { m.done = !!b.done; m.doneAt = now(t); } }
    else { const text = clean(String(b.text || '')).slice(0, 160); if (!text) return { error: 'empty' }; ch.myChecks.push({ id: uid('mc'), text, done: false, always: !!b.always, at: now(t) });
      if (b.always) { const l = L(t); l.myChecks ||= {}; const list = (l.myChecks[ch.family] ||= []); if (!list.some((x) => x.text === text)) list.push({ text, at: now(t) }); l.newRules.push({ id: uid('mc'), text: `Your check on every ${FAMILY_NAME[ch.family].toLowerCase()}: ${text}`, at: now(t) }); } }
    sync(t, ch); return { change: pubChange(t, ch), learned: learnedOut(t) };
  });
  on('POST', '/api/changes/:chid/notes', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ch.notes ||= [];
    if (b.id && b.remove) ch.notes = ch.notes.filter((x) => x.id !== b.id);
    else { const text = clean(String(b.text || '')).slice(0, 600); if (!text) return { error: 'empty' }; ch.notes.push({ id: uid('nt'), text, at: now(t) }); }
    return { change: pubChange(t, ch) };
  });
  on('POST', '/api/changes/:chid/iterate', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    const msg = clean(String(b.message || '')).slice(0, 400); if (!msg) return { error: 'empty' };
    const cut = !b.fix && !isQuestion(msg) ? CUTS_RE.exec(msg) : null;
    if (cut) { ch.thread.push(youSaid(t, msg)); const n = NUMW[cut[1].toLowerCase()] || +cut[1];
      try { think(ch, `Writing ${n} cuts of this version`); const made = await makeCuts(t, ch, n, msg, (x, i) => `Cut ${'ABCDE'[i]}: ${x.angle || 'a different cut'}`);
        ch.thread.push({ from: 'ai', text: made.length ? `Made ${made.length} options: ${cutNames(ch, made)}.${made.photos ? ' Each gets its own photo in a minute.' : ''} Tap them above the stage and use the one you like.` : 'Those cuts didn’t come through. Try again in a minute.', at: now(t), vs: made.map((v) => v.id), cuts: true });
      } finally { think(ch, null); }
      return { change: pubChange(t, ch), learned: learnedOut(t) }; }
    const rm = !b.fix && !isQuestion(msg) && ['meta_ad', 'social', 'post'].includes(ch.family) ? REMAKE_RE.exec(msg) : null;
    if (rm) { ch.thread.push(youSaid(t, msg)); const r = await remakeOf(t, ch, /carousel/i.test(rm[1]) ? 'carousel' : 'video');
      const why = r.error || (r.making === false ? r.why : null); if (why) ch.thread.push({ from: 'ai', text: why, at: now(t) }); else if (r.version) ch.thread.push({ from: 'ai', text: `Remade it as ${/carousel/i.test(rm[1]) ? 'a carousel' : 'a reel'}: v${r.version.n}. The media lands on it in a minute or two.`, at: now(t), v: r.version.n });
      return { change: pubChange(t, ch), making: !!r.making, learned: learnedOut(t) }; }
    /* "change the photo": a new photo, not a rewrite of the words. AI makes one where the platform allows it; the picker opens either way */
    if (!b.fix && photoAsk(msg) === 'change' && !isQuestion(msg) && ['meta_ad', 'social', 'post'].includes(ch.family)) {
      ch.thread.push(youSaid(t, msg));
      const started = !realOnly(ch) && !ch.imagePending ? (() => { ch.pkg.imageBrief = clean(`${ch.pkg.imageBrief || ''} The team asked: ${msg}`).slice(-600); return genImage(t, ch, msg); })() : false;
      ch.thread.push({ from: 'ai', text: started ? 'Making a new photo now. It lands as a new version in a minute. Rather use one of your own product photos, or upload one? The photo picker is open.' : realOnly(ch) ? `${ch.pkg.platform || 'This community'} wants real photos, not AI ones. Pick one of your product photos or upload your own: the photo picker is open.` : 'Pick one of your product photos or upload your own: the photo picker is open. Want a new one made instead? Describe it there.', at: now(t) });
      return { change: pubChange(t, ch), pickPhotos: true, image: started };
    }
    try {
      await iterate(t, ch, msg, { show: b.show ? clean(String(b.show)).slice(0, 300) : null });
      if (ANSWERED.has(ch)) return { change: pubChange(t, ch), answered: true }; /* a question: answered, nothing changed, no version */
      // fixing: re-check, and if anything is still wrong, try again with the exact problems (twice at most)
      for (let i = 0; b.fix && i < 2 && ch.fixes?.length && !isMock(); i++) await iterate(t, ch, `Still not fixed: ${ch.fixes.join('; ')}. Fix exactly these and change nothing else.`, { quiet: true });
      if (b.fix && ch.fixes?.length) ch.thread.push({ from: 'ai', text: `I couldn’t fix everything: ${ch.fixes.join('; ')}. Edit it in Details, or tell me how you want it.`, at: now(t) });
      return { change: pubChange(t, ch), learned: learnedOut(t) };
    } finally { think(ch, null); }
  });
  // a knob: instant for a look, a new creative for the image, AI for the words
  on('POST', '/api/changes/:chid/knob', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    const knob = knobsFor(ch.family, B()).find((k) => k.k === b.k); if (!knob) return { error: 'no knob' };
    // several values on a copy knob: one version per value, side by side. You stay on the version you were on.
    if (Array.isArray(b.v)) {
      const vals = b.v.filter((x) => knob.opts.includes(x)); if (!vals.length) return { error: 'no value' };
      if (vals.length === 1 || !isMulti(knob)) b.v = vals[0];
      else {
        const base = headOf(t, ch), keep = { ...ch.pkg, knobs: { ...(ch.pkg.knobs || {}) } }, made = [];
        ch.thread.push(youSaid(t, `${knob.label}: ${vals.join(' + ')}`));
        for (const val of vals) { ch.pkg = { ...keep, knobs: { ...keep.knobs, [knob.k]: val } }; ch.headVersionId = base?.id; await iterate(t, ch, `${knob.label}: ${val}`, { knob: { ...knob, v: val }, quiet: true }); made.push(ch.headVersionId); signal(t, 'pick', { agent: ch.agent, intent: `${knob.label}: ${val}`, changeId: ch.id }, now(t)); }
        // the canvas always shows the newest one; the timeline switches between them
        const last = made.length && versionById(t, ch.id, made[made.length - 1]); if (last) useVersion(t, ch, last); else { ch.pkg = keep; ch.headVersionId = base?.id; sync(t, ch); }
        ch.thread.push({ from: 'ai', text: `Made ${vals.length} versions, one for each ${knob.label.toLowerCase()}: ${vals.join(', ')}. You’re looking at the last one. Switch between them on the timeline above the preview.`, at: now(t), vs: made });
        return { change: pubChange(t, ch), learned: learnedOut(t) };
      }
    }
    if (!knob.opts.includes(b.v)) return { error: 'no value' };
    ch.pkg.knobs = { ...(ch.pkg.knobs || {}), [knob.k]: b.v };
    signal(t, 'pick', { agent: ch.agent, intent: `${knob.label}: ${b.v}`, changeId: ch.id }, now(t));
    if (knob.kind === 'look') { ch.pkg.grade = b.v; sync(t, ch); version(t, ch, 'you', `${knob.label}: ${b.v}`); return { change: pubChange(t, ch) }; }
    if (knob.kind === 'image') { if (knob.k === 'format') ch.pkg.format = b.v; sync(t, ch); const kv = version(t, ch, 'you', `${knob.label}: ${b.v}`); const started = genImage(t, ch, `${knob.label}: ${b.v}`, { target: kv.id }); /* the photo lands on this version */ if (!started) ch.thread.push({ from: 'ai', text: imageWhy(ch), at: now(t), photoWhy: true }); return { change: pubChange(t, ch), image: started }; }
    await iterate(t, ch, `${knob.label}: ${b.v}`, { knob: { ...knob, v: b.v } }); return { change: pubChange(t, ch), learned: learnedOut(t) };
  });
  on('POST', '/api/changes/:chid/image', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch);
    let bv = null; if (b.brief) { ch.pkg.imageBrief = clean(String(b.brief)).slice(0, 600); sync(t, ch); bv = version(t, ch, 'you', 'New image brief'); }
    const started = genImage(t, ch, b.brief ? 'your brief' : 'a new take', { all: !!b.all, target: bv?.id || null }); /* the photo lands on the brief's version, not a second one */
    return { change: pubChange(t, ch), image: started, why: started ? null : imageWhy(ch) };
  });
  on('POST', '/api/changes/:chid/listing-photos', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    const started = genListingPhotos(t, ch, 'a tap'); return { change: pubChange(t, ch), image: started, why: started ? null : ch.family !== 'listing' ? 'Only a marketplace listing makes a photo set.' : imageWhy(ch) };
  });
  on('POST', '/api/changes/:chid/video', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    const started = genVideo(t, ch, 'a tap'); if (!started) return { error: videoWhy(ch) };
    return { change: pubChange(t, ch), video: true };
  });
  /* the photo picker: the brand's own product photos, the current ones, and whether AI may make one here */
  /* ---------- the jam's chips: a publish pack, the projected impact, a remake in another format ---------- */
  /* a version's package as it was then: the snapshot without the change's own keys */
  const pkgOfVersion = (t, ch, v) => { if (!v) return { ...ch.pkg }; const { action, amount, title, sub, state, ...pkg } = v.snapshot || {}; return pkg; };
  const versionAsked = (t, ch, q) => { const vq = q?.get?.('v'); if (!vq) return headOf(t, ch) || null; return versionsOf(t, ch.id).find((x) => String(x.n) === vq || x.id === vq) || false; };
  const PACK_V = 2; // bump when a family's pack starts holding different files or words: every saved pack is made again (2: spend = a week of the daily budget)
  /* read-only: the version as files the team posts or applies themselves (publish-pack.js). Brew writes to no account.
     The zip is saved once per version (gen/pack-….zip) and served from /gen/ like every made file */
  on('GET', '/api/changes/:chid/pack', async (b, t, p, q) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch);
    const v = versionAsked(t, ch, q); if (v === false) return { status: 404, error: 'That version isn’t on this change.' };
    const pkg = pkgOfVersion(t, ch, v), n = v?.n || 1;
    const key = 'pack-' + crypto.createHash('sha1').update(`${PACK_V}|${ch.id}|${v?.id || ''}|${JSON.stringify(pkg)}|${ch.family}|${BN()}`).digest('hex').slice(0, 20) + '.zip';
    /* built once per version: the zip and what it holds are kept, so a repeat GET runs no ffmpeg or Chrome */
    ch.packMeta ||= {}; if (ch.packMeta[key] && (await genFile(key))) return { pack: { ...ch.packMeta[key], url: 'gen/' + key } };
    const chV = { ...ch, pkg }; const brand = { name: BN(), host: BH(), colors: B()?.seed?.brand?.colors || [], product: productFor(t.cards.get(ch.cardId) || {}, FACTS, pkgWords(chV))?.name || '' };
    const read = async (rel) => { if (!rel || typeof rel !== 'string') return null; if (/^\/?gen\//.test(rel)) return genFile(rel.replace(/^\/?gen\//, ''));
      const f = (o.photoAsync ? await o.photoAsync(rel).catch(() => null) : null) || photoFile(rel); return f && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null; };
    const renderPdf = ch.family === 'print' && process.env.PACK_PDF !== '0' ? (html) => withBrowser(async (br) => { const pg = await br.newPage(); try { await pg.setContent(html, { waitUntil: 'load' }); return Buffer.from(await pg.pdf({ preferCSSPageSize: true, printBackground: true })); } finally { await pg.close().catch(() => {}); } }) : null;
    const made = await buildPack({ ch: chV, pkg, family: ch.family, version: n, brand, assets: assetsFor(t, chV), read, renderPdf });
    if (!(await genFile(key))) saveGen(key, zipBuffer(made.entries));
    const meta = { name: made.fileName, version: n, versionId: v?.id || null, family: ch.family, familyName: FAMILY_NAME[ch.family], files: made.entries.map((e) => e.name), todo: made.todo, readme: made.readme, readOnly: true };
    ch.packMeta[key] = meta; const pk = Object.keys(ch.packMeta); if (pk.length > 6) delete ch.packMeta[pk[0]];
    return { pack: { ...meta, url: 'gen/' + key } };
  });

  /* the projected impact of the head version (impact.js): an estimate, cached per head version; ?fresh=1 works it out again */
  const FAMS = createFamilies({ log });
  /* the measure family (data/measure-families.json) a change of each studio family is judged as; a decision is read from its card */
  const MEASURED_AS = { meta_ad: 'paid_ads', meta_ops: 'paid_ads', search: 'paid_ads', social: 'content', post: 'content', brief: 'content', crm: 'messages', store: 'site', price_change: 'pricing', bundle_offer: 'pricing', discount_offer: 'pricing',
    vis: 'ai_search', listing: 'listings', setup: 'foundations', print: 'offline', short_video: 'content', blog_post: 'search' };
  on('GET', '/api/changes/:chid/impact', async (b, t, p, q) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch);
    const head = headOf(t, ch), c = t.cards.get(ch.cardId) || {}, mock = isMock();
    /* a member's projection uses the brand's private account rows: never cache it for a guest, never let a guest spend AI or force a rerun */
    const mem = !!t.member, key = `${head?.id || 'v0'}:${mock || !mem ? 'rules' : 'ai'}:${mem ? 'm' : 'g'}`; ch.impact ||= {};
    if (ch.impact[key] && (q?.get?.('fresh') !== '1' || !mem)) return { impact: { ...ch.impact[key], cached: true }, version: head?.n || 1 };
    const mv = moveNo(c.id), grade = mv != null ? B()?.moveValue?.[mv] || null : null;
    /* judged where the change lands, as the jam measures it (workFromChange): a Meta ad from a reorders card is read on Meta */
    const sector = (ch.family === 'listing' ? 'catalog' : SECTOR_OF[ch.agent]) || c.sector, cx = { ...c, sector, title: ch.after?.title || c.title, sub: ch.after?.sub || c.sub, cta: { label: ch.actionLabel }, measure: undefined };
    let recipe = null; try { recipe = FAMS.recipeOf(MEASURED_AS[String(ch.action).split('.').pop()] || MEASURED_AS[ch.family] || FAMS.classify(cx).family); } catch (e) { log.warn('[impact] family', e.message); }
    let measure = null; try { measure = o.measureOf?.(t, cx) || null; } catch (e) { log.warn('[impact] measure', e.message); }
    const x = impactInputs({ card: c, ch, grade, recipe, measure, ledger: t.member ? realRows(t.liveLedger) : [], connected: t.liveConn || {} });
    const ai = mem && !mock && claudeTool && spend('text') ? (prompt, schema) => claudeTool(prompt, schema, 1500, 'impact') : null;
    const out = await projectImpact(x, { ai, unbacked: unbackedNums, brand: BN(), log });
    if (!ai && !out.aiError) out.note = mock ? 'Brew’s rule-based range: AI estimates are off here.' : !mem ? 'Brew’s rule-based range: the AI estimate is for the brand’s team.' : 'Brew’s rule-based range: today’s AI budget is used up.';
    if (!out.aiError && (ai || mock || !mem)) { ch.impact[key] = { ...out, at: now(t) }; const ks = Object.keys(ch.impact); if (ks.length > 6) delete ch.impact[ks[0]]; }
    return { impact: out, version: head?.n || 1 };
  });

  /* Remake as a video, a carousel or an image, for any family: a new version of the same change whose draft (the media the
     stage shows, like the card's own first draft in seedV0) is in that format. The words come from the package itself
     (or the AI, when it may run); the media is made in the background on our own accounts, never in demo mode or offline */
  const REMAKE_AS = { video: 'a video', carousel: 'a carousel', image: 'an image' };
  const REMAKE_JOBS = new Set(); let RMK = null;
  const imgMaker = () => o.videoImage || geminiImage;
  const slideMakers = () => (RMK ||= createMakers({ geminiImage: imgMaker(), launchBrowser, zipBuffer, log }));
  const short = (s, n) => { const w = clean(String(s || '')).replace(/\s+/g, ' ').trim().split(' '); return w.length > n ? w.slice(0, n).join(' ') + '…' : w.join(' '); };
  const sentences = (xs) => xs.flatMap((x) => String(x || '').split(/(?<=[.!?])\s+|\n+/)).map((x) => x.replace(/^[-•*\d.)\s]+/, '').trim()).filter((x) => x.length > 3);
  /* the remake's words from the package as it stands: nothing new is claimed */
  const remakeRules = (ch, as, t = null) => {
    const p = ch.pkg || {}, said = [...new Set(sentences([ch.after?.sub, ...publicText(ch.family, ch.action, p)]))].filter((x) => x !== ch.after?.title);
    const visual = p.imageBrief || (p.slides || p.cards || [])[0]?.imageBrief || 'The product on a clean surface, soft daylight.';
    const end = p.cta || p.button || (p.buttons || [])[0] || (BH() ? `Shop at ${BH()}` : 'Shop now');
    const hook = short(ch.after?.title || said[0] || ch.actionLabel, 10);
    const P = productFor(t?.cards?.get?.(ch.cardId) || {}, FACTS, pkgWords(ch)) || {}; if (said.length < 2) said.push(...[P.claim, P.name !== 'the product' && (P.price ? `${P.name}, ${P.price}` : P.name)].filter((x) => x && !said.includes(x))); /* a short package: the product's own facts fill the middle */
    if (as === 'carousel') return { slides: [{ onSlide: hook, visual }, ...said.slice(0, 4).map((x) => ({ onSlide: short(x, 12), visual })), { onSlide: short(end, 8), visual }].slice(0, 6) };
    if (as === 'video') return { script: [{ beat: 'Hook', shot: visual, line: hook }, ...said.slice(0, 3).map((x, i) => ({ beat: ['Show', 'Proof', 'Detail'][i], shot: visual, line: short(x, 14) })), { beat: 'Call to action', shot: visual, line: short(end, 8) }], motion: 'The camera slowly pushes in on the product.' };
    return { overlay: short(ch.after?.title || said[0], 7), imageBrief: visual };
  };
  const REMAKE_SCHEMA = { type: 'object', required: ['label', 'slides', 'script', 'overlay', 'imageBrief', 'motion'], properties: {
    label: { type: 'string', description: '2 to 4 words naming this version, e.g. "As a carousel"' },
    slides: { type: 'array', items: { type: 'object', required: ['onSlide', 'visual'], properties: { onSlide: { type: 'string', description: 'Under 12 words; slide 1 the hook, the last says what to do' }, visual: { type: 'string', description: 'The photo behind it, no text in it' } } }, description: 'Carousel only: 3 to 6 slides; otherwise empty' },
    script: { type: 'array', items: { type: 'object', required: ['beat', 'shot', 'line'], properties: { beat: { type: 'string' }, shot: { type: 'string' }, line: { type: 'string', description: 'Under 14 words, said or shown' } } }, description: 'Video only: 4 or 5 beats of a 6-second vertical clip; otherwise empty' },
    overlay: { type: 'string', description: 'Image only: up to 7 words set on the picture; otherwise empty' },
    imageBrief: { type: 'string', description: 'The photograph as things you can see: the surface, the setting, where the light comes from, the props, who is in it and what they do. No mood words (premium, cinematic), no effects (splashes, sparkles, floating, glow), no text in it' },
    motion: { type: 'string', description: 'Video only: how the camera moves over 6 seconds' } } };
  const remakeLive = async (t, ch, as) => {
    const c = t.cards.get(ch.cardId) || {}, rv = await rivalRead(t, c).catch(() => null);
    const j = await claudeTool(`${cardBrief(c, seatLine(t.viewer))}${rv ? `\n\n${rivalBlock(rv.ad, rv.style, BN())}${as === 'video' && rv.style?.beats?.length ? '\nFor the video, follow the rival ad\'s beats in the same order, with our product and our words.' : ''}` : ''}\n\nYou are the ${AGENT[ch.agent] || 'creative'} agent. Remake this ${FAMILY_NAME[ch.family] || 'change'} (${ch.actionLabel}) as ${REMAKE_AS[as]} for ${BN()}'s own channels, keeping its point and its words where they fit.\n${productLine(c, pkgWords(ch))}\nThe package now (field: value):\n${toKV(ch.family, ch.action, ch.pkg).map((e) => `${e.k}: ${e.v}`).join('\n')}\nFill only the part for ${REMAKE_AS[as]}; leave the others empty. ${factsLine}`, REMAKE_SCHEMA, 2000, 'remake');
    const words = [...(j.slides || []).map((x) => x.onSlide), ...(j.script || []).map((x) => x.line), j.overlay].filter(Boolean).join(' ');
    if (!words || BANNED.test(words) || unbackedNums(words).length) return null; /* a claim the facts don't back: the package's own words instead */
    const out = as === 'carousel' ? { slides: (j.slides || []).slice(0, 6).map((x) => ({ onSlide: short(x.onSlide, 12), visual: clean(x.visual || j.imageBrief || '') })) } : as === 'video' ? { script: (j.script || []).slice(0, 5).map((x) => ({ beat: clean(x.beat), shot: clean(x.shot), line: short(x.line, 14) })), motion: clean(j.motion || '') } : { overlay: short(j.overlay, 7), imageBrief: clean(j.imageBrief || '') };
    if (as === 'carousel' && out.slides.length < 3) return null; if (as === 'video' && out.script.length < 3) return null;
    return { ...out, label: j.label };
  };
  const remakeWhy = (ch) => (ch.remakePending ? 'A remake is already being made.' : isMock() && !o.mediaFake ? 'Pictures and videos are off here, so this version has the words; make the media where AI is on.' : !imgMaker() ? 'This server can’t make pictures.' : 'The picture limit for today is used up. The words are here; make the media tomorrow.');
  /* the media, in the background: lands on the version it was made for, and on the stage if that version is still the head */
  /* rid: the remake's own tag on its draft. Versions made while the media is made copy that draft, so when it lands (or fails)
     every version and the stage holding the same rid get it, never only the one it started on */
  const remakeMedia = (t, ch, as, plan, target, rid = null) => {
    if ((isMock() && !o.mediaFake) || !imgMaker() || ch.remakePending) return false;
    /* a refusal by today's limits is said in the chat before anything is spent (it used to leave a silent "words only" version) */
    const no = as === 'video' && !spend('video') ? 'today’s video limit is used up' : !spend('image') ? 'today’s picture limit is used up' : null;
    if (no) { ch.remakeError = `The ${as} can’t be made right now: ${no}. The words are on the version.`; ch.thread.push({ from: 'ai', text: ch.remakeError, at: now(t) }); return false; }
    ch.remakePending = { as, at: Date.now(), step: 'Making the first picture' }; ch.remakeError = null; REMAKE_JOBS.add(ch.id);
    const step = (s) => { if (ch.remakePending) ch.remakePending.step = s; };
    (async () => {
      try {
        const c = t.cards.get(ch.cardId) || {}, src = await srcPhoto(t, ch, productFor(c, FACTS, pkgWords(ch))?.img); if (!src) throw new Error('no product photo could be read for it');
        /* our version of a rival's ad: its composition and look in words, with our product (rival-ad.js) */
        const rv = await rivalRead(t, c).catch(() => null);
        const lookLine = rv?.style ? ` ${rivalPicture(rv.ad, rv.style).visual}` : '';
        const ratio = as === 'video' ? '9:16' : RATIO[ch.pkg.format] && !(as === 'carousel' && ch.pkg.format === '9:16') ? ch.pkg.format : '4:5';
        let media;
        if (as === 'carousel') {
          const r = await slideMakers().carousel({ slides: plan.slides, src, ...(lookLine ? { lookLine } : {}), ratio, title: ch.after?.title || ch.actionLabel, cardTitle: c.title, id: ch.id + target, clean, canSpend: (i) => i === 0 || spend('image'), onStep: step });
          media = { images: r.slides.map((x) => x.image), ...(r.zip ? { zip: r.zip } : {}), ...(r.err ? { err: r.err } : {}) };
        } else {
          const brief = as === 'video' ? plan.script?.[0]?.shot || ch.pkg.imageBrief : plan.imageBrief;
          const prompt = `Create a new ${as === 'video' ? 'opening frame of a vertical 9:16 video' : `${ratio} photograph`} for ${BN()}. ${brief || 'The product on a clean surface, soft daylight.'} Keep the ${BN()} ${B()?.config?.product?.noun || 'product'} and its label exactly as in the reference photo; do not invent new text on the pack. Nothing else carries writing. No before/after. Photographic, natural light, the product clearly in frame.${lookLine}`;
          const key = crypto.createHash('sha1').update(prompt + ratio).digest('hex').slice(0, 16) + '.png';
          if (!(await genFile(key))) saveGen(key, await imgMaker()({ srcFile: src, prompt, ratio, text: [plan.overlay, ch.after?.title].filter(Boolean).join('. '), fallback: true }));
          media = { images: ['gen/' + key] };
          if (as === 'video') {
            step('Animating it, about a minute');
            let name = await makers().video(key, `Over 6 seconds: ${plan.motion || 'The camera slowly pushes in on the product.'}`, { ratio: '9:16', onStep: step });
            const hook = plan.script?.[0]?.line;
            if (hook && spend('voice')) { step('Adding the voiceover'); const au = await makers().voice(hook, 'warm and natural, like a creator talking to camera', 'Kore').catch((e) => { log.warn('[remake voice]', e.message); return null; });
              const both = au ? await makers().mux(name, au).catch((e) => { log.warn('[remake mux]', e.message); return null; }) : null; if (both) name = both; }
            Object.assign(media, { video: 'gen/' + name, poster: 'gen/' + key });
          }
        }
        const v = versionsOf(t, ch.id).find((x) => x.id === target), mine = (d0) => !!d0 && !!rid && d0.rid === rid, land = (d0) => ({ ...(d0 || v?.snapshot?.draft || ch.pkg.draft || {}), ...media, pending: false });
        for (const x of versionsOf(t, ch.id)) if (x.id === target || mine(x.snapshot?.draft)) x.snapshot = { ...x.snapshot, draft: land(x.snapshot?.draft) };
        if (headOf(t, ch)?.id === target || mine(ch.pkg.draft)) { ch.pkg = { ...ch.pkg, draft: land(ch.pkg.draft) }; try { mirror(t, ch, headOf(t, ch)); } catch {} }
        try { o.onMedia?.(t, ch, { kind: as, images: media.images || [], video: media.video || null, n: v?.n, label: REMAKE_AS[as], copy: (plan.slides || []).map((x, i) => `${i + 1}. ${x.onSlide}`).join('\n') || (plan.script || []).map((x) => x.line).join(' ') || '' }); } catch {}
        ch.thread.push({ from: 'ai', text: `${REMAKE_AS[as][0].toUpperCase() + REMAKE_AS[as].slice(1)} for ${v ? `v${v.n}` : 'this version'} is ready${media.err ? `. ${media.err}` : '.'}`, at: now(t) });
      } catch (e) {
        ch.remakeError = `The ${as} didn’t come through (${String(e.message).slice(0, 120)}). The words are on the version; make it again.`; log.warn('[remake]', as, e.message);
        ch.thread.push({ from: 'ai', text: ch.remakeError, at: now(t) }); /* said where the person is looking, not only on a field nothing shows */
        const mine = (d0) => !!d0 && !!rid && d0.rid === rid;
        for (const x of versionsOf(t, ch.id)) if ((x.id === target || mine(x.snapshot?.draft)) && x.snapshot?.draft) x.snapshot = { ...x.snapshot, draft: { ...x.snapshot.draft, pending: false } };
        if ((headOf(t, ch)?.id === target || mine(ch.pkg.draft)) && ch.pkg.draft) ch.pkg = { ...ch.pkg, draft: { ...ch.pkg.draft, pending: false } };
      } finally { ch.remakePending = null; REMAKE_JOBS.delete(ch.id); bump(t, ch); o.save?.(t); }
    })();
    return true;
  };
  const REMAKING = new Set();
  on('POST', '/api/changes/:chid/remake', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    return remakeOf(t, ch, String(b.as || '').toLowerCase());
  });
  /* the remake itself, shared by the chip and an OK'd ask from the jam (Brew or its Slack thread) */
  const remakeOf = async (t, ch, as) => {
    if (!REMAKE_AS[as]) return { status: 400, error: 'Remake as a video, a carousel or an image.' };
    /* a community post (Reddit, Quora, a Facebook group) takes real photos only: no AI reel, carousel or picture (the chips hide too) */
    if (realOnly(ch)) return { error: `${ch.pkg?.platform || 'This community'} takes real photos only, so it can’t be remade as ${REMAKE_AS[as]}. Pick one of your product photos instead.`, change: pubChange(t, ch) };
    if (ch.remakePending || REMAKING.has(ch.id)) return { error: 'A remake is already being made.', change: pubChange(t, ch) };
    /* a photo or video still being made would land as a newer version on top of the remake, built before its media existed */
    if (ch.imagePending || ch.videoPending) return { error: 'A photo for this draft is still being made. Try again in a minute.', change: pubChange(t, ch) };
    REMAKING.add(ch.id); /* held from before the AI call, so a double tap can't make two versions */
    let plan = null, live = false;
    try { if (!isMock() && claudeTool && spend('text')) { try { plan = await remakeLive(t, ch, as); live = !!plan; } catch (e) { log.warn('[remake words]', e.message); } } } finally { REMAKING.delete(ch.id); }
    plan ||= remakeRules(ch, as, t);
    const rid = uid('rk'), draft = { as, rid, title: ch.after?.title || ch.actionLabel, images: [], video: null, poster: null, ratio: as === 'video' ? '9:16' : ch.pkg.format || '4:5', text: false, remade: true, pending: false,
      ...(plan.slides ? { slides: plan.slides.map((x) => ({ text: x.onSlide, visual: x.visual })) } : {}), ...(plan.script ? { script: plan.script } : {}), ...(plan.overlay ? { overlay: plan.overlay } : {}), ...(plan.imageBrief ? { imageBrief: plan.imageBrief } : {}) };
    if (ch.pkg.image && as !== 'carousel') draft.images = [ch.pkg.image]; /* until the new picture lands, the version shows the one it was made from */
    ch.pkg = { ...ch.pkg, draft }; sync(t, ch);
    const v = version(t, ch, `ai:${ch.agent}`, `Remade as ${REMAKE_AS[as]}`, plan.label || `As ${REMAKE_AS[as]}`);
    const making = remakeMedia(t, ch, as, plan, v.id, rid);
    if (making) { ch.pkg.draft.pending = true; v.snapshot = { ...v.snapshot, draft: { ...draft, pending: true } }; }
    return { change: pubChange(t, ch), version: { id: v.id, n: v.n }, as, words: live ? 'ai' : 'package', making, why: making ? null : remakeWhy(ch), learned: learnedOut(t) };
  };
  /* the studio's finals (finals-routes.js createStudioFinals): status, quote, run and a Space checkpoint on this change; the
     result is the next version, labelled Final. Off when the server has no Sloosh client (tests) */
  const STUDIO_FINALS = o.finals && o.sloosh ? createStudioFinals({ headOf, useVersion, versionById: (t, ch, id) => versionById(t, ch.id, id), rivalOf: (t, ch, p) => rivalPic(t, ch, p) /* "Make our version": the final keeps the rival ad's composition, in words */, on, C, ensurePkg, sync, version, pubChange, cardOf: (t, ch) => t.cards.get(ch.cardId) || null, cardPhoto, catalogOf, jobs: IMG_JOBS, vidJobs: VID_JOBS /* a video final is a video job: C() never calls it stopped */, references: (t) => (o.references ? o.references(t) : []), finals: o.finals, sloosh: o.sloosh, creditsLeft: o.creditsLeft, brandOfT: o.brandOfT, slugOfT: o.slugOfT, meOf: o.meOf, onMedia: (t, ch, m) => o.onMedia?.(t, ch, m), isVideo: isVideoPost, RATIO, log }) : null;
  on('GET', '/api/changes/:chid/photos', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch);
    const cat = (catalogOf(t) || []).filter((x) => x.img).sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0)).slice(0, 60).map((x) => ({ t: x.t, img: x.img, ...(x.out ? { out: true } : {}) }));
    const ai = ['meta_ad', 'social', 'post'].includes(ch.family) && !realOnly(ch) && !!geminiImage && !isMock();
    const references = o.references ? await o.references(t).catch(() => []) : []; /* the brand's own References (references.js): same picker, numbered with the product photos */
    return { photos: cat, references, current: ch.pkg.photos || (ch.pkg.image ? [ch.pkg.image] : []), max: ch.family === 'post' ? 4 : 1, ai, aiWhy: ai ? null : realOnly(ch) ? `${ch.pkg.platform || 'This community'} wants real photos, not AI ones.` : isMock() ? 'AI is offline here.' : 'AI photos aren’t available for this one.', pending: !!ch.imagePending };
  });
  on('POST', '/api/changes/:chid/photo', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    if (b.ai) { if (b.brief) ch.pkg.imageBrief = clean(String(b.brief)).slice(0, 600); const started = genImage(t, ch, b.brief ? 'your brief' : 'a new take');
      if (!started) return { error: realOnly(ch) ? 'This community wants real photos: pick or upload one.' : ch.imagePending ? 'A photo is already being made.' : isMock() ? 'Images are off while AI is offline.' : 'No image budget left today.' };
      ch.thread.push({ from: 'ai', text: 'Making a new photo now. It lands as a new version in a minute.', at: now(t) }); return { change: pubChange(t, ch), image: true }; }
    let urls = Array.isArray(b.urls) ? b.urls.map(String).filter((u) => /^(https:\/\/|gen\/|b\/|assets\/)/.test(u) && !/\.\.|\\|\0/.test(u) && !isResearchImage(u)).slice(0, ch.family === 'post' ? 4 : 1) : []; /* a rival's poster is never our photo */
    if (b.upload) { const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/.exec(String(b.upload)); if (!m) return { error: 'Add a PNG, JPG or WebP photo.' };
      const buf = Buffer.from(m[3], 'base64'); if (buf.length > 8e6) return { error: 'That photo is over 8 MB.' };
      const name = `up-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${m[2] === 'jpeg' ? 'jpg' : m[2]}`; saveGen(name, buf); urls = [`gen/${name}`]; }
    if (!urls.length) return { error: 'Pick a photo first.' };
    ch.pkg = { ...ch.pkg, image: urls[0], photos: urls }; ch.imageError = null; sync(t, ch);
    const why = b.upload ? 'Your photo' : urls.length > 1 ? `${urls.length} product photos` : 'Product photo'; const nv = version(t, ch, 'you', why);
    ch.thread.push({ from: 'ai', text: `${why} in: that’s v${nv.n} on the left. The words stay the same.`, at: now(t) });
    signal(t, 'edit', { agent: ch.agent, changeId: ch.id, by: 'you', intent: 'photo' }, now(t));
    return { change: pubChange(t, ch) };
  });
  on('POST', '/api/changes/:chid/edit', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    const before = { ...ch.after };
    if (b.pkg) ch.pkg = { ...ch.pkg, ...cleanPkg(ch.family, ch.action, { ...ch.pkg, ...b.pkg }, clean), ...keepMedia(ch.pkg) };
    sync(t, ch); version(t, ch, 'you', b.reason || 'Your edit');
    signal(t, 'edit', { before, after: ch.after, agent: ch.agent, changeId: ch.id, by: 'you' }, now(t));
    return { change: pubChange(t, ch), learned: learnedOut(t) };
  });
  // use a version: move the pointer to it. No copy is made; your next change branches from it.
  on('POST', '/api/changes/:chid/restore', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' };
    if (!b.versionId) { (ch.batchKey ? Object.values(changes(t)).filter((x) => x.cardId === ch.cardId && x.batchKey) : [ch]).forEach((x) => delete x.discarded); /* no version: bring a discarded remix back */
      /* and the jam that went with it, unless the card has an open jam again */
      const w = (t.work || []).find((x) => x.discarded && x.discardedWith === ch.id);
      if (w && !(t.work || []).some((x) => x !== w && !x.discarded && x.cardId === w.cardId && !['shared', 'result', 'out'].includes(x.stage))) { delete w.discarded; delete w.discardedWith; w.updatedAt = now(t); }
      return { ok: true }; }
    ensurePkg(t, ch); const v = versionById(t, ch.id, b.versionId); if (!v) return { error: 'no version' };
    if (editable(ch)) return { error: 'It is live. Undo it first.' };
    useVersion(t, ch, v);
    return { change: pubChange(t, ch) };
  });
  /* options: a tab puts that option's newest version on the stage (/restore does the same, no copy is made); Use this one picks
     it, and the others fold away; opt null opens the choice again */
  on('POST', '/api/changes/:chid/options/pick', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); const op = optionsOf(t, ch); if (!op) return { error: 'There are no options to pick from here.' };
    if (b.opt == null) { ch.options.picked = null; return { change: pubChange(t, ch) }; }
    const it = op.list.find((x) => x.id === b.opt); if (!it) return { error: 'That option is gone.' };
    if (headOf(t, ch)?.id !== it.tip) { if (editable(ch)) return { error: 'It is live. Undo it first.' }; useVersion(t, ch, versionById(t, ch.id, it.tip)); }
    if (b.use !== false) ch.options.picked = it.id; o.save?.(t);
    return { change: pubChange(t, ch) };
  });
  // discard a remix (kept under Discarded, can be restored). Live or with Brew has to be undone or withdrawn first.
  const LIVEISH = ['running', 'live', 'deploy_team'];
  on('POST', '/api/changes/:chid/discard', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' };
    const set = ch.batchKey ? Object.values(changes(t)).filter((x) => x.cardId === ch.cardId && x.batchKey) : [ch];
    if (set.some((x) => LIVEISH.includes(x.state))) return { error: set.length > 1 ? 'Some of these ads are live. Undo them first.' : ch.state === 'deploy_team' ? 'It’s in a shared brief. Share a new version instead.' : 'It’s live. Undo it first, then discard it.' };
    set.forEach((x) => (x.discarded = now(t)));
    /* the studio is its jam's package: the jam goes with it, or opening the card reopens the package you just discarded */
    const ws = (t.work || []).filter((w) => !w.discarded && set.some((x) => x.id === w.changeId) && !['deploying', 'measuring'].includes(w.stage));
    ws.forEach((w) => { w.discarded = now(t); w.unread = false; w.discardedWith = ch.id; });
    return { ok: true, n: set.length, work: ws.map((w) => w.id) };
  });
  on('POST', '/api/changes/:chid/jam', async (b, t, p) => {
    const ch = C(t, p.chid); if (!ch) return { error: 'not found' };
    if (ch.workId) { const w0 = t.work.find((x) => x.id === ch.workId); if (w0 && !['result'].includes(w0.stage)) return { work: w0 }; }
    evaluate(t, ch); const c = t.cards.get(ch.cardId);
    const w = workFromChange(t, ch); w.plan = makePlan(t, c, ch); if (b.scope) w.plan.scope = +b.scope;
    if (b.scope && +b.scope > 1) w.plan.questions.unshift(qOf(t, 'scope_ok', `Run it on ${ch.scope.find((s) => s.n === +b.scope)?.label.toLowerCase()} at once?`, 'growth'));
    o.seedJam?.(t, w); // the Jam Room's living brief starts from this package
    addV(t, 'jam', w.id, planSnap(w.plan), { author: 'you', reason: `Jam opened from a remix${ch.reasons.length ? ': ' + ch.reasons[0] : ''}` });
    say(t, w, { from: 'system', body: `Jam opened. Goal: ${w.plan.goal}. ${w.plan.questions.filter((q) => !q.answer).length} open questions before it ships.` });
    ch.state = 'jam';
    signal(t, 'jam', { agent: ch.agent, action: ch.action, angle: ch.angle, intent: ch.intent, changeId: ch.id }, now(t));
    return { change: pubChange(t, ch), work: w, learned: learnedOut(t) };
  });
  // money, packaged as is: straight to the ShopOS team after your OK
  on('GET', '/api/tenants/:id/versions/:oid', async (b, t, p) => ({ versions: versionsOf(t, decodeURIComponent(p.oid)) }));
  on('GET', '/api/tenants/:id/learning', async (b, t) => ({ ...summary(t), recent: learnedOut(t) }));
  on('PUT', '/api/tenants/:id/learning/lessons/:lid', async (b, t, p) => {
    const l = L(t), x = l.lessons.find((y) => y.id === p.lid); if (!x) return { error: 'not found' };
    if (b.forget) { l.lessons = l.lessons.filter((y) => y !== x); return { ok: true }; }
    if (typeof b.on === 'boolean') x.on = b.on; if (typeof b.text === 'string' && clean(b.text).length >= 6) x.text = clean(b.text).slice(0, 200); return { ok: true, lesson: x };
  });
  on('POST', '/api/tenants/:id/learning/rules', async (b, t) => {
    const text = clean(String(b.text || '')).slice(0, 140); if (!text) return { error: 'empty' };
    const l = L(t); const r = { id: uid('rule'), k: 'you:' + slug(text), text, n: 1, evidence: [{ by: 'you', before: 'Taught directly', at: now(t) }], on: true, scope: b.agent || null, source: 'you', createdAt: now(t) };
    l.rules.unshift(r); addV(t, 'rule', r.id, { text, on: true }, { author: 'you', reason: 'Taught directly' }); return { rule: r };
  });
  on('PUT', '/api/tenants/:id/learning/rules/:rid', async (b, t, p) => {
    const l = L(t); const r = l.rules.find((x) => x.id === p.rid) || l.autoChecks.find((x) => x.id === p.rid); if (!r) return { error: 'not found' };
    if (b.forget) { l.rules = l.rules.filter((x) => x !== r); l.autoChecks = l.autoChecks.filter((x) => x !== r); if (r.k) { delete l.tags[r.k]; if (l.questions[r.k]) l.questions[r.k].n = 0; } addV(t, 'rule', r.id, { text: r.text || r.q, on: false, forgotten: true }, { author: 'you', reason: 'Forgotten' }); return { ok: true }; }
    if (typeof b.on === 'boolean') r.on = b.on; if (typeof b.text === 'string' && clean(b.text) && r.text != null) r.text = clean(b.text).slice(0, 140);
    addV(t, 'rule', r.id, { text: r.text || r.q, on: r.on }, { author: 'you', reason: typeof b.on === 'boolean' ? (b.on ? 'Turned on' : 'Turned off') : 'Edited' }); return { rule: r };
  });

  // jam plan
  const W = (t, id) => t.work.find((w) => w.id === id);
  on('POST', '/api/work/:wid/plan/answer', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' }; ensurePlan(t, w);
    const q = w.plan.questions.find((x) => x.id === b.qid); if (!q) return { error: 'no question' };
    answerQ(t, w, q, b.answer || 'Yes.', 'you'); return { work: w, learned: learnedOut(t) };
  });
  on('POST', '/api/work/:wid/plan/add', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' }; ensurePlan(t, w); const text = clean(String(b.q || '')).slice(0, 160); if (!text) return { error: 'empty' };
    w.plan.questions.push({ id: uid('q'), k: 'you:' + slug(text), q: text, owner: b.owner || 'ai', answer: null, by: null, auto: false, at: null, asked: false });
    addV(t, 'jam', w.id, planSnap(w.plan), { author: 'you', reason: `Asked: ${text}` }); return { work: w };
  });
  // Asking a person copies the question for them: Brew sends nothing and never answers for a teammate.
  const ask = async (t, w, q, email) => {
    if (q.answer || q.asked) return null;
    /* a real person on the team: they join the jam and get an email with the question (feed-service askPerson) */
    if (email && o.askPerson) { const x = await o.askPerson(t, w, q, email); if (x?.error) return x; if (x) { q.asked = true; q.waiting = x.name || x.email; q.ownerEmail = x.email; q.at = now(t); return { who: q.waiting, q: q.q, email: x.email }; } }
    if (q.owner === 'ai') { const a = await aiAnswer(t, w, q); if (!a) return null; answerQ(t, w, q, a, `ai:${w.agent}`); say(t, w, { from: 'ai', who: AGENT[w.agent], body: `${q.q} ${a}` }); return null; }
    if (q.owner !== 'brew' && process.env.DEMO_MODE !== '1') return null; /* a teammate's question waits for a real person to be picked: never a made-up colleague */
    if (q.owner === 'brew') o.onShopos?.(t, w, { why: 'asked the ShopOS team a question', text: q.q }); /* its inbox gets the question and the jam link */
    const who = q.owner === 'brew' ? 'ShopOS team' : colName(q.owner);
    q.asked = true; q.waiting = who; q.at = now(t);
    return { who, q: q.q };
  };
  on('POST', '/api/work/:wid/plan/ask', async (b, t, p) => {
    const w = W(t, p.wid); if (!w) return { error: 'not found' }; ensurePlan(t, w);
    const qs = b.all ? w.plan.questions.filter((x) => !x.answer) : w.plan.questions.filter((x) => x.id === b.qid);
    const asks = []; for (const q of qs) { const a = await ask(t, w, q, b.email); if (a?.error) return { error: a.error }; if (a) asks.push(a); }
    const copy = asks.length ? `${w.title}\n\n${asks.map((a) => `@${a.who}: ${a.q}`).join('\n')}` : null;
    return { work: w, learned: learnedOut(t), copy: asks.some((a) => a.email) ? null : copy, asked: asks.map((a) => a.who), emailed: asks.filter((a) => a.email).map((a) => a.email) };
  });

  const iterateFromJam = async (t, w, body) => {
    const ch = w.changeId && changes(t)[w.changeId]; if (!ch) return null; ensurePkg(t, ch);
    if (editable(ch)) return { error: editable(ch) };
    await iterate(t, ch, body);
    if (ANSWERED.has(ch)) return { change: pubChange(t, ch), answered: true }; /* a question: no new version in the jam either */
    const v = headOf(t, ch), row = (w.versions ||= []).find((x) => x.changeVersionId === v.id); /* version() mirrored it already: never twice */
    if (row) row.note = body.slice(0, 80); else w.versions.push({ n: v.n, title: ch.after.title, sub: ch.after.sub, images: ch.pkg.image ? [ch.pkg.image] : ch.after.images, by: 'ai', who: AGENT[ch.agent], note: body.slice(0, 80), at: now(t), changeVersionId: v.id, fromChange: true });
    w.current = v.n; w.title = ch.after.title; w.updatedAt = now(t);
    return { change: pubChange(t, ch) };
  };
  // picking a version in the jam moves the same pointer the studio uses
  const pickFromJam = (t, w, n) => { const ch = w.changeId && changes(t)[w.changeId]; if (!ch) return; const v = versionsOf(t, ch.id).find((x) => x.n === n); if (!v || editable(ch)) return; useVersion(t, ch, v); };
  /* an OK'd ask from the jam (in Brew or its Slack thread): remake in another form, or a new photo */
  const remakeFromJam = async (t, w, as) => { const ch = w.changeId && changes(t)[w.changeId]; if (!ch) return null; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) }; return remakeOf(t, ch, as); };
  const photoFromJam = (t, w, ask) => { const ch = w.changeId && changes(t)[w.changeId]; if (!ch) return null; ensurePkg(t, ch); if (editable(ch)) return { error: editable(ch) };
    if (!ch.imagePending) ch.pkg.imageBrief = clean(`${ch.pkg.imageBrief || ''} The team asked: ${ask}`).slice(-600);
    const started = genImage(t, ch, ask); return started ? { started: true } : { error: realOnly(ch) ? `${ch.pkg.platform || 'This place'} wants real photos, not AI ones.` : 'No new photo can be made for this one right now (AI is off, or today’s image limit is used up).' }; };
  /* a final Sloosh finished while Brew restarted (finals.reconcileAll → feed-service finalDone): the change's next version, labelled Final */
  const finalDone = (t, rec) => { const ok = STUDIO_FINALS?.landDone(t, rec) || false; if (ok) o.save?.(t); return ok; };
  /* v2 takes for the feed's pulse (updatedSince, healTakes) and for tests (the draws in flight) */
  const v2 = { updatedSince, healTakes, jobs: TAKE_JOBS, settle: async () => { while (TAKE_JOBS.size) await Promise.all([...TAKE_JOBS.values()].map((j) => j.run)); } }; /* a take's words job hands over to its picture job */
  return { remakeFromJam, photoFromJam, iterateFromJam, pickFromJam, makePlan, ensurePlan, planReady, onWorkVersion, pubChange, changes, packageOf, finalDone, v2, landMedia };
}
