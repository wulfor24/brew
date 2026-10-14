// The refresh machinery keeps its cadence: failed reads back off (and the backoff survives a restart), and a workspace that
// was closed while its moves were rewritten or retired catches up when it loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createResearch } from '../research.js';
import { createLiveWatch, RETRY } from '../live-watch.js';
import { followMoveCards, moveVersion, moveNoOf } from '../feed-service.js';
import { wellFormed } from '../ai.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-'));
const noBucket = async () => { throw new Error('no bucket here'); };
const brand = (o = {}) => ({ slug: 'test-brand', name: 'Test', host: 'test.example', kind: 'generated', config: { rivals: [], terms: [], questions: [], ...o }, facts: {}, money: (n) => String(n), seed: { laneImg: {} } });

test('research: a source that never worked waits an hour after a failure, not the next 30-minute tick', async () => {
  const ROOT = tmp(), PUB = tmp();
  const r = createResearch({ ROOT, PUB, anthropic: null, claudeParams: () => ({}), textOf: () => '', geminiImage: async () => { throw new Error('x'); }, gToken: noBucket, clean: (s) => s, brand: brand(), log: quiet });
  assert.ok(r.due().includes('news'), 'never read: due');
  await r.refresh(['news']); // no Claude key: fails
  assert.ok(!r.due().includes('news'), 'just failed: waits');
});

test('research: a failure is saved with the snapshot, so a restart waits out the hour too', async () => {
  const ROOT = tmp(), PUB = tmp(), b = brand();
  const local = path.join(ROOT, '.research', b.slug); fs.mkdirSync(local, { recursive: true });
  // an old read of news (due again) whose last try failed ten minutes ago
  fs.writeFileSync(path.join(local, 'snapshot.json'), JSON.stringify({ news: { fetchedAt: Date.now() - 9 * 3600e3, items: [], lastError: { at: Date.now() - 10 * 60e3, msg: '402' } } }));
  const r = createResearch({ ROOT, PUB, anthropic: null, claudeParams: () => ({}), textOf: () => '', geminiImage: async () => {}, gToken: noBucket, clean: (s) => s, brand: b, log: quiet });
  process.env.RESEARCH_OFF = '1'; try { await r.start(); } finally { delete process.env.RESEARCH_OFF; r.stop(); }
  assert.ok(!r.due().includes('news'), 'failed 10 minutes ago: not yet');
  // and the failing run writes lastError into the snapshot on disk
  const r2 = createResearch({ ROOT, PUB, anthropic: null, claudeParams: () => ({}), textOf: () => '', geminiImage: async () => {}, gToken: noBucket, clean: (s) => s, brand: b, log: quiet });
  fs.writeFileSync(path.join(local, 'snapshot.json'), JSON.stringify({ news: { fetchedAt: Date.now() - 9 * 3600e3, items: [] } }));
  process.env.RESEARCH_OFF = '1'; try { await r2.start(); } finally { delete process.env.RESEARCH_OFF; r2.stop(); }
  await r2.refresh(['news']);
  const saved = JSON.parse(fs.readFileSync(path.join(local, 'snapshot.json'), 'utf8'));
  assert.ok(saved.news.lastError?.at > Date.now() - 60e3, 'the failure is on disk');
  assert.equal(saved.news.items.length, 0, 'the last good data stays');
});

test('live watch: a failed read backs off instead of paying again every 15 minutes', async () => {
  assert.ok(RETRY.visibility >= 3600e3 && RETRY.catalog >= 3600e3);
  const lw = createLiveWatch({ ROOT: tmp(), anthropic: null, claudeParams: () => ({}), textOf: () => '', gToken: noBucket, brand: brand({ catalogUrl: 'http://127.0.0.1:9/products.json' }), log: quiet });
  assert.ok(lw.due().includes('catalog'));
  await lw.refresh(['catalog']); // nothing listens on port 9: fails
  assert.ok(!lw.due().includes('catalog'), 'just failed: waits for the retry');
});

test('move cards: a rewritten move replaces its card in a workspace that was closed, a retired move steps back', () => {
  const docs = { 3: { n: 3, meta: { at: 'a' } }, 7: { n: 7, meta: { at: 'b', rewrittenAt: 'r2' } } };
  const posts = [{ id: 'm07-1', title: 'New title', rows: [['x', '1']] }];
  const cards = new Map([
    ['m03-1', { id: 'm03-1', state: 'shown', title: 'old 3' }], // no version yet: stamped, untouched
    ['m07-1', { id: 'm07-1', state: 'shown', title: 'Old title', mv: 'b', createdAt: 1 }], // rewritten while away
    ['m07-2', { id: 'm07-2', state: 'ready', title: 'gone after the rewrite', mv: 'b' }], // the rewrite made fewer cards
    ['m1004-1', { id: 'm1004-1', state: 'ready', title: 'retired cadence move' }], // its run was retired
    ['m1005-1', { id: 'm1005-1', state: 'approved', title: 'acted on' }], // retired but approved: stays
    ['m1006-1', { id: 'm1006-1', state: 'ready', title: 'private', privateOf: 1006 }], // a member's private card: not ours
    ['lv-x', { id: 'lv-x', state: 'ready' }]
  ]);
  const expired = [];
  const r = followMoveCards(cards, { docs, posts, at: 99, expire: (c) => { c.state = 'expired'; expired.push(c.id); } });
  assert.equal(cards.get('m03-1').mv, 'a'); assert.equal(cards.get('m03-1').title, 'old 3');
  assert.equal(cards.get('m07-1').title, 'New title'); assert.equal(cards.get('m07-1').createdAt, 99); assert.equal(cards.get('m07-1').mv, 'r2'); assert.equal(cards.get('m07-1').state, 'shown');
  assert.deepEqual(r.replaced, ['m07-1']);
  assert.deepEqual(expired.sort(), ['m07-2', 'm1004-1']);
  assert.equal(cards.get('m1005-1').state, 'approved'); assert.equal(cards.get('m1006-1').state, 'ready');
  // a second load changes nothing
  const again = followMoveCards(cards, { docs, posts, at: 120, expire: () => assert.fail('nothing more to expire') });
  assert.deepEqual(again, { expired: [], replaced: [] });
});

test('move cards: with no moves read (a failed read, a fresh brand) nothing is touched', () => {
  const cards = new Map([['m03-1', { id: 'm03-1', state: 'ready' }]]);
  followMoveCards(cards, { docs: {}, posts: [], expire: () => assert.fail('must not expire') });
  assert.equal(cards.get('m03-1').state, 'ready');
  assert.equal(moveNoOf('m03-1'), 3); assert.equal(moveNoOf('m1010-2'), 1010); assert.equal(moveNoOf('static-x'), null); assert.equal(moveNoOf('m00-1'), null);
  assert.equal(moveVersion({ 3: { meta: { at: 'a', rewrittenAt: 'z' } } }, 'm03-2'), 'z');
});

test('AI calls: text cut mid-emoji is made well-formed before it is sent', () => {
  const bad = 'quote \ud83d', out = wellFormed([{ role: 'user', content: [{ type: 'text', text: bad }] }]);
  assert.equal(out[0].content[0].text.isWellFormed(), true);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)));
  assert.equal(wellFormed('fine 😀'), 'fine 😀');
});
