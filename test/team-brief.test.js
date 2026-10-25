// the team brief: written from the hand-off, the final words verbatim, the brand's own files only, quick edits kept
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamBrief } from '../team-brief.js';

const X = { title: 'Make the ad', brand: 'Acme', mark: null, memo: { from: 'Ana' }, card: { title: 'Cold feet', sub: 'Offices are cold', agent: 'Creative', type: 'Idea', rows: [['Orders', '120 last month']], why: [] },
  page: { reason: 'Winter is coming', moves: [], options: [] }, decided: null, brief: { md: '# Make the ad', missing: ['Budget'] }, questions: [],
  measure: { metric: 'Cost per order', target: 300, unit: '₹', window: 7 },
  pkg: { id: 'ch1', version: 3, action: 'Make new ads', target: 'Meta Ads', family: 'Meta ad', money: 'No spend', undo: 'Rollback: pause', notes: [], checks: [], thread: [],
    fields: [{ label: 'Primary text', pub: true, value: 'Cold feet, fixed.' }, { label: 'Ad set', pub: false, value: 'Women 25-45' }],
    assets: [{ kind: 'image', label: 'The final picture', url: '/gen/abcdef123456.jpg' }, { kind: 'image', label: 'The rival ad', url: '/research/x.jpg' }, { kind: 'image', label: 'Pack shot', url: '/b/acme-com/a/hero.png' }] } };
const make = (ai) => createTeamBrief({ isMock: () => !ai, spend: () => !!ai, now: () => 5, handoff: { build: async () => X },
  claudeTool: async () => ({ title: 'Cold feet ad', what: 'One Meta ad.', why: 'Offices are cold.', who: 'Women at desks.', creative: 'The attached picture.', specs: '4:5 JPG', rules: 'Use the exact primary text: "Cold feet, fixed."\nReal product only.\nPrimary text must be: "Cold feet, fixed."', when: 'To confirm.', done: 'Approved in the jam.', open: ['Budget'], evidence: [{ say: '120 orders last month', src: 'The card' }] }) });

test('the brief keeps the final words verbatim and attaches only the brand’s own files', async () => {
  const TB = make(true), w = { id: 'w1', doc: { rev: 2 } };
  const { x } = await TB.build({}, w); const v = TB.view(w, x);
  assert.equal(v.title, 'Cold feet ad');
  assert.equal(v.sections.find((s) => s.k === 'words').t, 'Primary text: Cold feet, fixed.');
  assert.match(v.sections.find((s) => s.k === 'measure').t, /Cost per order, target ₹300, read after 7 days/);
  assert.deepEqual(v.creatives.map((c) => c.url), ['gen/abcdef123456.jpg', 'b/acme-com/a/hero.png']);
  assert.equal(v.evidence[0].src, 'The card');
  assert.equal(v.memo.to, 'Your team');
  assert.equal(v.sections.find((s) => s.k === 'rules').t, 'Real product only.');
});

test('offline it still writes a usable brief from the hand-off', async () => {
  const TB = make(false), w = { id: 'w1', doc: { rev: 2, plan: { audience: 'Women 25-45' } } };
  const { x } = await TB.build({}, w); const v = TB.view(w, x);
  assert.equal(v.sections.find((s) => s.k === 'who').t, 'Women 25-45');
  assert.match(v.sections.find((s) => s.k === 'open').t, /Budget/);
});

test('a quick edit is kept when the brief is written again for a new version', async () => {
  const TB = make(true), w = { id: 'w1', doc: { rev: 2 } };
  await TB.build({}, w); w.teamBrief.edits.who = 'Night-shift nurses.';
  X.pkg.version = 4; const { x } = await TB.build({}, w); X.pkg.version = 3;
  assert.equal(TB.view(w, x).sections.find((s) => s.k === 'who').t, 'Night-shift nurses.');
});

test('change with AI: only the asked parts change, the memo line too, and the final words stay the ad’s', async () => {
  let asked = '';
  const TB = createTeamBrief({ isMock: () => false, spend: () => true, now: () => 5, handoff: { build: async () => X },
    claudeTool: async (p, sc, mx, name) => { if (name !== 'team_brief_edit') return { title: 'Cold feet ad', what: 'One Meta ad.', why: 'Offices are cold.', who: 'Women at desks.', creative: 'The picture.', specs: '4:5', rules: 'Real product only.', when: 'To confirm.', done: 'Files back.', open: [], evidence: [] };
      asked = p; return { changes: [{ k: 'to', t: 'Pixel Agency' }, { k: 'when', t: 'Owner: Riya. Due 30 Oct.' }, { k: 'who', t: 'Women at desks.' }], said: 'Sent to Pixel Agency, Riya owns it.', words_only: false }; } });
  const w = { id: 'w1', doc: { rev: 2 } }; await TB.build({}, w);
  const r = await TB.aiEdit({}, w, { ask: 'it goes to Pixel Agency, Riya owns it by 30 Oct', quote: 'Your team' });
  assert.deepEqual(r.changed, ['to', 'when']); /* an unchanged part is not counted */
  assert.match(asked, /selected this text in the brief: "Your team"/);
  assert.equal(r.brief.memo.to, 'Pixel Agency');
  assert.equal(r.brief.sections.find((s) => s.k === 'when').t, 'Owner: Riya. Due 30 Oct.');
  assert.equal(r.brief.sections.find((s) => s.k === 'words').t, 'Primary text: Cold feet, fixed.');
  const { x } = await TB.build({}, w); assert.equal(TB.view(w, x).memo.to, 'Pixel Agency'); /* kept through a rewrite */
});

