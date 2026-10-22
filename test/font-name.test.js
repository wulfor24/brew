// A brand's font is its family name only (22 Oct, manaprojects.com): a Google Fonts link's family= value carried the weights
// ("Cormorant:100,100italic,…", colon URL-encoded) into the brand kit card, which ran out of the card. Read, seed, heal and card.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fontName } from '../reader/stages/brand.js';
import { seedFromProfile } from '../seed-template.js';

test('fontName keeps the family only, whatever the link carried', () => {
  for (const [v, want] of [['Cormorant:100,100italic,200,200italic,300', 'Cormorant'], ['Cormorant%3A100%2C100italic%2C900', 'Cormorant'], ['Inter:wght@400;700', 'Inter'],
    ['Open+Sans|Lato', 'Open Sans'], ['"Playfair Display"', 'Playfair Display'], ['Futura PT', 'Futura PT'], ['', null], [null, null]]) assert.equal(fontName(v), want, String(v));
});

test('a saved read with weights in the name heals in the seed', () => {
  const s = seedFromProfile('x-com', { host: 'x.com', name: 'X', identity: { colors: [], fonts: { heading: 'Cormorant:100,100italic,200' }, typeName: 'Cormorant:100,100italic,200' }, catalog: { products: [] } }, null);
  assert.equal(s.brand.typeName, 'Cormorant'); assert.match(s.brand.face, /^"Cormorant", /);
});

test('the kit card cleans what it shows and never lets the name run out of the card', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), css = fs.readFileSync(new URL('../public/feed-brand.css', import.meta.url), 'utf8');
  assert.match(app, /tn = fontOnly\(c\.typeName \|\| B\.brand\.typeName\)/);
  assert.match(css, /\.fc-type span\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/); assert.match(css, /\.fc-type\{[^}]*min-width:0/);
});
