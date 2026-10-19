import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimFlags, scrubClaims, copyFlags, sourceText } from '../claims.js';
import { realNewlines } from '../ai.js';
import { balanceWarm, meanRGB, warmth } from '../color-cast.js';

/* QA 19 Oct (FEED-QA-25): codes, guarantees and timed results the store never made are flagged, for any brand */
const store = sourceText({ facts: { price: { label: 'Onion hair oil', v: '₹419' }, offer: { label: 'Offer', v: 'Use code MAMA10 for 10% off' } } }, [{ t: 'Sunscreen SPF50 PA+++', d: 'Results in 4 weeks of daily use.' }]);
const kinds = (t) => claimFlags(t, store).map((f) => `${f.kind}:${f.phrase}`);

test('invented codes are flagged, the store’s own codes and product names are not', () => {
  assert.deepEqual(kinds('Made Safe certified. Use Code: PURE25. Add to cart now!'), ['code:PURE25']);
  assert.deepEqual(kinds('Get 20% off with code MAMA20 today'), ['code:MAMA20']);
  assert.deepEqual(kinds('Use code MAMA10 at checkout.'), []);
  assert.deepEqual(kinds('SPF50 PA+++ protection for daily use.'), []);
  assert.deepEqual(kinds('The code to unlock savings is in your inbox.'), []);
  assert.deepEqual(claimFlags('Use code WELCOME15', '', { allowNewCode: true }), [], 'a retention offer proposes its own new code');
});

test('guarantees, timed results and absolutes are flagged unless the store says them', () => {
  assert.deepEqual(kinds('This formulation takes exactly 7 days to build a real dewy glow.'), ['timed:takes exactly 7 days']);
  assert.deepEqual(kinds('We offer an outcome-based guarantee.'), ['guarantee:guarantee']);
  assert.deepEqual(kinds('Clinically proven to reduce hair fall.'), ['absolute:Clinically proven']);
  assert.deepEqual(kinds('See results in 4 weeks of daily use.'), [], 'the store’s own window is backed');
  assert.deepEqual(kinds('Ships in 2 days, free over ₹499.'), [], 'a delivery time is not a result claim');
});

test('scrubClaims drops only the sentence with the invented code', () => {
  assert.equal(scrubClaims('Gentle on baby skin. Use Code: PURE25. Add to cart now!', store), 'Gentle on baby skin. Add to cart now!');
});

/* QA 19 Oct (FEED-QA-02): copy that reads wrong is flagged; line breaks and ₹ are fixed where words are written */
test('copy that reads wrong is flagged', () => {
  assert.ok(copyFlags('Is heavy hair fall NOT giving? Let’s fix that!').length >= 1);
  assert.ok(copyFlags('Stronger hair up to 7 days a week.').some((x) => /days a week/.test(x)));
  assert.ok(copyFlags('Onion Hair Oil with Onion Oil').some((x) => /repeated/.test(x)));
  assert.ok(copyFlags('Line one\\nLine two').some((x) => /\\n/.test(x)));
  assert.deepEqual(copyFlags('Day after day, your hair gets stronger. FREE shipping today.'), []);
  assert.ok(copyFlags('Our Oil Oil is great').some((x) => /repeated/.test(x)), 'a word twice in a row');
  assert.deepEqual(copyFlags('Stronger hair, healthier hair, every wash.'), [], 'a repeat for rhythm reads fine');
});

test('the brand’s own words are never flagged as reading wrong', () => {
  const src = sourceText({ facts: { p: { label: 'Product', v: 'Onion Hair Oil with Onion Oil & Redensyl for Hair Fall Control' }, s: { label: 'Banner', v: 'FREE SHIPPING ON ALL ORDERS ABOVE ₹299' } } });
  assert.deepEqual(copyFlags('Onion Hair Oil with Onion Oil & Redensyl, now ₹419.', src), [], 'the real product name');
  assert.deepEqual(copyFlags('FREE SHIPPING ON ALL ORDERS ABOVE ₹299. Shop now.', src), [], 'the store’s own banner');
  assert.ok(copyFlags('BUY NOW before it ends.', src).some((x) => /caps/.test(x)), 'shouting the store never wrote');
});

test('realNewlines turns written \\n into line breaks and ‹ before a price into ₹', () => {
  assert.deepEqual(realNewlines({ a: 'One\\n\\nTwo', b: ['Only ‹419. Shop now.', '‹ Back'] }), { a: 'One\n\nTwo', b: ['Only ₹419. Shop now.', '‹ Back'] });
});

/* QA 13 Oct (FEED-NOT-03): a picture washed yellow is pulled back toward its product photo; a warm product keeps its colour */
let ff = true; try { execFileSync(process.env.FFMPEG || 'ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ff = false; }
test('a warm cast is softened toward the product photo, a warm product is left alone', { skip: !ff && 'no ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-')), mk = (hex, f) => { const p = path.join(dir, f); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${hex}:s=64x64`, '-frames:v', '1', p]); return p; };
  const warm = mk('E8D9A0', 'warm.png'), neutral = mk('EDEDED', 'neutral.png'), gold = mk('E0B040', 'gold.png'), quiet = { info() {}, warn() {} };
  const a = await balanceWarm(fs.readFileSync(warm), neutral, { log: quiet });
  assert.equal(a.fixed, true); assert.ok(warmth(await meanRGB(a.buf)) < 0.15);
  assert.equal((await balanceWarm(fs.readFileSync(neutral), neutral, { log: quiet })).fixed, false);
  assert.equal((await balanceWarm(fs.readFileSync(gold), gold, { log: quiet })).fixed, false, 'a gold product in its own gold photo');
  const bad = await balanceWarm(Buffer.from('not a picture'), null, { log: quiet }); assert.equal(bad.fixed, false);
});
