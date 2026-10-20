import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildDraft, motionOnly, onScreen, VEO_NO_TEXT, VEO_SAME_PEOPLE } from '../sloosh-prompt.js';
import { fitFrame, fitsRatio } from '../vertex-media.js';

/* the Arata reel (20 Oct): Veo drew "Over? Not yeith." from a scripted text overlay, padded a 4:5 frame into 9:16 with black bars,
   and cut to a son and a changed father from a shot list joined with "Then". Every brand's clip goes through the same prompt */
const SHOT = 'High-tempo close-up of Appa parting his hair in the mirror, looking shocked at the thinning. Bold text overlay in the first second: "Over? Not yet."';

test('every Veo draft prompt tells Veo to draw no words and keep only the people in the first frame', () => {
  for (const motion of [SHOT, 'A hand picks the jar up and twists the lid.', '']) {
    const p = buildDraft({ kind: 'video', motion: `Over 6 seconds: ${motion}`, ratio: '9:16' }).prompt;
    assert.ok(p.includes(VEO_NO_TEXT), 'the no-text line');
    assert.ok(p.includes(VEO_SAME_PEOPLE), 'the same-people line');
    assert.match(VEO_NO_TEXT, /no text overlays, captions, subtitles/);
    assert.doesNotMatch(p, /Over\? Not yet|text overlay in|people may move/i);
  }
});

test("a shot's on-screen words leave the motion and are set in exact type instead", () => {
  assert.equal(motionOnly(SHOT), 'High-tempo close-up of Appa parting his hair in the mirror, looking shocked at the thinning.');
  assert.equal(motionOnly('Close-up of the pack. Clear price text pops up in the lower safe zone: "Pack of 3: ₹999".'), 'Close-up of the pack.');
  assert.equal(motionOnly('Appa inspects the real packaging, reading the label closely.'), 'Appa inspects the real packaging, reading the label closely.');
  assert.equal(onScreen(SHOT), 'Over? Not yet.');
  assert.equal(onScreen('Son walks in, smiling.'), '');
});

test('the jam clip animates the opening shot only and lays its words on with headClip', () => {
  const src = readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /join\(' Then '\)/);
  assert.match(src, /motionOnly\(clean\(shot0\)\)/);
  assert.match(src, /onScreen\(shot0\)[^\n]*headClip/);
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('a first frame not of the clip shape is cropped to fill it (no bars)', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const png = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=896x1152', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-']);
  const out = await fitFrame(png, '9:16');
  const size = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', '-'], { input: out }).toString().trim();
  assert.equal(size, '648x1152');
  assert.equal(await fitsRatio(png, '9:16'), false);
  assert.equal(await fitsRatio(out, '9:16'), true);
});
