// node --test test/voice-pick.test.js — the voice the team picks in setup (POST /api/brands/:slug/voice → brand-memory.js
// saveVoicePick): one keyed fact that updates in place, printed first in every prompt block, with or without a query. Free.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBrandMemory, saveVoicePick, VOICE_KEY, VOICE_LINE, VOICES } from '../brand-memory.js';

const fakePacks = () => { const files = new Map();
  return { files, getJSON: async (slug, name, d = null) => (files.has(`${slug}/${name}`) ? JSON.parse(files.get(`${slug}/${name}`)) : d),
    put: async (slug, name, data) => { files.set(`${slug}/${name}`, typeof data === 'string' ? data : JSON.stringify(data)); }, assetFile: async () => null }; };
const quiet = { warn: () => {}, info: () => {}, log: () => {} };
const member = { member: true, email: 'ana@acme.com' };

test('the voice lines: one per voice, the site one says it follows the site as Brew read it', () => {
  assert.deepEqual(VOICES, ['site', 'warmer', 'sharper', 'plainer']);
  assert.equal(VOICE_LINE.site, 'Voice: like the site, as we read it');
  for (const v of ['warmer', 'sharper', 'plainer']) assert.match(VOICE_LINE[v], new RegExp(`^Voice: ${v} than the site\\. \\S`), v);
});

test('only the team sets the voice: 401 signed out, 403 signed in outside it; a bad voice and memory off are refused', async () => {
  const M = createBrandMemory({ packs: fakePacks(), log: quiet });
  assert.equal((await saveVoicePick(M, 'acme-com', 'warmer', { who: null })).status, 401);
  assert.equal((await saveVoicePick(M, 'acme-com', 'warmer', { who: { member: false, email: 'bo@gmail.com' } })).status, 403);
  assert.equal((await saveVoicePick(M, 'acme-com', 'warmer', { who: { member: false, email: null } })).status, 401);
  const bad = await saveVoicePick(M, 'acme-com', 'shouty', { who: member }); assert.equal(bad.status, 400); assert.match(bad.error, /site, warmer, sharper, plainer/);
  assert.equal((await saveVoicePick(M, 'acme-com', undefined, { who: member })).status, 400);
  const off = await saveVoicePick(null, 'acme-com', 'warmer', { who: member }); assert.equal(off.off, true); assert.match(off.error, /off/);
  assert.equal((await M.repo('acme-com')).facts.length, 0, 'nothing was saved');
  assert.equal((await saveVoicePick(M, 'acme-com', 'plainer', { demo: true })).ok, true, 'the demo site takes it, like the brand memory');
});

test('a new pick replaces the old one in place: one voice.pick fact, logged as an update', async () => {
  const M = createBrandMemory({ packs: fakePacks(), log: quiet });
  const a = await saveVoicePick(M, 'acme-com', 'warmer', { who: member }); assert.equal(a.ok, true); assert.equal(a.added, 1);
  const b = await saveVoicePick(M, 'acme-com', 'sharper', { who: member }); assert.equal(b.updated, 1); assert.equal(b.added, 0);
  const c = await saveVoicePick(M, 'acme-com', 'sharper', { who: member }); assert.equal(c.added + c.updated, 0, 'the same pick again is a confirmation');
  const { facts, log } = await M.repo('acme-com'); const vp = facts.filter((f) => f.key === VOICE_KEY);
  assert.equal(vp.length, 1); assert.equal(vp[0].text, VOICE_LINE.sharper); assert.equal(vp[0].topic, 'voice'); assert.equal(vp[0].scope, 'brand');
  assert.match(vp[0].source.label, /voice picked in setup by team member mb_/); assert.doesNotMatch(vp[0].source.label, /ana@/, 'no email in the memory');
  assert.deepEqual(log.filter((x) => x.factId === vp[0].id).map((x) => x.op).reverse(), ['ADD', 'UPDATE']);
});

test('the pick is first in every prompt block, with a query, without one, and from the cache, and only once', async () => {
  const M = createBrandMemory({ packs: fakePacks(), log: quiet, autoLearn: false });
  await M.add('acme-com', 'Never show a discount in ads', { source: 'founder note' });
  await M.add('acme-com', 'The site says "cozy" a lot and never uses emoji', { topic: 'voice', source: 'site read' });
  for (let i = 0; i < 25; i++) await M.add('acme-com', `Product line ${i} sells best in the winter months near ${i}0 degrees`, { topic: 'products', source: `catalog ${i}` });
  await saveVoicePick(M, 'acme-com', 'plainer', { who: member });
  const hits = await M.search('acme-com', 'winter product line sells best', { k: 16 });
  assert.ok(!hits.some((h) => h.text === VOICE_LINE.plainer), 'the search alone would leave the pick out: the block keeps it on purpose');
  const blocks = [await M.promptBlock('acme-com', {}), await M.promptBlock('acme-com', { query: 'winter product line sells best' }), await M.promptBlock('acme-com', { query: 'zzz unrelated words', agent: 'creative' }), M.blockSync('acme-com', { agent: 'crm' })];
  for (const [i, s] of blocks.entries()) {
    const first = s.split('\n').slice(1, 3).join('\n');
    assert.match(first, /^The voice the team picked .*\n- Voice: plainer than the site/, `block ${i} starts with the pick`);
    assert.equal(s.split(VOICE_LINE.plainer).length, 2, `block ${i} has it once`);
  }
  assert.match(blocks[0], /never uses emoji/, 'the read voice is still there');
});

test('the route is a thin wrapper, reachable, and closed to outsiders on live like Drop', () => {
  const s = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');
  assert.match(s, /on\('POST', '\/api\/brands\/:slug\/voice', async \(b, t, p\) => \{/);
  assert.match(s, /saveVoicePick\(o\.memory, slug, b\.voice, \{ who: reqOf\(t\), demo: process\.env\.DEMO_MODE === '1' \}\)/);
  assert.equal(s.split("brands\\/[a-z0-9-]+\\/(drop|references(\\/[^/]+(\\/remove)?)?|voice)$").length, 3, 'both path gates let it through');
  assert.match(s, /brands\\\/\[\^\/\]\+\\\/\(drop\|voice\)\)\$\/\.test\(u\.pathname\)\) \{ send\(res, 403/, 'no writes from outside the team on live');
  const demo = /const DEMO_OK = (\/.*\/);/.exec(s)[1]; assert.ok(!demo.includes('voice'), 'not opened to demo-mode visitors');
});
