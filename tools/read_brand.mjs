#!/usr/bin/env node
// Read a brand for real and write its pack: .brands/<slug>/{profile,ledger,findings}.json
//   node tools/read_brand.mjs <url> [--only=open,brand,catalog] [--free] [--fresh] [--quiet]
//   --free   skips treg and Claude (only free sources: the site itself, puppeteer, public review feeds)
//   --fresh  ignores today's cached raw fetches
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.ENV_FILE || path.join(ROOT, '..', 'ugc-factory', '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const flag = (k) => args.some((a) => a === `--${k}`);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!url) { console.error('usage: node tools/read_brand.mjs <url> [--only=open,brand,catalog] [--free] [--fresh]'); process.exit(1); }
const free = flag('free');

const { createReader } = await import('../reader/index.js');
let ai = null, treg = null;
if (!free) {
  const { createAI } = await import('../ai.js'); const { createTreg } = await import('../treg.js');
  ai = createAI({ log: { info: () => {}, error: console.error, warn: console.warn } }); treg = createTreg({ log: console });
}
const quiet = flag('quiet');
const log = { log: () => {}, info: () => {}, warn: (...a) => !quiet && console.warn('  !', ...a), error: console.error };
const reader = createReader({ ai, treg, log });
const ac = new AbortController(); process.on('SIGINT', () => ac.abort(new Error('interrupted')));
const sec = (ms) => (ms / 1e3).toFixed(1).padStart(5) + 's';
const res = await reader.read(url, { only: only.length ? only : null, free, fresh: flag('fresh'), signal: ac.signal, onEvent: (e) => {
  if (quiet) return;
  if (e.type === 'step' && e.state === 'reading') console.log(`${sec(e.ms)}  ${e.k.padEnd(8)} … ${e.tick}`);
  else if (e.type === 'step') console.log(`${sec(e.ms)}  ${e.k.padEnd(8)} ${e.state === 'done' ? '✓' : '·'} ${e.done}`);
  else if (e.type === 'sub') console.log(`${sec(e.ms)}  ${e.k.padEnd(8)} ${e.state ? '✓ ' + e.done : '… ' + e.tick}`);
  else if (e.type === 'finding') { const f = e.finding; console.log(`${sec(e.ms)}  ${e.k.padEnd(8)} ◆ [${f.kind}] ${f.t} · ${f.src}`); const body = f.p || f.copy || f.a || (f.rows || []).map((r) => r.join(': ')).join(' | ') || (f.quotes || []).join(' ') || (f.imgs || []).join(' ') || (f.colors ? `${f.logo} ${f.colors.join(' ')} ${f.typeName}` : '') || f.img || ''; if (body) console.log(`           ${String(body).slice(0, 400)}`); if (f.cap || f.foot) console.log(`           — ${f.cap || f.foot}`); }
  else if (e.type === 'ready') console.log(`${sec(e.ms)}  ready`);
} });
const dir = path.join(ROOT, '.brands', res.slug); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(res.profile, null, 1));
fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(res.ledger, null, 1));
fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify(res.findings, null, 1));
const m = res.profile.meta;
console.log(`\n${res.slug}: ${res.ledger.length} ledger entries, ${res.findings.cards.length} findings, ${(m.ms / 1e3).toFixed(0)} s · http ${m.http.fetched} fetched / ${m.http.cached} cached · spend treg $${m.usd.treg.toFixed(4)} · claude $${m.usd.ai.toFixed(4)}`);
if (Object.keys(m.errors).length) console.log('errors:', m.errors);
console.log('timings:', Object.fromEntries(Object.entries(m.timings).map(([k, v]) => [k, Math.round(v / 100) / 10])));
console.log(`wrote ${path.relative(process.cwd(), dir)}/{profile,ledger,findings}.json`);
