// Demo Mode (DEMO_MODE=1, the demo site): each demo session is the owner of its own copy of the brand's private state;
// every connector is a simulated account built from the brand's real read; changes and undo work on it; nothing can
// reach a real account. No network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DEMO_MODE = '1'; process.env.REFRESH_AUTO = '0';
const { runDemo, sandboxName, guardFetch, sessionOf } = await import('../demo-mode.js');
const { createPacks } = await import('../brand-pack.js');
const { createSim, SIM_IDS } = await import('../connectors/sim.js');

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.join(HERE, '..');
const quiet = { log() {}, warn() {}, error() {} };
const slug = 'acme-com';
function setup() {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-mode-'));
  const P = createPacks({ ROOT, PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
  const products = Array.from({ length: 8 }, (_, i) => ({ title: `Runner ${i + 1}`, price: 95 + i * 10, url: `https://acme.com/products/runner-${i + 1}` }));
  return { P, ROOT, profile: { name: 'Acme', host: 'acme.com', country: 'US', currency: 'USD', catalog: { products }, reviews: { total: 4200 }, ads: { own: { live: 18 } }, search: { terms: ['running shoes', 'wool sneakers'] } } };
}

test('a session writes private files to its own folder and reads the brand’s until then', async () => {
  const { P } = setup();
  await P.put(slug, 'updates.json', { auto: true, stale: { 3: { why: 'base' } } });
  assert.equal(sandboxName('private/x.json'), null, 'outside a session nothing is mapped');
  await runDemo('aaaaaaaaaaaa', async () => {
    assert.equal((await P.getJSON(slug, 'updates.json')).stale[3].why, 'base', 'reads through to the brand');
    await P.put(slug, 'updates.json', { auto: true, stale: {} });
    await P.put(slug, 'private/connections.json', { meta: { state: 'live' } });
    const m = await P.getJSON(slug, 'private/members.json'); assert.equal(m.owner, 'demo-aaaaaaaaaaaa@demo.brew', 'the visitor owns their copy');
  });
  await runDemo('bbbbbbbbbbbb', async () => {
    assert.equal(await P.getJSON(slug, 'private/connections.json', null), null, 'another session sees none of it');
    assert.equal((await P.getJSON(slug, 'updates.json')).stale[3].why, 'base');
  });
  assert.equal((await P.getJSON(slug, 'updates.json')).stale[3].why, 'base', 'the brand’s own file is untouched');
  assert.equal(await P.getJSON(slug, 'private/connections.json', null), null);
});

test('a simulated account speaks the real connector shape, in the brand’s numbers', async () => {
  const { P, profile } = setup(); await P.put(slug, 'profile.json', profile); await P.put(slug, 'seed.json', { brand: { name: 'Acme' }, lanes: { core: {} } });
  const sim = createSim({ packs: P, log: quiet });
  for (const id of SIM_IDS) { const d = await sim.sync(slug, id); assert.ok(Array.isArray(d.stats) && d.stats.length, `${id} has stats`); assert.ok(d.ledger.every((e) => !e.demo && e.method === 'connected account'), `${id} ledger reads as connected`);
    assert.ok(d.cards.every((c) => c.id.startsWith('live-') && c.onlyWhen === id), `${id} cards are live cards`); }
  const shop = await sim.sync(slug, 'shopify'); assert.ok(shop.ledger.some((e) => e.key === 'shopify.orders.30d' && e.n > 0));
  assert.ok(JSON.stringify(shop.cards).includes('$'), 'money in the brand’s currency');
  const meta = await sim.sync(slug, 'meta'); assert.ok(meta.ledger.some((e) => e.key === 'meta.cpa'), 'the key the measuring engine reads');
});

test('nothing on the demo site can write to a real account or send a message', async () => {
  const calls = []; const was = globalThis.fetch; globalThis.fetch = async (u, o) => { calls.push(String(u)); return new Response('{}'); };
  try { guardFetch(quiet);
    await assert.rejects(fetch('https://graph.facebook.com/v21.0/act_1/campaigns', { method: 'POST' }), /Demo mode/);
    await assert.rejects(fetch('https://api.resend.com/emails', { method: 'POST' }), /Demo mode/);
    await assert.rejects(fetch('https://shop.myshopify.com/admin/api/2026-04/graphql.json', { method: 'POST' }), /Demo mode/);
    await fetch('https://acme.com/products.json'); await fetch('https://api.anthropic.com/v1/messages', { method: 'POST' });
    assert.deepEqual(calls, ['https://acme.com/products.json', 'https://api.anthropic.com/v1/messages'], 'reads and the AI pass');
  } finally { globalThis.fetch = was; }
});

test('a share link joins that session; ?d=new starts a fresh one', () => {
  const req = (cookie = '') => ({ headers: { cookie } });
  assert.equal(sessionOf(req('brew_demo=abcdefabcdef12'), new URL('http://x/a')).sid, 'abcdefabcdef12');
  const s = sessionOf(req('brew_demo=abcdefabcdef12'), new URL('http://x/a?d=0123456789ab')); assert.equal(s.sid, '0123456789ab'); assert.match(s.set, /brew_demo=0123456789ab/);
  const n = sessionOf(req('brew_demo=abcdefabcdef12'), new URL('http://x/a?d=new')); assert.notEqual(n.sid, 'abcdefabcdef12'); assert.ok(n.set);
});
