// QV 26 Oct, jam page: what each deliverable shows is right, for every brand and every kind of piece (jam-words.js, claims.js
// quoteFlags, jam-shape.js, studio.js fromKV/cleanPkg, text-fit.js versionLabel, and the jam page's frames in public/app.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixSign, wholeRupees, moneyWords, noneCell, splitList, joinList, noInventedTotal, datesAhead, docTitle, docLede, beatsEnd, beatTime, healWords, symOf } from '../jam-words.js';
import { quoteFlags, copyFlags } from '../claims.js';
import { fromKV, cleanPkg } from '../studio.js';
import { versionLabel } from '../text-fit.js';
import { setupLine, layoutOf, kindOf } from '../jam-shape.js';

test('P1-6: a lost ₹ sign comes back and prices are whole rupees, the way the store shows them', () => {
  assert.equal(moneyWords('Combo for ‑‑2,182.15, we realized'), 'Combo for ₹2,182, we realized');
  assert.equal(fixSign('only ‹499 today'), 'only ₹499 today');
  assert.equal(fixSign('for ‑‑20 a month', '$'), 'for $20 a month', 'the brand\'s own currency sign');
  assert.equal(fixSign('COVID‑19 and 3‑4 days'), 'COVID‑19 and 3‑4 days', 'a non-breaking hyphen inside a word stays');
  assert.equal(wholeRupees('₹2,182.15 and Rs. 99.50 and INR 1,299.00'), '₹2,182 and Rs. 100 and INR 1,299');
  assert.equal(wholeRupees('₹1.5 lakh in sales, ₹2.4 crore'), '₹1.5 lakh in sales, ₹2.4 crore', 'a lakh or crore figure is not paise');
  assert.equal(wholeRupees('$19.99'), '$19.99', 'cents stay on a dollar price');
  assert.equal(symOf('USD'), '$'); assert.equal(symOf(null), '₹');
  /* every text field of a saved package heals, pictures and links untouched */
  const p = { copy: 'Get it for ‑‑2,182.15', image: 'gen/a.15.png', buttons: ['Shop ₹2,182.15'] }, h = healWords('post', 'creative.linkedin_post', p);
  assert.deepEqual(h, { copy: 'Get it for ₹2,182', image: 'gen/a.15.png', buttons: ['Shop ₹2,182'] });
  assert.equal(healWords('post', 'x', h), h, 'same object back when nothing changes: nothing is saved twice');
});

test('P1-7: a beat the model left as "None" is empty, the length follows the beats, and a beat reads "0–3 s"', () => {
  assert.equal(noneCell('None'), ''); assert.equal(noneCell(' n/a '), ''); assert.equal(noneCell('null'), ''); assert.equal(noneCell('Nonetheless'), 'Nonetheless');
  const kv = fromKV('post', 'creative.short_video', [{ k: 'script', v: '0-3 s | Shaker bottle | None\n12-15 s | Pack shot | Shop now' }]);
  assert.equal(kv.script[0].line, ''); assert.equal(kv.script[1].line, 'Shop now');
  const c = cleanPkg('post', 'creative.short_video', { script: [{ beat: '0-3 s', shot: 'x', line: 'None' }] }); assert.equal(c.script[0].line, '');
  assert.equal(healWords('post', 'creative.short_video', { script: [{ beat: '0-3 s', shot: 'x', line: 'None' }] }).script[0].line, '', 'saved scripts heal');
  assert.equal(beatsEnd([{ beat: '0-3 s' }, { beat: '3–8 s' }, { beat: '12-15 s' }]), 15); assert.equal(beatsEnd([{ beat: 'Hook' }]), null);
  assert.equal(beatTime('0-3 s'), '0–3 s'); assert.equal(beatTime('12-15 S'), '12–15 s'); assert.equal(beatTime('Hook'), 'Hook');
  assert.match(setupLine({ action: 'creative.short_video', family: 'post', pkg: { script: [{ beat: '0-3 s' }, { beat: '12-15 s' }] } }, { name: 'Whey Isolate' }), /\*\*15-second\*\* video/);
});

test('P1-5: a listing bullet with a semicolon stays one bullet; saved split bullets join again; lower-case lists are left alone', () => {
  const kv = fromKV('listing', 'storefront.listing_content', [{ k: 'bullets', v: 'REALISTIC: A steady drop; within a month\n90-DAY HABIT TRAIL: Designed for regular use; use consistently for at least 90 days.' }]);
  assert.deepEqual(kv.bullets, ['REALISTIC: A steady drop; within a month', '90-DAY HABIT TRAIL: Designed for regular use; use consistently for at least 90 days.']);
  assert.deepEqual(splitList('Fast; Clean; Light'), ['Fast', 'Clean', 'Light'], 'one line of items still splits where each starts');
  const saved = ['POWERED BY Y100: Supports follicles.', '90-DAY HABIT TRAIL: Designed for regular use', 'use consistently for at least 90 days.', 'EASY: Built-in applicator.'];
  assert.deepEqual(joinList(saved), ['POWERED BY Y100: Supports follicles.', '90-DAY HABIT TRAIL: Designed for regular use; use consistently for at least 90 days.', 'EASY: Built-in applicator.']);
  assert.deepEqual(healWords('listing', 'storefront.listing_content', { bullets: saved }).bullets.length, 3);
  const steps = ['export the urls', 'categorise products', 'replace the parameters']; assert.equal(joinList(steps), steps);
  assert.deepEqual(cleanPkg('listing', 'storefront.listing_content', { bullets: saved }).bullets.length, 3);
  /* a listing's caps label ("REALISTIC EXPECTATIONS:") is the marketplace's convention, not shouting; a word across a line break is two lines */
  assert.deepEqual(copyFlags('REALISTIC EXPECTATIONS: Expect a steady drop in hairfall.\nDesigned for regular use\nuse it daily.'), []);
  assert.match(copyFlags('This is REALLY the best serum.').join(), /shouting caps/);
});

