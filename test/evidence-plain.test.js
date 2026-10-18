// The proof sheet (evidence.js) and plain words (plain.js) on every card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidence } from '../evidence.js';
import { createPlain, plainKey, dejargon } from '../plain.js';

const facts = {
  combo: { key: 'price.combo', label: 'Anti-Dandruff Combo price (arata.in/products)', v: '₹748', src: 'arata.in/products/combo', url: 'https://www.arata.in/products/combo', at: '2026-10-14' },
  massager: { key: 'price.massager', label: 'Scalp Massager price', v: '₹199', src: 'arata.in', url: 'https://www.arata.in/products/massager', at: '2026-10-14' },
  reviews: { key: 'reviews.serum', label: 'Serum reviews', v: '474 reviews', n: 474, src: 'Judge.me', url: 'https://judge.me/x', at: '2026-10-14' },
  demo: { key: 'demo.rev', label: 'Revenue', v: '₹9,99,000', kind: 'demo' }
};
const moves = { 8: { n: 8, title: 'Bonus and naming rules', stat: '₹0', statLabel: 'SAVED BY THE COMBO', factsUsed: ['price.combo'], sources: [{ label: 'Scalp Massager page', url: 'https://www.arata.in/products/massager', at: '2026-10-14' }, { label: 'Meta ad library, India', url: 'https://www.facebook.com/ads/library', at: '2026-10-14' }] } };
const EV = createEvidence({ factsOf: () => facts, movesOf: () => moves, numsOf: (src) => (/^Move 0?8\b/.test(src || '') ? [8] : []), adOf: (id) => (id === 'a1' ? { id: 'a1', brand: 'Rival', hook: 'Flakes gone in 7 days', url: 'https://facebook.com/ads/library/?id=1', days: 40, versions: 3 } : null), country: () => 'IN' });

test('evidence: every number on a move card is matched to its fact line with source and date, and the move cites its sources', () => {
  const c = { id: 'm08-2', src: 'Move 08 · Bonus and naming rules', title: 'Add a free massager to the ₹748 set', sub: 'The ₹199 Scalp Massager costs little. 474 reviews say the serum works.', detail: { why: ['The combo saves ₹0'] } };
  const e = EV.evidenceOf(c);
  const v = e.items.map((x) => x.value);
  assert.ok(v.includes('₹748') && v.includes('₹199') && v.includes('474 reviews'));
  const f = e.items.find((x) => x.value === '₹748');
  assert.equal(f.url, 'https://www.arata.in/products/combo'); assert.equal(f.at, '2026-10-14'); assert.equal(f.label, 'Anti-Dandruff Combo price');
  assert.equal(e.moves[0].n, 8); assert.ok(e.moves[0].sources[0].url);
  assert.equal(e.strength, 'strong'); assert.match(e.why.from, /Bonus and naming rules/);
});
test('evidence: a demo fact never backs a card, and an unmatched number is named, not hidden', () => {
  const e = EV.evidenceOf({ id: 'x', title: 'Revenue is ₹9,99,000', sub: 'Up to ₹5,555 this week.' });
  assert.ok(!e.items.some((x) => x.value === '₹9,99,000'));
  assert.ok(e.unbacked.includes('₹5,555'));
});
test('evidence: a connected account backs its number for a team member, a rival ad and a customer quote carry their links', () => {
  const e = EV.evidenceOf({ id: 'r-ad-a1', title: 'Rival: live 40 days', sub: 'Revenue ₹2,40,000 last month.', research: { kind: 'ad', id: 'a1' }, heard: { kind: 'thread', url: 'https://reddit.com/r/x/1', where: 'Reddit', quote: 'my scalp itches', replies: 12 } },
    { liveLedger: { 'shopify.revenue.30d': { v: '₹2,40,000', label: 'Revenue, last 30 days', at: Date.parse('2026-10-18') } } });
  const acct = e.items.find((x) => x.kind === 'account'); assert.equal(acct.src, 'Your Shopify account');
  assert.equal(e.items.find((x) => x.kind === 'ad').url, 'https://facebook.com/ads/library/?id=1');
  assert.equal(e.items.find((x) => x.kind === 'quote').url, 'https://reddit.com/r/x/1');
});
test('evidence: a card with nothing behind it says so (thin), never invents a source', () => {
  const e = EV.evidenceOf({ id: 'y', title: 'Try a new hook', sub: 'People like short videos.' });
  assert.equal(e.strength, 'thin'); assert.equal(e.items.length, 0);
});

