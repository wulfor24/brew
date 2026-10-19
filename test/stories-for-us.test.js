// QA 19 Oct (FEED-ARV-10, FEED-NOT-07, FEED-QA-28, STO-05/06): every rival and news story ends on one line for the brand and
// one button; empty rings are hidden (the brand's own stays); trend slides name the brand's market, never a hard-coded one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newsForUs, adForUs } from '../for-us.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), fsvc = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');

test('a story with no written take still says what it means for the brand, read from the story', () => {
  assert.match(newsForUs({ h: 'Rival raises $20 million' }, 'Allbirds'), /fresh money/);
  assert.match(newsForUs({ h: 'X launches a new serum line' }, 'Arata'), /Arata's is the one to pick/);
  assert.match(newsForUs({ h: 'Something else entirely' }, 'Glossier'), /^Turn this into one idea for Glossier's next ad or page\.$/);
  assert.match(adForUs({ brand: 'Hoka', format: 'video' }, 'Allbirds'), /Hoka's angle as a video with Allbirds's own product/);
});

test('news slides get a For line and one button that makes a card; the story link is quiet', () => {
  assert.match(fsvc, /forUs: x\.take \|\| newsForUs\(x, BN\(\)\)/);
  assert.match(fsvc, /if \(kind === 'news'\)/, 'the news slide button makes a card');
  assert.match(app, /data-sv-card="news"/);
  assert.doesNotMatch(app, /class="sv-btn pri" href="\$\{esc\(sl\.url\)\}"[^>]*>Read the story/, 'Read the story is a link in the source line, not the only button');
});

test('no hard-coded country on trend slides; empty rings hidden, brand ring kept', () => {
  assert.doesNotMatch(app, /Search interest · India|Rising searches · India/);
  assert.match(fsvc, /\.filter\(\(x\) => x\.k === 'brand' \|\| x\.slides\.length\)/);
  assert.doesNotMatch(fsvc, /Finding new \$\{title\.toLowerCase\(\)\} stories/);
  assert.match(app, /k === 'brand' \|\| S2\[k\]\.slides\?\.length/);
});
