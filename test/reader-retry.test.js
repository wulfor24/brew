// A read whose "Ask the AI tools" step timed out is asked again by heal(), and its new cards replace the old ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createReader, blankProfile, answersFailed } from '../reader/index.js';

const fakeAi = { live: true, meter: { usd: 0 }, async call(o) {
  if (o.tag === 'reader-questions') return { json: { questions: [{ q: 'best wool sneakers', branded: false }, { q: 'is acme good', branded: true }] }, text: '' };
  return { text: 'Try Acme or Rival Co.', cites: [{ url: 'https://acme.com' }], json: null };
} };

test('answersFailed: an error or a stuck step with no saved answers', () => {
  const p = blankProfile(new URL('https://acme.com'), 'acme-com');
  assert.equal(answersFailed(p, null), false);
  assert.equal(answersFailed({ ...p, meta: { errors: { answers: 'answers timed out after 170s' } } }, null), true);
  assert.equal(answersFailed(p, { steps: [{ k: 'answers', state: 'queued' }] }), true);
  assert.equal(answersFailed(p, { steps: [{ k: 'answers', state: 'empty', done: 'could not finish (answers timed out after 170s)' }] }), true);
  assert.equal(answersFailed({ ...p, ai: { answers: [{ q: 'x' }] }, meta: { errors: { answers: 'x' } } }, null), false);
});

test('heal asks the AI tools again and swaps the step and its cards', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
  const was = process.env.AI_PROVIDER; process.env.AI_PROVIDER = 'anthropic'; // the Claude ask is the only one here (no treg); it sits out under Gemini
  const reader = createReader({ ai: fakeAi, treg: null, root, log: { warn() {}, info() {} } });
  const p = blankProfile(new URL('https://acme.com'), 'acme-com');
  Object.assign(p, { name: 'Acme', country: 'US', descriptor: 'wool sneakers', descriptorBy: 'claude', ads: { v: 'skip', own: { page: 'Acme' }, rivals: [] },
    meta: { errors: { answers: 'answers timed out after 170s' } } });
  const findings = { steps: [{ k: 'answers', t: 'Ask the AI tools', state: 'empty', done: 'could not finish (answers timed out after 170s)' }],
    cards: [{ k: 'answers', kind: 'film', t: 'Films' }, { k: 'answers', kind: 'answer', t: 'old' }] };
  // ads would heal too because of the version; keep it out of this test
  const { ADS_V } = await import('../reader/stages/ads.js'); p.ads.v = ADS_V;
  const out = await reader.heal(p, { findings });
  if (was === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = was;
  assert.ok(out, 'heal changed something');
  assert.ok(out.changed.includes('answers'));
  assert.ok(out.profile.ai.answers.length > 0);
  assert.equal(out.profile.meta.errors.answers, undefined);
  const st = out.findings.steps.find((x) => x.k === 'answers');
  assert.doesNotMatch(st.done, /could not finish/);
  assert.ok(out.findings.cards.some((c) => c.kind === 'film'), 'the Films card stays');
  assert.ok(!out.findings.cards.some((c) => c.t === 'old'), 'the old answer card is replaced');
});

test('shopper questions: the AI fails, template questions are still asked through treg, and heal is told to retry', async () => {
  const { answers, templateQuestions } = await import('../reader/stages/answers.js');
  const p = blankProfile(new URL('https://acme.com'), 'acme-com');
  Object.assign(p, { name: 'Acme', country: 'IN', subcategory: 'Wool Sneakers', rivals: [{ name: 'Rival Co' }] });
  const asked = []; const steps = {};
  const ctx = { profile: p, ledger: { add() {} }, aiOn: true, tregOn: true, today: '2026-10-16', log: { warn() {} }, tick() {}, finding() {},
    done: (k, text, state) => { steps[k] = { text, state }; },
    ai: async () => { throw new Error('quota exhausted'); },
    dfs: async (_id, body) => { asked.push(body[0].keyword || body[0].user_prompt); return { markdown: 'Try Acme or Rival Co.', sources: [] }; } };
  await answers(ctx);
  assert.equal(p.ai.questionsBy, 'template');
  assert.equal(p.ai.questions.length, 8);
  assert.ok(p.ai.questions.includes('best wool sneakers in India'));
  assert.ok(p.ai.questions.includes('Acme vs Rival Co'));
  assert.ok(asked.length >= 8, 'the treg AI tools were still asked');
  assert.match(p.meta.errors.answers, /quota/);
  assert.equal(steps.answers.state, 'done');
  assert.match(steps.answers.text, /from a template/);
  assert.equal(answersFailed(p, null), true, 'heal writes real questions later');
  assert.equal(templateQuestions({ name: 'X', host: 'x.com' }).length, 8);
});
