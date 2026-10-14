// The Ad Library never turns a treg failure into "no ads": adCall falls back to the page reader, and when that is
// unavailable too it throws an error naming both failures (callers show "couldn't be read", never "none").
import test from 'node:test';
import assert from 'node:assert/strict';
import { adCall } from '../reader/adlib.js';

const broke = { live: true, call: async (id) => { throw new Error(`treg ${id} 402: insufficient_balance`); } };

test('treg success is returned as is', async () => {
  const ok = { live: true, call: async () => ({ results: [{ page_name: 'X' }], searchResultsCount: 1 }) };
  assert.equal((await adCall(ok, 'scrapecreators.x.v1-facebook-adlibrary-company-ads', { query: { companyName: 'X' } })).searchResultsCount, 1);
});

test('treg failure with no page reader is an error naming both, never an empty result', async () => {
  const prev = process.env.ADLIB_OFF; process.env.ADLIB_OFF = '1';
  try {
    for (const id of ['scrapecreators.x.v1-facebook-adlibrary-company-ads', 'scrapecreators.x.v1-facebook-adlibrary-search-ads', 'scrapecreators.x.v1-facebook-adlibrary-search-companies']) {
      await assert.rejects(adCall(broke, id, { query: { companyName: 'Stroom', query: 'Stroom', country: 'IN' } }), (e) => /Ad Library unreachable/.test(e.message) && /402/.test(e.message));
    }
  } finally { if (prev == null) delete process.env.ADLIB_OFF; else process.env.ADLIB_OFF = prev; }
});

test('a non-Ad Library endpoint is not routed to the page reader', async () => {
  await assert.rejects(adCall(broke, 'crawl4ai.google.serp.organic', { query: { q: 'x' } }), /402/);
});
