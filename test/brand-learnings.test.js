// node --test test/  — brand learnings (brand-learnings.js): the command, reading a pasted call into learnings (a scripted AI
// stands in for Claude), the brand context it writes, conflicts with the fact sheet, the moves it flags, rewrites and adds,
// the same paste twice, and who may do it. Free: no AI, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.REFRESH_AUTO = '0';
const { parseLearnCommand, looksLikeTranscript, vetLearnings, chunkText, heuristicLearnings, conflictsOf, withLearned, stripLearned, learnGate, sourceKind, sourceHash, createLearnings, replyText, planLocal, LEARN_CMD } = await import('../brand-learnings.js');
const { createPacks } = await import('../brand-pack.js');
const { createBuilder } = await import('../build.js');
const { createBrandMemory } = await import('../brand-memory.js');
const { movesDue, movesConfig, evidenceFor, familyPrompt, FAMILIES, writeFamily } = await import('../moves-cadence.js');

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.join(HERE, '..');
const quiet = { log() {}, warn() {}, error() {}, info() {} };

const CALL = `Call transcript, 12 Oct
Priya (founder): Thanks for having us. Honestly we are a skincare brand for people with oily, acne-prone skin who are tired of harsh products.
Sam (Brew): What are you focused on this quarter?
Priya (founder): Our goal this quarter is to launch the Night Repair Serum in November at ₹899.
Sam (Brew): Anything you never want in ads?
Priya (founder): We never use the word miracle, and we don't show before-and-after photos. Customers distrust hype.
Sam (Brew): Who buys most?
Priya (founder): Mostly women aged 22 to 30 in metro cities, a lot of them students.
Sam (Brew): How many products do you have now?
Priya (founder): We have 12 products on the store right now.
Sam (Brew): Great, thanks.`;

// a scripted Claude: learnings whose quotes are real lines of the call (plus one made up, one with an invented number)
const scripted = (calls = []) => ({ live: true, meter: { usd: 0 }, call: async (o) => { calls.push(o.tag);
  if (o.tag === 'learn-extract') {
    const has = (q) => o.prompt.includes(q);
    const L = [
      has('skincare brand for people') && { kind: 'essence', text: 'A skincare brand for people with oily, acne-prone skin who are tired of harsh products.', quote: 'we are a skincare brand for people with oily, acne-prone skin who are tired of harsh products', topic: 'none', conflictLabel: '', conflictSays: '' },
      has('Night Repair Serum') && { kind: 'goal', text: 'They plan to launch the Night Repair Serum in November at ₹899.', quote: 'Our goal this quarter is to launch the Night Repair Serum in November at ₹899', topic: 'none', conflictLabel: '', conflictSays: '' },
      has('never use the word miracle') && { kind: 'belief', text: 'They never use the word miracle and never show before-and-after photos in ads.', quote: "We never use the word miracle, and we don't show before-and-after photos", topic: 'rules', conflictLabel: '', conflictSays: '' },
      has('women aged 22 to 30') && { kind: 'fact', text: 'Most buyers are women aged 22 to 30 in metro cities, many of them students.', quote: 'Mostly women aged 22 to 30 in metro cities, a lot of them students', topic: 'audience', conflictLabel: '', conflictSays: '' },
      has('12 products') && { kind: 'fact', text: 'They have 12 products on the store.', quote: 'We have 12 products on the store right now', topic: 'products', conflictLabel: 'Products in the catalog', conflictSays: '12 products' },
      { kind: 'belief', text: 'They think TikTok is their best channel.', quote: 'TikTok is our best channel by far', topic: 'channels', conflictLabel: '', conflictSays: '' }, // not in the call: dropped
      has('Night Repair Serum') && { kind: 'fact', text: 'The serum will sell 5,000 units in its first month.', quote: 'launch the Night Repair Serum in November', topic: 'products', conflictLabel: '', conflictSays: '' } // a number the call never said: dropped
    ].filter(Boolean);
    return { json: { learnings: L }, usd: 0.02 };
  }
  if (o.tag === 'learn-plan') return { json: { stale: [{ n: 3, why: 'It plans ads around before-and-after photos, which the team rules out.', uses: [2] }, { n: 9, why: 'The launch in November changes what comes first.', uses: [1] }, { n: 40, why: 'not a written move', uses: [0] }, { n: 1001, why: 'a weekly move', uses: [0] }],
    fresh: [{ title: 'Plan the Night Repair Serum launch', why: 'The team plans to launch it in November.' }] }, usd: 0.01 };
  throw Object.assign(new Error('unexpected ' + o.tag), { mock: true });
} });

