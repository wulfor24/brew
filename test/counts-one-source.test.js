// QA 19 Oct (FEED-QA-07/21, FEED-QA-09): the greeting tiles, the moves counter and the demo's replayed build each read one source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { simStatus } from '../demo-routes.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'), fsvc = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');

test('the "Need your yes" tile is drawn again from gLists on every refresh', () => {
  assert.match(app, /const paintTiles = \(\) => \{[^\n]*GSTAT = gLists\(\)/);
  assert.match(app, /paintTiles\(\); paintTabbar\(\);/, 'counts() redraws the tiles, so insertNew and every pulse do');
});

test('moves written never goes down within a build, on the server and in the page', () => {
  assert.match(srv, /WRITTEN_HW/); assert.match(srv, /Math\.max\(\+s\.movesDone \|\| 0, w, was\)/);
  assert.match(app, /the count never goes back within a build/);
});

test('the demo replay is one source: the status route and the feed\'s "Your moves" line agree', () => {
  const st = { total: 64, movesDone: 64, done: true, pdfs: {}, stages: {} };
  assert.equal(simStatus(st, { flow: 'ready' }).movesDone, 64);
  assert.equal(simStatus(st, { flow: 'onboarding' }).movesDone, 0);
  assert.equal(simStatus(st, { flow: 'onboarding', confirmedAt: Date.now() - 600e3 }).movesDone, 64);
  assert.match(fsvc, /st = o\.viewStatus\?\.\(B\(\)\.slug, raw\) \|\| raw/);
  assert.match(srv, /viewStatus: DEMO \?/);
});
