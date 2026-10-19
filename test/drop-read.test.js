// Drop anything here: what a dropped file says (drop-read.js) and which way a preference note points (member-tuning.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { dropKind, unzip, officeText, readDrop } from '../drop-read.js';
import { noteSides, noteTopics, tuneScore } from '../member-tuning.js';

/* a minimal zip (deflated entries), the shape Word and PowerPoint save */
function zip(files) {
  const locals = [], cds = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nm = Buffer.from(name), raw = Buffer.from(text), data = zlib.deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); cds.push(cd, nm); off += 30 + nm.length + data.length;
  }
  const cdBuf = Buffer.concat(cds), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cds.length / 2, 8); end.writeUInt16LE(cds.length / 2, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

test('dropKind: what Brew can read', () => {
  assert.equal(dropKind('Brand guide.PDF'), 'pdf');
  assert.equal(dropKind('sheet.docx'), 'office');
  assert.equal(dropKind('deck.pptx'), 'office');
  assert.equal(dropKind('ad.jpeg', 'image/jpeg'), 'image');
  assert.equal(dropKind('notes.md'), 'text');
  assert.equal(dropKind('data', 'text/csv'), 'text');
  assert.equal(dropKind('photo.heic', 'image/heic'), null);
});

test('officeText: Word paragraphs and PowerPoint slides in order', () => {
  const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Our voice is warm &amp; playful.</w:t></w:r></w:p><w:p><w:r><w:t>Never</w:t></w:r><w:r><w:t xml:space="preserve"> discounts in headlines.</w:t></w:r></w:p></w:body></w:document>' });
  assert.equal(officeText(docx, 'docx'), 'Our voice is warm & playful.\nNever discounts in headlines.');
  const pptx = zip({ 'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>' });
  assert.equal(officeText(pptx, 'pptx'), 'Slide 1\nTwo\n\nSlide 2\nTen');
  assert.equal(unzip(docx).size, 1);
});

test('readDrop: text and Word read free; PDFs and photos need the AI; unknown files say what works', async () => {
  const t = await readDrop({ name: 'a.txt', text: 'Hero product is the warmer.' });
  assert.equal(t.kind, 'text'); assert.equal(t.text, 'Hero product is the warmer.');
  const docx = zip({ 'word/document.xml': '<w:p><w:t>Hello brand</w:t></w:p>' });
  assert.equal((await readDrop({ name: 'b.docx', data: docx.toString('base64') })).text, 'Hello brand');
  assert.match((await readDrop({ name: 'c.pdf', data: Buffer.from('%PDF').toString('base64') })).error, /AI/);
  assert.match((await readDrop({ name: 'd.heic', data: 'AAAA' })).error, /can’t read/);
  assert.match((await readDrop({ name: 'e.docx', data: Buffer.from('not a zip').toString('base64') })).error, /didn’t open/);
});

test('readDrop: a PDF goes to the AI as a document; a photo comes back with its words, what it shows and its job', async () => {
  const seen = [];
  const ai = { live: true, call: async (o) => { seen.push(o.messages[0].content[0].type); return o.schema ? { json: { text: 'COLD FEET, FIXED.', shows: 'A pink ad for a heated slipper', job: 'style' }, usd: 0.001 } : { text: 'Brand guide\nUse pink.', usd: 0.002 }; } };
  const pdf = await readDrop({ name: 'g.pdf', data: Buffer.from('%PDF-1.4').toString('base64') }, { ai });
  assert.equal(pdf.text, 'Brand guide\nUse pink.');
  const img = await readDrop({ name: 'ad.png', type: 'image/png', data: 'data:image/png;base64,' + Buffer.from('png').toString('base64') }, { ai });
  assert.match(img.text, /Picture “ad\.png”: A pink ad/); assert.match(img.text, /COLD FEET, FIXED\./);
  assert.equal(img.image.job, 'style');
  assert.deepEqual(seen, ['document', 'image']);
});

test('a "no" in a preference note pushes its words down, never up', () => {
  const s = noteSides([{ text: 'No discount cards please. More gifting ideas.' }]);
  const nt = noteTopics(s.up, s.down);
  assert.ok(nt.down.includes('discount')); assert.ok(nt.up.includes('gifting')); assert.ok(!nt.up.includes('discount'));
  assert.ok(tuneScore(null, { agent: 'x', title: 'Run a discount weekend' }, nt) < 0);
  assert.ok(tuneScore(null, { agent: 'x', title: 'A gifting bundle reel' }, nt) > 0);
  /* what Gemini read the note as wins over the sentence split */
  assert.deepEqual(noteSides([{ text: 'whatever', more: ['reels'], less: ['influencers'] }]), { up: ['reels'], down: ['influencers'] });
});

test('a PDF read that comes back as a summary is read again; chat around a copy is dropped; several files are read one by one', async () => {
  const { unchat, thinRead } = await import('../drop-read.js'); const { byFile } = await import('../brand-learnings.js');
  assert.equal(unchat('Here is the text:\n\nBody line.\n\nWould you like a summary of the phases?'), 'Body line.');
  assert.equal(thinRead('short', 'A few bullets. Would you like more?', 1e6), true);
  assert.equal(thinRead('x'.repeat(4000), 'x', 6e6), true, 'far too short for a 6 MB deck');
  assert.equal(thinRead('x'.repeat(40000), 'x', 6e6), false);
  const asks = []; const ai = { live: true, call: async (o) => { asks.push(o.messages[0].content[1].text); return asks.length === 1 ? { text: '* One bullet\n\nWould you like a summary?', usd: 0 } : { text: 'Page one words.\nPage two words.', usd: 0 }; } };
  const r = await readDrop({ name: 'deck.pdf', data: Buffer.from('%PDF').toString('base64') }, { ai });
  assert.equal(asks.length, 2); assert.equal(r.text, 'Page one words.\nPage two words.');
  assert.deepEqual(byFile('--- a.pdf ---\none\n--- b.pdf ---\ntwo'), ['--- a.pdf ---\none', '--- b.pdf ---\ntwo']);
  assert.deepEqual(byFile('just notes'), ['just notes']);
});
