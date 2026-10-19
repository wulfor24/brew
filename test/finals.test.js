// a final pays once: quote → yes → generate → poll → bytes; the record is written before the paid call; the same spec twice
// runs once; a stale quote never runs; a run left open at a restart is reconciled, never paid again; the demo site pays nothing
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinals, pick } from '../finals.js';
import { createBudget } from '../budget.js';
import { formOf, prefill, matchSpaces, familyOf } from '../sloosh-spaces.js';

function rig({ dummy = false, left = 100, gemini = null, video = null, connected = true, warning = null } = {}) {
  const files = new Map(); const packs = { getJSON: async (s, n, d) => files.get(`${s}/${n}`) ?? d, put: async (s, n, v) => { files.set(`${s}/${n}`, JSON.parse(JSON.stringify(v))); }, listFiles: async (s, sub) => [...files.keys()].filter((k) => k.startsWith(`${s}/${sub}/`)).map((k) => k.split('/').pop()) };
  const calls = []; let polls = 0;
  /* the shapes Sloosh really returns (data/sloosh-tools.json outputSchemas, 2026-10-16) */
  const sloosh = { getConnection: async () => ({ connection: { workspaceId: 'org_1', scopes: ['spacelab:read'] }, budget: { configured: true, unit: 'millicredits', dailyLimitUnits: 200000, remainingUnits: left * 1000, settledTodayUnits: 0 }, spendingEnabled: true, settingsUrl: 'https://sloosh.ai/settings/mcp' }),
    getAccount: async () => ({ workspace: { id: 'org_1', name: 'Brew' }, wallet: { totalCredits: 20 } }),
    importAsset: async (url, name) => { calls.push(['import', url, name]); return { asset: { reference: { kind: 'workspace', id: 'as-' + url.slice(-6) }, name, assetType: 'image', access: { url: `https://cdn.sloosh.test/${url.slice(-6)}` } }, deduplicated: false }; },
    quoteGeneration: async (o) => { calls.push(['quote', o]); return { quoteId: 'q1', credits: 2.5, expiresAt: new Date(Date.now() + 300e3).toISOString(), input: o, ...(warning ? { warning } : {}) }; },
    generate: async (o) => { calls.push(['generate', o]); if (o.quote === 'q-lost') throw new Error('quote_expired'); return { operationId: 'op1', state: 'admitted', owner: null }; },
    getGeneration: async (id) => { polls++; return polls >= 2 ? { operationId: id, state: 'settled', owner: { phase: 'settled', outputs: [{ generationId: 'out1', status: 'completed', url: null }], chargedCredits: 2.5, errorCode: null } } : { operationId: id, state: 'submitted', owner: { phase: 'running', outputs: [] } }; },
    getAsset: async (ref) => ({ asset: { reference: ref, access: { url: `https://cdn.sloosh.test/${ref.id}.png` } } }), reconcileGeneration: async (id) => ({ operationId: id, state: 'submitted', owner: { phase: 'running', outputs: [] } }),
    stateOf: (x) => (x?.owner?.terminalStatus || (x?.state === 'settled' ? (x.owner?.phase === 'rejected' ? 'rejected' : 'settled') : x?.state || '')), pendingCheckpoint: () => null,
    wait: async (getter) => { for (;;) { const x = await getter(); const s = x?.owner?.terminalStatus || (x?.state === 'settled' ? 'settled' : ''); if (s === 'settled' || s === 'completed') return x; if (/failed|rejected/.test(s)) throw new Error(s); await new Promise((r) => setTimeout(r, 1)); } } };
  const slooshAuth = { status: async () => (connected ? { connected: true, workspace: { name: 'Brew' } } : { connected: false }), setWorkspace: async () => {} };
  const budget = createBudget({ env: { DAILY_CREDITS_CAP: '10', BRAND_CREDITS_CAP: '6' } });
  const saved = []; const fetchImpl = async (url) => new Response(Buffer.from('PNGBYTES' + url), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '20' } });
  const F = createFinals({ sloosh, slooshAuth, packs, budget, saveGen: (n, b) => saved.push([n, b.length]), publicUrl: 'https://brew.test', fetchImpl, slugs: async () => ['cozy'], log: { warn() {}, info() {} }, dummy: () => dummy, geminiImage: gemini, makeVideo: video, photo: async (u) => `/photos/${u}` });
  return { F, files, calls, saved, budget, sloosh, polls: () => polls };
}
const spec = { kind: 'image', title: 'Diwali static', visual: 'The mask on a pillow', refs: [{ job: 'product', label: 'Hush Mask', url: 'b/cozy/a/mask.jpg' }], text: ['Sleep through it'], brand: { name: 'Cozy' }, ratio: '4:5' };

