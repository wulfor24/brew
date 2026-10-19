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

/* v2 (2026-10-18): the onboarding's progress card is driven by the real read, its tutorial cards are tagged Example, and the
   whole thing sits behind one flag that the demo tour carries */
test('v2 onboarding invents no timings and tags its example cards', () => {
  const ob = src('public/onboard2.js'), mk = src('public/make-sheet.js'), idx = src('public/index.html'), demo = src('demo-routes.js');
  for (const re of [/min(ute)?s? (left|remaining|saved)/i, /you (just )?saved \d+/i, /~\s*\d+\s*min/])
    assert.doesNotMatch(ob + mk, re, `found ${re}`);
  assert.match(ob, /EXAMPLE_CARDS/); assert.match(ob, /example: true/); assert.match(ob, /<span class="badge info">Example<\/span>/);
  assert.doesNotMatch(mk, /\bAI editing\b/, 'the sheet never says "AI editing"');
  assert.match(idx, /onboard2\.js/); assert.match(idx, /make-sheet\.js/); assert.match(idx, /v2\.css/);
  assert.match(app, /const V2 = /); assert.match(app, /if \(V2 && window\.OB2\) \{ view = 'setup'; return window\.OB2\.run\(\); \}/);
  assert.match(demo, /\(v=/, 'the demo tour carries the v= flag');
});

/* FEED_STACK (2026-10-18): the morning stack sits behind its own flag inside v2, is keyed by the brand's date, counts honestly
   ("n of N" from the cards really queued), and never opens on an email, jam, card or studio link */
test('the morning stack is behind FEED_STACK, keyed by the brand date, honest about its count, never on a deep link', () => {
  const ob = src('public/onboard2.js'), sv = src('server.js');
  assert.match(sv, /window\.FEED_STACK=\$\{flagJson\(process\.env\.FEED_STACK \|\| '0'\)\}/, 'injected on every page, off unless set');
  assert.match(src('deploy.sh'), /\|FEED_STACK=\$\{FEED_STACK:-0\}/); assert.match(src('tools/deploy-demo.sh'), /,FEED_STACK=\$\{FEED_STACK:-0\}/);
  assert.match(app, /const FEED_STACK = V2 && /, 'inside v2 only'); assert.match(app, /get\('stack'\); if \(q === '1'\) ls\.set\('brew-stack', '1'\); else if \(q === '0'\) ls\.set\('brew-stack', '0'\)/);
  assert.match(app, /const morningDue = \(\) => FEED_STACK && GEN && !LANDING && !!window\.OB2\?\.morning && !GO_LINK && !BOOT_RX && !\/\^#\(jam\|card\|work\|v\|remix\|cx\|cxerr\|s\)=\|\^#\(check\|team\)\$\/\.test\(location\.hash\) && S\.viewer\.stackDay !== brandClock\(\)\.day/);
  assert.match(app, /if \(GO_FEED\) \{ GO_LINK = true;/, 'an email link never opens the stack');
  assert.match(app, /if \(morningDue\(\)\) \{ view = 'stack'; S\.viewer\.stackDay = brandClock\(\)\.day; save\(\); return window\.OB2\.morning\(\{ onDone: \(\) => feed\(\) \}\); \}/, 'marked seen before it opens, then the feed');
  assert.match(src('brand-pack.js'), /tz: p\.config\?\.timezone && p\.config\.timezone !== 'UTC' \? p\.config\.timezone : null/, 'the brand zone reaches the page');
  assert.match(ob, /const runStack = \(o\) => \{/); assert.match(ob, /const firstThree = \(ranked\) => mixN\(ranked, 3\);/, 'the onboarding and the morning share one mix');
  assert.match(ob, /c\.textContent = `\$\{Math\.min\(acted \+ 1, total\)\} of \$\{total\}`/, 'the counter counts the cards really queued');
  assert.match(ob, /if \(k === 'Escape' && o\.skip && !\$\('#modal'\)\) \{ finish\(\); return true; \}/); assert.match(ob, /skip: 'Open the feed'/);
  assert.match(ob, /Math\.max\(1, Math\.min\(50, \+V\(\)\.perDay \|\| 10\)\)/, 'N is the person\'s own setting, 10 by default');
  for (const re of [/\b10 ready moves\b/, /ready moves every morning/, /\d+ moves? (saved|a day guaranteed)/i]) assert.doesNotMatch(ob, re, `found ${re}: the stack shows real cards, it promises no count`);
  assert.doesNotMatch(ob, /Good morning, \$\{esc\(name\(\)\)\}\.<\/h1>[^]*?10 cards/, 'no fixed ten anywhere');
});

/* v1 questions (2026-10-19): v1's reading screen asks v2's taps through OB2.questions (mode q), never the tutorial, stack, gate
   or "Good morning"; a confirm goes up only when a brand tap was answered and never with an empty hero list; lines that name
   v2-only verbs say what v1 does; screens already asked are not asked again during onboarding */
test('v1 asks the questions during the read, and only the questions', () => {
  const ob = src('public/onboard2.js'), idx = src('public/index.html');
  assert.match(ob, /window\.OB2 = \{[^}]*\bquestions, qState \}/);
  assert.match(ob, /const Q_ORDER = \['seat', 'first', 'channels', 'lead', 'rivals'\];/, 'five questions in mode q: no slides, tutorial, hold or done');
  assert.match(ob, /channels: \{ multi: 6, optional: true,/, 'every channel they run, and none is an answer');
  assert.match(ob, /if \(!s && mode === 'q'\) \{ QO\?\.onShow\?\.\(\); s = \$\('#v2-stage'\); \} if \(!s\) return mode === 'q' \? null : shell\(inner, o\);/, 'mode q reopens v1\'s layer, never a v2 shell');
  assert.match(ob, /if \(mode === 'q'\) \{ const bt = \['lead', 'rivals'\]; if \(!bt\.every\(\(k\) => st\.done\[k\]\)\) return; if \(!bt\.some\(\(k\) => st\.done\[k\] === true\)\) return; \}/);
  assert.match(ob, /st\.done\.lead === true && \(mode !== 'q' \|\| \(st\.v2\.hero \|\| \[\]\)\.length\)/, 'never an empty hero list from v1');
  assert.match(ob, /slice\(0, mode === 'q' \? 99 : 4\)/, 'v1 offers every seat, as its seat step did');
  assert.match(app, /const QM = !V2 && GEN && !!window\.OB2\?\.questions && !window\.OB2\.qState\(\)\.qDone;/);
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
  for (const re of [/OB2\.(stack|morning|run)\(/]) assert.doesNotMatch(app.match(/const setup = async[^]*?\n  };\n/)[0].replace(/if \(V2 && window\.OB2\) \{ view = 'setup'; return window\.OB2\.run\(\); \}/, ''), re, 'v1 setup runs no v2 screen');
});

test('Another take is on every card in v1 and v2; Make it yours stays v2; a take shows on its card', () => {
  assert.match(app, /<button class="icon-btn v2-act" data-act="take" aria-label="Another take, a free draft" title="Another take · Free draft">\$\{ic\('refresh'\)\}<\/button>\$\{V2 \? `<button class="icon-btn v2-act" data-act="make"/);
  assert.match(app, /document\.addEventListener\('click', async \(e\) => \{ if \(V2\) return; const b = e\.target\.closest\('\.card \[data-act="take"\]'\)/, 'v1 keeps the card in place');
  assert.match(app, /if \(p\.take && \(p\.take\.image \|\| p\.take\.drawing \|\| p\.take\.drawError\)\)/, 'cardOf draws the take');
  assert.match(app, /else if \(\(r\.updated \|\| \[\]\)\.length\) await redrawTakes\(r\.updated\);/, 'the pulse redraws it in place on v1');
  assert.match(app, /data-ais-proof="\$\{esc\(aiStand\(\)\.src \|\| 'weekly'\)\}">\$\{ic\('shield', 's14'\)\}Every question and each AI’s answer/, 'the health ring opens the AI answers sheet');
});
