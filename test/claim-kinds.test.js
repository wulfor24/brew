// A card says Brew saw only what Brew holds (Param, 19 Oct): the writers get the brand's evidence kinds (proof-logic.js
// evidenceKinds), a card whose observation outruns them is reworded once as an idea (cards-gen.js), and the plain-words
// rewrite never turns an idea into something Brew saw (plain.js). No AI and no spend: the AI here is a stand-in
import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceKinds, claimGaps, writerEvidence } from '../proof-logic.js';
import { createCardsGen, voiceOfProfile } from '../cards-gen.js';
import { createPlain } from '../plain.js';

const quiet = { log() {}, warn() {} };
const happy = { reviews: { quotes: [{ text: 'It keeps the curls for long, I love this gel so much.', rating: 5 }, { text: 'Lovely smell and my curls stay soft all day.', rating: 4 }] } };

test('evidence kinds: reviews by stars, threads, connected accounts (never demo or stale), search counts', () => {
  const k = evidenceKinds({ voice: [...voiceOfProfile(happy), { kind: 'thread', text: 'Is this gel any good?', where: 'r/curlyhair' }],
    ledger: [{ key: 'ga4.sessions', v: '1,200', method: 'account:ga4', layer: 'observed' }, { key: 'shopify.orders', v: '40', method: 'account:shopify', demo: true }, { key: 'meta.roas', v: '2', method: 'account:meta', stale: true }, { key: 'gads.spend', v: '9', method: 'account:gads' }],
    facts: { a: { label: 'Google rank for "curl gel" (IN)', v: '#4' } } });
  assert.equal(k.reviews, 2); assert.equal(k.happy, 2); assert.equal(k.unhappy, 0); assert.equal(k.threads, 1);
  assert.deepEqual(k.accounts.sort(), ['ga4', 'google']);
  assert.equal(k.search.ranks, 1); assert.equal(k.search.volumes, 0);
  const block = writerEvidence(k, 'Arata');
  assert.match(block, /None complains/); assert.match(block, /Google Analytics, Google Ads connected/); assert.match(block, /No counts of how many people search/);
});

test('claim gaps: bounce with no analytics, doubt over happy reviews, searches with no counts; ideas and outcomes pass', () => {
  const none = evidenceKinds({ voice: voiceOfProfile(happy) });
  assert.deepEqual(claimGaps('We saw high bounce rates on the ₹1,499 page.', none).map((g) => g.kind), ['account']);
  assert.deepEqual(claimGaps('We saw CGM customers questioning if products ruin curls.', none).map((g) => g.kind), ['praise']);
  assert.deepEqual(claimGaps('People search for heated slippers every winter.', none).map((g) => g.kind), ['search']);
  assert.deepEqual(claimGaps('We saw high bounce rates on the page.', { ...none, accounts: ['ga4'] }), []);
  assert.deepEqual(claimGaps('Buyers may worry the gel ruins curls.', none), [], 'an idea is not an observation');
  assert.deepEqual(claimGaps('A 5★ review says it keeps curls long. This reel will stop people leaving.', none), [], 'what the action does is not a claim');
  assert.deepEqual(claimGaps('We saw customers questioning the price.', { ...none, threads: 3 }), [], 'threads can hold doubt');
});

