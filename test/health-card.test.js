// The Store health card (2026-10-19): its "Open the move" button worked locally and did nothing live, because a merge left
// the click listener inside toggleSave, so it was only added after someone saved a card. The listener must be added once,
// when the page loads, at the top level of the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const LISTEN = "document.addEventListener('click', (e) => { const mv = e.target.closest('[data-hc-move]')";

test('the health card listener is added at the top level, once, not inside another function', () => {
  const lines = app.split('\n'), i = lines.findIndex((l) => l.includes(LISTEN));
  assert.ok(i > 0, 'the health card click listener exists');
  assert.equal(lines.filter((l) => l.includes(LISTEN)).length, 1, 'added once');
  assert.match(lines[i], /^  document\.addEventListener/, 'at the app’s top-level indent');
  const save = app.slice(app.indexOf('const toggleSave = '), app.indexOf('const rerenderKeep = '));
  assert.ok(!save.includes('[data-hc-move]'), 'not inside toggleSave');
  /* the last code line before it (past its comment and blank lines) ends a top-level statement, two spaces in */
  let k = i - 1; while (k > 0 && (/^\s*$/.test(lines[k]) || /^\s*\/\*.*\*\/\s*$/.test(lines[k]))) k--;
  assert.match(lines[k], /^  \S.*[;}]\s*$/, `the line before it closes a top-level statement: ${lines[k].slice(0, 60)}`);
});

test('the button opens the move page, and the moves list carries each move’s skill', () => {
  assert.match(app, /if \(mv\) \{ openMove\(\+mv\.dataset\.hcMove\); return; \}/);
  assert.match(fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'), /skill: x\.skill \|\| null/);
});
