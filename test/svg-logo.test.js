// A header logo saved as a sprite reference (<use href="#id">) draws nothing on its own (footshop-com, QA 20 Oct): the reader
// inlines the symbol from the page, an svg with nothing to draw is never saved, and a saved one is served as the site icon.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { drawableSvg, inlineSprite } from '../reader/svg-logo.js';

test('a sprite logo is inlined from the page; one that still draws nothing is no logo', () => {
  const bad = '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#svg_x_00"></use></svg>';
  const page = '<svg style="display:none"><symbol id="svg_x_00" viewBox="0 0 100 20"><path d="M0 0h10v10z"/></symbol></svg>';
  assert.equal(drawableSvg(bad), false);
  const fixed = inlineSprite(bad, page); assert.equal(drawableSvg(fixed), true); assert.match(fixed, /viewBox="0 0 100 20"/);
  assert.equal(drawableSvg(inlineSprite(bad, '<p>no symbols</p>')), false);
  assert.equal(drawableSvg('<svg><path d="M0 0"/></svg>'), true);
  assert.match(fs.readFileSync(new URL('../reader/stages/brand.js', import.meta.url), 'utf8'), /drawableSvg\(svgFile\)/);
  assert.match(fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'), /!drawableSvg\(await fs\.promises\.readFile/);
});
