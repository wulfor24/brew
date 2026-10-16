// a final pays once: quote → yes → generate → poll → bytes; the record is written before the paid call; the same spec twice
// runs once; a stale quote never runs; a run left open at a restart is reconciled, never paid again; the demo site pays nothing
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinals, pick } from '../finals.js';
import { createBudget } from '../budget.js';
import { formOf, prefill, matchSpaces, familyOf } from '../sloosh-spaces.js';

function rig({ dummy = false, left = 100 } = {}) {
  const files = new Map(); const packs = { getJSON: async (s, n, d) => files.get(`${s}/${n}`) ?? d, put: async (s, n, v) => { files.set(`${s}/${n}`, JSON.parse(JSON.stringify(v))); }, listFiles: async (s, sub) => [...files.keys()].filter((k) => k.startsWith(`${s}/${sub}/`)).map((k) => k.split('/').pop()) };
  const calls = []; let polls = 0;
  const sloosh = { getConnection: async () => ({ workspace: { name: 'Brew' }, limit: { daily: 200, remaining: left } }), importAsset: async (url) => { calls.push(['import', url]); return { asset_id: 'as-' + url.slice(-6) }; },
    quoteGeneration: async (o) => { calls.push(['quote', o]); return { quote_id: 'q1', credits: 2.5, expires_at: new Date(Date.now() + 300e3).toISOString() }; },
    generate: async (o) => { calls.push(['generate', o]); return { generation_id: 'g1', status: 'queued' }; },
    getGeneration: async (id) => { polls++; return { generation_id: id, status: polls >= 2 ? 'completed' : 'running', outputs: [{ asset_id: 'out1' }], credits: 2.5 }; },
    getAsset: async (id) => ({ id, url: `https://cdn.sloosh.test/${id}.png` }), reconcileGeneration: async ({ runKey }) => (runKey === 'lost' ? null : { generation_id: 'g9' }),
    stateOf: (x) => String(x?.status || ''), wait: async (getter) => { for (;;) { const x = await getter(); const s = String(x?.status || ''); if (/completed|failed/.test(s)) { if (s === 'failed') throw new Error('failed'); return x; } await new Promise((r) => setTimeout(r, 1)); } } };
  const slooshAuth = { status: async () => ({ connected: true, workspace: { name: 'Brew' } }) };
  const budget = createBudget({ env: { DAILY_CREDITS_CAP: '10', BRAND_CREDITS_CAP: '6' } });
  const saved = []; const fetchImpl = async (url) => new Response(Buffer.from('PNGBYTES' + url), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '20' } });
  const F = createFinals({ sloosh, slooshAuth, packs, budget, saveGen: (n, b) => saved.push([n, b.length]), publicUrl: 'https://brew.test', fetchImpl, slugs: async () => ['cozy'], log: { warn() {}, info() {} }, dummy: () => dummy });
  return { F, files, calls, saved, budget, sloosh, polls: () => polls };
}
const spec = { kind: 'image', title: 'Diwali static', visual: 'The mask on a pillow', refs: [{ job: 'product', label: 'Hush Mask', url: 'b/cozy/a/mask.jpg' }], text: ['Sleep through it'], brand: { name: 'Cozy' }, ratio: '4:5' };

test('pick reads dotted keys and skips empties', () => { assert.equal(pick({ a: { b: 1 }, c: '' }, 'c', 'a.b'), 1); assert.equal(pick({}, 'x'), undefined); });

test('quote imports the references once, sends the brief with the ratio in the settings, and shows the credits', async () => {
  const R = rig(); const q = await R.F.quote('cozy', spec);
  assert.equal(q.quoteId, 'q1'); assert.equal(q.credits, 2.5); assert.equal(q.model, 'nano-banana-pro'); assert.deepEqual(q.settings, { aspect_ratio: '4:5', resolution: '2K' });
  assert.equal(R.calls[0][1], 'https://brew.test/b/cozy/a/mask.jpg'); assert.deepEqual(R.calls[1][1].references, ['as-sk.jpg']); assert.match(q.prompt, /Image 1 is the product, Hush Mask/);
  await R.F.quote('cozy', spec); assert.equal(R.calls.filter((c) => c[0] === 'import').length, 1); /* cached in private/sloosh-assets.json */
});

