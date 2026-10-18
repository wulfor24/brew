// Jam chat (2026-10-16 audit): a question gets an answer and never a new version; "keep the same photo, change the words
// only" never starts a paid photo; an answer says only what the card, the package, the facts and the connected numbers
// say, and says so when they don't ("the script shows the highest engagement" with no data is cut). Free: fake AI only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isQuestion, photoAsk, groundCheck, answerGrounded, UNKNOWN } from '../jam-answer.js';
import { createJamBrief } from '../jam-brief.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('a question is told apart from a change, however it is phrased', () => {
  for (const q of ['Which script has the highest engagement?', 'what does the hook say', 'Why this price?', 'Is the offer still live', 'Does this work for WhatsApp?', 'How long should it run?'])
    assert.equal(isQuestion(q), true, q);
  for (const c of ['Can you make it shorter?', 'Could you add the price?', 'Please swap the hook', 'Make it punchier', 'Shorten the headline', 'How about a Hindi version?', 'Keep the same photo, change the words only', 'Add ROAS metrics', "Let's lead with the price"])
    assert.equal(isQuestion(c), false, c);
});

test('"keep the photo" never makes one; "change the photo" does; a comma never joins the photo to another change', () => {
  for (const k of ['Keep the same photo, change the words only', 'keep the photo but rewrite the caption', 'same image, new headline', "don't change the photo, just the copy", 'Text only please', 'Change the words only', 'the picture is fine, shorten it', 'no new photo, sharper hook'])
    assert.equal(photoAsk(k), 'keep', k);
  for (const c of ['Change the photo', 'Use a different image', 'swap the picture for a lifestyle shot', 'new visual please', 'photos: redo them']) assert.equal(photoAsk(c), 'change', c);
  for (const n of ['photo, change the hook', 'Shorter hook', 'Add the price']) assert.equal(photoAsk(n), null, n);
});

test('the cheap check: a number or a performance claim the evidence lacks is caught; what the evidence holds passes', () => {
  const ev = 'Card: Lead with the 30-day promise. Price ₹1,299. Acme: live Meta ads (read 14 Oct): 1,348. Connected accounts: none with results for this yet.';
  assert.equal(groundCheck('The script shows the highest engagement.', ev).ok, false, 'the 16 Oct answer: no data behind it');
  assert.equal(groundCheck('The script shows the highest engagement.', ev).issues[0].kind, 'performance');
  assert.equal(groundCheck('It got 4,200 clicks last week.', ev).issues[0].kind, 'number');
  assert.equal(groundCheck('The price is ₹1,299 and you run 1,348 live ads.', ev).ok, true);
  assert.equal(groundCheck('Lead with the 30-day promise in 3 lines.', ev).ok, true, 'small counts pass');
  assert.equal(groundCheck('Version B has the best CTR.', `${ev}\nMeta Ads: CTR 2.1% on version B, 1.4% on A`).ok, true, 'with the numbers, a performance answer is fine');
});

test('a grounded answer: an invented result is cut and the reply says what isn’t known; a backed one stands', async () => {
  const calls = [];
  const fake = (answer, known = true) => async (prompt, schema, max, tag) => { calls.push({ tag, max, prompt }); return { answer, known }; };
  const ev = 'Card: Lead with the 30-day promise. The package: hook: Warm paws all winter. Connected accounts: none with results for this yet.';
  const a = await answerGrounded({ ai: fake('The script shows the highest engagement. The hook is "Warm paws all winter".'), question: 'Which script performs best?', evidence: ev });
  assert.equal(a.known, false); assert.match(a.answer, /^The hook is "Warm paws all winter"\. /); assert.ok(a.answer.endsWith(UNKNOWN)); assert.doesNotMatch(a.answer, /highest engagement/);
  const b = await answerGrounded({ ai: fake('The hook is "Warm paws all winter".'), question: 'What is the hook?', evidence: ev });
  assert.equal(b.answer, 'The hook is "Warm paws all winter".'); assert.equal(b.known, true);
  assert.ok(calls.every((c) => c.tag === 'jam_answer' && c.max <= 800), 'one small call, never the whole brief or package');
  assert.match(calls[0].prompt, /Never say how something performs/);
});

