// The Work board by whose move it is (Param, 26 Oct: "this is missing: when AI is working, when AI has completed its work").
// One lane per jam from jams.js laneOf; Needs you is whyWaits, the same rule as the feed's count, the bell and the recap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { laneOf, whyWaits, waitsOn, LANES } from '../jams.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const app = read('public/app.js'), fsvc = read('feed-service.js'), rmx = read('remix.js'), css = read('public/brew.css');
const ME = 'asha@gully.com', RAJ = { email: 'raj@gully.com', name: 'Raj Mehta' }, T0 = 1_800_000_000_000;
const jam = (x = {}) => ({ id: 'w1', title: 'Desk reel', stage: 'drafting', current: 1, versions: [{ n: 1, by: 'agent', at: T0 }], thread: [], people: [{ email: ME }], reads: { [ME]: T0 + 1000 }, updatedAt: T0, ...x });
const k = (w, o = {}, me = ME) => laneOf(w, me, [], o).k;

test('lanes run by whose move it is, left to right', () => {
  assert.deepEqual(LANES, ['you', 'brew', 'look', 'doing', 'with', 'sent']);
  assert.deepEqual([...app.matchAll(/\{ k: '(\w+)', name: '([^']+)', full:/g)].map((m) => `${m[1]}:${m[2]}`),
    ['you:Needs you', 'brew:Brew is on it', 'look:Ready for you', 'doing:In progress', 'with:With a teammate', 'sent:Brief sent']);
});

test('Needs you: an ask, an OK, a failed make, our team asking, a question, a red check or a claim', () => {
  const ask = jam({ thread: [{ id: 'm', from: 'colleague', by: RAJ, to: [ME], body: 'Can we say warm in 60 seconds?', at: T0 + 2000 }] });
  assert.equal(k(ask), 'you'); assert.match(laneOf(ask, ME).line, /^Raj Mehta asked you: Can we say/); assert.equal(laneOf(ask, ME).who.name, 'Raj Mehta');
  assert.equal(k(jam({ stage: 'needs_you' })), 'you', 'an OK with nobody named waits on everyone');
  assert.equal(k(jam({ stage: 'needs_you', assignee: { email: ME } })), 'you');
  assert.equal(k(jam({ stage: 'needs_you', assignee: RAJ })), 'with', 'an OK asked of Raj is With a teammate for me');
  assert.equal(k(jam({ stage: 'needs_you', assignee: RAJ }), {}, RAJ.email), 'you', '…and Needs you for Raj');
  const failed = jam({ creative: { state: 'failed', error: 'The image model was busy.', at: T0 + 5000 } });
  assert.equal(k(failed), 'you'); assert.equal(laneOf(failed, ME).line, 'The make didn’t go through: The image model was busy. Make it again');
  assert.equal(k({ ...failed, reads: { [ME]: T0 + 9000 } }), 'doing', 'once you opened the jam, the failed make lets go');
  assert.equal(k(jam({ jamBrief: { status: 'needs_info', sender: { email: ME }, sharedAt: T0 } })), 'you', 'our team needs something: back on you');
  assert.equal(k(jam({ plan: { questions: [{ id: 'q', q: 'Which size leads?', ownerEmail: ME, answer: null, asked: true }] } })), 'you');
  assert.equal(k(jam({ plan: { questions: [{ id: 'q', q: 'Which size leads?', owner: 'ai', answer: null }] } })), 'doing', 'open plan questions are not an ask of you');
  const red = { checks: [{ k: 'Numbers not in the fact sheet: 80%', ok: false }] }, claim = { checks: [{ k: 'A health claim the Brand Book has not approved', ok: false, fix: true }] };
  assert.equal(k(jam(), { ch: red }), 'you'); assert.match(laneOf(jam(), ME, [], { ch: red }).line, /^Red check: Numbers not in the fact sheet/);
  assert.equal(laneOf(jam(), ME, [], { ch: claim }).line, 'A claim to approve or take out');
  assert.equal(k(jam(), { ch: { checks: [{ k: 'Can be undone', ok: false, soft: true }, { k: 'Mine', ok: false, mine: true }] } }), 'doing', 'soft and your own checks never block');
  assert.equal(k(jam({ people: [RAJ] }), { ch: red }, ME), 'doing', 'a red check waits on the people in the jam');
});

test('Brew is on it while it makes or writes; Ready for you when it finished since you last looked', () => {
  const busy = { k: 'make', line: 'Making One Masthead Float picture', since: T0, eta: 70, usd: 0.08 };
  const on = laneOf(jam(), ME, [], { busy });
  assert.equal(on.k, 'brew'); assert.equal(on.who.kind, 'brew'); assert.equal(on.line, busy.line); assert.equal(on.eta, 70); assert.equal(on.usd, 0.08);
  assert.equal(k(jam({ stage: 'needs_you' }), { busy }), 'you', 'a person waiting on you comes first');
  const made = jam({ creative: { state: 'made', line: 'Desk reel, 8 seconds', at: T0 + 5000 } });
  assert.equal(k(made), 'look'); assert.equal(laneOf(made, ME).line, 'Made: Desk reel, 8 seconds');
  assert.equal(k({ ...made, reads: { [ME]: T0 + 6000 } }), 'doing', 'looked at: In progress');
  assert.equal(k(jam({ current: 2, versions: [{ n: 1, by: 'agent', at: T0 }, { n: 2, by: 'ai', at: T0 + 5000 }] })), 'look', 'Brew wrote a new version');
  assert.equal(k(jam({ current: 2, versions: [{ n: 1, by: 'agent', at: T0 }, { n: 2, by: 'you', at: T0 + 5000 }] })), 'doing', 'your own version is no news to you');
  assert.equal(k(jam(), { final: { at: T0 + 5000 } }), 'look', 'a final landed');
  assert.equal(k({ ...made, people: [RAJ] }), 'doing', 'Ready for you is for the people in the jam');
  assert.equal(k({ ...made, reads: undefined, unread: true }, {}, null), 'look', 'no signed-in person: the jam\'s unread flag');
});

test('With a teammate, Brief sent, In progress', () => {
  assert.equal(k(jam({ stage: 'team', with: { kind: 'team', name: 'Raj Mehta' } })), 'with');
  const given = laneOf(jam({ assignee: { ...RAJ, ask: 'do' } }), ME); assert.equal(given.k, 'with'); assert.equal(given.line, 'Raj Mehta has it');
  assert.equal(k(jam({ assignee: { email: ME, ask: 'do' } })), 'doing', 'given to me and nobody waiting: my draft');
  assert.equal(k(jam({ plan: { questions: [{ id: 'q', q: 'Size?', ownerEmail: RAJ.email, waiting: 'Raj', asked: true, answer: null }] } })), 'with');
  assert.equal(k(jam({ stage: 'shared', ticket: 'BR-1' })), 'sent');
  assert.equal(laneOf(jam({ stage: 'shared', jamBrief: { status: 'received', to: 'shopos', sharedAt: T0 } }), ME).line, 'Our team has it');
  assert.equal(laneOf(jam({ teamBrief: { version: 1, sent: [{ name: 'Priya', version: 1, openedAt: T0 }] } }), ME).line, 'Sent to Priya · opened');
  assert.equal(k(jam({ teamBrief: { version: 2, sent: [{ name: 'Priya', version: 1 }] } })), 'doing', 'changed since it was sent: send the new version');
  assert.equal(laneOf(jam({ stage: 'ready' }), ME).line, 'Approved: send the brief');
  assert.equal(laneOf(jam({ current: 3, versions: [1, 2, 3].map((n) => ({ n, by: 'you', at: T0 })) }), ME).line, 'Draft v3 · shape it, then send the brief');
  assert.equal(laneOf(jam({ people: [RAJ] }), ME).who.name, 'Raj Mehta', 'a teammate\'s draft shows their face');
});

test('one rule: Needs you is exactly whyWaits, everywhere the board, the feed and the bell count it', () => {
  const cases = [jam(), jam({ stage: 'needs_you' }), jam({ stage: 'needs_you', assignee: RAJ }), jam({ creative: { state: 'failed', at: T0 + 5000 } }), jam({ stage: 'shared' })];
  for (const w of cases) for (const o of [{}, { ch: { checks: [{ k: 'x', ok: false }] } }]) assert.equal(laneOf(w, ME, [], o).k === 'you', waitsOn(w, ME, [], o), JSON.stringify({ w: w.stage, o }));
  assert.equal(whyWaits({ ...jam({ stage: 'needs_you' }), archived: true }, ME), null, 'an archived jam waits on nobody');
  /* the server: the lane is the rule, and every count reads it */
  assert.match(fsvc, /return \{ lane: ln, waitsOnMe: ln\.k === 'you' \};/);
  assert.match(fsvc, /needsYou: t\.work\.filter\(\(w\) => shown\(w\) && waits\(t, w\)\)\.length/);
  assert.match(fsvc, /const waits = \(t, w\) => waitsOn\(w, meOf\(t\)\?\.email, studioOf\(t, w\), \{ ch: chOfW\(t, w\) \}\);/);
  assert.equal((fsvc.match(/waitsOn\(/g) || []).length, 1, 'no second copy of the rule in feed-service');
  /* the client: the feed widget, the tab badge and the bell all use needsMe (w.waitsOnMe) */
  assert.match(app, /const needsMe = \(w\) => w\.waitsOnMe \?\?/);
  assert.match(app, /const you = rows\.filter\(\(n\) => \{ const w = WORK\.items\.find\(\(x\) => x\.id === n\.itemId\); return w \? needsMe\(w\)/, 'the bell\'s Needs you group is the board\'s rule');
  assert.match(app, /const laneK = \(w\) => w\.lane\?\.k \|\|/);
});

test('Brew is on it: the server knows what is in flight; the board shows a live clock and "you can leave"', () => {
  assert.match(rmx, /const busyOf = \(t, w\) => \{/); assert.match(rmx, /return \{ busyOf, finalOf,/);
  for (const re of [/ITER_JOBS\.has\(ch\.job\.id\)\) return \{ k: 'words'/, /VID_JOBS\.has\(ch\.id\)\) return \{ k: 'make'/, /IMG_JOBS\.has\(ch\.id\)\) return \{ k: 'make'/, /FILL_JOBS\.has\(ch\.id\)\) return \{ k: 'draft'/, /cr\?\.state === 'making' && fresh\(cr\.at, 40 \* 60e3\)/]) assert.match(rmx, re);
  assert.match(rmx, /from: ch\.studioState\?\.state === 'making' \? ch\.studioState\.from \|\| ch\.studioState\.at : now\(t\)/, 'the clock never restarts at "2 of 4 made"');
  assert.match(fsvc, /const at = TB\?\.writing\?\.\(w\.id\); return at \? \{ k: 'brief', line: 'Writing the brief'/, 'the brief being written is Brew\'s move too');
  assert.match(app, /You can leave: it lands in Ready for you/);
  assert.match(app, /\$\$\('#wb-deck \[data-since\]'\)\.forEach/, 'the clock ticks every second');
  assert.match(app, /laneK\(w\) === 'look' && w\.changeId && w\.cardId && byId\(w\.cardId\)\) return openRemix\(byId\(w\.cardId\), w\.changeId\)/, 'one tap opens the made piece');
  assert.match(app, /x\.chId && onJam\.has\(x\.chId\)/, 'a job shown on its jam is not shown twice');
  assert.doesNotMatch(app, /AI is working on/, 'no separate AI lane');
});

test('markup: every tile says whose move it is; empty lanes say one quiet line, never a 0; phones keep Needs you', () => {
  assert.match(app, /<span class="wb-mv">\$\{m\.av\}<em>\$\{esc\(m\.name\)\}<\/em><\/span>/);
  assert.match(app, /`<p class="wb-none">\$\{esc\(c\.empty\)\}<\/p>`/);
  for (const line of ['Nothing is waiting on you.', 'Brew isn’t making anything right now.', 'Nothing new from Brew since you last looked.']) assert.ok(app.includes(line), line);
  assert.match(app, /\$\{n \? `<span class="wb-n">\$\{n\}<\/span>` : ''\}/, 'no zero counts on lane heads');
  assert.match(app, /\$\{nOf\(c\) \? `<em>\$\{nOf\(c\)\}<\/em>` : ''\}/, 'no zero counts on the phone tabs');
  assert.match(css, /@media \(max-width:1100px\)\{\.wb-col\.is-empty\[data-bcol="you"\]\{display:flex\}\}/);
  assert.match(css, /:root\[data-theme="dark"\] \.wb-strip\.is-with b/);
});
