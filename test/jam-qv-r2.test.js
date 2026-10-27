// Jam QV round 2 (26 Oct, docs/qv/jam-r2.md): the words a piece goes out with are about the product it shows (P0-1, P1-15, P1-19),
// the brand's own price rounded to whole rupees is still its price (N-P1-3), the maker reads the brand's rules whole (N-P1-5, P1-17),
// and the brief stays the same until the piece changes (P1-16). Every brand: a hair store, a pet store, a bundle, other sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readyOf, otherNamed, pkgWordsOf } from '../publish-ready.js';
import { allowedFrom, unbacked, canon, backs, wholeTwin } from '../fact-gate.js';
import { sourceText, withWhole } from '../claims.js';
import { contextOf, healDir, rulesOf } from '../jam2/context.js';
import { fitDirection, healDirection } from '../jam2/kit-colours.js';
import { createDocSync } from '../shared-doc.js';
import { createTeamBrief } from '../team-brief.js';
import { createRemix } from '../remix.js';
import { configureGen } from '../gen-store.js';
import { runIn } from '../brand-ctx.js';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ARATA = [{ t: 'Sleek Hair Styling Stick - 15 ml', price: '349', img: 'stick.png' }, { t: 'Anti-Hair Fall Intensive Shampoo - 200 ml', price: '449', img: 'sh.png' },
  { t: 'Anti-Hair Fall Intensive Shampoo - 15 ml', price: '0', img: 'sh15.png' }, { t: 'MitoActive Hair Growth Serum - 30 ml', price: '999', img: 'serum.png' },
  { t: 'MitoActive + Anti-Hair Fall Shampoo & Conditioner Combo', price: '2182.15', img: 'combo.png' }, { t: 'Anti-Breakage Intensive Conditioner - 15ml', price: '0', img: 'c15.png' }];
const COZY = [{ t: 'Snugglet Paw Warmer', price: '$39.99', img: 'paw.png' }, { t: 'Snugglet Toe Toasters', price: '$29.99', img: 'toe.png' }, { t: 'The Desk Day Kit', price: '$59', img: 'kit.png' }];
const STICK = { name: 'Sleek Hair Styling Stick - 15 ml' };

/* ---------- 1. words about another product (P0-1, P1-15) ---------- */
test('P0-1: words naming another catalog product than the piece shows are found, by name, by kind and by hashtag', () => {
  const by = (text, p = STICK, cat = ARATA, b = 'Arata') => otherNamed(text, p, cat, b).map((x) => `${x.kind}:${x.said}`);
  assert.deepEqual(by('Rosemary and caffeine in our Anti-Hair Fall Intensive Shampoo. #antihairfall #arata'), ['name:Anti-Hair Fall Intensive Shampoo', 'tag:#antihairfall']);
  assert.deepEqual(by('Wash it, then apply your scalp serum directly to the roots.'), ['kind:scalp serum'], 'P1-15: a serum named by its kind on the stick\'s carousel');
  assert.deepEqual(by('Shampoo your hair, then tame flyaways with the Sleek Hair Styling Stick. After you shampoo, swipe it on.'), [], 'the verb is no product');
  assert.deepEqual(by('The Styling Stick tames flyaways in seconds.'), [], 'its own name, shortened');
  assert.deepEqual(by('A 200 ml bottle of rich lather.', { name: 'Anti-Hair Fall Intensive Shampoo - 15 ml' }), [], 'the same product in another size is no other product');
  assert.deepEqual(by('Serum, shampoo and conditioner in one combo.', { name: ARATA[4].t }), [], 'the pieces of the jam\'s own bundle');
  assert.deepEqual(by('Toasty toes all winter with Snugglet Toe Toasters.', { name: 'Snugglet Paw Warmer' }, COZY, 'Snugglet'), ['name:Snugglet Toe Toasters'], 'any brand: a pet store');
  assert.deepEqual(by('Warm paws on every walk.', { name: 'Snugglet Paw Warmer' }, COZY, 'Snugglet'), []);
});

