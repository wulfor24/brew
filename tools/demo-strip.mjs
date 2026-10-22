// The demo site's copy of a brand keeps only what anyone may see. demo-sync.sh downloads a few files into <dir>, this rewrites
// them in place, and writes <dir>/canary.txt: the team's real numbers and campaign names, which the sync then greps for in the
// demo bucket and refuses to finish if any are there.
//   updates.json  drops the team's run state (connectDone, connectRun, queue, pot, cardsDue, rewriting) and every history line's "because"
//   pages.json    keeps only pages of public cards, and none for a card whose page may carry the team's baseline
//   plain.json    drops the rewrites of the team's private cards (matched by plainKey on private/cards.json and private/live/*)
// Usage: node tools/demo-strip.mjs <dir>     (files that aren't in <dir> are skipped)
import fs from 'node:fs';
import path from 'node:path';
import { plainKey } from '../plain.js';
import { isPrivateCard } from '../connectors/common.js';

const dir = process.argv[2]; if (!dir) { console.error('usage: node tools/demo-strip.mjs <dir>'); process.exit(1); }
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };
const write = (f, x) => fs.writeFileSync(path.join(dir, f), JSON.stringify(x));
const out = { dropped: {} };

/* the team's cards: rewritten moves (private/cards.json) and every connected account's cards (private/live/*.json) */
const liveDir = path.join(dir, 'private-live'), live = fs.existsSync(liveDir) ? fs.readdirSync(liveDir).filter((f) => f.endsWith('.json')).map((f) => read(path.join('private-live', f), {})) : [];
const privCards = [...(read('private-cards.json', []) || []), ...live.flatMap((d) => d?.cards || [])];
const ledger = [...(read('private-ledger.json', []) || []), ...live.flatMap((d) => d?.ledger || [])];
/* a brand with real connected numbers: a shared page of an ads, creative, storefront or signals card may have been built with the team's baseline */
const connected = ledger.some((e) => /^account:/.test(e?.method || ''));
const BASELINED = new Set(['ads', 'creatives', 'storefront', 'signals']);

const upd = read('updates.json');
if (upd) {
  for (const k of ['connectDone', 'connectRun', 'connectFull', 'queue', 'pot', 'cardsDue', 'rewriting']) if (k in upd) { delete upd[k]; out.dropped[k] = true; }
  upd.stale = Object.fromEntries(Object.entries(upd.stale || {}).filter(([, v]) => !v?.private && !v?.live));
  upd.history = (upd.history || []).filter((h) => !h?.private && !h?.connected).map((h) => ({ ...h, because: null }));
  upd.connected = {}; upd.auto = false;
  write('updates.json', upd);
}

const seed = read('seed.json', {}) || {}, sector = new Map((seed.posts || []).map((c) => [String(c.id), c.sector]));
const pages = read('pages.json');
if (pages) { let n = 0;
  const keep = Object.fromEntries(Object.entries(pages).filter(([k]) => { const id = k.split('|')[0];
    const ok = !isPrivateCard({ id }) && !k.startsWith('priv|') && !(connected && BASELINED.has(sector.get(id))); if (!ok) n++; return ok; }));
  write('pages.json', keep); out.dropped.pages = n; }

const plain = read('plain.json');
if (plain) { const bad = new Set(privCards.map(plainKey)); let n = 0;
  const keep = Object.fromEntries(Object.entries(plain).filter(([k]) => (bad.has(k) ? (n++, false) : true)));
  write('plain.json', keep); out.dropped.plain = n; }

/* the canary: every real figure a connected account wrote (₹50.3 L, ₹780, 1.95x …) and the names on its cards */
const canary = new Set();
for (const e of ledger) if (/^account:/.test(e?.method || '') && typeof e.v === 'string' && /\d/.test(e.v) && e.v.length >= 4) for (const part of e.v.split(/;\s*/)) if (part.length >= 4) { canary.add(part.trim()); const nm = part.split(': ')[0].trim(); if (nm !== part.trim() && nm.length >= 6) canary.add(nm); } /* a campaign row also by its bare name */
for (const c of live.flatMap((d) => d?.cards || [])) for (const [label, v] of c.rows || []) if (/^(From|To|Campaign|Tired ad)/.test(label) && typeof v === 'string') canary.add(v.split(' · ')[0].trim());
fs.writeFileSync(path.join(dir, 'canary.txt'), [...canary].filter((x) => x.length >= 4).join('\n') + (canary.size ? '\n' : ''));
out.canary = canary.size;
console.log(JSON.stringify(out));
