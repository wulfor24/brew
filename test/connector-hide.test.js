// A tool a brand doesn't use (connector-hide.js; 2026-10-28: Arata has no Klaviyo) is no connector and no word for that brand,
// and every other brand keeps it exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hiddenFor, scrubText, hideInSeed, hiddenNote } from '../connector-hide.js';
import { createPacks } from '../brand-pack.js';

const quiet = { log() {}, warn() {}, error() {} };

test('Arata hides Klaviyo by host or slug; other brands hide nothing', () => {
  for (const k of ['arata.in', 'https://www.arata.in/', 'arata-in']) assert.deepEqual([...hiddenFor(k)], ['klaviyo']);
  assert.equal(hiddenFor('nutrova.com', 'mana-in', '').size, 0);
});

test('the name reads as what it does; ids, keys and links keep their letters', () => {
  const h = hiddenFor('arata.in');
  assert.equal(scrubText('Klaviyo flows are off.', h), 'Email flows are off.');
  assert.equal(scrubText('Set it up in Klaviyo today', h), 'Set it up in your email tool today');
  assert.equal(scrubText('Done. Klaviyo’s cart flow is off', h), 'Done. Your email tool’s cart flow is off');
  assert.equal(scrubText('klaviyo.com, Klaviyo.com and klaviyo.flows.off', h), 'klaviyo.com, Klaviyo.com and klaviyo.flows.off');
  assert.equal(scrubText('{"conn":"klaviyo","title":"Klaviyo read"}', h), '{"conn":"klaviyo","title":"Your email tool read"}');
  assert.equal(scrubText('Set it up in Klaviyo today', hiddenFor('nutrova.com')), 'Set it up in Klaviyo today');
  assert.match(hiddenNote(h), /does not use Klaviyo/); assert.equal(hiddenNote(hiddenFor('x.com')), '');
});

const SEED = () => ({ brand: { name: 'B', host: 'b.com' }, connectors: { shopify: { name: 'Shopify' }, klaviyo: { name: 'Klaviyo' } },
  roles: { crm: { connectors: ['shopify', 'klaviyo'] } },
  posts: [{ id: 'p1', title: 'Turn on the Klaviyo flows', conn: 'klaviyo', live: { klaviyo: 1 } }, { id: 'p2', title: 'Read', onlyWhen: 'klaviyo' }] });

test('a hidden tool leaves the seed: connector, role chip, card target, its own cards and its name', () => {
  const s = hideInSeed(SEED(), hiddenFor('arata.in'));
  assert.deepEqual(Object.keys(s.connectors), ['shopify']);
  assert.deepEqual(s.roles.crm.connectors, ['shopify']);
  assert.deepEqual(s.posts.map((p) => p.id), ['p1']);
  assert.equal(s.posts[0].conn, undefined); assert.deepEqual(s.posts[0].live, {});
  assert.equal(s.posts[0].title, 'Turn on the email flows');
  assert.deepEqual(s.hiddenTools, ['klaviyo']);
  const o = hideInSeed(SEED(), hiddenFor('b.com'));
  assert.deepEqual(Object.keys(o.connectors), ['shopify', 'klaviyo']); assert.equal(o.posts.length, 2);
});

test('the pack at load: Arata comes back without Klaviyo anywhere; another brand keeps it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hide-'));
  const make = (slug, host) => { const d = path.join(root, '.brands', slug); fs.mkdirSync(path.join(d, 'moves'), { recursive: true });
    fs.writeFileSync(path.join(d, 'seed.json'), JSON.stringify({ ...SEED(), brand: { name: slug, host }, lanes: { core: {} } }));
    fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify({ ready: true, name: slug, host }));
    fs.writeFileSync(path.join(d, 'profile.json'), JSON.stringify({ name: slug, host }));
    fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ currency: 'INR', country: 'IN' }));
    fs.writeFileSync(path.join(d, 'moves.json'), JSON.stringify({ 39: { n: 39, title: 'Lifecycle email' } }));
    fs.writeFileSync(path.join(d, 'moves', '39.json'), JSON.stringify({ n: 39, title: 'Lifecycle email', toConfirm: ['Whether Klaviyo is in use'] })); };
  make('arata-in', 'arata.in'); make('other-com', 'other.com');
  const packs = createPacks({ ROOT: root, PUB: root, log: quiet });
  const a = await packs.load('arata-in', { fresh: true }), b = await packs.load('other-com', { fresh: true });
  const text = (p) => JSON.stringify({ seed: p.seed, moveDocs: p.moveDocs, facts: p.facts });
  assert.ok(a && b);
  assert.doesNotMatch(text(a), /Klaviyo/); assert.equal(a.seed.connectors.klaviyo, undefined);
  assert.match(a.system, /does not use Klaviyo/);
  assert.match(text(b), /Klaviyo/); assert.ok(b.seed.connectors.klaviyo); assert.doesNotMatch(b.system || '', /does not use/);
  const live = a.fitLive([{ id: 'live-klaviyo-1', title: 'Klaviyo read', onlyWhen: 'klaviyo' }, { id: 'live-shopify-1', title: 'Shopify and Klaviyo' }]);
  assert.deepEqual(live.map((c) => c.id), ['live-shopify-1']); assert.doesNotMatch(JSON.stringify(live), /Klaviyo/);
});

test('every surface is wired: connectors API, routes, response scrub, PDFs, moves cadence', () => {
  const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const cx = src('connectors/index.js');
  assert.match(cx, /avail: Object\.fromEntries\(Object\.entries\(avail\(\)\)\.filter\(\(\[id\]\) => !hide\.has\(id\)\)\)/);
  assert.equal((cx.match(/\(await hiddenOf\(slug\)\)\.has\(id\)/g) || []).length, 2); /* both connect routes */
  assert.match(src('server.js'), /hideRes\(req, res, u\)/);
  assert.match(src('pdf/render.js'), /scrubText\(moveHtml\(/);
  assert.match(src('moves-cadence.js'), /hiddenFor\(p\.host\)\.has\('klaviyo'\)/);
});

test('a connect card on the feed can be dismissed for a stack the brand doesn’t use, with Undo', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-no-stack="\$\{id\}">We don’t use \$\{esc\(c\.name\)\}/);
  assert.match(app, /!S\.noStack\?\.\[need\]/); /* a dismissed tool never asks again */
  assert.match(app, /data-stack-back=/); /* Undo */
});
