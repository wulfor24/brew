// Sets on the creative stage (Brew Studio, 24 Oct): a set is made slide by slide; one slide can be made again (priced) or dropped
// (free) or one added, each landing as the set's next take and the v1 jam's next version; Amazon A+ is a set of modules at
// Amazon's own sizes whose words are page text, held to Amazon's content rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AI_MOCK = '1';
const { mountJam2 } = await import('../jam2/routes.js');
const G = await import('../gen-store.js');
const { defaults, styleOf } = await import('../jam2/studio.js');
const { SIZES } = await import('../jam2/catalogue.js');
const { readyOf } = await import('../publish-ready.js');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sets-')); G.configureGen({ dir: DIR, remote: false, log: { warn() {} } });
const quiet = { warn() {}, log() {}, error() {} };

const mount = (mem = new Map()) => {
  const R = {}, on = (m, p, fn) => (R[`${m} ${p}`] = fn), landed = [], states = [];
  const packs = { getJSON: async (s, f, d) => (mem.has(`${s}/${f}`) ? structuredClone(mem.get(`${s}/${f}`)) : d), putJSON: async (s, f, v) => { mem.set(`${s}/${f}`, structuredClone(v)); return true; }, put: async (s, f, v) => { mem.set(`${s}/${f}`, structuredClone(v)); return true; } };
  const card = { id: 'c1', title: 'Listing photos', cta: { label: 'Add the photos' } }, t = { id: 't1', brandId: 'acme', cards: new Map([['c1', card]]), changes: { ch1: { id: 'ch1' } }, work: [] };
  mountJam2({ on, packs, slugOfT: () => 'acme', brandOfT: () => ({ catalog: [{ t: 'Balm', img: 'balm.png' }], config: {} }), meOf: () => ({ email: 'a@acme.com' }), reqOf: () => ({ member: true }), cardOf: (tt, id) => tt.cards.get(id), sourceOf: () => '', refsOf: async () => [], isMock: () => true, spend: () => true, saveGen: G.saveGen, genFile: G.genFile, log: quiet,
    onStudioTake: (tt, chId, tk) => landed.push(tk.slides.map((x) => x.style)), onStudioState: (tt, chId, st) => states.push(st.state) });
  return { R, t, landed, states, mem };
};
const until = async (R, t, jid, bid) => { for (let k = 0; k < 300; k++) { const g = await R['GET /api/jam2/jams/:jid']({}, t, { jid }); const b = g.jam.busy?.[bid]; if (!b || b.error) return g; await new Promise((r) => setTimeout(r, 100)); } throw new Error('still busy'); };

test('a set made in Studio: redo one slide, drop one, add one; each lands in the v1 jam, the rest kept', { timeout: 120e3 }, async () => {
  const { R, t, landed, states } = mount();
  const o = await R['POST /api/jam2/open']({ cardId: 'c1', cta: 'Add the photos', v1ch: 'ch1' }, t, {}); const jid = o.jam.id, bid = o.jam.boards[0].id;
  const d = await R['GET /api/jam2/jams/:jid/studio']({}, t, { jid }, new URLSearchParams(`bid=${bid}`)); assert.ok(Array.isArray(d.defaults.set), 'a listing opens as a set');
  const spec = { ...d.defaults, set: ['mp-lifestyle', 'in-use', 'closeup'] }, pl = (await R['POST /api/jam2/jams/:jid/studio/plan']({ spec }, t, { jid })).plan;
  await R['POST /api/jam2/jams/:jid/studio/make']({ spec, confirmUsd: pl.usd, bid }, t, { jid }); let g = await until(R, t, jid, bid);
  assert.equal(g.jam.busy?.[bid]?.error, undefined, g.jam.busy?.[bid]?.error); assert.deepEqual(landed.at(-1), ['mp-lifestyle', 'in-use', 'closeup']);
  const drop = await R['POST /api/jam2/jams/:jid/studio/slide']({ bid, i: 1, op: 'drop' }, t, { jid }); assert.ok(!drop.error, drop.error); assert.deepEqual(landed.at(-1), ['mp-lifestyle', 'closeup'], 'drop is free and keeps the others');
  assert.match((await R['POST /api/jam2/jams/:jid/studio/slide']({ bid, i: 0, op: 'drop' }, t, { jid })).error, /at least two/);
  const redo = await R['POST /api/jam2/jams/:jid/studio/slide']({ bid, i: 1, op: 'redo', confirmUsd: 1 }, t, { jid }); assert.ok(!redo.error, redo.error); await until(R, t, jid, bid);
  assert.deepEqual(landed.at(-1), ['mp-lifestyle', 'closeup'], 'the same slide, made again');
  const add = await R['POST /api/jam2/jams/:jid/studio/slide']({ bid, op: 'add', style: 'flat-lay', confirmUsd: 1 }, t, { jid }); assert.ok(!add.error, add.error); await until(R, t, jid, bid);
  assert.deepEqual(landed.at(-1), ['mp-lifestyle', 'closeup', 'flat-lay']); assert.ok(states.includes('making'));
  g = await R['GET /api/jam2/jams/:jid']({}, t, { jid }); assert.equal(g.jam.boards.find((b) => b.id === bid).takes.length, 4, 'every change is its own take; nothing is lost');
});

