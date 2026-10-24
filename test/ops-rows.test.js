// An ad account change names the account's own campaigns, says only the setting that changes, and a card about keeping
// past buyers out of ads opens as that audience change, never a Klaviyo flow or "Scale the budget" (Arata jam, 25 Oct)
import test from 'node:test';
import assert from 'node:assert/strict';
import { healOps, opsCheck, NO_CAMP } from '../ops-rows.js';
import { recipeOfCard } from '../remix.js';
import { budgetMatch } from '../budget-match.js';

const LEDGER = { member: true, liveLedger: { 'meta.campaigns.7d': { v: 'TOF_Mito-Preorder_Nitin-Joshi_Conversion: 1.6x return, ₹4,100 a day, frequency 2.1; TOF_Arata3.0_Conversion_Mito_Genetic: 1.2x return, ₹2,900 a day, frequency 3.4; BOF_Retargeting_All: 2.4x return, ₹1,200 a day, frequency 4.5' } } };
const card = { title: 'Exclude existing customers from creator-led campaign targeting', sub: 'Exclusions on creator campaigns to conserve budget.', rows: [['The team said', 'Branded content ads suffered fatigue as identical Nitin Joshi assets were heavily scaled']], agent: 'brew', type: 'idea' };
const aiRows = [{ name: 'Serum Roller Combo', now: 'Creator Content', next: 'Prospecting | Broad 22-45 | Reels | existing customers not excluded, budget as set today | exclude past purchasers, budget +20%' },
  { name: 'Serum Roller Combo', now: 'Creator Content', next: 'Prospecting | Advantage+ | existing customers not excluded | exclude past purchasers' }];

test('a card about keeping past buyers out of ads is an audience exclusion, for any brand', () => {
  for (const title of ['Exclude existing customers from creator-led campaign targeting', 'Stop showing creator ads to past buyers', 'Leave out existing customers from prospecting audiences', 'Suppress recent purchasers from Meta prospecting'])
    assert.equal(recipeOfCard({ title, agent: 'brew', type: 'idea' }).primary, 'performance.exclude_audience', title);
  for (const title of ['Exclude recent buyers from the win-back flow', 'Win back lapsed customers with WhatsApp', 'Send a review ask to customers'])
    assert.notEqual(recipeOfCard({ title, agent: 'brew', type: 'idea' }).primary, 'performance.exclude_audience', title);
});

test('rows that name a product become the account campaign the card is about, with only the setting that changes', () => {
  const ch = { family: 'meta_ops', action: 'performance.exclude_audience', pkg: { summary: 'Keep past buyers out', items: aiRows.map((x) => ({ ...x })) } };
  assert.equal(healOps(LEDGER, ch, card), true);
  assert.equal(ch.pkg.items.length, 1, 'the same product twice is one campaign');
  assert.equal(ch.pkg.items[0].name, 'TOF_Mito-Preorder_Nitin-Joshi_Conversion');
  assert.equal(ch.pkg.items[0].now, 'Past buyers can see it'); assert.equal(ch.pkg.items[0].next, 'exclude past purchasers, budget +20%');
  assert.equal(healOps(LEDGER, ch, card), false, 'healing again changes nothing');
  assert.match(opsCheck(LEDGER, ch).k, /Brew matched this campaign/); assert.equal(opsCheck(LEDGER, ch).soft, true);
});

test('with no account connected the row asks for the campaign instead of guessing one', () => {
  const ch = { family: 'meta_ops', action: 'performance.scale_budget', pkg: { items: [{ name: 'Serum Roller Combo', now: 'As set today', next: 'Budget up 20%' }] } };
  healOps({}, ch, card); assert.equal(ch.pkg.items[0].name, NO_CAMP);
  const oc = opsCheck({}, ch); assert.equal(oc.soft, true); assert.match(oc.k, /Connect Meta/);
  assert.notEqual(budgetMatch(card, ch, LEDGER)?.ok, false, 'a row waiting for its name is not called a made-up campaign');
});

test('a row no campaign matches asks the team to name it, with the account’s campaigns as examples', () => {
  const ch = { family: 'meta_ops', action: 'performance.pause_losers', pkg: { items: [{ name: 'Holiday gift sets', now: 'Running', next: 'Paused' }] } };
  healOps(LEDGER, ch, { title: 'Pause the gift sets' }); assert.equal(ch.pkg.items[0].name, 'Pick the campaign');
  const oc = opsCheck(LEDGER, ch); assert.equal(oc.fix, true); assert.match(oc.k, /TOF_Mito-Preorder/);
});

test('real campaign names, product-row actions and the card’s own budget move are left alone', () => {
  const ch = { family: 'meta_ops', action: 'performance.scale_budget', pkg: { items: [{ name: 'BOF_Retargeting_All', now: '₹1,200 a day', next: '₹1,440 a day' }] } };
  assert.equal(healOps(LEDGER, ch, card), false);
  const stock = { family: 'meta_ops', action: 'performance.pause_pointing', pkg: { items: [{ name: 'Ads that send people to Curl Gel', now: 'Running', next: 'Paused' }] } };
  assert.equal(healOps(LEDGER, stock, card), false);
  const moved = { family: 'meta_ops', action: 'performance.shift_budget', pkg: { items: [{ name: 'Founder video', now: 'x', next: 'y' }] } };
  assert.equal(healOps(LEDGER, moved, { shift: { from: 'Founder video', to: 'B' } }), false);
});
