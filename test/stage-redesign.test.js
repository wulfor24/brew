// The jam page redesign (26 Oct, the prototype Param approved), and the fixes that came with it: the piece is drawn in the size
// it is set up in (Set-up said Story 9:16, the stage drew a 4:5 feed post), the sizes sit under the piece, a Story-sized Meta ad is
// drawn as a Story, the stage fits the Studio piece (it measured the Preview badge), set-up picks survive a reload, the header has a
// version switcher, the panel has no tabs, and each piece's tab has a status dot. Source checks: the page is plain browser JS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const cs = fs.readFileSync(new URL('../public/creative-stage.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/stage.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const fn = (name, src = app) => { const i = src.indexOf(`const ${name} = `); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n  const ', i + 10)); };

test('the piece is drawn in the size it is set up in, and the sizes sit under it', () => {
  assert.match(cs, /ratio: SIZES\?\.\[S\.spec\?\.sizes\?\.\[0\]\]\?\.ratio/); assert.match(cs, /sizeOpts:/);
  const st = fn('studioStage');
  assert.match(st, /\.\.\.\(st\.ratio \? \{ format: st\.ratio \} : \{\}\)/, 'the preview takes the set-up\'s shape');
  assert.match(st, /class="cs-sizes" role="radiogroup"[^\n]*data-cs-size=/, 'the sizes under the piece pick the set-up size');
  assert.match(cs, /\.cs-adjust, \.cs-sizes'\)\) return false/, 'the composer takes the stage\'s size buttons');
});

test('a Story-sized Meta ad is drawn as a Story, and the stage fits the Studio piece, not its badge', () => {
  assert.match(app, /class="as as-meta\$\{lg \? ' lg' : ''\}\$\{rw \/ rh < \.79 \? ' is-story' : ''\}/);
  assert.match(css, /\.as\.as-meta\.is-story \.am-text\{position:absolute/);
  assert.match(fn('fitAd'), /box\.querySelector\(':scope > \.cs-frame > \.as'\) \|\| box\.firstElementChild/);
  assert.match(fn('fitAd'), /if \(want < \.79\)/, 'a Story is never cropped back to 4:5');
});

test('set-up picks survive a reload, only when every pick is still offered', () => {
  assert.match(cs, /S\.spec = \{ \.\.\.S\.spec, \.\.\.patch \}; S\.pop = null; savePick\(\);/);
  assert.match(cs, /const ok = Object\.entries\(x\)\.every/, 'all or nothing');
  assert.match(cs, /if \(!S\.made\) S\.spec = \{ \.\.\.S\.spec, \.\.\.loadPick\(\) \}/);
});

test('header: the piece, a version switcher, the rest in the More menu; panel: no tabs; tabs: a status dot each', () => {
  assert.match(fn('verSw'), /data-vstep="-1"[^\n]*data-vmenu[^\n]*data-vstep="1"/);
  assert.match(app, /\[data-vstep\]/); assert.match(app, /RX\.viewing = to\.id === ch\.head \? null : to\.id/, 'look only; Use this on the bar makes it the newest');
  assert.match(app, /item\('versions', 'clock', 'Every version'/); assert.match(app, /versions: \(\) => \{ RX\.vmenu = true; paintStudio\(\); \}/);
  assert.match(app, /<aside class="st-panel">\$\{panelTop\(ch, tab\)\}/); assert.ok(!/<div class="st-tabs" role="tablist">\$\{\(RX\.stage === 'brief'/.test(app), 'no tab bar');
  assert.match(fn('dlDot'), /'writing'[^\n]*'fix'[^\n]*'ready'/); assert.match(app, /<i class="dl-dot is-\$\{dot\}"/);
  assert.match(html, /<link rel="stylesheet" href="stage\.css">/); assert.ok(html.indexOf('href="stage.css"') > html.indexOf('href="jam-fit.css"'), 'loaded last');
});
