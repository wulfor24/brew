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
  assert.match(sv, /const w = \+packs\.peek\(slug\)\?\.numbers\?\.moves\?\.written \|\| 0/); /* and never fewer than this build already showed (QA FEED-QA-21) */
  assert.match(sv, /Math\.min\(Math\.max\(\+s\.movesDone \|\| 0, w, was\), \+s\.total \|\| Infinity\)/);
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

/* one version (2026-10-21): the page has no ?ui=, ?v=, ?stack= or ?split= switch; UI2, the v2 onboarding, the morning stack,
   the Make-it-yours sheet and the old jam page are gone, and the server injects no version flag */
test('one version: no version switches on the page, no v2 or UI2 files, no version flag from the server', () => {
  const idx = src('public/index.html'), sv = src('server.js');
  for (const re of [/get\('ui'\)/, /get\('v'\)/, /get\('stack'\)/, /split=0/, /\bconst (UI2|V2|FEED_STACK|SPLIT) =/, /brew-ui|brew-stack|'brew-v'/]) assert.doesNotMatch(app, re, `found ${re}`);
  for (const re of [/ui2\.css/, /v2\.css/, /make-sheet\.js/, /onboard2\.js/]) assert.doesNotMatch(idx, re, `found ${re}`);
  assert.match(idx, /questions\.js/); assert.match(idx, /parts\.css/);
  for (const re of [/BREW_V/, /BREW_GATE/, /FEED_STACK/]) { assert.doesNotMatch(sv, re); assert.doesNotMatch(src('deploy.sh'), re); assert.doesNotMatch(src('tools/deploy-demo.sh'), re); }
  for (const f of ['public/ui2.css', 'public/v2.css', 'public/make-sheet.js', 'public/onboard2.js', 'ask-brew.js']) assert.ok(!fs.existsSync(new URL(`../${f}`, import.meta.url)), `${f} is gone`);
});

/* the questions (2026-10-19): the reading screen asks five taps through OB2.questions (questions.js), and only those; a confirm
   goes up only when a brand tap was answered and never with an empty hero list; screens already asked are not asked again */
test('the reading screen asks the questions during the read, and only the questions', () => {
  const ob = src('public/questions.js');
  assert.match(ob, /window\.OB2 = \{[^}]*\bquestions, qState \}/);
  assert.deepEqual([...ob.matchAll(/\{ id: '(\w+)', kind:/g)].map((m) => m[1]), ['seat', 'first', 'channels', 'lead', 'rivals'], 'five questions: no slides, tutorial, hold or done');
  assert.match(ob, /id: 'channels', kind: 'tap', multi: 6, optional: true,/, 'every channel they run, and none is an answer');
  assert.match(ob, /if \(!s\) \{ QO\?\.onShow\?\.\(\); s = \$\('#v2-stage'\); \} if \(!s\) return null;/, 'it reopens the reading screen\'s layer, never a shell of its own');
  assert.match(ob, /const bt = \['lead', 'rivals'\]; if \(!bt\.every\(\(k\) => st\.done\[k\]\)\) return; if \(!bt\.some\(\(k\) => st\.done\[k\] === true\)\) return;/);
  assert.match(ob, /st\.done\.lead === true && \(st\.v2\.hero \|\| \[\]\)\.length/, 'never an empty hero list');
  assert.match(ob, /const seatTiles = \(\) => A\(\)\.seatEntries\(\)\.map\(/, 'every seat is offered, as the seat step did');
  for (const re of [/EXAMPLE_CARDS/, /runStack/, /const gate/, /Good morning/, /EventSource/]) assert.doesNotMatch(ob, re, `found ${re}`);
  assert.match(app, /const QM = GEN && !!window\.OB2\?\.questions && !window\.OB2\.qState\(\)\.qDone;/);
  assert.match(app, /Promise\.all\(\[readP, qP\]\)\.then\(\(\[, q\]\) => showDone\(q\)\);/, 'the done bar waits for the read and the last question');
  assert.match(app, /if \(posted\) \{ b\.disabled = true; return continueToFeed\(\); \}/);
  assert.match(app, /const noWants = !S\.onboarded && qAns\('first'\), noLane = !S\.onboarded && qAns\('lead'\);/, 'a later Tune still shows everything');
  assert.match(app, /\$\('#ob-next'\)\.onclick = \(\) => \(S\.viewer\.teamSize === 'me' \? finishOnboarding\(\) : teamStep\(\)\);/);
  assert.match(app, /const ids = \[\.\.\.new Set\(\[\.\.\.\(S\.viewer\.tools \|\| \[\]\), \.\.\.ROLE\(\)\.connectors\]\)\]/, 'picked tools first');
  assert.match(app, /const todayN = \(\) => \+S\.viewer\.perDay \|\| 14;/);
  assert.match(app, /'continue', 'v2', 'q1'\]\.forEach/, 'a re-read starts the questions fresh');
  assert.match(src('public/brew.css'), /\.qfull\{position:fixed;inset:0;/, 'the questions take the whole screen');
  assert.match(app, /if \(QM\) setTimeout\(askBar, 9000\);/, 'the read shows first, then the questions are offered');
  assert.match(app, /onWait: \(\) => \{ qClose\(\);/, 'answered before the read is done: back to the read');
  assert.doesNotMatch(app, /OB2\.(stack|morning|run|route|resume)\(/, 'no v2 screen anywhere');
});

test('Another take is on every card, and a take shows on its card', () => {
  assert.match(app, /<button class="icon-btn" data-act="take" aria-label="Another take, a free draft" title="Another take · Free draft">\$\{ic\('refresh'\)\}<\/button>/);
  assert.doesNotMatch(app, /data-act="make"/, 'no Make it yours sheet');
  assert.match(app, /document\.addEventListener\('click', async \(e\) => \{ const b = e\.target\.closest\('\.card \[data-act="take"\]'\)/, 'the card stays in place');
  assert.match(app, /if \(p\.take && \(p\.take\.image \|\| p\.take\.drawing \|\| p\.take\.drawError\)\)/, 'cardOf draws the take');
  assert.match(app, /if \(\(r\.updated \|\| \[\]\)\.length\) await redrawTakes\(r\.updated\);/, 'the pulse redraws it in place');
  assert.match(app, /data-ais-proof="\$\{esc\(aiStand\(\)\.src \|\| 'weekly'\)\}">\$\{ic\('shield', 's14'\)\}Every question and each AI’s answer/, 'the health ring opens the AI answers sheet');
});
