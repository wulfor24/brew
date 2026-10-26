// Briefs sent to our team: only staff move a brief on (the route), and only staff see the controls (public/brief-staff.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { STATUSES, canMove } from '../brief-status.js';
import { createJamBrief } from '../jam-brief.js';

const src = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const load = (live = {}, demo = false) => {
  const win = { LIVE: live, BREW_DEMO: demo };
  const ctx = { window: win, document: { addEventListener() {}, querySelector: () => null }, setTimeout, CSS: { escape: (s) => s } };
  vm.runInNewContext(src('public/brief-staff.js'), ctx); return win.BriefStaff;
};
const work = (status, extra = {}) => ({ id: 'wk_1', ticket: 'BR-1042', jamBrief: { status, to: 'shopos', history: [] }, ...extra });
const visible = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

/* the route, on a bare workspace */
const rig = (staff) => {
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn), sent = [];
  const JB = createJamBrief({ claudeTool: null, cardBrief: () => '', seatLine: () => '', isMock: () => true, spend: () => false, now: () => 1000, AGENT: {}, log: { warn() {} },
    cardOf: () => ({ id: 'c1', title: 'Ad', agent: 'creative', sector: 'creatives' }), meOf: () => ({ email: 'ana@acme.com', name: 'Ana' }),
    staffOf: () => (staff ? { email: 'sam@joinsquareup.com', name: 'Sam', staff: true } : null), onBriefSent: async () => true, onBriefStatus: (t, w, x) => sent.push(x.status), onShopos: () => {} });
  const w = { id: 'wk_1', title: 'Ad', cardId: 'c1', thread: [], versions: [{ n: 1, title: 'Ad' }], current: 1, stage: 'drafting', history: [] };
  const t = { work: [w], cards: new Map() };
  JB.routes({ on, W: (t0, id) => t0.work.find((x) => x.id === id), say: (t0, w0, m) => w0.thread.push(m), move: (t0, w0, s) => (w0.stage = s), notify: () => {}, nextTicket: async () => 'BR-1042', handoff: null });
  const status = (body) => R['POST /api/work/:wid/brief/status'](body, t, { wid: 'wk_1' });
  return { R, t, w, sent, status, ship: () => R['POST /api/work/:wid/doc/ship']({ to: 'shopos', force: true }, t, { wid: 'wk_1' }) };
};

test('a brand member can never change a brief’s status, from any status; the 403 says our team', async () => {
  const a = rig(false); await a.ship();
  for (const to of STATUSES) {
    const r = await a.status({ status: to, note: 'x' });
    assert.equal(r.status, 403, to); assert.doesNotMatch(r.error, /ShopOS|Brew/);
  }
  assert.equal(a.w.jamBrief.status, 'sent'); assert.deepEqual(a.sent, []);
});

test('staff: every allowed step goes through, every other one is refused and changes nothing', async () => {
  for (const from of STATUSES) for (const to of STATUSES) {
    if (from === to) continue;
    const s = rig(true); await s.ship(); s.w.jamBrief.status = from;
    const r = await s.status({ status: to, note: to === 'needs_info' ? 'Which size?' : '' });
    if (canMove(from, to)) { assert.equal(r.status, to, `${from} → ${to}`); assert.equal(s.w.jamBrief.history[0].s, to); }
    else { assert.ok(r.error, `${from} → ${to} refused`); assert.equal(s.w.jamBrief.status, from); }
  }
  const s = rig(true); await s.ship();
  assert.match((await s.status({ status: 'needs_info' })).error, /Say what you need/, 'needs info always says what we need');
});

test('the client’s steps are exactly the server’s, and the main button is always an allowed step', () => {
  const BS = load({ full: true });
  for (const from of STATUSES) {
    for (const to of STATUSES) assert.equal((BS.NEXT[from] || []).includes(to), canMove(from, to), `${from} → ${to}`);
    if (BS.PRIMARY[from]) assert.ok(canMove(from, BS.PRIMARY[from]), from);
  }
});

test('the controls show only to our team, never to a brand member, a guest, the demo or a brief copied for the brand’s team', () => {
  for (const live of [{}, { me: { email: 'ana@acme.com' } }, { access: { role: 'owner' } }, { access: { role: 'member' } }]) {
    const BS = load(live); assert.equal(BS.html(work('sent')), '', JSON.stringify(live)); assert.equal(BS.shows(work('sent')), false);
  }
  assert.equal(load({ full: true }, true).html(work('sent')), '', 'never on the demo site');
  const BS = load({ full: true });
  assert.equal(BS.html({ id: 'w', jamBrief: { to: 'team', md: '#' } }), '', 'a brief copied for the brand’s team has no status');
  assert.equal(BS.html({ id: 'w' }), ''); assert.equal(BS.html(null), '');
  assert.ok(load({ access: { full: true } }).shows(work('sent')));
});

test('staff see the status, one main button for the next step and the other steps in a small menu', () => {
  const BS = load({ full: true });
  const h = BS.html(work('sent'));
  assert.match(h, /data-bs-now>Sent</);
  assert.equal((h.match(/btn-primary/g) || []).length, 1);
  assert.match(h, /class="btn btn-primary ship-go" data-bs-go="received"/);
  for (const to of ['in_progress', 'needs_info', 'delivered']) assert.match(h, new RegExp(`<details[\\s\\S]*data-bs-go="${to}"[\\s\\S]*</details>`), to);
  const d = BS.html(work('delivered'));
  assert.doesNotMatch(d, /btn-primary|<details/); assert.match(d, /data-bs-go="in_progress"[^>]*>Reopen it</);
  const ni = BS.html(work('needs_info', { jamBrief: { status: 'needs_info', to: 'shopos', history: [{ s: 'needs_info', note: 'Which size?' }] } }));
  assert.match(ni, /Asked: Which size\?/); assert.match(ni, /data-bs-go="in_progress"[^>]*>Back to work</);
  BS._state.ask = 'wk_1'; const ask = BS.html(work('sent'));
  assert.match(ask, /data-bs-note/); assert.match(ask, /data-bs-go="needs_info"[^>]*>Send the question</);
});

test('the staff controls speak plainly: sentence case, our team, never Brew, ShopOS or moves', () => {
  const BS = load({ full: true }); BS._state.ask = null;
  const all = STATUSES.map((s) => visible(BS.html(work(s)))).join(' ');
  BS._state.ask = 'wk_1'; const ask = visible(BS.html(work('sent'))); BS._state.ask = null;
  for (const t of [all, ask]) { assert.doesNotMatch(t, /\bBrew\b|ShopOS|\bmoves?\b/i); assert.match(t, /Our team/); }
  for (const v of STATUSES.flatMap((f) => (BS.NEXT[f] || []).map((to) => BS.VERB(to, f)))) assert.match(v, /^[A-Z][a-z ]+$/, v);
});

test('the jam wires the controls behind the staff check and the page loads them', () => {
  const app = src('public/app.js'), room = src('public/jam-room.js'), idx = src('public/index.html');
  assert.match(app, /if \(w0 && window\.BriefStaff\?\.shows\(w0\)\) return window\.BriefStaff\.html\(w0/);
  assert.match(room, /if \(w && window\.BriefStaff\?\.shows\(w\)\) return window\.BriefStaff\.html\(w/);
  assert.match(app, /pullWork: \(q\) => pullWork\(q\)/);
  assert.ok(idx.indexOf('brief-staff.js') > 0 && idx.indexOf('brief-staff.js') < idx.indexOf('src="app.js"'));
  assert.match(src('public/brief-staff.js'), /\/api\/work\/\$\{encodeURIComponent\(wid\)\}\/brief\/status/);
});
