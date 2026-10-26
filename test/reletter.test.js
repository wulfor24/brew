// A claim in our own words on a made picture comes off its word layers (drawn again, free); a model-drawn slide is named instead,
// and the chat never says a claim is gone while the check still flags it (26 Oct, Arata "Dermat-approved").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripScenes } from '../jam2/reletter.js';

const layer = (id, kind, words) => ({ id, kind, words, x: 0, y: 0, w: 10, h: 10 });
test('the claim leaves the layers it sits in; an emptied badge goes; other slides stay as they were', () => {
  const take = { slides: [
    { file: 'a.jpg', scene: { layers: [layer('headline', 'text', 'Your evening routine matters more'), layer('cta', 'badge', 'Shop now')] }, words: { headline: 'Your evening routine matters more' } },
    { file: 'b.jpg', scene: { layers: [layer('headline', 'text', 'Science-led scalp facts'), layer('badge', 'badge', 'Dermat-approved formula'), layer('sub', 'text', 'Gentle on the scalp. Dermat-approved for daily use.')] }, words: { badge: 'Dermat-approved formula', sub: 'Gentle on the scalp. Dermat-approved for daily use.' } },
    { file: 'c.jpg', drawn: 'c0.jpg', scene: { layers: [] } }] };
  const r = stripScenes(take, ['Dermat-approved']);
  assert.equal(r.set, true); assert.deepEqual(r.slides.map((x) => x.changed), [false, true, false]); assert.deepEqual(r.drawn, [3]);
  const s2 = r.slides[1].slide;
  assert.ok(!s2.scene.layers.some((l) => l.id === 'badge'), 'an emptied badge is left out');
  assert.equal(s2.scene.layers.find((l) => l.id === 'sub').words, 'Gentle on the scalp.');
  assert.equal(s2.words.badge, ''); assert.equal(r.slides[0].slide, take.slides[0], 'an untouched slide is the same object');
  assert.ok(take.slides[1].scene.layers.some((l) => l.id === 'badge'), 'the old take is never changed');
});

test('a single picture, and a claim nowhere in the layers, is said to be drawn in', () => {
  const r = stripScenes({ file: 'x.jpg', drawn: 'x0.jpg', scene: { layers: [layer('h', 'text', 'Fresh hair')] } }, ['clinically proven']);
  assert.equal(r.set, false); assert.deepEqual(r.drawn, [1]); assert.equal(r.slides[0].changed, false);
});

test('the fix path takes the claim off the picture first, lands it free, and never leaves a false "done"', () => {
  const rm = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8'), rt = fs.readFileSync(new URL('../jam2/routes.js', import.meta.url), 'utf8');
  assert.match(rm, /o\.reletter\(t, sv\.jid, sv\.take, phrases\)/);
  assert.match(rm, /is still on the picture\./, 'the chat says it is still there');
  assert.match(rm, /Same photo, nothing charged/);
  assert.match(rm, /!take\.relettered && v\.studio\.file/, 'a re-lettered take whose first slide kept its file still lands');
  assert.match(rt, /return \{ slackIn, publicHandle, store, flush: \(\) => store\.flush\(\), engines, brandbook: bb, reletter \}/);
});

import { readyOf } from '../publish-ready.js';
test('another product\'s real price on the picture is flagged with the phrase to take off; a bundle that names it is not', () => {
  const catalog = [{ t: 'Sleek Hair Styling Stick - 15 ml', price: 349 }, { t: 'Hair Fall Combo', price: 601 }];
  const base = { family: 'social', action: 'creative.ig_story', pkg: { caption: 'Sleek hair, all day.' }, product: { name: 'Sleek Hair Styling Stick - 15 ml' }, catalog, source: 'Sleek Hair Styling Stick ₹349 Hair Fall Combo ₹601' };
  const bad = readyOf({ ...base, words: ['Combo at ₹601', 'Shop now'] }).checks.find((c) => c.k === 'price');
  assert.equal(bad.ok, false); assert.deepEqual(bad.phrases, ['₹601']); assert.match(bad.t, /₹601 is the price of Hair Fall Combo, not of Sleek Hair Styling Stick/);
  assert.equal(readyOf({ ...base, words: ['Only ₹349'] }).checks.find((c) => c.k === 'price').ok, true);
  assert.equal(readyOf({ ...base, words: ['Upgrade to the Hair Fall Combo at ₹601'] }).checks.find((c) => c.k === 'price').ok, true);
  const cl = readyOf({ ...base, words: ['Dermat-approved solutions'], source: 'dermat-approved' }).checks.find((c) => c.k === 'claims');
  assert.equal(cl.ok, false); assert.ok(cl.phrases.length);
});
