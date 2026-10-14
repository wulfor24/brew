// Every generated picture shows the right product: the guard around the image model (image-guard.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createImageGuard } from '../image-guard.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-guard-'));
const file = (n, body) => { const f = path.join(dir, n); fs.writeFileSync(f, body); return f; };
const HUKUM = file('hukum.jpg', 'HUKUM-PHOTO'), DEFAULT = file('default.jpg', 'DEFAULT-PHOTO');
const catalog = [{ t: 'Aeres HUKUM IVORY', img: 'https://cdn/hukum.jpg' }, { t: 'Aeon V2 DEEPSPACE', img: 'https://cdn/deep.jpg' }, ...Array.from({ length: 20 }, (_, i) => ({ t: `Aeres CORE ${i}`, img: `https://cdn/c${i}.jpg` }))];
const fetchPhoto = async (u) => (u === 'https://cdn/hukum.jpg' ? HUKUM : null);
const quiet = { warn() {} };

const rig = (verdicts) => { const calls = [], checks = [];
  const gen = async (o) => { calls.push(o); return Buffer.from(`GEN${calls.length}`); };
  const verify = async (ref, buf, name) => { checks.push({ ref, buf: buf.toString(), name }); const v = verdicts.shift(); if (v instanceof Error) throw v; return { same: v }; };
  return { calls, checks, guard: createImageGuard({ gen, verify, fetchPhoto, context: () => null, log: quiet }) }; };

test('the product the words name becomes the reference, not the card default photo', async () => {
  const { calls, checks, guard } = rig([true]);
  const buf = await guard({ srcFile: DEFAULT, prompt: 'A new ad photo', text: 'Quiet elegance. The Hukum collection.', catalog, brand: 'Comet' });
  assert.equal(calls[0].srcFile, HUKUM); assert.match(calls[0].prompt, /Aeres HUKUM IVORY[\s\S]*exactly as in the reference/);
  assert.equal(checks[0].ref, HUKUM); assert.equal(buf.guard.product, 'Aeres HUKUM IVORY'); assert.equal(buf.guard.same, true); assert.equal(buf.toString(), 'GEN1');
});

test('a different product is regenerated once, then replaced by the real photo', async () => {
  const a = rig([false, true]); const b1 = await a.guard({ srcFile: DEFAULT, prompt: 'p', text: 'The Hukum collection', catalog });
  assert.equal(a.calls.length, 2); assert.match(a.calls[1].prompt, /different product/); assert.equal(b1.toString(), 'GEN2'); assert.equal(b1.guard.retried, true);
  const b = rig([false, false]); const b2 = await b.guard({ srcFile: DEFAULT, prompt: 'p', text: 'The Hukum collection', catalog });
  assert.equal(b2.toString(), 'HUKUM-PHOTO', 'never ships the wrong product'); assert.equal(b2.guard.fallback, true);
});

test('when the check itself fails, a named product falls back to its real photo', async () => {
  const { guard } = rig([new Error('down'), new Error('down')]);
  const buf = await guard({ srcFile: DEFAULT, prompt: 'p', text: 'The Hukum collection', catalog });
  assert.equal(buf.toString(), 'HUKUM-PHOTO'); assert.equal(buf.guard.fallback, true);
});

test('with no named product the caller photo is kept and still checked', async () => {
  const { calls, checks, guard } = rig([true]);
  await guard({ srcFile: DEFAULT, prompt: 'Comfort for every day', catalog });
  assert.equal(calls[0].srcFile, DEFAULT); assert.equal(checks[0].ref, DEFAULT);
});

test('with nothing to compare against it behaves exactly like the model', async () => {
  const { calls, checks, guard } = rig([]);
  const buf = await guard({ prompt: 'A logo-free texture', ratio: '1:1' });
  assert.equal(calls.length, 1); assert.equal(checks.length, 0); assert.equal(calls[0].prompt, 'A logo-free texture'); assert.equal(buf.toString(), 'GEN1');
  assert.ok(!('text' in calls[0]) && !('catalog' in calls[0]), 'guard-only fields never reach the model');
});
