// the one brief behind drafts and finals: references by position with a job and a keep line, text as exact quoted words with
// a place, no ratio in the words, no slop, "change only" on a revision, Seedance beats with no gaps
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDraft, buildFinal, scrub, hasSlop, reviseBrief, seedanceBeats, seedanceShots, brief, MODELS } from '../sloosh-prompt.js';

const brand = { name: 'Cozy Snugglet', noun: 'heated hand warmer', style: 'Soft window light from the left, warm cream tones, true colours, phone camera at eye level', avoid: 'No people shown as results, no medical claims.', colors: ['#F6C9D2', '#2B2B2B'] };

test('scrub strips keyword strings and mood words and keeps the visible facts', () => {
  assert.equal(scrub('a stunning, cinematic 4k shot of the mug on an oak desk, premium look, morning light from the window'), 'A shot of the mug on an oak desk, morning light from the window');
  assert.ok(hasSlop('floating product with sparkles')); assert.ok(!hasSlop('the mug on an oak desk'));
});

test('a draft reads as a scene, names the product reference by position, says the use and never the ratio', () => {
  const d = buildDraft({ kind: 'image', title: 'Instagram ad: desk warmth', visual: 'The grey pair on a desk next to a laptop, morning light, cinematic', scene: 'The picture must show what the card promises: the Toe Toasters under a desk.', hasSrc: true, product: { name: 'Snugglet Toe Toasters' }, brand, ratio: '4:5' });
  assert.match(d.prompt, /^A photograph for Instagram ad: desk warmth\./);
  assert.match(d.prompt, /Image 1 is the product, Snugglet Toe Toasters\. Keep its shape/);
  assert.match(d.prompt, /Made for a feed ad seen on a phone/);
  assert.ok(!/4:5|cinematic/.test(d.prompt)); assert.equal(d.ratio, '4:5');
  assert.match(d.prompt, /No people shown as results/); /* the brand's own avoid line */
  assert.match(d.prompt, /Nothing in the picture carries writing/);
});

test('a carousel slide names its place in the set and keeps the top third calm', () => {
  const d = buildDraft({ kind: 'image', title: 'the fit room carousel', visual: 'A side table with the mask', index: 2, count: 6, topSpace: true, hasSrc: true, brand, ratio: '4:5' });
  assert.match(d.prompt, /^Photograph 2 of 6 for one the fit room carousel; every photo in the set shares the same look/);
  assert.match(d.prompt, /keep the top third calm and simple, the words sit there/);
});

test('a video draft is one handheld shot where hands may use the product, which keeps its shape and mark', () => {
  const d = buildDraft({ kind: 'video', motion: 'the camera drifts right as steam rises, epic', ratio: '9:16' });
  assert.equal(d.prompt, 'The camera drifts right as steam rises. One continuous handheld phone shot at a natural pace that fills the whole frame; hands may move and use the product; the product keeps its shape, colours and brand mark as in the first frame. Only the people already in the first frame appear, each keeping the same face, hair, build and clothes throughout; no one new enters and no cuts. Draw no words anywhere: no text overlays, captions, subtitles, titles, price tags, signs or logos; any words are added afterwards.');
});

test('a final with text picks Nano Banana Pro, quotes each line with a place and renders it once; three lines go to Ideogram', () => {
  const f = buildFinal({ kind: 'image', title: 'Diwali static', visual: 'The Hush Mask on a linen pillow at 6 am', refs: [{ job: 'product', label: 'the Hush Mask', id: 'a' }, { job: 'style', label: 'last year’s Diwali ad', keep: 'the same warm palette' }], text: [{ words: 'Sleep through the fireworks', where: 'top third, left', style: 'tall serif' }], brand, ratio: '4:5' });
  assert.equal(f.model, MODELS.image); assert.deepEqual(f.settings, { aspect_ratio: '4:5', resolution: '2K' });
  assert.match(f.prompt, /Image 1 is the product, the Hush Mask\./); assert.match(f.prompt, /Image 2 is the look, last year’s Diwali ad: match its light, colours, framing and mood, not its subject; the same warm palette\./);
  assert.match(f.prompt, /Text: "Sleep through the fireworks" in tall serif, top third, left\. Render each line once, spelled exactly, and add no other text\./);
  assert.match(f.prompt, /No writing anywhere except the words asked for/);
  const t3 = buildFinal({ kind: 'image', text: ['A', 'B', 'C'], brand, refs: [{ job: 'product' }] }); assert.equal(t3.model, MODELS.type);
});

