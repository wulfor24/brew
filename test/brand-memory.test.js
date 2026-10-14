// node --test test/  — brand memory (brand-memory.js), free: no AI, no network. A scripted AI stands in for the
// mem0 decision step so ADD / UPDATE / DELETE / NONE are checked exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrandMemory, memoryHooks, memberKey, topicOf } from '../brand-memory.js';
import { setMemoryHooks, addLesson, promptBlock, memoryBlockAsync } from '../learn.js';

// an in-memory brand pack store with the same calls brand-pack.js offers (getJSON / put / assetFile)
const fakePacks = (seed = {}) => {
  const files = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return { files, getJSON: async (slug, name, d = null) => (files.has(`${slug}/${name}`) ? JSON.parse(files.get(`${slug}/${name}`)) : d),
    put: async (slug, name, data) => { files.set(`${slug}/${name}`, typeof data === 'string' ? data : JSON.stringify(data)); }, assetFile: async () => null };
};
const fixtureDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'memory');
const PROFILE = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'profile.json'), 'utf8'));
const BRIEF = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'brief.json'), 'utf8'));
const quiet = { warn: () => {}, info: () => {}, log: () => {} };
const brand = () => fakePacks({ 'acme-com/profile.json': PROFILE, 'acme-com/brief.json': BRIEF, 'acme-com/config.json': { banned: '\\b(miracle\\w*|guaranteed results|cure[sd]?)\\b' } });

test('every memory needs a source, and scopes are checked', async () => {
  const M = createBrandMemory({ packs: fakePacks(), log: quiet });
  await assert.rejects(() => M.add('acme-com', 'They never show discounts'), /source/);
  await assert.rejects(() => M.add('acme-com', 'I like short briefs', { scope: 'member', source: 'note' }), /memberId/);
  await assert.rejects(() => M.add('acme-com', 'x', { scope: 'team', source: 'note' }), /scope/);
});

