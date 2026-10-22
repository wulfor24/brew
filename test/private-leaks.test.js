// The team's real numbers stay with the team (22 Oct, after Arata connected Meta): a visitor's request never sees the live ledger
// another request left on the workspace and never takes the team's cards out of it; plain-word rewrites of team-only cards go to
// private/plain.json; the demo copy drops the team's run state, pages and rewrites and keeps a canary; disconnecting drops the
// sign-in and every pending one, hides the moves written from it and brings them back on reconnect; a first read that failed is
// tried again; Sync now reads once per 10 minutes. Free: no network, no AI.
process.env.BUILD_RESUME_OFF = '1'; process.env.DEMO_MODE = '';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
const { createMemberCtx } = await import('../member-ctx.js');
const { createPlain, plainKey } = await import('../plain.js');
const { createConnectors } = await import('../connectors/index.js');
const { createVault } = await import('../vault.js');

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the live ledger is per request: a visitor mid-way through never sees the team’s numbers, and none are saved', async () => {
  const MC = createMemberCtx({ defaultBrand: 'arata-in' }), t = MC.guard({ id: 't1', brandId: 'arata-in', liveLedger: { 'meta.cpa': { v: '₹780' } } });
  assert.deepEqual(t.liveLedger, {}, 'a workspace saved with the team’s numbers on it loses them');
  const ana = { member: true, email: 'ana@arata.in', slug: 'arata-in' }, visitor = { member: false, email: null, slug: 'arata-in' };
  let seen = null;
  const pAna = MC.run(ana, t, async () => { t.liveLedger = { 'meta.cpa': { v: '₹780', n: 780 } }; t.privMoves = [9]; await sleep(20); return [t.liveLedger['meta.cpa']?.v, t.privMoves]; });
  await MC.run(visitor, t, async () => { await sleep(5); seen = [t.liveLedger, t.privMoves, t.liveConn]; });
  assert.deepEqual(seen, [{}, [], {}], 'the visitor’s request starts empty while ana’s is in flight');
  assert.deepEqual(await pAna, ['₹780', [9]]);
  const saved = JSON.parse(JSON.stringify(t)); for (const k of ['liveLedger', 'liveConn', 'privMoves', 'privStatics', 'claimed']) assert.ok(!(k in saved), `${k} is never saved`);
  assert.deepEqual(t.liveLedger, {}, 'off a request, nothing a request read is left behind');
});

test('plain words: a team-only card’s rewrite (its real numbers) goes to private/plain.json, never the shared file', async () => {
  const files = {}, store = { getJSON: async (s, f) => files[`${s}/${f}`] || {}, put: async (s, f, v) => { files[`${s}/${f}`] = JSON.parse(JSON.stringify(v)); } };
  const pub = { id: 'm02-1', title: 'Lead with the serum', sub: 'It sells most.', detail: { why: ['It sells'], how: ['Lead with it'] } };
  const priv = { id: 'live-meta-shift', liveOnly: true, title: 'Move ₹578 a day to Campaign B', sub: 'B returned 2.7x and A 1.3x.', detail: { why: ['Returns differ'], how: ['Move it tomorrow'] } };
  const ai = async (_p) => ({ cards: [{ id: 'm02-1', title: 'Lead with the serum', sub: 'It sells the most.', why: ['It sells'], how: ['Lead with it'], because: 'Brew suggests this because it sells.' },
    { id: 'live-meta-shift', title: 'Move ₹578 a day to Campaign B', sub: 'B returned 2.7x and A 1.3x.', why: ['Returns differ'], how: ['Move it tomorrow'], because: 'Brew suggests this because B returned 2.7x.' }] });
  const P = createPlain({ ai, store });
  assert.ok(P.queue('b1', [pub, priv], 'B1')); while (P.busy('b1')) await sleep(5);
  assert.ok(files['b1/plain.json'][plainKey(pub)]); assert.ok(!files['b1/plain.json'][plainKey(priv)], 'the shared file has no team-only card');
  assert.ok(files['b1/private/plain.json'][plainKey(priv)], 'the team’s file has it');
  assert.ok(!JSON.stringify(files['b1/plain.json']).includes('578'));
  const P2 = createPlain({ ai, store }); await P2.load('b1'); await P2.load('b1', true);
  assert.equal(P2.apply('b1', priv).because, 'Brew suggests this because B returned 2.7x.', 'a member’s view finds it again');
});