async function brand(ROOT) {
  const P = createPacks({ ROOT, PUB: path.join(REPO, 'public'), bucket: null, gToken: null, log: quiet });
  const modules = { reader: { createReader: () => ({ read: async () => { throw new Error('no read'); } }) }, brief: { createBrief: () => ({}) }, moves: { SPECS: [], createMovesEngine: () => ({}) }, pdf: null };
  const builder = createBuilder({ ROOT, packs: P, ai: { onCharge() {}, call: async () => { throw Object.assign(new Error('mock'), { mock: true }); } }, treg: { onCharge() {} }, log: quiet, modules });
  const slug = 'glow-in';
  const profile = { url: 'https://glow.in', host: 'glow.in', slug, name: 'Glow', descriptor: 'Skincare for oily skin', category: 'Skincare', country: 'IN', currency: 'INR', locale: 'en-IN', platform: 'shopify',
    catalog: { products: [{ handle: 'gel', title: 'Clear Gel', price: 499, url: 'https://glow.in/products/gel', inStock: true, images: [] }] }, rivals: [], reviews: { total: 40 }, socials: {}, ads: { own: { page: 'Glow', live: 3 } } };
  const ledger = [{ key: 'catalog.count', label: 'Products in the catalog', v: '9', n: 9, layer: 'observed', src: 'glow.in/products.json', at: '2026-10-01' }, { key: 'price.gel', label: 'Clear Gel price', v: '₹499', n: 499, unit: 'INR', layer: 'observed', src: 'glow.in/products/gel', url: 'https://glow.in/products/gel', at: '2026-10-01' }];
  const sec = (text) => [{ h: 'Why', kind: 'why', blocks: [{ t: 'p', text }] }];
  const moves = { 3: { n: 3, title: 'Before-and-after ads', gives: 'Proof ads', sections: sec('Run before-and-after photos.') }, 9: { n: 9, title: 'Q4 priorities', gives: 'What comes first', sections: sec('Lead with the Clear Gel.') },
    12: { n: 12, title: 'Search', sections: sec('Nothing here.') }, 1001: { n: 1001, title: 'Audit', family: 'audit', meta: { cadence: true }, sections: sec('x') } };
  await P.put(slug, 'status.json', { name: 'Glow', host: 'glow.in', done: true, ready: true, doneAt: Date.now() });
  await P.put(slug, 'profile.json', profile); await P.put(slug, 'ledger.json', ledger); await P.put(slug, 'moves.json', moves);
  await P.put(slug, 'seed.json', { brand: { name: 'Glow', host: 'glow.in', mark: 'x.png' }, lanes: { core: { name: 'Core', line: 'Clear Gel' } }, posts: [] });
  await P.put(slug, 'brief.json', { oneLine: 'Skincare for oily skin', personas: [] }); await P.put(slug, 'brief.md', '# Glow brand brief\n\nSkincare for oily skin.\n');
  await builder.republish(slug);
  // a connected Shopify says 11 products: the source of truth for that number
  await P.put(slug, 'private/facts.json', { at: Date.now(), tools: { shopify: Date.now() }, facts: { catalog_count: { v: '11', n: 11, label: 'Products in the catalog', src: 'Shopify (connected)', kind: 'connected', connected: 'shopify', key: 'shopify.products.active' } } });
  return { P, builder, slug };
}

/* run, and save the draft it shows (the team checks learnings before they are saved) */
const saved = async (L, slug, o) => { const r = await L.run(slug, o); return r.draft ? { ...(await L.review(slug, 'save')), draft: r } : r; };

/* ---------- the command ---------- */
test('the command: typed explicitly anywhere, read implicitly only in a fresh (generic) jam', () => {
  const x = parseLearnCommand(`${LEARN_CMD}\n${CALL}`); assert.equal(x.mode, 'explicit'); assert.equal(x.why, 'command'); assert.ok(x.body.startsWith('Call transcript'));
  assert.equal(parseLearnCommand(`/update-brand-learnings: notes from the founder call`).body, 'notes from the founder call');
  assert.equal(parseLearnCommand('/Update_Brand_Learning').mode, 'explicit', 'case and separators are forgiven');
  assert.equal(parseLearnCommand(CALL), null, 'a card jam never reads a paste as learnings unless asked');
  const t = parseLearnCommand(CALL, { generic: true }); assert.equal(t.mode, 'implicit'); assert.equal(t.why, 'transcript');
  const ph = parseLearnCommand(`Update my brand learnings\n${CALL}`, { generic: true }); assert.equal(ph.why, 'phrase'); assert.ok(ph.body.startsWith('Call transcript'), 'the asking line is not part of the source');
  assert.equal(sourceHash(ph.body), sourceHash(x.body), 'the same paste is the same source with or without the asking line');
  assert.equal(parseLearnCommand("Here's the customer call transcript", { generic: true }).body, '');
  assert.equal(parseLearnCommand('Add this to what you know about us: we ship only in India.', { generic: true }).why, 'phrase');
  assert.equal(parseLearnCommand('Make a reel for the Clear Gel', { generic: true }), null);
  assert.equal(parseLearnCommand(`Make three ads from this call:\n${CALL}`, { generic: true }), null, 'a request to make something is not learnings');
  assert.equal(parseLearnCommand('x'.repeat(7000), { generic: true }).why, 'long');
  assert.ok(looksLikeTranscript(CALL)); assert.ok(!looksLikeTranscript('We are a brand. '.repeat(100)));
  assert.equal(sourceKind(CALL), 'Call transcript'); assert.equal(sourceKind('From: a@b.com\nSubject: plans\n\nWe launch soon.'), 'Email');
});

test('access: the brand’s team and the Brew team only; the demo site says no politely', () => {
  assert.equal(learnGate({ member: true, name: 'Glow' }), null);
  assert.match(learnGate({ member: false, name: 'Glow' }), /Only Glow’s team or the Brew team/);
  assert.match(learnGate({ member: true, demoSite: true }), /demo copy/);
});