test('pick reads dotted keys and skips empties', () => { assert.equal(pick({ a: { b: 1 }, c: '' }, 'c', 'a.b'), 1); assert.equal(pick({}, 'x'), undefined); });

test('quote imports the references once, sends the brief with the ratio in the settings, and shows the credits', async () => {
  const R = rig(); const q = await R.F.quote('cozy', spec);
  assert.equal(q.quoteId, 'q1'); assert.equal(q.credits, 2.5); assert.equal(q.model, 'gemini-3-pro-image-preview'); assert.equal(q.label, 'Nano Banana Pro'); assert.deepEqual(q.settings, { aspect_ratio: '4:5', resolution: '2K' });
  assert.equal(R.calls[0][1], 'https://brew.test/b/cozy/a/mask.jpg'); assert.equal(R.calls[0][2], 'Hush Mask'); /* import_asset needs a name */
  assert.deepEqual(R.calls[1][1], { mode: 'image_gen', prompt: q.prompt, model: 'gemini-3-pro-image-preview', references: [{ kind: 'workspace', id: 'as-sk.jpg', url: 'https://cdn.sloosh.test/sk.jpg', type: 'image', role: 'reference' }], ratio: '4:5', resolution: '2K', seconds: undefined, sound: undefined, count: 1 });
  assert.match(q.prompt, /Image 1 is the product, Hush Mask/);
  await R.F.quote('cozy', spec); assert.equal(R.calls.filter((c) => c[0] === 'import').length, 1); /* cached in private/sloosh-assets.json */
});

test('a quote over the workspace’s remaining limit or the brand’s share is refused in plain words', async () => {
  const R = rig({ left: 1 }); const q = await R.F.quote('cozy', spec); assert.match(q.error, /would hold 2.5 credits and Brew’s Sloosh workspace has 1 left today/);
  const R2 = rig(); R2.budget.spend('credits', 'cozy', 5); const q2 = await R2.F.quote('cozy', spec); assert.match(q2.error, /share for today is used up \(6 a day\)/);
});