test('demo copy: run state, reasons, the team’s pages and rewrites go; the canary lists the team’s numbers and campaigns', () => {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-strip-')), w = (f, x) => { fs.mkdirSync(path.dirname(path.join(D, f)), { recursive: true }); fs.writeFileSync(path.join(D, f), JSON.stringify(x)); };
  const priv = { id: 'm09-1-p', title: 'Prove ₹780 per purchase', sub: 'From Meta.', detail: { why: [], how: [] } }, pub = { id: 'm09-1', title: 'Prove the 2.2%', sub: 'From the read.', detail: { why: [], how: [] } };
  w('updates.json', { auto: true, stale: { 9: { n: 9, private: true, why: 'it can now use ₹780' }, 4: { n: 4, why: 'price moved' } }, connectDone: { at: 1, n: 53 }, queue: [{ via: 'connected' }], pot: { usd: 3 }, history: [{ at: 2, private: true, because: 'it can now use ₹780' }, { at: 1, because: 'The read changed' }] });
  w('pages.json', { 'm09-1|Prove the 2.2%': { lead: 'ok' }, 'live-meta-shift|Move': { lead: '₹578' }, 'm09-1-p|Prove': { lead: '₹780' }, 'm21-1|Ads': { lead: 'baseline ₹780' } });
  w('seed.json', { posts: [{ id: 'm09-1', sector: 'storefront2' }, { id: 'm21-1', sector: 'ads' }] });
  w('plain.json', { [plainKey(pub)]: { title: 'ok' }, [plainKey(priv)]: { title: '₹780' } });
  w('private-cards.json', [priv]);
  w('private-ledger.json', [{ key: 'meta.cpa', v: '₹780', method: 'account:meta' }, { key: 'meta.spend.30d', v: '₹50.3 L', method: 'account:meta' }]);
  w('private-live/meta.json', { cards: [{ id: 'live-meta-shift', rows: [['From', 'BCA3.0 MitoActive · 1.3x'], ['To', 'Mito-Preorder · 2.7x']] }], ledger: [] });
  const out = JSON.parse(execFileSync(process.execPath, [path.resolve('tools/demo-strip.mjs'), D], { encoding: 'utf8' }));
  const u = JSON.parse(fs.readFileSync(path.join(D, 'updates.json'), 'utf8'));
  assert.ok(!u.connectDone && !u.queue && !u.pot); assert.deepEqual(Object.keys(u.stale), ['4']); assert.equal(u.history.length, 1); assert.equal(u.history[0].because, null);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(D, 'pages.json'), 'utf8'))), ['m09-1|Prove the 2.2%'], 'team cards and a baselined ads page go');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(D, 'plain.json'), 'utf8'))), [plainKey(pub)]);
  const canary = fs.readFileSync(path.join(D, 'canary.txt'), 'utf8').split('\n').filter(Boolean);
  for (const x of ['₹780', '₹50.3 L', 'BCA3.0 MitoActive', 'Mito-Preorder']) assert.ok(canary.includes(x), x);
  assert.equal(out.canary, canary.length);
  const sh = fs.readFileSync('tools/demo-sync.sh', 'utf8');
  assert.match(sh, /demo-strip\.mjs/); assert.match(sh, /grep -F -f "\$W\/canary\.txt"/); assert.match(sh, /rsync -r "\$SRC\/\$slug" "\$W\/src" --exclude='\.\*\/\?\(private\|memory\|spend\|demo\)/, 'gen/ is found from public JSON only'); assert.match(sh, /--exclude='\^raw\//, 'the canary skips scraped pages');
});

