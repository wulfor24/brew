// The weekly move-rewrite pot (rewrite-pot.js): one budget a brand a week, drawn in order (learnings > events > the site
// check's high flags > connected accounts > low and weekly flags > new moves), each kind only down to its share, what the
// pot doesn't cover waiting for next week; costs per move on today's model. Free: no AI, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { flagKind, potFit, potOf, potLeft, potAdd, perMove, runKind, nextWeek, weekKey, EST, capOf } from '../rewrite-pot.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

test('flag kinds: who raised the flag and how much it matters', () => {
  assert.equal(flagKind({ via: 'stock', stock: true, priority: 'high' }), 'event');
  assert.equal(flagKind({ via: 'learnings', impact: 'high', weekly: true }), 'learnings', 'a learnings move that waited for the pot keeps its place');
  assert.equal(flagKind({ via: 'learnings', impact: 'low' }), 'low');
  assert.equal(flagKind({ src: 'event', priority: 'high' }), 'event');
  assert.equal(flagKind({ priority: 'high' }), 'check', 'the site check, a fresh reload');
  assert.equal(flagKind({ priority: 'medium' }), 'low', "the check's medium flags");
  assert.equal(flagKind({ via: 'facts', priority: 'high' }), 'check');
  assert.equal(flagKind({ via: 'shopify', live: true, real: true, priority: 'medium' }), 'live');
  assert.equal(flagKind({ via: 'facts-connected', priority: 'high' }), 'live');
  assert.equal(runKind('learnings'), 'learnings'); assert.equal(runKind('connected', true), 'live'); assert.equal(runKind(null, true), 'check');
  assert.equal(runKind(null, false), null, 'a manual rewrite is not drawn from the pot'); assert.equal(runKind('manual'), null); assert.equal(runKind('learnings-all'), null);
});

test('potFit: best kind first, each kind only down to its share, the rest waits', () => {
  const items = [{ n: 9, kind: 'new' }, { n: 6, kind: 'low', at: 1 }, { n: 4, kind: 'live', at: 1 }, { n: 5, kind: 'check', at: 2 }, { n: 3, kind: 'learnings', at: 9 }, { n: 2, kind: 'event', at: 5, top: true }];
  const { now } = potFit({ usd: 0 }, 2, 0.1, items);
  assert.deepEqual(now.map((x) => x.n), [2, 3, 5, 4, 6, 9], 'a roomy pot covers all, out of stock first');
  const tight = potFit({ usd: 0 }, 0.45, 0.1, items);
  assert.deepEqual(tight.now.map((x) => x.n), [2, 3, 5], 'stock, learnings, the check');
  assert.deepEqual(tight.wait.map((x) => x.n).sort(), [4, 6, 9], 'connector, low and new moves wait');
  const spent = potFit({ usd: 0.9 }, 1, 0.1, items);
  assert.deepEqual(spent.now.map((x) => x.n), [3], 'late in the week only what the team said still fits');
  assert.equal(potLeft({ usd: 0.3 }, 1, 'new'), 0.2); assert.equal(potLeft({ usd: 0.9 }, 1, 'live'), 0);
});

test('the pot is per week: a new week starts empty; next week starts on Monday', () => {
  const now = Date.UTC(2026, 9, 16, 12), u = { pot: { week: weekKey(now), usd: 3, by: { live: 3 }, waits: { 4: 'live' } } };
  assert.equal(potOf(u, now).usd, 3);
  assert.equal(potOf(u, now + 7 * 864e5).usd, 0, 'next week');
  assert.equal(new Date(nextWeek(now)).toISOString(), '2026-10-19T00:00:00.000Z');
  const p = potAdd(potOf({}, now), 'event', 0.25); potAdd(p, 'event', 0.25); assert.equal(p.usd, 0.5); assert.equal(p.by.event, 0.5);
});

