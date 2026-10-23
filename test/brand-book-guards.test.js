// Guards for the Brand Book: every problem found in the 23 Oct QA, kept from coming back for any brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dropKind } from '../drop-read.js';
import { auditBook } from '../tools/audit-brand-book.mjs';
import { blankBook, readLayer, viewOf } from '../jam2/brandbook.js';
import { groundProposals } from '../brand-book-routes.js';

const page = fs.readFileSync(new URL('../public/brand-book.js', import.meta.url), 'utf8');
const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); /* the page's code without its comments */

test('the page never uses an OS dropdown, never says "they", and never shows 0 before a count-up', () => {
  assert.ok(!/<select\b/.test(code), 'pickers, not <select>');
  assert.deepEqual(code.match(/\b(they|They|their|Their)\b/g) || [], [], 'name the brand, never "they"');
  assert.ok(!/textContent\s*=\s*'0'/.test(code), 'a count shows its real number until the count-up starts');
});

test('a #hash link in the book scrolls and never navigates (the app routes on the hash)', () => {
  for (const m of code.matchAll(/<a href="#[^"]*"([^>]*)>/g)) assert.match(m[1], /data-toc/, `a #link without the scroll handler: ${m[0]}`);
  assert.match(code, /data-toc[\s\S]{0,400}preventDefault/);
});

test('every file the picker offers is one Brew can read; the old formats get advice instead', () => {
  const accept = page.match(/accept="([^"]+)"/)[1].split(',').map((x) => x.replace('.', ''));
  for (const e of accept) assert.ok(dropKind(`f.${e}`) || /^(svg|ttf|otf|woff2?|zip)$/.test(e), `offered but unreadable: .${e}`);
  for (const e of ['doc', 'ppt', 'key', 'heic']) assert.ok(!accept.includes(e), `.${e} must not be offered`);
  assert.match(page, /heic: 'Send it as JPG or PNG'/);
});

test('a lost upload or ask never leaves its card on "Reading…" for good', () => {
  assert.match(code, /Promise\.race\(\[api\('POST'/);
});

test('an upload proposes only what the file says', () => {
  const kept = groundProposals([{ path: 'story.founderStory', value: 'Founded in a garage in 1999.' }, { path: 'tone.summary', value: 'Warm and playful.' }], 'Our voice is warm and playful.');
  assert.deepEqual(kept.map((x) => x.path), ['tone.summary']);
});

test('the all-brands audit catches each problem class (SEO cover, regex never-say, zero tile, leaks, missing catalogue)', () => {
  const profile = { name: 'X', category: 'Beauty', market: { primary: 'IN' }, catalog: { products: [{ handle: 'a', title: 'A', price: 100, img: 'https://cdn.x/a.jpg' }] } };
  const bookRead = { v: 1, cover: { tagline: 'Buy hair oil online at the best price', oneLine: "Explore X's most trusted range of hair care online" },
    proof: { ratings: [{ where: 'Judge.me', count: 0, rating: null }] }, products: { heroes: [{ title: 'Ghost' }], tiers: [{ name: 'Entry', from: '₹1', to: '₹2' }] } };
  const saved = { ...blankBook(), uploads: [{ id: 'u', name: 'old', at: '2026-01-01T00:00:00Z' }] };
  const P = auditBook({ slug: 'x', profile, brief: {}, config: { banned: '\\b(cure[sd]?)\\b' }, bookRead, saved, shop: null, winners: { ads: [{ id: '1', src: '/w.jpg' }] } }).join('\n');
  for (const re of [/older than/, /search title/, /search snippet/, /proof tile/, /products\.all is empty/, /no lo\/hi/, /no picture/, /two weeks/]) assert.match(P, re);
  assert.doesNotMatch(P, /never-say shows a pattern/, 'the read splits the category pattern into words');
  assert.doesNotMatch(P, /winners .* leak/, 'winners stay members-only');
});

test('a clean, current book passes the audit', async () => {
  const { BOOK_V } = await import('../brand-book-read.js');
  const profile = { name: 'Y', category: 'Apparel', market: { primary: 'US' }, catalog: { products: [] } };
  const P = auditBook({ slug: 'y', profile, brief: {}, config: {}, bookRead: { v: BOOK_V, cover: { tagline: 'Forever Faster' }, products: { heroes: [], tiers: [] } }, saved: null, shop: null, winners: null });
  assert.deepEqual(P, []);
  assert.ok(viewOf({ ...blankBook(), read: readLayer({ slug: 'y', profile, brief: {}, config: {} }) }, { scope: 'public' }).rulebook.length);
});
