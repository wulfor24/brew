#!/usr/bin/env node
// Audit every brand's feed cards against the creative catalog: repeated asks (same format + product + angle), generic asset
// lines ("a new ad"), and make.format values the catalog does not know. Brand-agnostic; exits 1 when anything is found.
//   node tools/audit-cards.mjs              # every pack under .brands/
//   node tools/audit-cards.mjs --bucket     # every pack in the live bucket (BREW_BUCKET or gs://brew-prototype, via gsutil)
//   node tools/audit-cards.mjs --json       # machine-readable
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isGeneric, keyOf, isFormat, repeats } from '../creative-catalog.js';
import { catalogOf } from '../product-match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const useBucket = args.has('--bucket');
const bucket = process.env.BREW_BUCKET || 'gs://brew-prototype';

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
function localPacks() {
  const dir = path.join(ROOT, '.brands');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((s) => !s.startsWith('_') && fs.existsSync(path.join(dir, s, 'seed.json')))
    .map((slug) => ({ slug, seed: readJSON(path.join(dir, slug, 'seed.json')), profile: readJSON(path.join(dir, slug, 'profile.json')) }));
}
function bucketPacks() {
  const list = execFileSync('gsutil', ['ls', `${bucket}/brands/`], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const out = [];
  for (const u of list) {
    const slug = u.replace(/\/$/, '').split('/').pop(); if (!slug || slug.startsWith('_')) continue;
    const get = (f) => { try { return JSON.parse(execFileSync('gsutil', ['cat', `${u}${f}`], { encoding: 'utf8', maxBuffer: 64e6 })); } catch { return null; } };
    const seed = get('seed.json'); if (!seed) continue;
    out.push({ slug, seed, profile: get('profile.json') });
  }
  return out;
}

const packs = useBucket ? bucketPacks() : localPacks();
const rows = [], detail = {};
for (const { slug, seed, profile } of packs) {
  const cards = (seed?.posts || []).filter((c) => c && typeof c === 'object');
  const made = cards.filter((c) => c.make?.format);
  const catalog = catalogOf(profile || {}), brand = profile?.name || seed?.brand?.name || '';
  const unknown = made.filter((c) => !isFormat(c.make.format)).map((c) => ({ id: c.id, format: c.make.format }));
  const empty = made.filter((c) => !String(c.make.pieces || '').trim()).map((c) => ({ id: c.id, format: c.make.format })); /* a format with no asset line (back-filled at load, or the writer left it out) */
  const generic = made.filter((c) => String(c.make.pieces || '').trim() && isGeneric(c.make.pieces)).map((c) => ({ id: c.id, format: c.make.format, pieces: c.make.pieces || '' }));
  const reps = repeats(made, catalog, { brand });
  detail[slug] = { cards: cards.length, made: made.length, unknown, generic, empty, repeats: reps };
  rows.push({ brand: slug, cards: cards.length, made: made.length, repeats: reps.reduce((a, r) => a + r.ids.length - 1, 0), generic: generic.length, empty: empty.length, unknown: unknown.length });
}

if (args.has('--json')) { console.log(JSON.stringify({ rows, detail }, null, 2)); }
else {
  const w = (s, n) => String(s).padEnd(n);
  console.log(`${w('brand', 28)}${w('cards', 7)}${w('make', 6)}${w('repeats', 9)}${w('generic', 9)}${w('empty', 7)}unknown`);
  for (const r of rows) console.log(`${w(r.brand, 28)}${w(r.cards, 7)}${w(r.made, 6)}${w(r.repeats, 9)}${w(r.generic, 9)}${w(r.empty, 7)}${r.unknown}`);
  for (const [slug, d] of Object.entries(detail)) {
    if (!d.repeats.length && !d.generic.length && !d.unknown.length && !d.empty.length) continue;
    console.log(`\n${slug}`);
    for (const r of d.repeats) console.log(`  repeat  ${r.key}  ←  ${r.ids.join(', ')}`);
    for (const g of d.generic) console.log(`  generic ${g.id} [${g.format}] "${g.pieces}"`);
    for (const u of d.unknown) console.log(`  unknown ${u.id} format "${u.format}"`);
    if (d.empty.length) console.log(`  empty   ${d.empty.map((e) => `${e.id} [${e.format}]`).join(', ')}`);
  }
  const tot = rows.reduce((a, r) => ({ repeats: a.repeats + r.repeats, generic: a.generic + r.generic, empty: a.empty + r.empty, unknown: a.unknown + r.unknown }), { repeats: 0, generic: 0, empty: 0, unknown: 0 });
  console.log(`\n${packs.length} packs · ${tot.repeats} repeats · ${tot.generic} generic · ${tot.empty} empty asset lines · ${tot.unknown} unknown formats`);
}
process.exit(rows.some((r) => r.repeats || r.generic || r.empty || r.unknown) ? 1 : 0);
