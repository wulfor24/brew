// Where a piece goes decides what it is (design-partner audit, 25 Oct): a Reddit, Quora, forum or group post is never an
// Instagram post, a printed card never an image ad; a Reddit thread that is only the evidence keeps the Instagram piece
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCta, fitMedium, inferMake } from '../cards-gen.js';

const card = (o) => ({ id: 'm1-1', type: 'idea', sector: 'signals', ...o });

test('a post that goes to Reddit, a forum or Quora drops its Instagram format and keeps a post button', () => {
  const ask = fitCta(card({ title: 'Ask local buyers how they verify builder trust', sub: 'We saw 41 public mentions. This Reddit post helps us uncover what site-visit evidence works.', make: { format: 'instagram post', pieces: '' }, cta: { label: 'Draft the post' }, detail: { how: ['Post the question on active real estate subreddits'] } }));
  assert.equal(ask.make, undefined); assert.equal(ask.medium, 'community'); assert.equal(ask.makeDropped, 'instagram post'); assert.equal(ask.cta.label, 'Draft the post');
  const answer = fitCta(card({ title: 'Answer collagen doubts on Reddit with clinical facts', sub: 'Buyers ask on Reddit.', make: { format: 'instagram post', pieces: '4:5 post: the collagen jar' }, cta: { label: 'Draft the post' } }));
  assert.equal(answer.make, undefined); assert.equal(answer.cta.label, 'Reply as the brand');
  const forum = fitCta(card({ title: 'Ask East Bengaluru buyers what clauses secure their booking', sub: 'Refund delays in reviews.', make: { format: 'instagram post', pieces: '' }, cta: { label: 'Draft the post' }, plan: { steps: ['Publish the tailored question in the three chosen real estate forums'] } }));
  assert.equal(forum.medium, 'community');
  assert.equal(inferMake(forum), null, 'the format never comes back from the button');
});

test('a Reddit thread as evidence, or Instagram named anywhere, keeps the Instagram piece', () => {
  const carousel = card({ title: 'Take control of East Bengaluru comparison threads', sub: 'We saw buyers on Reddit comparing projects. Let us post a transparent comparison carousel.', make: { format: 'instagram carousel', pieces: '5 slides' }, cta: { label: 'Draft the carousel post' }, detail: { how: ['Draft comparison slides', 'Publish to Instagram feed'] } });
  assert.equal(fitMedium(JSON.parse(JSON.stringify(carousel))).make.format, 'instagram carousel');
  const stories = card({ title: 'Build trust with a pinned legitimacy highlight', sub: 'A Reddit thread asks about authenticity. We will publish interactive Instagram Q&A stories.', make: { format: 'instagram stories', pieces: '4 frames' }, cta: { label: 'Draft the stories' } });
  assert.equal(fitMedium(JSON.parse(JSON.stringify(stories))).make.format, 'instagram stories');
  const reel = card({ title: 'Answer first flat anxiety with an unedited walkthrough', sub: 'A Reddit thread asks for a review.', make: { format: 'reel', pieces: '9:16 reel' }, cta: { label: 'Make the video' } });
  assert.equal(fitMedium(JSON.parse(JSON.stringify(reel))).make.format, 'reel', 'a reel is never a community post');
});

test('a printed card is a print piece with its own button, never an image ad', () => {
  const p = fitCta(card({ title: 'Print a tracker card so the 90 days feel like a plan', sub: 'A card with weekly ticks.', make: { format: 'single image ad', pieces: '' }, cta: { label: 'Make the ad' }, sector: 'creatives' }));
  assert.equal(p.make, undefined); assert.equal(p.medium, 'print'); assert.equal(p.cta.label, 'Draft the print card');
  assert.equal(inferMake(p), null);
  const ad = fitCta(card({ title: 'Launch a founder story static ad', sub: 'One static ad.', make: { format: 'single image ad', pieces: '1 static: founder' }, cta: { label: 'Make the ad' } }));
  assert.equal(ad.make.format, 'single image ad');
});

test('the jam opens a printed card as a print insert', async () => {
  const { titleJob } = await import('../remix.js');
  assert.equal(titleJob({ title: 'Print a tracker card so the 90 days feel like a plan' }, 'Draft the print card'), 'crm.print_insert');
  assert.equal(titleJob({ title: 'Print a tracker card so the 90 days feel like a plan' }, 'Make the ad'), 'crm.print_insert');
});