test('jam brief: a question is answered without rewriting the brief (no new rev, one small call); an edit still edits it', async () => {
  const tags = [];
  const claudeTool = async (prompt, schema, max, tag) => { tags.push(tag); return tag === 'jam_answer' ? { answer: 'This variant converts best. The offer is the 30-day promise.', known: true } : { reply: 'Shortened it.', doc: '# New jam\n\nShorter headline.\n\n## Plan\n- Lead with the 30-day promise', next: [], plan: {}, measure: null }; };
  const JB = createJamBrief({ claudeTool, cardBrief: (c) => `Card: ${c.title}. ${c.sub}`, seatLine: () => '', isMock: () => false, spend: () => true, now: () => 1, cardOf: () => ({ id: 'jam-x', title: 'New jam', sub: 'Lead with the 30-day promise.' }), log: quiet });
  const R = {}, t = { cards: new Map() }, w = { id: 'wk_1', cardId: 'jam-x', title: 'New jam', thread: [], stage: 'drafting' };
  JB.routes({ on: (m, p, fn) => { R[`${m} ${p}`] = fn; }, W: () => w, say: (t0, w0, m) => w0.thread.push(m), move: () => {} });
  JB.seed(t, w); const md0 = w.doc.md, rev0 = w.doc.rev;
  const r = await R['POST /api/work/:wid/doc/ask']({ text: 'Which variant converts best?' }, t, { wid: 'wk_1' });
  assert.equal(r.answered, true); assert.deepEqual(tags, ['jam_answer']); assert.equal(w.doc.md, md0); assert.equal(w.doc.rev, rev0, 'a question is never a new version of the brief');
  const reply = w.thread.at(-1).body; assert.doesNotMatch(reply, /converts best/, 'the made-up result is cut'); assert.match(reply, /don’t know that yet/);
  await R['POST /api/work/:wid/doc/ask']({ text: 'Make the headline shorter' }, t, { wid: 'wk_1' });
  assert.ok(tags.includes('jam_doc')); assert.match(w.doc.md, /Shorter headline/);
});

test('the studio: a question never makes a version, a package that came back unchanged is no version, "keep the photo" never starts one', () => {
  const r = src('remix.js');
  assert.doesNotMatch(r, /PHOTO_ASK/, 'the old regex that matched "photo, change" is gone');
  assert.match(r, /if \(!knob && !quiet && \(isQuestion\(message\) \|\| EVIDENCE_ASK\.test\(message\)\)\) \{ think\(ch, [^)]*\); try \{ return await answerIn\(/, 'questions are answered before any rewrite');
  assert.match(r, /photoAsk\(msg\) === 'change' && !isQuestion\(msg\)/, 'a paid photo only for an ask to change it');
  assert.match(r, /if \(!keepPhoto && \(out\.newImage/, 'the model can’t start a photo the person said to keep');
  assert.match(r, /const same = JSON\.stringify\(snapOf\(ch\)\) === snapIn;\s*\n\s*if \(!same\) \{ const v = version\(/, 'no identical version');
  assert.match(r, /if \(ANSWERED\.has\(ch\)\) return \{ change: pubChange\(t, ch\), answered: true \}; \/\* a question: no new version in the jam either/);
  const fsv = src('feed-service.js');
  assert.match(fsv, /const makeAsk = \(text\) => MAKE_ASK\.test\(text\) && photoAsk\(text\) !== 'keep' && !isQuestion\(text\);/);
  assert.doesNotMatch(fsv.replace(/const makeAsk = [^\n]*\n/, ''), /MAKE_ASK\.test\(/, 'every paid-make path goes through makeAsk');
  assert.match(src('public/app.js'), /if \(!r\.answered\) syncBrief\(r\.change, msg\);/, 'an answer doesn’t rewrite the brief in the background');
});
