// the on-screen spelling check on video finals (text-check.js), on fixtures: free
import test from 'node:test';
import assert from 'node:assert/strict';
import { askedLines, compareLine, textCheckNote } from '../text-check.js';

const prompt = 'Image 1 is the product.\n0-3s: A smile. On screen, in clean bold white type in the top third, exactly: "Hoping today\'s wash day turns out perfect"\n3-6s: Concern. On screen, in clean bold white type in the top third, exactly: "Realizing this regular gel is drying like concrete"\n6-9s: Crunch. <crunch>';

test('the asked lines come from the prompt with their seconds', () => {
  assert.deepEqual(askedLines(prompt), [{ from: 0, to: 3, want: "Hoping today's wash day turns out perfect" }, { from: 3, to: 6, want: 'Realizing this regular gel is drying like concrete' }]);
  assert.deepEqual(askedLines('0-6s: no words'), []);
});

test('a misspelled word is named with what it should read (Arata, 21 Oct: "concrate")', () => {
  const r = compareLine('Realizing this regular gel is drying like concrete', ['Realizing this regular gel is drying like concrate', '']);
  assert.equal(r.ok, false); assert.deepEqual(r.wrong, [{ want: 'concrete', saw: 'concrate' }]);
  assert.equal(compareLine("Hoping today's wash day", ["Hoping today’s wash day!"]).ok, true, 'quotes and punctuation are not mistakes');
  assert.equal(compareLine('Locked in a crunch prison', ['']).shown, false);
});

test('the jam note says what is wrong and where, and that a remake costs credits; nothing when all is right', () => {
  const bad = { ok: false, lines: [{ ...compareLine('drying like concrete', ['drying like concrate']), from: 3, to: 6 }] };
  assert.match(textCheckNote(bad), /“concrate” should read “concrete” \(3–6s\)/); assert.match(textCheckNote(bad), /costs credits/);
  assert.equal(textCheckNote({ ok: true, lines: [] }), null); assert.equal(textCheckNote({ ok: null, lines: [] }), null);
  const none = { ok: false, lines: [{ ...compareLine('Locked in a crunch prison', ['']), from: 6, to: 9 }] }; assert.match(textCheckNote(none), /never shows \(6–9s\)/);
});
