// Citations and the claim check (2026-10-16 audit): every move's meta.cites holds the ledger lines and sources it rests on
// (keys and URLs), the move page and the PDF show them, and "Every number checked" is the same bar whatever model wrote
// or checked the move: each number must be found in the evidence. Free: a fake AI, no network.
process.env.AI_MOCK = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMovesEngine, citesFor, citeMove, dateMove } from '../moves-engine.js';
import { moveHtml } from '../pdf/template.js';
import { numbersOf } from '../pack-numbers.js';

const LEDGER = [
  { key: 'ads.own.live', label: 'Acme: live Meta ads in IN', v: '664', n: 664, src: 'facebook.com/ads/library', url: 'https://www.facebook.com/ads/library/?q=Acme', at: '2026-10-14' },
  { key: 'price.serum', label: 'Hair serum', v: '₹1,299', n: 1299, src: 'acme.in/products/serum', url: 'https://acme.in/products/serum', at: '2026-10-14' },
  { key: 'reviews.total', label: 'Reviews and ratings found', v: '84,278', n: 84278, src: 'acme.in', at: '2026-10-14' },
  { key: 'brand.name', label: 'Brand name', v: 'Acme', src: 'acme.in', at: '2026-10-14' }];
const p = (text) => ({ t: 'p', text });
const moveOf = (found, extra = {}) => ({ n: 9, title: 'Pricing', stat: '₹1,299', statLabel: 'The hero price', gives: 'A price plan', live: 'A tested offer',
  sections: [{ h: 'What we found', kind: 'found', blocks: [p(found)] }, { h: 'The plan', kind: 'plan', blocks: [p('Hold the price for 30 days.')] }],
  sources: [{ label: 'Acme serum page', url: 'https://acme.in/products/serum', at: '2026-10-14' }], factsUsed: ['price.serum'], derived: [], newFacts: [], toConfirm: [], meta: { model: 'x', searched: [], cites: [] }, ...extra });

test('meta.cites: the ledger lines it names, the lines whose numbers it quotes, its own sources and the search results it used', () => {
  const m = moveOf('The serum sells at ₹1,299 and Acme runs 664 live ads, with 84,278 reviews and ratings.', { meta: { searched: [{ url: 'https://news.test/a', title: 'A story' }, { url: 'https://unused.test', title: 'Not used' }] }, newFacts: [{ v: '12%', label: 'Category growth', url: 'https://news.test/a', quote: 'grew 12%' }] });
  const c = citesFor(m, LEDGER, m.meta.searched);
  const ks = c.filter((x) => x.kind === 'ledger').map((x) => x.key);
  assert.equal(ks[0], 'price.serum', 'factsUsed first'); assert.deepEqual([...ks].sort(), ['ads.own.live', 'price.serum', 'reviews.total'], 'then every quoted number’s line');
  assert.equal(c.find((x) => x.key === 'ads.own.live').url, 'https://www.facebook.com/ads/library/?q=Acme', 'keys and URLs');
  assert.ok(!c.some((x) => x.kind === 'source' && x.url === 'https://acme.in/products/serum'), 'a source already cited by its ledger line is not listed twice');
  assert.deepEqual(c.filter((x) => x.kind === 'web').map((x) => x.url), ['https://news.test/a'], 'only the search results it used');
  citeMove(m, LEDGER);
  assert.ok(m.meta.cites.length >= 4);
  assert.ok(m.sources.some((s) => s.key === 'reviews.total' && /84,278/.test(s.label)), 'the sources list carries the evidence lines');
});

test('the move page and the PDF show the citations, even under a Sources section the move wrote itself', () => {
  const m = citeMove(moveOf('The serum sells at ₹1,299.', { sections: [...moveOf('').sections.slice(0, 1).map((s) => ({ ...s, blocks: [p('The serum sells at ₹1,299.')] })), { h: 'Sources', kind: 'sources', blocks: [{ t: 'list', items: ['The product page'] }] }] }), LEDGER);
  const html = moveHtml(m, { name: 'Acme' });
  assert.match(html, /Evidence lines/); assert.match(html, /Hair serum: ₹1,299/); assert.match(html, /price\.serum/);
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /hasSrc && \(m\.meta\?\.cites \|\| \[\]\)\.some\(\(c\) => c\.kind === 'ledger'/, 'the move page lists them under its own Sources');
});

