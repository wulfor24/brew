// QA 19 Oct (FEED-NOT-06, FEED-14, FEED-15): the end of the feed is a calm finish line: done for today, what tomorrow brings,
// Find more as a quiet link, and Yesterday (cards seen or acted on the day before) folded under it. No prices.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), fsvc = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
const end = app.slice(app.indexOf('const tomorrowLine'), app.indexOf("document.addEventListener('click', (e) => { const y = e.target.closest('[data-yday]')"));

test('a finish line, not "caught up": tomorrow, a quiet Find more, no prices', () => {
  assert.match(end, /You’re done for today/); assert.doesNotMatch(app, /You’re caught up<\/b>/);
  assert.match(end, /Tomorrow morning your agents bring/);
  assert.match(end, /class="linkbtn fe-more" data-find-more/, 'Find more is a quiet link, not a button');
  assert.doesNotMatch(end, /[$₹€£]\s?\d|price|Pro\b|trial/i, 'pricing is parked');
});

test('Yesterday is folded, from what the workspace keeps, and opens each card', () => {
  assert.match(end, /<details class="fe-y"><summary>Yesterday/); assert.doesNotMatch(end, /<details class="fe-y" open/);
  assert.match(fsvc, /const yesterdayOf = \(t\) =>/); assert.match(fsvc, /yesterday: yesterdayOf\(t\)/);
  for (const src of ['t.shown', 't.feedback', 't.actedAt']) assert.ok(fsvc.slice(fsvc.indexOf('const yesterdayOf'), fsvc.indexOf("on('GET', '/api/tenants/:id/feed'")).includes(src), src);
  assert.match(app, /data-yday/);
});