test('run writes the record before paying, counts the credits, polls to the bytes, and the same spec runs once', async () => {
  const R = rig(); const q = await R.F.quote('cozy', spec);
  const [a, b] = await Promise.all([R.F.run('cozy', spec, { quote: q, by: 'Param', target: { chid: 'ch1' } }), R.F.run('cozy', spec, { quote: q, by: 'Param', target: { chid: 'ch1' } })]);
  assert.equal(a.state, 'done'); assert.equal(a, b); assert.match(a.file, /^gen\/fin-[0-9a-f]{16}\.png$/); assert.equal(a.assetId, 'out1'); assert.equal(a.assetKind, 'generated'); assert.equal(a.link, 'https://cdn.sloosh.test/out1.png'); assert.equal(a.charged, 2.5);
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

test('after a restart an open run is finished from its operation id; one with no id replays the same quote and key (never a second charge); a refused replay is failed', async () => {
  const R = rig(); await R.files.set('cozy/private/finals/abc.json', { runKey: 'abc', state: 'running', genId: 'op1', kind: 'image', credits: 2 });
  R.files.set('cozy/private/finals/noid.json', { runKey: 'noid', state: 'starting', kind: 'image', credits: 2, quote: { id: 'q1' } }); R.files.set('cozy/private/finals/lost.json', { runKey: 'lost', state: 'starting', kind: 'image', credits: 2, quote: { id: 'q-lost' } });
  assert.equal(await R.F.reconcileAll(), 3); await new Promise((r) => setTimeout(r, 40));
  assert.equal(R.files.get('cozy/private/finals/abc.json').state, 'done'); assert.equal(R.files.get('cozy/private/finals/noid.json').state, 'done');
  const lost = R.files.get('cozy/private/finals/lost.json'); assert.equal(lost.state, 'failed'); assert.match(lost.error, /refused the retry \(quote_expired\)/); assert.equal(lost.charged, null);
  const gens = R.calls.filter((c) => c[0] === 'generate'); assert.deepEqual(gens.map((g) => g[1]), [{ quote: 'q1', runKey: 'noid', confirmed: true }, { quote: 'q-lost', runKey: 'lost', confirmed: true }]);
});

test('until Brew’s workspace can pay, an image final is made on Gemini with the same brief at zero credits; a video has no fallback', async () => {
  const made = []; const gemini = async (o) => { made.push(o); return Buffer.from('GEMINIBYTES'); };
  const R = rig({ connected: false, gemini }); const st = await R.F.status(); assert.equal(st.ok, false); assert.equal(st.fallback, true); assert.match(st.fallbackWhy, /not connected/);
  const q = await R.F.quote('cozy', spec); assert.equal(q.provider, 'gemini'); assert.equal(q.credits, 0); assert.equal(q.model, 'gemini-3-pro-image'); assert.match(q.why, /on Gemini for now/); assert.match(q.prompt, /Hush Mask/);
  const r = await R.F.run('cozy', { ...spec }, { quote: { ...q, at: Date.now() - 3600e3 }, by: 'Param', target: { chid: 'c' } }); assert.equal(r.state, 'done'); assert.equal(r.provider, 'gemini'); assert.equal(r.charged, 0); assert.match(r.file, /^gen\/fin-[0-9a-f]{16}\.png$/); /* no four-minute rule on Gemini */
  assert.equal(made[0].srcFile, '/photos/b/cozy/a/mask.jpg'); assert.equal(made[0].ratio, '4:5'); assert.equal(made[0].text, 'Sleep through it'); assert.equal(R.calls.length, 0); assert.equal(R.budget.left('cozy').credits.used, 0);
  const v = await R.F.quote('cozy', { ...spec, kind: 'video' }); assert.match(v.error, /video final runs on Sloosh only here/);
  /* with a video maker: a Gemini still, then Veo on it */
  const clips = []; const R3 = rig({ connected: false, gemini, video: async (frame, prompt, o) => { clips.push([frame.toString(), prompt, o]); return Buffer.from('MP4BYTES'); } });
  const qv = await R3.F.quote('cozy', { ...spec, kind: 'video', motion: 'the camera drifts left', seconds: 6, ratio: '9:16' }); assert.equal(qv.model, 'veo-3.1-fast'); assert.match(qv.motion, /camera drifts left/);
  const rv = await R3.F.run('cozy', { ...spec, kind: 'video', motion: 'the camera drifts left', seconds: 6, ratio: '9:16' }, { quote: qv, target: { chid: 'v' } }); assert.equal(rv.provider, 'gemini'); assert.match(rv.file, /\.mp4$/); assert.equal(clips[0][0], 'GEMINIBYTES'); assert.equal(clips[0][2].ratio, '9:16');
  /* connected, but Sloosh warns the wallet is short: Gemini again, with Sloosh's words */
  const R2 = rig({ gemini, warning: 'The wallet has 0 credits; this quote needs 2.5.' }); const q2 = await R2.F.quote('cozy', spec); assert.equal(q2.provider, 'gemini'); assert.match(q2.why, /Sloosh says: The wallet has 0 credits/);
  /* and with Sloosh ready, the Sloosh path is untouched by the fallback wiring */
  const R4 = rig({ gemini }); const q4 = await R4.F.quote('cozy', spec); assert.equal(q4.provider, 'sloosh'); assert.equal(q4.quoteId, 'q1'); const r4 = await R4.F.run('cozy', spec, { quote: q4, target: { chid: 'c' } }); assert.equal(r4.provider, 'sloosh'); assert.equal(r4.charged, 2.5); assert.equal(made.length, 2);
});

test('DUMMY: on the demo site a final is the draft’s own picture at zero credits, nothing is called', async () => {
  const R = rig({ dummy: true }); const q = await R.F.quote('cozy', spec); assert.equal(q.credits, 0); assert.equal(q.dummy, true); assert.match(q.prompt, /Hush Mask/);
  const r = await R.F.run('cozy', { ...spec, fromFile: 'gen/draft1.png' }, { quote: q, target: { wid: 'w' } }); assert.equal(r.state, 'done'); assert.equal(r.file, 'gen/draft1.png'); assert.equal(r.dummy, true); assert.equal(R.calls.length, 0);
});

test('a Sloosh canvas form (widget_props steps) becomes fields keyed by field id, image uploads first', () => {
  const schema = { space: { spaceId: 'sp_1', title: 'Product Poster / Ad Creative' }, formVersion: 'v', form: { widget_props: { id: 'canvas_form', isMultiStep: true, steps: [{ stepId: 'step-1', label: 'Details', formSchema: { rows: [], fields: [
    { id: 'field_nd_1', type: 'image-upload', label: 'Product photo', props: {}, validation: { acceptedTypes: ['image/*'] }, required: true }, { id: 'field_nd_2', type: 'text', label: 'Headline', props: {}, required: true }, { id: 'field_nd_3', type: 'image-upload', label: 'Reference video', validation: { acceptedTypes: ['video/*'] } }] } }] } } };
  const fields = formOf(schema.form); assert.deepEqual(fields.map((f) => [f.key, f.type, f.required]), [['field_nd_1', 'image', true], ['field_nd_2', 'text', true], ['field_nd_3', 'video', false]]);
  const pre = prefill(fields, { productPhoto: { url: 'https://brew.test/b/c/a/p.jpg', job: 'product' }, copy: { headline: 'Cold hands?' } }); assert.deepEqual(pre.values, { field_nd_1: 'https://brew.test/b/c/a/p.jpg', field_nd_2: 'Cold hands?' }); assert.deepEqual(pre.missing, []);
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
  const list = { spaces: [{ spaceId: 1, title: 'UGC Selfie Video Ad' }, { spaceId: 2, title: 'Product Poster / Ad Creative' }, { spaceId: 3, title: '3×3 Product Ad Grid' }, { spaceId: 4, title: 'Product in Scene + Relight' }, { spaceId: 5, title: 'Design Recomposer', description: 'resize a product poster to formats' }, { spaceId: 'sp_d3b3f14d-d7e3-4caf-bdfd-35a1aa979562', title: 'Renamed Swap Space' }] };
  assert.deepEqual(matchSpaces(list, 'single image ad').map((s) => s.spaceId), [2, 3, 'sp_d3b3f14d-d7e3-4caf-bdfd-35a1aa979562']); assert.deepEqual(matchSpaces(list, 'ugc').map((s) => s.spaceId), [1]);
  assert.equal(familyOf('single image ad'), 'single image ad'); assert.equal(familyOf('reel'), 'reel'); assert.equal(familyOf('ugc video'), 'ugc'); assert.equal(familyOf('', 'video'), 'reel');
});

test('an imported asset belongs to the workspace that imported it: another workspace (or an old entry with no ws) imports again', async () => {
  const R = rig(); await R.F.quote('cozy', spec); assert.equal(R.calls.filter((c) => c[0] === 'import').length, 1);
  const cache = R.files.get('cozy/private/sloosh-assets.json'); const key = Object.keys(cache)[0]; assert.equal(cache[key].ws, 'org_1');
  R.files.set('cozy/private/sloosh-assets.json', { [key]: { ...cache[key], ws: 'org_other' } }); R.F.forget(); await R.F.quote('cozy', spec); assert.equal(R.calls.filter((c) => c[0] === 'import').length, 2);
  R.files.set('cozy/private/sloosh-assets.json', { [key]: { ...cache[key], ws: undefined } }); R.F.forget(); await R.F.quote('cozy', spec); assert.equal(R.calls.filter((c) => c[0] === 'import').length, 3);
  R.F.forget(); await R.F.quote('cozy', spec); assert.equal(R.calls.filter((c) => c[0] === 'import').length, 3); /* re-imported into org_1: cached again */
});

test('a Gemini final is never the raw product photo: a guard stand-in fails the run, charges nothing, and no clip is made on it', async () => {
  const standIn = Object.assign(Buffer.from('REALPHOTO'), { guard: { fallback: true, genFailed: true, product: 'Hush Mask' } });
  const clips = []; const R = rig({ connected: false, gemini: async () => standIn, video: async () => { clips.push(1); return Buffer.from('MP4'); } });
  const q = await R.F.quote('cozy', spec); assert.equal(q.provider, 'gemini');
  await assert.rejects(R.F.run('cozy', spec, { quote: q, target: { chid: 'g' } }), /Gemini could not keep the product as photographed\. Try again, or wait for Sloosh\./);
  const rec = (await R.F.list('cozy'))[0]; assert.equal(rec.state, 'failed'); assert.equal(rec.charged, 0); assert.equal(rec.provider, 'gemini'); assert.equal(rec.guard.fallback, true); assert.equal(R.saved.length, 0);
  const qv = await R.F.quote('cozy', { ...spec, kind: 'video' }); await assert.rejects(R.F.run('cozy', { ...spec, kind: 'video' }, { quote: qv, target: { chid: 'gv' } }), /could not keep the product/); assert.equal(clips.length, 0);
  assert.equal(R.budget.left('cozy').credits.used, 0);
});

test('a refused generate charges no share and says failed; the same spec again gets a fresh quote and spends once', async () => {
  const R = rig(); let refuse = true; const gen = R.sloosh.generate; R.sloosh.generate = async (o) => { if (refuse) { refuse = false; R.calls.push(['generate', o]); throw new Error('quote_expired'); } return gen(o); };
  const q = await R.F.quote('cozy', spec);
  await assert.rejects(R.F.run('cozy', spec, { quote: q, target: { chid: 'r' } }), /Sloosh did not start this one \(quote_expired\)\. Nothing was charged; ask for a fresh quote\./);
  const rec = (await R.F.list('cozy'))[0]; assert.equal(rec.state, 'failed'); assert.equal(rec.charged, 0); assert.equal(R.budget.left('cozy').credits.used, 0);
  const q2 = await R.F.quote('cozy', spec); const r2 = await R.F.run('cozy', spec, { quote: q2, target: { chid: 'r' } }); assert.equal(r2.state, 'done'); assert.equal(r2.runKey, rec.runKey);
  assert.equal(R.budget.left('cozy').credits.used, 3); assert.equal(R.calls.filter((c) => c[0] === 'generate').length, 2);
  /* a share already used up is refused before Sloosh is asked, and nothing moves */
  const R2 = rig(); R2.budget.spend('credits', 'cozy', 5); const q3 = { ...(await R.F.quote('cozy', spec)), at: Date.now() }; await assert.rejects(R2.F.run('cozy', spec, { quote: q3, target: { chid: 'x' } }), (e) => e.budget === true); assert.equal(R2.calls.filter((c) => c[0] === 'generate').length, 0);
});

test('any Sloosh quote failure on an image or a video ends as a Gemini (Veo) quote with the reason, never a raw error; a Space keeps Sloosh’s', async () => {
  const gemini = async () => Buffer.from('G');
  const R = rig({ gemini }); R.sloosh.quoteGeneration = async () => { throw new Error('Sloosh quote_generation: insufficient balance (402)'); };
  const q = await R.F.quote('cozy', spec); assert.equal(q.provider, 'gemini'); assert.match(q.fallbackWhy, /cannot pay for this yet \(.*insufficient balance/);
  R.sloosh.quoteGeneration = async () => { throw new Error('Sloosh quote_generation: asset not found'); }; assert.match((await R.F.quote('cozy', spec)).fallbackWhy, /cannot pay for this yet/);
  R.sloosh.quoteGeneration = async () => { throw new Error('Sloosh MCP 503: upstream'); }; const q3 = await R.F.quote('cozy', spec); assert.equal(q3.provider, 'gemini'); assert.match(q3.fallbackWhy, /could not quote this \(Sloosh MCP 503/);
  R.sloosh.quoteGeneration = async () => ({ credits: 1 }); assert.match((await R.F.quote('cozy', spec)).fallbackWhy, /without a quote id/);
  const RV = rig({ gemini, video: async () => Buffer.from('V') }); RV.sloosh.quoteGeneration = async () => { throw new Error('Sloosh MCP 503: upstream'); }; const qv = await RV.F.quote('cozy', { ...spec, kind: 'video' }); assert.equal(qv.provider, 'gemini'); assert.equal(qv.model, 'veo-3.1-fast'); /* 19 Oct: "owner_invalid_request" reached the person */
  const RN = rig({ gemini: null }); RN.sloosh.quoteGeneration = async () => { throw new Error('Sloosh quote_generation: owner_invalid_request'); }; const qn = await RN.F.quote('cozy', spec); assert.match(qn.error, /couldn’t price this final just now/); assert.ok(!/owner_invalid/.test(qn.error), 'never the raw code');
  /* over the workspace's day: an image goes to Gemini with that reason, with no gemini wired it is the plain refusal */
  const RL = rig({ gemini, left: 1 }); const ql = await RL.F.quote('cozy', spec); assert.equal(ql.provider, 'gemini'); assert.match(ql.fallbackWhy, /would hold 2.5 credits and Brew’s Sloosh workspace has 1 left today/);
  const RS = rig({ gemini, left: 1 }); RS.sloosh.getSpaceInputSchema = async () => ({ type: 'object', properties: { headline: { type: 'string' } } }); RS.sloosh.quoteSpace = async () => ({ quoteId: 'qs', credits: 2.5 });
  const qs = await RS.F.quote('cozy', { ...spec, space: { id: 'sp_1', name: 'Poster', inputs: { headline: 'Hi' }, ctx: {} } }); assert.match(qs.error, /would hold 2.5 credits/);
});

test('a poll that keeps failing or the wait limit leaves the run open (running, with the reason), reconcileAll collects it and onDone hears of it; a 0 charge is 0', async () => {
  const heard = []; const R = rig(); const F2 = createFinals({ sloosh: R.sloosh, slooshAuth: { status: async () => ({ connected: true, workspace: { id: 'org_1', name: 'Brew' } }) }, packs: { getJSON: (s, n, d) => R.files.get(`${s}/${n}`) ?? d, put: async (s, n, v) => { R.files.set(`${s}/${n}`, JSON.parse(JSON.stringify(v))); }, listFiles: async (s, sub) => [...R.files.keys()].filter((k) => k.startsWith(`${s}/${sub}/`)).map((k) => k.split('/').pop()) },
    budget: R.budget, saveGen: () => {}, publicUrl: 'https://brew.test', fetchImpl: async () => new Response(Buffer.from('PNG'), { status: 200, headers: { 'content-type': 'image/png' } }), slugs: async () => ['cozy'], log: { warn() {}, info() {} }, dummy: () => false, onDone: async (slug, rec) => { heard.push([slug, rec.state, rec.target]); } });
  const realWait = R.sloosh.wait; R.sloosh.wait = async () => { throw Object.assign(new Error('Sloosh could not be read (Sloosh MCP 503)'), { pollError: true }); };
  const q = await F2.quote('cozy', spec); await assert.rejects(F2.run('cozy', spec, { quote: q, target: { chid: 'p' } }), (e) => e.open === true && /Brew will collect it/.test(e.message));
  let rec = (await F2.list('cozy'))[0]; assert.equal(rec.state, 'running'); assert.match(rec.lastError, /503/); assert.match(rec.note, /Brew will collect it/); assert.deepEqual(rec.target, { chid: 'p' });
  R.sloosh.wait = async () => { throw Object.assign(new Error('Sloosh run is still going after the wait limit'), { timeout: true }); };
  await assert.rejects(F2.run('cozy', spec, { quote: q, target: { chid: 'p' } }), /still going on Sloosh; Brew will collect it/); rec = (await F2.list('cozy'))[0]; assert.equal(rec.state, 'running'); assert.equal(rec.note, 'still going on Sloosh; Brew will collect it');
  assert.equal(R.calls.filter((c) => c[0] === 'generate').length, 1); /* the run was never paid again */
  /* the next boot: the poll works, the run is collected, the hook hears of it with its target; Sloosh charged 0 → charged is 0, not the quote */
  R.sloosh.wait = realWait; R.sloosh.getGeneration = async (id) => ({ operationId: id, state: 'settled', owner: { phase: 'settled', outputs: [{ generationId: 'out1', status: 'completed', url: 'https://cdn.sloosh.test/out1.png' }], chargedCredits: 0 } });
  assert.equal(await F2.reconcileAll(), 1); await new Promise((r) => setTimeout(r, 40)); rec = (await F2.list('cozy'))[0]; assert.equal(rec.state, 'done'); assert.equal(rec.charged, 0); assert.equal(rec.note, undefined); assert.deepEqual(heard, [['cozy', 'done', { chid: 'p' }]]);
  /* Sloosh's own terminal state still fails the run */
  R.sloosh.wait = async () => { throw Object.assign(new Error('Sloosh run rejected'), { terminal: true, final: { owner: { chargedCredits: 0 } } }); };
  const q2 = await F2.quote('cozy', { ...spec, visual: 'another' }); await assert.rejects(F2.run('cozy', { ...spec, visual: 'another' }, { quote: q2, target: { chid: 't' } }), /rejected/); assert.equal((await F2.list('cozy')).find((r) => r.target.chid === 't').state, 'failed');
});

test('where a final shows (land) rides on the record but never in the run key: a retry from a new card finds the same run and pays once', async () => {
  const R = rig(); const q = await R.F.quote('cozy', spec); const target = { wid: 'w1', draftId: 'd1', revision: 0 };
  const a = await R.F.run('cozy', spec, { quote: q, target, land: { tid: 'T1', fid: 'fn_a' } });
  assert.deepEqual(a.land, { tid: 'T1', fid: 'fn_a' });
  const b = await R.F.run('cozy', spec, { quote: q, target, land: { tid: 'T1', fid: 'fn_b' } });
  assert.equal(b.runKey, a.runKey); assert.equal(b.state, 'done'); assert.equal(R.calls.filter((c) => c[0] === 'generate').length, 1);
});
