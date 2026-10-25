// The Set-up tab (25 Oct): the style Brew opens on and the reason under it come from one rule, for every brand and card.
import test from 'node:test';
import assert from 'node:assert/strict';
const { defaults, styleOf, angleOf, carriesAngle } = await import('../jam2/studio.js');
const { contextOf } = await import('../jam2/context.js');

const product = { img: 'p.jpg', name: 'Strong Hold Styling Gel - 50 ml' };
const brands = [{ comfort: { people: 'ai-cast' }, personas: [{ name: 'The Hair-Fall Switcher' }] }, { comfort: { people: 'none' } }, { comfort: {} }];
const cards = [
  { title: 'Their gel flakes, ours holds 72 hours', sub: 'A rival runs 12 ads comparing hold.', cta: { label: 'Make the ad' } },
  { title: 'Lead with the 4.8★ reviews', cta: { label: 'Make the ad' } },
  { title: 'Tired of frizz by noon?', cta: { label: 'Make the ad' } },
  { title: 'Launch styling ad group for Karva Chauth', sub: 'Sleek looks for the festival.', cta: { label: 'Make the ad' } },
  { title: 'New conditioner is live', cta: { label: 'Make the ad' } },
  { title: 'Combo at ₹449, 20% off this week', cta: { label: 'Make the ad' } }];

test('a persona or a word inside a word is not an angle', () => {
  assert.equal(angleOf('The Hair-Fall Switcher buys this'), null);
  assert.equal(angleOf('Compare our hold with theirs')?.id, 'compare');
  assert.equal(angleOf('Switch from oiling')?.id, 'compare');
});

test('every brand, every card: the reason starts with the style picked, and names an angle only when that style carries it', () => {
  for (const bbv of brands) for (const card of cards) {
    const ctx = { card, product, bbv }, d = defaults(ctx, { recipe: 'image-ad', kind: 'static' }), st = styleOf(d.style);
    const why = contextOf(ctx, d).slots.style.why;
    assert.ok(why.startsWith(st.label), `${card.title}: "${why}" should start with ${st.label}`);
    const an = angleOf(`${card.title} ${card.cta.label} ${card.sub || ''}`);
    if (/because/.test(why)) assert.ok(carriesAngle(st, an), `${card.title}: ${st.label} doesn't carry "${an?.line}"`);
  }
});

test('a compare card opens on a Compare & Switch template, and says why', () => {
  const ctx = { card: cards[0], product, bbv: brands[0] }, d = defaults(ctx, { recipe: 'image-ad', kind: 'static' });
  assert.equal(styleOf(d.style).group, 'Compare & Switch');
  assert.match(contextOf(ctx, d).slots.style.why, /because it compares you with a rival/);
});

test('a card with no comparison never says it compares', () => {
  for (const card of cards.slice(1)) { const ctx = { card, product, bbv: brands[0] }, d = defaults(ctx, { recipe: 'image-ad', kind: 'static' });
    assert.doesNotMatch(contextOf(ctx, d).slots.style.why, /compares you/, card.title); }
});
