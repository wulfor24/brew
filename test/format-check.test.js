// 27 Oct (Param): "always have formatting check for every type of deliverable before showing it", and "I asked to remove text, it
// didn't remove, just confirmed". Every channel gets its own formatting; a chat reply never claims a change that didn't land.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatFix, channelOf, waHtml } from '../format-check.js';

test('WhatsApp: Markdown bold becomes WhatsApp bold, bullets and headings tidied, a URL button gets a label and the link is kept', () => {
  const ch = { family: 'crm', layout: 'msg', pkg: { message: '## Diwali\n**Start now** with\n- MitoActive\n- Shampoo\n\n\n\nGet it', buttons: ['Shop now', 'https://www.arata.in/products/mitoactive-pack-of-3', 'Shop now'] } };
  const { pkg, fixes } = formatFix(ch);
  assert.equal(pkg.message, 'Diwali\n*Start now* with\n• MitoActive\n• Shampoo\n\nGet it'); assert.deepEqual(pkg.buttons, ['Shop now', 'Visit website']); assert.equal(pkg.link, 'https://www.arata.in/products/mitoactive-pack-of-3');
  assert.ok(fixes.length); assert.deepEqual(formatFix({ ...ch, pkg }).pkg, pkg, 'the same package twice comes back the same');
  assert.equal(waHtml('*up to +28,200 new hair*.'), '<b>up to +28,200 new hair</b>.');
});

test('posts, ads, email and SMS show no Markdown; hashtags, codes and prices stay as they are', () => {
  const post = formatFix({ family: 'post', layout: 'post', pkg: { copy: '**Big news**: our _new_ serum.\n* one\n* two\n#haircare #arata use code SAVE_20 for ₹2,182' } }).pkg;
  assert.equal(post.copy, 'Big news: our new serum.\n• one\n• two\n#haircare #arata use code SAVE_20 for ₹2,182');
  assert.equal(channelOf({ family: 'crm', layout: 'mail' }), 'email'); assert.equal(channelOf({ family: 'crm', layout: 'msg', pkg: { channel: 'SMS' } }), 'sms');
  assert.equal(formatFix({ family: 'crm', layout: 'msg', pkg: { channel: 'SMS', message: '*Sale* ends ~today~' } }).pkg.message, 'Sale ends today');
  assert.equal(formatFix({ family: 'meta_ad', layout: 'pic', pkg: { image: 'gen/a.png', primaryText: '__Real__ results' } }).pkg.image, 'gen/a.png');
});

test('wiring: every save runs the format check; a words ask on an unmade Studio piece goes to the writer; replies follow the real change', () => {
  const rx = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), rt = fs.readFileSync(new URL('../jam2/routes.js', import.meta.url), 'utf8');
  assert.match(rx, /const sync = \(t, ch, c\) => \{[\s\S]{0,300}formatFix\(/);
  assert.match(app, /!\(WORDS_ASK\.test\(msg\) && !studioMade\(ch\)\)/); assert.ok(app.includes("WORDS_ASK = /\\b(?:text|words?"));
  assert.match(rt, /if \(!Object\.keys\(patch\)\.length\) out\.said = 'Nothing in the set-up changed/);
  assert.match(rx, /const reply = same \? `Nothing changed in the words/); assert.doesNotMatch(rx, /out\.reply \|\| \(same \? 'Nothing needed changing\.'/);
  assert.match(fs.readFileSync(new URL('../jam2/studio.js', import.meta.url), 'utf8'), /if \(spec\.fixed\) return spec\.fixed;/);
});
