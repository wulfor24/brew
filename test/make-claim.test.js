// One paid make per board (26 Oct): two teammates (or two tabs) pressing Make on two instances inside the jam's sync gap
// both used to pay. A make claims its board (and its press) first, all or none; the loser gets the board's busy answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AI_MOCK = '1';
const { mountJam2 } = await import('../jam2/routes.js');
const { claimMake, makeKeys, _resetMakeClaims } = await import('../jam2/make-claim.js');
const G = await import('../gen-store.js');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-')); G.configureGen({ dir: DIR, remote: false, log: { warn() {} } });
const quiet = { warn() {}, log() {}, error() {} };

/* one web instance: its own route table and busy marks; the jams file is shared (the Postgres doc every instance reads) */
const mount = (mem) => {
  const R = {}, on = (m, p, fn) => (R[`${m} ${p}`] = fn), landed = [];
  const packs = { getJSON: async (s, f, d) => (mem.has(`${s}/${f}`) ? structuredClone(mem.get(`${s}/${f}`)) : d), putJSON: async (s, f, v) => { mem.set(`${s}/${f}`, structuredClone(v)); return true; }, put: async (s, f, v) => { mem.set(`${s}/${f}`, structuredClone(v)); return true; } };
  const card = { id: 'c1', title: 'Listing photos', cta: { label: 'Add the photos' } }, t = { id: 't1', brandId: 'acme', cards: new Map([['c1', card]]), changes: { ch1: { id: 'ch1' } }, work: [] };
  mountJam2({ on, packs, slugOfT: () => 'acme', brandOfT: () => ({ catalog: [{ t: 'Balm', img: 'balm.png' }], config: {} }), meOf: () => ({ email: 'a@acme.com' }), reqOf: () => ({ member: true }), cardOf: (tt, id) => tt.cards.get(id), sourceOf: () => '', refsOf: async () => [], isMock: () => true, spend: () => true, saveGen: G.saveGen, genFile: G.genFile, log: quiet,
    onStudioTake: (tt, chId, tk) => landed.push(tk.id) });
  return { R, t, landed };
};
const until = async (R, t, jid, bid) => { for (let k = 0; k < 300; k++) { const g = await R['GET /api/jam2/jams/:jid']({}, t, { jid }); const b = g.jam.busy?.[bid]; if (!b || b.error) return g; await new Promise((r) => setTimeout(r, 100)); } throw new Error('still busy'); };

test('a claim is all or none, held until let go, and a press key runs once', async () => {
  _resetMakeClaims();
  const a = await claimMake(makeKeys('acme', 'j1', 'b1', 'p1')); assert.ok(a);
  assert.equal(await claimMake(makeKeys('acme', 'j1', 'b1', 'p2')), null, 'the board is being made');
  assert.equal(await claimMake(makeKeys('acme', 'j1', 'b2', 'p1')), null, 'the same press on another board: all or none');
  assert.ok(await claimMake(makeKeys('acme', 'j1', 'b2', 'p3')), 'another board is free');
  await a.release();
  assert.equal(await claimMake(makeKeys('acme', 'j1', 'b1', 'p1')), null, 'the press already ran');
  assert.ok(await claimMake(makeKeys('acme', 'j1', 'b1', 'p4')), 'a new press on the board, once the make ended');
  _resetMakeClaims();
});

