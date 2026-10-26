// Moves never name Brew people who do the work: the owner is the brand's own role; Brew drafts, the brand's team ships (Param, 20 Oct)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { brewText, brewFile } from '../brew-name.js';
test('Brew roles read as the brand team', () => {
  assert.equal(brewText('A Brew growth analyst reviews it within 48 hours.'), 'Your growth analyst reviews it within 48 hours.');
  assert.equal(brewText('Five weekly loops the Brew deployment team runs.'), 'Five weekly loops your team runs.');
  assert.equal(brewText('Brew will monitor it daily.'), 'Your team will monitor it daily.');
  assert.equal(brewText('Owner: Brew copywriter'), 'Owner: your copywriter');
  for (const keep of ['Brew listening finds 12 threads.', 'Brew drafts the email.', 'The Brew commerce calendar']) assert.equal(brewText(keep), keep);
  assert.match(String(brewFile('moves.json', Buffer.from(JSON.stringify({ 5: { t: 'A Brew content lead writes it.' } })))), /Your content lead writes it/);
});
test('the PDF says Brew drafts and the team ships', () => {
  const t = fs.readFileSync(new URL('../pdf/template.js', import.meta.url), 'utf8');
  assert.doesNotMatch(t, /BUILT, RUN AND OWNED BY THE BREW DEPLOYMENT TEAM|DEPLOYMENT TEAM<br>|45-MINUTE/);
  assert.match(t, /WE <b>DRAFT<\/b> EVERY PIECE/);
});
