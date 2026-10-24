// CRE-07: the ad's headline edits in one step on the preview: click, type, Enter saves a new version through the same POST
// /edit the brief form uses; Esc puts it back; a repaint never takes it from someone typing. The route keeps the version.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('both Meta ad previews carry the editable headline; saving goes through /edit as a version', () => {
  assert.equal((app.match(/<small>\$\{B\.brand\.host\}<\/small>\$\{hlHtml\(ch, p, lg\)\}/g) || []).length, 3, 'single, collection and catalog ads');
  assert.match(app, /const hlHtml = \(ch, p, lg\) => \(lg && view === 'remix' && !RX\.viewing/, 'only on the jam’s stage, on the version in use');
  assert.match(app, /tapi\('POST', `\/api\/changes\/\$\{ch\.id\}\/edit`, \{ pkg: \{ headline: now \}, reason: 'New headline' \}\)/);
  assert.match(app, /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); el\.textContent = el\.dataset\.was/);
  assert.match(app, /document\.activeElement\?\.matches\?\.\('\[data-hl-edit\]\[contenteditable\]'\)\) \{ pollJob\(ch\); return; \}/, 'no repaint under the typing');
});