test('Amazon A+ opens as its modules at Amazon’s own sizes; module words follow Amazon’s rules', () => {
  const d = defaults({ card: { title: 'A+ for the balm' }, product: { img: 'p.jpg', name: 'Balm' }, bbv: { comfort: { people: 'ai-cast' } } }, { kind: 'carousel', recipe: 'aplus' });
  assert.deepEqual(d.set, ['aplus-hero', 'aplus-use', 'aplus-detail', 'aplus-hands', 'aplus-wide']);
  assert.equal(SIZES[styleOf('aplus-hero').size].w, 970); assert.equal(SIZES[styleOf('aplus-use').size].w, 300); assert.equal(SIZES[styleOf('aplus-wide').size].h, 300);
  const none = defaults({ card: { title: 'A+' }, product: { img: 'p.jpg', name: 'Balm' }, bbv: { comfort: { people: 'none' } } }, { kind: 'carousel', recipe: 'aplus' }); assert.ok(!none.set.includes('aplus-hands') && none.set.includes('aplus-use'), 'no hands tile when the Brand Book says no people');
  const r = readyOf({ family: 'listing', pkg: { aplus: [{ kind: 'header', image: 'h.jpg', headline: 'Balm' }, { kind: 'tile', image: 'a.jpg', headline: 'Soft hands', body: 'Every morning.' }, { kind: 'tile', image: 'b.jpg', headline: 'The #1 balm', body: 'Only ₹299, rated 4.8 stars' }, { kind: 'wide', image: 'w.jpg', headline: 'Free shipping today', body: '' }] }, brand: 'Acme', host: 'acme.com' });
  assert.equal(r.ready, false); const why = r.parts.flatMap((x) => x.why).join(' | ');
  for (const w of ['“best” or “#1”', 'a price or a deal', 'a rating or a review', 'shipping or a guarantee']) assert.ok(why.includes(w), `${w}: ${why}`);
  assert.ok(!r.parts.some((x) => x.k === 'link'), 'A+ takes no link'); assert.ok(r.places.some((x) => x.where === 'A+ header'));
});

test('a set a restart cut off picks up where it stopped: the slides it already made are reused, never bought again', { timeout: 120e3 }, async () => {
  const mem = new Map(), A = mount(mem);
  const o = await A.R['POST /api/jam2/open']({ cardId: 'c1', cta: 'Add the photos', v1ch: 'ch1' }, A.t, {}); const jid = o.jam.id, bid = o.jam.boards[0].id;
  const d = await A.R['GET /api/jam2/jams/:jid/studio']({}, A.t, { jid }, new URLSearchParams(`bid=${bid}`)); const spec = { ...d.defaults, set: ['mp-lifestyle', 'in-use', 'closeup'] };
  for (let k = 0; k < 50 && !mem.get('acme/private/jams-v2.json')?.jams?.[jid]; k++) await new Promise((r) => setTimeout(r, 100));
  /* the first slide was made before the restart: the run wrote it down on the board, which was saved */
  const file = mem.get('acme/private/jams-v2.json'); assert.ok(file?.jams?.[jid], 'the jam was saved');
  file.jams[jid].boards.find((b) => b.id === bid).hfJobs = { [`set:0:mp-lifestyle,in-use,closeup:${(spec.product?.img || '').slice(0, 80)}:0`]: { slide: { file: 'gen/kept-0.jpg', style: 'mp-lifestyle', scene: { w: 1, h: 1, layers: [] }, words: { headline: 'kept' } } } };
  const B = mount(mem); /* the new instance */
  const pl = (await B.R['POST /api/jam2/jams/:jid/studio/plan']({ spec }, B.t, { jid })).plan; const mk = await B.R['POST /api/jam2/jams/:jid/studio/make']({ spec, confirmUsd: pl.usd, bid }, B.t, { jid }); assert.ok(!mk.error, mk.error);
  const g = await until(B.R, B.t, jid, bid), bd = g.jam.boards.find((b) => b.id === bid), head = bd.takes.at(-1);
  assert.equal(head.slides[0].file, 'gen/kept-0.jpg', 'the slide made before the restart is the one used'); assert.equal(head.slides.length, 3);
  assert.deepEqual(B.landed.at(-1), ['mp-lifestyle', 'in-use', 'closeup']);
});