test('exact brand colours go to Flux as hex lines tied to objects, and only there', () => {
  const f = buildFinal({ kind: 'image', visual: 'The warmer on a shelf', brand: { ...brand, exactColors: true }, refs: [{ job: 'product' }] });
  assert.equal(f.model, MODELS.hex); assert.match(f.prompt, /Brand colours, exact: #F6C9D2 for the backdrop, #2B2B2B for the accent props\./);
  const n = buildFinal({ kind: 'image', visual: 'The warmer on a shelf', brand, refs: [{ job: 'product' }] }); assert.ok(!/#F6C9D2/.test(n.prompt));
});

test('a revision changes one thing and repeats the keep list, on GPT Image', () => {
  const f = buildFinal({ kind: 'image', brand, text: ['Peace of mind'], revise: { change: 'the table to polished black marble, slightly warmer light' } });
  assert.equal(f.model, MODELS.edit);
  assert.equal(f.prompt, 'Image 1 is the previous picture. Change only this: The table to polished black marble, slightly warmer light. Keep everything else exactly as in image 1: the product and every word on its label; the framing and the camera; the light and the colours; the text "Peace of mind". No writing anywhere except the words asked for and the product’s own label: no calendars, notes, signs, screens, books, posters or other packaging. No logos or watermarks that are not the brand’s own. No body shown as a result, no before and after of a body. Nothing invented on the product. No people shown as results, no medical claims.');
  assert.match(reviseBrief({}, 'the background'), /Change only this: The background\./);
});

test('Seedance beats cover the whole clip in whole seconds with no gaps, lines in quotes, no subtitles; 2.0 gets numbered shots', () => {
  const f = buildFinal({ kind: 'video', title: 'reel', subject: 'the Paw Warmer', visual: 'on a desk at night', seconds: 10, sound: true, refs: [{ job: 'product', label: 'the Paw Warmer' }], beats: [{ shot: 'Wide, the warmer glows on the desk', line: 'Cold hands?' }, { shot: 'A hand slides in, close up' }, { shot: 'The camera holds on the smile, sparkles' }], brand });
  assert.equal(f.model, MODELS.video); assert.deepEqual(f.settings, { aspect_ratio: '3:4', resolution: '1080p', duration: 10, sound: true }); /* Seedance has no 4:5: the nearest it offers */
  const beats = f.prompt.split('\n').filter((l) => /^\d+-\d+s:/.test(l)); assert.deepEqual(beats.map((l) => l.split(':')[0]), ['0-3s', '3-7s', '7-10s']);
  assert.match(beats[0], /"Cold hands\?"$/); assert.ok(!/sparkles/.test(f.prompt)); assert.match(f.prompt, /No subtitles/); assert.match(f.prompt, /^Image 1 is the product, the Paw Warmer\./);
  const s = seedanceShots(brief({ kind: 'video', beats: [{ shot: 'a' }, { shot: 'b' }], seconds: 8 })); assert.match(s, /Shot 1: A\.\nShot 2: B\./);
  assert.match(seedanceBeats(brief({ kind: 'video', seconds: 5 })), /0-5s: The camera pushes in slowly on the product\./);
});

test('a brief never draws a planning note or calls the product by a card title (19 Oct, a Cozy reel)', async () => {
  const { buildFinal, dropNotes } = await import('../sloosh-prompt.js');
  assert.equal(dropNotes('Feet in the warmer. Measure: High watch time indicates it resonates. Soft light.'), 'Feet in the warmer. Soft light.');
  const f = buildFinal({ kind: 'image', visual: 'Measure: watch time. A desk in winter.', refs: [{ url: 'u', job: 'product', label: 'Product photo' }], brand: { name: 'Cozy' } });
  assert.ok(!/Measure/.test(f.prompt)); assert.match(f.prompt, /Image 1 is the product\. Keep/);
});

test('a reel final shows its on-screen lines as exact words, sounds as sounds, and the viral clip gives only its timing (21 Oct)', async () => {
  const { beatWords, buildFinal } = await import('../sloosh-prompt.js');
  assert.deepEqual(beatWords({ line: '(On-screen text) Keeping your feet warm in 1996... 🤢' }), { say: '', show: 'Keeping your feet warm in 1996...', sfx: '' });
  assert.deepEqual(beatWords({ line: '(Sound effect) Loud crinkling' }), { say: '', show: '', sfx: 'Loud crinkling' });
  assert.deepEqual(beatWords({ line: 'Try it tonight.' }), { say: 'Try it tonight.', show: '', sfx: '' });
  assert.deepEqual(beatWords({ line: '(Sound effect) Squeaking crunch sound (On-screen text) Locked in a crunch prison' }), { say: '', show: 'Locked in a crunch prison', sfx: 'Squeaking crunch sound' });
  assert.deepEqual(beatWords({ line: 'Try it. (On-screen text) Only ₹249 🔥' }), { say: 'Try it.', show: 'Only ₹249', sfx: '' });
  const p = buildFinal({ kind: 'video', title: 'our version', seconds: 15, sound: true, brand: { name: 'Cozy' }, refs: [{ job: 'product', label: 'Toe Toasters', url: 'x' }, { job: 'motion', label: 'the viral video', url: 'y' }],
    beats: [{ shot: 'Hands wrap foil over a sock.', line: '(On-screen text) Keeping your feet warm in 1996' }, { shot: 'Tighter.', line: '(Sound effect) crinkling' }] }).prompt;
  assert.match(p, /exactly: "Keeping your feet warm in 1996"/); assert.match(p, /<crinkling>/); assert.doesNotMatch(p, /"\(On-screen/);
  assert.match(p, /take only its pacing, shot order, framing and camera moves/); assert.match(p, /different clothes, socks and shoes/);
  assert.match(p, /Only the on-screen words given appear/);
  const plain = buildFinal({ kind: 'video', seconds: 6, brand: { name: 'Cozy' }, beats: [{ shot: 'A hand.', line: 'Hi there' }] }).prompt;
  assert.match(plain, /No subtitles, no captions/); assert.match(plain, /"Hi there"/);
});
