// node --test test/channel-fit.test.js — where a card's work goes out (channel-fit.js), and the two setup terms of the ranker
// (feed-service score(): chan, pace). Free: no AI, no network. Brand-agnostic samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toolOf, channelsOf, channelFit, paceFit, isNewAd, isGroundwork, cleanViewer, CHANNELS, VOICES as CF_VOICES } from '../channel-fit.js';
import { VOICES } from '../brand-memory.js';

/* the old feed-service deployTarget, copied as it was before the move (2026-10-19), to prove toolOf + the new wrapper agree */
const oldDeployTarget = (SEED) => {
  const NEEDS = { 'Queue the 12': 'meta', 'Publish Campaign': 'meta', 'Shift budget': 'meta', 'Rotate creative': 'meta', 'Apply the plan': 'meta', 'Run Monday decisions': 'meta', 'Lock the Diwali set': 'meta',
    'Update landing page': 'shopify', 'Apply Update': 'shopify', 'Turn on guest checkout': 'shopify', 'Approve 6 popups': 'shopify', 'Publish the page': 'shopify', 'Approve the 3 offers': 'shopify', 'Approve the ladder': 'shopify',
    'Push 5 titles': 'marketplaces', 'Draft the listing': 'marketplaces', 'Send on WhatsApp': 'whatsapp', 'Turn on the journey': 'whatsapp', 'Send the review ask': 'loox',
    'Launch the ad group': 'google', 'Fix tracking': 'google', 'Approve the flows': 'klaviyo', 'Swap the images': 'meta', 'Pause those ads': 'meta',
    'Queue the ads': 'meta', 'Approve the offers': 'shopify', 'Push the titles': 'shopify' };
  /* labels a generated brand's cards use that the map does not know: the card's own words name the tool before its section does */
  const toolInWords = (c) => { const s = `${c?.title || ''} ${c?.sub || ''}`; return /\b(meta|facebook|instagram|reels?)\b/i.test(s) ? 'meta' : /\bgoogle (ads|search|shopping)\b|\bsearch ads?\b/i.test(s) ? 'google' : /\b(klaviyo|email flow|newsletter)\b/i.test(s) ? 'klaviyo' : null; };
  /* labels that are a decision, a review, research or people work: nothing to run on an account */
  const NO_TOOL = new Set(['Agree with the call', 'Open the moves', 'Open the scoreboard', 'Review draft', 'Brief the shoot', 'Shortlist creators', 'Draft the buyer deck', 'Fix tracking', 'Fix the markup']);
  /* a label that only fits some cards: it names its tool when the card's words agree, else nothing runs */
  const IF_WORDS = { 'Draft the listing': [/\b(amazon|myntra|nykaa|flipkart|ajio|tata cliq|marketplace|listing)\b/i, 'marketplaces'], 'Approve the flows': [/\b(email|flow|klaviyo|newsletter|win-?back|welcome|post-purchase|abandon)\b/i, 'klaviyo'], 'Turn on the journey': [/\b(whatsapp|message|journey|reminder|alert|nudge)\b/i, 'whatsapp'] };
  const deployTarget = (label, card) => { const mf = card?.mf || null, ai = mf?.by === 'ai' && mf.tool ? mf.tool : null, iw = IF_WORDS[label];
    let k = ai ? (ai === 'none' ? null : ai === 'reviews' ? 'loox' : ai) : NO_TOOL.has(label) ? null : iw ? (iw[0].test(`${card?.title || ''} ${card?.sub || ''}`) ? iw[1] : null) : NEEDS[label] || toolInWords(card) || (card?.sector === 'creatives' || card?.sector === 'ads' ? 'meta' : card?.sector === 'storefront' ? 'shopify' : null); if (k === 'loox' && !SEED.connectors.loox) k = SEED.connectors.reviews ? 'reviews' : null; return k && SEED.connectors[k] ? { conn: k, name: SEED.connectors[k].name } : { conn: null, name: 'Brew' }; };

  return deployTarget;
};
const newDeployTarget = (SEED) => (label, card) => { let k = toolOf(label, card); if (k === 'loox' && !SEED.connectors.loox) k = SEED.connectors.reviews ? 'reviews' : null; return k && SEED.connectors[k] ? { conn: k, name: SEED.connectors[k].name } : { conn: null, name: 'Brew' }; };

const card = (x = {}) => ({ id: 'c1', title: 'A card', sub: 'Some words', type: 'idea', sector: 'signals', ...x });
const set = (s) => [...s].sort();

