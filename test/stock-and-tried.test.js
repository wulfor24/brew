// Two things that make a move wrong: a product it builds on is out of stock or off the site (marked out of date at once,
// rewritten in the weekly run, cleared when it comes back), and what the brand already tried (every one in the brief, and
// in every rewrite, so a move builds on what worked and never brings back what didn't).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { productNames, movesNaming, handleOfItem } from '../refresh.js';
import { KINDS, learnedSection, briefView, heuristicLearnings, emptyLearned } from '../brand-learnings.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const products = [{ handle: 'rosemary-oil', title: 'Rosemary Hair Oil - 100ml' }, { handle: 'serum', title: 'Hair Serum' }];
const mv = (n, text) => ({ n, title: `Move ${n}`, sections: [{ h: 'Plan', blocks: [{ t: 'p', text }] }], meta: { at: 'a' } });

test('the names a move would call a product by, and the moves that name it', () => {
  assert.deepEqual(productNames({ handle: 'rosemary-oil' }, products), ['rosemary hair oil - 100ml', 'rosemary hair oil']);
  assert.equal(handleOfItem({ title: 'price.rosemary-oil', url: 'https://acme.com/products/rosemary-oil?x=1' }), 'rosemary-oil');
  assert.deepEqual(productNames({ title: 'price.rosemary-oil', url: 'https://acme.com/products/rosemary-oil' }, products), ['rosemary hair oil - 100ml', 'rosemary hair oil'], 'a ledger key is never a name');
  const moves = { 1: mv(1, 'Lead with Rosemary Hair Oil in every ad'), 2: mv(2, 'Bundle the Hair Serum'), 1001: { ...mv(1001, 'Rosemary Hair Oil weekly'), meta: { cadence: true } } };
  assert.deepEqual(movesNaming(moves, ['rosemary hair oil']), [1], 'never a weekly cadence move');
});

async function brand() {
  const { createPacks } = await import('../brand-pack.js'); const { createBuilder } = await import('../build.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-stock-'));
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = 'acme-com', runs = [];
  await P.put(slug, 'status.json', { slug, name: 'Acme', done: true, ready: true, state: 'Ready' });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.com', catalog: { products } });
  await P.put(slug, 'ledger.json', []);
  await P.put(slug, 'brief.json', { name: 'Acme', catalogue: [], claims: [], platforms: [], quotes: [], channels: [], company: [], personas: [], objections: [], rivals: [], gaps: [], toConfirm: [], goal: 'To confirm', at: '2026-10-01' });
  await P.put(slug, 'brief.md', '# Acme brief');
  await P.put(slug, 'moves.json', { 1: mv(1, 'Lead with Rosemary Hair Oil in every ad'), 2: mv(2, 'Bundle the Hair Serum with a comb'), 3: mv(3, 'Win back lapsed buyers') });
  const moves = { SPECS: [{ n: 1 }, { n: 2 }, { n: 3 }], createMovesEngine: () => ({ runAll: async (ctx, { only }) => { runs.push({ only, md: ctx.brief.md }); for (const n of only) if (n) await ctx.save(n, { n, title: `Rewritten ${n}`, meta: {} }); } }) };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {} }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves, pdf: null } });
  return { b, P, slug, runs };
}
const stale = async (P, slug) => (await P.getJSON(slug, 'updates.json', {})).stale || {};
const OOS = { kind: 'oos', urgent: true, items: [{ handle: 'rosemary-oil', title: 'Rosemary Hair Oil - 100ml', inStock: false }] };