/* ---------- reading ---------- */
test('vetting: a learning whose words are not in the paste, or with a number the paste never said, is dropped', () => {
  const ok = vetLearnings([{ kind: 'goal', text: 'They launch the serum in November at ₹899.', quote: 'launch the Night Repair Serum in November at ₹899' },
    { kind: 'goal', text: 'They launch the serum in November at ₹999.', quote: 'launch the Night Repair Serum in November at ₹899' },
    { kind: 'belief', text: 'They love TikTok above all.', quote: 'TikTok is everything' }, { kind: 'mood', text: 'Not a kind at all here.', quote: 'Thanks for having us' }], CALL);
  assert.equal(ok.length, 1); assert.match(ok[0].text, /₹899/);
  const words = vetLearnings(heuristicLearnings(CALL), CALL);
  assert.ok(words.some((x) => x.kind === 'essence') && words.some((x) => x.kind === 'goal') && words.some((x) => x.kind === 'belief'), JSON.stringify(words.map((x) => x.kind)));
  assert.ok(words.every((x) => CALL.includes(x.quote)), 'the offline read quotes the paste as it stands');
});

test('long pastes are read in chunks and merged without duplicates', async () => {
  const long = `${CALL}\n${'Sam (Brew): ok.\n'.repeat(1400)}\n${CALL.replace('12 Oct', '13 Oct')}`; assert.ok(long.length > 20000);
  const parts = chunkText(long, 6000, 200); assert.ok(parts.length >= 3); assert.ok(parts.every((p) => p.length <= 6000));
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, builder, slug } = await brand(ROOT), calls = [];
  const L = createLearnings({ ai: scripted(calls), packs: P, builder: { flagStale: builder.flagStale, rewrite: async () => ({ ok: true }), busy: () => false }, log: quiet, env: { LEARN_CHUNK_CHARS: '6000', LEARN_REWRITE_MAX: '0' } });
  const r = await saved(L, slug, { text: long, by: 'Priya Rao', byShort: 'Priya' });
  assert.ok(calls.filter((x) => x === 'learn-extract').length >= 3, `${calls}`);
  assert.equal(r.applied.filter((x) => x.kind === 'goal').length, 1, 'the same learning in two chunks is one learning');
});

/* ---------- the whole run ---------- */
test('a pasted call updates the brief, memory and system prompt, reports the conflict, flags, rewrites and adds moves', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, builder, slug } = await brand(ROOT), calls = [], rw = [], due = [], ran = [];
  const memory = createBrandMemory({ packs: P, log: quiet });
  const B = { flagStale: builder.flagStale, rewrite: async (s, ns) => { rw.push(ns); return { ok: true, n: ns.length, est: Math.round(ns.length * 1.7) }; }, busy: () => false };
  const cadence = { due: async (s, o) => { due.push(o); return { families: ['learn'], left: 3, why: [] }; }, runOne: async (s, fams, o) => { ran.push({ fams, o }); return { written: [{ n: 1002 }], usd: 0.5 }; } };
  const L = createLearnings({ ai: scripted(calls), packs: P, memory, builder: B, cadence, log: quiet, onPack: async (s) => P.drop(s), wait: async () => {}, env: {} });
  const r = await saved(L, slug, { text: CALL, by: 'Priya Rao', byShort: 'Priya', why: 'transcript' });
  // learned: four kinds, each with its source; the invented belief and the invented number never got in
  assert.deepEqual(r.applied.map((x) => x.kind).sort(), ['belief', 'essence', 'fact', 'goal']);
  assert.ok(!JSON.stringify(r.applied).includes('TikTok') && !JSON.stringify(r.applied).includes('5,000'));
  const label = `Call transcript, added by Priya Rao, ${new Date().toISOString().slice(0, 10)}`; assert.equal(r.label, label);
  // the fact sheet wins: Shopify (connected) says 11, the call says 12 → reported, not applied
  assert.equal(r.conflicts.length, 1); assert.equal(r.conflicts[0].fact.v, '11'); assert.ok(r.conflicts[0].fact.connected);
  const Ld = await P.getJSON(slug, 'learned.json'); assert.equal(Ld.essence.length, 1); assert.equal(Ld.goals[0].source, label); assert.equal(Ld.sources[0].n, 4); assert.equal(Ld.sources[0].conflicts, 1);
  assert.ok(fs.existsSync(path.join(ROOT, '.brands', slug, 'private', 'learnings', `${r.hash}.txt`)), 'the paste is kept, privately');
  // brief.json and brief.md: the managed section, once
  assert.match((await P.getJSON(slug, 'brief.json')).learned.goals[0].text, /Night Repair Serum/);
  const md = (await P.get(slug, 'brief.md')).toString(); assert.match(md, /## What the team told Brew/); assert.match(md, /never use the word miracle/i); assert.match(md, /Call transcript, added by Priya Rao/);
  assert.equal(withLearned(md, Ld, { name: 'Glow' }).match(/What the team told Brew/g).length, 1, 'the section is replaced, never stacked');
  assert.equal(stripLearned(md).includes('What the team told Brew'), false);
  // the system prompt every AI call reads (brand-pack.js) carries it
  P.drop(slug); const pk = await P.load(slug); assert.match(pk.system, /What the team told Brew/); assert.match(pk.system, /Night Repair Serum/);
  // memory: essence, goals, beliefs as their own topics; a "never" belief is a rule; every line with its source
  const rp = await memory.repo(slug); const tops = new Set(rp.facts.map((f) => f.topic));
  for (const t of ['essence', 'goals', 'rules', 'audience']) assert.ok(tops.has(t), `memory topic ${t}: ${[...tops]}`);
  assert.ok(rp.facts.every((f) => f.source.label === label));
  const block = await memory.promptBlock(slug, { query: 'search engine optimisation', agent: 'creative', name: 'Glow' });
  assert.match(block, /Essence/); assert.match(block, /Goals/); assert.match(block, /miracle/, 'the brand’s own word rides along with any query');
  // moves: 3 and 9 flagged (40 is not written, 1001 is a weekly move), both rewritten; one new move queued after the rewrite
  const u = await P.getJSON(slug, 'updates.json'); assert.deepEqual(Object.keys(u.stale).sort(), ['3', '9']); assert.equal(u.stale[3].via, 'learnings'); assert.match(u.stale[3].why, /What the team told us \(Call transcript/);
  assert.deepEqual(rw, [[3, 9]]); assert.deepEqual(due[0], { manual: true, only: ['learn'] });
  await new Promise((res) => setTimeout(res, 20)); assert.deepEqual(ran[0].fams, ['learn']); assert.equal(ran[0].o.hints[0].title, 'Plan the Night Repair Serum launch');
  // the reply: plain, short, every part there
  assert.match(r.draft.reply, /^This looks like a call transcript, so I read it as brand learnings/); assert.match(r.draft.reply, /\*\*Check before it becomes Glow’s brand context\*\*[\s\S]*1\. A skincare brand[\s\S]*“save”/);
  assert.match(r.reply, /\*\*Saved 4 learnings to Glow’s brand context\*\*\nFrom the call transcript Priya added\./);
  for (const h of ['\n**Essence**\n', '\n**Goals**\n', '\n**Beliefs**\n', '\n**Facts**\n']) assert.ok(r.reply.includes(h), h);
  assert.match(r.reply, /They are in the brief and Brew’s memory/);
  assert.match(r.reply, /\*\*Not saved: the fact sheet wins on numbers\*\*\n- It says 12 products; Products in the catalog reads 11 from Shopify \(connected\)\. Connected accounts are the source of truth/);
  assert.match(r.reply, /\*\*Moves\*\*\n- Rewriting now: Move 03 and Move 09 \(2, 10 to 15 minutes, about \$1\.2\)\.\n- 1 new move from what you told us, once the rewrite is in\./);
  // the same paste again: nothing learned twice, nothing spent
  const n0 = calls.length, again = await L.run(slug, { text: `${CALL}\n`, by: 'Sam' });
  assert.ok(again.dup && again.draft); assert.equal(calls.length, n0, 'no new read'); assert.match(again.reply, /\*\*Already saved on .* by Priya\*\*[\s\S]*1\. A skincare brand[\s\S]*“save”/);
  const kept = await L.review(slug, 'cancel'); assert.match(kept.reply, /kept as it was/); assert.equal((await P.getJSON(slug, 'learned.json')).sources.length, 1);
  // a different paste that says the same things: known, nothing new
  const again2 = await saved(L, slug, { text: `Notes:\n${CALL.split('\n').slice(1, 4).join('\n')}\nAlso a new line to make it different enough here.`, by: 'Sam' });
  assert.equal(again2.applied.length, 0); assert.match(again2.reply, /Nothing new in it/);
});

