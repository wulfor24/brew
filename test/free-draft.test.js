// CRE-10 / RMX-10 / CRE-05: before anything is made, the button says whether it costs. Every draft-making button (the card's
// make button in the jam, Make the video, Redo it, Fix it with AI, Another take, the chips) carries a quiet "Free draft"; the
// clip says how long it takes; only the final (finalBtn) shows credits. Read from app.js and remix.js as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), rmx = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8');

test('draft buttons say Free draft; the clip says how long; only the final names credits', () => {
  assert.match(app, /\$\{esc\(planGo\(ch, pl\)\.label\)\}\$\{freeTag\(isReel\(ch\)\)\}<\/button>/, 'the card’s make button in the jam');
  assert.match(app, /data-rx="video" title="Make the video">\$\{ic\('vid', 's16'\)\}Make it\$\{freeTag\(true\)\}/, 'the make step says Make it, the clip says how long');
  assert.ok(!/ship-redo[^\n]*Redo it\$\{freeTag\(\)\}/.test(app), 'a free Redo it carries no tag: the price or Free draft sits on the primary only (25 Oct)');
  assert.match(app, /Fix it with AI\$\{freeTag\(\)\}/);
  assert.match(app, /data-act="take" aria-label="Another take, a free draft"\$\{tipA\('take'\)\}/); /* hover, focus or a long press says it (tips.js) */
  assert.match(fs.readFileSync(new URL('../public/tips.js', import.meta.url), 'utf8'), /take: 'Another take: a new free draft/);
  assert.ok(!/class="it-free"/.test(app), 'the chips row has no Free drafts label (25 Oct)');
  assert.match(app, /FREE_CLIP = 'Free draft · about two minutes'/);
  assert.equal((rmx.match(/a free draft, about two minutes/g) || []).length, 2, 'the chat line when a clip starts says the same');
  const fin = app.slice(app.indexOf('const finalBtn = '), app.indexOf('const fnOne = ')); assert.match(fin, /credits/); assert.ok(!/Free draft|freeTag/.test(fin), 'the final never says free');
});
