// YouTube clips (21 Oct): treg's stream URLs are locked to the provider's IP, so the file comes through an Apify downloader;
// without a key the error says so (never an empty result); a read goes by the link and never pays for a download
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoRead } from '../video-read.js';

const packs = { getJSON: async () => null, putJSON: async () => {} };
const mp4 = Buffer.alloc(20e3, 1);
const fetchFn = async (u) => ({ ok: true, headers: new Map([['content-length', String(mp4.length)]]), arrayBuffer: async () => mp4 });

test('a YouTube clip comes from the Apify downloader', async () => {
  const runs = [];
  const apify = { live: true, run: async (actor, input) => { runs.push([actor, input]); return [{ downloadedFileUrl: 'https://api.apify.com/v2/key-value-stores/x/records/a.mp4', durationSeconds: 11 }]; } };
  const vr = createVideoRead({ packs, treg: { call: async () => { throw new Error('treg must not be called'); } }, apify, fetchFn, log: { warn() {} } });
  const f = await vr.file({ url: 'https://www.youtube.com/shorts/co6K6u0RIGY' });
  assert.equal(runs[0][0], 'streamers/youtube-video-downloader');
  assert.equal(runs[0][1].videos[0].url, 'https://www.youtube.com/shorts/co6K6u0RIGY');
  assert.ok(f.buf?.length >= 10e3);
});

test('no Apify key: the error names it', async () => {
  const vr = createVideoRead({ packs, treg: { call: async () => ({}) }, apify: { live: false }, fetchFn, log: { warn() {} } });
  await assert.rejects(vr.file({ url: 'https://www.youtube.com/shorts/co6K6u0RIGY' }), /APIFY_TOKEN/);
});

test('reading a YouTube video never pays for a download', async () => {
  let ran = 0; const apify = { live: true, run: async () => { ran++; return []; } };
  const vr = createVideoRead({ packs, treg: { call: async () => ({}) }, apify, fetchFn, vertex: null, log: { warn() {} } });
  process.env.VIDEO_VERTEX = '0'; try { await vr.read({ url: 'https://www.youtube.com/shorts/co6K6u0RIGY' }).catch(() => null); } finally { delete process.env.VIDEO_VERTEX; }
  // VIDEO_VERTEX=0 is the one case where the file is needed (keyframes): it may download; with Gemini on, it must not
  const vr2 = createVideoRead({ packs, treg: { call: async () => ({}) }, apify, fetchFn, gToken: async () => 't', log: { warn() {} } });
  ran = 0; await vr2.read({ url: 'https://www.youtube.com/shorts/co6K6u0RIGY' }).catch(() => null);
  assert.equal(ran, 0);
});
