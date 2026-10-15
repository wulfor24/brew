// the feed follows the moves' state: a move the evidence overtook says "Being updated" and steps back until its rewrite lands,
// a rewritten move says "Updated" for three days; other badges are left alone
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('move cards carry where their move stands', async () => {
  const { createPacks } = await import('../brand-pack.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-cad-')), quiet = { log() {}, warn() {}, error() {}, info() {} };
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = 'acme-com', now = new Date().toISOString(), old = new Date(Date.now() - 5 * 864e5).toISOString();
  const card = (id, extra = {}) => ({ id, title: `Card ${id}`, sub: 'Two sentences here.', type: 'idea', kind: 'rows', rows: [['a', 'b']], agent: 'brew', sector: 'signals', lane: 'core', ...extra });
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.com' }, lanes: { core: {} }, roles: {}, posts: [card('m03-1'), card('m04-1'), card('m05-1'), card('m06-1', { badge: ['Price changed', 'warn'] })] });
  await P.put(slug, 'status.json', { slug, name: 'Acme', ready: true });
  await P.put(slug, 'moves.json', { 3: { n: 3, meta: { at: old } }, 4: { n: 4, meta: { at: old, rewrittenAt: now } }, 5: { n: 5, meta: { at: old, rewrittenAt: old } }, 6: { n: 6, meta: { at: old } } });
  await P.put(slug, 'updates.json', { stale: { 3: { n: 3, priority: 'high' }, 6: { n: 6 } } });
  const p = await P.load(slug, { fresh: true });
  const by = Object.fromEntries((p.rawSeed.posts || []).map((c) => [c.id, c.badge?.[0] || null]));
  assert.equal(by['m03-1'], 'Being updated');
  assert.equal(by['m04-1'], 'Updated');
  assert.equal(by['m05-1'], null, 'the Updated marker lasts three days');
  assert.equal(by['m06-1'], 'Price changed', 'a card\'s own badge stays');
  assert.ok(p.staleMoves.has(3) && p.staleMoves.has(6));
});
