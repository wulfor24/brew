// The Vertex stand-in (27 Oct): references go inline in order (product first), one that can't be read is left out and the
// prompt's lines renumbered, a product photo that can't be read fails the picture, the other model is tried, Veo retries plain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStandin } from '../vertex-standin.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);
const reply = (b64) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64 } }] } }] }) });

function rig({ bad = /never/, fail = 0 } = {}) {
  const calls = []; let left = fail;
  const fetchImpl = async (u, o = {}) => {
    if (o.method === 'POST') { const body = JSON.parse(o.body); calls.push({ u, body }); if (left-- > 0) return { ok: false, status: 503, text: async () => 'busy' }; return reply(PNG.toString('base64')); }
    if (bad.test(u)) return { ok: false, status: 404 }; return { ok: true, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) };
  };
  return { S: createStandin({ fetchImpl, publicUrl: 'https://feed.test', token: async () => 't', log: { warn() {} } }), calls };
}
const REFS = [{ src: 'https://a.test/p.jpg', job: 'product', label: 'the shampoo' }, { src: 'gen/logo.png', job: 'logo' }, { src: 'https://a.test/post.jpg', job: 'style' }];

test('references go in order before the words, gen/ files as their own bytes; the ratio rides along', async () => {
  const { S, calls } = rig();
  const buf = await S.image({ prompt: 'scene\n\nImage 1 is the product. Image 2 is the logo. Image 3 is the look.', refs: REFS, ratio: '4:5' });
  assert.equal(buf.provider, 'vertex'); const parts = calls[0].body.contents[0].parts;
  assert.equal(parts.length, 4); assert.ok(parts[0].inlineData); assert.match(parts[3].text, /Image 3 is the look/);
  assert.equal(calls[0].body.generationConfig.imageConfig.aspectRatio, '4:5');
});

test('a reference that cannot be read is left out and the lines renumbered; the product photo never is', async () => {
  const a = rig({ bad: /logo/ });
  await a.S.image({ prompt: 'scene\n\nImage 1 is the product. Image 2 is the logo. Image 3 is the look.', refs: REFS, ratio: 'auto' });
  const parts = a.calls[0].body.contents[0].parts; assert.equal(parts.length, 3); assert.doesNotMatch(parts[2].text, /Image 3/);
  assert.equal(a.calls[0].body.generationConfig.imageConfig, undefined, 'auto: the model keeps the reference\'s shape');
  const b = rig({ bad: /p\.jpg/ }); await assert.rejects(() => b.S.image({ prompt: 'x', refs: REFS }), /reference 404/);
});

test('one picture model down: the other is tried', async () => {
  const { S, calls } = rig({ fail: 1 }); const buf = await S.image({ prompt: 'x', refs: REFS.slice(0, 1) });
  assert.equal(calls.length, 2); assert.notEqual(calls[0].u, calls[1].u); assert.ok(buf.model);
});

test('a filtered clip is made once more with plain motion; an outage is not', async () => {
  const seen = []; const S = createStandin({ token: async () => 't', video: async (f, p) => { seen.push(p); if (seen.length === 1) throw new Error('the video model filtered this one'); return Buffer.from('mp4'); }, log: { warn() {} } });
  const v = await S.video({ frame: PNG, prompt: 'she turns', ratio: '9:16' }); assert.equal(v.plain, true); assert.match(seen[1], /slow, steady push-in/);
  const S2 = createStandin({ token: async () => 't', video: async () => { throw new Error('Vertex 429: quota'); } });
  await assert.rejects(() => S2.video({ frame: PNG, prompt: 'x' }), /429/);
});
