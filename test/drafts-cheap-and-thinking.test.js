// Every picture and clip is made by Sloosh, first drafts included (27 Oct, replacing the 16 Oct cheap-draft rule), and a slow studio
// reply shows what it is doing instead of a bare spinner.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('every picture and clip is Sloosh first; only when Sloosh can\'t does the Vertex stand-in make it (27 Oct), never Higgsfield', () => {
  const srv = read('server.js');
  assert.match(srv, /const rawImage = async \(o\) => \{[^\n]*slooshMake\.image\(/, 'the image guard\'s model is Sloosh');
  assert.match(srv, /setMakers\(\{ \.\.\.slooshMake, image: withSlug\(slooshMake\.image\)[^\n]*firstDraft:/, 'every clip and Studio make is Sloosh');
  assert.match(srv, /createSlooshMake\(\{[^\n]*standin: standinOn\(\) \? createStandin\(/, 'the stand-in sits inside the Sloosh maker, behind it');
  assert.doesNotMatch(srv, /rawGeminiImage|geminiOnce|IMAGE_FALLBACK/, 'no separate Gemini image chain in the server');
  const md = read('media.js'); assert.match(md, /if \(makers\?\.video\)/); assert.match(md, /VEO_LOCAL/, 'Veo on its own only for a local run on purpose');
});

test('a slow studio reply shows its step and the clock', () => {
  const rx = read('remix.js'), app = read('public/app.js');
  assert.match(rx, /const think = \(ch, step\) =>/);
  assert.match(rx, /think\(ch, quiet \? 'Fixing what the check flagged' : `Reading your note/);
  assert.match(rx, /think\(ch, out \? 'Checking the words against the facts and the product' : null\)/);
  assert.match(rx, /thinking: ch\.thinking && Date\.now\(\) - ch\.thinking\.at < 300e3 \? ch\.thinking : null/, 'the change carries its step to the client');
  assert.match(rx, /\} finally \{ think\(ch, null\); \}/, 'the step is cleared when the reply lands, even on an error');
  assert.match(app, /id="ship-think"/); assert.match(app, /const thinkStart = \(id\) =>/); assert.match(app, /q\?\.change\?\.thinking/);
});
