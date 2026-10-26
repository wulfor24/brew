// QV 26 Oct, jam page: saved jams heal on read (remix.js pubChange and evaluate), for every brand and every kind of piece: the
// ₹ sign and paise, "None" beats, split bullets, an invented order value, step dates, the checklist's title and product, the
// account change's product, an invented review quote, a Fix it version's name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemix } from '../remix.js';
import { configureGen } from '../gen-store.js';
import { runIn } from '../brand-ctx.js';
import { whoOf, DELIVERABLES, dlMenu } from '../deliverables.js';

process.env.AI_MOCK = '1';
const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', config: { product: { noun: 'shoe' }, currency: 'INR' }, seed: { brand: { name: 'Acme', host: 'acme.com' } } };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-words-')); fs.mkdirSync(path.join(DIR, 'gen'), { recursive: true }); configureGen({ dir: path.join(DIR, 'gen'), remote: false, log: { warn() {} } });
const CAT = [{ t: 'Motorsport Neo Cat Sneakers', price: '₹3,599', img: 'neo.png' }, { t: 'Motorsport Voltra Sneakers', price: '₹4,999', img: 'voltra.png', out: true }, { t: 'Hoops Basketball Jersey', price: '₹1,999', img: 'jersey.png', out: true }, { t: 'Creatine Monohydrate', price: '₹999', img: 'cr.png' }];
const quiet = { warn() {}, log() {}, error() {} };
const harness = () => { const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, catalogOf: () => CAT, claudeTool: null, mediaFake: true, PUB: DIR, LANE_PHOTO: {}, FACTS: {}, SEED: { connectors: { meta: { name: 'Meta Ads' } }, colleagues: [] }, AGENT: { creative: 'Creative' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => true, spend: () => true, uid: (p) => `${p}_${++n}`, now: () => Date.now(), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `₹${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: quiet });
  return { RMX, call: (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p)), run: (fn) => runIn(BRAND, fn) }; };
const card = { id: 'c1', title: 'Pause ads on sold-out shoes', sub: 'Motorsport Neo Cat Sneakers are selling; two products are sold out', agent: 'creative', sector: 'creatives', type: 'idea', cta: { label: 'Write the ad' }, make: { format: 'single image ad' }, detail: { why: ['Two products sold out'], how: [] } };
const tenant = () => ({ id: 't_1', brandId: 'acme', clock: 0, cards: new Map([['c1', card]]), changes: {}, work: [], conn: {}, acted: new Set(), shown: {} });
const open = async (S, t) => { const r = await S.call('POST /api/cards/:cid/remix', { fast: true }, t, { cid: 'c1' }); return t.changes[r.changes[0].id]; };

test('a saved post heals on read: the ₹ sign, whole rupees; a flow message loses its invented order value', async () => {
  const S = harness(), t = tenant(), ch = await open(S, t);
  ch.family = 'post'; ch.action = 'creative.linkedin_post'; ch.pkg = { platform: 'LinkedIn', copy: 'We launched the combo for ‑‑2,182.15, and it sold.' };
  const pub = S.run(() => S.RMX.pubChange(t, ch)); assert.equal(pub.pkg.copy, 'We launched the combo for ₹2,182, and it sold.'); assert.equal(ch.pkg.copy, pub.pkg.copy, 'healed for good, not just shown');
  ch.family = 'crm'; ch.action = 'crm.flow_copy'; ch.pkg = { channel: 'Email', flow: 'Cart recovery', segment: 'Cart abandoners', subject: 'Still thinking?', message: 'Hi {first_name},\n\nYour order of ₹6,500 qualifies for free shipping, since it is above ₹650.' };
  assert.equal(S.run(() => S.RMX.pubChange(t, ch)).pkg.message, 'Hi {first_name},\n\nYour order qualifies for free shipping when it is above ₹650.');
});

test('an account change names the products its rows pause, never the card\'s lead product; its rows say "Ads for"', async () => {
  const S = harness(), t = tenant(), ch = await open(S, t);
  Object.assign(ch, { family: 'meta_ops', action: 'performance.pause_pointing', actionLabel: 'Pause ads on sold-out products', target: { conn: 'meta', name: 'Meta Ads', object: 'Ads on sold-out products' } });
  ch.pkg = { summary: 'Pause Meta ads for the Voltra Sneakers and the Hoops Jersey.', items: [{ name: 'Motorsport Voltra Sneakers', now: 'Running', next: 'Paused' }, { name: 'Hoops Basketball Jersey', now: 'Running', next: 'Paused' }] };
  const pub = S.run(() => S.RMX.pubChange(t, ch)); assert.equal(pub.layout, 'acct'); assert.equal(pub.product.name, 'Motorsport Voltra Sneakers and 1 more');
  ch.pkg.items = ch.pkg.items.slice(0, 1); assert.equal(S.run(() => S.RMX.pubChange(t, ch)).product.name, 'Motorsport Voltra Sneakers');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'); assert.ok(app.includes("? 'Campaign' : 'Ads for')"));
});

test('a checklist: titled by its heading, shows a product only when it names one, dates ahead of today', async () => {
  const S = harness(), t = tenant(), ch = await open(S, t);
  Object.assign(ch, { family: 'setup', action: 'performance.tracking_fix', actionLabel: 'Fix tracking', target: { conn: 'meta', name: 'Meta Ads Manager' }, createdAt: Date.now() - 4 * 864e5 });
  ch.pkg = { tool: 'Meta Ads Manager', what: 'Campaign Naming Standard\nWe standardise all 52 live ads to one lowercase template. It closes gaps.\n\nThe Template Format\nutm_campaign = [concern]_[date]', steps: ['Export the ad URLs by 2020-01-02', 'Replace the parameters'], verify: 'Clicks log the new names' };
  const pub = S.run(() => S.RMX.pubChange(t, ch)); assert.equal(pub.layout, 'check'); assert.equal(pub.product, null, 'a UTM plan is about no product');
  assert.equal(pub.docTitle, 'Campaign Naming Standard'); assert.match(pub.docLede, /^We standardise all 52 live ads/); assert.match(pub.setupLine, /^\*\*Campaign Naming Standard\*\*: 2 steps/);
  assert.doesNotMatch(pub.pkg.steps[0], /20\d\d-\d\d-\d\d/); assert.match(pub.pkg.steps[0], /by (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/); assert.equal(ch.pkg.steps[0], 'Export the ad URLs by 2020-01-02', 'the saved plan keeps its own date');
  Object.assign(ch, { family: 'decision', action: 'brew.plan', actionLabel: 'Save it as the team plan' }); assert.equal(S.run(() => S.RMX.pubChange(t, ch)).kind, 'Team plan');
});

test('a made-up review quote fails the check; a real one passes', async () => {
  const S = harness(), t = tenant(), ch = await open(S, t);
  Object.assign(ch, { family: 'crm', action: 'crm.paid_broadcast', actionLabel: 'WhatsApp broadcast' }); ch.pkg = { channel: 'WhatsApp', segment: 'Past buyers', message: 'Our community’s verdict:\n"Saw an incredible reduction in hair fall in just over 3 weeks. Phenomenal product"', buttons: ['Shop'] };
  const r = (await S.call('GET /api/changes/:chid', {}, t, { chid: ch.id })).change, bad = (r.checks || []).find((x) => x.quote);
  assert.ok(bad && !bad.ok, 'an invented testimonial is flagged'); assert.match(bad.k, /A review none of your customers wrote/);
  ch.pkg = { ...ch.pkg, message: 'Our community’s verdict:\n“Lovely shoes”' }; const ok = (await S.call('GET /api/changes/:chid', {}, t, { chid: ch.id })).change; assert.ok(!(ok.checks || []).some((x) => x.quote), 'a short quoted phrase is no testimonial');
});

test('who makes a planning deliverable reads as a sentence; IG reads Instagram; the ids stay', () => {
  assert.equal(whoOf('Designer'), 'your designer'); assert.equal(whoOf('Social / CRM (ManyChat)'), 'your social or CRM team'); assert.equal(whoOf('AR studio'), 'your AR studio'); assert.equal(whoOf('Whoever the brief names'), 'whoever the brief names');
  const ig = DELIVERABLES.find((r) => r.id === 'ig_feed_post'); assert.equal(ig.name, 'Instagram feed post'); assert.ok(!dlMenu([]).some((x) => /^IG\b/.test(x.label)));
});