test('a review count in the picture is checked too: "from 226 reviews" passes only when the brand’s own reviews say 226', () => {
  const base = { family: 'social', pkg: { caption: 'Curls, sorted.', hashtags: ['#a', '#b', '#c'] }, brand: 'Acme', host: 'acme.com', words: ['4.5★ from 226 reviews'] };
  assert.match(readyOf({ ...base, source: 'customers rate it 4.5 stars' }).checks.find((c) => c.k === 'rating').t, /226 reviews/);
  assert.equal(readyOf({ ...base, source: 'Judge.me: 4.5 stars from 226 reviews' }).checks.find((c) => c.k === 'rating').ok, true);
});

test('Recreate runs only on the brand’s own videos; a creator’s or rival’s video opens on a viral short in its pattern, up to 30 s', async () => {
  const { blockOf } = await import('../jam2/studio.js');
  const ctx = { product: { img: 'p.jpg', name: 'Serum' }, bbv: { comfort: { people: 'ai-cast' } } };
  assert.match(blockOf(styleOf('recreate-swap'), ctx), /your own videos/);
  /* someone else's video (a creator's, a rival's): never recreated, their people and words would be in the brand's ad */
  assert.match(blockOf(styleOf('recreate-swap'), { ...ctx, ref: { video: 'https://x/v.mp4', author: 'Michaela' } }), /Michaela’s own people, face, voice and words/);
  assert.equal(blockOf(styleOf('recreate-swap'), { ...ctx, ref: { video: 'https://x/v.mp4', own: true } }), null, 'the brand’s own video can be recreated');
  const d = defaults({ ...ctx, card: { title: 'This hook went viral', research: { kind: 'viral' } }, ref: { video: 'https://x/v.mp4' } }, { kind: 'video', recipe: 'reel' }); assert.equal(d.style, 'viral-short', 'a creator’s video opens on a short in its pattern');
  const plain = defaults({ ...ctx, card: { title: 'Make the video' } }, { kind: 'video', recipe: 'reel' }); assert.notEqual(plain.style, 'recreate-swap');
  assert.equal(styleOf('viral-short').seconds, 30); assert.equal(styleOf('viral-short').job, 'viral-short');
  const { R, t } = mount(); const o = await R['POST /api/jam2/open']({ cardId: 'c1', cta: 'Make the video', v1ch: 'ch1' }, t, {});
  const pl = (await R['POST /api/jam2/jams/:jid/studio/plan']({ spec: { kind: 'video', style: 'viral-short', seconds: 30, sizes: ['story'], product: { img: 'balm.png', name: 'Balm' } } }, t, { jid: o.jam.id })).plan;
  assert.ok(!pl.error, pl.error); assert.match(pl.line, /30 s/, 'the 30 s is kept, not cut to 15');
});

test('a batch (How many above 1) lands its takes as one run the v1 strip can show', { timeout: 120e3 }, async () => {
  const { R, t, landed } = mount(); const seen = []; 
  const o = await R['POST /api/jam2/open']({ cardId: 'c1', cta: 'Make the ad', v1ch: 'ch1' }, t, {}); const jid = o.jam.id, bid = o.jam.boards[0].id;
  const spec = { kind: 'image', style: 'in-use', sizes: ['ig-portrait'], count: 2, product: { img: 'balm.png', name: 'Balm' } };
  const pl = (await R['POST /api/jam2/jams/:jid/studio/plan']({ spec }, t, { jid })).plan; const mk = await R['POST /api/jam2/jams/:jid/studio/make']({ spec, confirmUsd: pl.usd, bid }, t, { jid }); assert.equal(mk.boards.length, 2);
  for (const b of mk.boards) await until(R, t, jid, b);
  const g = await R['GET /api/jam2/jams/:jid']({}, t, { jid }); const runs = g.jam.boards.filter((b) => mk.boards.includes(b.id)).map((b) => b.takes.at(-1)?.run); assert.ok(runs[0] && runs[0] === runs[1], 'one run for the batch');
});

