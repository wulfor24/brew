// Make the final from the jam and the studio (finals-routes.js): our version of a rival's ad keeps their composition in words,
// never their picture; a final Sloosh finishes while Brew restarts lands on the card it was asked from
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinalsSheet, createFinalsRoutes } from '../finals-routes.js';
import { buildFinal } from '../sloosh-prompt.js';

const brandOfT = () => ({ seed: { brand: { name: 'Cozy' } }, config: { product: { noun: 'paw warmer' } }, catalog: [{ t: 'Paw Warmer', img: 'b/cozy/a/warmer.jpg' }] });
const rival = { refs: [{ job: 'product', label: '', keep: '' }], visual: "The composition of Rivalco's ad, made with our product: the product low in the centre on a desk, cropped tight. No other products, brands, logos, badges or retailer marks.", look: 'Soft window light, warm beige colours.', text: [{ words: 'Cold paws at your desk?', where: 'top third, centred', style: 'bold white sans-serif' }] };

test('a final of our version: their composition and look ride after the brief, our words sit where theirs did, and a rival picture is never a reference', () => {
  const sheet = createFinalsSheet({ finals: {}, sloosh: {}, brandOfT });
  const s = sheet.spec({}, { kind: 'image', title: 'Our version', visual: 'A hand slips the warmer into a glove.', text: 'Cold paws at your desk?', rival }, { refs: [{ url: 'b/cozy/a/warmer.jpg', job: 'product' }, { url: 'research/abc.png', job: 'style' }, { url: '/research/x.jpg', job: 'other' }], text: ['Warm paws by the second sip'] });
  assert.equal(s.refs.length, 1, 'their ad never reaches Sloosh or Gemini as a picture'); assert.equal(s.rival, true);
  assert.match(s.visual, /glove\. The composition of Rivalco's ad/); assert.equal(s.brand.style, rival.look);
  assert.deepEqual(s.text, [{ words: 'Warm paws by the second sip', where: 'top third, centred', style: 'bold white sans-serif' }]);
  const prompt = buildFinal(s).prompt; assert.match(prompt, /top third, centred/); assert.match(prompt, /Warm paws by the second sip/); assert.match(prompt, /cropped tight/);
  assert.deepEqual(sheet.spec({}, { kind: 'image', title: 'x', visual: 'v', rival }, { text: [] }).text, [], 'empty words in the sheet mean none');
  const plain = sheet.spec({}, { kind: 'image', title: 'x', visual: 'v', text: 'Hi' }, {}); assert.equal(plain.rival, false); assert.deepEqual(plain.text, ['Hi']);
});

test('the jam: the quote carries the rival read; a run Sloosh finished after a restart lands on its final card once, a failed one says so', async () => {
  const routes = new Map(); const on = (m, p, fn) => routes.set(`${m} ${p}`, fn);
  const w = { id: 'w1', cardId: 'c1', thread: [], drafts: [{ id: 'd1', as: 'image', state: 'ready', title: 'First draft: warm paws', copy: 'Cold paws at your desk?\nButton: Shop now', visual: 'A hand slips the warmer into a glove.', image: 'gen/d1.png' }] };
  const t = { id: 'T1', work: [w] }; let quoted = null, asked = null, ready = 0, saves = 0;
  const finals = { quote: async (slug, spec) => { quoted = spec; return { quoteId: 'q1', credits: 1.2, provider: 'sloosh', model: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' }; } };
  const J = createFinalsRoutes({ on, W: (tt, id) => tt.work.find((x) => x.id === id), say: (tt, ww, m) => ww.thread.push(m), meOf: () => ({ name: 'Param' }), slugOfT: () => 'cozy', brandOfT, cardOfW: () => ({ id: 'c1', research: { kind: 'ad', id: 'a1' } }), finals, sloosh: {}, rivalOf: async (tt, c, words) => { asked = words; return rival; }, onReady: () => { ready++; }, save: () => { saves++; }, now: () => 1000 });
  const r = await routes.get('POST /api/work/:wid/final/quote')({ draftId: 'd1', refs: [{ url: 'b/cozy/a/warmer.jpg', job: 'product' }], text: ['Cold paws at your desk?'] }, t, { wid: 'w1' });
  assert.ok(r.quote); assert.equal(quoted.rival, true); assert.match(quoted.visual, /Rivalco/); assert.equal(asked.button, 'Shop now'); assert.equal(quoted.text[0].where, 'top third, centred');
  /* the card that waited through the restart (drafts.js heal marks it interrupted), then reconcileAll's record arrives */
  w.drafts.unshift({ id: 'fn_1', as: 'image', state: 'failed', err: 'This draft was interrupted. Try again.', final: true, from: 'd1' });
  const rec = { runKey: 'rk1', state: 'done', kind: 'image', provider: 'sloosh', file: 'gen/fin-1.png', link: 'https://cdn.sloosh.test/out1.png', assetId: 'out1', charged: 1.2, model: 'gemini-3-pro-image-preview', target: { wid: 'w1', draftId: 'd1', revision: 0 }, land: { tid: 'T1', fid: 'fn_1' } };
  assert.equal(J.landDone(t, rec), true); const fd = w.drafts[0];
  assert.equal(fd.state, 'ready'); assert.equal(fd.image, 'gen/fin-1.png'); assert.equal(fd.failed, false); assert.equal(fd.err, null); assert.equal(fd.credits, 1.2); assert.equal(ready, 1); assert.ok(saves >= 1);
  assert.match(w.thread.at(-1).body, /The final is here: 1\.2 credits/);
  assert.equal(J.landDone(t, rec), true); assert.equal(ready, 1, 'landed once');
  w.drafts.unshift({ id: 'fn_2', as: 'image', state: 'making', final: true, from: 'd1' });
  J.landDone(t, { ...rec, runKey: 'rk2', state: 'failed', error: 'Sloosh delivered nothing (moderation)', land: { tid: 'T1', fid: 'fn_2' } });
  assert.equal(w.drafts[0].failed, true); assert.match(w.drafts[0].err, /moderation/); assert.match(w.thread.at(-1).body, /didn’t come through/);
  assert.equal(J.landDone(t, { ...rec, land: { tid: 'T1', fid: 'gone' } }), false);
});

test('one tap in the studio: the quote picks the product photo, a reel runs 3 s a beat with sound, and a run never spends a price it did not show', async () => {
  const { createStudioFinals } = await import('../finals-routes.js');
  const routes = new Map(); const on = (m, p, fn) => routes.set(`${m} ${p}`, fn); let quoted = null, ran = 0, qn = 0;
  const ch = { id: 'ch1', cardId: 'c1', family: 'post', action: 'creative.short_video', headVersionId: 'v1', pkg: { title: 'Festive', script: [{ shot: 'a', line: 'one' }, { shot: 'b', line: 'two' }, { shot: 'c', line: 'three' }, { shot: 'd', line: 'four' }], video: 'gen/d.mp4', photos: ['b/cozy/a/warmer.jpg'] }, thread: [] };
  const t = { id: 'T1', changes: { ch1: ch } };
  const finals = { quote: async (slug, spec) => { quoted = spec; qn++; return { quoteId: `q${qn}`, credits: 12, provider: 'sloosh', model: 'seedance-2.5', label: 'Seedance 2.5', expiresAt: Date.now() + 600e3 }; }, run: async () => { ran++; return { state: 'done', kind: 'video', file: 'gen/f.mp4', provider: 'sloosh', charged: 12 }; } };
  createStudioFinals({ on, C: (tt, id) => tt.changes[id], ensurePkg: () => {}, sync: () => {}, version: () => ({ id: 'v2', n: 2 }), pubChange: (tt, c) => ({ id: c.id }), cardOf: () => ({ id: 'c1', title: 'Warm paws' }), cardPhoto: () => 'b/cozy/a/warmer.jpg', jobs: new Set(), vidJobs: new Set(), finals, sloosh: {}, brandOfT, slugOfT: () => 'cozy', isVideo: (c) => !!c.pkg.script, RATIO: {} });
  const q = await routes.get('POST /api/changes/:chid/final/quote')({ auto: true }, t, { chid: 'ch1' });
  assert.equal(q.quote.credits, 12); assert.equal(quoted.kind, 'video'); assert.equal(quoted.seconds, 12, '4 beats × 3 s'); assert.equal(quoted.sound, true); assert.equal(quoted.ratio, '9:16', 'a reel matches its 9:16 draft, never a 4:5 post format snapped to 3:4');
  assert.equal(quoted.refs[0]?.job, 'product'); assert.equal(quoted.refs[0].keep, '', 'no "label exact": it garbled labels');
  const stale = await routes.get('POST /api/changes/:chid/final/run')({ expect: 'q0' }, t, { chid: 'ch1' });
  assert.equal(stale.requote, true); assert.equal(ran, 0, 'a different quote spends nothing');
  ch.finalQuote.quote.expiresAt = Date.now() - 1; const old = await routes.get('POST /api/changes/:chid/final/run')({ expect: 'q1' }, t, { chid: 'ch1' });
  assert.equal(old.requote, true); assert.equal(ran, 0, 'an expired quote spends nothing');
  await routes.get('POST /api/changes/:chid/final/quote')({ auto: true }, t, { chid: 'ch1' });
  const ok = await routes.get('POST /api/changes/:chid/final/run')({ expect: 'q2' }, t, { chid: 'ch1' }); assert.ok(ok.change); await new Promise((r) => setTimeout(r, 10)); assert.equal(ran, 1);
});

test('a viral clip passes the research filter only when the server set it; a rival video never does', () => {
  const sheet = createFinalsSheet({ finals: {}, sloosh: {}, brandOfT }), clip = 'research/abcdef0123456789abcd.mp4';
  const refs = [{ url: 'b/cozy/a/warmer.jpg', job: 'product' }, { url: clip, job: 'motion', kind: 'video' }];
  assert.equal(sheet.spec({}, { kind: 'video', title: 'x', visual: 'v', viralClip: clip }, { refs }).refs.filter((r) => r.job === 'motion').length, 1);
  assert.equal(sheet.spec({}, { kind: 'video', title: 'x', visual: 'v' }, { refs }).refs.filter((r) => r.job === 'motion').length, 0);
  assert.equal(sheet.spec({}, { kind: 'video', title: 'x', visual: 'v', viralClip: 'research/other.mp4' }, { refs }).refs.filter((r) => r.job === 'motion').length, 0);
});

test('a reel final takes its pictures from its beats, never an image brief left from an earlier take', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../finals-routes.js', import.meta.url), 'utf8');
  assert.match(src, /isVideo\(ch\) && \(p\.script \|\| \[\]\)\.some\(\(x\) => x\?\.shot\) \? '' : p\.imageBrief/);
});
