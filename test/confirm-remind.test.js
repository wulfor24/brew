// A brand waiting on "Check what we read" is never forgotten (audit 2026-10-16: one waited 23 hours with nobody told, and its
// research reloaded on every container start). Since 2026-10-17 the wait is honest: Brew starts writing at status.writeAt
// with what it read unless someone checks first, and the reminders stop once the build has started.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REMIND_AT, awaitingCheck, waitingOnCheck, waitingSince, dueReminder, recipients, reminderMail, createConfirmRemind } from '../confirm-remind.js';

const H = 36e5, T0 = Date.UTC(2026, 9, 15, 9);
const waiting = (o = {}) => ({ slug: 'gully-com', name: 'Gully', host: 'gully.com', createdAt: T0 - H, waitingSince: T0, done: false, error: null, cancelled: null,
  stages: { read: { state: 'done', at: T0 + 20 * H }, confirm: { state: 'waiting', at: T0 + 20 * H } }, ...o });

/* a packs store in memory, shaped like brand-pack.js */
const mem = (files = {}) => { const F = structuredClone(files), puts = [];
  return { F, puts, getJSON: async (slug, f, d = null) => (F[`${slug}/${f}`] !== undefined ? structuredClone(F[`${slug}/${f}`]) : d), put: async (slug, f, v) => { F[`${slug}/${f}`] = typeof v === 'string' ? JSON.parse(v) : v; puts.push(`${slug}/${f}`); },
    list: async () => Object.entries(F).filter(([k]) => k.endsWith('/status.json')).map(([k, v]) => ({ slug: k.split('/')[0], status: v })).filter((x) => x.status?.name) }; };

test('waiting on the check: read in, confirm open; not once confirmed, finished, stopped or failed', () => {
  assert.ok(waitingOnCheck(waiting()));
  assert.ok(!waitingOnCheck(waiting({ stages: { read: { state: 'done' }, confirm: { state: 'done' } } })));
  assert.ok(!waitingOnCheck(waiting({ confirmedAt: T0 })));
  assert.ok(!waitingOnCheck(waiting({ done: true })));
  assert.ok(!waitingOnCheck(waiting({ cancelled: true })));
  assert.ok(!waitingOnCheck(waiting({ stages: { read: { state: 'running' } } })));
  /* the watchers are held from the read until the check, whatever stage the confirm is at */
  assert.ok(awaitingCheck({ stages: { read: { state: 'done' } } }) && !awaitingCheck({ done: true }) && !awaitingCheck({ stages: { confirm: { state: 'done' } } }));
});

test('the wait counts from when it began, not from the last restart (stages re-stamp on boot)', () => {
  assert.equal(waitingSince(waiting()), T0);
  assert.equal(waitingSince(waiting({ waitingSince: undefined })), T0 - H, 'older brands fall back to when the read started');
});

test('reminders: one after a few hours, one a day later, never twice, a late find gets only the latest', () => {
  assert.deepEqual(REMIND_AT, [3 * H, 24 * H]);
  assert.equal(dueReminder(waiting(), {}, T0 + 2 * H), -1);
  assert.equal(dueReminder(waiting(), {}, T0 + 3 * H), 0);
  assert.equal(dueReminder(waiting(), { 0: T0 + 3 * H }, T0 + 10 * H), -1);
  assert.equal(dueReminder(waiting(), { 0: T0 + 3 * H }, T0 + 24 * H), 1);
  assert.equal(dueReminder(waiting(), { 0: 1, 1: 1 }, T0 + 99 * H), -1, 'two reminders, then quiet');
  assert.equal(dueReminder(waiting(), {}, T0 + 30 * H), 1, 'found a day late: the day reminder only');
  assert.equal(dueReminder(waiting({ confirmedAt: T0 + H }), {}, T0 + 30 * H), -1);
  assert.equal(dueReminder(waiting({ stages: { read: { state: 'done' }, confirm: { state: 'waiting' }, brief: { state: 'running' } } }), {}, T0 + 30 * H), -1, 'the build started: no reminder');
});

test('who hears: the person who started the read and the brand admins, once each, never a demo address', async () => {
  const P = mem({ 'g/private/created.json': { by: 'Ana@Gully.com' }, 'g/private/members.json': { owner: 'ana@gully.com', members: [{ email: 'ana@gully.com', role: 'owner' }, { email: 'raj@gully.com', role: 'owner' }, { email: 'sam@gully.com', role: 'member' }, { email: 'demo-x@demo.brew', role: 'owner' }] } });
  assert.deepEqual(await recipients(P, 'g'), ['ana@gully.com', 'raj@gully.com']);
  assert.deepEqual(await recipients(mem(), 'g'), []);
});

