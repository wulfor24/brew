// draft asset generation falls through its providers; every failure is named. Sloosh is not in these chains (sloosh-mcp.test.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { chain } from '../media.js';

test('the chain moves on when a provider fails and says which one made it', async () => {
  const warn = []; const log = { warn: (...a) => warn.push(a.join(' ')) };
  const r = await chain('image', [['none', null], ['gemini', async () => { throw new Error('Gemini 503'); }], ['gpt-image', async () => Buffer.from('png')]], log);
  assert.equal(r.provider, 'gpt-image'); assert.equal(String(r.buf), 'png'); assert.equal(r.tried[0].provider, 'gemini'); assert.ok(warn.length === 1);
});

test('every provider failing is an error naming each failure, never an empty asset', async () => {
  await assert.rejects(chain('voice', [['a', async () => { throw new Error('quota'); }], ['b', async () => Buffer.alloc(0)]], { warn() {} }), /voice: every provider failed \(a: quota; b: empty\)/);
});

