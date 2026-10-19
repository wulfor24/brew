// CRE-15: a card whose asset is a landing page opens on a landing-page draft, in one version: a hero with the page's own words,
// three benefit blocks with the brand's product photos (the named product first), one real review quote from the read (none
// when the read has none, never made up) and one button. Built from the package and the pack, so the mock path makes it free.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemix } from '../remix.js';
import { versionsOf } from '../learn.js';
import { configureGen } from '../gen-store.js';
import { runIn } from '../brand-ctx.js';

process.env.AI_MOCK = '1';
const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', sym: '$', config: { product: { noun: 'balm' } }, seed: { brand: { name: 'Acme', host: 'acme.com' } } };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-')); fs.mkdirSync(path.join(DIR, 'gen'), { recursive: true });
configureGen({ dir: path.join(DIR, 'gen'), remote: false, log: { warn() {} } });
const cat = (quotes) => { const c = [{ t: 'Acme Balm – Night Repair', img: 'https://cdn.example/balm.jpg', imgs: ['https://cdn.example/balm.jpg'], claim: 'Softer hands by morning.' }, { t: 'Acme Scrub', img: 'https://cdn.example/scrub.jpg' }, { t: 'Acme Mist', img: 'https://cdn.example/mist.jpg' }, { t: 'Acme Gone', img: 'https://cdn.example/gone.jpg', out: true }];
  Object.defineProperty(c, 'hooks', { value: { reviewQuotes: quotes, rivalHooks: [] } }); return c; };
const studio = (catalog) => { const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  createRemix({ on, claudeTool: null, geminiImage: null, PUB: DIR, LANE_PHOTO: {}, FACTS: {}, SEED: { connectors: { shopify: { name: 'Shopify' } }, colleagues: [] }, AGENT: { storefront: 'Storefront' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => true, spend: () => true, uid: (p) => `${p}_${++n}`, now: (t) => Date.now() + (t?.clock || 0), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `$${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: { warn() {}, log() {}, error() {} }, catalogOf: () => catalog });
  return (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p)); };
const tenant = (card) => ({ id: 't_1', brandId: 'acme', clock: 0, cards: new Map([[card.id, card]]), changes: {}, work: [], conn: {}, acted: new Set(), shown: {} });
const card = (o = {}) => ({ id: 'c1', title: 'Build the Acme Balm vs hand cream landing page', sub: 'Our data shows cold hands peak in December.', agent: 'storefront', sector: 'storefront', type: 'decision', cta: { label: 'Publish the page' }, make: { format: 'page section', pieces: 'A landing page for the Acme Balm' }, detail: { why: ['Searches doubled'], how: ['Create the page'] }, ...o });

test('a landing-page card opens on a landing page: hero, three benefit blocks with photos, the real quote, one button', async () => {
  const call = studio(cat(['My hands stopped cracking in a week.'])), t = tenant(card());
  const r = await call('POST /api/cards/:cid/remix', { fast: true }, t, { cid: 'c1' }); const id = r.changes[0].id, ch = t.changes[id];
  assert.equal(ch.action, 'storefront.page_copy', 'the card’s button opens what it did before (the mapping is untouched)');
  const L = (await call('GET /api/changes/:chid', {}, t, { chid: id })).change.pkg.landing;
  assert.ok(L?.hero, 'a hero'); assert.equal(L.benefits.length, 3); assert.equal(L.benefits[0].img, 'https://cdn.example/balm.jpg', 'the named product first');
  assert.ok(L.benefits.every((b) => b.img && b.title), 'each block has a photo and a title'); assert.ok(!L.benefits.some((b) => /Gone/.test(b.title)), 'never a sold-out product');
  assert.deepEqual(L.quote, { text: 'My hands stopped cracking in a week.', who: 'A customer review' }); assert.ok(L.cta);
  assert.ok(!/Our data shows/.test(L.sub), 'the hero never carries the card’s analysis');
  assert.ok(versionsOf(t, id).length >= 1 && versionsOf(t, id).length <= 2, 'one version, never options');
});

test('no review in the read: no quote block (never made up); a plain page section stays a page section', async () => {
  const call = studio(cat([])), t = tenant(card());
  const r = await call('POST /api/cards/:cid/remix', { fast: true }, t, { cid: 'c1' }); const L = (await call('GET /api/changes/:chid', {}, t, { chid: r.changes[0].id })).change.pkg.landing;
  assert.equal(L.quote, null);
  const t2 = tenant(card({ title: 'Add a size guide to the product page', make: { format: 'page section', pieces: 'A size guide block' } }));
  const r2 = await call('POST /api/cards/:cid/remix', { fast: true }, t2, { cid: 'c1' });
  assert.equal((await call('GET /api/changes/:chid', {}, t2, { chid: r2.changes[0].id })).change.pkg.landing, undefined);
});
