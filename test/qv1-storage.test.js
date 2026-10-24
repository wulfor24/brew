// QV round 1 (storage): each finding pinned so it can't come back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPg } from './pg-helper.js';

const quiet = { log() {}, warn() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('on the bucket (STORAGE unset) every workspace save reaches the bucket, not only the first', async () => {
  const saved = new Map(), real = globalThis.fetch; let puts = 0;
  globalThis.fetch = async (u, o = {}) => { const s = String(u); const name = decodeURIComponent((/[?&]name=([^&]+)/.exec(s) || /\/o\/([^?]+)/.exec(s))[1]);
    if (o.method === 'POST') { puts++; saved.set(name, Buffer.from(o.body).toString()); return new Response('{}'); } return saved.has(name) ? new Response(saved.get(name)) : new Response('nf', { status: 404 }); };
  try {
    const { createObjects } = await import('../objects.js'), { createStore } = await import('../store.js');
    const O = createObjects({ bucket: 'b', gToken: async () => 't', pg: false, log: quiet });
    const st = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'qv1-')), objects: O, log: quiet });
    const t = { id: 't_cc01', brandId: 'zz', n: 1 }; await st.write(t); await st.readFresh('t_cc01');
    t.n = 2; await st.write(t); t.n = 3; await st.write(t);
    assert.equal(puts, 3); assert.equal(JSON.parse(saved.get('tenants/t_cc01.json')).n, 3);
  } finally { globalThis.fetch = real; }
});

test('parts join in any order: a collection header never empties entries already read; undefined values and __proto__ keys are safe', async () => {
  const { splitDoc, joinDoc } = await import('../objects.js');
  const doc = { a: 1, cards: { __m: Array.from({ length: 30 }, (_, i) => [`c${i}`, { t: 'x'.repeat(2000), i }]) }, objs: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, { v: 'y'.repeat(2000) }])), gone: undefined };
  const parts = splitDoc(doc); assert.ok(!parts.some(([p]) => p === 'gone'));
  const rows = parts.map(([part, body], ord) => ({ part, ord, body: Buffer.from(body) }));
  for (const order of [rows, [...rows].reverse(), [...rows].sort(() => Math.random() - 0.5)]) {
    const back = joinDoc(order.filter((r) => r.part.startsWith('cards')).length ? order : order);
    assert.equal(back.cards.__m.length, 30); assert.equal(Object.keys(back.objs).length, 25); assert.equal(back.a, 1); }
  const evil = joinDoc([{ part: '__proto__', body: Buffer.from('{"polluted":true}') }]);
  assert.equal(({}).polluted, undefined); assert.deepEqual(Object.keys(evil), ['__proto__']);
});

const url = startPg();
const skip = !url && 'no Postgres on this machine';
let db, O, mkPacks, mkStore;
test('Postgres group', { skip }, async (t) => {
  process.env.STORAGE = 'pg'; process.env.DATABASE_URL = url; delete process.env.K_SERVICE;
  db = await import('../db/index.js'); await (await import('../db/migrate.js')).migrate({ log: quiet });
  O = await import('../objects.js');
  const { createPacks } = await import('../brand-pack.js'), { createStore } = await import('../store.js');
  mkPacks = () => createPacks({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'qv1p-')), PUB: path.resolve('public'), objects: O.createObjects({ log: quiet }), log: quiet });
  mkStore = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'qv1t-')), objects: O.createObjects({ log: quiet }), log: quiet });

  await t.test('a workspace whose earlier field shrinks keeps every card the user acted on', async () => {
    const st = mkStore();
    const w = { id: 't_dd02', brandId: 'zz', big: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, 'z'.repeat(2000)])), cards: new Map(Array.from({ length: 25 }, (_, i) => [`c${i}`, { t: 'x'.repeat(2000) }])) };
    await st.write(w); const a = await st.readFresh('t_dd02');
    a.big = { k0: 'small' }; a.cards.get('c0').acted = true; a.cards.get('c1').acted = true; await st.write(a);
    const back = await mkStore().readFresh('t_dd02');
    assert.equal(back.cards.size, 25); assert.ok(back.cards.get('c0').acted && back.cards.get('c1').acted);
    assert.deepEqual([...back.cards.keys()], [...w.cards.keys()], 'order kept');
  });

  await t.test('jams: an edit made while another instance’s change is pulled in is still saved; a jam removed here never comes back', async () => {
    const { createJams } = await import('../jams.js');
    const jA = createJams({ packs: mkPacks(), log: quiet, everyMs: 0 }), jB = createJams({ packs: mkPacks(), log: quiet, everyMs: 0 });
    const a = await jA.load('zz-qv1'), b = await jB.load('zz-qv1');
    a.work.push({ id: 'w1', n: 0 }, { id: 'w2', n: 0 }); await jA.flush(); await sleep(400);
    a.work.find((w) => w.id === 'w1').n = 1;                      /* A edits, unsaved */
    b.work.find((w) => w.id === 'w2').n = 5; await jB.flush();    /* B saves: A pulls */
    await sleep(400); await jA.flush(); await sleep(400);
    const stored = JSON.parse((await O.createObjects({ log: quiet }).get('brands/zz-qv1/private/jams.json')).toString());
    assert.equal(stored.work.find((w) => w.id === 'w1').n, 1, 'A’s edit was saved'); assert.equal(stored.work.find((w) => w.id === 'w2').n, 5);
    a.work.splice(a.work.findIndex((w) => w.id === 'w2'), 1); /* removed on A, then B writes something else before A saves */
    b.work.find((w) => w.id === 'w1').note = 'x'; await jB.flush(); await sleep(400); await jA.flush(); await sleep(400);
    assert.ok(!a.work.some((w) => w.id === 'w2'), 'the removed jam stays removed on A');
    assert.ok(!b.work.some((w) => w.id === 'w2'), 'and is gone on B');
  });

  await t.test('a database read that fails is an error, never "not there"', async () => {
    const packs = mkPacks(); await packs.put('zz-err', 'status.json', { ok: 1 });
    const realQ = db.q; /* break the next reads */
    const o2 = O.createObjects({ log: quiet }); const orig = o2.get; o2.get = async () => { throw new Error('pool timeout'); }; o2.getV = async () => { throw new Error('pool timeout'); };
    const { createPacks } = await import('../brand-pack.js');
    const p2 = createPacks({ ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'qv1e-')), PUB: path.resolve('public'), objects: o2, log: quiet });
    await assert.rejects(p2.get('zz-err', 'status.json'), /pool timeout/); void realQ; void orig;
  });
  await db.close();
});
