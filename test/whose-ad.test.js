// FEED-NOT-02: every ad says whose it is. A rival's ad card: "Seen on <rival>"; once our version is drawn on it: "Our version
// of <rival>'s ad" (the studio, the jam and the Work board say the same); an ad of ours: "Made for you". Saved cards with no
// rivalName still say the rival, from the make line or the ad card's title. The client helpers are read from app.js as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('  const AD_FORMATS = '), src.indexOf('  const fromLabel = '));
const { whoseAd, ourVersionOf } = new Function(`${block}; return { whoseAd, ourVersionOf, rivalOf };`)();

test('a rival ad says it was seen on that rival; our version on it says so; our own ads say Made for you', () => {
  const rival = { id: 'r-ad-1', type: 'competitor', sector: 'ads', kind: 'media', images: ['research/ads/1.jpg'], title: 'Traya: live 40 days in 3 versions', research: { kind: 'ad', id: '1' }, make: { format: 'single image ad', what: 'Our version of Traya’s image ad', from: 'rival' }, rivalName: 'Traya' };
  assert.equal(whoseAd(rival), 'Seen on Traya');
  assert.equal(whoseAd({ ...rival, rivalName: undefined }), 'Seen on Traya', 'a saved card: the name from the make line');
  assert.equal(whoseAd({ ...rival, rivalName: undefined, make: { format: 'single image ad' } }), 'Seen on Traya', 'or from the title');
  assert.equal(whoseAd({ ...rival, take: { image: 'gen/x.png' } }), 'Our version of Traya’s ad', 'our version drawn on it');
  assert.equal(whoseAd({ ...rival, draft: { images: ['gen/y.png'] } }), 'Our version of Traya’s ad');
  assert.equal(whoseAd({ id: 'static-1', kind: 'media', images: ['statics/1.png'], make: { format: 'single image ad' } }), 'Made for you');
  assert.equal(whoseAd({ id: 'static-2', kind: 'media', images: ['statics/2.png'] }), 'Made for you', 'a finished static is ours');
  assert.equal(whoseAd({ id: 'm1', kind: 'rows', make: { format: 'email' } }), '', 'not an ad: the card keeps its own source line');
  assert.equal(whoseAd({ id: 'm30-2', kind: 'media', images: ['/b/x/a/pack.png'], make: { format: 'catalog ad' } }), '', 'a card that only asks for an ad shows a stand-in photo: not made yet');
  assert.equal(whoseAd({ id: 'm30-2', kind: 'media', images: ['/b/x/a/pack.png'], make: { format: 'catalog ad' }, draft: { images: ['gen/d.png'] } }), 'Made for you', 'a first draft Brew drew is');
  assert.equal(ourVersionOf(''), 'Our version of a rival’s ad');
});

test('the studio header, the Work board and the feed all use it', () => {
  assert.match(src, /const fromLabel = \(c = \{\}\) => \{\n\s*const r = c\.research\?\.kind, wa = whoseAd\(c\); if \(wa\) return wa;/);
  assert.equal((src.match(/For: \$\{esc\(cutW\(cardOf\(RX\.p\)\.title, 90\)\)\}<\/button> · ` : ''\}\$\{studioFrom\(ch\)\}/g) || []).length, 1, 'the studio header: what it is for, then whose');
  assert.match(src, /rv = rivalOf\(c\), wa = rv \? ourVersionOf\(rv\.name\) : whoseAd\([^\n]*wb-whose/, 'the Work board: rival, else Made for you (final QA pass 19 Oct)');
  assert.match(fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8'), /rivalName: a\.brand/);
});
