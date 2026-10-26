// Sloosh makes and edits every creative (27 Oct). Brew's part, pinned here on a fake Sloosh: every relevant reference goes in (product
// first with its keep line, the logo, the brand's own posts, up to the model's maximum), the Brand Book's art direction rides along, the
// words to set are quoted, Sloosh enhances the prompt, the model fits the ratio asked, credits are recorded per brand, an edit sends
// the current picture with a keep line, a clip opens on its start frame, and an outage waits and fails softly (no other maker).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlooshMake } from '../sloosh-make.js';
import { pick, routeOf, OPTION, FORMAT_RATIO, CREATIVE_LAYOUTS } from '../sloosh-map.js';
import fs from 'node:fs';

const SPECS = { image_gen: { default: 'gemini-nano-banana-2.1', models: {
  'gemini-nano-banana-2.1': { fields: { aspectRatio: ['1:1', '4:5', '9:16', '16:9', '3:4', '2:3'], resolution: ['1K', '2K', '4K'] }, constraints: { maxReferenceImages: 14 }, controls: {} },
  'muse-image-1.0': { fields: { aspectRatio: ['1:1', '3:4', '9:16'], resolution: ['1K'] }, constraints: { maxReferenceImages: 10 }, controls: {} } } },
  video_gen: { default: 'seedance-2.5', models: { 'seedance-2.5': { fields: { aspectRatio: ['16:9', '1:1', '3:4', '9:16'], resolution: ['480p', '720p', '1080p'], duration: ['4', '6', '8', '10', '15'] }, constraints: { maxReferenceImages: 30, framesExcludesReferenceImages: true, frames: { start: 'optional' } }, controls: { generateAudio: { state: 'optional' } } },
    'happy-horse-1.1': { fields: { aspectRatio: ['9:16', '4:5', '1:1'], resolution: ['720p', '1080p'], duration: ['5', '8', '10'] }, constraints: { maxReferenceImages: 9 }, controls: { generateAudio: { state: 'always' } } } } } };
const VIEW = { name: 'Oasis', kit: { logo: 'https://oasis.test/logo.png' }, look: { notes: 'Real sun, real colour, real melt: the product held up against a deep blue sky' }, styleRefs: [{ src: 'https://oasis.test/post1.jpg', from: 'team' }], library: { 'ad-image': [{ src: 'https://oasis.test/post2.jpg', why: 'hand-held against the sky' }] } };

function rig({ fail = 0, specs = SPECS } = {}) {
  const asks = [], gens = [], recorded = [], imported = [];
  let left = fail;
  const sloosh = {
    modelSpecs: async (mode) => specs[mode],
    quoteGeneration: async (a) => { asks.push(a); if (left-- > 0) throw Object.assign(new Error('Sloosh MCP 503: busy'), { status: 503 }); return { quoteId: '11111111-1111-4111-8111-111111111111', credits: 2.01 }; },
    generate: async (g) => { gens.push(g); return { operationId: 'op1' }; },
    getGeneration: async () => ({ state: 'settled', owner: { phase: 'settled', outputs: [{ generationId: 'g1', status: 'succeeded', url: 'https://cdn.sloosh.test/out.png' }], chargedCredits: 2.01 } }),
    reconcileGeneration: async () => null, getAsset: async () => ({}),
    wait: async (getter) => getter()
  };
  const finals = { assetFor: async (slug, r) => { imported.push(r.url); return { kind: 'workspace', id: `a${imported.length}`, url: r.url, type: /\.mp4/.test(r.url) ? 'video' : 'image' }; } };
  const M = createSlooshMake({ sloosh, finals, packs: null, viewOf: async () => VIEW, saveGen: () => {}, publicUrl: 'https://feed.test', fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: new Map() }),
    record: (slug, c, where) => recorded.push({ slug, c, where }), mock: () => false, tries: 2, backoffMs: 1, sleep: async () => {}, log: { warn() {} } });
  return { M, asks, gens, recorded, imported };
}

test('a picture: every reference in (product first with its keep line, logo, the brand’s own posts), the art direction and the quoted words, Sloosh enhances', async () => {
  const { M, asks, gens, recorded, imported } = rig();
  const buf = await M.image({ slug: 'oasis', prompt: 'A cone held up against the sky.', srcFile: 'https://oasis.test/cone.jpg', productName: 'the Strawberry Cone', ratio: '4:5', words: 'Real Melt.' });
  const a = asks[0];
  assert.equal(a.model, 'gemini-nano-banana-2.1'); assert.equal(a.ratio, '4:5'); assert.equal(a.resolution, '2K'); assert.equal(a.enhance, true, 'Sloosh writes the final prompt');
  assert.deepEqual(imported, ['https://oasis.test/cone.jpg', 'https://oasis.test/logo.png', 'https://oasis.test/post1.jpg', 'https://oasis.test/post2.jpg'], 'product first, then logo and their own posts');
  assert.equal(a.references.length, 4); assert.ok(a.references.every((r) => r.role === 'reference'));
  assert.match(a.prompt, /Image 1 is the product, the Strawberry Cone\. Keep its shape/); assert.match(a.prompt, /Image 2 is the logo/); assert.match(a.prompt, /Image 3 is the look/);
  assert.match(a.prompt, /Real sun, real colour, real melt/, 'the Brand Book art direction'); assert.match(a.prompt, /"Real Melt\."/, 'the words, quoted');
  assert.equal(gens[0].confirmed, true); assert.match(gens[0].runKey, /^brew-[a-f0-9]{16}$/);
  assert.deepEqual(recorded, [{ slug: 'oasis', c: 2.01, where: 'image' }]); assert.equal(buf.provider, 'sloosh');
});

