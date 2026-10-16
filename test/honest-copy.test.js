// Copy that promises only what Brew does (audit 2026-10-16): no invented timings, one count for the moves, Slack said to
// post, no placeholder email, a real link to the team, and a signed-out visitor gets a plain sign-in, not an empty read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { movesEta } from '../pack-numbers.js';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const app = src('public/app.js'), live = src('public/live.js'), picker = src('public/demo-picker.html');

test('no promised timings or counts the build does not measure', () => {
  for (const re of [/about 20 minutes/, /in about 2 hours/, /51 plans/, /works while you sleep/, /keep landing over the next hour/, /140e3/, /Build my team/])
    assert.doesNotMatch(app + src('build.js'), re, `found ${re}`);
  assert.doesNotMatch(app + src('build.js'), /30-day rollout and how we measure it/, 'measurement was cut: the moves say what to watch');
});

test('the time left comes only from the pace this run really kept', () => {
  const t = Date.UTC(2026, 9, 16, 10), M = 60e3, run = t - 60 * M;
  const s = (o = {}) => ({ total: 64, movesDone: 44, stages: { moves: { state: 'running', at: run } }, paceAt: [t - 9 * M, t - 6 * M, t - 3 * M, t], ...o });
  assert.equal(movesEta(s(), t), 60, '20 moves left at 3 minutes each');
  assert.equal(movesEta(s({ paceAt: [t - 3 * M, t] }), t), null, 'too few moves to measure');
  assert.equal(movesEta(s(), t + 25 * M), null, 'a stall is not a countdown');
  assert.equal(movesEta(s({ paceAt: [run - 99 * M, run - 98 * M, run - 97 * M, t] }), t), null, 'an earlier run does not count');
  for (const o of [{ done: true }, { capped: true }, { pausedDay: '2026-10-15' }, { cancelled: true }, { total: 0 }, { movesDone: 64 }, { stages: { moves: { state: 'done', at: run } } }])
    assert.equal(movesEta(s(o), t), null, JSON.stringify(o));
  /* the status route adds it, and never says fewer written than the moves on file */
  const sv = src('server.js');
  assert.match(sv, /s = \{ \.\.\.s, etaMin: movesEta\(s\) \}/);
  assert.match(sv, /packs\.peek\(slug\)\?\.numbers\?\.moves\?\.written; if \(!s\.error && !s\.done && \+w > \(\+s\.movesDone \|\| 0\)\) s = \{ \.\.\.s, movesDone: \+w \}/);
  assert.match(src('build.js'), /paceAt: \[\.\.\.\(s1\?\.paceAt \|\| \[\]\), Date\.now\(\)\]\.slice\(-12\)/);
  /* the feed's strip and the wait screen read the same field */
  assert.match(app, /const etaOf = \(s\) => \{ const m = s\?\.etaMin;/);
  assert.match(app, /written\$\{etaOf\(BREW\)\}/);
  assert.match(app, /const brewingCard = \(\) => checkWaitCard\(\) \|\| \(GEN && BREW && !BREW\.done && \+BREW\.total && \(BREW\.movesDone \|\| 0\) < \+BREW\.total/);
});

test('Slack says it posts; every other connector stays read-only', () => {
  assert.match(app, /const accessOf = \(id\) => \(id === 'slack' \? 'Posts to your channel' : 'Read-only access'\)/);
  assert.equal((app.match(/Read-only access<\/span>/g) || []).length, 0, 'the footer goes through accessOf');
  assert.match(live, /const READONLY = \(id\) => \(id === 'slack' \? stat\('Posts the cards and jams/);
  assert.doesNotMatch(live, /READONLY\(\)/);
});

test('no placeholder email, and the demo offers none', () => {
  assert.match(app, /const mailMe = \(\) => \{ const m = ME\(\), e = m\?\.email; return e && !m\.demo && !\/@demo\\\.brew\$\/i\.test\(e\) \? e : null; \};/);
  assert.doesNotMatch(app, /Email me at \$\{esc\(ME\(\)\.email\)\}/);
  assert.match(app, /window\.BREW_DEMO \? '<p class="wt2-note">The demo sends no email/);
  assert.match(live, /'Demo visitor, no email'/);
});

test('the demo picker links to the team for real', () => {
  assert.match(picker, /<a href="mailto:hello@joinsquareup\.com[^"]*"><b>Talk to the Brew team\.<\/b><\/a>/);
  assert.doesNotMatch(picker, /Infinite Possibilities|as it happens|Live demo/);
});

test('a signed-out visitor at a brand gets the team sign-in, not "Reading… 0 sources"', () => {
  const i = app.indexOf('const setup = async () => {');
  assert.match(app.slice(i, i + 400), /if \(needSignin\(\) && signWall\('team'\)\) return;/);
  assert.match(app, /Sign in to open \$\{esc\(B\.brand\.name\)\}/);
  assert.match(app, /feed and moves are for its team\. Sign in with your work email/);
});

test('a read waiting on the check shows "Waiting for you" in the feed and opens the check', () => {
  assert.match(app, /Waiting for you\$\{BREW\.waitingSince/);
  assert.match(app, /data-checkread/);
  assert.match(app, /if \(waitsOnCheck\(st\) && !o\.stay && !o\.fromCheck\) return checkRead\(\);/);
  assert.match(app, /return waitMoves\(\{ fromCheck: true \}\); \}/, 'no loop between the check and the wait screen');
});