test('caps: a busy or capped rewrite and a used-up moves budget are said in the reply; AI off flags without rewriting', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, builder, slug } = await brand(ROOT);
  const B = { flagStale: builder.flagStale, rewrite: async () => ({ error: 'Today’s budget is used up. Try again tomorrow.' }), busy: () => false };
  const cadence = { due: async () => ({ families: [], why: ['learn: weekly cap $3 (spent $3.00)'] }), runOne: async () => assert.fail('must not run') };
  const r = await saved(createLearnings({ ai: scripted(), packs: P, builder: B, cadence, log: quiet, env: {} }), slug, { text: CALL, by: 'p@glow.in', byShort: 'p@glow.in' });
  assert.match(r.reply, /- The rewrite can’t start now: Today’s budget is used up\. Try again tomorrow\. The moves are marked on the Moves tab\./);
  assert.match(r.reply, /New moves from this wait: this brand's weekly budget for new moves is used up \(\$3 a week\)\./);
  // AI off (mock): the words are read without AI, moves the words point at are flagged, nothing is rewritten or spent
  const ROOT2 = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), b2 = await brand(ROOT2); let rewrote = false;
  const LO = createLearnings({ ai: { live: false, call: async () => { throw Object.assign(new Error('AI is off (mock)'), { mock: true }); } }, packs: b2.P, builder: { flagStale: b2.builder.flagStale, rewrite: async () => { rewrote = true; return {}; } }, log: quiet, env: {} })
;
  const off = await saved(LO, b2.slug, { text: `${CALL}\nWe want our before-and-after ads replaced with routine videos.`, by: 'p@glow.in' });
  assert.equal(off.how, 'words'); assert.ok(off.applied.length >= 3); assert.equal(rewrote, false); assert.equal(off.usd, 0);
  assert.ok(off.applied.every((x) => CALL.includes(x.quote) || x.quote.includes('routine videos')));
});

test('an empty command asks for the paste; the daily limit stops before any spend', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, slug } = await brand(ROOT), calls = [];
  const L = createLearnings({ ai: scripted(calls), packs: P, log: quiet, env: { LEARN_DAY_MAX: '1' } });
  const ask = await L.run(slug, { text: '', why: 'phrase' }); assert.ok(ask.asked); assert.match(ask.reply, /Paste the transcript, notes or email after \/update-brand-learnings/); assert.equal(calls.length, 0);
  await saved(L, slug, { text: CALL, by: 'a' }); const n = calls.length;
  const cap = await L.run(slug, { text: CALL.replace('12 Oct', '14 Oct'), by: 'a' }); assert.ok(cap.capped); assert.equal(calls.length, n); assert.match(cap.reply, /daily limit/);
});

