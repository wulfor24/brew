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
test('a budget jam whose card was withdrawn, or that names a campaign the account lacks, is stopped with the reason', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.match(src, /live-meta-shift\/\.test\(String\(ch\.cardId \|\| ''\)\) && !card\?\.shift/, 'withdrawn card is checked');
  assert.match(src, /the budget card was withdrawn on today’s numbers/);
  assert.match(src, /meta\.campaigns\.7d/, 'names are checked against the live campaign list');
  assert.match(src, /in your Meta account this week. Use one of yours/);
});
