// The brand's own fonts: every weight kept, a role picked by the team, the files in the brand kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fontMeta, fromName, mergeFaces } from '../font-meta.js';
import { createBrandbook } from '../jam2/brandbook.js';
import { createBrandKit } from '../brand-kit.js';
import { unzip } from '../drop-read.js';

/* a tiny sfnt with a `name` table (family) and an OS/2 table (weight, italic bit), enough for fontMeta */
function sfnt(family, weight, italic) {
  const str = Buffer.from(family, 'utf16le').swap16(), name = Buffer.alloc(6 + 12 + str.length);
  name.writeUInt16BE(0, 0); name.writeUInt16BE(1, 2); name.writeUInt16BE(18, 4);
  name.writeUInt16BE(3, 6); name.writeUInt16BE(1, 8); name.writeUInt16BE(0x409, 10); name.writeUInt16BE(1, 12); name.writeUInt16BE(str.length, 14); name.writeUInt16BE(0, 16); str.copy(name, 18);
  const os2 = Buffer.alloc(78); os2.writeUInt16BE(weight, 4); os2.writeUInt16BE(italic ? 1 : 0, 62);
  const head = Buffer.alloc(12 + 2 * 16); head.writeUInt32BE(0x00010000, 0); head.writeUInt16BE(2, 4);
  const at1 = head.length, at2 = at1 + name.length;
  head.write('name', 12, 'latin1'); head.writeUInt32BE(at1, 20); head.writeUInt32BE(name.length, 24);
  head.write('OS/2', 28, 'latin1'); head.writeUInt32BE(at2, 36); head.writeUInt32BE(os2.length, 40);
  return Buffer.concat([head, name, os2]);
}

test('a font says its own family, weight and style; the file name is the fallback', () => {
  assert.deepEqual(fontMeta(sfnt('Acme Sans', 700, true), 'whatever.ttf'), { family: 'Acme Sans', weight: 700, style: 'italic' });
  assert.deepEqual(fontMeta(Buffer.from('not a font'), 'Geist-SemiBoldItalic.woff2'), { family: 'Geist', weight: 600, style: 'italic' });
  assert.deepEqual(fromName('PlayfairDisplay-Black.ttf'), { family: 'Playfair Display', weight: 900, style: 'normal' });
  assert.deepEqual(fromName('Inter-600.woff'), { family: 'Inter', weight: 600, style: 'normal' });
  assert.deepEqual(fromName('BrandFont.ttf'), { family: 'Brand Font', weight: 400, style: 'normal' });
});

test('Bold never replaces Regular: one file per family + weight + style', () => {
  const r = { family: 'Geist', weight: 400, style: 'normal', src: '/b/x/a/font-r.ttf' }, b = { family: 'Geist', weight: 700, style: 'normal', src: '/b/x/a/font-b.ttf' };
  const kept = mergeFaces([b], [r]); assert.equal(kept.length, 2);
  const again = mergeFaces([{ ...b, src: '/b/x/a/font-b2.ttf' }], kept); assert.equal(again.length, 2); assert.ok(again.some((f) => f.src.endsWith('b2.ttf')));
});

test('uploads keep every weight; the team picks headings, body or both; a file can be removed; the kit carries them with fonts.css', async () => {
  const files = new Map();
  const packs = { getJSON: async (s, n, d) => (files.has(`${s}|${n}`) ? structuredClone(files.get(`${s}|${n}`)) : d), put: async (s, n, v) => files.set(`${s}|${n}`, v), get: async (s, n) => (/^assets\/font-/.test(n) ? Buffer.from('font-bytes') : null) };
  const bb = createBrandbook({ packs, log: { warn() {} } });
  const up = (id, weight) => ({ upload: { id, name: `Geist ${weight}`, kind: 'font', proposed: [], kit: { fonts: { heading: 'Geist' }, fontFiles: [{ family: 'Geist', weight, style: 'normal', src: `/b/cozy/a/font-${weight}.ttf` }] } } });
  await bb.update('cozy', up('f1', 400)); await bb.update('cozy', { applyUpload: { id: 'f1', fontRole: 'body' } });
  await bb.update('cozy', up('f2', 700)); let raw = await bb.update('cozy', { applyUpload: { id: 'f2', fontRole: 'both' } });
  assert.deepEqual(raw.kitEdits.fontFiles.map((f) => f.weight).sort(), [400, 700], 'both weights kept');
  assert.deepEqual(raw.kitEdits.fonts, { heading: 'Geist', body: 'Geist' });
  raw = await bb.update('cozy', { kit: { fonts: { heading: 'Fraunces' } } }); assert.equal(raw.kitEdits.fonts.heading, 'Fraunces'); assert.equal(raw.kitEdits.fonts.body, 'Geist');
  raw = await bb.update('cozy', { kit: { dropFont: '/b/cozy/a/font-700.ttf' } }); assert.deepEqual(raw.kitEdits.fontFiles.map((f) => f.weight), [400]);
  await bb.update('cozy', up('f3', 700)); await bb.update('cozy', { applyUpload: { id: 'f3' } });
  files.set('cozy|profile.json', { name: 'Cozy' });
  const z = await createBrandKit({ packs }).zip('cozy', { origin: 'https://brew.example' }); const zz = unzip(z.buf);
  assert.ok(zz.has('fonts/Geist/Geist-Regular.ttf') && zz.has('fonts/Geist/Geist-Bold.ttf'), [...zz.keys()].join(' '));
  const css = zz.get('fonts/fonts.css').toString(); assert.match(css, /font-weight: 700/); assert.match(css, /src: url\("Geist\/Geist-Bold\.ttf"\) format\("truetype"\)/);
});

test('Studio loads every uploaded weight of a family', async () => {
  const { fontLink } = await import('../public/jam2/scene.js');
  const html = fontLink({ fonts: { heading: 'Geist' }, files: [{ family: 'Geist', weight: 400, src: '/b/x/a/font-a.ttf' }, { family: 'Geist', weight: 700, style: 'italic', src: '/b/x/a/font-b.ttf' }] });
  assert.match(html, /font-weight:400/); assert.match(html, /font-weight:700;font-style:italic/);
});

test('the font picker always offers the fonts Brew read, so the original is one tap away after an upload', async () => {
  const { blankBook, readLayer, viewOf } = await import('../jam2/brandbook.js');
  const read = readLayer({ slug: 'c', profile: { name: 'C', identity: { fonts: { heading: 'Nunito', body: 'Corben' } } }, brief: {}, config: {} });
  const bb = { ...blankBook(), read, kitEdits: { fonts: { heading: 'Geist', body: 'Geist' }, fontFiles: [{ family: 'Geist', weight: 400, src: '/b/c/a/font-g.ttf' }] } };
  const v = viewOf(bb, { scope: 'member' });
  assert.deepEqual(v.kit.fonts, { heading: 'Geist', body: 'Geist' });
  for (const f of ['Geist', 'Nunito', 'Corben']) assert.ok(v.kit.fontChoices.includes(f), f);
});
