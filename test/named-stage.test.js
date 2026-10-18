import test from 'node:test';
import assert from 'node:assert/strict';
import { named, namedStale, NAMED_V } from '../reader/stages/named.js';

const answers = () => [
  { tool: 'chatgpt', q: 'best curl cream', text: 'Try Bare Anatomy or WishCare curl cream. Buy on Nykaa.', entities: ["L'Oréal"] },
  { tool: 'gemini', q: 'best curl cream', text: 'Arata and Himalaya are both fine.' },
  { tool: 'perplexity', q: 'x', error: 'timeout' }];
const ctxOf = (reply, aiOn = true) => ({ aiOn, profile: { name: 'Arata', ai: { answers: answers() } }, ai: async () => (reply instanceof Error ? Promise.reject(reply) : { json: reply }) });

test('named: each answer gets the brands it names; own brand, shops and names not in the text are dropped', async () => {
  const ctx = ctxOf({ answers: [{ i: 0, brands: ['Bare Anatomy', 'WishCare', 'Nykaa', 'Made Up Co', 'curl cream'] }, { i: 1, brands: ['Arata', 'Himalaya'] }] });
  await named(ctx);
  const [a, b] = ctx.profile.ai.answers;
  for (const n of ['Bare Anatomy', 'WishCare', "L'Oréal"]) assert.ok(a.brandsNamed.includes(n), n); // ChatGPT's own entities count too
  assert.ok(!a.brandsNamed.includes('Made Up Co')); // not in the answer: never guessed
  assert.ok(!a.brandsNamed.includes('curl cream')); // a product type, not a brand
  assert.deepEqual(b.brandsNamed, ['Himalaya']); // the brand itself is counted elsewhere
  assert.equal(ctx.profile.ai.named.v, NAMED_V); assert.equal(ctx.profile.ai.named.error, undefined);
  assert.equal(namedStale(ctx.profile), false);
});

test('named: a failed pass is stamped as an error (never an empty list) and heals after an hour', async () => {
  const ctx = ctxOf(new Error('Vertex 503'));
  await assert.rejects(named(ctx));
  assert.match(ctx.profile.ai.named.error, /503/);
  assert.ok(ctx.profile.ai.answers.every((a) => a.brandsNamed === undefined));
  assert.equal(namedStale(ctx.profile), false); // just failed: waits an hour
  ctx.profile.ai.named.at = new Date(Date.now() - 2 * 36e5).toISOString();
  assert.equal(namedStale(ctx.profile), true);
  const off = ctxOf({}, false); await named(off); assert.match(off.profile.ai.named.error, /AI off/);
});

test('namedStale: a saved read with answers and no pass, or an older pass, heals; no answers, nothing to do', () => {
  assert.equal(namedStale({ ai: { answers: answers() } }), true);
  assert.equal(namedStale({ ai: { answers: answers(), named: { v: NAMED_V - 1, at: new Date().toISOString() } } }), true);
  assert.equal(namedStale({ ai: { answers: [] } }), false);
});