/* ---------- connectors: disconnect, reconnect, retry, Sync now ---------- */
const memPacks = (brands = []) => { const D = new Map(), k = (s, n) => `${s}/${n}`;
  return { D, getJSON: async (s, n, d = null) => (D.has(k(s, n)) ? JSON.parse(D.get(k(s, n))) : d), async put(s, n, o) { D.set(k(s, n), typeof o === 'string' ? o : JSON.stringify(o)); },
    listFiles: async (s, sub) => [...D.keys()].filter((x) => x.startsWith(`${s}/${sub}/`)).map((x) => x.slice(`${s}/${sub}/`.length)).filter((x) => !x.includes('/')),
    list: async () => brands.map((slug) => ({ slug })) }; };
const rig = async (conn = {}) => {
  const P = memPacks(['cozy']), seen = [];
  await P.put('cozy', 'profile.json', { name: 'Cozy', host: 'cozy.shop', currency: 'USD', country: 'US' });
  await P.put('cozy', 'private/connections.json', { meta: { state: 'live', lastSync: Date.now() - 3600e3, verified: true, account: { id: 'act_1', name: 'Cozy ads' }, ...conn } });
  await P.put('cozy', 'private/live/meta.json', { at: Date.now() - 3600e3, cards: [{ id: 'live-meta-shift', liveOnly: true, title: 'Move $5 a day', rows: [] }], ledger: [{ key: 'meta.cpa', v: '$9', n: 9, method: 'account:meta' }] });
  await P.put('cozy', 'private/moves.json', { 21: { n: 21, title: 'Team move', meta: { connectedWith: ['meta'] } }, 4: { n: 4, title: 'Old private', meta: {} } });
  await P.put('cozy', 'private/cards.json', [{ id: 'm21-1', privateOf: 21, title: 'Team card' }, { id: 'm04-1', privateOf: 4, title: 'Old card' }]);
  const auth = { claimInfo: async () => ({ host: 'cozy.shop', role: 'owner', gen: true }), user: () => ({ email: 'ana@cozy.shop' }), signinOn: () => true, isAdmin: () => false, getMembers: async () => ({ members: [] }), mail: async () => true };
  const C = createConnectors({ packs: P, auth, builder: { liveConnected: async (...a) => seen.push(a), staleConnected: async () => {} }, log: quiet });
  const V = createVault(P); await V.save('cozy', 'meta', { token: 'tok', account: '1', exp: null, expChecked: 1 }); await V.save('cozy', 'meta-pending-abc123', { creds: { token: 'p' }, email: 'ana@cozy.shop', at: Date.now() });
  return { P, C, V, seen };
};
const post = (C, slug, id, body) => { const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b || ''; } };
  const req = Object.assign(Readable.from([JSON.stringify(body)]), { method: 'POST', headers: { host: 'x.test' } });
  return C.handle(req, res, new URL(`http://x.test/api/brands/${slug}/connect/${id}`)).then(() => JSON.parse(res.body || '{}')); };

test('disconnect drops the sign-in and every pending one; moves written from it wait hidden and come back on reconnect', async () => {
  const { P, C, V } = await rig();
  const before = await C.forViewer('cozy', true);
  assert.ok(before.cards.some((c) => c.id === 'm21-1-p')); assert.ok(before.cards.some((c) => c.id === 'm04-1-p'));
  assert.match(before.cards.find((c) => c.id === 'live-meta-shift').time, /^(\d+ (min|h|d)|just now)$/, 'the connector card says when it was read');
  await C.disconnect('cozy', 'meta');
  assert.equal(await V.load('cozy', 'meta'), null); assert.equal(await V.load('cozy', 'meta-pending-abc123'), null, 'a sign-in waiting to be picked goes too');
  const after = await C.forViewer('cozy', true);
  assert.ok(!after.cards.some((c) => c.id === 'm21-1-p'), 'the move written from Meta waits'); assert.ok(after.cards.some((c) => c.id === 'm04-1-p'), 'one written before connectedWith stays');
  assert.deepEqual(after.privMoves, [4], 'the shared Move 21 shows again');
  assert.deepEqual(await C.connectedIds('cozy'), []);
  /* reconnect: the same private move is back, nothing rewritten */
  const cs = await P.getJSON('cozy', 'private/connections.json'); cs.meta = { state: 'live', lastSync: Date.now(), verified: true }; await P.put('cozy', 'private/connections.json', cs);
  await P.put('cozy', 'private/live/meta.json', { at: Date.now(), cards: [], ledger: [] }); C.drop('cozy');
  assert.ok((await C.forViewer('cozy', true)).cards.some((c) => c.id === 'm21-1-p'));
});

