// Bring a brand pack made by the old feed in line with the Brew prototype's scope. Run on a local copy of the pack
// before it is uploaded to the prototype's bucket:  node tools/prepare-pack.mjs .brands/<slug>
//   - audit moves are retired (moved to moves/history/, their cards and PDFs leave): the prototype writes no audit moves
//   - automation moves keep their plan but lose the runnable program (Brew never runs routines): the routine text says the
//     team runs it from the shared brief
//   - files of cut features are removed: private/ (accounts, actions, spend), spend/, notify.json, pagespeed.json
// It only touches the folder it is given. Safe to run twice.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'status.json'))) { console.error('usage: node tools/prepare-pack.mjs <pack dir>'); process.exit(1); }
const J = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };
const W = (f, v) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(v, null, 1)); };
const out = [];

const moves = J('moves.json', {}) || {}, cadence = J('moves/cadence.json', {}) || {};
const audit = Object.values(moves).filter((m) => m?.family === 'audit').map((m) => m.n);
for (const n of audit) {
  const f = path.join(dir, 'moves', `${n}.json`);
  if (fs.existsSync(f)) { fs.mkdirSync(path.join(dir, 'moves/history'), { recursive: true }); fs.renameSync(f, path.join(dir, 'moves/history', `${n}.retired-audit.json`)); }
  delete moves[n];
  for (const p of fs.existsSync(path.join(dir, 'pdf')) ? fs.readdirSync(path.join(dir, 'pdf')) : []) if (p.startsWith(`${n} `)) fs.rmSync(path.join(dir, 'pdf', p));
}
if (audit.length) out.push(`retired audit moves ${audit.join(', ')}`);
if (cadence.live?.audit) { delete cadence.live.audit; if (cadence.last) delete cadence.last.audit; delete cadence.auditReadAt; cadence.runningAt = null; W('moves/cadence.json', cadence); }

const ROUTINE = /Brew runs its own steps only once the program is approved with limits; anything that sends or spends waits for that approval\./;
let auto = 0;
for (const m of Object.values(moves)) {
  if (m?.family !== 'auto') continue;
  delete m.program;
  for (const s of m.sections || []) for (const b of s.blocks || []) if (typeof b.text === 'string' && ROUTINE.test(b.text)) b.text = b.text.replace(ROUTINE, 'The team runs it from the shared brief; Brew does not run it.');
  W(`moves/${m.n}.json`, m); auto++;
}
if (auto) out.push(`automation moves made plan-only: ${auto}`);
W('moves.json', moves);

const seed = J('seed.json');
if (seed?.posts) {
  const gone = new Set(audit.map((n) => `m${n}-`)), before = seed.posts.length;
  seed.posts = seed.posts.filter((p) => ![...gone].some((g) => String(p.id).startsWith(g)));
  const autoNs = new Set(Object.values(moves).filter((m) => m?.family === 'auto').map((m) => m.n));
  for (const p of seed.posts) { delete p.program; const n = +(/^m(\d+)-/.exec(p.id || '')?.[1] ?? NaN); if (autoNs.has(n) && p.plan) { delete p.plan; out.push(`stored plan dropped: ${p.id}`); } } /* the card plan is rebuilt with the share-the-brief steps */
  if (seed.health) seed.health.v = null; // the simulated rings (dummy/health.js) replace it at load
  W('seed.json', seed); if (before !== seed.posts.length) out.push(`cards removed: ${before - seed.posts.length}`);
}
for (const x of ['private', 'spend', 'raw']) if (fs.existsSync(path.join(dir, x))) { fs.rmSync(path.join(dir, x), { recursive: true }); out.push(`removed ${x}/`); }
for (const x of ['notify.json', 'pagespeed.json']) if (fs.existsSync(path.join(dir, x))) { fs.rmSync(path.join(dir, x)); out.push(`removed ${x}`); }
console.log(out.join('\n') || 'nothing to change');
