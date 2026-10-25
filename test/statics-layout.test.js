// Static ads (25 Oct): the words sit in their own panel above the whole picture, never over the product; old ones are drawn again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { createStatics, STATICS_LAYOUT_V } = await import('../statics.js');

test('the composer gives the words their own panel and fits the picture whole', () => {
  const src = fs.readFileSync(new URL('../statics.js', import.meta.url), 'utf8');
  const html = src.slice(src.indexOf('const compose'), src.indexOf('async function recompose'));
  assert.doesNotMatch(html, /\.scrim|linear-gradient\(180deg,rgba\(12/, 'no dark band laid over the picture');
  assert.match(html, /object-fit:contain/, 'the picture is fitted, never cropped under the words');
  assert.match(html, /flex-direction:column/);
});

test('old-layout statics are drawn again from their saved scenes, once, and new makes are marked current', async () => {
  const store = new Map([['s/statics.json', { 'a-1': { headline: 'Fewer clumps', small: 'Gentle', product: 'x' } }], ['s/statics/raw-a-1.png', Buffer.from('png')]]);
  const packs = { getJSON: async (slug, k, d) => (store.has(`${slug}/${k}`) ? store.get(`${slug}/${k}`) : d), get: async (slug, k) => store.get(`${slug}/${k}`) || null, put: async (slug, k, v) => { store.set(`${slug}/${k}`, v); } };
  const page = { setViewport: async () => {}, setContent: async () => {}, screenshot: async () => Buffer.from('jpg'), close: async () => {} };
  const S = createStatics({ ai: null, image: null, packs, launchBrowser: async () => ({ newPage: async () => page, close: async () => {} }) });
  assert.equal(await S.recompose('s'), 1); assert.equal(String(store.get('s/statics/a-1.jpg')), 'jpg');
  assert.equal(store.get('s/statics-layout.json').v, STATICS_LAYOUT_V);
  assert.equal(await S.recompose('s'), 0, 'done once');
});

test('every draft and static picture with people keeps them everyday customers, never an expert in a lab coat', async () => {
  const { keepLine } = await import('../sloosh-prompt.js');
  assert.match(keepLine({ people: true }), /never a doctor, dermatologist, scientist/);
  assert.match(keepLine({ people: true }), /no lab coat/);
  assert.match(keepLine({ people: false }), /no people/);
});

test('a still draft sets its words in their own panel; a clip keeps its overlay', () => {
  const src = fs.readFileSync(new URL('../drafts.js', import.meta.url), 'utf8');
  assert.match(src, /if \(buf\) return panelHtml/, 'a picture gets the panel layout');
  assert.match(src.slice(src.indexOf('const panelHtml'), src.indexOf('const typeHtml')), /object-fit:contain/);
});

test('the draft judge fails a picture that shows an expert, and says how to redo it', async () => {
  const { lookVerdict, lookPrompt, FIX } = await import('../draft-quality.js');
  assert.match(lookPrompt('Less hair fall'), /EXPERT/);
  assert.deepEqual(lookVerdict('EXPERT: a woman in a lab coat').ok, false);
  assert.match(FIX.expert, /everyday customer/);
});

test('black bars in a picture are trimmed before it is fitted under the words', () => {
  const src = fs.readFileSync(new URL('../drafts.js', import.meta.url), 'utf8');
  assert.match(src, /cropdetect/); assert.match(src, /const buf = await trimBars\(buf0\)/);
});
