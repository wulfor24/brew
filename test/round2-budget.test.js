// Round 2 (23 Oct QA 1.1 / 3.9): a budget card from the connected Meta account and the draft behind it move the same amount between
// the same two campaigns, and the card shows the sum (each campaign's spend a day before and after)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockPkg } from '../studio.js';
import { runIn } from '../brand-ctx.js';
import META from '../connectors/meta.js';

const card = { id: 'live-meta-shift', title: 'Move ₹776 a day to Nitin Joshi video', rows: [], detail: { how: ['Move the budget tomorrow morning', 'Read it after 7 days', 'Move it back if cost per purchase rises 15%'] },
  shift: { from: 'Founder video, Hindi', to: 'Nitin Joshi video', fromRoas: 1.58, toRoas: 2.38, perDay: 776, fromDay: 3880, toDay: 2500, fromId: '111', toId: '222', fromAct: 'act_9', toAct: 'act_9' } };

test('the budget draft moves exactly the card’s amount between the card’s two campaigns', () => {
  const p = runIn({ slug: 'acme', name: 'Acme', sym: '₹', config: {}, seed: { brand: { name: 'Acme' } } }, () => mockPkg('meta_ops', 'performance.shift_budget', card, 0, '', {}));
  assert.equal(p.items.length, 2); assert.equal(p.items[0].name, 'Founder video, Hindi'); assert.equal(p.items[1].name, 'Nitin Joshi video');
  const n = (s) => +String(s).replace(/[^\d]/g, '');
  assert.equal(n(p.items[0].now) - n(p.items[0].next), 776); assert.equal(n(p.items[1].next) - n(p.items[1].now), 776, 'total spend stays the same');
  assert.match(p.summary, /776/);
});
test('the connector writes the sum onto the card and the ids the Ads Manager link needs', () => {
  const src = META.sync.toString();
  assert.match(src, /a fifth of \$\{F\.money\(worst\.spendDay\)\}/, 'Move a day says how it was worked out');
  assert.match(src, /fromAct: worst\.act/); assert.match(src, /fromImg: campImg\(worst\)/);
});
test('a budget draft is stopped when its card was withdrawn or it names a campaign the account lacks', async () => {
  const { budgetMatch } = await import('../budget-match.js');
  const pkg = runIn({ slug: 'acme', name: 'Acme', sym: '₹', config: {}, seed: { brand: { name: 'Acme' } } }, () => mockPkg('meta_ops', 'performance.shift_budget', card, 0, '', {}));
  const ch = { family: 'meta_ops', action: 'performance.shift_budget', cardId: 'live-meta-shift', pkg };
  const t = { member: true, liveLedger: { 'meta.campaigns.7d': { v: 'Founder video, Hindi: ₹3,880; Nitin Joshi video: ₹2,500' } } };
  assert.equal(budgetMatch(card, ch, t).ok, true, 'the matching draft passes');
  const made = budgetMatch(card, { ...ch, pkg: { ...pkg, items: [{ ...pkg.items[0], name: 'META_Test_CBO' }, pkg.items[1]] } }, t);
  assert.equal(made.ok, false); assert.match(made.k, /META_Test_CBO.*isn’t a campaign in your Meta account/);
  const gone = budgetMatch({ id: 'live-meta-shift' }, ch, t); assert.equal(gone.ok, false); assert.match(gone.k, /withdrawn on today’s numbers/);
  assert.equal(budgetMatch(card, { ...ch, family: 'post' }, t), null, 'only budget drafts are checked');
});
test('the simulated Meta account’s budget card carries its move, and its draft matches it (demo site, 3.9)', async () => {
  const { demoFor } = await import('../demo-data.js'); const { budgetMatch } = await import('../budget-match.js');
  const d = demoFor({ name: 'Acme', host: 'acme.in', country: 'IN', currency: 'INR', catalog: { products: [{ title: 'Serum', price: 499 }] } }, { brand: { name: 'Acme' } });
  const c0 = d.cards.find((c) => c.id === 'demo-meta-shift'); assert.ok(c0?.shift?.from && c0.shift.to && c0.shift.perDay > 0, 'the card has its move');
  const c = { ...c0, id: 'live-meta-shift' }, pkg = runIn({ slug: 'acme', name: 'Acme', sym: '₹', config: {}, seed: { brand: { name: 'Acme' } } }, () => mockPkg('meta_ops', 'performance.shift_budget', c, 0, '', {}));
  assert.equal(pkg.items[0].name, c.shift.from); assert.equal(budgetMatch(c, { family: 'meta_ops', action: 'performance.shift_budget', cardId: c.id, pkg }, null).ok, true);
});
