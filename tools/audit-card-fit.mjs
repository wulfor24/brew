// Every saved card, every brand: does its button fit what it makes, and are its counts today's?
// Reads a local copy of the bucket (brands/<slug>/{seed,facts}.json and tenants/*.json) and runs each card through what a
// serve does (fillMake → fitCta → freshCounts). Prints, per brand, the cards that still break a rule; exit 1 if any does.
//   gcloud storage cp … into DIR, then: node tools/audit-card-fit.mjs DIR [--before]
// --before counts the same problems on the cards as saved, to compare with what is served.
import fs from 'node:fs';
import path from 'node:path';
import { fillMake, fitCta, inferMake, inferable, rulesCard, intendsAsset, MAKE_LABELS } from '../cards-gen.js';
import { countsOf, freshCounts } from '../card-nums.js';

const dir = process.argv[2], before = process.argv.includes('--before');
if (!dir) { console.error('usage: node tools/audit-card-fit.mjs DIR [--before]'); process.exit(2); }
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const cardsOf = (x) => (Array.isArray(x?.__m) ? x.__m.map((e) => e[1]) : Array.isArray(x) ? x : Object.values(x || {}));
const MAKES = /^(?:Make|Build|Draft|Generate)\b/;

const byBrand = new Map();
for (const slug of fs.readdirSync(path.join(dir, 'brands'))) {
  const seed = read(path.join(dir, 'brands', slug, 'seed.json')), facts = read(path.join(dir, 'brands', slug, 'facts.json')) || {};
  byBrand.set(slug, { counts: countsOf(facts, [], seed?.brand?.name || ''), cards: (seed?.posts || []).map((c) => ['pack', c]) });
}
for (const f of fs.readdirSync(path.join(dir, 'tenants'))) {
  const t = read(path.join(dir, 'tenants', f)); const b = byBrand.get(t?.brandId); if (!b) continue;
  for (const c of cardsOf(t.cards)) if (c && typeof c === 'object') b.cards.push([f.replace(/\.json$/, ''), c]);
}
let total = 0, bad = 0;
const rows = [];
for (const [slug, { counts, cards }] of byBrand) {
  const hits = { makingNoAsset: 0, buttonOnlyAd: 0, rulesWithStray: 0, staleCounts: 0 }, ex = [];
  for (const [where, c0] of cards) {
    if (!c0?.title || c0.done || ['dismissed', 'done', 'dropped', 'expired'].includes(c0.state)) continue; total++;
    const c = before ? JSON.parse(JSON.stringify(c0)) : freshCounts(fitCta(fillMake(JSON.parse(JSON.stringify(c0)))), counts);
    const label = c.cta?.label || '', p = [];
    /* a making button with nothing to make (the Arata ad-fatigue card) */
    /* live readings, demo and report cards get their buttons from the code that writes them (the jam makes what the button says): skipped */
    if (inferable(c) && MAKE_LABELS.has(label) && !c.make?.format && !inferMake(c) && !before) p.push('making button, nothing to make');
    if (before && MAKE_LABELS.has(label) && !c.make?.format && (c.makeDropped || rulesCard(c))) p.push('making button, nothing to make');
    /* an ad the card's words never ask for, only its button */
    const byWords = inferMake({ ...c, make: null, cta: { label: '' } }); /* what the title alone names */
    if (c.make?.inferred && /ad$|reel/.test(c.make.format) && !byWords && !intendsAsset(c)) p.push(`button-only ${c.make.format}`);
    /* a rules card carrying a picture its words never name */
    if (rulesCard(c) && c.make?.format && c.make.inferred && !byWords) p.push(`rules card with ${c.make.format}`);
    /* a count row that isn't today's */
    const now = freshCounts(c, counts); if (now !== c && JSON.stringify(now.rows) !== JSON.stringify(c.rows)) p.push('stale count rows');
    if (p.length) { bad++; for (const x of p) { if (/^making/.test(x)) hits.makingNoAsset++; else if (/^button-only/.test(x)) hits.buttonOnlyAd++; else if (/^rules/.test(x)) hits.rulesWithStray++; else hits.staleCounts++; } if (ex.length < 4) ex.push(`  ${where} ${c.id}: ${p.join(', ')} | "${String(c.title).slice(0, 60)}" [${label}]`); }
  }
  rows.push([slug, cards.length, hits, ex]);
}
for (const [slug, n, h, ex] of rows) { const s = Object.values(h).reduce((a, b) => a + b, 0); console.log(`${s ? '✖' : '✔'} ${slug} (${n} cards) making-no-asset ${h.makingNoAsset} · button-only ad ${h.buttonOnlyAd} · rules+asset ${h.rulesWithStray} · stale counts ${h.staleCounts}`); ex.forEach((x) => console.log(x)); }
console.log(`\n${before ? 'AS SAVED' : 'AS SERVED'}: ${bad} of ${total} open cards break a rule`);
process.exit(bad ? 1 : 0);
