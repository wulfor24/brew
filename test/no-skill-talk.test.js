// Moves speak the brand's business: the source method ("this skill was written for software", "In SaaS", "where it says G2")
// never reaches the reader. The house prompt forbids it and saved moves heal on read (brew-name.js unSkill), for every brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unSkill, brewFile } from '../brew-name.js';

test('translation preambles leave; the rest of the paragraph stays whole (Judge.me, arata.in, ₹1,499 do not split)', () => {
  const t = unSkill('This discipline applies to Acme directly. The skill was written for software, so three terms need translating. Where it says G2 and Capterra, read Judge.me reviews. Acme sells at ₹1,499 on acme.in today. Rivals undercut it.');
  assert.equal(t, 'Acme sells at ₹1,499 on acme.in today. Rivals undercut it.');
});
test('"the skill says X" reads as the practice itself', () => {
  assert.equal(unSkill('The skill says a large rise goes in stages, and the skill\'s rollout rule holds for every pack we sell here.'), 'Good practice says a large rise goes in stages, and the rollout rule holds for every pack we sell here.');
});
test('a saved moves.json heals on read and stays valid JSON; other files are left alone', () => {
  const moves = { 3: { title: 'x', sections: [{ h: 'Why', blocks: [{ t: 'p', text: 'This skill was written for software, so here is the translation for this brand and its shoppers today.' }, { t: 'p', text: 'Real paragraph about the brand and its prices, long enough to count as one.' }] }] } };
  const out = JSON.parse(brewFile('brands/x/moves.json', Buffer.from(JSON.stringify(moves))).toString());
  assert.deepEqual(out[3].sections[0].blocks.map((b) => b.text), ['Real paragraph about the brand and its prices, long enough to count as one.']);
  const listen = Buffer.from(JSON.stringify({ items: [{ text: 'We moved off G2 because the skill was written for software buyers only.' }] }));
  assert.equal(brewFile('brands/x/listen/items.json', listen), listen);
});
test('the house prompt no longer asks for a translation paragraph', () => {
  const p = fs.readFileSync(new URL('../prompts/move-house.md', import.meta.url), 'utf8');
  assert.doesNotMatch(p, /Translate the skill first/);
  assert.match(p, /Never\s+mention the skill, the playbook, SaaS, software/);
});
