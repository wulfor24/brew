// FEED-QA-14: the studio's status follows the real job. A take's picture job clears imagePending when its own job ends, and
// never while another picture for the same change is still being drawn (IMG_JOBS counts per change). The studio's status
// lines ask jobOf() first, so none says Ready or Draft while something is being made. Free: AI_MOCK, a stand-in image maker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemix } from '../remix.js';
import { configureGen } from '../gen-store.js';
import { runIn } from '../brand-ctx.js';

process.env.AI_MOCK = '1';
const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', sym: '$', config: { product: { noun: 'balm' } }, seed: { brand: { name: 'Acme', host: 'acme.com' } } };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'job-status-')); fs.mkdirSync(path.join(DIR, 'gen'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'balm.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
configureGen({ dir: path.join(DIR, 'gen'), remote: false, log: { warn() {} } });
const quiet = { warn() {}, log() {}, error() {} };
const studio = (extra = {}) => {
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, claudeTool: null, geminiImage: null, PUB: DIR, LANE_PHOTO: { lane1: 'balm.png' }, FACTS: {}, SEED: { connectors: { meta: { name: 'Meta Ads' } }, colleagues: [] }, AGENT: { creative: 'Creative' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => true, spend: () => true, uid: (p) => `${p}_${++n}`, now: (t) => Date.now() + (t?.clock || 0), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `$${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: quiet, ...extra });
  return { R, RMX, call: (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p)) };
};
const tenant = () => ({ id: 't_1', brandId: 'acme', clock: 0, cards: new Map([['c1', { id: 'c1', title: 'Warm paws all winter', sub: 'Cold hands, sorted.', agent: 'creative', sector: 'creatives', type: 'idea', lane: 'lane1', detail: { why: [] } }]]), changes: {}, work: [], conn: {}, acted: new Set(), shown: {} });

test('two pictures at once: the spinner stays until the last one ends, then clears (no stale "Making the creative…")', async () => {
  const gates = []; let k = 0;
  const slowImage = () => new Promise((r) => gates.push(() => r(Buffer.from(`89504e470d0a1a0a${(++k).toString(16).padStart(2, '0')}`, 'hex'))));
  const t = tenant(), { call, RMX } = studio({ geminiImage: slowImage, mediaFake: true });
  const a = await call('POST /api/cards/:cid/remix', { queue: true }, t, { cid: 'c1' });
  const b = await call('POST /api/cards/:cid/remix', { queue: true, prompt: 'warmer light' }, t, { cid: 'c1' });
  for (let i = 0; i < 50 && gates.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  const ch = () => t.changes[a.changeId] || Object.values(t.changes)[0];
  assert.equal(ch().imagePending, true, 'both draws in flight');
  gates.shift()(); for (let i = 0; i < 20 && RMX.v2.jobs.size > 1; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(ch().imagePending, true, 'one ended, the other is still drawing: the spinner stays');
  gates.shift()(); await RMX.v2.settle();
  assert.equal(ch().imagePending, false, 'its own job ended and nothing else draws: the spinner clears');
  const g = await call('GET /api/changes/:chid', {}, t, { chid: b.changeId });
  assert.equal(g.change.imagePending, false); assert.equal(g.change.imageError, null, 'not called "stopped"');
});

test('every studio status line asks the job first (jobOf), so no Ready or Draft shows beside a spinner', () => {
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(src, /const jobOf = \(ch\) =>/);
  assert.match(src, /jobOf\(ch\)\) return stepBar\(ch\);[^\n]*\n\s*if \(!ch\.batchKey && ch\.state !== 'jam' && !planMade\(ch\)\)/, 'a job beats the First draft bar');
  assert.match(src, /const job = jobOf\(ch\), fp = finalGoing\(ch\);[\s\S]{0,2000}?else if \(job && !fp\)/, 'the step bar says the job before Ready or Final ready');
  assert.match(src, /if \(ch\.studio && !sv && !studioMade\(ch\)\) \{[^\n]*\n\s*if \(csS\?\.making\)/, 'a Studio piece being made says so before its price');
  assert.match(src, /if \(formFocus[^\n]*pollJob\(ch\); return; \}/, 'a skipped repaint keeps polling the job');
});

test('Make the final locks from the tap until the final lands or fails, and the bell says when it is ready', () => {
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(src, /RX\.fgo\[ch\.id\] = \{[^\n]*\n\s*const r = await tapi\('POST', `\/api\/changes\/\$\{ch\.id\}\/final\/run`/, 'locked before the run is asked, so a repaint meanwhile never shows the button');
  assert.match(src, /const jobOf = \(ch\) => !ch \? '' : finalGoing\(ch\)/, 'a stale read without finalPending still counts as making');
  assert.match(src, /else if \(fp\) \{[^\n]*ship-go" disabled/, 'the main button stays disabled while it is made');
  const fs2 = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.match(fs2, /onFinal: \(t, ch, r\) => studioFinal\(t, ch, r\)/);
  assert.match(fs2, /Your final \$\{what\} is ready/);
  const fr = fs.readFileSync(new URL('../finals-routes.js', import.meta.url), 'utf8');
  assert.match(fr, /tell\('done'\)/); assert.match(fr, /onFinal\(t, ch, \{ state: 'failed'/);
});
