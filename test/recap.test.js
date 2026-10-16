// The Recap ring: what happened since the last visit, from data Brew already holds, for any brand. Nothing since (or no
// last visit yet) means no slides, so the ring does not show; simulated account rows never count as real numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecap, visitTick, sinceLabel, VISIT_GAP } from '../recap.js';

const H = 3600e3, T0 = Date.parse('2026-10-16T09:00:00Z');

test('a visit starts after 30 quiet minutes and remembers when the last one ended', () => {
  const t = { liveLedger: { 'shopify.orders': { n: 40, v: '40', at: T0 } } };
  visitTick(t, T0, T0); assert.equal(t.visit.prev, null, 'the first visit has nothing before it');
  visitTick(t, T0 + 10 * 60e3, T0 + 10 * 60e3); assert.equal(t.visit.prev, null, 'ten minutes later is the same visit');
  visitTick(t, T0 + 10 * 60e3 + VISIT_GAP + 1, T0 + 10 * 60e3 + VISIT_GAP + 1);
  assert.equal(t.visit.prev, T0 + 10 * 60e3, 'the new visit looks back to the end of the last one');
  assert.deepEqual(t.visit.base, { 'shopify.orders': { n: 40, v: '40' } }, 'the numbers as they stood are kept');
});

test('a workspace from before visits were kept looks back to the last time a ring was opened', () => {
  const t = { storySeen: { trends: T0 - 5 * H, ads: T0 - 3 * H } }; visitTick(t, T0 + 1000, T0);
  assert.equal(t.visit.prevReal, T0 - 3 * H); assert.equal(t.visit.prev, T0 + 1000 - 3 * H, 'on the workspace clock too');
  const u = { storySeen: { trends: T0 - 60e3 } }; visitTick(u, T0, T0); assert.equal(u.visit.prev, null, 'a ring opened a minute ago is this visit');
});

test('no last visit, or nothing since it: no slides (the ring does not show)', () => {
  assert.deepEqual(buildRecap({ since: null, work: [], notes: [], cards: [] }), []);
  const old = { id: 'c1', title: 'Old card', createdAt: T0 - 5 * H };
  const w = { id: 'w1', title: 'Old jam', stage: 'drafting', versions: [{ n: 1, at: T0 - 9 * H }], updatedAt: T0 - 9 * H, jamBrief: { status: 'sent', history: [{ s: 'sent', at: T0 - 9 * H }] } };
  assert.deepEqual(buildRecap({ since: T0, sinceReal: T0, work: [w], notes: [{ itemId: 'w1', at: T0 - H, text: 'hi' }], cards: [old], moveDocs: { 3: { title: 'M', meta: { rewrittenAt: new Date(T0 - H).toISOString() } } }, ledger: {}, base: {} }), []);
});