test('plain: a rewrite that adds or drops a number keeps the original field; a clean one is kept', () => {
  const P = createPlain({ ai: null, store: null });
  const c = { id: 'm1', title: 'Front ads with the ₹748 set', sub: 'The combo saves ₹0. Add the ₹199 massager.', detail: { why: ['Saves ₹0 today'], how: ['Show the price'] } };
  const good = P.check(c, { title: 'Lead your ads with the ₹748 set', sub: 'The set saves buyers ₹0. Add the free ₹199 massager.', why: ['It saves ₹0 today'], how: ['Show the price'], because: 'Brew suggests this because the set saves ₹0.' });
  assert.equal(good.title, 'Lead your ads with the ₹748 set'); assert.ok(good.because);
  const bad = P.check(c, { title: 'Lead with the ₹699 set', sub: 'Add the massager.', why: ['x'], how: ['y'], because: 'It makes ₹50,000.' });
  assert.equal(bad.title, c.title); assert.equal(bad.sub, c.sub); assert.equal(bad.because, null);
});
test('plain: cached rewrites apply by the card\'s own words; jargon is swapped while a rewrite is on its way', async () => {
  const files = {};
  const store = { getJSON: async (s, f) => files[`${s}/${f}`] || {}, put: async (s, f, v) => { files[`${s}/${f}`] = JSON.parse(JSON.stringify(v)); } };
  const c = { id: 'm2', title: 'ROAS is low on PDP traffic', sub: 'Cold audiences see the hero product.', detail: { why: ['CTR is weak'], how: ['Fix the PDP'] } };
  const ai = async (prompt, schema) => { assert.ok(prompt.includes('"m2"')); return { cards: [{ id: 'm2', title: 'Your ads bring back too little', sub: 'People new to you see the best seller first.', why: ['Few people click'], how: ['Fix the product page'], because: 'Brew suggests this because few people click.' }] }; };
  const P = createPlain({ ai, store });
  await P.load('b1');
  const before = P.apply('b1', c);
  assert.equal(before.title, 'sales per rupee of ads is low on product page traffic'); assert.match(before.sub, /people new to you/i);
  assert.ok(P.queue('b1', [c], 'B1')); while (P.busy('b1')) await new Promise((r) => setTimeout(r, 5));
  const after = P.apply('b1', c);
  assert.equal(after.title, 'Your ads bring back too little'); assert.equal(after.detail.how[0], 'Fix the product page'); assert.equal(after.orig.title, c.title);
  assert.ok(files['b1/plain.json'][plainKey(c)]);
  assert.equal(P.apply('b1', { ...c, title: 'Changed words' }).title, 'Changed words'); /* changed words: no stale rewrite */
  assert.equal(dejargon('AOV and CTR'), 'average order and click rate');
});

test('"what\'s the evidence behind this?" is answered from the card\'s own proof: what Brew saw, the plan, the sources, the reasoning', async () => {
  const { EVIDENCE_ASK, proofAnswer } = await import('../evidence.js');
  for (const q of ['what’s the evidence behind this?', "what's the evidence behind this?", 'where did the ₹1,499 come from', 'show me the proof', 'how do you know?', 'why this card']) assert.ok(EVIDENCE_ASK.test(q.replace('’', "'")) || EVIDENCE_ASK.test(q), q);
  assert.ok(!EVIDENCE_ASK.test('make it shorter'));
  const e = EV.evidenceOf({ id: 'm08-2', src: 'Move 08 · Bonus and naming rules', title: 'Add a free massager to the ₹748 set', sub: 'The ₹199 Scalp Massager costs little.' });
  const a = proofAnswer(e);
  assert.match(a.text, /^Here’s what this card is based on\./); assert.match(a.text, /Saw: ₹748/); assert.match(a.text, /Plan: Move 08 · Bonus and naming rules/);
  assert.equal(a.proof.saw[0].url, 'https://www.arata.in/products/combo');
});

test('plain: a half answer (no body or reason) is never saved; it is asked again on the next load', async () => {
  const files = {}; const store = { getJSON: async (s, f) => files[`${s}/${f}`] || {}, put: async (s, f, v) => { files[`${s}/${f}`] = JSON.parse(JSON.stringify(v)); } };
  const c = { id: 'h1', title: 'Front ads with the hero SKU', sub: 'The PDP converts at 2%.', detail: { why: ['CTR is low'], how: ['Fix the PDP'] } };
  let calls = 0; const ai = async () => { calls++; return { cards: [{ id: 'h1', title: 'Lead your ads with your best seller', why: ['Few people click'] }] }; };
  const P = createPlain({ ai, store, log: { warn() {}, log() {} } }); await P.load('b2');
  P.queue('b2', [c], 'B2'); while (P.busy('b2')) await new Promise((r) => setTimeout(r, 5));
  assert.equal(P.get('b2', c), null, 'nothing kept from a half answer');
  P.queue('b2', [c], 'B2'); while (P.busy('b2')) await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 2, 'asked again');
});
