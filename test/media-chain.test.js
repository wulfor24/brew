// asset generation falls through its providers: Sloosh (off until connected) → the raw model APIs; a filtered clip is not
// retried on the stronger model; every failure is named
import test from 'node:test';
import assert from 'node:assert/strict';
import { chain, sloosh, slooshOn } from '../media.js';

test('the chain moves on when a provider fails and says which one made it', async () => {
  const warn = []; const log = { warn: (...a) => warn.push(a.join(' ')) };
  const r = await chain('image', [['sloosh', null], ['gemini', async () => { throw new Error('Gemini 503'); }], ['gpt-image', async () => Buffer.from('png')]], log);
  assert.equal(r.provider, 'gpt-image'); assert.equal(String(r.buf), 'png'); assert.equal(r.tried[0].provider, 'gemini'); assert.ok(warn.length === 1);
});

test('every provider failing is an error naming each failure, never an empty asset', async () => {
  await assert.rejects(chain('voice', [['a', async () => { throw new Error('quota'); }], ['b', async () => Buffer.alloc(0)]], { warn() {} }), /voice: every provider failed \(a: quota; b: empty\)/);
});

test('Sloosh is off until SLOOSH_URL is set, and the chain skips it quietly', async () => {
  delete process.env.SLOOSH_URL; assert.equal(slooshOn(), false);
  await assert.rejects(sloosh('image', { prompt: 'x' }), (e) => e.off === true);
  const r = await chain('image', [['sloosh', () => sloosh('image', { prompt: 'x' })], ['gemini', async () => Buffer.from('ok')]], { warn() { throw new Error('no warning expected'); } });
  assert.equal(r.provider, 'gemini');
});

test('Sloosh, once connected, is asked first', async () => {
  process.env.SLOOSH_URL = 'https://sloosh.example/mcp';
  try {
    const seen = []; const f = async (u, o) => { seen.push(u); return new Response(JSON.stringify({ b64: Buffer.from('img').toString('base64') }), { status: 200 }); };
    const buf = await sloosh('image', { prompt: 'x' }, { fetchImpl: f });
    assert.equal(String(buf), 'img'); assert.equal(seen[0], 'https://sloosh.example/mcp/image');
  } finally { delete process.env.SLOOSH_URL; }
});
