// Tooltip words (public/tips.js) and the floating #tipx layer (public/app.js): one short plain sentence each, the same for
// every brand, every key a page asks for exists, and a tipped element never also carries a native title (two tips at once).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { dejargon } from '../plain.js';

const pub = new URL('../public/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, pub), 'utf8');
const box = { window: {} };
vm.runInNewContext(read('tips.js'), box);
const { T, attr, area } = box.window.BrewTips;
const FILES = ['app.js', 'jam-room.js', 'composer.js', 'brand-book.js', 'creative-stage.js'];

test('every tip is one short sentence in plain words, with no brand in it', () => {
  for (const [k, t] of Object.entries(T)) {
    assert.ok(t.length <= 100, `${k} is long: ${t.length} chars`);
    assert.match(t, /^[A-Z].*\.$/, `${k} starts with a capital and ends with a full stop`);
    assert.doesNotMatch(t.slice(0, -1), /[.!?]\s/, `${k} is one sentence`);
    assert.equal(dejargon(t), t, `${k} has jargon plain.js would swap`);
    assert.doesNotMatch(t, /\b(Arata|Nutrova|Mana|Puma|Scrubroom|Cozy|Zenant|ShopOS|Sloosh)\b/i, `${k} names a brand or a vendor`);
  }
});

test('attr escapes and skips empty words', () => {
  assert.equal(attr(''), '');
  assert.equal(attr('nope'), '');
  assert.equal(attr('heart'), ` data-tip="${T.heart}"`);
  assert.equal(attr('Say "hi" <now>.'), ' data-tip="Say &quot;hi&quot; &lt;now&gt;."');
});

test('every tip key a page asks for exists', () => {
  for (const f of FILES) {
    const src = read(f);
    for (const m of src.matchAll(/(?:tipA|tipI|BrewTips\?\.attr)\('([A-Za-z]+)'\)|BrewTips\?\.T\.(\w+)/g)) assert.ok(T[m[1] || m[2]], `${f} asks for tip "${m[1] || m[2]}"`);
    for (const m of src.matchAll(/(?:tipA|BrewTips\?\.attr)\(([^()']*\?[^()]*)\)/g)) for (const k of m[1].match(/'([A-Za-z]+)'/g) || []) assert.ok(T[k.slice(1, -1)], `${f} asks for tip ${k}`);
  }
});

test('a tipped element has no native title too', () => {
  for (const f of FILES) for (const tag of read(f).match(/<(?:button|span|b|em|small|ol)\b[^<>]*(?:tipA\(|BrewTips\?\.attr\(|data-tip=)[^<>]*>/g) || []) assert.doesNotMatch(tag, /\stitle="[^"$]/, `${f}: ${tag.slice(0, 120)}`);
});

test('every feed area and health ring name says what it means', () => {
  const src = read('app.js'), keys = [...src.match(/const SECTORS = \{([\s\S]*?)\n  \};/)[1].matchAll(/(\w+): \{ name:/g)].map((m) => m[1]);
  assert.ok(keys.length >= 6);
  for (const k of keys) assert.match(area(k), /^ data-tip="[A-Z]/, `area ${k}`);
  for (const n of ['Creative', 'Storefront', 'AI answers']) assert.notEqual(area(n), '', `ring ${n}`);
  assert.equal(area('nope'), '');
  assert.match(src, /<em\$\{tipArea\(c\.sector\)\}>/); /* the card page's own area tag; a From label never borrows an area's words it doesn't show */
  assert.match(src, /<h2\$\{tipArea\(k\)\}>/);
});

test('the tip layer: no hover on touch, a long press that doesn’t press, never over its own button', () => {
  const src = read('app.js');
  assert.match(src, /pointerover[^\n]*pointerType === 'touch'\) return/);
  assert.match(src, /TIPT\.held === el\) \{ TIPT\.held = null; e\.preventDefault\(\); e\.stopPropagation\(\)/);
  assert.match(src, /up >= 8 \? up : down \+ h <= innerHeight - 8 \? down/);
  assert.match(read('index.html'), /<script src="tips\.js"><\/script>[\s\S]*<script src="app\.js">/);
});