test('P1-12: a flow message never tells every customer one invented order value', () => {
  assert.equal(noInventedTotal('Your order of ₹6,500 qualifies for free shipping in India, since it is above ₹650.'), 'Your order qualifies for free shipping in India when it is above ₹650.');
  assert.equal(noInventedTotal('Your ₹6,500 cart is waiting.'), 'Your cart is waiting.');
  assert.equal(noInventedTotal('Free shipping on orders above ₹650.'), 'Free shipping on orders above ₹650.', 'the store\'s own threshold stays');
  const h = healWords('crm', 'crm.flow_copy', { flow: 'Cart recovery', message: 'Hi {first_name},\n\nYour order of ₹6,500 qualifies for free shipping.' });
  assert.equal(h.message, 'Hi {first_name},\n\nYour order qualifies for free shipping.');
  assert.equal(healWords('crm', 'crm.paid_broadcast', { message: 'Your order of ₹6,500 ships free.' }).message, 'Your order of ₹6,500 ships free.', 'only a flow (a trigger, a segment) is per customer');
});

test('P1-21: a quoted review ships only when it is one of the brand\'s real reviews', () => {
  const src = 'Reviews: I saw a real reduction in hair fall after a month, love it. Great serum.';
  assert.equal(quoteFlags('"Saw an incredible reduction in hair fall in just over 3 weeks. Phenomenal product"', src).length, 1, 'an invented testimonial is flagged');
  assert.deepEqual(quoteFlags('“I saw a real reduction in hair fall after a month”', src), [], 'a real review, quoted, is fine');
  assert.deepEqual(quoteFlags('“I saw a real reduction in hair fall after a month, love it”', src), []);
  assert.deepEqual(quoteFlags('Ask for the “Morning Ritual Kit” today', src), [], 'a quoted name is no testimonial');
  assert.deepEqual(quoteFlags('No quotes here', src), []);
});

test('P1-8 and P1-9: a checklist is titled by its heading, its lede is the next paragraph, and its dates are ahead of today', () => {
  const what = 'Campaign Naming Standard\nWe standardise all 52 live Meta ads to use a clean lowercase UTM template. This removes gaps.\n\nThe Template Format\nutm_campaign = [concern]_[objective]_[date]\n\nExamples include:\n- skin_oct26';
  assert.equal(docTitle(what), 'Campaign Naming Standard'); assert.match(docLede(what), /^We standardise all 52 live Meta ads/); assert.ok(!docLede(what).includes('Campaign Naming Standard'));
  assert.equal(docTitle('## **Fix tracking**\nOne line.'), 'Fix tracking');
  assert.equal(docTitle('Pause the ads on the sold-out conditioner and launch a notifier.'), 'Pause the ads on the sold-out conditioner and launch a notifier');
  assert.ok(docTitle('x '.repeat(200)).length <= 80);
  assert.match(setupLine({ action: 'performance.tracking_fix', family: 'setup', pkg: { what, steps: ['a', 'b'], tool: 'Meta Ads Manager' } }), /^\*\*Campaign Naming Standard\*\*: 2 steps in Meta Ads Manager\.$/);
  const now = Date.UTC(2026, 9, 26, 9), from = Date.UTC(2026, 9, 22);
  assert.equal(datesAhead('Catalog team: pause the ads by 2026-10-24', { now, from }), 'Catalog team: pause the ads by Wed 28 Oct');
  assert.equal(datesAhead('Launch by 2026-11-03', { now, from }), 'Launch by Tue 3 Nov', 'a date still ahead keeps its day');
  assert.equal(datesAhead('No date here', { now }), 'No date here');
});

