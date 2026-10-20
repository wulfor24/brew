import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { draftView } from '../drafts-bg.js';

test('a first draft with its headline set in the picture says so (image and reel first frame), a grid or plain photo does not', () => {
  assert.equal(draftView({ kind: 'video', as: 'image', image: 'gen/a.png', render: 'gen/a-head.jpg', headline: 'Appa noticed' }).wordsIn, 'gen/a-head.jpg');
  assert.equal(draftView({ kind: 'image', as: 'image', image: 'gen/b.png', render: 'gen/b-head.jpg', headline: 'Warm toes' }).wordsIn, 'gen/b-head.jpg');
  assert.equal(draftView({ kind: 'collection', as: 'image', image: 'gen/c.png', render: 'gen/grid.jpg', headline: 'The range' }).wordsIn, undefined);
  assert.equal(draftView({ kind: 'image', as: 'image', image: 'gen/d.png' }).wordsIn, undefined);
});

test('the reel phone never lays a second headline over a picture that carries its own', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /p\.video \|\| \(p\.wordsIn && p\.wordsIn === imgOf\(ch\)\)[^?]*\? '' : `<p class="sv-hook">/);
  const remix = readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.match(remix, /ch\.pkg\.wordsIn = d\.wordsIn && d\.wordsIn === imgs\[0\]/);
});
