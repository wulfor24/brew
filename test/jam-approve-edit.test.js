// 27 Oct (Param, Arata jam): a real review was flagged as invented after the claims were approved, Fix with AI went round in circles,
// the other tabs kept flagging approved claims, a change asked as a question got only an answer, and a text post asked for a photo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quoteFlags, claimFlags, approvedText, sourceText } from '../claims.js';
import { isQuestion } from '../jam-answer.js';

const REVIEWS = ['I can definitely notice a change in the amount of my hairfall. It\'s not an overnight miracle but it works, and my scalp feels calm.', 'बालों का झड़ना कम हुआ, बहुत अच्छा प्रोडक्ट'];

test('a real review passes in full, cut short with "…", in curly or straight quotes, in Hindi; an invented one is flagged in full', () => {
  assert.deepEqual(quoteFlags('"I can definitely notice a change in the amount of my hairfall. It\'s not an…"', '', REVIEWS), []);
  assert.deepEqual(quoteFlags('“I can definitely notice a change in the amount of my hair fall.”', '', REVIEWS), [], 'hair fall / hairfall');
  assert.deepEqual(quoteFlags('“बालों का झड़ना कम हुआ, बहुत अच्छा प्रोडक्ट”', '', REVIEWS), []);
  const long = 'Saw an incredible reduction in hair fall in just over 3 weeks and my friends noticed too';
  assert.deepEqual(quoteFlags(`“${long}”`, '', REVIEWS), [long], 'the whole quote, so the writer sees what to replace');
  assert.equal(quoteFlags('“मेरे बाल दो हफ्ते में घने हो गए, कमाल का असर”', '', REVIEWS).length, 1, 'an invented Hindi review too');
  assert.equal(quoteFlags('“I can definitely notice a change” and my friends say it works wonders every single day', '', REVIEWS).length, 0, 'a short real fragment');
});

test('an approved claim passes in other words; a stronger or new one is still flagged', () => {
  const src = sourceText(approvedText(['up to 78% stronger hair in 1 wash', 'reduce hair fall by 7.4X']));
  assert.equal(claimFlags('Stronger by 78% after one wash.', src).length, 0);
  assert.equal(claimFlags('Cuts hair fall 7.4 times.', src).length, 0);
  assert.ok(claimFlags('92% less frizz in a week.', src).length);
});

test('a change asked as a question is a change; a real question is still answered', () => {
  for (const x of ['could the hook be shorter?', 'can it say ₹2,182?', 'should the headline lead with the review?']) assert.equal(isQuestion(x), false, x);
  for (const x of ['what is a hook?', 'is this live?', 'why this product?']) assert.equal(isQuestion(x), true, x);
});

test('wiring: every writer gets the real reviews and the approved claims; approving checks every tab; a text post has no photo step', () => {
  const rx = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.equal(rx.split('${claimsLine(t)}${reviewsLine(t)}').length - 1, 3, 'edit, redo and options');
  assert.match(rx, /quoteFlags\(shopperText, src, o\.reviewsOf\?\.\(t\) \|\| \[\]\)/);
  assert.match(rx, /others: others\.map\(\(x\) => pubChange\(t, x\)\)/); assert.match(app, /for \(const x of r\.others \|\| \[\]\) putCh\(x\)/);
  assert.match(app, /\(p\.media && !NO_MEDIA\.test\(p\.media\)\)/); assert.match(app, /credit\$\{n === 1 \? '' : 's'\}/);
  assert.match(fs.readFileSync(new URL('../brand-pack.js', import.meta.url), 'utf8'), /reviewTexts: \[\.\.\.new Set\(reviewTexts\(profile\)/);
});