test('P1-4: a marketplace listing is a listing everywhere: its name, its line, no ad shapes', () => {
  const ch = { action: 'storefront.listing_content', family: 'listing', studio: 'listing', actionLabel: 'Rewrite listing content', pkg: { bullets: ['A', 'B', 'C', 'D', 'E'], items: [{ marketplace: 'amazon.in' }, { marketplace: 'myntra.com' }] } };
  assert.equal(layoutOf(ch), 'set'); assert.equal(kindOf(ch), 'Marketplace listing');
  assert.equal(setupLine(ch, { name: 'MitoActive Serum - 30 ml' }), 'A **marketplace listing** for the **MitoActive Serum**: the title, 5 bullets and the photos, on amazon.in and myntra.com.');
  assert.equal(kindOf({ action: 'creative.ig_story', family: 'social', layout: 'set', actionLabel: 'Make the stories' }), 'Instagram Stories');
  assert.equal(kindOf({ action: 'creative.carousel_ad', family: 'meta_ad', actionLabel: 'Make the carousel' }), 'Carousel ad');
  assert.equal(kindOf({ action: 'brew.plan', family: 'decision', actionLabel: 'Save it as the team plan' }), 'Team plan', 'P2-18: a plan is named as a plan, never its button');
  assert.equal(kindOf({ action: 'x.y', actionLabel: 'Instagram post', dl: 'ig_post' }), 'Instagram post', 'a deliverable keeps its catalogue name');
});

test('P2-28: Brew\'s line names who a message goes to at a whole phrase, never cut mid-phrase', () => {
  const l = setupLine({ action: 'crm.paid_broadcast', family: 'crm', pkg: { channel: 'WhatsApp', segment: 'Active cart abandoners and recurring buyers of the combo', buttons: ['a', 'b'] } });
  assert.equal(l, 'One WhatsApp message to **active cart abandoners**, with 2 buttons.');
});

test('P2-2: a Fix it version is "Fixed a check", never the ask\'s first words', () => {
  assert.equal(versionLabel('Fix this before it goes: Claims your store doesn’t make'), 'Fixed a check');
  assert.equal(versionLabel('Fix the headline before it goes: too long'), 'Fixed a check');
  assert.equal(versionLabel('make it shorter'), 'Shorter');
});

test('the jam page draws each deliverable\'s words right (public/app.js)', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  { const cls = /const cutW = [^\n]*?\.replace\(\/\[([^\]]*)\]\+\$\/, ''\) \+ '…'/.exec(app)?.[1] || ''; assert.ok(['.', ',', ';', ':', '–', '—'].every((c) => cls.includes(c)), 'P2-1: no "…." double endings'); }
  assert.ok(/const mergeTags = /.test(app), 'P1-12: merge tags draw as a styled tag'); assert.ok(/mergeTags\(esc\(body\)\)/.test(app));
  assert.ok(/sizeChips\(ch, st\)/.test(app), 'P1-4: no duplicate shape, no ad shapes on a listing');
  assert.ok(/noChange/.test(app), 'P1-5: the old title struck through only when it differs');
  assert.ok(/beatTime\(/.test(app), 'P1-7: "0–3 s"'); assert.ok(/No words/.test(app));
  assert.ok(/ch\.docTitle/.test(app), 'P1-8: the checklist title is its heading');
});

test('the page\'s own helpers: merge tags as a chip, one size chip per shape, none on a listing', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), line = (name) => app.split('\n').find((l) => l.startsWith(`  const ${name} = `)).trim();
  const H = new Function(`const TOK_N = { 1: 'first name', 2: 'product', 3: 'detail' }; ${line('tokSpan')} ${line('mergeTags')} ${line('sizeChips')} return { mergeTags, sizeChips };`)();
  assert.equal(H.mergeTags('Hi {first_name},'), 'Hi <span class="tok">first name</span>,');
  assert.equal(H.mergeTags("Hi {{ first_name|default:'there' }},"), 'Hi <span class="tok">first name</span>,');
  assert.equal(H.mergeTags('Hi *|FNAME|*'), 'Hi <span class="tok">first name</span>');
  const st = { size: 'pdp', sizeOpts: [{ id: 'ig-portrait', ratio: '4:5' }, { id: 'ig-square', ratio: '1:1' }, { id: 'story', ratio: '9:16' }, { id: 'pdp', ratio: '1:1' }] };
  assert.deepEqual(H.sizeChips({ family: 'meta_ad' }, st).map((o) => o.id), ['ig-portrait', 'pdp', 'story'], 'Square 1:1 once, the picked one kept');
  assert.deepEqual(H.sizeChips({ family: 'listing', studio: 'listing' }, st), [], 'a listing offers no ad shapes');
});

test('P2-3: a name the card writes in capitals stays so in a sentence-case brief title, and a saved one gets it back', async () => {
  const { namesIn, keepNames, sentenceCase } = await import('../text-fit.js');
  const names = namesIn('Arata’s Baal Ki Baat series runs every week. Hair Fall is common.');
  assert.deepEqual(names, ['Baal Ki Baat']);
  assert.equal(keepNames('Launch baal ki baat hair education on Instagram', names), 'Launch Baal Ki Baat hair education on Instagram');
  assert.equal(keepNames(sentenceCase('Launch Baal Ki Baat Hair Education On Instagram'), names).startsWith('Launch Baal Ki Baat hair education'), true);
  const tb = fs.readFileSync(new URL('../team-brief.js', import.meta.url), 'utf8'); assert.ok(/keepNames\(sentenceCase\(tb\.title/.test(tb));
});