test('P0-1: the words check turns red with a words-only Fix it; a carousel of several products is about all of them', () => {
  const pkg = { slides: [{ onSlide: 'Evening routine > morning wash.' }, { onSlide: 'Wash away the day\'s buildup.', imageBrief: 'Photo of Anti-Hair Fall Intensive Shampoo 200ml bottle' }], caption: 'Rosemary and caffeine for a calmer scalp.', hashtags: ['#antihairfall', '#arata'] };
  const r = readyOf({ family: 'social', action: 'social.ig_story', pkg, product: STICK, catalog: ARATA, brand: 'Arata', host: 'arata.in' }), m = r.checks.find((c) => c.k === 'match');
  assert.equal(m.ok, false); assert.ok(!m.soft, 'red, not advice'); assert.equal(m.fix, 'words'); assert.equal(r.ready, false);
  assert.match(m.t, /about Anti-Hair Fall Intensive Shampoo.*shows Sleek Hair Styling Stick/); assert.match(m.ask, /Rewrite them for Sleek Hair Styling Stick - 15 ml/); assert.match(m.ask, /change only the words/);
  assert.match(pkgWordsOf(pkg), /Photo of Anti-Hair Fall/, 'the slides\' picture notes are words of the package too');
  const ok = readyOf({ family: 'social', action: 'social.ig_carousel', pkg: { slides: [{ onSlide: 'Tame flyaways' }], caption: 'Sleek Hair Styling Stick, in your bag.', hashtags: ['#hair', '#arata', '#sleek'] }, product: STICK, catalog: ARATA, brand: 'Arata', host: 'arata.in' });
  assert.ok(!ok.checks.some((c) => c.k === 'match' && !c.ok), 'the stick\'s own words pass');
  const many = readyOf({ family: 'meta_ad', pkg: { primaryText: 'Anti-Hair Fall Intensive Shampoo and more.', headline: 'H', cta: 'Shop now', cards: [{ headline: 'a' }, { headline: 'b' }] }, product: STICK, catalog: ARATA, brand: 'Arata', host: 'arata.in' });
  assert.ok(!many.checks.some((c) => c.k === 'match' && !c.ok), 'a carousel ad of several products');
  /* the bar's Fix it sends the check's own ask, and the server takes it from there: text only */
  const app = src('public/app.js'); assert.match(app, /message: x\.ask \|\| `Fix \$\{what\}/); assert.match(app, /\.\.\.\(x\.k \? \{ check: x\.k \} : \{\}\)/);
  const rx = src('remix.js'); assert.match(rx, /const wordsFix = b\.fix && b\.check === 'match' \? otherLeft\(\) : null;/); assert.match(rx, /!keepPhoto && !wordsOnly/);
  assert.match(rx, /const name = jp\?\.t \|\| jp\?\.name \|\| sv\?\.product\?\.name/, 'the check reads the jam\'s product (a pick, a made version\'s, the card\'s)');
});

/* the remix harness: a hair store's Stories jam made in Studio with the stick, its words about the shampoo */
process.env.AI_MOCK = '1';
const BRAND = { slug: 'arata-in', name: 'Arata', host: 'arata.in', sym: '₹', config: { product: { noun: 'hair care' } }, seed: { brand: { name: 'Arata', host: 'arata.in' } } };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-r2-')); fs.mkdirSync(path.join(DIR, 'gen'), { recursive: true }); configureGen({ dir: path.join(DIR, 'gen'), remote: false, log: { warn() {} } });
const quiet = { warn() {}, log() {}, error() {} };
const harness = (ai = null, extra = {}) => { const R = {}, on = (m, pat, fn) => (R[`${m} ${pat}`] = fn); let n = 0;
  const RMX = createRemix({ on, catalogOf: () => ARATA, claudeTool: ai, mediaFake: true, PUB: DIR, LANE_PHOTO: {}, FACTS: {}, SEED: { connectors: { meta: { name: 'Meta Ads' } }, colleagues: [] }, AGENT: { creative: 'Creative' }, cardBrief: () => '', seatLine: () => '', qaCheck: () => [], mechanicalFix: (x) => x, clean: (x) => String(x ?? ''), BANNED: /$^/,
    isMock: () => !ai, spend: () => true, uid: (p) => `${p}_${++n}`, now: (t) => Date.now() + (t?.clock || 0), clone: (x) => JSON.parse(JSON.stringify(x)), inr: (x) => `₹${x}`, say: (t, w, m) => w.thread.push(m), move: () => {}, notify: () => {}, curV: (w) => w.versions.at(-1), log: quiet, ...extra });
  return { RMX, call: (key, b, t, p) => runIn(BRAND, () => R[key](b, t, p)) }; };
const card = { id: 'c1', title: 'Launch Baal Ki Baat on Instagram Stories', sub: 'Three stories for the Sleek Hair Styling Stick', agent: 'creative', sector: 'creatives', type: 'idea', cta: { label: 'Make the stories' }, make: { format: 'instagram stories' }, images: ['stick.png'], detail: { why: ['Stories reach 2x'], how: [] } };
const tenant = () => ({ id: 't_1', brandId: 'arata-in', clock: 0, cards: new Map([['c1', card]]), changes: {}, work: [], conn: {}, acted: new Set(), shown: {} });
const madeJam = async (S, t) => { const r = await S.call('POST /api/cards/:cid/remix', { fast: true }, t, { cid: 'c1' }); const id = r.changes[0].id, ch = t.changes[id];
  ch.family = 'social'; ch.action = 'creative.ig_story';
  S.RMX.landStudio(t, id, { file: 'gen/s1.jpg', slides: [{ file: 'gen/s1.jpg' }, { file: 'gen/s2.jpg' }, { file: 'gen/s3.jpg' }], studio: { kind: 'image', label: 'Stories', spec: { product: { name: 'Sleek Hair Styling Stick - 15 ml', img: 'stick.png' } } } });
  ch.pkg = { ...ch.pkg, slides: [{ onSlide: 'Evening routine > morning wash.', imageBrief: 'The stick in hand' }, { onSlide: 'Wash away the day\'s buildup.', imageBrief: 'Photo of Anti-Hair Fall Intensive Shampoo 200ml bottle' }], caption: 'Rosemary and caffeine in our Anti-Hair Fall Intensive Shampoo.', hashtags: ['#antihairfall', '#arata', '#haircare'] };
  return { id, ch }; };

test('P0-1 heal on read: a saved jam whose words name the shampoo under the stick\'s picture shows the red words check, free', async () => {
  const S = harness(), t = tenant(), { ch } = await madeJam(S, t);
  const pb = S.RMX.pubChange(t, ch).publish, m = pb.checks.find((c) => c.k === 'match');
  assert.equal(m?.ok, false, 'red on the next read'); assert.ok(!m.soft); assert.deepEqual(m.of, ['Anti-Hair Fall Intensive Shampoo']);
  assert.equal(S.RMX.pubChange(t, ch).product.name, 'Sleek Hair Styling Stick - 15 ml', 'the jam\'s product is the made picture\'s');
});

test('P0-1 Fix it: the words are rewritten for the jam\'s product, text only (a new photo is never started), and the check clears', async () => {
  const asks = []; let drawn = 0;
  const ai = async (prompt, schema, mx, tag) => { if (tag !== 'studio_iterate') return null; asks.push(prompt);
    return { reply: 'Rewrote the caption and slides for the Sleek Hair Styling Stick.', label: 'For the stick', next: [], newImage: true /* a model asking for a new photo on a words fix is never obeyed */,
      pkg: [{ k: 'caption', v: 'Tame flyaways on the go with the Sleek Hair Styling Stick.' }, { k: 'hashtags', v: '#sleekhair #arata #flyaways' }, { k: 'slides', v: 'Evening routine > morning wash. | The stick in hand\nOne swipe, smooth all day. | The stick on a vanity' }] }; };
  const S = harness(ai, { geminiImage: async () => { drawn++; return Buffer.from('89504e470d0a1a0a', 'hex'); } }), t = tenant(), { id, ch } = await madeJam(S, t);
  const m = S.RMX.pubChange(t, ch).publish.checks.find((c) => c.k === 'match');
  await S.call('POST /api/changes/:chid/iterate', { message: 'Fix this', fix: true, check: 'match', show: `Fix: ${m.t}`, wait: true }, t, { chid: id });
  assert.match(asks[0] || '', /Rewrite them for Sleek Hair Styling Stick - 15 ml/, 'the server sends the check\'s own ask');
  assert.equal(drawn, 0, 'no picture drawn'); assert.ok(!ch.imagePending, 'no new photo started');
  assert.doesNotMatch(pkgWordsOf(ch.pkg), /Anti-Hair Fall|antihairfall/i, `the words follow the stick: ${pkgWordsOf(ch.pkg)}`);
  assert.ok(!(S.RMX.pubChange(t, ch).publish.checks.find((c) => c.k === 'match' && !c.ok)), 'the check clears');
});

test('P1-19: a new chat line never says the jam moved to another product; the person naming it is the exception', async () => {
  let reply = 'Updated the product focus to Anti-Hair Fall Intensive Shampoo. Tightened the hook.';
  let n = 0; /* each ask really changes the words: a reply about words that didn't change is "Nothing changed" (27 Oct) */
  const ai = async (prompt, schema, mx, tag) => (tag === 'studio_iterate' ? { reply, label: 'Shorter hook', next: [], newImage: false, pkg: [{ k: 'caption', v: `Tame flyaways with the Sleek Hair Styling Stick${'!'.repeat(++n)}` }] } : null);
  const S = harness(ai), t = tenant(), { id, ch } = await madeJam(S, t);
  const old = { from: 'ai', text: 'Updated the product focus to Anti-Hair Fall Intensive Shampoo', at: 1 }; ch.thread.unshift(old);
  await S.call('POST /api/changes/:chid/iterate', { message: 'Make the hook shorter', wait: true }, t, { chid: id });
  const line = ch.thread.filter((x) => x.from === 'ai').at(-1).text; assert.doesNotMatch(line, /Shampoo/, line); assert.match(line, /Tightened the hook/);
  assert.equal(ch.thread[0], old, 'history is not rewritten');
  reply = 'Updated the product focus to Anti-Hair Fall Intensive Shampoo.';
  await S.call('POST /api/changes/:chid/iterate', { message: 'Make the words punchier', wait: true }, t, { chid: id });
  assert.match(ch.thread.filter((x) => x.from === 'ai').at(-1).text, /^Updated the words for the Sleek Hair Styling Stick\.$/);
  reply = 'Switched it to the Anti-Hair Fall Intensive Shampoo.';
  await S.call('POST /api/changes/:chid/iterate', { message: 'Write the words for the Anti-Hair Fall Intensive Shampoo', wait: true }, t, { chid: id });
  assert.match(ch.thread.filter((x) => x.from === 'ai').at(-1).text, /Anti-Hair Fall Intensive Shampoo/, 'they asked for it: the line says so');
});

test('P1-15 on a draft: a piece not made in Studio flags another product\'s words in its own checks', async () => {
  const S = harness(), t = tenant(), r = await S.call('POST /api/cards/:cid/remix', { fast: true }, t, { cid: 'c1' }), ch = t.changes[r.changes[0].id];
  ch.family = 'social'; ch.action = 'creative.ig_carousel'; ch.pkg = { ...ch.pkg, slides: [{ onSlide: 'Tame flyaways' }, { onSlide: 'Wash it, then apply your scalp serum directly to the roots.' }], caption: 'The Sleek Hair Styling Stick, in your bag.' };
  const pc = S.RMX.pubChange(t, ch); const flagged = (pc.checks || []).find((c) => c.product);
  if (pc.publish) assert.ok(pc.publish.checks.some((c) => c.k === 'match' && !c.ok), 'Studio piece: the publish check'); else assert.ok(flagged && !flagged.ok, 'draft piece: the jam check');
});

/* ---------- 2. whole-rupee prices (N-P1-3) ---------- */
test('N-P1-3: ₹2,182 is the fact sheet\'s ₹2,182.15 in the fact gate, the publish check and the brand\'s words; other currencies stay exact', () => {
  assert.equal(wholeTwin('₹2182.15'), '₹2182'); assert.equal(wholeTwin('₹2182.65'), '₹2183'); assert.equal(wholeTwin('$29.99'), null, 'rupees only');
  const ok = allowedFrom({ combo: { v: '₹2,182.15' }, tee: { v: '$29.99' } });
  assert.ok(ok.has(canon('₹2,182')) && ok.has(canon('₹2,182.15'))); assert.ok(!ok.has(canon('$30')));
  assert.deepEqual(unbacked({ text: 'The combo for ₹2,182. Rs. 2182 today.' }, ok), [], 'LinkedIn and WhatsApp: no "Numbers not in the fact sheet"');
  assert.equal(unbacked({ text: 'Only ₹2,190' }, ok).length, 1, 'a different number is still caught');
  assert.ok(backs(new Set(['₹2182.15']), '₹2182'), 'any allowed set: the jam\'s connected numbers, a research card\'s');
  const proxy = { has: (n) => n === '₹2182.15', [Symbol.iterator]: function* () { yield '₹2182.15'; } }; assert.ok(backs(proxy, '₹2182'), 'the feed\'s live fact set');
  assert.match(withWhole('combo ₹2,182.15 ¶ rs. 449.50'), /₹2,182 ₹2182 ₹450 ₹450|₹2,182 ₹2182 ₹450/);
  assert.match(sourceText(['MitoActive Combo: ₹2,182.15']), /₹2,182(?!\.)/, 'the claims source carries the rounding');
  const r = readyOf({ family: 'post', action: 'post.linkedin', pkg: { title: 'Our combo', copy: 'The combo for ₹2,190, delivered.' }, source: 'facts: combo price ₹2,182.65', brand: 'Arata', host: 'arata.in' });
  assert.equal(r.checks.find((c) => c.k === 'price').ok, false, 'a price that isn\'t the store\'s is still caught');
  const r2 = readyOf({ family: 'post', action: 'post.linkedin', pkg: { title: 'Our combo', copy: 'The combo for ₹2,183, delivered.' }, source: 'facts: combo price ₹2,182.65', brand: 'Arata', host: 'arata.in' });
  assert.equal(r2.checks.find((c) => c.k === 'price').ok, true, 'the publish check reads the facts\' price rounded');
  assert.match(src('feed-service.js'), /have\.findIndex\(\(h\) => h === n \|\| wholeTwin\(h\) === n\)/, 'title prices match the text\'s rounded price');
});

/* ---------- 3. what the maker reads (N-P1-5, P1-17) ---------- */
test('N-P1-5: the direction keeps the brand\'s colours and Never rules whole, first, for a set of many styles; never cut mid-sentence', () => {
  const bbv = { kit: { colors: ['#0e7c7b', '#f4efe6'], logo: 'l.png' }, never: ['Dermat-approved.', 'cure', 'Before/after photos'] };
  const ctx = { card: { title: 'x' }, bbv, product: { name: 'Sleek Hair Styling Stick - 15 ml for flyaways, baby hair and sleek buns on the go', img: 'p.png' }, v1: { headline: 'Evening routine beats a morning wash every single time, and here is exactly why it works.' } };
  const d = contextOf(ctx, { kind: 'image', set: ['studio-white', 'in-use', 'flatlay', 'closeup', 'lifestyle'] }).slots.direction;
  assert.ok(d.value.length <= 900, `${d.value.length}`); assert.match(d.value, /In the brand’s deep teal and off-white\./); assert.match(d.value, /Never: Dermat-approved; cure; Before\/after photos\./);
  assert.ok(d.value.indexOf('In the brand’s') < 200, 'the rules come first'); assert.match(d.value, /[.!?”]$/, 'ends on a whole sentence'); assert.deepEqual(d.rules, [rulesOf(bbv).colours, rulesOf(bbv).never]);
  const long = ['P, exactly as in its photos.', ...Array.from({ length: 30 }, (_, i) => `Look ${i} with plenty of words to fill the line up.`), 'In the brand’s deep teal.', 'Never: say cure.'].join(' '), f = fitDirection(long, 300);
  assert.ok(f.length <= 300); assert.match(f, /In the brand’s deep teal\. Never: say cure\.$/, 'rules kept even when they came last'); assert.match(f, /^P, exactly as in its photos\./);
  for (const file of ['jam2/studio.js', 'jam2/context.js']) assert.doesNotMatch(src(file), /tidy\(spec\.direction, 600\)|\.join\(' '\), 600\)/, `${file}: no 600-character cut`);
  assert.match(src('jam2/creative.js'), /The direction for this piece\/\.test\(n\) \? tidy\(n, 1000\)/); assert.match(src('jam2/make.js'), /The direction for this piece\/\.test\(n\) \? 1000 : 600/);
});

test('P1-17 heal: a saved direction with stock blue hex and bad joins reads in the brand\'s colours, whole, with its rules back', () => {
  const old = 'Sleek Hair Styling Stick - 15 ml, exactly as in its photos. The product in use.; The product held up. Built around: “Evening routine > morning wash.”. In the brand colours #82b1ff, #3b82f6, #34';
  const a = healDirection(old); assert.doesNotMatch(a, /#[0-9a-f]{2,6}/i); assert.doesNotMatch(a, /\.;|\.”\./); assert.match(a, /No brand colours in the Brand Book yet/);
  const b = healDir(old, { kit: { colors: ['#82b1ff', '#0e7c7b'] }, never: ['Dermat-approved'] });
  assert.match(b, /In the brand’s deep teal\./, 'the kit\'s own colours, never the stock blue'); assert.match(b, /Never: Dermat-approved\./, 'the Never rules a cut had dropped are back'); assert.equal(healDir(b, { kit: { colors: ['#0e7c7b'] }, never: ['Dermat-approved'] }), b, 'healing twice changes nothing');
  assert.equal(healDir('In the brand’s deep teal. Warm light.', { kit: { colors: ['#0e7c7b'] } }), 'In the brand’s deep teal. Warm light.', 'a clean one stays as it is');
  const rt = src('jam2/routes.js'); assert.match(rt, /const healDirs = async \(t, j\)/); assert.match(rt, /if \(await healDirs\(t, jam\)\.catch\(\(\) => false\)\) await store\.put\(slug, jam\)/);
});

/* ---------- 4. the brief stays the same until the piece changes (P1-16) ---------- */
test('P1-16: a pull from another instance keeps a held jam live, so a brief written across the await is kept', async () => {
  let parts = new Map(); const packs = { async patchParts(slug, name, set, del) { for (const [p, b] of set) parts.set(p, b); for (const p of del) parts.delete(p); return 1; }, async getParts() { return [...parts].map(([part, b], ord) => ({ part, ord, body: Buffer.from(b) })); } };
  const A = { work: [{ id: 'w1', title: 'Stories', doc: { rev: 2 } }, { id: 'w2', title: 'Other' }] }, B = JSON.parse(JSON.stringify(A));
  const a = createDocSync({ packs, slug: 's', name: 'private/jams.json', fields: ['work'] }), b = createDocSync({ packs, slug: 's', name: 'private/jams.json', fields: ['work'] });
  await a.push(A); a.settle(A); b.settle(B);
  const held = A.work[0]; /* the brief's request holds this jam while the AI writes */
  B.work[1].title = 'Other, renamed'; await b.push(B); await a.pull(A); /* meanwhile another instance writes the jams */
  assert.equal(A.work[0], held, 'the same object: nothing let go'); held.teamBrief = { key: 'k1' };
  assert.equal(A.work[0].teamBrief.key, 'k1', 'the brief lands on the live jam'); assert.equal(A.work[1].title, 'Other, renamed', 'and the other write is taken');
});

test('P1-16: the open and the PDF asking at once write one brief; the next open a minute later reads it as it was', async () => {
  let writes = 0, t0 = 1000; const X = { title: 'Stories', brand: 'Arata', memo: {}, card: { title: 'Launch', sub: '', agent: 'Creative', rows: [], why: [] }, page: {}, brief: { md: '', missing: [] }, questions: [], pkg: { id: 'ch1', version: 3, action: 'Instagram Stories', fields: [], assets: [] } };
  const TB = createTeamBrief({ isMock: () => false, spend: () => true, now: () => t0, handoff: { build: async () => X },
    claudeTool: async () => { writes++; await new Promise((r) => setTimeout(r, 20)); return { title: `Stories ${writes}`, what: 'w', why: 'y', who: `Young men ${writes}`, creative: 'c', specs: 's', rules: 'r', when: 'To confirm.', done: 'd', open: [], evidence: [{ say: `Fact ${writes}`, src: 'The card' }] }; } });
  const w = { id: 'w1', doc: { rev: 2 } };
  const [a, b] = await Promise.all([TB.build({}, w), TB.build({}, w)]); assert.equal(writes, 1, 'one writing'); assert.equal(a.tb, b.tb);
  const v1 = TB.view(w, a.x); t0 += 60e3; const { x } = await TB.build({}, w); const v2 = TB.view(w, x);
  assert.equal(writes, 1, 'not written again'); assert.deepEqual(v2.sections, v1.sections); assert.deepEqual(v2.evidence, v1.evidence);
  X.pkg.version = 4; await TB.build({}, w); assert.equal(writes, 2, 'a new version of the piece writes it again'); X.pkg.version = 3;
});