test('without AI: notes become facts, the same note again is a confirmation, not a new line', async () => {
  const P = fakePacks(), M = createBrandMemory({ packs: P, log: quiet });
  const r1 = await M.add('acme-com', 'Never show a discount in ads', { source: { kind: 'note', label: 'founder note' } });
  assert.equal(r1.added.length, 1); assert.equal(r1.added[0].topic, 'rules');
  const r2 = await M.add('acme-com', 'never show a discount in ads.', { source: 'second note' });
  assert.equal(r2.added.length, 0); assert.equal(r2.same.length, 1);
  const { facts, files, log } = await M.repo('acme-com');
  assert.equal(facts.length, 1); assert.equal(facts[0].n, 2); assert.equal(facts[0].sources.length, 2);
  assert.match(files['brand/rules.md'], /Never show a discount in ads \[source: founder note \(\+1 more\); added: .*seen: 2; id: m_/);
  assert.match(files['MEMORY.md'], /\[\[brand\/rules.md\]\]/);
  assert.equal(log[0].op, 'ADD');
  // persisted the way packs persist (local + GCS behind): state, vectors and the readable repo
  assert.ok(P.files.has('acme-com/memory/state.json')); assert.ok(P.files.has('acme-com/memory/repo/brand/rules.md')); assert.ok(P.files.has('acme-com/memory/repo/LOG.md'));
});

test('learnFromLive without AI: counted facts from the pack, each with its source; a second read updates, not duplicates', async () => {
  const P = brand(); const M = createBrandMemory({ packs: P, log: quiet });
  const r = await M.learnFromLive('acme-com');
  assert.ok(r.added >= 10, `added ${r.added}`); assert.equal(r.ai, false);
  const { facts, files } = await M.repo('acme-com');
  assert.ok(facts.every((f) => f.source?.label), 'every fact has a source');
  const price = facts.find((f) => f.key === 'live.ads.price'); assert.match(price.text, /Price is in the hook of 2 of 3 live ads/);
  assert.match(facts.find((f) => f.key === 'live.ads.formats').text, /2 video, 1 image/);
  assert.match(facts.find((f) => f.key === 'live.catalog.range').text, /prices 40 to 120 USD/);
  assert.match(facts.find((f) => f.key === 'live.rules.banned').text, /miracle, guaranteed results, cure/);
  assert.match(files['brand/creative-style.md'], /Meta Ad Library, read 2026-10-01/);
  // the brand changes: a new read with one more priced ad updates that line in place and logs the diff
  PROFILE.ads.own.items.push({ id: '4', hook: '$60 | New drop', body: 'x', format: 'image', days: 1, cta: 'Shop now' });
  P.files.set('acme-com/profile.json', JSON.stringify(PROFILE));
  const r2 = await M.learnFromLive('acme-com');
  assert.equal(r2.added, 0); assert.ok(r2.updated >= 2); PROFILE.ads.own.items.pop();
  const { facts: f2, log } = await M.repo('acme-com');
  assert.equal(f2.filter((f) => f.key === 'live.ads.price').length, 1);
  const up = log.find((x) => x.op === 'UPDATE' && /hook of 3 of 4/.test(x.after)); assert.ok(up); assert.match(up.before, /2 of 3/);
});

test('mem0 decisions: ADD, UPDATE, DELETE and NONE from the AI are applied to the right lines and logged', async () => {
  const P = fakePacks(); const calls = [];
  const ai = { live: true, meter: { usd: 0 }, call: async (o) => { calls.push(o.tag);
    if (o.tag === 'memory-extract') return { json: { facts: o.prompt.includes('Video ads') ? [{ text: 'They stopped running video ads', topic: 'creative-style', personal: false }, { text: 'Headlines are under six words', topic: 'voice', personal: false }, { text: 'Ads show the shoe on feet, outdoors', topic: 'creative-style', personal: false }, { text: 'The founder writes in lower case', topic: 'voice', personal: false }] : [{ text: o.prompt.match(/"""\n([\s\S]*?)\n"""/)[1], topic: topicOf(o.prompt), personal: false }] } };
    if (o.tag === 'memory-decide') { const olds = JSON.parse(o.prompt.match(/Existing memories:\n(.*)\n/)[1]); const id = (re) => olds.find((x) => re.test(x.text))?.id;
      return { json: { memory: [{ event: 'DELETE', id: id(/video ads/), new: '0', text: '', topic: 'creative-style' }, { event: 'UPDATE', id: id(/Headlines are short/), new: '1', text: 'Headlines are short, under six words', topic: 'voice' }, { event: 'NONE', id: id(/on feet/), new: '2', text: '', topic: 'creative-style' }, { event: 'ADD', id: '', new: '3', text: 'The founder writes in lower case', topic: 'voice' }] } }; }
    throw new Error('unexpected ' + o.tag); } };
  const M = createBrandMemory({ ai, packs: P, log: quiet, autoLearn: false });
  for (const t of ['They run video ads every week', 'Headlines are short', 'Ads show the shoe on feet outdoors']) await M.add('acme-com', t, { source: 'seed note', infer: false });
  const r = await M.add('acme-com', 'Video ads paused. Headlines: under six words. On-feet outdoor shots. Founder writes lower case.', { source: { kind: 'note', label: 'call notes' } });
  assert.deepEqual(calls.filter((x) => x === 'memory-decide').length, 1);
  assert.equal(r.deleted.length, 1); assert.match(r.deleted[0].text, /video ads every week/);
  assert.equal(r.updated.length, 1); assert.equal(r.updated[0].text, 'Headlines are short, under six words');
  assert.equal(r.same.length, 1);
  assert.ok(r.added.some((f) => f.text === 'The founder writes in lower case'));
  assert.ok(r.added.some((f) => f.text === 'They stopped running video ads'), 'the contradicting fact replaces the deleted one');
  const { log, facts } = await M.repo('acme-com');
  assert.ok(log.find((x) => x.op === 'DELETE' && /contradicted by/.test(x.why)));
  assert.ok(log.find((x) => x.op === 'UPDATE' && x.before === 'Headlines are short'));
  assert.equal(facts.find((f) => /on feet/.test(f.text)).n, 2);
});

test('scopes: a member’s preferences are theirs alone; brand facts are shared; search finds by words without embeddings', async () => {
  const M = createBrandMemory({ packs: fakePacks(), log: quiet });
  const a = memberKey('Ana@Acme.com'), b = memberKey('bo@acme.com');
  assert.equal(a, memberKey('ana@acme.com '));
  await M.add('acme-com', 'Hero product is the Trail Runner in moss green', { source: 'note', infer: false });
  await M.add('acme-com', 'I want every brief to end with a dated checklist', { scope: 'member', memberId: a, source: 'Ana', infer: false });
  await M.add('acme-com', 'Run 1 is testing a moss green hook', { scope: 'run', runId: 'jam1', source: 'jam', infer: false });
  assert.equal((await M.repo('acme-com', { memberId: a })).facts.length, 2);
  assert.equal((await M.repo('acme-com', { memberId: b })).facts.length, 1);
  assert.ok(!(await M.repo('acme-com', { memberId: b })).files[`members/${a}.md`]);
  const hits = await M.search('acme-com', 'moss green trail runner', { memberId: b, runId: 'jam1' });
  assert.equal(hits[0].topic, 'products'); assert.equal(hits.length, 2);
  const block = await M.promptBlock('acme-com', { memberId: a, name: 'Acme' });
  assert.match(block, /Brand memory for Acme/); assert.match(block, /dated checklist/);
  assert.doesNotMatch(await M.promptBlock('acme-com', { memberId: b }), /dated checklist/);
  const f = (await M.repo('acme-com', { memberId: a })).facts.find((x) => x.scope === 'member');
  assert.equal((await M.forget('acme-com', f.id, { memberId: b })).ok, false);
  assert.equal((await M.forget('acme-com', f.id, { memberId: a })).ok, true);
});

test('consolidate merges exact duplicates and keeps topics capped', async () => {
  const P = fakePacks(), M = createBrandMemory({ packs: P, log: quiet });
  await M.add('acme-com', 'Ads lead with the product on feet', { source: 'a', infer: false });
  const c = await M.load('acme-com'); const f0 = c.state.facts[0];
  c.state.facts.push({ ...f0, id: 'm_dup0000001', sources: [{ label: 'b' }] });
  for (let i = 0; i < 35; i++) c.state.facts.push({ ...f0, id: `m_${String(i).padStart(10, '0')}`, text: `Filler line ${i} about colour`, hash: `h${i}`, topic: 'creative-style', key: null, n: 1 });
  const r = await M.consolidate('acme-com');
  assert.equal(r.merged, 1);
  assert.ok((await M.repo('acme-com')).facts.filter((x) => x.topic === 'creative-style').length <= 30);
});

test('learn.js hook: lessons and learned rules reach brand memory; prompts carry the memory block; off means unchanged', async () => {
  const P = brand(), M = createBrandMemory({ packs: P, log: quiet });
  await M.learnFromLive('acme-com');
  const t = { brandId: 'acme-com', memberEmail: 'ana@acme.com' };
  assert.equal(promptBlock(t, 'creative'), '', 'no hook: prompts unchanged');
  setMemoryHooks(memoryHooks(M, { nameOf: () => 'Acme' }));
  try {
    promptBlock(t, 'creative'); await new Promise((r) => setTimeout(r, 20)); // first call warms the cache
    const pb = promptBlock(t, 'creative');
    assert.match(pb, /Brand memory for Acme/); assert.match(pb, /Rules \(never break these\)/); assert.match(pb, /Price is in the hook/);
    assert.match(await memoryBlockAsync(t, 'creative', 'price in the hook'), /Price is in the hook/);
    addLesson(t, { kind: 'brand', text: 'Founder-shot reels beat studio statics on CTR here', step: 'the result came in', title: 'Reel test', measured: { metric: 'CTR', before: '0.9%', after: '1.4%', change: '+56%', win: true } });
    addLesson(t, { kind: 'you', text: 'You like plans with dated milestones', step: 'decided' });
    await new Promise((r) => setTimeout(r, 50));
    const { facts } = await M.repo('acme-com', { memberId: memberKey('ana@acme.com') });
    const win = facts.find((f) => /Founder-shot reels/.test(f.text)); assert.ok(win); assert.equal(win.topic, 'what-works'); assert.equal(win.source.kind, 'result'); assert.match(win.text, /CTR: 0.9% → 1.4%/);
    const mine = facts.find((f) => /dated milestones/.test(f.text)); assert.equal(mine.scope, 'member');
    assert.equal((await M.repo('acme-com', { memberId: memberKey('bo@acme.com') })).facts.some((f) => /dated milestones/.test(f.text)), false);
  } finally { setMemoryHooks(null); }
  assert.doesNotMatch(promptBlock(t, 'creative'), /Brand memory/, 'hook off: only the tenant’s own learning, as before');
});

test('memory routes: read, add, forget, and the team-only rule on a claimed brand', async () => {
  const { createMemoryRoutes } = await import('../memory-routes.js');
  const M = createBrandMemory({ packs: fakePacks(), log: quiet }); let viewer = { member: true, claimed: true, email: 'ana@acme.com' }, body = {};
  const R = createMemoryRoutes({ memory: M, viewerOf: async () => viewer, readBody: async () => body, send: (res, code, b) => { res.code = code; res.body = b; } });
  const call = async (method, p) => { const res = {}; const hit = await R({ method }, res, new URL(p, 'http://x')); return hit ? res : null; };
  assert.equal(await call('GET', '/api/brands/acme-com/status'), null);
  body = { text: 'Never name rivals in our ads' }; const a = await call('POST', '/api/brands/acme-com/memory'); assert.equal(a.body.added.length, 1);
  const g = await call('GET', '/api/brands/acme-com/memory'); assert.equal(g.body.facts.length, 1); assert.ok(g.body.files['MEMORY.md']);
  assert.equal((await call('GET', '/api/brands/acme-com/memory?q=rivals')).body.results.length, 1);
  viewer = { member: false, claimed: true, email: 'x@y.com' }; assert.equal((await call('POST', '/api/brands/acme-com/memory')).code, 403);
  viewer = { member: true, claimed: true, email: 'ana@acme.com' }; const d = await call('DELETE', `/api/brands/acme-com/memory/${a.body.added[0].id}`); assert.equal(d.body.ok, true);
});
