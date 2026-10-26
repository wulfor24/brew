// Every deliverable in Brew's list (data/deliverables.json, 228 on 26 Oct) can be added to any card under "+" and opens as a
// jam: a row with an action opens as that action, named as the row; a planning row is written as a family the jam already draws,
// checks and briefs, and its rules, maker and hand-off reach the brief. Free: AI_MOCK words, a bare workspace, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemix, ACTIONS } from '../remix.js';
import { familyOf, fieldsFor, ACTION_SPEC } from '../studio.js';
import { DELIVERABLES, dlOf, dlAction, dlMenu } from '../deliverables.js';
import { configureGen } from '../gen-store.js';
import { runIn } from '../brand-ctx.js';

process.env.AI_MOCK = '1';
const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', sym: '$', config: { product: { noun: 'balm' } }, seed: { brand: { name: 'Acme', host: 'acme.com' } } };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')); fs.mkdirSync(path.join(DIR, 'gen'), { recursive: true });
configureGen({ dir: path.join(DIR, 'gen'), remote: false, log: { warn() {} } });
const quiet = { warn() {}, log() {}, error() {} };
const studio = () => {
  const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, claudeTool: null, geminiImage: null, PUB: DIR, LANE_PHOTO: {}, FACTS: {}, SEED: { connectors: { meta: { name: 'Meta Ads' } }, colleagues: [] }, AGENT: { creative: 'Creative' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => true, spend: () => true, uid: (p) => `${p}_${++n}`, now: (t) => Date.now() + (t?.clock || 0), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `$${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: quiet });
  const call = (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p)); call.RMX = RMX; return call;
};
const tenant = () => ({ id: 't_1', brandId: 'acme', clock: 0, cards: new Map([['c1', { id: 'c1', title: 'Warm paws all winter', sub: 'Cold hands, sorted. One balm, every morning.', agent: 'creative', sector: 'creatives', type: 'idea', detail: { why: ['Searches for hand balm doubled this week'] } }]]), changes: {}, work: [], conn: {}, acted: new Set(), shown: {} });

test('the list is whole: 228 rows, one id each, and every row opens as an action whose family has fields', () => {
  assert.ok(DELIVERABLES.length >= 228, `${DELIVERABLES.length} rows`);
  assert.equal(new Set(DELIVERABLES.map((r) => r.id)).size, DELIVERABLES.length, 'ids are unique');
  for (const r of DELIVERABLES) { const key = dlAction(r), [a, k] = key.split('.');
    assert.ok(ACTIONS[a]?.[k], `${r.name} opens as ${key}, which exists`);
    assert.ok(fieldsFor(familyOf(key), key).length, `${r.name}: its family has fields to write`);
    if (!r.action) { assert.equal(ACTIONS[a][k].money, false, 'a planning deliverable never spends'); assert.ok(ACTIONS[a][k].manual && ACTIONS[a][k].plan); assert.match(ACTION_SPEC[k], /Rules it must meet/); } }
});

test('the "+" list leaves out what the card already has open', () => {
  const all = dlMenu(), less = dlMenu(['trial_reel']);
  assert.equal(all.length - less.length, 1); assert.ok(!less.some((x) => x.id === 'trial_reel'));
  assert.ok(all.find((x) => x.id === 'trial_reel').plan, 'a planning row is marked for the Brief tag');
});

test('"+" on any card: a planning deliverable opens as itself, writes its package, and is offered no more', async () => {
  const call = studio(), t = tenant();
  const g0 = await call('GET /api/cards/:cid/remix', {}, t, { cid: 'c1' });
  assert.ok(g0.add.length >= 228, 'the whole list is offered'); assert.ok(g0.add.some((x) => x.key === 'dl:trial_reel'));
  const r = await call('POST /api/cards/:cid/remix', { action: 'dl:trial_reel', fast: true }, t, { cid: 'c1' });
  const ch = r.changes?.[0]; assert.ok(ch, r.error || 'opened');
  assert.equal(ch.actionLabel, 'Trial reel'); assert.equal(ch.dl, 'trial_reel'); assert.equal(ch.action, dlOf('trial_reel').key); assert.equal(ch.money, false);
  assert.ok(Object.values(ch.pkg || {}).some((v) => v && (typeof v === 'string' ? v.trim() : true)), 'a package to work from');
  const g1 = await call('GET /api/cards/:cid/remix', {}, t, { cid: 'c1' });
  const pk = runIn(BRAND, () => call.RMX.packageOf(t, t.changes[ch.id])); assert.equal(pk.deliverable?.name, 'Trial reel'); assert.ok(pk.deliverable.rules && pk.deliverable.who && pk.deliverable.files && pk.deliverable.planned, 'its rules, maker and hand-off go to the brief');
  assert.ok(g1.changes.some((x) => x.id === ch.id), 'its tab is on the card'); assert.ok(!g1.add.some((x) => x.key === 'dl:trial_reel'), 'not offered twice');
});

test('with no AI writer, a planning deliverable opens on its own words, never another family\'s sample', async () => {
  const call = studio(), t = tenant();
  const r = await call('POST /api/cards/:cid/remix', { action: 'dl:whatsapp_community_plan', fast: true }, t, { cid: 'c1' });
  const pk = r.changes[0].pkg, row = dlOf('whatsapp_community_plan');
  assert.equal(pk.tool, row.platform); assert.match(pk.what, /WhatsApp Community plan/); assert.doesNotMatch(pk.verify, new RegExp(row.checks.slice(0, 12)), 'its rules go to the brief, not into How we know it worked');
  assert.doesNotMatch(JSON.stringify(pk), /Store and ad tracking|Before and after, the same number/);
});

test('a row with an action opens as that action, named as the row; an unknown one is refused', async () => {
  const call = studio(), t = tenant();
  const r = await call('POST /api/cards/:cid/remix', { action: 'dl:welcome_series', fast: true }, t, { cid: 'c1' });
  const row = dlOf('welcome_series'); assert.ok(row?.action, 'Welcome series is made by an existing action');
  assert.equal(r.changes[0].action, row.action); assert.equal(r.changes[0].actionLabel, row.name);
  const bad = await call('POST /api/cards/:cid/remix', { action: 'dl:no_such_thing' }, t, { cid: 'c1' });
  assert.ok(bad.error && !bad.changes, 'never the default piece in its place');
});
