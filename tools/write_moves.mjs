#!/usr/bin/env node
// Write the brief and moves for one brand pack.
//   node tools/write_moves.mjs --brand arata-in [--from test/fixtures/arata] [--only 3,21] [--mock] [--concurrency 6]
//                              [--brief-only] [--rebrief] [--no-verify] [--effort high] [--search 3] [--budget 4]
// Reads .brands/<slug>/{profile,ledger}.json (or --from <dir>), writes brief.md/json if missing, moves/NN.json,
// moves.json and cost.json. Prints the spend meter as it goes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
if (arg('mock')) process.env.AI_MOCK = '1';

// env: same parser as server.js
const envFile = process.env.ENV_FILE || path.join(ROOT, '..', 'ugc-factory', '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m || process.env[m[1]] !== undefined) continue;
  process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const { createAI } = await import('../ai.js');
const { createTreg } = await import('../treg.js');
const { createBrief } = await import('../brief.js');
const { createMovesEngine } = await import('../moves-engine.js');

const slug = arg('brand'); if (!slug || slug === true) { console.error('usage: --brand <slug>'); process.exit(1); }
const dir = path.join(ROOT, '.brands', slug), mdir = path.join(dir, 'moves');
fs.mkdirSync(mdir, { recursive: true });
const from = arg('from') ? path.resolve(ROOT, arg('from')) : dir;
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const profile = J(path.join(from, 'profile.json')), ledger = J(path.join(from, 'ledger.json'));
// --from reads the evidence elsewhere (e.g. a test fixture) and never overwrites the pack's own profile/ledger

const log = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
const ai = createAI({ log }), treg = createTreg({ log });
const budget = +arg('budget', 0);
const meter = () => `$${(ai.meter.usd + treg.meter.usd).toFixed(3)} (ai $${ai.meter.usd.toFixed(3)}, treg $${treg.meter.usd.toFixed(3)})`;
// the budget never kills a call in flight (that would throw away paid work): moves not yet started are skipped instead
ai.onCharge((tag, usd) => { console.log(`  [meter] ${tag} +$${usd.toFixed(3)} → ${meter()}`); if (budget && ai.meter.usd + treg.meter.usd > budget) console.warn(`budget $${budget} reached: no new moves will start`); });
const saveCost = () => {
  const f = path.join(dir, 'cost.json'); let c = { usd: 0, byTag: {} }; try { c = J(f); } catch {}
  for (const [k, v] of Object.entries({ ...ai.meter.byTag, ...Object.fromEntries(Object.entries(treg.meter.byTag).map(([k, v]) => ['treg:' + k, v])) })) c.byTag[k] = (c.byTag[k] || 0) + v;
  c.usd = Object.values(c.byTag).reduce((a, b) => a + b, 0); fs.writeFileSync(f, JSON.stringify(c, null, 1));
};
console.log(`brand ${slug} · AI ${ai.live ? 'live' : 'mock'} · treg ${treg.live ? 'live' : 'off'} · ledger ${ledger.length} entries`);

// brief
let brief = null;
const bmd = path.join(dir, 'brief.md'), bjs = path.join(dir, 'brief.json');
if (fs.existsSync(bmd) && !arg('rebrief')) brief = { md: fs.readFileSync(bmd, 'utf8'), json: fs.existsSync(bjs) ? J(bjs) : null };
if (!brief || (brief.json?.meta?.mock && ai.live)) {
  const t0 = Date.now();
  brief = await createBrief({ ai, log }).write(profile, ledger);
  fs.writeFileSync(bmd, brief.md); fs.writeFileSync(bjs, JSON.stringify(brief.json, null, 1));
  console.log(`brief written in ${((Date.now() - t0) / 1e3).toFixed(0)}s, ${brief.md.split(/\s+/).length} words · ${meter()}`);
}
if (arg('brief-only')) { saveCost(); process.exit(0); }

const engine = createMovesEngine({ ai, treg, log });
const pad = (n) => String(n).padStart(2, '0');
const only = arg('only') && arg('only') !== true ? String(arg('only')).split(',').map(Number) : null;
const ctx = {
  canSpend: () => !budget || ai.meter.usd + treg.meter.usd < budget,
  brand: { name: profile.name, descriptor: profile.descriptor, host: profile.host }, brief, profile, ledger, effort: arg('effort', 'high'), search: arg('search') != null ? +arg('search') : undefined,
  load: (n) => { try { return J(path.join(mdir, `${pad(n)}.json`)); } catch { return null; } },
  save: (n, m) => {
    fs.writeFileSync(path.join(mdir, `${pad(n)}.json`), JSON.stringify(m, null, 1));
    const all = fs.readdirSync(mdir).filter((f) => /^\d\d\.json$/.test(f)).sort().map((f) => J(path.join(mdir, f)));
    fs.writeFileSync(path.join(dir, 'moves.json'), JSON.stringify(all, null, 1));
  }
};
const t0 = Date.now();
const { errors } = await engine.runAll(ctx, { only, concurrency: +arg('concurrency', 6), verify: !arg('no-verify'),
  onMove: (n, m) => {
    const words = JSON.stringify(m.sections).split(/\s+/).length;
    console.log(`✓ ${pad(n)} ${m.title} · ${m.stat} ${m.statLabel} · ~${words} words · ${m.meta?.secs ?? '-'}s · $${(m.meta?.usd || 0).toFixed(3)} · verify ${JSON.stringify(m.meta?.verify || {})} · ${meter()}`);
  } });
saveCost();
console.log(`done in ${((Date.now() - t0) / 1e3).toFixed(0)}s · ${meter()}${errors.length ? ` · errors ${JSON.stringify(errors)}` : ''}`);