/* the checker is a model: a soft one (it finds nothing) must not pass a number the evidence lacks */
const engineWith = (issues = []) => createMovesEngine({ ai: { call: async (o) => (/^verify/.test(o.tag) ? { json: { issues } } : { json: { edits: [] } }) }, log: { warn() {}, log() {} } });

test('verified is the same bar for every model: every number found in the evidence, every fact it names a real line', async () => {
  const E = engineWith([]); /* a checker that finds nothing, like a soft model */
  const ok = await E.verify(moveOf('The serum sells at ₹1,299 with 84,278 reviews.'), LEDGER, { brief: { md: '' } });
  assert.equal(ok.move.meta.verified, true, 'every number is in the ledger');
  const bad = await E.verify(moveOf('The serum sells at ₹1,299 with 91,000 reviews.'), LEDGER, { brief: { md: '' } });
  assert.equal(bad.move.meta.verified, false, 'a soft checker can’t pass a number the evidence lacks'); assert.equal(bad.move.meta.verify.unresolvedNumbers, 1);
  assert.match(JSON.stringify(bad.move.sections), /91,000 reviews \(to confirm\)/);
  const keys = await E.verify(moveOf('The serum sells at ₹1,299.', { factsUsed: ['price.serum', 'reviews.made_up'] }), LEDGER, { brief: { md: '' } });
  assert.equal(keys.move.meta.verified, false); assert.deepEqual(keys.move.meta.verify.unknownKeys, ['reviews.made_up']);
});

test('search results are evidence the same way for every model: a number only through a new fact with its URL and quote', async () => {
  const E = engineWith([]);
  const text = 'The category grew 23,000 reviews this year and the serum is ₹1,299.';
  /* one model returns snippets with the number in the title, another returns only URLs: neither passes it on its own */
  const withSnippet = await E.verify(moveOf(text, { meta: { searched: [{ url: 'https://news.test/a', title: 'Category hits 23,000 reviews', quote: '23,000 reviews' }] } }), LEDGER, { brief: { md: '' } });
  const urlOnly = await E.verify(moveOf(text, { meta: { searched: [{ url: 'https://news.test/a', title: 'A story' }] } }), LEDGER, { brief: { md: '' } });
  assert.equal(withSnippet.move.meta.verified, false); assert.equal(urlOnly.move.meta.verified, false);
  /* with the new fact (its URL among the results, its quote holding the number) both pass */
  const nf = [{ v: '23,000 reviews', label: 'Category reviews', url: 'https://news.test/a', quote: 'the category passed 23,000 reviews' }];
  for (const searched of [[{ url: 'https://news.test/a', title: 'Category hits 23,000 reviews' }], [{ url: 'https://news.test/a', title: 'A story' }]]) {
    const r = await E.verify(moveOf(text, { newFacts: nf, meta: { searched } }), LEDGER, { brief: { md: '' } });
    assert.equal(r.move.meta.verified, true, JSON.stringify(searched));
  }
});

test('a move dates its counts: "664 live ads on 14 Oct"', () => {
  const N = numbersOf({ profile: { name: 'Acme', ads: { at: '2026-10-14', own: { page: 'Acme', live: 664 }, rivals: [] } } });
  const m = dateMove(moveOf('Acme runs 664 live ads.'), N);
  assert.equal(m.sections[0].blocks[0].text, 'Acme runs 664 live ads on 14 Oct.');
  assert.match(fs.readFileSync(new URL('../moves-engine.js', import.meta.url), 'utf8'), /never a bare "664 live ads"/, 'the writer is told to date them too');
});
