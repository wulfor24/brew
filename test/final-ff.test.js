// Final QA pass 19 Oct (final-feed): the verified gaps, each rule generic for any brand, card type and view. Free: no AI, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createJamBrief } from '../jam-brief.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/* FEED-ARV-01: evidence chat in the jam room and the card chat answers from the card's refined proof */
test('jam room: "what is the evidence for this?" and "show me the proof" get the card’s proof, never the general answer or a note in the brief', async () => {
  const tags = [];
  const claudeTool = async (p, s, m, tag) => { tags.push(tag); return { answer: 'I don’t know that yet.', known: false }; };
  const JB = createJamBrief({ claudeTool, proofOf: () => 'Here’s what this card is based on.\nSaw: 4.2★, average rating (Judge.me).', cardBrief: (c) => `Card: ${c.title}`, seatLine: () => '', isMock: () => false, spend: () => true, now: () => 1, cardOf: () => ({ id: 'm3-1', title: 'Lead with reviews', sub: '' }), log: quiet });
  const R = {}, t = { cards: new Map() }, w = { id: 'wk_1', cardId: 'm3-1', title: 'Lead with reviews', thread: [], stage: 'drafting' };
  JB.routes({ on: (m, p, fn) => { R[`${m} ${p}`] = fn; }, W: () => w, say: (t0, w0, m) => w0.thread.push(m), move: () => {} });
  JB.seed(t, w); const md0 = w.doc.md, rev0 = w.doc.rev;
  for (const q of ['What’s the evidence for this?', 'show me the proof', 'where did these numbers come from']) {
    const r = await R['POST /api/work/:wid/doc/ask']({ text: q }, t, { wid: 'wk_1' });
    assert.equal(r.answered, true, q); assert.match(w.thread.at(-1).body, /^Here’s what this card is based on/, q);
  }
  assert.deepEqual(tags, [], 'no AI call'); assert.equal(w.doc.md, md0, 'the brief is untouched'); assert.equal(w.doc.rev, rev0);
});
test('card chat and studio: the evidence ask is answered before routing, and the studio reads the refined proof', () => {
  const s = src('feed-service.js');
  assert.match(s, /say\(t, w, \{ from: 'me', body \}\);\s*\n\s*if \(EVIDENCE_ASK\.test\(body\)\) \{ const pa = proofSay\(t, w\.cardId\);[^\n]*\n\s*const decision = await routeJam/, '/iterate answers the evidence ask before routeJam');
  assert.match(s, /createRemix\(\{ evidenceOf: \(t, c\) => proofOfCard\(t, c\)/, 'the studio gets the same refined proof');
  assert.match(s, /const proofOfCard = [^\n]*refineProof\(/);
});