test('references stop at what the model takes; a ratio the model lacks moves to one that has it', async () => {
  const { M, asks } = rig();
  await M.image({ slug: 'oasis', prompt: 'p', srcFile: 'https://oasis.test/a.jpg', refs: Array.from({ length: 20 }, (_, i) => ({ src: `https://oasis.test/r${i}.jpg`, job: 'style' })), ratio: '4:5', job: 'concept' });
  assert.equal(asks[0].model, 'gemini-nano-banana-2.1', 'Muse has no 4:5: the next concept model that does'); assert.ok(asks[0].references.length <= 14);
  assert.equal(pick({ specs: SPECS.image_gen, job: 'concept', ratio: '1:1' }).model, 'muse-image-1.0');
  assert.equal(pick({ specs: SPECS.video_gen, job: 'video', ratio: '4:5' }).model, 'happy-horse-1.1', 'a 4:5 reel on a model that makes 4:5');
  assert.equal(pick({ specs: SPECS.image_gen, job: 'image', ratio: '4:5', tier: 'final' }).resolution, '4K');
});

test('a clip opens on its start frame (alone on a model that takes a frame or references), with sound', async () => {
  const { M, asks } = rig();
  await M.video({ slug: 'oasis', frame: 'https://feed.test/gen/first.png', prompt: 'The cone drips in the sun.', ratio: '9:16', seconds: 8, srcFile: 'https://oasis.test/cone.jpg' });
  const a = asks[0]; assert.equal(a.mode, 'video_gen'); assert.equal(a.model, 'seedance-2.5'); assert.equal(a.seconds, 8); assert.equal(a.sound, true);
  assert.deepEqual(a.references.map((r) => r.role), ['start_frame']); assert.match(a.prompt, /Open exactly on the start frame/);
});

test('an edit sends the current picture with "change only" and a keep line', async () => {
  const { M, asks } = rig();
  await M.edit({ slug: 'oasis', src: 'https://feed.test/gen/now.png', instruction: 'make the sky a deeper blue', srcFile: 'https://oasis.test/cone.jpg' });
  assert.match(asks[0].prompt, /^Edit image 1\. Change only this: make the sky a deeper blue\. Keep everything else exactly as in image 1/); assert.equal(asks[0].references[0].url, 'https://feed.test/gen/now.png');
});

test('Sloosh busy: tried again, then a soft error; never another maker', async () => {
  const ok = rig({ fail: 1 }); await ok.M.image({ slug: 'oasis', prompt: 'p' }); assert.equal(ok.asks.length, 2, 'tried again');
  const no = rig({ fail: 5 }); await assert.rejects(() => no.M.image({ slug: 'oasis', prompt: 'p' }), (e) => e.soft && e.sloosh && /try again/i.test(e.message));
  for (const f of ['server.js', 'media.js']) assert.doesNotMatch(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /rawGeminiImage|openaiImage\(o\)/);
});

test('every creative deliverable and every frontend option maps to Sloosh', () => {
  const rows = JSON.parse(fs.readFileSync(new URL('../data/deliverables.json', import.meta.url), 'utf8')).rows;
  const creative = rows.filter((r) => CREATIVE_LAYOUTS.includes(r.layout));
  assert.ok(creative.length > 100);
  for (const r of creative) { const x = routeOf(r); assert.ok(x && (x.job || x.space), r.id); }
  for (const r of rows.filter((r) => !CREATIVE_LAYOUTS.includes(r.layout))) assert.equal(routeOf(r), null, r.id);
  for (const k of ['make', 'style', 'products', 'cast', 'reference', 'brand', 'words', 'direction', 'size', 'length', 'count', 'quality', 'sound', 'format', 'language']) assert.ok(OPTION[k], k);
  for (const f of ['post', 'story', 'reel', 'pin', 'banner', 'email', 'page', 'whatsapp', 'listing', 'cover', 'carousel']) assert.ok(FORMAT_RATIO[f], f);
  assert.equal(OPTION.quality('premium').tier, 'final'); assert.equal(OPTION.format('story').ratio, '9:16');
});
