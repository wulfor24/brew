// 26 Oct (Param): the product picker shows every product as a row (photo, whole name, size/price/sold out) outside the style grid's
// rules; the first look follows the set-up (style, product, size) and the brand's real colours; claims are approvable where flagged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { productTiles } from '../jam2/ingredients.js';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('the picker: a list with photo, whole name and what tells look-alikes apart; the tile carries the price', () => {
  const cs = read('public/creative-stage.js'), css = read('public/creative-stage.css');
  assert.match(cs, /class="cs-prow/); assert.match(cs, /<span class="cs-pth"><img/); assert.match(cs, /'Sold out'/); assert.doesNotMatch(cs.slice(cs.indexOf("if (k === 'product')"), cs.indexOf("if (k === 'cast')")), /cs-grid/, 'never the style grid (its badge rule pulled the photos out)');
  assert.match(css, /\.cs-pop \.cs-plist \.cs-pth img\{position:static/);
  const t = productTiles([{ t: 'Oil-Control Face Wash - 100 ml', img: 'a.png', price: 349 }, { t: 'Oil-Control Face Wash Pack of 2', img: 'b.png', price: '₹586', out: true }]);
  assert.equal(t[0].price, 349); assert.equal(t[1].out, true);
});

test('the first look follows the set-up and the brand\'s real colours', () => {
  const cs = read('public/creative-stage.js'), st = read('jam2/studio.js');
  assert.match(cs, /const lookKey = \(\) => JSON\.stringify\(\[S\?\.spec\?\.kind, S\?\.spec\?\.style/); assert.match(cs, /price\(\); relook\(\);/);
  assert.match(st, /kitColours\(ctx\.bbv \|\| \{\}\)/); assert.match(st, /preset \}\);/);
});

test('claims are approvable where they are flagged, and a failed make carries them', () => {
  const app = read('public/app.js'), rm = read('remix.js'), rt = read('jam2/routes.js'), sd = read('jam2/studio.js');
  assert.match(app, /data-approve-claims=/); assert.match(app, /\/api\/changes\/\$\{id\}\/approve-claims/);
  assert.match(rm, /on\('POST', '\/api\/changes\/:chid\/approve-claims'/); assert.match(rm, /claims: st\.claims\.slice\(0, 6\)/);
  assert.match(rt, /const approveClaims = async \(t, claims\)/); assert.match(sd, /err\.invented = check\.invented/);
  assert.doesNotMatch(rm, /Nothing was charged for what wasn’t made/, 'the cost of the tries is said as it was');
});

test('Fix it on a part over its length re-counts it and asks again with the exact number; one that still does not fit is said', () => {
  const app = read('public/app.js'), rm = read('remix.js');
  assert.match(app, /\.\.\.\(x\.part \? \{ part: x\.part \} : \{\}\) \}\); RX\.fixing = false; return; \}/);
  assert.match(rm, /for \(let i = 0; b\.fix && i < 3 && over\(partNow\(\)\)/); assert.match(rm, /characters now: it fits\./); assert.match(rm, /is still \$\{pp\.n\} characters \(the limit is \$\{lim\}\)/);
});
