// One stage for every deliverable (25 Oct): the header names the piece and where it goes and what card it is for; the stage holds
// only the piece; the bar under it is the one next step, the same three steps on every jam; the Studio set-up lives in the
// panel; a card with a jam opens on that jam, never the old list of packages
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const cs = fs.readFileSync(new URL('../public/creative-stage.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/parts.css', import.meta.url), 'utf8');
const fn = (name, src = app) => { const i = src.indexOf(`const ${name} = `); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n  const ', i + 10)); };

test('the header: the piece and where it goes, then the card it is for; an organic post is never on Meta Ads', () => {
  const w = fn('stWhere');
  assert.match(w, /ch\.family === 'social' \? 'Instagram'/);
  assert.match(w, /!\/\\bon \[A-Z\]\/\.test\(lab\)/, 'a label that names its place is not told twice');
  assert.match(app, /class="st-for" data-tab="iterate"[^\n]*For: \$\{esc\(cutW\(cardOf\(RX\.p\)\.title, 90\)\)\}/);
  assert.ok(!/\$\{esc\(ch\.familyName\)\} · \$\{studioFrom\(ch\)\}/.test(app), 'the widget family is not in the header');
});

test('the stage holds only the piece: the Studio set-up is the panel’s Set-up tab, and Make it is on the bar', () => {
  const st = fn('studioStage');
  assert.ok(!/cs\.html\(ch\)/.test(st), 'no composer on the stage');
  assert.match(st, /shipBar\(ch, viewing\)/, 'the bar shows before anything is made');
  assert.match(st, /st\.frames/, 'the preview has as many frames as the set-up makes');
  assert.match(app, /\['adjust', ch\.studio \? 'Set-up' : 'Adjust'\], \['details', 'Details'\]/);
  assert.match(app, /ch\.studio && !studioMade\(ch\) && edit \? 'adjust' : 'iterate'/, 'a Studio piece not made yet opens on its set-up');
  assert.match(app, /data-cs-make/); assert.match(cs, /make: \(\) => go\(false\)/);
  assert.ok(!/data-cs-go/.test(cs.slice(cs.indexOf('function full()'), cs.indexOf('function full()') + 9000)), 'no second Generate in the set-up');
  assert.match(cs, /frames: Array\.isArray\(S\.spec\?\.set\)/);
});

test('the bar: Draft › Make › Send on every jam, every fix listed, the status never cut to one line', () => {
  const sb = fn('stepBar');
  assert.match(sb, /const steps = media \|\| ch\.studio \? \['Draft', 'Make', 'Send'\] : \['Draft', 'Send'\]/);
  assert.ok(!/'Set up', 'Made'|'Final'\]/.test(sb), 'no other step names');
  assert.match(sb, /class="ship-fixes"/, 'more than one fix: each is listed');
  assert.match(css, /\.ship\.one \.ship-l\{white-space:normal;[^}]*-webkit-line-clamp:2/);
  assert.ok(!/Make the final \$\{what\}/.test(app), 'the make step says Make it');
});

test('the chat says the next step nowhere: the bar does; the case folds its why and plan', () => {
  const cb = fn('caseBrief');
  assert.ok(!/case-next/.test(cb)); assert.match(cb, /<details class="case-s case-why"/); assert.match(cb, /<details class="case-s case-plan"/);
  assert.match(app, /!\(m\.rewrite && \(ch\.versions \|\| \[\]\)\.length > 1\)/, 'the starting-point note goes once there is a newer version');
});

test('one version: a card with a jam opens on it, never the What should this card become list', () => {
  assert.match(app, /const lead = RX\.list\[0\]; if \(lead\?\.id\) \{ PRE_CH\.set\(lead\.id, lead\); return openStudio\(lead\.id/);
  assert.match(fn('backToOptions'), /return openStudio\(lead\.id, \{ deep: true, replace: true \}\)/);
});

test('words set into a draft picture are never printed over it again', () => {
  assert.match(app, /!\(p\.draft\?\.as === 'carousel' && \(p\.draft\.images \|\| \[\]\)\.includes\(img\)\)/);
  assert.match(app, /\(p\.draft && !p\.draft\.text && \(p\.draft\.images \|\| \[\]\)\.includes\(imgOf\(ch\)\)\)/, 'a reel’s hook over a draft picture');
});