test('local plan: moves that share the words of a learning, core moves only', () => {
  const p = planLocal([{ kind: 'belief', text: 'They never show before-and-after photographs in advertising.' }], { 3: { title: 'Before-and-after photographs for advertising', gives: 'proof' }, 12: { title: 'Search' }, 1001: { title: 'before-and-after photographs advertising', meta: { cadence: true } } });
  assert.deepEqual(p.stale.map((s) => s.n), [3]);
});

test('reply: nothing found, and the long-paste note', () => {
  assert.match(replyText({ name: 'Glow', applied: [], conflicts: [], again: 0, note: '' }), /couldn’t find anything in it that changes what Brew knows about Glow/);
  assert.match(replyText({ name: 'Glow', kind: 'Notes', label: 'Notes, added by a, 2026-10-14', applied: [{ kind: 'fact', text: 'They ship only in India.' }], conflicts: [], again: 0, clipped: 120000, moves: {} }), /It was long, so I read the first 120,000 characters\.[\s\S]*Nothing in this changes the current moves\./);
});

/* ---------- the moves: the learn family ---------- */
test('cadence: learned moves run only when asked, cite the team’s words, and other families see the learnings as context', async () => {
  const cfg = movesConfig({});
  assert.deepEqual(movesDue({}, cfg, { now: Date.now(), ready: true }).families, ['auto'], 'the weekly clock never writes learned moves');
  assert.deepEqual(movesDue({}, cfg, { now: Date.now(), ready: true, manual: true, only: ['learn'] }).families, ['learn']);
  assert.deepEqual(movesDue({ last: { learn: Date.now() } }, cfg, { now: Date.now(), ready: true, manual: true, only: ['learn'] }).families, ['learn'], 'each paste may open its own moves');
  assert.match(movesDue({ spend: { week: (await import('../moves-cadence.js')).weekKey(Date.now()), usd: 2.9 } }, cfg, { now: Date.now(), ready: true, manual: true, only: ['learn'] }).why.join(), /learn: weekly cap/);
  const brief = { oneLine: 'Skincare', learned: { goals: [{ text: 'Launch the serum in November at ₹899.', source: 'Call transcript, added by Priya, 2026-10-14', at: Date.now() }], beliefs: [{ text: 'Never say miracle.', source: 'Call transcript, added by Priya, 2026-10-14' }] } };
  const ev = evidenceFor('learn', { profile: { host: 'glow.in' }, brief });
  assert.ok(ev.some((e) => /Goal \(the team's words\): Launch the serum in November at ₹899/.test(e.text) && e.src.startsWith('Call transcript, added by Priya')));
  const pr = familyPrompt('auto', { name: 'Glow', host: 'glow.in', ev: [], scorecard: { areas: [], weakest: [] }, auto: { email: 'Klaviyo', chat: 'WhatsApp' }, brief, k: 3 });
  assert.match(pr, /toldByTheTeam/); assert.match(pr, /Never say miracle/);
  assert.equal(FAMILIES.learn.max, 5); /* a strategy can open up to five new moves */
  const none = await writeFamily('learn', { ai: { call: async () => assert.fail('no call without learnings') }, slug: 'x', pack: { profile: {}, brief: { oneLine: 'x' } }, numbers: () => [] });
  assert.equal(none.skipped, 'nothing learned yet');
});

/* ---------- the jam route and the cards ---------- */
test('jam route: a learnings message gets Brew’s reply in the chat and leaves the jam brief alone; anything else edits the brief as before', async () => {
  const { createJamBrief } = await import('../jam-brief.js');
  const JB = createJamBrief({ claudeTool: async () => assert.fail('no AI here'), cardBrief: () => '', seatLine: () => '', isMock: () => true, spend: () => false, now: () => 1, cardOf: () => ({ id: 'jam-x', title: 'New jam', sub: 'A fresh jam. Say what you want made.' }), log: quiet });
  const R = {}, t = { cards: new Map() }, w = { id: 'wk_1', cardId: 'jam-x', title: 'New jam', thread: [], stage: 'drafting' };
  const seen = [];
  JB.routes({ on: (m, p, fn) => { R[`${m} ${p}`] = fn; }, W: () => w, say: (t0, w0, m) => w0.thread.push(m), move: () => {}, learn: async (t0, w0, text) => { seen.push(text); return /^\/update-brand-learnings/.test(text) ? { said: '/update-brand-learnings (2,400 characters pasted)', reply: 'Learned from the call transcript you added: 3 new learnings.', n: 3 } : null; } });
  const md0 = (JB.seed(t, w), w.doc.md);
  const r = await R['POST /api/work/:wid/doc/ask']({ text: `/update-brand-learnings\n${CALL}` }, t, { wid: 'wk_1' });
  assert.equal(r.learned, 3); assert.equal(w.doc.md, md0, 'the jam brief is not where learnings go');
  assert.deepEqual(w.thread.map((m) => [m.from, m.who || null]), [['me', null], ['ai', 'Brew']]);
  assert.match(w.thread[0].body, /characters pasted/); assert.match(w.thread[1].body, /3 new learnings/);
  await R['POST /api/work/:wid/doc/ask']({ text: 'Make the headline shorter' }, t, { wid: 'wk_1' });
  assert.equal(seen.length, 2); assert.match(w.doc.md, /Make the headline shorter/, 'a normal ask still edits the brief');
});

test('cards follow a rewritten move in an open workspace: replaced, and a card the rewrite no longer makes steps back', async () => {
  const { followMoveCards } = await import('../feed-service.js');
  const cards = new Map([['m03-1', { id: 'm03-1', state: 'ready', title: 'old 1', mv: 'v1' }], ['m03-2', { id: 'm03-2', state: 'shown', title: 'old 2', mv: 'v1' }], ['m09-1', { id: 'm09-1', state: 'ready', title: 'kept', mv: 'v1' }]]);
  const docs = { 3: { meta: { rewrittenAt: 'v2' } }, 9: { meta: { rewrittenAt: 'v1' } } }, expired = [];
  const out = followMoveCards(cards, { docs, posts: [{ id: 'm03-1', title: 'new 1' }, { id: 'm09-1', title: 'kept' }], expire: (c) => { c.state = 'expired'; expired.push(c.id); } });
  assert.deepEqual(out.replaced, ['m03-1']); assert.deepEqual(expired, ['m03-2']); assert.equal(cards.get('m03-1').title, 'new 1'); assert.equal(cards.get('m09-1').state, 'ready');
});

test('first learnings: past the upload’s dollar cap they wait for a yes, with the cost; later learnings rewrite within the cap', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, builder, slug } = await brand(ROOT); const asked = [];
  const B = { flagStale: builder.flagStale, rewrite: async (s, ns) => { asked.push(ns); return { ok: true, n: ns.length, est: 2 }; }, busy: () => false };
  const L = createLearnings({ ai: scripted(), packs: P, builder: B, log: quiet, env: { LEARN_CAP_USD: '0.6', LEARN_MOVE_EST_USD: '0.6' } }); /* a cap of one move, so the call's 2 moves go over it */
  const r = await saved(L, slug, { text: CALL, by: 'p@glow.in', byShort: 'p@glow.in' });
  assert.equal(asked.length, 0, 'nothing starts before the yes');
  assert.match(r.reply, /- 2 moves change in a way that matters \(Move 03 and Move 09\)\. Rewriting all of them costs about \$1\.2, over the \$0\.6 an upload spends on its own\./);
  assert.match(r.reply, /Reply “go ahead” to rewrite all 2 \(10 to 15 minutes\), or “just the top ones” for the 1 that matter most, within \$0\.6\./);
  assert.equal(await L.confirm(slug, 'what about the ads?'), null, 'anything else is a normal chat');
  const c = await L.confirm(slug, 'just the top ones please'); assert.deepEqual(asked, [[3]]); assert.match(c.reply, /Refreshing 1 move/);
  assert.equal(await L.confirm(slug, 'go ahead'), null, 'answered once');
  // a second, different paste: not the first any more, so up to the limit rewrites straight away
  const r2 = await saved(L, slug, { text: CALL.replace('12 Oct', '19 Oct') + '\nPriya (founder): We also never discount below 20 percent.', by: 'p@glow.in', byShort: 'p@glow.in' });
  assert.ok(!/first time/.test(r2.reply)); assert.ok(asked.length === 1 || asked[1].length <= 1);
});

test('the setup box (ask: false): the first learnings rewrite the top moves now and mark the rest, with no warning to answer', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, builder, slug } = await brand(ROOT); const asked = [];
  const B = { flagStale: builder.flagStale, rewrite: async (s, ns) => { asked.push(ns); return { ok: true, n: ns.length, est: 2 }; }, busy: () => false };
  const L = createLearnings({ ai: scripted(), packs: P, builder: B, log: quiet, env: { LEARN_CAP_USD: '0.6', LEARN_MOVE_EST_USD: '0.6' } });
  const r = await L.run(slug, { text: CALL, by: 'p@glow.in', byShort: 'p@glow.in', why: 'setup', ask: false });
  assert.deepEqual(asked, [[3]], 'the most affected move rewrites straight away');
  assert.ok(!/first time|go ahead/.test(r.reply)); assert.match(r.reply, /- In the weekly run: Move 09 \(past this upload’s budget\)\./);
  assert.equal(await L.confirm(slug, 'go ahead'), null, 'nothing waits for a yes');
});

