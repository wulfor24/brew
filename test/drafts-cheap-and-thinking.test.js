// Two rules from 16 Oct: every first draft is made on the cheap models (a premium picture is an explicit Make the final,
// never a draft), and a slow studio reply shows what it is doing instead of a bare spinner.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('drafts: the cheap image model first, the premium one only as a fallback; video and voice on the fast models', () => {
  const srv = read('server.js');
  assert.match(srv, /const IMAGE_MODEL = process\.env\.GEMINI_IMAGE_MODEL \|\| 'gemini-2\.5-flash-image'/);
  assert.match(srv, /const IMAGE_FALLBACK = process\.env\.GEMINI_IMAGE_FALLBACK \|\| 'gemini-3-pro-image'/);
  for (const f of ['deploy.sh', 'tools/deploy-demo.sh']) assert.match(read(f), /GEMINI_IMAGE_MODEL=\$\{GEMINI_IMAGE_MODEL:-gemini-2\.5-flash-image\}/, `${f} deploys drafts on the cheap image model`);
  const vm = read('vertex-media.js');
  assert.match(vm, /VEO_MODEL \|\| 'veo-3\.1-fast-generate-001'/); assert.match(vm, /TTS_MODEL \|\| 'gemini-2\.5-flash-tts'/);
  assert.match(read('media.js'), /Sloosh[^\n]*finals only/, 'the premium maker sits behind Make the final, not in the draft chain');
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