test('the email: one button into the product, on the check page; says honestly when Brew starts writing', () => {
  const m = reminderMail({ name: 'Gully', slug: 'gully-com', i: 0, base: 'https://brew.example', hours: 3.2 });
  assert.match(m.html, /href="https:\/\/brew\.example\/gully-com\?go=feed#check"/);
  assert.match(m.text, /https:\/\/brew\.example\/gully-com\?go=feed#check/);
  assert.match(m.subject, /Gully is waiting for you to check what Brew read/);
  assert.doesNotMatch(m.html, /never confirms/, 'Brew does go on without the check: the email never says otherwise');
  assert.match(m.text, /Brew starts writing once someone on the team checks it\./, 'no time limit (a read started signed out)');
  const at = Date.UTC(2026, 9, 15, 9, 30), w = reminderMail({ name: 'Gully', slug: 'g', i: 0, hours: 3, writeAt: at, now: at - 60e3, cfg: { timezone: 'Asia/Kolkata' } });
  assert.match(w.text, /Brew starts writing at 15:00 \S+ with what it read, unless you check first\./);
  assert.match(reminderMail({ name: 'Gully', slug: 'g', i: 1, hours: 26 }).text, /waited 1 day\. This is the last reminder/);
});

test('the job: sends, records, does not repeat, never confirms, and starts over for a new wait', async () => {
  const P = mem({ 'gully-com/status.json': waiting(), 'gully-com/private/created.json': { by: 'ana@gully.com' }, 'arata-in/status.json': { name: 'Arata', done: true, stages: { confirm: { state: 'done' } } } });
  const sent = []; let now = T0 + 4 * H;
  const R = createConfirmRemind({ packs: P, mail: async (to, subject, html, text) => { sent.push({ to, subject, text }); return true; }, now: () => now, base: 'https://b', log: { log() {}, warn() {} } });
  let out = await R.tick();
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'ana@gully.com'); assert.deepEqual(out.map((x) => [x.slug, x.i]), [['gully-com', 0]]);
  assert.equal(P.F['gully-com/private/remind.json'].sent[0], now);
  await R.tick(); assert.equal(sent.length, 1, 'not twice');
  now = T0 + 25 * H; await R.tick(); assert.equal(sent.length, 2); assert.match(sent[1].subject, /^Still waiting/);
  now = T0 + 90 * H; await R.tick(); assert.equal(sent.length, 2, 'two at most');
  assert.ok(!P.puts.includes('gully-com/status.json'), 'the reminder never touches the status: no auto-confirm');
  /* a restarted read waits anew: reminders start over */
  P.F['gully-com/status.json'] = waiting({ waitingSince: T0 + 100 * H }); now = T0 + 104 * H; await R.tick(); assert.equal(sent.length, 3);
});

test('a failed send is tried again next tick; nobody to email is recorded once, quietly', async () => {
  const P = mem({ 'g/status.json': waiting({ slug: 'g' }), 'g/private/created.json': { by: 'ana@gully.com' }, 'h/status.json': waiting({ slug: 'h', name: 'H' }) });
  let ok = false, n = 0; const R = createConfirmRemind({ packs: P, mail: async () => { n++; return ok; }, now: () => T0 + 4 * H, log: { log() {}, warn() {} } });
  await R.tick(); assert.equal(n, 1); assert.equal(P.F['g/private/remind.json'], undefined);
  assert.deepEqual(P.F['h/private/remind.json'].to, []);
  ok = true; await R.tick(); assert.equal(n, 2); assert.ok(P.F['g/private/remind.json'].sent[0]);
});

test('wiring: the build stamps the wait once, the server holds watchers and runs the job on the live site only', () => {
  const b = fs.readFileSync(new URL('../build.js', import.meta.url), 'utf8'), s = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(b, /if \(s\.stages\?\.confirm\?\.state !== 'waiting'\) await stage\(slug, 'confirm', 'waiting'\);/);
  assert.match(b, /if \(!\(await status\(slug\)\)\?\.waitingSince\) await setStatus\(slug, \{ waitingSince: Date\.now\(\) \}\);/);
  assert.match(s, /const held = p\.kind === 'generated' && awaitingCheck\(p\.status\);/);
  assert.match(s, /&& !held; \/\/ the default context runs no watchers/);
  assert.match(s, /if \(!DEMO && process\.env\.CONFIRM_REMIND !== '0' && \(process\.env\.K_SERVICE \|\| process\.env\.CONFIRM_REMIND === '1'\)\) createConfirmRemind\(/);
});