test('a quote over the workspace’s remaining limit or the brand’s share is refused in plain words', async () => {
  const R = rig({ left: 1 }); const q = await R.F.quote('cozy', spec); assert.match(q.error, /would hold 2.5 credits and Brew’s Sloosh workspace has 1 left today/);
  const R2 = rig(); R2.budget.spend('credits', 'cozy', 5); const q2 = await R2.F.quote('cozy', spec); assert.match(q2.error, /share for today is used up \(6 a day\)/);
});

test('run writes the record before paying, counts the credits, polls to the bytes, and the same spec runs once', async () => {
  const R = rig(); const q = await R.F.quote('cozy', spec);
  const [a, b] = await Promise.all([R.F.run('cozy', spec, { quote: q, by: 'Param', target: { chid: 'ch1' } }), R.F.run('cozy', spec, { quote: q, by: 'Param', target: { chid: 'ch1' } })]);
  assert.equal(a.state, 'done'); assert.equal(a, b); assert.match(a.file, /^gen\/fin-[0-9a-f]{16}\.png$/); assert.equal(a.assetId, 'out1'); assert.equal(a.link, 'https://cdn.sloosh.test/out1.png');
  assert.equal(R.calls.filter((c) => c[0] === 'generate').length, 1); assert.deepEqual(R.calls.find((c) => c[0] === 'generate')[1], { quote: 'q1', runKey: a.runKey, confirmed: true });
  assert.equal(R.budget.left('cozy').credits.used, 3); assert.equal(R.saved.length, 1);
  const again = await R.F.run('cozy', spec, { quote: q, target: { chid: 'ch1' } }); assert.equal(again.runKey, a.runKey); assert.equal(R.calls.filter((c) => c[0] === 'generate').length, 1);
  assert.equal((await R.F.list('cozy'))[0].state, 'done'); assert.equal(R.F.busy(), 0);
});

test('a quote older than four minutes never runs; a changed brief has its own key', async () => {
  const R = rig(); const q = await R.F.quote('cozy', spec);
  await assert.rejects(R.F.run('cozy', spec, { quote: { ...q, at: Date.now() - 5 * 60e3 }, target: { chid: 'c' } }), /more than four minutes old/);
  assert.notEqual(R.F.runKeyOf('cozy', { chid: 'c' }, spec), R.F.runKeyOf('cozy', { chid: 'c' }, { ...spec, revise: { change: 'the table' }, revision: 1 }));
  assert.equal(R.calls.filter((c) => c[0] === 'generate').length, 0);
});

test('after a restart an open run is finished from its id, a lost one is failed with nothing charged', async () => {
  const R = rig(); const key = 'abc'; await R.files.set('cozy/private/finals/abc.json', { runKey: key, state: 'running', genId: 'g1', kind: 'image', credits: 2 }); R.files.set('cozy/private/finals/lost.json', { runKey: 'lost', state: 'starting', kind: 'image', credits: 2 });
  assert.equal(await R.F.reconcileAll(), 2); await new Promise((r) => setTimeout(r, 30));
  assert.equal(R.files.get('cozy/private/finals/abc.json').state, 'done'); const lost = R.files.get('cozy/private/finals/lost.json'); assert.equal(lost.state, 'failed'); assert.equal(lost.charged, 0);
  assert.equal(R.calls.filter((c) => c[0] === 'generate').length, 0);
});

