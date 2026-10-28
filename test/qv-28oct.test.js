// QV 28 Oct (found on one brand's feed, fixed for every brand): the card picks its own product, proof backs the claim,
// spaced number words, one stock card once a store is connected, community and complaint routing, said-once headlines,
// status words that match their numbers, and partner mode (no prices, our team makes it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.AI_MOCK = '1';

const { numeralsIn } = await import('../num-words.js');

test('C: "thirty one" is 31 and "day twenty one" is day 21, never "30 one"', () => {
  assert.equal(numeralsIn('only thirty one percent of customers buy again'), 'only 31 percent of customers buy again');
  assert.equal(numeralsIn('the reminder goes on day twenty one'), 'the reminder goes on day 21');
  assert.equal(numeralsIn('send on day twenty-one'), 'send on day 21');
  assert.equal(numeralsIn('forty one public reviews'), '41 public reviews');
  assert.equal(numeralsIn('one version, two posts a week'), 'one version, two posts a week', 'small counts stay words');
  assert.equal(numeralsIn('November twenty first'), '21 November');
});

const { cardProduct } = await import('../product-match.js');
const { draftFits } = await import('../drafts-bg.js');
const CAT = [
  { t: 'Anti-Breakage Intensive Conditioner 15ml', price: 0, tags: ['free-sample'], img: 'c15.jpg' },
  { t: 'Anti-Breakage Intensive Conditioner 200ml', price: 649, img: 'c200.jpg' },
  { t: 'Anti-Grey Hair Serum 30ml', price: 899, out: true, img: 's30.jpg' },
  { t: 'Anti-Grey Hair Serum 50ml', price: 1299, out: true, img: 's50.jpg' },
  { t: 'Scalp Massager', price: 349, img: 'm.jpg' },
];
const STOCK = { id: 'x1', title: 'Pause ads for 3 sold-out products', sub: 'Ads still send people to pages they cannot buy from.', kind: 'rows',
  rows: [['Anti-Grey Hair Serum 30ml', '0 left'], ['Anti-Grey Hair Serum 50ml', '0 left'], ['Kit', '0 left']] };

test('A: a card that lists its products in rows is about those products, never another one', () => {
  assert.equal(cardProduct(STOCK, CAT, { brand: 'Acme', byNameOnly: true })?.t, 'Anti-Grey Hair Serum 30ml');
  assert.equal(draftFits({ product: 'Anti-Breakage Intensive Conditioner 15ml' }, STOCK, { catalog: CAT, brand: 'Acme' }), false, 'a conditioner draft never sits under the serum card');
  assert.equal(draftFits({ product: 'Anti-Breakage Intensive Conditioner 200ml' }, { title: 'Show the anti-frizz routine' }, { catalog: CAT, brand: 'Acme' }), false, 'one shared word ("anti") is not a fit');
  assert.equal(draftFits({ product: 'Anti-Grey Hair Serum 30ml' }, STOCK, { catalog: CAT, brand: 'Acme' }), true);
});

const { createEvidence } = await import('../evidence.js');
test('B: an account line backs a small number only when it is about what the card says', () => {
  const EV = createEvidence({ factsOf: () => ({}), movesOf: () => ({}), numsOf: () => [] });
  const ledger = { 'shopify.carts.7d': { v: 'MitoActive (473 carts), Scalp Massager (3 carts)', label: 'Abandoned carts by product' }, 'shopify.stock': { v: '3 products sold out: Anti-Grey Hair Serum 30ml, 50ml, Kit', label: 'Sold out' } };
  const e = EV.evidenceOf(STOCK, { liveLedger: ledger });
  const acct = e.items.filter((x) => x.kind === 'account');
  assert.ok(!acct.some((x) => /carts/i.test(x.value)), 'the cart line never backs a sold-out card');
  assert.ok(acct.some((x) => /sold out/i.test(x.label)), 'the stock line does');
  const big = EV.evidenceOf({ id: 'r', title: 'Your store made ₹2,40,000', sub: 'A good month.' }, { liveLedger: { 'shopify.revenue.30d': { v: '₹2,40,000', label: 'Revenue, last 30 days' } } });
  assert.ok(big.items.some((x) => x.kind === 'account'), 'an exact big number still backs its card');
});

