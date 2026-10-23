import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestRules, mergeRules, applyRuleChange, ruleLines, blockWords, reaches } from '../jam2/rules.js';
import { blankBook, readLayer, viewOf, promptBlock, creativeBlock, channelOf } from '../jam2/brandbook.js';

test('Brew suggests rules from the category and market, never the same set for every brand', () => {
  const beautyIn = suggestRules({ name: 'Arata', category: 'Beauty · Hair care', market: 'IN', never: ['cure', 'regrow'], rivals: ['Pilgrim'] });
  const ids = beautyIn.map((r) => r.id);
  for (const id of ['claims-own', 'claims-never', 'claims-asci', 'claims-beforeafter', 'safety-rivals']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('claims-fssai'), 'FSSAI is for foods and supplements');
  assert.deepEqual(beautyIn.find((r) => r.id === 'claims-never').words, ['cure', 'regrow']);
  const foodIn = suggestRules({ category: 'Health supplements', market: 'India' }).map((r) => r.id);
  assert.ok(foodIn.includes('claims-fssai'));
  const realty = suggestRules({ name: 'Mana', category: 'Real estate', market: 'IN', sells: 'by enquiry' }).map((r) => r.id);
  assert.ok(realty.includes('claims-rera') && !realty.includes('claims-beforeafter'));
  const us = suggestRules({ category: 'Apparel', market: 'US' }).map((r) => r.id);
  assert.ok(us.includes('claims-ftc') && !us.includes('claims-asci'));
  const kids = suggestRules({ category: 'Baby care' }).map((r) => r.id);
  assert.ok(!kids.includes('people-kids'), 'a baby brand is not told to keep children off camera');
});

test('the team keeps, turns off, re-scopes, rewrites and adds rules; suggestions stay labelled until kept', () => {
  const sug = suggestRules({ name: 'Cozy', category: 'Pet', market: 'US' });
  let t = applyRuleChange({}, { set: { id: 'safety-topics', strength: 'block', confirmed: true } });
  t = applyRuleChange(t, { set: { id: 'people-kids', off: true } });
  t = applyRuleChange(t, { set: { id: 'ai-reviews', where: { channels: ['ads', 'nope'] } } });
  t = applyRuleChange(t, { add: { text: 'Never show a model in a costume.', words: ['costume'] } }, () => 'r1');
  t = applyRuleChange(t, { add: { text: 'never show a model in a costume.' } }, () => 'r2');
  assert.equal(t.own.length, 1, 'the same rule is never added twice');
  const rules = mergeRules(sug, t, { people: 'hands', aiVoice: 'no', testimonials: 'yes', how: 'ai' }, 'Cozy');
  const by = (id) => rules.find((r) => r.id === id);
  assert.equal(by('safety-topics').strength, 'block'); assert.equal(by('safety-topics').confirmed, true);
  assert.equal(by('people-kids').off, true);
  assert.deepEqual(by('ai-reviews').where, { channels: ['ads'] });
  assert.equal(by('r1').group, 'people', 'an added rule finds its group from its words');
  assert.equal(by('claims-own').src, 'suggested'); assert.equal(by('claims-own').confirmed, false);
  assert.equal(by('choice-people').text, 'Only hands appear on camera, never faces.');
  assert.ok(!rules.some((r) => r.id === 'choice-how'), 'how things get made is a studio default, not a rule');
  t = applyRuleChange(t, { drop: 'r1' }); assert.equal(t.own.length, 0);
});

test('rules reach makers by channel, blocking words join the banned check, warnings never do', () => {
  const rules = [{ id: 'a', text: 'Never name a rival.', strength: 'block', where: { channels: ['ads'] }, words: ['pilgrim'] },
    { id: 'b', text: 'Never say miracle.', strength: 'block', words: ['miracle'] }, { id: 'c', text: 'Avoid slang.', strength: 'warn', words: ['lit'] },
    { id: 'd', text: 'Off one.', strength: 'block', words: ['gone'], off: true }];
  assert.deepEqual(blockWords(rules), ['miracle']);
  assert.ok(reaches(rules[0], { channel: 'ads' })); assert.ok(!reaches(rules[0], { channel: 'email' }));
  const email = ruleLines(rules, { channel: 'email' });
  assert.ok(!email.includes('rival') && email.includes('miracle') && email.includes('Avoid slang'));
  assert.ok(ruleLines(rules).includes('(Ads only)'));
  assert.equal(channelOf('static ad'), 'ads'); assert.equal(channelOf('klaviyo email'), 'email'); assert.equal(channelOf('instagram reel'), 'social');
});

test('the view carries rules to every scope; team changes stay out of the public kit; prompts lead with them', () => {
  const read = readLayer({ slug: 'x', config: { banned: '\\b(cure[sd]?|miracle\\w*)\\b' }, profile: { name: 'Arata', category: 'Beauty' }, brief: {} });
  const bb = { ...blankBook(), read, rulebook: applyRuleChange({}, { add: { text: 'Never show a competitor’s bottle.' } }, () => 'own1') };
  const member = viewOf(bb, { scope: 'member' }), share = viewOf(bb, { scope: 'share' }), pub = viewOf(bb, { scope: 'public' });
  assert.ok(member.rulebook.some((r) => r.id === 'own1') && share.rulebook.some((r) => r.id === 'own1'));
  assert.ok(!pub.rulebook.some((r) => r.id === 'own1'), 'the free kit has only Brew’s suggestions');
  assert.ok(!pub.rulebook.some((r) => r.choice), 'comfort choices are the team’s');
  assert.ok(pub.rulebook.some((r) => r.id === 'claims-own'));
  const p = promptBlock(member, { kind: 'static ad' });
  assert.ok(p.startsWith('What the team allows:') || p.startsWith('Rules you must follow:'));
  assert.ok(p.includes('Never show a competitor’s bottle.'));
  assert.ok(creativeBlock(member, 'static ad').includes('AI person never looks like a real, named person'));
});
