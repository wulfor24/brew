// QA 19 Oct (FEED-ARV-07): the store's plumbing never reaches a person, on cards, in jam plans or for a demo visitor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dejargon, createPlain } from '../plain.js';
import { planFor } from '../card-plan.js';

const BANNED = /\bGMC\b|webhook|products\.json|JSON-LD|llms\.txt|custom (?:web )?pixel|structured data|\bschema\b/i;

test('dejargon swaps the plumbing words for plain ones, keeps a sentence capital and the numbers', () => {
  const xs = ['Products.json shows 913 items', 'Read arata.in/products.json daily', 'Add JSON-LD FAQ schema blocks to the top 5 PDPs', 'Create structured /llms.txt at root',
    'Fix the GMC feed and the Shopify webhook triggers', 'The Shopify Custom Web Pixel Sandbox blocks it', 'Schema markup on 12 product pages'];
  for (const x of xs) { const y = dejargon(x); assert.doesNotMatch(y, BANNED, y); }
  assert.equal(dejargon('Products.json shows 913 items'), 'Your product list shows 913 items');
  assert.equal(dejargon('Read arata.in/products.json daily'), 'Read your product list daily');
  assert.match(dejargon('Schema markup on 12 product pages'), /^Search-friendly product info on 12 product pages$/);
});

test('a jam plan is plain: every step, its line and the case summary', () => {
  const c = { id: 'm30-1', title: 'Get named in AI answers', sub: 'Add JSON-LD and llms.txt so GMC reads arata.in/products.json', agent: 'visibility', sector: 'visibility',
    cta: { label: 'Add the search info' }, detail: { how: ['Add a webhook', 'Fix the custom pixel sandbox'] }, plan: { by: 'ai', steps: ['Audit products.json', 'Write the JSON-LD', 'Make the schema fix', 'Set a webhook'] } };
  const p = planFor(c);
  for (const s of p.steps) { assert.doesNotMatch(s.t, BANNED, s.t); assert.doesNotMatch(s.s || '', BANNED, s.s); }
  assert.doesNotMatch(p.summary.replace(/Next: .*$/, ''), BANNED);
});

test('a card with no rewrite yet (a demo visitor, AI off) still reads in plain words', () => {
  const P = createPlain({ ai: null, store: null });
  P._mem.set('x', {});
  const out = P.apply('x', { id: 'a', title: 'Fix GMC', sub: 'products.json lists 40 items', detail: { why: ['JSON-LD missing'], how: ['Add a webhook'] } });
  assert.doesNotMatch(JSON.stringify([out.title, out.sub, out.detail]), BANNED);
});

test('a Signals card that rests on an account names it; talk, team and connected cards need nothing', async () => {
  const { cardNeeds } = await import('../proof-logic.js');
  const has = () => true, off = { has, connected: () => false }, on = { has, connected: () => true };
  assert.deepEqual(cardNeeds({ id: 'm42-1', sector: 'signals', title: 'Remind serum buyers a week before the bottle runs out' }, [], off), ['shopify']);
  assert.deepEqual(cardNeeds({ id: 'm48-2', sector: 'signals', title: 'Message checkout starters' }, ['ga4', 'shopify'], off), ['ga4', 'shopify']);
  assert.deepEqual(cardNeeds({ id: 'm42-1', sector: 'signals', title: 'Remind serum buyers' }, [], on), []);
  assert.deepEqual(cardNeeds({ id: 'heard-t-1', sector: 'signals', origin: 'listen', title: 'People talk about returns' }, [], off), []);
  assert.deepEqual(cardNeeds({ id: 'm05-2', sector: 'signals', title: 'Hold three claims until R&D sends a basis' }, [], off), []);
  assert.deepEqual(cardNeeds({ id: 'm42-1', sector: 'signals', title: 'Remind serum buyers' }, [], { has: () => false, connected: () => false }), [], 'a brand with no store connector is never asked to connect one');
});

test('brand-facing labels: source lines, fact rows and the campaign button in plain words and sentence case', async () => {
  const fs = await import('node:fs');
  const mc = fs.readFileSync(new URL('../moves-cadence.js', import.meta.url), 'utf8'), fd = fs.readFileSync(new URL('../facts-desk.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mc, /`\$\{host\} products\.json`/, 'scorecard sources say "product list"');
  assert.doesNotMatch(fd, /'products\.json \(daily check\)'/);
  assert.match(fd, /label: dejargon\(f\.label\)/, 'fact rows heal saved labels');
  const { oneCard } = await import('../text-fit.js');
  assert.equal(oneCard({ cta: { label: 'Publish Campaign' } }).cta.label, 'Publish the campaign');
  const { recipeOfCard } = await import('../remix.js');
  assert.equal(recipeOfCard({ sector: 'ads', cta: { label: 'Publish the campaign' } }).primary, recipeOfCard({ sector: 'ads', cta: { label: 'Publish Campaign' } }).primary, 'the healed label maps like the old one');
  assert.equal(dejargon('Shopify Custom Web Pixel Sandbox'), 'Shopify tracking code');
});

/* final QA pass 19 Oct: what was still technical on live cards (Mamaearth, Arata, demo): fact rows, asset lines and the move name under a card */
test('a card’s fact rows, asset line and source line read plainly, for every brand', () => {
  const pl = createPlain({ ai: null, store: null });
  const c = pl.apply('x', { id: 'm64-1', title: 'Remind buyers to reorder', sub: 'x', src: 'Move 64 · Loop 3: SKU-Specific Reorder Clocks',
    rows: [['Total catalog SKUs', '913'], ['SKUs with Schema', '81'], ['Sitemap files', '7'], ['Headless Platform', 'shopify']], make: { format: 'page section', pieces: 'Homepage title, meta description, H1 and organisation markup' } });
  assert.equal(c.src, 'Move 64 · Product-Specific Reorder Clocks');
  assert.deepEqual(c.rows.map((r) => r[0]), ['Total catalog products', 'Products with search-friendly product info', 'Page lists for Google', 'Store platform']);
  assert.equal(c.make.pieces, 'Homepage title, search snippet, main heading and organisation info for Google');
  assert.equal(pl.apply('x', { id: 'm1011-1', title: 'a', src: 'Move 1011 · Automation' }).src, 'Weekly move 11 · Automation');
  assert.equal(dejargon('Hold markup on failing packs'), 'Hold markup on failing packs', 'a price markup is not page code');
});

test('a ratio is not a count: an asset line keeps 4:5 (final QA pass 19 Oct: "4:one static")', async () => {
  const { oneOf, oneCard } = await import('../text-fit.js');
  assert.equal(oneOf('4:5 static: Gully Number 001 – Megh White close-up'), '4:5 static: Gully Number 001 – Megh White close-up');
  assert.equal(oneCard({ make: { format: 'instagram post', pieces: '4:5 post: the unboxing card' } }).make.pieces, '4:5 post: the unboxing card');
  assert.equal(oneOf('Make 3 statics of the serum'), 'Make one static of the serum');
});