test('a Recreate take is a hard stop in the publish check: someone else’s face, voice and words are in it', () => {
  const r = readyOf({ family: 'post', pkg: { title: 'Curly gel', copy: 'Crunchy?', video: 'gen/j2-v.mp4', film: { cover: 'gen/c.jpg', captions: { n: 0, none: 'No words are spoken in it.' } } }, brand: 'Acme', host: 'acme.com', recreated: { by: 'Michaela Vernice' } });
  assert.equal(r.ready, false); assert.match(r.checks[0].t, /Michaela Vernice’s video with your product swapped in/);
});

test('a film never casts an AI expert and never says an unbacked endorsement; a caption that doesn’t name the product is flagged', async () => {
  const src = fs.readFileSync(new URL('../jam2/studio.js', import.meta.url), 'utf8');
  assert.match(src, /no doctor, dermatologist, scientist, pharmacist or other expert, no lab coat/); assert.equal((src.match(/expertOk\(ctx\) \? '' : NO_EXPERT/g) || []).length, 2, 'the UGC film and the viral short');
  const r = readyOf({ family: 'post', pkg: { title: 'Stop shower hair fall', copy: 'Tired of clumps of hair in your shower?', video: 'gen/j2-v.mp4', film: { srt: 'gen/a.srt', cover: 'gen/c.jpg', captions: { n: 3 } } }, product: { name: 'Seal Deal Curl Gel - 50 ml' }, brand: 'Arata', host: 'arata.in' });
  assert.ok(r.checks.find((c) => c.k === 'match' && !c.ok && c.soft), 'words written for another idea');
  assert.ok(!readyOf({ family: 'post', pkg: { title: 'Curls that hold', copy: 'Seal Deal Curl Gel keeps curls defined.', video: 'v', film: { srt: 'a', cover: 'c', captions: { n: 2 } } }, product: { name: 'Seal Deal Curl Gel - 50 ml' }, brand: 'Arata', host: 'arata.in' }).checks.some((c) => c.k === 'match'));
});

test('Always use this: a pick saved for the brand opens every new set-up and says why; the chat changes the set-up, never the words', { timeout: 60e3 }, async () => {
  const { R, t } = mount(); const o = await R['POST /api/jam2/open']({ cardId: 'c1', cta: 'Make the ad', v1ch: 'ch1' }, t, {}); const jid = o.jam.id, bid = o.jam.boards[0].id;
  assert.ok(!(await R['POST /api/jam2/studio/remember']({ slot: 'quality', value: 'premium' }, t, {})).error);
  assert.ok(!(await R['POST /api/jam2/studio/remember']({ slot: 'cast', value: 'A woman in her 30s' }, t, {})).error);
  const d = await R['GET /api/jam2/jams/:jid/studio']({}, t, { jid }, new URLSearchParams(`bid=${bid}`));
  assert.equal(d.defaults.quality, 'premium'); assert.equal(d.defaults.cast, 'A woman in her 30s'); assert.match(d.context.slots.quality.why, /always use this/);
  const off = await R['POST /api/jam2/studio/remember']({ slot: 'quality', value: null }, t, {}); assert.equal(off.prefs.quality, undefined, 'a pick can be taken back');
  const a = await R['POST /api/jam2/jams/:jid/studio/ask']({ text: 'make it a 10 s UGC video with a woman in her 30s, in Hindi', spec: { kind: 'image', style: 'in-use' } }, t, { jid });
  assert.equal(a.patch.kind, 'video'); assert.equal(a.patch.style, 'ugc-review'); assert.equal(a.patch.seconds, 10); assert.match(a.patch.cast, /woman in her 30s/); assert.match(a.patch.addDirection, /hindi/i); assert.ok(a.said);
});
