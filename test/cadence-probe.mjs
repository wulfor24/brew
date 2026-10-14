// Real-AI probe for moves on a cadence (moves-cadence.js) and background first drafts (drafts-bg.js), on local packs.
//   node test/cadence-probe.mjs [slug ...]          moves for each brand (default wearcomet-com allbirds-com)
//   DRAFTS_FOR=wearcomet-com DRAFTS_N=2 node …       also first drafts for the top N cards of one brand (MOVES_SKIP=1: drafts only)
// Spends real money: stops before a brand once PROBE_BUDGET (default $4) is spent. Writes .brands/<slug>/ locally.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAI } from '../ai.js';
import { createPacks } from '../brand-pack.js';
import { createBrandMemory, vertexEmbedder } from '../brand-memory.js';
import { createCardsGen } from '../cards-gen.js';
import { createMovesScheduler } from '../moves-cadence.js';
import { createDraftsBg } from '../drafts-bg.js';
import { configureGen, saveGen } from '../gen-store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.ENV_FILE || path.join(ROOT, '..', 'ugc-factory', '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const BUDGET = +process.env.PROBE_BUDGET || 4, PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617', IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
let tok = null;
const gToken = async () => tok || (tok = await new Promise((res, rej) => execFile('gcloud', ['auth', 'print-access-token'], { timeout: 15000 }, (e, out, err) => (e ? rej(new Error(String(err || e.message).trim())) : res(out.trim())))));
const quiet = { info: (...a) => console.log(...a), log: () => {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
const ai = createAI({ log: quiet });
if (!ai.live) { console.error('AI is off (no ANTHROPIC_API_KEY or AI_MOCK=1)'); process.exit(1); }
const packs = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken, log: quiet });
const memory = createBrandMemory({ ai, packs, embed: vertexEmbedder({ gToken, project: PROJECT, log: quiet }), log: quiet, autoLearn: false });
let images = 0;
async function geminiImage({ srcFile, prompt, ratio }) {
  const parts = []; if (srcFile) parts.push({ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(srcFile).toString('base64') } }); parts.push({ text: prompt });
  const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${IMAGE_MODEL}:generateContent`, { method: 'POST', headers: { authorization: `Bearer ${await gToken()}`, 'x-goog-user-project': PROJECT, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio || '1:1' } } }) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const img = (await r.json()).candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData; if (!img) throw new Error('Gemini returned no image'); images++; return Buffer.from(img.data, 'base64');
}

const S = createMovesScheduler({ packs, ai, memory, cardsGen: createCardsGen, log: quiet, env: { MOVES_WEEK_CAP_USD: process.env.MOVES_WEEK_CAP_USD || '3' } });
for (const slug of process.env.MOVES_SKIP === '1' ? [] : process.argv.slice(2).length ? process.argv.slice(2) : ['wearcomet-com', 'allbirds-com']) {
  if (ai.meter.usd >= BUDGET) { console.log(`budget $${BUDGET} reached, skipping ${slug}`); continue; }
  const t0 = Date.now(); const d = await S.due(slug, { manual: true });
  console.log(`\n================ ${slug}: families ${d.families.join(', ') || 'none'}${d.why.length ? ` (${d.why.join('; ')})` : ''}`);
  const r = await S.runOne(slug, d.families, { manual: true });
  console.log(`written ${r.written?.length || 0} in ${((Date.now() - t0) / 1e3).toFixed(0)}s, $${r.usd}; errors: ${JSON.stringify(r.errors || r.error)}`);
  console.log(`scorecard: ${r.scorecard?.areas?.map((a) => `${a.k} ${a.score ?? '-'}${a.grade ? ` (${a.grade})` : ''}`).join(' · ')}`);
  const moves = await packs.getJSON(slug, 'moves.json', {}), seed = await packs.getJSON(slug, 'seed.json', {});
  for (const w of r.written || []) {
    const m = moves[w.n]; console.log(`\nMove ${w.n} · ${m.family} · ${m.title}  [${m.stat} ${m.statLabel}]`);
    for (const f of m.sections.find((s) => s.kind === 'found').blocks[0].items) console.log(`   found: ${f}`);
    for (const s of m.sources.slice(0, 4)) console.log(`   source: ${s.label.slice(0, 150)}${s.url ? ` <${s.url}>` : ''}`);
    if (m.toConfirm.length) console.log(`   to confirm: ${m.toConfirm.slice(0, 3).join(' | ').slice(0, 220)}`);
    for (const c of (seed.posts || []).filter((c) => c.id.startsWith(`m${w.n}-`))) console.log(`   card ${c.id}: ${c.title} · ${c.src} · ${c.badge?.[0]}`);
  }
}
console.log(`\nmoves total: $${ai.meter.usd.toFixed(3)}`);

const DF = process.env.DRAFTS_FOR;
if (DF && ai.meter.usd < BUDGET) {
  configureGen({ dir: path.join(ROOT, 'public', 'gen'), log: quiet });
  const usd0 = ai.meter.usd;
  const J = createDraftsBg({ packs, ai, geminiImage, saveGen, memory, loadPack: (slug) => packs.load(slug, { fresh: true }), photoAsync: async (rel) => { const m = /^\/?b\/([a-z0-9-]+)\/a\/([\w.-]+)$/.exec(String(rel || '')); return m ? packs.assetFile(m[1], m[2]) : null; }, log: quiet, env: {} });
  const r = await J.runOne(DF, { manual: true, n: +process.env.DRAFTS_N || 2, only: process.env.DRAFTS_ONLY ? process.env.DRAFTS_ONLY.split(',') : null });
  console.log(`\n================ drafts for ${DF}: ${JSON.stringify(r, null, 1)}`);
  const cache = await J.cacheOf(DF); for (const x of r.made || []) { const d = cache[x.cardId]; console.log(`\n${x.cardId} · ${d.as} · ${d.title}\n${d.copy.slice(0, 400)}${d.image ? `\nimage: public/${d.image} (from the product photo: ${d.fromPhoto})` : ''}`); }
  console.log(`drafts: Claude $${(ai.meter.usd - usd0).toFixed(3)} + ${images} image(s) ≈ $${(images * 0.134).toFixed(3)}`);
}