test('toolOf + the deployTarget wrapper give exactly what the old deployTarget gave, on many samples', () => {
  const seeds = [{ connectors: { shopify: { name: 'Shopify' }, meta: { name: 'Meta' }, google: { name: 'Google Ads' }, klaviyo: { name: 'Klaviyo' }, reviews: { name: 'Judge.me' }, marketplaces: { name: 'Marketplaces' } } },
    { connectors: { meta: { name: 'Meta' }, loox: { name: 'Loox' }, whatsapp: { name: 'WhatsApp' } } }, { connectors: {} }];
  const labels = ['Queue the 12', 'Shift budget', 'Update landing page', 'Draft the listing', 'Approve the flows', 'Turn on the journey', 'Send the review ask', 'Fix tracking', 'Agree with the call', 'Generate versions', 'Make the video', 'Draft the post', 'Launch the ad group', 'Push the titles', undefined, 'Something new'];
  const cards = [card(), card({ sector: 'creatives' }), card({ sector: 'ads' }), card({ sector: 'storefront' }), card({ title: 'Win-back email flow for lapsed buyers' }), card({ title: 'New Instagram reel hook' }),
    card({ sub: 'Google Ads search terms are wasting spend' }), card({ title: 'Amazon listing titles' }), card({ title: 'WhatsApp reminder on reorder day' }),
    card({ mf: { by: 'ai', tool: 'reviews' } }), card({ mf: { by: 'ai', tool: 'none' } }), card({ mf: { by: 'ai', tool: 'klaviyo' } }), card({ mf: { by: 'words', tool: 'meta' }, sector: 'storefront' }), null, undefined];
  let n = 0;
  for (const S of seeds) { const a = oldDeployTarget(S), b = newDeployTarget(S); for (const l of labels) for (const c of cards) { assert.deepEqual(b(l, c), a(l, c), `${l} / ${JSON.stringify(c)}`); n++; } }
  assert.ok(n > 600);
  const s = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.match(s, /const deployTarget = \(label, card\) => \{ let k = toolOf\(label, card\);/, 'feed-service uses toolOf');
  assert.doesNotMatch(s, /const NEEDS = \{/, 'the maps live in channel-fit.js only');
});

test('toolOf without the section guess: a creatives or storefront card names no tool from its section alone', () => {
  assert.equal(toolOf('Generate versions', card({ sector: 'creatives' })), 'meta');
  assert.equal(toolOf('Generate versions', card({ sector: 'creatives' }), { sectorFallback: false }), null);
  assert.equal(toolOf('Something', card({ sector: 'storefront' }), { sectorFallback: false }), null);
  assert.equal(toolOf('Queue the ads', card(), { sectorFallback: false }), 'meta', 'the label still counts');
});

test('channelsOf: by make format family first', () => {
  for (const f of ['instagram post', 'instagram carousel', 'instagram stories', 'reel']) assert.deepEqual(set(channelsOf(card({ make: { format: f } }))), ['instagram'], f);
  for (const f of ['single image ad', 'carousel ad', 'collection ad', 'catalog ad', 'video ad']) assert.deepEqual(set(channelsOf(card({ make: { format: f } }))), ['facebook', 'instagram'], f);
  assert.deepEqual(set(channelsOf(card({ make: { format: 'email' }, cta: { label: 'Approve the flows' } }))), ['email']);
  assert.deepEqual(set(channelsOf(card({ make: { format: 'whatsapp message' } }))), ['whatsapp']);
  assert.equal(channelsOf(card({ make: { format: 'page section' }, cta: { label: 'Queue the ads' } })).size, 0, 'a page section fits every channel, whatever its button says');
  assert.deepEqual(set(channelsOf(card({ make: { format: 'Video Ad' } }))), ['facebook', 'instagram'], 'case does not matter');
});

test('channelsOf: then the button\'s tool, never the section', () => {
  assert.deepEqual(set(channelsOf(card({ cta: { label: 'Shift budget' } }))), ['facebook', 'instagram']);
  assert.deepEqual(set(channelsOf(card({ cta: { label: 'Launch the ad group' } }))), ['google']);
  assert.deepEqual(set(channelsOf(card({ cta: { label: 'Approve the flows' }, title: 'Welcome email flow' }))), ['email']);
  assert.deepEqual(set(channelsOf(card({ cta: { label: 'Turn on the journey' }, title: 'WhatsApp reminder' }))), ['whatsapp']);
  assert.deepEqual(set(channelsOf(card({ cta: { label: 'Draft the listing' }, title: 'Amazon listing fix' }))), ['marketplace']);
  assert.deepEqual(set(channelsOf(card({ cta: { label: 'Something' }, mf: { by: 'ai', tool: 'google' } }))), ['google']);
  assert.equal(channelsOf(card({ cta: { label: 'Update landing page' } })).size, 0, 'the store is every channel');
  assert.equal(channelsOf(card({ cta: { label: 'Generate versions' }, sector: 'creatives' })).size, 0, 'no section guess');
  assert.equal(channelsOf(card({ cta: { label: 'Agree with the call' } })).size, 0);
});

test('channelsOf: reports, rival cards, research and live readings fit everyone', () => {
  const ad = { make: { format: 'video ad' }, cta: { label: 'Queue the ads' } };
  for (const x of [{ type: 'report' }, { type: 'competitor' }, { research: { kind: 'ad' } }, { liveOnly: true }, { liveSrc: { kind: 'catalog' } }, { origin: 'live' }])
    assert.equal(channelsOf(card({ ...ad, ...x })).size, 0, JSON.stringify(x));
  assert.equal(channelsOf(null).size, 0);
});

test('channelFit: -8 only when they named channels and the card is only on others', () => {
  const ig = card({ make: { format: 'reel' } }), mail = card({ make: { format: 'email' } }), page = card({ make: { format: 'page section' } }), rep = card({ type: 'report', make: { format: 'email' } });
  assert.equal(channelFit(undefined, ig), 0); assert.equal(channelFit([], ig), 0); assert.equal(channelFit(null, mail), 0);
  assert.equal(channelFit(['instagram'], ig), 0); assert.equal(channelFit(['instagram'], mail), -8);
  assert.equal(channelFit(['email', 'whatsapp'], mail), 0); assert.equal(channelFit(['facebook'], card({ make: { format: 'carousel ad' } })), 0);
  assert.equal(channelFit(['google'], page), 0); assert.equal(channelFit(['google'], rep), 0);
});

test('paceFit: new ads and groundwork, by how many ads they ran last month', () => {
  const ad = card({ make: { format: 'single image ad' } }), adCta = card({ cta: { label: 'Queue the ads' } }), shift = card({ cta: { label: 'Shift budget' } });
  const ground = [card({ sector: 'storefront' }), card({ sector: 'catalog' }), card({ sector: 'visibility' }), card({ make: { format: 'page section' } }), card({ cta: { label: 'Fix tracking' } }), card({ mf: { family: 'foundations' } })];
  const other = card({ make: { format: 'instagram post' } });
  assert.ok(isNewAd(ad) && isNewAd(adCta)); assert.ok(!isNewAd(shift), 'moving budget is not a new ad'); assert.ok(!isNewAd(other));
  ground.forEach((g, i) => assert.ok(isGroundwork(g), `groundwork ${i}`));
  assert.ok(!isGroundwork(card({ sector: 'storefront', make: { format: 'video ad' } })), 'an ad is never groundwork');
  assert.ok(!isNewAd(card({ type: 'competitor', make: { format: 'video ad' } })), 'a rival card is not work');
  const W = { none: [-3, 4], few: [0, 2], ten: [2, 0], always: [4, 0] };
  for (const [p, [a, g]] of Object.entries(W)) { assert.equal(paceFit(p, ad), a, p); assert.equal(paceFit(p, adCta), a, p); for (const x of ground) assert.equal(paceFit(p, x), g, p); assert.equal(paceFit(p, other), 0, p); }
  assert.equal(paceFit(undefined, ad), 0); assert.equal(paceFit('lots', ground[0]), 0);
});

test('cleanViewer keeps only the setup answers it knows, and passes the rest of the viewer through', () => {
  const v = cleanViewer({ role: 'growth', lane: 'x', channels: ['instagram', 'tiktok', 'email', 'instagram', 'google', 'whatsapp'], adPace: 'few', perDay: '5', tools: ['shopify', 'nope', 'meta'], teamSize: 'me', voice: 'warmer' }, { tools: ['shopify', 'meta', 'klaviyo'] });
  assert.deepEqual(v, { role: 'growth', lane: 'x', channels: ['instagram', 'email', 'google'], adPace: 'few', perDay: 5, tools: ['shopify', 'meta'], teamSize: 'me', voice: 'warmer' });
  const bad = cleanViewer({ channels: 'instagram', adPace: 'lots', perDay: 7, tools: {}, teamSize: 'army', voice: 'shouty', role: 'brand' });
  assert.deepEqual(bad, { role: 'brand' }, 'a bad answer is dropped, so the saved one stays');
  assert.deepEqual(cleanViewer({ channels: null, voice: null }), { channels: null, voice: null }, 'null clears');
  assert.deepEqual(cleanViewer(undefined), {}); assert.deepEqual(cleanViewer([1]), {});
  assert.deepEqual(CHANNELS, ['instagram', 'facebook', 'google', 'email', 'whatsapp', 'marketplace']);
  assert.deepEqual(CF_VOICES, VOICES, 'the viewer whitelist and the voice route take the same voices');
});

test('score() adds chan + pace and returns both; PUT /state and a new tenant whitelist the answers', () => {
  const s = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.match(s, /const chan = channelFit\(v\.channels, c\), pace = paceFit\(v\.adPace, c\);/);
  assert.match(s, /const total = val \+ seat \+ aff \+ fresh \+ fatigue \+ fb \+ extra \+ behind \+ tune \+ lift \+ contra \+ chan \+ pace;/);
  assert.match(s, /extra, chan, pace, total:/, 'the scored item carries chan and pace for the reasons line');
  assert.match(s, /t\.viewer = \{ \.\.\.t\.viewer, \.\.\.cleanViewer\(b\.viewer,/);
  assert.match(s, /lane: firstLane\(\), \.\.\.cleanViewer\(snap\.viewer,/);
});
