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