test('a first read that failed is tried again once its wait has passed; Sync now reads once per 10 minutes', async () => {
  const { C, P } = await rig({ state: 'error', lastSync: null, error: 'meta ads 500', retryAt: Date.now() - 1000 });
  let reads = 0; const f0 = globalThis.fetch; globalThis.fetch = async () => { reads++; throw new Error('offline'); };
  try { await C.tick(); } finally { globalThis.fetch = f0; }
  assert.ok(reads > 0, 'the tick read it again'); assert.ok((await P.getJSON('cozy', 'private/connections.json')).meta.retryAt > Date.now(), 'and set the next wait');
  const { C: C2 } = await rig({ lastSync: Date.now() - 2 * 60e3 });
  const r = await post(C2, 'cozy', 'meta', { action: 'sync' });
  assert.equal(r.recent, true); assert.match(r.note, /Read 2 min ago\. You can read it again in 8 min/);
});

test('feed-service guards stay in place (pins: no test builds the whole feed service)', () => {
  const src = fs.readFileSync('feed-service.js', 'utf8');
  assert.match(src, /const measure = measureOf\(null, c\)/, 'a shared card page never carries the team’s baseline');
  assert.match(src, /if \(isPrivateCard\(c\)\) return privPageOf\(t, c\);/, 'a team-only card’s page is built apart');
  assert.match(src, /keepPage\(key, pg, 'private\/pages\.json'\)/);
  assert.match(src, /isPrivateCard\(c\) && !t\.member\)\)\) \{ send\(res, 404/, 'its routes are not found outside the team');
  assert.match(src, /if \(jamPrivate\(t, w\) && !t\.member\)/, 'the handoff page of a jam on the team’s numbers needs a member');
  assert.match(src, /if \(t\.member\) for \(const \[id, c\] of t\.cards\) if \(\(c\.liveOnly \|\| c\.publicLive\)/, 'only a member’s view drops the team’s cards');
  assert.match(src, /if \(!L\) return;/, 'a failed live read changes nothing');
  assert.match(src, /MC\.run\(\{ member, email: member \?/, 'a Slack reply is answered as the person who wrote it');
  assert.match(fs.readFileSync('server.js', 'utf8'), /builder\.updates\(slug, \{ member: !!v\.member \}\)/, 'an unclaimed brand’s visitors are not the team');
});

test('a card from a real connected account is never tagged Dummy; a simulated one is', async () => {
  const src = fs.readFileSync('public/app.js', 'utf8'), m = src.match(/const dummyCard = (\(p\) => [^\n]+);/); assert.ok(m, 'one rule for the Dummy tag');
  const dummyCard = eval(m[1]);
  assert.equal(dummyCard({ id: 'live-meta-shift', onlyWhen: 'meta', liveOnly: true }), false, 'Arata’s real budget card');
  assert.equal(dummyCard({ id: 'live-meta-shift', onlyWhen: 'meta', liveOnly: true, dummy: true }), true, 'a simulated account’s card (demo site)');
  assert.equal(dummyCard({ id: 'm21-1-p', privateOf: 21, liveOnly: true }), false); assert.equal(dummyCard({ id: 'sample', onlyWhen: 'shopify' }), true, 'a pack’s sample card');
  assert.equal(dummyCard({ id: 'm21-1' }), false); assert.equal((src.match(/is-dummy' : ''/g) || []).filter((x) => x).length >= 2, true);
  assert.ok(!/p\.onlyWhen \|\| \/\^live-\/\.test\(p\.id\) \? ' is-dummy'/.test(src), 'the old rule (every live card Dummy) is gone');
});
