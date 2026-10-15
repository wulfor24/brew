// The showcase never presents simulated or invented content as real (handover P0, 2026-10-15):
// no canned sign-offs, simulated teammates change nothing and leak nowhere, simulated account numbers are never evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { simulated, realRows } from '../connectors/common.js';
import { createHandoff } from '../handoff.js';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('no canned sign-offs: nothing claims a check, approval or consent that nobody gave', () => {
  const s = src('remix.js') + src('feed-service.js');
  for (const re of [/Verified this morning/, /Cleared\. Every claim/, /used with consent/, /Approving ✅/, /approved v\$\{w\.current\}\. Ready to ship/, /const ANSWERS = \{/])
    assert.doesNotMatch(s, re, `found ${re}`);
  assert.doesNotMatch(src('public/jam-room.js'), /Posted to \$\{/, 'no toast says something was posted');
});

test('a simulated teammate reply changes no stage and is tagged', () => {
  const s = src('feed-service.js'); const i = s.indexOf('const colleagueReply'); const body = s.slice(i, s.indexOf('const answerOnly', i));
  assert.match(body, /say\(t, w, \{ from: 'colleague', who, body: r\.reply, dummy: true \}\)/);
  assert.doesNotMatch(body, /move\(t, w, '(ready|needs_you)'/);
});

test('simulated account rows: flagged ones and old unflagged connector rows never count; real rows do', () => {
  const sim = { key: 'shopify.revenue.30d', v: '₹1 Cr', method: 'connected account', demo: true };
  const old = { key: 'meta.roas', v: '3.1x', method: 'connected account' }; // saved before the flag was kept
  const real = { key: 'meta.ads.live', v: '42', method: 'account:meta' };
  assert.ok(simulated(sim) && simulated(old) && !simulated(real));
  assert.deepEqual(realRows([sim, old, real]), [real]);
  assert.deepEqual(realRows({ a: sim, b: real }), [real]);
});

test('the shared brief leaves out simulated chat and simulated answers', async () => {
  const HO = createHandoff({ RMX: null, pageOf: async () => null, fillCard: (c) => c, SEED: { brand: { name: 'Acme' } } });
  const w = { id: 'wk_1', cardId: 'c1', title: 'A card', agent: 'creative', stage: 'drafting', versions: [], current: 1,
    thread: [{ id: 'm1', from: 'me', body: 'Can we ship Friday?' }, { id: 'm2', from: 'colleague', who: 'Brand manager', body: 'Approved.', dummy: true },
      { id: 'm3', from: 'brew', who: 'Deploy lead', body: 'The ShopOS team has it.' }, { id: 'm4', from: 'ai', body: 'Suggested: Friday works.' }],
    plan: { questions: [{ q: 'Are the claims cleared?', answer: 'Cleared.', by: 'teammate:Brand manager' }, { q: 'Sizes?', answer: 'Suggested: 1:1 and 4:5.', by: 'ai:creative' }, { q: 'Owner?', answer: 'Me', by: 'you' }] } };
  const t = { id: 't_1', cards: new Map(), viewer: {} };
  const x = await HO.build(t, w);
  assert.deepEqual(x.jam.map((m) => m.text), ['Can we ship Friday?', 'Suggested: Friday works.']);
  assert.deepEqual(x.questions.map((q) => q.a), [null, 'Suggested: 1:1 and 4:5.', 'Me']);
});

test('the festival is always the next one: it rolls to next year once the day has passed', async () => {
  const { nextFestival } = await import('../calendar.js');
  assert.equal(nextFestival('IN', new Date('2026-10-15')).date.slice(0, 10), '2026-11-08');
  assert.equal(nextFestival('IN', new Date('2026-11-09')).date.slice(0, 10), '2027-10-29');
  const us = nextFestival('US', new Date('2026-11-28')); assert.equal(us.name, 'Black Friday'); assert.equal(us.date.slice(0, 10), '2027-11-26');
  assert.match(us.label, /2027$/, 'a date next year says the year');
});

test('saved moves and seeds read honestly: no "OF N" kicker, no watching promise, no cut-feature welcome', async () => {
  const { brewFile } = await import('../brew-name.js');
  const saved = JSON.stringify({ kicker: 'PRICING · MOVE 65 OF 64', body: 'What Brew will watch: listen.x. | WEEK | BREW SHIPS |', h: 'Fifty-one moves, turned into cards.', w: 'Heart it, jam on it, do it.' });
  const out = brewFile('moves.json', Buffer.from(saved)).toString();
  assert.match(out, /PRICING · MOVE 65"/); assert.match(out, /What to watch:/); assert.match(out, /BREW DRAFTS/);
  assert.match(out, /Your moves, turned into cards\./); assert.match(out, /share the brief/); assert.doesNotMatch(out, /OF 64|Brew will watch|do it\./);
});

test('saved PDFs heal: a missing one is drawn (a failed render is tried again), retired moves leave the list, zips rebuild', async () => {
  const os = await import('node:os'); const path = await import('node:path');
  const { createPacks } = await import('../brand-pack.js'); const { createBuilder } = await import('../build.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-pdf-')); const quiet = { log() {}, warn() {}, error() {} };
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = 'acme-com';
  await P.put(slug, 'status.json', { slug, done: true, pdfs: { 1: '1 One.pdf', 1001: '1001 Retired.pdf' } });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.com' });
  await P.put(slug, 'moves.json', { 1: { n: 1, title: 'One', kicker: 'X · MOVE 01 OF 52' }, 2: { n: 2, title: 'Two', kicker: 'X · MOVE 02 OF 64' } });
  let tries = 0; const drawn = [];
  const pdf = { pdfName: (m) => `${m.n} ${m.title}.pdf`, zipBuffer: () => Buffer.from('zip'),
    renderMove: async (m, brand, out) => { if (m.n === 2 && !tries++) throw new Error('chrome hiccup'); drawn.push(m.kicker); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, 'pdf'); } };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {} }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves: null, pdf } });
  await b.healPdfs(slug);
  const st = await P.getJSON(slug, 'status.json');
  assert.deepEqual(Object.keys(st.pdfs).sort(), ['1', '2']); assert.equal(st.pdfV, 2); assert.ok(st.zips?.length, 'zips rebuilt');
  assert.ok(drawn.every((k) => !/ OF \d/.test(k)), 'PDFs are drawn from the healed kicker');
});

test('the told lift needs learnings, and only moves written after them count', async () => {
  const { cardUsesLearned, learnedMoveNs } = await import('../brand-learnings.js');
  assert.equal(cardUsesLearned('The team says the serum sells best', []), false, 'no learnings, no lift');
  assert.equal(cardUsesLearned('The team says the serum sells best', [['micro', 'drama', 'buckets']]), true);
  const L = { at: '2026-10-14T10:00:00Z', goals: [{ text: 'Plan a micro-drama concept document across three age buckets' }] };
  const moves = { 3: { title: 'Old', meta: { at: '2026-10-01T00:00:00Z' }, sections: ['the team says'] }, 4: { title: 'New', meta: { at: '2026-10-15T00:00:00Z' }, sections: ['the team says'] } };
  assert.deepEqual([...learnedMoveNs(moves, L)], [4]);
});
