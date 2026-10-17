// Every picture a model sees is PNG, JPEG or WebP (img-norm.js): a store's SVG product photo (eatknacks-com, 16 Oct) made
// Gemini answer 400 "Provided image is not valid" and the product check compare against a broken picture
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kindOf, createImageNorm } from '../img-norm.js';
import { createImageGuard } from '../image-guard.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgnorm-'));
const put = (name, data) => { const f = path.join(dir, name); fs.writeFileSync(f, data); return f; };
/* a browser stand-in: the SVG "screenshot" is a PNG */
const withBrowser = async (fn) => fn({ newPage: async () => ({ setViewport: async () => {}, setContent: async () => {}, screenshot: async () => PNG, close: async () => {} }) });

test('kinds are read from the bytes, never the file name', () => {
  assert.equal(kindOf(PNG), 'png');
  assert.equal(kindOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpeg');
  assert.equal(kindOf(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(kindOf(Buffer.from('<?xml version="1.0"?><svg xmlns="x"></svg>')), 'svg');
  assert.equal(kindOf(Buffer.from('<svg viewBox="0 0 10 10"></svg>      ')), 'svg');
  assert.equal(kindOf(Buffer.from('<!DOCTYPE html><html><body>404</body></html>')), 'html');
  assert.equal(kindOf(Buffer.from('GIF89a\0\0\0\0\0\0')), 'gif');
  assert.equal(kindOf(Buffer.from('\0\0\0\x1cftypavif\0\0\0\0')), 'avif');
});

test('a PNG passes as it is, an SVG becomes a PNG, a web page is refused in plain words', async () => {
  const n = createImageNorm({ withBrowser, tmp: dir, log: { info() {}, warn() {} } });
  const png = put('a.png', PNG); assert.equal(await n.normalize(png), png);
  const svg = put('pack.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200"/></svg>');
  const out = await n.normalize(svg); assert.notEqual(out, svg); assert.equal(kindOf(fs.readFileSync(out)), 'png');
  const html = put('photo.jpg', '<!doctype html><html><body>Not found</body></html>');
  await assert.rejects(n.normalize(html), /not a picture Brew can use/);
  const gif = put('g.gif', 'GIF89a' + '\0'.repeat(20));
  const viaFfmpeg = createImageNorm({ tmp: dir, run: async (args) => fs.writeFileSync(args[args.length - 1], PNG), log: { info() {}, warn() {} } });
  assert.equal(kindOf(fs.readFileSync(await viaFfmpeg.normalize(gif))), 'png');
});

test('the image guard hands the model and the check the normalised product photo and references', async () => {
  const n = createImageNorm({ withBrowser, tmp: dir, log: { info() {}, warn() {} } });
  const svg = put('prod.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
  const look = put('look.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><circle r="3"/></svg>');
  let seen = null, checked = null;
  const guard = createImageGuard({ gen: async (o) => { seen = o; return PNG; }, verify: async (ref) => { checked = ref; return { same: true }; }, normalize: n.normalize, log: { warn() {} } });
  await guard({ srcFile: svg, refFiles: [look], prompt: 'a picture', product: false });
  assert.equal(kindOf(fs.readFileSync(seen.srcFile)), 'png');
  assert.equal(seen.refFiles.length, 1); assert.equal(kindOf(fs.readFileSync(seen.refFiles[0])), 'png');
  assert.equal(kindOf(fs.readFileSync(checked)), 'png');
});
