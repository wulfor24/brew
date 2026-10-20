// Moves and feed audits 20 Oct: Title Case with lower-case small words ("Launching the Municipal Fleet Uptime Plan") is sentence
// cased; names (the brand, rivals, products, places, festivals) keep their capitals; SEO tails ("| Knacks Snacks") and "!" go.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sentenceCase as S } from '../text-fit.js';

test('Title Case in every common style is sentence cased; names stay', () => {
  assert.equal(S('Launching the Municipal Fleet Uptime Plan'), 'Launching the municipal fleet uptime plan');
  assert.equal(S('Healthy Pure Chews'), 'Healthy pure chews');
  assert.equal(S('A Unified Messaging House for FFS Beauty', ['FFS Beauty']), 'A unified messaging house for FFS Beauty');
  assert.equal(S('Comet vs Gully Labs', ['Gully Labs', 'Comet']), 'Comet vs Gully Labs');
  assert.equal(S('Win Diwali shoppers with the Rice Face Wash'), 'Win Diwali shoppers with the Rice Face Wash');
  assert.equal(S('Launch localized trust-first Meta ads in Bulgaria'), 'Launch localized trust-first Meta ads in Bulgaria');
  assert.match(fs.readFileSync(new URL('../brand-pack.js', import.meta.url), 'utf8'), /replace\(\/!\+\$\/, ''\)/);
});
