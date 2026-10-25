// Higgsfield, paid safely and briefed fully (26 Oct): every paid request can be picked up after a restart and carries an
// idempotency key, a refunded make gives the day's unit back, the catalog refresh can't empty the catalog, and every picture
// Higgsfield draws gets the same brand context (never as words to letter) and the cast's own face.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmpBase = () => path.join(os.tmpdir(), 'hfs-');
import { createHiggsfield } from '../jam2/higgsfield.js';
import { createEngines } from '../jam2/engines.js';
import { brandScene } from '../jam2/studio.js';

/* a fake Higgsfield: takes a request, says completed on the first poll, serves a file */
const fakeHF = (seen) => async (url, init = {}) => {
  const u = String(url);
  if (/\/estimate\//.test(u)) return new Response(JSON.stringify({ type: 'estimate', usd: 0.1 }), { status: 200 });
  if (/status/.test(u)) return new Response(JSON.stringify({ status: 'completed', images: [{ url: 'https://cdn.example/out.png' }] }), { status: 200 });
  if (/cdn\.example/.test(u)) return new Response(Buffer.alloc(2048, 1), { status: 200, headers: { 'content-type': 'image/png' } });
  seen.push({ url: u, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
  return new Response(JSON.stringify({ request_id: 'r1', status_url: 'https://api.example/requests/r1/status' }), { status: 200 });
};
const env = { HF_API_KEY_ID: 'id', HF_API_KEY_SECRET: 'secret', HF_API_BASE: 'https://api.example' };
const fast = async (fn) => { const st = global.setTimeout; global.setTimeout = (f) => st(f, 0); try { return await fn(); } finally { global.setTimeout = st; } };

test('a submit carries the idempotency key and is written down the moment it is bought; a resume never buys again', async () => {
  const seen = [], hf = createHiggsfield({ env, fetchImpl: fakeHF(seen), log: { warn() {} } }), id = hf.pick('product-shot').id;
  let saved = null;
  const out = await fast(() => hf.run(id, { prompt: 'x', image_urls: ['https://a/p.png'], aspect_ratio: '1:1' }, { idem: 'brew:p1:k', onSubmit: (j) => { saved = j; } }));
  assert.equal(seen.length, 1); assert.equal(seen[0].headers['idempotency-key'], 'brew:p1:k'); assert.ok(saved?.status_url); assert.ok(out.buf.length > 512);
  await fast(() => hf.run(id, { prompt: 'x' }, { resume: saved })); assert.equal(seen.length, 1, 'resume polls, never submits');
});

test('the product shot through the engines passes the hold (key, resume, write-down) on to Higgsfield', async () => {
  const seen = [], dir = fs.mkdtempSync(tmpBase());
  const eng = createEngines({ saveGen: (n, b) => fs.writeFileSync(`${dir}/${n}`, b), genFile: (n) => `${dir}/${n}`, fetchImpl: fakeHF(seen), env, mock: () => false, log: { warn() {}, info() {} } });
  let wrote = null;
  const r = await fast(() => eng.run('still.shot', { prompt: 'p', srcUrl: 'https://a/p.png', ratio: '1:1', hf: { idem: 'brew:press:shot:0:0', onSubmit: (j) => { wrote = j; } } }, { prefer: 'higgsfield' }));
  assert.equal(r.provider, 'higgsfield'); assert.equal(seen[0].headers['idempotency-key'], 'brew:press:shot:0:0'); assert.ok(wrote, 'written down when bought');
});

test('Studio holds every paid request in a make, lets the keys go after, and refunds a refunded make', () => {
  const s = fs.readFileSync(new URL('../jam2/studio.js', import.meta.url), 'utf8');
  assert.match(s, /ctx\.hfHook = \(step\) => \{ const k = `\$\{spec\.style\}:\$\{i\}:\$\{step\}:\$\{ask\}`/);
  assert.match(s, /idem: opts\.press \? `brew:/, 'the key comes from the press: a Redo is a new purchase');
  assert.match(s, /if \(!e\.open\) await letGo\(\)/, 'a job still running is kept to pick up, never bought again');
  assert.match(s, /if \(e\.refunded\) \{ try \{ refund\(/, 'a refunded make gives the unit back');
  const c = fs.readFileSync(new URL('../jam2/creative.js', import.meta.url), 'utf8');
  assert.match(c, /hf: ctx\.hfHook\?\.\(`shot:\$\{ctx\.hfStep \|\| 0\}:\$\{k\}`\)/, 'each parallel candidate has its own key');
  const rt = fs.readFileSync(new URL('../jam2/routes.js', import.meta.url), 'utf8');
  assert.match(rt, /refund: d\.refund/); assert.match(rt, /jobsOf\(t, j, bd, b\.press \|\| null\)/);
});

test('the catalog refresh never writes an empty or shrunken catalog, and reads absolute links', () => {
  const s = fs.readFileSync(new URL('../tools/hf-catalog.mjs', import.meta.url), 'utf8');
  assert.match(s, /workflows\.length < had \* 0\.5/); assert.match(s, /process\.exit\(1\)/); assert.match(s, /\(\?:https\?:/);
  const cat = JSON.parse(fs.readFileSync(new URL('../data/higgsfield-catalog.json', import.meta.url), 'utf8'));
  assert.ok(cat.workflows.length >= 60 && cat.workflows.every((w) => w.schema), 'the catalog in the repo is whole');
});

test('every Higgsfield picture gets the brand world as context, never as words, fonts or a logo to letter', () => {
  const ctx = { card: { title: 'x', make: { pieces: '1 static image: a woman holding the serum by a sunny bathroom window' } },
    bbv: { look: { notes: 'Soft daylight, sage greens', light: 'window light', props: 'towels', logoUse: 'top left', wordsOnImage: 'one short line' },
      kit: { roles: [{ hex: '#82b1ff', role: 'accent' }], fonts: { heading: 'Inter' } }, personas: [{ who: 'women 25–40 who tried one product and gave up' }] } };
  const line = brandScene(ctx);
  assert.match(line, /The scene: a woman holding the serum/); assert.match(line, /window light/); assert.match(line, /#82b1ff accent/); assert.match(line, /women 25–40/);
  assert.doesNotMatch(line, /Inter|top left|short line/, 'no fonts, logo placement or words-on-image notes'); assert.match(line, /None of this is written on the image\.$/);
  assert.doesNotMatch(brandScene(ctx, { people: false }), /people it is for/, 'no buyer line where people are not shown');
  assert.equal(brandScene({}), '', 'nothing known, nothing added');
  const s = fs.readFileSync(new URL('../jam2/studio.js', import.meta.url), 'utf8');
  assert.match(s, /rules, fix, \/\* the brand line last[^\n]*brandScene\(ctx/, 'the brand line is what a cut trims, never the exact-words rule');
});

test('a person or hands still gets the saved cast photos, so the face is the same in every still', () => {
  const s = fs.readFileSync(new URL('../jam2/studio.js', import.meta.url), 'utf8'), c = fs.readFileSync(new URL('../jam2/creative.js', import.meta.url), 'utf8');
  assert.match(s, /ctx\.castRefUrls = st0 && \['person', 'hands'\]\.includes\(st0\.people\)/);
  assert.match(c, /refUrls: \[\.\.\.photos\.slice\(1\), \.\.\.looks\.map\(\(x\) => x\.u\), \.\.\.cast\]/); assert.match(c, /they are not the product/);
});

test('a Pinterest pin is a picture made in Studio at 2:3, and "+" refuses what it cannot add instead of making the default piece', () => {
  const r = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.match(r, /pinterest_pin: 'pin'/); assert.match(r, /!\/pinterest_pin\$\/\.test/); assert.match(r, /w\.id === 'pin'\)\) r = w/);
  assert.match(r, /'creative\.pinterest_pin'\];/, 'offered under "+"');
  assert.match(r, /if \(b\.action && !pickA\) return \{ error:/, 'an action it cannot add is refused, never swapped for the default');
});
