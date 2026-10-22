// Meta Ads read after Arata's first real connect (22 Oct): the brand's Page found from its ads when the sign-in can't list Pages,
// a big ad list read again in smaller pages (Meta's code 1), an account that is the brand's own never split for a few creator
// Pages, a failed ad list said (whole account, "couldn't read"), a ROAS never rounded up, one tired ad is "1 tired ad", the
// campaign count uncapped, the frequency row always written, the budget card's campaigns carried for the package, throttle
// codes and Meta's wait header read, a token lookup that failed tried again the next day. Free: fetch is stubbed.
process.env.BUILD_RESUME_OFF = '1'; process.env.DEMO_MODE = '';
import test from 'node:test';
import assert from 'node:assert/strict';
const { default: meta, freshMeta } = await import('../connectors/meta.js');
const { getJSON, roasX, metaWait, isPrivateCard, connectedOk, acctRows, card } = await import('../connectors/common.js');

const res200 = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const resErr = (status, body, hdr = {}) => ({ ok: false, status, headers: { get: (k) => hdr[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });
const withFetch = async (f, run) => { const f0 = globalThis.fetch; globalThis.fetch = f; try { return await run(); } finally { globalThis.fetch = f0; } };

/* an account shaped like Arata's: no Pages listed to this sign-in, 1,000+ ads mostly from the brand's Page plus a few creator
   Pages, a 200-row ad page refused with code 1, 12 campaigns that spent this week, one ad over 3.5 */
const OWN = '4158', CREATORS = ['c1', 'c2', 'c3'];
const account = ({ adsFail = false, otherShare = 0, pages = [], camps = 8, tired = 1, roas = [9814601.53, 5031747.12] } = {}) => {
  const ads = []; for (let i = 0; i < 300; i++) ads.push({ id: `a${i}`, campaign_id: `k${i % camps}`, effective_status: i < 120 ? 'ACTIVE' : 'PAUSED', creative: { object_story_spec: { page_id: i < 6 ? CREATORS[i % 3] : i < 6 + otherShare ? 'other-brand' : OWN } } });
  const week = []; for (let i = 0; i < camps; i++) week.push({ ad_id: `a${i}`, ad_name: `Ad ${i}`, campaign_id: `k${i}`, campaign_name: `Campaign ${i}`, frequency: i < tired ? '5.33' : '1.4', spend: String(7000 * (camps - i)), action_values: [{ action_type: 'purchase', value: String(7000 * (camps - i) * (i === 0 ? 1.3 : i === 1 ? 2.7 : 1.8)) }] });
  const calls = [];
  const f = async (url) => { const u = new URL(url), p = u.pathname.replace(/^\/v[\d.]+\//, ''), lim = +u.searchParams.get('limit') || 25; calls.push({ p, lim, after: u.searchParams.get('after'), sort: u.searchParams.get('sort') });
    if (p === 'act_1') return res200({ name: 'Arata Mito - YTS', currency: 'INR' });
    if (p === 'act_1/promote_pages') return res200({ data: pages });
    if (p === 'act_1/ads') { if (adsFail) return resErr(500, { error: { code: 1, message: 'Please reduce the amount of data you’re asking for, then retry your request' } });
      if (lim > 100) return resErr(500, { error: { code: 1, error_subcode: 99, message: 'An unknown error occurred' } });
      const at = +(u.searchParams.get('after') || 0), page = ads.slice(at, at + lim), next = at + lim < ads.length;
      return res200({ data: page, paging: next ? { cursors: { after: String(at + lim) }, next: 'more' } : {} }); }
    if (p === 'act_1/insights') return res200({ data: u.searchParams.get('level') === 'ad' ? week : [{ spend: String(roas[1]), reach: '900000', actions: [{ action_type: 'omni_purchase', value: '6452' }], action_values: [{ action_type: 'omni_purchase', value: String(roas[0]) }] }] });
    return resErr(404, { error: { message: 'no' } }); };
  return { f, calls };
};
const CTX = { slug: 'arata-in', host: 'arata.in', hosts: ['arata.in'], pageId: OWN, profile: { name: 'Arata', host: 'arata.in', currency: 'INR', country: 'IN', ads: { own: { pageId: OWN, page: 'Arata' } } }, lane: 'core' };
const C = { token: 'tok', accounts: [{ id: '1' }] };
const ledgerOf = (r) => Object.fromEntries(r.ledger.map((e) => [e.key, e]));

test('Meta: no Pages listed, the brand’s Page is found from its own ads; a few creator Pages never split the account', async () => {
  const A = account(), r = await withFetch(A.f, () => meta.sync(C, CTX)), L = ledgerOf(r);
  assert.equal(r.ownPageId, OWN, 'the Page the Ad Library read found, from the ads');
  assert.ok(!r.notes.some((n) => /also runs ads for other Pages|couldn’t be read/.test(n)), r.notes.join(' | '));
  assert.equal(L['meta.spend.30d'].n, 5031747.12, 'the whole account is the brand’s own'); assert.equal(L['meta.spend.30d'].label, 'Meta spend, last 30 days');
  assert.equal(L['meta.ads.live'].n, 120, 'live ads counted once the list reads');
  assert.ok(A.calls.some((c) => c.p === 'act_1/ads' && c.lim === 100), 'read again with 100 a page after code 1');
  assert.ok(A.calls.filter((c) => c.p === 'act_1/insights' && c.sort).every((c) => c.sort === '["spend_descending"]'), 'ad rows biggest spend first');
  const own = await withFetch(A.f, () => meta.owns(C, CTX));
  assert.equal(own.ok, true, own.why); assert.match(own.why, /runs ads for Arata/);
});

test('Meta: a real second brand on the account (15% of its ads or more) is split off; below that it is not', async () => {
  const shared = await withFetch(account({ otherShare: 80 }).f, () => meta.sync(C, CTX));
  assert.ok(shared.notes.some((n) => /also runs ads for other Pages/.test(n)));
  assert.equal(shared.accounts[0].shared, true);
  const mine = await withFetch(account({ otherShare: 20 }).f, () => meta.sync(C, CTX));
  assert.equal(mine.accounts[0].shared, false, '20 of 300 ads is a partner, not another brand');
});

test('Meta: an ad list that can’t be read is said: whole-account totals, live ads "couldn’t read", a note that it tries again', async () => {
  const r = await withFetch(account({ adsFail: true }).f, () => meta.sync(C, CTX)), L = ledgerOf(r);
  assert.ok(r.notes.some((n) => /ad list couldn’t be read this time.*whole account’s.*next refresh tries again/.test(n)), r.notes.join(' | '));
  assert.equal(r.stats[0][0], 'Whole ad account spend, 30 days');
  assert.deepEqual(r.stats.find((s) => s[0] === 'Live ads'), ['Live ads', 'Couldn’t read this time'], 'never blank, never 0');
  assert.equal(L['meta.ads.live'], undefined, 'no live-ads fact from a failed read');
});

test('Meta: ROAS is never rounded up; one tired ad is "1 tired ad"; the campaign count is every campaign that spent', async () => {
  const r = await withFetch(account({ camps: 12 }).f, () => meta.sync(C, CTX)), L = ledgerOf(r);
  assert.equal(L['meta.roas'].v, '1.95x'); assert.deepEqual(r.stats.find((s) => s[0] === 'Return on ad spend'), ['Return on ad spend', '1.95x']);
  assert.ok(r.changed.includes('1 tired ad flagged for fresh versions'), r.changed.join(' | '));
  assert.ok(r.changed.some((x) => /12 campaigns that spent this week/.test(x)), r.changed.join(' | '));
  assert.ok(!r.changed.some((x) => /live cost per purchase|active campaigns/.test(x)));
  const freq = r.cards.find((c) => c.id === 'live-meta-freq'); assert.ok(freq, 'a single tired ad gets its card');
  assert.ok(freq.rows.some(([k, v]) => k === 'Tired ad' && /Ad 0 · 5\.3 a week/.test(v)), 'the tired ad is named');
  const two = await withFetch(account({ tired: 2 }).f, () => meta.sync(C, CTX));
  assert.ok(two.changed.includes('2 tired ads flagged for fresh versions'));
});

test('Meta: the frequency row is written below 3.5 too, and the budget card carries its campaigns and every figure it quotes', async () => {
  const r = await withFetch(account({ tired: 0 }).f, () => meta.sync(C, CTX)), L = ledgerOf(r);
  assert.equal(L['meta.frequency.max'].n, 1.4, 'a healthy account still gives the ring and the scorecard its frequency');
  assert.equal(r.cards.find((c) => c.id === 'live-meta-freq'), undefined);
  const s = r.cards.find((c) => c.id === 'live-meta-shift'); assert.ok(s, 'a 1.3x and a 2.7x campaign make a budget card');
  assert.equal(s.shift.from, 'Campaign 0'); assert.equal(s.shift.to, 'Campaign 1'); assert.equal(s.shift.perDay, Math.round((7000 * 8 / 7) * 0.2));
  assert.equal(L['meta.shift.day'].n, s.shift.perDay, 'the “Move ₹X a day” figure is on the fact sheet');
  assert.match(L['meta.campaigns.7d'].v, /Campaign 0: 1\.3x/); assert.equal(L['meta.campaigns.7d'].n, 8);
  assert.ok(r.ledger.every((e) => e.cur === 'INR'), 'every row says its currency');
  assert.equal(s.time, undefined, 'the card no longer says "just now" forever (forViewer stamps the read time)');
});

test('ROAS format: floors to 2 places (no float slip), whole numbers past 10', () => {
  assert.deepEqual([1.951, 1.15, 2, 1.999, 0.67, 10.9, 3.6].map(roasX), ['1.95x', '1.15x', '2x', '1.99x', '0.67x', '10x', '3.6x']);
  assert.equal(roasX(null), '');
});

test('getJSON: 80004 is a rate limit with Meta’s own wait; code 2 and a 5xx are tried again; code 1 is left to the caller', async () => {
  const waits = [];
  const hdr = { 'x-business-use-case-usage': JSON.stringify({ 1: [{ type: 'ads_insights', estimated_time_to_regain_access: 7 }] }) };
  const e1 = await getJSON('https://x.test/a', { fetchImpl: async () => resErr(400, { error: { code: 80004, message: 'too many calls' } }, hdr), wait: async (ms) => waits.push(ms) }).catch((e) => e);
  assert.equal(e1.rateLimited, true); assert.equal(e1.retryAfter, 7 * 60e3); assert.equal(waits.length, 0, 'a long wait is thrown, the tick backs off');
  let n = 0; const ok = await getJSON('https://x.test/b', { fetchImpl: async () => (++n === 1 ? resErr(500, { error: { code: 2, message: 'Service temporarily unavailable', is_transient: true } }) : res200({ ok: 1 })), wait: async (ms) => waits.push(ms) });
  assert.deepEqual(ok, { ok: 1 }); assert.equal(waits.length, 1);
  n = 0; const e2 = await getJSON('https://x.test/c', { fetchImpl: async () => (n++, resErr(500, { error: { code: 1, message: 'reduce the amount of data' } })), wait: async () => {} }).catch((e) => e);
  assert.equal(e2.code, 1); assert.equal(n, 1, 'code 1 is not retried as is (allSmaller asks for less)'); assert.ok(!e2.rateLimited);
  assert.equal(metaWait('nonsense'), null); assert.equal(metaWait(JSON.stringify({ 9: [{ estimated_time_to_regain_access: 0 }] })), null);
});

test('freshMeta: a token lookup that didn’t answer is tried again the next day, never left unknown for good', async () => {
  process.env.META_ADS_OAUTH_CLIENT_ID = 'id'; process.env.META_ADS_OAUTH_CLIENT_SECRET = 'sec';
  let calls = 0; const down = async () => { calls++; throw new Error('meta debug_token 500'); };
  const a = await freshMeta({ token: 't' }, { now: 1e12, getJSONImpl: down });
  assert.equal(a.expChecked, undefined); assert.equal(a.expTriedAt, 1e12);
  await freshMeta(a, { now: 1e12 + 3600e3, getJSONImpl: down }); assert.equal(calls, 1, 'not again within the day');
  const b = await freshMeta(a, { now: 1e12 + 25 * 3600e3, getJSONImpl: async () => ({ data: { expires_at: 1.79e9 } }) });
  assert.equal(b.exp, 1.79e12); assert.equal(b.expChecked, 1e12 + 25 * 3600e3);
});

test('a team-only card, a move written from a disconnected account, and account rows outside the team', () => {
  assert.equal(isPrivateCard(card('meta', 'Meta Ads', 'core', 'shift', { rows: [], cta: 'x' })), true);
  assert.equal(isPrivateCard({ id: 'm09-1-p' }), true); assert.equal(isPrivateCard({ id: 'live-marketplaces-rank', publicLive: true }), false);
  assert.equal(isPrivateCard({ id: 'm09-1' }), false); assert.equal(isPrivateCard({ id: 'idea-x-p', memberIdea: true }), true);
  assert.equal(connectedOk({ connectedWith: ['meta'] }, { meta: true }), true);
  assert.equal(connectedOk({ connectedWith: ['meta', 'shopify'] }, ['shopify']), false, 'Meta was disconnected: the move waits');
  assert.equal(connectedOk({}, []), true, 'a move written before connectedWith always shows');
  assert.equal(connectedOk({ connectedWith: ['meta', 'shopify'] }, ['shopify'], 40), true, 'an email move written while Meta was on stays when Meta goes');
  assert.equal(connectedOk({ connectedWith: ['meta', 'shopify'] }, ['shopify'], 21), false, 'a paid move waits');
  const rows = { 'meta.cpa': { v: '₹780', n: 780 } };
  assert.deepEqual(acctRows({ member: false, liveLedger: rows }), []); assert.equal(acctRows({ member: true, liveLedger: rows }).length, 1);
});