test('cost per move matches the provider: the brand’s own moves on today’s model, else an estimate', () => {
  assert.equal(perMove({ moves: [], provider: 'gemini' }), EST.gemini);
  assert.equal(perMove({ moves: [], provider: 'anthropic' }), EST.anthropic);
  assert.ok(EST.anthropic / EST.gemini >= 5, 'Flash is about a sixth of Opus');
  const flash = Array.from({ length: 8 }, () => ({ meta: { model: 'gemini-3.5-flash', usd: 0.06 } })), opus = Array.from({ length: 8 }, () => ({ meta: { model: 'claude-opus-5-5', usd: 0.9 } }));
  assert.equal(perMove({ moves: [...flash, ...opus], model: 'gemini-3.5-flash', provider: 'gemini' }), 0.09, 'Opus-era moves never price a Flash rewrite');
  assert.equal(perMove({ moves: flash.slice(0, 3), model: 'gemini-3.5-flash', provider: 'gemini' }), EST.gemini, 'too few to go on');
  assert.equal(capOf({ BRAND_WEEK_CAP_USD: '45' }, 'gemini'), 45); assert.ok(capOf({}, 'anthropic') >= 40 && capOf({}, 'anthropic') <= 60); assert.ok(capOf({}, 'gemini') < capOf({}, 'anthropic'));
  /* the deep model on Pro (GEMINI_DEEP_MODEL=gemini-3.1-pro-preview): the estimate and the pot grow with it, so a brand's rewrites don't stop after a dozen moves */
  const pro = { GEMINI_DEEP_MODEL: 'gemini-3.1-pro-preview' };
  assert.ok(perMove({ moves: [], provider: 'gemini', env: pro }) >= 3 * EST.gemini, 'a Pro move is priced well above a Flash one');
  assert.ok(capOf(pro, 'gemini') >= 3 * capOf({}, 'gemini') && capOf(pro, 'gemini') <= capOf({}, 'anthropic'), 'the Pro pot sits between Flash and Opus');
  assert.equal(capOf({ GEMINI_DEEP_MODEL: 'gemini-3.5-flash' }, 'gemini'), capOf({}, 'gemini'));
  assert.equal(capOf(pro, 'anthropic'), capOf({}, 'anthropic'), 'the Gemini model never changes the Anthropic pot');
});

/* a brand with written moves; each move the mock engine writes costs $0.1 and stops when the run may not spend */
async function brand({ cap = '0.45' } = {}) {
  process.env.BRAND_WEEK_CAP_USD = cap; process.env.AI_PROVIDER = 'gemini';
  const { createPacks } = await import('../brand-pack.js'); const { createBuilder } = await import('../build.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-pot-'));
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = 'acme-com', runs = [], NS = [1, 2, 3, 4, 5, 6, 7, 8]; let spend = () => {};
  await P.put(slug, 'status.json', { slug, name: 'Acme', done: true, ready: true, state: 'Ready' });
  await P.put(slug, 'profile.json', { name: 'Acme', host: 'acme.com', catalog: { products: [] } });
  await P.put(slug, 'ledger.json', []);
  await P.put(slug, 'brief.json', { name: 'Acme', goal: 'To confirm', at: '2026-10-01' });
  await P.put(slug, 'moves.json', Object.fromEntries(NS.map((n) => [n, { n, title: `Move ${n}`, meta: { at: 'a' } }])));
  const moves = { SPECS: NS.map((n) => ({ n })), createMovesEngine: () => ({ runAll: async (ctx, { only }) => { runs.push(only); for (const n of only) { if (!ctx.canSpend()) break; spend('move', 0.1); await ctx.save(n, { n, title: `Rewritten ${n}`, meta: {} }); } } }) };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge(f) { spend = f; } }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves, pdf: null } });
  return { b, P, slug, runs };
}
const STALE = {
  2: { n: 2, priority: 'high', via: 'stock', stock: true, stockWhy: { x: 'X is out of stock.' }, why: 'X is out of stock.', at: 5 },
  3: { n: 3, priority: 'high', via: 'learnings', impact: 'high', weekly: true, why: 'What the team told us.', at: 9 },
  4: { n: 4, priority: 'medium', via: 'shopify', live: true, real: true, why: 'Shopify moved.', at: 1 },
  5: { n: 5, priority: 'high', via: 'facts', why: 'The fact sheet changed.', at: 2 },
  6: { n: 6, priority: 'medium', why: 'The site check: worth a look.', at: 1 },
  7: { n: 7, priority: 'medium', via: 'connected', live: true, real: true, why: 'The first-connect run.', at: 1 },
  8: { n: 8, priority: 'medium', via: 'meta', demo: true, why: 'A demo account.', at: 1 },
};