import fs from 'node:fs';
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test('D: once Shopify is connected, stock comes from it one to one; two stock cards on the same products are one', () => {
  const fsvc = src('feed-service.js');
  assert.match(fsvc, /\(e\.kind === 'oos' \|\| e\.kind === 'back'\) && t && connOn\(t, 'shopify'\)\) return null;/, 'the page check makes no stock card once Shopify is connected');
  assert.match(fsvc, /!\(c\.liveSrc\?\.kind === 'catalog' && \/\^\(Out of stock\|Back in stock\)\$\/\.test\(\(c\.badge \|\| \[\]\)\[0\] \|\| ''\) && connOn\(t, 'shopify'\)\)/, 'a saved one steps aside');
  assert.match(fsvc, /return `one:stock:\$\{ps\.join\('\|'\)\}`/, 'the same products make one stock card, whatever made them');
});

const { usableThread } = await import('../community-gate.js');
const { copyFlags } = await import('../claims.js');
test('E: a general-chat community is never a reply target; stiff "let us" is flagged', () => {
  const now = Date.parse('2026-10-28T10:00:00Z');
  const th = { url: 'https://www.reddit.com/r/TeenIndia/comments/abc/which_gel_for_curly_hair/', title: 'Which gel for curly hair?', text: 'any suggestions?', at: '2026-10-27T10:00:00Z', comments: 40 };
  const r = usableThread(th, { now, profile: { country: 'IN' } });
  assert.equal(r.ok, false); assert.ok(r.why.some((w) => /general-chat/.test(w)));
  assert.ok(copyFlags('Curly hair is tricky, so let us share what works.').some((f) => /let us/.test(f)));
  assert.deepEqual(copyFlags('Curly hair is tricky, so let’s share what works.').filter((f) => /let us/.test(f)), []);
});