test('the weekly pot: learnings rewrite what it covers at today’s cost per move; the rest waits, with the reason', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, builder, slug } = await brand(ROOT); const asked = [];
  const B = { flagStale: builder.flagStale, rewrite: async (s, ns) => { asked.push(ns); return { ok: true, n: ns.length }; }, busy: () => false, pot: async () => ({ est: 0.1, left: { learnings: 0.15, new: 0 } }), potSpend: async () => {} };
  const L = createLearnings({ ai: scripted(), packs: P, builder: B, log: quiet, env: {} }); /* the upload's own cap ($30) is roomy: the pot ($0.15) decides */
  const r = await L.run(slug, { text: CALL, by: 'p@glow.in', byShort: 'p@glow.in', why: 'setup', ask: false });
  assert.deepEqual(asked, [[3]], 'one move fits the pot');
  assert.match(r.reply, /about \$0\.1\)/, 'priced at today’s model, not the Opus-era $0.6');
  assert.match(r.reply, /- In the weekly run: Move 09 \(past this week’s rewrite budget\)\./);
  assert.equal((await P.getJSON(slug, 'updates.json')).stale[9].via, 'learnings', 'it keeps its flag for the weekly run');
});

test('the draft: nothing is saved until "save"; drop, change and add edit it; cancel saves nothing; the same paste shows the draft again', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, builder, slug } = await brand(ROOT); const calls = [];
  const L = createLearnings({ ai: scripted(calls), packs: P, builder: { flagStale: builder.flagStale, rewrite: async (s, ns) => ({ ok: true, n: ns.length }), busy: () => false }, log: quiet, env: {} });
  const r = await L.run(slug, { text: CALL, by: 'Priya Rao', byShort: 'Priya' });
  assert.ok(r.draft); assert.equal((await P.getJSON(slug, 'learned.json')).sources.length, 0, 'nothing saved yet');
  assert.ok(!/What the team told Brew/.test((await P.get(slug, 'brief.md')).toString()), 'brief untouched');
  const n0 = calls.length, again = await L.run(slug, { text: CALL, by: 'Priya Rao' }); assert.ok(again.draft); assert.equal(calls.length, n0, 'same paste: the draft again, no new read');
  assert.equal(await L.review(slug, 'how are the ads doing?'), null, 'other chat passes through');
  let x = await L.review(slug, 'drop 1'); assert.match(x.reply, /\*\*Updated draft\*\*/); assert.ok(!/A skincare brand/.test(x.reply));
  x = await L.review(slug, 'change 1 to They launch the Night Repair Serum in December.'); assert.match(x.reply, /December/);
  x = await L.review(slug, 'add belief: Customers trust dermatologists over influencers.'); assert.match(x.reply, /\*\*Beliefs\*\*[\s\S]*dermatologists/);
  const s = await L.review(slug, 'save'); assert.ok(s.saved); assert.match(s.reply, /\*\*Saved \d learnings to Glow’s brand context\*\*/);
  const Ld = await P.getJSON(slug, 'learned.json'); assert.ok(!Ld.draft); assert.ok(Ld.beliefs.some((b) => /dermatologists/.test(b.text))); assert.ok(Ld.goals.some((g) => /December/.test(g.text)));
  assert.equal(await L.review(slug, 'save'), null, 'no draft left');
  // cancel: a new paste, then cancel, saves nothing
  await L.run(slug, { text: CALL.replace('12 Oct', '21 Oct') + '\nPriya (founder): Our hero is the Clear Gel at ₹499.', by: 'a' });
  const c = await L.review(slug, 'cancel'); assert.match(c.reply, /nothing was saved/); assert.equal((await P.getJSON(slug, 'learned.json')).sources.length, 1);
});

