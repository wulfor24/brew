// A Studio film made ready to post (video-finish.js): captions from what is said (.srt + burned in, in the Reels safe zone), a
// cover with the headline over the clearest frame, a looping GIF under 2 MB; a step that can't run says so, never pretends.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createVideoFinish, phrases, spread, srtOf } from '../video-finish.js';
import { readyOf } from '../publish-ready.js';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-'));
const clip = (name, audio = true) => { const f = path.join(DIR, name); execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=24:duration=5', ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:a', 'aac', '-shortest'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]); return fs.readFileSync(f); };
let hasFfmpeg = true; try { execFileSync('ffmpeg', ['-version']); } catch { hasFfmpeg = false; }

test('caption phrases are 2–6 words, in order, never overlapping; a script with no read is spread and marked approximate', () => {
  const p = phrases([{ from: 0.2, to: 3, text: 'Use one pea-sized drop of gel on damp hair then air dry' }], 5);
  assert.ok(p.length >= 2 && p.every((x) => x.text.split(' ').length <= 6)); assert.ok(p.every((x, i) => i === 0 || x.from >= p[i - 1].to - 1e-9));
  assert.match(srtOf(p), /^1\n00:00:00,200 --> 00:00:01,\d{3}\nUse one/);
  const s = spread('Curls feeling heavy? Check your palm first.', 10); assert.ok(s.length >= 1 && s[0].from < 1 && s.at(-1).to <= 10);
});

test('a film is captioned from its speech, burned in, given a cover and a GIF; a silent clip has no captions and says why', { skip: !hasFfmpeg && 'no ffmpeg here', timeout: 120e3 }, async () => {
  const { launchBrowser } = await import('../pdf/render.js'); let browserOk = true; try { const b = await launchBrowser(); await b.close(); } catch { browserOk = false; }
  const vf = createVideoFinish({ launchBrowser: browserOk ? launchBrowser : null, transcribe: async () => [{ from: 0.3, to: 2.2, text: 'Curls feeling heavy?' }, { from: 2.4, to: 4.6, text: 'Check your palm first.' }], log: { warn() {} } });
  const spoken = clip('spoken.mp4'), silent = clip('silent.mp4', false);
  const c = await vf.captions(spoken, { script: 'x' }); assert.equal(c.segs.length, 2); assert.equal(c.approx, undefined);
  const none = await vf.captions(silent); assert.equal(none.segs.length, 0); assert.match(none.none, /no speech/);
  const fail = await createVideoFinish({ transcribe: async () => { throw new Error('down'); }, log: { warn() {} } }).captions(spoken, { script: 'Curls feeling heavy? Check your palm first.' }); assert.equal(fail.approx, true, 'the script, timed by estimate');
  const nothing = await createVideoFinish({ log: { warn() {} } }).captions(spoken); assert.match(nothing.error, /couldn’t be read/, 'no read and no script: said, not hidden');
  const g = await vf.gif(silent, { seconds: 3 }); assert.ok(g && g.bytes < 2e6 && g.gif.slice(0, 3).toString() === 'GIF');
  if (browserOk) { const b = await vf.burn(spoken, c.segs); assert.ok(b && b.length > 1000, 'the captioned film'); const p = await vf.probe(path.join(DIR, 'spoken.mp4')); assert.equal(p.audio, true);
    const cv = await vf.cover(spoken, { headline: 'How much gel?' }); assert.ok(cv.cover.length > 1000 && cv.frame.length > 1000); }
});

test('ready to publish says whether a film is captioned: on, by estimate, none spoken, or missing', () => {
  const base = { family: 'post', pkg: { title: 'Curly gel', copy: 'How much gel?', video: 'gen/j2-v.mp4' }, brand: 'Acme', host: 'acme.com' };
  const k = (film) => readyOf({ ...base, pkg: { ...base.pkg, film } }).checks.find((x) => x.k === 'captions');
  assert.equal(k({ srt: 'gen/a.srt', cover: 'gen/c.jpg', captions: { n: 4 } }).ok, true);
  const est = k({ srt: 'gen/a.srt', cover: 'gen/c.jpg', captions: { n: 4, approx: true } }); assert.equal(est.ok, false); assert.equal(est.soft, true);
  assert.equal(k({ cover: 'gen/c.jpg', captions: { n: 0, none: 'This video has no speech, so it has no captions.' } }).ok, true);
  assert.equal(k({ cover: 'gen/c.jpg', captions: { n: 0, error: 'The words couldn’t be read' } }).ok, false);
});

test('a film’s captions file and GIF are stored and served like every other made file', async () => {
  const G = await import('../gen-store.js'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-')); G.configureGen({ dir, remote: false, log: { warn() {} } });
  G.saveGen('j2-abcdef12.srt', Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHi\n')); G.saveGen('j2-abcdef12.gif', Buffer.from('GIF89a'));
  assert.ok(await G.genFile('j2-abcdef12.srt'), '.srt served'); assert.ok(await G.genFile('j2-abcdef12.gif'), '.gif served');
});
