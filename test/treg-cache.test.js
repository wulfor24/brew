// treg data calls are paid for once a day at most; generation, polling and failures are never cached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreg } from '../treg.js';

function withFetch(fn) {
  return async () => {
    const real = globalThis.fetch; const calls = [];
    let fail = false;
    globalThis.fetch = async (u) => { calls.push(String(u)); if (fail) return new Response('{"detail":"insufficient_balance"}', { status: 402 }); return new Response(JSON.stringify({ n: calls.length }), { status: 200, headers: { 'x-treg-cost-micro': '2000' } }); };
    process.env.TREG_TOKEN ||= 'test';
    try { await fn(calls, (v) => { fail = v; }); } finally { globalThis.fetch = real; }
  };
}
const memCache = () => { const m = new Map(); return { m, get: async (k) => m.get(k) || null, put: async (k, v) => { m.set(k, v); } }; };

test('the same data call twice in a day is paid once', withFetch(async (calls) => {
  const t = createTreg({ cache: memCache() });
  const a = await t.call('scrapecreators.x.v1-facebook-adlibrary-company-ads', { query: { companyName: 'Stroom', country: 'IN' }, tag: 'reader-x' });
  const b = await t.call('scrapecreators.x.v1-facebook-adlibrary-company-ads', { query: { companyName: 'Stroom', country: 'IN' }, tag: 'other-tag' });
  assert.equal(calls.length, 1); assert.deepEqual(a, b); assert.equal(t.meter.hits, 1);
  await t.call('scrapecreators.x.v1-facebook-adlibrary-company-ads', { query: { companyName: 'Yoga Bar', country: 'IN' } });
  assert.equal(calls.length, 2, 'different parameters are a different call');
}));

test('an answer older than a day is fetched again', withFetch(async (calls) => {
  const c = memCache(); const t = createTreg({ cache: c });
  await t.call('crawl4ai.google.serp.organic', { query: { q: 'protein bar' } });
  for (const [k, v] of c.m) c.m.set(k, { ...v, at: new Date(Date.now() - 25 * 36e5).toISOString() });
  await t.call('crawl4ai.google.serp.organic', { query: { q: 'protein bar' } });
  assert.equal(calls.length, 2);
}));

test('generation and job polling are never cached', withFetch(async (calls) => {
  const t = createTreg({ cache: memCache() });
  for (let i = 0; i < 2; i++) {
    await t.call('minimax.video-gen.from_image', { body: { prompt: 'x' } });
    await t.call('minimax.video-gen.task.status', { query: { task_id: '1' } });
    await t.call('google-ai.voice-gen.gemini-3-8-flash-tts', { query: { model: 'm' } });
  }
  assert.equal(calls.length, 6);
}));

test('a failed call is not cached, and cache:false opts out', withFetch(async (calls, setFail) => {
  const t = createTreg({ cache: memCache() });
  setFail(true);
  await assert.rejects(t.call('scrapecreators.x.v1-facebook-adlibrary-search-ads', { query: { query: 'a' } }), /402/);
  setFail(false);
  await t.call('scrapecreators.x.v1-facebook-adlibrary-search-ads', { query: { query: 'a' } });
  await t.call('scrapecreators.x.v1-facebook-adlibrary-search-ads', { query: { query: 'a' }, cache: false });
  assert.equal(calls.length, 3);
}));
