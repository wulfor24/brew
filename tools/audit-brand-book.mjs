// Every brand's Brand Book, every scope: the problems found and fixed on 23 Oct must never come back, for any brand.
// Reads a local copy of the bucket (brands/<slug>/{profile,brief,config,brandbook-read,facts}.json + private/{brandbook,shop-brand,
// meta-winners}.json) and builds each book the way the page, the share link and the free kit do (viewOf member/share/public).
// Prints, per brand, what breaks a rule; exit 1 if anything does.
//   gcloud storage cp -r "gs://brew-prototype/brands/<slug>/*.json" … into DIR/brands/<slug>/ (and private/), then:
//   node tools/audit-brand-book.mjs DIR
import fs from 'node:fs';
import path from 'node:path';
import { blankBook, readLayer, viewOf, claimKey } from '../jam2/brandbook.js';
import { bookNumbers } from '../facts-desk.js';
import { BOOK_V, taglineOk, oneLineOk } from '../brand-book-read.js';

const dir = process.argv[2];
const read = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'brands', ...p), 'utf8')); } catch { return null; } };
const REGEX_BITS = /[|\\()[\]^$*+?]/;

/* each check: a name, and what it finds in one brand's views (a list of short problem lines) */
export function auditBook({ slug, profile, brief, config, bookRead, saved, shop, winners, facts = null }) {
  const P = [], bb = { ...blankBook(), ...(saved || {}), shop, winners, read: readLayer({ slug, profile, brief, config: config || {}, book: bookRead }) };
  const views = Object.fromEntries(['member', 'share', 'public'].map((s) => [s, viewOf(structuredClone(bb), { scope: s })]));
  const m = views.member;
  if (!bookRead) return ['no book built yet'];
  if ((bookRead.v || 0) < BOOK_V) P.push(`book v${bookRead.v} is older than v${BOOK_V} (rebuilds on the next open)`);
  for (const [s, v] of Object.entries(views)) {
    /* 1. the cover is the brand talking, never a search snippet (Shopify about/slogan, page titles) */
    if (v.cover?.tagline && !taglineOk(v.cover.tagline)) P.push(`${s}: cover tagline reads like a search title: "${v.cover.tagline}"`);
    if (v.cover?.oneLine && !oneLineOk(v.cover.oneLine) && v.cover.oneLine.length <= 180) P.push(`${s}: cover line reads like a search snippet: "${v.cover.oneLine}"`);
    /* 2. never-say shows plain words, never a regex */
    for (const w of [...(v.never || []), ...(v.neverSay || [])]) if (REGEX_BITS.test(w)) P.push(`${s}: never-say shows a pattern, not words: "${w}"`);
    /* 3. rules exist, in their four groups, and makers can read them */
    if (!(v.rulebook || []).some((r) => r.id === 'claims-own')) P.push(`${s}: rules missing the own-claims rule`);
    if ((v.rulebook || []).some((r) => !['claims', 'people', 'ai', 'safety'].includes(r.group))) P.push(`${s}: a rule outside the four groups`);
    /* 4. no zero tiles: a count that wasn't read is left out, never shown as 0 */
    for (const r of v.proof?.ratings || []) if (!(+r.count > 0) && !(+r.rating > 0)) P.push(`${s}: proof tile with nothing in it (${r.where})`);
    /* 8. each claim once (26 Oct: Nutrova's claims twice, with and without their bracketed note) */
    { const ks = (v.claims || []).map((c) => claimKey(c.text)); const dup = ks.find((k, i) => k && ks.findIndex((j) => j === k || (Math.min(j.length, k.length) >= 24 && (j.startsWith(k) || k.startsWith(j)))) !== i); if (dup) P.push(`${s}: a claim listed twice: "${dup}"`); }
  }
  /* 5. what only the team may see stays out of the share link and the free kit */
  for (const s of ['share', 'public']) {
    const v = views[s];
    if (v.library?.['ad-winners']?.length) P.push(`${s}: Meta winners (members only) leak into ${s}`);
    if ((v.uploads || []).length) P.push(`${s}: uploads leak into ${s}`);
  }
  if ((views.public.rulebook || []).some((r) => r.src === 'team' || r.choice)) P.push('public: the team’s own rules or choices leak into the free kit');
  /* 6. products: the whole catalogue for the All products page, price steps it can filter by, a picture for every hero */
  const cat = profile?.catalog?.products || [];
  if (cat.length && !(m.products?.all || []).length) P.push(`products.all is empty while the catalogue has ${cat.length}`);
  for (const t of m.products?.tiers || []) if (t.lo == null || t.hi == null) P.push(`price step "${t.name}" has no lo/hi to filter by`);
  for (const h of m.products?.heroes || []) if (!h.img && !(m.products?.all || []).find((x) => x.title === h.title)?.img) P.push(`hero "${h.title}" has no picture anywhere`);
  /* 9. the numbers chapter: a person's source line ("from your sitemap · 22 Oct"), never a raw URL, a file, an ISO date or a test note (26 Oct) */
  if (facts) for (const x of bookNumbers(facts.facts || facts, { host: profile?.host || '' })) {
    if (/https?:|\/[\w-]+\.json|\b\d{4}-\d{2}-\d{2}\b/.test(`${x.from} ${x.day}`)) P.push(`number "${x.label}" shows a raw source: "${x.from} · ${x.day}"`);
    if (/\((?:[^)]*\b(?:headless|one run)\b)/i.test(x.label)) P.push(`number "${x.label}" carries a test note`); }
  /* 7. change cards: none left open for weeks (they float over the book) */
  const old = (saved?.uploads || []).filter((u) => !u.applied && !u.dismissed && u.at && Date.now() - Date.parse(u.at) > 14 * 864e5);
  if (old.length) P.push(`${old.length} change card(s) left open for over two weeks`);
  return [...new Set(P)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!dir) { console.error('usage: node tools/audit-brand-book.mjs DIR'); process.exit(2); }
  let bad = 0, n = 0;
  for (const slug of fs.readdirSync(path.join(dir, 'brands')).filter((s) => !s.startsWith('_'))) {
    const bookRead = read(slug, 'brandbook-read.json'); if (!bookRead && !read(slug, 'profile.json')) continue; n++;
    const P = auditBook({ slug, profile: read(slug, 'profile.json'), brief: read(slug, 'brief.json'), config: read(slug, 'config.json'), bookRead,
      saved: read(slug, 'private', 'brandbook.json'), shop: read(slug, 'private', 'shop-brand.json'), winners: read(slug, 'private', 'meta-winners.json'), facts: read(slug, 'facts.json') });
    if (P.length) { bad++; console.log(`✖ ${slug}\n  - ${P.join('\n  - ')}`); } else console.log(`✔ ${slug}`);
  }
  console.log(`\n${n - bad}/${n} brands clean`);
  process.exit(bad ? 1 : 0);
}