test('two Make presses on two instances at once: one pays, the other is told the board is being made', { timeout: 120e3 }, async () => {
  _resetMakeClaims();
  const mem = new Map(), A = mount(mem);
  const o = await A.R['POST /api/jam2/open']({ cardId: 'c1', cta: 'Add the photos', v1ch: 'ch1' }, A.t, {}); const jid = o.jam.id, bid = o.jam.boards[0].id;
  for (let k = 0; k < 50 && !mem.get('acme/private/jams-v2.json')?.jams?.[jid]; k++) await new Promise((r) => setTimeout(r, 100));
  const B = mount(mem); /* the second instance: it reads the jam before A's busy mark reaches it */
  const d = await A.R['GET /api/jam2/jams/:jid/studio']({}, A.t, { jid }, new URLSearchParams(`bid=${bid}`)); const spec = { ...d.defaults, set: ['mp-lifestyle', 'in-use', 'closeup'] }; /* a set: one board, made in mock */
  const pl = (await A.R['POST /api/jam2/jams/:jid/studio/plan']({ spec }, A.t, { jid })).plan; assert.ok(!pl.error, pl.error);
  const [ra, rb] = await Promise.all([A.R['POST /api/jam2/jams/:jid/studio/make']({ spec, confirmUsd: pl.usd, bid, press: 'press-a' }, A.t, { jid }), B.R['POST /api/jam2/jams/:jid/studio/make']({ spec, confirmUsd: pl.usd, bid, press: 'press-b' }, B.t, { jid })]);
  const won = [ra, rb].filter((r) => !r.error), lost = [ra, rb].filter((r) => r.error);
  assert.equal(won.length, 1, JSON.stringify([ra.error, rb.error])); assert.match(lost[0].error, /still being made/); assert.equal(lost[0].busy, true);
  const W = ra.error ? B : A; const g = await until(W.R, W.t, jid, bid);
  assert.equal(g.jam.busy?.[bid]?.error, undefined, g.jam.busy?.[bid]?.error);
  assert.equal(A.landed.length + B.landed.length, 1, 'one take made, one paid');
  /* the same press sent again (a retry from either instance) never makes twice; a new press on the board works once it ended */
  const again = await B.R['POST /api/jam2/jams/:jid/studio/make']({ spec, confirmUsd: pl.usd, bid, redo: true, press: ra.error ? 'press-b' : 'press-a' }, B.t, { jid }); assert.match(again.error || '', /still being made/);
  for (let k = 0; k < 50 && (await claimMake(makeKeys('acme', jid, bid, null)).then((c) => (c ? (c.release(), false) : true))); k++) await new Promise((r) => setTimeout(r, 100)); /* the run let its board go */
  const next = await A.R['POST /api/jam2/jams/:jid/studio/make']({ spec, confirmUsd: pl.usd, bid, redo: true, press: 'press-c' }, A.t, { jid }); assert.ok(!next.error, next.error);
  await until(A.R, A.t, jid, bid); _resetMakeClaims();
});

/* the Postgres claim (STORAGE=pg): many presses at once from separate connections, one wins; a let-go board is free again.
   Runs against a throwaway database: MAKE_CLAIM_PG_URL=postgres://… (skipped without one) */
test('Postgres: twenty presses at once on one board, exactly one claim', { skip: !process.env.MAKE_CLAIM_PG_URL }, async () => {
  process.env.DATABASE_URL = process.env.MAKE_CLAIM_PG_URL; process.env.PG_POOL_MAX = '20';
  const { migrate } = await import('../db/migrate.js'), { q, close } = await import('../db/index.js');
  try { await migrate({ log: quiet }); await q("DELETE FROM make_claims WHERE key LIKE '%:pgtest:%'");
    const got = await Promise.all(Array.from({ length: 20 }, (_, i) => claimMake(makeKeys('acme', 'pgtest', 'b1', `pgtest:${i}`), { pg: true })));
    const won = got.filter(Boolean); assert.equal(won.length, 1);
    assert.equal((await q("SELECT count(*)::int n FROM make_claims WHERE key LIKE 'press:acme:pgtest:%'")).rows[0].n, 1, 'the losers left no press behind');
    await won[0].release(); assert.equal(await claimMake(makeKeys('acme', 'pgtest', 'b1', `pgtest:${got.findIndex(Boolean)}`), { pg: true }), null, 'the same press never runs twice');
    const next = await claimMake(makeKeys('acme', 'pgtest', 'b1', 'pgtest:new'), { pg: true }); assert.ok(next, 'the board is free once let go'); await next.release();
    await q("UPDATE make_claims SET until = now() - interval '1 second' WHERE key = 'board:acme:pgtest:b2'"); assert.ok(await claimMake(makeKeys('acme', 'pgtest', 'b2', null), { pg: true }));
    await q("UPDATE make_claims SET until = now() - interval '1 second' WHERE key = 'board:acme:pgtest:b2'"); assert.ok(await claimMake(makeKeys('acme', 'pgtest', 'b2', null), { pg: true }), 'a claim that ran out (a crashed instance) is taken over');
  } finally { await q("DELETE FROM make_claims WHERE key LIKE '%:pgtest:%'").catch(() => {}); await close(); }
});
