// the brand's fact sheet leads every brief prompt; it never ends up inside a jam's brief (Cozy, 22 Oct)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJamBrief } from '../jam-brief.js';

const FACT = '# Acme brand brief\n\n**Warm things.** Snapshot: 2026-10-16.\n\n## Catalogue and prices\n\n| Product | Price |\n| --- | --- |\n| Toe Toasters | $34 [k:price.toe] |\n\n## Claims ledger (exact claims printed by the brand)\n\n- Warm in 60s [k:claim.1]\n\n## Company facts\n\n- Founded 2024 [k:company.founded]';
const JAM = '# Launch the warm-up ad\n\nWe launch early warm-up ads.\n\n## The plan\n\n- **Brew recommends:** Queue the ads.\n\n**Next:** Queue the ads.';
const LEAKED = `${FACT}\n\n## The plan\n\n- **Brew recommends:** Queue the ads.\n- **Other options:** Start smaller (one ad first).\n\n**Next:** Queue the ads.`;
const make = (doc) => createJamBrief({ cardOf: (t, id) => t.cards.get(id), isMock: () => false, spend: () => true, now: () => 1, clean: (x) => x, seatLine: () => '',
  cardBrief: (c) => `${FACT}\n\nCard (by the ${c.agent} agent, from x):\nTitle: ${c.title}\nBody: ${c.sub}\nThe person reading is the founder.`,
  claudeTool: async () => ({ reply: 'Done.', doc, next: [], plan: null, measure: null }) });
const work = () => ({ id: 'w1', cardId: 'c1', title: 'Launch the warm-up ad', versions: [], current: 1, doc: { md: JAM, rev: 2, edits: [{ rev: 2, by: 'you' }], planned: 1, measure: { metric: 'x' } } });
const tOf = () => ({ cards: new Map([['c1', { id: 'c1', title: 'Launch the warm-up ad', sub: 'Early ads', agent: 'performance' }]]) });

test('an AI edit that pastes the fact sheet in keeps only the jam brief', async () => {
  const JB = make(LEAKED), t = tOf(), w = work();
  await JB.edit(t, w, 'Make the brief match the package', { who: 'Brew', sync: true });
  const md = w.doc.md;
  assert.doesNotMatch(md, /Acme brand brief|Catalogue and prices|Claims ledger|Company facts|\[k:/);
  assert.match(md, /^# Launch the warm-up ad/);
  assert.match(md, /Start smaller \(one ad first\)/);
});

test('a saved brief that already carries the fact sheet is cleaned when it loads', () => {
  const JB = make(JAM), t = tOf(), w = work(); w.doc.md = LEAKED;
  const md = JB.seed(t, w).md;
  assert.doesNotMatch(md, /Acme brand brief|Catalogue and prices|Claims ledger|\[k:/);
  assert.match(md, /^# Launch the warm-up ad/);
  assert.match(md, /Start smaller/);
});

test('a clean brief is left as it is', () => {
  const JB = make(JAM), t = tOf(), w = work();
  assert.equal(JB.seed(t, w).md, JAM);
});