test('an upload: moves by impact within the dollar cap (no count limit), the rest to the weekly run; the feed changes at once', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, builder, slug } = await brand(ROOT), asked = [], added = [];
  const seed = await P.getJSON(slug, 'seed.json');
  seed.posts = [{ id: 'm03-1', agent: 'brew', sector: 'creatives', type: 'idea', lane: 'core', title: 'Run before-and-after ads', sub: 'Show the skin change in two photos.', detail: { why: ['x'], how: ['y'] } },
    { id: 'm09-1', agent: 'brew', sector: 'signals', type: 'idea', lane: 'core', title: 'Plan the November serum launch', sub: 'Put the Night Repair Serum first in Q4.', detail: { why: ['x'], how: ['y'] } }];
  await P.put(slug, 'seed.json', seed);
  /* move 12 was rewritten an hour ago: it waits for the weekly run instead of paying twice */
  const mv = await P.getJSON(slug, 'moves.json'); mv[12].meta = { rewrittenAt: new Date(Date.now() - 3600e3).toISOString() }; mv[20] = { n: 20, title: 'Reviews', sections: [{ h: 'Why', blocks: [{ t: 'p', text: 'x' }] }] }; await P.put(slug, 'moves.json', mv);
  const ai = scripted(); const call0 = ai.call;
  ai.call = async (o) => o.tag !== 'learn-plan' ? call0(o) : { usd: 0.01, json: {
    stale: [{ n: 9, impact: 'medium', why: 'The launch comes first.', uses: [1] }, { n: 3, impact: 'high', why: 'Before-and-after photos are ruled out.', uses: [2] }, { n: 12, impact: 'medium', why: 'x', uses: [] }, { n: 20, impact: 'low', why: 'A small change.', uses: [] }],
    fresh: [], cards: { up: [{ id: 'm09-1', why: 'The team puts the November launch first.' }], hide: [{ id: 'm03-1', why: 'The team never shows before-and-after photos.' }, { id: 'nope', why: 'not a card' }],
      add: [{ title: 'Line up the Night Repair Serum launch', sub: 'The team plans it for November at ₹899. Start the waitlist now.', why: ['Their goal this quarter'], how: ['Open a waitlist'], sector: 'signals', uses: [1] }] } } };
  const B = { flagStale: builder.flagStale, rewrite: async (s, ns, o) => { asked.push([ns, o.via]); return { ok: true }; }, busy: () => false };
  const L = createLearnings({ ai, packs: P, builder: B, feed: { addCards: async (s, cs) => added.push(...cs) }, log: quiet, env: {}, onPack: async (s) => P.drop(s) });
  const r = await saved(L, slug, { text: CALL, by: 'p@glow.in', byShort: 'Priya' });
  assert.deepEqual(asked, [[[3, 9], 'learnings']], 'high first, then medium; a low one and a fresh one wait');
  assert.match(r.reply, /- Rewriting now: Move 03 and Move 09 \(2, 10 to 15 minutes, about \$1\.2\)\./);
  assert.match(r.reply, /- In the weekly run: Move 12 and Move 20 \(rewritten in the last day, a small change\)\./);
  const st = (await P.getJSON(slug, 'updates.json')).stale;
  assert.equal(st[20].weekly, true); assert.equal(st[12].weekly, true); assert.equal(st[3].weekly, false); assert.equal(st[20].via, 'learnings');
  // the feed, at once
  assert.match(r.reply, /\*\*Your feed, now\*\*\n- New on the feed, from what Glow’s team told us: “Line up the Night Repair Serum launch”\n- Moved up: “Plan the November serum launch”\. The team puts the November launch first\.\n- Off the top of the feed: “Run before-and-after ads”\. The team never shows before-and-after photos\./);
  assert.equal(added.length, 1); assert.equal(added[0].src, 'From what Glow’s team told us'); assert.match(added[0].id, /^told-/);
  const b = await P.load(slug, { fresh: true });
  assert.ok(b.learnedHide.has('m03-1') && b.learnedUp.has('m09-1') && b.teamCards.has(added[0].id));
  assert.ok(b.seed.posts.some((x) => x.id === added[0].id), 'a new workspace gets the team card too');
  assert.equal(b.notes['m09-1'], 'From what Glow’s team told us: The team puts the November launch first.');
  // bring a hidden card back
  const back = await L.confirm(slug, 'bring back the before-and-after ads card');
  assert.match(back.reply, /Back on the feed: “Run before-and-after ads”/);
  assert.equal((await P.load(slug, { fresh: true })).learnedHide.has('m03-1'), false);
  assert.equal(await L.confirm(slug, 'bring back the moon'), null, 'no such card: a normal chat');
});

