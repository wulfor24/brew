// Real-AI probe for brand memory: learnFromLive on local brand packs, then print the repo files.
// node test/memory-probe.mjs [slug ...]   (default: wearcomet-com allbirds-com). Spends a few cents per brand
// (Sonnet + Vertex embeddings); stops before starting a brand once $1 is spent. Writes .brands/<slug>/memory/ locally.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAI } from '../ai.js';
import { createPacks } from '../brand-pack.js';
import { createBrandMemory, vertexEmbedder } from '../brand-memory.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.ENV_FILE || path.join(ROOT, '..', 'ugc-factory', '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
const BUDGET = +process.env.PROBE_BUDGET || 1;
let tok = null;
const gToken = async () => tok || (tok = await new Promise((res, rej) => execFile('gcloud', ['auth', 'print-access-token'], { timeout: 15000 }, (e, out, err) => (e ? rej(new Error(String(err || e.message).trim())) : res(out.trim())))));
const quiet = { info: () => {}, log: () => {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
const ai = createAI({ log: quiet });
if (!ai.live) { console.error('AI is off (no ANTHROPIC_API_KEY or AI_MOCK=1)'); process.exit(1); }
const packs = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken, log: quiet });
const embed = vertexEmbedder({ gToken, project: process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617', log: quiet });
const memory = createBrandMemory({ ai, packs, embed, log: quiet, autoLearn: false });

for (const slug of process.argv.slice(2).length ? process.argv.slice(2) : ['wearcomet-com', 'allbirds-com']) {
  if (ai.meter.usd >= BUDGET) { console.log(`budget $${BUDGET} reached, skipping ${slug}`); continue; }
  const t0 = Date.now(); const r = await memory.learnFromLive(slug);
  console.log(`\n================ ${slug}: ${JSON.stringify(r)} in ${((Date.now() - t0) / 1e3).toFixed(1)}s`);
  const { files } = await memory.repo(slug);
  for (const [p, body] of Object.entries(files)) if (p !== 'LOG.md') console.log(`\n----- ${p}\n${body.trim()}`);
  const q = 'how do they write ad hooks and show the product';
  console.log(`\n----- search: "${q}"`); (await memory.search(slug, q, { k: 5 })).forEach((h) => console.log(`${h.score.toFixed(3)} [${h.topic}] ${h.text}`));
  console.log(`\n----- promptBlock (creative)\n${await memory.promptBlock(slug, { agent: 'creative' })}`);
}
console.log(`\nAI spend: $${ai.meter.usd.toFixed(4)} over ${ai.meter.calls} calls`, ai.meter.byTag);