test('out of stock: every move naming the product is out of date at once, kept on top, cleared when it is back', async () => {
  const { b, P, slug } = await brand();
  /* move 1 already carries a quieter flag (a connected account moved): the stock mark goes on top and gives it back after */
  await P.put(slug, 'updates.json', { stale: { 1: { n: 1, priority: 'medium', via: 'shopify', live: true, real: true, why: 'Shopify moved.', changes: ['Orders: 1 → 2'] } } });
  const r = await b.stockSignal(slug, [OOS]);
  assert.deepEqual(r.flagged, [1]);
  let s = await stale(P, slug);
  assert.equal(s[1].priority, 'high', 'the move page says "This move is out of date"');
  assert.match(s[1].why, /^Rosemary Hair Oil - 100ml is out of stock on the site, and this move builds on it\. Shopify moved\.$/);
  assert.equal(s[2], undefined, 'a move that does not name it is left alone');
  const at = s[1].at;
  assert.deepEqual((await b.stockSignal(slug, [OOS])).flagged, [], 'the same out-of-stock pass every 3 hours changes nothing');
  assert.equal((await stale(P, slug))[1].at, at);

  await b.liveConnected(slug, 'shopify', [], true, { public: false }).catch(() => {});
  assert.ok((await stale(P, slug))[1].stockWhy, 'a re-read never takes the stock mark off');

  await b.stockSignal(slug, [{ kind: 'back', items: [{ handle: 'rosemary-oil' }] }]);
  s = await stale(P, slug);
  assert.equal(s[1].priority, 'medium'); assert.equal(s[1].why, 'Shopify moved.'); assert.equal(s[1].stockWhy, undefined, 'back in stock: the earlier flag is as it was');
  assert.deepEqual((await P.getJSON(slug, 'updates.json', {})).stockOut, {});
});

test('a product gone from the site flags its moves; the weekly run rewrites them and the rewrite is told what can not be sold', async () => {
  const { b, P, slug, runs } = await brand();
  await P.put(slug, 'learned.json', { ...emptyLearned(), tried: [{ text: 'They ran influencer posts in 2025 and they did not convert.', source: 'Call, added by Asha' }] });
  await b.stockSignal(slug, [{ kind: 'removed', items: [{ handle: 'serum', title: 'Hair Serum' }] }]);
  const s = await stale(P, slug);
  assert.match(s[2].why, /Hair Serum is no longer on the site/); assert.equal(s[2].via, 'stock');
  const w = await b.liveWeekly(slug); await settle();
  assert.equal(w.ok, true); assert.deepEqual(runs.at(-1).only, [2]);
  assert.match(runs.at(-1).md, /## Right now on the site[\s\S]*- Hair Serum: no longer on the site/);
  assert.match(runs.at(-1).md, /What Acme already tried[\s\S]*influencer posts in 2025 and they did not convert/, 'every rewrite carries what they tried');
  assert.equal((await stale(P, slug))[2], undefined, 'rewritten, the mark is gone');
  assert.deepEqual((await b.stockSignal(slug, [{ kind: 'removed', items: [{ handle: 'serum', title: 'Hair Serum' }] }])).flagged, [], 'and the same news does not flag it again');
  await b.stockSignal(slug, [{ kind: 'new', items: [{ handle: 'serum', title: 'Hair Serum' }] }]);
  assert.deepEqual((await P.getJSON(slug, 'updates.json', {})).stockOut, {}, 'back on the site, it is no longer listed as gone');
});

test('what they tried: its own kind, every one in the brief with the rule, kept as history', () => {
  assert.ok(KINDS.includes('tried'));
  const tried = Array.from({ length: 30 }, (_, i) => ({ text: `They tried thing ${i + 1} and it did not work.`, source: 'Notes' }));
  const md = learnedSection({ ...emptyLearned(), beliefs: [{ text: 'Never discount.', source: 'Call' }], tried }, { name: 'Acme' });
  assert.match(md, /What Acme already tried, and how it went \(respect every one\)/);
  assert.match(md, /Never recommend again what they say didn't work, unless the move says plainly what is different this time/);
  assert.match(md, /thing 30 and it did not work/, 'never cut to six');
  assert.equal(briefView({ tried }).tried.length, 30);
  const h = heuristicLearnings('We ran influencer campaigns last Diwali and they didn’t convert at all for us.\nOur best ad was the before-after video with the founder.');
  assert.deepEqual(h.map((x) => x.kind), ['tried', 'tried']);
});