test('cards-gen: a card that claims bounce with no account is reworded once as an idea; the card and its number stay', async () => {
  const calls = [];
  const first = { label: { short: 's', line: 'l' }, cards: [
    { type: 'idea', title: 'Explain the ₹1,499 serum price', sub: 'We saw high bounce rates on the ₹1,499 serum page. Add a cost-per-day line so buyers see the value.', why: ['a'], how: ['b'], rows: [], cta: 'Open the scoreboard' },
    { type: 'idea', title: 'Show the curl review', sub: 'A 5★ review says the gel keeps curls long. Put it on the gel page.', why: ['a'], how: ['b'], rows: [], cta: 'Open the scoreboard' }] };
  const ai = { call: async (o) => { calls.push(o); if (o.tag === 'cards-claims') return { json: { cards: [{ id: 'm07-1', title: 'Explain the ₹1,499 serum price', sub: 'A price of ₹1,499 can make new visitors hesitate. Add a cost-per-day line so buyers see the value.' }] } }; return { json: first }; } };
  const move = { n: 7, title: 'T', gives: 'g', live: 'l', sections: [{ h: 'Why', blocks: [{ text: 'The serum sells at ₹1,499.' }] }] };
  const r = await createCardsGen({ ai, log: quiet }).fromMove(move, { brand: { name: 'Arata', host: 'arata.in' }, profile: happy, facts: { p: { label: 'Serum price', v: '₹1,499' } }, lanes: { core: {} }, laneImg: {}, ledger: [] });
  assert.equal(r.cards.length, 2, 'no card is dropped');
  assert.match(calls[0].prompt, /WHAT BREW HOLDS FOR Arata/); assert.match(calls[0].prompt, /none connected/);
  assert.equal(calls.filter((c) => c.tag === 'cards-claims').length, 1); assert.match(calls[1].prompt, /no Google Analytics or Shopify account is connected/);
  assert.equal(r.cards[0].sub, 'A price of ₹1,499 can make new visitors hesitate. Add a cost-per-day line so buyers see the value.');
  assert.equal(r.cards[1].sub, first.cards[1].sub, 'a card with nothing to fix keeps its words');
});

test('cards-gen: a rewording that adds a number, or still claims as much, is not kept; a failed call keeps the card', async () => {
  const card = { type: 'idea', title: 'Fix the cart drop-off', sub: 'We saw shoppers abandon carts at checkout. Turn on guest checkout to keep them.', why: ['a'], how: ['b'], rows: [], cta: 'Open the scoreboard' };
  const run = async (fix) => createCardsGen({ ai: { call: async (o) => (o.tag === 'cards-claims' ? fix() : { json: { label: {}, cards: [card] } }) }, log: quiet })
    .fromMove({ n: 3, title: 'T', gives: 'g', live: 'l', sections: [] }, { brand: { name: 'Acme', host: 'acme.com' }, facts: {}, lanes: { core: {} }, laneImg: {}, ledger: [] });
  assert.equal((await run(() => ({ json: { cards: [{ id: 'm03-1', title: 'Fix the cart drop-off', sub: 'Shoppers may give up at checkout, 40% of them. Turn on guest checkout.' }] } }))).cards[0].sub, card.sub);
  assert.equal((await run(() => ({ json: { cards: [{ id: 'm03-1', title: 'Fix the cart drop-off', sub: 'Shoppers are abandoning carts at checkout. Turn on guest checkout.' }] } }))).cards[0].sub, card.sub);
  assert.equal((await run(() => { throw new Error('quota'); })).cards[0].sub, card.sub);
});

test('plain: a rewrite that turns an idea into something Brew saw keeps the original words', () => {
  const P = createPlain({ ai: null, store: null });
  const c = { id: 'm1', title: 'Explain the serum price', sub: 'Buyers may balk at the price. Add a cost-per-day line.', detail: { why: ['Price needs a reason'], how: ['Add the line'] } };
  const r = P.check(c, { title: 'Explain the serum price', sub: 'Visitors are leaving the page over the price. Add a cost-per-day line.', why: ['Price needs a reason'], how: ['Add the line'], because: 'Brew suggests this because shoppers are leaving the serum page.' }, {});
  assert.equal(r.sub, c.sub); assert.equal(r.because, null);
  const ok = P.check(c, { title: 'Explain the serum price', sub: 'Buyers may think the price is high. Add a cost-per-day line.', why: ['Price needs a reason'], how: ['Add the line'], because: 'Brew suggests this because buyers may worry about the price.' }, {});
  assert.equal(ok.sub, 'Buyers may think the price is high. Add a cost-per-day line.'); assert.ok(ok.because);
});
