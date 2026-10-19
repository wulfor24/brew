// The jam tells the card's story from the first second (Param, 19 Oct: "is this writing first draft coherent with the story
// that we sell on each card?"). The starting package is the card's line with the product's facts, said once and cleaned of
// the site's footnote marks; its picture brief is the card's scene; the jam's name and the pack follow what the card asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runIn } from '../brand-ctx.js';
import { mockPkg, cleanClaim, cardHook, isAdVideo, namesLiveTest } from '../studio.js';
import { sceneOf } from '../product-match.js';
import { labelFor } from '../remix.js';

const CLAIM = 'As per clinical trials, 87% people had increased hair growth in 84 days 1 and hair fall was reduced by up to 95% 2 ..';
const BRAND = { slug: 'arata', name: 'Arata', host: 'arata.in', sym: '₹', config: { product: { noun: 'serum' } }, seed: { brand: { name: 'Arata', host: 'arata.in' } },
  catalog: [{ t: 'MitoActive Mitochondrial Hair Growth Serum - 30 ml', price: '₹1,499', claim: CLAIM, url: 'https://arata.in/mitoactive' }] };
const IDEA = { id: 'w1', agent: 'creative', sector: 'creatives', type: 'idea', title: 'Energise your hair follicles with our ₹1,499 serum',
  sub: 'Buyers want faster growth without a heavy, greasy feel. Our MitoActive serum gives follicles cellular energy.',
  detail: { why: ['Overcomes worries about heavy oils.'], how: ['Design a split-screen layout contrasting heavy oils with light serum.', 'Highlight the mitochondrial energy claim in bold, clean typography.', 'Direct users straight to the product page.'] }, cta: { label: 'Generate versions' } };
const AUTOMATION = { id: 'm1', agent: 'creative', sector: 'creatives', title: 'Refresh MitoActive serum video hooks weekly', sub: 'Brew saw 8 new video ads in the last 30 days. Replace the first seconds of your top video to keep your ad costs low.', cta: { label: 'Make the video' }, plan: { steps: ['Export the Meta Ads creative reports on Monday morning'] } };

test('a site claim loses its footnote marks; counts that are part of the words stay', () => {
  assert.equal(cleanClaim(CLAIM), 'As per clinical trials, 87% people had increased hair growth in 84 days and hair fall was reduced by up to 95%.');
  assert.equal(cleanClaim('Pack of 2. Buy 2, get 1 free. Day 1 results.'), 'Pack of 2. Buy 2, get 1 free. Day 1 results.');
});

test('the card scene comes from make.pieces, else the how-step that describes the picture', () => {
  assert.equal(sceneOf(IDEA), 'split-screen layout contrasting heavy oils with light serum');
  assert.equal(sceneOf({ detail: { how: ['Highlight the claim in bold typography.', 'Run it to the product page.'] } }), '');
  assert.equal(sceneOf({ make: { pieces: '1 static image: a nurse on a bench, headline Warm' }, detail: IDEA.detail }), 'a nurse on a bench');
});

test('the starting Meta ad tells the card’s story: its line, the claim once, no footnotes, the card’s scene in the picture brief', () => {
  const p = runIn(BRAND, () => mockPkg('meta_ad', 'creative.add_variants', IDEA, 0, '', {}));
  assert.match(p.headline, /^Energise your hair follicles/);
  assert.ok(!/\b1 and\b|95% 2|\.\./.test(p.primaryText), p.primaryText);
  assert.equal((p.primaryText.match(/clinical trials/g) || []).length, 1, p.primaryText);
  assert.match(p.imageBrief, /split-screen layout contrasting heavy oils with light serum/);
  assert.ok(p.headline.length <= 40 && !/₹1$/.test(p.headline), `cut at a word: ${p.headline}`);
});

test('with no card line a shopper could read, the hook is the product’s first claim and the body never repeats it', () => {
  const p = runIn(BRAND, () => mockPkg('meta_ad', 'creative.add_variants', { ...IDEA, title: 'Refresh the MitoActive ads' }, 0, '', {}));
  assert.equal((p.primaryText.match(/As per clinical trials/g) || []).length, 1, p.primaryText);
  assert.equal(cardHook({ title: 'Lead the ads with comfort and story' }), '');
});

test('the jam is named for what the card asked: new ads unless a test runs; a video card about paid ads is a Meta video ad', () => {
  assert.equal(labelFor('creative.add_variants', IDEA).label, 'Make new ads');
  assert.equal(labelFor('creative.add_variants', { ...IDEA, sub: 'Add three hooks to the live test on Meta.' }).label, 'Add to the live test');
  assert.ok(namesLiveTest({ title: 'x', images: ['a', 'b', 'c'] }), 'a batch card is its test');
  assert.ok(isAdVideo(AUTOMATION));
  const lf = labelFor('creative.short_video', AUTOMATION); assert.equal(lf.label, 'Make the video ad'); assert.equal(lf.target.name, 'Meta Ads'); assert.match(lf.spec, /Ads Manager/);
  assert.equal(labelFor('creative.short_video', { title: 'Post the size-worry Reel', make: { format: 'reel' }, sub: 'Our Meta ads say the same' }).label, 'Make the short video', 'a reel stays a reel');
  assert.equal(labelFor('creative.short_video', { title: 'x', post: { platform: 'youtube' } }).label, 'Make the short video', 'an idea from the stream stays organic');
});

// Param, 19 Oct: "it still shows making 3 variations - ensure this issue is not still there across the entire feed app", and
// "ensure it doesn't even come up in jam brief case": nothing a person reads offers several versions to pick from
test('no screen, case or brief offers several versions to pick from', async () => {
  const fs = await import('node:fs');
  const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const app = read('public/app.js'), brief = read('jam-brief.js'), canvas = read('public/canvas.js'), plan = read('card-plan.js');
  for (const bad of ['Making three variations', 'Writing three complete packages', 'Make 3 variations', 'Try 3 versions', 'Draft three reel hooks']) assert.ok(!app.includes(bad) && !canvas.includes(bad), bad);
  assert.ok(!brief.includes('Other options'), 'the brief carries the one way forward');
  assert.match(plan, /export const PLAN_V = 2;/, 'plans saved before one-always rebuild');
  assert.match(app, /const optTabs = \(ch, viewing\) => \{ const op = null;/, 'no option tabs, even on old jams');
});