test('offline: the selected words are swapped for what was typed', async () => {
  const TB = make(false), w = { id: 'w1', doc: { rev: 2, plan: { audience: 'Women 25-45' } } }; await TB.build({}, w);
  const r = await TB.aiEdit({}, w, { ask: 'Men 30-50', quote: 'Women 25-45' });
  assert.equal(r.brief.sections.find((s) => s.k === 'who').t, 'Men 30-50');
});

test('a chat line names the brief or sets one of its facts; a creative ask does not', () => {
  const TB = make(false);
  for (const m of ['owner is Riya', 'budget should be ₹50k', 'in the brief, add the agency', 'brief: due Friday', 'the deadline is 30 Oct']) assert.ok(TB.isBriefAsk(m), m);
  for (const m of ['make the headline shorter', 'warmer photo', 'who is the audience?']) assert.ok(!TB.isBriefAsk(m), m);
});

test('a follow-up goes to the brief when the chat just before was about it', () => {
  const TB = make(false), about = [{ text: '@Param should we make the deadline 17th September' }], ad = [{ text: 'Shorten the hook' }];
  assert.ok(TB.isBriefAsk('yeah, change it to Sep 17th', about));
  assert.ok(!TB.isBriefAsk('yeah, change it to Sep 17th', ad));
  assert.ok(!TB.isBriefAsk('make the photo warmer', about));
});

test('every change stamps the brief and is handed to the jam brief; the jam brief following it never rewrites the team brief', async () => {
  const seen = []; let t0 = 10;
  const TB = createTeamBrief({ isMock: () => true, now: () => t0++, handoff: { build: async () => X }, onEdit: (t, w, e) => seen.push(e.ask) });
  const w = { id: 'w1', doc: { rev: 2, plan: { audience: 'Women 25-45' } } }; await TB.build({}, w); const r0 = TB.view(w, null).rev;
  const r = await TB.aiEdit({}, w, { ask: 'Men 30-50', quote: 'Women 25-45' });
  assert.ok(r.brief.rev > r0); assert.deepEqual(seen, ['Men 30-50']);
  w.doc.rev = 3; TB.follow({}, w); const { x } = await TB.build({}, w);
  assert.match(w.teamBrief.key, /\|3$/); assert.equal(TB.view(w, x).sections.find((s) => s.k === 'who').t, 'Men 30-50');
});

/* 26 Oct: the WhatsApp tab showed the ads brief, To was always "Your team", and the title came back in Title Case */
test('each deliverable tab keeps its own brief; the person picked is the To line; the title reads as a sentence', async () => {
  let routes = {}; const TB = createTeamBrief({ isMock: () => false, spend: () => true, now: () => 5, handoff: { build: async (t, w) => ({ ...X, pkg: { ...X.pkg, id: w.changeId } }) },
    claudeTool: async () => ({ title: 'Stop Hair Fall At The Biological Root', what: 'One message.', why: 'Buyers want a routine.', who: 'Past buyers.', creative: 'None.', specs: '-', rules: 'Real product only.', when: 'To confirm.', done: 'Approved.', open: [], evidence: [] }) });
  const w = { id: 'w1', cardId: 'c1', changeId: 'ch1', doc: { rev: 1 } }, t = { changes: { ch1: { id: 'ch1', cardId: 'c1' }, ch2: { id: 'ch2', cardId: 'c1' }, other: { id: 'other', cardId: 'c9' } } };
  TB.routes({ on: (m, p, fn) => { routes[`${m} ${p}`] = fn; }, W: (tt, id) => (id === 'w1' ? w : null) });
  const q = (ch) => new URLSearchParams(ch ? { ch } : {});
  const a = await routes['GET /api/work/:wid/team-brief']({}, t, { wid: 'w1' }, q());
  const b = await routes['GET /api/work/:wid/team-brief']({}, t, { wid: 'w1' }, q('ch2'));
  assert.equal(w.teamBrief.key.split('|')[1], 'ch1'); assert.equal(w.teamBriefs.ch2.key.split('|')[1], 'ch2', 'the second tab has its own');
  assert.equal(a.brief.title, 'Stop hair fall at the biological root'); assert.equal(b.brief.memo.to, 'Your team');
  const c = await routes['POST /api/work/:wid/team-brief/to']({ kind: 'agency', email: 'riya@pixel.in', ch: 'ch2' }, t, { wid: 'w1' }, q());
  assert.equal(c.brief.memo.to, 'Your agency'); assert.equal(c.brief.recipient.email, 'riya@pixel.in'); assert.equal(w.teamBrief.recipient, null, 'the first tab is untouched');
  await routes['GET /api/work/:wid/team-brief']({}, t, { wid: 'w1' }, q('other')); assert.ok(!w.teamBriefs.other, 'a tab of another card falls back to the jam’s own brief');
});