test('a high-impact move rewrites now even if it was rewritten today (that rewrite did not know this); a medium one waits', async () => {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-')), { P, builder, slug } = await brand(ROOT), asked = [];
  const mv = await P.getJSON(slug, 'moves.json'); for (const n of [3, 9]) mv[n].meta = { rewrittenAt: new Date(Date.now() - 600e3).toISOString() }; await P.put(slug, 'moves.json', mv);
  const ai = scripted(), call0 = ai.call;
  ai.call = async (o) => o.tag !== 'learn-plan' ? call0(o) : { usd: 0.01, json: { stale: [{ n: 3, impact: 'high', why: 'Ruled out.', uses: [] }, { n: 9, impact: 'medium', why: 'Goal first.', uses: [] }], fresh: [], cards: {} } };
  const L = createLearnings({ ai, packs: P, builder: { flagStale: builder.flagStale, busy: () => false, rewrite: async (s, ns) => { asked.push(ns); return { ok: true }; } }, log: quiet, env: {} });
  const r = await saved(L, slug, { text: CALL, by: 'p@glow.in', byShort: 'Priya' });
  assert.deepEqual(asked, [[3]]); assert.match(r.reply, /- In the weekly run: Move 09 \(rewritten in the last day\)\./);
});

test('a card is hidden only on a clear contradiction: a hedged reason keeps it', async () => {
  const { vetCardPlan } = await import('../brand-learnings.js');
  const cards = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const v = vetCardPlan({ hide: [{ id: 'a', why: 'They said gifting got zero orders.' }, { id: 'b', why: 'It might conflict with their price rule.' }] }, cards);
  assert.deepEqual(v.hide.map((x) => x.id), ['a']);
});

test('one view of the market: a card hidden for the wrong market means no card naming it is lifted', async () => {
  const { vetCardPlan } = await import('../brand-learnings.js');
  const cards = [{ id: 'in', title: 'Switch the store to INR', sub: 'For Indian shoppers' }, { id: 'amz', title: 'Launch the Paw Warmer on Amazon India', sub: '' }, { id: 'pdp', title: 'Add a trust block to the Paw Warmer page', sub: '' }];
  const v = vetCardPlan({ hide: [{ id: 'in', why: 'It targets India, whereas most buyers are in the US.' }], up: [{ id: 'amz', why: 'Hero product.' }, { id: 'pdp', why: 'Hero product.' }] }, cards);
  assert.deepEqual(v.up.map((x) => x.id), ['pdp']);
});

test('the market check never blocks the brand’s own market named in the reason', async () => {
  const { vetCardPlan } = await import('../brand-learnings.js');
  const cards = [{ id: 'in', title: 'Switch the store to INR', sub: 'For Indian shoppers' }, { id: 'us', title: 'Run Meta ads to US cat owners', sub: '' }];
  const v = vetCardPlan({ hide: [{ id: 'in', why: 'It targets India, whereas most buyers are in the US.' }], up: [{ id: 'us', why: 'Their buyers are US cat owners.' }] }, cards);
  assert.deepEqual(v.up.map((x) => x.id), ['us']);
});

test('what did not work, card by card: every card repeating it steps off the top with the team’s words', async () => {
  const { vetCardPlan } = await import('../brand-learnings.js');
  const cards = [{ id: 'g', title: 'Send gift packs to micro creators' }, { id: 'h', title: 'Seed warmers to pet influencers' }, { id: 'k', title: 'Fix the checkout' }];
  const items = [{ kind: 'tried', text: 'Influencer gifting to ten pet influencers got zero orders.' }];
  const v = vetCardPlan({ repeats: [{ uses: 0, ids: ['g', 'h', 'nope'] }], hide: [] }, cards, items);
  assert.deepEqual(v.hide.map((x) => x.id), ['g', 'h']);
  assert.equal(v.hide[0].why, 'It repeats what the team said did not work: Influencer gifting to ten pet influencers got zero orders.');
});
