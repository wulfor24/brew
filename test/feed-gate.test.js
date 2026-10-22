// A brand's first read writes its moves only once someone opens the feed after onboarding (build.js feedGate, feedOpened):
// the read, the check and the brief go as before, the moves wait; a feed opened early counts; a correction made while it waits
// reaches the brief before the moves; a re-read of a brand already in use writes at once. No network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.REFRESH_AUTO = '0'; process.env.BUILD_RESUME_OFF = '1'; process.env.DEMO_MODE = '';
const { createBuilder } = await import('../build.js');
const { createPacks } = await import('../brand-pack.js');

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const tmpPacks = () => createPacks({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'brew-feedgate-')), PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await sleep(25); } return false; };

async function brand(P, slug, status = {}) {
  await P.put(slug, 'seed.json', { brand: { name: 'Acme', host: 'acme.in' }, lanes: { core: { name: 'Core', line: 'x' } }, posts: [] });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.in', slug, url: 'https://acme.in', catalog: { products: [] }, reviews: {}, rivals: [], meta: { readAt: '2026-10-16T08:00:00Z' } });
  await P.put(slug, 'ledger.json', []); await P.put(slug, 'findings.json', { steps: [], cards: [] });
  await P.put(slug, 'private/created.json', { by: 'ana@acme.in', at: 1 });
  await P.put(slug, 'status.json', { slug, host: 'acme.in', url: 'https://acme.in', name: 'Acme', stages: { read: { state: 'done' } }, ...status });
  const calls = { brief: 0, runAll: 0, briefNames: [] };
  const modules = { reader: { createReader: () => ({ read: async () => { throw new Error('not called'); } }) },
    brief: { createBrief: () => ({ write: async (p) => { calls.brief++; calls.briefNames.push(p.name); return { json: { name: p.name }, md: `# ${p.name} brief` }; } }) },
    moves: { SPECS: [], createMovesEngine: () => ({ runAll: async () => { calls.runAll++; return { moves: {}, errors: [], applicable: [] }; } }) }, pdf: null };
  const ai = { onCharge() {}, call: async () => { throw Object.assign(new Error('AI is off (mock)'), { mock: true }); } };
  const b = createBuilder({ ROOT: path.dirname(P.dirOf(slug)), packs: P, ai, treg: { onCharge() {} }, log: quiet, modules, caps: { build: 0.5 } });
  return { b, calls };
}

test('a first read: the brief is written after the check, the moves wait for the first open of the feed', async () => {
  const P = tmpPacks(), slug = 'gate-example-com';
  const { b, calls } = await brand(P, slug, { feedGate: true, confirmedAt: Date.now() });
  const run = b.resume(slug);
  assert.ok(await until(async () => (await b.status(slug))?.state === 'Your moves start when you open your feed'), 'says what it waits for');
  assert.equal(calls.brief, 1, 'the brief is written'); assert.equal(calls.runAll, 0, 'no move before the feed opens');
  assert.ok((await b.status(slug)).feedWaitSince > 0, 'the wait is stamped for the reminder emails');
  const r = await b.feedOpened(slug); assert.deepEqual(r, { ok: true, started: true, woke: true });
  await run;
  assert.equal(calls.runAll, 1, 'the moves start'); assert.ok((await b.status(slug)).feedOpenAt);
  assert.deepEqual(await b.feedOpened(slug), { ok: true, started: true }, 'a second open changes nothing');
});

test('a feed opened before the brief is done counts: the moves go straight on', async () => {
  const P = tmpPacks(), slug = 'early-example-com';
  const { b, calls } = await brand(P, slug, { feedGate: true, confirmedAt: Date.now() });
  await b.feedOpened(slug); /* not running: it starts the build itself */
  assert.ok(await until(async () => calls.runAll === 1), 'the moves ran without waiting');
});

test('a correction made while the moves wait reaches the brief before the moves', async () => {
  const P = tmpPacks(), slug = 'fix-example-com';
  const { b, calls } = await brand(P, slug, { feedGate: true, confirmedAt: Date.now() });
  const run = b.resume(slug);
  assert.ok(await until(async () => (await b.status(slug))?.state === 'Your moves start when you open your feed'));
  await sleep(5); /* the correction comes after the brief */
  const r = await b.confirm(slug, [{ key: 'name', v: 'Acme Labs' }]); assert.ok(r.recheck, 'the check page notes it as a late correction');
  await b.feedOpened(slug); await run;
  assert.deepEqual(calls.briefNames, ['Acme', 'Acme Labs'], 'the brief is written again with the correction'); assert.equal(calls.runAll, 1);
});

test('no gate (a re-read of a brand already in use, or BUILD_FEED_GATE=0): the moves follow the brief at once', async () => {
  const P = tmpPacks(), slug = 'open-example-com';
  const { b, calls } = await brand(P, slug, { confirmedAt: Date.now() });
  await b.resume(slug);
  assert.equal(calls.runAll, 1);
  assert.deepEqual(await b.feedOpened(slug), { ok: true, started: true });
});
