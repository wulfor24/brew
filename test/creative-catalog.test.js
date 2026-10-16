// The creative catalog (data/creative-catalog.json, creative-catalog.js): every card format has an entry, generic asset
// lines are caught, repeats are found by format + product + angle, and the prompt block stays short.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, formats, entry, familyOf, isFormat, promptBlock, isGeneric, keyOf, repeats } from '../creative-catalog.js';
import { inferMake, fillMake } from '../cards-gen.js';

const OLD_MAKE_FORMATS = ['single image ad', 'carousel ad', 'collection ad', 'catalog ad', 'video ad', 'instagram post', 'instagram carousel', 'instagram stories', 'reel', 'whatsapp message', 'email', 'page section', 'other'];

test('every MAKE_FORMAT has a catalog entry with the fields the writers need', () => {
  for (const f of OLD_MAKE_FORMATS) {
    const e = entry(f);
    assert.ok(e, `missing ${f}`);
    assert.equal(e.family, null);
    assert.ok(e.looks && e.makes && e.with && Array.isArray(e.needs) && Array.isArray(e.examples) && e.examples.length >= 3, `${f} is incomplete`);
    assert.ok(isFormat(f));
  }
  assert.deepEqual(formats(), OLD_MAKE_FORMATS);
});

test('Sloosh Spaces and models are in the catalog and map to a family', () => {
  for (const name of ['Product Poster / Ad Creative', 'UGC Unboxing Clip', 'Instagram Carousel', 'Virtual Try-On', 'Packaging from Dieline', 'Seedance 2.5', 'Nano Banana Pro', 'Veo 3.1']) {
    const e = entry(name); assert.ok(e, `missing ${name}`);
    assert.ok(OLD_MAKE_FORMATS.includes(e.family), `${name} maps to ${e.family}`);
    assert.equal(familyOf(name), e.family);
  }
  assert.equal(familyOf('reel'), 'reel');
  assert.equal(familyOf('a format nobody has'), null);
});

test('isGeneric catches the avoid lines and passes the catalog examples', () => {
  for (const a of load().avoid) assert.ok(isGeneric(a), `"${a}" should be generic`);
  for (const a of ['A new ad.', 'new visuals for Diwali', 'some videos', 'Fresh creative for the launch', '']) assert.ok(isGeneric(a), `"${a}" should be generic`);
  for (const e of load().formats) for (const ex of e.examples) assert.ok(!isGeneric(ex), `example should pass: "${ex}"`);
  for (const ok of ['6 slides: the fit room, one body type per slide', 'Review strip with 3 hair fall quotes and total review count', '9:16 reel, 8 s: the Paw Warmer heating up on a desk, then the hand sliding in'])
    assert.ok(!isGeneric(ok), `"${ok}" should pass`);
});

test('keyOf dedupes two identical asks and keeps two angles apart', () => {
  const catalog = [{ t: 'Snugglet Paw Warmer – USB Heated Plush Hand Pillow', img: 'a.jpg' }, { t: 'Snugglet Toe Toasters – USB Heated Plush Bootie Slippers', img: 'b.jpg' }];
  const a = { id: 'a', title: 'Show the Paw Warmer heating up', make: { format: 'reel', pieces: '9:16 reel, 8 s: the Snugglet Paw Warmer heating up on a desk' } };
  const b = { id: 'b', title: 'A desk reel for the Paw Warmer', make: { format: 'UGC Unboxing Clip', pieces: '9:16, 8 s: the Snugglet Paw Warmer heating up on the desk' } };
  const c = { id: 'c', title: 'Unbox the Paw Warmer', make: { format: 'reel', pieces: '9:16 reel, 12 s: unboxing the Snugglet Paw Warmer on the doormat' } };
  const d = { id: 'd', title: 'Toe Toasters on the desk', make: { format: 'reel', pieces: '9:16 reel, 8 s: the Snugglet Toe Toasters heating up on a desk' } };
  assert.equal(keyOf(a, catalog, { brand: 'Cozy Snugglet' }), keyOf(b, catalog, { brand: 'Cozy Snugglet' }));
  assert.notEqual(keyOf(a, catalog), keyOf(c, catalog));
  assert.notEqual(keyOf(a, catalog), keyOf(d, catalog));
  assert.match(keyOf(a, catalog), /^reel\|snugglet paw warmer/);
  const reps = repeats([a, b, c, d], catalog, { brand: 'Cozy Snugglet' });
  assert.equal(reps.length, 1); assert.deepEqual(reps[0].ids, ['a', 'b']);
  /* without a catalog the Capitalised name in the asset line stands in for the product */
  assert.equal(keyOf(a), keyOf(b));
});

test('promptBlock stays under 2,500 characters and lists every family but "other"', () => {
  const b = promptBlock({ product: 'the Hush Mask' });
  assert.ok(b.length < 2500, `block is ${b.length} chars`);
  for (const f of OLD_MAKE_FORMATS.filter((x) => x !== 'other')) assert.ok(b.includes(`- ${f} (`), `block lists ${f}`);
  assert.ok(!b.includes('[product]') && b.includes('the Hush Mask') && !b.includes('the the Hush Mask'));
  assert.ok(promptBlock({ family: 'reel' }).split('\n').length === 2);
});

test('inferMake and fillMake only ever set catalog families', () => {
  const c = fillMake({ id: 'm21-1', title: 'Launch 3 new carousel ads for the kits', sub: '', cta: { label: 'Make the carousel ad' } });
  assert.ok(isFormat(c.make.format));
  const m = inferMake({ id: 'm22-1', title: 'Cut a 12 s video ad from the review lines', cta: { label: 'Make the video' } });
  assert.ok(m && isFormat(m.format));
});