test('briefs, jams, cards, moves and accounts that moved each get a slide that opens the thing', () => {
  const since = T0, at = T0 + 2 * H;
  const brief = { id: 'w1', title: 'Diwali gift box ads', stage: 'deploying', versions: [{ n: 1, at: T0 - H }], jamBrief: { status: 'needs_info', history: [{ s: 'needs_info', at: at + 60e3, note: 'Which SKUs are in the box?' }, { s: 'received', at }, { s: 'sent', at: T0 - H }] } };
  const jam = { id: 'w2', title: 'Reorder message', stage: 'needs_you', updatedAt: at, versions: [{ n: 1, at: T0 - H }, { n: 2, at }] };
  const quiet = { id: 'w3', title: 'Nothing new', stage: 'drafting', updatedAt: T0 - H, versions: [{ n: 1, at: T0 - H }] };
  const gone = { ...jam, id: 'w4', discarded: true };
  const notes = [{ itemId: 'w2', at: at + 1, text: 'Asha replied in Slack' }, { itemId: 'w3', at: T0 - 2 * H, text: 'old' }];
  const cards = [{ id: 'm4-1', title: 'Bundle the bestsellers', createdAt: at, images: ['/x.jpg'] }, { id: 'c2', title: 'Fix the size chart', createdAt: at }, { id: 'c3', title: 'Older', createdAt: T0 - H }];
  const moveDocs = { 4: { title: 'Bundles', meta: { rewrittenAt: new Date(at).toISOString(), because: 'New evidence came in' } }, 5: { title: 'Untouched', meta: {} } };
  const ledger = { 'shopify.orders': { n: 52, v: '52', at, label: 'Orders, last 30 days' }, 'meta.cpa': { n: 410, v: '₹410', at, label: 'Cost per purchase' }, 'shopify.aov': { n: 900, v: '₹900', at, label: 'Average order' } };
  const base = { 'shopify.orders': { n: 40, v: '40' }, 'meta.cpa': { n: 410, v: '₹410' } };
  const s = buildRecap({ since, sinceReal: since, when: 'Since yesterday', work: [brief, jam, quiet, gone], notes, cards, moveDocs, ledger, base, moveCard: (n) => (n === 4 ? 'm4-1' : null) });
  assert.deepEqual(s.map((x) => x.kind), ['summary', 'briefs', 'jams', 'cards', 'moves', 'accounts']);
  assert.equal(s[0].h, 'Since yesterday');
  const by = Object.fromEntries(s.map((x) => [x.kind, x]));
  assert.equal(by.briefs.rows[0].workId, 'w1'); assert.equal(by.briefs.rows[0].s, 'Received → Needs info from you', 'the team’s moves, not the brand’s own send');
  assert.ok(by.briefs.rows[0].warn && /Which SKUs/.test(by.briefs.p), 'what the team needs is said');
  assert.deepEqual(by.jams.rows.map((r) => r.workId), ['w2'], 'only jams that changed; discarded ones never');
  assert.match(by.jams.rows[0].s, /1 update · New version \(v2\) · Needs your OK/);
  assert.deepEqual(by.cards.rows.map((r) => r.cardId), ['m4-1', 'c2']); assert.equal(by.cards.big, 2);
  assert.deepEqual(by.moves.rows.map((r) => [r.move, r.cardId]), [[4, 'm4-1']]);
  assert.deepEqual(by.accounts.rows.map((r) => r.s), ['40 → 52'], 'only numbers that moved and were there last time');
  assert.ok(by.accounts.conn);
  assert.ok(!JSON.stringify(s).match(/\b0 (brief|jam|card|move|number)s?\b/), 'never a zero tile');
});

test('one thing happened: just that slide, no summary', () => {
  const s = buildRecap({ since: T0, sinceReal: T0, work: [], notes: [], cards: [{ id: 'c1', title: 'Only one', sub: 'Why it matters', createdAt: T0 + H }], ledger: null });
  assert.equal(s.length, 1); assert.equal(s[0].h, 'Only one'); assert.equal(s[0].rows[0].cardId, 'c1');
});

test('no connected accounts (or the demo, whose simulated rows never reach the ledger): no account slide', () => {
  const s = buildRecap({ since: T0, sinceReal: T0, work: [], notes: [], cards: [{ id: 'c1', title: 'x', createdAt: T0 + H }], ledger: null, base: { a: { n: 1 } } });
  assert.ok(!s.some((x) => x.kind === 'accounts'));
});

test('the last visit in plain words', () => {
  assert.equal(sinceLabel(T0, T0 + 50 * 60e3), 'In the last hour');
  assert.equal(sinceLabel(T0, T0 + 5 * H), 'In the last 5 hours');
  assert.equal(sinceLabel(T0, T0 + 26 * H), 'Since yesterday');
  assert.match(sinceLabel(T0, T0 + 3 * 24 * H), /^Since [A-Z][a-z]+day$/);
  assert.equal(sinceLabel(T0, T0 + 9 * 24 * H), 'In the last 9 days');
});