test('DUMMY: on the demo site a final is the draft’s own picture at zero credits, nothing is called', async () => {
  const R = rig({ dummy: true }); const q = await R.F.quote('cozy', spec); assert.equal(q.credits, 0); assert.equal(q.dummy, true); assert.match(q.prompt, /Hush Mask/);
  const r = await R.F.run('cozy', { ...spec, fromFile: 'gen/draft1.png' }, { quote: q, target: { wid: 'w' } }); assert.equal(r.state, 'done'); assert.equal(r.file, 'gen/draft1.png'); assert.equal(r.dummy, true); assert.equal(R.calls.length, 0);
});

test('a Space form is read from its schema, prefilled from what Brew holds, and says what the team still has to upload', () => {
  const schema = { type: 'object', required: ['product_photo', 'headline', 'creator_photo', 'aspect_ratio'], properties: { product_photo: { type: 'string', format: 'image', title: 'Product photo' }, creator_photo: { type: 'string', description: 'Upload the creator’s face (asset)' }, headline: { type: 'string', title: 'Headline' }, brief: { type: 'string' },
    aspect_ratio: { type: 'string', enum: ['9:16', '1:1', '16:9'] }, language: { type: 'string', enum: ['English', 'Hindi'], default: 'English' }, video_length: { type: 'integer', minimum: 4, maximum: 15 }, sound: { type: 'boolean', default: true }, brand_colour: { type: 'string', format: 'color' }, products: { type: 'array', items: { type: 'string', format: 'uri' }, maxItems: 10, title: 'Product photos' } } };
  const fields = formOf(schema); assert.deepEqual(fields.map((f) => [f.key, f.type]), [['product_photo', 'image'], ['creator_photo', 'image'], ['headline', 'text'], ['brief', 'text'], ['aspect_ratio', 'select'], ['language', 'select'], ['video_length', 'number'], ['sound', 'boolean'], ['brand_colour', 'color'], ['products', 'images']]);
  const pre = prefill(fields, { productPhoto: { url: 'https://brew.test/b/c/a/p.jpg', job: 'product' }, refs: [{ job: 'style', url: 'https://brew.test/b/c/refs/s.jpg' }], copy: { headline: 'Cold hands?' }, brief: 'Desk warmth', ratio: '4:5', seconds: 8, brand: { name: 'Cozy', colors: ['#F6C9D2'] } });
  assert.equal(pre.values.product_photo, 'https://brew.test/b/c/a/p.jpg'); assert.equal(pre.values.headline, 'Cold hands?'); assert.equal(pre.values.brief, 'Desk warmth'); assert.equal(pre.values.aspect_ratio, '9:16'); assert.equal(pre.filled.aspect_ratio, 'the Space’s default');
  assert.equal(pre.values.language, 'English'); assert.equal(pre.values.video_length, 8); assert.equal(pre.values.sound, true); assert.equal(pre.values.brand_colour, '#F6C9D2'); assert.deepEqual(pre.values.products, ['https://brew.test/b/c/a/p.jpg']);
  assert.deepEqual(pre.missing.map((m) => m.key), ['creator_photo']); assert.match(pre.missing[0].why, /Upload or type creator photo/);
});

test('Spaces are matched to a family by name, best first, at most three', () => {
  const list = { spaces: [{ id: 1, name: 'UGC Selfie Video Ad' }, { id: 2, name: 'Product Poster / Ad Creative' }, { id: 3, name: '3x3 Product Ad Grid' }, { id: 4, name: 'Product in Scene + Relight' }, { id: 5, name: 'Design Recomposer', description: 'resize a product poster to formats' }] };
  assert.deepEqual(matchSpaces(list, 'single image ad').map((s) => s.id), [2, 3, 4]); assert.deepEqual(matchSpaces(list, 'ugc').map((s) => s.id), [1]);
  assert.equal(familyOf('single image ad'), 'single image ad'); assert.equal(familyOf('reel'), 'reel'); assert.equal(familyOf('ugc video'), 'ugc'); assert.equal(familyOf('', 'video'), 'reel');
});