const SF = await import('../social-feed.js');
test('F: an order complaint is answered privately; a doubt about the product goes on the product page', () => {
  const sf = src('social-feed.js'), rx = src('remix.js');
  assert.match(sf, /cta: \{ label: orderIssue \? 'Reply to them privately'/);
  assert.match(rx, /'Reply to them privately': 'crm\.outreach_email'/);
  const { ORDER_ISSUE } = SF; assert.ok(ORDER_ISSUE.test('got an expired bottle and the gel was missing from my order'));
  assert.ok(!ORDER_ISSUE.test('does this serum really stop grey hair?'));
});

const { notHeadline } = await import('../drafts-bg.js');
const { teamStaticCards } = await import('../statics.js');
test('G: a headline in the picture is said once: not again in the caption, not as the card title', () => {
  assert.equal(notHeadline('light as air! Made for long days on your feet.', 'Light as Air'), 'Made for long days on your feet.');
  assert.equal(notHeadline('Made for you. LIGHT AS AIR.', 'Light as air'), 'Made for you.');
  assert.equal(notHeadline('Shop now. Light as air, every day.', 'Light as air'), 'Shop now. Light as air, every day.', 'inside a sentence it stays');
  const [, c] = teamStaticCards('acme', ['a-1'], { 'a-1': { headline: 'Fewer clumps, every wash', product: 'x' } }, { name: 'Acme', titleOf: () => 'Scalp Massager' });
  assert.equal(c.title, 'Run this ad for Scalp Massager'); assert.equal(c.headline, 'Fewer clumps, every wash');
});

/* ---------- partner mode (Arvind 28 Oct): no prices, "Our team makes it", Copy the prompt ---------- */
const MM = await import('../make-mode.js');
const { createFinalsRoutes } = await import('../finals-routes.js');
test('partner mode: staff always make, a brand\'s own people get "Our team makes it"', () => {
  const was = process.env.MAKE_MODE;
  try {
    delete process.env.MAKE_MODE; assert.equal(MM.makeModeOf('ana@brand.com'), 'paid', 'unset: the priced flow as before');
    process.env.MAKE_MODE = 'partner';
    assert.equal(MM.makeModeOf('ana@brand.com'), 'partner'); assert.equal(MM.makeModeOf(null), 'partner');
    assert.equal(MM.makeModeOf('param@joinsquareup.com'), 'paid', 'staff fulfil the asks');
    const no = MM.partnerNo(); assert.equal(no.status, 409); assert.equal(no.needsTeam, true); assert.doesNotMatch(no.error, /[$₹]|credit/i);
  } finally { if (was == null) delete process.env.MAKE_MODE; else process.env.MAKE_MODE = was; }
});
test('partner mode: a paid final is refused on the server for a partner, the prompt is free for everyone', async () => {
  const was = process.env.MAKE_MODE; process.env.MAKE_MODE = 'partner';
  try {
    const R = new Map(), on = (m, path, fn) => R.set(`${m} ${path}`, fn);
    const w = { id: 'w1', drafts: [{ id: 'd1', as: 'image', state: 'ready', title: 'Ad', visual: 'a bathroom shelf', copy: 'Fewer clumps', ratio: '4:5', image: 'gen/x.png' }] };
    let quoted = 0; const finals = { quote: async () => { quoted++; return { quoteId: 'q', credits: 3 }; }, status: async () => ({ ok: true }) };
    let who = { email: 'ana@brand.com' };
    createFinalsRoutes({ on, W: () => w, say: () => {}, meOf: () => who, slugOfT: () => 'acme', brandOfT: () => ({ name: 'Acme', catalog: [] }), finals, sloosh: { listSpaces: async () => [] } });
    const r = await R.get('POST /api/work/:wid/final/quote')({ draftId: 'd1' }, {}, { wid: 'w1' });
    assert.equal(r.needsTeam, true); assert.equal(quoted, 0, 'nothing was quoted or spent');
    who = { email: 'param@joinsquareup.com' }; await R.get('POST /api/work/:wid/final/quote')({ draftId: 'd1' }, {}, { wid: 'w1' }); assert.equal(quoted, 1, 'staff get through');
    who = { email: 'ana@brand.com' };
    const pr = await R.get('GET /api/work/:wid/final/prompt')({}, {}, { wid: 'w1' }, new URLSearchParams('draftId=d1'));
    assert.ok(pr.prompt && pr.prompt.length > 40, JSON.stringify(pr)); assert.equal(pr.size, '4:5'); assert.equal(quoted, 1, 'the prompt quotes nothing');
  } finally { if (was == null) delete process.env.MAKE_MODE; else process.env.MAKE_MODE = was; }
});
test('partner mode: the page shows no price and offers our team, the prompt and the brief', () => {
  const app = src('public/app.js'), cs = src('public/creative-stage.js'), jr = src('public/jam-room.js'), j2 = src('jam2/routes.js');
  assert.match(app, /const finalBtn = \(ch\) => \{ if \(PARTNER\(\)\) return teamBtn\(\);/);
  assert.match(app, /Our team makes it<small class="btn-free">Free for initial partners<\/small>/);
  assert.match(app, /if \(PARTNER\(\) && PAID_MAIN\.test\(main\)/, 'every priced main button becomes our team');
  assert.match(app, /'data-rx="copy-prompt"', 'copy', 'Copy the prompt'/); assert.match(app, /'Send the brief to your team'/);
  assert.match(app, /Ask our team for changes/); assert.match(cs, /Ask our team to redo it/); assert.match(cs, /Ask our team to add it/);
  assert.match(jr, /window\.LIVE\?\.makeMode !== 'partner'/);
  for (const r of ['studio/make', 'studio/slide', 'boards/:bid/render', 'boards/:bid/reshot']) assert.match(j2, new RegExp(`'/api/jam2/jams/:jid/${r.replace(/[/:]/g, (c) => `\\${c}`)}', paid\\(wrap\\(`), r);
  assert.match(src('deploy.sh'), /MAKE_MODE=\$\{MAKE_MODE:-partner\}/); assert.match(src('tools/prod-env.sh'), /MAKE_MODE=\$\{MAKE_MODE:-partner\}/);
});