test('the weekly run takes every flag kind in order, as far as the pot goes; the rest waits for next week', async () => {
  const { b, P, slug, runs } = await brand();
  await P.put(slug, 'updates.json', { stale: STALE });
  const r = await b.liveWeekly(slug); await settle();
  assert.equal(r.ok, true);
  assert.deepEqual(r.ns, [2, 3, 5], 'out of stock, then learnings, then the fact sheet; never the connect run or a demo account');
  assert.deepEqual(r.wait.sort(), [4, 6]);
  assert.deepEqual(runs.at(-1), [2, 3, 5, 0]);
  const u = await P.getJSON(slug, 'updates.json');
  assert.deepEqual(Object.keys(u.stale).map(Number).sort(), [4, 6, 7, 8], 'the rewritten moves lose their flags; the waiting ones keep theirs');
  assert.ok(Math.abs(u.pot.usd - 0.4) < 1e-9, 'three moves and the index drew $0.40'); assert.ok(u.pot.by.event > 0);
  assert.deepEqual(u.pot.waits, { 4: 'live', 6: 'low' });
  const up = await b.updates(slug);
  assert.deepEqual(up.pot, { spent: 0.4, cap: 0.45, waiting: 2, est: EST.gemini }, 'the Updates page: spent this week, what waits');
  assert.equal(up.estMove, EST.gemini, 'the estimate follows the provider, not the Opus-era $0.6');

  /* next week: the pot is fresh, and what waited is rewritten first */
  await P.put(slug, 'updates.json', { ...u, liveRun: { at: 0 }, pot: { ...u.pot, week: '2020-W01' } });
  const r2 = await b.liveWeekly(slug); await settle();
  assert.deepEqual(r2.ns, [4, 6]); assert.deepEqual(r2.wait, []);
  const u2 = await P.getJSON(slug, 'updates.json');
  assert.deepEqual(Object.keys(u2.stale).map(Number).sort(), [7, 8], 'the connect run and the demo account were never taken'); assert.deepEqual(u2.pot.waits, {});
});

test('a spent pot holds the run: nothing is written and the flags stay; a manual rewrite is not drawn', async () => {
  const { b, P, slug, runs } = await brand();
  await P.put(slug, 'updates.json', { stale: { 6: STALE[6] }, pot: { week: weekKey(Date.now()), usd: 0.4, by: { event: 0.4 }, waits: {} } });
  const r = await b.liveWeekly(slug); await settle();
  assert.equal(r.skipped, 'pot'); assert.equal(runs.length, 0);
  assert.ok((await P.getJSON(slug, 'updates.json')).stale[6], 'the flag stays for next week');
  assert.equal((await b.updates(slug)).pot.waiting, 1);
  const m = await b.rewrite(slug, [6]); await settle();
  assert.equal(m.ok, true); assert.deepEqual(runs.at(-1), [6], 'you asked: it runs, outside the pot');
  assert.ok(Math.abs((await P.getJSON(slug, 'updates.json')).pot.usd - 0.4) < 1e-9, 'and the pot is unchanged');
});

test('a run the pot stops halfway keeps the rest flagged and waiting', async () => {
  const { b, P, slug, runs } = await brand({ cap: '0.15' });
  await P.put(slug, 'updates.json', { stale: { 3: STALE[3], 5: { ...STALE[5], via: 'learnings', impact: 'high' }, 6: { ...STALE[6], via: 'learnings', impact: 'medium' } } });
  await b.rewrite(slug, [3, 5, 6], { via: 'learnings' }); await settle();
  assert.equal(runs.at(-1).length, 4);
  const u = await P.getJSON(slug, 'updates.json');
  assert.ok(Math.abs(u.pot.usd - 0.2) < 1e-9, 'it stops once the pot is spent (one move over at most)');
  const left = Object.keys(u.stale).map(Number);
  assert.ok(left.length >= 1, 'what it did not write keeps its flag'); for (const n of left) assert.equal(u.pot.waits[n], 'learnings');
});
