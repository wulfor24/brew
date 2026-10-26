// One set-up per jam (26 Oct, Param: "one thing changed at one place doesn't update everywhere"): a product or a size picked in the
// set-up, on the stage or said in the chat is saved on the jam, and the header, Brew's line, the frame, Studio and the words follow.
// The words' own size picks the product's size twin ("De-Knot (200 ml)" never shows the 50 ml).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemix } from '../remix.js';
import { configureGen } from '../gen-store.js';
import { runIn } from '../brand-ctx.js';

process.env.AI_MOCK = '1';
const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', sym: '₹', config: { product: { noun: 'conditioner' } }, seed: { brand: { name: 'Acme', host: 'acme.com' } } };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'one-setup-')); fs.mkdirSync(path.join(DIR, 'gen'), { recursive: true }); configureGen({ dir: path.join(DIR, 'gen'), remote: false, log: { warn() {} } });
const CAT = [{ t: 'De-Knot Moisturising Conditioner - 50 ml', price: '₹199', img: 'dk50.png' }, { t: 'De-Knot Moisturising Conditioner - 200 ml', price: '₹449', img: 'dk200.png' }, { t: 'Scalp Massager With Silicone Bristles', price: '₹299', img: 'sm.png' }];
const quiet = { warn() {}, log() {}, error() {} };
const harness = () => { const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, catalogOf: () => CAT, claudeTool: null, mediaFake: true, PUB: DIR, LANE_PHOTO: {}, FACTS: {}, SEED: { connectors: { meta: { name: 'Meta Ads' } }, colleagues: [] }, AGENT: { creative: 'Creative' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => true, spend: () => true, uid: (p) => `${p}_${++n}`, now: () => Date.now(), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `₹${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: quiet });
  return { RMX, call: (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p)) }; };
const card = { id: 'c1', title: 'Make our version of a rival free-gift ad', sub: 'Run it on the De-Knot Moisturising Conditioner', agent: 'creative', sector: 'creatives', type: 'idea', cta: { label: 'Write the ad' }, make: { format: 'single image ad' }, detail: { why: ['A rival ran it 63 days'], how: [] } };
const tenant = () => ({ id: 't_1', brandId: 'acme', clock: 0, cards: new Map([['c1', card]]), changes: {}, work: [], conn: {}, acted: new Set(), shown: {} });
const open = async (S, t) => { const r = await S.call('POST /api/cards/:cid/remix', { fast: true }, t, { cid: 'c1' }); return t.changes[r.changes[0].id]; };

test('the words\' own size picks the product\'s size twin; a price picks it too', async () => {
  const S = harness(), t = tenant(), ch = await open(S, t);
  ch.pkg = { ...ch.pkg, imageBrief: 'A studio shot of De-Knot Moisturising Conditioner (200 ml) on white tiles.' };
  assert.equal(S.RMX.pubChange(t, ch).product.name, 'De-Knot Moisturising Conditioner - 200 ml');
  ch.pkg.imageBrief = 'De-Knot Moisturising Conditioner, now ₹199.'; assert.equal(S.RMX.pubChange(t, ch).product.name, 'De-Knot Moisturising Conditioner - 50 ml');
});

test('a pick in the set-up is the jam\'s product and size everywhere, and the chat says it once', async () => {
  const S = harness(), t = tenant(), ch = await open(S, t); ch.family = 'meta_ad';
  const r = await S.call('POST /api/changes/:chid/setup', { product: { name: 'Scalp Massager With Silicone Bristles', img: 'sm.png' }, format: '9:16' }, t, { chid: ch.id });
  assert.equal(r.change.product.name, 'Scalp Massager With Silicone Bristles'); assert.equal(ch.pkg.format, '9:16'); assert.match(r.change.setupLine, /Scalp Massager/);
  await S.call('POST /api/changes/:chid/setup', { format: '1:1' }, t, { chid: ch.id });
  assert.equal(ch.thread.filter((m) => m.setup).length, 1, 'a run of picks is one line in the chat'); assert.match(ch.thread.at(-1).text, /Square 1:1/);
  const same = await S.call('POST /api/changes/:chid/setup', { format: '1:1' }, t, { chid: ch.id }); assert.ok(same.change, 'nothing new: no new line'); assert.equal(ch.thread.filter((m) => m.setup).length, 1);
});

test('the chat moves the set-up: a product or a size said in an ask', async () => {
  const S = harness(), t = tenant(), ch = await open(S, t); ch.family = 'meta_ad';
  await S.call('POST /api/changes/:chid/iterate', { message: 'Make it for the Scalp Massager With Silicone Bristles, as a story', wait: true }, t, { chid: ch.id });
  assert.equal(ch.pick?.name, 'Scalp Massager With Silicone Bristles'); assert.equal(ch.pkg.format, '9:16');
  assert.equal(S.RMX.pubChange(t, ch).product.name, 'Scalp Massager With Silicone Bristles');
});

test('the set-up panel saves its product and size on the jam, and follows the jam when the chat moves it', () => {
  const cs = fs.readFileSync(new URL('../public/creative-stage.js', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(cs, /H\.setup\?\.\(S\.chId,/); assert.match(cs, /function follow\(ch, repaint = true\)/); assert.match(cs, /if \(!S\.made\) follow\(ch, false\)/);
  assert.match(app, /const jpSetup = async \(chId, body\) => \{ const r = await tapi\('POST', `\/api\/changes\/\$\{chId\}\/setup`/); assert.match(app, /data-jp-prod=/); assert.match(app, /data-jp-fmt=/); assert.match(app, /cs\.follow\?\.\(ch\)/);
});
