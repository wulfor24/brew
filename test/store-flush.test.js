import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.js';

test('flushPending writes a workspace still inside the save debounce', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-store-'));
  const store = createStore({ dir, log: { warn() {} } });
  store.save({ id: 't_abc123', brandId: 'b', cards: new Map([['x', 1]]) }, 60e3);
  assert.equal(fs.existsSync(path.join(dir, 't_abc123.json')), false);
  await store.flushPending();
  const back = await store.load('t_abc123');
  assert.equal(back.cards.get('x'), 1);
  await store.flushPending(); // nothing left pending: a no-op
});

test('flush still drops pending writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-store-'));
  const store = createStore({ dir, log: { warn() {} } });
  store.save({ id: 't_def456', brandId: 'b' }, 60e3);
  store.flush();
  await store.flushPending();
  assert.equal(fs.existsSync(path.join(dir, 't_def456.json')), false);
});
