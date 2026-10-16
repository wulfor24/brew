// node --test test/  — References (references.js): parse limits, the job list, list / add / update / remove against a fake
// pack store, and the Drop sheet's "references" destination (drop.js). Free: no AI, no network, no disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferences, parseReference, dims, JOBS, VIDEO_MAX, IMAGE_MAX, FILE, mimeOf } from '../references.js';
import { DESTS, parseDrop } from '../drop.js';

const quiet = { warn: () => {}, info: () => {}, log: () => {} };
/* the calls brand-pack.js offers that references.js uses: getJSON / put (files kept as bytes) */
const fakePacks = () => { const files = new Map(); return { files,
  getJSON: async (slug, name, d = null) => (files.has(`${slug}/${name}`) ? JSON.parse(files.get(`${slug}/${name}`).toString('utf8')) : d),
  put: async (slug, name, data, type) => { files.set(`${slug}/${name}`, Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))); files.set(`${slug}/${name}#type`, type || null); } }; };
// a 3×2 PNG header is enough: parsing reads the IHDR, never the pixels
const png = (w = 3, h = 2, pad = 0) => { const b = Buffer.alloc(33 + pad, 1); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
const mp4 = (n = 64) => Buffer.alloc(n, 7);

test('parse: PNG, JPG and WebP up to 8 MB; MP4 up to 25 MB; everything else refused', () => {
  const ok = parseReference({ data: dataUrl('image/png', png()), label: '  Hero  shot ', job: 'Style', keep: 'match its light' });
  assert.equal(ok.kind, 'image'); assert.equal(ok.ext, 'png'); assert.equal(ok.mime, 'image/png'); assert.match(ok.file, /^refs\/[a-f0-9]{16}\.png$/);
  assert.deepEqual([ok.w, ok.h], [3, 2]); assert.equal(ok.label, 'Hero shot'); assert.equal(ok.job, 'style'); assert.equal(ok.keep, 'match its light');
  assert.equal(parseReference({ data: dataUrl('image/jpeg', Buffer.from('ffd8ffe0', 'hex')) }).ext, 'jpg');
  assert.equal(parseReference({ data: dataUrl('image/webp', Buffer.from('RIFF')) }).ext, 'webp');
  const v = parseReference({ data: dataUrl('video/mp4', mp4()), label: 'Past ad' });
  assert.equal(v.kind, 'video'); assert.equal(v.ext, 'mp4'); assert.equal(v.mime, 'video/mp4'); assert.match(v.file, /^refs\/[a-f0-9]{16}\.mp4$/); assert.equal(v.w, null);
  assert.equal(IMAGE_MAX, 8e6); assert.equal(VIDEO_MAX, 25e6);
  assert.match(parseReference({ data: dataUrl('image/png', Buffer.alloc(IMAGE_MAX + 1)) }).error, /over 8 MB/);
  assert.match(parseReference({ data: dataUrl('video/mp4', Buffer.alloc(VIDEO_MAX + 1)) }).error, /over 25 MB/);
  assert.match(parseReference({ data: dataUrl('image/gif', Buffer.from('GIF89a')) }).error, /PNG, JPG or WebP/);
  assert.match(parseReference({ data: dataUrl('video/quicktime', mp4()) }).error, /MP4 only/);
  assert.match(parseReference({ data: dataUrl('application/pdf', Buffer.from('%PDF')) }).error, /PNG, JPG or WebP/);
  assert.match(parseReference({ data: dataUrl('image/png', Buffer.alloc(0)) }).error, /empty/);
  assert.match(parseReference({ text: 'just words' }).error, /photo/);
  assert.match(parseReference({ data: 'not a data url' }).error, /PNG, JPG or WebP/);
});

test('jobs: the six names, lower-cased; anything else is "other" on add and refused on edit', async () => {
  assert.deepEqual(JOBS, ['product', 'scene', 'style', 'person', 'logo', 'other']);
  assert.equal(parseReference({ data: dataUrl('image/png', png()), job: 'LOGO' }).job, 'logo');
  assert.equal(parseReference({ data: dataUrl('image/png', png()), job: 'banner' }).job, 'other');
  const R = createReferences({ packs: fakePacks(), log: quiet });
  const { item } = await R.add('acme-com', { data: dataUrl('image/png', png()), label: 'x' });
  assert.match((await R.update('acme-com', item.id, { job: 'banner' })).error, /product, scene, style, person, logo, other/);
  assert.equal((await R.update('acme-com', item.id, { job: 'Person' })).item.job, 'person');
});

test('list / add / update / remove round trip: one JSON per brand, bytes beside it, the same file twice is one row', async () => {
  const P = fakePacks(), R = createReferences({ packs: P, log: quiet });
  assert.deepEqual(await R.list('acme-com'), []);
  const a = await R.add('acme-com', { data: dataUrl('image/png', png(640, 480)), label: 'Bottle on marble', job: 'product', keep: 'this exact bottle', by: 'ria@acme.com' });
  assert.equal(a.ok, true); assert.match(a.item.id, /^rf_[a-f0-9]{10}$/);
  assert.match(a.item.url, /^\/b\/acme-com\/refs\/[a-f0-9]{16}\.png$/); assert.deepEqual([a.item.w, a.item.h], [640, 480]); assert.equal(a.item.by, 'ria@acme.com'); assert.equal(a.item.sloosh, null);
  const file = a.item.url.replace('/b/acme-com/', '');
  assert.ok(P.files.has(`acme-com/${file}`), 'the bytes were put'); assert.equal(P.files.get(`acme-com/${file}#type`), 'image/png');
  const saved = JSON.parse(P.files.get(`acme-com/${FILE}`).toString()); assert.equal(saved.items.length, 1); assert.equal(saved.items[0].file, file); assert.equal(saved.items[0].kind, 'image'); assert.equal(saved.items[0].bytes, 33);
  const v = await R.add('acme-com', { data: dataUrl('video/mp4', mp4()), job: 'scene' }); assert.equal(v.item.kind, 'video'); assert.equal(v.item.label, 'Video');
  const again = await R.add('acme-com', { data: dataUrl('image/png', png(640, 480)), label: 'Same bytes' }); assert.equal(again.same, true); assert.equal(again.item.id, a.item.id);
  let L = await R.list('acme-com'); assert.equal(L.length, 2); assert.equal(L[0].id, v.item.id, 'newest first');
  const u = await R.update('acme-com', a.item.id, { label: 'Bottle, marble', keep: 'keep the cap' }); assert.equal(u.item.label, 'Bottle, marble'); assert.equal(u.item.keep, 'keep the cap'); assert.equal(u.item.job, 'product', 'untouched fields stay');
  assert.match((await R.update('acme-com', a.item.id, { label: '   ' })).error, /name/);
  assert.match((await R.update('acme-com', 'rf_nope', { label: 'x' })).error, /not found/);
  const rm = await R.remove('acme-com', v.item.id); assert.equal(rm.ok, true); assert.equal(rm.items.length, 1);
  assert.match((await R.remove('acme-com', v.item.id)).error, /not found/);
  L = await R.list('acme-com'); assert.deepEqual(L.map((x) => x.id), [a.item.id]);
  assert.deepEqual(await R.list('other-brand'), [], 'brands never see each other');
  const bad = await R.add('acme-com', { data: dataUrl('image/gif', Buffer.from('GIF')) }); assert.ok(bad.error); assert.equal((await R.list('acme-com')).length, 1);
});

test('adds to one brand never interleave: twenty at once all land', async () => {
  const P = fakePacks(), R = createReferences({ packs: P, log: quiet });
  await Promise.all(Array.from({ length: 20 }, (_, i) => R.add('acme-com', { data: dataUrl('image/png', png(i + 1, 1)), label: `r${i}` })));
  assert.equal((await R.list('acme-com')).length, 20);
});

test('header dims: PNG, JPEG SOF0, WebP VP8L; junk reads as null, never a throw', () => {
  assert.deepEqual(dims(png(1200, 800), 'png'), { w: 1200, h: 800 });
  const jpg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0001108001e002803012200021101031101', 'hex'); assert.deepEqual(dims(jpg, 'jpg'), { w: 40, h: 30 });
  const vp8l = Buffer.alloc(32); vp8l.write('RIFF', 0); vp8l.write('WEBP', 8); vp8l.write('VP8L', 12); vp8l[20] = 0x2f; vp8l.writeUInt32LE((99 /* w-1 */) | ((49 /* h-1 */) << 14), 21); assert.deepEqual(dims(vp8l, 'webp'), { w: 100, h: 50 });
  assert.deepEqual(dims(Buffer.from('xx'), 'png'), { w: null, h: null }); assert.deepEqual(dims(Buffer.alloc(0), 'jpg'), { w: null, h: null });
  assert.equal(mimeOf('refs/abc.webp'), 'image/webp'); assert.equal(mimeOf('refs/abc.mp4'), 'video/mp4'); assert.equal(mimeOf('x.bin'), 'application/octet-stream');
});

test('the Drop sheet can file into References; parseDrop itself still takes photos only', () => {
  assert.ok(DESTS.includes('references')); assert.deepEqual(DESTS.slice(0, 3), ['memory', 'prefs', 'once'], 'the old destinations keep their names');
  assert.match(parseDrop({ data: dataUrl('video/mp4', mp4()) }).error, /PNG, JPG or WebP/);
  assert.equal(parseDrop({ data: dataUrl('image/png', png()) }).kind, 'image');
});
