// One-time clean-up after 22 Oct: card pages and plain-word rewrites saved in a brand's shared files before the team's cards were
// kept apart. A team-only card's page or rewrite moves to the brand's private/ copy (the team keeps it); a shared page of an ads,
// creative, storefront or signals card on a brand with real connected numbers is dropped (it may have been built with the team's
// baseline; it is written again, without it, the next time someone opens the card). Every file changed is backed up first under
// private/backup-<date>/. Dry run by default.
// Usage: node tools/private-cleanup.mjs [--apply] [slug …]   (no slug: every brand with a real connected account)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plainKey } from '../plain.js';
import { isPrivateCard } from '../connectors/common.js';

const B = 'gs://brew-prototype/brands', apply = process.argv.includes('--apply'), want = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const g = (...a) => execFileSync('gcloud', ['storage', ...a], { encoding: 'utf8', maxBuffer: 256e6, stdio: ['ignore', 'pipe', 'ignore'] });
const cat = (slug, f, d = null) => { try { return JSON.parse(g('cat', `${B}/${slug}/${f}`)); } catch { return d; } };
const put = (slug, f, x) => { const t = path.join(os.tmpdir(), `pc-${process.pid}-${f.replace(/\W/g, '_')}`); fs.writeFileSync(t, JSON.stringify(x)); g('cp', t, `${B}/${slug}/${f}`, '--quiet'); fs.rmSync(t); };
const BASELINED = new Set(['ads', 'creatives', 'storefront', 'signals']), day = new Date().toISOString().slice(0, 10);

const slugs = want.length ? want : g('ls', `${B}/`).split('\n').map((x) => x.replace(`${B}/`, '').replace(/\/$/, '')).filter(Boolean)
  .filter((s) => (cat(s, 'private/connected-ledger.json', []) || []).some((e) => /^account:/.test(e?.method || '')));
const out = [];
for (const slug of slugs) {
  const ledger = cat(slug, 'private/connected-ledger.json', []) || [], connected = ledger.some((e) => /^account:/.test(e?.method || ''));
  const live = g('ls', `${B}/${slug}/private/live/`).split('\n').filter((x) => x.endsWith('.json')).map((u) => { try { return JSON.parse(g('cat', u)); } catch { return null; } }).filter(Boolean);
  const privCards = [...(cat(slug, 'private/cards.json', []) || []), ...live.flatMap((d) => d.cards || [])];
  const sector = new Map((cat(slug, 'seed.json', {})?.posts || []).map((c) => [String(c.id), c.sector]));
  const r = { slug, pagesMoved: 0, pagesDropped: 0, plainMoved: 0 };
  /* pages: a team card's page goes to private/pages.json under its priv| key; a baselined shared page goes */
  const pages = cat(slug, 'pages.json'), ppages = cat(slug, 'private/pages.json', {}) || {};
  if (pages) { const keep = {};
    for (const [k, v] of Object.entries(pages)) { const id = k.split('|')[0];
      if (k.startsWith('priv|') || isPrivateCard({ id })) { ppages[k.startsWith('priv|') ? k : `priv|${k}`] = v; r.pagesMoved++; }
      else if (connected && BASELINED.has(sector.get(id))) r.pagesDropped++;
      else keep[k] = v; }
    if (apply && (r.pagesMoved || r.pagesDropped)) { put(slug, `private/backup-${day}/pages.json`, pages); put(slug, 'private/pages.json', ppages); put(slug, 'pages.json', keep); } }
  /* plain words: a team card's rewrite (keyed by its words) moves to private/plain.json */
  const plain = cat(slug, 'plain.json'), pplain = cat(slug, 'private/plain.json', {}) || {};
  if (plain) { const bad = new Set(privCards.map(plainKey)), keep = {};
    for (const [k, v] of Object.entries(plain)) { if (bad.has(k)) { pplain[k] = v; r.plainMoved++; } else keep[k] = v; }
    if (apply && r.plainMoved) { put(slug, `private/backup-${day}/plain.json`, plain); put(slug, 'private/plain.json', pplain); put(slug, 'plain.json', keep); } }
  out.push(r);
}
console.log(JSON.stringify({ apply, brands: out }, null, 1));
